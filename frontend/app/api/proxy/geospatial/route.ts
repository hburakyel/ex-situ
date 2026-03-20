import { type NextRequest, NextResponse } from "next/server"

// Simple in-memory cache for geospatial responses
const responseCache: Map<string, { data: any; timestamp: number }> = new Map()
const CACHE_DURATION_GLOBAL = 30 * 60 * 1000 // 30 minutes for zoom < 7 (country/city stats rarely change)
const CACHE_DURATION_LOCAL  =  5 * 60 * 1000 // 5 minutes for zoom >= 7 (viewport-dependent)

// Rate limiting - shared state
let lastRequestTime = 0
const MIN_REQUEST_INTERVAL = 300 // 300ms between requests for geospatial

// In-flight deduplication — prevents multiple concurrent requests for the same key
const inFlightRequests: Map<string, Promise<any>> = new Map()

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL

  console.log("[Geospatial Proxy] API_BASE_URL:", apiBaseUrl)

  if (!apiBaseUrl) {
    console.error("[Geospatial Proxy] NEXT_PUBLIC_API_BASE_URL is not set!")
    return NextResponse.json({ error: "API_BASE_URL is not configured" }, { status: 500 })
  }

  // Generate cache key from the request parameters
  const zoom = searchParams.get('zoom')
  const minLon = searchParams.get('minLon')
  const minLat = searchParams.get('minLat')
  const maxLon = searchParams.get('maxLon')
  const maxLat = searchParams.get('maxLat')
  const institution = searchParams.get('institution')
  const city = searchParams.get('city')
  const country = searchParams.get('country')
  
  const cacheKey = `geospatial:${zoom}:${minLon}:${minLat}:${maxLon}:${maxLat}:${institution || 'all'}:${city || 'all'}:${country || 'all'}`
  const zoomNum = parseInt(zoom || '2', 10)
  const cacheDuration = zoomNum < 7 ? CACHE_DURATION_GLOBAL : CACHE_DURATION_LOCAL

  // Check cache first
  const cachedResponse = responseCache.get(cacheKey)
  if (cachedResponse && Date.now() - cachedResponse.timestamp < cacheDuration) {
    return NextResponse.json(cachedResponse.data, {
      headers: {
        "Cache-Control": zoomNum < 7
          ? "public, max-age=1800, stale-while-revalidate=3600"  // 30min fresh + 1h stale
          : "public, max-age=60, stale-while-revalidate=300",
        "X-Cache": "HIT",
      },
    })
  }

  // ── In-flight deduplication ──────────────────────────────────────
  // If an identical request is already fetching, piggy-back on it
  const existingFlight = inFlightRequests.get(cacheKey)
  if (existingFlight) {
    try {
      const data = await existingFlight
      return NextResponse.json(data, {
        headers: {
          "Cache-Control": zoomNum < 7
            ? "public, max-age=1800, stale-while-revalidate=3600"
            : "public, max-age=60, stale-while-revalidate=300",
          "X-Cache": "DEDUP",
        },
      })
    } catch {
      // If the in-flight request failed, fall through and retry
    }
  }

  // Implement rate limiting
  const now = Date.now()
  const timeSinceLastRequest = now - lastRequestTime
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await wait(MIN_REQUEST_INTERVAL - timeSinceLastRequest)
  }
  lastRequestTime = Date.now()

  // Create a fetch promise and register it for deduplication
  const fetchPromise = (async () => {
    // Replace localhost with 127.0.0.1 to avoid DNS resolution issues in Node.js
    // Only forward known safe parameters — prevent Strapi filter injection
    const ALLOWED_GEO_PARAMS = new Set(['zoom', 'minLon', 'minLat', 'maxLon', 'maxLat', 'institution', 'city', 'country'])
    const safeParams = new URLSearchParams()
    for (const [key, value] of searchParams.entries()) {
      if (ALLOWED_GEO_PARAMS.has(key)) {
        safeParams.set(key, value)
      }
    }
    const resolvedBaseUrl = apiBaseUrl.replace('localhost', '127.0.0.1')
    const apiURL = `${resolvedBaseUrl}/museum-objects/geospatial?${safeParams.toString()}`

    const response = await fetch(apiURL, {
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "ExSitu/1.0",
      },
      cache: "no-store",
    })

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }

    return await response.json()
  })()

  inFlightRequests.set(cacheKey, fetchPromise)

  try {
    const data = await fetchPromise

    // Store in cache
    responseCache.set(cacheKey, { data, timestamp: Date.now() })

    // Clean up old cache entries if cache is too large
    if (responseCache.size > 100) {
      const oldestEntries = Array.from(responseCache.entries())
        .sort(([, a], [, b]) => a.timestamp - b.timestamp)
        .slice(0, 20)
      oldestEntries.forEach(([key]) => responseCache.delete(key))
    }

    console.log(`[Geospatial Proxy] Success: type=${data.type}, items=${data.data?.length || 0}`)

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": zoomNum < 7
          ? "public, max-age=1800, stale-while-revalidate=3600"
          : "public, max-age=60, stale-while-revalidate=300",
        "X-Cache": "MISS",
      },
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error("[Geospatial Proxy] Fetch Error:", errorMessage)

    // Return stale cache if available (stale-while-error)
    if (cachedResponse) {
      return NextResponse.json(cachedResponse.data, {
        headers: {
          "Cache-Control": "public, max-age=30",
          "X-Cache": "STALE",
        },
      })
    }

    return NextResponse.json({ 
      error: "Failed to fetch geospatial data",
      details: errorMessage 
    }, { status: 500 })
  } finally {
    inFlightRequests.delete(cacheKey)
  }
}

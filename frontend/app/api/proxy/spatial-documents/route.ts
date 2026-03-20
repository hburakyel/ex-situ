import { type NextRequest, NextResponse } from "next/server"

// Simple in-memory cache for spatial-document responses
const responseCache: Map<string, { data: any; timestamp: number }> = new Map()
const CACHE_DURATION_GLOBAL = 30 * 60 * 1000 // 30 min for low zoom
const CACHE_DURATION_LOCAL  =  5 * 60 * 1000 // 5 min  for high zoom

let lastRequestTime = 0
const MIN_REQUEST_INTERVAL = 300

const inFlightRequests: Map<string, Promise<any>> = new Map()
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL

  if (!apiBaseUrl) {
    return NextResponse.json({ error: "API_BASE_URL is not configured" }, { status: 500 })
  }

  // Build cache key from all relevant params
  const zoom = searchParams.get("zoom")
  const minLon = searchParams.get("minLon")
  const minLat = searchParams.get("minLat")
  const maxLon = searchParams.get("maxLon")
  const maxLat = searchParams.get("maxLat")
  const contentType = searchParams.get("contentType")

  const cacheKey = `spatial-doc:${zoom}:${minLon}:${minLat}:${maxLon}:${maxLat}:${contentType || "all"}`
  const zoomNum = parseInt(zoom || "2", 10)
  const cacheDuration = zoomNum < 7 ? CACHE_DURATION_GLOBAL : CACHE_DURATION_LOCAL

  // Check cache
  const cachedResponse = responseCache.get(cacheKey)
  if (cachedResponse && Date.now() - cachedResponse.timestamp < cacheDuration) {
    return NextResponse.json(cachedResponse.data, {
      headers: {
        "Cache-Control": zoomNum < 7
          ? "public, max-age=1800, stale-while-revalidate=3600"
          : "public, max-age=60, stale-while-revalidate=300",
        "X-Cache": "HIT",
      },
    })
  }

  // In-flight deduplication
  const existingFlight = inFlightRequests.get(cacheKey)
  if (existingFlight) {
    try {
      const data = await existingFlight
      return NextResponse.json(data, {
        headers: { "X-Cache": "DEDUP" },
      })
    } catch {
      // fall through
    }
  }

  // Rate limit
  const now = Date.now()
  if (now - lastRequestTime < MIN_REQUEST_INTERVAL) {
    await wait(MIN_REQUEST_INTERVAL - (now - lastRequestTime))
  }
  lastRequestTime = Date.now()

  const fetchPromise = (async () => {
    const resolvedBaseUrl = apiBaseUrl.replace("localhost", "127.0.0.1")
    // Only forward known safe parameters — prevent injection
    const ALLOWED_PARAMS = new Set(['zoom', 'minLon', 'minLat', 'maxLon', 'maxLat', 'contentType', 'institution', 'city', 'country'])
    const safeParams = new URLSearchParams()
    for (const [key, value] of searchParams.entries()) {
      if (ALLOWED_PARAMS.has(key)) {
        safeParams.set(key, value)
      }
    }
    const apiURL = `${resolvedBaseUrl}/spatial-documents/geospatial?${safeParams.toString()}`

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
    responseCache.set(cacheKey, { data, timestamp: Date.now() })

    // Evict old entries
    if (responseCache.size > 100) {
      const oldest = Array.from(responseCache.entries())
        .sort(([, a], [, b]) => a.timestamp - b.timestamp)
        .slice(0, 20)
      oldest.forEach(([key]) => responseCache.delete(key))
    }

    console.log(`[SpatialDoc Proxy] Success: type=${data.type}, items=${data.data?.length || 0}`)

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": zoomNum < 7
          ? "public, max-age=1800, stale-while-revalidate=3600"
          : "public, max-age=60, stale-while-revalidate=300",
        "X-Cache": "MISS",
      },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("[SpatialDoc Proxy] Error:", msg)

    if (cachedResponse) {
      return NextResponse.json(cachedResponse.data, {
        headers: { "X-Cache": "STALE" },
      })
    }

    return NextResponse.json({ error: "Failed to fetch spatial documents", details: msg }, { status: 500 })
  } finally {
    inFlightRequests.delete(cacheKey)
  }
}

import { type NextRequest, NextResponse } from "next/server"

// Simple in-memory cache for API responses
const responseCache: Map<string, { data: any; timestamp: number }> = new Map()
const CACHE_DURATION = 10 * 60 * 1000 // 10 minutes for individual objects

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // Prevent path traversal — id must be numeric
  if (!id || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: "Invalid object ID" }, { status: 400 })
  }

  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL

  // Generate cache key from the object ID
  const cacheKey = `object:${id}`

  // Check cache first
  const cachedResponse = responseCache.get(cacheKey)
  if (cachedResponse && Date.now() - cachedResponse.timestamp < CACHE_DURATION) {
    console.log("Using cached response for object:", id)
    return NextResponse.json(cachedResponse.data, {
      headers: {
        "Cache-Control": "public, max-age=600", // Cache for 10 minutes
        "X-Cache": "HIT",
      },
    })
  }

  if (!apiBaseUrl) {
    return NextResponse.json({ error: "API_BASE_URL is not set" }, { status: 500 })
  }

  try {
    // Fix localhost DNS resolution issue in Node.js by converting to 127.0.0.1
    const fixedApiBaseUrl = apiBaseUrl.replace("localhost", "127.0.0.1")
    const apiURL = `${fixedApiBaseUrl}/museum-objects/${id}?populate=*`
    console.log("Proxying single object request to:", apiURL)

    const response = await fetch(apiURL, {
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "ExSitu/1.0",
      },
      cache: "force-cache",
    })

    if (response.status === 404) {
      return NextResponse.json(
        { error: "Object not found", id },
        { status: 404 }
      )
    }

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`API error: ${response.status}`, errorText)
      return NextResponse.json(
        { error: `API error: ${response.status}`, details: errorText },
        { status: response.status }
      )
    }

    const data = await response.json()

    // Store in cache
    responseCache.set(cacheKey, { data, timestamp: Date.now() })

    // Clean up old cache entries if cache is too large
    if (responseCache.size > 500) {
      const oldestEntries = Array.from(responseCache.entries())
        .sort(([, a], [, b]) => a.timestamp - b.timestamp)
        .slice(0, 50)

      oldestEntries.forEach(([key]) => responseCache.delete(key))
    }

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, max-age=600",
        "X-Cache": "MISS",
      },
    })
  } catch (error) {
    console.error("❌ Proxy Fetch Error for object:", id, error)
    return NextResponse.json(
      { error: "Failed to fetch object" },
      { status: 500 }
    )
  }
}

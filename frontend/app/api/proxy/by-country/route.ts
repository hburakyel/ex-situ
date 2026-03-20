import { type NextRequest, NextResponse } from "next/server"

// Simple in-memory cache
const responseCache: Map<string, { data: any; timestamp: number }> = new Map()
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL

  if (!apiBaseUrl) {
    return NextResponse.json({ error: "API_BASE_URL is not configured" }, { status: 500 })
  }

  const country = searchParams.get("country")
  if (!country) {
    return NextResponse.json({ error: "country parameter is required" }, { status: 400 })
  }

  // Cache key
  const cacheKey = `by-country:${searchParams.toString()}`
  const cached = responseCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return NextResponse.json(cached.data, {
      headers: { "Cache-Control": "public, max-age=300", "X-Cache": "HIT" },
    })
  }

  try {
    const resolvedBaseUrl = apiBaseUrl.replace("localhost", "127.0.0.1")
    // Only forward known safe parameters — prevent Strapi filter injection
    const ALLOWED_PARAMS = new Set(['country', 'site', 'institution', 'page', 'pageSize'])
    const safeParams = new URLSearchParams()
    for (const [key, value] of searchParams.entries()) {
      if (ALLOWED_PARAMS.has(key)) {
        safeParams.set(key, value)
      }
    }
    const apiURL = `${resolvedBaseUrl}/museum-objects/by-country?${safeParams.toString()}`

    const response = await fetch(apiURL, {
      headers: { "Content-Type": "application/json", "User-Agent": "ExSitu/1.0" },
      cache: "no-store",
    })

    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after") || "5"
      return NextResponse.json(
        { error: "Rate limited" },
        { status: 429, headers: { "Retry-After": retryAfter } },
      )
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "")
      console.error(`[by-country proxy] API error: ${response.status}`, errorText)
      return NextResponse.json(
        { error: `API error: ${response.status}` },
        { status: response.status },
      )
    }

    const data = await response.json()

    // Cache response
    responseCache.set(cacheKey, { data, timestamp: Date.now() })

    // Evict old entries
    if (responseCache.size > 50) {
      const oldest = Array.from(responseCache.entries())
        .sort(([, a], [, b]) => a.timestamp - b.timestamp)
        .slice(0, 10)
      oldest.forEach(([key]) => responseCache.delete(key))
    }

    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, max-age=300", "X-Cache": "MISS" },
    })
  } catch (error) {
    console.error("[by-country proxy] Fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 })
  }
}

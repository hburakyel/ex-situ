import { type NextRequest, NextResponse } from "next/server"

// Simple in-memory cache — bucket counts only change when the underlying
// data changes, so a short cache is plenty and keeps repeated
// institution/city/country selections snappy.
const responseCache: Map<string, { data: any; timestamp: number }> = new Map()
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL

  if (!apiBaseUrl) {
    return NextResponse.json({ error: "API_BASE_URL is not configured" }, { status: 500 })
  }

  const institution = searchParams.get('institution')
  const city = searchParams.get('city')
  const country = searchParams.get('country')

  const cacheKey = `date-buckets:${institution || 'all'}:${city || 'all'}:${country || 'all'}`

  const cached = responseCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return NextResponse.json(cached.data, { headers: { "X-Cache": "HIT" } })
  }

  try {
    // Only forward known safe parameters
    const ALLOWED_PARAMS = new Set(['institution', 'city', 'country'])
    const safeParams = new URLSearchParams()
    for (const [key, value] of searchParams.entries()) {
      if (ALLOWED_PARAMS.has(key)) safeParams.set(key, value)
    }
    const resolvedBaseUrl = apiBaseUrl.replace('localhost', '127.0.0.1')
    const apiURL = `${resolvedBaseUrl}/museum-objects/date-buckets?${safeParams.toString()}`

    const response = await fetch(apiURL, {
      headers: { "Content-Type": "application/json", "User-Agent": "ExSitu/1.0" },
      cache: "no-store",
    })
    if (!response.ok) throw new Error(`API error: ${response.status}`)
    const data = await response.json()

    responseCache.set(cacheKey, { data, timestamp: Date.now() })
    if (responseCache.size > 50) {
      const oldest = Array.from(responseCache.entries()).sort(([, a], [, b]) => a.timestamp - b.timestamp).slice(0, 10)
      oldest.forEach(([key]) => responseCache.delete(key))
    }

    return NextResponse.json(data, { headers: { "X-Cache": "MISS" } })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    if (cached) {
      return NextResponse.json(cached.data, { headers: { "X-Cache": "STALE" } })
    }
    return NextResponse.json({ error: "Failed to fetch date buckets", details: errorMessage }, { status: 500 })
  }
}

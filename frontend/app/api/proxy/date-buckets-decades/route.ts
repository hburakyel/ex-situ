import { type NextRequest, NextResponse } from "next/server"

const responseCache: Map<string, { data: any; timestamp: number }> = new Map()
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL

  if (!apiBaseUrl) {
    return NextResponse.json({ error: "API_BASE_URL is not configured" }, { status: 500 })
  }

  const century = searchParams.get('century')
  if (!century) {
    return NextResponse.json({ error: "century parameter is required" }, { status: 400 })
  }
  const institution = searchParams.get('institution')
  const city = searchParams.get('city')
  const country = searchParams.get('country')

  const cacheKey = `date-buckets-decades:${century}:${institution || 'all'}:${city || 'all'}:${country || 'all'}`

  const cached = responseCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return NextResponse.json(cached.data, { headers: { "X-Cache": "HIT" } })
  }

  try {
    const ALLOWED_PARAMS = new Set(['century', 'institution', 'city', 'country'])
    const safeParams = new URLSearchParams()
    for (const [key, value] of searchParams.entries()) {
      if (ALLOWED_PARAMS.has(key)) safeParams.set(key, value)
    }
    const resolvedBaseUrl = apiBaseUrl.replace('localhost', '127.0.0.1')
    const apiURL = `${resolvedBaseUrl}/museum-objects/date-buckets/decades?${safeParams.toString()}`

    const response = await fetch(apiURL, {
      headers: { "Content-Type": "application/json", "User-Agent": "ExSitu/1.0" },
      cache: "no-store",
    })
    if (!response.ok) throw new Error(`API error: ${response.status}`)
    const data = await response.json()

    responseCache.set(cacheKey, { data, timestamp: Date.now() })
    if (responseCache.size > 100) {
      const oldest = Array.from(responseCache.entries()).sort(([, a], [, b]) => a.timestamp - b.timestamp).slice(0, 20)
      oldest.forEach(([key]) => responseCache.delete(key))
    }

    return NextResponse.json(data, { headers: { "X-Cache": "MISS" } })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    if (cached) {
      return NextResponse.json(cached.data, { headers: { "X-Cache": "STALE" } })
    }
    return NextResponse.json({ error: "Failed to fetch decade buckets", details: errorMessage }, { status: 500 })
  }
}

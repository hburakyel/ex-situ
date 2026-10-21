import { type NextRequest, NextResponse } from "next/server"

// Object search (inventory number or place text); cached 60s like suggest
const responseCache: Map<string, { data: any; timestamp: number }> = new Map()
const CACHE_DURATION = 60 * 1000

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL
  const resolvedUrl = apiBaseUrl
    ? apiBaseUrl.replace("localhost", "127.0.0.1")
    : "http://127.0.0.1:1337/api"

  const q = searchParams.get("q")
  if (!q || q.trim().length < 2) {
    return NextResponse.json({ data: [] })
  }

  const limit = Math.min(parseInt(searchParams.get("limit") || "8"), 20)
  const cacheKey = `search:${q.toLowerCase().trim()}:${limit}`
  const cached = responseCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return NextResponse.json(cached.data, { headers: { "X-Cache": "HIT" } })
  }

  try {
    const upstream = new URL(`${resolvedUrl}/museum-objects/search`)
    upstream.searchParams.set("q", q.trim())
    upstream.searchParams.set("limit", String(limit))

    const res = await fetch(upstream.toString(), { next: { revalidate: 60 } })
    if (!res.ok) return NextResponse.json({ data: [] }, { status: res.status })

    const data = await res.json()
    responseCache.set(cacheKey, { data, timestamp: Date.now() })
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, max-age=60" },
    })
  } catch {
    return NextResponse.json({ data: [] }, { status: 502 })
  }
}

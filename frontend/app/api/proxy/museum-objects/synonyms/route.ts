import { NextResponse } from "next/server"

// Cache synonyms for 24h — the table only changes when migrations run
let cachedData: any = null
let cacheTimestamp = 0
const CACHE_DURATION = 24 * 60 * 60 * 1000

export async function GET() {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL
  const resolvedUrl = apiBaseUrl
    ? apiBaseUrl.replace("localhost", "127.0.0.1")
    : "http://127.0.0.1:1337/api"

  if (cachedData && Date.now() - cacheTimestamp < CACHE_DURATION) {
    return NextResponse.json(cachedData, { headers: { "X-Cache": "HIT" } })
  }

  try {
    const res = await fetch(`${resolvedUrl}/museum-objects/synonyms`, {
      next: { revalidate: 86400 },
    })
    if (!res.ok) return NextResponse.json({ data: [] }, { status: res.status })

    const data = await res.json()
    cachedData = data
    cacheTimestamp = Date.now()
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, max-age=86400" },
    })
  } catch {
    return NextResponse.json({ data: [] }, { status: 502 })
  }
}

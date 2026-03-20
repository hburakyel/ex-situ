import { type NextRequest, NextResponse } from "next/server"

// Per-institution detail cache
const detailCache: Map<string, { data: any; timestamp: number }> = new Map()
const CACHE_DURATION = 3 * 60 * 1000 // 3 minutes

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ institution: string }> }
) {
  const rawUrl = process.env.NEXT_PUBLIC_API_BASE_URL
  const { institution } = await params

  if (!rawUrl) {
    return NextResponse.json({ error: "API_BASE_URL is not configured" }, { status: 500 })
  }

  // Node 18 undici resolves "localhost" to IPv6 ::1 — Strapi binds IPv4 only
  const apiBaseUrl = rawUrl.replace("://localhost", "://127.0.0.1")

  if (!institution) {
    return NextResponse.json({ error: "institution parameter required" }, { status: 400 })
  }

  const cacheKey = institution.toLowerCase()

  // Check cache
  const cached = detailCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return NextResponse.json(cached.data, {
      headers: { "Cache-Control": "public, max-age=180", "X-Cache": "HIT" },
    })
  }

  try {
    const url = `${apiBaseUrl}/museum-objects/resolver-stats/${encodeURIComponent(institution)}`
    console.log("[Resolver Detail Proxy] Fetching:", url)

    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("[Resolver Detail Proxy] Error:", response.status, errorText)
      return NextResponse.json(
        { error: `Backend returned ${response.status}` },
        { status: response.status }
      )
    }

    const data = await response.json()
    detailCache.set(cacheKey, { data, timestamp: Date.now() })

    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, max-age=180", "X-Cache": "MISS" },
    })
  } catch (error: any) {
    console.error("[Resolver Detail Proxy] Fetch error:", error.message)
    return NextResponse.json(
      { error: `Failed to fetch resolver detail: ${error.message}` },
      { status: 502 }
    )
  }
}

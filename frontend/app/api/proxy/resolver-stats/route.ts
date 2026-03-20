import { type NextRequest, NextResponse } from "next/server"

// Cache for resolver stats (refreshes every 5 minutes)
const statsCache: { data: any; timestamp: number } = { data: null, timestamp: 0 }
const CACHE_DURATION = 5 * 60 * 1000

export async function GET(request: NextRequest) {
  const rawUrl = process.env.NEXT_PUBLIC_API_BASE_URL

  if (!rawUrl) {
    return NextResponse.json({ error: "API_BASE_URL is not configured" }, { status: 500 })
  }

  // Node 18 undici resolves "localhost" to IPv6 ::1 — Strapi binds IPv4 only
  const apiBaseUrl = rawUrl.replace("://localhost", "://127.0.0.1")

  // Check cache
  if (statsCache.data && Date.now() - statsCache.timestamp < CACHE_DURATION) {
    return NextResponse.json(statsCache.data, {
      headers: {
        "Cache-Control": "public, max-age=300",
        "X-Cache": "HIT",
      },
    })
  }

  try {
    const url = `${apiBaseUrl}/museum-objects/resolver-stats`
    console.log("[Resolver Stats Proxy] Fetching:", url)

    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("[Resolver Stats Proxy] Error:", response.status, errorText)
      return NextResponse.json(
        { error: `Backend returned ${response.status}` },
        { status: response.status }
      )
    }

    const data = await response.json()

    // Cache the response
    statsCache.data = data
    statsCache.timestamp = Date.now()

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, max-age=300",
        "X-Cache": "MISS",
      },
    })
  } catch (error: any) {
    console.error("[Resolver Stats Proxy] Fetch error:", error.message)
    return NextResponse.json(
      { error: `Failed to fetch resolver stats: ${error.message}` },
      { status: 502 }
    )
  }
}

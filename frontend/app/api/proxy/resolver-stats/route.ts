import { NextResponse } from "next/server"

// Totals and per-institution places (name, place "City, Country"); the map reads the
// places to name an arc's destination city. Cached like the per-institution route.
let cache: { data: unknown; timestamp: number } | null = null
const CACHE_DURATION = 10 * 60 * 1000

export async function GET() {
  const rawUrl = process.env.NEXT_PUBLIC_API_BASE_URL
  if (!rawUrl) return NextResponse.json({ error: "API_BASE_URL is not configured" }, { status: 500 })
  if (cache && Date.now() - cache.timestamp < CACHE_DURATION) {
    return NextResponse.json(cache.data, { headers: { "X-Cache": "HIT" } })
  }
  // Node 18 undici resolves "localhost" to IPv6 ::1 — Strapi binds IPv4 only
  const apiBaseUrl = rawUrl.replace("://localhost", "://127.0.0.1")
  try {
    const res = await fetch(`${apiBaseUrl}/museum-objects/resolver-stats`, { cache: "no-store" })
    if (!res.ok) return NextResponse.json({ error: `upstream ${res.status}` }, { status: 502 })
    const data = await res.json()
    cache = { data, timestamp: Date.now() }
    return NextResponse.json(data, { headers: { "X-Cache": "MISS" } })
  } catch {
    return NextResponse.json({ error: "upstream unavailable" }, { status: 502 })
  }
}

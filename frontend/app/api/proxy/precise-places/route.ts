import { type NextRequest, NextResponse } from "next/server"

// Precise places inside a site (Istanbul → Dolmabahçe Palace …), cached briefly.
const cache: Map<string, { data: unknown; timestamp: number }> = new Map()
const CACHE_DURATION = 5 * 60 * 1000

export async function GET(request: NextRequest) {
  const rawUrl = process.env.NEXT_PUBLIC_API_BASE_URL
  if (!rawUrl) return NextResponse.json({ error: "API_BASE_URL is not configured" }, { status: 500 })
  const sp = request.nextUrl.searchParams
  const site = sp.get("site")
  if (!site || site.length > 200) return NextResponse.json({ error: "site parameter is required" }, { status: 400 })
  const params = new URLSearchParams({ site })
  for (const k of ["country", "institution"]) { const v = sp.get(k); if (v && v.length <= 200) params.set(k, v) }
  const key = params.toString()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.timestamp < CACHE_DURATION) return NextResponse.json(hit.data, { headers: { "X-Cache": "HIT" } })
  // Node 18 undici resolves "localhost" to IPv6 ::1 — Strapi binds IPv4 only
  const apiBaseUrl = rawUrl.replace("://localhost", "://127.0.0.1")
  try {
    const res = await fetch(`${apiBaseUrl}/museum-objects/precise-places?${key}`, { cache: "no-store" })
    if (!res.ok) return NextResponse.json({ data: [] }, { status: 200 })
    const data = await res.json()
    cache.set(key, { data, timestamp: Date.now() })
    return NextResponse.json(data, { headers: { "X-Cache": "MISS" } })
  } catch {
    return NextResponse.json({ data: [] }, { status: 200 })
  }
}

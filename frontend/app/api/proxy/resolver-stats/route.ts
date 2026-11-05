import { NextResponse } from "next/server"

// Totals and per-institution places (name, place "City, Country"); the map reads the
// places to name an arc's destination city. Cached by nginx in production.
export async function GET() {
  const rawUrl = process.env.NEXT_PUBLIC_API_BASE_URL
  if (!rawUrl) return NextResponse.json({ error: "API_BASE_URL is not configured" }, { status: 500 })
  // Node 18 undici resolves "localhost" to IPv6 ::1 — Strapi binds IPv4 only
  const apiBaseUrl = rawUrl.replace("://localhost", "://127.0.0.1")
  try {
    const res = await fetch(`${apiBaseUrl}/museum-objects/resolver-stats`, { cache: "no-store" })
    if (!res.ok) return NextResponse.json({ error: `upstream ${res.status}` }, { status: 502 })
    return NextResponse.json(await res.json(), { headers: { "Cache-Control": "public, max-age=300" } })
  } catch {
    return NextResponse.json({ error: "upstream unavailable" }, { status: 502 })
  }
}

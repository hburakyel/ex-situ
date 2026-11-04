import { type NextRequest, NextResponse } from "next/server"

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org"

// Nominatim allows one request a second, and this server counts as one client for all
// visitors. Past a short queue a search goes without place results instead of waiting.
const MIN_REQUEST_INTERVAL_MS = 1100
const MAX_QUEUE_WAIT_MS = 3000
const REQUEST_TIMEOUT_MS = 8000
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const MAX_CACHE_ENTRIES = 1000

const cache = new Map<string, { features: any[]; timestamp: number }>()
const inFlight = new Map<string, Promise<any[] | null>>()
let nextRequestAt = 0

async function searchNominatim(query: string, limit: string): Promise<any[] | null> {
  const now = Date.now()
  const startAt = Math.max(now, nextRequestAt)
  if (startAt - now > MAX_QUEUE_WAIT_MS) return null
  nextRequestAt = startAt + MIN_REQUEST_INTERVAL_MS
  if (startAt > now) await new Promise((resolve) => setTimeout(resolve, startAt - now))

  const url = `${NOMINATIM_BASE}/search?q=${encodeURIComponent(query)}&format=json&accept-language=en&limit=${encodeURIComponent(limit)}&addressdetails=1`
  const res = await fetch(url, {
    headers: { "User-Agent": "ExSitu/1.0 (https://exsitu.app)" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) return null
  const results = await res.json()

  return (Array.isArray(results) ? results : []).map((r: any) => ({
    place_name: r.display_name || "",
    text: r.display_name?.split(",")[0] || r.name || "",
    center: [parseFloat(r.lon), parseFloat(r.lat)],
    place_type: [r.type || "place"],
    bbox: r.boundingbox ? [
      parseFloat(r.boundingbox[2]), parseFloat(r.boundingbox[0]),
      parseFloat(r.boundingbox[3]), parseFloat(r.boundingbox[1]),
    ] : null,
    context: [],
  }))
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const query = searchParams.get("q")?.trim()
  const limit = searchParams.get("limit") || "5"
  if (!query) return NextResponse.json({ features: [] })

  const key = `${limit}:${query.toLowerCase()}`
  const cached = cache.get(key)
  const headers = { "Cache-Control": "public, max-age=3600" }
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return NextResponse.json({ features: cached.features }, { headers })
  }

  try {
    let pending = inFlight.get(key)
    if (!pending) {
      pending = searchNominatim(query, limit).finally(() => inFlight.delete(key))
      inFlight.set(key, pending)
    }
    const features = await pending
    if (!features) return NextResponse.json({ features: [] })

    if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!)
    cache.set(key, { features, timestamp: Date.now() })
    return NextResponse.json({ features }, { headers })
  } catch (err) {
    console.error("[geocode] Nominatim request failed:", err)
    return NextResponse.json({ features: [] })
  }
}

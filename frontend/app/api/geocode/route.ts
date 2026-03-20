import { type NextRequest, NextResponse } from "next/server"

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const lng = searchParams.get("lng")
  const lat = searchParams.get("lat")
  const q = searchParams.get("q")
  const limit = searchParams.get("limit") || "5"

  try {
    // ── Reverse geocode (lng + lat → place name) ──
    if (lng && lat) {
      const url = `${NOMINATIM_BASE}/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&format=json&accept-language=en&zoom=10`
      const res = await fetch(url, {
        headers: { "User-Agent": "ex-situ-map/1.0" },
      })
      if (!res.ok) return NextResponse.json({ features: [] })
      const data = await res.json()

      if (!data || data.error) return NextResponse.json({ features: [] })

      const addr = data.address || {}

      // Skip bogus administrative names (e.g. "Area A", "Area B", "Area H1")
      const bogusPattern = /^area\s+/i
      const isBogus = (s: string) => !s || bogusPattern.test(s)

      const rawName = addr.city || addr.town || addr.village || addr.hamlet || ''
      const countyOrDistrict = addr.county || addr.state_district || ''
      const state = addr.state || addr.region || ''
      const country = addr.country || ''

      // Pick the most meaningful local name, skipping bogus ones
      let localName = rawName
      if (isBogus(localName)) localName = countyOrDistrict
      if (isBogus(localName)) localName = state
      if (isBogus(localName)) localName = data.name || ''
      // Final bogus check — if even data.name is bogus, fall back to state or country
      if (isBogus(localName)) localName = state
      if (isBogus(localName)) localName = country

      // Build full place name: city, state/region, country (deduplicated)
      const parts = [localName, state, country].filter(Boolean)
      // Remove consecutive duplicates (e.g. "İzmir, İzmir, Turkey" → "İzmir, Turkey")
      const deduped = parts.filter((p, i) => i === 0 || p.toLowerCase() !== parts[i - 1].toLowerCase())
      const placeName = deduped.join(', ')

      return NextResponse.json({
        features: localName ? [{
          place_name: placeName,
          text: localName,
          center: [parseFloat(data.lon), parseFloat(data.lat)],
          place_type: [data.type || "place"],
          bbox: null,
          context: [],
        }] : [],
      }, {
        headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" },
      })
    }

    // ── Forward geocode (q → coordinates) ──
    if (q && q.trim()) {
      const url = `${NOMINATIM_BASE}/search?q=${encodeURIComponent(q.trim())}&format=json&accept-language=en&limit=${encodeURIComponent(limit)}&addressdetails=1`
      const res = await fetch(url, {
        headers: { "User-Agent": "ex-situ-map/1.0" },
      })
      if (!res.ok) return NextResponse.json({ features: [] })
      const results = await res.json()

      const features = (Array.isArray(results) ? results : []).map((r: any) => {
        const addr = r.address || {}
        const name = r.display_name?.split(",")[0] || r.name || ""
        const country = addr.country || ""
        return {
          place_name: r.display_name || "",
          text: name,
          center: [parseFloat(r.lon), parseFloat(r.lat)],
          place_type: [r.type || "place"],
          bbox: r.boundingbox ? [
            parseFloat(r.boundingbox[2]), parseFloat(r.boundingbox[0]),
            parseFloat(r.boundingbox[3]), parseFloat(r.boundingbox[1]),
          ] : null,
          context: [],
        }
      })

      return NextResponse.json({ features }, {
        headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" },
      })
    }

    return NextResponse.json({ features: [] })
  } catch (err) {
    console.error("[geocode] Nominatim request failed:", err)
    return NextResponse.json({ features: [] })
  }
}

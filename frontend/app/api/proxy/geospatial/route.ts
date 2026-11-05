import { type NextRequest, NextResponse } from "next/server"

// nginx caches this route in production by the Cache-Control below, and shares one upstream
// request between identical ones.
const MAX_AGE_GLOBAL = 300 // zoom < 7: country/city stats
const MAX_AGE_LOCAL = 60 // zoom >= 7: viewport-dependent

// Only forward known safe parameters — prevent Strapi filter injection
const ALLOWED_GEO_PARAMS = new Set(['zoom', 'minLon', 'minLat', 'maxLon', 'maxLat', 'institution', 'city', 'country', 'dateStart', 'dateEnd', 'undated', 'acqDateStart', 'acqDateEnd', 'acqUndated'])

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL

  if (!apiBaseUrl) {
    console.error("[Geospatial Proxy] NEXT_PUBLIC_API_BASE_URL is not set!")
    return NextResponse.json({ error: "API_BASE_URL is not configured" }, { status: 500 })
  }

  const safeParams = new URLSearchParams()
  for (const [key, value] of searchParams.entries()) {
    if (ALLOWED_GEO_PARAMS.has(key)) {
      safeParams.set(key, value)
    }
  }
  // Replace localhost with 127.0.0.1 to avoid DNS resolution issues in Node.js
  const resolvedBaseUrl = apiBaseUrl.replace('localhost', '127.0.0.1')
  const apiURL = `${resolvedBaseUrl}/museum-objects/geospatial?${safeParams.toString()}`

  try {
    const response = await fetch(apiURL, {
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "ExSitu/1.0",
      },
      cache: "no-store",
    })

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }

    const zoom = parseInt(searchParams.get('zoom') || '2', 10)
    return NextResponse.json(await response.json(), {
      headers: { "Cache-Control": `public, max-age=${zoom < 7 ? MAX_AGE_GLOBAL : MAX_AGE_LOCAL}` },
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error("[Geospatial Proxy] Fetch Error:", errorMessage)

    return NextResponse.json({
      error: "Failed to fetch geospatial data",
      details: errorMessage
    }, { status: 500 })
  }
}

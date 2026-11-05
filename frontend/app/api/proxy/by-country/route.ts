import { type NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL

   const resolvedUrl = apiBaseUrl 
    ? apiBaseUrl.replace("localhost", "127.0.0.1")
    : "http://127.0.0.1:1337/api"

  const country = searchParams.get("country")
  const institution = searchParams.get("institution")
  if (!country && !institution) {
    return NextResponse.json({ error: "country or institution parameter is required" }, { status: 400 })
  }

try {
    const ALLOWED_PARAMS = new Set(['country', 'site', 'precise', 'institution', 'page', 'pageSize', 'onlyWithImages', 'dateStart', 'dateEnd', 'undated', 'acqDateStart', 'acqDateEnd', 'acqUndated'])
    const safeParams = new URLSearchParams()
    for (const [key, value] of searchParams.entries()) {
      if (ALLOWED_PARAMS.has(key)) {
        safeParams.set(key, value)
      }
    }
    const apiURL = `${resolvedUrl}/museum-objects/by-country?${safeParams.toString()}`

    const response = await fetch(apiURL, {
      headers: { "Content-Type": "application/json", "User-Agent": "ExSitu/1.0" },
      cache: "no-store",
    })

    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after") || "5"
      return NextResponse.json(
        { error: "Rate limited" },
        { status: 429, headers: { "Retry-After": retryAfter } },
      )
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "")
      console.error(`[by-country proxy] API error: ${response.status}`, errorText)
      return NextResponse.json(
        { error: `API error: ${response.status}` },
        { status: response.status },
      )
    }

    // Cached by nginx in production.
    return NextResponse.json(await response.json(), {
      headers: { "Cache-Control": "public, max-age=300" },
    })
  } catch (error) {
    console.error("[by-country proxy] Fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 })
  }
}

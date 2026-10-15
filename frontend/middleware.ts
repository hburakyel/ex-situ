import { NextResponse, type NextRequest } from "next/server"
import { renamedCountry } from "@/lib/country-names.server"

// A link with an older spelling of a country (/map?place=Ivory Coast, or
// /research/arc/ivory coast via the redirect in next.config.js) opens under the
// name the data uses now, with a permanent redirect so search engines follow.
export function middleware(request: NextRequest) {
  const place = request.nextUrl.searchParams.get("place")
  const current = place ? renamedCountry(place) : null
  if (!current) return NextResponse.next()
  const url = request.nextUrl.clone()
  url.searchParams.set("place", current)
  return NextResponse.redirect(url, 308)
}

export const config = { matcher: "/map", runtime: "nodejs" }

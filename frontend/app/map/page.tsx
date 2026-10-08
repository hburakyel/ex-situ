import type { Metadata } from "next"
import MapClient from "./map-client"
import { fetchArcTotals, findGroup, groupByInstitution, groupByPlace } from "@/lib/arc-index"

// Place and museum views live on /map (?place=, ?institution=); give each its own title,
// description and canonical so search engines can index them. Labels and counts only.

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

function names(related: { name: string }[], max = 3) {
  const shown = related.slice(0, max).map((r) => r.name)
  return related.length > max ? `${shown.join(", ")} +${related.length - max}` : shown.join(", ")
}

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const params = await searchParams
  const place = first(params.place)
  const institution = first(params.institution)
  // Narrower views (a site, an object) aren't indexed separately. lat/lng/zoom are only the
  // viewport the map writes back into the URL, so the place keeps its title.
  const narrowed = ["site", "artifactId"].some((k) => params[k] !== undefined)
  if ((!place && !institution) || narrowed || (place && institution)) return {}

  const arcs = await fetchArcTotals()
  const group = place ? findGroup(groupByPlace(arcs), place) : findGroup(groupByInstitution(arcs), institution!)
  if (!group) return { robots: { index: false } }

  const param = place ? "place" : "institution"
  const canonical = `/map?${param}=${encodeURIComponent(group.name)}`
  const title = place ? `${group.name} — objects by museum` : `${group.name} — objects by origin`
  const description = `${group.count.toLocaleString("en-US")} objects · ${names(group.related)}`

  return {
    title: `${title} | Ex Situ`,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, siteName: "Ex Situ", type: "website" },
    twitter: { card: "summary", title, description },
  }
}

export default function MapPage() {
  return <MapClient />
}

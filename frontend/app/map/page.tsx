import type { Metadata } from "next"
import MapClient from "./map-client"
import { fetchArcTotals, findGroup, groupByInstitution, groupByPlace } from "@/lib/arc-index"
import { ARCS_PREVIEW_IMAGE, mapPreviewImage, mapTitle, withSiteName } from "@/lib/map-title"

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
  // An object link previews with the arcs, not the site's grid of other objects.
  if (!place && !institution) {
    return params.artifactId !== undefined
      ? { openGraph: { images: [ARCS_PREVIEW_IMAGE] }, twitter: { card: "summary_large_image", images: [ARCS_PREVIEW_IMAGE.url] } }
      : {}
  }
  if (narrowed || (place && institution)) {
    // Not indexed separately, but the tab still names the view: Next re-applies this
    // title on client navigations, so an empty one would reset it to "Ex Situ".
    // A shared link previews with the same name ("Sanctuary of Athena (Pergamon) — Ex Situ").
    const view = { place, site: first(params.site), precise: first(params.precise), institution }
    const title = withSiteName(mapTitle(view)!)
    // An object link keeps the arcs image; a site or place-and-museum view previews its objects.
    const image = params.artifactId !== undefined ? ARCS_PREVIEW_IMAGE : mapPreviewImage(view)
    return {
      title,
      openGraph: { title, siteName: "Ex Situ", type: "website", images: [image] },
      twitter: { card: "summary_large_image", title, images: [image.url] },
    }
  }

  const arcs = await fetchArcTotals()
  const group = place ? findGroup(groupByPlace(arcs), place) : findGroup(groupByInstitution(arcs), institution!)
  if (!group) return { robots: { index: false } }

  const param = place ? "place" : "institution"
  const canonical = `/map?${param}=${encodeURIComponent(group.name)}`
  const title = place ? mapTitle({ place: group.name })! : mapTitle({ institution: group.name })!
  const description = `${group.count.toLocaleString("en-US")} artifacts · ${names(group.related)}`
  const image = mapPreviewImage(place ? { place: group.name } : { institution: group.name })

  return {
    title: withSiteName(title),
    description,
    alternates: { canonical },
    openGraph: { title: withSiteName(title), description, url: canonical, siteName: "Ex Situ", type: "website", images: [image] },
    twitter: { card: "summary_large_image", title: withSiteName(title), description, images: [image.url] },
  }
}

export default function MapPage() {
  return <MapClient />
}

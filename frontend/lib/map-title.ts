// The map with nothing picked: the title search results, tabs and link previews show.
export const MAP_DEFAULT_TITLE = "Ex Situ"

// A picked view's title in tabs, search results and link previews: "Palestine — Ex Situ".
export const withSiteName = (title: string) => `${title} — Ex Situ`

// Link-preview image for pages without one of their own: a grid of 24 objects from 11 countries,
// laid out like the place previews (app/og/route.tsx). Only Met (CC0) and Rijksmuseum (Public
// Domain) images, so it carries no credit line. Resolved against metadataBase in app/layout.tsx.
export const SITE_PREVIEW_IMAGE = {
  url: "/og-image.jpg",
  width: 1200,
  height: 630,
  alt: "Artifacts from China, Egypt, India, Indonesia, Iran, Iraq, Japan, Mexico, Nigeria, Peru and the United States",
}

// For a link to one artifact with no image of its own, where a grid of other objects would read
// as that artifact's: the world map with its arcs (public/og-arcs.jpg, a screenshot of /map with
// the panels hidden).
export const ARCS_PREVIEW_IMAGE = {
  url: "/og-arcs.jpg",
  width: 1200,
  height: 630,
  alt: "Arcs from places of origin to the institutions that hold the artifacts today",
}

// Link-preview image for a place or museum view: its objects as a grid (app/og/route.tsx).
export function mapPreviewImage(view: { place?: string; site?: string; precise?: string; institution?: string }) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(view)) if (value) params.set(key, value)
  const title = mapTitle(view)
  return { url: `/og?${params}`, width: 1200, height: 630, alt: title ? `Artifacts from ${title}` : SITE_PREVIEW_IMAGE.alt }
}

// Browser tab / share title for a map view. Used for the server-rendered metadata
// (app/map/page.tsx) and kept in sync on the client as the visitor drills in.
export function mapTitle({ place, site, precise, institution }: {
  place?: string | null
  site?: string | null
  precise?: string | null
  institution?: string | null
}): string | null {
  // Several picked sites are joined with "|"; the country names them better.
  const oneSite = site && !site.includes("|") ? site : null
  const from = (oneSite && precise) || oneSite || place
  if (from && institution) return `${from} · ${institution}`
  return from || institution || null
}

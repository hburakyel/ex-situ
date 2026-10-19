// The map with nothing picked: the title search results, tabs and link previews show.
export const MAP_DEFAULT_TITLE = "Ex Situ"

// Link-preview image for pages without one of their own: the world map with its arcs
// (public/og-image.jpg, a screenshot of /map with the panels hidden). Resolved against
// metadataBase in app/layout.tsx.
export const SITE_PREVIEW_IMAGE = {
  url: "/og-image.jpg",
  width: 1200,
  height: 630,
  alt: "Arcs from places of origin to the institutions that hold the artifacts today",
}

// Browser tab / share title for a map view. Used for the server-rendered metadata
// (app/map/page.tsx) and kept in sync on the client as the visitor drills in.
export function mapTitle({ place, site, institution }: {
  place?: string | null
  site?: string | null
  institution?: string | null
}): string | null {
  // Several picked sites are joined with "|"; the country names them better.
  const from = (site && !site.includes("|") ? site : null) || place
  if (from && institution) return `Artifacts from ${from} in ${institution}`
  if (from) return `Artifacts from ${from}`
  if (institution) return `Artifacts in ${institution}`
  return null
}

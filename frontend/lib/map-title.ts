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

// "Suggest a correction": a prefilled GitHub issue, so nobody needs an account with us.
// Only data the record already has goes into the issue; the reporter writes the rest.

const ISSUES_NEW = "https://github.com/hburakyel/ex-situ/issues/new"
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://exsitu.app"

export interface CorrectionArtifact {
  id: string | number
  title?: string | null
  inventory_number?: string | null
  institution_name?: string | null
  place_name?: string | null
  place_name_normalized?: string | null
  country_en?: string | null
  latitude?: number | null
  longitude?: number | null
  manual_latitude?: number | null
  manual_longitude?: number | null
  geocoding_status?: string | null
  source_link?: string | null
}

const line = (label: string, value: unknown) =>
  `- ${label}: ${value === null || value === undefined || value === "" ? "—" : String(value)}`

export function artifactCorrectionUrl(a: CorrectionArtifact): string {
  const name = a.inventory_number?.trim() || a.title?.trim() || `#${a.id}`
  const lat = a.manual_latitude ?? a.latitude
  const lng = a.manual_longitude ?? a.longitude
  const body = [
    "**Artifact**",
    line("Ex Situ", `${SITE_URL}/artifact/${a.id}`),
    line("Inventory number", a.inventory_number),
    line("Institution", a.institution_name),
    line("Institution record", a.source_link),
    line("Place shown", a.place_name_normalized || a.place_name),
    line("Place as recorded", a.place_name),
    line("Territory", a.country_en),
    // Stored as float4, so 35.0217 comes back as 35.021724700927734; 6 decimals is ~0.1 m.
    line("Coordinates", lat != null && lng != null ? `${+lat.toFixed(6)}, ${+lng.toFixed(6)}` : null),
    line("Geocoding status", a.geocoding_status || "not recorded"),
    "",
    "**What is wrong?**",
    "",
    "",
    "**Source for the correction** (link or reference)",
    "",
  ].join("\n")
  return issueUrl(`Correction: ${name}${a.institution_name ? ` (${a.institution_name})` : ""}`, body)
}

export function issueUrl(title: string, body: string): string {
  const params = new URLSearchParams({ title, body })
  return `${ISSUES_NEW}?${params.toString()}`
}

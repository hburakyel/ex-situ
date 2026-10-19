// "Cite this": the record is cited as the institution's own object, with Ex Situ named as the
// index it was found in. Only fields the record already has; nothing is added or interpreted.

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://exsitu.app"

export interface CitableArtifact {
  id: string | number
  title?: string | null
  inventory_number?: string | null
  institution_name?: string | null
  place_name?: string | null
  place_name_normalized?: string | null
  country_en?: string | null
  source_link?: string | null
}

const clean = (v?: string | null) => (v ?? "").trim()

function parts(a: CitableArtifact) {
  const inv = clean(a.inventory_number)
  const title = clean(a.title)
  const place = clean(a.place_name_normalized) || clean(a.place_name)
  const country = clean(a.country_en)
  const origin = [place, country && country !== place ? country : ""].filter(Boolean).join(", ")
  return {
    label: inv || title || `Artifact ${a.id}`,
    inv,
    title,
    origin,
    institution: clean(a.institution_name),
    source: clean(a.source_link),
    page: `${SITE_URL}/artifact/${a.id}`,
  }
}

export const accessedOn = (d: Date = new Date()) => d.toISOString().slice(0, 10)

export function citationText(a: CitableArtifact, accessed = accessedOn()): string {
  const p = parts(a)
  return [
    [p.institution, p.inv && `inv. ${p.inv}`].filter(Boolean).join(", ") || p.label,
    p.origin && `Origin as recorded by the institution: ${p.origin}`,
    p.source && `Institution record: ${p.source}`,
    `Ex Situ index: ${p.page} (accessed ${accessed})`,
  ].filter(Boolean).join(". ") + "."
}

const bibEscape = (s: string) => s.replace(/([&%$#_{}])/g, "\\$1")

export function citationBibtex(a: CitableArtifact, accessed = accessedOn()): string {
  const p = parts(a)
  const fields: [string, string][] = [
    ["title", p.title || p.label],
    ["howpublished", p.page],
    ["organization", p.institution],
    ["number", p.inv],
    ["note", [p.origin && `Origin as recorded: ${p.origin}`, p.source && `Institution record: ${p.source}`].filter(Boolean).join(". ")],
    ["urldate", accessed],
  ]
  return `@misc{exsitu${a.id},\n${fields.filter(([, v]) => v).map(([k, v]) => `  ${k} = {${bibEscape(v)}}`).join(",\n")}\n}`
}

export function citationCslJson(a: CitableArtifact, accessed = accessedOn()) {
  const p = parts(a)
  const [y, m, d] = accessed.split("-").map(Number)
  return {
    id: `exsitu${a.id}`,
    type: "dataset",
    title: p.title || p.label,
    publisher: "Ex Situ",
    URL: p.page,
    number: p.inv || undefined,
    archive: p.institution || undefined,
    archive_location: p.inv || undefined,
    source: p.source || undefined,
    note: p.origin ? `Origin as recorded: ${p.origin}` : undefined,
    accessed: { "date-parts": [[y, m, d]] },
  }
}

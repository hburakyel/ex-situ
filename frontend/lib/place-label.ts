// Display labels for origin places. Stored names keep a disambiguating tag
// ("Kano (State)", "Kano (City)" — see etl/normalize_place_labels.py); the UI
// drops it only when no other place in the same list has the same base name,
// so the state and the city never show up as two identical "Kano" rows.
// Display only: filtering, URLs and API calls keep using the stored name.

// English terms the ETL writes as tags. Other tags carry information
// ("(Tarquinia)", "(WWI)", "(?)") and are always shown.
const GENERIC_TAGS = new Set(
  [
    "State", "City", "Province", "District", "Region", "Area", "River", "Island", "Islands",
    "Peninsula", "Mountain", "Mountains", "Lower course", "Upper course", "Coast", "Lake",
    "Valley", "Village", "Harbour", "Oasis", "Department", "Governorate", "Kingdom",
  ].map((t) => t.toLowerCase()),
)

const TRAILING_TAG = /^(.*\S)\s*\(([^()]*)\)\s*$/

/** "Kano (State)" → "Kano"; names without a generic tag are returned unchanged. */
export function placeBaseName(name: string): string {
  const match = TRAILING_TAG.exec(name)
  return match && GENERIC_TAGS.has(match[2].trim().toLowerCase()) ? match[1] : name
}

/**
 * Map each name to its label for this list: the base name when it is unique
 * (case-insensitive) among `names`, otherwise the full stored name.
 */
export function placeDisplayLabels(names: Iterable<string>): Map<string, string> {
  const all = [...names]
  const baseCounts = new Map<string, number>()
  for (const name of new Set(all)) {
    const base = placeBaseName(name).toLowerCase()
    baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1)
  }
  const labels = new Map<string, string>()
  for (const name of all) {
    const base = placeBaseName(name)
    labels.set(name, (baseCounts.get(base.toLowerCase()) ?? 0) > 1 ? name : base)
  }
  return labels
}

/** Label for a single name shown alongside `siblings` (e.g. the breadcrumb's active site). */
export function placeDisplayLabel(name: string, siblings: Iterable<string> = []): string {
  return placeDisplayLabels([...siblings, name]).get(name) ?? name
}

interface OriginFields {
  place_name?: string | null
  place_name_normalized?: string | null
  historical_name?: string | null
  precise_place?: string | null
}

/**
 * The object panel's "From" value: precise place, then the site with its former
 * name — "Sanctuary of Athena, Bergama (Pergamon)". A trailing "(Pergamon)" on
 * the precise place repeats the site, so it is dropped there.
 */
export function originFromLabel(o: OriginFields): string | null {
  const clean = (v?: string | null) => (v && v.trim() !== "" ? v.trim() : null)
  const from = clean(o.place_name_normalized) || clean(o.place_name)
  if (!from) return null
  const historical = clean(o.historical_name)
  const former = historical && historical.toLowerCase() !== from.toLowerCase() ? historical : null
  const site = former ? `${from} (${former})` : from
  let precise = clean(o.precise_place)
  const tag = precise ? TRAILING_TAG.exec(precise) : null
  if (tag && [from, former].some((n) => n && n.toLowerCase() === tag[2].trim().toLowerCase())) precise = tag[1]
  if (!precise || [from, former, site].some((n) => n && n.toLowerCase() === precise!.toLowerCase())) return site
  return `${precise}, ${site}`
}

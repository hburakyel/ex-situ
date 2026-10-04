// Pure helpers behind the MCP server's get_origins / count_objects output:
// place-name normalization and merging, precision labels, disputed-origin flags.
// No I/O here — see gazetteer.ts for loading the lookup and route.ts for calls.
//
// Place normalization now happens upstream: etl/fill_place_name_normalized.py
// stores normalizePlaceDisplay() results in place_name_normalized, and the
// geospatial view groups on it case-insensitively. mergeFlows() is kept as a
// fallback that is a no-op on normalized data. The rules are pinned by
// place-normalization-cases.json, which both implementations are tested against.

export type Precision = "site" | "city" | "region" | "country"

export interface Gazetteer {
  countries: Set<string>
  regions: Set<string>
  cities: Set<string>
}

/** One row as returned by /museum-objects/geospatial. */
export interface RawFlow {
  place_name: string
  country: string | null
  institution_name: string
  object_count: number
  /** Raw spellings the backend already merged into this row (geospatial place_variants). */
  variants?: string[]
}

export interface Flow {
  origin: string
  precision?: Precision
  country: string | null
  museum: string
  objects: number
  /** Raw spellings merged into this row; only present when there is more than one. */
  variants?: string[]
}

/** Must stay identical to normalize() in etl/build_mcp_gazetteer.py. */
export function normalizePlaceName(name: string): string {
  return name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim()
}

/** Strip a trailing ", <country>" (e.g. "Olympia, Greece" → "Olympia"). */
export function stripCountrySuffix(name: string, country: string | null): string {
  if (!country) return name.trim()
  const comma = name.lastIndexOf(",")
  if (comma === -1) return name.trim()
  const suffix = name.slice(comma + 1)
  return normalizePlaceName(suffix) === normalizePlaceName(country) ? name.slice(0, comma).trim() : name.trim()
}

/**
 * Display form stored in place_name_normalized: country suffix stripped,
 * whitespace trimmed and collapsed, original casing kept. Must stay identical
 * to normalize_display() in etl/fill_place_name_normalized.py.
 */
export function normalizePlaceDisplay(name: string, country: string | null): string {
  return stripCountrySuffix(name, country).replace(/\s+/g, " ").trim()
}

/** Grouping key: exact match after suffix stripping, trimming and case-folding — nothing fuzzier. */
export function placeKey(name: string, country: string | null): string {
  return normalizePlaceName(normalizePlaceDisplay(name, country))
}

// Country-level fallbacks written in German in SMB records.
const COUNTRY_ALIASES = new Set(
  ["Zypern", "Griechenland", "Italien", "Türkei", "Ägypten", "Syrien", "Spanien", "Frankreich", "Deutschland", "Russland", "Libanon", "Iran", "Irak"]
    .map(normalizePlaceName),
)

// Administrative/geographic units that GeoNames admin1 doesn't list by these names.
const REGION_PATTERN = /\b(gouvernement|governorate|province|provinz|provincia|region|regione|oblast|district|kreis|landschaft)\b|delta\b/

export function classifyPrecision(name: string, country: string | null, gazetteer: Gazetteer): Precision {
  // A trailing "?" marks an uncertain attribution, not a different place.
  const n = normalizePlaceName(stripCountrySuffix(name, country)).replace(/\?+$/, "").trim()
  if (!n || n === "unknown" || (country && n === normalizePlaceName(country)) || gazetteer.countries.has(n) || COUNTRY_ALIASES.has(n)) {
    return "country"
  }
  if (REGION_PATTERN.test(n)) return "region"
  if (gazetteer.cities.has(n)) return "city"
  if (gazetteer.regions.has(n)) return "region"
  // Not a known country, region or populated place — in this dataset that is
  // almost always an archaeological site, sanctuary, tomb or similar find-spot.
  return "site"
}

/**
 * Merge rows that are the same place after normalization (per country and museum),
 * keeping the raw spellings in `variants`. Parent/child places stay separate:
 * "Tarquinia" and "Tomba del Guerriero (Tarquinia)" are different keys.
 * Fallback only: on normalized upstream data every group has one row, so this
 * just passes rows (and their upstream variants) through.
 */
export function mergeFlows(rows: RawFlow[], gazetteer: Gazetteer | null): Flow[] {
  const groups = new Map<string, { rows: RawFlow[]; total: number }>()
  for (const row of rows) {
    const key = `${row.institution_name}\u0000${row.country ?? ""}\u0000${placeKey(row.place_name, row.country)}`
    const group = groups.get(key) ?? { rows: [], total: 0 }
    group.rows.push(row)
    group.total += row.object_count
    groups.set(key, group)
  }

  const flows: Flow[] = []
  for (const { rows: members, total } of groups.values()) {
    const top = members.reduce((a, b) => (b.object_count > a.object_count ? b : a))
    const variants = [...new Set(members.flatMap((m) => (m.variants?.length ? m.variants : [m.place_name])))]
    const flow: Flow = {
      origin: normalizePlaceDisplay(top.place_name, top.country),
      country: top.country,
      museum: top.institution_name,
      objects: total,
    }
    if (gazetteer) flow.precision = classifyPrecision(top.place_name, top.country, gazetteer)
    if (variants.length > 1) flow.variants = variants
    flows.push(flow)
  }
  return flows.sort((a, b) => b.objects - a.objects || a.origin.localeCompare(b.origin))
}

// Territories with disputed sovereignty or limited international recognition,
// as country_en values appear in the data.
const DISPUTED_TERRITORIES = new Set(
  [
    "Turkish Republic of Northern Cyprus",
    "Northern Cyprus",
    "Kosovo",
    "Somaliland",
    "Western Sahara",
    "Abkhazia",
    "South Ossetia",
    "Transnistria",
    "Taiwan",
    "Palestine",
  ].map(normalizePlaceName),
)

export function isDisputedTerritory(country: string | null): boolean {
  return Boolean(country && DISPUTED_TERRITORIES.has(normalizePlaceName(country)))
}

/** One human-readable flag per disputed territory present in the rows. */
export function disputedFlags(rows: RawFlow[]): string[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    if (isDisputedTerritory(row.country)) counts.set(row.country!, (counts.get(row.country!) ?? 0) + row.object_count)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([country, n]) =>
      `${n} object${n === 1 ? " has an" : "s have an"} origin in a disputed or partially recognized territory (${country}).`,
    )
}

export interface Coverage {
  total: number
  located: number
  unlocated: number
}

export function coverage(total: number, located: number): Coverage {
  const safeLocated = Math.min(located, total)
  return { total, located: safeLocated, unlocated: total - safeLocated }
}

export function coverageNote({ total, located }: Coverage): string {
  if (total === 0) return "No objects match these filters."
  const pct = Math.round((located / total) * 100)
  return `${located} of ${total} objects (${pct}%) have a located origin; only located objects appear in origin flows.`
}

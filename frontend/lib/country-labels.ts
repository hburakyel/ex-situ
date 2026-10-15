/**
 * Country labels drawn by Ex Situ instead of the basemap's (see
 * etl/build_country_labels.py and METHODOLOGY.md, "Country labels").
 */

export const COUNTRY_LABELS_URL = "/country-labels.geojson"
export const COUNTRY_LABELS_SOURCE = "country-labels"
export const ORIGIN_LABELS_SOURCE = "origin-labels"

/**
 * Accent-, case- and punctuation-insensitive form of a country name. Must stay
 * identical to country_key() in etl/build_country_labels.py; both are checked
 * against lib/country-key-cases.json.
 */
export function countryKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "")
    .toLowerCase()
    .replace(/-/g, " ")
    .replace(/[.']/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")
}

type CountryLabelCollection = {
  features: { properties: { id: string; keys: string } }[]
}

/** Normalized name → label id, from the `keys` each label carries. */
export function buildCountryIndex(collection: CountryLabelCollection): Map<string, string> {
  const index = new Map<string, string>()
  for (const { properties } of collection.features) {
    for (const key of properties.keys.split("|")) {
      if (key && !index.has(key)) index.set(key, properties.id)
    }
  }
  return index
}

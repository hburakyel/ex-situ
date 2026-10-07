// The site name an object is grouped under on the map — must match the SQL in
// backend/src/api/museum-object/services/place-group.js (PLACE_GROUP_EXPR), so
// an arc clicked at street zoom (individual objects, raw place_name) selects the
// same site as the Sites list built from the zoom 4–6 clusters.

interface SiteFields {
  place_name_normalized?: string | null
  city_en?: string | null
  country_en?: string | null
  country?: string | null
}

// Same guard as the SQL (place-group.js LATIN_ONLY): Latin script incl. accents,
// no other scripts.
const LATIN_ONLY = /^[\u0001-\u024F\u02B0-\u02FF\u1E00-\u1EFF\u2018\u2019]*$/
const usable = (value?: string | null): value is string =>
  typeof value === "string" && value.trim() !== "" && LATIN_ONLY.test(value)

export function siteLabel(o: SiteFields): string {
  const country = o.country_en ?? o.country ?? null
  const city = usable(o.city_en) ? o.city_en.trim() : null
  const normalized = usable(o.place_name_normalized) ? o.place_name_normalized.trim() : null
  // A curated label that is only the country loses to a finer city_en.
  if (normalized && !(city && normalized.toLowerCase() === (country ?? "").toLowerCase())) return normalized
  if (city) return city
  return country && country.trim() !== "" ? country : "Unknown"
}

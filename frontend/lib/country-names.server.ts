import fs from "node:fs"
import path from "node:path"
import { buildCountryNameIndex, countryKey } from "./country-labels"

// Links shared before a country's spelling was unified ("Ivory Coast",
// "People's Republic of China") resolve to the name the data uses now.
let index: Map<string, string> | null = null

function countryNames(): Map<string, string> {
  if (!index) {
    const file = path.join(process.cwd(), "public", "country-labels.geojson")
    index = buildCountryNameIndex(JSON.parse(fs.readFileSync(file, "utf8")))
  }
  return index
}

/** The current name for an older spelling of a country, or null if `name` is current or no country. */
export function renamedCountry(name: string, { ignoreCase = false } = {}): string | null {
  const current = countryNames().get(countryKey(name))
  if (!current) return null
  const same = ignoreCase ? current.toLowerCase() === name.toLowerCase() : current === name
  return same ? null : current
}

import { readFileSync } from "fs"
import path from "path"
import { describe, expect, it } from "vitest"
import { siteLabel } from "./site-label"

// Cases mirror backend/src/api/museum-object/services/place-group.js.
describe("siteLabel", () => {
  it("uses the cleaned label instead of the raw source name (Sahure, Abusir)", () => {
    expect(siteLabel({
      place_name_normalized: null,
      city_en: "Mortuary Temple of Sahure, North Side of Columned Courtyard, Abusir",
      country_en: "Egypt",
    })).toBe("Mortuary Temple of Sahure, North Side of Columned Courtyard, Abusir")
    expect(siteLabel({ place_name_normalized: "Mortuary Temple of Sahure (Abusir)", city_en: "Totentempel des Sahure (Abusir)", country_en: "Egypt" }))
      .toBe("Mortuary Temple of Sahure (Abusir)")
  })
  it("keeps city precision when the curated label is only the country", () => {
    expect(siteLabel({ place_name_normalized: "Egypt", city_en: "Cairo", country_en: "Egypt" })).toBe("Cairo")
  })
  it("falls back to the country, then Unknown", () => {
    expect(siteLabel({ place_name_normalized: "", city_en: "", country_en: "Nigeria" })).toBe("Nigeria")
    expect(siteLabel({})).toBe("Unknown")
  })
  it("ignores non-ASCII values like the SQL guard does", () => {
    expect(siteLabel({ place_name_normalized: null, city_en: "Fayûm", country_en: "Egypt" })).toBe("Egypt")
  })
})

describe("arc worker copy", () => {
  it("matches lib/site-label.ts", () => {
    // The worker can't import app modules, so it carries a copy; keep the logic identical.
    const worker = readFileSync(path.join(__dirname, "../workers/arc-worker.ts"), "utf8")
    for (const line of [
      "const city = usable(o.city_en) ? o.city_en.trim() : null",
      "const normalized = usable(o.place_name_normalized) ? o.place_name_normalized.trim() : null",
      'if (normalized && !(city && normalized.toLowerCase() === (country ?? "").toLowerCase())) return normalized',
      "if (city) return city",
    ]) {
      expect(worker).toContain(line)
    }
  })
})

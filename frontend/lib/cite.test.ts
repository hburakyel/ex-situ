import { describe, expect, it } from "vitest"
import { citationBibtex, citationCslJson, citationText } from "./cite"

const a = {
  id: 42,
  title: "Tapestry Tunic",
  inventory_number: "2020.79",
  institution_name: "The Metropolitan Museum of Art",
  place_name: "Peru",
  place_name_normalized: null,
  country_en: "Peru",
  source_link: "https://www.metmuseum.org/art/collection/search/833953",
}

describe("cite", () => {
  it("plain text names the institution's record and the index", () => {
    const t = citationText(a, "2026-10-19")
    expect(t).toContain("The Metropolitan Museum of Art, inv. 2020.79")
    expect(t).toContain("Origin as recorded by the institution: Peru.")
    expect(t).toContain("Institution record: https://www.metmuseum.org/art/collection/search/833953")
    expect(t).toContain("/artifact/42 (accessed 2026-10-19)")
  })
  it("skips missing fields instead of inventing them", () => {
    const t = citationText({ id: 7 }, "2026-10-19")
    expect(t).toBe("Artifact 7. Ex Situ index: https://exsitu.app/artifact/7 (accessed 2026-10-19).")
  })
  it("bibtex escapes special characters", () => {
    expect(citationBibtex({ ...a, title: "Cup & saucer_1" }, "2026-10-19")).toContain("Cup \\& saucer\\_1")
  })
  it("csl-json carries date parts and omits empty fields", () => {
    const c = citationCslJson({ id: 7 }, "2026-10-19")
    expect(c.accessed["date-parts"]).toEqual([[2026, 10, 19]])
    expect(c.number).toBeUndefined()
  })
})

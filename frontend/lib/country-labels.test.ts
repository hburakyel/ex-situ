import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import cases from "./country-key-cases.json"
import { buildCountryIndex, buildCountryNameIndex, countryKey } from "./country-labels"

describe("countryKey", () => {
  it.each(cases)("$name → $key (same cases as etl/build_country_labels.py)", ({ name, key }) => {
    expect(countryKey(name)).toBe(key)
  })
})

describe("country labels file", () => {
  const collection = JSON.parse(fs.readFileSync(path.join(__dirname, "../public/country-labels.geojson"), "utf8"))
  const index = buildCountryIndex(collection)
  const label = (id: string) => collection.features.find((f: any) => f.properties.id === id)?.properties

  it("labels Palestine as a country, from the same zoom as Israel and ahead of it", () => {
    expect(label("PSX")).toMatchObject({ name: "Palestine", min_zoom: label("ISR").min_zoom, sort_key: 0 })
  })

  it("does not label Northern Cyprus", () => {
    expect(label("CYN")).toBeUndefined()
  })

  const match = (name: string) => index.get(countryKey(name))

  it("matches the data's spellings of an origin to one label", () => {
    expect(["Palestine", "Palestinian Territories", "Palestinian Territory"].map(match)).toEqual(["PSX", "PSX", "PSX"])
    expect(["China", "People's Republic of China", "china"].map(match)).toEqual(["CHN", "CHN", "CHN"])
    expect(match("Turkish Republic of Northern Cyprus")).toBe("CYP")
  })

  it("leaves regions and places drawn inside another country unmatched", () => {
    expect(["Middle East", "Africa", "Guadeloupe"].map(match)).toEqual([undefined, undefined, undefined])
  })

  it("resolves older spellings to the name the data uses now (old links keep working)", () => {
    const names = buildCountryNameIndex(collection)
    const current = (name: string) => names.get(countryKey(name))
    expect(current("Ivory Coast")).toBe("Côte d'Ivoire")
    expect(current("People's Republic of China")).toBe("China")
    expect(current("Palestinian Territories")).toBe("Palestine")
    expect(current("United States of America")).toBe("United States")
    expect(current("Palestine")).toBe("Palestine")
    expect(current("Sbaita")).toBeUndefined()
  })
})

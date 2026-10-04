import { describe, expect, it } from "vitest"
import { loadGazetteer } from "./gazetteer"
import {
  type RawFlow, classifyPrecision, coverage, coverageNote, disputedFlags, mergeFlows, normalizePlaceDisplay, placeKey,
} from "./origins"
import sharedCases from "./place-normalization-cases.json"

const gazetteer = loadGazetteer()!

// Site-level rows as /museum-objects/geospatial?zoom=5&institution=Antikensammlung returns them.
const row = (place_name: string, country: string | null, object_count: number): RawFlow => ({
  place_name, country, institution_name: "Antikensammlung", object_count,
})
const antikensammlungSites: RawFlow[] = [
  row("Olympia, Greece", "Greece", 315),
  row("Dodona", "Greece", 150),
  row("Pergamon", "Turkey", 148),
  row("Tomba del Guerriero (Tarquinia)", "Italy", 50),
  row("Tarquinia", "Italy", 42),
  row("Olympia", "Greece", 38),
  row("Turkey", "Turkey", 29),
  row("Egypt", "Egypt", 28),
  row("Zypern", "Cyprus", 19),
  row("Tarquinia, Tomba del Guerriero", "Italy", 7),
  row("Olympia?", "Greece", 4),
  row("Unknown", null, 3),
  row("Athienou", "Turkish Republic of Northern Cyprus", 2),
]

describe("gazetteer", () => {
  it("loads from disk", () => {
    expect(gazetteer).toBeTruthy()
    expect(gazetteer.cities.size).toBeGreaterThan(100_000)
  })
})

// Same file the ETL checks with `python etl/fill_place_name_normalized.py --self-test`.
describe("shared normalization cases (ETL ↔ MCP)", () => {
  it.each(sharedCases.cases)("$name ($country)", ({ name, country, display, key }) => {
    expect(normalizePlaceDisplay(name, country)).toBe(display)
    expect(placeKey(name, country)).toBe(key)
  })
})

describe("placeKey", () => {
  it("strips a trailing ', <country>' and case-folds", () => {
    expect(placeKey("Olympia, Greece", "Greece")).toBe("olympia")
    expect(placeKey("  OLYMPIA ", "Greece")).toBe("olympia")
  })
  it("keeps a trailing part that is not the row's country", () => {
    expect(placeKey("Tarquinia, Tomba del Guerriero", "Italy")).toBe("tarquinia, tomba del guerriero")
  })
})

describe("mergeFlows", () => {
  const flows = mergeFlows(antikensammlungSites, gazetteer)
  const byOrigin = (origin: string) => flows.filter((f) => f.origin === origin)

  it("merges Olympia spellings into one row with variants", () => {
    const olympia = byOrigin("Olympia")
    expect(olympia).toHaveLength(1)
    expect(olympia[0].objects).toBe(353)
    expect(olympia[0].variants).toEqual(["Olympia, Greece", "Olympia"])
  })

  it("does not merge parent/child or uncertain places", () => {
    expect(byOrigin("Tarquinia")[0].objects).toBe(42)
    expect(byOrigin("Tomba del Guerriero (Tarquinia)")[0].objects).toBe(50)
    expect(byOrigin("Tarquinia, Tomba del Guerriero")[0].objects).toBe(7)
    expect(byOrigin("Olympia?")[0].objects).toBe(4)
  })

  it("only adds variants when there is more than one spelling", () => {
    expect(byOrigin("Dodona")[0]).not.toHaveProperty("variants")
  })

  it("is a no-op on rows the backend already normalized, keeping upstream variants", () => {
    const normalized: RawFlow[] = [
      { ...row("Olympia", "Greece", 353), variants: ["Olympia", "Olympia, Greece"] },
      row("Dodona", "Greece", 150),
      row("Tarquinia", "Italy", 42),
    ]
    const out = mergeFlows(normalized, gazetteer)
    expect(out.map((f) => [f.origin, f.objects])).toEqual([["Olympia", 353], ["Dodona", 150], ["Tarquinia", 42]])
    expect(out[0].variants).toEqual(["Olympia", "Olympia, Greece"])
    expect(out[1]).not.toHaveProperty("variants")
  })

  it("omits precision when no gazetteer is given (country grouping)", () => {
    expect(mergeFlows(antikensammlungSites, null)[0]).not.toHaveProperty("precision")
  })
})

describe("classifyPrecision", () => {
  const p = (name: string, country: string | null) => classifyPrecision(name, country, gazetteer)

  it("labels country-level fallbacks as country", () => {
    expect(p("Turkey", "Turkey")).toBe("country")
    expect(p("Egypt", "Egypt")).toBe("country")
    expect(p("Zypern", "Cyprus")).toBe("country")
    expect(p("Unknown", null)).toBe("country")
  })
  it("labels towns as city, including uncertain ones", () => {
    expect(p("Olympia, Greece", "Greece")).toBe("city")
    expect(p("Tarquinia", "Italy")).toBe("city")
    expect(p("Olympia?", "Greece")).toBe("city")
  })
  it("labels named find-spots as site", () => {
    expect(p("Dodona", "Greece")).toBe("site")
    expect(p("Pergamon", "Turkey")).toBe("site")
    expect(p("Tomba del Guerriero (Tarquinia)", "Italy")).toBe("site")
  })
  it("labels administrative units as region", () => {
    expect(p("Gouvernement al-Fayyum", "Egypt")).toBe("region")
    expect(p("Nildelta", "Egypt")).toBe("region")
  })
})

describe("disputedFlags", () => {
  it("flags Turkish Republic of Northern Cyprus with its object count", () => {
    expect(disputedFlags(antikensammlungSites)).toEqual([
      "2 objects have an origin in a disputed or partially recognized territory (Turkish Republic of Northern Cyprus).",
    ])
  })
  it("returns nothing when no disputed origins are present", () => {
    expect(disputedFlags([row("Dodona", "Greece", 150)])).toEqual([])
  })
})

describe("coverage", () => {
  it("computes unlocated and a factual note", () => {
    const cov = coverage(5612, 2418)
    expect(cov).toEqual({ total: 5612, located: 2418, unlocated: 3194 })
    expect(coverageNote(cov)).toBe(
      "2418 of 5612 objects (43%) have a located origin; only located objects appear in origin flows.",
    )
  })
  it("never reports more located than total", () => {
    expect(coverage(10, 12)).toEqual({ total: 10, located: 10, unlocated: 0 })
  })
})

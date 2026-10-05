import { describe, expect, it } from "vitest"
import { placeBaseName, placeDisplayLabel, placeDisplayLabels } from "./place-label"

describe("placeBaseName", () => {
  it("drops generic tags written by the ETL", () => {
    expect(placeBaseName("Kano (State)")).toBe("Kano")
    expect(placeBaseName("Kongo (River)")).toBe("Kongo")
    expect(placeBaseName("Kilwa (District)")).toBe("Kilwa")
  })
  it("keeps tags that carry information", () => {
    expect(placeBaseName("Tomba del Guerriero (Tarquinia)")).toBe("Tomba del Guerriero (Tarquinia)")
    expect(placeBaseName("POW Camp Frankfurt (Oder) (WWI)")).toBe("POW Camp Frankfurt (Oder) (WWI)")
    expect(placeBaseName("Olympia?")).toBe("Olympia?")
    expect(placeBaseName("Owo")).toBe("Owo")
  })
})

describe("placeDisplayLabels", () => {
  it("shows the bare name when it is unique in the list", () => {
    const labels = placeDisplayLabels(["Kano (State)", "Owo", "Veracruz (State)"])
    expect(labels.get("Kano (State)")).toBe("Kano")
    expect(labels.get("Veracruz (State)")).toBe("Veracruz")
  })
  it("keeps the tag when another place shares the base name", () => {
    const labels = placeDisplayLabels(["Kano (State)", "Kano (City)", "Owo"])
    expect(labels.get("Kano (State)")).toBe("Kano (State)")
    expect(labels.get("Kano (City)")).toBe("Kano (City)")
  })
  it("keeps the tag when an untagged place has the same name", () => {
    const labels = placeDisplayLabels(["Kano (State)", "kano"])
    expect(labels.get("Kano (State)")).toBe("Kano (State)")
  })
  it("never produces two identical labels for different names", () => {
    const names = ["Kano (State)", "Kano (City)", "Kano", "Punjab", "Punjab (Province)", "Owo"]
    const shown = [...placeDisplayLabels(names).values()].map((l) => l.toLowerCase())
    expect(new Set(shown).size).toBe(names.length)
  })
})

describe("placeDisplayLabel", () => {
  it("uses the siblings to decide", () => {
    expect(placeDisplayLabel("Kano (State)", ["Owo"])).toBe("Kano")
    expect(placeDisplayLabel("Kano (State)", ["Kano (City)"])).toBe("Kano (State)")
  })
})

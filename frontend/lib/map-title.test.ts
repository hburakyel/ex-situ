import { describe, expect, it } from "vitest"
import { mapTitle } from "./map-title"

describe("mapTitle", () => {
  it("names the most specific place picked", () => {
    expect(mapTitle({ place: "Turkey" })).toBe("Artifacts from Turkey")
    expect(mapTitle({ place: "Turkey", site: "Bergama" })).toBe("Artifacts from Bergama")
    expect(mapTitle({ place: "Turkey", site: "Bergama", precise: "Sanctuary of Athena (Pergamon)" }))
      .toBe("Artifacts from Sanctuary of Athena (Pergamon)")
  })
  it("ignores a precise place without its site, and several sites", () => {
    expect(mapTitle({ place: "Turkey", precise: "Trajaneum" })).toBe("Artifacts from Turkey")
    expect(mapTitle({ place: "Turkey", site: "Bergama|Istanbul", precise: "Trajaneum" })).toBe("Artifacts from Turkey")
  })
  it("adds the collection", () => {
    expect(mapTitle({ place: "Turkey", site: "Bergama", institution: "Antikensammlung" }))
      .toBe("Artifacts from Bergama in Antikensammlung")
  })
})

import { describe, expect, it } from "vitest"
import { mapTitle, withSiteName } from "./map-title"

describe("mapTitle", () => {
  it("names the most specific place picked", () => {
    expect(mapTitle({ place: "Turkey" })).toBe("Turkey")
    expect(mapTitle({ place: "Turkey", site: "Bergama" })).toBe("Bergama")
    expect(mapTitle({ place: "Turkey", site: "Bergama", precise: "Sanctuary of Athena (Pergamon)" }))
      .toBe("Sanctuary of Athena (Pergamon)")
  })
  it("ignores a precise place without its site, and several sites", () => {
    expect(mapTitle({ place: "Turkey", precise: "Trajaneum" })).toBe("Turkey")
    expect(mapTitle({ place: "Turkey", site: "Bergama|Istanbul", precise: "Trajaneum" })).toBe("Turkey")
  })
  it("adds the collection", () => {
    expect(mapTitle({ place: "Turkey", site: "Bergama", institution: "Antikensammlung" }))
      .toBe("Bergama · Antikensammlung")
    expect(mapTitle({ institution: "Antikensammlung" })).toBe("Antikensammlung")
    expect(mapTitle({})).toBeNull()
  })
  it("ends with the site name", () => {
    expect(withSiteName("Palestine")).toBe("Palestine — Ex Situ")
  })
})

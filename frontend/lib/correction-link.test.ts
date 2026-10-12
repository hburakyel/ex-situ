import { describe, expect, it } from "vitest"
import { artifactCorrectionUrl } from "./correction-link"

const parse = (url: string) => new URL(url).searchParams

describe("artifactCorrectionUrl", () => {
  it("prefills title and body from the record", () => {
    const p = parse(artifactCorrectionUrl({
      id: 42,
      inventory_number: "VII c 123",
      institution_name: "Ethnologisches Museum",
      place_name: "Benin-City",
      place_name_normalized: "Benin City",
      country_en: "Nigeria",
      latitude: 6.3,
      longitude: 5.6,
      manual_latitude: 6.340000152587891,
      manual_longitude: 5.62,
    }))
    expect(p.get("title")).toBe("Correction: VII c 123 (Ethnologisches Museum)")
    const body = p.get("body")!
    expect(body).toContain("/artifact/42")
    expect(body).toContain("- Place shown: Benin City")
    expect(body).toContain("- Place as recorded: Benin-City")
    // Manual coordinates win, as on the map.
    expect(body).toContain("- Coordinates: 6.34, 5.62")
    // Missing status is said, not implied to be fine.
    expect(body).toContain("- Geocoding status: not recorded")
  })

  it("falls back to the id and dashes for missing fields", () => {
    const p = parse(artifactCorrectionUrl({ id: 7 }))
    expect(p.get("title")).toBe("Correction: #7")
    expect(p.get("body")).toContain("- Coordinates: —")
  })
})

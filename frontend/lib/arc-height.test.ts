import { describe, expect, it } from "vitest"
import { arcHeightForZoom } from "./arc-height"

describe("arcHeightForZoom", () => {
  it("keeps the world, regional and street heights", () => {
    expect(arcHeightForZoom(1)).toBe(1)
    expect(arcHeightForZoom(4.5)).toBeCloseTo(0.35)
    expect(arcHeightForZoom(7)).toBe(0)
    expect(arcHeightForZoom(12)).toBe(0)
  })

  it("has no jump between zoom levels", () => {
    for (let z = 0; z < 10; z += 0.01) {
      expect(Math.abs(arcHeightForZoom(z + 0.01) - arcHeightForZoom(z))).toBeLessThan(0.01)
    }
  })
})

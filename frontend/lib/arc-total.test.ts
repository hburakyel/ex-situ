import { describe, expect, it } from "vitest"
import { objectsAcrossPlaces } from "./arc-total"

describe("objectsAcrossPlaces", () => {
  it("counts an object named at two places once across them", () => {
    // 181 "Egypt or Syria" objects: on both arcs, first-named at Egypt.
    const egypt = { object_count: 3632, primary_count: 3628 }
    const syria = { object_count: 623, primary_count: 411 }
    expect(objectsAcrossPlaces(egypt) + objectsAcrossPlaces(syria)).toBe(4039)
  })

  it("falls back to object_count for arcs from an API without primary_count", () => {
    expect(objectsAcrossPlaces({ object_count: 12 })).toBe(12)
    expect(objectsAcrossPlaces({})).toBe(0)
  })
})

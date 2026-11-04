import { describe, expect, it } from "vitest"
import { ERA_BUCKETS, collapseContiguousBuckets, usableDateSpans } from "./era-buckets"

describe("usableDateSpans", () => {
  const counts = { "ce-9": 4, "ce-10": 4, "ce-11": 4, "ce-12": 7, "ce-13": 2 }
  const wide = { earliest: 801, latest: 1100, count: 4 }
  const spans = [
    wide,
    { earliest: 1101, latest: 1200, count: 3 },
    { earliest: 1150, latest: 1250, count: 2 },
    { earliest: 1800, latest: 1800, count: 4 },
    { earliest: 1101, latest: 1150, count: 2 },
  ]

  it("keeps a span that fills a bucket and drops the rest", () => {
    expect(usableDateSpans(counts, spans)).toContainEqual(wide)
    expect(usableDateSpans(counts, spans)).not.toContainEqual({ earliest: 1800, latest: 1800, count: 4 })
    expect(usableDateSpans(counts, spans)).not.toContainEqual({ earliest: 1101, latest: 1200, count: 3 })
  })

  it("collapses the buckets exactly as with every span", () => {
    expect(collapseContiguousBuckets(ERA_BUCKETS, counts, usableDateSpans(counts, spans)))
      .toEqual(collapseContiguousBuckets(ERA_BUCKETS, counts, spans))
  })

  it("has nothing to keep without counts", () => {
    expect(usableDateSpans({}, spans)).toEqual([])
  })
})

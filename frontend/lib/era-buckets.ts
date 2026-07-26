/**
 * Time-period buckets for the search-panel date filter.
 *
 * Century-based, human-named buckets ("14th century", "19th century"...)
 * rather than a precise year slider or arbitrary multi-century spans — a
 * large share of object dates are only known as a range, not an exact year
 * (see METHODOLOGY.md), so finer-grained filtering would imply false
 * precision, while one giant span per bucket was too coarse to browse.
 * "Undated" is an explicit, selectable bucket rather than objects with no
 * date silently vanishing when any other bucket is active. Anything older
 * than 500 BCE collapses into a single "Before 500 BCE" catch-all — the
 * collection holds material back to roughly 500,000 BCE, so a literal
 * century-by-century list that far back would be almost entirely empty rows.
 *
 * For an exact single year (e.g. "1906"), use the year-input box instead —
 * it applies the same overlap logic, just pinned to one year.
 *
 * MUST stay structurally in sync with the backend's copy of this generator
 * in backend/src/api/museum-object/services/museum-object.js (ERA_BUCKETS) —
 * same ids and boundaries. The one intentional difference: the backend list
 * omits "undated" (it's handled as a separate predicate there), while this
 * one includes it so the UI can render it as a normal list row.
 */

export interface EraBucket {
  id: string
  label: string
  /** Inclusive lower bound (year, negative = BCE). null = unbounded start. */
  start: number | null
  /** Inclusive upper bound (year, negative = BCE). null = unbounded end (present). */
  end: number | null
  /** Special bucket: objects with no known creation date at all. */
  undated?: boolean
}

function ordinal(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1: return `${n}st`
    case 2: return `${n}nd`
    case 3: return `${n}rd`
    default: return `${n}th`
  }
}

/** BCE centuries run 5th → 1st (500 BCE is the "Before 500 BCE" cutoff), then CE centuries 1st → current. */
function buildCenturyBuckets(currentYear: number): EraBucket[] {
  const buckets: EraBucket[] = [
    { id: "ancient", label: "Before 500 BCE", start: null, end: -500 },
  ]
  for (let n = 5; n >= 1; n--) {
    buckets.push({ id: `bce-${n}`, label: `${ordinal(n)} century BCE`, start: -n * 100, end: -(n - 1) * 100 - 1 })
  }
  const currentCentury = Math.ceil(currentYear / 100)
  for (let n = 1; n <= currentCentury; n++) {
    const isCurrent = n === currentCentury
    buckets.push({
      id: `ce-${n}`,
      label: `${ordinal(n)} century`,
      start: (n - 1) * 100 + 1,
      end: isCurrent ? null : n * 100,
    })
  }
  buckets.push({ id: "undated", label: "Undated", start: null, end: null, undated: true })
  return buckets
}

export const ERA_BUCKETS: EraBucket[] = buildCenturyBuckets(new Date().getFullYear())

export interface EraDateFilters {
  dateStart?: number
  dateEnd?: number
  undated?: boolean
  acqDateStart?: number
  acqDateEnd?: number
  acqUndated?: boolean
}

/**
 * Shared derivation from the "Time"/"Migration" selections to the query
 * params every data-fetching path (map arcs, object grid, Places/Sites/
 * Collections aggregates) sends the backend. Keeping this in one place
 * means all of them agree on what an era/migrationEra selection means.
 */
export function eraToDateFilters(era?: EraBucket | null, migrationEra?: EraBucket | null): EraDateFilters {
  return {
    dateStart: era && !era.undated ? era.start ?? undefined : undefined,
    dateEnd: era && !era.undated ? era.end ?? undefined : undefined,
    undated: era?.undated || undefined,
    acqDateStart: migrationEra && !migrationEra.undated ? migrationEra.start ?? undefined : undefined,
    acqDateEnd: migrationEra && !migrationEra.undated ? migrationEra.end ?? undefined : undefined,
    acqUndated: migrationEra?.undated || undefined,
  }
}

export interface DateSpan {
  earliest: number
  latest: number
  count: number
}

export interface CollapsedBucketRow {
  id: string
  label: string
  count: number
  /** The range to filter by when this row is clicked/selected — a synthetic
   * combined bucket for merged rows, the original bucket otherwise. */
  era: EraBucket
  /** True when this row folds together more than one original century bucket. */
  isMerged: boolean
}

function isCenturyBucketId(id: string): boolean {
  return /^(bce|ce)-\d+$/.test(id)
}

function bucketOverlapsSpan(bucket: EraBucket, span: DateSpan): boolean {
  const startOk = bucket.end === null || span.earliest <= bucket.end
  const endOk = bucket.start === null || span.latest >= bucket.start
  return startOk && endOk
}

/**
 * Collapse a run of contiguous century buckets into one combined row when
 * they all trace back to the exact same object(s) — e.g. an object dated
 * "9th–14th century" currently repeats its count in every one of those 6
 * buckets, which reads as though 6 different objects happened to match,
 * rather than one wide-ranged object doing exactly what overlap-filtering
 * is supposed to do.
 *
 * Correctness rests on one fact: a bucket's count is always the sum of the
 * counts of every distinct (earliest, latest) span that overlaps it. So if
 * some span's own count equals a bucket's whole count, that span must be
 * the bucket's only contributor — no other span can also be contributing
 * (that would push the sum past the bucket's total). This means "same
 * object set" falls out of plain integer equality against the spans array
 * the backend already returns — no per-bucket object-id comparison needed.
 *
 * Only merges real century buckets ("bce-N"/"ce-N", chronological order).
 * "Before 500 BCE" and "Undated" are catch-alls, never merged into or across.
 *
 * `spans` defaults to [] so a response that predates this field (e.g. a
 * stale 5-minute proxy/client cache entry from before objectDateSpans
 * existed) degrades to "nothing merges, show every bucket as-is" instead of
 * throwing and blanking the whole list.
 */
export function collapseContiguousBuckets(
  buckets: EraBucket[],
  bucketCounts: Record<string, number>,
  spans: DateSpan[] = [],
): CollapsedBucketRow[] {
  const rows: CollapsedBucketRow[] = []
  let i = 0
  while (i < buckets.length) {
    const bucket = buckets[i]
    const count = bucketCounts[bucket.id] ?? 0

    if (!isCenturyBucketId(bucket.id)) {
      rows.push({ id: bucket.id, label: bucket.label, count, era: bucket, isMerged: false })
      i++
      continue
    }

    const span = count > 0 ? spans.find((s) => s.count === count && bucketOverlapsSpan(bucket, s)) : undefined
    if (!span) {
      rows.push({ id: bucket.id, label: bucket.label, count, era: bucket, isMerged: false })
      i++
      continue
    }

    // Extend forward while the next bucket is also fully explained by this same span.
    let j = i
    while (
      j + 1 < buckets.length &&
      isCenturyBucketId(buckets[j + 1].id) &&
      (bucketCounts[buckets[j + 1].id] ?? 0) === count &&
      bucketOverlapsSpan(buckets[j + 1], span)
    ) {
      j++
    }

    if (j === i) {
      rows.push({ id: bucket.id, label: bucket.label, count, era: bucket, isMerged: false })
      i++
      continue
    }

    const first = buckets[i]
    const last = buckets[j]
    const mergedLabel = `${first.label.split(' century')[0]}–${last.label}`
    const mergedId = `${first.id}_to_${last.id}`
    rows.push({
      id: mergedId,
      label: mergedLabel,
      count,
      era: { id: mergedId, label: mergedLabel, start: first.start, end: last.end },
      isMerged: true,
    })
    i = j + 1
  }
  return rows
}

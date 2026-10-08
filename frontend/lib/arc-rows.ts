import { INSTITUTION_CITIES } from "@/hooks/use-unified-search"

/** Holding city of an arc's destination; the institution name when the city isn't known. */
export function destinationCity(institution: string): string {
  return INSTITUTION_CITIES[institution] ?? institution
}

export interface Destination {
  city: string
  count: number
}

/** Adds an arc's objects to a place's per-city tally (cities sorted by count afterwards). */
export function addDestination(tally: Map<string, number>, institution: string, count: number) {
  const city = destinationCity(institution)
  tally.set(city, (tally.get(city) ?? 0) + count)
}

export function sortedDestinations(tally: Map<string, number>): Destination[] {
  return Array.from(tally, ([city, count]) => ({ city, count })).sort((a, b) => b.count - a.count)
}

/**
 * The panel lists arcs (origin → holding city), not bare places: one row per
 * place and destination city, largest first. Clicking a row still drills into
 * its origin place, so `group` is the place the row came from.
 */
export function arcRows<T extends { totalCount: number; destinations?: Destination[] }>(groups: T[]) {
  return groups
    .flatMap((group) =>
      group.destinations?.length
        ? group.destinations.map((d) => ({ group, to: d.city, count: d.count }))
        : [{ group, to: "", count: group.totalCount }],
    )
    .sort((a, b) => b.count - a.count)
}

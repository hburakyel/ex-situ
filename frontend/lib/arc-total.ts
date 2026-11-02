/**
 * An arc's share of a total that spans places (a collection's objects, the whole
 * map). A record that names several places ("Egypt or Syria") is on the arc from
 * each, so adding up object_count across places would count it once per place;
 * primary_count counts it at the place it names first only. Totals within one place
 * (a country's or a site's arcs) add up object_count.
 */
export function objectsAcrossPlaces(arc: { object_count?: number | null; primary_count?: number | null }): number {
  return arc.primary_count ?? arc.object_count ?? 0
}

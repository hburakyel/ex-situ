// Country → institution arc totals (geospatial zoom=1), for server-side metadata and the sitemap.
// One cached request serves every place/institution page.

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:1337/api"

export interface ArcTotal {
  place_name: string
  institution_name: string
  object_count: number
}

export async function fetchArcTotals(): Promise<ArcTotal[]> {
  try {
    const res = await fetch(`${API_BASE}/museum-objects/geospatial?zoom=1`, {
      next: { revalidate: 86400 },
    })
    if (!res.ok) return []
    const json = await res.json()
    const data: unknown = Array.isArray(json?.data) ? json.data : json
    if (!Array.isArray(data)) return []
    return data.filter(
      (d): d is ArcTotal =>
        typeof d?.place_name === "string" && typeof d?.institution_name === "string",
    )
  } catch {
    return []
  }
}

export interface Group {
  name: string
  count: number
  /** The other side of the arc (museums for a place, places for a museum), largest first. */
  related: { name: string; count: number }[]
}

function groupBy(arcs: ArcTotal[], key: "place_name" | "institution_name"): Group[] {
  const other = key === "place_name" ? "institution_name" : "place_name"
  const groups = new Map<string, Map<string, number>>()
  for (const a of arcs) {
    const g = groups.get(a[key]) ?? new Map<string, number>()
    g.set(a[other], (g.get(a[other]) ?? 0) + (a.object_count ?? 0))
    groups.set(a[key], g)
  }
  return [...groups].map(([name, rel]) => {
    const related = [...rel].map(([n, count]) => ({ name: n, count })).sort((x, y) => y.count - x.count)
    return { name, count: related.reduce((s, r) => s + r.count, 0), related }
  })
}

export const groupByPlace = (arcs: ArcTotal[]) => groupBy(arcs, "place_name")
export const groupByInstitution = (arcs: ArcTotal[]) => groupBy(arcs, "institution_name")

export function findGroup(groups: Group[], name: string): Group | undefined {
  const key = name.trim().toLowerCase()
  return groups.find((g) => g.name.toLowerCase() === key)
}

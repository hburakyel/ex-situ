import type { MetadataRoute } from 'next'

export const revalidate = 86400 // regenerate once per day

const BASE_URL = 'https://exsitu.app'
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:1337/api'
// Google hard limit is 50,000 URLs per sitemap file
const ARTIFACTS_PER_PAGE = 1000

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Research pages intentionally excluded from sitemap (work in progress)

async function fetchTotalArtifactCount(): Promise<number> {
  try {
    const res = await fetch(
      `${API_BASE}/museum-objects?pagination[pageSize]=1`,
      { next: { revalidate: 86400 } }
    )
    if (!res.ok) return 0
    const json = await res.json()
    return json?.meta?.pagination?.total ?? 0
  } catch {
    return 0
  }
}

async function fetchArtifactPage(pageIndex: number, pageSize: number): Promise<number[]> {
  try {
    const res = await fetch(
      `${API_BASE}/museum-objects?pagination[page]=${pageIndex + 1}&pagination[pageSize]=${pageSize}&fields[0]=id`,
      { next: { revalidate: 86400 } }
    )
    if (!res.ok) return []
    const json = await res.json()
    return (Array.isArray(json?.data) ? json.data : [])
      .map((r: { id: number }) => r.id)
      .filter((id: unknown): id is number => typeof id === 'number')
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Paginated sitemap — id=0: static+arcs+collections, id≥1: artifacts
// ---------------------------------------------------------------------------

export async function generateSitemaps() {
  const total = await fetchTotalArtifactCount()
  const artifactPageCount = Math.max(1, Math.ceil(total / ARTIFACTS_PER_PAGE))
  // id=0 reserved for static routes, id=1..N for artifacts
  return Array.from({ length: artifactPageCount + 1 }, (_, i) => ({ id: i }))
}

export default async function sitemap({ id }: { id: number }): Promise<MetadataRoute.Sitemap> {
  const now = new Date()
  const numId = Number(id)

  // id=0: static pages only (research excluded — work in progress)
  if (numId === 0) {
    return [
      { url: `${BASE_URL}/map`, lastModified: now, changeFrequency: 'daily', priority: 1.0 },
    ]
  }

  // id≥1: artifact pages (page index = id - 1)
  const artifactIds = await fetchArtifactPage(numId - 1, ARTIFACTS_PER_PAGE)
  return artifactIds.map((artId) => ({
    url: `${BASE_URL}/artifact/${artId}`,
    lastModified: now,
    changeFrequency: 'monthly' as const,
    priority: 0.5,
  }))
}

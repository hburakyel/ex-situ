import type { MetadataRoute } from 'next'

export const revalidate = 86400 // regenerate once per day

const BASE_URL = 'https://exsitu.app'
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:1337/api'
// Google hard limit is 50,000 URLs per sitemap file
const ARTIFACTS_PER_PAGE = 1000

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchArcAndCollectionSlugs(): Promise<{
  arcs: string[]
  collections: string[]
}> {
  try {
    const res = await fetch(`${API_BASE}/museum-objects/geospatial?zoom=1`, {
      next: { revalidate: 86400 },
    })
    if (!res.ok) return { arcs: [], collections: [] }

    const json = await res.json()
    const data: Array<{ place_name?: string; institution_name?: string }> =
      Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : []

    const arcs = [...new Set(
      data.map((d) => d.place_name).filter((s): s is string => Boolean(s))
    )]
    const collections = [...new Set(
      data.map((d) => d.institution_name).filter((s): s is string => Boolean(s))
    )]

    return { arcs, collections }
  } catch {
    return { arcs: [], collections: [] }
  }
}

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

  // id=0: static pages, arcs, collections
  if (numId === 0) {
    const { arcs, collections } = await fetchArcAndCollectionSlugs()

    const staticRoutes: MetadataRoute.Sitemap = [
      { url: `${BASE_URL}/map`, lastModified: now, changeFrequency: 'daily', priority: 1.0 },
      { url: `${BASE_URL}/research`, lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
    ]
    const arcRoutes: MetadataRoute.Sitemap = arcs.map((slug) => ({
      url: `${BASE_URL}/research/arc/${encodeURIComponent(slug)}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    }))
    const collectionRoutes: MetadataRoute.Sitemap = collections.map((slug) => ({
      url: `${BASE_URL}/research/collection/${encodeURIComponent(slug)}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    }))

    return [...staticRoutes, ...arcRoutes, ...collectionRoutes]
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

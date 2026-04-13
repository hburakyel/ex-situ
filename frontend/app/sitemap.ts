import type { MetadataRoute } from 'next'

export const revalidate = 86400 // regenerate once per day

const BASE_URL = 'https://exsitu.app'
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:1337/api'

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

async function fetchArtifactIds(cap = 500): Promise<number[]> {
  const ids: number[] = []
  const pageSize = 100
  let page = 1
  let totalPages = 1

  try {
    while (page <= totalPages && ids.length < cap) {
      const res = await fetch(
        `${API_BASE}/museum-objects?pagination[page]=${page}&pagination[pageSize]=${pageSize}&fields[0]=id`,
        { next: { revalidate: 86400 } }
      )
      if (!res.ok) break

      const json = await res.json()
      const records: Array<{ id: number }> = Array.isArray(json?.data)
        ? json.data
        : []

      for (const r of records) {
        if (ids.length >= cap) break
        if (typeof r.id === 'number') ids.push(r.id)
      }

      totalPages = json?.meta?.pagination?.pageCount ?? 1
      page++
    }
  } catch {
    // Gracefully degrade — sitemap will omit artifact entries
  }

  return ids
}

// ---------------------------------------------------------------------------
// Sitemap
// ---------------------------------------------------------------------------

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [{ arcs, collections }, artifactIds] = await Promise.all([
    fetchArcAndCollectionSlugs(),
    fetchArtifactIds(500),
  ])

  const now = new Date()

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: `${BASE_URL}/map`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/research`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
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

  const artifactRoutes: MetadataRoute.Sitemap = artifactIds.map((id) => ({
    url: `${BASE_URL}/artifact/${id}`,
    lastModified: now,
    changeFrequency: 'monthly' as const,
    priority: 0.5,
  }))

  return [...staticRoutes, ...arcRoutes, ...collectionRoutes, ...artifactRoutes]
}

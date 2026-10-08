import { MetadataRoute } from 'next'
import { fetchArcTotals, groupByInstitution, groupByPlace } from '@/lib/arc-index'

const SITE = 'https://exsitu.app'

// Rebuilt daily, like the arc totals it lists.
export const revalidate = 86400

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const arcs = await fetchArcTotals()
  const view = (param: 'place' | 'institution', name: string): MetadataRoute.Sitemap[number] => ({
    url: `${SITE}/map?${param}=${encodeURIComponent(name)}`,
    changeFrequency: 'weekly',
    priority: 0.7,
  })

  return [
    { url: SITE, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE}/map`, changeFrequency: 'daily', priority: 0.9 },
    ...groupByInstitution(arcs).map((g) => view('institution', g.name)),
    ...groupByPlace(arcs).map((g) => view('place', g.name)),
  ]
}

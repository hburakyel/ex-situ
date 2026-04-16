import type { Metadata } from "next"
import ArcDetailClient from "./arc-client"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:1337/api"

interface ArcEntry {
  place_name?: string
  institution_name?: string
  object_count?: number
}

async function fetchArcEntries(country: string): Promise<ArcEntry[]> {
  try {
    const res = await fetch(`${API_BASE}/museum-objects/geospatial?zoom=1`, {
      next: { revalidate: 86400 },
    })
    if (!res.ok) return []
    const json = await res.json()
    const data: ArcEntry[] = Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json)
      ? json
      : []
    return data.filter(
      (d) => d.place_name?.toLowerCase() === country.toLowerCase(),
    )
  } catch {
    return []
  }
}

export async function generateStaticParams() {
  try {
    const res = await fetch(`${API_BASE}/museum-objects/geospatial?zoom=1`, {
      cache: "force-cache",
    })
    if (!res.ok) return []
    const json = await res.json()
    const data: ArcEntry[] = Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json)
      ? json
      : []
    const slugs = [
      ...new Set(
        data
          .map((d) => d.place_name)
          .filter((s): s is string => Boolean(s))
          .map((s) => s.toLowerCase()),
      ),
    ]
    return slugs.map((slug) => ({ slug: encodeURIComponent(slug) }))
  } catch {
    return []
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const country = decodeURIComponent(slug)
  const displayName = country.charAt(0).toUpperCase() + country.slice(1)

  const entries = await fetchArcEntries(country)
  const totalObjects = entries.reduce((sum, a) => sum + (a.object_count ?? 0), 0)
  const institutions = [
    ...new Set(entries.map((a) => a.institution_name).filter(Boolean)),
  ].slice(0, 3) as string[]

  const description =
    totalObjects > 0
      ? `${totalObjects.toLocaleString()} cultural heritage objects from ${displayName}, held at ${institutions.join(", ")}${institutions.length > 0 ? " and others" : ""}. Explore provenance on Ex Situ.`
      : `Explore cultural heritage objects from ${displayName} and their institutional provenance on Ex Situ.`

  return {
    title: `${displayName} — Cultural Heritage Provenance | Ex Situ`,
    description,
    openGraph: {
      title: `${displayName} — Cultural Heritage Provenance | Ex Situ`,
      description,
      url: `https://exsitu.app/research/arc/${encodeURIComponent(country.toLowerCase())}`,
    },
  }
}

export default function ArcDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  return <ArcDetailClient params={params} />
}


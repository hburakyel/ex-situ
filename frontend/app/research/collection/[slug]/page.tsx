import type { Metadata } from "next"
import CollectionDetailClient from "./collection-client"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:1337/api"

interface ArcEntry {
  place_name?: string
  institution_name?: string
  object_count?: number
}

async function fetchInstitutionEntries(institution: string): Promise<ArcEntry[]> {
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
      (d) => d.institution_name?.toLowerCase() === institution.toLowerCase(),
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
    const institutions = [
      ...new Set(
        data
          .map((d) => d.institution_name)
          .filter((s): s is string => Boolean(s))
          .map((s) => s.toLowerCase()),
      ),
    ]
    return institutions.map((name) => ({ slug: encodeURIComponent(name) }))
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
  const decodedSlug = decodeURIComponent(slug)
  const displayName = decodedSlug
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")

  const entries = await fetchInstitutionEntries(decodedSlug)
  const totalObjects = entries.reduce((sum, a) => sum + (a.object_count ?? 0), 0)
  const origins = [
    ...new Set(entries.map((a) => a.place_name).filter(Boolean)),
  ].slice(0, 3) as string[]

  const description =
    totalObjects > 0
      ? `${displayName} holds ${totalObjects.toLocaleString()} cultural heritage objects from ${origins.join(", ")}${origins.length > 0 ? " and other origins" : ""}. Explore the collection on Ex Situ.`
      : `Explore the ${displayName} collection and its provenance data on Ex Situ.`

  return {
    title: `${displayName} Collection | Ex Situ`,
    description,
    openGraph: {
      title: `${displayName} Collection | Ex Situ`,
      description,
      url: `https://exsitu.app/research/collection/${encodeURIComponent(decodedSlug.toLowerCase())}`,
    },
  }
}

export default function CollectionDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  return <CollectionDetailClient params={params} />
}


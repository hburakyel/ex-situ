import { Metadata } from "next"
import { notFound } from "next/navigation"
import type { MuseumObject } from "@/types"
import ArtifactRedirect from "./artifact-redirect"

const BASE_URL = "https://exsitu.app"

interface ObjectPageProps {
  params: Promise<{ id: string }>
}

async function getObject(id: string): Promise<MuseumObject | null> {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL
  if (!apiBaseUrl) return null

  try {
    const fixedApiBaseUrl = apiBaseUrl.replace("localhost", "127.0.0.1")
    const response = await fetch(`${fixedApiBaseUrl}/museum-objects/${id}?populate=*`, {
      next: { revalidate: 3600 },
    })

    if (!response.ok) return null

    const data = await response.json()
    return data.data as MuseumObject
  } catch (error) {
    console.error("Error fetching object:", error)
    return null
  }
}

function buildDescription(attrs: MuseumObject["attributes"], invPart: string): string {
  const parts: string[] = []
  const title = attrs.title
  if (title) parts.push(`${title}${invPart}.`)
  const origin = attrs.place_name || attrs.country_en
  if (origin) parts.push(`Origin: ${origin}.`)
  if (attrs.institution_name) parts.push(`Now at ${attrs.institution_name}.`)
  if (attrs.cultural_context) {
    const snippet = attrs.cultural_context.slice(0, 120)
    parts.push(snippet.length < attrs.cultural_context.length ? `${snippet}…` : snippet)
  }
  return parts.join(" ") || `Museum object at Ex Situ — relational spatial index of cultural heritage.`
}

function buildJsonLd(id: string, attrs: MuseumObject["attributes"]) {
  const sameAs: string[] = []
  if (attrs.source_link) sameAs.push(attrs.source_link)
  if (attrs.object_links?.length) {
    for (const l of attrs.object_links) {
      if (l.url) sameAs.push(l.url)
    }
  }

  return {
    "@context": "https://schema.org",
    "@type": "VisualArtwork",
    "@id": `${BASE_URL}/artifact/${id}`,
    url: `${BASE_URL}/artifact/${id}`,
    name: attrs.title || `Object ${id}`,
    ...(attrs.inventory_number && { identifier: attrs.inventory_number }),
    ...(attrs.img_url && { image: attrs.img_url }),
    ...(attrs.cultural_context && { description: attrs.cultural_context }),
    ...((attrs.place_name || attrs.country_en) && {
      locationCreated: {
        "@type": "Place",
        name: attrs.place_name || attrs.country_en,
        ...(attrs.country_en && { addressCountry: attrs.country_en }),
      },
    }),
    ...(attrs.institution_name && {
      contentLocation: {
        "@type": "Museum",
        name: attrs.institution_name,
        ...((attrs.institution_city_en || attrs.institution_country_en) && {
          address: {
            "@type": "PostalAddress",
            ...(attrs.institution_city_en && { addressLocality: attrs.institution_city_en }),
            ...(attrs.institution_country_en && { addressCountry: attrs.institution_country_en }),
          },
        }),
      },
    }),
    ...(sameAs.length > 0 && { sameAs }),
    provider: {
      "@type": "Organization",
      name: "Ex Situ",
      url: BASE_URL,
    },
  }
}

export async function generateMetadata({ params }: ObjectPageProps): Promise<Metadata> {
  const { id } = await params
  const object = await getObject(id)

  if (!object) {
    return { title: "Object Not Found | Ex Situ" }
  }

  const attrs = object.attributes
  const title = attrs.title || `Object ${id}`
  const invPart = attrs.inventory_number ? ` ${attrs.inventory_number}` : ""
  const description = buildDescription(attrs, invPart)
  const canonicalUrl = `${BASE_URL}/artifact/${id}`
  const images = attrs.img_url ? [{ url: attrs.img_url }] : []

  return {
    title: `${title}${invPart} | Ex Situ`,
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title: `${title}${invPart} | Ex Situ`,
      description,
      url: canonicalUrl,
      type: "article",
      images,
    },
    twitter: {
      card: "summary_large_image",
      title: `${title}${invPart} | Ex Situ`,
      description,
      images: attrs.img_url ? [attrs.img_url] : [],
    },
  }
}

export default async function ObjectPage({ params }: ObjectPageProps) {
  const { id } = await params
  const object = await getObject(id)

  if (!object) notFound()

  const attrs = object.attributes

  const redirectParams = new URLSearchParams()
  redirectParams.set("artifactId", id)
  if (attrs.latitude && attrs.longitude) {
    redirectParams.set("lat", attrs.latitude.toFixed(4))
    redirectParams.set("lng", attrs.longitude.toFixed(4))
    redirectParams.set("zoom", "12")
  }
  if (attrs.country_en) redirectParams.set("place", attrs.country_en)
  if (attrs.place_name) redirectParams.set("site", attrs.place_name)

  const mapUrl = `/map?${redirectParams.toString()}`
  const jsonLd = buildJsonLd(id, attrs)

  return (
    <>
      {/* Structured data for Google */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* Client-side redirect to map — preserves SSR HTML for crawlers */}
      <ArtifactRedirect url={mapUrl} />
      {/* Crawler-visible content — hidden from real users via sr-only */}
      <main style={{ position: "absolute", width: "1px", height: "1px", padding: 0, margin: "-1px", overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0 }}>
        <h1>{attrs.title || `Object ${id}`}</h1>
        {attrs.inventory_number && <p>inv: {attrs.inventory_number}</p>}
        {attrs.institution_name && <p>{attrs.institution_name}</p>}
        {attrs.place_name && <p>{attrs.place_name}</p>}
        {attrs.country_en && <p>{attrs.country_en}</p>}
        {attrs.cultural_context && <p>{attrs.cultural_context}</p>}
        <a href={mapUrl}>View on map</a>
      </main>
    </>
  )
}

import { Metadata } from "next"
import { notFound } from "next/navigation"
import Image from "next/image"
import Link from "next/link"
import { ArrowLeft, ExternalLink, MapPin, Building2, Globe2, BookOpen, Route, History, Shield } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { MuseumObject } from "@/types"
import BackButton from "@/components/back-button"

interface ObjectPageProps {
  params: Promise<{ id: string }>
}

async function getObject(id: string): Promise<MuseumObject | null> {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL
  if (!apiBaseUrl) return null

  try {
    const fixedApiBaseUrl = apiBaseUrl.replace("localhost", "127.0.0.1")
    const response = await fetch(`${fixedApiBaseUrl}/museum-objects/${id}?populate=*`, {
      next: { revalidate: 3600 }, // Cache for 1 hour
    })

    if (!response.ok) return null

    const data = await response.json()
    return data.data as MuseumObject
  } catch (error) {
    console.error("Error fetching object:", error)
    return null
  }
}

export async function generateMetadata({ params }: ObjectPageProps): Promise<Metadata> {
  const { id } = await params
  const object = await getObject(id)

  if (!object) {
    return {
      title: "Object Not Found | Ex Situ",
    }
  }

  const attrs = object.attributes
  const title = attrs.title || `Object ${id}`
  const description = `${title} from ${attrs.place_name || attrs.country_en || "Unknown origin"}, now at ${attrs.institution_name || "Unknown institution"}`

  return {
    title: `${title} | Ex Situ`,
    description,
    openGraph: {
      title: `${title} | Ex Situ`,
      description,
      images: attrs.img_url ? [{ url: attrs.img_url }] : [],
    },
  }
}

export default async function ObjectPage({ params }: ObjectPageProps) {
  const { id } = await params
  const object = await getObject(id)

  if (!object) {
    notFound()
  }

  const attrs = object.attributes

  // Build map URL with coordinates
  const mapUrl = attrs.latitude && attrs.longitude
    ? `/map?zoom=12&lat=${attrs.latitude.toFixed(4)}&lng=${attrs.longitude.toFixed(4)}`
    : "/map"

  // Get external link
  const getExternalLink = () => {
    if (attrs.object_links?.length) {
      return attrs.object_links[0].url || attrs.object_links[0].link_text
    }
    return attrs.source_link
  }

  const externalLink = getExternalLink()

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center gap-4 px-4">
          <BackButton />
          <div className="flex-1" />
          {externalLink && (
            <a href={externalLink} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" className="gap-2">
                <ExternalLink className="h-4 w-4" />
                View Source
              </Button>
            </a>
          )}
        </div>
      </header>

      {/* Content */}
      <div className="container px-4 py-8">
        <div className="grid gap-8 lg:grid-cols-2">
          {/* Image Section */}
          <div className="relative aspect-square overflow-hidden rounded-lg bg-muted">
            {attrs.img_url ? (
              <Image
                src={attrs.img_url}
                alt={attrs.title || "Museum object"}
                fill
                className="object-contain"
                priority
                sizes="(max-width: 1024px) 100vw, 50vw"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                No Image
              </div>
            )}
          </div>

          {/* Details Section */}
          <div className="space-y-6">
            {/* Title & Inventory */}
            <div>
              <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
                {attrs.title || "Başlık Yok"}
              </h1>
              {attrs.inventory_number && (
                <p className="mt-1 text-sm text-muted-foreground">
                  Envanter No: {attrs.inventory_number}
                </p>
              )}
            </div>

            {/* Origin Location */}
            <div className="rounded-lg border p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <MapPin className="h-4 w-4 text-red-500" />
                Origin
              </div>
              <div className="space-y-1 text-sm">
                {attrs.place_name && (
                  <p className="font-medium">{attrs.place_name}</p>
                )}
                {(attrs.city_en || attrs.city_native) && (
                  <p>
                    {attrs.city_en}
                    {attrs.city_native && attrs.city_native !== attrs.city_en && (
                      <span className="text-muted-foreground"> ({attrs.city_native})</span>
                    )}
                  </p>
                )}
                {(attrs.country_en || attrs.country_native) && (
                  <p>
                    {attrs.country_en}
                    {attrs.country_native && attrs.country_native !== attrs.country_en && (
                      <span className="text-muted-foreground"> ({attrs.country_native})</span>
                    )}
                  </p>
                )}
                {attrs.latitude && attrs.longitude && (
                  <p className="text-xs text-muted-foreground">
                    {attrs.latitude.toFixed(4)}, {attrs.longitude.toFixed(4)}
                  </p>
                )}
              </div>
            </div>

            {/* Institution */}
            <div className="rounded-lg border p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Building2 className="h-4 w-4 text-blue-500" />
                Current Location
              </div>
              <div className="space-y-1 text-sm">
                {attrs.institution_name && (
                  <p className="font-medium">{attrs.institution_name}</p>
                )}
                {(attrs.institution_city_en || attrs.institution_city_native) && (
                  <p>
                    {attrs.institution_city_en}
                    {attrs.institution_city_native && attrs.institution_city_native !== attrs.institution_city_en && (
                      <span className="text-muted-foreground"> ({attrs.institution_city_native})</span>
                    )}
                  </p>
                )}
                {attrs.institution_country_en && (
                  <p>{attrs.institution_country_en}</p>
                )}
                {attrs.institution_latitude && attrs.institution_longitude && (
                  <p className="text-xs text-muted-foreground">
                    {attrs.institution_latitude.toFixed(4)}, {attrs.institution_longitude.toFixed(4)}
                  </p>
                )}
              </div>
            </div>

            {/* Cultural Context (LLM Enrichment) */}
            {attrs.cultural_context && (
              <div className="rounded-lg border p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <BookOpen className="h-4 w-4 text-amber-500" />
                  Cultural Context
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {attrs.cultural_context}
                </p>
                {attrs.enrichment_confidence && (
                  <Badge
                    variant={
                      attrs.enrichment_confidence === "high"
                        ? "secondary"
                        : attrs.enrichment_confidence === "medium"
                        ? "outline"
                        : "destructive"
                    }
                    className="mt-2"
                  >
                    {attrs.enrichment_confidence} confidence
                  </Badge>
                )}
              </div>
            )}

            {/* Transfer Method (LLM Enrichment) */}
            {attrs.transfer_method && (
              <div className="rounded-lg border p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <Route className="h-4 w-4 text-orange-500" />
                  Transfer Method
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {attrs.transfer_method}
                </p>
              </div>
            )}

            {/* Historical Relation (LLM Enrichment) */}
            {attrs.historical_relation && (
              <div className="rounded-lg border p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <History className="h-4 w-4 text-purple-500" />
                  Historical Relation
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {attrs.historical_relation}
                </p>
              </div>
            )}

            {/* Origin Type & Normalized Origin */}
            {(attrs.origin_type || attrs.normalized_origin) && (
              <div className="rounded-lg border p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <Shield className="h-4 w-4 text-teal-500" />
                  Origin Classification
                </div>
                <div className="flex flex-wrap gap-2">
                  {attrs.origin_type && (
                    <Badge
                      variant={
                        attrs.origin_type === "valid_location"
                          ? "secondary"
                          : attrs.origin_type === "cultural_area"
                          ? "outline"
                          : attrs.origin_type === "historical_toponym"
                          ? "outline"
                          : "destructive"
                      }
                    >
                      {attrs.origin_type.replace(/_/g, " ")}
                    </Badge>
                  )}
                  {attrs.normalized_origin && attrs.normalized_origin !== attrs.city_en && (
                    <Badge variant="outline">
                      Normalized: {attrs.normalized_origin}
                    </Badge>
                  )}
                </div>
              </div>
            )}

            {/* Geocoding Info */}
            {(attrs.geocoded_country || attrs.geocoder_source || attrs.geocoding_confidence) && (
              <div className="rounded-lg border p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <Globe2 className="h-4 w-4 text-green-500" />
                  Geocoding Info
                </div>
                <div className="flex flex-wrap gap-2">
                  {attrs.geocoded_country && (
                    <Badge variant="secondary">{attrs.geocoded_country}</Badge>
                  )}
                  {attrs.geocoded_region && (
                    <Badge variant="secondary">{attrs.geocoded_region}</Badge>
                  )}
                  {attrs.geocoder_source && (
                    <Badge variant="outline">{attrs.geocoder_source}</Badge>
                  )}
                  {attrs.geocoding_confidence && (
                    <Badge variant="outline">
                      Confidence: {(attrs.geocoding_confidence * 100).toFixed(0)}%
                    </Badge>
                  )}
                  {attrs.geocoding_status && (
                    <Badge
                      variant={
                        attrs.geocoding_status === "ok"
                          ? "secondary"
                          : attrs.geocoding_status === "disputed"
                          ? "destructive"
                          : "outline"
                      }
                    >
                      {attrs.geocoding_status}
                    </Badge>
                  )}
                </div>
                {attrs.geocoding_notes && (
                  <p className="mt-2 text-xs text-muted-foreground">{attrs.geocoding_notes}</p>
                )}
              </div>
            )}

            {/* Original Place Variants */}
            {attrs.original_place_variants && attrs.original_place_variants.length > 0 && (
              <div className="rounded-lg border p-4">
                <div className="mb-2 text-sm font-medium">Alternative Place Names</div>
                <div className="flex flex-wrap gap-2">
                  {attrs.original_place_variants.map((variant, index) => (
                    <Badge key={index} variant="outline">
                      {variant.label}
                      {variant.language && (
                        <span className="ml-1 text-xs opacity-60">({variant.language})</span>
                      )}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Object Links */}
            {attrs.object_links && attrs.object_links.length > 0 && (
              <div className="rounded-lg border p-4">
                <div className="mb-2 text-sm font-medium">Links</div>
                <div className="flex flex-col gap-2">
                  {attrs.object_links.map((link, index) => (
                    <a
                      key={index}
                      href={link.url || link.link_text}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-sm text-blue-600 hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {link.link_display || link.link_text || "Bağlantı"}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* View on Map Button */}
            <Link href={mapUrl} className="block">
              <Button className="w-full gap-2" size="lg">
                <MapPin className="h-4 w-4" />
                View on Map
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}

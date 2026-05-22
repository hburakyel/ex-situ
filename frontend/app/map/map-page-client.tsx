"use client"

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import MapView, { type FacetedFilters } from "@/components/map/map-view"
import ObjectPanel, { type ContainerSize } from "@/components/map/object-panel"
import { fetchMuseumObjects, fetchObjectsByCountry } from "@/lib/api"
import type { MuseumObject, MapBounds, SelectedArc } from "@/types"
import { useMediaQuery } from "@/hooks/use-media-query"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/use-toast"
import { Toaster } from "@/components/ui/toaster"
import debounce from "lodash/debounce"
import { useUnifiedSearch, type ArcData } from "@/hooks/use-unified-search"
import CommandPalette, { type CommandPaletteHandlers } from "@/components/map/command-palette"

// ── SubArc type (zoom=4 site-level data) ──
interface SubArc {
  place_name: string
  place_name_normalized?: string
  institution_name: string
  object_count: number
  latitude: number
  longitude: number
  institution_latitude?: number
  institution_longitude?: number
  country?: string
  sample_img_url: string | null
  cluster_id: string
}

async function fetchSubArcs(country: string): Promise<SubArc[]> {
  try {
    const params = new URLSearchParams({ zoom: "4", country })
    const res = await fetch(`/api/proxy/geospatial?${params.toString()}`)
    if (!res.ok) return []
    const data = await res.json()
    return (data.data || []) as SubArc[]
  } catch { return [] }
}

function normalizePlaceKey(value?: string | null): string {
  return (value || "").trim().toLocaleLowerCase()
}

function hasValidCoordinates(lat?: number | null, lng?: number | null): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
  return Math.abs(lat as number) <= 90
    && Math.abs(lng as number) <= 180
    && !(Math.abs(lat as number) < 1e-6 && Math.abs(lng as number) < 1e-6)
}

function prefersPlaceLabel(nextLabel: string, currentLabel: string): boolean {
  if (!currentLabel) return true
  const nextHasUppercase = /\p{Lu}/u.test(nextLabel)
  const currentHasUppercase = /\p{Lu}/u.test(currentLabel)
  if (nextHasUppercase !== currentHasUppercase) return nextHasUppercase
  return nextLabel.length < currentLabel.length
}

function matchesAnyFilter(value: string | null | undefined, filters: Set<string>): boolean {
  if (filters.size === 0) return true
  return filters.has(normalizePlaceKey(value))
}

export default function MapPageClient() {
  return (
    <Suspense fallback={<div className="flex h-full w-full items-center justify-center bg-white"><div className="text-gray-400">loading map...</div></div>}>
      <MapContent />
    </Suspense>
  )
}

// ── Drill-down level type ──
type DrillLevel = "global" | "country" | "objects"

function MapContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  // ── Read initial state from URL params ──
  const urlCountry = searchParams.get("place")
  const urlSite = searchParams.get("site")
  const urlInstitution = searchParams.get("institution")
  const urlLat = searchParams.get("lat")
  const urlLng = searchParams.get("lng")
  const urlZoom = searchParams.get("zoom")
  const urlArtifactId = searchParams.get("artifactId")
  // Capture on mount in a ref — router.replace will strip it from the URL but we still need it
  const artifactIdRef = useRef(urlArtifactId)

  // Clamp and validate URL parameters to prevent NaN / extreme values
  const clamp = (val: number, min: number, max: number, fallback: number) =>
    Number.isFinite(val) ? Math.min(Math.max(val, min), max) : fallback

  // Detect mobile at mount time (before any resize events) for initial view defaults
  const isMobileInit = typeof window !== 'undefined' && window.innerWidth < 768

  const [objects, setObjects] = useState<MuseumObject[]>([])
  const [viewState, setViewState] = useState({
    longitude: clamp(urlLng ? parseFloat(urlLng) : (isMobileInit ? 15 : 0), -180, 180, isMobileInit ? 15 : 0),
    latitude: clamp(urlLat ? parseFloat(urlLat) : (isMobileInit ? 15 : 20), -90, 90, isMobileInit ? 15 : 20),
    zoom: clamp(urlZoom ? parseFloat(urlZoom) : (isMobileInit ? 1.2 : 2), 0, 22, isMobileInit ? 1.2 : 2),
    name: "",
  })
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [totalCount, setTotalCount] = useState(0)
  const [currentBounds, setCurrentBounds] = useState<MapBounds | null>(null)
  const [locationName, setLocationName] = useState("")
  const [geocodedName, setGeocodedName] = useState("")
  const [isRateLimited, setIsRateLimited] = useState(false)
  const mapRef = useRef<any>(null)
  const isMobile = useMediaQuery("(max-width: 768px)")
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [containerSize, setContainerSize] = useState<ContainerSize>("default")
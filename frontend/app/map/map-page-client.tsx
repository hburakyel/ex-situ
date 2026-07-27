"use client"

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import MapView, { type FacetedFilters } from "@/components/map/map-view"
import ObjectPanel, { type ContainerSize } from "@/components/map/object-panel"
import { fetchMuseumObjects, fetchObjectsByCountry, fetchDateBucketCounts, type DateBucketCounts } from "@/lib/api"
import { eraToDateFilters, type EraDateFilters } from "@/lib/era-buckets"
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

async function fetchSubArcs(country: string, dateFilters?: EraDateFilters): Promise<SubArc[]> {
  try {
    const params = new URLSearchParams({ zoom: "4", country })
    if (dateFilters?.dateStart !== undefined) params.set("dateStart", String(dateFilters.dateStart))
    if (dateFilters?.dateEnd !== undefined) params.set("dateEnd", String(dateFilters.dateEnd))
    if (dateFilters?.undated) params.set("undated", "true")
    if (dateFilters?.acqDateStart !== undefined) params.set("acqDateStart", String(dateFilters.acqDateStart))
    if (dateFilters?.acqDateEnd !== undefined) params.set("acqDateEnd", String(dateFilters.acqDateEnd))
    if (dateFilters?.acqUndated) params.set("acqUndated", "true")
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
  const [isObjectContainerVisible, setIsObjectContainerVisible] = useState(true)
  const [facetedFilters, setFacetedFilters] = useState<FacetedFilters>({ institutions: [], countries: [], cities: [] })
  const [selectedArc, setSelectedArc] = useState<SelectedArc | null>(null)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [wikiDocs, setWikiDocs] = useState<any[]>([])
  const [initialGalleryArtifact, setInitialGalleryArtifact] = useState<MuseumObject | null>(null)
  const initialZoom = clamp(urlZoom ? parseFloat(urlZoom) : (isMobileInit ? 1.2 : 2), 0, 22, isMobileInit ? 1.2 : 2)
  const [currentZoom, setCurrentZoom] = useState(initialZoom)
  const currentZoomRef = useRef(initialZoom)

  // ── Unified search for global arc data (fastest initial data) ──
  const { arcData, cityArcData, isLoadingArcData } = useUnifiedSearch({
    dateFilters: eraToDateFilters(facetedFilters.era, facetedFilters.migrationEra),
  })

  // ── ⌘K shortcut for command palette ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setCommandPaletteOpen(prev => !prev)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  // ── Deep-link: fetch single artifact from URL param to auto-open gallery ──
  // Use ref value so the URL being rewritten (stripping artifactId) doesn't cancel the fetch
  useEffect(() => {
    const artifactId = artifactIdRef.current
    if (!artifactId) return
    let cancelled = false

    fetch(`/api/proxy/object/${encodeURIComponent(artifactId)}`)
      .then(r => r.ok ? r.json() : null)
      .then((data) => {
        if (cancelled || !data?.data) return

        const artifact = data.data as MuseumObject
        const objectCountry = artifact.attributes.country_en || artifact.attributes.country || artifact.attributes.place_name || null
        const objectSite = artifact.attributes.place_name_normalized || artifact.attributes.place_name || null
        const originLat = artifact.attributes.latitude
        const originLng = artifact.attributes.longitude
        const fallbackLat = artifact.attributes.institution_latitude
        const fallbackLng = artifact.attributes.institution_longitude
        const hasOriginCoordinates = hasValidCoordinates(originLat, originLng)
        const hasFallbackCoordinates = hasValidCoordinates(fallbackLat, fallbackLng)
        const targetLat = hasOriginCoordinates ? originLat : (hasFallbackCoordinates ? fallbackLat : null)
        const targetLng = hasOriginCoordinates ? originLng : (hasFallbackCoordinates ? fallbackLng : null)

        setInitialGalleryArtifact(artifact)
        setIsObjectContainerVisible(true)
        setSelectedArc(null)
        setActiveCountry(objectCountry)
        setActiveSite(objectSite)
        setActiveInstitution(null)
        setDrillLevel("objects")
        drillLevelRef.current = "objects"
        setLocationName(objectSite || objectCountry || "")
        setArcObjects([])
        setArcObjectsPage(1)

        if (targetLat !== null && targetLng !== null) {
          setViewState(prev => ({ ...prev, longitude: targetLng, latitude: targetLat, zoom: 14 }))
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, []) // run once on mount — artifactIdRef is stable

  // ── Drill-down state (research page pattern) ──
  const [drillLevel, setDrillLevel] = useState<DrillLevel>(urlCountry ? (urlSite || urlInstitution ? "objects" : "country") : "global")
  const drillLevelRef = useRef(drillLevel)
  // Keep ref in sync with state
  useEffect(() => { drillLevelRef.current = drillLevel }, [drillLevel])
  const [activeCountry, setActiveCountry] = useState<string | null>(urlCountry || null)
  const activeCountryRef = useRef<string | null>(urlCountry || null)
  useEffect(() => { activeCountryRef.current = activeCountry }, [activeCountry])
  const [activeSite, setActiveSite] = useState<string | null>(urlSite || null)
  const activeSiteRef = useRef<string | null>(urlSite || null)
  useEffect(() => { activeSiteRef.current = activeSite }, [activeSite])
  const [activeInstitution, setActiveInstitution] = useState<string | null>(urlInstitution || null)
  // Transient hover-only highlight — mirrors an object card's origin onto the
  // matching map arc without triggering the navigation/fetch side effects of setActiveSite.
  const [hoveredObjectPlace, setHoveredObjectPlace] = useState<string | null>(null)
  const [subArcs, setSubArcs] = useState<SubArc[]>([])
  const [isLoadingSubArcs, setIsLoadingSubArcs] = useState(false)

  // Time/Migration bucket counts for the left panel + ⌘K palette — single
  // owner (was independently fetched by both MapView and CommandPalette,
  // tripling backend load for identical data; see museum-object.js's
  // getDateBucketCounts for the query cost this avoids duplicating).
  // Cross-filtered by the current institution/city/country selection, same
  // behavior as Places/Sites/Collections; drill state (activeCountry/
  // activeSite/activeInstitution) takes precedence over the search-panel
  // facetedFilters arrays, mirroring how Collections is already scoped by
  // activeCountry via aggregateInstitutions.
  const [dateBuckets, setDateBuckets] = useState<DateBucketCounts | null>(null)
  useEffect(() => {
    let cancelled = false
    fetchDateBucketCounts({
      institutions: activeInstitution ? [activeInstitution] : (facetedFilters.institutions.length > 0 ? facetedFilters.institutions : undefined),
      countries: activeCountry ? [activeCountry] : (facetedFilters.countries.length > 0 ? facetedFilters.countries : undefined),
      cities: activeSite ? [activeSite] : (facetedFilters.cities.length > 0 ? facetedFilters.cities : undefined),
    }).then((result) => {
      if (!cancelled) setDateBuckets(result)
    }).catch(() => { /* leave previous counts visible on error */ })
    return () => { cancelled = true }
  }, [
    activeCountry, activeSite, activeInstitution,
    facetedFilters.institutions.join(','), facetedFilters.countries.join(','), facetedFilters.cities.join(','),
  ])

  // Arc drill-down objects (SQL by-country)
  const [arcObjects, setArcObjects] = useState<MuseumObject[]>([])
  const [arcObjectsPage, setArcObjectsPage] = useState(1)
  const [arcObjectsHasMore, setArcObjectsHasMore] = useState(false)
  const [arcObjectsTotal, setArcObjectsTotal] = useState(0)
  const [arcObjectsLoading, setArcObjectsLoading] = useState(false)
  // Shared sequence number for every arcObjects writer (fetchDrillObjects and
  // the global-institution direct fetch in handleToggleInstitution) — rapid
  // filter changes (e.g. picking a Collection then a Time bucket right after)
  // fire overlapping requests, and without this guard a slower, superseded
  // response can land after the correct one and silently overwrite it with
  // stale (or empty) results — the sidebar/aggregate counts (driven by
  // separate endpoints) then disagree with an empty object grid.
  const drillFetchIdRef = useRef(0)

  const handleZoomChange = useCallback((zoom: number) => {
    currentZoomRef.current = zoom
    setCurrentZoom(zoom)
  }, [])

  // Track previous zoom to detect zoom-out vs fly-to
  const prevZoomRef = useRef(initialZoom)

  // Arc cards from map-view
  const [mapArcCards, setMapArcCards] = useState<any[]>([])
  const handleArcCardsChange = useCallback((cards: any[]) => { setMapArcCards(cards) }, [])

  // ── Apply facetedFilters to arcData for sidebar consistency ──
  const filteredArcData = useMemo(() => {
    let data = arcData
    if (facetedFilters.institutions.length > 0) {
      const set = new Set(facetedFilters.institutions.map(s => s.toLowerCase()))
      data = data.filter(a => set.has(a.institution_name.toLowerCase()))
    }
    if (facetedFilters.countries.length > 0) {
      const set = new Set(facetedFilters.countries.map(s => s.toLowerCase()))
      data = data.filter(a => set.has((a.place_name || '').toLowerCase()) || set.has((a.country || '').toLowerCase()))
    }
    return data
  }, [arcData, facetedFilters.institutions, facetedFilters.countries])

  const filteredSubArcs = useMemo(() => {
    let data = subArcs
    if (facetedFilters.institutions.length > 0) {
      const set = new Set(facetedFilters.institutions.map(s => s.toLowerCase()))
      data = data.filter(a => set.has(a.institution_name.toLowerCase()))
    }
    return data
  }, [subArcs, facetedFilters.institutions])

  const filteredGlobalAggregateArcs = useMemo(() => {
    const institutionFilters = new Set(facetedFilters.institutions.map(normalizePlaceKey))
    const countryFilters = new Set(facetedFilters.countries.map(normalizePlaceKey))
    const cityFilters = new Set(facetedFilters.cities.map(normalizePlaceKey))
    const aggregateSource = cityFilters.size > 0 ? cityArcData : arcData

    return aggregateSource.filter((arc) => {
      const matchesInstitution = institutionFilters.size === 0 || matchesAnyFilter(arc.institution_name, institutionFilters)
      const matchesCountry = countryFilters.size === 0 || [
        arc.country,
        arc.place_name,
      ].some((value) => matchesAnyFilter(value, countryFilters))
      const matchesCity = cityFilters.size === 0 || [
        arc.place_name_normalized,
        arc.place_name,
      ].some((value) => matchesAnyFilter(value, cityFilters))

      return matchesInstitution && matchesCountry && matchesCity
    })
  }, [arcData, cityArcData, facetedFilters.institutions, facetedFilters.countries, facetedFilters.cities])

  const allObjects = useMemo<MuseumObject[]>(() => {
    const previewSource = facetedFilters.cities.length > 0 ? cityArcData : arcData

    return previewSource
      .filter((item) => !!item.sample_img_url)
      .map((item, idx) => ({
        id: `preview-${item.cluster_id || idx}`,
        attributes: {
          place_name: item.place_name || item.country || '',
          place_name_normalized: item.place_name_normalized || item.place_name || '',
          city_en: item.place_name || item.country || '',
          country_en: item.country || item.place_name || '',
          latitude: item.latitude ?? 0,
          longitude: item.longitude ?? 0,
          institution_name: item.institution_name || '',
          institution_place: item.institution_place || item.institution_name || '',
          institution_latitude: item.institution_latitude ?? 0,
          institution_longitude: item.institution_longitude ?? 0,
          img_url: item.sample_img_url,
          title: '',
          inventory_number: '',
        } as any,
      }))
  }, [arcData, cityArcData, facetedFilters.cities.length])

  const filteredGlobalPreviewObjects = useMemo(() => {
    const institutionFilters = new Set(facetedFilters.institutions.map(normalizePlaceKey))
    const countryFilters = new Set(facetedFilters.countries.map(normalizePlaceKey))
    const cityFilters = new Set(facetedFilters.cities.map(normalizePlaceKey))

    if (institutionFilters.size === 0 && countryFilters.size === 0 && cityFilters.size === 0) {
      return null
    }

    return allObjects.filter((object) => {
      const attrs = object.attributes
      const matchesInstitution = matchesAnyFilter(attrs.institution_name, institutionFilters)
      const matchesCountry = countryFilters.size === 0 || [
        attrs.country_en,
        attrs.country,
        attrs.place_name,
      ].some((value) => matchesAnyFilter(value, countryFilters))
      const matchesCity = cityFilters.size === 0 || [
        attrs.place_name_normalized,
        attrs.place_name,
        attrs.city_en,
      ].some((value) => matchesAnyFilter(value, cityFilters))

      return matchesInstitution && matchesCountry && matchesCity
    })
  }, [allObjects, facetedFilters.institutions, facetedFilters.countries, facetedFilters.cities])

  // ── Grouped origins from arcData (like research page) ──
  const groupedOrigins = useMemo(() => {
    // When institution is selected at global level (no country), filter places to that institution
    const source = (activeInstitution && !activeCountry)
      ? filteredGlobalAggregateArcs.filter(a => a.institution_name.toLowerCase() === activeInstitution.toLowerCase())
      : filteredGlobalAggregateArcs
    const countryMap = new Map<string, { arcs: ArcData[]; totalCount: number; displayName: string; hasImage: boolean }>()
    source.forEach((arc) => {
      const displayName = (arc.place_name_normalized || arc.place_name || "").trim()
      const countryKey = normalizePlaceKey(displayName)
      if (!countryKey) return
      const existing = countryMap.get(countryKey)
      if (existing) {
        existing.arcs.push(arc)
        existing.totalCount += arc.object_count
        existing.hasImage = existing.hasImage || !!arc.sample_img_url
        if (prefersPlaceLabel(displayName, existing.displayName)) {
          existing.displayName = displayName
        }
      } else {
        countryMap.set(countryKey, {
          arcs: [arc],
          totalCount: arc.object_count,
          displayName,
          hasImage: !!arc.sample_img_url,
        })
      }
    })
    return Array.from(countryMap.entries())
      .filter(([, data]) => data.hasImage)
      .map(([, data]) => ({
        country: data.displayName,
        totalCount: data.totalCount,
        institutions: [...new Set(data.arcs.map((a) => a.institution_name))],
        lat: data.arcs[0].latitude,
        lng: data.arcs[0].longitude,
      }))
      .sort((a, b) => b.totalCount - a.totalCount)
  }, [filteredGlobalAggregateArcs, activeInstitution, activeCountry])

  // ── Country-level arcs for the active country ──
  const countryArcs = useMemo(() => {
    if (!activeCountry) return []
    return filteredArcData
      .filter((a) => a.place_name.toLowerCase() === activeCountry.toLowerCase())
      .sort((a, b) => b.object_count - a.object_count)
  }, [filteredArcData, activeCountry])

  // ── Grouped sites from subArcs (filtered by institution) ──
  const groupedSites = useMemo(() => {
    const source = activeInstitution && filteredSubArcs.length > 0
      ? filteredSubArcs.filter((a) => a.institution_name.toLowerCase() === activeInstitution.toLowerCase())
      : filteredSubArcs
    // Prefer place_name_normalized for display if available
    const map = new Map<string, { totalCount: number; institutions: Set<string>; lat: number; lng: number; displayName: string; rawNames: Set<string>; hasImage: boolean }>()
    source.forEach((arc) => {
      const displayName = (arc.place_name_normalized || arc.place_name || "").trim()
      const placeKey = normalizePlaceKey(displayName)
      if (!placeKey) return
      const existing = map.get(placeKey)
      if (existing) {
        existing.totalCount += arc.object_count
        existing.institutions.add(arc.institution_name)
        existing.rawNames.add(arc.place_name)
        existing.rawNames.add(displayName)
        existing.hasImage = existing.hasImage || !!arc.sample_img_url
        if (prefersPlaceLabel(displayName, existing.displayName)) {
          existing.displayName = displayName
        }
      } else {
        map.set(placeKey, {
          totalCount: arc.object_count,
          institutions: new Set([arc.institution_name]),
          lat: arc.latitude,
          lng: arc.longitude,
          displayName,
          rawNames: new Set([arc.place_name, displayName]),
          hasImage: !!arc.sample_img_url,
        })
      }
    })
    return Array.from(map.entries())
      .filter(([, data]) => data.hasImage)
      .map(([, data]) => ({
        name: data.displayName,
        totalCount: data.totalCount,
        institutions: Array.from(data.institutions),
        lat: data.lat,
        lng: data.lng,
        displayName: data.displayName,
        rawNames: Array.from(data.rawNames),
      }))
      .sort((a, b) => b.totalCount - a.totalCount)
  }, [filteredSubArcs, activeInstitution])

  // ── Institutions for the active country (filtered by site) ──
  const aggregateInstitutions = useMemo(() => {
    if (activeSite && filteredSubArcs.length > 0) {
      const map = new Map<string, number>()
      let source = filteredSubArcs
        .filter((a) => a.place_name.toLowerCase() === activeSite.toLowerCase())

      if (activeInstitution) {
        source = source.filter((a) => a.institution_name.toLowerCase() === activeInstitution.toLowerCase())
      }

      source
        .forEach((a) => { map.set(a.institution_name, (map.get(a.institution_name) || 0) + a.object_count) })
      return Array.from(map.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
    }
    // At global zoom (no active country) aggregate from all arcs
    let source = activeCountry ? countryArcs : filteredGlobalAggregateArcs
    if (activeInstitution) {
      source = source.filter((arc) => arc.institution_name.toLowerCase() === activeInstitution.toLowerCase())
    }
    const map = new Map<string, number>()
    source.forEach((arc) => { map.set(arc.institution_name, (map.get(arc.institution_name) || 0) + arc.object_count) })
    return Array.from(map.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  }, [countryArcs, filteredGlobalAggregateArcs, filteredSubArcs, activeSite, activeCountry, activeInstitution])

  const institutions = useMemo(() => {
    return [...aggregateInstitutions].sort((a, b) => b.count - a.count)
  }, [aggregateInstitutions])

  // ── Sites per country from cityArcData ──
  const sitesByCountry = useMemo(() => {
    const map = new Map<string, Set<string>>()
    cityArcData.forEach((arc: any) => {
      const c = normalizePlaceKey(arc.country)
      const site = (arc.place_name_normalized || arc.place_name || "").trim()
      if (c) {
        if (!map.has(c)) map.set(c, new Set())
        if (site) map.get(c)!.add(site)
      }
    })
    return map
  }, [cityArcData])

  // ── Breadcrumb segments ──
  const breadcrumb = useMemo(() => {
    const segments: { label: string; level: DrillLevel }[] = []
    // Always show "Ex Situ" as root
    segments.push({ label: "Ex Situ", level: "global" })
    if (activeCountry) segments.push({ label: activeCountry, level: "country" })
    // Deduplication: if activeSite === activeCountry, skip site segment
    if (activeSite && activeSite !== activeCountry) segments.push({ label: activeSite, level: "objects" })
    if (activeInstitution && !activeSite) segments.push({ label: activeInstitution, level: "objects" })
    return segments
  }, [activeCountry, activeSite, activeInstitution])

  // ── Sync drill-down state → URL (shallow replace, no scroll) ──
  const isRestoringFromUrl = useRef(!!urlCountry)
  const urlUpdateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Build URL from current state
  const buildUrl = useCallback((country: string | null, site: string | null, institution: string | null, lat: number, lng: number, zoom: number) => {
    const params = new URLSearchParams()
    if (country) params.set("place", country)
    if (site) params.set("site", site)
    if (institution) params.set("institution", institution)
    if (hasValidCoordinates(lat, lng) && (lat !== 20 || lng !== 0 || zoom !== 2)) {
      params.set("lat", lat.toFixed(4))
      params.set("lng", lng.toFixed(4))
      params.set("zoom", zoom.toFixed(1))
    }
    const qs = params.toString()
    return qs ? `${pathname}?${qs}` : pathname
  }, [pathname])

  // Immediate URL update for drill-down changes
  useEffect(() => {
    if (isRestoringFromUrl.current) {
      isRestoringFromUrl.current = false
      return
    }
    const newUrl = buildUrl(activeCountry, activeSite, activeInstitution, viewState.latitude, viewState.longitude, viewState.zoom)
    router.replace(newUrl, { scroll: false })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCountry, activeSite, activeInstitution])

  // Debounced URL update for map position changes
  useEffect(() => {
    if (isRestoringFromUrl.current) return
    if (urlUpdateTimer.current) clearTimeout(urlUpdateTimer.current)
    urlUpdateTimer.current = setTimeout(() => {
      const newUrl = buildUrl(activeCountry, activeSite, activeInstitution, viewState.latitude, viewState.longitude, viewState.zoom)
      router.replace(newUrl, { scroll: false })
    }, 800)
    return () => { if (urlUpdateTimer.current) clearTimeout(urlUpdateTimer.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewState.latitude, viewState.longitude, viewState.zoom])

  // ── Restore drill-down from URL on mount (fly to location) ──
  const hasRestoredRef = useRef(false)
  useEffect(() => {
    if (hasRestoredRef.current) return
    hasRestoredRef.current = true
    if (!urlCountry) return

    // We need arcData to be loaded before we can fly, so schedule a check
    const restoreTimer = setTimeout(() => {
      if (urlLat && urlLng && mapRef.current) {
        const lat = parseFloat(urlLat)
        const lng = parseFloat(urlLng)
        const zoom = urlZoom ? parseFloat(urlZoom) : 5
        if (hasValidCoordinates(lat, lng)) {
          mapRef.current.flyToLocation(lng, lat, zoom, 1400)
          setViewState(prev => ({ ...prev, longitude: lng, latitude: lat, zoom }))
        }
      }
      // Set location name from most specific filter
      setLocationName(urlSite || urlCountry!)
    }, 500)

    return () => clearTimeout(restoreTimer)
  }, [urlCountry, urlSite, urlInstitution, urlLat, urlLng, urlZoom])

  // ── Fetch sub-arcs when country is selected (or the Time/Migration filter changes) ──
  useEffect(() => {
    if (!activeCountry) { setSubArcs([]); return }
    let cancelled = false
    setIsLoadingSubArcs(true)
    fetchSubArcs(activeCountry, eraToDateFilters(facetedFilters.era, facetedFilters.migrationEra)).then((data) => {
      if (!cancelled) { setSubArcs(data); setIsLoadingSubArcs(false) }
    })
    return () => { cancelled = true }
  }, [activeCountry, facetedFilters.era, facetedFilters.migrationEra])

  // ── Fetch objects when drill-down filters change (country or institution level) ──
  const fetchDrillObjects = useCallback(async (page: number, append = false) => {
    if (!activeCountry && !activeInstitution) return
    const requestId = ++drillFetchIdRef.current
    setArcObjectsLoading(true)
    try {
      // Use explicit drill-down institution, or fall back to faceted filter institution
      const effectiveInstitution = activeInstitution || facetedFilters.institutions[0] || undefined
      const result = await fetchObjectsByCountry(
        activeCountry || null, page, 60,
        activeSite || undefined,
        effectiveInstitution,
        false,
        eraToDateFilters(facetedFilters.era, facetedFilters.migrationEra),
      )
      // A newer request (from a filter change that happened while this one was
      // in flight) has already taken over — applying this stale result would
      // clobber the correct, more recent state.
      if (requestId !== drillFetchIdRef.current) return
      if (append) {
        setArcObjects((prev) => {
          const ids = new Set(prev.map(o => o.id))
          return [...prev, ...result.objects.filter(o => !ids.has(o.id))]
        })
      } else {
        setArcObjects(result.objects)
      }
      setArcObjectsTotal(result.pagination?.total || 0)
      setArcObjectsHasMore((result.pagination?.page || 1) < (result.pagination?.pageCount || 1))
      setArcObjectsPage(page)
    } catch (err) {
      console.error("[DrillObjects] fetch failed:", err)
      if (requestId !== drillFetchIdRef.current) return
      // Stop the infinite-scroll loop: if all retries are exhausted mark hasMore
      // as false so the IntersectionObserver stops firing onLoadMore.
      setArcObjectsHasMore(false)
    } finally {
      if (requestId === drillFetchIdRef.current) setArcObjectsLoading(false)
    }
  }, [activeCountry, activeSite, activeInstitution, facetedFilters.institutions, facetedFilters.era?.id, facetedFilters.migrationEra?.id])

  // Trigger object fetch when drill-down filters change
  useEffect(() => {
    if (drillLevel === "country" || drillLevel === "objects") {
      setArcObjects([])
      setArcObjectsPage(1)
      fetchDrillObjects(1)
    }
  }, [activeCountry, activeSite, activeInstitution, facetedFilters.institutions, facetedFilters.era?.id, facetedFilters.migrationEra?.id, fetchDrillObjects, drillLevel])

  const handleDrillLoadMore = useCallback(() => {
    if (!arcObjectsHasMore || arcObjectsLoading) return
    fetchDrillObjects(arcObjectsPage + 1, true)
  }, [arcObjectsHasMore, arcObjectsLoading, arcObjectsPage, fetchDrillObjects])

  // Reverse geocode — always runs to show geocoded name in object panel
  const geocodeAbort = useRef<AbortController | null>(null)
  const debouncedGeocode = useRef(
    debounce(async (lng: number, lat: number) => {
      // Abort any in-flight request to prevent stale responses overwriting
      geocodeAbort.current?.abort()
      const controller = new AbortController()
      geocodeAbort.current = controller
      try {
        const params = new URLSearchParams({ lng: lng.toString(), lat: lat.toString() })
        const res = await fetch(`/api/geocode?${params.toString()}`, { signal: controller.signal })
        const data = await res.json()
        // Use place_name (full: "Bergama, İzmir, Turkey") instead of text ("Bergama")
        setGeocodedName(data?.features?.[0]?.place_name || data?.features?.[0]?.text || "")
      } catch (e: any) {
        if (e?.name === 'AbortError') return // ignore aborted requests
        setGeocodedName("")
      }
    }, 800)
  ).current
  useEffect(() => () => { debouncedGeocode.cancel(); geocodeAbort.current?.abort() }, [debouncedGeocode])

  // ── Drill-down handlers ──
  const handleOriginClick = useCallback((country: string, lat?: number, lng?: number) => {
    // Reopen the object panel only when this is a genuinely new selection —
    // re-clicking the already-active country respects a deliberate close.
    if (normalizePlaceKey(activeCountryRef.current) !== normalizePlaceKey(country)) {
      setIsObjectContainerVisible(true)
    }
    setSelectedArc(null)
    setActiveCountry(country)
    setActiveSite(null)
    setActiveInstitution(null)
    setDrillLevel("country")
    drillLevelRef.current = "country"  // sync ref immediately
    debouncedGeocode.cancel()           // cancel any pending reverse-geocode
    geocodeAbort.current?.abort()        // abort in-flight fetch
    setGeocodedName("")                   // clear stale geocoded name immediately
    drillFetchIdRef.current++ // invalidate any in-flight drill fetch from the previous scope
    setArcObjects([])
    setLocationName(country)
    // Fly to origin
    if (hasValidCoordinates(lat, lng) && mapRef.current) {
      const targetLat = lat as number
      const targetLng = lng as number
      mapRef.current.flyToLocation(targetLng, targetLat, 5, 1600)
      setViewState(prev => ({ ...prev, longitude: targetLng, latitude: targetLat, zoom: 5 }))
      debouncedGeocode(targetLng, targetLat)
    }
  }, [debouncedGeocode])

  const handleToggleSite = useCallback((site: string, lat?: number, lng?: number) => {
    const next = normalizePlaceKey(activeSite) === normalizePlaceKey(site) ? null : site
    // Only a genuinely new site selection reopens the panel — toggling the
    // same site off (next === null) respects a deliberate close.
    if (next) setIsObjectContainerVisible(true)
    setSelectedArc(null)
    setActiveSite(next)
    const nextLevel = next ? "objects" : "country"
    setDrillLevel(nextLevel)
    drillLevelRef.current = nextLevel
    debouncedGeocode.cancel()
    geocodeAbort.current?.abort()
    setGeocodedName("")
    setLocationName(next || activeCountry || "")
    // Clear institution if the site doesn't have it
    if (next && activeInstitution) {
      const siteData = groupedSites.find(s => normalizePlaceKey(s.name) === normalizePlaceKey(next))
      if (siteData && !siteData.institutions.includes(activeInstitution)) {
        setActiveInstitution(null)
      }
    }
    // Fly to site location
    if (next && hasValidCoordinates(lat, lng) && mapRef.current) {
      const targetLat = lat as number
      const targetLng = lng as number
      mapRef.current.flyToLocation(targetLng, targetLat, 10, 1400)
      setViewState(prev => ({ ...prev, longitude: targetLng, latitude: targetLat, zoom: 10 }))
      debouncedGeocode(targetLng, targetLat)
    }
    drillFetchIdRef.current++ // invalidate any in-flight drill fetch from the previous scope
    setArcObjects([])
    setArcObjectsPage(1)
  }, [activeSite, activeInstitution, groupedSites, activeCountry, debouncedGeocode])

  const handleToggleInstitution = useCallback((inst: string) => {
    const next = activeInstitution === inst ? null : inst
    // Only a genuinely new institution selection reopens the panel —
    // toggling the same one off (next === null) respects a deliberate close.
    if (next) setIsObjectContainerVisible(true)
    setSelectedArc(null)
    setActiveInstitution(next)
    drillFetchIdRef.current++ // invalidate any in-flight drill fetch from the previous scope
    setArcObjects([])
    setArcObjectsPage(1)
    debouncedGeocode.cancel()
    geocodeAbort.current?.abort()
    setGeocodedName("")
    // Left-panel institution clicks are single-select and replace whatever was
    // there — mirrors the drill-only activeInstitution toggle above, but also
    // writes into facetedFilters so the arc layer actually filters (same
    // mechanism Time/Migration already use), instead of only updating the
    // object panel like before.
    setFacetedFilters({ ...facetedFilters, institutions: next ? [next] : [] })

    if (!activeCountry) {
      // Global level: fetch institution objects directly with the new value
      // (direct call avoids useEffect timing race where arcObjectsLoading isn't set yet)
      if (next) {
        const requestId = ++drillFetchIdRef.current
        setArcObjectsLoading(true)
        fetchObjectsByCountry(null, 1, 60, undefined, next, false, eraToDateFilters(facetedFilters.era, facetedFilters.migrationEra))
          .then(result => {
            if (requestId !== drillFetchIdRef.current) return
            setArcObjects(result.objects)
            setArcObjectsTotal(result.pagination?.total || 0)
            setArcObjectsHasMore((result.pagination?.page || 1) < (result.pagination?.pageCount || 1))
            setArcObjectsPage(1)
          })
          .catch(err => console.error("[GlobalInstitution] fetch failed:", err))
          .finally(() => { if (requestId === drillFetchIdRef.current) setArcObjectsLoading(false) })
      } else {
        setArcObjectsTotal(0)
        setArcObjectsHasMore(false)
      }
      return
    }

    // Country/site level drill-down (existing behaviour)
    const nextLevel = next ? "objects" : (activeSite ? "objects" : "country")
    setDrillLevel(nextLevel)
    drillLevelRef.current = nextLevel
    setLocationName(activeSite || activeCountry || "")
    // Clear site if institution doesn't have it
    if (next && activeSite) {
      const instSites = subArcs
        .filter((a) => a.institution_name.toLowerCase() === next.toLowerCase())
        .map((a) => a.place_name)
      if (!instSites.includes(activeSite)) {
        setActiveSite(null)
      }
    }
  }, [activeInstitution, activeSite, subArcs, activeCountry, debouncedGeocode, facetedFilters, setFacetedFilters])

  // Faceted filter chips (places/collections/time from the search palette or
  // filter chip UI) — reopen the panel only when a filter is newly added,
  // never when one is removed/cleared (that's the user narrowing or backing out).
  const handleFacetedFiltersChange = useCallback((next: FacetedFilters) => {
    const hasNewValue = (nextValues: string[], prevValues: string[]) => {
      const prevKeys = new Set(prevValues.map(normalizePlaceKey))
      return nextValues.some((v) => !prevKeys.has(normalizePlaceKey(v)))
    }
    const addedFilter =
      hasNewValue(next.countries, facetedFilters.countries) ||
      hasNewValue(next.cities, facetedFilters.cities) ||
      hasNewValue(next.institutions, facetedFilters.institutions) ||
      (!!next.era && next.era.id !== facetedFilters.era?.id) ||
      (!!next.migrationEra && next.migrationEra.id !== facetedFilters.migrationEra?.id)
    if (addedFilter) setIsObjectContainerVisible(true)
    setFacetedFilters(next)
  }, [facetedFilters])

  const handleBreadcrumbClick = useCallback((level: DrillLevel) => {
    if (level === "global") {
      setSelectedArc(null)
      setActiveCountry(null)
      setActiveSite(null)
      setActiveInstitution(null)
      setDrillLevel("global")
      drillLevelRef.current = "global"
      debouncedGeocode.cancel()
      geocodeAbort.current?.abort()
      setGeocodedName("")
      drillFetchIdRef.current++ // invalidate any in-flight drill fetch from the previous scope
      setArcObjects([])
      setArcObjectsTotal(0)
      setArcObjectsHasMore(false)
      setArcObjectsPage(1)
      setSubArcs([])
      setLocationName("")
      // Reset map view to globe level (same as globe icon)
      if (mapRef.current) {
        mapRef.current.flyToLocation(0, 20, 1, 1800)
        setViewState({ longitude: 0, latitude: 20, zoom: 1, name: "" })
        debouncedGeocode(0, 20)
      }
    } else if (level === "country") {
      setSelectedArc(null)
      setActiveSite(null)
      setActiveInstitution(null)
      setDrillLevel("country")
      drillLevelRef.current = "country"
      debouncedGeocode.cancel()
      geocodeAbort.current?.abort()
      setGeocodedName("")
      setLocationName(activeCountry || "")
      drillFetchIdRef.current++ // invalidate any in-flight drill fetch from the previous scope
      setArcObjects([])
      setArcObjectsPage(1)
      // Fly back to country center at zoom 5
      if (activeCountry && mapRef.current) {
        const origin = groupedOrigins.find(o => normalizePlaceKey(o.country) === normalizePlaceKey(activeCountry))
        if (origin) {
          mapRef.current.flyToLocation(origin.lng, origin.lat, 5, 1400)
          setViewState(prev => ({ ...prev, longitude: origin.lng, latitude: origin.lat, zoom: 5 }))
          debouncedGeocode(origin.lng, origin.lat)
        }
      }
    }
  }, [activeCountry, groupedOrigins, debouncedGeocode])

  // ── Command palette navigation handlers ──
  const commandPaletteHandlers: CommandPaletteHandlers = useMemo(() => ({
    onNavigatePlace: (longitude: number, latitude: number, name: string) => {
      setViewState({ longitude, latitude, zoom: 10, name })
      setLocationName(name)
      setGeocodedName("")
      if (mapRef.current) {
        mapRef.current.flyToLocation(longitude, latitude, 10, 1400)
        debouncedGeocode(longitude, latitude)
      }
    },
    onNavigateSite: (country: string, site: string, lat: number, lng: number) => {
      // Reopen only for a genuinely new site — re-selecting the site that's
      // already active respects a deliberate close.
      if (normalizePlaceKey(activeSiteRef.current) !== normalizePlaceKey(site)) {
        setIsObjectContainerVisible(true)
      }
      // Atomic drill-down: set country, site, drill level in one batch
      // so breadcrumb reflects it immediately
      setActiveCountry(country)
      setActiveSite(site)
      setActiveInstitution(null)
      setDrillLevel("objects")
      drillLevelRef.current = "objects"  // prevents any pending reverse-geocode from overwriting
      setLocationName(site || country)
      setGeocodedName("")
      drillFetchIdRef.current++ // invalidate any in-flight drill fetch from the previous scope
      setArcObjects([])
      setArcObjectsPage(1)
      if (mapRef.current && hasValidCoordinates(lat, lng)) {
        mapRef.current.flyToLocation(lng, lat, 10, 1400)
        setViewState(prev => ({ ...prev, longitude: lng, latitude: lat, zoom: 10 }))
        debouncedGeocode(lng, lat)
      }
    },
    onOriginClick: handleOriginClick,
    onToggleSite: handleToggleSite,
    onToggleInstitution: handleToggleInstitution,
  }), [handleOriginClick, handleToggleSite, handleToggleInstitution])

  // Bbox fetch for zoomed-in objects
  const fetchObjects = useCallback(async (bounds: MapBounds, page: number, reset = false) => {
    if (isRateLimited) return
    setIsLoading(true)
    try {
      const { objects, pagination } = await fetchMuseumObjects(bounds, page)
      if (objects && Array.isArray(objects)) {
        setObjects(prev => {
          if (reset || page === 1) return objects
          const existingIds = new Set(prev.map(obj => obj.id))
          return [...prev, ...objects.filter(obj => !existingIds.has(obj.id))]
        })
        setTotalCount(pagination.total); setHasMore(pagination.page < pagination.pageCount); setCurrentPage(pagination.page)
      }
    } catch (err) {
      console.error("Failed to fetch objects:", err)
    } finally {
      setIsLoading(false)
    }
  }, [isRateLimited])

  // The bbox fetch (fetchMuseumObjects → /api/proxy) has no way to carry
  // facetedFilters — it only knows lat/lng bounds. Skip it whenever a filter
  // is active so containerObjects falls back to the already-filtered
  // filteredGlobalPreviewObjects/allObjects, instead of showing unfiltered
  // objects for the current viewport.
  const hasActiveFacetFilters =
    facetedFilters.institutions.length > 0 ||
    facetedFilters.countries.length > 0 ||
    facetedFilters.cities.length > 0 ||
    !!facetedFilters.era ||
    !!facetedFilters.migrationEra

  const handleBoundsChange = useCallback(async (bounds: MapBounds) => {
    if (isRateLimited) return
    setCurrentBounds(bounds)
    const zoom = currentZoomRef.current
    // Only fetch bbox objects when zoomed in, at global level (no country drill-down), and no facet/date filter is active
    if (zoom >= 7 && drillLevelRef.current === "global" && !hasActiveFacetFilters) { await fetchObjects(bounds, 1, true) }
    const centerLng = (bounds.east + bounds.west) / 2
    const centerLat = (bounds.north + bounds.south) / 2
    // Update viewState for URL sync (no flyTo feedback — initialViewState effect is bookkeeping only)
    setViewState(prev => ({ ...prev, longitude: centerLng, latitude: centerLat, zoom }))
    // Always reverse-geocode to keep the header accurate
    debouncedGeocode(centerLng, centerLat)
  }, [fetchObjects, isRateLimited, debouncedGeocode, hasActiveFacetFilters])

  // Clear stale unfiltered bbox objects the instant a filter is applied while
  // zoomed in — otherwise containerObjects keeps showing the last unfiltered
  // viewport fetch until the map pans/zooms again. hasMore must go to false
  // (not true): there is nothing to paginate into while the bbox pipeline is
  // suspended, and leaving it true lets ObjectGrid's auto-load-more
  // IntersectionObserver immediately re-fire handleLoadMore, re-populating
  // `objects`/`totalCount` from the unfiltered bbox endpoint and silently
  // overriding the correct filtered total.
  useEffect(() => {
    if (hasActiveFacetFilters) {
      setObjects([])
      setTotalCount(0)
      setHasMore(false)
      setCurrentPage(1)
    }
  }, [hasActiveFacetFilters])

  const handleLoadMore = useCallback(() => {
    // Bbox pagination has no way to carry facetedFilters — see handleBoundsChange above.
    if (currentBounds && hasMore && !isLoading && !isRateLimited && !hasActiveFacetFilters) {
      fetchObjects(currentBounds, currentPage + 1)
    }
  }, [currentBounds, hasMore, isLoading, currentPage, fetchObjects, isRateLimited, hasActiveFacetFilters])

  const handleLocationFound = useCallback((longitude: number, latitude: number, name: string) => {
    setViewState({ longitude, latitude, zoom: 10, name })
    setLocationName(name)
    setGeocodedName("")
  }, [])

  // ── Arc selection from header panel → triggers drill-down to site level ──
  const handleSelectArc = useCallback((arc: SelectedArc | null) => {
    setSelectedArc(arc)
    if (arc) {
      const country = arc.fromCountry || activeCountryRef.current || arc.from
      const site = arc.from && normalizePlaceKey(arc.from) !== normalizePlaceKey(country)
        ? arc.from
        : null
      // arc.to is the institution the arc points to — filter objects to it
      const institution = arc.to || null
      setActiveCountry(country)
      setActiveSite(site)
      setActiveInstitution(institution)
      setDrillLevel(site ? "objects" : "country")
      drillLevelRef.current = site ? "objects" : "country"  // sync ref immediately to prevent stale closure geocode
      debouncedGeocode.cancel()           // cancel any pending reverse-geocode
      geocodeAbort.current?.abort()        // abort in-flight fetch
      setGeocodedName("")                   // clear stale geocoded name immediately
      setIsObjectContainerVisible(true)
      setLocationName(site || country)
      // Note: do NOT call flyToLocation here — the arc onClick handler
      // in map-view.tsx already runs animateToZoomLevel for a smooth
      // single animation. Calling flyTo + setViewState here caused a
      // competing double-animation ("zoom then jump" bug).
    } else {
      // Deselect → go back to global
      setActiveCountry(null)
      setActiveSite(null)
      setActiveInstitution(null)
      setDrillLevel("global")
      drillFetchIdRef.current++ // invalidate any in-flight drill fetch from the previous scope
      setArcObjects([])
      setGeocodedName("")
    }
  }, [])

  const handleObjectClick = useCallback((longitude: number, latitude: number, object?: MuseumObject) => {
    const drill = drillLevelRef.current

    if (drill === "global") {
      const objectCountry = object?.attributes.country_en || object?.attributes.country || object?.attributes.place_name || null
      if (objectCountry) {
        const origin = groupedOrigins.find(o => normalizePlaceKey(o.country) === normalizePlaceKey(objectCountry))
        handleOriginClick(
          objectCountry,
          origin?.lat ?? latitude,
          origin?.lng ?? longitude,
        )
        // Preview cards are aggregated per country+institution — an unfiltered
        // country fetch only returns its first page in arbitrary order and may
        // never include the specific object the sample image came from.
        // Narrowing to the institution makes the drilled-down list small enough
        // to actually contain it.
        if (object?.attributes.institution_name) {
          setActiveInstitution(object.attributes.institution_name)
        }
        return
      }

      if (!mapRef.current) return
      if (!hasValidCoordinates(latitude, longitude)) return
      const fallbackZoom = Math.min(Math.max(currentZoomRef.current, 5), 6)
      mapRef.current.flyToLocation(longitude, latitude, fallbackZoom, 1200)
      setViewState(prev => ({ ...prev, longitude, latitude, zoom: fallbackZoom }))
      debouncedGeocode(longitude, latitude)
      return
    }

    if (object) {
      const objectCountry = object.attributes.country_en || object.attributes.country || object.attributes.place_name || null
      const objectSite = object.attributes.place_name_normalized || object.attributes.place_name || null
      const objectInstitution = object.attributes.institution_name || null
      const objectLat = object.attributes.latitude
      const objectLng = object.attributes.longitude
      const fallbackLat = hasValidCoordinates(latitude, longitude) ? latitude : null
      const fallbackLng = hasValidCoordinates(latitude, longitude) ? longitude : null
      const targetLat = hasValidCoordinates(objectLat, objectLng) ? objectLat : fallbackLat
      const targetLng = hasValidCoordinates(objectLat, objectLng) ? objectLng : fallbackLng

      if (objectSite && objectInstitution) {
        setSelectedArc({
          key: `${objectSite}-${objectInstitution}`,
          from: objectSite,
          to: objectInstitution,
          fromLat: targetLat ?? viewState.latitude,
          fromLng: targetLng ?? viewState.longitude,
          toLat: object.attributes.institution_latitude,
          toLng: object.attributes.institution_longitude,
          fromCity: object.attributes.city_en,
          fromCountry: objectCountry || undefined,
          toCity: object.attributes.institution_city_en,
          toCountry: object.attributes.institution_country_en,
        })
      }

      // Only (re-)drill from the clicked object's own place attributes when
      // we're navigating INTO a site for the first time (country-level view,
      // no site chosen yet). Once already at site/object level, activeSite is
      // the source of truth for the current drill — overwriting it here with
      // objectSite (place_name_normalized || place_name) is unreliable, since
      // that can differ from the city_en value the drill itself is keyed on
      // (e.g. "Northwest (Mongolia)" vs "Mongolei" for the same place), which
      // would silently swap the whole grid/Time/Collections to a near-empty,
      // barely-matching filter just from opening an object's detail view.
      if (objectCountry && objectSite && drill !== "objects") {
        setActiveCountry(objectCountry)
        setActiveSite(objectSite)
        setActiveInstitution(null)
        setDrillLevel("objects")
        drillLevelRef.current = "objects"
        setLocationName(objectSite)
      }
    }

    if (!mapRef.current) return
  if (!hasValidCoordinates(latitude, longitude)) return

    // ── Step 2: Country level → fly to object detail ──
    mapRef.current.flyToLocation(longitude, latitude, 14, 1200)
    setViewState(prev => ({ ...prev, longitude, latitude, zoom: 14 }))
    debouncedGeocode(longitude, latitude)
  }, [groupedOrigins, handleOriginClick, debouncedGeocode])

  const handleStatsItemClick = useCallback((type: "country" | "city" | "institution", name: string, centroid?: { lat: number; lng: number }) => {
    if (centroid && mapRef.current) {
      const targetZoom = type === "country" ? 6 : type === "city" ? 10 : 12
      mapRef.current.flyToLocation(centroid.lng, centroid.lat, targetZoom, 1400)
      setViewState(prev => ({ ...prev, longitude: centroid.lng, latitude: centroid.lat, zoom: targetZoom }))
      debouncedGeocode(centroid.lng, centroid.lat)
      if (type === "country") {
        setActiveCountry(name)
        setActiveSite(null)
        setActiveInstitution(null)
        setDrillLevel("country")
        drillLevelRef.current = "country"
      }
      setLocationName(name)
      setGeocodedName("")
      debouncedGeocode.cancel()
      geocodeAbort.current?.abort()
    }
  }, [debouncedGeocode])

  // Auto-clear drill-down when user zooms out to global (not during fly-to)
  // Guard: skip during initial restore period (first 3s after mount with URL params)
  const mountTimeRef = useRef(Date.now())
  useEffect(() => {
    const wasAbove = prevZoomRef.current >= 3
    prevZoomRef.current = currentZoom
    // Skip auto-clear during initial restore (map may animate through low zoom levels)
    if (urlCountry && Date.now() - mountTimeRef.current < 3000) return
    if (currentZoom < 3 && wasAbove && drillLevel !== "global") {
      setActiveCountry(null)
      setActiveSite(null)
      setActiveInstitution(null)
      setDrillLevel("global")
      drillLevelRef.current = "global"
      setSelectedArc(null)
      drillFetchIdRef.current++ // invalidate any in-flight drill fetch from the previous scope
      setArcObjects([])
      setLocationName("")
      setGeocodedName("")
    }
  }, [currentZoom, drillLevel, urlCountry])

  // Handle wikipedia documents from map view
  const handleWikiDocumentsChange = useCallback((docs: any[]) => {
    setWikiDocs(docs)
  }, [])

  // Convert wiki docs to MuseumObject-compatible cards for the object grid
  const wikiObjects: MuseumObject[] = useMemo(() => {
    return wikiDocs.map((d: any, i: number) => ({
      id: `wiki-${d.id || d.cluster_id || i}`,
      attributes: {
        title: d.title || d.sample_title || 'Wikipedia Article',
        img_url: d.img_url || d.sample_img_url || undefined,
        longitude: d.longitude || 0,
        latitude: d.latitude || 0,
        inventory_number: '',
        institution_name: 'Wikipedia',
        institution_longitude: 0,
        institution_latitude: 0,
        place_name: d.title || d.sample_title || '',
        source_link: d.source_url || undefined,
        country_en: d.source_name || 'Wikipedia',
      }
    } as MuseumObject))
  }, [wikiDocs])

  // Container objects — drill-down objects, bbox objects, or global preview (allObjects)
  // When Wikipedia is selected, append wiki docs so they appear in the grid
  const isWikipediaActive = false // Wikipedia feature disabled — see ENABLE_WIKIPEDIA in faceted-filter.tsx
  // Derived flag: institution selected at global level (no country) needs arcObjects too
  const isGlobalInstitutionDrill = drillLevel === "global" && !!activeInstitution && !activeCountry
  const containerObjects = useMemo(() => {
    const useDrillObjects = drillLevel !== "global" || isGlobalInstitutionDrill
    let base = useDrillObjects
      ? arcObjects
      : (objects.length > 0 ? objects : (filteredGlobalPreviewObjects || allObjects))
    // At globe level with no institution filter, hide items without images
    if (drillLevel === "global" && !isGlobalInstitutionDrill && objects.length === 0) {
      base = base.filter(o => !!o.attributes?.img_url)
    }
    let combined = isWikipediaActive && wikiObjects.length > 0 ? [...base, ...wikiObjects] : base
    // Deduplicate by id to prevent the same object appearing twice in the gallery
    const seen = new Set<string | number>()
    combined = combined.filter(o => {
      if (seen.has(o.id)) return false
      seen.add(o.id)
      return true
    })
    return combined
  }, [drillLevel, isGlobalInstitutionDrill, arcObjects, objects, filteredGlobalPreviewObjects, allObjects, isWikipediaActive, wikiObjects])

  // Effective location name: derived from drill state, with manual fallback
  // This ensures the object panel header ALWAYS reflects the current drill-down
  // without needing setLocationName() in every single handler.
  const effectiveLocationName = activeSite || activeCountry || locationName || ''

  // Global-level stats: arc count and unique collection count
  const globalArcCount = filteredGlobalAggregateArcs.length
  const globalCollectionCount = useMemo(() => new Set(filteredGlobalAggregateArcs.map(a => a.institution_name)).size, [filteredGlobalAggregateArcs])
  const globalTotalCount = useMemo(
    () => filteredGlobalAggregateArcs.reduce((sum, arc) => sum + (arc.object_count || 0), 0),
    [filteredGlobalAggregateArcs],
  )

  const mapTotalCount = drillLevel === "global" && objects.length === 0 ? globalTotalCount : totalCount

  // Container total count — aggregate data is the single source of truth for all counts
  const containerTotalCount = useMemo(() => {
    const wikiCount = isWikipediaActive ? wikiObjects.length : 0
    if (drillLevel !== "global" || isGlobalInstitutionDrill) {
      const aggregateTotal = aggregateInstitutions.reduce((sum, i) => sum + i.count, 0)
      return (aggregateTotal > 0 ? aggregateTotal : arcObjectsTotal) + wikiCount
    }
    return mapTotalCount + wikiCount
  }, [drillLevel, isGlobalInstitutionDrill, aggregateInstitutions, arcObjectsTotal, mapTotalCount, isWikipediaActive, wikiObjects.length])

  const handleMapError = useCallback((error: string) => {
    console.error("Map error:", error)
    toast({ title: "Map Error", description: "There was an error loading the map.", variant: "destructive" })
  }, [])

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-white">
        <div className="text-center">
          <div className="text-red-500 mb-2">{error}</div>
          <button onClick={() => window.location.reload()} className="text-gray-400 hover:text-gray-600">retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="h-full w-full relative">
        <MapView
          ref={mapRef}
          initialViewState={{ ...viewState, name: locationName }}
          initialLongitude={viewState.longitude}
          initialLatitude={viewState.latitude}
          initialZoom={viewState.zoom}
          onBoundsChange={handleBoundsChange}
          objects={objects}
          allObjects={allObjects}
          onError={handleMapError}
          totalCount={containerTotalCount}
          onToggleView={() => setViewMode(prev => prev === "grid" ? "list" : "grid")}
          onExpandView={() => setContainerSize(prev => prev === "default" ? "expanded" : "default")}
          viewMode={viewMode}
          containerSize={containerSize}
          locationName={drillLevel === "country" ? (activeCountry || locationName) : locationName}
          onCommandPaletteOpen={() => setCommandPaletteOpen(true)}
          isObjectContainerVisible={isObjectContainerVisible}
          setObjects={setObjects}
          setTotalCount={setTotalCount}
          facetedFilters={facetedFilters}
          onFacetedFiltersChange={handleFacetedFiltersChange}
          selectedArc={selectedArc}
          onSelectArc={handleSelectArc}
          onZoomChange={handleZoomChange}
          onArcCardsChange={handleArcCardsChange}
          onStatsItemClick={handleStatsItemClick}
          onWikiDocumentsChange={handleWikiDocumentsChange}
          // Drill-down props for header
          drillLevel={drillLevel}
          breadcrumb={breadcrumb}
          onBreadcrumbClick={handleBreadcrumbClick}
          groupedOrigins={groupedOrigins}
          sitesByCountry={sitesByCountry}
          isLoadingOrigins={isLoadingArcData}
          onOriginClick={handleOriginClick}
          groupedSites={groupedSites}
          drillInstitutions={institutions}
          activeCountry={activeCountry}
          activeSite={activeSite}
          activeInstitution={activeInstitution}
          onToggleSite={handleToggleSite}
          onToggleInstitution={handleToggleInstitution}
          isLoadingSubArcs={isLoadingSubArcs}
          drillArcs={filteredSubArcs}
          hoveredObjectPlace={hoveredObjectPlace}
          dateBuckets={dateBuckets}
        />

        {/* Floating object container — images only (+ header on mobile) */}
        {isObjectContainerVisible && (
          <ObjectPanel
            objects={containerObjects}
            onLoadMore={isGlobalInstitutionDrill || drillLevel !== "global" ? handleDrillLoadMore : handleLoadMore}
            hasMore={isGlobalInstitutionDrill || drillLevel !== "global" ? arcObjectsHasMore : hasMore}
            totalCount={containerTotalCount}
            isLoading={
              isGlobalInstitutionDrill || drillLevel !== "global"
                ? arcObjectsLoading
                // At global level, `isLoading` only tracks the zoomed-in bbox fetch — it stays
                // false while the initial arc/global-preview data (arcData) is still loading, which
                // otherwise flashes "0 artifacts" / "No artifacts found" before the first real
                // response lands. Fold in isLoadingArcData until there's something to show.
                : isLoading || (isLoadingArcData && containerObjects.length === 0)
            }
            onObjectClick={handleObjectClick}
            onObjectHover={setHoveredObjectPlace}
            isMobile={isMobile}
            viewMode={viewMode}
            setViewMode={setViewMode}
            containerSize={containerSize}
            setContainerSize={setContainerSize}
            // Drill-down props (used on mobile)
            drillLevel={drillLevel}
            breadcrumb={breadcrumb}
            onBreadcrumbClick={handleBreadcrumbClick}
            groupedOrigins={groupedOrigins}
            sitesByCountry={sitesByCountry}
            isLoadingOrigins={isLoadingArcData}
            onOriginClick={handleOriginClick}
            groupedSites={groupedSites}
            drillInstitutions={institutions}
            activeSite={activeSite}
            activeCountry={activeCountry}
            activeInstitution={activeInstitution}
            onToggleSite={handleToggleSite}
            onToggleInstitution={handleToggleInstitution}
            isLoadingSubArcs={isLoadingSubArcs}
            locationName={effectiveLocationName}
            geocodedName={geocodedName}
            arcCount={globalArcCount}
            collectionCount={globalCollectionCount}
            allObjects={allObjects}
            facetedFilters={facetedFilters}
            onFacetedFiltersChange={handleFacetedFiltersChange}
            onCommandPaletteOpen={() => setCommandPaletteOpen(true)}
            dateBuckets={dateBuckets}
            linkObjects={[]}
            initialGalleryArtifact={initialGalleryArtifact}
            onCloseContainer={() => setIsObjectContainerVisible(false)}
          />
        )}

        {/* Command Palette (⌘K) */}
        <CommandPalette
          open={commandPaletteOpen}
          onOpenChange={setCommandPaletteOpen}
          handlers={commandPaletteHandlers}
          facetedFilters={facetedFilters}
          onFacetedFiltersChange={handleFacetedFiltersChange}
          dateBuckets={dateBuckets}
        />

        {/* Rate limit warning */}
        {isRateLimited && (
          <div className="absolute top-16 right-4 z-[70] bg-red-500 text-white p-3 rounded-md shadow-lg">
            <div className="flex items-center">
              <AlertTriangle className="h-5 w-5 mr-2" />
              <span className="text-sm">API rate limited</span>
            </div>
            <Button size="sm" variant="outline" className="mt-2 w-full bg-white/20 hover:bg-white/30 text-white"
              onClick={() => window.location.reload()}>
              Retry
            </Button>
          </div>
        )}
      </div>
      <Toaster />
    </div>
  )
}

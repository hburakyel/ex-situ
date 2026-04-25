"use client"

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import MapView, { type FacetedFilters } from "@/components/map/map-view"
import ObjectPanel, { type ContainerSize } from "@/components/map/object-panel"
import { fetchMuseumObjects, fetchGeospatialData, fetchObjectsByCountry } from "@/lib/api"
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
  institution_name: string
  object_count: number
  latitude: number
  longitude: number
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

export default function MapPage() {
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

  // Clamp and validate URL parameters to prevent NaN / extreme values
  const clamp = (val: number, min: number, max: number, fallback: number) =>
    Number.isFinite(val) ? Math.min(Math.max(val, min), max) : fallback

  const [objects, setObjects] = useState<MuseumObject[]>([])
  const [allObjects, setAllObjects] = useState<MuseumObject[]>([])
  const [viewState, setViewState] = useState({
    longitude: clamp(urlLng ? parseFloat(urlLng) : 0, -180, 180, 0),
    latitude: clamp(urlLat ? parseFloat(urlLat) : 20, -90, 90, 20),
    zoom: clamp(urlZoom ? parseFloat(urlZoom) : 2, 0, 22, 2),
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
  const [initialLoadComplete, setInitialLoadComplete] = useState(false)
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [containerSize, setContainerSize] = useState<ContainerSize>("default")
  const [isObjectContainerVisible, setIsObjectContainerVisible] = useState(true)
  const [facetedFilters, setFacetedFilters] = useState<FacetedFilters>({ institutions: [], countries: [], cities: [] })
  const [selectedArc, setSelectedArc] = useState<SelectedArc | null>(null)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [wikiDocs, setWikiDocs] = useState<any[]>([])
  const initialZoom = clamp(urlZoom ? parseFloat(urlZoom) : 2, 0, 22, 2)
  const [currentZoom, setCurrentZoom] = useState(initialZoom)
  const currentZoomRef = useRef(initialZoom)

  // ── Unified search for global arc data (fastest initial data) ──
  const { arcData, cityArcData, isLoadingArcData } = useUnifiedSearch()

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

  // ── Drill-down state (research page pattern) ──
  const [drillLevel, setDrillLevel] = useState<DrillLevel>(urlCountry ? (urlSite || urlInstitution ? "objects" : "country") : "global")
  const drillLevelRef = useRef(drillLevel)
  // Keep ref in sync with state
  useEffect(() => { drillLevelRef.current = drillLevel }, [drillLevel])
  const [activeCountry, setActiveCountry] = useState<string | null>(urlCountry || null)
  const [activeSite, setActiveSite] = useState<string | null>(urlSite || null)
  const [activeInstitution, setActiveInstitution] = useState<string | null>(urlInstitution || null)
  const [subArcs, setSubArcs] = useState<SubArc[]>([])
  const [isLoadingSubArcs, setIsLoadingSubArcs] = useState(false)

  // Arc drill-down objects (SQL by-country)
  const [arcObjects, setArcObjects] = useState<MuseumObject[]>([])
  const [arcObjectsPage, setArcObjectsPage] = useState(1)
  const [arcObjectsHasMore, setArcObjectsHasMore] = useState(false)
  const [arcObjectsTotal, setArcObjectsTotal] = useState(0)
  const [arcObjectsLoading, setArcObjectsLoading] = useState(false)

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

  // ── Grouped origins from arcData (like research page) ──
  const groupedOrigins = useMemo(() => {
    const countryMap = new Map<string, { arcs: ArcData[]; totalCount: number }>()
    filteredArcData.forEach((arc) => {
      const country = arc.place_name
      const existing = countryMap.get(country)
      if (existing) {
        existing.arcs.push(arc)
        existing.totalCount += arc.object_count
      } else {
        countryMap.set(country, { arcs: [arc], totalCount: arc.object_count })
      }
    })
    return Array.from(countryMap.entries())
      .map(([country, data]) => ({
        country,
        totalCount: data.totalCount,
        institutions: [...new Set(data.arcs.map((a) => a.institution_name))],
        lat: data.arcs[0].latitude,
        lng: data.arcs[0].longitude,
      }))
      .sort((a, b) => b.totalCount - a.totalCount)
  }, [filteredArcData])

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
    const map = new Map<string, { totalCount: number; institutions: Set<string>; lat: number; lng: number; displayName: string }>()
    source.forEach((arc) => {
      const displayName = arc.place_name_normalized || arc.place_name
      const existing = map.get(arc.place_name)
      if (existing) {
        existing.totalCount += arc.object_count
        existing.institutions.add(arc.institution_name)
      } else {
        map.set(arc.place_name, {
          totalCount: arc.object_count,
          institutions: new Set([arc.institution_name]),
          lat: arc.latitude,
          lng: arc.longitude,
          displayName,
        })
      }
    })
    return Array.from(map.entries())
      .map(([name, data]) => ({
        name,
        totalCount: data.totalCount,
        institutions: Array.from(data.institutions),
        lat: data.lat,
        lng: data.lng,
        displayName: data.displayName,
      }))
      .sort((a, b) => b.totalCount - a.totalCount)
  }, [filteredSubArcs, activeInstitution])

  // ── Institutions for the active country (filtered by site) ──
  const institutions = useMemo(() => {
    if (activeSite && filteredSubArcs.length > 0) {
      const map = new Map<string, number>()
      filteredSubArcs
        .filter((a) => a.place_name.toLowerCase() === activeSite.toLowerCase())
        .forEach((a) => { map.set(a.institution_name, (map.get(a.institution_name) || 0) + a.object_count) })
      return Array.from(map.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
    }
    const map = new Map<string, number>()
    countryArcs.forEach((arc) => { map.set(arc.institution_name, (map.get(arc.institution_name) || 0) + arc.object_count) })
    return Array.from(map.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  }, [countryArcs, filteredSubArcs, activeSite])

  // ── Sites per country from cityArcData ──
  const sitesByCountry = useMemo(() => {
    const map = new Map<string, Set<string>>()
    cityArcData.forEach((arc: any) => {
      const c = arc.country
      if (c) {
        if (!map.has(c)) map.set(c, new Set())
        map.get(c)!.add(arc.place_name)
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
    if (lat !== 20 || lng !== 0 || zoom !== 2) {
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
        mapRef.current.flyToLocation(lng, lat, zoom, 1400)
        setViewState(prev => ({ ...prev, longitude: lng, latitude: lat, zoom }))
      }
      // Set location name from most specific filter
      setLocationName(urlSite || urlCountry!)
    }, 500)

    return () => clearTimeout(restoreTimer)
  }, [urlCountry, urlSite, urlInstitution, urlLat, urlLng, urlZoom])

  // Fetch initial geospatial data
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        setIsLoading(true)
        const geoData = await fetchGeospatialData(2) as any
        const mapped: MuseumObject[] = (geoData.data || []).map((item: any, idx: number) => ({
          id: String(-(idx + 1)) as any,
          attributes: {
            place_name: item.place_name || item.origin_country || '',
            city_en: item.city_en || item.origin_country || '',
            country_en: item.country_en || item.origin_country || '',
            latitude: item.latitude ?? item.origin_lat ?? 0,
            longitude: item.longitude ?? item.origin_lon ?? 0,
            institution_name: item.institution_name || '',
            institution_place: item.institution_name || '',
            institution_latitude: item.institution_latitude ?? item.inst_lat ?? 0,
            institution_longitude: item.institution_longitude ?? item.inst_lon ?? 0,
            img_url: item.img_url || item.sample_img_url || null,
            title: '', inventory_number: '',
          } as any,
        }))
        setAllObjects(mapped)
        const total = (geoData.data || []).reduce((s: number, d: any) => s + (d.object_count || d.total_objects || 0), 0)
        setTotalCount(total)
        setInitialLoadComplete(true)
      } catch (err) {
        console.error("Failed to fetch initial data:", err)
      } finally {
        setIsLoading(false)
      }
    }
    fetchInitialData()
  }, [])

  // ── Fetch sub-arcs when country is selected ──
  useEffect(() => {
    if (!activeCountry) { setSubArcs([]); return }
    let cancelled = false
    setIsLoadingSubArcs(true)
    fetchSubArcs(activeCountry).then((data) => {
      if (!cancelled) { setSubArcs(data); setIsLoadingSubArcs(false) }
    })
    return () => { cancelled = true }
  }, [activeCountry])

  // ── Fetch objects when drill-down filters change (country level) ──
  const fetchDrillObjects = useCallback(async (page: number, append = false) => {
    if (!activeCountry) return
    setArcObjectsLoading(true)
    try {
      // Use explicit drill-down institution, or fall back to faceted filter institution
      const effectiveInstitution = activeInstitution || facetedFilters.institutions[0] || undefined
      const result = await fetchObjectsByCountry(
        activeCountry, page, 60,
        activeSite || undefined,
        effectiveInstitution,
      )
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
    } finally {
      setArcObjectsLoading(false)
    }
  }, [activeCountry, activeSite, activeInstitution, facetedFilters.institutions])

  // Trigger object fetch when drill-down filters change
  useEffect(() => {
    if (drillLevel === "country" || drillLevel === "objects") {
      setArcObjects([])
      setArcObjectsPage(1)
      fetchDrillObjects(1)
    }
  }, [activeCountry, activeSite, activeInstitution, facetedFilters.institutions, fetchDrillObjects, drillLevel])

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
    setActiveCountry(country)
    setActiveSite(null)
    setActiveInstitution(null)
    setDrillLevel("country")
    drillLevelRef.current = "country"  // sync ref immediately
    debouncedGeocode.cancel()           // cancel any pending reverse-geocode
    geocodeAbort.current?.abort()        // abort in-flight fetch
    setGeocodedName("")                   // clear stale geocoded name immediately
    setArcObjects([])
    setLocationName(country)
    // Fly to origin
    if (lat != null && lng != null && mapRef.current) {
      mapRef.current.flyToLocation(lng, lat, 5, 1600)
      setViewState(prev => ({ ...prev, longitude: lng, latitude: lat, zoom: 5 }))
      debouncedGeocode(lng, lat)
    }
  }, [debouncedGeocode])

  const handleToggleSite = useCallback((site: string, lat?: number, lng?: number) => {
    const next = activeSite === site ? null : site
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
      const siteData = groupedSites.find(s => s.name === next)
      if (siteData && !siteData.institutions.includes(activeInstitution)) {
        setActiveInstitution(null)
      }
    }
    // Fly to site location
    if (next && lat != null && lng != null && mapRef.current) {
      mapRef.current.flyToLocation(lng, lat, 10, 1400)
      setViewState(prev => ({ ...prev, longitude: lng, latitude: lat, zoom: 10 }))
      debouncedGeocode(lng, lat)
    }
    setArcObjects([])
    setArcObjectsPage(1)
  }, [activeSite, activeInstitution, groupedSites, activeCountry, debouncedGeocode])

  const handleToggleInstitution = useCallback((inst: string) => {
    const next = activeInstitution === inst ? null : inst
    setActiveInstitution(next)
    const nextLevel = next ? "objects" : (activeSite ? "objects" : "country")
    setDrillLevel(nextLevel)
    drillLevelRef.current = nextLevel
    debouncedGeocode.cancel()
    geocodeAbort.current?.abort()
    setGeocodedName("")
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
    setArcObjects([])
    setArcObjectsPage(1)
  }, [activeInstitution, activeSite, subArcs, activeCountry, debouncedGeocode])

  const handleBreadcrumbClick = useCallback((level: DrillLevel) => {
    if (level === "global") {
      setActiveCountry(null)
      setActiveSite(null)
      setActiveInstitution(null)
      setDrillLevel("global")
      drillLevelRef.current = "global"
      debouncedGeocode.cancel()
      geocodeAbort.current?.abort()
      setGeocodedName("")
      setArcObjects([])
      setSubArcs([])
      setLocationName("")
      // Reset map view to globe level (same as globe icon)
      if (mapRef.current) {
        mapRef.current.flyToLocation(0, 20, 1, 1800)
        setViewState({ longitude: 0, latitude: 20, zoom: 1, name: "" })
        debouncedGeocode(0, 20)
      }
    } else if (level === "country") {
      setActiveSite(null)
      setActiveInstitution(null)
      setDrillLevel("country")
      drillLevelRef.current = "country"
      debouncedGeocode.cancel()
      geocodeAbort.current?.abort()
      setGeocodedName("")
      setLocationName(activeCountry || "")
      setArcObjects([])
      setArcObjectsPage(1)
      // Fly back to country center at zoom 5
      if (activeCountry && mapRef.current) {
        const origin = groupedOrigins.find(o => o.country === activeCountry)
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
      // Atomic drill-down: set country, site, drill level in one batch
      // so breadcrumb reflects it immediately
      setActiveCountry(country)
      setActiveSite(site)
      setActiveInstitution(null)
      setDrillLevel("objects")
      drillLevelRef.current = "objects"  // prevents any pending reverse-geocode from overwriting
      setLocationName(site || country)
      setGeocodedName("")
      setArcObjects([])
      setArcObjectsPage(1)
      if (mapRef.current) {
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

  const handleBoundsChange = useCallback(async (bounds: MapBounds) => {
    if (isRateLimited) return
    setCurrentBounds(bounds)
    const zoom = currentZoomRef.current
    // Only fetch bbox objects when zoomed in AND we're at global level (no country drill-down)
    if (zoom >= 7 && drillLevelRef.current === "global") { await fetchObjects(bounds, 1, true) }
    const centerLng = (bounds.east + bounds.west) / 2
    const centerLat = (bounds.north + bounds.south) / 2
    // Update viewState for URL sync (no flyTo feedback — initialViewState effect is bookkeeping only)
    setViewState(prev => ({ ...prev, longitude: centerLng, latitude: centerLat, zoom }))
    // Always reverse-geocode to keep the header accurate
    debouncedGeocode(centerLng, centerLat)
  }, [fetchObjects, isRateLimited, debouncedGeocode])

  const handleLoadMore = useCallback(() => {
    if (currentBounds && hasMore && !isLoading && !isRateLimited) {
      fetchObjects(currentBounds, currentPage + 1)
    }
  }, [currentBounds, hasMore, isLoading, currentPage, fetchObjects, isRateLimited])

  const handleLocationFound = useCallback((longitude: number, latitude: number, name: string) => {
    setViewState({ longitude, latitude, zoom: 10, name })
    setLocationName(name)
    setGeocodedName("")
  }, [])

  // ── Arc selection from header panel → triggers drill-down to site level ──
  const handleSelectArc = useCallback((arc: SelectedArc | null) => {
    setSelectedArc(arc)
    if (arc) {
      // Determine country and site from arc
      const country = arc.fromCountry || arc.from
      const site = arc.from && arc.from !== country ? arc.from : null
      setActiveCountry(country)
      setActiveSite(site)
      setActiveInstitution(null)
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
      setArcObjects([])
      setGeocodedName("")
    }
  }, [])

  const handleObjectClick = useCallback((longitude: number, latitude: number) => {
    if (!mapRef.current) return
    const drill = drillLevelRef.current
    const zoom = currentZoomRef.current

    // ── Step 1: Global → drill into the object's country ──
    if (drill === "global") {
      // Try to resolve country from allObjects (aggregated data at global level)
      const match = allObjects.find(
        o =>
          Math.abs((o.attributes?.longitude ?? 0) - longitude) < 0.01 &&
          Math.abs((o.attributes?.latitude ?? 0) - latitude) < 0.01
      )
      const country = match?.attributes?.place_name || match?.attributes?.country_en
      if (country) {
        handleOriginClick(country, latitude, longitude)
        return
      }
      // Fallback: if no country match (e.g. bbox objects at zoom 7+), just fly closer
      mapRef.current.flyToLocation(longitude, latitude, Math.max(zoom, 8), 1200)
      setViewState(prev => ({ ...prev, longitude, latitude, zoom: Math.max(zoom, 8) }))
      debouncedGeocode(longitude, latitude)
      return
    }

    // ── Step 2: Country level → fly to object detail ──
    mapRef.current.flyToLocation(longitude, latitude, 14, 1200)
    setViewState(prev => ({ ...prev, longitude, latitude, zoom: 14 }))
    debouncedGeocode(longitude, latitude)
  }, [allObjects, handleOriginClick, debouncedGeocode])

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
  const containerObjects = useMemo(() => {
    let base = drillLevel !== "global" ? arcObjects : (objects.length > 0 ? objects : allObjects)
    // At globe level the items are aggregates with often-missing images;
    // filter to only show items that actually have an image so the grid
    // isn't filled with empty cards.
    if (drillLevel === "global" && objects.length === 0) {
      base = base.filter(o => !!o.attributes?.img_url)
    }
    if (isWikipediaActive && wikiObjects.length > 0) {
      return [...base, ...wikiObjects]
    }
    return base
  }, [drillLevel, arcObjects, objects, allObjects, isWikipediaActive, wikiObjects])

  // Effective location name: derived from drill state, with manual fallback
  // This ensures the object panel header ALWAYS reflects the current drill-down
  // without needing setLocationName() in every single handler.
  const effectiveLocationName = activeSite || activeCountry || locationName || ''

  // Global-level stats: arc count and unique collection count
  const globalArcCount = filteredArcData.length
  const globalCollectionCount = useMemo(() => new Set(filteredArcData.map(a => a.institution_name)).size, [filteredArcData])

  // Container total count
  const containerTotalCount = useMemo(() => {
    const wikiCount = isWikipediaActive ? wikiObjects.length : 0
    if (drillLevel !== "global") return arcObjectsTotal + wikiCount
    // At global level: real bbox count if available, otherwise aggregate total from initial data
    const base = objects.length > 0 ? totalCount : (allObjects.length > 0 ? totalCount : 0)
    return base + wikiCount
  }, [drillLevel, arcObjectsTotal, totalCount, objects.length, allObjects.length, isWikipediaActive, wikiObjects.length])

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
          locationName={locationName}
          onCommandPaletteOpen={() => setCommandPaletteOpen(true)}
          isObjectContainerVisible={isObjectContainerVisible}
          toggleObjectContainerVisibility={() => setIsObjectContainerVisible(prev => !prev)}
          setObjects={setObjects}
          setTotalCount={setTotalCount}
          facetedFilters={facetedFilters}
          onFacetedFiltersChange={setFacetedFilters}
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
          activeSite={activeSite}
          activeInstitution={activeInstitution}
          onToggleSite={handleToggleSite}
          onToggleInstitution={handleToggleInstitution}
          isLoadingSubArcs={isLoadingSubArcs}
        />

        {/* Floating object container — images only (+ header on mobile) */}
        {isObjectContainerVisible && (
          <ObjectPanel
            objects={containerObjects}
            onLoadMore={drillLevel !== "global" ? handleDrillLoadMore : handleLoadMore}
            hasMore={drillLevel !== "global" ? arcObjectsHasMore : hasMore}
            totalCount={containerTotalCount}
            isLoading={drillLevel !== "global" ? arcObjectsLoading : isLoading}
            onObjectClick={handleObjectClick}
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
            onFacetedFiltersChange={setFacetedFilters}
            onCommandPaletteOpen={() => setCommandPaletteOpen(true)}
            linkObjects={[]}
          />
        )}

        {/* Command Palette (⌘K) */}
        <CommandPalette
          open={commandPaletteOpen}
          onOpenChange={setCommandPaletteOpen}
          handlers={commandPaletteHandlers}
          facetedFilters={facetedFilters}
          onFacetedFiltersChange={setFacetedFilters}
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

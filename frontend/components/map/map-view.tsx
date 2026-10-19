"use client"
import "maplibre-gl/dist/maplibre-gl.css"

import type React from "react"
import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle, useMemo, Fragment } from "react"
import maplibregl from "maplibre-gl"
import { Protocol } from "pmtiles"
import { MapboxOverlay } from "@deck.gl/mapbox"
import type { MuseumObject, MapBounds, SelectedArc } from "../../types"
import debounce from "lodash/debounce"
import { ChevronDown, ChevronUp, Info } from "lucide-react"
import { ExclamationTriangleIcon, ReloadIcon } from "@radix-ui/react-icons"
import { iconSvgStrings } from "@/components/icons"
import SearchBar from "./search-bar"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ArcLayer, ScatterplotLayer } from "@deck.gl/layers"
import { Spinner } from "@/components/ui/spinner"
import { useGeospatialData, type GeospatialFilters as FilterState } from "@/hooks/use-geospatial-data"
import { useSpatialDocuments } from "@/hooks/use-spatial-documents"
import { useArcWorker, type ArcDatum } from "@/hooks/use-arc-worker"
import { cn } from "@/lib/utils"
import { useMediaQuery } from "@/hooks/use-media-query"
import { WIKIPEDIA_COLLECTION, ENABLE_WIKIPEDIA } from "@/components/faceted-filter"
import { ARC_ANCHOR_LAYER, protomapsDarkStyle } from "@/lib/protomaps-dark-style"
import { eraToDateFilters, ERA_BUCKETS, collapseContiguousBuckets, type EraBucket } from "@/lib/era-buckets"
import type { DateBucketCounts } from "@/lib/api"
import { resolveImageSrc } from "@/lib/image-src"
import { placeDisplayLabels } from "@/lib/place-label"
import { sharedRequest } from "@/lib/api"
import { COUNTRY_LABELS_URL, ORIGIN_LABELS_SOURCE, buildCountryIndex, countryKey } from "@/lib/country-labels"
import { track } from "@/lib/analytics"
import { useInstitutionPlaces } from "@/lib/institution-places"
import { siteKey } from "@/lib/site-key"
import type { PrecisePlace } from "@/lib/api"
import PrecisePlaceRows from "@/components/map/precise-place-rows"
import { AboutText } from "@/components/map/info-panel"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

// Register PMTiles protocol adapter so MapLibre can read .pmtiles files directly
let pmtilesRegistered = false
if (typeof window !== "undefined" && !pmtilesRegistered) {
  const protocol = new Protocol()
  maplibregl.addProtocol("pmtiles", protocol.tile)
  pmtilesRegistered = true
}



// Re-export for parent
// `era` = "Time" (object creation date), `migrationEra` = "Migration"
// (acquisition date) — both optional, set/cleared only from the left panel's
// Time/Migration accordion sections.
export type FacetedFilters = {
  institutions: string[]
  countries: string[]
  cities: string[]
  era?: EraBucket | null
  migrationEra?: EraBucket | null
}

// Protomaps dark style — see lib/protomaps-dark-style.ts
// For full data sovereignty, the PMTiles planet file can be downloaded from
// https://protomaps.com/downloads and served as a static file from
// /public/basemap.pmtiles — this eliminates all external tile dependencies.
const DARK_STYLE = protomapsDarkStyle()

interface ViewState {
  longitude: number
  latitude: number
  zoom: number
  pitch?: number
  bearing?: number
  name?: string
}

type DrillLevel = "global" | "country" | "objects"

interface BreadcrumbSegment {
  label: string
  level: DrillLevel
}

interface GroupedOrigin {
  country: string
  totalCount: number
  institutions: string[]
  lat: number
  lng: number
}

interface GroupedSite {
  name: string
  totalCount: number
  institutions: string[]
  lat: number
  lng: number
}

interface InstitutionItem {
  name: string
  count: number
}

const HEADER_ACCORDION_FADE_STYLE = {
  background: "linear-gradient(to top, rgba(255, 255, 255, 1) 0%, rgba(255, 255, 255, 0.92) 14%, rgba(255, 255, 255, 0.45) 30%, rgba(255, 255, 255, 0) 48%, rgba(255, 255, 255, 0) 100%)",
}

const HEADER_ACCORDION_TOP_FADE_STYLE = {
  background: "linear-gradient(to bottom, rgba(255, 255, 255, 1) 0%, rgba(255, 255, 255, 0.92) 14%, rgba(255, 255, 255, 0.45) 30%, rgba(255, 255, 255, 0) 48%, rgba(255, 255, 255, 0) 100%)",
}

// Same place, same key: "Çorum" / "Corum (Province)", "Istanbul" / "Istanbul?" (lib/site-key.ts)
const normalizePlaceKey = siteKey

function hasValidCoordinates(lat?: number | null, lng?: number | null): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
  return Math.abs(lat as number) <= 90
    && Math.abs(lng as number) <= 180
    && !(Math.abs(lat as number) < 1e-6 && Math.abs(lng as number) < 1e-6)
}

function hasValidCoordinatePair(position?: [number, number] | number[]): boolean {
  if (!position || position.length < 2) return false
  return hasValidCoordinates(position[1], position[0])
}

function HeaderAccordionList({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      <div className="space-y-0.5 max-h-40 overflow-y-auto pr-1 pb-1">
        {children}
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-5"
        style={HEADER_ACCORDION_TOP_FADE_STYLE}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-8"
        style={HEADER_ACCORDION_FADE_STYLE}
      />
    </div>
  )
}

interface MapViewProps {
  initialViewState: ViewState
  onBoundsChange: (bounds: MapBounds) => void
  objects: MuseumObject[]
  allObjects: MuseumObject[]
  onError?: (error: string) => void
  totalCount: number
  onToggleView: () => void
  onExpandView: () => void
  viewMode: "grid" | "list"
  containerSize: "default" | "expanded" | "minimized"
  locationName?: string
  onDownloadCSV?: () => void
  isObjectContainerVisible: boolean
  setObjects: (objects: MuseumObject[]) => void
  setTotalCount: (count: number) => void
  initialLongitude?: number
  initialLatitude?: number
  initialZoom?: number
  children?: React.ReactNode
  showControls?: boolean
  facetedFilters?: FacetedFilters
  onFacetedFiltersChange?: (filters: FacetedFilters) => void
  selectedArc?: SelectedArc | null
  onSelectArc?: (arc: SelectedArc | null) => void
  onZoomChange?: (zoom: number) => void
  onArcCardsChange?: (arcCards: any[]) => void
  onStatsItemClick?: (type: "country" | "city" | "institution", name: string, centroid?: { lat: number; lng: number }) => void
  // Drill-down props
  drillLevel?: DrillLevel
  breadcrumb?: BreadcrumbSegment[]
  onBreadcrumbClick?: (level: DrillLevel) => void
  groupedOrigins?: GroupedOrigin[]
  sitesByCountry?: Map<string, Set<string>>
  isLoadingOrigins?: boolean
  onOriginClick?: (country: string, lat?: number, lng?: number) => void
  groupedSites?: GroupedSite[]
  drillInstitutions?: InstitutionItem[]
  activeCountry?: string | null
  activeSite?: string | null
  precisePlaces?: PrecisePlace[]
  activePrecise?: string | null
  onTogglePrecise?: (place: PrecisePlace) => void
  activeInstitution?: string | null
  // Transient hover-only place name (from an object card in the grid) — highlights
  // the matching arc without the navigation/fetch side effects of activeSite.
  hoveredObjectPlace?: string | null
  onToggleSite?: (site: string, lat?: number, lng?: number) => void
  onToggleInstitution?: (inst: string) => void
  isLoadingSubArcs?: boolean
  drillArcs?: { place_name: string; institution_name: string; object_count: number; latitude: number; longitude: number; institution_latitude?: number; institution_longitude?: number }[]
  onCommandPaletteOpen?: () => void
  onWikiDocumentsChange?: (docs: any[]) => void
  // Time/Migration bucket counts for the left-panel "Time" accordion —
  // fetched once by the parent (page.tsx) and shared with CommandPalette,
  // instead of each component fetching its own copy.
  dateBuckets?: DateBucketCounts | null
}

const MapView = forwardRef<{ map: maplibregl.Map | null }, MapViewProps>(
  (
    {
      initialViewState,
      onBoundsChange,
      objects = [],
      allObjects = [],
      onError,
      totalCount,
      onToggleView,
      viewMode,
      containerSize,
      locationName,
      onExpandView,
      onDownloadCSV,
      isObjectContainerVisible,
      setObjects,
      setTotalCount,
      initialLongitude,
      initialLatitude,
      initialZoom,
      children,
      showControls = true,
      facetedFilters: parentFacetedFilters,
      onFacetedFiltersChange,
      selectedArc,
      onSelectArc,
      onZoomChange,
      onArcCardsChange,
      onStatsItemClick,
      drillLevel = "global",
      breadcrumb = [],
      onBreadcrumbClick,
      groupedOrigins = [],
      sitesByCountry = new Map(),
      isLoadingOrigins = false,
      onOriginClick,
      groupedSites = [],
      drillInstitutions = [],
      activeCountry = null,
      activeSite = null,
      precisePlaces = [],
      activePrecise = null,
      onTogglePrecise,
      activeInstitution = null,
      hoveredObjectPlace = null,
      onToggleSite,
      onToggleInstitution,
      isLoadingSubArcs = false,
      drillArcs = [],
      onCommandPaletteOpen,
      onWikiDocumentsChange,
      dateBuckets = null,
    },
    ref,
  ) => {
    const mapContainer = useRef<HTMLDivElement>(null)
    const institutionPlace = useInstitutionPlaces()
    const map = useRef<maplibregl.Map | null>(null)
    const lastBounds = useRef<MapBounds | null>(null)
    const deckOverlay = useRef<MapboxOverlay | null>(null)
    const [mapError, setMapError] = useState<string | null>(null)
    // Zoom bands, not the raw zoom: the map fires "zoom" every animation frame,
    // and a raw-value state re-rendered this component (and rebuilt the arc
    // layers) ~60×/s while zooming. The exact value lives in currentZoomRef.
    const [isLowZoomArcView, setIsLowZoomArcView] = useState((initialZoom || 2) < 4)
    const [isStreetZoom, setIsStreetZoom] = useState((initialZoom || 2) >= 7)
    const currentZoomRef = useRef(initialZoom || 2)
    const [isMapReady, setIsMapReady] = useState(false)
    const initialBoundsSet = useRef(false)
    const prevViewStateRef = useRef(initialViewState)
    const [mapLoaded, setMapLoaded] = useState(false)
    const isMobile = useMediaQuery("(max-width: 768px)")

    // Old UI state
    const [showArcs, setShowArcs] = useState(true)
    // Display-only labels: "Kano (State)" shows as "Kano" unless another site shares the name.
    const siteLabels = useMemo(() => placeDisplayLabels(groupedSites.map((s) => s.name)), [groupedSites])
    const [showCollections, setShowCollections] = useState(true)
    const [showTime, setShowTime] = useState(true)
    type HoveredArc = {
      fromName: string; toName: string; count: number
      fromCity?: string; fromCountry?: string; fromHistorical?: string
      toCity?: string; toCountry?: string
    }
    const [hoveredArc, setHoveredArc] = useState<HoveredArc | null>(null)
    // The tooltip follows the pointer by moving its element directly: keeping
    // x/y in state re-rendered this whole component on every mouse move.
    // State changes only when the pointer reaches a different arc.
    const arcTooltipRef = useRef<HTMLDivElement>(null)
    const arcTooltipPosRef = useRef({ x: 0, y: 0 })
    const showArcTooltip = useCallback((arc: HoveredArc, x: number, y: number) => {
      arcTooltipPosRef.current = { x, y }
      const el = arcTooltipRef.current
      if (el) { el.style.left = `${x + 10}px`; el.style.top = `${y + 10}px` }
      setHoveredArc((prev) =>
        prev && prev.fromName === arc.fromName && prev.toName === arc.toName && prev.count === arc.count ? prev : arc)
    }, [])

    // Touch screens have no "mouse leaves the arc", so a tapped arc's tooltip would
    // stay on screen (over the object panel). Close it after a moment or on the next touch.
    useEffect(() => {
      if (!hoveredArc || !isMobile) return
      const close = () => setHoveredArc(null)
      const timer = window.setTimeout(close, 2500)
      const onTouch = () => close()
      window.addEventListener("touchstart", onTouch, { passive: true, once: true })
      return () => {
        window.clearTimeout(timer)
        window.removeEventListener("touchstart", onTouch)
      }
    }, [hoveredArc, isMobile])

    const [hoveredDoc, setHoveredDoc] = useState<{
      title: string; description?: string; count?: number; x: number; y: number
    } | null>(null)

    const [selectedDoc, setSelectedDoc] = useState<{
      title: string; description?: string; img_url?: string;
      source_url?: string; source_name?: string;
      count?: number; x: number; y: number
    } | null>(null)

    // Guard against update loops from programmatic map moves
    const isProgrammaticMove = useRef(false)
    const lastViewRef = useRef({
      lng: initialViewState.longitude || 0,
      lat: initialViewState.latitude || 20,
      zoom: initialViewState.zoom || 2,
    })

    // Refs for arc selection
    const selectedArcRef = useRef(selectedArc)
    const onSelectArcRef = useRef(onSelectArc)
    useEffect(() => { selectedArcRef.current = selectedArc }, [selectedArc])
    useEffect(() => { onSelectArcRef.current = onSelectArc }, [onSelectArc])

    // Ref for onZoomChange to avoid stale closure in map event listener
    const onZoomChangeRef = useRef(onZoomChange)
    useEffect(() => { onZoomChangeRef.current = onZoomChange }, [onZoomChange])

    // Ref for onToggleSite to avoid stale closure in arc click handlers
    const onToggleSiteRef = useRef(onToggleSite)
    useEffect(() => { onToggleSiteRef.current = onToggleSite }, [onToggleSite])

    const [isRateLimited, setIsRateLimited] = useState(false)

    // ── New backend: geospatial data pipeline ──
    // Bumped at the end of every move, programmatic ones included: the arc viewport
    // filter reads the map's bounds, and a fly-to sets viewportState before the map has
    // moved, so without this the new site's arcs stayed filtered out after the flight.
    const [moveEndTick, setMoveEndTick] = useState(0)
    const [viewportState, setViewportState] = useState({
      longitude: initialViewState.longitude || 0,
      latitude: initialViewState.latitude || 20,
      zoom: initialViewState.zoom || 2,
    })

    const [localFacetedFilters, setLocalFacetedFilters] = useState<FacetedFilters>({
      institutions: [], countries: [], cities: [],
    })
    const facetedFilters = parentFacetedFilters ?? localFacetedFilters
    const facetedFiltersRef = useRef(facetedFilters)
    facetedFiltersRef.current = facetedFilters

    const setFacetedFilters = useCallback((filters: FacetedFilters | ((prev: FacetedFilters) => FacetedFilters)) => {
      if (onFacetedFiltersChange) {
        const newFilters = typeof filters === 'function' ? filters(facetedFiltersRef.current) : filters
        onFacetedFiltersChange(newFilters)
      } else {
        setLocalFacetedFilters(filters)
      }
    }, [onFacetedFiltersChange])

    const geospatialFilters: FilterState = useMemo(() => ({
      institutions: facetedFilters.institutions.length > 0 ? facetedFilters.institutions : undefined,
      countries: facetedFilters.countries.length > 0 ? facetedFilters.countries : undefined,
      cities: facetedFilters.cities.length > 0 ? facetedFilters.cities : undefined,
      ...eraToDateFilters(facetedFilters.era, facetedFilters.migrationEra),
    }), [
      facetedFilters.institutions.join(','),
      facetedFilters.countries.join(','),
      facetedFilters.cities.join(','),
      facetedFilters.era?.id,
      facetedFilters.migrationEra?.id,
    ])

    const toggleEra = useCallback((bucket: EraBucket) => {
      setFacetedFilters({ ...facetedFilters, era: facetedFilters.era?.id === bucket.id ? null : bucket })
    }, [facetedFilters, setFacetedFilters])

    // Derive geocoded/resolved place name from objects' city_en (for collapsed header)
    const closedResolvedPlaceName = useMemo(() => {
      if (!locationName || objects.length === 0) return null
      for (const obj of objects) {
        const cityEn = (obj.attributes?.city_en || '').trim()
        if (cityEn && cityEn.toLowerCase() !== locationName.trim().toLowerCase()) {
          return cityEn
        }
      }
      return null
    }, [objects, locationName])

    const { data: geospatialData, loading: geospatialLoading } = useGeospatialData(viewportState, {
      debounceMs: 300, autoFetch: true, filters: geospatialFilters,
    })

    // Refs for prop callbacks
    const onBoundsChangeRef = useRef(onBoundsChange)
    const setObjectsRef = useRef(setObjects)
    const setTotalCountRef = useRef(setTotalCount)
    const onErrorRef = useRef(onError)
    const onBreadcrumbClickRef = useRef(onBreadcrumbClick)
    useEffect(() => {
      onBoundsChangeRef.current = onBoundsChange
      setObjectsRef.current = setObjects
      setTotalCountRef.current = setTotalCount
      onErrorRef.current = onError
      onBreadcrumbClickRef.current = onBreadcrumbClick
    }, [onBoundsChange, setObjects, setTotalCount, onError, onBreadcrumbClick])

    useImperativeHandle(ref, () => ({
      map: map.current,
      // True while a flight started by code (flyToLocation, arc click) is still running.
      isProgrammaticMove: (): boolean => isProgrammaticMove.current,
      // Returns false while the map isn't created yet (the call did nothing).
      flyToLocation: (lng: number, lat: number, zoom: number = 10, duration: number = 800): boolean => {
        if (!map.current) return false
        isProgrammaticMove.current = true
        setViewportState({ longitude: lng, latitude: lat, zoom })
        lastViewRef.current = { lng, lat, zoom }
        prevViewStateRef.current = { longitude: lng, latitude: lat, zoom } as any
        map.current.flyTo({ center: [lng, lat], zoom, essential: true, duration })
        return true
      },
      jumpToLocation: (lng: number, lat: number, zoom: number = 10) => {
        if (map.current) {
          isProgrammaticMove.current = true
          setViewportState({ longitude: lng, latitude: lat, zoom })
          lastViewRef.current = { lng, lat, zoom }
          prevViewStateRef.current = { longitude: lng, latitude: lat, zoom } as any
          map.current.jumpTo({ center: [lng, lat], zoom })
        }
      },
    }))

    // ── Animate helper ──
    const animateToZoomLevel = useCallback(
      (center: [number, number], targetZoom: number, options: { mode?: "level-shift" | "detail"; duration?: number; onComplete?: () => void } = {}) => {
        const mapRef = map.current
        if (!mapRef) return
        isProgrammaticMove.current = true
        setViewportState({ longitude: center[0], latitude: center[1], zoom: targetZoom })
        lastViewRef.current = { lng: center[0], lat: center[1], zoom: targetZoom }
        const mode = options.mode ?? "level-shift"
        const duration = options.duration ?? (mode === "detail" ? 2000 : 2500)
        const easingFn = mode === "detail"
          ? (t: number) => 1 - Math.pow(1 - t, 2.2)
          : (t: number) => 1 - Math.pow(1 - t, 3.2)
        mapRef.easeTo({ center, zoom: targetZoom, duration, easing: easingFn, essential: true })
      },
      [map],
    )

    // ── Bounds change ──
    const handleBoundsChange = useCallback((bounds: MapBounds) => {
      if (isRateLimited) return
      if (onBoundsChangeRef.current) onBoundsChangeRef.current(bounds)
    }, [isRateLimited])

    // Store debouncedBoundsChange in a ref so the map event closure always
    // calls the latest version, and old debounce timers are cancelled.
    const debouncedBoundsChangeRef = useRef(
      debounce((bounds: MapBounds) => {
        if (!lastBounds.current ||
          Math.abs(lastBounds.current.north - bounds.north) > 0.05 ||
          Math.abs(lastBounds.current.south - bounds.south) > 0.05 ||
          Math.abs(lastBounds.current.east - bounds.east) > 0.05 ||
          Math.abs(lastBounds.current.west - bounds.west) > 0.05
        ) {
          lastBounds.current = bounds
          handleBoundsChange(bounds)
        }
      }, 200),
    )
    // When handleBoundsChange changes, cancel old timer and create new debounced fn
    useEffect(() => {
      debouncedBoundsChangeRef.current.cancel()
      debouncedBoundsChangeRef.current = debounce((bounds: MapBounds) => {
        if (!lastBounds.current ||
          Math.abs(lastBounds.current.north - bounds.north) > 0.05 ||
          Math.abs(lastBounds.current.south - bounds.south) > 0.05 ||
          Math.abs(lastBounds.current.east - bounds.east) > 0.05 ||
          Math.abs(lastBounds.current.west - bounds.west) > 0.05
        ) {
          lastBounds.current = bounds
          handleBoundsChange(bounds)
        }
      }, 200)
      return () => { debouncedBoundsChangeRef.current.cancel() }
    }, [handleBoundsChange])

    const handleResize = useCallback(() => {
      requestAnimationFrame(() => {
        if (map.current && typeof map.current.resize === 'function') map.current.resize()
      })
    }, [])

    const handleResetView = useCallback(() => {
      if (map.current) {
        isProgrammaticMove.current = true
        lastViewRef.current = { lng: 0, lat: 20, zoom: 1 }
        map.current.flyTo({ center: [0, 20], zoom: 1, pitch: 0, bearing: 0, essential: true, duration: 1800 })
      }
    }, [])

    // ── Initialize map ──
    useEffect(() => {
      if (!mapContainer.current || map.current) return

      let mapInstance: maplibregl.Map
      try {
        mapInstance = new maplibregl.Map({
          container: mapContainer.current,
          style: DARK_STYLE,
          center: [initialLongitude || 0, initialLatitude || 20],
          zoom: initialZoom || 2,
          attributionControl: false,
        })
      } catch (error) {
        setMapError("Failed to initialize map")
        if (onErrorRef.current) onErrorRef.current("Failed to initialize map")
        return
      }

      // ── MapboxOverlay (deck.gl as MapLibre control — identical API) ──
      try {
        deckOverlay.current = new MapboxOverlay({ interleaved: true, layers: [] })
        mapInstance.addControl(deckOverlay.current as unknown as maplibregl.IControl)
      } catch (error) {
        console.error("Error creating deck.gl overlay:", error)
      }

      mapInstance.on("load", () => {
        setMapLoaded(true)
        setIsMapReady(true)
        setMapError(null)

        // Initial bounds
        const bounds = mapInstance.getBounds()
        if (bounds && !initialBoundsSet.current) {
          initialBoundsSet.current = true
          const calculatedBounds = {
            north: bounds.getNorth(), south: bounds.getSouth(),
            east: bounds.getEast(), west: bounds.getWest(),
          }
          lastBounds.current = calculatedBounds
          handleBoundsChange(calculatedBounds)
        }
      })

      mapInstance.on("movestart", () => {
        // Clear hover tooltips immediately when map starts moving / animating
        // Prevents tooltips from getting stuck on screen during fly animations
        setHoveredArc(null)
        setHoveredDoc(null)
      })

      mapInstance.on("moveend", () => {
        setMoveEndTick((t) => t + 1)
        const wasProgrammatic = isProgrammaticMove.current
        if (wasProgrammatic) { isProgrammaticMove.current = false }
        setSelectedDoc(null)
        const center = mapInstance.getCenter()
        const zoom = mapInstance.getZoom()
        // A page opened at a deep link fires no "zoom" event, so set the bands here too.
        setIsLowZoomArcView(zoom < 4)
        setIsStreetZoom(zoom >= 7)
        const moved = Math.abs(lastViewRef.current.lng - center.lng) > 0.001 ||
          Math.abs(lastViewRef.current.lat - center.lat) > 0.001 ||
          Math.abs(lastViewRef.current.zoom - zoom) > 0.05
        if (!moved) return
        lastViewRef.current = { lng: center.lng, lat: center.lat, zoom }
        // Always update viewport state so geospatial data hook fetches
        // the correct zoom-level data (country → city → objects)
        setViewportState({ longitude: center.lng, latitude: center.lat, zoom })
        // Only notify parent about bounds changes for user-initiated moves
        // (geocode for programmatic moves is handled directly in the handlers)
        if (!wasProgrammatic) {
          const bounds = mapInstance.getBounds()
          if (bounds) {
            debouncedBoundsChangeRef.current({
              north: bounds.getNorth(), south: bounds.getSouth(),
              east: bounds.getEast(), west: bounds.getWest(),
            })
          }
        }
      })

      mapInstance.on("error", (e: any) => {
        // Only log tile/resource errors — they are transient and shouldn't
        // destroy the entire map UI.  Reserve setMapError for truly fatal
        // errors (handled by the constructor try/catch above).
        const errorMsg = e?.error?.message || e?.message || "Unknown map error"
        console.warn("MapLibre error (non-fatal):", errorMsg)
      })

      mapInstance.on("zoom", () => {
        const newZoom = mapInstance.getZoom()
        setIsLowZoomArcView(newZoom < 4)
        setIsStreetZoom(newZoom >= 7)
        currentZoomRef.current = newZoom
        onZoomChangeRef.current?.(newZoom)
      })

      // No map controls: scroll or pinch zooms, the breadcrumb root goes back to the globe,
      // and About sits on the breadcrumb row of the header card (and next to search on phones).

      window.addEventListener("resize", handleResize)
      // The mobile map card changes size (card, full screen, put away) without a window
      // resize; MapLibre then keeps its old canvas size, stretching labels and drawing
      // arcs away from their sites. Follow the container itself.
      const containerObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => handleResize()) : null
      if (containerObserver && mapContainer.current) containerObserver.observe(mapContainer.current)
      map.current = mapInstance

      return () => {
        window.removeEventListener("resize", handleResize)
        containerObserver?.disconnect()
        // Cancel any pending debounced bounds change
        debouncedBoundsChangeRef.current.cancel()
        if (deckOverlay.current) {
          try { mapInstance.removeControl(deckOverlay.current as unknown as maplibregl.IControl) } catch (e) {}
          deckOverlay.current = null
        }
        if (mapInstance) {
          try { mapInstance.remove() } catch (error) {}
          finally {
            if (mapContainer.current) mapContainer.current.innerHTML = ""
            map.current = null; setMapLoaded(false); setIsMapReady(false); setMapError(null)
          }
        }
      }
    }, [showControls])

    // Sync prevViewStateRef when initialViewState changes (for URL restore bookkeeping)
    // Actual map flyTo is handled directly by handlers via flyToLocation — no duplicate animation
    useEffect(() => {
      if (map.current && isMapReady) {
        prevViewStateRef.current = initialViewState
      }
    }, [initialViewState, isMapReady])

    // ── WEB WORKER ARC PIPELINE ──
    const { processedArcs, processing: arcProcessing } = useArcWorker(geospatialData, objects)

    // ── WIKIPEDIA / SPATIAL DOCUMENTS LAYER ──
    const isWikipediaSelected = ENABLE_WIKIPEDIA && facetedFilters.institutions.includes(WIKIPEDIA_COLLECTION)

    const { data: spatialDocData } = useSpatialDocuments(viewportState, {
      debounceMs: 400,
      autoFetch: isWikipediaSelected,
    })

    // Push wiki docs to parent for the object grid
    useEffect(() => {
      if (!onWikiDocumentsChange) return
      if (!isWikipediaSelected || !spatialDocData?.data) {
        onWikiDocumentsChange([])
        return
      }
      onWikiDocumentsChange(spatialDocData.data)
    }, [isWikipediaSelected, spatialDocData, onWikiDocumentsChange])

    const wikiLayer = useMemo(() => {
      if (!isMapReady || !isWikipediaSelected || !spatialDocData?.data) return null
      const docs = spatialDocData.data
      if (!docs || docs.length === 0) return null

      return new ScatterplotLayer({
        id: 'wikipedia-documents-layer',
        data: docs,
        getPosition: (d: any) => [d.longitude || 0, d.latitude || 0],
        getRadius: (d: any) => {
          // Clusters get bigger radius based on doc_count
          if (d.doc_count && d.doc_count > 1) {
            return Math.max(6, Math.min(30, 6 + Math.log(d.doc_count) * 5))
          }
          return 6
        },
        getFillColor: [99, 102, 241, 200], // Indigo
        getLineColor: [255, 255, 255, 255],
        lineWidthMinPixels: 1.5,
        stroked: true,
        filled: true,
        radiusScale: 1,
        radiusMinPixels: 5,
        radiusMaxPixels: 30,
        pickable: true,
        autoHighlight: true,
        highlightColor: [139, 92, 246, 255], // Violet on hover
        onHover: (info: any) => {
          if (info.object) {
            const d = info.object
            setHoveredDoc({ title: d.title || d.sample_title || 'Wikipedia', description: d.description || null, count: d.doc_count, x: info.x, y: info.y })
            setHoveredArc(null)
          } else {
            setHoveredDoc(null)
          }
        },
        onClick: (info: any) => {
          if (!info.object) return
          const d = info.object
          const docCount = d.doc_count ? parseInt(d.doc_count) : 1
          const mapRef = map.current
          if (docCount > 1 && !d.source_url) {
            setSelectedDoc(null)
            if (mapRef) animateToZoomLevel([d.longitude || 0, d.latitude || 0], Math.min((mapRef.getZoom() || 2) + 3, 12), { mode: 'level-shift', duration: 1800 })
            return
          }
          const wikiTitle = d.title || d.sample_title || ''
          const inferredUrl = d.source_url || (wikiTitle ? `https://en.wikipedia.org/wiki/${encodeURIComponent(wikiTitle.replace(/ /g, '_'))}` : undefined)
          setSelectedDoc({ title: wikiTitle || 'Wikipedia', description: d.description, img_url: d.img_url, source_url: inferredUrl, source_name: d.source_name, count: d.doc_count, x: info.x, y: info.y })
        },
      })
    }, [isMapReady, isWikipediaSelected, spatialDocData])

    // Arc layer construction

    // Zoom 4 splits the global view from the regional one (arc height, viewport filter).
    // Bucketed to a boolean (isLowZoomArcView, set in the zoom handler) so the layers only
    // recompute when crossing the threshold, not on every zoom-gesture frame.

    // Only the identity of the hovered arc matters for the layer (mobile width boost);
    // the tooltip's x/y change on every mouse move and must not rebuild the layer.
    const hoveredArcKey = isMobile && hoveredArc ? `${hoveredArc.fromName}-${hoveredArc.toName}` : null

    // Focus: once a country, site, collection or arc is selected, only its arcs
    // are drawn. Unrelated arcs used to stay on the map — a hairball at world
    // zoom, and when zoomed in, long arcs passing the camera as wide bands.
    const matchesArcFocus = useCallback((fromName: string, fromCountry: string, toName: string) => {
      const from = normalizePlaceKey(fromName)
      const to = normalizePlaceKey(toName)
      if (selectedArc) {
        return normalizePlaceKey(selectedArc.from) === from && normalizePlaceKey(selectedArc.to) === to
      }
      if (activeCountry) {
        const country = normalizePlaceKey(activeCountry)
        if (normalizePlaceKey(fromCountry) !== country && from !== country) return false
      }
      if (activeSite && normalizePlaceKey(activeSite) !== from) return false
      if (activeInstitution && normalizePlaceKey(activeInstitution) !== to) return false
      return true
    }, [selectedArc?.from, selectedArc?.to, activeCountry, activeSite, activeInstitution])

    // Hovering a Places/Sites/Collections row tints its arcs like hovering an
    // object card does. Pointer devices only: a tap would leave it stuck on.
    const [listHover, setListHover] = useState<{ kind: "country" | "site" | "institution"; name: string } | null>(null)
    const canHover = useMediaQuery("(hover: hover)")
    const listHoverKey = listHover ? `${listHover.kind}:${listHover.name}` : null
    const listHoverProps = (kind: "country" | "site" | "institution", name: string) => canHover ? {
      onMouseEnter: () => setListHover({ kind, name }),
      onMouseLeave: () => setListHover(null),
    } : {}
    // The hovered row may unmount on click (drill-down) without a mouseleave.
    useEffect(() => { setListHover(null) }, [drillLevel, activeCountry, activeSite, activeInstitution])
    const matchesListHover = useCallback((fromName: string, fromCountry: string, toName: string) => {
      if (!listHover) return false
      const key = normalizePlaceKey(listHover.name)
      if (listHover.kind === "institution") return normalizePlaceKey(toName) === key
      if (listHover.kind === "site") return normalizePlaceKey(fromName) === key
      return normalizePlaceKey(fromCountry) === key || normalizePlaceKey(fromName) === key
    }, [listHoverKey])

    // Zoomed in, the map shows what left the places in view: routes whose origin
    // is near the viewport. Routes merely crossing the screen drew as wide bands
    // (arcs rise toward the camera), and in Europe nearly every route ends in
    // view. With a collection selected, routes into it count too. The rest come
    // back on pan (moveend).
    const isNearViewport = useMemo(() => {
      const mapInstance = map.current
      if (!isMapReady || isLowZoomArcView || !mapInstance) return () => true
      const b = mapInstance.getBounds()
      const lngSpan = b.getEast() - b.getWest()
      const latSpan = b.getNorth() - b.getSouth()
      if (lngSpan >= 240) return () => true
      const west = b.getWest() - lngSpan * 0.25
      const width = lngSpan * 1.5
      const south = b.getSouth() - latSpan * 0.25
      const north = b.getNorth() + latSpan * 0.25
      const inView = ([lng, lat]: [number, number]) =>
        lat >= south && lat <= north && (((lng - west) % 360) + 360) % 360 <= width
      return (source: [number, number], target: [number, number]) =>
        inView(source) || (!!activeInstitution && inView(target))
    }, [isMapReady, isLowZoomArcView, viewportState, moveEndTick, activeInstitution])

    // Highlighted and selected arcs are drawn again in a layer of their own on
    // top, without the depth test: inside the main layer, the arcs around them
    // cut them into dashes.
    const withEmphasis = (layer: ArcLayer<any>, emphasized: any[]) => emphasized.length === 0 ? [layer] : [
      layer,
      layer.clone({
        id: `${layer.id}-emphasis`,
        data: emphasized,
        pickable: false,
        autoHighlight: false,
        transitions: {},
        parameters: { depthCompare: "always", depthWriteEnabled: false },
      }),
    ]

    // Which arcs are drawn is kept apart from how they look: a hover only changes
    // colors, and with the same data array deck.gl updates just those attributes
    // instead of re-uploading every arc.
    const visibleArcData = useMemo(() => processedArcs.arcLayerData.filter((arc) =>
      hasValidCoordinatePair(arc.sourcePosition) && hasValidCoordinatePair(arc.targetPosition) &&
      matchesArcFocus(arc.fromName, arc.fromCountry, arc.toName) &&
      (!!selectedArc || isNearViewport(arc.sourcePosition, arc.targetPosition))
    ), [processedArcs, matchesArcFocus, isNearViewport, selectedArc?.key])

    // ── Labels (lib/country-labels.ts, lib/protomaps-dark-style.ts) ──
    // The country labels' names, to leave origins that are countries to them.
    const [countryIndex, setCountryIndex] = useState<Map<string, string> | null>(null)
    useEffect(() => {
      let cancelled = false
      sharedRequest(COUNTRY_LABELS_URL, () => fetch(COUNTRY_LABELS_URL).then((res) => res.json()))
        .then((collection) => { if (!cancelled) setCountryIndex(buildCountryIndex(collection)) })
        .catch((err) => console.error("Failed to load country labels:", err))
      return () => { cancelled = true }
    }, [])

    // Below the world view the arcs start at sites, which no country label names:
    // label each drawn arc's origin, as the source records give it. Origins that
    // are countries are left to the country labels.
    useEffect(() => {
      const source = map.current?.getSource(ORIGIN_LABELS_SOURCE) as maplibregl.GeoJSONSource | undefined
      if (!isMapReady || !source) return
      const origins = new Map<string, { name: string; count: number; position: [number, number] }>()
      const add = (name: string, count: number, position: [number, number]) => {
        const key = normalizePlaceKey(name)
        if (!key || countryIndex?.has(countryKey(name))) return
        const existing = origins.get(key)
        if (existing) existing.count += count
        else origins.set(key, { name, count, position })
      }
      if (processedArcs.dataSource !== "geospatial-country") {
        visibleArcData.forEach((arc) => add(arc.fromName, arc.count, arc.sourcePosition))
      }
      drillArcs.forEach((arc) => {
        if (hasValidCoordinates(arc.latitude, arc.longitude) && matchesArcFocus(arc.place_name, activeCountry ?? "", arc.institution_name)) {
          add(arc.place_name, arc.object_count, [arc.longitude, arc.latitude])
        }
      })
      const labels = placeDisplayLabels([...origins.values()].map((o) => o.name))
      source.setData({
        type: "FeatureCollection",
        features: [...origins.values()].map((o) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: o.position },
          // Town-sized text; places with more artifacts win label collisions.
          properties: { name: labels.get(o.name) ?? o.name, population_rank: 10, sort_key: -o.count },
        })),
      })
    }, [isMapReady, visibleArcData, processedArcs.dataSource, drillArcs, matchesArcFocus, activeCountry, countryIndex])

    // ArcLayer: görsel ve etkileşim bir arada, mobilde hover/tıklama sırasında geçici olarak genişler
    const arcLayer = useMemo(() => {
      if (!isMapReady || visibleArcData.length === 0) return null
      const { dataSource, layerStyle } = processedArcs
      const arcLayerData = visibleArcData
      const { sourceColor, targetColor } = layerStyle
      const layerId = dataSource === 'geospatial-country' || dataSource === 'geospatial-city' ? 'arc-layer-geospatial'
        : dataSource === 'geospatial-objects' ? 'arc-layer-objects' : 'arc-layer-fallback'
      const isAggregated = dataSource === 'geospatial-country' || dataSource === 'geospatial-city'
      // Alpha follows the route's size on a log scale: the few routes that carry
      // most objects stay solid, the hundreds of single-digit routes fade back
      // instead of overplotting them. Nothing is dropped — faint arcs still hover and click.
      const logMaxCount = Math.log(arcLayerData.reduce((m, d) => Math.max(m, d.count), 1) + 1)
      // Until a country, site, collection or arc is chosen the arcs are a quiet
      // texture at every zoom; a selection is what makes them read clearly.
      const isQuiet = !selectedArc && !activeCountry && !activeSite && !activeInstitution
      const [minAlpha, maxAlpha] = isQuiet ? [40, 220] : [100, 255]
      const restingAlpha = (d: ArcDatum) => {
        let alpha = isQuiet ? 130 : 255
        if (isAggregated && logMaxCount > 0) alpha = minAlpha + (maxAlpha - minAlpha) * (Math.log(d.count + 1) / logMaxCount)
        // Hovering a row in the left panel: everything else steps back.
        if (listHover && !matchesListHover(d.fromName, d.fromCountry, d.toName)) alpha *= 0.25
        return Math.round(alpha)
      }

      // Selection / drill-down state: gets the emphasized blue→purple gradient + thicker width.
      const isSelectedOrActiveArc = (d: ArcDatum) => {
        const selectedFrom = normalizePlaceKey(selectedArcRef.current?.from)
        const selectedTo = normalizePlaceKey(selectedArcRef.current?.to)
        const datumFrom = normalizePlaceKey(d.fromName)
        const datumTo = normalizePlaceKey(d.toName)

        const matchesSelectedArc = !!selectedArcRef.current && (
          selectedArcRef.current.key === `${d.fromName}-${d.toName}` ||
          (selectedFrom.length > 0 && selectedTo.length > 0 && selectedFrom === datumFrom && selectedTo === datumTo)
        )

        return matchesSelectedArc || (
          normalizePlaceKey(activeSite).length > 0 && normalizePlaceKey(activeSite) === datumFrom
        )
      }

      // Hovering an image in the panel: match the same flat-tint style deck.gl's
      // autoHighlight uses when hovering an arc directly on the map (no gradient, no width boost).
      const isPanelHoveredArc = (d: ArcDatum) =>
        (normalizePlaceKey(hoveredObjectPlace).length > 0 && normalizePlaceKey(hoveredObjectPlace) === normalizePlaceKey(d.fromName)) ||
        (!!listHover && matchesListHover(d.fromName, d.fromCountry, d.toName))

      const mainLayer = new ArcLayer<ArcDatum>({
        id: layerId,
        data: arcLayerData,
        getSourcePosition: (d) => d.sourcePosition,
        getTargetPosition: (d) => d.targetPosition,
        getSourceColor: (d): [number, number, number, number] => {
          if (isSelectedOrActiveArc(d) || isPanelHoveredArc(d)) return [59, 130, 246, 255]
          return [...sourceColor, restingAlpha(d)] as [number, number, number, number]
        },
        getTargetColor: (d): [number, number, number, number] => {
          if (isSelectedOrActiveArc(d)) return [147, 51, 234, 255]
          if (isPanelHoveredArc(d)) return [59, 130, 246, 255]
          return [...targetColor, restingAlpha(d)] as [number, number, number, number]
        },
        // Arcs rise toward the camera; zoomed in, a tall arc near the screen edge
        // projects as a wide band. Lower arcs stay readable at regional zoom. At street
        // zoom an arc thousands of km long is already far above the map next to its
        // origin, and perspective pushes it out of view, so it lies flat there instead.
        getHeight: isLowZoomArcView ? 1 : isStreetZoom ? 0 : 0.35,
        getWidth: (d) => {
          const selectedOrActive = isSelectedOrActiveArc(d)
          const isHovered = hoveredArcKey === `${d.fromName}-${d.toName}`
          const baseWidth = dataSource === 'geospatial-country' || dataSource === 'geospatial-city'
            ? Math.max(0.5, Math.min(3, 0.5 + Math.log(d.count + 1) * 0.45))
            : Math.max(2, Math.min(6, 2 + Math.log(d.count + 1) * 0.9))
          // Mobilde ve hover/seçili ise geçici olarak genişlet
          if (isMobile && (isHovered || selectedOrActive || isPanelHoveredArc(d))) return Math.max(baseWidth, 16)
          if (selectedOrActive) return baseWidth * 2.5
          // Thin unhighlighted arcs further while nothing is selected so overlap
          // reads as density rather than a solid overplotted mass.
          return isQuiet ? baseWidth * 0.7 : baseWidth
        },
        widthMinPixels: isMobile ? 2.5 : 1.5,
        pickable: true,
        autoHighlight: true,
        highlightColor: [59, 130, 246],
        transitions: { getSourceColor: { duration: 300 }, getTargetColor: { duration: 300 }, getWidth: { duration: 300 } },
        updateTriggers: {
          getSourceColor: [selectedArc?.key, activeSite, activeCountry, activeInstitution, hoveredObjectPlace, isLowZoomArcView, listHoverKey], getTargetColor: [selectedArc?.key, activeSite, activeCountry, activeInstitution, hoveredObjectPlace, isLowZoomArcView, listHoverKey], getWidth: [selectedArc?.key, activeSite, activeCountry, activeInstitution, hoveredObjectPlace, hoveredArcKey, isMobile, isLowZoomArcView, listHoverKey],
        },
        onHover: (info: any) => {
          if (info.object) {
            const d = info.object
            showArcTooltip({ fromName: d.fromName, toName: d.toName, count: d.count, fromCity: d.fromCity, fromCountry: d.fromCountry, fromHistorical: d.fromHistorical, toCity: d.toCity, toCountry: d.toCountry }, info.x, info.y)
          } else {
            setHoveredArc(null)
          }
        },
        onClick: (info: any) => {
          if (!info.object) return
          const d = info.object
          const [lng, lat] = d.sourcePosition
          const arcKey = `${d.fromName}-${d.toName}`
          if (selectedArcRef.current?.key === arcKey) { onSelectArcRef.current?.(null); return }
          track("arc_click", { from: d.fromName, to: d.toName, artifacts: d.count })
          onSelectArcRef.current?.({
            key: arcKey, from: d.fromName, to: d.toName, fromLat: lat, fromLng: lng,
            fromCity: d.fromCity, fromCountry: d.fromCountry, toCity: d.toCity, toCountry: d.toCountry, objectCount: d.count,
          })
          isProgrammaticMove.current = true
          const mapRef = map.current
          if (!mapRef) return
          if (info.layer.id === 'arc-layer-geospatial') {
            const curZ = mapRef.getZoom()
            if (curZ < 4) animateToZoomLevel([lng, lat], 5, { mode: 'level-shift', duration: 1900 })
            else animateToZoomLevel([lng, lat], 6, { mode: 'level-shift', duration: 1800 })
          } else if (info.layer.id === 'arc-layer-objects') {
            animateToZoomLevel([lng, lat], 14, { mode: 'detail', duration: 1600 })
          } else {
            animateToZoomLevel([lng, lat], 5, { mode: 'level-shift', duration: 1900 })
          }
        },
      })
      return withEmphasis(mainLayer, arcLayerData.filter((d) => isSelectedOrActiveArc(d) || isPanelHoveredArc(d)))
    }, [processedArcs, isMapReady, selectedArc?.key, isMobile, activeSite, hoveredObjectPlace, hoveredArcKey, isLowZoomArcView, isStreetZoom, visibleArcData, listHoverKey, matchesListHover, activeCountry, activeInstitution])

    // ── Drill arc layer: persistent city-cluster arcs ──
    // Shown at city zoom (< 7) always. At zoom 7+, shown only when arcLayer has
    // no individual-object data (e.g. institution with no bbox objects) — this
    // keeps arcs always visible while avoiding duplicate arcs when arcLayer
    // already covers the same route.
    const drillArcLayer = useMemo(() => {
      if (!isMapReady || drillLevel === "global" || drillArcs.length === 0) return null
      // At zoom 7+, only hide when the active arc layer is already rendering
      // individual object routes for the current viewport.
      if (isStreetZoom && processedArcs.dataSource === 'geospatial-objects' && processedArcs.arcLayerData.length > 0) return null
      // Drill arcs already belong to the active country; site/collection/arc
      // selections narrow them further (the country check is skipped here).
      const validArcs = drillArcs.filter(a =>
        hasValidCoordinates(a.latitude, a.longitude) &&
        a.institution_latitude != null && a.institution_longitude != null &&
        hasValidCoordinates(a.institution_latitude, a.institution_longitude) &&
        matchesArcFocus(a.place_name, activeCountry ?? "", a.institution_name) &&
        isNearViewport([a.longitude, a.latitude], [a.institution_longitude, a.institution_latitude])
      )
      if (validArcs.length === 0) return null
      // Drill-down selection: emphasized blue→purple gradient + thicker width.
      const isActiveSiteDrillArc = (d: any) => normalizePlaceKey(activeSite) === normalizePlaceKey(d.place_name)
      // Hovering an image in the panel: match the flat-tint style used when hovering an arc directly on the map.
      const isPanelHoveredDrillArc = (d: any) =>
        (normalizePlaceKey(hoveredObjectPlace).length > 0 && normalizePlaceKey(hoveredObjectPlace) === normalizePlaceKey(d.place_name)) ||
        (!!listHover && matchesListHover(d.place_name, activeCountry ?? "", d.institution_name))
      const drillAlpha = (d: any) => listHover && !matchesListHover(d.place_name, activeCountry ?? "", d.institution_name) ? 50 : 200
      const drillLayer = new ArcLayer({
        id: "arc-layer-drill",
        data: validArcs,
        getSourcePosition: (d: any) => [d.longitude, d.latitude],
        getTargetPosition: (d: any) => [d.institution_longitude, d.institution_latitude],
        getSourceColor: (d: any): [number, number, number, number] =>
          (isActiveSiteDrillArc(d) || isPanelHoveredDrillArc(d)) ? [59, 130, 246, 255] : [239, 95, 0, drillAlpha(d)],
        getTargetColor: (d: any): [number, number, number, number] =>
          isActiveSiteDrillArc(d) ? [147, 51, 234, 255] : (isPanelHoveredDrillArc(d) ? [59, 130, 246, 255] : [239, 95, 0, drillAlpha(d)]),
        getHeight: isLowZoomArcView ? 1 : isStreetZoom ? 0 : 0.35,
        getWidth: (d: any) =>
          isActiveSiteDrillArc(d) ? 3 : Math.max(0.5, Math.min(3, 0.5 + Math.log((d.object_count || 1) + 1) * 0.45)),
        widthMinPixels: isMobile ? 2.5 : 1.5,
        pickable: true,
        autoHighlight: true,
        highlightColor: [59, 130, 246],
        updateTriggers: {
          getSourceColor: [activeSite, hoveredObjectPlace, listHoverKey],
          getTargetColor: [activeSite, hoveredObjectPlace, listHoverKey],
          getWidth: [activeSite, hoveredObjectPlace],
        },
        onHover: (info: any) => {
          if (info.object) {
            const d = info.object
            showArcTooltip({ fromName: d.place_name, toName: d.institution_name, count: d.object_count, fromHistorical: d.historical_names?.length ? d.historical_names.join(", ") : undefined }, info.x, info.y)
          } else {
            setHoveredArc(null)
          }
        },
        onClick: (info: any) => {
          if (!info.object) return
          const d = info.object
          // Use onSelectArc (same path as main arcLayer) so handleSelectArc sets
          // both activeSite and activeInstitution, filtering the object panel correctly
          track("arc_click", { from: d.place_name, to: d.institution_name, artifacts: d.object_count })
          onSelectArcRef.current?.({
            key: `${d.place_name}-${d.institution_name}`,
            from: d.place_name,
            to: d.institution_name,
            fromLat: d.latitude,
            fromLng: d.longitude,
            fromCity: d.place_name,
            fromCountry: d.country || '',
            toCity: '',
            toCountry: '',
            objectCount: d.object_count,
          })
          isProgrammaticMove.current = true
          animateToZoomLevel([d.longitude, d.latitude], 6, { mode: 'level-shift', duration: 1800 })
        },
      })
      return withEmphasis(drillLayer, validArcs.filter((d) => isActiveSiteDrillArc(d) || isPanelHoveredDrillArc(d)))
    }, [isMapReady, drillLevel, drillArcs, activeSite, activeCountry, hoveredObjectPlace, isMobile, isStreetZoom, processedArcs.dataSource, processedArcs.arcLayerData.length, matchesArcFocus, isNearViewport, isLowZoomArcView, listHoverKey, matchesListHover])

    // Derived values from processedArcs
    const { arcCards, uniqueArcsCount } = useMemo(() => ({
      arcCards: processedArcs.arcCards,
      uniqueArcsCount: processedArcs.uniqueArcCount,
    }), [processedArcs])

    const layers = useMemo(() => {
      if (!isMapReady) return []
      const result: any[] = []
      if (drillArcLayer) result.push(...drillArcLayer)
      if (arcLayer) result.push(...arcLayer)
      if (wikiLayer) result.push(wikiLayer)
      // Arcs go beneath every label, so all names stay legible.
      return result.map((layer) => layer instanceof ArcLayer ? layer.clone({ beforeId: ARC_ANCHOR_LAYER }) : layer)
    }, [isMapReady, arcLayer, drillArcLayer, wikiLayer])

    // Push layers to MapboxOverlay
    useEffect(() => {
      if (!deckOverlay.current || !isMapReady) return
      try { deckOverlay.current.setProps({ layers, pickingRadius: isMobile ? 10 : 3 }) } catch (e) {}
    }, [layers, isMapReady, isMobile])

    // Notify parent when arcCards change
    useEffect(() => { onArcCardsChange?.(arcCards) }, [arcCards, onArcCardsChange])

    if (mapError) {
      return (
        <div className="w-full h-full flex items-center justify-center bg-red-50 text-red-500">
          <div className="text-center p-8">
            <ExclamationTriangleIcon className="h-12 w-12 mx-auto mb-4" />
            <p className="text-sm font-normal mb-4">{mapError}</p>
            <Button onClick={() => window.location.reload()} variant="outline" className="mx-auto">
              <ReloadIcon className="h-5 w-5 mr-2" /> Reload Page
            </Button>
          </div>
        </div>
      )
    }

    return (
      <div
        className="relative h-full w-full"
        suppressHydrationWarning
        data-panel={
          isMobile
            ? (isObjectContainerVisible ? `mobile-${containerSize}` : "mobile-hidden")
            : (isObjectContainerVisible ? "desktop" : "desktop-hidden")
        }
      >
        {/* iOS Safari'de harita arkasında beyaz background sorununu önlemek için özel bir kapsayıcı */}
        <div
          ref={mapContainer}
          className="h-full w-full"
          suppressHydrationWarning
          onMouseLeave={() => {
            // deck.gl's ArcLayer onHover only clears hover state when it picks
            // "nothing" inside the canvas — if the pointer leaves the canvas
            // directly (e.g. onto the object panel), that pick never fires and
            // the tooltip stays stuck. Clear it explicitly on leave.
            setHoveredArc(null)
            setHoveredDoc(null)
          }}
          style={{
            backgroundColor: "#111", // Protomaps dark bg ile uyumlu
            WebkitBackdropFilter: "none",
            backdropFilter: "none",
            // iOS Safari'de background-attachment: fixed bug'ını önle
            backgroundAttachment: 'fixed',
            // iOS Safari tespiti için user agent kontrolü
            ...(typeof window !== 'undefined' && /iP(ad|hone|od)/.test(navigator.userAgent)
              ? { backgroundColor: '#111', backgroundImage: 'none' } : {})
          }}
        />

        {/* Map attribution */}
        <div className="absolute bottom-1 right-1 z-10 text-[9px] text-white/20 px-1.5 py-0.5 rounded">
          <span><a href="https://protomaps.com" target="_blank" rel="noopener noreferrer" className="hover:underline">Protomaps</a> | © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="hover:underline">OpenStreetMap contributors</a></span>
        </div>

        {/* Loading overlay */}
        {!mapLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/50">
            <Spinner size="2" />
          </div>
        )}

        {children}

        {/* Arc hover tooltip */}
        {hoveredArc && (
          <div
            ref={arcTooltipRef}
            className="absolute bg-white p-3 rounded-xl text-sm z-50 pointer-events-none border shadow-lg"
            style={{ left: arcTooltipPosRef.current.x + 10, top: arcTooltipPosRef.current.y + 10, maxWidth: "300px" }}
          >
            {/* Same terms as the artifact panel: "to" is a place, the museum is the collection. */}
            {(() => {
              const known = institutionPlace(hoveredArc.toName)
              const toPlace = hoveredArc.toCity || known?.city || ""
              const toCountry = hoveredArc.toCountry || known?.country || ""
              const city = hoveredArc.fromCity && hoveredArc.fromCity.toLowerCase() !== hoveredArc.fromName.toLowerCase() ? hoveredArc.fromCity : null
              const country = hoveredArc.fromCountry && hoveredArc.fromCountry.toLowerCase() !== hoveredArc.fromName.toLowerCase() ? hoveredArc.fromCountry : null
              const fromSub = city && country ? `${city}, ${country}` : city || country
              return (
                <>
                  <div className="mb-1" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", columnGap: "1rem" }}>
                    <div className="min-w-0">
                      <span className="text-muted-foreground mr-2">From:</span>
                      <span className="text-foreground">{hoveredArc.fromName}</span>
                      {/* Former name after the present-day one: "Al-Shirqat (Assur)" */}
                      {hoveredArc.fromHistorical && hoveredArc.fromHistorical.toLowerCase() !== hoveredArc.fromName.toLowerCase() && (
                        <span className="text-muted-foreground"> ({hoveredArc.fromHistorical})</span>
                      )}
                      {fromSub && <div className="text-[10px] text-muted-foreground">{fromSub}</div>}
                    </div>
                    {toPlace && (
                      <div className="min-w-0">
                        <span className="text-muted-foreground mr-2">To:</span>
                        <span className="text-foreground">{toPlace}</span>
                        {toCountry && toCountry.toLowerCase() !== toPlace.toLowerCase() && (
                          <div className="text-[10px] text-muted-foreground">{toCountry}</div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="mb-1">
                    <span className="text-muted-foreground mr-2">Collection:</span>
                    <span className="text-foreground">{hoveredArc.toName}</span>
                  </div>
                </>
              )
            })()}
            <div>
              <span className="text-muted-foreground mr-2">{hoveredArc.count === 1 ? "Artifact:" : "Artifacts:"}</span>
              <span className="text-foreground">
                {hoveredArc.count}
              </span>
            </div>
          </div>
        )}

        {/* Wikipedia document hover tooltip */}
        {hoveredDoc && !selectedDoc && (
          <div
            className="absolute bg-white p-2 rounded-[10px] text-sm z-50 pointer-events-none border shadow-lg"
            style={{ left: hoveredDoc.x + 10, top: hoveredDoc.y + 10, maxWidth: "280px" }}
          >
            <div className="font-medium text-foreground mb-1">{hoveredDoc.title}</div>
            {hoveredDoc.count && hoveredDoc.count > 1 && (
              <div className="text-sm text-muted-foreground mt-1">{hoveredDoc.count} articles</div>
            )}
            <div className="text-[10px] text-indigo-500 mt-1">Click to view</div>
          </div>
        )}

        {/* Wikipedia document click popup */}
        {selectedDoc && (
          <div
            className="absolute bg-white rounded-2xl text-sm z-50 border shadow-xl overflow-hidden"
            style={{
              left: Math.min(selectedDoc.x, (typeof window !== 'undefined' ? window.innerWidth - 320 : 400)),
              top: Math.min(selectedDoc.y - 10, (typeof window !== 'undefined' ? window.innerHeight - 380 : 400)),
              width: "300px",
            }}
          >
            {/* Close button */}
            <button
              onClick={() => setSelectedDoc(null)}
              className="absolute top-2 right-2 z-10 w-6 h-6 flex items-center justify-center rounded-full bg-white/80 hover:bg-white text-gray-500 hover:text-gray-800 transition-colors"
            >
              ×
            </button>
            {/* Image */}
            {selectedDoc.img_url && (
              <div className="w-full h-40  bg-blue-50 flex items-center justify-center overflow-hidden">
                <img
                  src={resolveImageSrc(selectedDoc.img_url)}
                  alt={selectedDoc.title}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
            )}
            {/* Content */}
            <div className="p-3">
              <div className="font-medium text-foreground leading-snug mb-1">{selectedDoc.title}</div>
              {selectedDoc.description && (
                <div className="text-sm text-muted-foreground line-clamp-3 mb-2 leading-relaxed">{selectedDoc.description}</div>
              )}
              <div className="flex items-center justify-between mt-2">
                <span className="text-[10px] text-gray-500">{selectedDoc.source_name}</span>
                {selectedDoc.source_url && (
                  <button
                    onClick={() => window.open(selectedDoc.source_url, '_blank', 'noopener,noreferrer')}
                    className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
                  >
                    Open article ↗
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ════════════ HEADER PANEL (top-left) — desktop only ════════════ */}
        {!isMobile && (
        <div className="absolute top-10 left-10 bottom-10 sm:w-80 z-20 pointer-events-none">
        <div className={`bg-white rounded-2xl shadow-lg flex flex-col relative pointer-events-auto max-h-full ${showArcs || showTime || showCollections ? "h-full" : ""}`}>
          {/* ── Breadcrumb header with controls ── */}
          {/* Same row as the object panel's count row (pt-2 + py-1, 32px tall, leading-normal),
              so "Ex Situ" and "N artifacts" sit on one baseline. */}
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            {/* Breadcrumb */}
            <div className="flex items-center min-h-8 min-w-0 flex-1 overflow-hidden text-sm leading-normal text-black">
              {breadcrumb.map((seg, i) => {
                const isLast = i === breadcrumb.length - 1
                return (
                  <Fragment key={i}>
                    {i > 0 && <span className="text-black/30 px-1 flex-shrink-0">/</span>}
                    {isLast ? (
                      <span className="font-medium truncate min-w-0" title={seg.label}>{seg.label}</span>
                    ) : (
                      <button
                        className="hover:underline transition-colors whitespace-nowrap flex-shrink-0 text-left"
                        onClick={() => onBreadcrumbClick?.(seg.level)}
                      >
                        {seg.label}
                      </button>
                    )}
                  </Fragment>
                )
              })}
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" title="About" aria-label="About">
                  <Info className="w-5 h-5 text-gray-500" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 rounded-xl text-[13px] leading-normal text-[#333]">
                <AboutText />
              </PopoverContent>
            </Popover>
          </div>
          <div className="px-4 pb-2">
            <SearchBar onOpen={() => onCommandPaletteOpen?.()} />
          </div>

          {/* ── Artifact count (only when object container is closed) ── */}
          {!isObjectContainerVisible && (
            <div className="px-4 pb-1">
              <span className="text-sm text-gray-700 block">
                {totalCount} artifact{totalCount !== 1 ? "s" : ""}{locationName ? ` from ${locationName}` : ""}
              </span>
              {closedResolvedPlaceName && (
                <span style={{ color: '#444', fontSize: '10px', fontFamily: 'var(--font-mono, ui-monospace, monospace)' }} className="block truncate">
                  resolved → {closedResolvedPlaceName}
                </span>
              )}
            </div>
          )}

          <TooltipProvider delayDuration={150}>
          <div className="px-4 pb-3 text-sm flex-1 min-h-0 overflow-y-auto">
            {/* ── Places Section (drill-down) — header renders unconditionally
                (like Time/Collections) so it appears during the loading window
                instead of popping in only once groupedOrigins is non-empty. ── */}
            {drillLevel === "global" && (
              <div className="pt-0 mt-1">
                <div className="flex items-center justify-between">
                  <span className="panel-text-muted">
                    Places
                  </span>
                  <Button variant="ghost" size="icon" className="h-8 w-8 flex items-center justify-center"
                    onClick={() => setShowArcs(!showArcs)}
                    title={showArcs ? "Collapse Places" : "Expand Places"}
                    aria-label={showArcs ? "Collapse Places" : "Expand Places"}
                  >
                    {showArcs ? <ChevronUp className="h-5 w-5 text-gray-500" /> : <ChevronDown className="h-5 w-5 text-gray-500" />}
                  </Button>
                </div>

                {showArcs && (
                  <div className="mt-1">
                    <HeaderAccordionList>
                      {groupedOrigins.map((origin, index) => (
                          <div key={index} className="flex justify-between cursor-pointer hover:bg-gray-50 rounded-md px-1 py-0.5"
                            onClick={() => onOriginClick?.(origin.country, origin.lat, origin.lng)}
                            {...listHoverProps("country", origin.country)}
                          >
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="truncate max-w-[70%]">{origin.country}</span>
                              </TooltipTrigger>
                              <TooltipContent side="top">{origin.country}</TooltipContent>
                            </Tooltip>
                            <span className="ml-2 text-gray-500 text-sm">{origin.totalCount}</span>
                          </div>
                      ))}
                    </HeaderAccordionList>
                  </div>
                )}
              </div>
            )}

            {/* ── Sites Section (country drill-down) — hidden when there is nothing to list ── */}
            {drillLevel !== "global" && (groupedSites.length > 0 || isLoadingSubArcs) && (
              <div className="pt-0 mt-1">
                <div className="flex items-center justify-between">
                  <span className="panel-text-muted">
                    Sites
                    {isLoadingSubArcs && <Spinner className="ml-2 h-3 w-3 inline-block" />}
                  </span>
                  <Button variant="ghost" size="icon" className="h-8 w-8 flex items-center justify-center"
                    onClick={() => setShowArcs(!showArcs)}
                    title={showArcs ? "Collapse Sites" : "Expand Sites"}
                    aria-label={showArcs ? "Collapse Sites" : "Expand Sites"}
                  >
                    {showArcs ? <ChevronUp className="h-5 w-5 text-gray-500" /> : <ChevronDown className="h-5 w-5 text-gray-500" />}
                  </Button>
                </div>

                {showArcs && (
                  <div className="mt-1 pl-0">
                    <HeaderAccordionList>
                      {groupedSites.map((site, index) => (
                        <Fragment key={index}>
                        <div
                          className={`flex justify-between cursor-pointer hover:bg-gray-50 rounded-md px-1 py-0.5 ${activeSite === site.name ? "bg-gray-100" : ""}`}
                          onClick={() => onToggleSite?.(site.name, site.lat, site.lng)}
                          {...listHoverProps("site", site.name)}
                        >
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="truncate max-w-[70%]">{siteLabels.get(site.name) ?? site.name}</span>
                            </TooltipTrigger>
                            <TooltipContent side="top">{site.name}</TooltipContent>
                          </Tooltip>
                          <span className="ml-2 text-gray-500 text-sm">{site.totalCount}</span>
                        </div>
                        {activeSite === site.name && (
                          <PrecisePlaceRows places={precisePlaces} active={activePrecise} onToggle={onTogglePrecise} padX="px-1" />
                        )}
                        </Fragment>
                      ))}
                    </HeaderAccordionList>
                  </div>
                )}
              </div>
            )}

            {/* ── Time Section — shown at all drill levels, above Collections (if any dated objects) ── */}
            {dateBuckets && (dateBuckets.objectDateBuckets.some((b) => b.count > 0) || (dateBuckets.objectDateSpans?.length ?? 0) > 0) && (
              <div className="pt-0 mt-1">
                <div className="flex items-center justify-between">
                  <span className="panel-text-muted">
                    Time
                  </span>
                  <Button variant="ghost" size="icon" className="h-8 w-8 flex items-center justify-center"
                    onClick={() => setShowTime(!showTime)}
                    title={showTime ? "Collapse Time" : "Expand Time"}
                    aria-label={showTime ? "Collapse Time" : "Expand Time"}
                  >
                    {showTime ? <ChevronUp className="h-5 w-5 text-gray-500" /> : <ChevronDown className="h-5 w-5 text-gray-500" />}
                  </Button>
                </div>
                {showTime && (
                  <div className="mt-1 pl-0">
                    <HeaderAccordionList>
                      {dateBuckets && collapseContiguousBuckets(
                          ERA_BUCKETS,
                          Object.fromEntries(dateBuckets.objectDateBuckets.map((b) => [b.id, b.count])),
                          dateBuckets.objectDateSpans,
                        )
                        // Hide empty buckets now that we have a real (non-null) result.
                        .filter((row) => row.count > 0)
                        .map((row) => (
                          <div key={row.id}
                            className={`flex justify-between cursor-pointer hover:bg-gray-50 rounded-md px-1 py-0.5 ${facetedFilters.era?.id === row.id ? "bg-gray-100" : ""}`}
                            onClick={() => toggleEra(row.era)}
                          >
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="truncate max-w-[70%]">{row.label}</span>
                              </TooltipTrigger>
                              <TooltipContent side="top">{row.label}</TooltipContent>
                            </Tooltip>
                            <span className="ml-2 text-gray-500 text-sm">{row.count}</span>
                          </div>
                        ))}
                    </HeaderAccordionList>
                  </div>
                )}
              </div>
            )}

            {/* ── Institutions Section — shown at all drill levels (if any) ── */}
            {(drillInstitutions.length > 0 || isLoadingSubArcs) && (
              <div className="pt-0 mt-1">
                <div className="flex items-center justify-between">
                  <span className="panel-text-muted">
                    Collections
                    {isLoadingSubArcs && <Spinner className="ml-2 h-3 w-3 inline-block" />}
                  </span>
                  <Button variant="ghost" size="icon" className="h-8 w-8 flex items-center justify-center"
                    onClick={() => setShowCollections(!showCollections)}
                    title={showCollections ? "Collapse Collections" : "Expand Collections"}
                    aria-label={showCollections ? "Collapse Collections" : "Expand Collections"}
                  >
                    {showCollections ? <ChevronUp className="h-5 w-5 text-gray-500" /> : <ChevronDown className="h-5 w-5 text-gray-500" />}
                  </Button>
                </div>
                {showCollections && (
                  <div className="mt-1 pl-0">
                    <HeaderAccordionList>
                      {drillInstitutions.map((inst, index) => (
                        <div key={index}
                          className={`flex justify-between cursor-pointer hover:bg-gray-50 rounded-md px-1 py-0.5 ${activeInstitution === inst.name ? "bg-gray-100" : ""}`}
                          onClick={() => onToggleInstitution?.(inst.name)}
                          {...listHoverProps("institution", inst.name)}
                        >
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="truncate max-w-[70%]">{inst.name}</span>
                            </TooltipTrigger>
                            <TooltipContent side="top">{inst.name}</TooltipContent>
                          </Tooltip>
                          <span className="ml-2 text-gray-500 text-sm">{inst.count}</span>
                        </div>
                      ))}
                    </HeaderAccordionList>
                  </div>
                )}
              </div>
            )}

          </div>
          </TooltipProvider>
        </div>
        </div>
        )}
      </div>
    )
  },
)

MapView.displayName = "MapView"

export default MapView

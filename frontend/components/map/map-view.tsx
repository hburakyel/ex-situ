"use client"
import "maplibre-gl/dist/maplibre-gl.css"

import type React from "react"
import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle, useMemo, Fragment } from "react"
import maplibregl from "maplibre-gl"
import { Protocol } from "pmtiles"
import { MapboxOverlay } from "@deck.gl/mapbox"
import type { MuseumObject, MapBounds, SelectedArc } from "../../types"
import debounce from "lodash/debounce"
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react"
import { ExclamationTriangleIcon, ReloadIcon } from "@radix-ui/react-icons"
import { IconSearch, IconPanelOpen, IconPanelClosed, iconSvgStrings } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { ArcLayer, ScatterplotLayer } from "@deck.gl/layers"
import { Spinner } from "@/components/ui/spinner"
import { useGeospatialData, type GeospatialFilters as FilterState } from "@/hooks/use-geospatial-data"
import { useSpatialDocuments } from "@/hooks/use-spatial-documents"
import { useArcWorker, type ArcDatum } from "@/hooks/use-arc-worker"
import { cn } from "@/lib/utils"
import { useMediaQuery } from "@/hooks/use-media-query"
import { WIKIPEDIA_COLLECTION, ENABLE_WIKIPEDIA } from "@/components/faceted-filter"
import { protomapsDarkStyle } from "@/lib/protomaps-dark-style"

// Register PMTiles protocol adapter so MapLibre can read .pmtiles files directly
let pmtilesRegistered = false
if (typeof window !== "undefined" && !pmtilesRegistered) {
  const protocol = new Protocol()
  maplibregl.addProtocol("pmtiles", protocol.tile)
  pmtilesRegistered = true
}



// Re-export for parent
export type FacetedFilters = { institutions: string[]; countries: string[]; cities: string[] }

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
  toggleObjectContainerVisibility: () => void
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
  activeSite?: string | null
  activeInstitution?: string | null
  onToggleSite?: (site: string, lat?: number, lng?: number) => void
  onToggleInstitution?: (inst: string) => void
  isLoadingSubArcs?: boolean
  onCommandPaletteOpen?: () => void
  onWikiDocumentsChange?: (docs: any[]) => void
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
      toggleObjectContainerVisibility,
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
      activeSite = null,
      activeInstitution = null,
      onToggleSite,
      onToggleInstitution,
      isLoadingSubArcs = false,
      onCommandPaletteOpen,
      onWikiDocumentsChange,
    },
    ref,
  ) => {
    const mapContainer = useRef<HTMLDivElement>(null)
    const map = useRef<maplibregl.Map | null>(null)
    const lastBounds = useRef<MapBounds | null>(null)
    const deckOverlay = useRef<MapboxOverlay | null>(null)
    const [mapError, setMapError] = useState<string | null>(null)
    const [currentZoom, setCurrentZoom] = useState(2)
    const currentZoomRef = useRef(2)
    const [isMapReady, setIsMapReady] = useState(false)
    const initialBoundsSet = useRef(false)
    const prevViewStateRef = useRef(initialViewState)
    const [mapLoaded, setMapLoaded] = useState(false)
    const isMobile = useMediaQuery("(max-width: 768px)")

    // Old UI state
    const [showArcs, setShowArcs] = useState(true)
    const [showCollections, setShowCollections] = useState(true)
    const [hoveredArc, setHoveredArc] = useState<{
      fromName: string; toName: string; count: number
      fromCity?: string; fromCountry?: string
      toCity?: string; toCountry?: string
      x: number; y: number
    } | null>(null)

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

    const [isRateLimited, setIsRateLimited] = useState(false)

    // ── New backend: geospatial data pipeline ──
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
    }), [facetedFilters.institutions.join(','), facetedFilters.countries.join(','), facetedFilters.cities.join(',')])

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
      flyToLocation: (lng: number, lat: number, zoom: number = 10, duration: number = 800) => {
        if (map.current) {
          isProgrammaticMove.current = true
          setViewportState({ longitude: lng, latitude: lat, zoom })
          lastViewRef.current = { lng, lat, zoom }
          prevViewStateRef.current = { longitude: lng, latitude: lat, zoom } as any
          map.current.flyTo({ center: [lng, lat], zoom, essential: true, duration })
        }
      },
    }))

    // ── Animate helper ──
    const animateToZoomLevel = useCallback(
      (center: [number, number], targetZoom: number, options: { mode?: "level-shift" | "detail"; duration?: number; onComplete?: () => void } = {}) => {
        if (!map.current) return
        isProgrammaticMove.current = true
        setViewportState({ longitude: center[0], latitude: center[1], zoom: targetZoom })
        lastViewRef.current = { lng: center[0], lat: center[1], zoom: targetZoom }
        const mode = options.mode ?? "level-shift"
        const duration = options.duration ?? (mode === "detail" ? 1200 : 1600)
        const easingFn = mode === "detail"
          ? (t: number) => 1 - Math.pow(1 - t, 2.2)
          : (t: number) => 1 - Math.pow(1 - t, 3.2)
        map.current.easeTo({ center, zoom: targetZoom, duration, easing: easingFn, essential: true })
      },
      [],
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
        const wasProgrammatic = isProgrammaticMove.current
        if (wasProgrammatic) { isProgrammaticMove.current = false }
        setSelectedDoc(null)
        const center = mapInstance.getCenter()
        const zoom = mapInstance.getZoom()
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
        setCurrentZoom(newZoom)
        currentZoomRef.current = newZoom
        onZoomChangeRef.current?.(newZoom)
      })

      // Nav controls – read media query synchronously so the value is correct
      // even if the React `isMobile` hook hasn't hydrated yet.
      const mobileNow = typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches
      const controlPosition = mobileNow ? "top-right" : "bottom-left"
      const ctrlPrefix = "maplibregl"
      // Info control
      class InfoControl {
        _container: HTMLDivElement | null = null; _popup: HTMLDivElement | null = null; _closeFn: ((ev: MouseEvent) => void) | null = null
        onAdd() {
          this._container = document.createElement("div")
          this._container.className = `${ctrlPrefix}-ctrl ${ctrlPrefix}-ctrl-group`
          const btn = document.createElement("button")
          btn.className = `${ctrlPrefix}-ctrl-icon`
          btn.setAttribute("aria-label", "About")
          btn.innerHTML = '<svg width="24" height="24" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7.5 1C3.91 1 1 3.91 1 7.5S3.91 14 7.5 14 14 11.09 14 7.5 11.09 1 7.5 1Zm0 1a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Zm-.5 3h1v1h-1V5Zm0 2h1v4h-1V7Z" fill="currentColor"/></svg>'
          btn.addEventListener("click", (e) => {
            e.stopPropagation()
            if (this._popup) { this._popup.remove(); this._popup = null; return }
            const rect = btn.getBoundingClientRect()
            this._popup = document.createElement("div")
            this._popup.style.cssText = `position:fixed;background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.12);padding:14px 16px;width:220px;font-family:system-ui,sans-serif;z-index:9999;font-size:13px;line-height:1.5;color:#333`
            if (mobileNow) {
              this._popup.style.top = `${rect.top}px`
              this._popup.style.right = `${window.innerWidth - rect.left + 8}px`
            } else {
              this._popup.style.bottom = `${window.innerHeight - rect.bottom}px`
              this._popup.style.left = `${rect.right + 8}px`
            }
            this._popup.innerHTML = `
              <div style="font-weight:600;margin-bottom:6px;font-size:14px;color:#000">Ex Situ</div>
              <div style="margin-bottom:10px;color:#555">any hyperlink that implies a location can be resolved, indexed, and made part of the Ex Situ spatial commons.</div>
              <div style="display:flex;flex-direction:column;gap:6px">
                <a href="https://github.com/hburakyel/ex-situ" target="_blank" rel="noopener noreferrer" style="color:#333;text-decoration:none;display:flex;align-items:center;gap:6px">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .3a12 12 0 0 0-3.8 23.38c.6.12.83-.26.83-.57L9 21.07c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.08-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.49 1 .1-.78.42-1.3.76-1.6-2.67-.31-5.47-1.34-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6.02 0c2.28-1.55 3.29-1.23 3.29-1.23.64 1.66.24 2.88.12 3.18a4.65 4.65 0 0 1 1.23 3.22c0 4.61-2.8 5.62-5.48 5.92.42.36.81 1.1.81 2.22l-.01 3.29c0 .31.2.69.82.57A12 12 0 0 0 12 .3"/></svg>
                  GitHub
                </a>
              </div>
            `
            const close = (ev: MouseEvent) => {
              if (this._popup && !this._popup.contains(ev.target as Node) && ev.target !== btn) {
                this._popup.remove(); this._popup = null; document.removeEventListener("click", close); this._closeFn = null
              }
            }
            this._closeFn = close
            setTimeout(() => document.addEventListener("click", close), 0)
            document.body.appendChild(this._popup)
          })
          this._container.appendChild(btn)
          return this._container
        }
        onRemove() { if (this._popup) { this._popup.remove(); this._popup = null }; if (this._closeFn) { document.removeEventListener("click", this._closeFn); this._closeFn = null }; if (this._container?.parentNode) this._container.parentNode.removeChild(this._container) }
      }

      // Globe view control
      class GlobeViewControl {
        _map: any = null; _container: HTMLDivElement | null = null
        onAdd(map: any) {
          this._map = map
          this._container = document.createElement("div")
          this._container.className = `${ctrlPrefix}-ctrl ${ctrlPrefix}-ctrl-group`
          const btn = document.createElement("button")
          btn.className = `${ctrlPrefix}-ctrl-icon`
          btn.setAttribute("aria-label", "Global View")
          btn.innerHTML = '<svg width="24" height="24" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7.49996 1.80002C4.35194 1.80002 1.79996 4.352 1.79996 7.50002C1.79996 10.648 4.35194 13.2 7.49996 13.2C10.648 13.2 13.2 10.648 13.2 7.50002C13.2 4.352 10.648 1.80002 7.49996 1.80002ZM0.899963 7.50002C0.899963 3.85494 3.85488 0.900024 7.49996 0.900024C11.145 0.900024 14.1 3.85494 14.1 7.50002C14.1 11.1451 11.145 14.1 7.49996 14.1C3.85488 14.1 0.899963 11.1451 0.899963 7.50002Z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"></path><path d="M13.4999 7.89998H1.49994V7.09998H13.4999V7.89998Z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"></path><path d="M7.09991 13.5V1.5H7.89991V13.5H7.09991zM10.375 7.49998C10.375 5.32724 9.59364 3.17778 8.06183 1.75656L8.53793 1.24341C10.2396 2.82218 11.075 5.17273 11.075 7.49998 11.075 9.82724 10.2396 12.1778 8.53793 13.7566L8.06183 13.2434C9.59364 11.8222 10.375 9.67273 10.375 7.49998zM3.99969 7.5C3.99969 5.17611 4.80786 2.82678 6.45768 1.24719L6.94177 1.75281C5.4582 3.17323 4.69969 5.32389 4.69969 7.5 4.6997 9.67611 5.45822 11.8268 6.94179 13.2472L6.45769 13.7528C4.80788 12.1732 3.9997 9.8239 3.99969 7.5z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"></path></svg>'
          btn.addEventListener("click", () => {
            // Trigger parent's breadcrumb "global" handler to clear drill state
            onBreadcrumbClickRef.current?.("global" as any)
          })
          this._container.appendChild(btn)
          return this._container
        }
        onRemove() { if (this._container?.parentNode) this._container.parentNode.removeChild(this._container); this._map = null }
      }

      if (showControls) {
        mapInstance.addControl(new GlobeViewControl(), controlPosition)
        mapInstance.addControl(new InfoControl(), controlPosition)
        mapInstance.addControl(new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), controlPosition)
      }

      window.addEventListener("resize", handleResize)
      map.current = mapInstance

      return () => {
        window.removeEventListener("resize", handleResize)
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
            if (mapRef) animateToZoomLevel([d.longitude || 0, d.latitude || 0], Math.min((mapRef.getZoom() || 2) + 3, 12), { mode: 'level-shift', duration: 900 })
            return
          }
          const wikiTitle = d.title || d.sample_title || ''
          const inferredUrl = d.source_url || (wikiTitle ? `https://en.wikipedia.org/wiki/${encodeURIComponent(wikiTitle.replace(/ /g, '_'))}` : undefined)
          setSelectedDoc({ title: wikiTitle || 'Wikipedia', description: d.description, img_url: d.img_url, source_url: inferredUrl, source_name: d.source_name, count: d.doc_count, x: info.x, y: info.y })
        },
      })
    }, [isMapReady, isWikipediaSelected, spatialDocData])

    // Arc layer construction
    const arcLayer = useMemo(() => {
      if (!isMapReady || processedArcs.arcLayerData.length === 0) return null
      const { arcLayerData, dataSource, layerStyle } = processedArcs
      const { sourceColor, targetColor } = layerStyle
      const layerId = dataSource === 'geospatial-country' || dataSource === 'geospatial-city' ? 'arc-layer-geospatial'
        : dataSource === 'geospatial-objects' ? 'arc-layer-objects' : 'arc-layer-fallback'
      const isCountryLevel = dataSource === 'geospatial-country'
      const maxCount = arcLayerData.reduce((m, d) => Math.max(m, d.count), 1)

      return new ArcLayer<ArcDatum>({
        id: layerId,
        data: arcLayerData,
        getSourcePosition: (d) => d.sourcePosition,
        getTargetPosition: (d) => d.targetPosition,
        getSourceColor: (d): [number, number, number, number] => {
          const arcKey = `${d.fromName}-${d.toName}`
          const highlighted = selectedArcRef.current?.key === arcKey || (activeSite && d.fromName === activeSite)
          return highlighted ? [59, 130, 246, 255] : [...sourceColor, 255] as [number, number, number, number]
        },
        getTargetColor: (d): [number, number, number, number] => {
          const arcKey = `${d.fromName}-${d.toName}`
          const highlighted = selectedArcRef.current?.key === arcKey || (activeSite && d.fromName === activeSite)
          return highlighted ? [147, 51, 234, 255] : [...targetColor, 255] as [number, number, number, number]
        },
        getWidth: (d) => {
          const arcKey = `${d.fromName}-${d.toName}`
          const highlighted = selectedArcRef.current?.key === arcKey || (activeSite && d.fromName === activeSite)
          const baseWidth = dataSource === 'geospatial-country' || dataSource === 'geospatial-city'
            ? Math.max(0.5, Math.min(3, 0.5 + Math.log(d.count + 1) * 0.45))
            : Math.max(2, Math.min(6, 2 + Math.log(d.count + 1) * 0.9))
          return highlighted ? baseWidth * 2.5 : baseWidth
        },
        widthMinPixels: isMobile ? 2.5 : 1.5,
        pickable: true,
        autoHighlight: true,
        highlightColor: [59, 130, 246],
        transitions: { getSourceColor: { duration: 300 }, getTargetColor: { duration: 300 }, getWidth: { duration: 300 } },
        updateTriggers: {
          getSourceColor: [selectedArc?.key, activeSite], getTargetColor: [selectedArc?.key, activeSite], getWidth: [selectedArc?.key, activeSite],
        },
        onHover: (info: any) => {
          if (info.object) {
            const d = info.object
            setHoveredArc({ fromName: d.fromName, toName: d.toName, count: d.count, fromCity: d.fromCity, fromCountry: d.fromCountry, toCity: d.toCity, toCountry: d.toCountry, x: info.x, y: info.y })
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
          onSelectArcRef.current?.({
            key: arcKey, from: d.fromName, to: d.toName, fromLat: lat, fromLng: lng,
            fromCity: d.fromCity, fromCountry: d.fromCountry, toCity: d.toCity, toCountry: d.toCountry, objectCount: d.count,
          })
          isProgrammaticMove.current = true
          const mapRef = map.current
          if (!mapRef) return
          // panelVisible: true — the panel is guaranteed to be shown
          // after onSelectArc (even if the batched state hasn't committed yet)
          if (info.layer.id === 'arc-layer-geospatial') {
            const curZ = mapRef.getZoom()
            if (curZ < 4) animateToZoomLevel([lng, lat], 5, { mode: 'level-shift', duration: 950 })
            else animateToZoomLevel([lng, lat], 6, { mode: 'level-shift', duration: 900 })
          } else if (info.layer.id === 'arc-layer-objects') {
            animateToZoomLevel([lng, lat], 14, { mode: 'detail', duration: 800 })
          } else {
            animateToZoomLevel([lng, lat], 5, { mode: 'level-shift', duration: 950 })
          }
        },
      })
    }, [processedArcs, isMapReady, selectedArc?.key, isMobile, activeSite])

    // Derived values from processedArcs
    const { arcCards, uniqueArcsCount } = useMemo(() => ({
      arcCards: processedArcs.arcCards,
      uniqueArcsCount: processedArcs.uniqueArcCount,
    }), [processedArcs])

    const layers = useMemo(() => {
      if (!isMapReady) return []
      const result: any[] = []
      if (arcLayer) result.push(arcLayer)
      if (wikiLayer) result.push(wikiLayer)
      return result
    }, [isMapReady, arcLayer, wikiLayer])

    // Push layers to MapboxOverlay
    useEffect(() => {
      if (!deckOverlay.current || !isMapReady) return
      try { deckOverlay.current.setProps({ layers }) } catch (e) {}
    }, [layers, isMapReady])

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
        <div ref={mapContainer} className="h-full w-full" suppressHydrationWarning />

        {/* Map attribution */}
        <div className="absolute bottom-1 right-1 z-10 text-[9px] text-gray-600/40 px-1.5 py-0.5 rounded">
          <span><a href="https://protomaps.com" target="_blank" rel="noopener noreferrer" className="hover:underline">Protomaps</a> | © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="hover:underline">OpenStreetMap contributors</a></span>
        </div>

        {/* Loading overlay */}
        {!mapLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/50">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}

        {children}

        {/* Arc hover tooltip */}
        {hoveredArc && (
          <div
            className="absolute bg-white p-2 rounded-[10px] text-sm z-50 pointer-events-none border shadow-lg"
            style={{ left: hoveredArc.x + 10, top: hoveredArc.y + 10, maxWidth: "300px" }}
          >
            <div className="mb-1">
              <span className="text-muted-foreground mr-2">From:</span>
              <span className="text-foreground">{hoveredArc.fromName}</span>
              {(hoveredArc.fromCity || hoveredArc.fromCountry) && (
                (() => {
                  const city = hoveredArc.fromCity && hoveredArc.fromCity.toLowerCase() !== hoveredArc.fromName.toLowerCase() ? hoveredArc.fromCity : null
                  const country = hoveredArc.fromCountry && hoveredArc.fromCountry.toLowerCase() !== hoveredArc.fromName.toLowerCase() ? hoveredArc.fromCountry : null
                  const sub = city && country ? `${city}, ${country}` : city || country
                  return sub ? <div className="text-[10px] text-muted-foreground">{sub}</div> : null
                })()
              )}
            </div>
            <div className="mb-1">
              <span className="text-muted-foreground mr-2">To:</span>
              <span className="text-foreground">{hoveredArc.toName}</span>
              {(hoveredArc.toCity || hoveredArc.toCountry) && (
                (() => {
                  const city = hoveredArc.toCity && hoveredArc.toCity.toLowerCase() !== hoveredArc.toName.toLowerCase() ? hoveredArc.toCity : null
                  const country = hoveredArc.toCountry && hoveredArc.toCountry.toLowerCase() !== hoveredArc.toName.toLowerCase() ? hoveredArc.toCountry : null
                  const sub = city && country ? `${city}, ${country}` : city || country
                  return sub ? <div className="text-[10px] text-muted-foreground">{sub}</div> : null
                })()
              )}
            </div>
            <div>
              <span className="text-muted-foreground mr-2">Count:</span>
              <span className="text-foreground">
                {hoveredArc.count} artifact{hoveredArc.count !== 1 ? "s" : ""}
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
                  src={selectedDoc.img_url}
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
                <span className="text-[10px] text-gray-400">{selectedDoc.source_name}</span>
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
        <div className="absolute top-10 left-10 sm:w-80 z-20">
        <div className="bg-white rounded-2xl shadow-lg flex flex-col relative">
          {/* ── Breadcrumb header with controls ── */}
          <div className="flex items-center justify-between px-4 pt-2 pb-2">
            {/* Breadcrumb */}
            <div className="flex items-center min-w-0 flex-1 overflow-hidden text-sm text-black">
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
            {/* Controls */}
            <div className="flex items-center gap-2 ml-2">
              {/* Objects panel toggle */}
              <Button
                onClick={toggleObjectContainerVisibility}
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title="Toggle objects panel"
              >
                {isObjectContainerVisible ? (
                  <IconPanelOpen className="h-5 w-5 text-gray-500" />
                ) : (
                  <IconPanelClosed className="h-5 w-5 text-gray-500" />
                )}
              </Button>
              {/* Search */}
              <Button variant="ghost" size="icon" className="h-8 w-8"
                onClick={() => onCommandPaletteOpen?.()}
                title="Search (⌘K)"
              >
                <IconSearch className="w-5 h-5" />
              </Button>
            </div>
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

          <div className="px-4 pb-3 text-sm">
            {/* ── Places Section (drill-down) ── */}
            {drillLevel === "global" && groupedOrigins.length > 0 && (
              <div className="pt-0 mt-1">
                <div className="flex items-center justify-between">
                  <span className="panel-text-muted">
                    Places
                    {isLoadingOrigins && <Spinner className="ml-2 h-3 w-3 inline-block" />}
                  </span>
                  <Button variant="ghost" size="icon" className="h-8 w-8 flex items-center justify-center"
                    onClick={() => setShowArcs(!showArcs)}
                  >
                    {showArcs ? <ChevronUp className="h-5 w-5 text-gray-500" /> : <ChevronDown className="h-5 w-5 text-gray-500" />}
                  </Button>
                </div>

                {showArcs && (
                  <div className="mt-1">
                    <div className="space-y-0.5 max-h-40 overflow-y-auto pr-1">
                      {groupedOrigins.map((origin, index) => (
                          <div key={index} className="flex justify-between cursor-pointer hover:bg-gray-50 rounded-md px-1 py-0.5"
                            onClick={() => onOriginClick?.(origin.country, origin.lat, origin.lng)}
                          >
                            <span className="truncate max-w-[70%]">{origin.country}</span>
                            <span className="ml-2 text-gray-400 text-sm">{origin.totalCount}</span>
                          </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Sites Section (country drill-down) ── */}
            {drillLevel !== "global" && groupedSites.length > 0 && (
              <div className="pt-0 mt-1">
                <div className="flex items-center justify-between">
                  <span className="panel-text-muted">
                    Sites
                    {isLoadingSubArcs && <Spinner className="ml-2 h-3 w-3 inline-block" />}
                  </span>
                  <Button variant="ghost" size="icon" className="h-8 w-8 flex items-center justify-center"
                    onClick={() => setShowArcs(!showArcs)}
                  >
                    {showArcs ? <ChevronUp className="h-5 w-5 text-gray-500" /> : <ChevronDown className="h-5 w-5 text-gray-500" />}
                  </Button>
                </div>

                {showArcs && (
                  <div className="mt-1 pl-0">
                    <div className="space-y-0.5 max-h-40 overflow-y-auto pr-1">
                      {groupedSites.map((site, index) => (
                        <div key={index}
                          className={`flex justify-between cursor-pointer hover:bg-gray-50 rounded-md px-1 py-0.5 ${activeSite === site.name ? "bg-gray-100" : ""}`}
                          onClick={() => onToggleSite?.(site.name, site.lat, site.lng)}
                        >
                          <span className="truncate max-w-[70%]">{site.name}</span>
                          <span className="ml-2 text-gray-400 text-sm">{site.totalCount}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Institutions Section (country drill-down) ── */}
            {drillLevel !== "global" && drillInstitutions.length > 0 && (
              <div className="pt-0 mt-1">
                <div className="flex items-center justify-between">
                  <span className="panel-text-muted">
                    Collections
                  </span>
                  <Button variant="ghost" size="icon" className="h-8 w-8 flex items-center justify-center"
                    onClick={() => setShowCollections(!showCollections)}
                  >
                    {showCollections ? <ChevronUp className="h-5 w-5 text-gray-500" /> : <ChevronDown className="h-5 w-5 text-gray-500" />}
                  </Button>
                </div>
                {showCollections && (
                  <div className="mt-1 pl-0">
                    <div className="space-y-0.5 max-h-40 overflow-y-auto pr-1">
                      {drillInstitutions.map((inst, index) => (
                        <div key={index}
                          className={`flex justify-between cursor-pointer hover:bg-gray-50 rounded-md px-1 py-0.5 ${activeInstitution === inst.name ? "bg-gray-100" : ""}`}
                          onClick={() => onToggleInstitution?.(inst.name)}
                        >
                          <span className="truncate max-w-[70%]">{inst.name}</span>
                          <span className="ml-2 text-gray-400 text-sm">{inst.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}


          </div>
        </div>
        </div>
        )}
      </div>
    )
  },
)

MapView.displayName = "MapView"

export default MapView

"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import debounce from "lodash/debounce"
import { fetchGeospatialData } from "@/lib/api"
import type { GeospatialResponse, GeospatialBbox } from "@/types"

export interface ViewState {
  longitude: number
  latitude: number
  zoom: number
}

// Faceted filters support multiple selections per category
export interface GeospatialFilters {
  institutions?: string[]
  countries?: string[]
  cities?: string[]
}

interface UseGeospatialDataOptions {
  /** Debounce delay in milliseconds (default: 300) */
  debounceMs?: number
  /** Whether to automatically fetch on mount (default: true) */
  autoFetch?: boolean
  /** Filters for collection, city, country */
  filters?: GeospatialFilters
}

interface UseGeospatialDataReturn {
  data: GeospatialResponse | null
  loading: boolean
  error: Error | null
  /** Manually trigger a data refresh */
  refresh: () => void
  /** Current zoom level category: 'statistics' | 'clusters' | 'objects' */
  dataType: 'statistics' | 'clusters' | 'objects' | null
}

/**
 * Calculate bounding box from viewport state
 * Uses approximate bounds calculation based on zoom level
 */
function getBoundsFromViewport(viewState: ViewState): GeospatialBbox {
  const { longitude, latitude, zoom } = viewState

  // Calculate approximate viewport size based on zoom
  // At zoom 0, the entire world is visible (~360° longitude, ~180° latitude)
  // Each zoom level halves the visible area
  const latOffset = 90 / Math.pow(2, zoom)
  const lonOffset = 180 / Math.pow(2, zoom)

  return {
    minLon: Math.max(-180, longitude - lonOffset),
    minLat: Math.max(-90, latitude - latOffset),
    maxLon: Math.min(180, longitude + lonOffset),
    maxLat: Math.min(90, latitude + latOffset),
  }
}

/**
 * Get the data type category based on zoom level
 */
function getZoomCategory(zoom: number): 'statistics' | 'clusters' | 'objects' {
  const floorZoom = Math.floor(zoom)
  if (floorZoom < 4) return 'statistics'
  if (floorZoom < 7) return 'clusters'
  return 'objects'
}

/**
 * Hook for fetching geospatial data with zoom-based aggregation
 * Automatically debounces viewport changes and handles caching
 */
export function useGeospatialData(
  viewState: ViewState,
  options: UseGeospatialDataOptions = {}
): UseGeospatialDataReturn {
  const { debounceMs = 300, autoFetch = true, filters } = options

  const [data, setData] = useState<GeospatialResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  // Track previous fetch params to avoid redundant requests
  const lastFetchRef = useRef<{
    zoom: number
    bounds: string
    filtersKey: string
  } | null>(null)

  // Fetch function
  const fetchData = useCallback(async (vs: ViewState, f?: GeospatialFilters) => {
    const floorZoom = Math.floor(vs.zoom)
    const bounds = getBoundsFromViewport(vs)
    const boundsKey = `${bounds.minLon.toFixed(2)},${bounds.minLat.toFixed(2)},${bounds.maxLon.toFixed(2)},${bounds.maxLat.toFixed(2)}`
    // Create stable key from array filters
    const filtersKey = `${(f?.institutions || []).sort().join(',')}:${(f?.countries || []).sort().join(',')}:${(f?.cities || []).sort().join(',')}`

    // Check if this fetch is necessary
    // For zoom < 7 (statistics/clusters), data is global - no bbox needed
    // For zoom >= 7, we need to check if bounds changed significantly
    const currentCategory = getZoomCategory(floorZoom)
    const lastCategory = lastFetchRef.current ? getZoomCategory(lastFetchRef.current.zoom) : null

    // Skip if same category and (for global categories) nothing changed,
    // or (for object level) bounds + filters haven't changed
    if (
      lastFetchRef.current &&
      currentCategory === lastCategory &&
      lastFetchRef.current.filtersKey === filtersKey &&
      (currentCategory !== 'objects' || lastFetchRef.current.bounds === boundsKey)
    ) {
      return
    }

    // Update last fetch ref
    lastFetchRef.current = { zoom: floorZoom, bounds: boundsKey, filtersKey }

    setLoading(true)
    setError(null)

    try {
      // Send bbox only for zoom >= 7 (object level)
      // Zoom < 4: country statistics (global, no bbox needed)
      // Zoom 4-7: city clusters (global, no bbox needed - all arcs visible)
      // Zoom 7+: individual objects (requires bbox)
      const boundsParam = floorZoom >= 7 ? bounds : undefined
      const result = await fetchGeospatialData(floorZoom, boundsParam, f)
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to fetch geospatial data"))
    } finally {
      setLoading(false)
    }
  }, [])

  // Debounced fetch function
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedFetch = useCallback(
    debounce((vs: ViewState, f?: GeospatialFilters) => fetchData(vs, f), debounceMs),
    [fetchData, debounceMs]
  )

  // Track the current zoom category to detect transitions
  const currentCategoryRef = useRef<string | null>(null)
  // Flag to bypass debounce on category transitions (programmatic fly)
  const skipDebounceRef = useRef(false)

  // Track zoom category changes — old data stays visible until new data arrives
  // (clearing data caused arcs to disappear during fly animations)
  useEffect(() => {
    const category = getZoomCategory(Math.floor(viewState.zoom))
    if (currentCategoryRef.current && currentCategoryRef.current !== category) {
      // Category changed — force a fresh fetch by clearing lastFetchRef
      // but keep existing data visible until the new data arrives
      lastFetchRef.current = null
      skipDebounceRef.current = true
    }
    currentCategoryRef.current = category
  }, [viewState.zoom])

  // Create stable filter key to prevent infinite loops
  const filtersKey = useMemo(
    () => JSON.stringify(filters || {}),
    [filters?.institutions, filters?.countries, filters?.cities]
  )

  // Trigger fetch on viewState or filters change
  useEffect(() => {
    if (!autoFetch) return

    // When a zoom category transition occurs (e.g. from programmatic fly),
    // fetch immediately without debounce to minimise arc appearance delay
    if (skipDebounceRef.current) {
      skipDebounceRef.current = false
      debouncedFetch.cancel()
      fetchData(viewState, filters)
    } else {
      debouncedFetch(viewState, filters)
    }

    // Cleanup debounce on unmount
    return () => {
      debouncedFetch.cancel()
    }
  }, [viewState.longitude, viewState.latitude, viewState.zoom, filtersKey, debouncedFetch, autoFetch, fetchData])

  // Manual refresh function
  const refresh = useCallback(() => {
    // Clear last fetch ref to force a new fetch
    lastFetchRef.current = null
    fetchData(viewState, filters)
  }, [fetchData, viewState, filters])

  return {
    data,
    loading,
    error,
    refresh,
    dataType: data?.type || null,
  }
}

export default useGeospatialData

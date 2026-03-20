"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import debounce from "lodash/debounce"
import { fetchSpatialDocuments } from "@/lib/api"
import type { SpatialDocumentResponse, GeospatialBbox } from "@/types"

export interface ViewState {
  longitude: number
  latitude: number
  zoom: number
}

interface UseSpatialDocumentsOptions {
  debounceMs?: number
  autoFetch?: boolean
  contentType?: string
}

interface UseSpatialDocumentsReturn {
  data: SpatialDocumentResponse | null
  loading: boolean
  error: Error | null
  refresh: () => void
  dataType: "document_clusters" | "documents" | null
}

function getBoundsFromViewport(viewState: ViewState): GeospatialBbox {
  const { longitude, latitude, zoom } = viewState
  const latOffset = 90 / Math.pow(2, zoom)
  const lonOffset = 180 / Math.pow(2, zoom)

  return {
    minLon: Math.max(-180, longitude - lonOffset),
    minLat: Math.max(-90, latitude - latOffset),
    maxLon: Math.min(180, longitude + lonOffset),
    maxLat: Math.min(90, latitude + latOffset),
  }
}

function getDocZoomCategory(zoom: number): "document_clusters" | "documents" {
  return Math.floor(zoom) < 7 ? "document_clusters" : "documents"
}

/**
 * Hook for fetching spatial documents (Wikipedia articles, etc.)
 * with zoom-based clustering, debounced viewport tracking.
 */
export function useSpatialDocuments(
  viewState: ViewState,
  options: UseSpatialDocumentsOptions = {}
): UseSpatialDocumentsReturn {
  const { debounceMs = 300, autoFetch = true, contentType } = options

  const [data, setData] = useState<SpatialDocumentResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const lastFetchRef = useRef<{
    zoom: number
    bounds: string
    contentType: string
  } | null>(null)

  const fetchData = useCallback(
    async (vs: ViewState, ct?: string) => {
      const floorZoom = Math.floor(vs.zoom)
      const bounds = getBoundsFromViewport(vs)
      const boundsKey = `${bounds.minLon.toFixed(2)},${bounds.minLat.toFixed(2)},${bounds.maxLon.toFixed(2)},${bounds.maxLat.toFixed(2)}`
      const ctKey = ct || "all"

      // Skip duplicate fetches
      if (
        lastFetchRef.current &&
        lastFetchRef.current.zoom === floorZoom &&
        lastFetchRef.current.bounds === boundsKey &&
        lastFetchRef.current.contentType === ctKey
      ) {
        return
      }
      lastFetchRef.current = { zoom: floorZoom, bounds: boundsKey, contentType: ctKey }

      setLoading(true)
      setError(null)

      try {
        const filters = ct ? { contentType: ct } : undefined
        const result = await fetchSpatialDocuments(floorZoom, bounds, filters)
        setData(result)
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)))
      } finally {
        setLoading(false)
      }
    },
    []
  )

  // Debounced version
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedFetch = useCallback(
    debounce((vs: ViewState, ct?: string) => fetchData(vs, ct), debounceMs),
    [fetchData, debounceMs]
  )

  useEffect(() => {
    if (!autoFetch) return
    debouncedFetch(viewState, contentType)
    return () => debouncedFetch.cancel()
  }, [viewState.zoom, viewState.latitude, viewState.longitude, contentType, autoFetch, debouncedFetch])

  const refresh = useCallback(() => {
    lastFetchRef.current = null
    fetchData(viewState, contentType)
  }, [viewState, contentType, fetchData])

  const dataType = data ? getDocZoomCategory(viewState.zoom) : null

  return { data, loading, error, refresh, dataType }
}

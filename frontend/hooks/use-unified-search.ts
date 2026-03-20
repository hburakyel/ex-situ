"use client"

import { useState, useEffect, useCallback, useMemo } from "react"

// Arc data from geospatial API
export interface ArcData {
  place_name: string
  country?: string | null
  latitude: number
  longitude: number
  institution_name: string
  institution_place: string
  institution_latitude: number
  institution_longitude: number
  object_count: number
  sample_img_url: string | null
  type: string
  cluster_id: string
}

export interface CollectionResult {
  name: string
  shortName: string
  objectCount: number
  countries: string[]
  sampleImageUrl: string | null
}

export interface PlaceResult {
  name: string
  longitude: number
  latitude: number
  type: string
  bbox: number[] | null
}

// Collection short labels
export const COLLECTION_LABELS: Record<string, string> = {
  "Ethnologisches Museum": "Ethnologisches Museum",
  "The Metropolitan Museum of Art": "The Met",
  "Museum für Islamische Kunst": "Museum für Islamische Kunst",
  "Ägyptisches Museum und Papyrussammlung": "Ägyptisches Museum",
  "Antikensammlung": "Antikensammlung",
  "Museum für Asiatische Kunst": "Museum für Asiatische Kunst",
  "Vorderasiatisches Museum": "Vorderasiatisches Museum",
  "Wikipedia": "Wikipedia",
}

export const WIKIPEDIA_COLLECTION = "Wikipedia"

// Common Mapbox → arc data mappings
const COUNTRY_ALIASES: Record<string, string> = {
  "türkiye": "turkey",
  "côte d'ivoire": "ivory coast",
  "czech republic": "czech republic",
  "czechia": "czech republic",
  "timor-leste": "east timor",
  "eswatini": "eswatini",
  "swaziland": "eswatini",
  "burma": "myanmar",
  "republic of china": "taiwan",
  "democratic republic of congo": "democratic republic of the congo",
  "drc": "democratic republic of the congo",
  "congo-brazzaville": "republic of the congo",
  "congo": "republic of the congo",
  "gambia": "the gambia",
  "china": "people's republic of china",
  "united states": "united states of america",
  "usa": "united states of america",
  "uk": "united kingdom",
  "great britain": "united kingdom",
  "north cyprus": "turkish republic of northern cyprus",
  "northern cyprus": "turkish republic of northern cyprus",
}

export interface UnifiedSearchResult {
  places: PlaceResult[]
  arcs: ArcData[]
  collections: CollectionResult[]
  error: string | null
  isSearching: boolean
  hasResults: boolean
}

interface UseUnifiedSearchOptions {
  /** Minimum characters before triggering search (default: 3) */
  minChars?: number
}

/**
 * Normalize a raw API item (any zoom level) → ArcData shape.
 * The backend returns different field names depending on zoom:
 *   zoom < 5 : country_en, total_objects, center.{lat,lon}, institutions[]
 *   zoom 5-9 : latitude, longitude, count, country_en, institution_name
 *   zoom 10+ : flat fields including place_name, object_count, etc.
 */
function normalizeArcItem(raw: any): ArcData {
  return {
    place_name: raw.place_name || raw.country_en || '',
    country: raw.country || raw.country_en || null,
    latitude: raw.latitude ?? raw.center?.latitude ?? 0,
    longitude: raw.longitude ?? raw.center?.longitude ?? 0,
    institution_name: raw.institution_name || (Array.isArray(raw.institutions) ? raw.institutions[0] : '') || '',
    institution_place: raw.institution_place || raw.country_en || '',
    institution_latitude: raw.institution_latitude ?? raw.center?.latitude ?? 0,
    institution_longitude: raw.institution_longitude ?? raw.center?.longitude ?? 0,
    object_count: raw.object_count ?? raw.total_objects ?? raw.count ?? 0,
    sample_img_url: raw.sample_img_url || null,
    type: raw.type || 'unknown',
    cluster_id: raw.cluster_id || '',
  }
}

export function useUnifiedSearch(options: UseUnifiedSearchOptions = {}) {
  const { minChars = 3 } = options

  const [searchQuery, setSearchQuery] = useState("")
  const [isSearching, setIsSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<PlaceResult[]>([])
  const [matchingArcs, setMatchingArcs] = useState<ArcData[]>([])
  const [matchingCollections, setMatchingCollections] = useState<CollectionResult[]>([])
  const [searchError, setSearchError] = useState<string | null>(null)

  // Arc data
  const [arcData, setArcData] = useState<ArcData[]>([])
  const [cityArcData, setCityArcData] = useState<ArcData[]>([])
  const [isLoadingArcData, setIsLoadingArcData] = useState(true)
  const [wikiDocCount, setWikiDocCount] = useState(0)

  // Fetch country-level arcs first (fast), then city-level in background
  useEffect(() => {
    let cancelled = false
    // 1) Country data — unblocks the UI
    fetch('/api/proxy/geospatial?zoom=1')
      .then(res => res.json())
      .then(data => {
        if (!cancelled && data?.data && Array.isArray(data.data)) {
          setArcData(data.data.map(normalizeArcItem))
        }
      })
      .catch(err => console.error('Failed to fetch country arc data:', err))
      .finally(() => { if (!cancelled) setIsLoadingArcData(false) })

    // 2) City data — loads in background, doesn't block UI
    fetch('/api/proxy/geospatial?zoom=4')
      .then(res => res.json())
      .then(data => {
        if (!cancelled && data?.data && Array.isArray(data.data)) {
          setCityArcData(data.data.map(normalizeArcItem))
        }
      })
      .catch(err => console.error('Failed to fetch city arc data:', err))

    return () => { cancelled = true }
  }, [])

  // Fetch Wikipedia spatial_documents count (gated by ENABLE_WIKIPEDIA)
  useEffect(() => {
    // Wikipedia feature is disabled — skip fetch
    return
    let cancelled = false
    const fetchWiki = async (attempt = 1): Promise<void> => {
      try {
        const res = await fetch('/api/proxy/spatial-documents?zoom=0')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        const count = (data.data || []).reduce((s: number, d: any) => s + (d.doc_count || 1), 0)
        if (!cancelled) setWikiDocCount(count)
      } catch {
        if (attempt < 3 && !cancelled) {
          await new Promise(r => setTimeout(r, 2000 * attempt))
          return fetchWiki(attempt + 1)
        }
      }
    }
    fetchWiki()
    return () => { cancelled = true }
  }, [])

  // Aggregate collections from arc data
  const collections = useMemo(() => {
    const institutionMap = new Map<string, { count: number; countries: Set<string>; sampleImg: string | null }>()
    arcData.forEach(arc => {
      const existing = institutionMap.get(arc.institution_name)
      if (existing) {
        existing.count += arc.object_count
        existing.countries.add(arc.place_name)
      } else {
        institutionMap.set(arc.institution_name, {
          count: arc.object_count,
          countries: new Set([arc.place_name]),
          sampleImg: arc.sample_img_url
        })
      }
    })
    const result = Array.from(institutionMap.entries())
      .map(([name, data]) => ({
        name,
        shortName: COLLECTION_LABELS[name] || name,
        objectCount: data.count,
        countries: Array.from(data.countries).slice(0, 5),
        sampleImageUrl: data.sampleImg
      }))
      .sort((a, b) => b.objectCount - a.objectCount)

    return result
  }, [arcData, wikiDocCount])

  // All searchable arcs (country + city level, deduplicated)
  const allSearchableArcs = useMemo(() => {
    const seen = new Set<string>()
    const merged: ArcData[] = []
    for (const arc of cityArcData) {
      if (!seen.has(arc.cluster_id)) {
        merged.push(arc)
        seen.add(arc.cluster_id)
      }
    }
    for (const arc of arcData) {
      if (!seen.has(arc.cluster_id)) {
        merged.push(arc)
        seen.add(arc.cluster_id)
      }
    }
    return merged
  }, [arcData, cityArcData])

  // Find matching arcs for a search query
  const findMatchingArcs = useCallback((query: string): ArcData[] => {
    const lowerQuery = query.toLowerCase()
    return allSearchableArcs.filter(arc =>
      (arc.place_name || '').toLowerCase().includes(lowerQuery) ||
      (arc.institution_name || '').toLowerCase().includes(lowerQuery) ||
      (arc.institution_place || '').toLowerCase().includes(lowerQuery) ||
      (arc.cluster_id || '').toLowerCase().includes(lowerQuery)
    ).sort((a, b) => (b.object_count || 0) - (a.object_count || 0)).slice(0, 15)
  }, [allSearchableArcs])

  // Normalize country name for matching
  const normalizeCountry = useCallback((name: string): string => {
    const lower = name.toLowerCase().trim()
    return COUNTRY_ALIASES[lower] || lower
  }, [])

  // Build a Set of lowercase arc place names for fast lookup
  const arcCountrySet = useMemo(() => {
    return new Set(allSearchableArcs.filter(a => a.place_name).map(a => a.place_name.toLowerCase()))
  }, [allSearchableArcs])

  // Find arcs by country names
  const findArcsByCountries = useCallback((countryNames: string[]): ArcData[] => {
    if (countryNames.length === 0) return []
    const matchedArcCountries = new Set<string>()
    for (const name of countryNames) {
      const normalized = normalizeCountry(name)
      if (arcCountrySet.has(normalized)) matchedArcCountries.add(normalized)
      const lower = name.toLowerCase().trim()
      if (arcCountrySet.has(lower)) matchedArcCountries.add(lower)
    }
    if (matchedArcCountries.size === 0) return []
    return allSearchableArcs.filter(arc =>
      matchedArcCountries.has((arc.place_name || '').toLowerCase())
    ).sort((a, b) => (b.object_count || 0) - (a.object_count || 0)).slice(0, 10)
  }, [allSearchableArcs, arcCountrySet, normalizeCountry])

  // Find matching collections
  const findMatchingCollections = useCallback((query: string): CollectionResult[] => {
    const lowerQuery = query.toLowerCase()
    return collections
      .filter(c =>
        c.shortName.toLowerCase().includes(lowerQuery) ||
        c.name.toLowerCase().includes(lowerQuery)
      )
      .slice(0, 6)
  }, [collections])

  // Main search function
  const performSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([])
      setMatchingArcs([])
      setMatchingCollections([])
      setSearchError(null)
      return
    }

    setIsSearching(true)
    setSearchError(null)

    // Direct text match on arcs
    const directArcs = findMatchingArcs(query)
    const cols = findMatchingCollections(query)
    setMatchingCollections(cols)

    try {
      const params = new URLSearchParams({
        q: query,
        limit: "5",
      })
      const response = await fetch(`/api/geocode?${params.toString()}`)
      if (!response.ok) throw new Error("Search failed")
      const data = await response.json()

      if (data.features?.length > 0) {
        const lowerQuery = query.toLowerCase().trim()
        // When arc matches already exist, suppress geocoding noise:
        // keep only country-level results, or results whose primary text
        // starts with the query (e.g. exact country name match).
        // This prevents "Iranduba, Brazil" appearing when the user typed "iran".
        const filteredFeatures = directArcs.length > 0
          ? data.features.filter((feature: any) => {
              const isCountry = feature.place_type?.includes("country")
              const primaryText: string = (feature.text || "").toLowerCase()
              const startsWithQuery = primaryText.startsWith(lowerQuery)
              return isCountry || startsWithQuery
            })
          : data.features
        const features: PlaceResult[] = filteredFeatures.map((feature: any) => ({
          name: feature.place_name,
          longitude: feature.center[0],
          latitude: feature.center[1],
          type: feature.place_type?.[0] || "place",
          bbox: feature.bbox || null
        }))
        setSearchResults(features)

        // Extract country names from geocoded results
        const countryNames = new Set<string>()
        data.features.forEach((feature: any) => {
          if (feature.place_type?.includes("country")) {
            countryNames.add(feature.text)
          }
          if (feature.context) {
            const countryCtx = feature.context.find((c: any) => c.id?.startsWith("country"))
            if (countryCtx?.text) countryNames.add(countryCtx.text)
          }
          const parts = feature.place_name?.split(", ")
          if (parts && parts.length > 1) {
            countryNames.add(parts[parts.length - 1])
          }
        })

        // Merge direct + country-based arc matches
        const countryArcs = findArcsByCountries(Array.from(countryNames))
        const seen = new Set(directArcs.map(a => a.cluster_id))
        const merged = [...directArcs]
        for (const arc of countryArcs) {
          if (!seen.has(arc.cluster_id)) {
            merged.push(arc)
            seen.add(arc.cluster_id)
          }
        }
        setMatchingArcs(merged.slice(0, 15))
      } else {
        setSearchResults([])
        setMatchingArcs(directArcs)
        if (directArcs.length === 0 && cols.length === 0) setSearchError("No results found")
      }
    } catch {
      setMatchingArcs(directArcs)
      if (directArcs.length === 0 && cols.length === 0) setSearchError("Search failed. Please try again.")
      setSearchResults([])
    } finally {
      setIsSearching(false)
    }
  }, [findMatchingArcs, findArcsByCountries, findMatchingCollections])

  // Handle query change with auto-search
  const handleQueryChange = useCallback((query: string) => {
    setSearchQuery(query)
    setSearchError(null)
    if (query.trim().length >= minChars) {
      performSearch(query)
    } else if (query.trim().length === 0) {
      setSearchResults([])
      setMatchingArcs([])
      setMatchingCollections([])
    }
  }, [minChars, performSearch])

  // Clear search
  const clearSearch = useCallback(() => {
    setSearchQuery("")
    setSearchResults([])
    setMatchingArcs([])
    setMatchingCollections([])
    setSearchError(null)
  }, [])

  const hasQuery = searchQuery.trim().length > 0
  const hasResults = searchResults.length > 0 || matchingArcs.length > 0 || matchingCollections.length > 0 || !!searchError

  return {
    // State
    searchQuery,
    isSearching,
    isLoadingArcData,
    searchError,
    // Results
    places: searchResults,
    arcs: matchingArcs,
    collections: matchingCollections,
    allCollections: collections,
    arcData,
    cityArcData,
    // Derived
    hasQuery,
    hasResults,
    // Actions
    setSearchQuery: handleQueryChange,
    performSearch,
    clearSearch,
  }
}

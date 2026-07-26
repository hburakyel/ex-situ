"use client"

import type React from "react"
import { useEffect, useRef, useState, useCallback, useMemo } from "react"
import { Search, X, ChevronRight, ArrowRight } from "lucide-react"
import { Spinner } from "@radix-ui/themes"
import { useUnifiedSearch } from "@/hooks/use-unified-search"
import { ERA_BUCKETS, eraToDateFilters, collapseContiguousBuckets, type EraBucket } from "@/lib/era-buckets"
import { fetchDecadeBucketCounts, type DateBucket, type DateBucketCounts } from "@/lib/api"

// ── Types ──

export type FacetedFilters = {
  institutions: string[]
  countries: string[]
  cities: string[]
  /** "Time" (object creation date) — set/cleared only from this palette. */
  era?: EraBucket | null
  /** "Migration" (acquisition date) — set/cleared only from this palette. */
  migrationEra?: EraBucket | null
}

export interface CommandPaletteHandlers {
  onNavigatePlace?: (longitude: number, latitude: number, name: string) => void
  onNavigateSite?: (country: string, site: string, lat: number, lng: number) => void
  onOriginClick?: (country: string, lat?: number, lng?: number) => void
  onToggleSite?: (site: string, lat?: number, lng?: number) => void
  onToggleInstitution?: (inst: string) => void
  /** Called when a shortest-path result is found between two nodes */
  onPathResult?: (path: PathStep[]) => void
  /** Called when "Explore" random jump is triggered */
  onExplore?: () => void
}

/** A single step in a shortest-path result */
export interface PathStep {
  nodeKey: string
  type?: string
  label?: string
  lat?: number | null
  lng?: number | null
  objectCount?: number
  connectionCount?: number
  imgUrl?: string | null
  wikidata?: string | null
}

interface V3CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  handlers: CommandPaletteHandlers
  facetedFilters: FacetedFilters
  onFacetedFiltersChange: (filters: FacetedFilters) => void
  // Time/Migration bucket counts — fetched once by the parent (page.tsx) and
  // shared with MapView's left panel, instead of each component fetching
  // its own copy.
  dateBuckets: DateBucketCounts | null
}

type SectionKey = "places" | "sites" | "collections" | "flyto" | "time" | "migration"

interface PlaceRow {
  name: string
  objectCount: number
  lat: number
  lng: number
}

interface SiteRow {
  name: string
  type: string
  objectCount: number
  lat: number
  lng: number
  country: string
}

interface CollectionRow {
  name: string
  objectCount: number
  countries: string[]
}

// ── Component ──

export default function V3CommandPalette({
  open,
  onOpenChange,
  handlers,
  facetedFilters,
  onFacetedFiltersChange,
  dateBuckets,
}: V3CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const search = useUnifiedSearch({
    minChars: 2,
    dateFilters: eraToDateFilters(facetedFilters.era, facetedFilters.migrationEra),
  })
  const [expanded, setExpanded] = useState<Set<SectionKey>>(new Set())
  const [selectedIdx, setSelectedIdx] = useState(-1)
  const [timeYearInput, setTimeYearInput] = useState("")
  const [migrationYearInput, setMigrationYearInput] = useState("")
  // Time century → decade drill-down: which centuries are expanded, and a
  // cache of fetched decade counts per century id (fetched lazily on first expand).
  const [expandedCenturies, setExpandedCenturies] = useState<Set<string>>(new Set())
  const [decadeCache, setDecadeCache] = useState<Record<string, DateBucket[]>>({})
  const [loadingDecadesFor, setLoadingDecadesFor] = useState<string | null>(null)

  // ── Connection Finder (6 degrees) state ──
  const [pathMode, setPathMode] = useState(false)
  const [pathFrom, setPathFrom] = useState("")
  const [pathTo, setPathTo] = useState("")
  const [pathResult, setPathResult] = useState<PathStep[] | null>(null)
  const [pathLoading, setPathLoading] = useState(false)
  const [pathError, setPathError] = useState<string | null>(null)

  const findPath = useCallback(async (from: string, to: string) => {
    if (!from || !to) return
    setPathLoading(true)
    setPathError(null)
    setPathResult(null)
    try {
      const params = new URLSearchParams({ from, to })
      const res = await fetch(`/api/proxy/arc-graph/path?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!data || !data.path) {
        setPathError("No connection found (max 6 hops)")
        return
      }
      setPathResult(data.path)
      handlers.onPathResult?.(data.path)
    } catch (err: any) {
      setPathError(err.message || "Failed to find path")
    } finally {
      setPathLoading(false)
    }
  }, [handlers])

  // ── Serendipity: random exploration ──
  const handleExplore = useCallback(async () => {
    try {
      const res = await fetch('/api/proxy/arc-graph/graph?limit=100')
      if (!res.ok) return
      const { nodes } = await res.json()
      if (!nodes || nodes.length === 0) return
      // Weighted random: prefer nodes with more connections
      const totalWeight = nodes.reduce((s: number, n: any) => s + (n.connectionCount || 1), 0)
      let r = Math.random() * totalWeight
      let chosen = nodes[0]
      for (const n of nodes) {
        r -= (n.connectionCount || 1)
        if (r <= 0) { chosen = n; break }
      }
      if (chosen.lat && chosen.lng) {
        handlers.onNavigatePlace?.(chosen.lng, chosen.lat, chosen.label || chosen.nodeKey)
      }
      handlers.onExplore?.()
      onOpenChange(false)
    } catch { /* silent */ }
  }, [handlers, onOpenChange])

  // Focus input when opened, reset on close
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 50)
      return () => clearTimeout(t)
    } else {
      search.clearSearch()
      setExpanded(new Set())
      setSelectedIdx(-1)
      setPathMode(false)
      setPathFrom("")
      setPathTo("")
      setPathResult(null)
      setPathError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])


  const toggleEra = useCallback((bucket: EraBucket) => {
    setTimeYearInput("")
    onFacetedFiltersChange({ ...facetedFilters, era: facetedFilters.era?.id === bucket.id ? null : bucket })
  }, [facetedFilters, onFacetedFiltersChange])

  const toggleMigrationEra = useCallback((bucket: EraBucket) => {
    setMigrationYearInput("")
    onFacetedFiltersChange({ ...facetedFilters, migrationEra: facetedFilters.migrationEra?.id === bucket.id ? null : bucket })
  }, [facetedFilters, onFacetedFiltersChange])

  // Reset the year input boxes whenever their filter is cleared elsewhere
  // (top-bar chip X, Clear all) so a stale typed value isn't left behind.
  useEffect(() => { if (!facetedFilters.era) setTimeYearInput("") }, [facetedFilters.era])
  useEffect(() => { if (!facetedFilters.migrationEra) setMigrationYearInput("") }, [facetedFilters.migrationEra])

  // Exact-year input — same EraBucket shape as the preset buckets (a
  // single-point range, start === end), so it flows through the exact same
  // overlap-filter logic on the backend. Honest about what it does: an
  // object whose date is only known as a wide range (e.g. "800–1300") will
  // still match here if the typed year falls inside that range — typing
  // "1906" isn't a promise the object is dated exactly 1906, only that
  // 1906 is consistent with what's known.
  const YEAR_INPUT_BOUNDS: [number, number] = [-1000000, 2027]

  const applyTimeYear = useCallback(() => {
    const year = parseInt(timeYearInput, 10)
    if (isNaN(year) || year < YEAR_INPUT_BOUNDS[0] || year > YEAR_INPUT_BOUNDS[1]) return
    onFacetedFiltersChange({ ...facetedFilters, era: { id: `year-${year}`, label: String(year), start: year, end: year } })
  }, [timeYearInput, facetedFilters, onFacetedFiltersChange])

  const applyMigrationYear = useCallback(() => {
    const year = parseInt(migrationYearInput, 10)
    if (isNaN(year) || year < YEAR_INPUT_BOUNDS[0] || year > YEAR_INPUT_BOUNDS[1]) return
    onFacetedFiltersChange({ ...facetedFilters, migrationEra: { id: `year-${year}`, label: String(year), start: year, end: year } })
  }, [migrationYearInput, facetedFilters, onFacetedFiltersChange])

  // Only real century buckets ("bce-N"/"ce-N") support decade drill-down —
  // "ancient" (the pre-500-BCE catch-all) and "undated" don't.
  const isDrillableCentury = (bucketId: string) => /^(bce|ce)-\d+$/.test(bucketId)

  const toggleCenturyExpand = useCallback((bucketId: string) => {
    setExpandedCenturies((prev) => {
      const next = new Set(prev)
      if (next.has(bucketId)) {
        next.delete(bucketId)
      } else {
        next.add(bucketId)
      }
      return next
    })
  }, [])

  // Fetch decade counts for a century the first time it's expanded.
  useEffect(() => {
    for (const centuryId of expandedCenturies) {
      if (decadeCache[centuryId] || loadingDecadesFor === centuryId) continue
      setLoadingDecadesFor(centuryId)
      fetchDecadeBucketCounts(centuryId, {
        institutions: facetedFilters.institutions.length > 0 ? facetedFilters.institutions : undefined,
        countries: facetedFilters.countries.length > 0 ? facetedFilters.countries : undefined,
        cities: facetedFilters.cities.length > 0 ? facetedFilters.cities : undefined,
      })
        .then((result) => {
          setDecadeCache((prev) => ({ ...prev, [centuryId]: result.decadeBuckets }))
        })
        .catch(() => { /* leave uncached — row shows a loading state indefinitely, acceptable on failure */ })
        .finally(() => setLoadingDecadesFor((cur) => (cur === centuryId ? null : cur)))
      break // fetch one at a time; effect re-runs as expandedCenturies/decadeCache change
    }
  }, [expandedCenturies, decadeCache, loadingDecadesFor, facetedFilters.institutions, facetedFilters.countries, facetedFilters.cities])

  const toggleDecadeEra = useCallback((decade: DateBucket & { start?: number; end?: number }) => {
    const bucket: EraBucket = { id: decade.id, label: decade.label, start: (decade as any).start ?? null, end: (decade as any).end ?? null }
    onFacetedFiltersChange({ ...facetedFilters, era: facetedFilters.era?.id === bucket.id ? null : bucket })
  }, [facetedFilters, onFacetedFiltersChange])

  // ── Full-dataset rows (shown when no query, clicking accordion) ──
  const allPlaceRows: PlaceRow[] = useMemo(() => {
    const map = new Map<string, PlaceRow>()
    for (const arc of search.arcData) {
      const name = arc.place_name || ''
      if (!name) continue
      const key = name.toLowerCase()
      const existing = map.get(key)
      if (existing) {
        existing.objectCount += arc.object_count || 0
      } else {
        map.set(key, { name, objectCount: arc.object_count || 0, lat: arc.latitude, lng: arc.longitude })
      }
    }
    return Array.from(map.values()).sort((a, b) => b.objectCount - a.objectCount)
  }, [search.arcData])

  const allSiteRows: SiteRow[] = useMemo(() => {
    const map = new Map<string, SiteRow>()
    for (const arc of search.cityArcData) {
      const name = arc.place_name || ''
      if (!name) continue
      const country = (arc as any).country || ''
      // A "site" whose name is identical to its own country (e.g.
      // place_name="Japan", country_en="Japan") is already represented in
      // Places at the country level — display-only exclusion, doesn't touch
      // Places, exports, or any counting/filtering logic elsewhere.
      if (country && name.trim().toLowerCase() === country.trim().toLowerCase()) continue
      const key = name.toLowerCase()
      const existing = map.get(key)
      if (existing) {
        existing.objectCount += arc.object_count || 0
      } else {
        map.set(key, { name, type: "city", objectCount: arc.object_count || 0, lat: arc.latitude, lng: arc.longitude, country })
      }
    }
    return Array.from(map.values()).sort((a, b) => b.objectCount - a.objectCount)
  }, [search.cityArcData])

  const allCollectionRows: CollectionRow[] = useMemo(() => {
    return search.allCollections.map((c) => ({
      name: c.name,
      objectCount: c.objectCount,
      countries: c.countries,
    }))
  }, [search.allCollections])

  // ── Filtered rows from search results ──
  const searchPlaceRows: PlaceRow[] = useMemo(() => {
    if (!search.hasQuery) return []
    const map = new Map<string, PlaceRow>()
    for (const arc of search.arcs) {
      const name = arc.place_name || ''
      if (!name) continue
      const key = name.toLowerCase()
      const existing = map.get(key)
      if (existing) {
        existing.objectCount += arc.object_count || 0
      } else {
        map.set(key, { name, objectCount: arc.object_count || 0, lat: arc.latitude, lng: arc.longitude })
      }
    }
    return Array.from(map.values()).sort((a, b) => b.objectCount - a.objectCount)
  }, [search.hasQuery, search.arcs])

  const searchSiteRows: SiteRow[] = useMemo(() => {
    if (!search.hasQuery) return []
    const placeNames = new Set(searchPlaceRows.map((p) => p.name.toLowerCase()))
    return search.places
      .filter((p) => !placeNames.has(p.name.toLowerCase()))
      .map((p) => ({ name: p.name, type: p.type, objectCount: (p as any).object_count ?? 0, lat: p.latitude, lng: p.longitude, country: "" }))
  }, [search.hasQuery, search.places, searchPlaceRows])

  const searchCollectionRows: CollectionRow[] = useMemo(() => {
    if (!search.hasQuery) return []
    return search.collections.map((c) => ({ name: c.name, objectCount: c.objectCount, countries: c.countries }))
  }, [search.hasQuery, search.collections])

  // ── Active rows: search results when querying, full dataset otherwise ──
  const placeRows = search.hasQuery ? searchPlaceRows : allPlaceRows
  // Sites always come from real arc data; when searching, filter to matching names
  const siteRows = useMemo(() => {
    if (!search.hasQuery) return allSiteRows
    const query = search.searchQuery.toLowerCase()
    return allSiteRows.filter((s) => s.name.toLowerCase().includes(query))
  }, [search.hasQuery, search.searchQuery, allSiteRows])
  const collectionRows = search.hasQuery ? searchCollectionRows : allCollectionRows
  // Fly-to rows: geocoded results that don't match places or sites — only shown when typing
  const flyToRows = useMemo(() => {
    if (!search.hasQuery) return []
    const placeNames = new Set(searchPlaceRows.map((p) => p.name.toLowerCase()))
    const siteNames = new Set(siteRows.map((s) => s.name.toLowerCase()))
    return searchSiteRows.filter((r) => !placeNames.has(r.name.toLowerCase()) && !siteNames.has(r.name.toLowerCase()))
  }, [search.hasQuery, searchPlaceRows, siteRows, searchSiteRows])

  // ── Auto-expand matching sections on search, collapse non-matching ──
  useEffect(() => {
    if (!search.hasQuery) {
      setExpanded(new Set())
      setSelectedIdx(-1)
      return
    }
    const next = new Set<SectionKey>()
    if (searchPlaceRows.length > 0) next.add("places")
    if (siteRows.length > 0) next.add("sites")
    if (searchCollectionRows.length > 0) next.add("collections")
    if (flyToRows.length > 0) next.add("flyto")
    setExpanded(next)
    setSelectedIdx(0)
  }, [search.hasQuery, searchPlaceRows.length, siteRows.length, searchCollectionRows.length, flyToRows.length])

  // ── Flat selectable list for keyboard navigation ──
  const flatItems = useMemo(() => {
    const list: { section: SectionKey; index: number }[] = []
    if (expanded.has("places")) placeRows.forEach((_, i) => list.push({ section: "places", index: i }))
    if (expanded.has("sites")) siteRows.forEach((_, i) => list.push({ section: "sites", index: i }))
    if (expanded.has("collections")) collectionRows.forEach((_, i) => list.push({ section: "collections", index: i }))
    // Fly-to rows are always expanded when present (no header to toggle)
    flyToRows.forEach((_, i) => list.push({ section: "flyto", index: i }))
    return list
  }, [expanded, placeRows, siteRows, collectionRows, flyToRows])

  // ── Filter toggle helpers (adds/removes chip, does NOT close palette) ──
  const toggleFilter = useCallback(
    (dim: keyof Omit<FacetedFilters, "era" | "migrationEra">, value: string) => {
      const current = facetedFilters[dim]
      const isActive = current.some((v) => v.toLowerCase() === value.toLowerCase())
      const next = isActive
        ? current.filter((v) => v.toLowerCase() !== value.toLowerCase())
        : [...current, value]
      onFacetedFiltersChange({ ...facetedFilters, [dim]: next })
    },
    [facetedFilters, onFacetedFiltersChange],
  )

  const isFilterActive = useCallback(
    (dim: keyof Omit<FacetedFilters, "era" | "migrationEra">, value: string) =>
      facetedFilters[dim].some((v) => v.toLowerCase() === value.toLowerCase()),
    [facetedFilters],
  )

  // ── Selection handlers — toggle filter + fly to + close ──
  const handleSelectPlace = useCallback(
    (row: PlaceRow) => {
      toggleFilter("countries", row.name)
      handlers.onOriginClick?.(row.name, row.lat, row.lng)
      onOpenChange(false)
    },
    [toggleFilter, handlers, onOpenChange],
  )

  const handleSelectSite = useCallback(
    (row: SiteRow) => {
      toggleFilter("cities", row.name)
      // Drill into country + site atomically so breadcrumb updates correctly
      if (row.country && handlers.onNavigateSite) {
        handlers.onNavigateSite(row.country, row.name, row.lat, row.lng)
      } else {
        handlers.onNavigatePlace?.(row.lng, row.lat, row.name)
      }
      onOpenChange(false)
    },
    [toggleFilter, handlers, onOpenChange],
  )

  const handleSelectCollection = useCallback(
    (row: CollectionRow) => {
      toggleFilter("institutions", row.name)
      onOpenChange(false)
    },
    [toggleFilter, onOpenChange],
  )

  // ── Fly-to handler (just navigate, no filter toggle) ──
  const handleSelectFlyTo = useCallback(
    (row: SiteRow) => {
      handlers.onNavigatePlace?.(row.lng, row.lat, row.name)
      onOpenChange(false)
    },
    [handlers, onOpenChange],
  )

  const handleSelectFlat = useCallback(
    (idx: number) => {
      const entry = flatItems[idx]
      if (!entry) return
      if (entry.section === "places") handleSelectPlace(placeRows[entry.index])
      else if (entry.section === "sites") handleSelectSite(siteRows[entry.index])
      else if (entry.section === "flyto") handleSelectFlyTo(flyToRows[entry.index])
      else handleSelectCollection(collectionRows[entry.index])
    },
    [flatItems, placeRows, siteRows, collectionRows, flyToRows, handleSelectPlace, handleSelectSite, handleSelectFlyTo, handleSelectCollection],
  )

  const toggleSection = useCallback((key: SectionKey) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // Flat-index lookup for a section row
  const flatIndexOf = useCallback(
    (section: SectionKey, rowIndex: number) =>
      flatItems.findIndex((f) => f.section === section && f.index === rowIndex),
    [flatItems],
  )

  // ── Filter chip helpers ──
  const activeFilterCount =
    facetedFilters.countries.length + facetedFilters.cities.length + facetedFilters.institutions.length +
    (facetedFilters.era ? 1 : 0) + (facetedFilters.migrationEra ? 1 : 0)

  const removeFilter = useCallback(
    (dim: keyof Omit<FacetedFilters, "era" | "migrationEra">, value: string) => {
      onFacetedFiltersChange({
        ...facetedFilters,
        [dim]: facetedFilters[dim].filter((v) => v.toLowerCase() !== value.toLowerCase()),
      })
    },
    [facetedFilters, onFacetedFiltersChange],
  )

  const clearAllFilters = useCallback(() => {
    onFacetedFiltersChange({ institutions: [], countries: [], cities: [], era: null, migrationEra: null })
  }, [onFacetedFiltersChange])

  // ── Keyboard ──
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onOpenChange(false)
        return
      }
      if (flatItems.length === 0) return
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedIdx((prev) => Math.min(prev + 1, flatItems.length - 1))
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedIdx((prev) => Math.max(prev - 1, 0))
      } else if (e.key === "Enter") {
        e.preventDefault()
        if (selectedIdx >= 0) handleSelectFlat(selectedIdx)
      }
    },
    [flatItems, selectedIdx, handleSelectFlat, onOpenChange],
  )

  // Scroll selected row into view
  useEffect(() => {
    if (!listRef.current || selectedIdx < 0) return
    const el = listRef.current.querySelector(`[data-flat="${selectedIdx}"]`)
    if (el) el.scrollIntoView({ block: "nearest" })
  }, [selectedIdx])

  if (!open) return null

  const matchCount = placeRows.length + siteRows.length + collectionRows.length + flyToRows.length
  const hasQuery = search.hasQuery

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[80] bg-black/25 backdrop-blur-[2px]" onClick={() => onOpenChange(false)} />

      {/* Palette */}
      <div className="fixed inset-0 z-[80] flex items-start justify-center pt-[15vh] pointer-events-none">
        <div
          className="w-full max-w-lg bg-white rounded-[20px] shadow-2xl border border-gray-200 overflow-hidden pointer-events-auto"
          onKeyDown={handleKeyDown}
        >
          {/* Search input */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
            <Search className="w-[18px] h-[18px] text-gray-400 flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={search.searchQuery}
              onChange={(e) => search.setSearchQuery(e.target.value)}
              placeholder="Search places, sites, collections…"
              className="flex-1 text-sm bg-transparent outline-none placeholder:text-gray-400"
            />
            {search.isSearching && <Spinner size="1" />}
            {search.searchQuery && (
              <button onClick={() => search.clearSearch()} className="p-0.5 hover:bg-gray-100 rounded-md">
                <X className="w-3.5 h-3.5 text-gray-400" />
              </button>
            )}
            <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-1.5 text-[10px] text-gray-400">
              ESC
            </kbd>
          </div>

          {/* Active filter chips */}
          {activeFilterCount > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-b border-gray-100 bg-gray-50/50">
              {facetedFilters.countries.map((c) => (
                <span key={`fc-${c}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-[10px]">
                  {c}
                  <button onClick={() => removeFilter("countries", c)} className="hover:bg-blue-100 rounded-md p-0.5"><X className="w-2.5 h-2.5" /></button>
                </span>
              ))}
              {facetedFilters.cities.map((c) => (
                <span key={`fs-${c}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-[10px]">
                  {c}
                  <button onClick={() => removeFilter("cities", c)} className="hover:bg-blue-100 rounded-md p-0.5"><X className="w-2.5 h-2.5" /></button>
                </span>
              ))}
              {facetedFilters.institutions.map((c) => (
                <span key={`fi-${c}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-orange-50 text-orange-700 text-[10px]">
                  {c}
                  <button onClick={() => removeFilter("institutions", c)} className="hover:bg-orange-100 rounded-md p-0.5"><X className="w-2.5 h-2.5" /></button>
                </span>
              ))}
              {facetedFilters.era && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-50 text-gray-600 text-[10px]">
                  {facetedFilters.era.label}
                  <button onClick={() => toggleEra(facetedFilters.era!)} className="hover:opacity-70 rounded-md p-0.5"><X className="w-2.5 h-2.5 text-white" /></button>
                </span>
              )}
              {facetedFilters.migrationEra && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-50 text-gray-600 text-[10px]">
                  {facetedFilters.migrationEra.label}
                  <button onClick={() => toggleMigrationEra(facetedFilters.migrationEra!)} className="hover:opacity-70 rounded-md p-0.5"><X className="w-2.5 h-2.5 text-white" /></button>
                </span>
              )}
              {activeFilterCount > 1 && (
                <button onClick={clearAllFilters} className="text-[10px] text-gray-400 hover:text-gray-600 px-1">Clear all</button>
              )}
            </div>
          )}

          {/* Content */}


          {/* Connection Finder (6 Degrees) */}
          {pathMode && (
            <div className="px-4 py-3 border-b border-gray-100 bg-violet-50/50 space-y-2">
              <p className="text-[11px] font-medium text-violet-600">Find shortest path between two nodes (max 6 hops)</p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={pathFrom}
                  onChange={e => setPathFrom(e.target.value)}
                  placeholder="From (e.g. origin_country:Turkey)"
                  className="flex-1 text-xs bg-white border border-violet-200 rounded-md px-2 py-1.5 outline-none focus:border-violet-400 placeholder:text-gray-400"
                />
                <span className="text-gray-400 text-xs">→</span>
                <input
                  type="text"
                  value={pathTo}
                  onChange={e => setPathTo(e.target.value)}
                  placeholder="To (e.g. institution:British Museum)"
                  className="flex-1 text-xs bg-white border border-violet-200 rounded-md px-2 py-1.5 outline-none focus:border-violet-400 placeholder:text-gray-400"
                />
                <button
                  onClick={() => findPath(pathFrom, pathTo)}
                  disabled={pathLoading || !pathFrom || !pathTo}
                  className="px-3 py-1.5 text-xs font-medium bg-violet-600 text-white rounded-md hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {pathLoading ? "…" : "Find"}
                </button>
              </div>
              {pathError && <p className="text-xs text-red-500">{pathError}</p>}
              {pathResult && (
                <div className="flex items-center gap-1 flex-wrap pt-1">
                  {pathResult.map((step, i) => (
                    <span key={step.nodeKey} className="inline-flex items-center gap-1">
                      {i > 0 && <span className="text-violet-300 text-xs">→</span>}
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium cursor-pointer hover:ring-1 hover:ring-violet-400 transition-all ${
                          step.type === "origin_country" ? "bg-blue-100 text-blue-700"
                          : step.type === "origin_city" ? "bg-emerald-100 text-emerald-700"
                          : step.type === "institution" ? "bg-amber-100 text-amber-700"
                          : "bg-gray-100 text-gray-600"
                        }`}
                        onClick={() => {
                          if (step.lat && step.lng) {
                            handlers.onNavigatePlace?.(step.lng, step.lat, step.label || step.nodeKey)
                            onOpenChange(false)
                          }
                        }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full" style={{
                          background: step.type === "origin_country" ? "#3b82f6"
                            : step.type === "origin_city" ? "#10b981"
                            : step.type === "institution" ? "#f59e0b"
                            : "#6b7280"
                        }} />
                        {step.label || step.nodeKey.split(":").pop()}
                      </span>
                    </span>
                  ))}
                  <span className="text-[10px] text-violet-400 ml-2">{pathResult.length - 1} hops</span>
                </div>
              )}
            </div>
          )}

          <div ref={listRef} className="max-h-[50vh] overflow-y-auto">
            {/* Typing hint */}
            {search.searchQuery.length > 0 && search.searchQuery.length < 2 && (
              <div className="px-4 py-6 text-center text-sm text-gray-400">Type at least 2 characters…</div>
            )}

            {/* No results */}
            {hasQuery && !search.isSearching && matchCount === 0 && (
              <div className="px-4 py-6 text-center text-sm text-gray-400">
                No results for &ldquo;{search.searchQuery}&rdquo;
              </div>
            )}

            {/* Accordion sections — always visible once data is loaded */}
            {(!search.searchQuery || matchCount > 0 || search.searchQuery.length < 2) && (allPlaceRows.length > 0 || allCollectionRows.length > 0) && (
              <div className="py-1">
                {/* ── Places ── */}
                <SectionHeader
                  label="Places"
                  count={placeRows.length}
                  isOpen={expanded.has("places")}
                  onToggle={() => toggleSection("places")}
                  dimmed={hasQuery && searchPlaceRows.length === 0}
                />
                {expanded.has("places") &&
                  placeRows.map((row, i) => {
                    const fi = flatIndexOf("places", i)
                    const active = isFilterActive("countries", row.name)
                    return (
                      <button
                        key={`p-${row.name}`}
                        data-flat={fi}
                        className={`group w-full flex items-center gap-3 pl-7 pr-4 py-1.5 text-left transition-colors ${
                          active
                            ? "bg-blue-50 text-blue-800"
                            : fi === selectedIdx
                              ? "bg-gray-50 text-gray-900"
                              : "hover:bg-gray-50 text-gray-700"
                        }`}
                        onClick={() => handleSelectPlace(row)}
                        onMouseEnter={() => setSelectedIdx(fi)}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${active ? "bg-blue-500" : "bg-blue-400"}`} />
                        <span className="flex-1 text-sm truncate">{row.name}</span>
                        <span className="text-sm text-gray-400 tabular-nums flex-shrink-0">
                          {row.objectCount.toLocaleString()}
                        </span>
                        {active && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />}
                      </button>
                    )
                  })}

                {/* ── Sites ── */}
                <SectionHeader
                  label="Sites"
                  count={siteRows.length}
                  isOpen={expanded.has("sites")}
                  onToggle={() => toggleSection("sites")}
                  dimmed={hasQuery && siteRows.length === 0}
                />
                {expanded.has("sites") &&
                  siteRows.map((row, i) => {
                    const fi = flatIndexOf("sites", i)
                    const active = isFilterActive("cities", row.name)
                    return (
                      <button
                        key={`s-${row.name}`}
                        data-flat={fi}
                        className={`group w-full flex items-center gap-3 pl-7 pr-4 py-1.5 text-left transition-colors ${
                          active
                            ? "bg-blue-50 text-blue-800"
                            : fi === selectedIdx
                              ? "bg-gray-50 text-gray-900"
                              : "hover:bg-gray-50 text-gray-700"
                        }`}
                        onClick={() => handleSelectSite(row)}
                        onMouseEnter={() => setSelectedIdx(fi)}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${active ? "bg-blue-500" : "bg-blue-400"}`} />
                        <span className="flex-1 text-sm truncate">{row.name}</span>
                        <span className="text-sm text-gray-400 tabular-nums flex-shrink-0">
                          {row.objectCount.toLocaleString()}
                        </span>
                        {active && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />}
                      </button>
                    )
                  })}

                {/* ── Time (object creation date) ── */}
                <SectionHeader
                  label="Time"
                  count={dateBuckets ? (dateBuckets.objectDateExactCount ?? 0) : null}
                  isOpen={expanded.has("time")}
                  onToggle={() => toggleSection("time")}
                  dimmed={false}
                />
                {expanded.has("time") && (
                  <>
                    <div className="pl-7 pr-4 py-1 flex items-center gap-1.5">
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="-?[0-9]*"
                        value={timeYearInput}
                        onChange={(e) => setTimeYearInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") applyTimeYear() }}
                        placeholder="Exact year (e.g. 1906, -500 for BCE)"
                        className="flex-1 min-w-0 text-sm bg-white border border-gray-200 rounded-md px-2 py-1 outline-none focus:border-gray-400 placeholder:text-gray-400"
                      />
                      <button
                        onClick={applyTimeYear}
                        className="text-sm text-gray-500 hover:text-gray-700 px-1.5 py-1"
                      >
                        Go
                      </button>
                    </div>
                    {dateBuckets && collapseContiguousBuckets(
                        ERA_BUCKETS,
                        Object.fromEntries(dateBuckets.objectDateBuckets.map((b) => [b.id, b.count])),
                        dateBuckets.objectDateSpans,
                      )
                      // Hide empty buckets now that we have a real (non-null) result.
                      .filter((row) => row.count > 0)
                      .map((row) => {
                      const bucket = row.era
                      const count = row.count
                      const active = facetedFilters.era?.id === row.id
                      const drillable = !row.isMerged && isDrillableCentury(bucket.id)
                      const isExpanded = expandedCenturies.has(bucket.id)
                      const decades = decadeCache[bucket.id]
                      const isLoadingDecades = loadingDecadesFor === bucket.id
                      return (
                        <div key={`time-${bucket.id}`}>
                          <div
                            className={`group w-full flex items-center gap-1.5 pl-3 pr-4 py-1.5 transition-colors ${
                              active ? "bg-gray-200 text-gray-900" : "hover:bg-gray-50 text-gray-700"
                            }`}
                          >
                            {drillable ? (
                              <button
                                onClick={() => toggleCenturyExpand(bucket.id)}
                                className="p-0.5 -m-0.5 flex-shrink-0"
                                aria-label={isExpanded ? "Collapse" : "Expand"}
                              >
                                <ChevronRight className={`w-3.5 h-3.5 text-gray-400 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                              </button>
                            ) : (
                              <span className="w-3.5 h-3.5 flex-shrink-0" />
                            )}
                            <button
                              className="flex-1 flex items-center gap-3 text-left min-w-0"
                              onClick={() => toggleEra(bucket)}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${active ? "bg-gray-500" : "bg-gray-400"}`} />
                              <span className="flex-1 text-sm truncate">{bucket.label}</span>
                              <span className="text-sm text-gray-400 tabular-nums flex-shrink-0">
                                {count.toLocaleString()}
                              </span>
                              {active && <span className="w-1.5 h-1.5 rounded-full bg-gray-500 flex-shrink-0" />}
                            </button>
                          </div>
                          {drillable && isExpanded && (
                            <div className="pl-8">
                              {isLoadingDecades && !decades && (
                                <div className="flex items-center gap-2 pl-7 pr-4 py-1.5 text-sm text-gray-400">
                                  <Spinner size="1" /> Loading decades…
                                </div>
                              )}
                              {decades
                                ?.filter((d) => d.count > 0)
                                .map((decade) => {
                                  const decadeActive = facetedFilters.era?.id === decade.id
                                  return (
                                    <button
                                      key={`decade-${decade.id}`}
                                      className={`group w-full flex items-center gap-3 pl-7 pr-4 py-1.5 text-left transition-colors ${
                                        decadeActive ? "bg-gray-200 text-gray-900" : "hover:bg-gray-50 text-gray-700"
                                      }`}
                                      onClick={() => toggleDecadeEra(decade as any)}
                                    >
                                      <span className={`w-1 h-1 rounded-full flex-shrink-0 ${decadeActive ? "bg-gray-500" : "bg-gray-400"}`} />
                                      <span className="flex-1 text-sm truncate">{decade.label}</span>
                                      <span className="text-sm text-gray-400 tabular-nums flex-shrink-0">
                                        {decade.count.toLocaleString()}
                                      </span>
                                      {decadeActive && <span className="w-1.5 h-1.5 rounded-full bg-gray-500 flex-shrink-0" />}
                                    </button>
                                  )
                                })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </>
                )}

                {/* ── Migration (acquisition date) — hidden entirely when the
                    current institution/place selection has zero real
                    (non-undated) acquisition records, since an "Undated"-only
                    list has nothing to browse. While dateBuckets is still
                    loading (null), show it rather than flashing it away. ── */}
                {(!dateBuckets || (dateBuckets.acquisitionExactCount ?? 0) > 0) && (
                  <>
                    <SectionHeader
                      label="Migration"
                      count={dateBuckets ? (dateBuckets.acquisitionExactCount ?? 0) : null}
                      isOpen={expanded.has("migration")}
                      onToggle={() => toggleSection("migration")}
                      dimmed={false}
                    />
                    {expanded.has("migration") && (
                      <>
                        <div className="pl-7 pr-4 py-1 flex items-center gap-1.5">
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="-?[0-9]*"
                            value={migrationYearInput}
                            onChange={(e) => setMigrationYearInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") applyMigrationYear() }}
                            placeholder="Exact year (e.g. 1925)"
                            className="flex-1 min-w-0 text-sm bg-white border border-gray-200 rounded-md px-2 py-1 outline-none focus:border-gray-400 placeholder:text-gray-400"
                          />
                          <button
                            onClick={applyMigrationYear}
                            className="text-sm text-gray-500 hover:text-gray-700 px-1.5 py-1"
                          >
                            Go
                          </button>
                        </div>
                        {(dateBuckets?.acquisitionBuckets ?? [])
                          // Undated is expected to dwarf every real year (most institutions
                          // have no acquisition data at all) — keep it pinned first regardless.
                          .filter((bucket) => bucket.count > 0 || bucket.id === 'undated')
                          .map((bucket) => {
                            const yearMatch = /^year-(-?\d+)$/.exec(bucket.id)
                            const migrationBucket: EraBucket = yearMatch
                              ? { id: bucket.id, label: bucket.label, start: parseInt(yearMatch[1], 10), end: parseInt(yearMatch[1], 10) }
                              : { id: 'undated', label: 'Undated', start: null, end: null, undated: true }
                            const active = facetedFilters.migrationEra?.id === migrationBucket.id
                            return (
                              <button
                                key={`migration-${bucket.id}`}
                                className={`group w-full flex items-center gap-3 pl-7 pr-4 py-1.5 text-left transition-colors ${
                                  active ? "bg-gray-200 text-gray-900" : "hover:bg-gray-50 text-gray-700"
                                }`}
                                onClick={() => toggleMigrationEra(migrationBucket)}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${active ? "bg-gray-500" : "bg-gray-400"}`} />
                                <span className="flex-1 text-sm truncate">{migrationBucket.label}</span>
                                <span className="text-sm text-gray-400 tabular-nums flex-shrink-0">
                                  {bucket.count.toLocaleString()}
                                </span>
                                {active && <span className="w-1.5 h-1.5 rounded-full bg-gray-500 flex-shrink-0" />}
                              </button>
                            )
                          })}
                      </>
                    )}
                  </>
                )}

                {/* ── Collections ── */}
                <SectionHeader
                  label="Collections"
                  count={collectionRows.length}
                  isOpen={expanded.has("collections")}
                  onToggle={() => toggleSection("collections")}
                  dimmed={hasQuery && searchCollectionRows.length === 0}
                />
                {expanded.has("collections") &&
                  collectionRows.map((row, i) => {
                    const fi = flatIndexOf("collections", i)
                    const active = isFilterActive("institutions", row.name)
                    return (
                      <button
                        key={`c-${row.name}`}
                        data-flat={fi}
                        className={`group w-full flex items-center gap-3 pl-7 pr-4 py-1.5 text-left transition-colors ${
                          active
                            ? "bg-orange-50 text-orange-800"
                            : fi === selectedIdx
                              ? "bg-gray-50 text-gray-900"
                              : "hover:bg-gray-50 text-gray-700"
                        }`}
                        onClick={() => handleSelectCollection(row)}
                        onMouseEnter={() => setSelectedIdx(fi)}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${active ? "bg-orange-500" : "bg-orange-400"}`} />
                        <div className="flex-1 min-w-0">
                          <span className="text-sm truncate block">{row.name}</span>
                          {row.countries.length > 0 && (
                            <span className="text-sm text-gray-400 truncate block">
                              {row.countries.slice(0, 3).join(", ")}
                              {row.countries.length > 3 ? ` +${row.countries.length - 3}` : ""}
                            </span>
                          )}
                        </div>
                        <span className="text-sm text-gray-400 tabular-nums flex-shrink-0">
                          {row.objectCount.toLocaleString()}
                        </span>
                        {active && <span className="w-1.5 h-1.5 rounded-full bg-orange-500 flex-shrink-0" />}
                      </button>
                    )
                  })}

                {/* ── Fly-to rows (headerless, only when searching) ── */}
                {hasQuery && flyToRows.length > 0 && (
                  <>
                    <div className="px-4 py-1 border-t border-gray-100" />
                    {flyToRows.map((row, i) => {
                      const fi = flatIndexOf("flyto", i)
                      return (
                        <button
                          key={`ft-${i}-${row.name}`}
                          data-flat={fi}
                          className={`group w-full flex items-center gap-3 pl-7 pr-4 py-1.5 text-left transition-colors ${
                            fi === selectedIdx
                              ? "bg-gray-50 text-gray-900"
                              : "hover:bg-gray-50 text-gray-500"
                          }`}
                          onClick={() => handleSelectFlyTo(row)}
                          onMouseEnter={() => setSelectedIdx(fi)}
                        >
                          <span className="flex-1 text-sm truncate text-gray-500">{row.name}</span>
                          <ArrowRight className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                        </button>
                      )
                    })}
                  </>
                )}
              </div>
            )}

            {/* Loading state */}
            {!search.searchQuery && allPlaceRows.length === 0 && search.isLoadingArcData && (
              <div className="px-4 py-6 text-center">
                <Spinner size="1" />
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

// ── Accordion section header ──

function SectionHeader({
  label,
  count,
  isOpen,
  onToggle,
  dimmed,
  countLabel,
}: {
  label: string
  /** null means "still loading" — omits the count entirely rather than showing a misleading zero. */
  count: number | null
  isOpen: boolean
  onToggle: () => void
  dimmed: boolean
  /** When set (e.g. "Exact"), renders "Exact: N" instead of a bare number —
   * for sections (Time) where this count is a narrower metric than "how many
   * rows are in the list below", so a bare 0 would misread as "nothing here"
   * even while range-dated buckets have real counts. */
  countLabel?: string
}) {
  return (
    <button
      onClick={onToggle}
      className={`w-full flex items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-gray-50 ${
        dimmed ? "opacity-35" : ""
      }`}
    >
      <ChevronRight
        className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${isOpen ? "rotate-90" : ""}`}
      />
      <span className="text-sm font-medium text-gray-500 flex-1">{label}</span>
      {count !== null && (
        <span className="text-sm text-gray-400 tabular-nums">
          {countLabel && `${countLabel}: `}{count.toLocaleString()}
        </span>
      )}
    </button>
  )
}

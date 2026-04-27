"use client"

import { useState, useRef, useEffect, useMemo, useCallback } from "react"
import { ChevronDown, ChevronUp, Check, MoreHorizontal } from "lucide-react"
import { IconSearch, IconClose, IconDownloadCsv, IconExpand, IconMinimize, IconShare, IconPanelOpen, IconPanelClosed } from "@/components/icons"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import ObjectGrid from "@/components/object-grid"
import BlurhashImage from "@/components/blurhash-image"
import type { MuseumObject } from "@/types"
import ImageGallery from "@/components/image-gallery"
import { Spinner } from "@/components/ui/spinner"
import InfoPanel from "./info-panel"

export type ContainerSize = "default" | "expanded" | "minimized"

export type FacetedFilters = { institutions: string[]; countries: string[]; cities: string[] }

export type DrillLevel = "global" | "country" | "objects"

export interface BreadcrumbSegment {
  label: string
  level: DrillLevel
}

export interface GroupedOrigin {
  country: string
  totalCount: number
  institutions: string[]
  lat: number
  lng: number
}

export interface GroupedSite {
  name: string
  totalCount: number
  institutions: string[]
  lat: number
  lng: number
}

export interface InstitutionItem {
  name: string
  count: number
}

interface ObjectPanelProps {
  objects: MuseumObject[]
  onLoadMore: () => void
  hasMore: boolean
  totalCount: number
  isLoading: boolean
  onObjectClick: (longitude: number, latitude: number) => void
  isMobile?: boolean
  viewMode: "grid" | "list"
  setViewMode: (mode: "grid" | "list") => void
  containerSize: ContainerSize
  setContainerSize: (size: ContainerSize) => void
  // Mobile drill-down props (only used on mobile)
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
  locationName?: string
  geocodedName?: string
  arcCount?: number
  collectionCount?: number
  allObjects?: MuseumObject[]
  facetedFilters?: FacetedFilters
  onFacetedFiltersChange?: (filters: FacetedFilters) => void
  onCommandPaletteOpen?: () => void
  linkObjects?: MuseumObject[]
  initialGalleryArtifact?: MuseumObject | null
}

export default function ObjectPanel({
  objects,
  onLoadMore,
  hasMore,
  totalCount,
  isLoading,
  onObjectClick,
  isMobile = false,
  viewMode,
  setViewMode,
  containerSize,
  setContainerSize,
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
  locationName,
  geocodedName,
  arcCount = 0,
  collectionCount = 0,
  allObjects = [],
  facetedFilters = { institutions: [], countries: [], cities: [] },
  onFacetedFiltersChange,
  onCommandPaletteOpen,
  linkObjects = [],
  initialGalleryArtifact,
}: ObjectPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [galleryArtifact, setGalleryArtifact] = useState<MuseumObject | null>(null)
  const [showOrigins, setShowOrigins] = useState(false)
  const [showSites, setShowSites] = useState(false)
  const [showCollections, setShowCollections] = useState(false)
  const [showCopied, setShowCopied] = useState(false)

  // ── Mobile bottom-sheet drag-to-resize ──
  const containerSizeRef = useRef<ContainerSize>(containerSize)
  const dragStartY = useRef(0)
  const dragStartTime = useRef(0)
  const dragStartSize = useRef<ContainerSize>("default")
  // "idle" → no gesture | "deciding" → figuring out scroll vs drag | "dragging" → sheet is being dragged
  const touchPhase = useRef<"idle" | "deciding" | "dragging">("idle")
  const touchStartScrollTop = useRef(0)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLDivElement>(null)
  const prefersReducedMotion = useRef(false)
  const [liveHeight, setLiveHeight] = useState<number | null>(null)

  useEffect(() => {
    prefersReducedMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  }, [])

  // Keep containerSizeRef in sync so window handlers always see the latest size
  useEffect(() => { containerSizeRef.current = containerSize }, [containerSize])

  // Lock background body scroll when sheet is expanded on mobile (prevents page scroll behind)
  useEffect(() => {
    if (!isMobile) return
    if (containerSize === "expanded") {
      const prev = document.body.style.overflow
      document.body.style.overflow = "hidden"
      return () => { document.body.style.overflow = prev }
    }
  }, [isMobile, containerSize])

  // ── Mobile drag resize: window-level gesture handler (Apple Maps-style) ──
  //
  // Gesture decision logic:
  //   touch on handle        → immediately "dragging" (no deciding phase)
  //   touch on content area:
  //     finger moves UP   + sheet not expanded   → "dragging" (expand sheet)
  //     finger moves DOWN + scroll is at top     → "dragging" (shrink sheet)
  //     otherwise                                → "idle"    (let scroll happen)
  //
  // deltaY convention: positive = finger moved DOWN = sheet shrinks
  useEffect(() => {
    if (!isMobile) return

    const sizeToHeight = (size: ContainerSize): number => {
      const vh = window.innerHeight
      if (size === "expanded") return vh
      if (size === "minimized") return 88
      return Math.round(vh * 0.44)
    }

    const resolveSnap = (deltaY: number, velocity: number): ContainerSize => {
      // Always move at most ONE step at a time: minimized ↔ default ↔ expanded.
      // This prevents jumping directly from expanded to minimized or vice-versa.
      const order: ContainerSize[] = ["minimized", "default", "expanded"]
      const snapH: Record<ContainerSize, number> = {
        expanded: window.innerHeight,
        default: Math.round(window.innerHeight * 0.44),
        minimized: 88,
      }
      const idx = order.indexOf(dragStartSize.current)
      const currentH = sizeToHeight(dragStartSize.current) - deltaY
      // Upward intent (negative deltaY / negative velocity) → one step up
      if (velocity < -0.2 || deltaY < -30) return order[Math.min(idx + 1, order.length - 1)]
      // Downward intent → one step down
      if (velocity > 0.5 || deltaY > 70) return order[Math.max(idx - 1, 0)]
      // Slow drag → nearest snap point (still capped to one step from start)
      const nearest = (Object.keys(snapH) as ContainerSize[]).reduce((best, k) =>
        Math.abs(currentH - snapH[k]) < Math.abs(currentH - snapH[best]) ? k : best
      )
      const nearestIdx = order.indexOf(nearest)
      // Clamp to one step away from where we started
      const clampedIdx = Math.max(idx - 1, Math.min(idx + 1, nearestIdx))
      return order[clampedIdx]
    }

    // Returns true if `el` is inside a scrollable container that isn't the main scroll root.
    // This prevents accordion / nested-scroll areas from triggering sheet expansion.
    const isInsideNestedScroll = (target: EventTarget | null): boolean => {
      let el = target as HTMLElement | null
      const root = scrollContainerRef.current
      while (el && el !== root) {
        const style = window.getComputedStyle(el)
        const oy = style.overflowY
        if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) {
          return true
        }
        el = el.parentElement
      }
      return false
    }

    const onTouchStart = (e: TouchEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) return
      dragStartY.current = e.touches[0].clientY
      dragStartTime.current = Date.now()
      dragStartSize.current = containerSizeRef.current
      touchStartScrollTop.current = scrollContainerRef.current?.scrollTop ?? 0
      // Handle area: commit to dragging immediately (no ambiguity)
      if (handleRef.current?.contains(e.target as Node)) {
        touchPhase.current = "dragging"
      } else if (isInsideNestedScroll(e.target)) {
        // Touch started inside a nested scrollable (e.g. accordion list)
        // Only allow downward (shrink) gestures when main scroll is at top;
        // never intercept upward scrolls so nested content scrolls freely.
        touchPhase.current = "nested-scroll" as any
      } else {
        touchPhase.current = "deciding"
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      if (touchPhase.current === "idle") return

      // deltaY: positive = finger moved DOWN
      const deltaY = e.touches[0].clientY - dragStartY.current

      if (touchPhase.current === "deciding") {
        if (Math.abs(deltaY) < 8) return // not committed yet, wait for clearer intent
        // Upward drag (negative deltaY) → expand sheet, unless already expanded
        if (deltaY < 0 && dragStartSize.current !== "expanded") {
          touchPhase.current = "dragging"
        }
        // Downward drag (positive deltaY) → shrink sheet, only when scroll is at top
        // Allow tiny scrollTop tolerance — some browsers report 1-2px when "at top"
        else if (deltaY > 0 && touchStartScrollTop.current <= 4) {
          touchPhase.current = "dragging"
        }
        else {
          // Scroll inside content — let browser handle it, map won't move due to overscroll-behavior
          touchPhase.current = "idle"
          return
        }
      }

      // nested-scroll: only allow sheet shrink on downward drag when main scroll is at top
      if ((touchPhase.current as string) === "nested-scroll") {
        if (deltaY > 8 && touchStartScrollTop.current <= 4) {
          touchPhase.current = "dragging"
        } else {
          // let the nested element scroll freely — don't preventDefault
          return
        }
      }

      if (touchPhase.current === "dragging") {
        e.preventDefault()
        const baseH = sizeToHeight(dragStartSize.current)
        setLiveHeight(Math.max(88, Math.min(window.innerHeight, baseH - deltaY)))
      }
    }

    const onTouchEnd = (e: TouchEvent) => {
      // Tap-to-expand: phase still "deciding" (never moved enough) + short duration
      // → cycle to next size up. Skip if tap target is interactive so buttons/links work.
      if (touchPhase.current === "deciding") {
        const deltaTime = Date.now() - dragStartTime.current
        const target = e.target as HTMLElement | null
        const isInteractive = !!target?.closest(
          'button, a, input, textarea, select, [role="button"], [role="link"], [data-no-sheet-tap]'
        )
        if (!isInteractive && deltaTime < 250) {
          const order: ContainerSize[] = ["minimized", "default", "expanded"]
          const idx = order.indexOf(containerSizeRef.current)
          if (idx < order.length - 1) setContainerSize(order[idx + 1])
        }
        touchPhase.current = "idle"
        return
      }
      if (touchPhase.current !== "dragging") {
        touchPhase.current = "idle"
        return
      }
      const deltaY = e.changedTouches[0].clientY - dragStartY.current
      const deltaTime = Date.now() - dragStartTime.current
      const velocity = deltaY / Math.max(deltaTime, 1)
      setContainerSize(resolveSnap(deltaY, velocity))
      setLiveHeight(null)
      touchPhase.current = "idle"
    }

    // Mouse events for desktop drag testing (handle only, via onMouseDown on handle)
    const onMouseMove = (e: MouseEvent) => {
      if (touchPhase.current !== "dragging") return
      const deltaY = e.clientY - dragStartY.current
      const baseH = sizeToHeight(dragStartSize.current)
      setLiveHeight(Math.max(88, Math.min(window.innerHeight, baseH - deltaY)))
    }

    const onMouseUp = (e: MouseEvent) => {
      if (touchPhase.current !== "dragging") return
      const deltaY = e.clientY - dragStartY.current
      const deltaTime = Date.now() - dragStartTime.current
      // Small movement = click on handle → cycle to next size up
      if (Math.abs(deltaY) < 5 && deltaTime < 300) {
        const order: ContainerSize[] = ["minimized", "default", "expanded"]
        const idx = order.indexOf(containerSizeRef.current)
        if (idx < order.length - 1) setContainerSize(order[idx + 1])
        setLiveHeight(null)
        touchPhase.current = "idle"
        return
      }
      const velocity = deltaY / Math.max(deltaTime, 1)
      setContainerSize(resolveSnap(deltaY, velocity))
      setLiveHeight(null)
      touchPhase.current = "idle"
    }

    window.addEventListener("touchstart", onTouchStart, { passive: true })
    window.addEventListener("touchmove", onTouchMove, { passive: false })
    window.addEventListener("touchend", onTouchEnd)
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
    return () => {
      window.removeEventListener("touchstart", onTouchStart)
      window.removeEventListener("touchmove", onTouchMove)
      window.removeEventListener("touchend", onTouchEnd)
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }
  }, [isMobile, setContainerSize])

  // ── Wheel-to-resize (mobile only) ──
  // deltaY > 0 → finger/scroll DOWN  → sheet expands
  // deltaY < 0 → finger/scroll UP    → sheet shrinks (only when no scrollable content or at top with no content)
  // Desktop: completely disabled — wheel always scrolls content normally.
  useEffect(() => {
    if (!isMobile) return
    const panel = containerRef.current
    if (!panel) return
    const onWheel = (e: WheelEvent) => {
      const scrollEl = scrollContainerRef.current
      if (scrollEl && !scrollEl.contains(e.target as Node)) return
      const atTop = (scrollEl?.scrollTop ?? 0) <= 2
      const order: ContainerSize[] = ["minimized", "default", "expanded"]
      const idx = order.indexOf(containerSizeRef.current)
      const hasScrollableContent = !!(scrollEl && scrollEl.scrollHeight > scrollEl.clientHeight + 4)

      if (e.deltaY > 0 && atTop && idx < order.length - 1) {
        // Scroll DOWN → expand sheet
        e.preventDefault()
        setContainerSize(order[idx + 1])
      } else if (e.deltaY < 0 && idx > 0 && !hasScrollableContent) {
        // Scroll UP → shrink sheet, but only if there's no scrollable content
        // (prevents stealing scroll from the object grid)
        e.preventDefault()
        setContainerSize(order[idx - 1])
      }
    }
    panel.addEventListener("wheel", onWheel, { passive: false })
    return () => panel.removeEventListener("wheel", onWheel)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile, setContainerSize])

  // Share current URL to clipboard
  const handleShare = useCallback(async () => {
    const url = window.location.href
    try {
      await navigator.clipboard.writeText(url)
      setShowCopied(true)
      setTimeout(() => setShowCopied(false), 2000)
    } catch {
      // Fallback for older browsers
      const input = document.createElement('input')
      input.value = url
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
      setShowCopied(true)
      setTimeout(() => setShowCopied(false), 2000)
    }
  }, [])

  // Filter chip helpers
  const activeFilterCount = facetedFilters.countries.length + facetedFilters.cities.length + facetedFilters.institutions.length
  const removeFilter = useCallback((type: keyof FacetedFilters, value: string) => {
    if (!onFacetedFiltersChange) return
    onFacetedFiltersChange({
      ...facetedFilters,
      [type]: facetedFilters[type].filter(v => v !== value),
    })
  }, [facetedFilters, onFacetedFiltersChange])
  const clearAllFilters = useCallback(() => {
    onFacetedFiltersChange?.({ institutions: [], countries: [], cities: [] })
  }, [onFacetedFiltersChange])

   // Display name: only show geocoded name (not locationName fallback)
  const displayName = geocodedName || ''
  // Show resolved line when both names exist and differ
  const showResolved = !!(geocodedName && locationName && geocodedName.toLowerCase() !== locationName.toLowerCase())

  // Related objects filler: when < 12 results, fill with related objects from same region
  const relatedObjects = useMemo(() => {
    if (objects.length >= 12 || objects.length === 0 || allObjects.length === 0) return []
    const needed = 12 - objects.length
    const objectIds = new Set(objects.map(o => o.id))
    // Determine current region from locationName or first object
    const region = locationName || objects[0]?.attributes?.country_en || ''
    // Prefer same country, then any
    const sameRegion = allObjects.filter(o =>
      !objectIds.has(o.id) &&
      o.attributes?.img_url &&
      (o.attributes?.country_en === region || o.attributes?.place_name === region)
    )
    const others = allObjects.filter(o =>
      !objectIds.has(o.id) && o.attributes?.img_url && !sameRegion.includes(o)
    )
    return [...sameRegion, ...others].slice(0, needed)
  }, [objects, allObjects, locationName])

  // Match museum objects to wiki link cards by place/origin overlap
  const wikiLinks = useMemo(() => {
    if (linkObjects.length === 0 || objects.length === 0) return [] as { museum: MuseumObject; linkCard: MuseumObject }[]

    // Build tokens from each wiki object title
    const wikiIndex = linkObjects.map(w => {
      const title = (w.attributes.title || '').toLowerCase()
      const tokens = title.split(/[\s\-_,()]+/).filter(t => t.length > 2)
      return { obj: w, title, tokens }
    })

    const pairs: { museum: MuseumObject; linkCard: MuseumObject }[] = []
    const usedWiki = new Set<string>()

    for (const m of objects) {
      if (String(m.id).startsWith('wiki-')) continue // skip wiki objects in main list

      const placeName = (m.attributes.place_name || '').toLowerCase()
      const origin = (m.attributes.normalized_origin || '').toLowerCase()
      const country = (m.attributes.country_en || '').toLowerCase()
      const city = (m.attributes.city_en || '').toLowerCase()

      const museumTokens = [
        ...placeName.split(/[\s\-_,()]+/),
        ...origin.split(/[\s\-_,()]+/),
        ...country.split(/[\s\-_,()]+/),
        ...city.split(/[\s\-_,()]+/),
      ].filter(t => t.length > 2)

      for (const w of wikiIndex) {
        if (usedWiki.has(w.obj.id)) continue

        // substring match: wiki title contains place/origin or vice-versa
        const matched =
          (placeName && placeName.length > 2 && (w.title.includes(placeName) || placeName.includes(w.title))) ||
          (origin && origin.length > 2 && (w.title.includes(origin) || origin.includes(w.title))) ||
          (country && country.length > 2 && w.title.includes(country)) ||
          // token overlap
          w.tokens.some(wt => museumTokens.some(mt => wt.includes(mt) || mt.includes(wt)))

        if (matched) {
          pairs.push({ museum: m, linkCard: w.obj })
          usedWiki.add(w.obj.id)
          break // one link per museum object
        }
      }
    }

    return pairs
  }, [objects, linkObjects])

  // Close gallery when objects become empty or selectedIndex goes out of bounds
  // Skip when showing a deep-linked artifact (galleryArtifact overrides objects[])
  useEffect(() => {
    if (galleryArtifact) return
    if (galleryOpen && (!objects || objects.length === 0)) {
      setGalleryOpen(false)
      setSelectedIndex(0)
    } else if (galleryOpen && selectedIndex >= objects.length) {
      setSelectedIndex(Math.max(0, objects.length - 1))
    }
  }, [objects, galleryOpen, selectedIndex, galleryArtifact])

  // Deep-link: auto-open gallery when a specific artifact is passed via prop
  useEffect(() => {
    if (!initialGalleryArtifact || galleryOpen) return
    setGalleryArtifact(initialGalleryArtifact)
    setSelectedIndex(0)
    setGalleryOpen(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialGalleryArtifact])

  // Once site objects load, switch gallery from single-artifact mode to full list.
  // Using galleryKey forces ImageGallery to remount with the correct initialIndex.
  const [galleryKey, setGalleryKey] = useState(0)

  // Gallery fade-in: two-frame flush triggers CSS transition from opacity:0 → opacity:1
  const [galleryVisible, setGalleryVisible] = useState(false)
  useEffect(() => {
    if (galleryOpen) {
      const id = requestAnimationFrame(() =>
        requestAnimationFrame(() => setGalleryVisible(true))
      )
      return () => cancelAnimationFrame(id)
    } else {
      setGalleryVisible(false)
    }
  }, [galleryOpen])

  // ── Mobile: gallery should always be at expanded size (Apple Maps detail behavior) ──
  // Remember the size before opening so we can restore it on close.
  const sizeBeforeGallery = useRef<ContainerSize | null>(null)
  useEffect(() => {
    if (!isMobile) return
    if (galleryOpen) {
      if (sizeBeforeGallery.current === null) {
        sizeBeforeGallery.current = containerSizeRef.current
        if (containerSizeRef.current !== "expanded") setContainerSize("expanded")
      }
    } else if (sizeBeforeGallery.current !== null) {
      setContainerSize(sizeBeforeGallery.current)
      sizeBeforeGallery.current = null
    }
  }, [galleryOpen, isMobile, setContainerSize])
  useEffect(() => {
    if (!galleryArtifact || !galleryOpen || objects.length === 0) return
    const idx = objects.findIndex(o => String(o.id) === String(galleryArtifact.id))
    if (idx !== -1) {
      setSelectedIndex(idx)
      setGalleryArtifact(null)
      setGalleryKey(k => k + 1) // force remount so initialIndex is picked up
    }
  }, [objects, galleryArtifact, galleryOpen])

  const getContainerStyle = (): React.CSSProperties => {
    if (isMobile) {
      const shadow = "0 -2px 20px rgba(0,0,0,0.10), 0 8px 24px rgba(0,0,0,0.07)"
      // iOS-style spring: fast start, soft settle. 350ms feels natural without being heavy.
      const ease = "cubic-bezier(0.32,0.72,0,1)"
      const transition = prefersReducedMotion.current
        ? "none"
        : `height 0.35s ${ease}, border-radius 0.30s ${ease}, left 0.30s ${ease}, right 0.30s ${ease}, bottom 0.30s ${ease}`
      // Respect iPhone home indicator / notch
      const safeBottom = "max(16px, env(safe-area-inset-bottom))"

      if (liveHeight !== null) {
        // During drag: always bottom-anchored so sheet grows/shrinks upward
        const isNearExpanded = liveHeight >= window.innerHeight * 0.9
        return {
          top: "auto",
          transition: "none",
          height: liveHeight,
          bottom: isNearExpanded ? 0 : safeBottom,
          left: isNearExpanded ? 0 : 12,
          right: isNearExpanded ? 0 : 12,
          borderRadius: isNearExpanded ? 0 : 24,
          boxShadow: isNearExpanded ? "none" : shadow,
        }
      }

      switch (containerSize) {
        case "expanded":
          // Keep top:"auto" + bottom:0 so height animation always grows upward from bottom
          return { transition, top: "auto", bottom: 0, left: 0, right: 0, height: "100dvh", borderRadius: 0, boxShadow: "none" }
        case "minimized":
          return { transition, top: "auto", bottom: safeBottom, left: 12, right: 12, height: 88, borderRadius: 24, boxShadow: shadow }
        case "default":
        default:
          return { transition, top: "auto", bottom: safeBottom, left: 12, right: 12, height: "44dvh", borderRadius: 24, boxShadow: shadow }
      }
    }

    const desktopTransition = prefersReducedMotion.current ? "none" : "width 0.26s cubic-bezier(0.4,0,0.2,1), height 0.26s cubic-bezier(0.4,0,0.2,1)"
    switch (containerSize) {
      case "expanded":
        return {
          transition: desktopTransition,
          width: "calc(100% - 5rem)",
          height: "calc(100dvh - 5rem)",
        }
      case "default":
      default:
        return {
          transition: desktopTransition,
          width: "40%",
          height: "auto",
        }
    }
  }

  const toggleSize = () => {
    if (isMobile) {
      // Cycle: minimized → default → expanded → default
      if (containerSize === "minimized") setContainerSize("default")
      else if (containerSize === "default") setContainerSize("expanded")
      else setContainerSize("default")
    } else {
      setContainerSize(containerSize === "default" ? "expanded" : "default")
    }
  }

  const toggleMinimize = () => {
    setContainerSize(containerSize === "minimized" ? "default" : "minimized")
  }

  const handleObjectClick = (longitude: number, latitude: number, index: number) => {
    const obj = objects[index]
    // Wikipedia articles: open source link in new tab instead of gallery
    if (obj && String(obj.id).startsWith('wiki-') && obj.attributes?.source_link) {
      window.open(obj.attributes.source_link, '_blank', 'noopener,noreferrer')
      return
    }
    onObjectClick(longitude, latitude)
    setSelectedIndex(index)
    if (objects && objects.length > 0) {
      setGalleryOpen(true)
    }
  }

  // Download CSV
  const downloadObjectsAsCSV = () => {
    const headers = [
      "ID", "Title", "Inventory Number", "From Place", "From City", "From Country",
      "To Institution", "To Place", "To City", "To Country",
      "Longitude", "Latitude", "Institution Longitude", "Institution Latitude",
    ].join(",")

    const csvRows = objects.map((obj) => {
      const attrs = obj.attributes
      return [
        obj.id,
        `"${(attrs.title || "").replace(/"/g, '""')}"`,
        `"${(attrs.inventory_number || "").replace(/"/g, '""')}"`,
        `"${(attrs.place_name || "").replace(/"/g, '""')}"`,
        `"${(attrs.city_en || "").replace(/"/g, '""')}"`,
        `"${(attrs.country_en || "").replace(/"/g, '""')}"`,
        `"${(attrs.institution_name || "").replace(/"/g, '""')}"`,
        `"${(attrs.institution_place || "").replace(/"/g, '""')}"`,
        `"${(attrs.institution_city_en || "").replace(/"/g, '""')}"`,
        `"${(attrs.institution_country_en || "").replace(/"/g, '""')}"`,
        attrs.longitude || "",
        attrs.latitude || "",
        attrs.institution_longitude || "",
        attrs.institution_latitude || "",
      ].join(",")
    })

    const csvContent = [headers, ...csvRows].join("\n")
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.setAttribute("href", url)
    link.setAttribute("download", `ex-situ-objects-${new Date().toISOString().split("T")[0]}.csv`)
    link.style.visibility = "hidden"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const containerStyle = getContainerStyle()

  const sheetInner = (
    <div className="h-full flex flex-col">
      {/* Mobile drag handle */}
      {isMobile && (
        <div
          ref={handleRef}
          role="button"
          tabIndex={0}
          aria-label={`Panel is ${containerSize}. Use arrow keys to resize.`}
          aria-expanded={containerSize === "expanded"}
          className="flex-shrink-0 flex items-center justify-center pt-2 pb-1 select-none"
          style={{ touchAction: "none" }}
          onMouseDown={(e) => {
            dragStartY.current = e.clientY
            dragStartTime.current = Date.now()
            dragStartSize.current = containerSizeRef.current
            touchPhase.current = "dragging"
          }}
          onKeyDown={(e) => {
            const order: ContainerSize[] = ["minimized", "default", "expanded"]
            const idx = order.indexOf(containerSize)
            if (e.key === "ArrowUp") { e.preventDefault(); setContainerSize(order[Math.min(idx + 1, 2)]) }
            else if (e.key === "ArrowDown") { e.preventDefault(); setContainerSize(order[Math.max(idx - 1, 0)]) }
            else if (e.key === "Escape") { e.preventDefault(); setContainerSize("minimized") }
          }}
        >
          <div className="w-14 h-1 rounded-full bg-gray-300" />
        </div>
      )}
        {/* Header: Desktop and Mobile layouts */}
        {isMobile ? (
          <div className="sticky top-0 z-30 flex flex-col bg-white">
            <div className="flex items-center justify-between text-sm min-w-0 px-4 pt-0">
              <div className="flex items-center min-w-0 flex-1 overflow-hidden">
                {breadcrumb.map((seg, i) => {
                  const isLast = i === breadcrumb.length - 1
                  return (
                    <span
                      key={i}
                      className={`flex items-center ${isLast ? "min-w-0 overflow-hidden" : "flex-shrink-0"}`}
                    >
                      {i > 0 && <span className="text-black/30 mx-1 flex-shrink-0">/</span>}
                      {isLast ? (
                        <span
                          className="text-black font-medium truncate"
                          title={seg.label}
                        >
                          {seg.label}
                        </span>
                      ) : (
                        <button
                          className="text-black/60 hover:text-black underline-offset-2 hover:underline transition-colors whitespace-nowrap"
                          onClick={() => onBreadcrumbClick?.(seg.level)}
                        >
                          {seg.label}
                        </button>
                      )}
                    </span>
                  )
                })}
              </div>
              <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                {onCommandPaletteOpen && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={onCommandPaletteOpen} title="Search (⌘K)">
                    <IconSearch className="w-5 h-5 text-gray-500" />
                  </Button>
                )}
              </div>
            </div>
            <InfoPanel
                isMobile={isMobile}
                containerSize={containerSize}
                breadcrumb={[]}
                onBreadcrumbClick={undefined}
                onCommandPaletteOpen={undefined}
                actionSlot={objects.length > 0 ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="More options">
                        <MoreHorizontal className="h-5 w-5 text-gray-500" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[160px]">
                      <DropdownMenuItem onClick={handleShare} className="gap-2 cursor-pointer">
                        {showCopied ? <Check className="h-4 w-4 text-green-500" /> : <IconShare className="h-4 w-4 text-gray-500" />}
                        {showCopied ? "Link copied!" : "Share link"}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={downloadObjectsAsCSV} className="gap-2 cursor-pointer">
                        <IconDownloadCsv className="h-4 w-4 text-gray-500" />
                        Download CSV
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : undefined}
                totalCount={totalCount}
                collectionCount={collectionCount}
                isLoading={isLoading}
                drillLevel={drillLevel}
                groupedOrigins={groupedOrigins}
                isLoadingOrigins={isLoadingOrigins}
                onOriginClick={onOriginClick}
                groupedSites={groupedSites}
                activeSite={activeSite}
                onToggleSite={onToggleSite}
                isLoadingSubArcs={isLoadingSubArcs}
                drillInstitutions={drillInstitutions}
                activeInstitution={activeInstitution}
                onToggleInstitution={onToggleInstitution}
                facetedFilters={facetedFilters}
                removeFilter={removeFilter}
                clearAllFilters={clearAllFilters}
                locationName={locationName}
                geocodedName={geocodedName}
              />
          </div>
        ) : (
          <div className="sticky top-0 z-30 flex flex-row items-start bg-white">
            <div className="flex-1 min-w-0">
              <InfoPanel
                isMobile={isMobile}
                containerSize={containerSize}
                breadcrumb={[]}
                onBreadcrumbClick={undefined}
                onCommandPaletteOpen={undefined}
                totalCount={totalCount}
                collectionCount={collectionCount}
                isLoading={isLoading}
                drillLevel={drillLevel}
                groupedOrigins={groupedOrigins}
                isLoadingOrigins={isLoadingOrigins}
                onOriginClick={onOriginClick}
                groupedSites={groupedSites}
                activeSite={activeSite}
                onToggleSite={onToggleSite}
                isLoadingSubArcs={isLoadingSubArcs}
                drillInstitutions={drillInstitutions}
                activeInstitution={activeInstitution}
                onToggleInstitution={onToggleInstitution}
                facetedFilters={facetedFilters}
                removeFilter={removeFilter}
                clearAllFilters={clearAllFilters}
                locationName={locationName}
                geocodedName={geocodedName}
              />
            </div>
            <div className="flex items-center gap-2 shrink-0 pt-2 pr-4">
              {objects.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="More options">
                      <MoreHorizontal className="h-5 w-5 text-gray-500" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[160px]">
                    <DropdownMenuItem onClick={handleShare} className="gap-2 cursor-pointer">
                      {showCopied ? <Check className="h-5 w-5 text-green-500" /> : <IconShare className="h-5 w-5" />}
                      {showCopied ? "Link copied!" : "Share link"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={downloadObjectsAsCSV} className="gap-2 cursor-pointer">
                      <IconDownloadCsv className="h-5 w-5" />
                      Download CSV
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {/* Expand/minimize — desktop only */}
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleSize}>
                {containerSize === "expanded" ? <IconMinimize className="h-5 w-5 text-gray-500" /> : <IconExpand className="h-5 w-5 text-gray-500" />}
              </Button>
            </div>
          </div>
        )}

        {/* Content — objects */}
        {containerSize !== "minimized" && (
        <div ref={scrollContainerRef} className="flex-1 overflow-auto bg-white" style={{ touchAction: "pan-y", overscrollBehaviorY: "contain" }}>
          <ObjectGrid
            objects={objects}
            onLoadMore={onLoadMore}
            hasMore={hasMore}
            totalCount={totalCount}
            isLoading={isLoading}
            onObjectClick={(longitude, latitude, index) => handleObjectClick(longitude, latitude, index)}
            isFullscreen={containerSize === "expanded"}
            panelSize={containerSize === "expanded" ? 100 : 40}
            mobileColumns={3}
          />
          {relatedObjects.length > 0 && objects.length > 0 && objects.length < 12 && (
            <div className="px-4 pb-4 bg-white">
              <div className="flex items-center gap-3 py-2">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-sm text-gray-400 uppercase tracking-wider whitespace-nowrap">Related from region</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>
              <ObjectGrid
                objects={relatedObjects}
                onLoadMore={() => {}}
                hasMore={false}
                totalCount={relatedObjects.length}
                isLoading={false}
                onObjectClick={(longitude, latitude, index) => {
                  if (longitude && latitude) onObjectClick(longitude, latitude)
                }}
                isFullscreen={containerSize === "expanded"}
                panelSize={containerSize === "expanded" ? 100 : 40}
                mobileColumns={3}
              />
            </div>
          )}
          {/* Links section — paired museum image + wiki link cards */}
          {wikiLinks.length > 0 && (
            <div className="px-4 pb-4 bg-white">
              <div className="flex items-center gap-3 py-2">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="font-mono text-[10px] text-gray-400 uppercase tracking-wider whitespace-nowrap">Links</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                {wikiLinks.flatMap(({ museum, linkCard }) => [
                  /* Image card — museum object thumbnail */
                  <div
                    key={`img-${museum.id}`}
                    className="group relative cursor-pointer bg-white p-1 h-44 flex items-center justify-center"
                    onClick={() => {
                      const a = museum.attributes
                      if (a.longitude && a.latitude) onObjectClick(a.longitude, a.latitude)
                    }}
                  >
                    <div className="relative inline-flex overflow-hidden bg-white rounded-[10px] group-hover:ring-2 group-hover:ring-blue-500">
                      {museum.attributes?.img_url ? (
                        <BlurhashImage
                          src={museum.attributes.img_url}
                          alt={museum.attributes.title || "Museum object"}
                          className="block"
                          imgClassName="block max-h-36 w-auto bg-white"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex items-center justify-center text-center p-2 bg-white min-h-[80px]">
                          <span className="text-gray-500 text-sm">Image unavailable</span>
                        </div>
                      )}
                    </div>
                  </div>,
                  /* Link card — Wikipedia article */
                  <div
                    key={`link-${linkCard.id}`}
                    className="relative cursor-pointer bg-white rounded-[10px] border border-gray-100 p-3 h-44 flex flex-col justify-between transition-colors hover:bg-[#f5f5f5]"
                    onClick={() => {
                      if (linkCard.attributes.source_link) {
                        window.open(linkCard.attributes.source_link, '_blank', 'noopener,noreferrer')
                      }
                    }}
                  >
                    {/* Top-left arrow */}
                    <span className="text-gray-400 text-sm leading-none">↗</span>
                    {/* Center — image or title */}
                    <div className="flex-1 flex items-center justify-center overflow-hidden px-1">
                      {linkCard.attributes.img_url ? (
                        <img
                          src={linkCard.attributes.img_url}
                          alt={linkCard.attributes.title || ''}
                          className="max-h-20 max-w-full object-contain rounded"
                          loading="lazy"
                        />
                      ) : (
                        <span className="font-mono text-sm text-[#111] text-center line-clamp-4 leading-tight">
                          {linkCard.attributes.title}
                        </span>
                      )}
                    </div>
                    {/* Bottom row */}
                    <div className="flex items-end justify-between mt-1 pl-0">
                      <span className="text-[9px] text-gray-400 leading-none">Wikipedia</span>
                      <span className="text-[9px] text-gray-400 leading-none truncate ml-1 max-w-[60%] text-right">
                        {linkCard.attributes.place_name || linkCard.attributes.country_en || ''}
                      </span>
                    </div>
                  </div>
                ])}
              </div>
            </div>
          )}
        </div>
        )}
      </div>
  )

  return (
    <div
      ref={containerRef}
      role={isMobile ? "complementary" : undefined}
      aria-label={isMobile ? "Object panel" : undefined}
      className={`fixed ${
        isMobile
          ? "" // all positioning/sizing handled by inline style
          : "top-10 right-10 bottom-10 shadow-lg"
      } bg-white z-20 overflow-hidden`}
      style={{
        ...containerStyle,
        ...(!isMobile ? { borderRadius: "1rem" } : {}),
        ...(isMobile && liveHeight !== null ? { willChange: "height" } : {}),
      }}
    >
      {sheetInner}

      {/* Image Gallery — subtle fade + slide entrance */}
      {galleryOpen && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 59,
            opacity: galleryVisible ? 1 : 0,
            transform: galleryVisible ? "translateY(0)" : "translateY(6px)",
            transition: "opacity 0.18s ease, transform 0.18s ease",
            pointerEvents: galleryVisible ? "auto" : "none",
          }}
        >
          <ImageGallery
            key={galleryKey}
            objects={galleryArtifact ? [galleryArtifact] : objects}
            initialIndex={galleryArtifact ? 0 : selectedIndex}
            onClose={() => { setGalleryArtifact(null); setGalleryOpen(false) }}
            isFullscreen={containerSize === "expanded"}
            isMobile={isMobile}
          />
        </div>
      )}
    </div>
  )
}

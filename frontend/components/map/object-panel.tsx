"use client"

import { useState, useRef, useEffect, useMemo, useCallback } from "react"
import { ChevronDown, ChevronUp, Check, MoreHorizontal, FileText, FileJson, Loader2 } from "lucide-react"
import { IconSearch, IconClose, IconDownloadCsv, IconExpand, IconMinimize, IconShare, IconPanelOpen, IconPanelClosed } from "@/components/icons"
import { fetchObjectsByCountry } from "@/lib/api"
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

const hasImageUrl = (imgUrl?: string | null) => typeof imgUrl === "string" && imgUrl.trim().length > 0

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
  displayName: string
  rawNames: string[]
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
  onObjectClick: (longitude: number, latitude: number, object?: MuseumObject) => void
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
  activeCountry?: string | null
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
  activeCountry = null,
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
  // Snapshot of gallery objects taken at click time so the gallery stays open
  // while the background drill-down empties and refills containerObjects.
  const gallerySnapshot = useRef<MuseumObject[]>([])
  const [showOrigins, setShowOrigins] = useState(false)
  const [showSites, setShowSites] = useState(false)
  const [showCollections, setShowCollections] = useState(true)
  const [showCopied, setShowCopied] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  const galleryObjects = useMemo(() => {
    return objects.filter((object) => hasImageUrl(object.attributes?.img_url))
  }, [objects])

  // ── Mobile bottom-sheet drag-to-resize ──
  const containerSizeRef = useRef<ContainerSize>(containerSize)
  const dragStartY = useRef(0)
  const dragStartTime = useRef(0)
  const dragStartSize = useRef<ContainerSize>("default")
  // "idle" → no gesture | "deciding" → content area (up=expand, down=scroll) | "deciding-header" → header area (both directions → drag) | "dragging" → sheet is being dragged
  const touchPhase = useRef<"idle" | "deciding" | "deciding-header" | "dragging">("idle")
  const touchStartScrollTop = useRef(0)
  // Cooldown: timestamp after which new touch gestures are accepted (prevents double-snap on fast swipes)
  const snapCooldownUntil = useRef(0)
  // Wheel: separate debounce timer — extends as long as wheel events keep firing (momentum scroll)
  const wheelLockTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wheelLocked = useRef(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const prefersReducedMotion = useRef(false)
  const [liveHeight, setLiveHeight] = useState<number | null>(null)

  useEffect(() => {
    prefersReducedMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  }, [])

  // Keep containerSizeRef in sync
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
      // Ignore new gesture while snap animation is playing
      if (Date.now() < snapCooldownUntil.current) return
      dragStartY.current = e.touches[0].clientY
      dragStartTime.current = Date.now()
      dragStartSize.current = containerSizeRef.current
      touchStartScrollTop.current = scrollContainerRef.current?.scrollTop ?? 0
      if (handleRef.current?.contains(e.target as Node)) {
        // Handle touch → always resize the sheet
        touchPhase.current = "dragging"
      } else if (headerRef.current?.contains(e.target as Node)) {
        // Header touch: accordion/nested scroll areas scroll freely; bare header resizes
        if (isInsideNestedScroll(e.target)) {
          touchPhase.current = "idle"
        } else if (containerSizeRef.current === "expanded") {
          // Expanded: header drag can shrink the sheet (downward = shrink)
          touchPhase.current = "dragging"
        } else {
          // Non-expanded: both directions can resize — use deciding-header
          touchPhase.current = "deciding-header"
        }
      } else if (scrollContainerRef.current?.contains(e.target as Node)) {
        if (containerSizeRef.current === "expanded") {
          // Expanded: content always scrolls freely, sheet can only shrink via handle
          touchPhase.current = "idle"
        } else {
          // Default/minimized: upward swipe on grid → expand sheet; downward → scroll
          touchPhase.current = "deciding"
        }
      } else {
        // Outside scroll container: only allow deciding in non-expanded states
        touchPhase.current = containerSizeRef.current === "expanded" ? "idle" : "deciding"
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      if (touchPhase.current === "idle") return

      // deltaY: positive = finger moved DOWN
      const deltaY = e.touches[0].clientY - dragStartY.current

      if (touchPhase.current === "deciding") {
        if (Math.abs(deltaY) < 8) return // not committed yet
        if (deltaY < 0 && dragStartSize.current !== "expanded") {
          // Upward → expand sheet
          touchPhase.current = "dragging"
        } else {
          // Downward in content area → scroll, never shrink
          touchPhase.current = "idle"
          return
        }
      }

      if ((touchPhase.current as string) === "deciding-header") {
        if (Math.abs(deltaY) < 8) return // not committed yet
        // Header: both up (expand) and down (shrink) become dragging
        touchPhase.current = "dragging"
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
      if (touchPhase.current === "deciding" || (touchPhase.current as string) === "deciding-header") {
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
      // Block new gestures for 350ms (= animation duration) so a fast swipe can't chain two snaps
      snapCooldownUntil.current = Date.now() + 350
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
      // Small movement: let onClick handle the cycle (avoid double-firing)
      if (Math.abs(deltaY) < 5 && deltaTime < 300) {
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
  // Debounce-lock pattern: the first wheel event in a gesture fires the snap.
  // Every subsequent event (including momentum scroll) resets a 600ms timer.
  // The lock lifts only after wheel events fully stop — so momentum can never
  // trigger a second snap within the same gesture.
  // Desktop: completely disabled.
  useEffect(() => {
    if (!isMobile) return
    const panel = containerRef.current
    if (!panel) return

    const unlock = () => { wheelLocked.current = false }

    const onWheel = (e: WheelEvent) => {
      const scrollEl = scrollContainerRef.current
      if (scrollEl && !scrollEl.contains(e.target as Node)) return

      // Always extend the debounce timer — this keeps the lock alive during momentum
      if (wheelLockTimer.current) clearTimeout(wheelLockTimer.current)
      wheelLockTimer.current = setTimeout(unlock, 600)

      // If already locked after a snap:
      // - In expanded state, let content scroll freely (don't block the grid).
      // - In other states, suppress the event so momentum can't re-trigger a snap.
      if (wheelLocked.current) {
        if (containerSizeRef.current !== "expanded") e.preventDefault()
        return
      }

      // Expanded: only handle/header can resize — never trigger sheet change from grid scroll
      if (containerSizeRef.current === "expanded") return

      const atTop = (scrollEl?.scrollTop ?? 0) <= 2
      const order: ContainerSize[] = ["minimized", "default", "expanded"]
      const idx = order.indexOf(containerSizeRef.current)
      const hasScrollableContent = !!(scrollEl && scrollEl.scrollHeight > scrollEl.clientHeight + 4)

      if (e.deltaY > 0 && atTop && idx < order.length - 1) {
        // Scroll DOWN → expand sheet (one step), then lock
        e.preventDefault()
        setContainerSize(order[idx + 1])
        wheelLocked.current = true
      } else if (e.deltaY < 0 && idx > 0 && !hasScrollableContent) {
        // Scroll UP → shrink sheet (one step), then lock
        e.preventDefault()
        setContainerSize(order[idx - 1])
        wheelLocked.current = true
      }
    }

    panel.addEventListener("wheel", onWheel, { passive: false })
    return () => {
      panel.removeEventListener("wheel", onWheel)
      if (wheelLockTimer.current) clearTimeout(wheelLockTimer.current)
    }
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

  // Close gallery when objects become empty or selectedIndex goes out of bounds.
  // While gallery is open we use the snapshot so a background drill-down
  // (which temporarily empties containerObjects) cannot close the gallery.
  // Skip when showing a deep-linked artifact (galleryArtifact overrides objects[]).
  useEffect(() => {
    if (galleryArtifact) return
    const active = gallerySnapshot.current.length > 0 ? gallerySnapshot.current : galleryObjects
    if (galleryOpen && active.length === 0) {
      setGalleryOpen(false)
      setSelectedIndex(0)
    } else if (galleryOpen && selectedIndex >= active.length) {
      setSelectedIndex(Math.max(0, active.length - 1))
    }
  }, [galleryObjects, galleryOpen, selectedIndex, galleryArtifact])

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
    if (!galleryArtifact || !galleryOpen || galleryObjects.length === 0) return
    const idx = galleryObjects.findIndex(o => String(o.id) === String(galleryArtifact.id))
    if (idx !== -1) {
      setSelectedIndex(idx)
      setGalleryArtifact(null)
      setGalleryKey(k => k + 1) // force remount so initialIndex is picked up
    }
  }, [galleryObjects, galleryArtifact, galleryOpen])

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

  const handleObjectClick = (longitude: number, latitude: number, index: number, object?: MuseumObject) => {
    const obj = index >= 0 ? galleryObjects[index] : null
    const selectedObject = obj || object
    if (!obj) {
      onObjectClick(longitude, latitude, selectedObject)
      return
    }
    // Wikipedia articles: open source link in new tab instead of gallery
    if (obj && String(obj.id).startsWith('wiki-') && obj.attributes?.source_link) {
      window.open(obj.attributes.source_link, '_blank', 'noopener,noreferrer')
      return
    }
    // Pass obj so the parent zooms to the right location and starts the
    // drill-down in the background. The snapshot keeps the gallery open
    // during the transition — when the user closes it the new objects are ready.
    gallerySnapshot.current = [...galleryObjects]
    onObjectClick(longitude, latitude, obj)
    setSelectedIndex(index)
    if (galleryObjects.length > 0) {
      setGalleryOpen(true)
    }
  }

  // ── Export helpers ────────────────────────────────────────────────

  const getMostSpecificPlaceName = (value?: string | null) => {
    if (!value) return "Unknown"
    const firstSegment = value
      .split(",")
      .map((part) => part.trim())
      .find(Boolean)
    return firstSegment || value.trim() || "Unknown"
  }

  const isUncertainOrigin = (value?: string | null) => {
    if (!value) return true
    const normalized = value.trim().toLowerCase()
    return !normalized || /unknown|uncertain|unidentified|unlocated|various|multiple/.test(normalized)
  }

  const getArtifactDate = (artifact: MuseumObject) => {
    const attrs = artifact.attributes as MuseumObject["attributes"] & {
      date?: string | null
      year?: string | number | null
    }
    return String(attrs.date || attrs.year || "?").trim() || "?"
  }

  const buildExportFilename = (ext: string) => {
    const date = new Date().toISOString().split("T")[0]
    const country = (activeCountry || "").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") || "all"
    const site = (activeSite || "").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")
    const parts = ["exsitu", country]
    if (site) parts.push(site)
    parts.push(date)
    return `${parts.join("-")}.${ext}`
  }

  /** Fetch every page of the current arc's objects via the by-country endpoint. */
  const fetchAllForExport = useCallback(async () => {
    // No filter active — can't paginate all objects; return what's already loaded
    if (!activeCountry && !activeInstitution) return objects

    const PAGE_SIZE = 200
    const allObjects: import("@/types").MuseumObject[] = []
    let page = 1
    let pageCount = 1
    do {
      const result = await fetchObjectsByCountry(
        activeCountry ?? null,
        page,
        PAGE_SIZE,
        activeSite ?? undefined,
        activeInstitution ?? undefined,
      )
      allObjects.push(...result.objects)
      pageCount = result.pagination.pageCount
      page++
    } while (page <= pageCount)
    return allObjects
  }, [activeCountry, activeSite, activeInstitution, objects])

  /** Trigger a browser download from a string payload. */
  const triggerDownload = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = filename
    link.style.visibility = "hidden"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  // Download CSV — fetches ALL objects for current arc
  const downloadObjectsAsCSV = async () => {
    if (isExporting) return
    setIsExporting(true)
    try {
      const all = await fetchAllForExport()
      const headers = [
        "id", "title", "inventory_number", "place_name", "city_en", "country_en",
        "institution_name", "institution_place", "institution_city_en", "institution_country_en",
        "longitude", "latitude", "institution_longitude", "institution_latitude",
        "source_url", "image_url",
      ].join(",")

      const csvRows = all.map((obj) => {
        const a = obj.attributes
        const esc = (v?: string | null) => `"${(v || "").replace(/"/g, '""')}"`
        return [
          obj.id,
          esc(a.title),
          esc(a.inventory_number),
          esc(a.place_name),
          esc(a.city_en),
          esc(a.country_en),
          esc(a.institution_name),
          esc(a.institution_place),
          esc(a.institution_city_en),
          esc(a.institution_country_en),
          a.longitude ?? "",
          a.latitude ?? "",
          a.institution_longitude ?? "",
          a.institution_latitude ?? "",
          esc(a.source_link),
          esc(a.img_url),
        ].join(",")
      })

      triggerDownload([headers, ...csvRows].join("\n"), buildExportFilename("csv"), "text/csv")
    } finally {
      setIsExporting(false)
    }
  }

  // Export Markdown provenance report
  const exportAsMarkdown = async () => {
    if (isExporting) return
    setIsExporting(true)
    try {
      const all = await fetchAllForExport()
      const exportDate = new Date().toISOString().split("T")[0]

      // Build origin sites table
      const siteMap = new Map<string, { count: number; lat: number; lng: number; sample?: string; displayName: string }>()
      for (const obj of all) {
        const a = obj.attributes
        const rawPlace = a.place_name || a.city_en || "Unknown"
        const key = getMostSpecificPlaceName(rawPlace)
        const existing = siteMap.get(key)
        if (existing) {
          existing.count++
          if (!existing.sample && a.img_url) existing.sample = a.img_url
        } else {
          siteMap.set(key, {
            count: 1,
            lat: a.latitude ?? 0,
            lng: a.longitude ?? 0,
            sample: a.img_url || undefined,
            displayName: key,
          })
        }
      }

      const sortedSites = [...siteMap.entries()].sort((a, b) => b[1].count - a[1].count)
      const total = all.length
      const topSite = sortedSites[0]
      const topSiteName = topSite?.[1].displayName || "Unknown"
      const topSitePct = total > 0 && topSite ? ((topSite[1].count / total) * 100).toFixed(1) : "0.0"
      const top3SiteDistribution = sortedSites
        .slice(0, 3)
        .map(([_, data]) => `${data.displayName} (${data.count})`)
        .join(", ") || "None"
      const siteDistributionLines = sortedSites
        .slice(0, 5)
        .map(([_, data]) => {
          const pct = total > 0 ? ((data.count / total) * 100).toFixed(1) : "0.0"
          return `- ${data.displayName}: ${data.count} artifacts (${pct}%)`
        })
      const institutionList = [...new Set(
        all
          .map((obj) => obj.attributes.institution_name)
          .filter((name): name is string => Boolean(name && name.trim()))
      )]
      const artifactSample = objects.slice(0, 20)
      const uncertainCount = all.filter((obj) => {
        const a = obj.attributes
        return isUncertainOrigin(a.place_name || a.city_en)
      }).length
      const uncertainPct = total > 0 ? ((uncertainCount / total) * 100).toFixed(1) : "0.0"

      // YAML frontmatter
      const frontmatter = [
        "---",
        `filters:`,
        `  country: ${activeCountry || "all"}`,
        `  site: ${activeSite || "all"}`,
        `  institution: ${activeInstitution || "all"}`,
        `export_date: "${exportDate}"`,
        `total_count: ${total}`,
        "---",
      ].join("\n")

      // Origin sites table
      const tableHeader = "| Place | Lat | Lon | Objects | Sample Image |"
      const tableSep   = "|-------|-----|-----|---------|--------------|"
      const tableRows = sortedSites.slice(0, 50).map(([_, d]) =>
        `| ${d.displayName} | ${d.lat.toFixed(4)} | ${d.lng.toFixed(4)} | ${d.count} | ${d.sample ? `![](${d.sample})` : ""} |`
      )

      // Spatial distribution (top 10 + %)
      const distLines = sortedSites.slice(0, 10).map(([_, d]) => {
        const pct = ((d.count / total) * 100).toFixed(1)
        return `- **${d.displayName}**: ${d.count} artifacts (${pct}%)`
      })

      const artifactTableHeader = "| Inventory | Title | Origin Site | Date | Institution | Source |"
      const artifactTableSep = "|-----------|-------|-------------|------|-------------|--------|"
      const artifactTableRows = artifactSample.map((artifact) => {
        const attrs = artifact.attributes
        const sourceLink = attrs.source_link ? `[link](${attrs.source_link})` : ""
        return [
          attrs.inventory_number || "?",
          attrs.title || "Untitled",
          getMostSpecificPlaceName(attrs.place_name || attrs.city_en),
          getArtifactDate(artifact),
          attrs.institution_name || "Unknown",
          sourceLink,
        ].map((value) => String(value).replace(/\|/g, "\\|")).join(" | ")
      }).map((row) => `| ${row} |`)

      // Research prompt
      const researchPrompt = [
        "---",
        "This provenance report was generated by Ex Situ (exsitu.app) —",
        "an open-source federated spatial index of displaced cultural artifacts.",
        "API: https://exsitu.app/api/museum-objects/geospatial",
        "GitHub: https://github.com/hburakyel/ex-situ",
        "",
        "The index tracks only the geographic displacement vector between",
        "an artifact's origin site and its current holding institution.",
        "",
        "Analyze this provenance cluster:",
        "",
        `Origin territory: ${activeCountry || "Unknown"}`,
        `Primary site: ${topSiteName}  `,
        `Destination institution(s): ${institutionList.join(", ") || "Unknown"}`,
        `Total artifacts indexed: ${total}`,
        `Unique origin sites: ${siteMap.size}`,
        "",
        "Site distribution:",
        ...(siteDistributionLines.length > 0 ? siteDistributionLines : ["- None"]),
        "",
        "Sample artifacts (from institutional sources):",
        artifactTableHeader,
        artifactTableSep,
        ...(artifactTableRows.length > 0 ? artifactTableRows : ["| ? | ? | ? | ? | ? | |"]),
        "",
        "Based strictly on documented historical facts, provide:",
        "",
        "1. ACQUISITION CONTEXT",
        "What were the dominant mechanisms — expedition, colonial law,",
        "military campaign, trade — through which artifacts from this",
        "territory entered these institutions? Name specific actors,",
        "dates, treaties where documented.",
        "",
        "2. SPATIAL PATTERN",
        `Why is ${topSiteName} dominant at ${topSitePct}%? What does this concentration`,
        "reveal about acquisition logistics and priorities?",
        "",
        "3. ARTIFACT TYPOLOGY",
        "Based on the sample titles and dates, what categories of",
        "artifacts dominate? What does this selection reveal about",
        "collector priorities?",
        "",
        "4. DOCUMENTATION QUALITY",
        `What percentage have uncertain origin (marked with ?)? ${uncertainPct}%.`,
        "What does this reveal about institutional documentation?",
        "",
        "5. UNESCO 1970 THRESHOLD",
        "Were the majority of these artifacts acquired before or",
        "after 1970? What are the implications for restitution claims?",
        "",
        "Plain academic prose. Four paragraphs maximum per section.",
        "No speculation. Cite only documented facts.",
        "If uncertain, state explicitly.",
        "---",
      ].join("\n")

      const md = [
        frontmatter,
        "",
        `# Ex Situ — Provenance Report`,
        "",
        `**Export date:** ${exportDate}  `,
        `**Total artifacts:** ${total}  `,
        `**Country filter:** ${activeCountry || "all"}  `,
        activeSite ? `**Site filter:** ${activeSite}  ` : null,
        activeInstitution ? `**Institution filter:** ${activeInstitution}  ` : null,
        "",
        "## Origin Sites",
        "",
        tableHeader,
        tableSep,
        ...tableRows,
        "",
        "## Spatial Distribution",
        "",
        ...distLines,
        "",
        `## Artifacts (sample, ${artifactSample.length} of ${total})`,
        "",
        artifactTableHeader,
        artifactTableSep,
        ...(artifactTableRows.length > 0 ? artifactTableRows : ["| ? | ? | ? | ? | ? | |"]),
        "",
        "## Research Prompt",
        "",
        researchPrompt,
      ].filter((l) => l !== null).join("\n")

      triggerDownload(md, buildExportFilename("md"), "text/markdown")
    } finally {
      setIsExporting(false)
    }
  }

  // Export JSON
  const exportAsJSON = async () => {
    if (isExporting) return
    setIsExporting(true)
    try {
      const all = await fetchAllForExport()
      const payload = all.map((obj) => {
        const a = obj.attributes
        return {
          id: obj.id,
          title: a.title,
          inventory_number: a.inventory_number,
          place_name: a.place_name,
          city_en: a.city_en,
          country_en: a.country_en,
          institution_name: a.institution_name,
          institution_place: a.institution_place,
          institution_city_en: a.institution_city_en,
          institution_country_en: a.institution_country_en,
          longitude: a.longitude,
          latitude: a.latitude,
          institution_longitude: a.institution_longitude,
          institution_latitude: a.institution_latitude,
          source_url: a.source_link,
          image_url: a.img_url,
        }
      })
      triggerDownload(JSON.stringify(payload, null, 2), buildExportFilename("json"), "application/json")
    } finally {
      setIsExporting(false)
    }
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
          onClick={() => {
            // Cycle on click/tap: minimized → default → expanded → default
            const order: ContainerSize[] = ["minimized", "default", "expanded"]
            const idx = order.indexOf(containerSizeRef.current)
            setContainerSize(idx < order.length - 1 ? order[idx + 1] : order[idx - 1])
          }}
          onKeyDown={(e) => {
            const order: ContainerSize[] = ["minimized", "default", "expanded"]
            const idx = order.indexOf(containerSize)
            if (e.key === "ArrowUp") { e.preventDefault(); setContainerSize(order[Math.min(idx + 1, 2)]) }
            else if (e.key === "ArrowDown") { e.preventDefault(); setContainerSize(order[Math.max(idx - 1, 0)]) }
            else if (e.key === "Escape") { e.preventDefault(); setContainerSize("minimized") }
            else if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              setContainerSize(idx < order.length - 1 ? order[idx + 1] : order[idx - 1])
            }
          }}
        >
          <div className="w-14 h-1 rounded-full bg-gray-300" />
        </div>
      )}
        {/* Header: Desktop and Mobile layouts */}
        {isMobile ? (
          <div ref={headerRef} className="sticky top-0 z-30 flex flex-col bg-white">
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
                        {isExporting ? <Loader2 className="h-5 w-5 animate-spin text-gray-400" /> : <MoreHorizontal className="h-5 w-5 text-gray-500" />}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[160px]">
                      <DropdownMenuItem onClick={handleShare} className="gap-2 cursor-pointer">
                        {showCopied ? <Check className="h-4 w-4 text-green-500" /> : <IconShare className="h-4 w-4 text-gray-500" />}
                        {showCopied ? "Link copied!" : "Share link"}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={downloadObjectsAsCSV} disabled={isExporting} className="gap-2 cursor-pointer">
                        <IconDownloadCsv className="h-4 w-4 text-gray-500" />
                        Download CSV
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={exportAsMarkdown} disabled={isExporting} className="gap-2 cursor-pointer">
                        <FileText className="h-4 w-4 text-gray-500" />
                        Export MD
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={exportAsJSON} disabled={isExporting} className="gap-2 cursor-pointer">
                        <FileJson className="h-4 w-4 text-gray-500" />
                        Download JSON
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
                activeCountry={activeCountry}
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
                activeCountry={activeCountry}
              />
            </div>
            <div className="flex items-center gap-2 shrink-0 pt-2 pr-4">
              {objects.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="More options">
                      {isExporting ? <Loader2 className="h-5 w-5 animate-spin text-gray-400" /> : <MoreHorizontal className="h-5 w-5 text-gray-500" />}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[160px]">
                    <DropdownMenuItem onClick={handleShare} className="gap-2 cursor-pointer">
                      {showCopied ? <Check className="h-5 w-5 text-green-500" /> : <IconShare className="h-5 w-5" />}
                      {showCopied ? "Link copied!" : "Share link"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={downloadObjectsAsCSV} disabled={isExporting} className="gap-2 cursor-pointer">
                      <IconDownloadCsv className="h-5 w-5" />
                      Download CSV
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={exportAsMarkdown} disabled={isExporting} className="gap-2 cursor-pointer">
                      <FileText className="h-5 w-5" />
                      Export MD
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={exportAsJSON} disabled={isExporting} className="gap-2 cursor-pointer">
                      <FileJson className="h-5 w-5" />
                      Download JSON
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
            onObjectClick={(longitude, latitude, index, object) => handleObjectClick(longitude, latitude, index, object)}
            isFullscreen={containerSize === "expanded"}
            panelSize={containerSize === "expanded" ? 100 : 40}
            mobileColumns={3}
          />
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
                        {linkCard.attributes.place_name_normalized || linkCard.attributes.place_name || linkCard.attributes.country_en || ''}
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
            objects={galleryArtifact ? [galleryArtifact] : (gallerySnapshot.current.length > 0 ? gallerySnapshot.current : galleryObjects)}
            initialIndex={galleryArtifact ? 0 : selectedIndex}
            onClose={() => { gallerySnapshot.current = []; setGalleryArtifact(null); setGalleryOpen(false) }}
            isFullscreen={containerSize === "expanded"}
            isMobile={isMobile}
          />
        </div>
      )}
    </div>
  )
}

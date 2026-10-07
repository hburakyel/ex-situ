"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import type { MuseumObject } from "../types"
import ObjectImage from "@/components/object-image"
import { resolveImageSrc, THUMB_WIDTH } from "@/lib/image-src"
import { useInView } from "react-intersection-observer"
import { Spinner } from "@radix-ui/themes"
import { formatOriginAttribution } from "@/lib/origin-attribution"

const hasImageUrl = (imgUrl?: string | null) => typeof imgUrl === "string" && imgUrl.trim().length > 0

// Objects whose source record the museum withdrew keep a place in the grid as a
// text card (inventory number, collection, link) instead of an image, so it stays
// visible how many objects are affected. Papyri are now in the Berliner
// Papyrusdatenbank; everything else is searched on SMB's own collection site.
const isWithdrawn = (object: MuseumObject) => object.attributes?.source_withdrawn === true
const withdrawnSearchUrl = (object: MuseumObject): string | null => {
  const inv = object.attributes?.inventory_number?.trim()
  if (!inv) return null
  return /^P\b/.test(inv)
    ? `https://berlpap.smb.museum/?s=${encodeURIComponent(inv)}`
    : `https://search.smb.museum/?q=${encodeURIComponent(inv)}`
}

// A tile is only ever shown once its image has actually loaded — objects with
// no image, or whose image fails, are left out of the grid entirely rather than
// rendered as an empty/placeholder tile. Images are preloaded in list order and
// revealed as a contiguous prefix, so tiles never shift once on screen.
const PRELOAD_CONCURRENCY = 8
const PRELOAD_LOOKAHEAD = 24
const PRELOAD_TIMEOUT_MS = 8000
// The first pending image normally blocks everything behind it (that's what keeps
// tiles from shifting). If it's still loading after this long while a later image
// has already loaded, it's the slow one: drop it rather than hold the grid back.
// Lone slowness (e.g. a slow connection, where nothing later has loaded either)
// keeps waiting up to PRELOAD_TIMEOUT_MS as before.
const SLOW_SKIP_MS = 1200
// After this many slow/timed-out images in a row from one host (any image that
// loads resets the count), stop requesting that host's images for the rest of the
// session — e.g. a museum image server that is down.
const SLOW_HOST_STRIKES = 3
const slowHostStrikes = new Map<string, number>()

const imageHost = (url: string): string => {
  try {
    return new URL(url).hostname
  } catch {
    return ""
  }
}
const isSlowHost = (url: string) => (slowHostStrikes.get(imageHost(url)) ?? 0) >= SLOW_HOST_STRIKES
const addSlowHostStrike = (url: string) => {
  const host = imageHost(url)
  if (host) slowHostStrikes.set(host, (slowHostStrikes.get(host) ?? 0) + 1)
}
// Stop auto-fetching further pages after this many in a row reveal nothing new
// (e.g. a filter whose objects are almost all imageless).
const MAX_EMPTY_AUTOLOADS = 5

type ImageStatus = "ok" | "failed"

interface ObjectGridProps {
  objects: MuseumObject[]
  onLoadMore: () => void
  hasMore: boolean
  totalCount: number
  isLoading: boolean
  onObjectClick?: (longitude: number, latitude: number, index: number, object?: MuseumObject) => void
  onObjectHover?: (placeName: string | null) => void
  isFullscreen?: boolean
  panelSize?: number
  mobileColumns?: number
  /** Fixed column count chosen by the user; overrides the responsive layout. */
  columns?: number | null
  /** Fires on every scroll of the grid's internal container, with its scrollTop and how far it can scroll. */
  onScroll?: (scrollTop: number, maxScrollTop: number) => void
}

const GRID_BOTTOM_FADE_STYLE = {
  background: "linear-gradient(to top, rgba(255, 255, 255, 1) 0%, rgba(255, 255, 255, 0.92) 14%, rgba(255, 255, 255, 0.45) 30%, rgba(255, 255, 255, 0) 48%, rgba(255, 255, 255, 0) 100%)",
}

const GRID_TOP_FADE_STYLE = {
  background: "linear-gradient(to bottom, rgba(255, 255, 255, 1) 0%, rgba(255, 255, 255, 0.92) 14%, rgba(255, 255, 255, 0.45) 30%, rgba(255, 255, 255, 0) 48%, rgba(255, 255, 255, 0) 100%)",
}

export default function ObjectGrid({
  objects,
  onLoadMore,
  hasMore,
  totalCount,
  isLoading,
  onObjectClick = () => {},
  onObjectHover = () => {},
  isFullscreen = false,
  panelSize = 50,
  mobileColumns = 2,
  columns: columnsOverride = null,
  onScroll,
}: ObjectGridProps) {
  const { ref: observerRef, inView } = useInView({
    threshold: 0.1,
    triggerOnce: false,
  })

  const [imageStatus, setImageStatus] = useState<Record<string, ImageStatus>>({})
  const inflightRef = useRef<Map<string, HTMLImageElement>>(new Map())
  const inflightStartRef = useRef<Map<string, number>>(new Map())
  const [slowCheckTick, setSlowCheckTick] = useState(0)
  const emptyAutoloadsRef = useRef(0)
  const [gridClass, setGridClass] = useState("")
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null)

  // Use virtualization for better performance with large lists
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 50 })
  const containerRef = useRef<HTMLDivElement>(null)
  const wasInViewRef = useRef(false)

  // User-chosen density: tile height scales with the column count (3 = the original 11rem).
  const tileHeight = columnsOverride ? (columnsOverride <= 1 ? 320 : columnsOverride >= 5 ? 112 : 176) : null

  const imageObjects = useMemo(() => {
    return objects.filter((object) => isWithdrawn(object) || hasImageUrl(object.attributes?.img_url))
  }, [objects])

  const markImage = useCallback((id: string, status: ImageStatus) => {
    setImageStatus((prev) => (prev[id] === status ? prev : { ...prev, [id]: status }))
  }, [])

  // revealed: loaded objects up to the first one still pending (the frontier).
  const { revealed, frontier } = useMemo(() => {
    const revealed: MuseumObject[] = []
    let frontier = imageObjects.length
    for (let i = 0; i < imageObjects.length; i++) {
      const status = isWithdrawn(imageObjects[i]) ? "ok" : imageStatus[imageObjects[i].id]
      if (status === "ok") revealed.push(imageObjects[i])
      else if (status === undefined) {
        frontier = i
        break
      }
    }
    return { revealed, frontier }
  }, [imageObjects, imageStatus])

  // Preload images from the frontier onward, a bounded window ahead of what's shown.
  useEffect(() => {
    if (revealed.length >= visibleRange.end + PRELOAD_LOOKAHEAD) return
    const inflight = inflightRef.current
    const end = Math.min(imageObjects.length, frontier + PRELOAD_LOOKAHEAD)
    for (let i = frontier; i < end && inflight.size < PRELOAD_CONCURRENCY; i++) {
      const object = imageObjects[i]
      if (isWithdrawn(object) || imageStatus[object.id] || inflight.has(object.id)) continue
      if (isSlowHost(object.attributes.img_url!)) {
        markImage(object.id, "failed")
        continue
      }
      const img = new window.Image()
      const settle = (status: ImageStatus) => {
        clearTimeout(timer)
        img.onload = null
        img.onerror = null
        inflight.delete(object.id)
        inflightStartRef.current.delete(object.id)
        if (status === "ok") slowHostStrikes.delete(imageHost(object.attributes.img_url!))
        markImage(object.id, status)
      }
      const timer = setTimeout(() => {
        img.src = ""
        addSlowHostStrike(object.attributes.img_url!)
        settle("failed")
      }, PRELOAD_TIMEOUT_MS)
      // naturalWidth guard: some hosts answer dead links with a 1px placeholder.
      img.onload = () => settle(img.naturalWidth > 1 ? "ok" : "failed")
      img.onerror = () => settle("failed")
      img.src = resolveImageSrc(object.attributes.img_url!, THUMB_WIDTH)
      inflight.set(object.id, img)
      inflightStartRef.current.set(object.id, Date.now())
    }
  }, [imageObjects, frontier, imageStatus, revealed.length, visibleRange.end, markImage])

  // Skip a slow frontier image once a later one has loaded (see SLOW_SKIP_MS).
  useEffect(() => {
    const object = imageObjects[frontier]
    if (!object) return
    const img = inflightRef.current.get(object.id)
    const startedAt = inflightStartRef.current.get(object.id)
    if (!img || startedAt === undefined) return
    const laterLoaded = imageObjects
      .slice(frontier + 1, frontier + 1 + PRELOAD_LOOKAHEAD)
      .some((o) => imageStatus[o.id] === "ok")
    const wait = startedAt + SLOW_SKIP_MS - Date.now()
    if (laterLoaded && wait <= 0) {
      img.onload = null
      img.onerror = null
      img.src = ""
      inflightRef.current.delete(object.id)
      inflightStartRef.current.delete(object.id)
      addSlowHostStrike(object.attributes.img_url!)
      markImage(object.id, "failed")
      return
    }
    // Re-check when the deadline passes (or soon, while waiting for a later load).
    const id = window.setTimeout(() => setSlowCheckTick((t) => t + 1), Math.max(wait, 200))
    return () => window.clearTimeout(id)
  }, [imageObjects, frontier, imageStatus, slowCheckTick, markImage])

  // Abort in-flight preloads on unmount.
  useEffect(() => {
    const inflight = inflightRef.current
    return () => {
      inflight.forEach((img) => {
        img.onload = null
        img.onerror = null
        img.src = ""
      })
      inflight.clear()
    }
  }, [])

  const visibleObjects = useMemo(() => {
    return revealed.slice(visibleRange.start, visibleRange.end)
  }, [revealed, visibleRange])

  // Every loaded object has been checked but too few had images to fill the
  // view — fetch the next page instead of waiting for a scroll that can't happen.
  const lastRevealedCountRef = useRef(0)
  useEffect(() => {
    if (revealed.length !== lastRevealedCountRef.current) {
      lastRevealedCountRef.current = revealed.length
      emptyAutoloadsRef.current = 0
    }
    if (
      frontier === imageObjects.length &&
      revealed.length < visibleRange.end &&
      hasMore &&
      !isLoading &&
      emptyAutoloadsRef.current < MAX_EMPTY_AUTOLOADS
    ) {
      emptyAutoloadsRef.current += 1
      onLoadMore()
    }
  }, [frontier, imageObjects.length, revealed.length, visibleRange.end, hasMore, isLoading, onLoadMore])

  // Load more when reaching the end of the list
  useEffect(() => {
    if (inView && !wasInViewRef.current && hasMore && !isLoading) {
      onLoadMore()
    }
    wasInViewRef.current = inView
  }, [inView, hasMore, isLoading, onLoadMore])

  // Handle scroll to load more visible items + trigger API fetch
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return

    const { scrollTop, clientHeight, scrollHeight } = containerRef.current
    const scrollPosition = scrollTop + clientHeight

    onScroll?.(scrollTop, scrollHeight - clientHeight)

    // If we're near the bottom of our current range, load more items into view
    if (scrollPosition > scrollHeight - 200 && visibleRange.end < revealed.length) {
      setVisibleRange((prev) => ({
        start: prev.start,
        end: prev.end + 40,
      }))
    }

    // If near bottom AND we've shown all loaded objects, fetch next page
    if (scrollPosition > scrollHeight - 400 && visibleRange.end >= revealed.length - 5 && hasMore && !isLoading) {
      onLoadMore()
    }

    // If we've scrolled up significantly, adjust the start range to improve performance
    if (scrollTop < 200 && visibleRange.start > 0) {
      setVisibleRange((prev) => ({
        start: Math.max(prev.start - 20, 0),
        end: prev.end,
      }))
    }
  }, [revealed.length, visibleRange, hasMore, isLoading, onLoadMore, onScroll])

  // Attach scroll listener
  useEffect(() => {
    const container = containerRef.current
    if (container) {
      container.addEventListener("scroll", handleScroll, { passive: true })
      return () => container.removeEventListener("scroll", handleScroll)
    }
  }, [handleScroll])

  // Dynamically adjust grid columns based on panel size
  useEffect(() => {
    let columns: string

    if (isFullscreen || panelSize >= 90) {
      columns = `grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8`
    } else if (panelSize <= 30) {
      columns = `grid-cols-${mobileColumns} xs:grid-cols-${mobileColumns} sm:grid-cols-${mobileColumns} md:grid-cols-${mobileColumns} lg:grid-cols-${mobileColumns} xl:grid-cols-${mobileColumns} 2xl:grid-cols-${mobileColumns}`
    } else if (panelSize <= 40) {
      columns = `grid-cols-${mobileColumns} xs:grid-cols-${mobileColumns} sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-3`
    } else if (panelSize <= 50) {
      columns = `grid-cols-${mobileColumns} xs:grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-4`
    } else if (panelSize <= 60) {
      columns = `grid-cols-${mobileColumns} xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-5 2xl:grid-cols-5`
    } else if (panelSize <= 70) {
      columns = `grid-cols-${mobileColumns} xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-6 2xl:grid-cols-6`
    } else if (panelSize <= 80) {
      columns = `grid-cols-${mobileColumns} xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-7`
    } else {
      columns = `grid-cols-${mobileColumns} xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8`
    }

    setGridClass(columns)
  }, [panelSize, isFullscreen, mobileColumns])

  // When new objects are appended, expand visible range to include them
  useEffect(() => {
    if (objects.length === 0) {
      setVisibleRange({ start: 0, end: 50 })
    }
  }, [objects.length])

  const handleImageClick = (index: number) => {
    const object = visibleObjects[index]
    if (!object) return
    const lng = object.attributes.longitude || 0
    const lat = object.attributes.latitude || 0
    const objectIndex = objects.findIndex((candidate) => candidate.id === object.id)
    onObjectClick(lng, lat, objectIndex, object)
  }

  const isCheckingImages = frontier < imageObjects.length || (isLoading && hasMore)
  if (revealed.length === 0 && (isCheckingImages || (isLoading && objects.length === 0))) {
    return (
      <div className="flex flex-col justify-center items-center h-full p-4 text-center bg-white">
        <Spinner size="2" />
      </div>
    )
  }

  if (revealed.length === 0) {
    return (
      <div className="flex flex-col justify-center items-center h-full p-4 text-center bg-white">
        <p className="text-sm text-gray-500 mb-4">No artifacts found in this area.</p>
        <p className="text-xs text-gray-500">Try zooming out or panning to a different location on the map.</p>
      </div>
    )
  }

return (
  <div className="relative h-full bg-white">
    <div ref={containerRef} className="h-full overflow-auto px-4 pt-4 pb-4 bg-white">
      <div
        className={`grid ${columnsOverride ? "" : gridClass} gap-3`}
        style={columnsOverride ? { gridTemplateColumns: `repeat(${columnsOverride}, minmax(0, 1fr))` } : undefined}
      >
      {visibleObjects.map((object, index) => {
        const isSelected = object.id === selectedImageId

if (isWithdrawn(object)) {
  const href = withdrawnSearchUrl(object)
  return (
    <div
      key={object.id}
      className={`relative bg-white p-1 flex items-center justify-center ${tileHeight ? "" : "h-44"}`}
      style={tileHeight ? { height: tileHeight } : undefined}
      onMouseEnter={() => onObjectHover(object.attributes.place_name || null)}
      onMouseLeave={() => onObjectHover(null)}
    >
      <a
        href={href || undefined}
        target="_blank"
        rel="noopener noreferrer"
        title="The museum withdrew this record from its online collection"
        className="w-full h-full bg-white rounded-[10px] border border-gray-100 p-3 flex flex-col justify-between transition-colors hover:bg-[#f5f5f5]"
      >
        <span className="text-gray-400 text-sm leading-none">{href ? "↗" : ""}</span>
        <span className="flex-1 flex items-center justify-center px-1 font-mono text-sm text-[#111] text-center line-clamp-3 leading-tight">
          {object.attributes.inventory_number}
        </span>
        <span className="flex items-end justify-between mt-1">
          <span className="text-[9px] text-gray-400 leading-none">Record withdrawn</span>
          <span className="text-[9px] text-gray-400 leading-none truncate ml-1 max-w-[60%] text-right">
            © {object.attributes.institution_name}
          </span>
        </span>
      </a>
    </div>
  )
}

return (
  <div
    key={object.id}
    className={`group relative cursor-pointer transition-all duration-200 bg-white p-1 flex items-center justify-center ${tileHeight ? "" : "h-44"}`}
    style={tileHeight ? { height: tileHeight } : undefined}
    onClick={() => handleImageClick(index)}
    onMouseEnter={() => {
      setSelectedImageId(object.id)
      onObjectHover(object.attributes.place_name || null)
    }}
    onMouseLeave={() => {
      setSelectedImageId(null)
      onObjectHover(null)
    }}
  >
    <div
      className={[
        "relative overflow-hidden bg-white rounded-[4px]",
        "inline-flex",
        isSelected ? "ring-2 ring-blue-500" : "",
        "group-hover:ring-2 group-hover:ring-blue-500",
      ].join(" ")}
    >
      {(object.attributes.geocoding_status && object.attributes.geocoding_status !== "ok") && (
        <span
          className={`absolute top-2 left-2 z-10 capitalize inline-flex items-center px-2 py-0.5 rounded-md text-xs ${
            object.attributes.geocoding_status === "disputed"
              ? "bg-orange-50 text-orange-700"
              : "border border-gray-200 text-gray-500"
          }`}
          title={object.attributes.geocoding_notes || undefined}
        >
          {object.attributes.geocoding_status}
        </span>
      )}
      {(object.attributes.review_status && object.attributes.review_status !== "verified") && (
        <span
          className={`absolute top-2 right-2 z-10 capitalize inline-flex items-center px-2 py-0.5 rounded-md text-xs ${
            object.attributes.review_status === "rejected"
              ? "bg-orange-50 text-orange-700"
              : "border border-gray-200 text-gray-500"
          }`}
        >
          {object.attributes.review_status}
        </span>
      )}
      {typeof object.attributes.geocoding_confidence === 'number' &&
        object.attributes.geocoding_confidence < 0.5 && (
        <span
          className="absolute bottom-1 left-1 z-10 bg-amber-100 text-amber-700 text-[9px] font-medium px-1 py-0.5 rounded pointer-events-none leading-none"
          title={`Low geocoding confidence (${Math.round(object.attributes.geocoding_confidence * 100)}%)`}
        >
          ~
        </span>
      )}
      {/* Place is attributed from a maker/production event, not a confirmed
          findspot — e.g. "Kyūshū" for a piece made by a named potter is the
          maker's home region, not where the object was found. */}
      {object.attributes.origin_event_type_en && !object.attributes.origin_is_findspot && (
        <span
          className="absolute bottom-1 right-1 z-10 bg-amber-100 text-amber-700 text-[9px] font-medium px-1 py-0.5 rounded pointer-events-none leading-none"
          title={formatOriginAttribution(object.attributes) || undefined}
        >
          i
        </span>
      )}
      <ObjectImage
        src={object.attributes.img_url!}
        alt={object.attributes?.title || "Museum object"}
        className="block"
        imgClassName={`block w-auto bg-white ${tileHeight ? "max-w-full" : "max-h-44"}`}
        imgStyle={tileHeight ? { maxHeight: tileHeight } : undefined}
        onError={() => markImage(object.id, "failed")}
        // Already preloaded into the browser cache before the tile was revealed.
        loading="eager"
      />
    </div>
  </div>
)
      })}
      </div>

      {/* Infinite scroll sentinel */}
      {hasMore && (
        <div ref={observerRef} className="flex items-center justify-center py-6">
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Spinner size="1" />
              <span>Loading more artifacts…</span>
            </div>
          ) : (
            <div className="h-8" />
          )}
        </div>
      )}

      {!hasMore && !isCheckingImages && (
        <div className="text-center py-4 text-[10px] text-gray-300">
          {revealed.length} artifact{revealed.length !== 1 ? "s" : ""}
        </div>
      )}
    </div>
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 h-8"
      style={GRID_TOP_FADE_STYLE}
    />
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-8"
      style={GRID_BOTTOM_FADE_STYLE}
    />
  </div>
)
}

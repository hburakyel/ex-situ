"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import type { MuseumObject } from "../types"
import BlurhashImage from "@/components/blurhash-image"
import { useInView } from "react-intersection-observer"
import { Spinner } from "@radix-ui/themes"
import { Badge } from "@/components/ui/badge"

interface ObjectGridProps {
  objects: MuseumObject[]
  onLoadMore: () => void
  hasMore: boolean
  totalCount: number
  isLoading: boolean
  onObjectClick?: (longitude: number, latitude: number, index: number) => void
  isFullscreen?: boolean
  panelSize?: number
  mobileColumns?: number
}

export default function ObjectGrid({
  objects,
  onLoadMore,
  hasMore,
  totalCount,
  isLoading,
  onObjectClick = () => {},
  isFullscreen = false,
  panelSize = 50,
  mobileColumns = 2,
}: ObjectGridProps) {
    const getGeocodeStatusVariant = (status?: string) => {
      switch (status) {
        case "disputed":
          return "destructive"
        case "ok":
          return "secondary"
        case "ambiguous":
        default:
          return "default"
      }
    }

    const getReviewStatusVariant = (status?: string) => {
      switch (status) {
        case "verified":
          return "secondary"
        case "rejected":
          return "destructive"
        case "pending":
        default:
          return "outline"
      }
    }

  const { ref: observerRef, inView } = useInView({
    threshold: 0.1,
    triggerOnce: false,
  })

  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({})
  const [loadedImages, setLoadedImages] = useState<Record<string, boolean>>({})
  const [gridClass, setGridClass] = useState("")
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null)

  // Use virtualization for better performance with large lists
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 50 })
  const containerRef = useRef<HTMLDivElement>(null)

  // Reset broken-image tracker when the object set changes (e.g. navigation
  // between places) to avoid accumulating IDs from previous views.
  const objectIdsFingerprint = objects.length > 0 ? `${objects[0]?.id}-${objects.length}` : ""
  useEffect(() => {
    setBrokenImages({})
    setLoadedImages({})
  }, [objectIdsFingerprint])

  // Calculate visible objects based on current range
  const visibleObjects = useMemo(() => {
    return objects.slice(visibleRange.start, visibleRange.end)
  }, [objects, visibleRange])

  // Load more when reaching the end of the list
  useEffect(() => {
    if (inView && hasMore && !isLoading) {
      onLoadMore()
    }
  }, [inView, hasMore, isLoading, onLoadMore])

  // Handle scroll to load more visible items + trigger API fetch
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return

    const { scrollTop, clientHeight, scrollHeight } = containerRef.current
    const scrollPosition = scrollTop + clientHeight

    // If we're near the bottom of our current range, load more items into view
    if (scrollPosition > scrollHeight - 200 && visibleRange.end < objects.length) {
      setVisibleRange((prev) => ({
        start: prev.start,
        end: Math.min(prev.end + 40, objects.length),
      }))
    }

    // If near bottom AND we've shown all loaded objects, fetch next page
    if (scrollPosition > scrollHeight - 400 && visibleRange.end >= objects.length - 5 && hasMore && !isLoading) {
      onLoadMore()
    }

    // If we've scrolled up significantly, adjust the start range to improve performance
    if (scrollTop < 200 && visibleRange.start > 0) {
      setVisibleRange((prev) => ({
        start: Math.max(prev.start - 20, 0),
        end: prev.end,
      }))
    }
  }, [objects.length, visibleRange, hasMore, isLoading, onLoadMore])

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
    } else {
      setVisibleRange((prev) => ({
        start: prev.start,
        end: Math.max(prev.end, Math.min(objects.length, prev.end + 40)),
      }))
    }
  }, [objects.length])

  const handleImageClick = (index: number) => {
    const object = objects[visibleRange.start + index]
    if (!object) return
    const lng = object.attributes.longitude || 0
    const lat = object.attributes.latitude || 0
    onObjectClick(lng, lat, visibleRange.start + index)
  }

  const handleImageError = (id: string) => {
    console.log(`Image failed to load for object ${id}`)
    setBrokenImages((prev) => ({
      ...prev,
      [id]: true,
    }))
  }

  const handleImageLoad = (id: string) => {
    setLoadedImages((prev) => ({
      ...prev,
      [id]: true,
    }))
  }

  if (isLoading && objects.length === 0) {
    return null
  }

  if (objects.length === 0 && !isLoading) {
    return (
      <div className="flex flex-col justify-center items-center h-full p-4 text-center bg-white">
        <p className="text-sm text-gray-500 mb-4">No objects found in this area.</p>
        <p className="text-xs text-gray-500">Try zooming out or panning to a different location on the map.</p>
      </div>
    )
  }

return (
  <div ref={containerRef} className="h-full overflow-auto px-4 pt-4 pb-4 bg-white">
    <div className={`grid ${gridClass} gap-3`}>
      {visibleObjects.filter(o => !!o.attributes?.img_url).map((object, index) => {
        if (brokenImages[object.id]) return null
        const isSelected = object.id === selectedImageId

return (
  <div
    key={object.id}
    className="group relative cursor-pointer transition-all duration-200 bg-white p-1 h-44 flex items-center justify-center"
    onClick={() => handleImageClick(index)}
    onMouseEnter={() => setSelectedImageId(object.id)}
    onMouseLeave={() => setSelectedImageId(null)}
  >
    {/* Inventory number shown as placeholder while image loads */}
    {object.attributes.inventory_number && !loadedImages[object.id] && (
      <span className="absolute inset-0 flex items-center justify-center z-0 pointer-events-none">
        <span className="text-[10px] text-gray-300 font-mono text-center px-2 break-all leading-tight max-w-full">
          {object.attributes.inventory_number}
        </span>
      </span>
    )}
    <div
      className={
        [
          "relative inline-flex overflow-hidden bg-white rounded-[4px]",
          loadedImages[object.id] && isSelected ? "ring-2 ring-blue-500" : "",
          loadedImages[object.id] ? "group-hover:ring-2 group-hover:ring-blue-500" : ""
        ].join(" ")
      }
    >
      {(object.attributes.geocoding_status && object.attributes.geocoding_status !== "ok") && (
        <Badge
          variant={getGeocodeStatusVariant(object.attributes.geocoding_status)}
          className="absolute top-2 left-2 z-10 capitalize"
          title={object.attributes.geocoding_notes || undefined}
        >
          {object.attributes.geocoding_status}
        </Badge>
      )}
      {(object.attributes.review_status && object.attributes.review_status !== "verified") && (
        <Badge
          variant={getReviewStatusVariant(object.attributes.review_status)}
          className="absolute top-2 right-2 z-10 capitalize"
        >
          {object.attributes.review_status}
        </Badge>
      )}
      <BlurhashImage
            src={object.attributes.img_url!}
            alt={object.attributes?.title || "Museum object"}
            className="block"
            imgClassName="block max-h-44 w-auto bg-white"
            onLoad={() => handleImageLoad(object.id)}
            onError={() => handleImageError(object.id)}
            loading="lazy"
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

    {!hasMore && objects.length > 0 && (
      <div className="text-center py-4 text-[10px] text-gray-300">
        {objects.length} of {totalCount} artifacts
      </div>
    )}
  </div>
)
}

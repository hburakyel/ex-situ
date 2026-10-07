"use client"

import React, { useState, useEffect, useCallback, useRef } from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "@radix-ui/react-icons"
import { IconSource, IconClose } from "@/components/icons"
import { displayObjectDate } from "@/lib/object-date"
import { Button } from "@/components/ui/button"
import type { MuseumObject } from "../types"
import ObjectImage from "@/components/object-image"
import { Check, Link2 } from "lucide-react"
import { INSTITUTION_CITIES } from "@/hooks/use-unified-search"
import { LARGE_WIDTH, THUMB_WIDTH, resolveImageSrc } from "@/lib/image-src"
import { isWithdrawn, withdrawnSourceUrl } from "@/lib/withdrawn"

const hasImageUrl = (imgUrl?: string | null) => typeof imgUrl === "string" && imgUrl.trim().length > 0
const MOBILE_CLOSE_SWIPE_THRESHOLD = 48

interface ImageGalleryProps {
  objects: MuseumObject[]
  initialIndex: number
  onClose: () => void
  isFullscreen?: boolean
  isMobile?: boolean
}

export default function ImageGallery({
  objects,
  initialIndex,
  onClose,
  isFullscreen = false,
  isMobile = false,
}: ImageGalleryProps) {
  const galleryObjects = objects
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  // Start from the opening object's real state — it may have no image (withdrawn record).
  const startsWithImage = hasImageUrl(objects[initialIndex]?.attributes?.img_url)
  const [imageError, setImageError] = useState(!startsWithImage)
  const [isLoading, setIsLoading] = useState(startsWithImage)
  const [linkCopied, setLinkCopied] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)

  // Clamp currentIndex when objects array changes (e.g. filters, navigation)
  useEffect(() => {
    if (galleryObjects.length > 0 && currentIndex >= galleryObjects.length) {
      setCurrentIndex(Math.max(0, galleryObjects.length - 1))
    }
  }, [galleryObjects, currentIndex])

  const currentObject = galleryObjects.length > 0 ? galleryObjects[currentIndex] : null

  // Reset image/loading state synchronously during render (not in an effect) so the
  // browser never paints a stale frame — e.g. the previous object's "no image" fallback
  // flashing before the new object's image is known to exist.
  const [trackedObjectId, setTrackedObjectId] = useState(currentObject?.id)
  if (currentObject && currentObject.id !== trackedObjectId) {
    setTrackedObjectId(currentObject.id)
    const objectHasImage = hasImageUrl(currentObject.attributes?.img_url)
    setImageError(!objectHasImage)
    setIsLoading(objectHasImage)
  }

  // Log container width on mount and resize
  useEffect(() => {
    if (containerRef.current) {
      console.log("Gallery container width:", containerRef.current.offsetWidth)

      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          console.log("Gallery container resized to:", entry.contentRect.width)
        }
      })

      observer.observe(containerRef.current)
      return () => observer.disconnect()
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose()
      } else if (e.key === "ArrowRight") {
        handleNext()
      } else if (e.key === "ArrowLeft") {
        handlePrevious()
      }
    }

    window.addEventListener("keydown", handleKeyDown)

    return () => {
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [currentIndex, objects?.length, onClose])

  // Direction of the last navigation, so a failed image is skipped the way the
  // user was already heading instead of showing an empty frame.
  const directionRef = useRef<1 | -1>(1)
  const skippedRef = useRef(0)

  const handleNext = useCallback(() => {
    if (galleryObjects.length === 0) return
    directionRef.current = 1
    skippedRef.current = 0
    setCurrentIndex((prevIndex) => (prevIndex + 1) % galleryObjects.length)
  }, [galleryObjects])

  const handlePrevious = useCallback(() => {
    if (galleryObjects.length === 0) return
    directionRef.current = -1
    skippedRef.current = 0
    setCurrentIndex((prevIndex) => (prevIndex - 1 + galleryObjects.length) % galleryObjects.length)
  }, [galleryObjects])

  const handleImageLoad = () => {
    skippedRef.current = 0
    setIsLoading(false)
  }

  // Image didn't load: show the inventory number in its place (same as the grid tile).
  const handleImageError = () => {
    setImageError(true)
  }

  const handleImageTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobile) return
    touchStartX.current = event.touches[0]?.clientX ?? null
    touchStartY.current = event.touches[0]?.clientY ?? null
  }

  const handleImageTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobile || touchStartX.current === null || touchStartY.current === null) {
      return
    }

    const endX = event.changedTouches[0]?.clientX ?? touchStartX.current
    const endY = event.changedTouches[0]?.clientY ?? touchStartY.current
    const deltaX = endX - touchStartX.current
    const deltaY = endY - touchStartY.current

    touchStartX.current = null
    touchStartY.current = null

    if (deltaY > MOBILE_CLOSE_SWIPE_THRESHOLD && Math.abs(deltaY) > Math.abs(deltaX)) {
      onClose()
    }
  }

  const handleImageTouchCancel = () => {
    touchStartX.current = null
    touchStartY.current = null
  }

  // Early return if no valid objects or current object (transient state during re-renders)
  if (galleryObjects.length === 0 || !currentObject) {
    return null
  }

  // Check if the object has links
  const hasObjectLinks = currentObject.attributes.object_links && currentObject.attributes.object_links.length > 0

  // Get the correct URL to open
  const getLinkUrl = () => {
    // Withdrawn record: its old link is dead — point to where it can still be found.
    if (isWithdrawn(currentObject)) return withdrawnSourceUrl(currentObject)
    // Check if object_links exists and has items
    if (
      currentObject.attributes.object_links &&
      Array.isArray(currentObject.attributes.object_links) &&
      currentObject.attributes.object_links.length > 0
    ) {
      return currentObject.attributes.object_links[0].link_text || currentObject.attributes.object_links[0].url || null
    }

    // Fallback to source_link if object_links is not available
    if (currentObject.attributes.source_link) {
      return currentObject.attributes.source_link
    }

    // If we have a direct link_text property, use that
    if (currentObject.attributes.link_text) {
      return currentObject.attributes.link_text
    }

    return null
  }

  // Fixed width for default size
  const galleryWidth = isFullscreen ? "100%)" : "100%"

  return (
    <>
      {/* Overlay removed for non-blocking view */}
      {/* <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0, 0, 0, 0.7)",
          backdropFilter: "blur(8px)",
          zIndex: 40,
        }}
        onClick={onClose}
      /> */}

      {/* Gallery container - changed to side panel/floating styles */}
      <div
        ref={containerRef}
        className="shadow-lg"
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: "white",
          color: "black",
          borderRadius: "inherit",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          zIndex: 60,
          border: "none",
        }}
      >
        {/* Header with navigation controls */}

        <div className="flex items-center justify-between px-4 pt-3 pb-2 bg-white">
          <div className="flex items-center min-w-0 flex-1 overflow-hidden text-sm" style={{fontSize:14}}>
            <span className="text-black">{currentIndex + 1} / {galleryObjects.length}</span>
            {currentObject.attributes.inventory_number && (
              <span className="text-[#666] ml-2">
                ID: <span className="text-black">{currentObject.attributes.inventory_number}</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 ml-2 flex-shrink-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={handlePrevious}
              className="h-8 w-8"
              disabled={galleryObjects.length <= 1}
              aria-label="Previous image"
            >
              <ChevronLeftIcon className="h-5 w-5 text-gray-500" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleNext}
              className="h-8 w-8"
              disabled={galleryObjects.length <= 1}
              aria-label="Next image"
            >
              <ChevronRightIcon className="h-5 w-5 text-gray-500" />
            </Button>
            {(() => {
              const rawId = currentObject.id
              const numId = Number(rawId)
              const hasValidId = rawId && !String(rawId).startsWith('wiki-') && !isNaN(numId) && numId > 0
              return hasValidId ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title={linkCopied ? "Copied!" : "Copy link"}
                  onClick={(e) => {
                    e.stopPropagation()
                    const url = `${window.location.origin}/artifact/${rawId}`
                    navigator.clipboard.writeText(url).catch(() => {})
                    setLinkCopied(true)
                    setTimeout(() => setLinkCopied(false), 2000)
                  }}
                >
                  {linkCopied
                    ? <Check className="h-5 w-5 text-green-500" />
                    : <Link2 className="h-5 w-5 text-gray-500" />}
                </Button>
              ) : null
            })()}
            {getLinkUrl() && (
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation()
                  const url = getLinkUrl()
                  if (url) window.open(url, "_blank", "noopener,noreferrer")
                }}
                className="h-8 w-8"
                title="View Source"
              >
                <IconSource className="h-5 w-5 text-gray-500" />
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8" aria-label="Close gallery">
              <IconClose className="h-5 w-5 text-gray-500" />
            </Button>
          </div>
        </div>

        {/* From / To / Time / Collection — right under the header */}
        <div
          style={{
            padding: "0 16px 8px",
            backgroundColor: "white",
            textAlign: "left",
          }}
        >
          <span className="text-black" style={{ fontSize: "0.875rem" }}>
            {(() => {
              const at = currentObject.attributes
              const from = at.place_name_normalized || at.place_name
              const to = at.institution_city_en || INSTITUTION_CITIES[at.institution_name || ""] || at.institution_place
              const time = displayObjectDate(at.object_date)
              const items: [string, string][] = []
              if (from) items.push(["From", from])
              if (to) items.push(["To", to])
              if (time) items.push(["Time", time])
              if (at.institution_name) items.push(["Collection", at.institution_name])
              // Pairs are separated by a real space (a break point) and each label is held
              // to its value; short pairs ("To: Berlin", "Time: 1–600 CE") never split.
              return items.map(([label, value], i) => (
                <React.Fragment key={label}>
                  {i > 0 && " "}
                  <span className={label === "To" || label === "Time" ? "whitespace-nowrap" : undefined}>
                    <span className="text-[#666]">{label}:{"\u00a0"}</span>
                    {value}
                  </span>
                </React.Fragment>
              ))
            })()}
          </span>
        </div>

        {/* Main image container */}
        <div
          style={{
            flex: "1 1 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            overflow: "hidden",
            minHeight: "0",
            backgroundColor: "white",
          }}
          onTouchStart={handleImageTouchStart}
          onTouchEnd={handleImageTouchEnd}
          onTouchCancel={handleImageTouchCancel}
        >
          {galleryObjects.length > 1 && (
            <>
              <button
                type="button"
                aria-label="Previous image"
                onClick={handlePrevious}
                className="absolute inset-y-0 left-0 z-10 w-1/2 cursor-w-resize bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/30 focus-visible:ring-inset"
              >
                <span className="sr-only">Previous image</span>
              </button>
              <button
                type="button"
                aria-label="Next image"
                onClick={handleNext}
                className="absolute inset-y-0 right-0 z-10 w-1/2 cursor-e-resize bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/30 focus-visible:ring-inset"
              >
                <span className="sr-only">Next image</span>
              </button>
            </>
          )}

          {/* While the full-size image loads, show the grid thumbnail (already in
              the browser cache from the grid) instead of an empty frame. */}
          {isLoading && !imageError && (
            <div
              style={{
                position: "absolute",
                inset: "0",
                zIndex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "white",
              }}
            >
              <img
                src={resolveImageSrc(currentObject.attributes.img_url!, THUMB_WIDTH)}
                alt=""
                aria-hidden="true"
                // Same box as the full-size image below, so the swap only sharpens — no jump in size.
                className="w-full h-full object-contain"
              />
            </div>
          )}

          {!imageError ? (
            <div className="gallery-image-bg" style={{ width: "100%", height: "100%" }}>
              <ObjectImage
              src={currentObject.attributes.img_url!}
              alt={currentObject.attributes.title || "Museum object"}
              className="w-full h-full flex items-center justify-center"
              imgClassName="w-full h-full object-contain"
              imgStyle={{ backgroundColor: "white", margin: "0", padding: "0" }}
              wrapperStyle={{ backgroundColor: "white" }}
             onError={handleImageError}
             onLoad={handleImageLoad}
             loading="eager"
             width={LARGE_WIDTH}
               />
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                height: "100%",
                width: "100%",
                backgroundColor: "white", // Added white background
              }}
            >
              <span className="font-mono text-sm text-[#111]">
                {currentObject.attributes.inventory_number || "—"}
              </span>
            </div>
          )}
        </div>


        {/* Image credit — bottom right */}
        <div style={{ padding: "4px 16px 6px", backgroundColor: "white", textAlign: "right" }}>
          {(() => {
            // Image credit as each museum states it for its images (audited 2026-10-07):
            // - SMB (museum-digital object_images[].rights): CC BY-NC-SA for every collection
            // - Met Open Access images are public domain: CC0
            // - V&A image meta: "© Victoria and Albert Museum, London" (no open licence)
            // - AIC: CC0 only for public-domain works, which isn't stored per object yet,
            //   so no licence is claimed
            const SMB_COLLECTIONS = new Set([
              "Ethnologisches Museum",
              "Antikensammlung",
              "Museum für Islamische Kunst",
              "Vorderasiatisches Museum",
              "Ägyptisches Museum und Papyrussammlung",
              "Museum für Asiatische Kunst",
            ])
            const CREDITS: Record<string, string> = {
              "The Metropolitan Museum of Art": "The Metropolitan Museum of Art · CC0",
              "Art Institute of Chicago": "© Art Institute of Chicago",
              "Victoria and Albert Museum": "© Victoria and Albert Museum, London",
            }
            const institution = currentObject.attributes.institution_name || ""
            const sourceUrl = getLinkUrl()
            const credit = isWithdrawn(currentObject)
              // No image: the museum withdrew the record that stated its licence.
              ? `© ${institution} · No image licence`
              : SMB_COLLECTIONS.has(institution)
                ? `© ${institution}, Staatliche Museen zu Berlin · CC BY-NC-SA`
                : CREDITS[institution] || (institution ? `© ${institution}` : "")
            const style = { color: "#2a2a2a", fontSize: "0.875rem", textDecoration: "none" }

            if (sourceUrl) {
              return (
                <a href={sourceUrl} target="_blank" rel="noopener noreferrer" style={style}>
                  {credit || "View source"} ↗
                </a>
              )
            }
            if (credit) return <span style={style}>{credit}</span>
            return null
          })()}
        </div>
      </div>
    </>
  )
}

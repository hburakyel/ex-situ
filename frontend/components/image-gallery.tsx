"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "@radix-ui/react-icons"
import { IconSource, IconClose } from "@/components/icons"
import { Spinner } from "@radix-ui/themes"
import { Button } from "@/components/ui/button"
import type { MuseumObject } from "../types"
import BlurhashImage from "@/components/blurhash-image"
import Link from "next/link"
import { Info } from "lucide-react"

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
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const [imageError, setImageError] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)

  // Clamp currentIndex when objects array changes (e.g. filters, navigation)
  useEffect(() => {
    if (objects && objects.length > 0 && currentIndex >= objects.length) {
      setCurrentIndex(Math.max(0, objects.length - 1))
    }
  }, [objects, currentIndex])

  const currentObject = objects && objects.length > 0 ? objects[currentIndex] : null

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
    // Reset image error state when changing images
    setImageError(false)
    setIsLoading(true)
  }, [currentIndex])

  useEffect(() => {
    if (!currentObject?.attributes?.img_url) {
      setIsLoading(false)
    }
  }, [currentObject?.attributes?.img_url])

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

  const handleNext = useCallback(() => {
    if (!objects || objects.length === 0) return
    setCurrentIndex((prevIndex) => (prevIndex + 1) % objects.length)
  }, [objects])

  const handlePrevious = useCallback(() => {
    if (!objects || objects.length === 0) return
    setCurrentIndex((prevIndex) => (prevIndex - 1 + objects.length) % objects.length)
  }, [objects])

  const handleImageLoad = () => {
    setIsLoading(false)
  }

  // Early return if no valid objects or current object (transient state during re-renders)
  if (!objects || objects.length === 0 || !currentObject) {
    return null
  }

  // Check if the object has links
  const hasObjectLinks = currentObject.attributes.object_links && currentObject.attributes.object_links.length > 0

  // Get the correct URL to open
  const getLinkUrl = () => {
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
            <span className="text-black">{currentIndex + 1} / {objects.length}</span>
            {currentObject.attributes.inventory_number && (
              <span className="text-[#666] ml-2">
                ID: <span className="text-black">{currentObject.attributes.inventory_number}</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 ml-2 flex-shrink-0">
            <Button variant="ghost" size="icon" onClick={handlePrevious} className="h-8 w-8">
              <ChevronLeftIcon className="h-5 w-5 text-gray-500" />
            </Button>
            <Button variant="ghost" size="icon" onClick={handleNext} className="h-8 w-8">
              <ChevronRightIcon className="h-5 w-5 text-gray-500" />
            </Button>
            <Link href={`/artifact/${currentObject.id}`} onClick={(e) => e.stopPropagation()}>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title="Object Details"
              >
                <Info className="h-5 w-5 text-gray-500" />
              </Button>
            </Link>
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
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
              <IconClose className="h-5 w-5 text-gray-500" />
            </Button>
          </div>
        </div>

        {/* Subheader with object details */}
        <div
          style={{
            padding: "8px 16px",
            borderBottom: "none",
            fontSize: "14px",
            backgroundColor: "white",
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: "16px" }}>
            <div>
              <span style={{ color: "var(--panel-text-muted, #666)" }}>From: </span>
              <span>{currentObject.attributes.place_name || "Unknown"}</span>
            </div>
            <div>
              <span style={{ color: "var(--panel-text-muted, #666)" }}>To: </span>
              <span>{currentObject.attributes.institution_place || "Unknown"}</span>
            </div>
            <div>
              <span style={{ color: "var(--panel-text-muted, #666)" }}>Collection: </span>
              <span>{currentObject.attributes.institution_name || "Unknown"}</span>
            </div>
          </div>
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
        >
          {isLoading && !imageError && (
            <div
              style={{
                position: "absolute",
                inset: "0",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Spinner size="3" />
            </div>
          )}

          {!imageError ? (
            currentObject.attributes.img_url ? (
              <div className="gallery-image-bg" style={{ width: "100%", height: "100%" }}>
                <BlurhashImage
                src={currentObject.attributes.img_url}
                alt={currentObject.attributes.title || "Museum object"}
                className="w-full h-full flex items-center justify-center"
                imgClassName="max-h-full max-w-full object-contain"
                imgStyle={{ backgroundColor: "white", margin: "0", padding: "0" }}
                wrapperStyle={{ backgroundColor: "white" }}
               onError={() => setImageError(true)}
               onLoad={handleImageLoad}
               loading="eager"
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
                  backgroundColor: "white",
                }}
              >
                <span style={{ color: "#999", fontSize: "14px" }}>No image available</span>
              </div>
            )
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
              <span style={{ color: "#999", fontSize: "14px" }}>
                {currentObject.attributes.inventory_number || "No image available"}
              </span>
            </div>
          )}
        </div>

        {/* License attribution */}
        <div
          style={{
            padding: "4px 16px 6px",
            backgroundColor: "white",
            textAlign: "right",
          }}
        >
          {(() => {
            const LICENSE_MAP: Record<string, string> = {
              "Ethnologisches Museum": "CC BY 4.0",
              "The Metropolitan Museum of Art": "CC0",
              "Antikensammlung": "CC BY 4.0",
              "Museum für Islamische Kunst": "CC BY 4.0",
              "Vorderasiatisches Museum": "CC BY 4.0",
              "Ägyptisches Museum": "CC BY 4.0",
              "Museum für Asiatische Kunst": "CC BY 4.0",
            }
            const institution = currentObject.attributes.institution_name || ""
            const sourceUrl = getLinkUrl()
            const license = LICENSE_MAP[institution]

            if (license && sourceUrl) {
              return (
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: "#2a2a2a",
                    fontSize: "9px",
                    fontFamily: "monospace",
                    textDecoration: "none",
                  }}
                >
                  © {institution} · {license} ↗
                </a>
              )
            } else if (license) {
              return (
                <span
                  style={{
                    color: "#2a2a2a",
                    fontSize: "9px",
                    fontFamily: "monospace",
                  }}
                >
                  © {institution} · {license}
                </span>
              )
            } else if (sourceUrl) {
              return (
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: "#2a2a2a",
                    fontSize: "9px",
                    fontFamily: "monospace",
                    textDecoration: "none",
                  }}
                >
                  View source ↗
                </a>
              )
            }
            return null
          })()}
        </div>
      </div>
    </>
  )
}

"use client"

import type { CSSProperties } from "react"
import { useEffect, useRef, useState } from "react"
import { decode } from "blurhash"
import { cn } from "@/lib/utils"

interface BlurhashImageProps {
  src: string
  alt: string
  className?: string
  imgClassName?: string
  wrapperStyle?: CSSProperties
  imgStyle?: CSSProperties
  loading?: "lazy" | "eager"
  onLoad?: () => void
  onError?: () => void
  fallbackSrc?: string
  decodeSize?: number
}

const MAX_BLURHASH_CACHE_SIZE = 500
const blurhashCache = new Map<string, string>()

function toProxySrc(src: string): string {
  try {
    if (new URL(src).hostname === "id.smb.museum") {
      return `/api/img?url=${encodeURIComponent(src)}`
    }
  } catch {
    // not a valid absolute URL — return as-is
  }
  return src
}

/** LRU-style eviction: when cache exceeds limit, drop oldest entries */
function blurhashCacheSet(key: string, value: string) {
  // If already cached, delete first so re-insert moves it to the end (recent)
  if (blurhashCache.has(key)) blurhashCache.delete(key)
  blurhashCache.set(key, value)
  // Evict oldest entries when over limit
  if (blurhashCache.size > MAX_BLURHASH_CACHE_SIZE) {
    const firstKey = blurhashCache.keys().next().value
    if (firstKey !== undefined) blurhashCache.delete(firstKey)
  }
}

const decodeBlurhashToDataUrl = (blurhash: string, width: number, height: number) => {
  const pixels = decode(blurhash, width, height)
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext("2d")
  if (!context) return null

  const imageData = new ImageData(pixels as unknown as Uint8ClampedArray<ArrayBuffer>, width, height)
  context.putImageData(imageData, 0, 0)
  return canvas.toDataURL()
}

export default function BlurhashImage({
  src,
  alt,
  className,
  imgClassName,
  wrapperStyle,
  imgStyle,
  loading = "lazy",
  onLoad,
  onError,
  fallbackSrc,
  decodeSize = 32,
}: BlurhashImageProps) {
  const [blurhashDataUrl, setBlurhashDataUrl] = useState<string | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [hasError, setHasError] = useState(false)
  const imgRef = useRef<HTMLImageElement | null>(null)

  const imageSrc = hasError ? fallbackSrc || src : src

  useEffect(() => {
    setIsLoaded(false)
  }, [imageSrc])

  useEffect(() => {
    let isActive = true

    setIsLoaded(false)
    setHasError(false)

    if (!src) {
      setBlurhashDataUrl(null)
      return
    }

    const cached = blurhashCache.get(src)
    if (cached) {
      setBlurhashDataUrl(cached)
      return
    }

    const controller = new AbortController()

    const loadBlurhash = async () => {
      try {
        const response = await fetch(`/api/generate-blurhash?url=${encodeURIComponent(src)}`, {
          signal: controller.signal,
        })
        if (!response.ok) return

        const data = await response.json()
        if (!data?.blurhash || !isActive) return

        const dataUrl = decodeBlurhashToDataUrl(data.blurhash, data.width || decodeSize, data.height || decodeSize)
        if (!dataUrl || !isActive) return

        blurhashCacheSet(src, dataUrl)
        setBlurhashDataUrl(dataUrl)
      } catch {
        if (isActive) setBlurhashDataUrl(null)
      }
    }

    loadBlurhash()

    return () => {
      isActive = false
      controller.abort()
    }
  }, [src, decodeSize])

  useEffect(() => {
    const img = imgRef.current
    if (!img) return

    let isActive = true

    // For lazy-loaded images, img.complete can be true with naturalWidth === 0
    // before the browser starts the fetch — this is NOT an error.
    // Only treat it as loaded (not errored) when naturalWidth > 0.
    // Actual load failures are caught by the <img> onError handler.
    const markLoadedIfReady = () => {
      if (!isActive || !img) return
      if (img.complete && img.naturalWidth > 0) {
        setIsLoaded(true)
      }
    }

    markLoadedIfReady()

    // Check after next paint — handles cached images where the load event
    // fired before React attached the onLoad listener
    const rafId = requestAnimationFrame(() => markLoadedIfReady())

    if (typeof img.decode === "function") {
      img
        .decode()
        .then(() => {
          if (isActive) setIsLoaded(true)
        })
        .catch(() => {
          // decode() can reject for cross-origin / SVG images even when the
          // image is perfectly displayable — fall back to the complete check
          if (isActive) markLoadedIfReady()
        })
    }

    const timeoutId = window.setTimeout(markLoadedIfReady, 1000)

    return () => {
      isActive = false
      cancelAnimationFrame(rafId)
      window.clearTimeout(timeoutId)
    }
  }, [imageSrc])

  return (
    <div
      className={cn("relative overflow-hidden bg-white", className)}
      style={{
        ...wrapperStyle,
        backgroundImage: blurhashDataUrl ? `url(${blurhashDataUrl})` : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <img
        ref={imgRef}
        src={toProxySrc(imageSrc)}
        alt={alt}
        loading={loading}
        decoding="async"
        className={cn("block transition-opacity duration-500 ease-out", imgClassName, isLoaded ? "opacity-100" : "opacity-0")}
        style={imgStyle}
        onLoad={() => {
          setIsLoaded(true)
          onLoad?.()
        }}
        onError={() => {
          setHasError(true)
          onError?.()
        }}
      />
    </div>
  )
}

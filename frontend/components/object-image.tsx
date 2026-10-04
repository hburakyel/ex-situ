"use client"

import type { CSSProperties } from "react"
import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { resolveImageSrc, THUMB_WIDTH } from "@/lib/image-src"

interface ObjectImageProps {
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
  /** Text shown in place of the image while it loads or if it fails — e.g. the inventory number. */
  fallbackText?: string
  /** Target width for proxied images (see resolveImageSrc). Use LARGE_WIDTH for full-size views. */
  width?: number
}

export default function ObjectImage({
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
  fallbackText,
  width = THUMB_WIDTH,
}: ObjectImageProps) {
  const [isLoaded, setIsLoaded] = useState(false)
  const [hasError, setHasError] = useState(false)

  const imageSrc = hasError ? fallbackSrc || src : src

  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    setHasError(false)
    // A cached image can finish loading before this effect runs (onLoad already
    // fired) — resetting to "not loaded" then would leave it invisible forever.
    const img = imgRef.current
    setIsLoaded(Boolean(img?.complete && img.naturalWidth > 0))
  }, [src])

  return (
    <div className={cn("relative overflow-hidden bg-white", className)} style={wrapperStyle}>
      {fallbackText && (!isLoaded || (hasError && !fallbackSrc)) && (
        <div className="absolute inset-0 flex items-center justify-center break-words px-1 text-center font-mono text-[10px] leading-tight text-gray-400">
          {fallbackText}
        </div>
      )}
      <img
        ref={imgRef}
        src={resolveImageSrc(imageSrc, width)}
        alt={alt}
        loading={loading}
        decoding="async"
        className={cn(
          "relative block transition-opacity duration-500 ease-out",
          imgClassName,
          isLoaded ? "opacity-100" : "opacity-0",
        )}
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

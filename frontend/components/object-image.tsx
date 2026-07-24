"use client"

import type { CSSProperties } from "react"
import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

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
}

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
}: ObjectImageProps) {
  const [isLoaded, setIsLoaded] = useState(false)
  const [hasError, setHasError] = useState(false)

  const imageSrc = hasError ? fallbackSrc || src : src

  useEffect(() => {
    setIsLoaded(false)
    setHasError(false)
  }, [src])

  return (
    <div className={cn("relative overflow-hidden bg-white", className)} style={wrapperStyle}>
      {fallbackText && (!isLoaded || (hasError && !fallbackSrc)) && (
        <div className="absolute inset-0 flex items-center justify-center break-words px-1 text-center font-mono text-[10px] leading-tight text-gray-400">
          {fallbackText}
        </div>
      )}
      <img
        src={toProxySrc(imageSrc)}
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

"use client"
import dynamic from "next/dynamic"

const MapLibreCSS = dynamic(() => import("@/components/maplibre-css"), { ssr: false })

export default function ClientMapLibreCSS() {
  return <MapLibreCSS />
}

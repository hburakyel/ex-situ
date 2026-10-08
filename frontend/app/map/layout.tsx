import type React from "react"
import type { Metadata, Viewport } from "next"

export const metadata: Metadata = {
  title: "Ex Situ",
  description: "Explore the global spatial index of cultural artifacts. Browse provenance arcs by place, time, and collection on an interactive map.",
}

// Mobile browsers tint the status bar / toolbar areas from theme-color and the page
// background. On desktop the map fills the page, so match its background
// (protomaps-dark-style.ts); on phones the white object panel is the page.
const MAP_BACKGROUND = "#111111"
const PANEL_BACKGROUND = "#ffffff"
const PHONE = "(max-width: 768px)"

export const viewport: Viewport = {
  themeColor: [
    { media: PHONE, color: PANEL_BACKGROUND },
    { color: MAP_BACKGROUND },
  ],
}

export default function MapLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="map-route-bg h-dvh flex flex-col overflow-hidden" suppressHydrationWarning>
      {/* Only on the map route: the page behind the content (overscroll, safe areas). */}
      <style>{`
        html, body, .map-route-bg { background-color: ${MAP_BACKGROUND}; }
        @media ${PHONE} { html, body, .map-route-bg { background-color: ${PANEL_BACKGROUND}; } }
      `}</style>
      <main className="flex-1 min-h-0 relative" suppressHydrationWarning>
        {children}
      </main>
    </div>
  )
}

import type React from "react"
import type { Metadata, Viewport } from "next"

export const metadata: Metadata = {
  title: "Ex Situ",
  description: "Explore the global spatial index of cultural artifacts. Browse provenance arcs by place, time, and collection on an interactive map.",
}

// Mobile browsers tint the status bar / toolbar areas from theme-color and the page
// background; match the map's background (protomaps-dark-style.ts) so no white shows.
const MAP_BACKGROUND = "#111111"

export const viewport: Viewport = {
  themeColor: MAP_BACKGROUND,
}

export default function MapLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-dvh flex flex-col overflow-hidden" style={{ backgroundColor: MAP_BACKGROUND }} suppressHydrationWarning>
      {/* Only on the map route: the page behind the map (overscroll, safe areas) is the map's color. */}
      <style>{`html, body { background-color: ${MAP_BACKGROUND}; }`}</style>
      <main className="flex-1 min-h-0 relative" suppressHydrationWarning>
        {children}
      </main>
    </div>
  )
}

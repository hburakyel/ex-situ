import type React from "react"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Map — Ex Situ",
  description: "Explore the global spatial index of cultural heritage objects. Browse provenance arcs by country, institution, and collection on an interactive map.",
}

export default function MapLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden" suppressHydrationWarning>
      <main className="flex-1 min-h-0 relative" suppressHydrationWarning>
        {children}
      </main>
    </div>
  )
}

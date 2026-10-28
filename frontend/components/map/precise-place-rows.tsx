"use client"

import type { PrecisePlace } from "@/lib/api"

// Precise places inside the selected site, indented under it (country → city →
// precise location). Shown only when the site has any.
export default function PrecisePlaceRows({ places, active, onToggle, padX = "px-2" }: {
  places: PrecisePlace[]
  active: string | null
  onToggle?: (place: PrecisePlace) => void
  padX?: string
}) {
  if (places.length === 0) return null
  return (
    <div className="ml-3 border-l border-gray-200 pl-2">
      {places.map((p) => (
        <div
          key={p.name}
          className={`flex justify-between cursor-pointer hover:bg-gray-200 rounded-md ${padX} py-0.5 text-gray-700 ${active === p.name ? "bg-gray-300" : ""}`}
          onClick={(e) => { e.stopPropagation(); onToggle?.(p) }}
        >
          <span className="truncate max-w-[70%]" title={p.name}>{p.name}</span>
          <span className="ml-2 text-gray-600 text-sm">{p.count}</span>
        </div>
      ))}
    </div>
  )
}

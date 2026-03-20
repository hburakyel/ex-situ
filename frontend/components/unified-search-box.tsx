"use client"

import type React from "react"
import { useRef, useEffect } from "react"
import { GlobeIcon, ArrowRightIcon } from "@radix-ui/react-icons"
import { IconSearch, IconClose } from "@/components/icons"
import { Input } from "@/components/ui/input"
import type { ArcData, PlaceResult, CollectionResult } from "@/hooks/use-unified-search"
import { COLLECTION_LABELS } from "@/hooks/use-unified-search"

export interface UnifiedSearchBoxProps {
  /** Current search query */
  query: string
  /** Called when query changes */
  onQueryChange: (query: string) => void
  /** Whether a search is in progress */
  isSearching: boolean
  /** Error message */
  error: string | null
  /** Place results */
  places: PlaceResult[]
  /** Arc results */
  arcs: ArcData[]
  /** Collection results */
  collections: CollectionResult[]
  /** Whether there is a query */
  hasQuery: boolean
  /** Whether there are results */
  hasResults: boolean
  /** Called when a place is selected */
  onPlaceSelect: (place: PlaceResult) => void
  /** Called when an arc is selected */
  onArcSelect: (arc: ArcData) => void
  /** Called when a collection is selected */
  onCollectionSelect: (collectionName: string) => void
  /** Called when search is submitted (enter key) */
  onSubmit?: () => void
  /** Called when close is requested */
  onClose?: () => void
  /** Placeholder text */
  placeholder?: string
  /** Whether to auto-focus the input */
  autoFocus?: boolean
  /** Width variant */
  variant?: "landing" | "map"
  /** Additional className for the wrapper */
  className?: string
}

export default function UnifiedSearchBox({
  query,
  onQueryChange,
  isSearching,
  error,
  places,
  arcs,
  collections,
  hasQuery,
  hasResults,
  onPlaceSelect,
  onArcSelect,
  onCollectionSelect,
  onSubmit,
  onClose,
  placeholder = "Search places, collections, and arcs...",
  autoFocus = false,
  variant = "map",
  className = "",
}: UnifiedSearchBoxProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus()
    }
  }, [autoFocus])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit?.()
  }

  const isLanding = variant === "landing"

  return (
    <div className={className}>
      {/* Search input */}
      <form onSubmit={handleSubmit} className="relative">
        <Input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          className={
            isLanding
              ? "w-full h-11 pl-10 pr-10 text-sm border border-gray-200 rounded-[10px] focus:border-gray-300 focus:ring-0 transition-colors bg-white placeholder:text-gray-300"
              : "w-full h-10 pl-10 pr-10 text-sm border border-gray-200 rounded-lg focus:border-gray-300 focus:ring-0 transition-colors bg-white placeholder:text-gray-400"
          }
        />
        <IconSearch
          className={
            isLanding
              ? "absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-300"
              : "absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"
          }
        />
        {isSearching && (
          <div className={isLanding ? "absolute right-3 top-1/2 -translate-y-1/2" : "absolute right-3 top-1/2 -translate-y-1/2"}>
            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-200 border-t-gray-500" />
          </div>
        )}
        {!isSearching && hasQuery && (
          <button
            type="button"
            onClick={() => {
              onQueryChange("")
              inputRef.current?.focus()
            }}
            className={isLanding ? "absolute right-3 top-1/2 -translate-y-1/2" : "absolute right-3 top-1/2 -translate-y-1/2"}
          >
            <IconClose className="h-4 w-4 text-gray-400 hover:text-gray-600 transition-colors" />
          </button>
        )}
      </form>

      {/* Results dropdown */}
        {hasQuery && hasResults && (
          <div
            className={
              isLanding
                ? "mt-2 border border-gray-100 rounded-[10px] bg-white shadow-lg p-2 max-h-[50vh] overflow-y-auto space-y-1 animate-in fade-in slide-in-from-top-1 duration-150"
                : "mt-2 max-h-[60vh] overflow-y-auto space-y-1 animate-in fade-in slide-in-from-top-1 duration-150"
            }
          >
            {error && arcs.length === 0 && collections.length === 0 && (
              <p className="text-sm text-gray-400 py-3 text-center">{error}</p>
            )}

            {/* Arcs — shown first so collection data leads the results */}
            {arcs.length > 0 && (
              <div className="space-y-0.5">
                <p className="text-xs text-gray-400 px-1 pb-1">Arcs</p>
                {arcs.map((arc, idx) => (
                  <button
                    key={idx}
                    onClick={() => onArcSelect(arc)}
                    className="w-full px-3 py-2.5 text-left rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-3 group"
                  >
                    {arc.sample_img_url ? (
                      <img
                        src={arc.sample_img_url}
                        alt={arc.place_name}
                        className="h-9 w-9 rounded-lg object-cover shrink-0 bg-gray-100"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                      />
                    ) : (
                      <div className="h-9 w-9 rounded-lg bg-gray-100 shrink-0 flex items-center justify-center">
                        <GlobeIcon className="h-4 w-4 text-gray-300" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-gray-700 font-medium">
                        {arc.place_name}
                      </span>
                      <span className="block text-xs text-gray-400 truncate">
                        {arc.object_count.toLocaleString()}
                        {arc.institution_name && (
                          <span className="text-gray-300"> · {COLLECTION_LABELS[arc.institution_name] || arc.institution_name}</span>
                        )}
                      </span>
                    </div>
                    <ArrowRightIcon className="h-4 w-4 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))}
              </div>
            )}

            {/* Collections */
            {collections.length > 0 && (
              <div className="space-y-0.5 pt-1">
                <p className="text-xs text-gray-400 px-1 pb-1">Collections</p>
                {collections.map((c) => (
                  <button
                    key={c.name}
                    onClick={() => onCollectionSelect(c.name)}
                    className="w-full px-3 py-2.5 text-left rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-3 group"
                  >
                    {c.sampleImageUrl ? (
                      <img
                        src={c.sampleImageUrl}
                        alt={c.shortName}
                        className="h-9 w-9 rounded-lg object-cover shrink-0 bg-gray-100"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                      />
                    ) : (
                      <div className="h-9 w-9 rounded-lg bg-gray-100 shrink-0 flex items-center justify-center">
                        <GlobeIcon className="h-4 w-4 text-gray-300" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-gray-700 font-medium">{c.shortName}</span>
                      <span className="block text-xs text-gray-400 truncate">{c.objectCount.toLocaleString()} artifacts</span>
                    </div>
                    <ArrowRightIcon className="h-4 w-4 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
    </div>
  )
}

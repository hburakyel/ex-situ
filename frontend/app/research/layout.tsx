"use client"

import type React from "react"
import { useState, useRef, useEffect } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useUnifiedSearch } from "@/hooks/use-unified-search"
import type { ArcData, PlaceResult } from "@/hooks/use-unified-search"

const NAV_ITEMS = [
  { label: "research", href: "/research" },
  { label: "map", href: "/map" },
  { label: "about", href: "/about" },
  { label: "community", href: "/community" },
  { label: "api", href: "/api" },
  { label: "help", href: "/help" },
]

export default function ResearchLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const {
    searchQuery,
    setSearchQuery,
    isSearching,
    places,
    arcs,
    collections,
    hasQuery,
    hasResults,
    performSearch,
    clearSearch,
  } = useUnifiedSearch()

  // Build breadcrumb segments from pathname
  const segments = pathname.split("/").filter(Boolean)

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const handleNavigate = (href: string) => {
    setDropdownOpen(false)
    router.push(href)
  }

  const handlePlaceSelect = (place: PlaceResult) => {
    router.push(`/map?place=${encodeURIComponent(place.name)}`)
  }

  const handleArcSelect = (arc: ArcData) => {
    router.push(`/research/arc/${encodeURIComponent((arc.place_name || '').toLowerCase())}`)
    clearSearch()
  }

  const handleCollectionSelect = (collectionName: string) => {
    router.push(`/research/collection/${encodeURIComponent(collectionName.toLowerCase())}`)
    clearSearch()
  }

  // Handle search submit
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && searchQuery.trim()) {
      performSearch(searchQuery)
    }
    if (e.key === "Escape") {
      clearSearch()
      setSearchQuery("")
    }
  }

  // Collect search results for inline display
  const searchResults = hasQuery && hasResults
    ? [
        ...arcs.map((a) => ({ type: "arc" as const, label: a.place_name, sub: `${a.object_count} objects · ${a.institution_name}`, action: () => handleArcSelect(a) })),
        ...collections.map((c) => ({ type: "collection" as const, label: c.name, sub: `${c.objectCount.toLocaleString()} objects`, action: () => handleCollectionSelect(c.name) })),
        ...places.map((p) => ({ type: "place" as const, label: p.name, sub: `${p.latitude.toFixed(2)}, ${p.longitude.toFixed(2)}`, action: () => handlePlaceSelect(p) })),
      ]
    : []

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Terminal-style header */}
      <header className="sticky top-0 z-30 bg-white">
        <div className="px-5 py-3 max-w-5xl mx-auto">
          {/* Breadcrumb prompt line */}
          <div className="flex items-center gap-0 flex-wrap">
            <Link href="/" className="text-green-600 hover:text-green-500">
              exsitu
            </Link>
            <span className="text-gray-400 mx-0.5">/</span>

            {/* First segment with dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="text-green-600 hover:text-green-500 cursor-pointer"
              >
                {segments[0] || "research"}
                <span className="text-gray-400 ml-1">▾</span>
              </button>

              {dropdownOpen && (
                <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 z-50 min-w-[160px]">
                  {NAV_ITEMS.map((item) => (
                    <button
                      key={item.label}
                      onClick={() => handleNavigate(item.href)}
                      className={`block w-full text-left px-3 py-1.5 hover:bg-gray-100 ${
                        pathname.startsWith(item.href)
                          ? "text-green-600"
                          : "text-gray-600"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Remaining segments */}
            {segments.slice(1).map((seg, i) => {
              const href = "/" + segments.slice(0, i + 2).join("/")
              const isLast = i === segments.length - 2
              const label = decodeURIComponent(seg)
              return (
                <span key={href} className="flex items-center">
                  <span className="text-gray-400 mx-0.5">/</span>
                  {isLast ? (
                    <span className="text-gray-500">{label}</span>
                  ) : (
                    <Link href={href} className="text-gray-500 hover:text-gray-700">
                      {label}
                    </Link>
                  )}
                </span>
              )
            })}

            <span className="text-gray-400 mx-0.5">/</span>

            {/* Inline cursor */}
            <span className="text-gray-300 animate-pulse">_</span>
          </div>

          {/* Search prompt line */}
          <div className="mt-3 flex items-center gap-2">
            <span className="text-gray-400 shrink-0">$</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="search objects, arcs, collections..."
              className="flex-1 bg-transparent border-none outline-none text-gray-800 placeholder:text-gray-300 caret-green-500"
            />
            {isSearching && (
              <span className="text-gray-400 text-xs">searching...</span>
            )}
          </div>

          {/* Inline search results */}
          {searchResults.length > 0 && (
            <div className="mt-2 border-t border-gray-100 pt-2">
              <div className="text-gray-400 text-xs mb-1">
                — {searchResults.length} result{searchResults.length !== 1 ? "s" : ""} —
              </div>
              {searchResults.slice(0, 12).map((r, i) => (
                <button
                  key={i}
                  onClick={r.action}
                  className="block w-full text-left py-0.5 hover:bg-gray-50 group"
                >
                  <span className={`${
                    r.type === "arc" ? "text-blue-500" : r.type === "collection" ? "text-amber-600" : "text-blue-600"
                  }`}>
                    {r.label}
                  </span>
                  <span className="text-gray-400 ml-2">{r.sub}</span>
                </button>
              ))}
              {searchResults.length > 12 && (
                <div className="text-gray-300 text-xs mt-1">
                  +{searchResults.length - 12} more
                </div>
              )}
            </div>
          )}

          {hasQuery && !hasResults && !isSearching && (
            <div className="mt-2 text-gray-400 text-xs">
              no results for &quot;{searchQuery}&quot;
            </div>
          )}
        </div>

        {/* Thin separator */}
        <div className="border-b border-gray-100" />
      </header>

      {/* Page content */}
      <main className="flex-1">
        {children}
      </main>
    </div>
  )
}

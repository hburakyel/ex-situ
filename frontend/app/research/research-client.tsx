"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useUnifiedSearch, type ArcData, type CollectionResult } from "@/hooks/use-unified-search"

type Tab = "arcs" | "collections"

export default function ResearchClient() {
  const router = useRouter()
  const {
    isLoadingArcData,
    arcData,
    cityArcData,
    allCollections,
  } = useUnifiedSearch()

  const [activeTab, setActiveTab] = useState<Tab>("arcs")
  const [filterText, setFilterText] = useState("")

  // Group arcs by country, sorted by total object count
  const groupedArcs = useMemo(() => {
    const countryMap = new Map<string, { arcs: ArcData[]; totalCount: number }>()
    arcData.forEach((arc) => {
      const country = arc.place_name
      const existing = countryMap.get(country)
      if (existing) {
        existing.arcs.push(arc)
        existing.totalCount += arc.object_count
      } else {
        countryMap.set(country, { arcs: [arc], totalCount: arc.object_count })
      }
    })
    return Array.from(countryMap.entries())
      .map(([country, data]) => ({
        country,
        arcs: data.arcs,
        totalCount: data.totalCount,
        institutions: [...new Set(data.arcs.map((a) => a.institution_name))],
        lat: data.arcs[0].latitude,
        lng: data.arcs[0].longitude,
      }))
      .sort((a, b) => b.totalCount - a.totalCount)
  }, [arcData])

  // Sites per country from cityArcData (zoom=4)
  const sitesByCountry = useMemo(() => {
    const map = new Map<string, Set<string>>()
    cityArcData.forEach((arc) => {
      const c = arc.country
      if (c) {
        if (!map.has(c)) map.set(c, new Set())
        map.get(c)!.add(arc.place_name)
      }
    })
    return map
  }, [cityArcData])

  // Filter countries list
  const filteredArcs = useMemo(() => {
    if (!filterText) return groupedArcs
    const lower = filterText.toLowerCase()
    return groupedArcs.filter(
      (g) =>
        g.country.toLowerCase().includes(lower) ||
        g.institutions.some((i) => i.toLowerCase().includes(lower)),
    )
  }, [groupedArcs, filterText])

  const filteredCollections = useMemo(() => {
    if (!filterText) return allCollections
    const lower = filterText.toLowerCase()
    return allCollections.filter(
      (c) =>
        c.name.toLowerCase().includes(lower) ||
        c.shortName.toLowerCase().includes(lower) ||
        c.countries.some((co) => co.toLowerCase().includes(lower)),
    )
  }, [allCollections, filterText])

  // Handlers
  const handleCountryClick = (country: string) => {
    router.push(`/research/arc/${encodeURIComponent(country.toLowerCase())}`)
  }

  const handleCollectionClick = (name: string) => {
    router.push(`/research/collection/${encodeURIComponent(name.toLowerCase())}`)
  }

  // ─── Main list view (countries / collections) ───
  return (
    <div className="max-w-5xl mx-auto px-5 py-4">
      {/* Tab selector */}
      <div className="flex items-center gap-4 mb-4">
        <button
          onClick={() => setActiveTab("arcs")}
          className={activeTab === "arcs" ? "text-gray-900 underline underline-offset-4" : "text-gray-400 hover:text-gray-600"}
        >
          arcs
        </button>
        <button
          onClick={() => setActiveTab("collections")}
          className={activeTab === "collections" ? "text-gray-900 underline underline-offset-4" : "text-gray-400 hover:text-gray-600"}
        >
          collections
        </button>

        <div className="flex items-center gap-1 ml-auto">
          <span className="text-gray-300">filter:</span>
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="..."
            className="bg-transparent border-none outline-none text-gray-700 placeholder:text-gray-300 w-40 caret-green-500"
          />
        </div>
      </div>

      {/* Loading */}
      {isLoadingArcData && (
        <div className="py-16 text-gray-400">loading...</div>
      )}

      {/* ══════════ ARCS TAB ══════════ */}
      {!isLoadingArcData && activeTab === "arcs" && (
        <>
          <div className="text-gray-400 mb-3">
            {filteredArcs.length} origin{filteredArcs.length !== 1 ? "s" : ""}
          </div>

          <div className="border-t border-gray-100">
            {filteredArcs.map((group, index) => {
              const sites = sitesByCountry.get(group.country)
              const siteNames = sites ? Array.from(sites).sort() : []
              return (
                <button
                  key={`${group.country}-${index}`}
                  onClick={() => handleCountryClick(group.country)}
                  className="w-full text-left py-2 border-b border-gray-50 hover:bg-gray-50 group block"
                >
                  <div className="flex items-baseline gap-3">
                    <span className="text-blue-600 group-hover:text-blue-500 min-w-[180px]">
                      {group.country}
                    </span>
                    <span className="text-gray-400 tabular-nums">
                      {group.totalCount.toLocaleString()} links
                    </span>
                    <span className="text-gray-300">·</span>
                    <span className="text-gray-400">
                      {group.institutions.length} collection{group.institutions.length !== 1 ? "s" : ""}
                    </span>
                    <span className="text-gray-300">·</span>
                    <span className="text-gray-300 truncate">
                      {group.institutions.slice(0, 2).join(", ")}
                      {group.institutions.length > 2 && ` +${group.institutions.length - 2}`}
                    </span>
                    <span className="ml-auto text-gray-300 opacity-0 group-hover:opacity-100">
                      →
                    </span>
                  </div>
                  {siteNames.length > 0 && (
                    <div className="mt-0.5 text-gray-300 text-xs truncate pl-[180px]">
                      {siteNames.length} site{siteNames.length !== 1 ? "s" : ""} · {siteNames.slice(0, 4).join(", ")}
                      {siteNames.length > 4 && ` +${siteNames.length - 4}`}
                    </div>
                  )}
                </button>
              )
            })}
          </div>

          {filterText && filteredArcs.length === 0 && (
            <div className="text-gray-400 py-8">
              no arcs matching &quot;{filterText}&quot;
            </div>
          )}
        </>
      )}

      {/* ══════════ COLLECTIONS TAB ══════════ */}
      {!isLoadingArcData && activeTab === "collections" && (
        <>
          <div className="text-gray-400 mb-3">
            {filteredCollections.length} collection{filteredCollections.length !== 1 ? "s" : ""}
          </div>

          <div className="border-t border-gray-100">
            {filteredCollections.map((collection) => (
              <button
                key={collection.name}
                onClick={() => handleCollectionClick(collection.name)}
                className="w-full text-left flex items-baseline gap-3 py-2 border-b border-gray-50 hover:bg-gray-50 group"
              >
                <span className="text-amber-500 group-hover:text-amber-500 min-w-[180px]">
                  {collection.shortName}
                </span>
                <span className="text-gray-400 tabular-nums">
                  {collection.objectCount.toLocaleString()} links
                </span>
                <span className="text-gray-300">·</span>
                <span className="text-gray-300 truncate">
                  {collection.countries.slice(0, 3).join(", ")}
                  {collection.countries.length > 3 && ` +${collection.countries.length - 3}`}
                </span>
                <span className="ml-auto text-gray-300 opacity-0 group-hover:opacity-100">
                  →
                </span>
              </button>
            ))}
          </div>

          {filterText && filteredCollections.length === 0 && (
            <div className="text-gray-400 py-8">
              no collections matching &quot;{filterText}&quot;
            </div>
          )}
        </>
      )}
    </div>
  )
}

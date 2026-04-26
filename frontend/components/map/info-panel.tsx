// InfoPanel: Extracted from ObjectPanel for easier editing.
// This file should contain only the info panel UI/logic, not the object grid or gallery.

import React from "react"
import { Spinner } from "@/components/ui/spinner"
import { Button } from "@/components/ui/button"
import { ChevronDown, ChevronUp } from "lucide-react"
import { IconClose, IconSearch } from "@/components/icons"
import type {
  BreadcrumbSegment,
  DrillLevel,
  GroupedOrigin,
  GroupedSite,
  InstitutionItem,
  FacetedFilters
} from "./object-panel"

interface InfoPanelProps {
  isMobile: boolean
  containerSize: "default" | "expanded" | "minimized"
  breadcrumb: BreadcrumbSegment[]
  onBreadcrumbClick?: (level: DrillLevel) => void
  onCommandPaletteOpen?: () => void
  actionSlot?: React.ReactNode
  totalCount: number
  collectionCount: number
  isLoading: boolean
  drillLevel: DrillLevel
  groupedOrigins: GroupedOrigin[]
  isLoadingOrigins: boolean
  onOriginClick?: (country: string, lat?: number, lng?: number) => void
  groupedSites: GroupedSite[]
  activeSite: string | null
  onToggleSite?: (site: string, lat?: number, lng?: number) => void
  isLoadingSubArcs: boolean
  drillInstitutions: InstitutionItem[]
  activeInstitution: string | null
  onToggleInstitution?: (inst: string) => void
  facetedFilters: FacetedFilters
  removeFilter: (type: keyof FacetedFilters, value: string) => void
  clearAllFilters: () => void
  locationName?: string
  geocodedName?: string
}

export default function InfoPanel({
  isMobile,
  containerSize,
  breadcrumb,
  onBreadcrumbClick,
  onCommandPaletteOpen,
  actionSlot,
  totalCount,
  collectionCount,
  isLoading,
  drillLevel,
  groupedOrigins,
  isLoadingOrigins,
  onOriginClick,
  groupedSites,
  activeSite,
  onToggleSite,
  isLoadingSubArcs,
  drillInstitutions,
  activeInstitution,
  onToggleInstitution,
  facetedFilters,
  removeFilter,
  clearAllFilters,
  locationName,
  geocodedName,
}: InfoPanelProps) {
  const [showOrigins, setShowOrigins] = React.useState(false)
  const [showSites, setShowSites] = React.useState(false)
  const [showCollections, setShowCollections] = React.useState(false)

  const activeFilterCount = facetedFilters.countries.length + facetedFilters.cities.length + facetedFilters.institutions.length
  const displayName = geocodedName || ''
  const showResolved = !!(geocodedName && locationName && geocodedName.toLowerCase() !== locationName.toLowerCase())

  return (
    <div className={`${isMobile ? "px-4 pt-2 pb-4" : "p-4 pt-3"} flex flex-col bg-white`}>
      {/* Mobile breadcrumb + search row — always visible */}

      {breadcrumb.length > 0 && (
        <div className="flex py-1 items-center justify-between gap-2 pb-1.5">
          <div className="flex items-center min-w-0 flex-1 overflow-hidden text-sm">
            {breadcrumb.map((seg, i) => {
              const isLast = i === breadcrumb.length - 1
              return (
                <span
                  key={i}
                  className={`flex items-center ${isLast ? "min-w-0 overflow-hidden" : "flex-shrink-0"}`}
                >
                  {i > 0 && <span className="text-black/30 mx-1 flex-shrink-0">/</span>}
                  {isLast ? (
                    <span
                      className="text-black font-medium truncate"
                      title={seg.label}
                    >
                      {seg.label}
                    </span>
                  ) : (
                    <button
                      className="text-black/60 hover:text-black hover:underline transition-colors whitespace-nowrap flex-shrink-0"
                      onClick={() => onBreadcrumbClick?.(seg.level)}
                      title={seg.label}
                    >
                      {seg.label}
                    </button>
                  )}
                </span>
              )
            })}
          </div>
          {onCommandPaletteOpen && (
            <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={onCommandPaletteOpen} title="Search (⌘K)">
              <IconSearch className="w-5 h-5 text-gray-500" />
            </Button>
          )}
        </div>
      )}

      {isMobile && containerSize === "minimized" && actionSlot && (
        <div className="flex items-center justify-between py-1">
          <span className="text-sm text-black/60 truncate min-w-0 flex-1">
            {displayName || locationName || ""}
          </span>
          <div className="flex-shrink-0">{actionSlot}</div>
        </div>
      )}

      {!(isMobile && containerSize === "minimized") && (
        <>
          <div className="flex py-1 items-center justify-between gap-2">
            <div className="text-sm min-w-0 flex-1">
              <div className="leading-normal text-left">
                <span className="inline-block whitespace-nowrap">
                  <span className="text-black font-medium">{totalCount}</span>
                  <span className="ml-1">artifact{totalCount !== 1 ? "s" : ""}</span>
                </span>
                <span>
                  {drillLevel === "global"
                    ? (collectionCount > 0 ? ` from ${collectionCount} collection${collectionCount !== 1 ? "s" : ""}` : "")
                    : (displayName || locationName)
                      ? ` from ${displayName || locationName}`
                      : ""}
                </span>
                {isLoading && <Spinner className="ml-2 h-3 w-3 inline-block" />}
              </div>
            </div>
            {actionSlot && (
              <div className="flex-shrink-0">{actionSlot}</div>
            )}
          </div>

          {/* Mobile: Drill-down sections (after artifact count) */}
          {isMobile && (
            <div>
              {/* Places (global) */}
              {drillLevel === "global" && groupedOrigins.length > 0 && (
                <div>
                  <div className="flex items-center justify-between">
                    <span className="panel-text-muted">
                      Places
                      {isLoadingOrigins && <Spinner className="ml-2 h-3 w-3 inline-block" />}
                    </span>
                    <Button variant="ghost" size="icon" className="h-8 w-8 flex items-center justify-center"
                      onClick={() => setShowOrigins(!showOrigins)}
                    >
                      {showOrigins ? <ChevronUp className="h-5 w-5 text-gray-500" /> : <ChevronDown className="h-5 w-5 text-gray-500" />}
                    </Button>
                  </div>
                  {showOrigins && (
                    <div className="space-y-0.5 max-h-40 overflow-y-auto pr-1">
                        {groupedOrigins.map((origin, index) => (
                          <div key={index} className="flex justify-between cursor-pointer hover:bg-gray-50 rounded-md px-0 py-0.5"
                            onClick={() => onOriginClick?.(origin.country, origin.lat, origin.lng)}
                          >
                            <span className="truncate max-w-[70%]">{origin.country}</span>
                            <span className="ml-2 text-gray-400 text-sm">{origin.totalCount}</span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}

              {/* Sites (country) */}
              {drillLevel !== "global" && groupedSites.length > 0 && (
                <div>
                  <div className="flex items-center justify-between">
                    <span className="panel-text-muted">
                      Sites
                      {isLoadingSubArcs && <Spinner className="ml-2 h-3 w-3 inline-block" />}
                    </span>
                    <Button variant="ghost" size="icon" className="h-8 w-8 flex items-center justify-center"
                      onClick={() => setShowSites(!showSites)}
                    >
                      {showSites ? <ChevronUp className="h-5 w-5 text-gray-500" /> : <ChevronDown className="h-5 w-5 text-gray-500" />}
                    </Button>
                  </div>
                  {showSites && (
                    <div className="space-y-0.5 max-h-40 overflow-y-auto pr-1">
                        {groupedSites.map((site, index) => (
                          <div key={index}
                            className={`flex justify-between cursor-pointer hover:bg-gray-50 rounded-md px-0 py-0.5 ${activeSite === site.name ? "bg-gray-100" : ""}`}
                            onClick={() => onToggleSite?.(site.name, site.lat, site.lng)}
                          >
                            <span className="truncate max-w-[70%]">{site.name}</span>
                            <span className="ml-2 text-gray-400 text-sm">{site.totalCount}</span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}

              {/* Institutions (country) */}
              {drillLevel !== "global" && drillInstitutions.length > 0 && (
                <div>
                  <div className="flex items-center justify-between">
                    <span className="panel-text-muted">
                      Collections
                    </span>
                    <Button variant="ghost" size="icon" className="h-8 w-8 flex items-center justify-center"
                      onClick={() => setShowCollections(!showCollections)}
                    >
                      {showCollections ? <ChevronUp className="h-5 w-5 text-gray-500" /> : <ChevronDown className="h-5 w-5 text-gray-500" />}
                    </Button>
                  </div>
                  {showCollections && (
                    <div className="space-y-0.5 max-h-40 overflow-y-auto pr-1">
                        {drillInstitutions.map((inst, index) => (
                          <div key={index}
                            className={`flex justify-between cursor-pointer hover:bg-gray-50 rounded-md px-0 py-0.5 ${activeInstitution === inst.name ? "bg-gray-100" : ""}`}
                            onClick={() => onToggleInstitution?.(inst.name)}
                          >
                            <span className="truncate max-w-[70%]">{inst.name}</span>
                            <span className="ml-2 text-gray-400 text-sm">{inst.count}</span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Filter chips */}
          {activeFilterCount > 0 && (
            <div className="flex flex-wrap items-center gap-1 pt-1">
              {facetedFilters.countries.map(c => (
                <span key={`c-${c}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-100 text-blue-700 text-sm">
                  {c}
                  <button onClick={() => removeFilter('countries', c)} className="hover:bg-blue-100 rounded-md p-0.5">
                    <IconClose className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
              {facetedFilters.cities.map(c => (
                <span key={`s-${c}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-100 text-blue-700 text-sm">
                  {c}
                  <button onClick={() => removeFilter('cities', c)} className="hover:bg-blue-100 rounded-md p-0.5">
                    <IconClose className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
              {facetedFilters.institutions.map(c => (
                <span key={`i-${c}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-orange-50 text-orange-700 text-sm">
                  {c}
                  <button onClick={() => removeFilter('institutions', c)} className="hover:bg-orange-100 rounded-md p-0.5">
                    <IconClose className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
              {activeFilterCount > 1 && (
                <button onClick={clearAllFilters} className="text-sm text-gray-400 hover:text-gray-600 px-0">
                  Clear all
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

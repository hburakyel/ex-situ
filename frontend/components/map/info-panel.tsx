// InfoPanel: Extracted from ObjectPanel for easier editing.
// This file should contain only the info panel UI/logic, not the object grid or gallery.

import React from "react"
import { Spinner } from "@/components/ui/spinner"
import { Button } from "@/components/ui/button"
import { IconClose, IconSearch } from "@/components/icons"
import type { EraBucket } from "@/lib/era-buckets"
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
  onToggleEra?: (bucket: EraBucket) => void
  facetedFilters: FacetedFilters
  removeFilter: (type: keyof Omit<FacetedFilters, "era" | "migrationEra">, value: string) => void
  removeEraFilter?: () => void
  removeMigrationFilter?: () => void
  locationName?: string
  activeCountry?: string | null
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
  activeSite,
  drillInstitutions,
  facetedFilters,
  removeFilter,
  removeEraFilter,
  removeMigrationFilter,
  locationName,
  activeCountry,
}: InfoPanelProps) {
  const activeFilterCount = facetedFilters.countries.length + facetedFilters.cities.length + facetedFilters.institutions.length +
    (facetedFilters.era ? 1 : 0) + (facetedFilters.migrationEra ? 1 : 0)
  // Real place/site name — same priority used to build the breadcrumb trail, not the reverse-geocoded name.
  // Institution is deliberately excluded: it's always shown as a filter chip
  // below (facetedFilters.institutions), so repeating it here as plain text
  // duplicated the same name twice in the panel header.
  const displayName = (activeSite && activeSite !== activeCountry)
    ? activeSite
    : (activeCountry || '')

  return (
    <div className={`${isMobile ? "px-4 pt-0 pb-4" : "p-4 pt-2"} flex flex-col bg-white`}>
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
                {!(totalCount === 0 && isLoading) && (
                  <>
                    <span className="inline-block whitespace-nowrap">
                      <span className="text-black font-medium">{totalCount}</span>
                      <span className="ml-1">artifact{totalCount !== 1 ? "s" : ""}</span>
                    </span>
                    <span>
                      {drillLevel === "global"
                        ? (collectionCount > 0 ? ` from ${collectionCount} collection${collectionCount !== 1 ? "s" : ""}` : "")
                        : drillInstitutions.length > 0
                          ? ` · ${drillInstitutions.length} collection${drillInstitutions.length !== 1 ? "s" : ""}`
                          : ""}
                    </span>
                    {isLoading && <Spinner className="ml-2 h-3 w-3 inline-block" />}
                  </>
                )}
              </div>
              {displayName && (
                <div className="truncate text-sm text-black leading-normal mt-0.5">
                  {displayName}
                </div>
              )}
            </div>
            {actionSlot && (
              <div className="flex-shrink-0">{actionSlot}</div>
            )}
          </div>

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
              {facetedFilters.era && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-50 text-gray-600 text-sm">
                  {facetedFilters.era.label}
                  <button onClick={() => removeEraFilter?.()} className="hover:opacity-70 rounded-md p-0.5">
                    <IconClose className="w-2.5 h-2.5 text-white" />
                  </button>
                </span>
              )}
              {facetedFilters.migrationEra && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-50 text-gray-600 text-sm">
                  {facetedFilters.migrationEra.label}
                  <button onClick={() => removeMigrationFilter?.()} className="hover:opacity-70 rounded-md p-0.5">
                    <IconClose className="w-2.5 h-2.5 text-white" />
                  </button>
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// InfoPanel: Extracted from ObjectPanel for easier editing.
// This file should contain only the info panel UI/logic, not the object grid or gallery.

import React from "react"
import { Spinner } from "@/components/ui/spinner"
import { Button } from "@/components/ui/button"
import { ChevronDown, ChevronUp, Globe, Info } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { IconClose } from "@/components/icons"
import SearchBar from "./search-bar"
import { ERA_BUCKETS, collapseContiguousBuckets, type EraBucket } from "@/lib/era-buckets"
import type { DateBucketCounts } from "@/lib/api"
import type {
  BreadcrumbSegment,
  DrillLevel,
  GroupedOrigin,
  GroupedSite,
  InstitutionItem,
  FacetedFilters
} from "./object-panel"
import { placeDisplayLabels } from "@/lib/place-label"

const PANEL_BOTTOM_FADE_STYLE = {
  background: "linear-gradient(to top, rgba(255, 255, 255, 1) 0%, rgba(255, 255, 255, 0.92) 14%, rgba(255, 255, 255, 0.45) 30%, rgba(255, 255, 255, 0) 48%, rgba(255, 255, 255, 0) 100%)",
}

const PANEL_TOP_FADE_STYLE = {
  background: "linear-gradient(to bottom, rgba(255, 255, 255, 1) 0%, rgba(255, 255, 255, 0.92) 14%, rgba(255, 255, 255, 0.45) 30%, rgba(255, 255, 255, 0) 48%, rgba(255, 255, 255, 0) 100%)",
}

const formatCount = (n: number) => n.toLocaleString("en-US")

// Mobile drill-down section header (Places / Sites / Time / Collections): the whole
// row toggles, not just the chevron. It keeps the old 32px look; an invisible
// extension above and below makes the touch target 44px.
function SectionToggle({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="relative flex w-full h-8 items-center justify-between text-left before:absolute before:inset-x-0 before:-top-1.5 before:-bottom-1.5 before:content-['']"
      onClick={onToggle}
      aria-expanded={open}
    >
      <span className="panel-text-muted">{children}</span>
      {open ? <ChevronUp className="h-5 w-5 text-gray-500" /> : <ChevronDown className="h-5 w-5 text-gray-500" />}
    </button>
  )
}

function FadedAccordionList({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      <div className="space-y-0.5 max-h-40 overflow-y-auto pr-1 pb-4">
        {children}
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-5"
        style={PANEL_TOP_FADE_STYLE}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-8"
        style={PANEL_BOTTOM_FADE_STYLE}
      />
    </div>
  )
}

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
  dateBuckets?: DateBucketCounts | null
  /** Collapses the Places/Time/Collections block (mobile only) to free up room for the object grid while it's scrolled down. Defaults to visible. */
  drillSectionsVisible?: boolean
  facetedFilters: FacetedFilters
  removeFilter: (type: keyof Omit<FacetedFilters, "era" | "migrationEra">, value: string) => void
  removeEraFilter?: () => void
  removeMigrationFilter?: () => void
  locationName?: string
  activeCountry?: string | null
  /** Mobile only: "drill" is the top card (breadcrumb, Places/Sites/Time/Collections, filter chips);
   *  "summary" is the bottom sheet's count row. Omitted, everything renders together. */
  mobileVariant?: "summary" | "drill"
  /** Mobile: shows/puts away the map card; its button takes the About button's place. */
  onMapToggle?: () => void
  mapOpen?: boolean
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
  onToggleEra,
  dateBuckets,
  drillSectionsVisible = true,
  facetedFilters,
  removeFilter,
  removeEraFilter,
  removeMigrationFilter,
  locationName,
  activeCountry,
  mobileVariant,
  onMapToggle,
  mapOpen,
}: InfoPanelProps) {
  // Mobile sections are an accordion: one list open at a time keeps the card short
  // enough to fit above the half-height sheet without scrolling.
  const [openSection, setOpenSection] = React.useState<"origins" | "sites" | "time" | "collections" | null>("origins")
  const sectionState = (key: "origins" | "sites" | "time" | "collections") =>
    [openSection === key, (open: boolean) => setOpenSection(open ? key : null)] as const
  const [showOrigins, setShowOrigins] = sectionState("origins")
  // Places (global) and Sites (country) share one open state, so drilling in keeps the list open.
  const [showSites, setShowSites] = sectionState("origins")
  // Display-only labels: "Kano (State)" shows as "Kano" unless another site shares the name.
  const siteLabels = React.useMemo(() => placeDisplayLabels(groupedSites.map((s) => s.name)), [groupedSites])
  const [showTime, setShowTime] = sectionState("time")
  const [showCollections, setShowCollections] = sectionState("collections")

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
    <div className={`${
      mobileVariant === "summary" ? "px-4 py-0"
        : mobileVariant === "drill" ? "px-4 pt-1 pb-3"
        : isMobile ? "px-4 pt-0 pb-4" : "p-4 pt-2"
    } flex flex-col bg-white`}>
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
          {mobileVariant === "drill" && onMapToggle && (
            <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={onMapToggle}
              title={mapOpen ? "Hide map" : "Show map"} aria-label={mapOpen ? "Hide map" : "Show map"} aria-pressed={mapOpen}
            >
              <Globe className={`w-5 h-5 ${mapOpen ? "text-black" : "text-gray-500"}`} />
            </Button>
          )}
          {/* About — on phones this replaces the map's info control */}
          {mobileVariant === "drill" && !onMapToggle && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" title="About" aria-label="About">
                  <Info className="w-5 h-5 text-gray-500" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 rounded-xl text-[13px] leading-normal text-[#333]">
                <p className="mb-2.5 text-[#555]">
                  Ex Situ is an open-source spatial index mapping cultural heritage displacement. By tracking only the geographic extraction vector between an artifact&apos;s origin and current repository, it refuses problematic taxonomies and routes researchers directly to the source.
                </p>
                <a href="https://github.com/hburakyel/ex-situ" target="_blank" rel="noopener noreferrer" className="block text-[#333]">
                  GitHub ↗
                </a>
                <p className="mt-1.5 font-mono text-[11px] text-[#999]">
                  Data may be incomplete.{" "}
                  <a href="https://github.com/hburakyel/ex-situ/issues/new" target="_blank" rel="noopener noreferrer" className="text-[#999]">Report issue ↗</a>
                </p>
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}

      {onCommandPaletteOpen && (
        <div className="pt-1 pb-2">
          <SearchBar onOpen={onCommandPaletteOpen} />
        </div>
      )}

      {!mobileVariant && isMobile && containerSize === "minimized" && actionSlot && (
        <div className="flex items-center justify-between py-1">
          <span className="text-sm text-black/60 truncate min-w-0 flex-1">
            {displayName || locationName || ""}
          </span>
          <div className="flex-shrink-0">{actionSlot}</div>
        </div>
      )}

      {(mobileVariant || !(isMobile && containerSize === "minimized")) && (
        <>
          {mobileVariant !== "drill" && (
          <div className="flex py-1 items-center justify-between gap-2">
            <div className="text-sm min-w-0 flex-1">
              <div className="leading-normal text-left">
                {!(totalCount === 0 && isLoading) && (
                  <>
                    <span className="inline-block whitespace-nowrap">
                      <span className="text-black font-medium">{formatCount(totalCount)}</span>
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
              {displayName && !isMobile && (
                <div className="truncate text-sm text-black leading-normal mt-0.5">
                  {displayName}
                </div>
              )}
            </div>
            {actionSlot && (
              <div className="flex-shrink-0">{actionSlot}</div>
            )}
          </div>
          )}

          {/* Mobile: Drill-down sections (after artifact count) — collapses while the
              object grid below is scrolled down, to free up room for it, and comes
              back on scroll-up (see drillSectionsVisible in object-panel.tsx). */}
          {isMobile && mobileVariant !== "summary" && (
            <div
              className={`overflow-hidden transition-[max-height,opacity] ease-in-out ${
                drillSectionsVisible ? "duration-700 max-h-[1000px] opacity-100" : "duration-400 max-h-0 opacity-0"
              }`}
            >
              {/* Places (global) */}
              {drillLevel === "global" && groupedOrigins.length > 0 && (
                <div>
                  <SectionToggle open={showOrigins} onToggle={() => setShowOrigins(!showOrigins)}>
                    Places
                    {isLoadingOrigins && <Spinner className="ml-2 h-3 w-3 inline-block" />}
                  </SectionToggle>
                  {showOrigins && (
                    <FadedAccordionList>
                        {groupedOrigins.map((origin, index) => (
                          <div key={index} className="flex justify-between cursor-pointer hover:bg-gray-50 rounded-md px-0 py-0.5"
                            onClick={() => onOriginClick?.(origin.country, origin.lat, origin.lng)}
                          >
                            <span className="truncate max-w-[70%]" title={origin.country}>{origin.country}</span>
                            <span className="ml-2 text-gray-400 text-sm">{formatCount(origin.totalCount)}</span>
                          </div>
                        ))}
                    </FadedAccordionList>
                  )}
                </div>
              )}

              {/* Sites (country) */}
              {drillLevel !== "global" && groupedSites.length > 0 && (
                <div>
                  <SectionToggle open={showSites} onToggle={() => setShowSites(!showSites)}>
                    Sites
                    {isLoadingSubArcs && <Spinner className="ml-2 h-3 w-3 inline-block" />}
                  </SectionToggle>
                  {showSites && (
                    <FadedAccordionList>
                        {groupedSites.map((site, index) => (
                          <div key={index}
                            className={`flex justify-between cursor-pointer hover:bg-gray-50 rounded-md px-0 py-0.5 ${activeSite === site.name ? "bg-gray-100" : ""}`}
                            onClick={() => onToggleSite?.(site.name, site.lat, site.lng)}
                          >
                            <span className="truncate max-w-[70%]" title={site.name}>{siteLabels.get(site.name) ?? site.name}</span>
                            <span className="ml-2 text-gray-400 text-sm">{formatCount(site.totalCount)}</span>
                          </div>
                        ))}
                    </FadedAccordionList>
                  )}
                </div>
              )}

              {/* Time — shown at all drill levels */}
              {dateBuckets && (
                <div>
                  <SectionToggle open={showTime} onToggle={() => setShowTime(!showTime)}>
                    Time
                  </SectionToggle>
                  {showTime && (
                    <FadedAccordionList>
                        {collapseContiguousBuckets(
                            ERA_BUCKETS,
                            Object.fromEntries(dateBuckets.objectDateBuckets.map((b) => [b.id, b.count])),
                            dateBuckets.objectDateSpans,
                          )
                          .filter((row) => row.count > 0)
                          .map((row) => (
                            <div key={row.id}
                              className={`flex justify-between cursor-pointer hover:bg-gray-50 rounded-md px-0 py-0.5 ${facetedFilters.era?.id === row.id ? "bg-gray-100" : ""}`}
                              onClick={() => onToggleEra?.(row.era)}
                            >
                              <span className="truncate max-w-[70%]" title={row.label}>{row.label}</span>
                              <span className="ml-2 text-gray-400 text-sm">{formatCount(row.count)}</span>
                            </div>
                          ))}
                    </FadedAccordionList>
                  )}
                </div>
              )}

              {/* Institutions — shown at all zoom levels */}
              {drillInstitutions.length > 0 && (
                <div>
                  <SectionToggle open={showCollections} onToggle={() => setShowCollections(!showCollections)}>
                    Collections
                  </SectionToggle>
                  {showCollections && (
                    <FadedAccordionList>
                        {drillInstitutions.map((inst, index) => (
                          <div key={index}
                            className={`flex justify-between cursor-pointer hover:bg-gray-50 rounded-md px-0 py-0.5 ${activeInstitution === inst.name ? "bg-gray-100" : ""}`}
                            onClick={() => onToggleInstitution?.(inst.name)}
                          >
                            <span className="truncate max-w-[70%]" title={inst.name}>{inst.name}</span>
                            <span className="ml-2 text-gray-400 text-sm">{formatCount(inst.count)}</span>
                          </div>
                        ))}
                    </FadedAccordionList>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Filter chips */}
          {activeFilterCount > 0 && mobileVariant !== "summary" && (
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

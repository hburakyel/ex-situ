// InfoPanel: Extracted from ObjectPanel for easier editing.
// This file should contain only the info panel UI/logic, not the object grid or gallery.

import React from "react"
import { Spinner } from "@/components/ui/spinner"
import { Button } from "@/components/ui/button"
import { ChevronDown, ChevronUp, Globe, Info, Search } from "lucide-react"
import { useScrollFades } from "@/hooks/use-scroll-fades"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { IconClose, IconMinimize } from "@/components/icons"
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
import { placeDisplayLabels, siteRowLabel } from "@/lib/place-label"
import type { PrecisePlace } from "@/lib/api"
import PrecisePlaceRows from "@/components/map/precise-place-rows"

const PANEL_BOTTOM_FADE_STYLE = {
  background: "linear-gradient(to top, rgba(255, 255, 255, 1) 0%, rgba(255, 255, 255, 0.92) 14%, rgba(255, 255, 255, 0.45) 30%, rgba(255, 255, 255, 0) 48%, rgba(255, 255, 255, 0) 100%)",
}

const PANEL_TOP_FADE_STYLE = {
  background: "linear-gradient(to bottom, rgba(255, 255, 255, 1) 0%, rgba(255, 255, 255, 0.92) 14%, rgba(255, 255, 255, 0.45) 30%, rgba(255, 255, 255, 0) 48%, rgba(255, 255, 255, 0) 100%)",
}

const formatCount = (n: number) => n.toLocaleString("en-US")

// Mobile drill-down section header (Places / Sites / Time / Collections): the whole
// row toggles, and the chevron sits right after the label. An invisible
// extension above and below makes the 32px row a 44px touch target.
function SectionToggle({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="relative flex w-full h-8 items-center gap-1 text-left before:absolute before:inset-x-0 before:-top-1.5 before:-bottom-1.5 before:content-['']"
      onClick={onToggle}
      aria-expanded={open}
    >
      <span className="panel-text-muted">{children}</span>
      {open ? <ChevronUp className="h-4 w-4 text-gray-600" /> : <ChevronDown className="h-4 w-4 text-gray-600" />}
    </button>
  )
}

// Side-by-side sections (desktop expanded panel): every list is open, so the header
// is a plain label rather than a toggle.
function SectionHeader({ columns, open, onToggle, children }: { columns?: boolean; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  if (!columns) return <SectionToggle open={open} onToggle={onToggle}>{children}</SectionToggle>
  return (
    <div className="flex h-8 items-center">
      <span className="panel-text-muted">{children}</span>
    </div>
  )
}

// About Ex Situ: the mobile header's info section and the desktop popover.
export function AboutText() {
  return (
    <>
      <p className="mb-2.5">
        Ex Situ is an open-source spatial index that maps cultural artifacts from their place of origin to the institution that holds them today. Each artifact is drawn as an arc that links back to the institution&rsquo;s own page. Ex Situ does not host images or copy records. The index shows what museum records state. Many artifacts have no located origin, and some locations are uncertain.
      </p>
      <p>
        <a href="https://github.com/hburakyel/ex-situ" target="_blank" rel="noopener noreferrer" className="text-link">GitHub ↗</a>
        {" · "}
        <a href="https://github.com/hburakyel/ex-situ/issues/new" target="_blank" rel="noopener noreferrer" className="text-link">Report issue ↗</a>
      </p>
    </>
  )
}

function FadedAccordionList({ children }: { children: React.ReactNode }) {
  const { ref, fades } = useScrollFades<HTMLDivElement>()
  return (
    <div className="relative">
      <div ref={ref} className="max-h-40 overflow-y-auto pr-1 pb-4">
        {children}
      </div>
      {fades.top && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-5"
          style={PANEL_TOP_FADE_STYLE}
        />
      )}
      {fades.bottom && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-8"
          style={PANEL_BOTTOM_FADE_STYLE}
        />
      )}
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
  precisePlaces?: PrecisePlace[]
  activePrecise?: string | null
  onTogglePrecise?: (place: PrecisePlace) => void
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
  /** Mobile: the search icon shows/hides the search box and the Places/Time/Collections lists. */
  onInfoToggle?: () => void
  infoOpen?: boolean
  /** Mobile: the info icon unfolds the About text under the header (instead of a popover). */
  onAboutToggle?: () => void
  aboutOpen?: boolean
  /** Mobile: extra header buttons after the icons (grid size). */
  headerSlot?: React.ReactNode
  /** Desktop expanded panel: Places/Sites, Time and Collections side by side, all open. */
  sectionColumns?: boolean
  /** "collapse": the map button is the minimize icon at the end of the row (desktop expanded panel). */
  mapToggle?: "globe" | "collapse"
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
  precisePlaces = [],
  activePrecise = null,
  onTogglePrecise,
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
  onInfoToggle,
  infoOpen,
  onAboutToggle,
  aboutOpen,
  headerSlot,
  sectionColumns,
  mapToggle = "globe",
}: InfoPanelProps) {
  // Mobile sections are an accordion: one list open at a time keeps the card short
  // enough to fit above the half-height sheet without scrolling.
  const [openSection, setOpenSection] = React.useState<"origins" | "sites" | "time" | "collections" | null>("origins")
  const sectionState = (key: "origins" | "sites" | "time" | "collections") =>
    [sectionColumns || openSection === key, (open: boolean) => setOpenSection(open ? key : null)] as const
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
  const displayName = activePrecise
    ? activePrecise
    : (activeSite && activeSite !== activeCountry)
      ? activeSite
      : (activeCountry || '')
  // A place or site with its own chip is named by the chip alone, like a collection.
  // A precise place has no filter of its own; its chip clears it.
  const precisePlace = activePrecise ? precisePlaces.find((p) => p.name === activePrecise) : undefined
  const nameIsChip = !!precisePlace || [...facetedFilters.countries, ...facetedFilters.cities]
    .some((v) => v.toLowerCase() === displayName.toLowerCase())

  // Breadcrumb segments; `offset` keeps the original index when the trail is split.
  const renderTrail = (segs: typeof breadcrumb, offset: number) => segs.map((seg, k) => {
    const i = k + offset
    const isLast = i === breadcrumb.length - 1
    return (
      <span
        key={i}
        className={`flex items-center ${isLast ? "min-w-0 overflow-hidden" : "flex-shrink-0"}`}
      >
        {k > 0 && <span className="text-black/30 mx-1 flex-shrink-0">/</span>}
        {isLast ? (
          <span
            className="text-black font-medium truncate"
            title={seg.label}
          >
            {seg.label}
          </span>
        ) : (
          <button
            className="text-black hover:underline transition-colors whitespace-nowrap flex-shrink-0"
            onClick={() => onBreadcrumbClick?.(seg.level)}
            title={seg.label}
          >
            {seg.label}
          </button>
        )}
      </span>
    )
  })
  // Phones: "Ex Situ" stays beside the icons and the drill-down path gets its own
  // line below, so a long site or collection name isn't cut to a few letters.
  const splitTrail = mobileVariant === "drill" && !sectionColumns && breadcrumb.length > 1

  return (
    <div className={`${
      mobileVariant === "summary" ? "px-4 py-0"
        : mobileVariant === "drill" ? (onInfoToggle ? "px-4 pt-1 pb-0" : "px-4 pt-1 pb-3")
        : isMobile ? "px-4 pt-0 pb-4" : "p-4 pt-2"
    } flex flex-col bg-white`}>
      {/* Mobile breadcrumb + search row — always visible */}

      {breadcrumb.length > 0 && (
        <div className="flex py-1 items-center justify-between gap-2 pb-1.5">
          <div className="flex items-center min-w-0 flex-1 overflow-hidden text-sm">
            {renderTrail(splitTrail ? breadcrumb.slice(0, 1) : breadcrumb, 0)}
          </div>
          {/* About — on phones this replaces the map's info control */}
          {mobileVariant === "drill" && onAboutToggle && (
            <Button variant="ghost" size="icon" className={`h-8 w-8 flex-shrink-0 ${aboutOpen ? "bg-gray-200 hover:bg-gray-200" : ""}`} onClick={onAboutToggle}
              title="About" aria-label="About" aria-expanded={aboutOpen}
            >
              <Info className={`w-5 h-5 ${aboutOpen ? "text-black" : "text-gray-500"}`} />
            </Button>
          )}
          {mobileVariant === "drill" && !onAboutToggle && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0 data-[state=open]:bg-gray-200" title="About" aria-label="About">
                  <Info className="w-5 h-5 text-gray-500" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 rounded-xl text-[13px] leading-normal">
                <AboutText />
              </PopoverContent>
            </Popover>
          )}
          {mobileVariant === "drill" && onMapToggle && mapToggle !== "collapse" && (
            <Button variant="ghost" size="icon" className={`h-8 w-8 flex-shrink-0 ${mapOpen ? "bg-gray-200 hover:bg-gray-200" : ""}`} onClick={onMapToggle}
              title={mapOpen ? "Hide map" : "Show map"} aria-label={mapOpen ? "Hide map" : "Show map"} aria-pressed={mapOpen}
            >
              <Globe className={`w-5 h-5 ${mapOpen ? "text-black" : "text-gray-500"}`} />
            </Button>
          )}
          {mobileVariant === "drill" && onInfoToggle && (
            <Button variant="ghost" size="icon" className={`h-8 w-8 flex-shrink-0 ${infoOpen ? "bg-gray-200 hover:bg-gray-200" : ""}`} onClick={onInfoToggle}
              title={infoOpen ? "Hide search and lists" : "Search and lists"} aria-label={infoOpen ? "Hide search and lists" : "Search and lists"} aria-pressed={infoOpen}
            >
              <Search className={`w-5 h-5 ${infoOpen ? "text-black" : "text-gray-500"}`} />
            </Button>
          )}
          {mobileVariant === "drill" && headerSlot}
          {/* Desktop expanded panel: the way back is the counterpart of the icon that
              expanded it (not the globe, which on the map means "global view"). */}
          {mobileVariant === "drill" && onMapToggle && mapToggle === "collapse" && (
            <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={onMapToggle}
              title="Minimize panel" aria-label="Minimize panel"
            >
              <IconMinimize className="w-5 h-5 text-gray-500" />
            </Button>
          )}
        </div>
      )}
      {splitTrail && (
        <div className="flex items-center min-w-0 overflow-hidden text-sm pb-1.5">
          {renderTrail(breadcrumb.slice(1), 1)}
        </div>
      )}

      {mobileVariant === "drill" && aboutOpen && (
        <div className="pt-1 pb-2 text-[13px] leading-normal">
                <AboutText />
        </div>
      )}

      {onCommandPaletteOpen && infoOpen !== false && (
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
                      <span className="ml-1">indexed artifact{totalCount !== 1 ? "s" : ""}</span>
                    </span>
                    {isLoading && <Spinner className="ml-2 h-3 w-3 inline-block" />}
                  </>
                )}
              </div>
              {displayName && !isMobile && !nameIsChip && (
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
          {isMobile && mobileVariant !== "summary" && infoOpen !== false && (
            <div
              className={`overflow-hidden transition-[max-height,opacity] ease-in-out ${
                drillSectionsVisible ? "duration-700 max-h-[1000px] opacity-100" : "duration-400 max-h-0 opacity-0"
              }`}
              // Inline, not Tailwind's grid-cols-3: globals.css has an old .grid rule
              // (auto-fill 150px columns) that overrides the utility class.
              style={sectionColumns ? { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", columnGap: 40, alignItems: "start" } : undefined}
            >
              {/* Places (global) */}
              {drillLevel === "global" && groupedOrigins.length > 0 && (
                <div>
                  <SectionHeader columns={sectionColumns} open={showOrigins} onToggle={() => setShowOrigins(!showOrigins)}>
                    Places
                    {isLoadingOrigins && <Spinner className="ml-2 h-3 w-3 inline-block" />}
                  </SectionHeader>
                  {showOrigins && (
                    <FadedAccordionList>
                        {groupedOrigins.map((origin, index) => (
                          <div key={index} className="flex justify-between cursor-pointer hover:bg-gray-200 rounded-md px-2 py-0.5"
                            onClick={() => onOriginClick?.(origin.country, origin.lat, origin.lng)}
                          >
                            <span className="truncate max-w-[70%]" title={origin.country}>{origin.country}</span>
                            <span className="ml-2 text-gray-500 text-sm">{formatCount(origin.totalCount)}</span>
                          </div>
                        ))}
                    </FadedAccordionList>
                  )}
                </div>
              )}

              {/* Sites (country) */}
              {drillLevel !== "global" && groupedSites.length > 0 && (
                <div>
                  <SectionHeader columns={sectionColumns} open={showSites} onToggle={() => setShowSites(!showSites)}>
                    Sites
                    {isLoadingSubArcs && <Spinner className="ml-2 h-3 w-3 inline-block" />}
                  </SectionHeader>
                  {showSites && (
                    <FadedAccordionList>
                        {groupedSites.map((site, index) => (
                          <React.Fragment key={index}>
                          <div
                            className={`flex justify-between cursor-pointer hover:bg-gray-200 rounded-md px-2 py-0.5 ${activeSite === site.name ? "bg-gray-300" : ""}`}
                            data-active-site={activeSite === site.name || undefined}
                            onClick={() => onToggleSite?.(site.name, site.lat, site.lng)}
                          >
                            <span className="truncate max-w-[70%]" title={site.name}>{siteRowLabel(site.name, activeCountry, siteLabels)}</span>
                            <span className="ml-2 text-gray-500 text-sm">{formatCount(site.totalCount)}</span>
                          </div>
                          {activeSite === site.name && (
                            <PrecisePlaceRows places={precisePlaces} active={activePrecise} onToggle={onTogglePrecise} />
                          )}
                          </React.Fragment>
                        ))}
                    </FadedAccordionList>
                  )}
                </div>
              )}

              {/* Time — shown at all drill levels */}
              {dateBuckets && (
                <div>
                  <SectionHeader columns={sectionColumns} open={showTime} onToggle={() => setShowTime(!showTime)}>
                    Time
                  </SectionHeader>
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
                              className={`flex justify-between cursor-pointer hover:bg-gray-200 rounded-md px-2 py-0.5 ${facetedFilters.era?.id === row.id ? "bg-gray-300" : ""}`}
                              onClick={() => onToggleEra?.(row.era)}
                            >
                              <span className="truncate max-w-[70%]" title={row.label}>{row.label}</span>
                              <span className="ml-2 text-gray-500 text-sm">{formatCount(row.count)}</span>
                            </div>
                          ))}
                    </FadedAccordionList>
                  )}
                </div>
              )}

              {/* Institutions — shown at all zoom levels */}
              {drillInstitutions.length > 0 && (
                <div>
                  <SectionHeader columns={sectionColumns} open={showCollections} onToggle={() => setShowCollections(!showCollections)}>
                    Collections
                  </SectionHeader>
                  {showCollections && (
                    <FadedAccordionList>
                        {drillInstitutions.map((inst, index) => (
                          <div key={index}
                            className={`flex justify-between cursor-pointer hover:bg-gray-200 rounded-md px-2 py-0.5 ${activeInstitution === inst.name ? "bg-gray-300" : ""}`}
                            onClick={() => onToggleInstitution?.(inst.name)}
                          >
                            <span className="truncate max-w-[70%]" title={inst.name}>{inst.name}</span>
                            <span className="ml-2 text-gray-500 text-sm">{formatCount(inst.count)}</span>
                          </div>
                        ))}
                    </FadedAccordionList>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Filter chips */}
          {(activeFilterCount > 0 || precisePlace) && mobileVariant !== "summary" && (
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
              {precisePlace && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-100 text-blue-700 text-sm">
                  {precisePlace.name}
                  <button onClick={() => onTogglePrecise?.(precisePlace)} className="hover:bg-blue-100 rounded-md p-0.5">
                    <IconClose className="w-2.5 h-2.5" />
                  </button>
                </span>
              )}
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

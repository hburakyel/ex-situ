/**
 * Ex Situ Design System — Component Specifications
 *
 * Every component documented here exists in the codebase.
 * Token references point to lib/design-system/tokens.ts.
 * Props interfaces are extracted verbatim from the source.
 *
 * Naming convention: components are indexed by their file-system name.
 */

import type { MuseumObject, MapBounds, SelectedArc } from "@/types"

// ─────────────────────────────────────────────────────────────────────────────
// SHARED TYPES (re-exported from map components)
// ─────────────────────────────────────────────────────────────────────────────

/** Container size — three-state enum used by the resizable object panel. */
export type ContainerSize = "default" | "expanded" | "minimized"

/** Faceted filter state shared between command palette, map, and panel. */
export type FacetedFilters = {
  institutions: string[]
  countries: string[]
  cities: string[]
}

/** Drill-down navigation level. */
export type DrillLevel = "global" | "country" | "objects"

/** Breadcrumb segment passed between page, map-header, and panel. */
export interface BreadcrumbSegment {
  label: string
  level: DrillLevel
}

/** Grouped origin row (country-level arc data). */
export interface GroupedOrigin {
  country: string
  totalCount: number
  institutions: string[]
  lat: number
  lng: number
}

/** Grouped site row (city-level arc data within a country). */
export interface GroupedSite {
  name: string
  totalCount: number
  institutions: string[]
  lat: number
  lng: number
}

/** Institution count row. */
export interface InstitutionItem {
  name: string
  count: number
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. MAP LAYOUT SHELL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **File:** app/map/layout.tsx
 *
 * ### Anatomy
 * ```
 * div.h-screen.flex.flex-col.bg-white.overflow-hidden
 *   main.flex-1.min-h-0.relative
 *     {children}
 * ```
 *
 * ### Tokens Used
 * - `colors.bgBase` (bg-white)
 *
 * ### States
 * - None. Static shell.
 *
 * ### Accessibility
 * - `<main>` landmark element.
 */
export interface MapLayoutProps {
  children: React.ReactNode
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. MAP VIEW
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **File:** components/map/map-view.tsx (1 075 lines)
 *
 * Full-bleed map with deck.gl overlay (ArcLayer + ScatterplotLayer),
 * a floating header panel (desktop only), and hover/click tooltips.
 *
 * ### Anatomy (high-level)
 * ```
 * div.relative.h-full.w-full                          ← container
 *   div.h-full.w-full [ref=mapContainer]               ← Mapbox/MapLibre canvas
 *   div.absolute.inset-0 (loading overlay)              ← conditional
 *   {children}
 *   div.absolute (arc hover tooltip)                    ← conditional
 *   div.absolute (wiki hover tooltip)                   ← conditional
 *   div.absolute (wiki click popup)                     ← conditional
 *   div.absolute.top-10.left-10 (HEADER PANEL)          ← desktop only
 *     div.bg-white.rounded-2xl.shadow-lg
 *       Title row ("Ex Situ" + panel toggle + search)
 *       Breadcrumb subheader                            ← conditional
 *       Artifact count                                  ← when panel closed
 *       SectionList: Places / Sites / Collections       ← drill-down lists
 * ```
 *
 * ### Sub-Components (inline)
 * - **ArcHoverTooltip** — absolute div, pointer-events-none
 * - **WikiHoverTooltip** — absolute div, pointer-events-none
 * - **WikiClickPopup** — absolute div with image + title + link
 * - **HeaderPanel** — contains Breadcrumb, SectionList (Places/Sites/Collections)
 * - **GlobeViewControl** — custom Mapbox control class (globe icon button)
 *
 * ### Tokens Used
 * - `colors.bgBase` (bg-white)
 * - `colors.bgOverlay` (bg-background/50)
 * - `colors.bgError` (bg-red-50)
 * - `colors.bgHover` (hover:bg-gray-50)
 * - `colors.bgSelectedBlue` (bg-blue-50)
 * - `colors.bgSelectedAmber` (bg-amber-50)
 * - `colors.textPrimary` (text-black)
 * - `colors.textSecondary` (text-gray-400)
 * - `colors.textPanelMuted` (.panel-text-muted)
 * - `colors.textMuted` (text-muted-foreground)
 * - `colors.textIndigo` (text-indigo-500, text-indigo-600)
 * - `colors.textError` (text-red-500)
 * - `colors.borderFocusBlue` (ring-1 ring-blue-200)
 * - `colors.borderRingAmber` (ring-1 ring-amber-200)
 * - `radii.panel` (rounded-2xl)
 * - `radii.tile` (rounded-[10px] on tooltips)
 * - `shadows.lg` (shadow-lg)
 * - `shadows.xl` (shadow-xl on wiki popup)
 * - `spacing.10` (top-10, left-10)
 * - `layout.headerPanelWidth` (sm:w-80)
 * - `zIndex.panel` (z-20)
 * - `zIndex.tooltip` (z-50)
 * - `motion.fast` (transition-colors)
 * - `motion.arc` (transitions: { duration: 300 })
 * - `iconSizes.md` (w-4 h-4)
 *
 * ### States
 * - **default** — map loaded, arcs visible
 * - **loading** — spinner overlay (Loader2 animate-spin)
 * - **error** — full-screen red-50 background with ExclamationTriangleIcon + Reload button
 * - **hoveredArc** — tooltip follows cursor
 * - **hoveredDoc** — Wikipedia tooltip follows cursor
 * - **selectedDoc** — Wikipedia popup at click position
 * - **drillLevel:global** — Places section shown
 * - **drillLevel:country** — Sites + Collections sections shown
 * - **selectedArc** — arc highlighted with wider stroke + blue color
 *
 * ### Accessibility
 * - `aria-label="Global View"` on globe control button
 * - `title="Toggle objects panel"`, `title="Search (⌘K)"` on icon buttons
 */
export interface MapViewProps {
  initialViewState: { longitude: number; latitude: number; zoom: number; pitch?: number; bearing?: number; name?: string }
  onBoundsChange: (bounds: MapBounds) => void
  objects: MuseumObject[]
  allObjects: MuseumObject[]
  onError?: (error: string) => void
  totalCount: number
  onToggleView: () => void
  onExpandView: () => void
  viewMode: "grid" | "list"
  containerSize: ContainerSize
  locationName?: string
  onDownloadCSV?: () => void
  isObjectContainerVisible: boolean
  toggleObjectContainerVisibility: () => void
  setObjects: (objects: MuseumObject[]) => void
  setTotalCount: (count: number) => void
  initialLongitude?: number
  initialLatitude?: number
  initialZoom?: number
  children?: React.ReactNode
  showControls?: boolean
  facetedFilters?: FacetedFilters
  onFacetedFiltersChange?: (filters: FacetedFilters) => void
  selectedArc?: SelectedArc | null
  onSelectArc?: (arc: SelectedArc | null) => void
  onZoomChange?: (zoom: number) => void
  onArcCardsChange?: (arcCards: any[]) => void
  onStatsItemClick?: (type: "country" | "city" | "institution", name: string, centroid?: { lat: number; lng: number }) => void
  drillLevel?: DrillLevel
  breadcrumb?: BreadcrumbSegment[]
  onBreadcrumbClick?: (level: DrillLevel) => void
  groupedOrigins?: GroupedOrigin[]
  sitesByCountry?: Map<string, Set<string>>
  isLoadingOrigins?: boolean
  onOriginClick?: (country: string, lat?: number, lng?: number) => void
  groupedSites?: GroupedSite[]
  drillInstitutions?: InstitutionItem[]
  activeSite?: string | null
  activeInstitution?: string | null
  onToggleSite?: (site: string, lat?: number, lng?: number) => void
  onToggleInstitution?: (inst: string) => void
  isLoadingSubArcs?: boolean
  onCommandPaletteOpen?: () => void
  onWikiDocumentsChange?: (docs: any[]) => void
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. OBJECT PANEL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **File:** components/map/object-panel.tsx (712 lines)
 *
 * Floating panel on the right (desktop) or bottom-sheet (mobile).
 * Contains ObjectGrid, related objects, wiki link cards, and ImageGallery.
 *
 * ### Anatomy
 * ```
 * div.fixed.bg-white.rounded-2xl.shadow-lg.z-20.overflow-hidden
 *   div.h-full.flex.flex-col
 *     div.sticky.top-0.z-30.p-3.bg-white             ← header
 *       [Mobile]: Title row + Breadcrumb + Artifact count
 *       [Desktop]: Artifact count + Download + Expand
 *       FilterChips                                    ← conditional
 *     [Mobile drill-down sections]: Places / Sites / Collections
 *     div.flex-1.overflow-auto.bg-white               ← content
 *       ObjectGrid
 *       RelatedFromRegion divider + ObjectGrid         ← conditional
 *       Links divider + LinkCardGrid                   ← conditional
 *   ImageGallery                                       ← conditional overlay
 * ```
 *
 * ### Tokens Used
 * - `colors.bgBase` (bg-white)
 * - `colors.bgHover` (hover:bg-gray-50)
 * - `colors.bgSelectedBlue` (bg-blue-50)
 * - `colors.bgSelectedAmber` (bg-amber-50)
 * - `colors.bgChipOrange` (bg-orange-50)
 * - `colors.bgLinkCardHover` (hover:bg-[#f5f5f5])
 * - `colors.textPrimary` (text-black)
 * - `colors.textSecondary` (text-gray-400)
 * - `colors.textTertiary` (text-gray-700)
 * - `colors.textPanelMuted` (.panel-text-muted)
 * - `colors.textChipBlue` (text-blue-700)
 * - `colors.textChipOrange` (text-orange-700)
 * - `colors.textBreadcrumbSeparator` (text-black/40)
 * - `colors.textBreadcrumbInactive` (text-black/60)
 * - `radii.panel` (rounded-2xl)
 * - `radii.tile` (rounded-[10px])
 * - `shadows.lg` (shadow-lg)
 * - `spacing.3` (p-3, gap-3)
 * - `spacing.10` (top-10, right-10, bottom-10)
 * - `layout.panelWidthDefault` (width: "40%")
 * - `layout.panelWidthExpanded` (width: "calc(100% - 5rem)")
 * - `layout.mobileSheetDefault` (height: "40%")
 * - `zIndex.panel` (z-20)
 * - `zIndex.panelHeader` (z-30)
 * - `motion.fast` (transition-colors)
 * - `iconSizes.md` (h-4 w-4)
 *
 * ### States
 * - **default** — 40% width panel, right-side, images visible
 * - **expanded** — near-full-screen
 * - **minimized** — mobile only, collapsed to pill with title
 * - **loading** — Spinner inline next to artifact count
 * - **galleryOpen** — ImageGallery overlays the panel
 * - **hasFilters** — filter chips row visible
 *
 * ### Accessibility
 * - `title="Restore panel"` / `title="Minimize panel"` on toggle
 * - `title="Search"` on search icon button
 */
export interface ObjectPanelProps {
  objects: MuseumObject[]
  onLoadMore: () => void
  hasMore: boolean
  totalCount: number
  isLoading: boolean
  onObjectClick: (longitude: number, latitude: number) => void
  isMobile?: boolean
  viewMode: "grid" | "list"
  setViewMode: (mode: "grid" | "list") => void
  containerSize: ContainerSize
  setContainerSize: (size: ContainerSize) => void
  drillLevel?: DrillLevel
  breadcrumb?: BreadcrumbSegment[]
  onBreadcrumbClick?: (level: DrillLevel) => void
  groupedOrigins?: GroupedOrigin[]
  sitesByCountry?: Map<string, Set<string>>
  isLoadingOrigins?: boolean
  onOriginClick?: (country: string, lat?: number, lng?: number) => void
  groupedSites?: GroupedSite[]
  drillInstitutions?: InstitutionItem[]
  activeSite?: string | null
  activeInstitution?: string | null
  onToggleSite?: (site: string, lat?: number, lng?: number) => void
  onToggleInstitution?: (inst: string) => void
  isLoadingSubArcs?: boolean
  locationName?: string
  allObjects?: MuseumObject[]
  facetedFilters?: FacetedFilters
  onFacetedFiltersChange?: (filters: FacetedFilters) => void
  onCommandPaletteOpen?: () => void
  linkObjects?: MuseumObject[]
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. COMMAND PALETTE (⌘K)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **File:** components/map/command-palette.tsx (698 lines)
 *
 * Full-screen modal search interface with accordion sections.
 * Launched via ⌘K keyboard shortcut.
 *
 * ### Anatomy
 * ```
 * div.fixed.inset-0.z-50.bg-black/25.backdrop-blur-[2px]   ← backdrop
 * div.fixed.inset-0.z-50.flex.items-start.justify-center.pt-[15vh]
 *   div.w-full.max-w-lg.bg-white.rounded-[20px].shadow-2xl.border
 *     SearchInput row (Search icon + input + Spinner + clear + ESC kbd)
 *     FilterChips bar                                         ← conditional
 *     ConnectionFinder (violet section)                       ← conditional
 *     div.max-h-[50vh].overflow-y-auto                        ← list container
 *       SectionHeader "Places"        + PlaceRows
 *       SectionHeader "Sites"         + SiteRows
 *       SectionHeader "Collections"   + CollectionRows
 * ```
 *
 * ### Sub-Components (inline)
 * - **SectionHeader** — accordion toggle with label + count + chevron
 *   ```
 *   button.w-full.flex.items-center.gap-2.px-4.py-2
 *     ChevronRight (rotates 90° when open)
 *     span.text-sm.font-medium.text-gray-500   ← label
 *     span.text-sm.text-gray-400.tabular-nums  ← count
 *   ```
 *
 * ### Tokens Used
 * - `colors.bgBase` (bg-white)
 * - `colors.bgScrim` (bg-black/25)
 * - `colors.bgHover` (hover:bg-gray-50, bg-gray-50)
 * - `colors.bgSelectedBlue` (bg-blue-50)
 * - `colors.bgChipOrange` (bg-orange-50)
 * - `colors.bgSurfaceSubtle` (bg-gray-50/50)
 * - `colors.bgViolet` (bg-violet-50/50)
 * - `colors.bgPathCountry` / `bgPathCity` / `bgPathInstitution` / `bgPathDefault`
 * - `colors.textSecondary` (text-gray-400)
 * - `colors.textTertiary` (text-gray-500)
 * - `colors.textSelectedBlue` (text-blue-800)
 * - `colors.textSelectedOrange` (text-orange-800)
 * - `colors.textViolet` (text-violet-600)
 * - `colors.borderSubtle` (border-gray-100)
 * - `colors.borderLight` (border-gray-200)
 * - `radii.palette` (rounded-[20px])
 * - `radii.md` (rounded-md)
 * - `radii.full` (rounded-full)
 * - `shadows["2xl"]` (shadow-2xl)
 * - `backdrop.scrim` (backdrop-blur-[2px])
 * - `spacing.4` (px-4)
 * - `layout.commandPaletteMaxWidth` (max-w-lg)
 * - `layout.commandPaletteTopOffset` (pt-[15vh])
 * - `layout.commandPaletteMaxHeight` (max-h-[50vh])
 * - `zIndex.commandPalette` (z-50)
 * - `motion.fast` (transition-colors, transition-transform)
 * - `iconSizes.md` (w-4 h-4)
 * - `iconSizes.searchBar` (w-[18px] h-[18px])
 *
 * ### States
 * - **closed** — renders null
 * - **open:empty** — shows accordion headers, no query
 * - **open:typing** — "Type at least 2 characters…" hint
 * - **open:searching** — Spinner in search bar
 * - **open:results** — matching sections auto-expand
 * - **open:noResults** — "No results for …" message
 * - **keyboard:selected** — row highlighted via bg-gray-50
 * - **pathMode** — connection finder section visible
 *
 * ### Accessibility
 * - Escape key closes palette
 * - ArrowUp/ArrowDown for keyboard navigation
 * - Enter to select
 * - `<kbd>ESC</kbd>` visual hint
 */
export interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  handlers: CommandPaletteHandlers
  facetedFilters: FacetedFilters
  onFacetedFiltersChange: (filters: FacetedFilters) => void
}

export interface CommandPaletteHandlers {
  onNavigatePlace?: (longitude: number, latitude: number, name: string) => void
  onNavigateSite?: (country: string, site: string, lat: number, lng: number) => void
  onOriginClick?: (country: string, lat?: number, lng?: number) => void
  onToggleSite?: (site: string, lat?: number, lng?: number) => void
  onToggleInstitution?: (inst: string) => void
  onPathResult?: (path: PathStep[]) => void
  onExplore?: () => void
}

export interface PathStep {
  nodeKey: string
  type?: string
  label?: string
  lat?: number | null
  lng?: number | null
  objectCount?: number
  connectionCount?: number
  imgUrl?: string | null
  wikidata?: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. OBJECT GRID
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **File:** components/object-grid.tsx
 *
 * Virtualized image grid displaying museum objects. Used inside
 * ObjectPanel (primary) and "Related from region" section.
 *
 * ### Anatomy
 * ```
 * div.h-full.overflow-auto.px-4.pt-4.pb-4.bg-white     ← scroll container
 *   div.grid.{gridClass}.gap-3                           ← responsive grid
 *     div.group.relative.cursor-pointer.bg-white.p-1.h-44
 *       div.relative.inline-flex.overflow-hidden.bg-white.rounded-[10px]
 *         Badge (geocoding_status)                       ← conditional
 *         Badge (review_status)                          ← conditional
 *         BlurhashImage | "Image unavailable" placeholder
 *   div (infinite-scroll sentinel)                       ← conditional
 *     Spinner + "Loading more artifacts…"
 *   div "{n} of {total} artifacts"                       ← end of list
 * ```
 *
 * ### Tokens Used
 * - `colors.bgBase` (bg-white)
 * - `colors.textTertiary` (text-gray-500)
 * - `colors.textSecondary` (text-gray-400)
 * - `colors.textFaint` (text-gray-300)
 * - `colors.borderRingBlue` (ring-2 ring-blue-500)
 * - `radii.tile` (rounded-[10px])
 * - `spacing.3` (gap-3)
 * - `spacing.4` (px-4, pt-4, pb-4)
 * - `layout.gridTileHeight` (h-44)
 * - `layout.gridImageMaxHeight` (max-h-36)
 * - `motion.default` (transition-all duration-200)
 * - `typography.scale.caption` (text-[10px])
 *
 * ### States
 * - **loading:initial** — returns null (no skeleton)
 * - **empty** — "No objects found in this area" message
 * - **default** — image tiles in responsive grid
 * - **hover** — ring-2 ring-blue-500 on tile
 * - **selected** — ring-2 ring-blue-500 (selectedImageId)
 * - **imageError** — fallback text (inventory number or "Image unavailable")
 * - **infiniteScroll** — sentinel + spinner at bottom
 * - **complete** — "{n} of {total} artifacts" footer
 */
export interface ObjectGridProps {
  objects: MuseumObject[]
  onLoadMore: () => void
  hasMore: boolean
  totalCount: number
  isLoading: boolean
  onObjectClick?: (longitude: number, latitude: number, index: number) => void
  isFullscreen?: boolean
  panelSize?: number
  mobileColumns?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. IMAGE GALLERY OVERLAY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **File:** components/image-gallery.tsx
 *
 * Full-panel image viewer with left/right navigation. Renders inside
 * ObjectPanel at z-50.
 *
 * ### Anatomy
 * ```
 * div (position: absolute, inset: 0, bg: white, zIndex: 50)
 *   Header: index/total + inventory + nav buttons (prev/next/info/source/close)
 *   Subheader: From / To / Collection metadata
 *   Main image container (flex, centered)
 *     BlurhashImage | "No image available" placeholder
 * ```
 *
 * ### Tokens Used
 * - `colors.bgBase` (backgroundColor: "white")
 * - `colors.textPrimary` (color: "black")
 * - `colors.textPanelMuted` (var(--panel-text-muted, #666))
 * - `colors.textTertiary` (#999, #666)
 * - `shadows.lg` (shadow-lg on container)
 * - `zIndex.gallery` (zIndex: 50)
 * - `iconSizes.md` (h-4 w-4)
 *
 * ### States
 * - **loading** — Spinner centered (Radix Spinner size="3")
 * - **default** — image displayed
 * - **imageError** — fallback text
 * - **noObjects** — returns null
 *
 * ### Accessibility
 * - Escape key closes gallery
 * - ArrowLeft/ArrowRight for navigation
 * - Link to object detail page (`/artifact/{id}`)
 */
export interface ImageGalleryProps {
  objects: MuseumObject[]
  initialIndex: number
  onClose: () => void
  isFullscreen?: boolean
  isMobile?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. BLURHASH IMAGE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **File:** components/blurhash-image.tsx
 *
 * Progressive image loader: fetches a blurhash placeholder via API,
 * decodes it to a canvas data URL, then fades in the real image.
 *
 * ### Anatomy
 * ```
 * div.relative.overflow-hidden.bg-white [backgroundImage: blurhash data URL]
 *   img [opacity: 0 → 1 via transition-opacity duration-500 ease-out]
 * ```
 *
 * ### Tokens Used
 * - `colors.bgBase` (bg-white)
 * - `motion.imageFade` (transition-opacity duration-500 ease-out)
 *
 * ### States
 * - **loading** — blurhash background visible, img opacity-0
 * - **loaded** — img opacity-100
 * - **error** — calls onError callback; can use fallbackSrc
 *
 * ### Accessibility
 * - `alt` prop passed through to `<img>`
 * - `loading` attribute ("lazy" | "eager")
 * - `decoding="async"` for non-blocking decode
 */
export interface BlurhashImageProps {
  src: string
  alt: string
  className?: string
  imgClassName?: string
  wrapperStyle?: React.CSSProperties
  imgStyle?: React.CSSProperties
  loading?: "lazy" | "eager"
  onLoad?: () => void
  onError?: () => void
  fallbackSrc?: string
  decodeSize?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. FILTER CHIP (inline, not a standalone component file)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Defined inline in:** command-palette.tsx, object-panel.tsx
 *
 * Chip showing an active filter value with an X button to remove.
 *
 * ### Anatomy
 * ```
 * span.inline-flex.items-center.gap-1.px-2.py-0.5.rounded-md.text-[10px|sm]
 *   {label}
 *   button.hover:bg-{color}-100.rounded-md.p-0.5
 *     X icon (w-2.5 h-2.5)
 * ```
 *
 * ### Variants
 * - **country/city** — bg-blue-50 text-blue-700
 * - **institution** — bg-orange-50 text-orange-700
 *
 * ### Tokens Used
 * - `colors.bgSelectedBlue` / `colors.bgChipOrange`
 * - `colors.textChipBlue` / `colors.textChipOrange`
 * - `colors.stateHoverBlue` / `colors.stateHoverOrange`
 * - `radii.md` (rounded-md)
 * - `iconSizes.xs` (w-2.5 h-2.5)
 * - `typography.scale.caption` (text-[10px] in command palette)
 * - `typography.scale.bodyMd` (text-sm in panel)
 *
 * INCONSISTENCY: Command palette uses text-[10px], panel uses text-sm for chips.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 9. BREADCRUMB (inline)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Defined inline in:** map-view.tsx (desktop), object-panel.tsx (mobile)
 *
 * Horizontal breadcrumb trail: "Ex situ / Turkey / Istanbul"
 *
 * ### Anatomy
 * ```
 * div.flex.items-center.gap-1.flex-wrap.px-2.pt-2.pb-1.5.text-sm
 *   span.flex.items-center.gap-1  (per segment)
 *     span "/" separator (text-black text-xs) — desktop
 *     span "/" separator (text-black/40 text-xs) — mobile
 *     button (text-black hover:underline) — clickable ancestor
 *     span (text-black font-medium) — current
 * ```
 *
 * ### Tokens Used
 * - `colors.textPrimary` (text-black)
 * - `colors.textBreadcrumbSeparator` (text-black/40 — mobile)
 * - `colors.textBreadcrumbInactive` (text-black/60 — mobile)
 * - `typography.scale.bodyMd` (text-sm)
 *
 * INCONSISTENCY: Desktop uses `text-black` for separators and ancestor links;
 * mobile uses `text-black/40` separators and `text-black/60` ancestor links.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 10. SECTION HEADER (inline sub-component)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Defined inline in:** command-palette.tsx (extracted as local `SectionHeader`),
 * map-view.tsx, object-panel.tsx
 *
 * Collapsible section toggle for Places / Sites / Collections lists.
 *
 * ### Anatomy — Command Palette variant
 * ```
 * button.w-full.flex.items-center.gap-2.px-4.py-2.hover:bg-gray-50
 *   ChevronRight (w-4 h-4, rotate-90 when open)
 *   span.text-sm.font-medium.text-gray-500  ← label
 *   span.text-sm.text-gray-400.tabular-nums  ← count
 * ```
 *
 * ### Anatomy — Map Header / Panel variant
 * ```
 * div.flex.items-center.justify-between
 *   span.panel-text-muted  ← label + optional Spinner
 *   Button variant="ghost" size="sm" (ChevronUp / ChevronDown)
 * ```
 *
 * ### Tokens Used
 * - `colors.bgHover` (hover:bg-gray-50)
 * - `colors.textTertiary` (text-gray-500)
 * - `colors.textSecondary` (text-gray-400)
 * - `colors.textPanelMuted` (.panel-text-muted)
 * - `iconSizes.md` (w-4 h-4)
 * - `motion.fast` (transition-colors, transition-transform)
 *
 * ### States
 * - **collapsed** — chevron pointing right
 * - **expanded** — chevron rotated 90°
 * - **dimmed** — opacity-35 when search yields no results for this section
 */

// ─────────────────────────────────────────────────────────────────────────────
// 11. COUNT BADGE / PILL (inline)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Defined inline in:** command-palette.tsx, map-view.tsx, object-panel.tsx
 *
 * Numeric count displayed alongside list items.
 *
 * ### Anatomy
 * ```
 * span.text-sm.text-gray-400.tabular-nums.flex-shrink-0
 *   {count.toLocaleString()}
 * ```
 *
 * ### Tokens Used
 * - `colors.textSecondary` (text-gray-400)
 * - `typography.scale.bodyMd` (text-sm)
 *
 * tabular-nums ensures counts align vertically.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 12. BUTTON VARIANTS (from shadcn/ui)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **File:** components/ui/button.tsx (shadcn/ui)
 *
 * Variants used in the app:
 * - `variant="ghost"` — transparent bg, hover:bg-accent
 * - `variant="outline"` — border + bg-background, hover:bg-accent
 * - `size="icon"` — h-10 w-10 (but overridden to h-6 w-6 or h-8 w-8 inline)
 * - `size="sm"` — h-9 rounded-md px-3
 *
 * @source map-view.tsx (Button variant="ghost" size="icon" className="h-6 w-6")
 * @source object-panel.tsx (Button variant="ghost" size="icon" className="h-6 w-6")
 * @source image-gallery.tsx (Button variant="ghost" size="icon" className="h-8 w-8")
 * @source app/map/page.tsx (Button size="sm" variant="outline")
 */

// ─────────────────────────────────────────────────────────────────────────────
// 13. ICON BUTTON (inline pattern)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Pattern used across the app:**
 * ```tsx
 * <Button variant="ghost" size="icon" className="h-6 w-6">
 *   <IconComponent className="w-4 h-4" />
 * </Button>
 * ```
 * OR for panel-toggle with custom SVG:
 * ```tsx
 * <button className="flex items-center justify-center w-6 h-6 rounded-md hover:bg-gray-100 transition-colors">
 *   <svg width="18" height="18" …/>
 * </button>
 * ```
 *
 * ### Tokens Used
 * - `colors.bgHover` (hover:bg-gray-100)
 * - `radii.md` (rounded-md)
 * - `iconSizes.md` (w-4 h-4)
 * - `iconSizes.panelToggle` (width="18" height="18")
 * - `motion.fast` (transition-colors)
 *
 * Consistent size: 24px (h-6 w-6) for header actions, 32px (h-8 w-8) for gallery nav.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 14. DIVIDER / SEPARATOR (inline)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Defined inline in:** object-panel.tsx
 *
 * Used to separate "Related from region" and "Links" sections.
 *
 * ### Anatomy
 * ```
 * div.flex.items-center.gap-3.py-2
 *   div.flex-1.h-px.bg-gray-200         ← left line
 *   span.text-sm.text-gray-400.uppercase.tracking-wider  ← label
 *   div.flex-1.h-px.bg-gray-200         ← right line
 * ```
 *
 * ### Tokens Used
 * - `colors.borderLight` (bg-gray-200)
 * - `colors.textSecondary` (text-gray-400)
 * - `typography.scale.overline` (uppercase, tracking-wider)
 */

// ─────────────────────────────────────────────────────────────────────────────
// 15. CSV DOWNLOAD BUTTON (inline)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Defined inline in:** object-panel.tsx
 *
 * Ghost icon button that triggers CSV export.
 *
 * ### Anatomy
 * ```
 * Button variant="ghost" size="icon" className="h-6 w-6"
 *   Download icon (h-4 w-4)
 * ```
 *
 * Only visible when `objects.length > 0`.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 16. SEARCH INPUT (inside Command Palette)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Defined inline in:** command-palette.tsx
 *
 * ### Anatomy
 * ```
 * div.flex.items-center.gap-2.px-4.py-3.border-b.border-gray-100
 *   Search icon (w-[18px] h-[18px] text-gray-400)
 *   input.flex-1.text-sm.bg-transparent.outline-none.placeholder:text-gray-400
 *   Spinner (conditional)
 *   button.p-0.5.hover:bg-gray-100.rounded-md (X clear, conditional)
 *   kbd.hidden.sm:inline-flex.h-5.items-center.rounded-md.border.bg-gray-50.px-1.5.text-[10px].text-gray-400
 * ```
 *
 * ### Tokens Used
 * - `colors.textSecondary` (text-gray-400, placeholder:text-gray-400)
 * - `colors.bgHover` (hover:bg-gray-100)
 * - `colors.borderSubtle` (border-gray-100)
 * - `colors.bgSurfaceSubtle` (bg-gray-50 on kbd)
 * - `radii.md` (rounded-md)
 * - `iconSizes.searchBar` (w-[18px] h-[18px])
 * - `iconSizes.sm` (w-3.5 h-3.5)
 * - `typography.scale.caption` (text-[10px] on kbd)
 * - `typography.scale.bodyMd` (text-sm on input)
 */

// ─────────────────────────────────────────────────────────────────────────────
// 17. SPINNER (wrapper)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **File:** components/ui/spinner.tsx
 *
 * Thin wrapper around `@radix-ui/themes` Spinner.
 *
 * ### Anatomy
 * ```
 * span.{className}
 *   RadixSpinner size={size ?? "1"}
 * ```
 *
 * ### Usage
 * - Inline with text: `<Spinner className="ml-2 h-3 w-3 inline-block" />`
 * - Centered loading: `<Loader2 className="h-8 w-8 animate-spin text-primary" />`
 *   (Loader2 from lucide-react, not Spinner — used on map loading overlay)
 */
export interface SpinnerProps {
  className?: string
  size?: "1" | "2" | "3"
}

// ─────────────────────────────────────────────────────────────────────────────
// 18. MAP CONTROLS (native Mapbox/MapLibre + custom)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Defined in:** map-view.tsx (GlobeViewControl class), app/globals.css
 *
 * ### Controls rendered
 * 1. NavigationControl (zoom in/out) — built-in, bottom-left
 * 2. GlobeViewControl (custom) — globe icon, bottom-left
 *
 * ### Tokens Used (CSS overrides)
 * - `colors.bgBase` (background-color: white)
 * - `colors.bgHover` (hover: rgba(0,0,0,0.05))
 * - `colors.borderMapControl` (border: 1px solid rgba(0,0,0,0.1))
 * - `radii.control` (border-radius: 6px)
 * - `shadows.control` (box-shadow: 0 2px 6px rgba(0,0,0,0.1))
 * - `iconSizes.mapControl` (svg 15px)
 * - `iconSizes.mapControlButton` (button 28px)
 * - `layout.mapControlInset` (margin: 0 0 40px 40px)
 */

// ─────────────────────────────────────────────────────────────────────────────
// 19. LINK CARD (inline — Wikipedia card in object grid)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Defined inline in:** object-panel.tsx
 *
 * ### Anatomy
 * ```
 * div.relative.cursor-pointer.bg-white.rounded-[10px].border.border-gray-100.p-3.h-44
 *   span "↗" (top-left arrow)
 *   div.flex-1.flex.items-center.justify-center  ← image or title
 *   div.flex.items-end.justify-between
 *     span.text-[9px].text-gray-400 "Wikipedia"
 *     span.text-[9px].text-gray-400 {place_name}
 * ```
 *
 * ### Tokens Used
 * - `colors.bgBase` (bg-white)
 * - `colors.bgLinkCardHover` (hover:bg-[#f5f5f5])
 * - `colors.textPrimary` (text-[#111])
 * - `colors.textSecondary` (text-gray-400)
 * - `colors.borderSubtle` (border-gray-100)
 * - `radii.tile` (rounded-[10px])
 * - `layout.linkCardHeight` (h-44)
 * - `typography.scale.micro` (text-[9px])
 */

// ─────────────────────────────────────────────────────────────────────────────
// 20. FACETED FILTER (Popover)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **File:** components/faceted-filter.tsx
 *
 * Map-control-style icon button that opens a Popover with multi-select
 * checkbox lists for Collection, Country, and City.
 *
 * NOTE: This component is NOT directly used in map pages (the map page uses
 * the command-palette for filtering instead), but it exists in the codebase
 * and shares the FacetedFilters type.
 *
 * ### Anatomy
 * ```
 * Popover
 *   PopoverTrigger: button.mapboxgl-ctrl-icon
 *     MixerHorizontalIcon
 *     Badge (active count) — conditional
 *   PopoverContent.w-[320px].bg-white/95.backdrop-blur-md.shadow-lg
 *     Header: "FILTER" + "Clear all" button
 *     Sections: Collection / Country / City
 *       SectionHeader (expandable)
 *       Search input (for large lists)
 *       Checkbox list
 *       Collapsed chip preview
 *     Footer: "{n} objects match your filters"
 * ```
 *
 * ### Tokens Used
 * - `colors.bgBase` (bg-white/95)
 * - `backdrop.popover` (backdrop-blur-md)
 * - `shadows.lg` (shadow-lg)
 * - `zIndex.dropdown` (z-[1000])
 */
export interface FacetedFilterProps {
  filters: FacetedFilters
  onFiltersChange: (filters: FacetedFilters) => void
}

// ─────────────────────────────────────────────────────────────────────────────
// 21. BADGE (from shadcn/ui)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **File:** components/ui/badge.tsx (shadcn/ui)
 *
 * Used via ObjectGrid for geocoding_status and review_status badges.
 *
 * ### Variants used
 * - `"destructive"` — geocoding_status === "disputed"
 * - `"secondary"` — geocoding_status === "ok", review_status === "verified"
 * - `"default"` — geocoding_status === "ambiguous"
 * - `"outline"` — review_status === "pending"
 *
 * ### Positioning
 * ```
 * Badge className="absolute top-2 left-2 z-10 capitalize"   ← geocoding
 * Badge className="absolute top-2 right-2 z-10 capitalize"  ← review
 * ```
 */

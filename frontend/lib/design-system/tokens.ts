/**
 * Ex Situ Design System — Foundational Tokens
 *
 * Extracted from the codebase (components/map/*, app/map/*,
 * app/globals.css, styles/globals.css, tailwind.config.js).
 *
 * Every value is annotated with the source file(s) where it was found.
 * "(single-use)" marks values that appear in only one location.
 *
 * ⚠  INCONSISTENCIES are flagged inline with "INCONSISTENCY:" comments —
 *    they are documented, not fixed.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. COLOR SYSTEM
// ─────────────────────────────────────────────────────────────────────────────

export const colors = {
  /* ── Backgrounds ──────────────────────────────────────────────────────── */

  /** Pure white — primary surface everywhere.
   *  @source app/globals.css (:root --background: 0 0% 100%)
   *  @source object-panel.tsx (bg-white)
   *  @source map-view.tsx (bg-white)
   *  @source command-palette.tsx (bg-white)
   *  @source object-grid.tsx (bg-white)
   *  @source image-gallery.tsx (backgroundColor: "white")
   *  @source app/map/layout.tsx (bg-white)
   */
  bgBase: "#ffffff",

  /** Loading overlay — semi-transparent background surface.
   *  @source map-view.tsx (bg-background/50)
   */
  bgOverlay: "hsla(0, 0%, 100%, 0.5)",

  /** Command-palette backdrop.
   *  @source command-palette.tsx (bg-black/25 backdrop-blur-[2px])
   */
  bgScrim: "rgba(0, 0, 0, 0.25)",

  /** Image-gallery overlay (currently commented out in code but defined in CSS).
   *  @source app/globals.css (.image-gallery-overlay background-color: rgba(0,0,0,0.7))
   */
  bgGalleryOverlay: "rgba(0, 0, 0, 0.7)",

  /** Resizable panel custom variable.
   *  @source app/globals.css (.resizable-panel background-color: rgba(229,229,229,0.9))
   *  (single-use)
   */
  bgPanelBackdrop: "rgba(229, 229, 229, 0.9)",

  /** Subtle gray surface for filter-chip bar.
   *  @source command-palette.tsx (bg-gray-50/50)
   */
  bgSurfaceSubtle: "rgba(249, 250, 251, 0.5)",

  /** Map error state background. (single-use)
   *  @source map-view.tsx (bg-red-50)
   */
  bgError: "#fef2f2",

  /** Hover state on list rows.
   *  @source map-view.tsx (hover:bg-gray-50)
   *  @source command-palette.tsx (hover:bg-gray-50)
   *  @source object-panel.tsx (hover:bg-gray-50)
   */
  bgHover: "#f9fafb",

  /** Selected / active origin row — blue.
   *  @source map-view.tsx (bg-blue-50)
   *  @source command-palette.tsx (bg-blue-50)
   *  @source object-panel.tsx (bg-blue-50)
   */
  bgSelectedBlue: "#eff6ff",

  /** Selected / active institution row — amber.
   *  @source map-view.tsx (bg-amber-50)
   *  @source object-panel.tsx (bg-amber-50)
   */
  bgSelectedAmber: "#fffbeb",

  /** Collection filter chips — orange.
   *  @source command-palette.tsx (bg-orange-50)
   *  @source object-panel.tsx (bg-orange-50)
   */
  bgChipOrange: "#fff7ed",

  /** Hover on link cards. (single-use)
   *  @source object-panel.tsx (hover:bg-[#f5f5f5])
   */
  bgLinkCardHover: "#f5f5f5",

  /** Connection-finder section background. (single-use)
   *  @source command-palette.tsx (bg-violet-50/50)
   */
  bgViolet: "rgba(245, 243, 255, 0.5)",

  /** Path-step chip backgrounds — per node type. (single-use each)
   *  @source command-palette.tsx
   */
  bgPathCountry: "#dbeafe",    // bg-blue-100
  bgPathCity: "#d1fae5",       // bg-emerald-100
  bgPathInstitution: "#fef3c7", // bg-amber-100
  bgPathDefault: "#f3f4f6",    // bg-gray-100

  /* ── Text Colors ──────────────────────────────────────────────────────── */

  /** Primary text — pure black. Forced in globals.css for all elements.
   *  @source app/globals.css (* { color: black })
   *  @source map-view.tsx (text-black)
   *  @source object-panel.tsx (text-black)
   */
  textPrimary: "#000000",

  /** Body text — via CSS custom-property --foreground.
   *  @source app/globals.css --foreground: 222.2 84% 4.9%  →  hsl(222.2, 84%, 4.9%)
   *  INCONSISTENCY: styles/globals.css uses --foreground: 0 0% 3.9%  →  hsl(0, 0%, 3.9%)
   */
  textForeground: "hsl(222.2, 84%, 4.9%)",

  /** Muted text — CSS custom-property --muted-foreground.
   *  @source app/globals.css --muted-foreground: 215.4 16.3% 46.9%  →  hsl(215.4, 16.3%, 46.9%)
   *  INCONSISTENCY: styles/globals.css uses --muted-foreground: 0 0% 45.1%  →  hsl(0, 0%, 45.1%)
   */
  textMuted: "hsl(215.4, 16.3%, 46.9%)",

  /** Secondary gray text — used for counts, labels, metadata.
   *  @source map-view.tsx (text-gray-400)
   *  @source command-palette.tsx (text-gray-400)
   *  @source object-panel.tsx (text-gray-400)
   *  @source object-grid.tsx (text-gray-400)
   */
  textSecondary: "#9ca3af",

  /** Subtle gray text for hints. (text-gray-500 in Tailwind)
   *  @source object-grid.tsx (text-gray-500)
   *  @source image-gallery.tsx (#666)
   */
  textTertiary: "#6b7280",

  /** Panel muted text — via CSS custom-property.
   *  @source app/globals.css --panel-text-muted: 0 0% 45%
   *  @source map-view.tsx (.panel-text-muted)
   *  @source object-panel.tsx (.panel-text-muted)
   */
  textPanelMuted: "hsl(0, 0%, 45%)",

  /** Selected blue text.
   *  @source command-palette.tsx (text-blue-800, text-blue-700)
   */
  textSelectedBlue: "#1e40af",
  textChipBlue: "#1d4ed8",

  /** Selected orange text.
   *  @source command-palette.tsx (text-orange-800, text-orange-700)
   *  @source object-panel.tsx (text-orange-700)
   */
  textSelectedOrange: "#9a3412",
  textChipOrange: "#c2410c",

  /** Gray text on loading state.
   *  @source object-grid.tsx (text-gray-300)
   *  @source command-palette.tsx (text-[10px] text-gray-400)
   */
  textFaint: "#d1d5db",

  /** Breadcrumb separator and muted navigation text.
   *  @source object-panel.tsx (text-black/40, text-black/60)
   */
  textBreadcrumbSeparator: "rgba(0, 0, 0, 0.4)",
  textBreadcrumbInactive: "rgba(0, 0, 0, 0.6)",

  /** Error text.
   *  @source app/map/page.tsx (text-red-500)
   *  @source map-view.tsx (text-red-500)
   */
  textError: "#ef4444",

  /** Indigo accent for Wikipedia link/CTA text.
   *  @source map-view.tsx (text-indigo-600, text-indigo-500)
   */
  textIndigo: "#4f46e5",

  /** Violet accent for connection finder.
   *  @source command-palette.tsx (text-violet-600, text-violet-400, text-violet-300)
   */
  textViolet: "#7c3aed",

  /** Path-step chip text colors.
   *  @source command-palette.tsx
   */
  textPathCountry: "#1d4ed8",   // text-blue-700
  textPathCity: "#047857",       // text-emerald-700
  textPathInstitution: "#b45309", // text-amber-700
  textPathDefault: "#4b5563",    // text-gray-600

  /* ── Border Colors ────────────────────────────────────────────────────── */

  /** Default border — via CSS custom-property.
   *  @source app/globals.css --border: 214.3 31.8% 91.4%  → #e2e8f0
   *  INCONSISTENCY: styles/globals.css uses --border: 0 0% 89.8%  → #e5e5e5
   *  NOTE: globals.css aggressively removes all borders with `border: none !important`.
   */
  borderDefault: "hsl(214.3, 31.8%, 91.4%)",

  /** Light border for subtle separation.
   *  @source command-palette.tsx (border-gray-100, border-gray-200)
   */
  borderSubtle: "#f3f4f6",
  borderLight: "#e5e7eb",

  /** Ring on focus/selection — blue.
   *  @source map-view.tsx (ring-1 ring-blue-200)
   *  @source object-panel.tsx (ring-1 ring-blue-200)
   *  @source object-grid.tsx (ring-2 ring-blue-500)
   */
  borderFocusBlue: "#bfdbfe",
  borderRingBlue: "#3b82f6",

  /** Ring on institution selection — amber.
   *  @source map-view.tsx (ring-1 ring-amber-200)
   *  @source object-panel.tsx (ring-1 ring-amber-200)
   */
  borderRingAmber: "#fde68a",

  /** Map control border.
   *  @source app/globals.css (border: 1px solid rgba(0,0,0,0.1))
   */
  borderMapControl: "rgba(0, 0, 0, 0.1)",

  /* ── Accent / Brand ───────────────────────────────────────────────────── */

  /** Orange accent — used for institution filter chips.
   *  @source command-palette.tsx (bg-orange-50, text-orange-700, bg-orange-500)
   *  @source object-panel.tsx (bg-orange-50, text-orange-700)
   */
  accentOrange: "#f97316",

  /** Blue accent — used for place filter chips, selection rings.
   *  @source command-palette.tsx (bg-blue-50, text-blue-700, bg-blue-500, bg-blue-400)
   *  @source object-grid.tsx (ring-blue-500)
   */
  accentBlue: "#3b82f6",

  /* ── State Colors ─────────────────────────────────────────────────────── */

  /** Hover on command-palette clear button.
   *  @source command-palette.tsx (hover:bg-blue-100, hover:bg-orange-100)
   */
  stateHoverBlue: "#dbeafe",
  stateHoverOrange: "#ffedd5",

  /** Disabled / rate-limited overlay.
   *  @source app/map/page.tsx (bg-red-500 text-white)
   */
  stateAlertBg: "#ef4444",

  /** Destructive — from CSS custom-property.
   *  @source app/globals.css --destructive: 0 84.2% 60.2%
   */
  stateDestructive: "hsl(0, 84.2%, 60.2%)",

  /* ── Map Layer Colors (deck.gl) ───────────────────────────────────────── */

  /** Arc source color — computed in arc-worker.ts, defaults applied in map-view.tsx.
   *  @source hooks/use-arc-worker.ts (via processedArcs.layerStyle)
   *  @source map-view.tsx ([59, 130, 246, 255] selected arc)
   */
  mapArcSelected: "rgba(59, 130, 246, 1)",   // #3b82f6
  mapArcSelectedTarget: "rgba(147, 51, 234, 1)", // #9333ea

  /** Deck.gl highlight.
   *  @source map-view.tsx (highlightColor: [59, 130, 246])
   */
  mapHighlight: "rgba(59, 130, 246, 1)",

  /** Wikipedia scatter-plot fill.
   *  @source map-view.tsx ([99, 102, 241, 200])
   */
  mapWikiFill: "rgba(99, 102, 241, 0.78)",

  /** Wikipedia scatter-plot highlight.
   *  @source map-view.tsx ([139, 92, 246, 255])
   */
  mapWikiHighlight: "rgba(139, 92, 246, 1)",

  /** Wikipedia scatter-plot stroke.
   *  @source map-view.tsx ([255, 255, 255, 255])
   */
  mapWikiStroke: "#ffffff",

  /** Path-step dot colors (inline styles).
   *  @source command-palette.tsx
   */
  mapDotCountry: "#3b82f6",
  mapDotCity: "#10b981",
  mapDotInstitution: "#f59e0b",
  mapDotDefault: "#6b7280",

  /** Arc tooltip background (CSS class).
   *  @source app/globals.css (.mapboxgl-tooltip background-color: rgba(0,0,0,0.8))
   *  @source app/globals.css (.arc-tooltip background-color: rgba(0,0,0,0.85))
   */
  mapTooltipBg: "rgba(0, 0, 0, 0.85)",
} as const

// ─────────────────────────────────────────────────────────────────────────────
// 2. TYPOGRAPHY
// ─────────────────────────────────────────────────────────────────────────────

export const typography = {
  /** The entire app is forced to monospace via globals.css and tailwind.config.js.
   *  @source app/globals.css (* { @apply font-mono font-normal })
   *  @source tailwind.config.js (fontFamily.sans / fontFamily.mono)
   */
  fontFamily:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',

  /** Global base font-size. Set on * selector.
   *  @source app/globals.css (* { font-size: 0.875rem })  → 14px
   */
  fontSizeBase: "0.875rem",

  /** Global font-weight. Forced to 400 via !important.
   *  @source app/globals.css (* { font-weight: 400 !important })
   */
  fontWeightNormal: 400,

  /** Font-weight medium — used in breadcrumb active segment.
   *  @source map-view.tsx (font-medium)
   *  @source object-panel.tsx (font-medium)
   *  @source command-palette.tsx (font-medium)
   *  NOTE: Tailwind's font-medium is 500, but globals.css overrides to 400 via !important.
   *  INCONSISTENCY: font-medium (500) declared but overridden to 400.
   */
  fontWeightMedium: 500,

  scale: {
    /** Display: Not used. */

    /** body-md — the dominant text size everywhere ("text-sm" = 14px in Tailwind).
     *  @source map-view.tsx, command-palette.tsx, object-panel.tsx,
     *          object-grid.tsx, image-gallery.tsx
     *  Maps to Tailwind `text-sm` which is 0.875rem/14px — same as the base.
     */
    bodyMd: { fontSize: "0.875rem", lineHeight: "1.25rem" },

    /** body-sm — never used as a distinct step; the global 14px is already "sm". */

    /** caption — 10px text used for pill counts, meta labels, link-card footers.
     *  @source command-palette.tsx (text-[10px])
     *  @source object-panel.tsx (text-[9px], text-[10px])
     *  @source map-view.tsx (text-[10px])
     *  @source object-grid.tsx (text-[10px])
     */
    caption: { fontSize: "10px", lineHeight: "1" },

    /** micro — 9px used only for link-card bottom row.
     *  @source object-panel.tsx (text-[9px])
     *  (single-use)
     */
    micro: { fontSize: "9px", lineHeight: "1" },

    /** label — used for filter section headers via SectionHeader sub-component.
     *  @source command-palette.tsx (text-sm font-medium)
     *  Same numeric size as body-md but semantically a label.
     */
    label: { fontSize: "0.875rem", lineHeight: "1.25rem", fontWeight: 500 },

    /** mono — the entire UI is in monospace; no separate mono step. */

    /** overline — the "Related from region" / "Links" dividers.
     *  @source object-panel.tsx (text-sm text-gray-400 uppercase tracking-wider)
     *  @source object-panel.tsx (font-mono text-[10px] text-gray-400 uppercase tracking-wider)
     */
    overline: { fontSize: "0.875rem", lineHeight: "1.25rem", textTransform: "uppercase" as const, letterSpacing: "0.05em" },
    overlineSm: { fontSize: "10px", lineHeight: "1", textTransform: "uppercase" as const, letterSpacing: "0.05em" },
  },
} as const

// ─────────────────────────────────────────────────────────────────────────────
// 3. SPACING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tailwind 4px-base scale. Every padding/margin/gap in use is listed here
 * with the Tailwind class that generates it.
 */
export const spacing = {
  /** 0px — py-0 */
  0: "0px",
  /** 1px — (not directly used as Tailwind spacing, but ring-1 uses 1px) */
  px: "1px",
  /** 2px — p-0.5, gap-0.5, space-y-0.5 */
  0.5: "0.125rem",
  /** 4px — gap-1, p-1, py-1, px-1
   *  @source map-view.tsx (gap-1, px-1, py-0.5, p-1)
   *  @source command-palette.tsx (gap-1, px-1, p-0.5)
   *  @source object-panel.tsx (gap-1, p-1)
   *  @source object-grid.tsx (p-1)
   */
  1: "0.25rem",
  /** 6px — gap-1.5, py-1.5, px-1.5
   *  @source command-palette.tsx (gap-1.5, py-1.5, px-1.5)
   *  @source object-panel.tsx (gap-1.5)
   */
  1.5: "0.375rem",
  /** 8px — gap-2, p-2, px-2, py-2, space-y-2
   *  @source map-view.tsx (px-2, pt-2, pb-2, gap-2)
   *  @source command-palette.tsx (gap-2, px-2, py-2, space-y-2)
   */
  2: "0.5rem",
  /** 10px — gap-2.5 (not used) */
  2.5: "0.625rem",
  /** 12px — gap-3, p-3, px-3
   *  @source object-panel.tsx (p-3, px-3, gap-3)
   *  @source map-view.tsx (gap-3)
   *  @source object-grid.tsx (gap-3)
   */
  3: "0.75rem",
  /** 16px — gap-4, p-4, px-4, py-4
   *  @source command-palette.tsx (px-4)
   *  @source object-panel.tsx (px-4, pb-4)
   *  @source object-grid.tsx (px-4, pt-4, pb-4)
   *  Note: globals.css forces all p-3/p-4/px-3/px-4/py-3/py-4 to 0.75rem.
   *  INCONSISTENCY: CSS override converts 16px padding to 12px.
   */
  4: "1rem",
  /** 20px — gap-5, inset offsets
   *  @source object-panel.tsx (bottom: 20, left: 20, right: 20)
   *  These are inline style values, not Tailwind.
   */
  5: "1.25rem",
  /** 24px — py-6
   *  @source command-palette.tsx (py-6)
   *  @source object-grid.tsx (py-6)
   */
  6: "1.5rem",
  /** 32px — p-8
   *  @source map-view.tsx (p-8 in error state)
   */
  8: "2rem",
  /** 40px — inset spacing
   *  @source map-view.tsx (top-10, left-10)
   *  @source object-panel.tsx (top-10, right-10, bottom-10)
   *  @source app/globals.css (margin: 0 0 40px 40px for map controls)
   */
  10: "2.5rem",
  /** 64px — pt-[15vh] approximation / minimized bottom sheet bottom-padding. */
} as const

// ─────────────────────────────────────────────────────────────────────────────
// 4. GRID & LAYOUT
// ─────────────────────────────────────────────────────────────────────────────

export const layout = {
  /** Right-side panel width (desktop default).
   *  @source object-panel.tsx (width: "40%")
   */
  panelWidthDefault: "40%",

  /** Right-side panel width (desktop expanded).
   *  @source object-panel.tsx (width: "calc(100% - 5rem)")
   */
  panelWidthExpanded: "calc(100% - 5rem)",

  /** Right-side panel height (desktop expanded).
   *  @source object-panel.tsx (height: "calc(100vh - 5rem)")
   */
  panelHeightExpanded: "calc(100vh - 5rem)",

  /** Desktop panel insets (fixed position).
   *  @source object-panel.tsx (top-10 right-10 bottom-10)  → 40px
   */
  panelInsetDesktop: "2.5rem",

  /** Mobile bottom-sheet heights.
   *  @source object-panel.tsx
   */
  mobileSheetDefault: "40%",
  mobileSheetExpanded: "100%",
  mobileSheetMinimized: "auto",

  /** Mobile bottom-sheet insets.
   *  @source object-panel.tsx (bottom: 20, left: 20, right: 20)  → 20px
   */
  mobileSheetInset: "20px",

  /** Header panel width (desktop, top-left of map).
   *  @source map-view.tsx (sm:w-80)  → 320px
   */
  headerPanelWidth: "20rem",

  /** Header panel insets.
   *  @source map-view.tsx (top-10 left-10)  → 40px
   */
  headerPanelInset: "2.5rem",

  /** Command palette width.
   *  @source command-palette.tsx (max-w-lg)  → 32rem / 512px
   */
  commandPaletteMaxWidth: "32rem",

  /** Command palette Y offset.
   *  @source command-palette.tsx (pt-[15vh])
   */
  commandPaletteTopOffset: "15vh",

  /** Command palette list max-height.
   *  @source command-palette.tsx (max-h-[50vh])
   */
  commandPaletteMaxHeight: "50vh",

  /** Map control offset from bottom-left.
   *  @source app/globals.css (margin: 0 0 40px 40px)
   */
  mapControlInset: "40px",

  /** Image grid tile height.
   *  @source object-grid.tsx (h-44)  → 176px
   */
  gridTileHeight: "11rem",

  /** Image grid max-image height.
   *  @source object-grid.tsx (max-h-36)  → 144px
   */
  gridImageMaxHeight: "9rem",

  /** Image grid gap.
   *  @source object-grid.tsx (gap-3)  → 12px
   */
  gridGap: "0.75rem",

  /** Container max-width (from tailwind.config.js).
   *  @source tailwind.config.js (screens["2xl"]: "1400px")
   */
  containerMax2xl: "1400px",

  /** Object grid columns by panel size (responsive):
   *  panelSize ≤ 40  → 3 cols (sm+)
   *  panelSize ≤ 50  → 4 cols (md+)
   *  fullscreen       → 2 → 3 → 4 → 5 → 6 → 7 → 8 cols
   *  @source object-grid.tsx
   */
  gridColumns: {
    fullscreen: "grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8",
    default40: "grid-cols-3 xs:grid-cols-3 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-3",
    default50: "grid-cols-3 xs:grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-4",
  },

  /** Drill-down list max-heights.
   *  @source map-view.tsx (max-h-40)  → 160px
   *  @source object-panel.tsx (max-h-40)
   */
  listMaxHeight: "10rem",

  /** Wikipedia popup width. (single-use)
   *  @source map-view.tsx (width: "300px")
   */
  wikiPopupWidth: "300px",

  /** Link-card grid columns. (single-use)
   *  @source object-panel.tsx (grid-cols-3)
   */
  linkCardColumns: 3,

  /** Link-card height. (single-use)
   *  @source object-panel.tsx (h-44)  → 176px
   */
  linkCardHeight: "11rem",
} as const

// ─────────────────────────────────────────────────────────────────────────────
// 5. BORDER RADIUS
// ─────────────────────────────────────────────────────────────────────────────

export const radii = {
  /** Small — Tailwind's rounded-md via custom property.
   *  @source tailwind.config.js (calc(var(--radius) - 4px))  → calc(0.5rem - 4px) = 4px
   *  @source command-palette.tsx (rounded-md)
   *  @source map-view.tsx (rounded-md)
   */
  sm: "calc(0.5rem - 4px)",

  /** Medium — Tailwind md.
   *  @source tailwind.config.js (calc(var(--radius) - 2px))  → 6px
   */
  md: "calc(0.5rem - 2px)",

  /** Large — Tailwind lg.
   *  @source tailwind.config.js (var(--radius))  → 0.5rem = 8px
   *  @source app/globals.css (.resizable-panel border-radius: 8px)
   *  @source app/globals.css (.image-gallery-modal border-radius: 8px)
   */
  lg: "0.5rem",

  /** Image tile / tooltip — 10px.
   *  @source object-grid.tsx (rounded-[10px])
   *  @source map-view.tsx (rounded-[10px])
   *  @source object-panel.tsx (rounded-[10px])
   */
  tile: "10px",

  /** Panel / card — 20px (very large).
   *  @source command-palette.tsx (rounded-[20px])
   *  @source map-view.tsx (rounded-2xl)  → 16px
   *  @source object-panel.tsx (rounded-2xl)  → 16px
   *  INCONSISTENCY: command palette uses 20px, panels use 16px (rounded-2xl).
   */
  panel: "1rem",      // 16px (rounded-2xl — used by map header + object container)
  palette: "1.25rem", // 20px (rounded-[20px] — used by command palette)

  /** Wikipedia popup. (single-use)
   *  @source map-view.tsx (rounded-2xl)
   */
  popup: "1rem",

  /** Map control group.
   *  @source app/globals.css (.mapboxgl-ctrl-group border-radius: 6px)
   */
  control: "6px",

  /** Full / pill.
   *  @source command-palette.tsx (rounded-full)
   *  @source faceted-filter.tsx (rounded-full)
   */
  full: "9999px",
} as const

// ─────────────────────────────────────────────────────────────────────────────
// 6. ELEVATION & SHADOWS
// ─────────────────────────────────────────────────────────────────────────────

export const shadows = {
  /** Primary shadow on panels and cards.
   *  @source command-palette.tsx (shadow-2xl)
   *  @source map-view.tsx (shadow-lg)
   *  @source object-panel.tsx (shadow-lg)
   */
  lg: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)",
  "2xl": "0 25px 50px -12px rgba(0, 0, 0, 0.25)",

  /** Wikipedia popup.
   *  @source map-view.tsx (shadow-xl on selectedDoc popup)
   */
  xl: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",

  /** Map control.
   *  @source app/globals.css (box-shadow: 0 2px 6px rgba(0,0,0,0.1))
   */
  control: "0 2px 6px rgba(0, 0, 0, 0.1)",

  /** Arc tooltip.
   *  @source app/globals.css (.arc-tooltip box-shadow: 0 2px 10px rgba(0,0,0,0.3))
   */
  tooltip: "0 2px 10px rgba(0, 0, 0, 0.3)",

  /** Subtle shadow (defined in CSS).
   *  @source app/globals.css (.shadow-subtle)
   */
  subtle: "0 1px 3px rgba(0, 0, 0, 0.05)",

  /** Image gallery modal.
   *  @source app/globals.css (.image-gallery-modal box-shadow)
   */
  gallery: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",

  /** Map provider dropdown.
   *  @source app/globals.css (.map-provider-dropdown box-shadow: 0 4px 12px rgba(0,0,0,0.15))
   */
  dropdown: "0 4px 12px rgba(0, 0, 0, 0.15)",
} as const

export const backdrop = {
  /** Panel backdrop blur.
   *  @source app/globals.css (.panel backdrop-filter: blur(8px))
   *  @source app/globals.css (.resizable-panel backdrop-filter: blur(4px))
   */
  panel: "blur(8px)",
  resizable: "blur(4px)",

  /** Command-palette backdrop.
   *  @source command-palette.tsx (backdrop-blur-[2px])
   */
  scrim: "blur(2px)",

  /** Faceted-filter popover.
   *  @source faceted-filter.tsx (backdrop-blur-md)  → blur(12px)
   */
  popover: "blur(12px)",
} as const

// ─────────────────────────────────────────────────────────────────────────────
// 7. MOTION
// ─────────────────────────────────────────────────────────────────────────────

export const motion = {
  /** Fast — hover transitions, color changes.
   *  @source command-palette.tsx (transition-colors, transition-transform)
   *  @source map-view.tsx (transition-colors)
   *  @source object-grid.tsx (duration-200)
   *  @source app/globals.css (.map-provider-option transition: 0.15s ease)
   */
  fast: { duration: "150ms", easing: "ease" },

  /** Default — general UI transitions.
   *  @source app/globals.css (.sidebar transition: width 0.3s ease-in-out)
   *  @source app/globals.css (.resizable-panel transition: all 0.3s ease)
   *  @source blurhash-image.tsx (duration-500 ease-out) — image fade-in
   */
  default: { duration: "300ms", easing: "ease-in-out" },

  /** Image fade-in (blurhash reveal).
   *  @source blurhash-image.tsx (transition-opacity duration-500 ease-out)
   */
  imageFade: { duration: "500ms", easing: "ease-out" },

  /** Gallery animation.
   *  @source app/globals.css (fadeIn 0.2s ease-out, galleryFadeIn 0.2s ease-out)
   *  @source app/globals.css (.image-gallery-enter-active 300ms)
   */
  gallery: { duration: "200ms", easing: "ease-out" },

  /** Arc layer transitions.
   *  @source map-view.tsx (transitions: { duration: 300 })
   *  @source app/globals.css (.arc-fade-in animation: fadeIn 0.3s ease-in-out)
   */
  arc: { duration: "300ms", easing: "ease-in-out" },

  /** Loading gradient animation.
   *  @source app/globals.css (.loading-gradient animation: gradientMove 1.5s infinite)
   */
  loadingGradient: { duration: "1500ms", easing: "linear", iterationCount: "infinite" },

  /** Accordion.
   *  @source tailwind.config.js (accordion-down 0.2s ease-out, accordion-up 0.2s ease-out)
   */
  accordion: { duration: "200ms", easing: "ease-out" },

  /** Map flyTo durations (used as numeric ms).
   *  @source app/map/page.tsx (1400, 1200, 800)
   *  @source map-view.tsx (800, 900, 950, 1500, 1600, 2300)
   */
  mapFly: {
    fast: 800,
    default: 1200,
    slow: 1400,
    levelShift: 2300,
  },

  /** Map easing functions.
   *  @source map-view.tsx
   */
  mapEasing: {
    detail: "(t: number) => 1 - Math.pow(1 - t, 2.2)",
    levelShift: "(t: number) => 1 - Math.pow(1 - t, 3.2)",
  },
} as const

// ─────────────────────────────────────────────────────────────────────────────
// 8. Z-INDEX LAYERS
// ─────────────────────────────────────────────────────────────────────────────

export const zIndex = {
  /** Map canvas.
   *  @source app/globals.css (.mapboxgl-canvas z-index: 2)
   */
  mapCanvas: 2,

  /** Map base.
   *  @source app/globals.css (.mapboxgl-map z-index: 1)
   */
  map: 1,

  /** Map controls.
   *  @source app/globals.css (.mapboxgl-control-container z-index: 10)
   */
  mapControls: 10,

  /** Header panel + object container.
   *  @source map-view.tsx (z-20)
   *  @source object-panel.tsx (z-20)
   */
  panel: 20,

  /** Sticky header inside object container.
   *  @source object-panel.tsx (z-30)
   */
  panelHeader: 30,

  /** Map controls overlay.
   *  @source app/globals.css (.map-controls z-index: 40)
   */
  mapOverlay: 40,

  /** Tooltips on map.
   *  @source map-view.tsx (z-50 on arc tooltip / wiki tooltip)
   *  @source app/globals.css (.mapboxgl-popup z-index: 60)
   *  @source app/globals.css (.mapboxgl-tooltip z-index: 60)
   */
  tooltip: 50,

  /** Image gallery inside container.
   *  @source image-gallery.tsx (zIndex: 60)
   */
  gallery: 60,

  mapPopup: 60,

  /** Rate-limit warning.
   *  @source app/map/page.tsx (z-[70])
   */
  alert: 70,

  /** Command palette + its backdrop.
   *  @source command-palette.tsx (z-[80])
   */
  commandPalette: 80,

  /** Map-provider dropdown / arc tooltip.
   *  @source app/globals.css (.map-provider-dropdown z-index: 1000)
   *  @source app/globals.css (.arc-tooltip z-index: 1000)
   *  @source faceted-filter.tsx (z-[1000])
   */
  dropdown: 1000,
} as const

// ─────────────────────────────────────────────────────────────────────────────
// 9. BREAKPOINTS
// ─────────────────────────────────────────────────────────────────────────────

export const breakpoints = {
  /** Extra-small — custom.
   *  @source tailwind.config.js (xs: "480px")
   */
  xs: "480px",

  /** Small — Tailwind default.
   *  @source tailwind.config.js (inherited)
   *  @source app/globals.css (@media (max-width: 640px))
   */
  sm: "640px",

  /** Medium — Tailwind default. Also used for isMobile check.
   *  @source hooks/use-media-query.ts ("(max-width: 768px)")
   *  @source app/globals.css (@media (max-width: 768px))
   *  @source map-view.tsx / object-panel.tsx (isMobile)
   */
  md: "768px",

  /** Large — Tailwind default.
   *  @source tailwind.config.js (inherited)
   */
  lg: "1024px",

  /** Extra-large — Tailwind default.
   *  @source tailwind.config.js (inherited)
   */
  xl: "1280px",

  /** 2x-large — container max-width boundary.
   *  @source tailwind.config.js (screens["2xl"]: "1400px")
   */
  "2xl": "1400px",
} as const

// ─────────────────────────────────────────────────────────────────────────────
// ICON SIZES
// ─────────────────────────────────────────────────────────────────────────────

export const iconSizes = {
  /** Tiny indicator dots.
   *  @source command-palette.tsx (w-1.5 h-1.5)
   */
  dot: "0.375rem",

  /** XS icons (close button inside chips).
   *  @source command-palette.tsx (w-2.5 h-2.5)
   *  @source object-panel.tsx (w-2.5 h-2.5)
   */
  xs: "0.625rem",

  /** Small icons (clear search, spinner inline).
   *  @source command-palette.tsx (w-3.5 h-3.5)
   *  @source map-view.tsx (h-3 w-3)
   */
  sm: "0.875rem",

  /** Default icons.
   *  @source map-view.tsx (w-4 h-4)
   *  @source object-panel.tsx (h-4 w-4)
   *  @source command-palette.tsx (w-4 h-4)
   *  @source image-gallery.tsx (h-4 w-4)
   */
  md: "1rem",

  /** Medium icons (alert, search bar icon).
   *  @source command-palette.tsx (w-[18px] h-[18px])
   */
  searchBar: "18px",

  /** Rate-limit alert icon.
   *  @source app/map/page.tsx (h-5 w-5)
   */
  lg: "1.25rem",

  /** Loading spinner.
   *  @source map-view.tsx (h-8 w-8)
   */
  xl: "2rem",

  /** Map error icon.
   *  @source map-view.tsx (h-12 w-12)
   */
  "2xl": "3rem",

  /** Map control icon.
   *  @source app/globals.css (.mapboxgl-ctrl-icon svg width: 15px)
   */
  mapControl: "15px",

  /** Map control button.
   *  @source app/globals.css (.mapboxgl-ctrl-group button width: 28px)
   */
  mapControlButton: "28px",

  /** Custom panel-toggle SVG.
   *  @source map-view.tsx (width="18" height="18")
   *  @source object-panel.tsx (width="18" height="18")
   */
  panelToggle: "18px",
} as const

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOM ICON REGISTRY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registry of custom Ex Situ icons.
 *
 * These replace lucide-react / @radix-ui/react-icons for the core UI actions.
 * Import React components from `@/components/icons`.
 * Raw SVG strings (for Mapbox IControl) available via `iconSvgStrings`.
 *
 * | Token key       | Component          | Purpose                              |
 * |-----------------|--------------------|--------------------------------------|
 * | close           | IconClose          | Dismiss / close dialogs, panels      |
 * | search          | IconSearch         | Search input, command palette         |
 * | downloadCsv     | IconDownloadCsv    | Export / download CSV                 |
 * | expand          | IconExpand         | Maximize panel                        |
 * | minimize        | IconMinimize       | Minimize / restore panel              |
 * | panelClosed     | IconPanelClosed    | Panel toggle — panel is closed        |
 * | panelOpen       | IconPanelOpen      | Panel toggle — panel is open          |
 * | share           | IconShare          | Share URL / link                      |
 * | source          | IconSource         | External link to museum source        |
 *
 * @example React component
 * ```tsx
 * import { IconSearch } from "@/components/icons"
 * <IconSearch className="h-4 w-4" />
 * ```
 *
 * @example Raw SVG string (Mapbox IControl)
 * ```ts
 * import { iconSvgStrings } from "@/components/icons"
 * btn.innerHTML = iconSvgStrings.panelOpen
 * ```
 */
export const iconRegistry = {
  close: { component: "IconClose", file: "/icons/close.svg" },
  search: { component: "IconSearch", file: "/icons/search.svg" },
  downloadCsv: { component: "IconDownloadCsv", file: "/icons/download-csv.svg" },
  expand: { component: "IconExpand", file: "/icons/expand.svg" },
  minimize: { component: "IconMinimize", file: "/icons/minimize.svg" },
  panelClosed: { component: "IconPanelClosed", file: "/icons/object-panel-closed.svg" },
  panelOpen: { component: "IconPanelOpen", file: "/icons/object-panel-open.svg" },
  share: { component: "IconShare", file: "/icons/share.svg" },
  source: { component: "IconSource", file: "/icons/source.svg" },
} as const

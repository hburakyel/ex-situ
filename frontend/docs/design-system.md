# Ex Situ Design System

> Extracted from the codebase — **pure documentation, no opinions.**  
> Every value below exists in the source. Inconsistencies are flagged, not fixed.

---

## Table of Contents

1. [Overview](#overview)  
2. [Tech Stack](#tech-stack)  
3. [File Map](#file-map)  
4. [Design Principles (as-built)](#design-principles-as-built)  
5. [Color Tokens](#color-tokens)  
6. [Typography](#typography)  
7. [Spacing](#spacing)  
8. [Layout](#layout)  
9. [Border Radius](#border-radius)  
10. [Shadows & Elevation](#shadows--elevation)  
11. [Backdrop Blur](#backdrop-blur)  
12. [Motion](#motion)  
13. [Z-Index Layers](#z-index-layers)  
14. [Breakpoints](#breakpoints)  
15. [Icon Sizes](#icon-sizes)  
16. [Component Inventory](#component-inventory)  
17. [Inconsistencies](#inconsistencies)  
18. [Migration Checklist](#migration-checklist)  

---

## Overview

Ex Situ is a geospatial museum-object explorer. The interface is a single full-screen page (`/map`) with:

- A **MapLibre/Mapbox** map filling the viewport
- A **floating header panel** (desktop, top-left) with drill-down navigation
- A **floating object panel** (desktop right / mobile bottom-sheet) with image grid
- A **command palette** (⌘K) for search and connection discovery
- **deck.gl** overlays for arcs and scatter plots

The design is **monochrome + monospace** with surgical use of blue, amber, orange, and violet accents.

---

## Tech Stack

| Layer | Package | Version |
|-------|---------|---------|
| Framework | Next.js | 15.2.4 |
| React | React | 19 |
| Language | TypeScript | 5 |
| Styling | Tailwind CSS | (with `tailwindcss-animate`) |
| Components | shadcn/ui (Radix primitives) | — |
| Class Merging | clsx + tailwind-merge + CVA | — |
| Map | mapbox-gl, maplibre-gl | 5.17 |
| Visualization | deck.gl (ArcLayer, ScatterplotLayer) | — |
| Command Palette | cmdk | — |
| Panels | react-resizable-panels | — |
| Animations | framer-motion | — |
| Icons | lucide-react | — |

---

## File Map

### Design System Files (this package)

| File | Purpose |
|------|---------|
| `lib/design-system/tokens.ts` | All foundational tokens with JSDoc source annotations |
| `lib/design-system/components.ts` | Component specs, anatomy, props, states |
| `lib/design-system/index.ts` | Unified re-exports |
| `lib/design-system/tailwind.config.tokens.ts` | `theme.extend` consuming tokens |
| `styles/tokens.css` | CSS custom properties for every token |
| `docs/design-system.md` | This document |
| `tokens.json` | W3C Design Token Community Group format |

### Source Files

| File | Lines | Role |
|------|-------|------|
| `app/map/page.tsx` | 808 | Main orchestrator — state machine, data fetching, URL sync |
| `app/map/layout.tsx` | 13 | Full-screen white shell |
| `components/map/map-view.tsx` | 1075 | Map + deck.gl + header panel |
| `components/map/command-palette.tsx` | 698 | ⌘K search + connection finder |
| `components/map/object-panel.tsx` | 712 | Right panel + mobile sheet |

### Shared Components

| File | Role |
|------|------|
| `components/object-grid.tsx` | Virtualized image grid |
| `components/image-gallery.tsx` | Image viewer overlay |
| `components/blurhash-image.tsx` | Progressive image loading |
| `components/faceted-filter.tsx` | Filter popover (not in the main layout directly) |
| `components/ui/spinner.tsx` | Radix spinner wrapper |

### Infrastructure

| File | Role |
|------|------|
| `app/globals.css` | Primary CSS — custom properties, global resets, map styles |
| `styles/globals.css` | Secondary shadcn/ui variables (light + dark mode) |
| `tailwind.config.js` | Tailwind configuration |
| `lib/utils.ts` | `cn()` utility (clsx + twMerge) |
| `hooks/use-media-query.ts` | Responsive breakpoint hook |
| `types.ts` | All TypeScript interfaces |

---

## Design Principles (as-built)

These are not aspirational — they describe what the code does today.

1. **Monospace everywhere.** `globals.css` applies `font-mono font-normal` to `*`. Both `fontFamily.sans` and `fontFamily.mono` in Tailwind resolve to the same monospace stack.

2. **White-canvas UI.** Every surface is `bg-white`. No dark mode in the app (dark tokens exist in `styles/globals.css` but are unused).

3. **Floating panels.** Map fills the viewport; UI elements float on top with `position: fixed/absolute`, `border-radius`, and `shadow-lg`.

4. **Aggressive CSS resets.** `globals.css` force-removes borders (`border: none !important`), overrides font-weight to 400 (`!important`), and normalizes padding classes.

5. **Drill-down state machine.** Navigation flows `global → country → objects` with breadcrumb trail and back-navigation.

6. **Monochrome + accent.** Base palette is black/white/gray. Blue = geographic selection. Amber = institution selection. Orange = filter chips. Violet = connection finder.

---

## Color Tokens

### Backgrounds

| Token | Value | Usage |
|-------|-------|-------|
| `bgBase` | `#ffffff` | Every surface |
| `bgOverlay` | `hsla(0,0%,100%,0.5)` | Map loading overlay |
| `bgScrim` | `rgba(0,0,0,0.25)` | Command palette backdrop |
| `bgGalleryOverlay` | `rgba(0,0,0,0.7)` | Image gallery overlay (CSS) |
| `bgPanelBackdrop` | `rgba(229,229,229,0.9)` | Resizable panel (CSS) |
| `bgSurfaceSubtle` | `rgba(249,250,251,0.5)` | Filter bar background |
| `bgError` | `#fef2f2` | Map error state |
| `bgHover` | `#f9fafb` | List row hover |
| `bgSelectedBlue` | `#eff6ff` | Active place/country row |
| `bgSelectedAmber` | `#fffbeb` | Active institution row |
| `bgChipOrange` | `#fff7ed` | Collection filter chips |
| `bgLinkCardHover` | `#f5f5f5` | Wiki link card hover |
| `bgViolet` | `rgba(245,243,255,0.5)` | Connection finder section |

### Text

| Token | Value | Usage |
|-------|-------|-------|
| `textPrimary` | `#000000` | Forced on all elements |
| `textForeground` | `hsl(222.2,84%,4.9%)` | CSS `--foreground` |
| `textMuted` | `hsl(215.4,16.3%,46.9%)` | CSS `--muted-foreground` |
| `textSecondary` | `#9ca3af` | Counts, labels, metadata |
| `textTertiary` | `#6b7280` | Hints, secondary headings |
| `textPanelMuted` | `hsl(0,0%,45%)` | Panel section labels |
| `textError` | `#ef4444` | Error messages |
| `textIndigo` | `#4f46e5` | Wikipedia CTA text |
| `textViolet` | `#7c3aed` | Connection finder accent |

### Borders

| Token | Value | Usage |
|-------|-------|-------|
| `borderDefault` | `hsl(214.3,31.8%,91.4%)` | CSS `--border` |
| `borderSubtle` | `#f3f4f6` | Section dividers |
| `borderLight` | `#e5e7eb` | Separator lines |
| `borderFocusBlue` | `#bfdbfe` | Selection ring (thin) |
| `borderRingBlue` | `#3b82f6` | Selection ring (thick) |
| `borderRingAmber` | `#fde68a` | Institution ring |
| `borderMapControl` | `rgba(0,0,0,0.1)` | Map control border |

### Accent

| Token | Value | Usage |
|-------|-------|-------|
| `accentOrange` | `#f97316` | Institution accent |
| `accentBlue` | `#3b82f6` | Geographic accent |

### Map Layer Colors

| Token | Value | Usage |
|-------|-------|-------|
| `mapArcSelected` | `rgba(59,130,246,1)` | Selected arc source |
| `mapArcSelectedTarget` | `rgba(147,51,234,1)` | Selected arc target |
| `mapWikiFill` | `rgba(99,102,241,0.78)` | Wiki scatter dots |
| `mapWikiHighlight` | `rgba(139,92,246,1)` | Wiki hover highlight |
| `mapTooltipBg` | `rgba(0,0,0,0.85)` | Arc/map tooltip bg |

---

## Typography

| Property | Value | Source |
|----------|-------|--------|
| Font Family | `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace` | `tailwind.config.js`, `globals.css` |
| Base Size | `0.875rem` (14px) | `globals.css (* { font-size: 0.875rem })` |
| Weight Normal | `400` | `globals.css (* { font-weight: 400 !important })` |
| Weight Medium | `500` (declared but overridden to 400) | see Inconsistencies |

### Type Scale

| Name | Size | Line Height | Usage |
|------|------|-------------|-------|
| `bodyMd` | `0.875rem` | `1.25rem` | Primary text everywhere |
| `caption` | `10px` | `1` | Badge counts, kbd hints, metadata |
| `micro` | `9px` | `1` | Link card footers (single-use) |
| `label` | `0.875rem` | `1.25rem` | Section headers (`font-medium`) |
| `overline` | `0.875rem` | `1.25rem` | Divider labels (`uppercase tracking-wider`) |
| `overlineSm` | `10px` | `1` | Small divider labels |

---

## Spacing

Tailwind 4px base scale. All values used in the app:

| Token | Value | Tailwind Class |
|-------|-------|----------------|
| `0` | `0px` | `p-0` |
| `px` | `1px` | — |
| `0.5` | `0.125rem` | `p-0.5` |
| `1` | `0.25rem` | `gap-1`, `p-1` |
| `1.5` | `0.375rem` | `gap-1.5`, `py-1.5` |
| `2` | `0.5rem` | `gap-2`, `px-2` |
| `3` | `0.75rem` | `p-3`, `gap-3` |
| `4` | `1rem` | `px-4` (see note) |
| `5` | `1.25rem` | inline styles |
| `6` | `1.5rem` | `py-6` |
| `8` | `2rem` | `p-8` |
| `10` | `2.5rem` | `top-10`, `left-10` |

> **Note:** `globals.css` overrides `p-3`, `p-4`, `px-3`, `px-4`, `py-3`, `py-4` to `0.75rem` (12px). This means `p-4` in the source does NOT produce 16px — it produces 12px.

---

## Layout

| Token | Value | Description |
|-------|-------|-------------|
| `panelWidthDefault` | `40%` | Object panel width (desktop) |
| `panelWidthExpanded` | `calc(100% - 5rem)` | Expanded panel |
| `panelInsetDesktop` | `2.5rem` (40px) | Panel offset from edges |
| `mobileSheetDefault` | `40%` | Mobile bottom-sheet height |
| `mobileSheetInset` | `20px` | Mobile sheet edge offset |
| `headerPanelWidth` | `20rem` (320px) | Desktop header panel |
| `commandPaletteMaxWidth` | `32rem` (512px) | ⌘K palette width |
| `commandPaletteTopOffset` | `15vh` | Palette Y position |
| `commandPaletteMaxHeight` | `50vh` | Palette list area |
| `gridTileHeight` | `11rem` (176px) | Image tile height |
| `gridGap` | `0.75rem` (12px) | Grid gap |

---

## Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `sm` | `calc(0.5rem - 4px)` = 4px | Small elements |
| `md` | `calc(0.5rem - 2px)` = 6px | Buttons, chips |
| `lg` | `0.5rem` = 8px | Cards, modals |
| `tile` | `10px` | Image tiles, tooltips |
| `panel` | `1rem` = 16px | Header + object panel |
| `palette` | `1.25rem` = 20px | Command palette |
| `control` | `6px` | Map controls |
| `full` | `9999px` | Pills |

---

## Shadows & Elevation

| Token | Value | Usage |
|-------|-------|-------|
| `lg` | `0 10px 15px -3px …` | Primary panels |
| `2xl` | `0 25px 50px -12px …` | Command palette |
| `xl` | `0 20px 25px -5px …` | Wiki popup |
| `control` | `0 2px 6px …` | Map controls |
| `tooltip` | `0 2px 10px …` | Arc tooltip |
| `subtle` | `0 1px 3px …` | Utility class |
| `gallery` | `0 10px 25px -5px …` | Image gallery |
| `dropdown` | `0 4px 12px …` | Map provider dropdown |

---

## Backdrop Blur

| Token | Value | Usage |
|-------|-------|-------|
| `panel` | `blur(8px)` | Panel CSS class |
| `resizable` | `blur(4px)` | Resizable panel CSS |
| `scrim` | `blur(2px)` | Command palette backdrop |
| `popover` | `blur(12px)` | Faceted filter popover |

---

## Motion

| Token | Duration | Easing | Usage |
|-------|----------|--------|-------|
| `fast` | `150ms` | `ease` | Hover transitions, color changes |
| `default` | `300ms` | `ease-in-out` | Panel width, sidebar |
| `imageFade` | `500ms` | `ease-out` | Blurhash reveal |
| `gallery` | `200ms` | `ease-out` | Gallery fade-in |
| `arc` | `300ms` | `ease-in-out` | Arc layer transitions |
| `loadingGradient` | `1500ms` | `linear` | Loading shimmer (infinite) |
| `accordion` | `200ms` | `ease-out` | Accordion open/close |

### Map Fly Durations

| Variant | Duration (ms) | Usage |
|---------|---------------|-------|
| `fast` | 800 | Detail zoom |
| `default` | 1200 | Country zoom |
| `slow` | 1400 | Initial fly |
| `levelShift` | 2300 | Drill-down level change |

---

## Z-Index Layers

```
┌─────────────────────────────────────────┐
│ z-1000  dropdown / arc-tooltip          │
├─────────────────────────────────────────┤
│ z-80    commandPalette + backdrop       │
├─────────────────────────────────────────┤
│ z-70    rate-limit alert                │
├─────────────────────────────────────────┤
│ z-60    gallery / mapPopup              │
├─────────────────────────────────────────┤
│ z-50    arc tooltip / wiki tooltip      │
├─────────────────────────────────────────┤
│ z-40    map overlay controls            │
├─────────────────────────────────────────┤
│ z-30    panelHeader (sticky)            │
├─────────────────────────────────────────┤
│ z-20    panel (header + object)         │
├─────────────────────────────────────────┤
│ z-10    mapControls                     │
├─────────────────────────────────────────┤
│ z-2     mapCanvas                       │
│ z-1     map                             │
└─────────────────────────────────────────┘
```

---

## Breakpoints

| Name | Width | Source |
|------|-------|--------|
| `xs` | `480px` | Custom (tailwind.config.js) |
| `sm` | `640px` | Tailwind default |
| `md` | `768px` | Tailwind default; `isMobile` threshold |
| `lg` | `1024px` | Tailwind default |
| `xl` | `1280px` | Tailwind default |
| `2xl` | `1400px` | Custom (tailwind.config.js) |

---

## Icon Sizes

| Token | Value | Usage |
|-------|-------|-------|
| `dot` | `6px` | Indicator dots (e.g., path connection) |
| `xs` | `10px` | Close × inside chips |
| `sm` | `14px` | Clear search, small spinners |
| `md` | `16px` | Default icons (w-4 h-4) |
| `searchBar` | `18px` | Search icon in command palette |
| `lg` | `20px` | Alert icons |
| `xl` | `32px` | Loading spinner |
| `2xl` | `48px` | Map error icon |
| `mapControl` | `15px` | SVG inside map controls |
| `mapControlButton` | `28px` | Map control button size |
| `panelToggle` | `18px` | Panel sidebar-toggle SVG |

---

## Component Inventory

Full anatomy, states, and props are documented in `lib/design-system/components.ts`.

### Page-Level

| Component | File | Description |
|-----------|------|-------------|
| Map Layout | `app/map/layout.tsx` | Full-screen white shell |
| Map Page | `app/map/page.tsx` | Orchestrator with drill-down state machine |

### Map Components

| Component | File | Description |
|-----------|------|-------------|
| MapView | `components/map/map-view.tsx` | Map + deck.gl + floating header |
| CommandPalette | `components/map/command-palette.tsx` | ⌘K search + connection finder |
| ObjectContainer | `components/map/object-panel.tsx` | Right panel / mobile sheet |

### Shared Components

| Component | File | Description |
|-----------|------|-------------|
| ObjectGrid | `components/object-grid.tsx` | Virtualized image grid |
| ImageGallery | `components/image-gallery.tsx` | Full-panel image viewer |
| BlurhashImage | `components/blurhash-image.tsx` | Progressive image loading |
| FacetedFilter | `components/faceted-filter.tsx` | Filter popover |
| Spinner | `components/ui/spinner.tsx` | Radix spinner wrapper |

### Inline Patterns (not separate files)

| Pattern | Defined In | Description |
|---------|-----------|-------------|
| FilterChip | command-palette, object-container | Active filter tag with dismiss |
| Breadcrumb | map-view, object-container | Drill-down trail |
| SectionHeader | command-palette, map-view, object-container | Collapsible section toggle |
| CountBadge | command-palette, map-view, object-container | Numeric count pill |
| SearchInput | command-palette | Input with icon + kbd hint |
| IconButton | across the app | Ghost button wrapping a Lucide icon |
| Divider | object-container | Labeled horizontal rule |
| LinkCard | object-container | Wikipedia article card |
| MapControls | map-view, globals.css | Zoom + globe custom control |
| CSVDownloadButton | object-container | Ghost icon button for export |

---

## Inconsistencies

These exist in the codebase as-is. Flagged for awareness, not for action.

### 1. Dual `globals.css` Files

Two CSS files define overlapping custom properties with different values:

| Property | `app/globals.css` | `styles/globals.css` |
|----------|-------------------|----------------------|
| `--foreground` | `222.2 84% 4.9%` | `0 0% 3.9%` |
| `--muted-foreground` | `215.4 16.3% 46.9%` | `0 0% 45.1%` |
| `--border` | `214.3 31.8% 91.4%` | `0 0% 89.8%` |

### 2. `font-medium` Override

`font-medium` (Tailwind weight 500) is declared throughout the app but `globals.css` forces `font-weight: 400 !important` on all elements.

### 3. Border Radius Mismatch

- Command palette: `rounded-[20px]` (20px)
- Header panel + object container: `rounded-2xl` (16px)

Both are "the main panel" radius but differ by 4px.

### 4. Padding Override

`globals.css` overrides Tailwind `p-3`/`p-4`/`px-3`/`px-4`/`py-3`/`py-4` to a flat `0.75rem` (12px), which means `p-4` does NOT produce 16px.

### 5. FilterChip Font Size Mismatch

- Command palette chips: `text-[10px]`
- Object container chips: `text-sm` (14px)

### 6. Breadcrumb Separator Color

- Desktop (map header): `text-black` for separator + ancestor
- Mobile (object container): `text-black/40` separator, `text-black/60` ancestor

### 7. ~~Z-Index Collision at z-50~~ (RESOLVED)

Previously `gallery`, `tooltip`, `commandPalette`, `alert`, and `mapOverlay` all used `z-50`. Now separated: mapOverlay(40), tooltip(50), gallery(60), alert(70), commandPalette(80).

---

## Migration Checklist

Files containing **hardcoded values** that should eventually reference tokens:

| File | Hardcoded Values |
|------|-----------------|
| `app/map/page.tsx` | flyTo durations (1400, 1200, 800), z-50, text-red-500 |
| `components/map/map-view.tsx` | deck.gl RGBA arrays, rounded-[10px], w-80, top-10, left-10, h-6 w-6, shadow-lg, z-20, z-50 |
| `components/map/command-palette.tsx` | rounded-[20px], max-w-lg, pt-[15vh], max-h-[50vh], bg-black/25, text-[10px], w-[18px] h-[18px], z-50 |
| `components/map/object-panel.tsx` | width: "40%", width: "calc(100% - 5rem)", bottom: 20/left: 20/right: 20, rounded-2xl, h-44, shadow-lg, z-20, z-30 |
| `components/object-grid.tsx` | rounded-[10px], h-44, max-h-36, text-[10px], ring-2 ring-blue-500 |
| `components/image-gallery.tsx` | zIndex: 50, backgroundColor: "white", color: "black", inline styles |
| `components/blurhash-image.tsx` | duration-500, ease-out |
| `components/faceted-filter.tsx` | z-[1000], backdrop-blur-md |
| `app/globals.css` | All CSS custom properties, map control inline sizes, shadow values |
| `styles/globals.css` | Duplicate/conflicting CSS custom properties |
| `tailwind.config.js` | Hardcoded font stack, --radius, 1400px breakpoint |

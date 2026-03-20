/**
 * Ex Situ Design System — Unified Exports
 *
 * Single entry point for all design-system tokens and component specs.
 *
 * @example
 * ```ts
 * import { colors, typography, spacing, motion } from "@/lib/design-system"
 * ```
 */

// ── Tokens ──────────────────────────────────────────────────────────────────
export {
  colors,
  typography,
  spacing,
  layout,
  radii,
  shadows,
  backdrop,
  motion,
  zIndex,
  breakpoints,
  iconSizes,
  iconRegistry,
} from "./tokens"

// ── Component Types ─────────────────────────────────────────────────────────
export type {
  ContainerSize,
  FacetedFilters,
  DrillLevel,
  BreadcrumbSegment,
  GroupedOrigin,
  GroupedSite,
  InstitutionItem,
  MapLayoutProps,
  MapViewProps,
  ObjectPanelProps,
  CommandPaletteProps,
  CommandPaletteHandlers,
  PathStep,
  ObjectGridProps,
  ImageGalleryProps,
  BlurhashImageProps,
  SpinnerProps,
  FacetedFilterProps,
} from "./components"

/**
 * Ex Situ Custom Icon Library
 *
 * A unified set of SVG icons designed specifically for the Ex Situ app.
 * All icons use `currentColor` for stroke/fill, enabling color control
 * via CSS `color` or Tailwind `text-*` utilities.
 *
 * Default viewBox: 24×24. Size via className (e.g. "h-4 w-4") or width/height props.
 *
 * @example
 * ```tsx
 * import { IconClose, IconSearch } from "@/components/icons"
 * <IconClose className="h-4 w-4" />
 * ```
 */

import React from "react"

export interface IconProps extends React.SVGAttributes<SVGSVGElement> {
  /** Tailwind / CSS classes for sizing and color */
  className?: string
  /** Explicit width — defaults to 24 */
  width?: number | string
  /** Explicit height — defaults to 24 */
  height?: number | string
}

/* ── Close (×) ──────────────────────────────────────────────────────────── */
export const IconClose: React.FC<IconProps> = ({
  width = 24,
  height = 24,
  className,
  ...props
}) => (
  <svg
    width={width}
    height={height}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    {...props}
  >
    <path
      d="M18 6L6 18"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M6 6L18 18"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)
IconClose.displayName = "IconClose"

/* ── Search ─────────────────────────────────────────────────────────────── */
export const IconSearch: React.FC<IconProps> = ({
  width = 24,
  height = 24,
  className,
  ...props
}) => (
  <svg
    width={width}
    height={height}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    {...props}
  >
    <path
      d="M20.9999 21.0002L16.6599 16.6602"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M11 19C15.4183 19 19 15.4183 19 11C19 6.58172 15.4183 3 11 3C6.58172 3 3 6.58172 3 11C3 15.4183 6.58172 19 11 19Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)
IconSearch.displayName = "IconSearch"

/* ── Download CSV ───────────────────────────────────────────────────────── */
export const IconDownloadCsv: React.FC<IconProps> = ({
  width = 24,
  height = 24,
  className,
  ...props
}) => (
  <svg
    width={width}
    height={height}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    {...props}
  >
    <path
      d="M12 15V3"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M7 10L12 15L17 10"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)
IconDownloadCsv.displayName = "IconDownloadCsv"

/* ── Expand ─────────────────────────────────────────────────────────────── */
export const IconExpand: React.FC<IconProps> = ({
  width = 24,
  height = 24,
  className,
  ...props
}) => (
  <svg
    width={width}
    height={height}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    {...props}
  >
    <path
      d="M8 3H5C4.46957 3 3.96086 3.21071 3.58579 3.58579C3.21071 3.96086 3 4.46957 3 5V8"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M21 8V5C21 4.46957 20.7893 3.96086 20.4142 3.58579C20.0391 3.21071 19.5304 3 19 3H16"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M3 16V19C3 19.5304 3.21071 20.0391 3.58579 20.4142C3.96086 20.7893 4.46957 21 5 21H8"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M16 21H19C19.5304 21 20.0391 20.7893 20.4142 20.4142C20.7893 20.0391 21 19.5304 21 19V16"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)
IconExpand.displayName = "IconExpand"

/* ── Minimize ───────────────────────────────────────────────────────────── */
export const IconMinimize: React.FC<IconProps> = ({
  width = 24,
  height = 24,
  className,
  ...props
}) => (
  <svg
    width={width}
    height={height}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    {...props}
  >
    <path
      d="M8 3V6C8 6.53043 7.78929 7.03914 7.41421 7.41421C7.03914 7.78929 6.53043 8 6 8H3"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M21 8H18C17.4696 8 16.9609 7.78929 16.5858 7.41421C16.2107 7.03914 16 6.53043 16 6V3"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M3 16H6C6.53043 16 7.03914 16.2107 7.41421 16.5858C7.78929 16.9609 8 17.4696 8 18V21"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M16 21V18C16 17.4696 16.2107 16.9609 16.5858 16.5858C16.9609 16.2107 17.4696 16 18 16H21"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)
IconMinimize.displayName = "IconMinimize"

/* ── Object Panel Closed (toggle → open) ────────────────────────────────── */
export const IconPanelClosed: React.FC<IconProps> = ({
  width = 24,
  height = 24,
  className,
  ...props
}) => (
  <svg
    width={width}
    height={height}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    {...props}
  >
    <path
      d="M18.3 3H5.7C4.20883 3 3 4.20883 3 5.7V18.3C3 19.7912 4.20883 21 5.7 21H18.3C19.7912 21 21 19.7912 21 18.3V5.7C21 4.20883 19.7912 3 18.3 3Z"
      stroke="currentColor"
      strokeWidth="2"
    />
    <path
      d="M16.375 7H12.625C12.2798 7 12 7.3731 12 7.83333V16.1667C12 16.6269 12.2798 17 12.625 17H16.375C16.7202 17 17 16.6269 17 16.1667V7.83333C17 7.3731 16.7202 7 16.375 7Z"
      stroke="currentColor"
      strokeWidth="2"
    />
  </svg>
)
IconPanelClosed.displayName = "IconPanelClosed"

/* ── Object Panel Open (toggle → close) ─────────────────────────────────── */
export const IconPanelOpen: React.FC<IconProps> = ({
  width = 24,
  height = 24,
  className,
  ...props
}) => (
  <svg
    width={width}
    height={height}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    {...props}
  >
    <path
      d="M18.3 3H5.7C4.20883 3 3 4.20883 3 5.7V18.3C3 19.7912 4.20883 21 5.7 21H18.3C19.7912 21 21 19.7912 21 18.3V5.7C21 4.20883 19.7912 3 18.3 3Z"
      stroke="currentColor"
      strokeWidth="2"
    />
    <path
      d="M16.375 7H12.625C12.2798 7 12 7.3731 12 7.83333V16.1667C12 16.6269 12.2798 17 12.625 17H16.375C16.7202 17 17 16.6269 17 16.1667V7.83333C17 7.3731 16.7202 7 16.375 7Z"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="2"
    />
  </svg>
)
IconPanelOpen.displayName = "IconPanelOpen"

/* ── Share ───────────────────────────────────────────────────────────────── */
export const IconShare: React.FC<IconProps> = ({
  width = 24,
  height = 24,
  className,
  ...props
}) => (
  <svg
    width={width}
    height={height}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    {...props}
  >
    <path
      d="M12 2V15"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M16 6L12 2L8 6"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M4 12V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V12"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)
IconShare.displayName = "IconShare"

/* ── Source (external link with arrow) ──────────────────────────────────── */
export const IconSource: React.FC<IconProps> = ({
  width = 24,
  height = 24,
  className,
  ...props
}) => (
  <svg
    width={width}
    height={height}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    {...props}
  >
    <path
      d="M8 10H14V16"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M3.5 20L14 10"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M3 12.6L3 5.4C3 4.76348 3.25286 4.15303 3.70294 3.70294C4.15303 3.25286 4.76348 3 5.4 3L18.6 3C19.2365 3 19.847 3.25286 20.2971 3.70295C20.7471 4.15303 21 4.76348 21 5.4L21 18.6C21 19.2365 20.7471 19.847 20.2971 20.2971C19.847 20.7471 19.2365 21 18.6 21L11.4 21"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)
IconSource.displayName = "IconSource"

/* ── Raw SVG strings for non-React contexts (Mapbox IControl) ───────────── */

export const iconSvgStrings = {
  close: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 6L18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,

  search: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20.9999 21.0002L16.6599 16.6602" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 19C15.4183 19 19 15.4183 19 11C19 6.58172 15.4183 3 11 3C6.58172 3 3 6.58172 3 11C3 15.4183 6.58172 19 11 19Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,

  downloadCsv: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 15V3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 10L12 15L17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,

  expand: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 3H5C4.46957 3 3.96086 3.21071 3.58579 3.58579C3.21071 3.96086 3 4.46957 3 5V8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 8V5C21 4.46957 20.7893 3.96086 20.4142 3.58579C20.0391 3.21071 19.5304 3 19 3H16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 16V19C3 19.5304 3.21071 20.0391 3.58579 20.4142C3.96086 20.7893 4.46957 21 5 21H8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 21H19C19.5304 21 20.0391 20.7893 20.4142 20.4142C20.7893 20.0391 21 19.5304 21 19V16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,

  minimize: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 3V6C8 6.53043 7.78929 7.03914 7.41421 7.41421C7.03914 7.78929 6.53043 8 6 8H3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 8H18C17.4696 8 16.9609 7.78929 16.5858 7.41421C16.2107 7.03914 16 6.53043 16 6V3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 16H6C6.53043 16 7.03914 16.2107 7.41421 16.5858C7.78929 16.9609 8 17.4696 8 18V21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 21V18C16 17.4696 16.2107 16.9609 16.5858 16.5858C16.9609 16.2107 17.4696 16 18 16H21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,

  panelClosed: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18.3 3H5.7C4.20883 3 3 4.20883 3 5.7V18.3C3 19.7912 4.20883 21 5.7 21H18.3C19.7912 21 21 19.7912 21 18.3V5.7C21 4.20883 19.7912 3 18.3 3Z" stroke="currentColor" stroke-width="2"/><path d="M16.375 7H12.625C12.2798 7 12 7.3731 12 7.83333V16.1667C12 16.6269 12.2798 17 12.625 17H16.375C16.7202 17 17 16.6269 17 16.1667V7.83333C17 7.3731 16.7202 7 16.375 7Z" stroke="currentColor" stroke-width="2"/></svg>`,

  panelOpen: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18.3 3H5.7C4.20883 3 3 4.20883 3 5.7V18.3C3 19.7912 4.20883 21 5.7 21H18.3C19.7912 21 21 19.7912 21 18.3V5.7C21 4.20883 19.7912 3 18.3 3Z" stroke="currentColor" stroke-width="2"/><path d="M16.375 7H12.625C12.2798 7 12 7.3731 12 7.83333V16.1667C12 16.6269 12.2798 17 12.625 17H16.375C16.7202 17 17 16.6269 17 16.1667V7.83333C17 7.3731 16.7202 7 16.375 7Z" fill="currentColor" stroke="currentColor" stroke-width="2"/></svg>`,

  share: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2V15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 6L12 2L8 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 12V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,

  source: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 8H16V14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 19L16 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 11L6 5C6 4.46957 6.21072 3.96086 6.58579 3.58579C6.96086 3.21071 7.46957 3 8 3L19 3C19.5304 3 20.0391 3.21071 20.4142 3.58579C20.7893 3.96086 21 4.46957 21 5L21 16C21 16.5304 20.7893 17.0391 20.4142 17.4142C20.0391 17.7893 19.5304 18 19 18L13 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
} as const

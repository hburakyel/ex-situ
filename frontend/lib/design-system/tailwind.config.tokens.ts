/**
 * Ex Situ Design System — Tailwind Theme Extension
 *
 * Drop-in `theme.extend` configuration that consumes the token values
 * from lib/design-system/tokens.ts. This file mirrors the structure of
 * the existing tailwind.config.js — values are not changed, only
 * centralized.
 *
 * Usage in tailwind.config.js:
 *   const { themeExtend } = require("./lib/design-system/tailwind.config.tokens")
 *   module.exports = { theme: { extend: themeExtend } }
 *
 * ⚠  This file is READ-ONLY documentation of what exists.
 *    Do not add new tokens — extract only.
 */

import { colors, typography, radii, shadows, layout, breakpoints, motion } from "./tokens"

/**
 * `theme.extend` block — plug this into your tailwind.config.js.
 * All values are sourced from tokens.ts.
 */
export const themeExtend = {
  /* ── Container ────────────────────────────────────────────────────────── */
  container: {
    center: true,
    padding: "2rem",
    screens: {
      "2xl": layout.containerMax2xl,  // "1400px"
    },
  },

  /* ── Screens / Breakpoints ────────────────────────────────────────────── */
  screens: {
    xs: breakpoints.xs,      // "480px"
    "2xl": breakpoints["2xl"], // "1400px"
  },

  /* ── Colors ───────────────────────────────────────────────────────────── */
  /**
   * Existing tailwind.config.js uses CSS custom properties via
   * `hsl(var(--<name>))`. This block maps semantic names to the same
   * variables so the existing codebase continues to work.
   *
   * @source tailwind.config.js
   */
  colors: {
    border: "hsl(var(--border))",
    input: "hsl(var(--input))",
    ring: "hsl(var(--ring))",
    background: "hsl(var(--background))",
    foreground: "hsl(var(--foreground))",
    primary: {
      DEFAULT: "hsl(var(--primary))",
      foreground: "hsl(var(--primary-foreground))",
    },
    secondary: {
      DEFAULT: "hsl(var(--secondary))",
      foreground: "hsl(var(--secondary-foreground))",
    },
    destructive: {
      DEFAULT: "hsl(var(--destructive))",
      foreground: "hsl(var(--destructive-foreground))",
    },
    muted: {
      DEFAULT: "hsl(var(--muted))",
      foreground: "hsl(var(--muted-foreground))",
    },
    accent: {
      DEFAULT: "hsl(var(--accent))",
      foreground: "hsl(var(--accent-foreground))",
    },
    popover: {
      DEFAULT: "hsl(var(--popover))",
      foreground: "hsl(var(--popover-foreground))",
    },
    card: {
      DEFAULT: "hsl(var(--card))",
      foreground: "hsl(var(--card-foreground))",
    },
    /* Sidebar tokens (from styles/globals.css) */
    sidebar: {
      DEFAULT: "hsl(var(--sidebar-background))",
      foreground: "hsl(var(--sidebar-foreground))",
      primary: "hsl(var(--sidebar-primary))",
      "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
      accent: "hsl(var(--sidebar-accent))",
      "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
      border: "hsl(var(--sidebar-border))",
      ring: "hsl(var(--sidebar-ring))",
    },
    /* Chart tokens (from styles/globals.css) */
    chart: {
      1: "hsl(var(--chart-1))",
      2: "hsl(var(--chart-2))",
      3: "hsl(var(--chart-3))",
      4: "hsl(var(--chart-4))",
      5: "hsl(var(--chart-5))",
    },
  },

  /* ── Border Radius ────────────────────────────────────────────────────── */
  borderRadius: {
    lg: radii.lg,     // "var(--radius)"  → 0.5rem
    md: radii.md,     // "calc(var(--radius) - 2px)"
    sm: radii.sm,     // "calc(var(--radius) - 4px)"
    tile: radii.tile, // "10px"
    panel: radii.panel,   // "1rem"
    palette: radii.palette, // "1.25rem"
    control: radii.control, // "6px"
  },

  /* ── Font Family ──────────────────────────────────────────────────────── */
  /**
   * Both `sans` and `mono` resolve to the same monospace stack.
   * @source tailwind.config.js
   */
  fontFamily: {
    sans: [typography.fontFamily],
    mono: [typography.fontFamily],
  },

  /* ── Shadows ──────────────────────────────────────────────────────────── */
  boxShadow: {
    lg: shadows.lg,
    xl: shadows.xl,
    "2xl": shadows["2xl"],
    control: shadows.control,
    tooltip: shadows.tooltip,
    subtle: shadows.subtle,
    gallery: shadows.gallery,
    dropdown: shadows.dropdown,
  },

  /* ── Animations ───────────────────────────────────────────────────────── */
  /**
   * Accordion animations from existing tailwind.config.js.
   * @source tailwind.config.js (keyframes + animation)
   */
  keyframes: {
    "accordion-down": {
      from: { height: "0" },
      to: { height: "var(--radix-accordion-content-height)" },
    },
    "accordion-up": {
      from: { height: "var(--radix-accordion-content-height)" },
      to: { height: "0" },
    },
  },
  animation: {
    "accordion-down": `accordion-down ${motion.accordion.duration} ${motion.accordion.easing}`,
    "accordion-up": `accordion-up ${motion.accordion.duration} ${motion.accordion.easing}`,
  },
} as const

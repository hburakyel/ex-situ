// Cookie-free analytics (self-hosted Umami, see docs/ANALYTICS.md).
// track() is a no-op when the Umami script isn't configured or is blocked,
// so call sites never need to check for it.

export type AnalyticsEvent =
  | "arc_click"
  | "territory_drilldown"
  | "artifact_open"
  | "outbound_institution_click"
  | "share_click"
  | "command_palette_search"

type EventData = Record<string, string | number | boolean | null | undefined>

declare global {
  interface Window {
    umami?: { track: (event: string, data?: Record<string, string | number | boolean>) => void }
  }
}

// Umami caps string values at 500 characters; keep payloads small and never send free-form user input whole.
const MAX_VALUE = 100

export function track(event: AnalyticsEvent, data?: EventData): void {
  if (typeof window === "undefined" || !window.umami?.track) return
  const clean: Record<string, string | number | boolean> = {}
  for (const [k, v] of Object.entries(data ?? {})) {
    if (v === null || v === undefined || v === "") continue
    clean[k] = typeof v === "string" ? v.slice(0, MAX_VALUE) : v
  }
  try {
    window.umami.track(event, clean)
  } catch {
    // Analytics must never break the page.
  }
}

/** Hostname of an outbound link (the institution's site), without the path. */
export function linkHost(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).hostname
  } catch {
    return undefined
  }
}

import Script from "next/script"

// Umami tracker, only when both env vars are set (so dev and forks send nothing).
// data-exclude-search: the map writes lat/lng/zoom into the query string on every
// pan, which Umami would otherwise count as a page view each time.
// data-domains: only count the production host, never localhost or previews.

const SRC = process.env.NEXT_PUBLIC_UMAMI_SRC
const WEBSITE_ID = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID
const DOMAINS = process.env.NEXT_PUBLIC_UMAMI_DOMAINS

export default function AnalyticsScript() {
  if (!SRC || !WEBSITE_ID) return null
  return (
    <Script
      src={SRC}
      data-website-id={WEBSITE_ID}
      data-exclude-search="true"
      data-exclude-hash="true"
      data-do-not-track="true"
      {...(DOMAINS ? { "data-domains": DOMAINS } : {})}
      strategy="afterInteractive"
    />
  )
}

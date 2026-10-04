// Server-side allowlist for museum image URLs the API routes are allowed to
// fetch (/api/proxy/img, /api/proxy/institution-image). Anything else — other
// hosts, private/loopback addresses, non-http(s) schemes — is rejected so the
// routes can't be used to reach internal services (SSRF).

// NO localhost/127.0.0.1 here
const ALLOWED_IMAGE_DOMAINS = new Set([
  "images.metmuseum.org",
  "collectionapi.metmuseum.org",
  "www.britishmuseum.org",
  "recherche.smb.museum",
  "upload.wikimedia.org",
  "commons.wikimedia.org",
  "id.smb.museum",
  "framemark.vam.ac.uk",
  "smb.museum-digital.de",
  "asset.museum-digital.org",
  "search.smb.museum",
  "www.artic.edu",
])

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^fc00:/i,
  /^fe80:/i,
  /^::1$/,
  /^fd/i,
]

const PRIVATE_HOSTNAMES = new Set(["localhost", "ip6-localhost", "ip6-loopback"])

const isPrivateIp = (hostname: string): boolean =>
  PRIVATE_HOSTNAMES.has(hostname.toLowerCase()) ||
  PRIVATE_IP_PATTERNS.some((pattern) => pattern.test(hostname))

export function isAllowedImageUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return false
    if (isPrivateIp(url.hostname)) return false
    return ALLOWED_IMAGE_DOMAINS.has(url.hostname)
  } catch {
    return false
  }
}

const MAX_REDIRECTS = 3

// fetch() that follows redirects by hand, re-checking every hop against the
// allowlist — default redirect-following would let an open redirect on an
// allowed host bounce the request to an arbitrary (internal) address.
export async function fetchAllowedImage(url: string, init: RequestInit): Promise<Response> {
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedImageUrl(current)) throw new Error("Disallowed image URL")
    const headers = new Headers(init.headers)
    if (headers.has("Referer")) headers.set("Referer", new URL(current).origin + "/")
    const res = await fetch(current, { ...init, headers, redirect: "manual" })
    const location = res.headers.get("location")
    if (res.status < 300 || res.status >= 400 || !location) return res
    current = new URL(location, current).toString()
  }
  throw new Error("Too many redirects")
}

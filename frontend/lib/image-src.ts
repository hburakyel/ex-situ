// Maps a stored museum img_url to the URL the browser should actually load.
//
// - images.metmuseum.org: img_url points at /original/ (often 5–10 MB). The
//   same path under /web-large/ is the Met's own ~1024px display rendition, and
//   /mobile-large/ its ~355px one — enough for a grid tile and ~2.5× smaller,
//   which matters on a phone connection.
// - www.artic.edu: AIC's IIIF server sits behind Cloudflare, which blocks
//   hotlinked browser requests ("Sorry, you have been blocked"). It only lets
//   through requests carrying AIC's documented AIC-User-Agent header, which a
//   browser <img> can't send — so route through /api/proxy/img, which adds it.
//   (It must live under /api/proxy/: production nginx sends every other
//   /api/* path to Strapi, not Next.) AIC also allows only some sizes (see
//   AIC_THUMB_WIDTH); a source narrower than the width asked for is retried at
//   its own width by the proxy (aicInfoUrl, aicUrlAtWidth), and a size that
//   stalls is asked for at another allowed width (aicAlternateUrl).
// - id.smb.museum: hotlink-blocks headerless requests; proxied for the same reason.
// - www.weltmuseumwien.at: /pics/ files are the full-size scans (often 300 KB+) and
//   the page's own thumbnails have hashed names; proxied so tiles are resized.
// - search.smb.museum: stored URLs are the 1200px "extra_large"; "large" is 600px and
//   about a third of the bytes (checked on a sample of 60 records).
// - framemark.vam.ac.uk: stored URLs ask for an 800px box; tiles take 600.
// - upload.wikimedia.org is left alone: a width other than the stored 960px mostly
//   answers 429, and a failed tile falls back to its inventory number.
// - ids.si.edu (Smithsonian): stored URLs have no size; "max" asks for a web-sized one.
// - recherche.smb.museum: dead (301 to the homepage). Rows not yet remapped by
//   etl/refetch_smb_image_urls.py point there; the same asset lives on
//   search.smb.museum (see smbSearchUrl).

const PROXIED_HOSTS = new Set(["id.smb.museum", "www.artic.edu", "www.weltmuseumwien.at"])

export const THUMB_WIDTH = 300
export const LARGE_WIDTH = 800

// AIC's IIIF allowlist answers 403 to "!w,h", "full", "max", "pct:" and to most
// widths. 400 and 843 are on the list; 843 is the width AIC documents.
const AIC_THUMB_WIDTH = 400
const AIC_LARGE_WIDTH = 843

// search.smb.museum buckets assets as dir1 = (id/1000) % 1000, dir2 = id/1e6
// (left out when 0) — same layout as compute_search_url in the ETL.
function smbSearchUrl(assetId: number, rendition: "large" | "extra_large"): string {
  const q1 = Math.floor(assetId / 1000)
  const pad = (n: number) => String(n).padStart(3, "0")
  const dir2 = Math.floor(q1 / 1000)
  const dirs = dir2 === 0 ? pad(q1 % 1000) : `${pad(q1 % 1000)}/${pad(dir2)}`
  return `https://search.smb.museum/media/images/thumbs/${rendition}/${dirs}/${assetId}.jpg`
}

// AIC refuses (403, sometimes 500) a width above the source's own. info.json
// gives that width, which the allowlist lets through.
export function aicInfoUrl(src: string): string {
  return src.replace(/\/full\/.*$/, "/info.json")
}

export function aicUrlAtWidth(src: string, sourceWidth: number): string {
  return src.replace(/\/full\/[^/]+\//, `/full/${Math.min(sourceWidth, AIC_LARGE_WIDTH)},/`)
}

// The next allowed size down, for a request that stalled at AIC: the proxy shrinks
// to the width asked for, so tiles and the large view look the same.
export function aicAlternateUrl(src: string): string {
  return src.replace(`/full/${AIC_THUMB_WIDTH},/`, "/full/600,/").replace(`/full/${AIC_LARGE_WIDTH},/`, "/full/800,/")
}

export function resolveImageSrc(src: string, width: number = THUMB_WIDTH): string {
  let url: URL
  try {
    url = new URL(src)
  } catch {
    return src // relative or invalid — leave as-is
  }

  if (url.hostname === "recherche.smb.museum") {
    const m = url.pathname.match(/\/(\d+)(?:_\d+x\d+)?\.jpe?g$/i)
    if (m) return smbSearchUrl(Number(m[1]), width <= THUMB_WIDTH ? "large" : "extra_large")
  }

  if (url.hostname === "search.smb.museum" && width <= THUMB_WIDTH) {
    url.pathname = url.pathname.replace("/thumbs/extra_large/", "/thumbs/large/")
    return url.toString()
  }

  if (url.hostname === "framemark.vam.ac.uk" && width <= THUMB_WIDTH) {
    url.pathname = url.pathname.replace("/full/!800,800/", "/full/!600,600/")
    return url.toString()
  }

  if (url.hostname === "images.metmuseum.org" && url.pathname.includes("/original/")) {
    url.pathname = url.pathname.replace("/original/", width <= THUMB_WIDTH ? "/mobile-large/" : "/web-large/")
    return url.toString()
  }

  if (url.hostname === "www.artic.edu") {
    // The proxy resizes to the exact width; ask AIC for the nearest allowed one.
    const aicWidth = width <= THUMB_WIDTH ? AIC_THUMB_WIDTH : AIC_LARGE_WIDTH
    url.pathname = url.pathname.replace(/\/full\/[^/]+\//, `/full/${aicWidth},/`)
  }

  if (url.hostname === "iiif.micr.io") {
    // Rijksmuseum (IIIF 3): stored URLs request "1000," wide, which is rejected (400)
    // when the image is narrower — IIIF 3 does not upscale without "^"
    // (RP-F-F01141-AV is 970px). "!w,h" fits within the box and works for every size.
    const box = width <= THUMB_WIDTH ? 600 : 1000
    url.pathname = url.pathname.replace(/\/full\/\d+,\//, `/full/!${box},${box}/`)
    return url.toString()
  }

  if (url.hostname === "ids.si.edu") {
    // Smithsonian IDS: stored URLs carry no size and return the full image; "max"
    // caps the longer side (it does not upscale).
    url.searchParams.set("max", String(width <= THUMB_WIDTH ? 600 : 1000))
    return url.toString()
  }

  if (PROXIED_HOSTS.has(url.hostname)) {
    return `/api/proxy/img?url=${encodeURIComponent(url.toString())}&w=${width}`
  }

  return src
}

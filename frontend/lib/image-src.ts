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
//   /api/* path to Strapi, not Next.)
// - id.smb.museum: hotlink-blocks headerless requests; proxied for the same reason.
// - recherche.smb.museum: dead (301 to the homepage). Rows not yet remapped by
//   etl/refetch_smb_image_urls.py point there; the same asset lives on
//   search.smb.museum (see smbSearchUrl).

const PROXIED_HOSTS = new Set(["id.smb.museum", "www.artic.edu"])

export const THUMB_WIDTH = 300
export const LARGE_WIDTH = 800

// search.smb.museum buckets assets as dir1 = (id/1000) % 1000, dir2 = id/1e6
// (left out when 0) — same layout as compute_search_url in the ETL.
function smbSearchUrl(assetId: number): string {
  const q1 = Math.floor(assetId / 1000)
  const pad = (n: number) => String(n).padStart(3, "0")
  const dir2 = Math.floor(q1 / 1000)
  const dirs = dir2 === 0 ? pad(q1 % 1000) : `${pad(q1 % 1000)}/${pad(dir2)}`
  return `https://search.smb.museum/media/images/thumbs/extra_large/${dirs}/${assetId}.jpg`
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
    if (m) return smbSearchUrl(Number(m[1]))
  }

  if (url.hostname === "images.metmuseum.org" && url.pathname.includes("/original/")) {
    url.pathname = url.pathname.replace("/original/", width <= THUMB_WIDTH ? "/mobile-large/" : "/web-large/")
    return url.toString()
  }

  if (url.hostname === "www.artic.edu") {
    // Stored URLs request a fixed "843," width, which IIIF 2 rejects (403) when
    // the source is narrower than 843px. "!843,843" fits within the box
    // without upscaling, so it works for every source size.
    url.pathname = url.pathname.replace(/\/full\/\d+,\//, "/full/!843,843/")
  }

  if (PROXIED_HOSTS.has(url.hostname)) {
    return `/api/proxy/img?url=${encodeURIComponent(url.toString())}&w=${width}`
  }

  return src
}

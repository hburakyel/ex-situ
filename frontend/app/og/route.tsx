import { readFile } from "node:fs/promises"
import path from "node:path"
import { ImageResponse } from "next/og"
import { type NextRequest } from "next/server"
import sharp from "sharp"
import { openImageCredit } from "@/lib/image-rights"
import { resolveImageSrc, LARGE_WIDTH } from "@/lib/image-src"
import { fetchAllowedImage, isAllowedImageUrl } from "@/lib/remote-image-url"

// Link-preview image for a place or museum view of the map (/og?place=Egypt&site=Luxor):
// the view's objects as a grid, like the object grid, with where they come from and the
// image credit underneath. Only images whose licence allows showing them outside the
// museum's own credit (openImageCredit). Fewer images → a smaller grid or one image;
// none, or the API down → the site's arcs image.

export const runtime = "nodejs"

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:1337/api").replace("localhost", "127.0.0.1")
const W = 1200
const H = 630
const TOP = 26
const BOTTOM = 70
const SIDE = 24
const RADIUS = 6
// Link-preview crawlers give up after a few seconds: images not loaded by then are left out.
const IMAGE_BUDGET_MS = 4000
const PARAMS = ["place", "site", "precise", "institution"] as const

type Obj = {
  img_url: string | null
  institution_name: string | null
  institution_city_en: string | null
  country_en: string | null
  image_rights: string | null
}

const cache = new Map<string, { body: Buffer; at: number }>()
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const MAX_CACHE_ENTRIES = 100

const jpeg = (body: Buffer) =>
  new Response(new Uint8Array(body), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" },
  })

async function fallback() {
  return jpeg(await readFile(path.join(process.cwd(), "public/og-image.jpg")))
}

async function fetchPage(q: Record<string, string>, page: number) {
  const params = new URLSearchParams({ onlyWithImages: "true", pageSize: "100", page: String(page) })
  if (q.place) params.set("country", q.place)
  if (q.site) params.set("site", q.site)
  if (q.precise) params.set("precise", q.precise)
  if (q.institution) params.set("institution", q.institution)
  const res = await fetch(`${API_BASE}/museum-objects/by-country?${params}`, {
    headers: { "User-Agent": "ExSitu/1.0" },
    signal: AbortSignal.timeout(5000),
    cache: "no-store",
  })
  if (!res.ok) return { objects: [] as Obj[], pageCount: 0 }
  const json = await res.json()
  return {
    objects: (json.data ?? []).map((o: { attributes?: Obj }) => o.attributes ?? o) as Obj[],
    pageCount: Number(json.meta?.pagination?.pageCount) || 1,
  }
}

// The list comes grouped by import, so one page is often one museum (Egypt's first
// pages are all Weltmuseum): read pages from across the list and alternate museums.
async function fetchObjects(q: Record<string, string>): Promise<Obj[]> {
  const first = await fetchPage(q, 1)
  const more = [...new Set([0.25, 0.5, 0.75].map((f) => Math.max(2, Math.round(first.pageCount * f))))]
    .filter((p) => p <= first.pageCount)
  const pages = [first, ...(await Promise.all(more.map((p) => fetchPage(q, p))))]
  const byMuseum = new Map<string, Obj[]>()
  for (const o of pages.flatMap((p) => p.objects)) {
    const key = o.institution_name ?? ""
    byMuseum.set(key, [...(byMuseum.get(key) ?? []), o])
  }
  const queues = [...byMuseum.values()]
  const mixed: Obj[] = []
  for (let i = 0; queues.some((q) => i < q.length); i++) for (const q of queues) if (i < q.length) mixed.push(q[i])
  return mixed
}

// An object's image, scaled down to at most the preview's size.
async function loadImage(src: string): Promise<Buffer | null> {
  // resolveImageSrc picks a web-sized rendition; proxied hosts come back as our own
  // /api/proxy/img path, so fetch those from the museum directly.
  const resolved = resolveImageSrc(src, LARGE_WIDTH)
  const url = resolved.startsWith("/api/proxy/img") ? src : resolved
  if (!isAllowedImageUrl(url)) return null
  try {
    const res = await fetchAllowedImage(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(IMAGE_BUDGET_MS),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ExSitu/1.0; +https://exsitu.app)",
        "Referer": new URL(url).origin + "/",
      },
    })
    if (!res.ok) return null
    return await sharp(Buffer.from(await res.arrayBuffer())).rotate()
      .resize(W, H, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer()
  } catch {
    return null
  }
}

function list(values: (string | null | undefined)[], max: number) {
  const unique = [...new Set(values.filter((v): v is string => !!v))].sort()
  return unique.length > max ? `${unique.slice(0, max).join(", ")} +${unique.length - max}` : unique.join(", ")
}

async function render(q: Record<string, string>): Promise<Buffer | null> {
  const candidates = (await fetchObjects(q))
    .map((o) => ({ o, credit: o.img_url ? openImageCredit(o.institution_name ?? "", o.image_rights) : null }))
    .filter((c) => c.credit)
    .slice(0, 36)
  if (candidates.length === 0) return null

  // Pick the layout the loaded images fill.
  const loaded = (await Promise.all(candidates.map(async (c) => ({ ...c, img: await loadImage(c.o.img_url!) }))))
    .filter((c) => c.img)
  const [cols, rows] = loaded.length >= 24 ? [8, 3] : loaded.length >= 12 ? [6, 2] : loaded.length >= 1 ? [1, 1] : [0, 0]
  if (!cols) return null
  const shown = loaded.slice(0, cols * rows)

  const cw = (W - 2 * SIDE) / cols
  const ch = (H - TOP - BOTTOM) / rows
  const pad = cols === 1 ? 0 : 10
  const tiles = await Promise.all(shown.map(async (c, i) => {
    const w = Math.round(cw - 2 * pad), h = Math.round(ch - 2 * pad)
    const buf = await sharp(c.img!).resize(w * 2, h * 2, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer()
    const meta = await sharp(buf).metadata()
    const scale = Math.min(w / (meta.width ?? w), h / (meta.height ?? h))
    const tw = Math.round((meta.width ?? w) * scale), th = Math.round((meta.height ?? h) * scale)
    const x = SIDE + (i % cols) * cw, y = TOP + Math.floor(i / cols) * ch
    return { src: `data:image/jpeg;base64,${buf.toString("base64")}`, left: x + (cw - tw) / 2, top: y + pad + (h - th) / 2, width: tw, height: th }
  }))

  // Like the image gallery's caption: "Luxor, Egypt → Amsterdam, Baltimore".
  const from = q.precise || q.site
    ? [q.precise || q.site, q.place].filter(Boolean).join(", ")
    : q.place || list(shown.map((c) => c.o.country_en), 6)
  const to = list(shown.map((c) => c.o.institution_city_en), 4)
  const credits = new Map<string, string>()
  for (const c of shown) credits.set(c.credit!.name, c.credit!.licence)
  const imageCredit = `Images: ${[...credits].map(([name, licence]) => `${name} (${licence})`).join(" · ")} · via exsitu.app`
  const lineStyle = { display: "flex", alignItems: "center", whiteSpace: "nowrap", overflow: "hidden", maxWidth: "100%" } as const

  const font = await readFile(path.join(process.cwd(), "app/og/NotoSansMono-Regular.ttf"))
  const image = new ImageResponse(
    (
      <div style={{ display: "flex", width: W, height: H, background: "#fff", position: "relative" }}>
        {tiles.map((t, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src={t.src} width={t.width} height={t.height} style={{ position: "absolute", left: t.left, top: t.top, borderRadius: RADIUS }} />
        ))}
        <div style={{ position: "absolute", right: SIDE + 10, left: SIDE + 10, bottom: 14, display: "flex", flexDirection: "column", alignItems: "flex-end", fontSize: 13, lineHeight: 1.5, color: "#8c8c8c", fontFamily: "Noto Sans Mono" }}>
          <div style={lineStyle}>
            {from}
            {/* components/icons IconArrowRight */}
            {from && to && (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ margin: "0 7px" }}>
                <path d="M4 12H20" stroke="#8c8c8c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M15.75 7.75L20 12L15.75 16.25" stroke="#8c8c8c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            {to}
          </div>
          <div style={lineStyle}>{imageCredit}</div>
        </div>
      </div>
    ),
    { width: W, height: H, fonts: [{ name: "Noto Sans Mono", data: font, weight: 400, style: "normal" }] },
  )
  return sharp(Buffer.from(await image.arrayBuffer())).jpeg({ quality: 88 }).toBuffer()
}

export async function GET(request: NextRequest) {
  const q: Record<string, string> = {}
  for (const key of PARAMS) {
    const value = request.nextUrl.searchParams.get(key)?.trim()
    if (value && value.length <= 200) q[key] = value
  }
  if (!q.place && !q.institution) return fallback()

  const key = JSON.stringify(q)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return jpeg(hit.body)

  const body = await render(q).catch((err) => {
    console.error("[og] render failed", err)
    return null
  })
  if (!body) return fallback()
  if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!)
  cache.set(key, { body, at: Date.now() })
  return jpeg(body)
}

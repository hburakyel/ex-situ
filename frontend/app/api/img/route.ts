import { NextRequest, NextResponse } from "next/server"
import { encode } from "blurhash"
import sharp from "sharp"

export const runtime = "nodejs"

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const DEFAULT_WIDTH = 300
const MAX_WIDTH = 800
const BLURHASH_SIZE = 32

// Allowed image source domains — NO localhost/127.0.0.1 (SSRF prevention)
const ALLOWED_IMAGE_DOMAINS = new Set([
  "images.metmuseum.org",
  "collectionapi.metmuseum.org",
  "www.britishmuseum.org",
  "recherche.smb.museum",
  "upload.wikimedia.org",
  "commons.wikimedia.org",
  "id.smb.museum",
])

// Block private/internal IP ranges and hostnames to prevent SSRF
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

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return false
    if (isPrivateIp(url.hostname)) return false
    if (!ALLOWED_IMAGE_DOMAINS.has(url.hostname)) return false
    return true
  } catch {
    return false
  }
}

// In-memory cache for resized images (key: url+width → { buffer, headers })
const imageCache = new Map<string, { buffer: Buffer; contentType: string; blurhash: string; w: number; h: number; timestamp: number }>()
const MAX_CACHE_ENTRIES = 200
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

function evictStaleEntries() {
  if (imageCache.size <= MAX_CACHE_ENTRIES) return
  const now = Date.now()
  for (const [key, entry] of imageCache) {
    if (now - entry.timestamp > CACHE_TTL_MS || imageCache.size > MAX_CACHE_ENTRIES) {
      imageCache.delete(key)
    }
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const url = searchParams.get("url")

  if (!url || !isValidUrl(url)) {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 })
  }

  const wParam = Number(searchParams.get("w"))
  const targetWidth = Number.isFinite(wParam)
    ? Math.min(Math.max(wParam, 50), MAX_WIDTH)
    : DEFAULT_WIDTH

  const cacheKey = `${url}:${targetWidth}`

  // Check in-memory cache
  const cached = imageCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return new NextResponse(cached.buffer, {
      status: 200,
      headers: {
        "Content-Type": cached.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Blurhash": cached.blurhash,
        "X-Blurhash-Width": String(cached.w),
        "X-Blurhash-Height": String(cached.h),
        "Access-Control-Expose-Headers": "X-Blurhash, X-Blurhash-Width, X-Blurhash-Height",
      },
    })
  }

  // Fetch original image
  let response: Response
  try {
    response = await fetch(url, { next: { revalidate: 86400 } })
  } catch {
    return NextResponse.json({ error: "Failed to fetch image" }, { status: 502 })
  }

  if (!response.ok) {
    return NextResponse.json({ error: "Failed to fetch image" }, { status: 502 })
  }

  const contentLength = response.headers.get("content-length")
  if (contentLength && Number(contentLength) > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Image too large" }, { status: 413 })
  }

  const originalBuffer = Buffer.from(await response.arrayBuffer())
  if (originalBuffer.length > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Image too large" }, { status: 413 })
  }

  try {
    // Resize to target width for the thumbnail
    const resized = await sharp(originalBuffer)
      .resize(targetWidth, undefined, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 75, progressive: true })
      .toBuffer({ resolveWithObject: true })

    // Generate blurhash from a small version
    const { data: bhData, info: bhInfo } = await sharp(originalBuffer)
      .ensureAlpha()
      .resize(BLURHASH_SIZE, BLURHASH_SIZE, { fit: "inside" })
      .raw()
      .toBuffer({ resolveWithObject: true })

    const blurhash = encode(new Uint8ClampedArray(bhData), bhInfo.width, bhInfo.height, 4, 4)

    // Store in cache
    evictStaleEntries()
    imageCache.set(cacheKey, {
      buffer: resized.data,
      contentType: "image/jpeg",
      blurhash,
      w: bhInfo.width,
      h: bhInfo.height,
      timestamp: Date.now(),
    })

    return new NextResponse(resized.data, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Blurhash": blurhash,
        "X-Blurhash-Width": String(bhInfo.width),
        "X-Blurhash-Height": String(bhInfo.height),
        "Access-Control-Expose-Headers": "X-Blurhash, X-Blurhash-Width, X-Blurhash-Height",
      },
    })
  } catch {
    return NextResponse.json({ error: "Failed to process image" }, { status: 500 })
  }
}

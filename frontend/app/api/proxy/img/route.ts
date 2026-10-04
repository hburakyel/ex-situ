import { NextRequest, NextResponse } from "next/server"
import sharp from "sharp"
import { fetchAllowedImage, isAllowedImageUrl } from "@/lib/remote-image-url"

export const runtime = "nodejs"

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const DEFAULT_WIDTH = 300
const MAX_WIDTH = 800

// In-memory cache for resized images (key: url+width → { buffer, headers })
const imageCache = new Map<string, { buffer: Buffer; contentType: string; timestamp: number }>()
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

  if (!url || !isAllowedImageUrl(url)) {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 })
  }

  const wParam = Number(searchParams.get("w"))
  const targetWidth = Number.isFinite(wParam)
    ? Math.min(Math.max(wParam, 50), MAX_WIDTH)
    : DEFAULT_WIDTH

  const cacheKey = `${url}:${targetWidth}`

  const toResponseBody = (buffer: Buffer): ArrayBuffer =>
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer

  // Check in-memory cache
  const cached = imageCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return new NextResponse(toResponseBody(cached.buffer), {
      status: 200,
      headers: {
        "Content-Type": cached.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    })
  }

  // Fetch original image. Some museum CDNs (e.g. id.smb.museum) hotlink-block
  // headerless requests, so spoof a browser-like User-Agent/Referer.
  let response: Response
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    try {
      response = await fetchAllowedImage(url, {
        // Not Next's fetch data cache: it serializes image bodies to disk as JSON
        // and, under concurrent requests, reads back half-written entries
        // ("Unexpected end of JSON input" → 500). imageCache above plus the
        // immutable Cache-Control on our response already cover caching.
        cache: "no-store",
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; ExSitu/1.0; +https://ex-situ.eu)",
          "Accept": "image/webp,image/jpeg,image/*,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          "Referer": new URL(url).origin + "/",
          // AIC's Cloudflare blocks IIIF image requests (even from real
          // browsers) unless AIC's own identification header is set.
          "AIC-User-Agent": "ExSitu (https://exsitu.app)",
        },
      })
    } finally {
      clearTimeout(timeout)
    }
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

    // Store in cache
    evictStaleEntries()
    imageCache.set(cacheKey, {
      buffer: resized.data,
      contentType: "image/jpeg",
      timestamp: Date.now(),
    })

    return new NextResponse(toResponseBody(resized.data), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    })
  } catch {
    return NextResponse.json({ error: "Failed to process image" }, { status: 500 })
  }
}

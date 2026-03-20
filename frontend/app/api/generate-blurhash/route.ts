import { NextRequest, NextResponse } from "next/server"
import { encode } from "blurhash"
import sharp from "sharp"

export const runtime = "nodejs"

const DEFAULT_SIZE = 32
const MAX_SIZE = 64
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

// Allowed image source domains (add museum CDN domains as needed)
const ALLOWED_IMAGE_DOMAINS = new Set([
  "images.metmuseum.org",
  "collectionapi.metmuseum.org",
  "www.britishmuseum.org",
  "recherche.smb.museum",
  "upload.wikimedia.org",
  "commons.wikimedia.org",
  "id.smb.museum",
])

// Block private/internal hostnames and IP ranges to prevent SSRF
const PRIVATE_HOSTNAMES = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
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

const isPrivateIp = (hostname: string): boolean => {
  if (PRIVATE_HOSTNAMES.has(hostname.toLowerCase())) return true
  return PRIVATE_IP_PATTERNS.some((pattern) => pattern.test(hostname))
}

const isValidUrl = (value: string) => {
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return false
    // Block private IPs (SSRF protection)
    if (isPrivateIp(url.hostname)) return false
    // Domain allowlist
    if (!ALLOWED_IMAGE_DOMAINS.has(url.hostname)) return false
    return true
  } catch {
    return false
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const url = searchParams.get("url")

  if (!url || !isValidUrl(url)) {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 })
  }

  const sizeParam = Number(searchParams.get("size"))
  const size = Number.isFinite(sizeParam) ? Math.min(Math.max(sizeParam, 16), MAX_SIZE) : DEFAULT_SIZE

  const response = await fetch(url, {
    next: { revalidate: 86400 },
  })

  if (!response.ok) {
    return NextResponse.json({ error: "Failed to fetch image" }, { status: 502 })
  }

  const contentLength = response.headers.get("content-length")
  if (contentLength && Number(contentLength) > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Image too large" }, { status: 413 })
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Image too large" }, { status: 413 })
  }

  try {
    const { data, info } = await sharp(buffer)
      .ensureAlpha()
      .resize(size, size, { fit: "inside" })
      .raw()
      .toBuffer({ resolveWithObject: true })

    const blurhash = encode(new Uint8ClampedArray(data), info.width, info.height, 4, 4)

    return NextResponse.json({ blurhash, width: info.width, height: info.height })
  } catch {
    return NextResponse.json({ error: "Failed to process image" }, { status: 500 })
  }
}

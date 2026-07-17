import { type NextRequest, NextResponse } from "next/server"

// Server-side validated image lookup for an institution. Unlike by-country's
// onlyWithImages (which only checks img_url is non-empty), this actually
// HEAD-checks candidate URLs and only ever returns one confirmed reachable —
// so the browser never has to attempt-and-fail an image load itself.

const CACHE_DURATION = 30 * 60 * 1000 // 30 minutes
// Misses get a much shorter TTL — a null result usually means the upstream API
// or every candidate CDN was transiently unreachable, not that no image exists.
// Caching that for the full 30 minutes would keep serving failure during an outage.
const NEGATIVE_CACHE_DURATION = 30 * 1000 // 30 seconds
const responseCache = new Map<string, { imgUrl: string | null; timestamp: number }>()

const HEAD_TIMEOUT_MS = 2500
const MAX_CANDIDATES = 8

async function isImageReachable(url: string): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), HEAD_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ExSitu/1.0; +https://ex-situ.eu)",
        "Referer": new URL(url).origin + "/",
      },
    })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const institution = searchParams.get("institution")
  const exclude = new Set(
    (searchParams.get("exclude") || "").split(",").map((s) => s.trim()).filter(Boolean),
  )

  if (!institution) {
    return NextResponse.json({ error: "institution parameter is required" }, { status: 400 })
  }

  const cacheKey = `institution-image:${institution}:${[...exclude].sort().join(",")}`
  const cached = responseCache.get(cacheKey)
  const cachedTtl = cached?.imgUrl ? CACHE_DURATION : NEGATIVE_CACHE_DURATION
  if (cached && Date.now() - cached.timestamp < cachedTtl) {
    return NextResponse.json({ img_url: cached.imgUrl }, { headers: { "X-Cache": "HIT" } })
  }

  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL
  const resolvedUrl = apiBaseUrl ? apiBaseUrl.replace("localhost", "127.0.0.1") : "http://127.0.0.1:1337/api"

  try {
    const upstream = new URL(`${resolvedUrl}/museum-objects/by-country`)
    upstream.searchParams.set("institution", institution)
    upstream.searchParams.set("onlyWithImages", "true")
    upstream.searchParams.set("pageSize", String(MAX_CANDIDATES))

    const upstreamRes = await fetch(upstream.toString(), {
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    })

    if (!upstreamRes.ok) {
      responseCache.set(cacheKey, { imgUrl: null, timestamp: Date.now() })
      return NextResponse.json({ img_url: null })
    }

    const json = await upstreamRes.json()
    const candidates: string[] = Array.isArray(json?.data)
      ? json.data
          .map((o: any) => o?.attributes?.img_url as string | undefined)
          .filter((url: unknown): url is string => typeof url === "string" && url.trim().length > 0 && !exclude.has(url))
      : []

    let validated: string | null = null
    if (candidates.length > 0) {
      try {
        // Race all candidates concurrently — first one to confirm reachable wins.
        // Each check is individually capped at HEAD_TIMEOUT_MS, so this settles
        // in at most ~HEAD_TIMEOUT_MS regardless of how many candidates there are.
        validated = await Promise.any(
          candidates.map(async (url) => {
            if (!(await isImageReachable(url))) throw new Error("unreachable")
            return url
          }),
        )
      } catch {
        validated = null // every candidate failed (AggregateError)
      }
    }

    responseCache.set(cacheKey, { imgUrl: validated, timestamp: Date.now() })
    if (responseCache.size > 200) {
      const oldest = Array.from(responseCache.entries())
        .sort(([, a], [, b]) => a.timestamp - b.timestamp)
        .slice(0, 40)
      oldest.forEach(([key]) => responseCache.delete(key))
    }

    return NextResponse.json({ img_url: validated }, { headers: { "X-Cache": "MISS" } })
  } catch {
    return NextResponse.json({ img_url: null }, { status: 502 })
  }
}

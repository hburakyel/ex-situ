import { NextResponse } from "next/server"

export const revalidate = 86400

const BASE_URL = "https://exsitu.app"
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:1337/api"
const ARTIFACTS_PER_PAGE = 1000

async function fetchTotalArtifactCount(): Promise<number> {
  try {
    const res = await fetch(`${API_BASE}/museum-objects?pagination[pageSize]=1`, {
      next: { revalidate: 86400 },
    })
    if (!res.ok) return 0
    const json = await res.json()
    return json?.meta?.pagination?.total ?? 0
  } catch {
    return 0
  }
}

export async function GET() {
  const total = await fetchTotalArtifactCount()
  // id=0 is static+arcs+collections, id=1..N are artifact pages
  const artifactPageCount = Math.max(1, Math.ceil(total / ARTIFACTS_PER_PAGE))
  const totalPages = artifactPageCount + 1 // +1 for id=0

  const now = new Date().toISOString()

  const sitemapEntries = Array.from({ length: totalPages }, (_, i) => {
    return `  <sitemap>\n    <loc>${BASE_URL}/sitemap/${i}.xml</loc>\n    <lastmod>${now}</lastmod>\n  </sitemap>`
  }).join("\n")

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries}
</sitemapindex>`

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600",
    },
  })
}

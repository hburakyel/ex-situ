import { type NextRequest, NextResponse } from "next/server"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { z } from "zod"
import { LARGE_WIDTH, resolveImageSrc } from "@/lib/image-src"

// Public, read-only MCP server for Ex Situ — lets Claude (or any MCP client)
// answer questions about the collections by querying the same Strapi GET
// endpoints the website uses. Add it in Claude under Settings → Connectors →
// "Add custom connector" with https://exsitu.app/api/proxy/mcp
// (lives under /api/proxy/ because production nginx sends every other /api/*
// path to Strapi).
//
// Safety: every tool only GETs a fixed Strapi path with validated, length-
// capped parameters — no tool takes a URL or a raw query string, so nothing
// outside these endpoints is reachable and nothing can be written.

export const runtime = "nodejs"

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://exsitu.app"
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:1337/api").replace("localhost", "127.0.0.1")

const UPSTREAM_TIMEOUT_MS = 15_000
const MAX_BODY_BYTES = 64 * 1024

// ── Rate limiting (in-memory, per process) ─────────────────────────────────
// Claude.ai connectors call from Anthropic's servers, so many users can share
// one IP — the per-IP cap is generous; the global cap protects the server.
const PER_IP_LIMIT = 300 // requests per window per client IP
const GLOBAL_LIMIT = 1200 // requests per window across all clients
const WINDOW_MS = 60_000
const hits = new Map<string, { count: number; windowStart: number }>()
let globalHits = { count: 0, windowStart: Date.now() }

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0].trim()
  return request.headers.get("x-real-ip") || "unknown"
}

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  if (now - globalHits.windowStart > WINDOW_MS) globalHits = { count: 0, windowStart: now }
  if (++globalHits.count > GLOBAL_LIMIT) return true

  const entry = hits.get(ip)
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    hits.set(ip, { count: 1, windowStart: now })
    if (hits.size > 5000) {
      for (const [key, value] of hits) if (now - value.windowStart > WINDOW_MS) hits.delete(key)
    }
    return false
  }
  return ++entry.count > PER_IP_LIMIT
}

// ── Upstream helpers ───────────────────────────────────────────────────────
type Params = Record<string, string | number | undefined>

async function strapiGet(path: string, params: Params = {}): Promise<any> {
  const url = new URL(`${API_BASE}${path}`)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value))
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "ExSitu-MCP/1.0" },
      signal: controller.signal,
      cache: "no-store",
    })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`Ex Situ API returned ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timeout)
  }
}

function mapUrl(filters: { country?: string; institution?: string }): string {
  const params = new URLSearchParams()
  if (filters.country) params.set("place", filters.country)
  if (filters.institution) params.set("institution", filters.institution)
  const query = params.toString()
  return `${SITE_URL}/map${query ? `?${query}` : ""}`
}

// resolveImageSrc returns a site-relative path for proxied hosts (AIC).
function absoluteUrl(url: string): string {
  return url.startsWith("/") ? `${SITE_URL}${url}` : url
}

function compactObject(id: number, a: any) {
  return {
    id,
    title: a.title || null,
    inventory_number: a.inventory_number || null,
    museum: a.institution_name || null,
    museum_city: a.institution_place || null,
    origin_place: a.place_name || null,
    origin_city: a.city_en || null,
    origin_country: a.country_en || a.country || null,
    date: a.object_date || null,
    acquisition_year: a.acquisition_year ?? null,
    image_url: a.img_url ? absoluteUrl(resolveImageSrc(a.img_url, LARGE_WIDTH)) : null,
    museum_page: a.source_link || null,
    ex_situ_page: `${SITE_URL}/artifact/${id}`,
  }
}

function result(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] }
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true }
}

// Shared input fields. Values are exact names as stored (English country names,
// museum names as listed by get_overview).
const country = z.string().trim().min(1).max(100).optional()
  .describe('Origin country, English name as stored, e.g. "Egypt", "Turkey", "Peru"')
const institution = z.string().trim().min(1).max(120).optional()
  .describe('Holding museum, exact name from get_overview, e.g. "Antikensammlung", "The Metropolitan Museum of Art"')
const year = (what: string) =>
  z.number().int().min(-10000).max(2100).optional().describe(`${what} (integer year, negative for BCE)`)

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }

function buildServer(): McpServer {
  const server = new McpServer(
    { name: "ex-situ", version: "1.0.0" },
    {
      instructions:
        "Ex Situ maps museum objects from where they were made or found to the museum that holds them today. " +
        "Data covers 9 museums (Berlin State Museums collections, The Met, V&A, Art Institute of Chicago). " +
        "Start with get_overview for museum names and totals. Counts reflect what Ex Situ has indexed, not a museum's full holdings. " +
        "Origin places come from museum records and may be uncertain (e.g. 'Egypt?'). Link answers to the ex_situ_page / map_url provided.",
    },
  )

  server.registerTool(
    "get_overview",
    {
      title: "Dataset overview",
      description:
        "Totals for the whole Ex Situ dataset (objects, museums, origin countries) and per-museum counts. " +
        "Use first to learn the exact museum names other tools accept.",
      annotations: READ_ONLY,
    },
    async () => {
      const data = await strapiGet("/museum-objects/resolver-stats")
      return result({
        totals: {
          objects: data?.totals?.totalObjects,
          objects_with_located_origin: data?.totals?.totalGeocoded,
          museums: data?.totals?.totalInstitutions,
          origin_countries: data?.totals?.totalCountries,
        },
        museums: (data?.institutions || []).map((i: any) => ({
          name: i.name,
          city: i.place,
          objects: i.totalObjects,
          origin_countries: i.distinctCountries,
          located_origin_pct: i.resolvedPct,
        })),
        map_url: `${SITE_URL}/map`,
      })
    },
  )

  server.registerTool(
    "count_objects",
    {
      title: "Count objects",
      description:
        "Count objects by origin country and/or holding museum, optionally limited to an object date range. " +
        "At least one of country or institution is required.",
      inputSchema: {
        country,
        institution,
        date_start: year("Earliest object date"),
        date_end: year("Latest object date"),
      },
      annotations: READ_ONLY,
    },
    async ({ country, institution, date_start, date_end }) => {
      if (!country && !institution) return errorResult("Provide country or institution.")
      const data = await strapiGet("/museum-objects/by-country", {
        country, institution, dateStart: date_start, dateEnd: date_end, page: 1, pageSize: 1,
      })
      return result({
        filters: { country, institution, date_start, date_end },
        count: data?.meta?.pagination?.total ?? 0,
        map_url: mapUrl({ country, institution }),
      })
    },
  )

  server.registerTool(
    "get_origins",
    {
      title: "Where objects come from",
      description:
        "Origin → museum flows with object counts. Filter by museum to see where its objects come from, " +
        "or by country to see which museums hold objects from there. detail='country' groups by country, " +
        "detail='site' lists individual find-spots and cities.",
      inputSchema: {
        country,
        institution,
        detail: z.enum(["country", "site"]).default("country"),
        date_start: year("Earliest object date"),
        date_end: year("Latest object date"),
        limit: z.number().int().min(1).max(50).default(20),
      },
      annotations: READ_ONLY,
    },
    async ({ country, institution, detail, date_start, date_end, limit }) => {
      const data = await strapiGet("/museum-objects/geospatial", {
        // zoom ≤ 6 is the deepest level that works without a bounding box.
        zoom: detail === "country" ? 2 : 5, country, institution, dateStart: date_start, dateEnd: date_end,
      })
      const rows = (Array.isArray(data?.data) ? data.data : [])
        .map((r: any) => ({
          origin: r.place_name,
          origin_country: r.country,
          museum: r.institution_name,
          objects: r.object_count,
        }))
        .sort((a: any, b: any) => (b.objects ?? 0) - (a.objects ?? 0))
      return result({
        filters: { country, institution, detail, date_start, date_end },
        flows_total: rows.length,
        flows: rows.slice(0, limit),
        note: "Only objects with a located origin appear here; count_objects may be slightly higher.",
        map_url: mapUrl({ country, institution }),
      })
    },
  )

  server.registerTool(
    "get_time_distribution",
    {
      title: "Object and acquisition dates",
      description:
        "How objects are spread over time: by object date (when made) and by acquisition date (when the museum got them).",
      inputSchema: {
        country,
        institution,
        city: z.string().trim().min(1).max(100).optional().describe("Origin city"),
      },
      annotations: READ_ONLY,
    },
    async ({ country, institution, city }) => {
      const data = await strapiGet("/museum-objects/date-buckets", { country, institution, city })
      const buckets = (list: any) =>
        (Array.isArray(list) ? list : []).filter((b: any) => b.count > 0).map((b: any) => ({ period: b.label, objects: b.count }))
      return result({
        filters: { country, institution, city },
        by_object_date: buckets(data?.objectDateBuckets),
        objects_with_date: data?.objectDateExactCount,
        by_acquisition_date: buckets(data?.acquisitionBuckets),
        objects_with_acquisition_date: data?.acquisitionExactCount,
        map_url: mapUrl({ country, institution }),
      })
    },
  )

  server.registerTool(
    "find_places",
    {
      title: "Find origin places",
      description: "Search origin place names (cities, sites, regions) and how many objects come from each.",
      inputSchema: {
        query: z.string().trim().min(2).max(100).describe("Part of a place name, e.g. 'Pergamon', 'Luxor'"),
        limit: z.number().int().min(1).max(20).default(10),
      },
      annotations: READ_ONLY,
    },
    async ({ query, limit }) => {
      const data = await strapiGet("/museum-objects/suggest", { q: query, limit })
      return result({
        query,
        places: (data?.data || []).map((p: any) => ({
          place: p.place_name,
          city: p.city_en,
          country: p.country_en,
          objects: p.object_count,
        })),
      })
    },
  )

  server.registerTool(
    "search_objects",
    {
      title: "Search objects",
      description:
        "Find individual objects. Either a free-text query (title, material, place…) or a country/museum filter. Returns up to 20 objects with links.",
      inputSchema: {
        query: z.string().trim().min(2).max(100).optional().describe("Free-text search, e.g. 'scarab', 'Iznik tile'"),
        country,
        institution,
        limit: z.number().int().min(1).max(20).default(10),
      },
      annotations: READ_ONLY,
    },
    async ({ query, country, institution, limit }) => {
      if (query && (country || institution)) {
        return errorResult("Use either query or country/institution filters, not both.")
      }
      let data: any
      if (country || institution) {
        data = await strapiGet("/museum-objects/by-country", { country, institution, page: 1, pageSize: limit, onlyWithImages: "true" })
      } else if (query) {
        data = await strapiGet("/museum-objects", { _q: query, "pagination[page]": 1, "pagination[pageSize]": limit })
      } else {
        return errorResult("Provide query, country, or institution.")
      }
      return result({
        filters: { query, country, institution },
        total_matches: data?.meta?.pagination?.total ?? null,
        objects: (data?.data || []).map((o: any) => compactObject(o.id, o.attributes || {})),
      })
    },
  )

  server.registerTool(
    "get_object",
    {
      title: "Object details",
      description: "Full record for one object by its Ex Situ id (the id returned by search_objects).",
      inputSchema: { id: z.number().int().positive() },
      annotations: READ_ONLY,
    },
    async ({ id }) => {
      const data = await strapiGet(`/museum-objects/${id}`)
      if (!data?.data) return errorResult(`No object with id ${id}.`)
      const a = data.data.attributes || {}
      return result({
        ...compactObject(data.data.id, a),
        time_periods: Array.isArray(a.time) ? a.time.map((t: any) => t.time_name).filter(Boolean) : [],
        origin_is_findspot: a.origin_is_findspot ?? null,
        origin_event: a.origin_event_type_en || null,
      })
    },
  )

  return server
}

async function handle(request: NextRequest): Promise<Response> {
  if (isRateLimited(clientIp(request))) {
    return NextResponse.json(
      { jsonrpc: "2.0", error: { code: -32000, message: "Rate limit exceeded, try again in a minute." }, id: null },
      { status: 429, headers: { "Retry-After": "60" } },
    )
  }
  const length = Number(request.headers.get("content-length") || 0)
  if (length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 })
  }

  // Stateless: a fresh server + transport per request, no sessions to track.
  const server = buildServer()
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  try {
    return await transport.handleRequest(request)
  } finally {
    await server.close()
  }
}

export const POST = handle
export const GET = handle
export const DELETE = handle

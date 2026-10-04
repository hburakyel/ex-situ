import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

// Acceptance cases for the MCP server, run through a real MCP client against a
// running server (local dev by default; MCP_URL=https://exsitu.app/api/proxy/mcp
// to check production). Skipped when the server isn't reachable. Counts are
// pinned to the 2026-10-04 Antikensammlung data.
const MCP_URL = process.env.MCP_URL ?? "http://localhost:3000/api/proxy/mcp"

describe(`MCP get_origins / count_objects for Antikensammlung (${MCP_URL})`, () => {
  const client = new Client({ name: "ex-situ-tests", version: "1.0.0" })
  let reachable = false
  const call = async (name: string, args: Record<string, unknown>) => {
    const res: any = await client.callTool({ name, arguments: args })
    expect(res.isError, res.content?.[0]?.text).toBeFalsy()
    return JSON.parse(res.content[0].text)
  }

  beforeAll(async () => {
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL)))
      reachable = true
    } catch {
      console.warn(`MCP server not reachable at ${MCP_URL}; skipping integration tests`)
    }
  }, 30_000)
  afterAll(async () => {
    if (reachable) await client.close()
  })
  beforeEach((ctx) => {
    if (!reachable) ctx.skip()
  })

  it("detail=country reports coverage and how much of it the country flows cover", async () => {
    const r = await call("get_origins", { institution: "Antikensammlung", detail: "country" })
    expect(r.coverage.total).toBe(5612)
    expect(r.coverage.located + r.coverage.unlocated).toBe(r.coverage.total)
    // Country flows exclude located objects that have no country.
    expect(r.flows_objects).toBe(2418)
    expect(r.flows_objects).toBeLessThanOrEqual(r.coverage.located)
    expect(r.note).toMatch(/^\d+ of 5612 objects \(\d+%\) have a located origin/)
    expect(r.note).not.toMatch(/slightly higher/)
  })

  it("detail=site merges Olympia into one row with variants", async () => {
    const r = await call("get_origins", { institution: "Antikensammlung", detail: "site", limit: 5 })
    const olympia = r.flows.filter((f: any) => f.origin === "Olympia")
    expect(olympia).toHaveLength(1)
    expect(olympia[0].objects).toBe(353)
    expect(olympia[0].variants).toEqual(expect.arrayContaining(["Olympia, Greece", "Olympia"]))
  })

  it("detail=site leaves out country-level records and counts them separately", async () => {
    const r = await call("get_origins", { institution: "Antikensammlung", detail: "site", limit: 50, offset: 0 })
    const all: any[] = [...r.flows]
    for (let offset = 50; offset < r.flows_total; offset += 50) {
      all.push(...(await call("get_origins", { institution: "Antikensammlung", detail: "site", limit: 50, offset })).flows)
    }
    expect(all).toHaveLength(r.flows_total)
    const origins = all.map((f) => f.origin)
    expect(origins).not.toContain("Turkey")
    expect(origins).not.toContain("Egypt")
    expect(all.every((f) => f.precision !== "country")).toBe(true)
    expect(r.country_level_only.flows).toBeGreaterThan(0)

    const withCountry = await call("get_origins", {
      institution: "Antikensammlung", detail: "site", include_country_level: true, limit: 50,
    })
    expect(withCountry.flows_total).toBe(r.flows_total + r.country_level_only.flows)
    expect(withCountry).not.toHaveProperty("country_level_only")
  }, 60_000)

  it("signals truncation and pages without overlap", async () => {
    const page1 = await call("get_origins", { institution: "Antikensammlung", detail: "site", limit: 20 })
    expect(page1.truncated).toBe(true)
    expect(page1.returned).toBe(20)
    expect(page1.flows_total).toBeGreaterThan(20)
    const page2 = await call("get_origins", { institution: "Antikensammlung", detail: "site", limit: 20, offset: 20 })
    expect(page2.offset).toBe(20)
    const firstKeys = new Set(page1.flows.map((f: any) => `${f.origin}|${f.country}`))
    expect(page2.flows.some((f: any) => firstKeys.has(`${f.origin}|${f.country}`))).toBe(false)
  })

  it("flags Turkish Republic of Northern Cyprus origins at both detail levels", async () => {
    for (const detail of ["site", "country"]) {
      const r = await call("get_origins", { institution: "Antikensammlung", detail })
      expect(r.flags, detail).toEqual(
        expect.arrayContaining([expect.stringContaining("(Turkish Republic of Northern Cyprus)")]),
      )
    }
  })

  it("count_objects returns total / located / unlocated", async () => {
    const r = await call("count_objects", { institution: "Antikensammlung" })
    expect(r.total).toBe(5612)
    expect(r.located + r.unlocated).toBe(r.total)
    expect(r).not.toHaveProperty("count")
  })
})

// One layer down: the backend view itself must already group Olympia, so the
// MCP merge is only a fallback. API_URL=https://exsitu.app/api to check production.
const API_URL = process.env.API_URL ?? "http://127.0.0.1:1337/api"

describe(`geospatial place grouping for Antikensammlung (${API_URL})`, () => {
  let rows: any[] | null = null
  beforeAll(async () => {
    try {
      const res = await fetch(`${API_URL}/museum-objects/geospatial?zoom=5&institution=Antikensammlung`)
      if (res.ok) rows = (await res.json()).data
    } catch {
      console.warn(`Backend not reachable at ${API_URL}; skipping`)
    }
  }, 30_000)
  beforeEach((ctx) => {
    if (!rows) ctx.skip()
  })

  it("returns Olympia as one row with its raw spellings", () => {
    const olympia = rows!.filter((r) => r.place_name.toLowerCase().startsWith("olympia") && !r.place_name.endsWith("?"))
    expect(olympia).toHaveLength(1)
    expect(olympia[0].object_count).toBe(353)
    expect(olympia[0].place_variants).toEqual(expect.arrayContaining(["Olympia", "Olympia, Greece"]))
  })

  it("keeps Tarquinia and the tomb inside it apart", () => {
    const names = rows!.map((r) => r.place_name)
    expect(names).toEqual(expect.arrayContaining(["Tarquinia", "Tomba del Guerriero (Tarquinia)"]))
  })

  it("has no two rows that differ only by case or a country suffix", () => {
    const keys = rows!.map((r) => `${r.institution_name}|${r.country}|${r.place_name.replace(new RegExp(`,\\s*${r.country}$`, "i"), "").trim().toLowerCase()}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

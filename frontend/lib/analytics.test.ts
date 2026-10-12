import { afterEach, describe, expect, it, vi } from "vitest"
import { linkHost, track } from "./analytics"

describe("track", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("does nothing without the Umami script", () => {
    vi.stubGlobal("window", {})
    expect(() => track("arc_click", { from: "Egypt" })).not.toThrow()
  })

  it("drops empty values and caps long strings", () => {
    const calls: unknown[][] = []
    vi.stubGlobal("window", { umami: { track: (...args: unknown[]) => calls.push(args) } })
    track("command_palette_search", { query: "x".repeat(300), type: "site", pick: "", id: undefined, n: 0 })
    expect(calls).toHaveLength(1)
    const [event, data] = calls[0] as [string, Record<string, unknown>]
    expect(event).toBe("command_palette_search")
    expect(data).toEqual({ query: "x".repeat(100), type: "site", n: 0 })
  })

  it("never throws if the tracker does", () => {
    vi.stubGlobal("window", { umami: { track: () => { throw new Error("blocked") } } })
    expect(() => track("share_click")).not.toThrow()
  })
})

describe("linkHost", () => {
  it("keeps only the hostname", () => {
    expect(linkHost("https://id.smb.museum/object/794830?x=1")).toBe("id.smb.museum")
    expect(linkHost("not a url")).toBeUndefined()
    expect(linkHost(null)).toBeUndefined()
  })
})

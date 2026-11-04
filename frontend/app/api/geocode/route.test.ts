// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const place = { display_name: "Pergamon, Turkey", lat: "39.1", lon: "27.2", type: "city" }
const get = (route: typeof import("./route"), q: string) =>
  route.GET(new NextRequest(`http://localhost/api/geocode?q=${encodeURIComponent(q)}`)).then((res) => res.json())

describe("/api/geocode", () => {
  let route: typeof import("./route")
  const fetchMock = vi.fn()

  beforeEach(async () => {
    vi.resetModules()
    vi.useFakeTimers()
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => new Response(JSON.stringify([place])))
    vi.stubGlobal("fetch", fetchMock)
    route = await import("./route")
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("asks Nominatim once for a repeated search, whatever its case", async () => {
    const first = await get(route, "Pergamon")
    const second = await get(route, "pergamon")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(second).toEqual(first)
    expect(first.features[0].text).toBe("Pergamon")
  })

  it("shares one request between identical searches in flight", async () => {
    await Promise.all([get(route, "Uruk"), get(route, "Uruk")])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("spaces requests a second apart", async () => {
    await get(route, "Uruk")
    const second = get(route, "Assur")
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(200)
    await second
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("answers without place results when the queue is too long", async () => {
    await get(route, "a1")
    const queued = ["a2", "a3", "a4"].map((q) => get(route, q))
    expect(await get(route, "a5")).toEqual({ features: [] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.runAllTimersAsync()
    await Promise.all(queued)
  })

  it("doesn't cache a failed request", async () => {
    fetchMock.mockImplementationOnce(async () => new Response("", { status: 503 }))
    expect(await get(route, "Uruk")).toEqual({ features: [] })
    const retry = get(route, "Uruk")
    await vi.runAllTimersAsync()
    expect((await retry).features).toHaveLength(1)
  })
})

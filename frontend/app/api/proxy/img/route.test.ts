import { afterEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import sharp from "sharp"
import { GET } from "./route"

vi.mock("@/lib/image-src", () => import("../../../../lib/image-src"))
vi.mock("@/lib/remote-image-url", () => import("../../../../lib/remote-image-url"))

const AIC = "https://www.artic.edu/iiif/2/abc/full"

const jpeg = async () =>
  new Response(
    new Uint8Array(
      await sharp({ create: { width: 40, height: 40, channels: 3, background: "#888" } }).jpeg().toBuffer(),
    ),
  )

// Answers like AIC: `stalled` URLs hang until the proxy aborts them.
function stubFetch(answer: (url: string) => Promise<Response> | "stall") {
  const urls: string[] = []
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    urls.push(url)
    const result = answer(url)
    if (result !== "stall") return result
    return new Promise((_, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
    })
  })
  return urls
}

const get = (url: string, width: number) =>
  GET(new NextRequest(`http://localhost/api/proxy/img?url=${encodeURIComponent(url)}&w=${width}`))

afterEach(() => vi.unstubAllGlobals())

describe("/api/proxy/img — Art Institute of Chicago", () => {
  it("asks for another allowed size when one stalls", async () => {
    const urls = stubFetch((url) => (url.includes("/full/400,/") ? "stall" : jpeg()))
    const response = await get(`${AIC}/400,/0/default.jpg`, 300)
    expect(response.status).toBe(200)
    expect(urls).toEqual([`${AIC}/400,/0/default.jpg`, `${AIC}/600,/0/default.jpg`])
  }, 6000)

  it("retries a narrow source at its own width", async () => {
    const urls = stubFetch(async (url) => {
      if (url.endsWith("/info.json")) return Response.json({ width: 398 })
      return url.includes("/full/843,/") ? new Response("", { status: 403 }) : jpeg()
    })
    const response = await get(`${AIC}/843,/0/default.jpg`, 800)
    expect(response.status).toBe(200)
    expect(urls.at(-1)).toBe(`${AIC}/398,/0/default.jpg`)
  })

  it("answers 502 when every size fails", async () => {
    stubFetch(async () => new Response("", { status: 500 }))
    const response = await get(`${AIC}/400,/0/default2.jpg`, 300)
    expect(response.status).toBe(502)
  })
})

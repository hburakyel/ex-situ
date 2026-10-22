import { describe, expect, it } from "vitest"
import { LARGE_WIDTH, resolveImageSrc } from "./image-src"

describe("resolveImageSrc", () => {
  it("maps dead recherche.smb.museum URLs to search.smb.museum", () => {
    expect(resolveImageSrc("https://recherche.smb.museum/images/41/4109986_1000x1000.jpg")).toBe(
      "https://search.smb.museum/media/images/thumbs/extra_large/109/004/4109986.jpg",
    )
    expect(resolveImageSrc("https://recherche.smb.museum/images/12/123456_1000x1000.jpg")).toBe(
      "https://search.smb.museum/media/images/thumbs/extra_large/123/123456.jpg",
    )
  })

  it("leaves search.smb.museum URLs alone", () => {
    const u = "https://search.smb.museum/media/images/thumbs/extra_large/273/004/4273901.jpg"
    expect(resolveImageSrc(u)).toBe(u)
  })
})

describe("resolveImageSrc — Rijksmuseum (micr.io IIIF 3)", () => {
  const stored = "https://iiif.micr.io/hlNHQ/full/1000,/0/default.jpg"
  it("fits thumbnails in a box instead of a fixed width that cannot upscale", () => {
    expect(resolveImageSrc(stored)).toBe("https://iiif.micr.io/hlNHQ/full/!600,600/0/default.jpg")
  })
  it("uses a larger box for large views", () => {
    expect(resolveImageSrc(stored, LARGE_WIDTH)).toBe("https://iiif.micr.io/hlNHQ/full/!1000,1000/0/default.jpg")
  })
})

describe("resolveImageSrc — Met renditions", () => {
  const original = "https://images.metmuseum.org/CRDImages/is/original/DT8104.jpg"
  it("uses the small rendition for grid thumbnails", () => {
    expect(resolveImageSrc(original)).toBe("https://images.metmuseum.org/CRDImages/is/mobile-large/DT8104.jpg")
  })
  it("uses the display rendition for large views", () => {
    expect(resolveImageSrc(original, LARGE_WIDTH)).toBe("https://images.metmuseum.org/CRDImages/is/web-large/DT8104.jpg")
  })
})

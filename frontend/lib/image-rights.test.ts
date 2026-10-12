import { describe, expect, it } from "vitest"
import { isPublicDomain, rightsLabel } from "./image-rights"

describe("rightsLabel", () => {
  it("labels Creative Commons licences", () => {
    expect(rightsLabel("http://creativecommons.org/licenses/by/4.0/")).toBe("CC BY 4.0")
    expect(rightsLabel("http://creativecommons.org/licenses/by-sa/4.0/")).toBe("CC BY-SA 4.0")
    expect(rightsLabel("https://creativecommons.org/licenses/by/2.5/")).toBe("CC BY 2.5")
    expect(rightsLabel("http://creativecommons.org/licenses/by-sa/3.0/")).toBe("CC BY-SA 3.0")
  })

  it("labels public-domain dedications", () => {
    expect(rightsLabel("http://creativecommons.org/publicdomain/zero/1.0/")).toBe("CC0")
    expect(rightsLabel("http://creativecommons.org/publicdomain/mark/1.0/")).toBe("Public Domain")
    expect(isPublicDomain("http://creativecommons.org/publicdomain/zero/1.0/")).toBe(true)
    expect(isPublicDomain("http://creativecommons.org/licenses/by/4.0/")).toBe(false)
  })

  it("claims nothing for unknown or missing rights", () => {
    expect(rightsLabel(null)).toBeNull()
    expect(rightsLabel("")).toBeNull()
    expect(rightsLabel("http://rightsstatements.org/vocab/InC/1.0/")).toBeNull()
  })
})

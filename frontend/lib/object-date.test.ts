import { describe, expect, it } from "vitest"
import { displayObjectDate } from "./object-date"

describe("displayObjectDate", () => {
  it("renders German era markers in English", () => {
    expect(displayObjectDate("1-600 n. Chr.")).toBe("1–600 CE")
    expect(displayObjectDate("315-286 v. Chr.")).toBe("315–286 BCE")
    expect(displayObjectDate("246-255 n.Chr.")).toBe("246–255 CE")
  })

  it("renders centuries and their parts", () => {
    expect(displayObjectDate("Anfang 5. Jh. v. Chr.")).toBe("early 5th century BCE")
    expect(displayObjectDate("Mitte 6. Jh. v. Chr.")).toBe("mid-6th century BCE")
    expect(displayObjectDate("Ende 19. Jahrhundert")).toBe("late 19th century")
    expect(displayObjectDate("2. Hälfte 1. Jh. n. Chr.")).toBe("second half of the 1st century CE")
    expect(displayObjectDate("1. Viertel 3. Jh.")).toBe("first quarter of the 3rd century")
    expect(displayObjectDate("11. Jh.")).toBe("11th century")
    expect(displayObjectDate("22. Jh.")).toBe("22nd century")
  })

  it("renders approximations and connectives", () => {
    expect(displayObjectDate("um 1900")).toBe("c. 1900")
    expect(displayObjectDate("ca. 1450 bis 1550")).toBe("c. 1450 to 1550")
    expect(displayObjectDate("vor 1880")).toBe("before 1880")
  })

  it("leaves English and unknown values alone", () => {
    expect(displayObjectDate("1450-1550")).toBe("1450–1550")
    expect(displayObjectDate("ca. 1st century BCE")).toBe("c. 1st century BCE")
    expect(displayObjectDate("Edo period")).toBe("Edo period")
    expect(displayObjectDate(null)).toBe("")
  })
})

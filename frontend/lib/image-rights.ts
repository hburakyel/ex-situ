// Short label for an image licence URI (edm:rights, as stored in image_rights).
// Only the licences Ex Situ indexes images under; anything else returns null so
// the credit falls back to "© <institution>" without claiming a licence.
//
//   http://creativecommons.org/licenses/by-sa/4.0/   → "CC BY-SA 4.0"
//   http://creativecommons.org/publicdomain/zero/1.0/ → "CC0"
//   http://creativecommons.org/publicdomain/mark/1.0/ → "Public Domain"

export function rightsLabel(uri: string | null | undefined): string | null {
  if (!uri) return null
  const m = uri.trim().match(/creativecommons\.org\/(licenses|publicdomain)\/([a-z-]+)\/(\d+(?:\.\d+)?)/i)
  if (!m) return null
  const [, kind, code, version] = m
  if (kind.toLowerCase() === "publicdomain") {
    if (code.toLowerCase() === "zero") return "CC0"
    if (code.toLowerCase() === "mark") return "Public Domain"
    return null
  }
  return `CC ${code.toUpperCase()} ${version}`
}

// Public-domain images carry no "©".
export function isPublicDomain(uri: string | null | undefined): boolean {
  const label = rightsLabel(uri)
  return label === "CC0" || label === "Public Domain"
}

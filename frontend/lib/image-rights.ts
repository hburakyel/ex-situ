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

// The six Staatliche Museen zu Berlin collections: museum-digital states CC BY-NC-SA
// for their images (audited 2026-10-07).
export const SMB_COLLECTIONS = new Set([
  "Ethnologisches Museum",
  "Antikensammlung",
  "Museum für Islamische Kunst",
  "Vorderasiatisches Museum",
  "Ägyptisches Museum und Papyrussammlung",
  "Museum für Asiatische Kunst",
])

const CC0_INSTITUTIONS = new Set(["The Metropolitan Museum of Art", "The Walters Art Museum"])

// Credit for an image Ex Situ may show outside the museum's own credit line (the
// link-preview grid): public domain or an open CC licence that allows adaptation.
// Returns null for everything else: V&A (©), AIC (licence not stored per object),
// Weltmuseum (the KHM terms want "©KHM-Museumsverband" at each image), CC BY-ND.
const NOT_OPEN = new Set(["Victoria and Albert Museum", "Art Institute of Chicago", "Weltmuseum Wien"])

export function openImageCredit(institution: string, rights: string | null | undefined): { name: string; licence: string } | null {
  if (NOT_OPEN.has(institution)) return null
  if (CC0_INSTITUTIONS.has(institution)) return { name: institution, licence: "CC0" }
  if (SMB_COLLECTIONS.has(institution)) return { name: "Staatliche Museen zu Berlin", licence: "CC BY-NC-SA" }
  const label = rightsLabel(rights)
  if (!label || label.includes("ND")) return null
  return { name: institution, licence: label }
}

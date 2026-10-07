import type { MuseumObject } from "@/types"

// Objects whose source record the museum withdrew (tagged by
// etl/check_withdrawn_sources.py) keep their place in the grid and gallery with
// the inventory number instead of an image, so it stays visible how many are affected.
export const isWithdrawn = (object?: MuseumObject | null): boolean => object?.attributes?.source_withdrawn === true

// Where a withdrawn object can still be looked up: its exact Berliner
// Papyrusdatenbank record when etl/resolve_berlpap_links.py found one, else
// BerlPap's search (papyri) or SMB's own collection search.
export function withdrawnSourceUrl(object: MuseumObject): string | null {
  const link = object.attributes?.source_link
  if (link && link.startsWith("https://berlpap.smb.museum/")) return link
  const inv = object.attributes?.inventory_number?.trim()
  if (!inv) return null
  return /^P\b/.test(inv)
    ? `https://berlpap.smb.museum/?s=${encodeURIComponent(inv)}`
    : `https://search.smb.museum/?q=${encodeURIComponent(inv)}`
}

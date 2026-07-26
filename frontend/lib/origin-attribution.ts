/**
 * Formats the origin-event attribution context (migration 015 —
 * origin_event_type_en / origin_is_findspot / origin_person_name) into a
 * short label for display next to place_name.
 *
 * Background: place_name alone doesn't say whether it's a genuine findspot
 * or just where a named maker was active — e.g. "Kyūshū" for a ceramic
 * piece is the maker's home region (a "Created" event), not where the
 * object was found. Without this label the two read identically. Fields
 * are only populated for SMB records processed by
 * etl/backfill_smb_event_attribution.py — everything else (and any
 * not-yet-backfilled SMB row) returns null and the caller should render
 * nothing extra.
 */

interface OriginAttributionInput {
  origin_event_type_en?: string | null
  origin_is_findspot?: boolean | null
  origin_person_name?: string | null
}

export function formatOriginAttribution(attrs: OriginAttributionInput): string | null {
  const { origin_event_type_en, origin_is_findspot, origin_person_name } = attrs

  if (!origin_event_type_en) return null

  if (origin_is_findspot) {
    return 'Findspot'
  }

  if (origin_person_name) {
    return `${origin_event_type_en} — attributed to ${origin_person_name}`
  }

  return origin_event_type_en
}

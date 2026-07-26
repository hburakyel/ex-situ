-- Migration 015: Add origin-event attribution columns
--
-- SMB (museum-digital) objects carry a structured object_events[] array,
-- each event tagged with an event_type (Hergestellt/Created, Gefunden/Found,
-- Gesammelt/Collected, Gemalt/Painted, etc.) and its own place + people.
-- The scraper previously took object_events[0] positionally, with no regard
-- for event_type, so place_name/latitude/longitude could silently come from
-- a maker's broad activity region (a "Hergestellt" event) or even go missing
-- for objects whose findspot ("Gefunden") wasn't the first event in the
-- array. See etl/smb_event_selection.py for the corrected, event-type-aware
-- selection logic this backs.
--
-- These columns record WHICH event the stored place_name/latitude/longitude
-- came from, so the UI can show that context instead of presenting every
-- place as if it were an equally-certain findspot.
--
-- NULL on all rows not (yet) processed by the new scraper/backfill path —
-- safe to re-run, does not touch existing place_name/latitude/longitude.

ALTER TABLE museum_objects ADD COLUMN IF NOT EXISTS origin_event_type_id INTEGER;
ALTER TABLE museum_objects ADD COLUMN IF NOT EXISTS origin_event_type_en TEXT;
ALTER TABLE museum_objects ADD COLUMN IF NOT EXISTS origin_is_findspot   BOOLEAN;
ALTER TABLE museum_objects ADD COLUMN IF NOT EXISTS origin_person_name   TEXT;

CREATE INDEX IF NOT EXISTS idx_museum_objects_origin_is_findspot
  ON museum_objects (origin_is_findspot) WHERE origin_is_findspot IS NOT NULL;

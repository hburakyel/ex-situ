-- Migration 007: Add missing enrichment fields to museum_objects
-- All statements use ADD COLUMN IF NOT EXISTS — safe to re-run.
-- Matches the 16 fields declared in frontend/types.ts but absent from schema.json.
-- After applying, restart Strapi so it picks up the updated schema.json.

-- -----------------------------------------------------------------------
-- Institution locality (Phase 2 will back-populate from institution_place)
-- -----------------------------------------------------------------------
ALTER TABLE museum_objects ADD COLUMN IF NOT EXISTS institution_city_en    TEXT;
ALTER TABLE museum_objects ADD COLUMN IF NOT EXISTS institution_country_en TEXT;

-- -----------------------------------------------------------------------
-- Place name normalisation
-- NOTE: place_name_normalized was added by migration 006 at the DB level
-- but was missing from schema.json, so Strapi returned it as NULL.
-- The column already exists; this is a no-op that keeps the migration
-- self-contained and re-runnable.
-- -----------------------------------------------------------------------
ALTER TABLE museum_objects ADD COLUMN IF NOT EXISTS place_name_normalized TEXT;
ALTER TABLE museum_objects ADD COLUMN IF NOT EXISTS normalized_origin      TEXT;

-- -----------------------------------------------------------------------
-- Geocoding provenance & quality
-- -----------------------------------------------------------------------
ALTER TABLE museum_objects ADD COLUMN IF NOT EXISTS geocoding_confidence FLOAT;
ALTER TABLE museum_objects ADD COLUMN IF NOT EXISTS geocoding_status      TEXT
  CHECK (geocoding_status IN ('ok', 'ambiguous', 'disputed'));
ALTER TABLE museum_objects ADD COLUMN IF NOT EXISTS geocoding_notes       TEXT;
ALTER TABLE museum_objects ADD COLUMN IF NOT EXISTS geocoded_country      TEXT;
ALTER TABLE museum_objects ADD COLUMN IF NOT EXISTS geocoded_region       TEXT;
ALTER TABLE museum_objects ADD COLUMN IF NOT EXISTS geocoder_source       TEXT;

-- -----------------------------------------------------------------------
-- Review & classification
-- -----------------------------------------------------------------------
ALTER TABLE museum_objects ADD COLUMN IF NOT EXISTS review_status TEXT
  CHECK (review_status IN ('pending', 'verified', 'rejected'));

ALTER TABLE museum_objects ADD COLUMN IF NOT EXISTS origin_type TEXT
  CHECK (origin_type IN (
    'valid_location',
    'historical_toponym',
    'cultural_area',
    'archaeological_micro_location',
    'invalid'
  ));

ALTER TABLE museum_objects ADD COLUMN IF NOT EXISTS cultural_context    TEXT;
ALTER TABLE museum_objects ADD COLUMN IF NOT EXISTS transfer_method     TEXT;
ALTER TABLE museum_objects ADD COLUMN IF NOT EXISTS historical_relation TEXT;

ALTER TABLE museum_objects ADD COLUMN IF NOT EXISTS enrichment_confidence TEXT
  CHECK (enrichment_confidence IN ('high', 'medium', 'low'));

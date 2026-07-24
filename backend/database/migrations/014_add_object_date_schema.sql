-- Migration 014: Add normalized object-date and acquisition-date schema
--
-- Two independent date axes, both internal-only (never exposed raw to API
-- consumers — see date-display.js for the collapse-to-public-fields logic):
--
--   object_date_*      — when the object was made/originated
--   acquisition_year_* — when the holding institution acquired it, ONLY where
--                        the source data actually provides this (no fabrication)
--
-- Replaces the dead free-text `object_date` column and the junk-laden
-- `time_start`/`time_end` varchar pair (which store literal "N/A"/"?" as
-- values) with typed, indexed, queryable earliest/latest year integers plus
-- an explicit, queryable precision/confidence state instead of relying on
-- NULL to mean "unknown".
--
-- All statements use ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS —
-- safe to re-run. Institution-by-institution backfill happens in separate,
-- institution-scoped scripts (see etl/backfill_aic_object_dates.sql for the
-- first one); this migration only adds columns, it does not populate them.

ALTER TABLE museum_objects ADD COLUMN IF NOT EXISTS object_date_earliest  INTEGER;
ALTER TABLE museum_objects ADD COLUMN IF NOT EXISTS object_date_latest    INTEGER;
ALTER TABLE museum_objects ADD COLUMN IF NOT EXISTS object_date_precision TEXT
  CHECK (object_date_precision IN ('exact', 'circa', 'range', 'before', 'after', 'unknown'));
ALTER TABLE museum_objects ADD COLUMN IF NOT EXISTS object_date_display   TEXT;

ALTER TABLE museum_objects ADD COLUMN IF NOT EXISTS acquisition_year_earliest   INTEGER;
ALTER TABLE museum_objects ADD COLUMN IF NOT EXISTS acquisition_year_latest     INTEGER;
ALTER TABLE museum_objects ADD COLUMN IF NOT EXISTS acquisition_date_precision  TEXT
  CHECK (acquisition_date_precision IN ('exact', 'range', 'unknown'));
ALTER TABLE museum_objects ADD COLUMN IF NOT EXISTS acquisition_date_confidence TEXT
  CHECK (acquisition_date_confidence IN ('confirmed', 'inferred'));

CREATE INDEX IF NOT EXISTS idx_museum_objects_object_date_range
  ON museum_objects (object_date_earliest, object_date_latest);
CREATE INDEX IF NOT EXISTS idx_museum_objects_acquisition_year_range
  ON museum_objects (acquisition_year_earliest, acquisition_year_latest);

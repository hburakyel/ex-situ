-- Backfill: Victoria and Albert Museum acquisition-date migration
--
-- V&A has NO creation-date source data at all (scrape_vam.py's date
-- extraction never yields anything — the V&A bulk search API doesn't return
-- the requested date fields; confirmed 0% object_date coverage in the
-- completeness audit). We do not fabricate or infer a creation date here:
-- object_date_precision is set to the explicit, queryable 'unknown' state
-- for every V&A row (not left as an unmigrated NULL), per the schema design
-- goal of making "unknown" a real queryable state rather than silent NULL.
--
-- Acquisition year: V&A's existing acquisition_year column is regex-derived
-- from the trailing year in the accession number (e.g. "T.123-1925" -> 1925)
-- — a real but INFERRED proxy, not a confirmed institutional acquisition
-- record. Migrated with confidence='inferred' accordingly.
--
-- Diagnostics run before writing this:
--   - 34,405 / 41,981 rows have a non-null acquisition_year
--   - min 1852 (matches V&A's founding year, plausible), max 2026 excluding
--     one known-bad pair
--   - exactly 2 rows (ids 250348, 229584, both inventory_number
--     "IS.110-2102") have acquisition_year = 2102 — an implausible future
--     year baked into the source accession number itself, not a regex bug.
--     Bounded out (treated as unknown) rather than migrated as a real year.
--
-- Scoped strictly to institution_name = 'Victoria and Albert Museum'.
-- Re-runnable: overwrites only V&A rows.

BEGIN;

UPDATE museum_objects
SET object_date_precision = 'unknown'
WHERE institution_name = 'Victoria and Albert Museum'
  AND published_at IS NOT NULL;

UPDATE museum_objects
SET
  acquisition_year_earliest = acquisition_year,
  acquisition_year_latest = acquisition_year,
  acquisition_date_precision = 'exact',
  acquisition_date_confidence = 'inferred'
WHERE institution_name = 'Victoria and Albert Museum'
  AND published_at IS NOT NULL
  AND acquisition_year IS NOT NULL
  AND acquisition_year BETWEEN 1800 AND 2027;

-- Rows where the source-derived acquisition_year exists but is implausible
-- (currently: the 2 "IS.110-2102" rows) — explicitly mark as unknown rather
-- than silently leaving unprocessed NULL.
UPDATE museum_objects
SET acquisition_date_precision = 'unknown'
WHERE institution_name = 'Victoria and Albert Museum'
  AND published_at IS NOT NULL
  AND (acquisition_year IS NULL OR acquisition_year NOT BETWEEN 1800 AND 2027);

COMMIT;

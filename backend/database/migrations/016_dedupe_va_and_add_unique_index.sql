-- Migration 016: De-duplicate V&A rows and add the missing unique index
--
-- Root cause: scrape_vam.py's INSERT has always carried
--   ON CONFLICT (institution_name, inventory_number) WHERE inventory_number IS NOT NULL DO NOTHING
-- but no unique index backing that arbiter was ever created (checked pg_indexes:
-- zero matches). Re-running the scraper therefore silently re-inserted every
-- row instead of no-op'ing on conflict. Result: 20,457 groups of true
-- duplicates (20,484 extra rows) — confirmed byte-identical across every
-- content column (title, place, all object_date_*/acquisition_* fields,
-- geocoding/review/enrichment columns) via md5(ROW(...)) hashing, min=max=2
-- copies per real object.
--
-- IMPORTANT wrinkle discovered during dedup analysis: (institution_name,
-- inventory_number) is NOT actually a reliable key for V&A. 24 accession
-- numbers are shared by 2-6 GENUINELY DIFFERENT V&A objects (distinct
-- systemNumbers/source_link/images/places — e.g. "913:30-1894" covers 6
-- distinct catalog items O1300334..O1300339 that all report the same
-- accessionNumber string). These are not duplicates and must not be
-- collapsed. The true per-row identity is (institution_name, inventory_number,
-- source_link) — every group keyed on those three columns hashed to exactly
-- 1 distinct content hash (verified), i.e. real 1:1 duplicates only.
--
-- So: dedupe on the 3-column key (safe, verified identical), and build the
-- unique index on that same 3-column key rather than the 2-column key
-- originally used in scrape_vam.py's ON CONFLICT clause (which cannot be
-- satisfied without destroying the 24 groups' distinct real records).
-- scrape_vam.py's ON CONFLICT target is updated to match in the same change.
--
-- Scoped strictly to institution_name = 'Victoria and Albert Museum' via a
-- partial index — this bug is specific to scrape_vam.py; no other scraper
-- uses this ON CONFLICT target (scrape_europeana.py uses a bare
-- ON CONFLICT DO NOTHING; Met/AIC/SMB import through a different path), so
-- other institutions' data is intentionally left untouched here.
--
-- Re-runnable: the DELETE only ever removes exact-duplicate rows (by id, not
-- by count), and CREATE UNIQUE INDEX IF NOT EXISTS is idempotent.

BEGIN;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY institution_name, inventory_number, source_link
      ORDER BY id
    ) AS rn
  FROM museum_objects
  WHERE institution_name = 'Victoria and Albert Museum'
    AND published_at IS NOT NULL
    AND inventory_number IS NOT NULL
)
DELETE FROM museum_objects mo
USING ranked
WHERE mo.id = ranked.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_museum_objects_va_inv_source_unique
  ON museum_objects (institution_name, inventory_number, source_link)
  WHERE institution_name = 'Victoria and Albert Museum' AND inventory_number IS NOT NULL;

COMMIT;

-- Backfill: The Metropolitan Museum of Art creation-date migration
--
-- Populates object_date_* columns (migration 014) for the Met from its
-- existing time component data. Met's time_start/time_end are 99.8% numeric
-- already (per the completeness audit); time_name is always empty for the
-- Met, so display falls back to the earliest/latest range formatting.
--
-- Diagnostics run before writing this (see conversation log):
--   - no reversed ranges (time_start > time_end): 0
--   - no circa-like time_name prefixes: 0 (time_name is always empty)
--   - every object has exactly one time component row: confirmed
--   - only real NULLs as placeholders (no "N/A"/"?" strings, no AIC-style
--     sentinel garbage) — min/max of numeric values: -6000..1950 / -4000..2000
--   - 3 asymmetric rows (time_start NULL, time_end populated) — genuine
--     open-ended "known by year X, no earlier bound" cases -> precision='before'
--
-- Acquisition year: Met's public API has a genuine accessionYear field
-- (confirmed via live test: object 452147 -> accessionYear 1970) but
-- backfilling it requires ~19,586 individual HTTP requests, which is a
-- long-running, rate-limit-exposed operation — deliberately DEFERRED here,
-- not attempted. acquisition_year_* / acquisition_date_confidence are left
-- NULL for the Met; do not fabricate them.
--
-- Scoped strictly to institution_name = 'The Metropolitan Museum of Art'.
-- Re-runnable: overwrites only Met rows.

BEGIN;

WITH met_time AS (
  SELECT
    mo.id AS museum_object_id,
    t.time_name,
    CASE
      WHEN NULLIF(BTRIM(t.time_start), '') ~ '^-?[0-9]+$'
        AND NULLIF(BTRIM(t.time_start), '')::bigint BETWEEN -10000 AND 2027
        THEN NULLIF(BTRIM(t.time_start), '')
      ELSE NULL
    END AS time_start,
    CASE
      WHEN NULLIF(BTRIM(t.time_end), '') ~ '^-?[0-9]+$'
        AND NULLIF(BTRIM(t.time_end), '')::bigint BETWEEN -10000 AND 2027
        THEN NULLIF(BTRIM(t.time_end), '')
      ELSE NULL
    END AS time_end
  FROM museum_objects mo
  JOIN museum_objects_components moc
    ON moc.entity_id = mo.id AND moc.field = 'time'
  JOIN components_time_name_time_infos t ON t.id = moc.component_id
  WHERE mo.institution_name = 'The Metropolitan Museum of Art'
    AND mo.published_at IS NOT NULL
)
UPDATE museum_objects mo
SET
  object_date_display = NULLIF(BTRIM(mt.time_name), ''),
  object_date_earliest = CASE
    WHEN mt.time_start IS NOT NULL AND mt.time_end IS NOT NULL
      THEN LEAST(mt.time_start::int, mt.time_end::int)
    WHEN mt.time_start IS NOT NULL AND mt.time_end IS NULL
      THEN mt.time_start::int
    ELSE NULL
  END,
  object_date_latest = CASE
    WHEN mt.time_start IS NOT NULL AND mt.time_end IS NOT NULL
      THEN GREATEST(mt.time_start::int, mt.time_end::int)
    WHEN mt.time_end IS NOT NULL AND mt.time_start IS NULL
      THEN mt.time_end::int
    ELSE NULL
  END,
  object_date_precision = CASE
    WHEN mt.time_start IS NULL AND mt.time_end IS NULL THEN 'unknown'
    WHEN mt.time_start IS NULL AND mt.time_end IS NOT NULL THEN 'before'
    WHEN mt.time_end IS NULL AND mt.time_start IS NOT NULL THEN 'after'
    WHEN mt.time_name ~* '^c\.|^ca\.|^about |^circa' THEN 'circa'
    WHEN mt.time_start::int = mt.time_end::int THEN 'exact'
    ELSE 'range'
  END
FROM met_time mt
WHERE mo.id = mt.museum_object_id;

-- Met rows with no time component row at all (none expected, confirmed 0
-- during diagnosis, but handled defensively/idempotently anyway).
UPDATE museum_objects mo
SET object_date_precision = 'unknown'
WHERE mo.institution_name = 'The Metropolitan Museum of Art'
  AND mo.published_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM museum_objects_components moc
    WHERE moc.entity_id = mo.id AND moc.field = 'time'
  );

COMMIT;

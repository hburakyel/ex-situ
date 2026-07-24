-- Backfill: Vorderasiatisches Museum (SMB) creation-date migration
--
-- Diagnostics run before writing this — clean across the board:
--   - placeholder tokens: "N/A" (59 both-sides, symmetric), 1 lone "?" on
--     time_start only (pairs with a numeric time_end -> 'before')
--   - min/max of numeric values: -6200..2010 / -5800..2010 — all plausible
--   - 0 reversed ranges, 0 rows with no time component, 0 asymmetric
--     N/A+numeric combos, 0 circa-like prefixes, 0 BCE-text/positive-value
--     conflicts (the sign-convention bug found in Antikensammlung and
--     Museum für Asiatische Kunst does not recur here)
--
-- No acquisition-date source for this institution — left untouched (NULL).
--
-- Scoped strictly to institution_name = 'Vorderasiatisches Museum'.
-- Re-runnable: overwrites only this institution's rows.

BEGIN;

WITH inst_time AS (
  SELECT
    mo.id AS museum_object_id,
    t.time_name,
    CASE
      WHEN NULLIF(BTRIM(t.time_start), '') ~ '^-?[0-9]+$'
        AND NULLIF(BTRIM(t.time_start), '')::bigint BETWEEN -1000000 AND 2027
        THEN NULLIF(BTRIM(t.time_start), '')
      ELSE NULL
    END AS time_start,
    CASE
      WHEN NULLIF(BTRIM(t.time_end), '') ~ '^-?[0-9]+$'
        AND NULLIF(BTRIM(t.time_end), '')::bigint BETWEEN -1000000 AND 2027
        THEN NULLIF(BTRIM(t.time_end), '')
      ELSE NULL
    END AS time_end
  FROM museum_objects mo
  JOIN museum_objects_components moc
    ON moc.entity_id = mo.id AND moc.field = 'time'
  JOIN components_time_name_time_infos t ON t.id = moc.component_id
  WHERE mo.institution_name = 'Vorderasiatisches Museum'
    AND mo.published_at IS NOT NULL
)
UPDATE museum_objects mo
SET
  object_date_display = NULLIF(BTRIM(it.time_name), ''),
  object_date_earliest = CASE
    WHEN it.time_start IS NOT NULL AND it.time_end IS NOT NULL
      THEN LEAST(it.time_start::int, it.time_end::int)
    WHEN it.time_start IS NOT NULL AND it.time_end IS NULL THEN it.time_start::int
    ELSE NULL
  END,
  object_date_latest = CASE
    WHEN it.time_start IS NOT NULL AND it.time_end IS NOT NULL
      THEN GREATEST(it.time_start::int, it.time_end::int)
    WHEN it.time_end IS NOT NULL AND it.time_start IS NULL THEN it.time_end::int
    ELSE NULL
  END,
  object_date_precision = CASE
    WHEN it.time_start IS NULL AND it.time_end IS NULL THEN 'unknown'
    WHEN it.time_start IS NULL AND it.time_end IS NOT NULL THEN 'before'
    WHEN it.time_end IS NULL AND it.time_start IS NOT NULL THEN 'after'
    WHEN it.time_name ~* '^c\.|^ca\.|^um |^about |^circa' THEN 'circa'
    WHEN it.time_start::int = it.time_end::int THEN 'exact'
    ELSE 'range'
  END
FROM inst_time it
WHERE mo.id = it.museum_object_id;

UPDATE museum_objects mo
SET object_date_precision = 'unknown'
WHERE mo.institution_name = 'Vorderasiatisches Museum'
  AND mo.published_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM museum_objects_components moc
    WHERE moc.entity_id = mo.id AND moc.field = 'time'
  );

COMMIT;

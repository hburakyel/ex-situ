-- Backfill: Museum für Islamische Kunst (SMB) creation-date migration
--
-- Diagnostics run before writing this:
--   - placeholder tokens: "N/A" (32 both-sides, symmetric — confirmed no
--     asymmetric N/A+numeric combos) and "?" (157 end-side "Nach X"/after
--     pattern, 1 start-side)
--   - min/max of numeric values: -2500..1999 / -1501..2000 — all plausible
--   - 7 reversed ranges (time_start > time_end), all identical pattern:
--     time_name "200-100 n. Chr." (start=200, end=100) — a source
--     entry-order quirk, not corruption; LEAST/GREATEST below resolves to
--     the correct chronological order (100-200 AD) same as it does for AIC
--   - 0 rows with no time component row at all
--   - 0 circa-like time_name prefixes
--
-- No acquisition-date source for this institution — left untouched (NULL).
--
-- Scoped strictly to institution_name = 'Museum für Islamische Kunst'.
-- Re-runnable: overwrites only this institution's rows.

BEGIN;

WITH inst_time AS (
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
  WHERE mo.institution_name = 'Museum für Islamische Kunst'
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
WHERE mo.institution_name = 'Museum für Islamische Kunst'
  AND mo.published_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM museum_objects_components moc
    WHERE moc.entity_id = mo.id AND moc.field = 'time'
  );

COMMIT;

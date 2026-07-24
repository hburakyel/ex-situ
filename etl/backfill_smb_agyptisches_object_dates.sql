-- Backfill: Ägyptisches Museum und Papyrussammlung (SMB) creation-date migration
--
-- Diagnostics run before writing this:
--   - placeholder tokens: "N/A" (107 both-sides, symmetric), 1 stray "?" on
--     time_end only, and a whitespace artifact " 0713" (1 row) — handled
--     fine by the existing BTRIM.
--   - min/max of numeric values: -500000..1901 / -200000..2000.
--     IMPORTANT: unlike every institution processed so far, the -500000
--     value is NOT garbage — it's 1 row (id 138887, inv "ÄM 18907",
--     time_name "Altpaläolithikum (-500000--200000)" = Lower Paleolithic,
--     a real archaeological era this museum legitimately holds artifacts
--     from. AIC/Met/Ethnologisches/Islamische Kunst were all checked and
--     have ZERO rows in the -1,000,000..-10,000 range, so this institution
--     needed its own wider floor rather than reusing AIC's -10000 bound
--     unquestioned — confirming the plausibility bound must be checked
--     per-institution, not assumed global.
--   - Bound widened to -1,000,000..2027 for this reason (kept for the
--     remaining SMB institutions too, as a safety margin).
--   - 0 reversed ranges, 0 rows with no time component, 0 asymmetric
--     N/A+numeric combos, 0 circa-like time_name prefixes.
--
-- No acquisition-date source for this institution — left untouched (NULL).
--
-- Scoped strictly to institution_name = 'Ägyptisches Museum und Papyrussammlung'.
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
  WHERE mo.institution_name = 'Ägyptisches Museum und Papyrussammlung'
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
WHERE mo.institution_name = 'Ägyptisches Museum und Papyrussammlung'
  AND mo.published_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM museum_objects_components moc
    WHERE moc.entity_id = mo.id AND moc.field = 'time'
  );

COMMIT;

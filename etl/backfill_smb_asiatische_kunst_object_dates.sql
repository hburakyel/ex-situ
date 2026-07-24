-- Backfill: Museum für Asiatische Kunst (SMB) creation-date migration
--
-- Diagnostics run before writing this:
--   - placeholder tokens: "N/A" (290 both-sides, symmetric), "?" (6
--     start-side, 8 end-side)
--   - min/max of numeric values: -10000..2008 / -2000..2008 — the -10000
--     floor is legitimate (2 rows, time_name "10000-2000 v. Chr.", same
--     Stone Age era pattern seen in Ethnologisches Museum), confirmed by
--     inspection, not garbage.
--   - 0 rows with no time component, 0 asymmetric N/A+numeric, 0 circa
--     prefixes, 0 explicit "v. Chr. without n. Chr." + positive-value rows.
--
--   Same sign-convention bug class as Antikensammlung, different era: 3
--   rows describe "Shang-Zeit" / "Späte Shang-Zeit" (Shang dynasty, China,
--   ~1600-1046 BCE — entirely BCE, no possible CE reading) but store
--   time_start/time_end as positive numbers (1600/1100, 1300/1100). Same
--   treatment as Antikensammlung: NOT sign-corrected (would be fabricating
--   a value), forced to object_date_precision='unknown' with time_name
--   preserved in object_date_display. Flagged in the final report.
--
-- No acquisition-date source for this institution — left untouched (NULL).
--
-- Scoped strictly to institution_name = 'Museum für Asiatische Kunst'.
-- Re-runnable: overwrites only this institution's rows.

BEGIN;

WITH inst_time AS (
  SELECT
    mo.id AS museum_object_id,
    t.time_name,
    (
      (t.time_name ~* 'v\.\s*Chr\.' AND t.time_name !~* 'n\.\s*Chr\.')
      OR t.time_name ~* 'bronzezeit|minoisch|helladisch|kykladisch|shang-zeit'
    ) AS bce_text_conflict,
    CASE
      WHEN NULLIF(BTRIM(t.time_start), '') ~ '^-?[0-9]+$'
        AND NULLIF(BTRIM(t.time_start), '')::bigint BETWEEN -1000000 AND 2027
        THEN NULLIF(BTRIM(t.time_start), '')
      ELSE NULL
    END AS time_start_raw,
    CASE
      WHEN NULLIF(BTRIM(t.time_end), '') ~ '^-?[0-9]+$'
        AND NULLIF(BTRIM(t.time_end), '')::bigint BETWEEN -1000000 AND 2027
        THEN NULLIF(BTRIM(t.time_end), '')
      ELSE NULL
    END AS time_end_raw
  FROM museum_objects mo
  JOIN museum_objects_components moc
    ON moc.entity_id = mo.id AND moc.field = 'time'
  JOIN components_time_name_time_infos t ON t.id = moc.component_id
  WHERE mo.institution_name = 'Museum für Asiatische Kunst'
    AND mo.published_at IS NOT NULL
),
inst_time_clean AS (
  SELECT
    museum_object_id,
    time_name,
    CASE WHEN bce_text_conflict AND time_start_raw::bigint > 0 THEN NULL ELSE time_start_raw END AS time_start,
    CASE WHEN bce_text_conflict AND time_end_raw::bigint > 0 THEN NULL ELSE time_end_raw END AS time_end
  FROM inst_time
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
FROM inst_time_clean it
WHERE mo.id = it.museum_object_id;

UPDATE museum_objects mo
SET object_date_precision = 'unknown'
WHERE mo.institution_name = 'Museum für Asiatische Kunst'
  AND mo.published_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM museum_objects_components moc
    WHERE moc.entity_id = mo.id AND moc.field = 'time'
  );

COMMIT;

-- Backfill: Antikensammlung (SMB) creation-date migration
--
-- Diagnostics run before writing this:
--   - placeholder tokens: "N/A" (3,654 both-sides, symmetric), "?" (6
--     start-side, 2 end-side)
--   - min/max of numeric values: -5500..3000 / -3001..2100
--   - 24 "reversed" ranges (time_start > time_end) — mostly benign entry-order
--     quirks (e.g. "315-301 n. Chr." = 315 AD to 301 AD, correctly resolved
--     by LEAST/GREATEST) EXCEPT for a distinct, more serious sub-case below.
--   - 0 rows with no time component, 0 asymmetric N/A+numeric, 0 circa prefixes
--
--   ** Sign-convention bug found (new pattern, not seen in AIC/Met/
--   Ethnologisches/Islamische Kunst/Ägyptisches): 20 rows describe
--   unambiguously BCE periods — either explicit "v. Chr." (BCE) text, or an
--   unambiguous Aegean Bronze Age era name (Minoisch/Helladisch/Kykladisch/
--   Bronzezeit, e.g. "Spätminoisch III" = Late Minoan III, ~1400-1100 BCE) —
--   but store time_start/time_end as POSITIVE numbers (e.g. 1400/1100
--   instead of -1400/-1100). Taken at face value this doesn't fail a plain
--   plausibility-bounds check (1400 CE is a perfectly ordinary year) — it
--   would silently produce a plausible-LOOKING but factually wrong
--   medieval-CE date instead of a Bronze-Age-BCE one. This is worse than
--   the sentinel-garbage cases found elsewhere because bounds-checking
--   alone can't catch it.
--   2 of the 20 rows are already caught by the existing <=2027 ceiling
--   (values of 3000/2000 and 2300/2100 both exceed it on both sides). The
--   remaining 18 fall inside the plausible 1..2027 window and need this
--   explicit text-based check. We do NOT attempt to guess-correct the sign
--   (that would be fabricating a value, not migrating one) — these are
--   forced to object_date_precision='unknown' instead, with the original
--   time_name preserved in object_date_display so the human-readable era
--   name isn't lost, only the unreliable numeric bounds are suppressed.
--   Flagged in the final report as a source data-quality issue for the SMB
--   team, not corrected here.
--
-- No acquisition-date source for this institution — left untouched (NULL).
--
-- Scoped strictly to institution_name = 'Antikensammlung'.
-- Re-runnable: overwrites only this institution's rows.

BEGIN;

WITH inst_time AS (
  SELECT
    mo.id AS museum_object_id,
    t.time_name,
    -- BCE-text-contradicts-positive-number check, applied before the
    -- ordinary bounds/regex check below.
    (
      (t.time_name ~* 'v\.\s*Chr\.' AND t.time_name !~* 'n\.\s*Chr\.')
      OR t.time_name ~* 'bronzezeit|minoisch|helladisch|kykladisch'
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
  WHERE mo.institution_name = 'Antikensammlung'
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
WHERE mo.institution_name = 'Antikensammlung'
  AND mo.published_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM museum_objects_components moc
    WHERE moc.entity_id = mo.id AND moc.field = 'time'
  );

COMMIT;

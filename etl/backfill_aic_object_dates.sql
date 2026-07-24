-- Backfill: Art Institute of Chicago creation-date pilot
--
-- Populates the new object_date_* columns (migration 014) for AIC only,
-- from AIC's existing time component data (time_name/time_start/time_end),
-- which was already populated at scrape time directly from AIC's own API
-- date_display/date_start/date_end fields — the cleanest source in the corpus.
--
-- AIC has no acquisition-date source captured today (its credit_line field,
-- which sometimes carries an accession year, isn't currently fetched) —
-- acquisition_year_* / acquisition_date_confidence are deliberately left
-- NULL here. Do not fabricate them.
--
-- Scoped strictly to institution_name = 'Art Institute of Chicago'.
-- Re-runnable: overwrites only AIC rows, does not touch any other institution.

BEGIN;

WITH aic_time AS (
  SELECT
    mo.id AS museum_object_id,
    t.time_name,
    -- Reject implausible sentinel/garbage values (e.g. a raw -1824528578 or
    -- 5000001 seen in 2 of 33,890 AIC rows — not real years, just noise from
    -- AIC's own API) rather than trusting "looks numeric" alone. Bound is
    -- generous: legitimate AIC data goes back to ~5000 BCE (Neolithic) and
    -- forward to the current year.
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
  WHERE mo.institution_name = 'Art Institute of Chicago'
    AND mo.published_at IS NOT NULL
)
UPDATE museum_objects mo
SET
  object_date_display = NULLIF(BTRIM(at.time_name), ''),
  object_date_earliest = CASE
    WHEN at.time_start ~ '^-?[0-9]+$' AND at.time_end ~ '^-?[0-9]+$'
      THEN LEAST(at.time_start::int, at.time_end::int)
    ELSE NULL
  END,
  object_date_latest = CASE
    WHEN at.time_start ~ '^-?[0-9]+$' AND at.time_end ~ '^-?[0-9]+$'
      THEN GREATEST(at.time_start::int, at.time_end::int)
    ELSE NULL
  END,
  object_date_precision = CASE
    -- NULL !~ pattern evaluates to NULL (not TRUE) in Postgres, so an
    -- explicit IS NULL check is required first — regex alone silently lets
    -- NULL bounds fall through to circa/range below.
    WHEN at.time_start IS NULL OR at.time_end IS NULL THEN 'unknown'
    WHEN at.time_start !~ '^-?[0-9]+$' OR at.time_end !~ '^-?[0-9]+$' THEN 'unknown'
    WHEN at.time_name ~* '^c\.|^ca\.|^about |^circa'
      THEN 'circa'
    WHEN at.time_start::int = at.time_end::int THEN 'exact'
    ELSE 'range'
  END
FROM aic_time at
WHERE mo.id = at.museum_object_id;

-- AIC rows with no time component row at all (no production date recorded by
-- AIC's own API) — explicit 'unknown', not left as silent NULL.
UPDATE museum_objects mo
SET object_date_precision = 'unknown'
WHERE mo.institution_name = 'Art Institute of Chicago'
  AND mo.published_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM museum_objects_components moc
    WHERE moc.entity_id = mo.id AND moc.field = 'time'
  );

COMMIT;

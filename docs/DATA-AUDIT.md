# Ex Situ — Data Audit

**Audit date:** May 2026  
**Dataset:** `ex-situ-objects-2026-05-04-2.csv`, 132,854 records  
**Production read-replica:** run all queries against a read-replica; never against the primary.

---

## Null-Field Rates Per Institution

```sql
-- Null rates for the 16 schema-desynchronized fields, grouped by institution.
-- Run after Phase 1 (schema sync) to establish a baseline; re-run after each
-- enrichment phase to measure improvement.

SELECT
  COALESCE(NULLIF(institution_name, ''), 'Unknown') AS institution,
  COUNT(*) AS total,

  -- Origin geocoding
  ROUND(100.0 * COUNT(*) FILTER (WHERE geocoding_confidence IS NULL) / COUNT(*), 1) AS pct_null_geocoding_confidence,
  ROUND(100.0 * COUNT(*) FILTER (WHERE geocoding_status     IS NULL) / COUNT(*), 1) AS pct_null_geocoding_status,
  ROUND(100.0 * COUNT(*) FILTER (WHERE geocoding_notes      IS NULL) / COUNT(*), 1) AS pct_null_geocoding_notes,
  ROUND(100.0 * COUNT(*) FILTER (WHERE geocoded_country     IS NULL) / COUNT(*), 1) AS pct_null_geocoded_country,
  ROUND(100.0 * COUNT(*) FILTER (WHERE geocoded_region      IS NULL) / COUNT(*), 1) AS pct_null_geocoded_region,
  ROUND(100.0 * COUNT(*) FILTER (WHERE geocoder_source      IS NULL) / COUNT(*), 1) AS pct_null_geocoder_source,

  -- Place normalisation
  ROUND(100.0 * COUNT(*) FILTER (WHERE place_name_normalized IS NULL) / COUNT(*), 1) AS pct_null_place_name_normalized,
  ROUND(100.0 * COUNT(*) FILTER (WHERE normalized_origin     IS NULL) / COUNT(*), 1) AS pct_null_normalized_origin,

  -- Classification
  ROUND(100.0 * COUNT(*) FILTER (WHERE origin_type          IS NULL) / COUNT(*), 1) AS pct_null_origin_type,
  ROUND(100.0 * COUNT(*) FILTER (WHERE cultural_context     IS NULL) / COUNT(*), 1) AS pct_null_cultural_context,
  ROUND(100.0 * COUNT(*) FILTER (WHERE historical_relation  IS NULL) / COUNT(*), 1) AS pct_null_historical_relation,
  ROUND(100.0 * COUNT(*) FILTER (WHERE transfer_method      IS NULL) / COUNT(*), 1) AS pct_null_transfer_method,

  -- Enrichment meta
  ROUND(100.0 * COUNT(*) FILTER (WHERE enrichment_confidence IS NULL) / COUNT(*), 1) AS pct_null_enrichment_confidence,
  ROUND(100.0 * COUNT(*) FILTER (WHERE review_status         IS NULL) / COUNT(*), 1) AS pct_null_review_status,

  -- Institution locality (Phase 2 target)
  ROUND(100.0 * COUNT(*) FILTER (WHERE institution_city_en    IS NULL) / COUNT(*), 1) AS pct_null_institution_city_en,
  ROUND(100.0 * COUNT(*) FILTER (WHERE institution_country_en IS NULL) / COUNT(*), 1) AS pct_null_institution_country_en

FROM museum_objects
WHERE published_at IS NOT NULL
GROUP BY COALESCE(NULLIF(institution_name, ''), 'Unknown')
ORDER BY total DESC;
```

---

## Coordinate Quality

```sql
-- Overall coordinate coverage and precision distribution.
-- Requires Phase 3 (coordinate_precision column) to be meaningful beyond the first block.

SELECT
  COUNT(*)                                                       AS total_objects,
  COUNT(*) FILTER (WHERE latitude  IS NOT NULL
                      AND longitude IS NOT NULL)                 AS has_origin_coords,
  COUNT(*) FILTER (WHERE manual_latitude  IS NOT NULL
                      AND manual_longitude IS NOT NULL)          AS has_manual_override,
  COUNT(*) FILTER (WHERE latitude  IS NULL
                      OR  longitude IS NULL)                     AS missing_origin_coords,
  COUNT(*) FILTER (WHERE institution_latitude  IS NOT NULL
                      AND institution_longitude IS NOT NULL)     AS has_institution_coords,
  -- After Phase 3:
  COUNT(*) FILTER (WHERE coordinate_precision = 'exact')        AS precision_exact,
  COUNT(*) FILTER (WHERE coordinate_precision = 'site')         AS precision_site,
  COUNT(*) FILTER (WHERE coordinate_precision = 'city')         AS precision_city,
  COUNT(*) FILTER (WHERE coordinate_precision = 'region')       AS precision_region,
  COUNT(*) FILTER (WHERE coordinate_precision = 'country')      AS precision_country,
  COUNT(*) FILTER (WHERE coordinate_precision IS NULL)          AS precision_unknown
FROM museum_objects
WHERE published_at IS NOT NULL;
```

---

## Known Coordinate Errors

```sql
-- Records currently displaying at Nigeria's geographic centroid (~7.99, 9.60)
-- instead of Benin City (~5.60, 7.06). Approximately 500 km error.
-- Targeted fix is in Phase 3 (Benin coordinate update).

SELECT
  id,
  object_id,
  title,
  place_name,
  latitude,
  longitude,
  manual_latitude,
  manual_longitude,
  COALESCE(manual_latitude, latitude)  AS displayed_lat,
  COALESCE(manual_longitude, longitude) AS displayed_lon
FROM museum_objects
WHERE published_at IS NOT NULL
  AND place_name ILIKE ANY (ARRAY['%Court of Benin%', '%Igun-Eronmwen%'])
ORDER BY object_id;
```

---

## Materialized View Staleness

```sql
-- Check when the geospatial materialized views were last refreshed.
-- Views go stale after bulk imports until a manual REFRESH is run (Phase 5 adds auto-refresh).

SELECT
  schemaname,
  matviewname,
  ispopulated,
  -- pg_stat_user_tables does not track MVs directly; use pg_class for size as a proxy
  pg_size_pretty(pg_total_relation_size(schemaname || '.' || matviewname)) AS size
FROM pg_matviews
WHERE schemaname = 'public'
ORDER BY matviewname;
```

---

## Inventory Number Format Distribution

```sql
-- Identifies multi-part inventory numbers (e.g. "1991.17.58a, b") that break
-- exact-match search. Phase 6 adds a normalized column to handle these.

SELECT
  COUNT(*) FILTER (WHERE inventory_number LIKE '%, %')  AS multi_part_count,
  COUNT(*) FILTER (WHERE inventory_number LIKE '%a, %'
                      OR  inventory_number LIKE '%b, %'
                      OR  inventory_number LIKE '%c, %') AS letter_suffix_count,
  COUNT(*) FILTER (WHERE inventory_number IS NOT NULL)   AS has_inventory_number,
  COUNT(*) FILTER (WHERE inventory_number IS NULL)       AS missing_inventory_number,
  COUNT(*)                                               AS total
FROM museum_objects
WHERE published_at IS NOT NULL;
```

---

## Notes

- All queries are read-only `SELECT` statements safe to run against a production replica.
- Re-run after each phase to verify improvement.
- The `coordinate_precision` and `place_name_normalized` columns referenced above do not exist until Phases 1 and 3 are applied; omit those `FILTER` clauses when running before those phases.

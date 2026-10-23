'use strict';

/**
 * The map's materialized views: pre-aggregated counts the map, the Time/Migration
 * filters and the place search read instead of the million-row museum_objects
 * table. Built at startup by src/index.js when missing, refreshed after data
 * imports by refresh_geospatial_views(), and rebuilt side by side by
 * scripts/rebuild-map-views.js when their definitions change.
 */

const { buildEraBuckets } = require('./api/museum-object/services/era-buckets');
const { PLACE_GROUP_KEY, PLACE_DISPLAY_EXPR, PLACE_VARIANTS_AGG, HISTORICAL_NAMES_AGG } = require('./api/museum-object/services/place-group');

const MV_COUNTRY_SQL = `
  CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_country_institution_stats AS
  SELECT
      COALESCE(NULLIF(country_en::text, ''), 'Unknown') AS origin_country,
      avg(COALESCE(manual_latitude, latitude))          AS origin_lat,
      avg(COALESCE(manual_longitude, longitude))        AS origin_lon,
      institution_name,
      avg(institution_latitude)                         AS inst_lat,
      avg(institution_longitude)                        AS inst_lon,
      COUNT(DISTINCT CASE
          WHEN inventory_number IS NOT NULL AND inventory_number != ''
          THEN inventory_number ELSE id::text END)::integer AS object_count,
      min(img_url)                                      AS sample_img_url
  FROM museum_objects
  WHERE
      published_at IS NOT NULL
      AND (manual_latitude IS NOT NULL OR latitude IS NOT NULL)
      AND (manual_longitude IS NOT NULL OR longitude IS NOT NULL)
      AND institution_latitude IS NOT NULL
      AND institution_longitude IS NOT NULL
      AND country_en IS NOT NULL
      AND country_en::text <> ''
      AND institution_name IS NOT NULL
  GROUP BY
      COALESCE(NULLIF(country_en::text, ''), 'Unknown'),
      institution_name
  WITH DATA;
`;

// Origin place grouping is shared with getClusteredData — see place-group.js.
const MV_CITY_SQL = `
  CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_city_institution_stats AS
  SELECT
      ${PLACE_GROUP_KEY}                         AS place_key,
      COALESCE(country_en::text, CHR(1))         AS country_key,
      mode() WITHIN GROUP (ORDER BY ${PLACE_DISPLAY_EXPR}) AS origin_city,
      ${PLACE_VARIANTS_AGG}                      AS place_variants,
      ${HISTORICAL_NAMES_AGG}                    AS historical_names,
      country_en,
      avg(COALESCE(manual_latitude, latitude))   AS origin_lat,
      avg(COALESCE(manual_longitude, longitude)) AS origin_lon,
      institution_name,
      avg(institution_latitude)                  AS inst_lat,
      avg(institution_longitude)                 AS inst_lon,
      COUNT(DISTINCT CASE
          WHEN inventory_number IS NOT NULL AND inventory_number != ''
          THEN inventory_number ELSE id::text END)::integer AS object_count,
      min(img_url)                               AS sample_img_url,
      min(COALESCE(manual_latitude, latitude))   AS min_lat,
      max(COALESCE(manual_latitude, latitude))   AS max_lat,
      min(COALESCE(manual_longitude, longitude)) AS min_lon,
      max(COALESCE(manual_longitude, longitude)) AS max_lon
  FROM museum_objects
  WHERE
      published_at IS NOT NULL
      AND (manual_latitude IS NOT NULL OR latitude IS NOT NULL)
      AND (manual_longitude IS NOT NULL OR longitude IS NOT NULL)
      AND institution_latitude IS NOT NULL
      AND institution_longitude IS NOT NULL
      AND institution_name IS NOT NULL
  GROUP BY
      ${PLACE_GROUP_KEY},
      country_en,
      institution_name
  WITH DATA;
`;

// ── Time/Migration ("date bucket") stats — fast path for getDateBucketCounts
// when no institution/city/country filter is active. Mirrors the shape of
// the live aggregate query in services/museum-object.js exactly, built from
// the same buildEraBuckets() list so the two never drift out of sync. ──
const ERA_BUCKETS = buildEraBuckets(new Date().getFullYear());

const TIME_SELECTS = (() => {
  const selects = [
    `COUNT(*) FILTER (WHERE object_date_precision = 'unknown') AS time_undated`,
    `COUNT(*) FILTER (WHERE object_date_precision = 'exact') AS time_exact_total`,
  ];
  for (const bucket of ERA_BUCKETS) {
    const overlapConds = [];
    if (bucket.end !== null) overlapConds.push(`object_date_earliest <= ${bucket.end}`);
    if (bucket.start !== null) overlapConds.push(`object_date_latest >= ${bucket.start}`);
    selects.push(`COUNT(*) FILTER (WHERE ${overlapConds.join(' AND ')}) AS time_${bucket.id.replace(/-/g, '_')}`);
  }
  return selects;
})();

const MV_TIME_SQL = (() => {
  const selects = TIME_SELECTS;
  return `
  CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_time_bucket_stats AS
  SELECT 1 AS row_key, ${selects.join(',\n      ')}
  FROM museum_objects
  WHERE published_at IS NOT NULL
  WITH DATA;
`;
})();

// One row per acquisition year (year IS NULL represents the "Unknown"
// bucket — everything not acquisition_date_confidence = 'confirmed').
const MV_ACQUISITION_YEAR_SQL = `
  CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_acquisition_year_stats AS
  SELECT acquisition_year_earliest AS year, COUNT(*)::integer AS count
  FROM museum_objects
  WHERE published_at IS NOT NULL AND acquisition_date_confidence = 'confirmed'
  GROUP BY acquisition_year_earliest
  UNION ALL
  SELECT NULL::integer AS year, COUNT(*)::integer AS count
  FROM museum_objects
  WHERE published_at IS NOT NULL AND acquisition_date_confidence IS DISTINCT FROM 'confirmed'
  WITH DATA;
`;

// Object-date spans (getDateBucketCounts' objectDateSpans) for the unfiltered case:
// a GROUP BY over every dated row, a second and a half with the Smithsonian rows.
const MV_DATE_SPAN_SQL = `
  CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_date_span_stats AS
  SELECT object_date_earliest AS earliest, object_date_latest AS latest, COUNT(*)::integer AS count
  FROM museum_objects
  WHERE published_at IS NOT NULL
    AND object_date_earliest IS NOT NULL AND object_date_latest IS NOT NULL
  GROUP BY object_date_earliest, object_date_latest
  WITH DATA;
`;

// The same Time / Migration / span counts per institution and country, for the
// filtered case (getDateBucketCounts with an institution and/or country filter):
// the filters select rows of these views exactly as they selected objects, and the
// counts add up. Counting a Smithsonian collection live took seconds per request.
// inst_key / country_key: the unique index columns, NULL written as CHR(1) so it
// stays apart from an empty string.
const MV_TIME_BY_GROUP_SQL = `
  CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_time_bucket_by_group AS
  SELECT institution_name, country_en,
      COALESCE(institution_name::text, CHR(1)) AS inst_key, COALESCE(country_en::text, CHR(1)) AS country_key,
      ${TIME_SELECTS.join(',\n      ')}
  FROM museum_objects
  WHERE published_at IS NOT NULL
  GROUP BY institution_name, country_en
  WITH DATA;
`;

const MV_ACQUISITION_BY_GROUP_SQL = `
  CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_acquisition_year_by_group AS
  SELECT institution_name, country_en,
      COALESCE(institution_name::text, CHR(1)) AS inst_key, COALESCE(country_en::text, CHR(1)) AS country_key,
      confirmed, year, COALESCE(year, -2147483648) AS year_key, COUNT(*)::integer AS count
  FROM (
    SELECT institution_name, country_en,
        acquisition_date_confidence IS NOT DISTINCT FROM 'confirmed' AS confirmed,
        CASE WHEN acquisition_date_confidence = 'confirmed' THEN acquisition_year_earliest END AS year
    FROM museum_objects
    WHERE published_at IS NOT NULL
  ) o
  GROUP BY institution_name, country_en, confirmed, year
  WITH DATA;
`;

const MV_DATE_SPAN_BY_GROUP_SQL = `
  CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_date_span_by_group AS
  SELECT institution_name, country_en,
      COALESCE(institution_name::text, CHR(1)) AS inst_key, COALESCE(country_en::text, CHR(1)) AS country_key,
      object_date_earliest AS earliest, object_date_latest AS latest, COUNT(*)::integer AS count
  FROM museum_objects
  WHERE published_at IS NOT NULL
    AND object_date_earliest IS NOT NULL AND object_date_latest IS NOT NULL
  GROUP BY institution_name, country_en, object_date_earliest, object_date_latest
  WITH DATA;
`;

// Place autocomplete (getSuggestions): the matching rows grouped by site, as the
// map's Sites list groups them, counting the rows whose raw place, label, city or
// country starts with what was typed. Grouping the live table on every keystroke
// took 12 s for "Unit" (United States, 500k Smithsonian rows). One row here per
// distinct combination of those four fields: a prefix selects rows of this view
// exactly as it selected rows of the table, and their counts and coordinate sums
// add up to the same result. The site key and display name follow from the four
// fields, so they are stored per row too.
const MV_PLACE_SUGGEST_SQL = `
  CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_place_suggest AS
  SELECT
      md5(concat_ws(CHR(1), place_name, place_name_normalized, city_en, country_en,
          (place_name_normalized IS NULL)::text, (city_en IS NULL)::text, (country_en IS NULL)::text)) AS row_key,
      place_name,
      place_name_normalized,
      city_en,
      country_en,
      ${PLACE_GROUP_KEY}                         AS place_key,
      ${PLACE_DISPLAY_EXPR}                      AS display_name,
      COUNT(*)::integer                          AS object_count,
      SUM(COALESCE(manual_latitude, latitude))   AS sum_lat,
      COUNT(COALESCE(manual_latitude, latitude))::integer AS n_lat,
      SUM(COALESCE(manual_longitude, longitude)) AS sum_lon,
      COUNT(COALESCE(manual_longitude, longitude))::integer AS n_lon
  FROM museum_objects
  WHERE place_name IS NOT NULL
  GROUP BY place_name, place_name_normalized, city_en, country_en
  WITH DATA;
`;

// Each view with the plain columns of its unique index: REFRESH ... CONCURRENTLY
// needs one.
const MAP_VIEWS = [
  { name: 'mv_country_institution_stats', sql: MV_COUNTRY_SQL, key: 'origin_country, institution_name' },
  { name: 'mv_city_institution_stats', sql: MV_CITY_SQL, key: 'place_key, country_key, institution_name' },
  { name: 'mv_time_bucket_stats', sql: MV_TIME_SQL, key: 'row_key' },
  { name: 'mv_acquisition_year_stats', sql: MV_ACQUISITION_YEAR_SQL, key: 'year' },
  { name: 'mv_date_span_stats', sql: MV_DATE_SPAN_SQL, key: 'earliest, latest' },
  { name: 'mv_place_suggest', sql: MV_PLACE_SUGGEST_SQL, key: 'row_key' },
  { name: 'mv_time_bucket_by_group', sql: MV_TIME_BY_GROUP_SQL, key: 'inst_key, country_key' },
  { name: 'mv_acquisition_year_by_group', sql: MV_ACQUISITION_BY_GROUP_SQL, key: 'inst_key, country_key, confirmed, year_key' },
  { name: 'mv_date_span_by_group', sql: MV_DATE_SPAN_BY_GROUP_SQL, key: 'inst_key, country_key, earliest, latest' },
];

/** The view's CREATE statement under another name (scripts/rebuild-map-views.js). */
function createViewSql(view, name = view.name) {
  return view.sql.replace(`public.${view.name} AS`, `public.${name} AS`);
}

function uniqueIndexSql(view, name = view.name) {
  return `CREATE UNIQUE INDEX IF NOT EXISTS ${name}_key ON public.${name} (${view.key});`;
}

// Called after data imports (services/museum-object.js refreshGeospatialViews,
// etl/normalize_country_names.py, the ETL steps in CLAUDE.md). CONCURRENTLY, with
// the unique indexes: the map keeps reading the old rows while the new ones are
// counted. A plain refresh locked the views for the whole count, a minute and a
// half with the Smithsonian rows, and every map request waited for it.
const REFRESH_FUNCTION_SQL = `
  CREATE OR REPLACE FUNCTION public.refresh_geospatial_views() RETURNS void
  LANGUAGE plpgsql AS $$
  BEGIN
${MAP_VIEWS.map((v) => `    REFRESH MATERIALIZED VIEW CONCURRENTLY public.${v.name};`).join('\n')}
  END;
  $$;
`;

/** Create any missing view and its unique index, and the refresh function. */
async function ensureMapViews(db) {
  for (const view of MAP_VIEWS) {
    const { rows } = await db.raw('SELECT EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = ?) AS exists', [view.name]);
    if (!rows[0].exists) await db.raw(createViewSql(view));
    await db.raw(uniqueIndexSql(view));
  }
  await db.raw(REFRESH_FUNCTION_SQL);
}

module.exports = { MAP_VIEWS, REFRESH_FUNCTION_SQL, createViewSql, uniqueIndexSql, ensureMapViews };

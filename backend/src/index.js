'use strict';

/**
 * Pre-boot: drop DB objects that depend on manual_latitude/manual_longitude
 * (or on other Strapi-schema-synced museum_objects columns, for the
 * date-bucket views) so Strapi's schema sync can freely alter these columns.
 * Post-boot: ensure the columns + all dependent objects exist.
 */

const { buildEraBuckets } = require('./api/museum-object/services/era-buckets');

const DROP_DEPENDENCIES_SQL = `
  DROP INDEX IF EXISTS idx_museum_objects_resolved_lat;
  DROP INDEX IF EXISTS idx_museum_objects_resolved_lon;
  DROP INDEX IF EXISTS idx_museum_objects_resolved_coords;
  DROP MATERIALIZED VIEW IF EXISTS public.mv_country_institution_stats;
  DROP MATERIALIZED VIEW IF EXISTS public.mv_city_institution_stats;
  DROP MATERIALIZED VIEW IF EXISTS public.mv_time_bucket_stats;
  DROP MATERIALIZED VIEW IF EXISTS public.mv_acquisition_year_stats;
`;

const RESTORE_DEPENDENCIES_SQL = `
  -- Ensure columns exist
  ALTER TABLE public.museum_objects ADD COLUMN IF NOT EXISTS manual_latitude double precision;
  ALTER TABLE public.museum_objects ADD COLUMN IF NOT EXISTS manual_longitude double precision;

  -- Expression indexes
  CREATE INDEX IF NOT EXISTS idx_museum_objects_resolved_lat
      ON public.museum_objects USING btree (COALESCE(manual_latitude, latitude))
      WHERE published_at IS NOT NULL;

  CREATE INDEX IF NOT EXISTS idx_museum_objects_resolved_lon
      ON public.museum_objects USING btree (COALESCE(manual_longitude, longitude))
      WHERE published_at IS NOT NULL;

  CREATE INDEX IF NOT EXISTS idx_museum_objects_resolved_coords
      ON public.museum_objects USING btree (
          COALESCE(manual_latitude, latitude),
          COALESCE(manual_longitude, longitude)
      )
      WHERE (
          published_at IS NOT NULL
          AND (manual_latitude IS NOT NULL OR latitude IS NOT NULL)
          AND (manual_longitude IS NOT NULL OR longitude IS NOT NULL)
          AND institution_latitude IS NOT NULL
          AND institution_longitude IS NOT NULL
      );
`;

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

const MV_CITY_SQL = `
  CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_city_institution_stats AS
  SELECT
      COALESCE(
          CASE WHEN city_en IS NOT NULL AND TRIM(city_en) != ''
                    AND octet_length(city_en) = char_length(city_en)
               THEN city_en END,
          COALESCE(NULLIF(country_en::text, ''), 'Unknown')
      ) AS origin_city,
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
      COALESCE(
          CASE WHEN city_en IS NOT NULL AND TRIM(city_en) != ''
                    AND octet_length(city_en) = char_length(city_en)
               THEN city_en END,
          COALESCE(NULLIF(country_en::text, ''), 'Unknown')
      ),
      country_en,
      institution_name
  WITH DATA;
`;

// ── Time/Migration ("date bucket") stats — fast path for getDateBucketCounts
// when no institution/city/country filter is active. Mirrors the shape of
// the live aggregate query in services/museum-object.js exactly, built from
// the same buildEraBuckets() list so the two never drift out of sync. ──
const ERA_BUCKETS = buildEraBuckets(new Date().getFullYear());

const MV_TIME_SQL = (() => {
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
  return `
  CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_time_bucket_stats AS
  SELECT ${selects.join(',\n      ')}
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

module.exports = {
  register() {},

  /**
   * Runs AFTER Strapi schema sync — ensure columns + all dependent objects exist.
   * The pre-strapi.js script drops these objects BEFORE Strapi boots.
   */
  async bootstrap({ strapi }) {
    const db = strapi.db?.connection;
    if (!db) return;
    try {
      // 1. Ensure columns + trigger + indexes
      await db.raw(RESTORE_DEPENDENCIES_SQL);

      // 2. Ensure materialized views
      const [{ exists: mvCountry }] = (await db.raw(
        "SELECT EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = 'mv_country_institution_stats') AS exists"
      )).rows;
      if (!mvCountry) await db.raw(MV_COUNTRY_SQL);

      const [{ exists: mvCity }] = (await db.raw(
        "SELECT EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = 'mv_city_institution_stats') AS exists"
      )).rows;
      if (!mvCity) await db.raw(MV_CITY_SQL);

      const [{ exists: mvTime }] = (await db.raw(
        "SELECT EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = 'mv_time_bucket_stats') AS exists"
      )).rows;
      if (!mvTime) await db.raw(MV_TIME_SQL);

      const [{ exists: mvAcqYear }] = (await db.raw(
        "SELECT EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = 'mv_acquisition_year_stats') AS exists"
      )).rows;
      if (!mvAcqYear) await db.raw(MV_ACQUISITION_YEAR_SQL);

      strapi.log.info('[lifecycle] Restored manual-coord columns + dependent objects (post-sync)');
    } catch (err) {
      strapi.log.error('[lifecycle] Failed to restore dependencies:', err.message);
    }
  },
};

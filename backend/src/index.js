'use strict';

/**
 * Pre-boot: drop DB objects that depend on manual_latitude/manual_longitude
 * so Strapi's schema sync can freely alter these columns.
 * Post-boot: ensure the columns + all dependent objects exist.
 */

const DROP_DEPENDENCIES_SQL = `
  DROP TRIGGER IF EXISTS museum_objects_geom_trigger ON public.museum_objects;
  DROP INDEX IF EXISTS idx_museum_objects_resolved_lat;
  DROP INDEX IF EXISTS idx_museum_objects_resolved_lon;
  DROP INDEX IF EXISTS idx_museum_objects_resolved_coords;
  DROP MATERIALIZED VIEW IF EXISTS public.mv_country_institution_stats;
  DROP MATERIALIZED VIEW IF EXISTS public.mv_city_institution_stats;
`;

const RESTORE_DEPENDENCIES_SQL = `
  -- Ensure columns exist
  ALTER TABLE public.museum_objects ADD COLUMN IF NOT EXISTS manual_latitude double precision;
  ALTER TABLE public.museum_objects ADD COLUMN IF NOT EXISTS manual_longitude double precision;

  -- Trigger function
  CREATE OR REPLACE FUNCTION public.update_geom_from_lat_lon()
  RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
      IF COALESCE(NEW.manual_latitude, NEW.latitude) IS NOT NULL
         AND COALESCE(NEW.manual_longitude, NEW.longitude) IS NOT NULL THEN
          NEW.geom := ST_SetSRID(ST_MakePoint(
              COALESCE(NEW.manual_longitude, NEW.longitude),
              COALESCE(NEW.manual_latitude, NEW.latitude)
          ), 4326)::geography;
      ELSE
          NEW.geom := NULL;
      END IF;
      RETURN NEW;
  END;
  $$;

  -- Trigger
  DROP TRIGGER IF EXISTS museum_objects_geom_trigger ON public.museum_objects;
  CREATE TRIGGER museum_objects_geom_trigger
  BEFORE INSERT OR UPDATE ON public.museum_objects
  FOR EACH ROW EXECUTE FUNCTION public.update_geom_from_lat_lon();

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
      count(*)::integer                                 AS object_count,
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
      COALESCE(NULLIF(city_en::text, ''), COALESCE(NULLIF(country_en::text, ''), 'Unknown')) AS origin_city,
      country_en,
      avg(COALESCE(manual_latitude, latitude))   AS origin_lat,
      avg(COALESCE(manual_longitude, longitude)) AS origin_lon,
      institution_name,
      avg(institution_latitude)                  AS inst_lat,
      avg(institution_longitude)                 AS inst_lon,
      count(*)::integer                          AS object_count,
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
      COALESCE(NULLIF(city_en::text, ''), COALESCE(NULLIF(country_en::text, ''), 'Unknown')),
      country_en,
      institution_name
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

      strapi.log.info('[lifecycle] Restored manual-coord columns + dependent objects (post-sync)');
    } catch (err) {
      strapi.log.error('[lifecycle] Failed to restore dependencies:', err.message);
    }
  },
};

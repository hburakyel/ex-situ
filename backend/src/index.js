'use strict';

/**
 * Pre-boot: drop DB objects that depend on manual_latitude/manual_longitude
 * (or on other Strapi-schema-synced museum_objects columns, for the
 * date-bucket views) so Strapi's schema sync can freely alter these columns.
 * Post-boot: ensure the columns + all dependent objects exist.
 */

const { viewFingerprints, FINGERPRINT_TABLE_SQL } = require('../scripts/view-fingerprint');
const { ensureMapViews } = require('./map-views');

const DROP_DEPENDENCIES_SQL = `
  DROP INDEX IF EXISTS idx_museum_objects_resolved_lat;
  DROP INDEX IF EXISTS idx_museum_objects_resolved_lon;
  DROP INDEX IF EXISTS idx_museum_objects_resolved_coords;
  DROP MATERIALIZED VIEW IF EXISTS public.mv_country_institution_stats;
  DROP MATERIALIZED VIEW IF EXISTS public.mv_city_institution_stats;
  DROP MATERIALIZED VIEW IF EXISTS public.mv_time_bucket_stats;
  DROP MATERIALIZED VIEW IF EXISTS public.mv_acquisition_year_stats;
`;

// V&A import dedupe. scripts/pre-strapi.js drops it so Strapi's schema sync can run
// (Strapi doesn't know it and fails dropping it as a constraint); restored on its own
// so a failure here (e.g. a duplicate row) never stops the map views being rebuilt.
const VA_DEDUPE_INDEX_SQL = `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_museum_objects_va_inv_source_unique
      ON public.museum_objects USING btree (institution_name, inventory_number, source_link)
      WHERE ((institution_name)::text = 'Victoria and Albert Museum'::text AND inventory_number IS NOT NULL);
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
      try {
        await db.raw(VA_DEDUPE_INDEX_SQL);
      } catch (err) {
        strapi.log.warn(`[bootstrap] V&A dedupe index not restored: ${err.message}`);
      }

      // 2. Ensure materialized views
      await ensureMapViews(db);

      // Built from this code: the next start keeps them unless it changes.
      await db.raw(FINGERPRINT_TABLE_SQL);
      const fp = viewFingerprints();
      await db.raw(
        `INSERT INTO public.exsitu_view_state (id, views_fp, schema_fp) VALUES (1, :views, :schema)
         ON CONFLICT (id) DO UPDATE SET views_fp = EXCLUDED.views_fp, schema_fp = EXCLUDED.schema_fp, built_at = now()`,
        fp
      );

      strapi.log.info('[lifecycle] Restored manual-coord columns + dependent objects (post-sync)');

      // Count the totals every map page asks for now, in the background, so the
      // first visitors after a restart don't wait for them.
      strapi.service('api::museum-object.museum-object').getResolverStats()
        .catch((err) => strapi.log.warn(`[bootstrap] resolver stats not counted: ${err.message}`));
    } catch (err) {
      strapi.log.error('[lifecycle] Failed to restore dependencies:', err.message);
    }
  },
};

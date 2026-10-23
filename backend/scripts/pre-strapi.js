#!/usr/bin/env node
'use strict';

/**
 * Pre-start script: drop DB objects that depend on manual_latitude / manual_longitude
 * so Strapi's schema sync can freely alter these columns without CASCADE errors.
 *
 * Runs BEFORE `strapi develop` or `strapi start`.
 * After Strapi boots, the bootstrap() hook in src/index.js restores everything.
 */

const path = require('path');
const { viewFingerprints, FINGERPRINT_TABLE_SQL } = require('./view-fingerprint');

async function main() {
  // Load .env from backend root
  const envPath = path.resolve(__dirname, '..', '.env');
  try {
    require('dotenv').config({ path: envPath });
  } catch {
    // dotenv might not be installed; fall back to reading .env manually
    const fs = require('fs');
    if (fs.existsSync(envPath)) {
      fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
        const match = line.match(/^([^#=]+)=(.*)$/);
        if (match) process.env[match[1].trim()] = match[2].trim();
      });
    }
  }

  const { Client } = require('pg');
  const client = new Client({
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    database: process.env.DATABASE_NAME || 'museum_db',
    user: process.env.DATABASE_USERNAME || 'museum_user',
    password: process.env.DATABASE_PASSWORD || '',
  });

  try {
    await client.connect();

    // Partial unique index (V&A import dedupe) that isn't in the Strapi schema: at
    // every start Strapi tries to drop it as a constraint and fails, so it always goes;
    // src/index.js restores it. Also the stale geom trigger (removed 2025-05).
    await client.query(`
      DROP TRIGGER IF EXISTS museum_objects_geom_trigger ON museum_objects;
      DROP FUNCTION IF EXISTS update_geom_from_lat_lon() CASCADE;
      DROP INDEX IF EXISTS idx_museum_objects_va_inv_source_unique;
    `);

    // The objects that reference manual_latitude / manual_longitude (and other synced
    // columns) block Strapi from altering those columns. They go only when the views'
    // definitions or Strapi's schemas changed since they were built (view-fingerprint.js):
    // otherwise the map keeps its views and the API is back in seconds.
    await client.query(FINGERPRINT_TABLE_SQL);
    const stored = (await client.query('SELECT views_fp, schema_fp FROM public.exsitu_view_state WHERE id = 1')).rows[0];
    const current = viewFingerprints();
    if (stored && stored.views_fp === current.views && stored.schema_fp === current.schema) {
      console.log('[pre-strapi] Views and schemas unchanged — map views kept.');
      return;
    }
    await client.query(`
      DELETE FROM public.exsitu_view_state;
      DROP INDEX IF EXISTS idx_museum_objects_resolved_lat;
      DROP INDEX IF EXISTS idx_museum_objects_resolved_lon;
      DROP INDEX IF EXISTS idx_museum_objects_resolved_coords;
      DROP MATERIALIZED VIEW IF EXISTS public.mv_country_institution_stats;
      DROP MATERIALIZED VIEW IF EXISTS public.mv_city_institution_stats;
      DROP MATERIALIZED VIEW IF EXISTS public.mv_time_bucket_stats;
      DROP MATERIALIZED VIEW IF EXISTS public.mv_acquisition_year_stats;
      DROP MATERIALIZED VIEW IF EXISTS public.mv_place_suggest;
      DROP MATERIALIZED VIEW IF EXISTS public.mv_date_span_stats;
      DROP MATERIALIZED VIEW IF EXISTS public.mv_time_bucket_by_group;
      DROP MATERIALIZED VIEW IF EXISTS public.mv_acquisition_year_by_group;
      DROP MATERIALIZED VIEW IF EXISTS public.mv_date_span_by_group;
    `);

    console.log('[pre-strapi] Views or schemas changed — dropped the map views; Strapi can sync safely and rebuilds them.');
  } catch (err) {
    // Non-fatal: if DB is unreachable, let Strapi handle the error
    console.warn('[pre-strapi] Could not drop dependencies (DB may be offline):', err.message);
  } finally {
    await client.end().catch(() => {});
  }
}

main();

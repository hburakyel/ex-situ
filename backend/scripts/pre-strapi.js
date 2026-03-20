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

    // Drop all objects that reference manual_latitude / manual_longitude
    await client.query(`
      DROP TRIGGER IF EXISTS museum_objects_geom_trigger ON public.museum_objects;
      DROP INDEX IF EXISTS idx_museum_objects_resolved_lat;
      DROP INDEX IF EXISTS idx_museum_objects_resolved_lon;
      DROP INDEX IF EXISTS idx_museum_objects_resolved_coords;
      DROP MATERIALIZED VIEW IF EXISTS public.mv_country_institution_stats;
      DROP MATERIALIZED VIEW IF EXISTS public.mv_city_institution_stats;
    `);

    console.log('[pre-strapi] Dropped manual-coord dependent objects — Strapi can sync safely.');
  } catch (err) {
    // Non-fatal: if DB is unreachable, let Strapi handle the error
    console.warn('[pre-strapi] Could not drop dependencies (DB may be offline):', err.message);
  } finally {
    await client.end().catch(() => {});
  }
}

main();

#!/usr/bin/env node
'use strict';

/**
 * Rebuild the map's materialized views (src/map-views.js) from this checkout while
 * the running backend keeps serving the old ones: each view is built as
 * <name>__next beside the live one, then all are swapped in one short transaction
 * (drop old, rename new). Stores the views fingerprint, so the restart that
 * follows keeps them (scripts/pre-strapi.js) and the API is back in seconds
 * instead of minutes.
 *
 * Run before restarting the backend on new code (scripts/deploy/deploy.sh does):
 *
 *   node backend/scripts/rebuild-map-views.js --if-changed
 *
 * The running backend reads the new views by the old names until it restarts,
 * so a definition change must keep the columns the old code reads. A change to
 * Strapi's schemas still drops and rebuilds the views at startup: Strapi has to
 * alter columns they depend on.
 *
 * --if-changed        do nothing when the stored views fingerprint matches this checkout
 * --schema-unchanged  this checkout's Strapi schemas are the ones the database runs
 *                     (deploy.sh: no content-type or component file changed): store
 *                     their fingerprint too, so the first restart after this script
 *                     existed keeps the views as well
 */

const path = require('path');
const { Client } = require('pg');
const { viewFingerprints, FINGERPRINT_TABLE_SQL } = require('./view-fingerprint');
const { MAP_VIEWS, REFRESH_FUNCTION_SQL, createViewSql, uniqueIndexSql } = require('../src/map-views');

const NEXT = (name) => `${name}__next`;

function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  try {
    require('dotenv').config({ path: envPath });
  } catch {
    const fs = require('fs');
    if (fs.existsSync(envPath)) {
      fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
        const match = line.match(/^([^#=]+)=(.*)$/);
        if (match) process.env[match[1].trim()] = match[2].trim();
      });
    }
  }
}

const log = (msg) => console.log(`[rebuild-map-views] ${msg}`);

async function main() {
  loadEnv();
  const client = new Client({
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    database: process.env.DATABASE_NAME || 'museum_db',
    user: process.env.DATABASE_USERNAME || 'museum_user',
    password: process.env.DATABASE_PASSWORD || '',
  });
  await client.connect();
  try {
    const fp = viewFingerprints();
    await client.query(FINGERPRINT_TABLE_SQL);
    const stored = (await client.query('SELECT views_fp FROM public.exsitu_view_state WHERE id = 1')).rows[0];
    if (process.argv.includes('--if-changed') && stored && stored.views_fp === fp.views) {
      log('view definitions unchanged — nothing to do');
      return;
    }

    for (const view of MAP_VIEWS) {
      const started = Date.now();
      await client.query(`DROP MATERIALIZED VIEW IF EXISTS public.${NEXT(view.name)}`);
      await client.query(createViewSql(view, NEXT(view.name)));
      await client.query(uniqueIndexSql(view, NEXT(view.name)));
      log(`built ${NEXT(view.name)} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    }

    // The swap waits for running reads of the old views; a lock timeout keeps it
    // from queueing new map requests behind a long one. Retried a few times.
    for (let attempt = 1; ; attempt++) {
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '5s'");
        for (const view of MAP_VIEWS) {
          await client.query(`DROP MATERIALIZED VIEW IF EXISTS public.${view.name}`);
          await client.query(`ALTER MATERIALIZED VIEW public.${NEXT(view.name)} RENAME TO ${view.name}`);
          await client.query(`ALTER INDEX public.${NEXT(view.name)}_key RENAME TO ${view.name}_key`);
        }
        await client.query(REFRESH_FUNCTION_SQL);
        await client.query(
          `INSERT INTO public.exsitu_view_state (id, views_fp) VALUES (1, $1)
           ON CONFLICT (id) DO UPDATE SET views_fp = EXCLUDED.views_fp, built_at = now()`,
          [fp.views]
        );
        if (process.argv.includes('--schema-unchanged')) {
          await client.query('UPDATE public.exsitu_view_state SET schema_fp = $1 WHERE id = 1', [fp.schema]);
        }
        await client.query('COMMIT');
        break;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (attempt >= 5) throw err;
        log(`swap attempt ${attempt} failed (${err.message}); retrying`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    log('views swapped in');
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error('[rebuild-map-views] failed:', err.message);
  process.exit(1);
});

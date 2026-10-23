'use strict';

/**
 * Fingerprints of what the map's materialized views depend on:
 *   views   their SQL (src/map-views.js and the services it builds them from)
 *           and the current year (the era buckets end at it)
 *   schema  Strapi's content-type and component schemas: a change makes Strapi
 *           alter museum_objects columns, which the views block
 *
 * scripts/pre-strapi.js drops the views only when either differs from what was
 * stored when they were last built (src/index.js at startup, or
 * scripts/rebuild-map-views.js, which builds new views beside the live ones and
 * stores only the views fingerprint). Rebuilding them on every start kept the map
 * API down for minutes with a million rows.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BACKEND = path.resolve(__dirname, '..');

const VIEW_FILES = [
  'src/map-views.js',
  'src/api/museum-object/services/place-group.js',
  'src/api/museum-object/services/era-buckets.js',
];

function jsonFilesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return jsonFilesUnder(p);
    return e.name.endsWith('.json') ? [p] : [];
  });
}

function hashFiles(files, extra = '') {
  const hash = crypto.createHash('sha256');
  hash.update(extra);
  for (const f of [...files].sort()) {
    hash.update(path.relative(BACKEND, f));
    hash.update(fs.readFileSync(f));
  }
  return hash.digest('hex');
}

function viewFingerprints() {
  return {
    views: hashFiles(VIEW_FILES.map((f) => path.join(BACKEND, f)), String(new Date().getFullYear())),
    schema: hashFiles([
      ...jsonFilesUnder(path.join(BACKEND, 'src/api')).filter((f) => f.includes(`${path.sep}content-types${path.sep}`)),
      ...jsonFilesUnder(path.join(BACKEND, 'src/components')),
    ]),
  };
}

// One row: the fingerprints the views were last built with.
const FINGERPRINT_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS public.exsitu_view_state (
    id integer PRIMARY KEY CHECK (id = 1),
    views_fp text,
    schema_fp text,
    built_at timestamptz NOT NULL DEFAULT now()
  );
`;

module.exports = { viewFingerprints, FINGERPRINT_TABLE_SQL };

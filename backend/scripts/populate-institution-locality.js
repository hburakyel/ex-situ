/**
 * Phase 2: Populate institution_city_en and institution_country_en
 *
 * For records not covered by migration 008 (the static SQL mapping), this script
 * calls the Nominatim geocoding API to resolve institution_place → (city, country).
 *
 * Usage:
 *   node scripts/populate-institution-locality.js [--dry-run]
 *
 * Flags:
 *   --dry-run   Print intended changes without writing to the database.
 *
 * Prerequisites:
 *   - Run migration 008 first (covers major institutions via static mapping).
 *   - API_TOKEN and STRAPI_BASE_URL in backend/.env.
 *
 * Rate limiting: Nominatim allows ~1 req/s. This script enforces a 1.1 s delay
 * between requests and retries once on rate-limit (429) or transient (5xx) errors.
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fetch = require('node-fetch');

const STRAPI_URL  = process.env.STRAPI_BASE_URL || 'http://127.0.0.1:1337/api/museum-objects';
const API_TOKEN   = process.env.API_TOKEN;
const DRY_RUN     = process.argv.includes('--dry-run');
const BATCH_SIZE  = 100;
const DELAY_MS    = 1100; // Nominatim: 1 req/s, add 100 ms headroom

if (!API_TOKEN) {
  console.error('Missing API_TOKEN in .env');
  process.exit(1);
}

if (DRY_RUN) {
  console.log('🔍 DRY RUN — no changes will be written.\n');
}

/** Sleep for `ms` milliseconds. */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetch the next page of published objects that still have a NULL
 * institution_city_en or institution_country_en, but have a non-empty
 * institution_place to geocode from.
 */
async function fetchPage(page) {
  const url = new URL(STRAPI_URL);
  url.searchParams.set('pagination[page]', page);
  url.searchParams.set('pagination[pageSize]', BATCH_SIZE);
  url.searchParams.set('filters[publishedAt][$null]', 'false');
  // Only fetch records that still need institution locality data
  url.searchParams.set('filters[$or][0][institution_city_en][$null]', 'true');
  url.searchParams.set('filters[$or][1][institution_country_en][$null]', 'true');
  // Must have institution_place to geocode
  url.searchParams.set('filters[institution_place][$notNull]', 'true');
  url.searchParams.set('fields[0]', 'id');
  url.searchParams.set('fields[1]', 'institution_place');
  url.searchParams.set('fields[2]', 'institution_city_en');
  url.searchParams.set('fields[3]', 'institution_country_en');

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Strapi fetch failed: ${res.status} ${res.statusText}`);
  const body = await res.json();
  return body.data || [];
}

/**
 * Resolve institution_place to (city_en, country_en) via Nominatim.
 * Returns null if geocoding fails or returns no usable address.
 */
async function geocodePlace(placeName, retries = 1) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(placeName)}&format=json&addressdetails=1&limit=1&accept-language=en`;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(DELAY_MS * 2); // back off before retry
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'ex-situ/1.0 (https://exsitu.app)' },
      });
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`Nominatim HTTP ${res.status}`);
        continue;
      }
      const results = await res.json();
      if (!results || results.length === 0) return null;
      const addr = results[0].address;
      const city_en =
        addr.city || addr.town || addr.municipality || addr.county || null;
      const country_en = addr.country || null;
      return city_en || country_en ? { city_en, country_en } : null;
    } catch (err) {
      lastError = err;
    }
  }
  console.warn(`  ⚠ Nominatim lookup failed for "${placeName}": ${lastError?.message}`);
  return null;
}

/** PATCH a single Strapi record with institution locality data. */
async function updateRecord(id, payload) {
  const res = await fetch(`${STRAPI_URL}/${id}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ data: payload }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Strapi PUT ${id} failed: ${res.status} — ${body.slice(0, 200)}`);
  }
}

async function main() {
  let page = 1;
  let totalUpdated = 0;
  let totalSkipped = 0;

  // Cache geocoding results to avoid duplicate Nominatim calls for the same place.
  const geocodeCache = new Map();

  while (true) {
    const records = await fetchPage(page);
    if (records.length === 0) break;

    for (const record of records) {
      const { id, attributes } = record;
      const placeName = attributes.institution_place?.trim();

      if (!placeName) {
        totalSkipped++;
        continue;
      }

      // Skip if both fields are already populated.
      if (attributes.institution_city_en && attributes.institution_country_en) {
        totalSkipped++;
        continue;
      }

      let locality = geocodeCache.get(placeName);
      if (locality === undefined) {
        await sleep(DELAY_MS);
        locality = await geocodePlace(placeName);
        geocodeCache.set(placeName, locality);
      }

      if (!locality) {
        console.log(`  ✗ No geocode result for "${placeName}" (id ${id}) — skipping`);
        totalSkipped++;
        continue;
      }

      const payload = {};
      if (!attributes.institution_city_en    && locality.city_en)    payload.institution_city_en    = locality.city_en;
      if (!attributes.institution_country_en && locality.country_en)  payload.institution_country_en = locality.country_en;

      if (Object.keys(payload).length === 0) {
        totalSkipped++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`  [DRY RUN] id ${id} "${placeName}" →`, payload);
      } else {
        try {
          await updateRecord(id, payload);
          console.log(`  ✓ id ${id} "${placeName}" →`, payload);
        } catch (err) {
          console.error(`  ✗ Failed to update id ${id}:`, err.message);
          totalSkipped++;
          continue;
        }
      }
      totalUpdated++;
    }

    console.log(`Page ${page} processed (${records.length} records).`);
    page++;
  }

  console.log(`\nDone. Updated: ${totalUpdated}, Skipped/failed: ${totalSkipped}.`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

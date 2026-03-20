/**
 * bulkUnpublishExcept-log.js
 * Unpublish all published entries in `museum-objects`
 * EXCEPT those whose institution_name is:
 *   - "Antikensammlung"
 *   - "The Metropolitan Museum of Art"
 *
 * Logs each unpublished item and writes a CSV report.
 *
 * Usage:
 *   npm i axios
 *   node bulkUnpublishExcept-log.js
 */

const axios = require('axios');
const fs = require('fs');
const http = require('http');
const https = require('https');

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

// ========= CONFIG =========
const STRAPI_BASE = process.env.STRAPI_BASE || 'http://127.0.0.1:1337';
const COLLECTION = 'museum-objects';
const API_TOKEN = process.env.API_TOKEN;
if (!API_TOKEN) { console.error('Missing API_TOKEN in .env'); process.exit(1); }
const PAGE_SIZE = 100;       // Strapi v4 max
const CONCURRENCY = 30;      // tune 20–60 if server & DB can handle it
const KEEP = ['Antikensammlung', 'The Metropolitan Museum of Art'];

// Field names in your Strapi content-type (API layer)
const FIELD_INSTITUTION = 'institution_name'; // change if your key differs (e.g., 'InstitutionName')
const FIELD_TITLE = 'title';                  // change if your title field has a different name
// ==========================

// Keep-alive for speed
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 200 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 200 });

const api = axios.create({
  baseURL: `${STRAPI_BASE}/api/${COLLECTION}`,
  headers: { Authorization: `Bearer ${API_TOKEN}` },
  httpAgent,
  httpsAgent,
  timeout: 60_000,
});

const report = []; // will hold { id, title, institution, publishedAt }

// Fetch a batch (always page 1) of items to unpublish, returning minimal fields
async function fetchBatch() {
  const params = new URLSearchParams();

  // Only published
  params.set('publicationState', 'live');
  params.set('filters[publishedAt][$notNull]', 'true');

  // Exclude the institutions we keep
  KEEP.forEach((name, i) => {
    params.set(`filters[${FIELD_INSTITUTION}][$notIn][${i}]`, name);
  });

  // Minimal fields for logging + sanity
  params.set('fields[0]', 'id');
  params.set('fields[1]', FIELD_INSTITUTION);
  params.set('fields[2]', FIELD_TITLE);
  params.set('fields[3]', 'publishedAt');

  // Stable order (optional)
  params.set('sort[0]', 'id:asc');

  // Always page 1 so we don't skip as items leave "live"
  params.set('pagination[page]', '1');
  params.set('pagination[pageSize]', String(PAGE_SIZE));

  const url = `?${params.toString()}`;
  const res = await api.get(url);
  return res.data.data || [];
}

async function unpublishOne(entry) {
  const id = entry.id;
  const attrs = entry.attributes || {};
  const title = attrs[FIELD_TITLE] ?? '';
  const institution = attrs[FIELD_INSTITUTION] ?? '';
  const publishedAt = attrs.publishedAt ?? null;

  // Update: set publishedAt to null
  await api.put(`/${id}`, { data: { publishedAt: null } });

  // Log to console
  console.log(`   • Unpublished #${id} | ${title || '(no title)'} | ${institution} | was: ${publishedAt}`);

  // Add to report buffer
  report.push({
    id,
    title: sanitizeCsv(title),
    institution: sanitizeCsv(institution),
    publishedAt,
  });

  return id;
}

// Simple concurrency runner
async function runWithConcurrency(entries, limit) {
  let idx = 0;
  let ok = 0, fail = 0;

  async function worker() {
    while (idx < entries.length) {
      const my = idx++;
      const entry = entries[my];
      try {
        await unpublishOne(entry);
        ok++;
      } catch (e) {
        fail++;
        const id = entry.id;
        const msg = e?.response?.data || e.message;
        console.error(`   ↳ Failed #${id}:`, msg);
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, entries.length) }, () => worker());
  await Promise.all(workers);
  return { ok, fail };
}

function sanitizeCsv(v) {
  if (v == null) return '';
  const s = String(v);
  // Escape double quotes by doubling them; wrap fields containing comma/quote/newline
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const file = `unpublished_items_${ts}.csv`;
  const header = 'id,title,institution,publishedAt\n';
  const rows = report.map(r => `${r.id},${r.title},${r.institution},${r.publishedAt || ''}`).join('\n');
  fs.writeFileSync(file, header + rows, 'utf8');
  console.log(`📝 Wrote report: ${file}`);
}

(async function run() {
  console.log('🚀 Starting bulk unpublish with logging…');

  let totalOk = 0;
  let totalFail = 0;
  let round = 0;

  while (true) {
    round++;
    const batch = await fetchBatch();

    if (batch.length === 0) {
      console.log('✅ No more published items to unpublish. Done.');
      break;
    }

    console.log(`Round ${round}: fetched ${batch.length} items (page 1). Unpublishing…`);
    const { ok, fail } = await runWithConcurrency(batch, CONCURRENCY);
    totalOk += ok;
    totalFail += fail;
    console.log(`   ✅ Round ${round} done. Updated: ${ok}, Errors: ${fail}. Total updated: ${totalOk}`);
  }

  writeCsv();
  console.log(`🏁 Finished. Total unpublished: ${totalOk}, Total errors: ${totalFail}`);
})().catch((e) => {
  console.error('Fatal:', e?.response?.data || e.message);
  process.exit(1);
});

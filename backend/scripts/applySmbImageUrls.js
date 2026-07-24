// applySmbImageUrls.js — Writes the img_url values rebuilt by
// etl/refetch_smb_image_urls.py (cached in etl/smb_image_refetch_cache.jsonl)
// to Strapi, for the SMB records broken by the recherche.smb.museum outage.
//
// This is the "apply" half of a multi-step process:
//   1. etl/refetch_smb_image_urls.py fetch    (rate-limited against museum-digital.de, writes cache)
//   2. etl/refetch_smb_image_urls.py report   (review a sample from the cache)
//   3. this script                            (writes the reviewed cache to Strapi)
//
// The cache file keeps BOTH old_url (the broken recherche.smb.museum URL) and
// new_url (the rebuilt smb.museum-digital.de URL) forever — this script never
// deletes or shrinks it. When --live runs successfully for a record, it stamps
// that record with "applied_at" (an ISO timestamp) so the cache also serves as
// an audit trail of what actually got pushed to Strapi vs. what was just found.
//
// If SMB's high-res recherche.smb.museum backend comes back later, reverting
// is a lookup, not a rediscovery: --revert re-reads the same cache file and
// PUTs old_url back for every record that has an applied_at (and hasn't
// already been reverted), stamping "reverted_at" in turn.
//
// Usage:
//   node applySmbImageUrls.js --dry-run           # default: print what would be sent, no writes
//   node applySmbImageUrls.js --live              # PUT new_url to Strapi, stamp applied_at
//   node applySmbImageUrls.js --revert --dry-run  # preview reverting to old_url
//   node applySmbImageUrls.js --revert --live     # PUT old_url back, stamp reverted_at

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const axios = require('axios');
const fs = require('fs');
const readline = require('readline');
const path = require('path');

const CACHE_PATH = path.resolve(__dirname, '../../etl/smb_image_refetch_cache.jsonl');
const strapiBaseUrl = process.env.STRAPI_BASE_URL || 'http://127.0.0.1:1337/api/museum-objects';
const API_TOKEN = process.env.API_TOKEN;

const LIVE = process.argv.includes('--live');
const REVERT = process.argv.includes('--revert');

if (LIVE && !API_TOKEN) {
  console.error('Missing API_TOKEN in .env');
  process.exit(1);
}

// Loads every line, preserving original order and raw text so a rewrite can
// pass through anything unparseable untouched.
async function loadLines(cachePath) {
  const lines = [];
  const rl = readline.createInterface({ input: fs.createReadStream(cachePath) });
  for await (const raw of rl) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let parsed = null;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // tolerate a truncated last line from a killed fetch process
    }
    lines.push({ raw: trimmed, parsed });
  }
  return lines;
}

function rewriteCache(cachePath, lines) {
  const out = lines
    .map(({ raw, parsed }) => (parsed ? JSON.stringify(parsed) : raw))
    .join('\n') + '\n';
  fs.writeFileSync(cachePath, out);
}

async function putImgUrl(id, url) {
  await axios.put(
    `${strapiBaseUrl}/${id}`,
    { data: { img_url: url } },
    { headers: { Authorization: `Bearer ${API_TOKEN}` } }
  );
}

async function main() {
  if (!fs.existsSync(CACHE_PATH)) {
    console.error(`Cache file not found: ${CACHE_PATH}`);
    console.error('Run etl/refetch_smb_image_urls.py fetch first.');
    process.exit(1);
  }

  const lines = await loadLines(CACHE_PATH);

  // Select target records + which URL field to write, depending on mode.
  const targets = lines.filter(({ parsed }) => {
    if (!parsed) return false;
    if (REVERT) {
      return Boolean(parsed.applied_at) && !parsed.reverted_at;
    }
    return parsed.status === 'ok' && parsed.new_url && !parsed.applied_at;
  });

  console.log(`Cache file: ${CACHE_PATH}`);
  console.log(`Mode: ${REVERT ? 'REVERT (old_url)' : 'APPLY (new_url)'} — ${LIVE ? 'LIVE, writing to Strapi' : 'DRY RUN, no writes'}`);
  console.log(`Candidate records: ${targets.length}`);
  console.log();

  let updated = 0;
  let failed = 0;
  const now = new Date().toISOString();

  for (let i = 0; i < targets.length; i++) {
    const { parsed: rec } = targets[i];
    const url = REVERT ? rec.old_url : rec.new_url;

    if (!LIVE) {
      if (i < 5 || i === targets.length - 1) {
        console.log(`[DRY RUN] would set id=${rec.id} (object_id=${rec.object_id}, inv=${rec.inventory_number}) img_url -> ${url}`);
      }
      updated++;
      continue;
    }

    try {
      await putImgUrl(rec.id, url);
      if (REVERT) {
        rec.reverted_at = now;
      } else {
        rec.applied_at = now;
      }
      updated++;
    } catch (error) {
      failed++;
      console.error(`Failed to update id=${rec.id} (object_id=${rec.object_id}): ${error.message}`);
    }

    if ((i + 1) % 500 === 0 || i === targets.length - 1) {
      console.log(`[${i + 1}/${targets.length}] updated=${updated} failed=${failed}`);
    }
  }

  if (LIVE && updated > 0) {
    rewriteCache(CACHE_PATH, lines);
    console.log(`Cache file updated with ${REVERT ? 'reverted_at' : 'applied_at'} timestamps.`);
  }

  console.log();
  console.log(`Done. updated=${updated} failed=${failed} total_candidates=${targets.length}`);
  if (!LIVE) {
    console.log('(dry run — no rows were written; re-run with --live to apply)');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

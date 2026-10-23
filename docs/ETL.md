# Ex Situ — ETL Pipeline Documentation

**Last updated:** July 2026  
**Dataset size:** ~215,980 records (as of July 2026, incl. Art Institute of Chicago)

---

## Overview

The Ex Situ ETL pipeline imports museum object data from JSON, geocodes origin coordinates, enriches institution locality fields, and keeps PostgreSQL materialized views in sync. All scripts live in `backend/scripts/`.

---

## Required Environment Variables

Set these in `backend/.env` before running any script:

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgres://user:pass@localhost:5432/exsitu` |
| `STRAPI_BASE_URL` | Base URL of the Strapi API | `http://127.0.0.1:1337/api/museum-objects` |
| `API_TOKEN` | Strapi API token (Bearer) | `abc123…` |
| `NEXT_PUBLIC_API_BASE_URL` | Used by the Next.js frontend proxy | `http://127.0.0.1:1337/api` |

---

## Pipeline Order

Run steps in sequence. Each step is idempotent unless noted.

### Step 1 — Run Database Migrations

Apply all SQL migrations in order from `backend/database/migrations/`:

```bash
# From backend/
psql "$DATABASE_URL" -f database/migrations/001_add_postgis_geometry.sql
psql "$DATABASE_URL" -f database/migrations/006_add_place_name_normalized.sql
psql "$DATABASE_URL" -f database/migrations/007_add_missing_enrichment_fields.sql
psql "$DATABASE_URL" -f database/migrations/008_populate_institution_locality.sql
psql "$DATABASE_URL" -f database/migrations/009_fix_benin_coordinates.sql
psql "$DATABASE_URL" -f database/migrations/010_expand_place_normalization.sql
psql "$DATABASE_URL" -f database/migrations/011_add_inventory_number_normalized.sql
psql "$DATABASE_URL" -f database/migrations/012_add_search_fulltext.sql
psql "$DATABASE_URL" -f database/migrations/017_add_object_search_index.sql
psql "$DATABASE_URL" -f database/migrations/018_add_filter_indexes.sql
```

All migrations use `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` and are safe to re-run.

**Expected runtime:** < 5 minutes for a fresh DB; migration 012 (tsvector backfill) may take 1–2 minutes on a large table.

**013 (`013_add_gazetteer_geocoding.sql`) is not in this list** — it's currently disabled (`.sql.disabled`) because it conflicts with `geocode_place()`/`reverse_geocode()` functions already present in production under a different, untracked schema (see `etl/README.md`'s Geocoding pipeline section for details). Don't apply it to a new environment without checking for those functions first.

### Step 2 — Start Strapi

```bash
cd backend && npm run develop   # development
# or
cd backend && npm run start     # production
```

Strapi must be running for all subsequent steps (they call its REST API).

### Step 3 — Import Raw Data

```bash
# Dry run first — prints what would be inserted, no writes
node scripts/importData.js --dry-run

# Live run
node scripts/importData.js
```

**What it does:** Reads `data/museum_objects.json`, checks whether each `object_id` already exists (idempotency), and inserts new records only.

**Expected runtime:** ~15–30 minutes for 132k records (Strapi ORM overhead per record).

### Step 4 — Geocode Object Coordinates (Origin Locality)

```bash
# Dry run first
node scripts/update-strapi-locations.js --dry-run

# Live run
node scripts/update-strapi-locations.js
```

**What it does:** For each published record missing `country_en` or `city_en`, calls the Nominatim reverse geocoding API using `latitude`/`longitude` and updates the record via the Strapi REST API.

**Rate limiting:** Enforces ≥ 1.1 s between Nominatim requests. On HTTP 429 or 5xx errors, retries up to 3 times with exponential backoff (1.1 s → 2.2 s → 4.4 s → 8.8 s).

**Expected runtime:** ~40 hours for 132k uncached records (Nominatim rate limit). Run in a tmux session or use a pre-geocoded dump if available.

### Step 5 — Populate Institution Locality (Phase 2)

Populates `institution_city_en` / `institution_country_en` for institutions not covered by the static SQL mapping in migration 008.

```bash
# Dry run first
node scripts/populate-institution-locality.js --dry-run

# Live run
node scripts/populate-institution-locality.js
```

**What it does:** Paginates through all records where `institution_city_en` is null, calls Nominatim for the `institution_place` value, and updates via Strapi.

**Rate limiting:** Same Nominatim limits as Step 4 (1.1 s between requests, 1 retry).

**Expected runtime:** Minutes if migration 008 already covered major institutions; up to several hours for smaller/unusual institutions.

---

## Individual Scripts

| Script | Purpose | `--dry-run` | Idempotent |
|---|---|---|---|
| `importData.js` | Import raw JSON data into Strapi | ✅ | ✅ (skips existing `object_id`) |
| `update-strapi-locations.js` | Geocode origin coordinates via Nominatim | ✅ | ✅ (skips records with existing `country_en` + `city_en`) |
| `populate-institution-locality.js` | Geocode institution locations via Nominatim | ✅ | ✅ (skips records with existing `institution_city_en`) |
| `setupPostGIS.js` | Enable PostGIS extension and create geometry columns | ❌ | ✅ |
| `syncStrapiContent.js` | Sync content type schemas | ❌ | ✅ |
| `publishEntries.js` | Bulk-publish all draft entries | ❌ | ✅ |
| `bulkUnpublishExcept.js` | Unpublish entries outside a given set | ❌ | ✅ |
| `updateImgUrlAntik.js` | One-off image URL update for Antikensammlung | ❌ | ✅ |
| `etl/backfill_smb_event_attribution.py` | SMB rows without coordinates: findspot/production place from the museum-digital record (fetch → report → apply); then the place pipeline in CLAUDE.md | ✅ (`apply` without `--apply`) | ✅ (only writes rows unchanged since fetch) |

---

## Materialized Views

The map reads pre-aggregated materialized views instead of the `museum_objects` table; they are
defined in `backend/src/map-views.js`:

| View | Used for |
|---|---|
| `mv_country_institution_stats` | Arcs at low zoom (country → institution) |
| `mv_city_institution_stats` | Arcs at zoom 4–6 (site → institution) |
| `mv_time_bucket_stats`, `mv_acquisition_year_stats`, `mv_date_span_stats` | Time / Migration counts without filters |
| `mv_time_bucket_by_group`, `mv_acquisition_year_by_group`, `mv_date_span_by_group` | The same per institution and country (institution/country filters) |
| `mv_place_suggest` | Place search suggestions |

They are **not refreshed automatically**: after any import or fix, run

```sql
SELECT refresh_geospatial_views();
```

It refreshes every view `CONCURRENTLY` (each has a unique index `<view>_key`), so the map keeps
answering from the old rows while the new ones are counted (about 5 seconds on production,
October 2026). Until 2026-10-23 the function refreshed only the two arc views; the Time /
Migration counts were rebuilt only when Strapi restarted.

Strapi start (`backend/scripts/pre-strapi.js`) keeps the views unless their definitions or
Strapi's schemas changed; then they are dropped and rebuilt. When a deploy changes a view's
definition, `backend/scripts/rebuild-map-views.js` builds the new views beside the live ones and
swaps them in before the restart (`scripts/deploy/deploy.sh` runs it).

---

## Smoke Test

After each pipeline step, verify the geospatial endpoint is returning data:

```bash
curl "http://127.0.0.1:1337/api/museum-objects/geospatial?zoom=3" | jq '.data | length'
# Should return > 0
```

---

## Troubleshooting

**`importData.js` fails with "Cannot find module @strapi/strapi"**  
→ Run from `backend/`: `cd backend && node scripts/importData.js`

**Nominatim returns 429 Too Many Requests**  
→ The script retries automatically with backoff. If it persists, reduce parallel processes or add `User-Agent` header (already included).

**Materialized view is stale after import**  
→ Trigger a manual refresh (see above), or restart Strapi to re-register lifecycle hooks.

**`search_vector` column missing**  
→ Run migration 012: `psql "$DATABASE_URL" -f database/migrations/012_add_search_fulltext.sql`

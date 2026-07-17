# Ex Situ — ETL

Python pipelines for ingesting, geocoding, and normalising collection data from museum APIs into the Ex Situ PostGIS database.

---

## Structure

```
etl/
├── scrape_smb_am_api.py       # Staatliche Museen zu Berlin — Antikensammlung resolver
├── scrape_met_api.py          # Metropolitan Museum of Art resolver
├── scrape_vam.py              # Victoria and Albert Museum resolver
├── scrape_aic_api.py          # Art Institute of Chicago resolver
├── postgis_geocoder.py        # Geocoding pipeline (local PostGIS gazetteer)
├── import_gazetteer.sh        # Loads a GeoNames extract into gazetteer_places
├── normalize_place_names.py   # Place name normalization + deduplication
└── requirements.txt           # Python dependencies
```

---

## Prerequisites

- Python 3.10+
- PostgreSQL 16+ with PostGIS and the Ex Situ schema applied
- A `.env` file at the project root (or in `etl/`) with DB credentials

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=exsitu_db
DB_USER=exsitu
DB_PASSWORD=yourpassword
```

Install dependencies:

```bash
cd etl
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

---

## Running a resolver

Each scraper is self-contained and reads DB credentials from the environment.

**Staatliche Museen zu Berlin — Antikensammlung**

```bash
python scrape_smb_am_api.py
```

**Metropolitan Museum of Art**

```bash
python scrape_met_api.py
```

**Victoria and Albert Museum**

```bash
# All non-European collections
python scrape_vam.py

# Single collection, dry-run
python scrape_vam.py --collection east-asia --dry-run

# Resume from page 5
python scrape_vam.py --collection south-asia --start-page 5
```

Common flags available on all resolvers:

| Flag | Description |
|------|-------------|
| `--dry-run` | Print mapped records without writing to the DB |
| `--max-pages N` | Limit pages fetched (useful for testing) |
| `--output path.jsonl` | Write a local JSONL dump alongside DB insert |

---

## Geocoding pipeline

`postgis_geocoder.py` resolves place names to coordinates by calling the `geocode_place()` / `reverse_geocode()` SQL functions against the local `gazetteer_places` table (fast, no rate limits, no external calls). Resolvers that don't wire up a `PostGISGeocoder` fall back to Nominatim instead.

> **Status (2026-07-17):** `013_add_gazetteer_geocoding.sql` is currently **disabled** (`.sql.disabled`) in production. Production already has its own `geocode_place()` / `reverse_geocode()` functions and a different schema for them, created directly against the DB at some point outside of any tracked migration — 013's `CREATE OR REPLACE FUNCTION` conflicts with those (different return columns) and crash-loops Strapi on boot if applied as-is. Do not re-enable 013 without first reconciling it against whatever prod's untracked functions actually do. Locally this isn't an issue if your dev DB never had those legacy functions — check `\df geocode_place` before applying.

Before first use (local only, see status note above), apply `backend/database/migrations/013_add_gazetteer_geocoding.sql` and populate the gazetteer:

```bash
./import_gazetteer.sh
```

This downloads GeoNames' `cities500` extract plus country/admin1 reference tables and loads them into `gazetteer_places`. Skip this and `gazetteer_places` stays empty — every resolver will silently fall back to Nominatim (slow, rate-limited) with no error.

`postgis_geocoder.py` reads DB credentials from `DATABASE_HOST` / `DATABASE_PORT` / `DATABASE_NAME` / `DATABASE_USERNAME` / `DATABASE_PASSWORD` (not the `DB_*` vars above).

```bash
# One-off lookup / smoke test
python postgis_geocoder.py "Istanbul"
python postgis_geocoder.py --reverse 41.0082 28.9784
```

---

## Place name normalisation

`normalize_place_names.py` applies a priority-ordered normalization pipeline:

1. Lookup table — German forms, historical names, spelling variants → canonical English
2. Language detection — falls through to fuzzy match if unresolved
3. Fuzzy deduplication — `rapidfuzz` token-sort ratio ≥ 88 against existing normalized values
4. Descriptive phrase / stopword filter → sets `place_name_normalized = NULL`

```bash
# Dry-run (default) — prints report, no DB writes
python normalize_place_names.py

# Apply updates
python normalize_place_names.py --apply
```

---

## Adding a new institution resolver

Each resolver follows the same pattern:

1. **Fetch** — paginate the institution's public API
2. **Map** — extract `title`, `place_name`, `object_date`, `image_url`, `source_url`
3. **Geocode** — resolve `place_name` → `(latitude, longitude)` via `postgis_geocoder`
4. **Insert** — bulk-upsert into `museum_objects` using `psycopg2.extras.execute_values`

Copy an existing resolver (e.g. `scrape_met_api.py`) and adapt the API client and field mapping. The DB schema and geocoding helpers are shared — you only need to write the API-specific fetch and transform logic.

Open an issue to discuss the institution before submitting a PR.

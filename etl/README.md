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
├── scrape_europeana.py        # Europeana resolver — institutions via Europeana, non-European origins only
├── scrape_si.py               # Smithsonian Open Access resolver — Asian Art, American Indian, NMNH Anthropology
├── si_points.py               # Smithsonian: county, state and place points from GeoNames allCountries
├── scrape_wmw.py              # Weltmuseum Wien resolver — object pages from the sitemap
├── import_wmw.py              # Weltmuseum Wien: wmw_objects.json → museum_objects (upsert)
├── check_europeana_images.py  # Finds Europeana image URLs that do not load (objects are left out)
├── backfill_europeana_fields.py # After import: country/city, museum locality, licence, inventory number
├── postgis_geocoder.py        # Geocoding pipeline (local PostGIS gazetteer)
├── import_gazetteer.sh        # Loads a GeoNames extract into gazetteer_places
├── normalize_place_names.py   # Place name normalization + deduplication
├── normalize_country_names.py # One spelling per country_en: the map's country label name
├── fill_place_name_normalized.py # Fills remaining NULLs from city_en (map/MCP grouping)
├── normalize_place_labels.py  # Clean display labels (strip/translate tags), flags for review
├── audit_places.py            # Finds wrong labels (Lagos → Laos) and wrong-country coordinates
├── build_mcp_gazetteer.py     # GeoNames lookup for the MCP server's place precision
├── build_country_labels.py    # The map's country labels, from Natural Earth (see METHODOLOGY.md)
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

**Institutions via Europeana**

Europeana is the access route, not a collection: every record is attributed to its `dataProvider`
and links to the institution's own page (`edmIsShownAt`). Only objects whose origin the institution
places outside Europe, with a museum location and an image that loads, are kept.

```bash
export EUROPEANA_API_KEY=...          # your own key; never commit it
python scrape_europeana.py                         # dry run: counts per dataProvider
python scrape_europeana.py --apply                 # full scan → europeana_objects.json (+ flagged)
python check_europeana_images.py                   # per-image check for mixed hosts
python scrape_europeana.py --apply --finalize-only # rebuild from the last scan, no fetching
```

`europeana_image_groups.json` holds the browser sample verdict per institution and image host
(images that fail in a browser: TIFF, viewer pages, 404/403, hotlink-blocked). Then import with
`backend/scripts/importData.js` (copy the output to `data/museum_objects.json`), run
`backfill_europeana_fields.py --apply`, and restart Strapi.

### Smithsonian Open Access

**Not imported (2026-10-23).** The open data links almost no photographs: none for NMNH
Anthropology, and the American Indian museum's few CC0 photographs are of its "Non-Indian"
records. The museums' own pages show photographs under the Smithsonian's usage conditions, but
neither the bulk files nor the Open Access API (api.si.edu) link to them. The resolver is kept for
a later source of image links.

`scrape_si.py` reads the Smithsonian's CC0 bulk metadata on AWS (no API key) for three units:
`fsg` (National Museum of Asian Art), `nmai` (National Museum of the American Indian) and
`nmnhanthro` (NMNH Anthropology). Origin is the record's geoLocation (country → state → county →
city), resolved by exact GeoNames lookup; a point only for a uniquely named town. Korea, Tibet and
multi-country places go to `si_flagged.json` for review. Asian Art objects of US or European origin
(the Freer's American paintings) are left out. Only CC0 images are linked.

```bash
python scrape_si.py --unit fsg --limit 20     # dry run, sample
python scrape_si.py --apply                   # all units → si_objects.json (+ si_flagged.json); ~1.9 GB cached in si_cache/
python si_points.py                           # dry run: point levels, si_points_review.json sample
python si_points.py --apply                   # → si_objects_points.json
```

Most NMNH and American Indian origins name a county or a state, not a town. `si_points.py` places
every record by exact name in GeoNames allCountries (`data/gazetteer/allcountries/allCountries.zip`,
download from download.geonames.org): town or site inside the record's state and county, else the
county, else the state; the label is the matched GeoNames name, with the state added for names that
occur in several states ("Bethel, Alaska"). Country-only records get no point here.

### Weltmuseum Wien

No API or data dump: `scrape_wmw.py` lists the object pages from the museum's sitemap (robots.txt
allows them) and reads each page once, at about one request per second (~50,700 pages, ~14 h,
resumable). Origin is the page's "Geography" path (place of production): paths in Europe are left
out; the last level is placed on a single exact GeoNames match in the path's country (town, island
or site, label: the GeoNames name, "Kairo" → Cairo; else a first/second-level region, label: the
museum's name), searched in GeoNames allCountries (`data/gazetteer/allcountries/allCountries.zip`).
Otherwise the record keeps the country and the point existing records use for it (where they
disagree, the one nearest the map's country label; where there is none, the label point). Records
without a country or a point are indexed without one and also listed in `wmw_flagged.json`.
`wmw_countries.json` maps the museum's German country names. Images are the pages' own `/pics/`
files (CC BY-NC-SA 4.0), resized through `/api/proxy/img`.

```bash
python scrape_wmw.py enumerate                # object page URLs from the sitemap
python scrape_wmw.py fetch                    # cache → wmw_details.jsonl (resumable)
python scrape_wmw.py map --dry-run            # counts + sample records
python scrape_wmw.py map                      # → wmw_objects.json (+ wmw_flagged.json)
python import_wmw.py                          # dry run; --apply to write, then the place pipeline
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

Next, give every origin country the name its map label uses, so each country is
one entry in the Places list ("People's Republic of China" and "china" → `China`,
"Palestinian Territories" → `Palestine`, "Ivory Coast" → `Côte d'Ivoire`). It reads
the labels' `keys` from `frontend/public/country-labels.geojson`, also renames a
`place_name_normalized` that names the row's own country, and clears a `city_en`
that only copies a raw country name ("Jordanien") so the English label shows.
Each changed row gets a `[country-name]` note with the old value:

```bash
python normalize_country_names.py            # dry run: changes + Places count, rolled back
python normalize_country_names.py --apply
```

Then fill the rows it left `NULL`, so spelling variants of one place group
together on the map and in the MCP server (`"Olympia, Greece"` and `"Olympia"`
→ `Olympia`). Run it **after** `normalize_place_names.py`, which only processes
rows whose `place_name_normalized` is still `NULL`:

```bash
python fill_place_name_normalized.py            # dry run
python fill_place_name_normalized.py --apply    # then restart Strapi to rebuild the map views
```

Finally, check the result against the raw source and GeoNames:

```bash
python audit_places.py report            # CSVs in reports/, no writes
python audit_places.py apply --dry-run   # then: apply
```

It restores labels that name a different place than the raw `place_name`
(an old fuzzy pass turned "Lagos" into "Laos", "Borno" into "Borneo") and flags
coordinates outside the recorded country. Coordinates are only moved when the
raw name has exactly one GeoNames match in that country, and then only into
`manual_latitude`/`manual_longitude` — the original values are kept.
`normalize_place_names.py` no longer fuzzy-matches unless run with `--fuzzy`.

`fill_place_name_normalized.py` strips a trailing `", <country_en>"` from `city_en`, trims and collapses
whitespace, and keeps casing; the map view groups case-insensitively. Curated
values and `place_name` are never changed. The rules are shared with the MCP
server (`frontend/lib/mcp/origins.ts`) through
`frontend/lib/mcp/place-normalization-cases.json`; both sides test against it
(`python fill_place_name_normalized.py --self-test`, `pnpm test` in `frontend/`).

---

## Adding a new institution resolver

Each resolver follows the same pattern:

1. **Fetch** — paginate the institution's public API
2. **Map** — extract `title`, `place_name`, `object_date`, `image_url`, `source_url`
3. **Geocode** — resolve `place_name` → `(latitude, longitude)` via `postgis_geocoder`
4. **Insert** — bulk-upsert into `museum_objects` using `psycopg2.extras.execute_values`

Copy an existing resolver (e.g. `scrape_met_api.py`) and adapt the API client and field mapping. The DB schema and geocoding helpers are shared — you only need to write the API-specific fetch and transform logic.

Open an issue to discuss the institution before submitting a PR.

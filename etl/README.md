# Ex Situ — ETL

Python pipelines for ingesting, geocoding, and normalising collection data from museum APIs into the Ex Situ PostGIS database.

---

## Structure

```
etl/
├── scrape_smb_am_api.py       # Staatliche Museen zu Berlin — Antikensammlung resolver
├── scrape_met_api.py          # Metropolitan Museum of Art resolver
├── scrape_vam.py              # Victoria and Albert Museum resolver
├── postgis_geocoder.py        # Geocoding pipeline (local PostGIS gazetteer)
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

> `scrape_vam.py` imports `geocode_cache.py` and `institution_coords.py` from this
> directory. Both are intentionally excluded from git (see `.gitignore`) and are
> not part of this repo — you need to provide your own local versions before this
> script will run. At minimum they must expose:
> - `geocode_cache.geocode(place_name: str) -> Optional[tuple[float, float]]`
> - `geocode_cache.geocode_country(place_name: str) -> Optional[str]`
> - `geocode_cache.is_european(lat: float, lon: float, place_name: str) -> bool`
> - `geocode_cache._load_cache()` / `geocode_cache._cache` (dict, for `--skip-geocode`)
> - `institution_coords.INSTITUTION_COORDS` — a dict mapping institution name to
>   `{"lat": float, "lon": float}` (or equivalent, see usage at line ~481)
>
> `postgis_geocoder.py`'s `PostGISGeocoder` class covers the same geocode/is_european
> surface against the project's own PostGIS gazetteer and is a reasonable starting
> point if you're writing your own.

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

`postgis_geocoder.py` resolves `place_name` strings to coordinates using Nominatim, then writes `latitude`, `longitude`, and geometry into `museum_objects`.

```bash
# Geocode all un-geocoded rows
python postgis_geocoder.py

# Dry-run — print what would be resolved
python postgis_geocoder.py --dry-run
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

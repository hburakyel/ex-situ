#!/usr/bin/env bash
#
# import_gazetteer.sh — populate gazetteer_places from a GeoNames extract.
#
# Referenced by etl/postgis_geocoder.py's docstring since it was added
# (commit 8f1effa) but never actually existed in the repo. This is the
# reconstruction: downloads GeoNames' cities500 dataset (populated places
# with 500+ residents) plus country/admin1 reference tables, and loads them
# into the gazetteer_places table created by
# backend/database/migrations/013_add_gazetteer_geocoding.sql.
#
# Usage:
#   ./import_gazetteer.sh              # download + load
#   ./import_gazetteer.sh --skip-download   # reuse files already in DATA_DIR
#
# DB connection is read from the same env vars postgis_geocoder.py uses
# (DATABASE_HOST/PORT/NAME/USERNAME/PASSWORD), falling back to its defaults.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${DATA_DIR:-$SCRIPT_DIR/data/gazetteer}"
GEONAMES_BASE="https://download.geonames.org/export/dump"

SKIP_DOWNLOAD=0
for arg in "$@"; do
  case "$arg" in
    --skip-download) SKIP_DOWNLOAD=1 ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

export PGHOST="${DATABASE_HOST:-localhost}"
export PGPORT="${DATABASE_PORT:-5432}"
export PGDATABASE="${DATABASE_NAME:-museum_db}"
export PGUSER="${DATABASE_USERNAME:-museum_user}"
export PGPASSWORD="${DATABASE_PASSWORD:-museum_pass}"

mkdir -p "$DATA_DIR"

if [ "$SKIP_DOWNLOAD" -eq 0 ]; then
  echo "Downloading GeoNames extracts to $DATA_DIR ..."
  curl -fL -o "$DATA_DIR/cities500.zip" "$GEONAMES_BASE/cities500.zip"
  curl -fL -o "$DATA_DIR/countryInfo.txt" "$GEONAMES_BASE/countryInfo.txt"
  curl -fL -o "$DATA_DIR/admin1CodesASCII.txt" "$GEONAMES_BASE/admin1CodesASCII.txt"
  unzip -o "$DATA_DIR/cities500.zip" -d "$DATA_DIR" cities500.txt
else
  echo "Skipping download, reusing files in $DATA_DIR"
fi

for f in cities500.txt countryInfo.txt admin1CodesASCII.txt; do
  if [ ! -f "$DATA_DIR/$f" ]; then
    echo "Missing $DATA_DIR/$f (pass no flags to download it)" >&2
    exit 1
  fi
done

# countryInfo.txt has leading comment lines (including the header) — strip them.
grep -v "^#" "$DATA_DIR/countryInfo.txt" > "$DATA_DIR/countryInfo.clean.txt"

echo "Loading into gazetteer_places (database: $PGDATABASE @ $PGHOST:$PGPORT) ..."

CITIES_FILE="$DATA_DIR/cities500.txt"
ADMIN1_FILE="$DATA_DIR/admin1CodesASCII.txt"
COUNTRY_FILE="$DATA_DIR/countryInfo.clean.txt"
SQL_FILE="$DATA_DIR/import_gazetteer.generated.sql"

# \copy's filename argument does not undergo psql :'var' substitution (that
# only applies to regular SQL text, not backslash-command arguments) — so the
# heredoc below is written to a file with placeholders, then the placeholders
# are swapped for real paths with sed, then the file is run via `psql -f`.
cat > "$SQL_FILE" <<'SQL_EOF'
BEGIN;

CREATE TEMP TABLE staging_cities (
  geonameid     TEXT, name TEXT, asciiname TEXT, alternatenames TEXT,
  latitude TEXT, longitude TEXT, feature_class TEXT, feature_code TEXT,
  country_code TEXT, cc2 TEXT, admin1_code TEXT, admin2_code TEXT,
  admin3_code TEXT, admin4_code TEXT, population TEXT, elevation TEXT,
  dem TEXT, timezone TEXT, modification_date TEXT
) ON COMMIT DROP;

CREATE TEMP TABLE staging_admin1 (
  code TEXT, name TEXT, name_ascii TEXT, geonameid TEXT
) ON COMMIT DROP;

CREATE TEMP TABLE staging_country (
  iso TEXT, iso3 TEXT, iso_numeric TEXT, fips TEXT, country TEXT,
  capital TEXT, area TEXT, population TEXT, continent TEXT, tld TEXT,
  currency_code TEXT, currency_name TEXT, phone TEXT, postal_format TEXT,
  postal_regex TEXT, languages TEXT, geonameid TEXT, neighbours TEXT,
  equivalent_fips TEXT
) ON COMMIT DROP;

-- CSV format with a rare quote char (rather than the text format's default
-- backslash-escaping) so stray backslashes/quotes in alternatenames etc.
-- don't break parsing.
\copy staging_cities FROM 'CITIES_FILE_PLACEHOLDER' WITH (FORMAT csv, DELIMITER E'\t', QUOTE E'\x01', NULL '')
\copy staging_admin1 FROM 'ADMIN1_FILE_PLACEHOLDER' WITH (FORMAT csv, DELIMITER E'\t', QUOTE E'\x01', NULL '')
\copy staging_country FROM 'COUNTRY_FILE_PLACEHOLDER' WITH (FORMAT csv, DELIMITER E'\t', QUOTE E'\x01', NULL '')

-- Countries first (place_type = 'country'), coordinates borrowed from the
-- capital's row in staging_cities when we can find one by name+country match.
INSERT INTO gazetteer_places
  (geonameid, name, name_en, country_code, country_name, region_name, place_type, latitude, longitude, population, confidence, feature_code)
SELECT
  NULLIF(sc.geonameid, '')::BIGINT,
  sc.country,
  sc.country,
  upper(sc.iso),
  sc.country,
  NULL,
  'country',
  cap.latitude::DOUBLE PRECISION,
  cap.longitude::DOUBLE PRECISION,
  NULLIF(sc.population, '')::INTEGER,
  1.0,
  'PCLI'
FROM staging_country sc
LEFT JOIN staging_cities cap
  ON upper(cap.country_code) = upper(sc.iso)
  AND lower(cap.name) = lower(sc.capital)
WHERE sc.iso IS NOT NULL AND sc.iso <> ''
ON CONFLICT (geonameid) WHERE geonameid IS NOT NULL DO NOTHING;

-- Cities (place_type = 'city'), region_name resolved via admin1 code lookup.
INSERT INTO gazetteer_places
  (geonameid, name, name_en, country_code, country_name, region_name, place_type, latitude, longitude, population, confidence, feature_code)
SELECT
  NULLIF(c.geonameid, '')::BIGINT,
  c.name,
  c.asciiname,
  upper(c.country_code),
  ci.country,
  a1.name,
  'city',
  NULLIF(c.latitude, '')::DOUBLE PRECISION,
  NULLIF(c.longitude, '')::DOUBLE PRECISION,
  NULLIF(c.population, '')::INTEGER,
  CASE
    WHEN c.feature_code = 'PPLC' THEN 1.0   -- national capital
    WHEN c.feature_code = 'PPLA' THEN 0.9   -- admin1 capital
    WHEN NULLIF(c.population, '')::INTEGER >= 100000 THEN 0.85
    WHEN NULLIF(c.population, '')::INTEGER >= 10000 THEN 0.7
    ELSE 0.5
  END,
  c.feature_code
FROM staging_cities c
LEFT JOIN staging_country ci ON upper(ci.iso) = upper(c.country_code)
LEFT JOIN staging_admin1 a1 ON a1.code = upper(c.country_code) || '.' || c.admin1_code
WHERE c.feature_class = 'P'
ON CONFLICT (geonameid) WHERE geonameid IS NOT NULL DO NOTHING;

-- Populate geography column for reverse_geocode(), if PostGIS is present
-- (013_add_gazetteer_geocoding.sql only adds this column when PostGIS exists).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'gazetteer_places' AND column_name = 'geom') THEN
    UPDATE gazetteer_places
    SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND geom IS NULL;
  END IF;
END $$;

COMMIT;

SELECT place_type, count(*) FROM gazetteer_places GROUP BY place_type ORDER BY place_type;
SQL_EOF

sed -i.bak \
  -e "s#CITIES_FILE_PLACEHOLDER#${CITIES_FILE}#" \
  -e "s#ADMIN1_FILE_PLACEHOLDER#${ADMIN1_FILE}#" \
  -e "s#COUNTRY_FILE_PLACEHOLDER#${COUNTRY_FILE}#" \
  "$SQL_FILE"
rm -f "$SQL_FILE.bak"

psql -v ON_ERROR_STOP=1 -f "$SQL_FILE"

echo "Done."

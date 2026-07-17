-- Migration 013: PostGIS gazetteer for local place geocoding
--
-- Creates the `gazetteer_places` table and the `geocode_place()` /
-- `reverse_geocode()` SQL functions that etl/postgis_geocoder.py has always
-- called, but which were never actually created by any migration — the
-- geocoder module was added in isolation (commit 8f1effa) and has been
-- silently falling back to Nominatim in every environment ever since.
--
-- This migration only creates the schema. It does NOT populate data —
-- run etl/import_gazetteer.sh afterward to load a GeoNames extract.
--
-- Safe to re-run (IF NOT EXISTS / CREATE OR REPLACE throughout).

-- pg_trgm is a "trusted" extension (PG13+) and installable without
-- superuser by any role with CREATE on the database.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── 1. gazetteer_places table ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gazetteer_places (
  id            SERIAL PRIMARY KEY,
  geonameid     BIGINT,                 -- GeoNames geonameid, NULL for synthetic rows
  name          TEXT NOT NULL,          -- local-language name, as shipped by the source
  name_en       TEXT,                   -- ASCII/English-ish name used for search
  country_code  CHAR(2),                -- ISO 3166-1 alpha-2
  country_name  TEXT,
  region_name   TEXT,                   -- admin1 (state/province) name, if applicable
  place_type    TEXT NOT NULL DEFAULT 'city'
                CHECK (place_type IN ('country', 'region', 'city', 'other')),
  latitude      DOUBLE PRECISION,
  longitude     DOUBLE PRECISION,
  population    INTEGER,
  confidence    REAL NOT NULL DEFAULT 0.5,  -- base row confidence, blended with match score at query time
  feature_code  TEXT                    -- raw GeoNames feature code (PPLC, PPLA, ADM1, PCLI, ...), for debugging
);

CREATE UNIQUE INDEX IF NOT EXISTS gazetteer_places_geonameid_idx
  ON gazetteer_places (geonameid) WHERE geonameid IS NOT NULL;

CREATE INDEX IF NOT EXISTS gazetteer_places_place_type_idx
  ON gazetteer_places (place_type);

CREATE INDEX IF NOT EXISTS gazetteer_places_country_code_idx
  ON gazetteer_places (country_code);

CREATE INDEX IF NOT EXISTS gazetteer_places_name_trgm_idx
  ON gazetteer_places USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS gazetteer_places_name_en_trgm_idx
  ON gazetteer_places USING GIN (name_en gin_trgm_ops);

-- geocode_place()'s exact-match disjuncts (lower(name) = lower(query_text))
-- have no index of their own, and Postgres won't use the trigram GIN indexes
-- for the OR'd trigram disjuncts unless every disjunct in the OR is indexable
-- — without these, the planner falls back to a full sequential scan (~5-10s
-- per call on the full GeoNames cities500 load) instead of a ~40ms bitmap-or.
CREATE INDEX IF NOT EXISTS gazetteer_places_name_lower_idx
  ON gazetteer_places (lower(name));

CREATE INDEX IF NOT EXISTS gazetteer_places_name_en_lower_idx
  ON gazetteer_places (lower(name_en));

-- ── 2. geocode_place() — trigram/exact search, no PostGIS geometry required ──

CREATE OR REPLACE FUNCTION geocode_place(
  query_text   TEXT,
  country_hint TEXT DEFAULT NULL,
  limit_n      INTEGER DEFAULT 5
)
RETURNS TABLE (
  latitude    DOUBLE PRECISION,
  longitude   DOUBLE PRECISION,
  country_name TEXT,
  region_name TEXT,
  confidence  REAL,
  match_type  TEXT,
  name_en     TEXT
) AS $$
BEGIN
  -- NOTE: the match score is computed in an inner, qualified subquery (m.match_confidence)
  -- rather than aliased as `confidence` directly, because `confidence` is also the name of
  -- a RETURNS TABLE output column — PL/pgSQL auto-declares those as variables, and an
  -- unqualified `ORDER BY confidence` would raise "column reference is ambiguous".
  RETURN QUERY
  SELECT
    m.latitude,
    m.longitude,
    m.country_name,
    m.region_name,
    m.match_confidence,
    m.match_kind,
    m.name_en
  FROM (
    SELECT
      g.latitude,
      g.longitude,
      g.country_name,
      g.region_name,
      CASE
        WHEN lower(g.name) = lower(query_text) OR lower(g.name_en) = lower(query_text)
          THEN 1.0::real
        ELSE LEAST(
          1.0,
          GREATEST(similarity(g.name, query_text), similarity(coalesce(g.name_en, ''), query_text))
            * g.confidence
        )
      END AS match_confidence,
      CASE
        WHEN lower(g.name) = lower(query_text) OR lower(g.name_en) = lower(query_text)
          THEN 'exact'
        ELSE 'trigram'
      END AS match_kind,
      g.name_en,
      g.population
    FROM gazetteer_places g
    WHERE
      (country_hint IS NULL OR g.country_code = upper(country_hint))
      AND (
        lower(g.name) = lower(query_text)
        OR lower(g.name_en) = lower(query_text)
        OR g.name % query_text
        OR g.name_en % query_text
      )
  ) m
  ORDER BY m.match_confidence DESC, m.population DESC NULLS LAST
  LIMIT limit_n;
END;
$$ LANGUAGE plpgsql STABLE;

-- ── 3. reverse_geocode() — nearest gazetteer city, requires PostGIS ─────────
--
-- PostGIS must already be installed by the DBA (see migration 001's note —
-- it typically requires superuser and isn't installed by app-role migrations).
-- If it's missing, this function is skipped; geocode_place() above still works.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN

    EXECUTE 'ALTER TABLE gazetteer_places ADD COLUMN IF NOT EXISTS geom GEOGRAPHY(POINT, 4326)';

    EXECUTE '
      UPDATE gazetteer_places
      SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND geom IS NULL
    ';

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'gazetteer_places_geom_idx') THEN
      EXECUTE 'CREATE INDEX gazetteer_places_geom_idx ON gazetteer_places USING GIST(geom)';
    END IF;

    EXECUTE '
      CREATE OR REPLACE FUNCTION reverse_geocode(lat DOUBLE PRECISION, lon DOUBLE PRECISION)
      RETURNS TABLE (
        country_name TEXT,
        country_code TEXT,
        region_name  TEXT,
        city_name    TEXT,
        distance_km  DOUBLE PRECISION
      ) AS $fn$
      BEGIN
        RETURN QUERY
        SELECT
          g.country_name,
          g.country_code::TEXT,
          g.region_name,
          g.name AS city_name,
          ST_Distance(g.geom, ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography) / 1000.0 AS distance_km
        FROM gazetteer_places g
        WHERE g.place_type = ''city'' AND g.geom IS NOT NULL
        ORDER BY g.geom <-> ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography
        LIMIT 1;
      END;
      $fn$ LANGUAGE plpgsql STABLE;
    ';

  ELSE
    RAISE NOTICE '013_add_gazetteer_geocoding: PostGIS not installed — skipping geom column and reverse_geocode(). geocode_place() is still available.';
  END IF;
END $$;

-- Fallback lat/lon index so bounding-box style queries still work without PostGIS
CREATE INDEX IF NOT EXISTS gazetteer_places_lat_lon_idx
  ON gazetteer_places (latitude, longitude);

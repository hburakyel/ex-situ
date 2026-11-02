-- Migration 019: Records that name two or more possible origins
--
-- A record whose origin reads "Egypt or Syria" or "Nishapur or Samarqand, Iran or
-- present-day Uzbekistan" names more than one place. Each named place gets a row
-- here with its own label, country and point (etl/split_origin_places.py), and the
-- map draws the object on the arc from each of them (museum_object_points in
-- src/map-views.js). museum_objects keeps the record as it is: its place_name,
-- label and point are not changed, and the panel shows the record's own label on
-- every arc.
--
-- ordinal 1 is the place the record names first: totals that span places count the
-- object there only (primary_count in the map views), so it counts once.
--
-- Strapi does not manage this table. At a start that runs a migration, its schema
-- sync drops every table it does not know, unless the table is listed in the core
-- store's persisted_tables (read after the migrations, before the sync): the end of
-- this file lists it there. Rows go with their object (ON DELETE CASCADE).
--
-- Safe to re-run. No question mark in this file: Strapi runs it through knex.raw,
-- which reads one as a binding placeholder.

CREATE TABLE IF NOT EXISTS museum_object_origins (
  object_id integer NOT NULL REFERENCES museum_objects (id) ON DELETE CASCADE,
  ordinal smallint NOT NULL CHECK (ordinal >= 1),
  label text NOT NULL,
  country_en text,
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  -- Where the point comes from ("country centre (Egypt)", "GeoNames 1216265, …"),
  -- with the script's tag and date.
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (object_id, ordinal)
);

-- Kept through Strapi's schema sync (Strapi's own key for strapi.store
-- { type: 'core', key: 'persisted_tables' }: a JSON array of table names).
INSERT INTO strapi_core_store_settings (key, value, type)
SELECT 'core_persisted_tables', '[]', 'object'
WHERE NOT EXISTS (SELECT 1 FROM strapi_core_store_settings
                  WHERE key = 'core_persisted_tables' AND environment IS NULL AND tag IS NULL);

UPDATE strapi_core_store_settings
SET value = (COALESCE(NULLIF(value, ''), '[]')::jsonb || '["museum_object_origins"]'::jsonb)::text
WHERE key = 'core_persisted_tables' AND environment IS NULL AND tag IS NULL
  AND NOT COALESCE(NULLIF(value, ''), '[]')::jsonb @> '["museum_object_origins"]'::jsonb;

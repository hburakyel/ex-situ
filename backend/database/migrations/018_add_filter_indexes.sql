-- Migration 018: Indexes for the map's institution and country filters and the
-- object search
--
-- The geospatial, date-bucket and object-grid queries filter on
-- institution_name = :x and country_en = :x (buildMultiValueFilter), the object
-- grid (getObjectsByCountry) matches country_en / the place label /
-- institution_name with ILIKE '%x%', and searchObjects ORs an exact
-- inventory_number_normalized match with two indexed conditions. Without these
-- indexes each such request scans the whole table, which with the Smithsonian
-- collections (750k rows, 2026-10) is over a million rows.
--
-- Each index is on the column cast to text, which is how Postgres compares these
-- varchar columns ("(country_en)::text = 'Peru'::text"), so the planner uses it.
-- It has to be an expression: Strapi's schema sync drops indexes on plain columns
-- it does not know at every start (it dropped migration 011's
-- idx_museum_objects_inv_norm), and leaves expression indexes alone.
--
-- Strapi runs this file at startup inside a transaction, so it cannot use
-- CREATE INDEX CONCURRENTLY, and a plain CREATE INDEX blocks writes while it
-- builds. On a large live database, create the same indexes first with
-- CONCURRENTLY (psql, outside a transaction); this file then finds them and
-- does nothing.
--
-- Safe to re-run.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_museum_objects_institution_text
  ON museum_objects ((institution_name::text));

CREATE INDEX IF NOT EXISTS idx_museum_objects_country_text
  ON museum_objects ((country_en::text));

CREATE INDEX IF NOT EXISTS idx_museum_objects_inv_norm_text
  ON museum_objects ((inventory_number_normalized::text));

CREATE INDEX IF NOT EXISTS idx_museum_objects_institution_trgm
  ON museum_objects USING GIN ((institution_name::text) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_museum_objects_country_trgm
  ON museum_objects USING GIN ((country_en::text) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_museum_objects_place_name_coalesce_trgm
  ON museum_objects USING GIN (COALESCE(place_name_normalized, place_name) gin_trgm_ops);

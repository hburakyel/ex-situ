-- Migration 017: Indexes for object search (GET /api/museum-objects/search)
--
-- searchObjects() matches a query against the inventory number and the record's
-- place fields. Without these indexes the query still works, as a sequential scan.
--
--   1. Inventory number prefix ("1974.294" finds 1974.294.2): btree on
--      lower(inventory_number) with text_pattern_ops, so LIKE 'x%' uses it.
--   2. Words anywhere in the record: trigram GIN index on the same expression as
--      OBJECT_SEARCH_TEXT in services/museum-object.js. Keep the two identical,
--      character for character, or the planner will not use the index.
--
-- search_vector (migration 012) is not used here: its trigger was dropped, so it
-- is stale for every row inserted since.
--
-- Built with || and coalesce, not concat_ws: concat_ws is not IMMUTABLE and
-- cannot be indexed.
--
-- Safe to re-run.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_museum_objects_inv_lower_prefix
  ON museum_objects (lower(inventory_number) text_pattern_ops);

CREATE INDEX IF NOT EXISTS idx_museum_objects_search_text_trgm
  ON museum_objects USING GIN (
    lower(coalesce(inventory_number, '') || ' ' || coalesce(place_name, '') || ' ' || coalesce(place_name_normalized, '') || ' ' || coalesce(city_en, '') || ' ' || coalesce(country_en, '') || ' ' || coalesce(historical_name, '') || ' ' || coalesce(precise_place, '') || ' ' || coalesce(institution_name, ''))
    gin_trgm_ops
  );

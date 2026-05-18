-- Migration 012: Full-text search tsvector + place_name_synonyms table
-- Safe to re-run (IF NOT EXISTS / CREATE TABLE IF NOT EXISTS throughout)

-- ── 1. Synonym table (replaces hardcoded COUNTRY_ALIASES in frontend) ─────────

CREATE TABLE IF NOT EXISTS place_name_synonyms (
  id      SERIAL PRIMARY KEY,
  alias   TEXT NOT NULL,          -- lowercase, trimmed input variant
  canonical TEXT NOT NULL         -- canonical form used in museum_objects
);

CREATE UNIQUE INDEX IF NOT EXISTS place_name_synonyms_alias_idx
  ON place_name_synonyms (alias);

-- Seed with the aliases currently hardcoded in use-unified-search.ts
-- Uses INSERT ... ON CONFLICT DO NOTHING so re-runs are safe
INSERT INTO place_name_synonyms (alias, canonical) VALUES
  ('türkiye',                           'turkey'),
  ('turquie',                           'turkey'),
  ('côte d''ivoire',                    'ivory coast'),
  ('cote d''ivoire',                    'ivory coast'),
  ('czech republic',                    'czech republic'),
  ('czechia',                           'czech republic'),
  ('timor-leste',                       'east timor'),
  ('eswatini',                          'eswatini'),
  ('swaziland',                         'eswatini'),
  ('burma',                             'myanmar'),
  ('republic of china',                 'taiwan'),
  ('democratic republic of congo',      'democratic republic of the congo'),
  ('drc',                               'democratic republic of the congo'),
  ('dr congo',                          'democratic republic of the congo'),
  ('congo-brazzaville',                 'republic of the congo'),
  ('congo',                             'republic of the congo'),
  ('gambia',                            'the gambia'),
  ('china',                             'people''s republic of china'),
  ('united states',                     'united states of america'),
  ('usa',                               'united states of america'),
  ('us',                                'united states of america'),
  ('uk',                                'united kingdom'),
  ('great britain',                     'united kingdom'),
  ('england',                           'united kingdom'),
  ('north cyprus',                      'turkish republic of northern cyprus'),
  ('northern cyprus',                   'turkish republic of northern cyprus'),
  ('persia',                            'iran'),
  ('siam',                              'thailand'),
  ('ceylon',                            'sri lanka'),
  ('dahomey',                           'benin'),
  ('gold coast',                        'ghana'),
  ('rhodesia',                          'zimbabwe'),
  ('belgian congo',                     'democratic republic of the congo'),
  ('abyssinia',                         'ethiopia'),
  ('formosa',                           'taiwan'),
  ('dutch east indies',                 'indonesia'),
  ('french indochina',                  'vietnam'),
  ('anglo-egyptian sudan',              'sudan'),
  ('british guiana',                    'guyana'),
  ('french guiana',                     'french guiana'),
  ('ussr',                              'russia'),
  ('soviet union',                      'russia'),
  ('yugoslavia',                        'serbia'),
  ('czechoslovakia',                    'czech republic')
ON CONFLICT (alias) DO NOTHING;

-- ── 2. Full-text search tsvector column on museum_objects ─────────────────────

ALTER TABLE museum_objects
  ADD COLUMN IF NOT EXISTS search_vector TSVECTOR;

-- Build index first so the update is efficient
CREATE INDEX IF NOT EXISTS museum_objects_search_vector_idx
  ON museum_objects USING GIN (search_vector);

-- Populate: concatenate searchable text fields with weights
-- A = place_name (highest), B = place_name_normalized / country_en, C = city_en / institution_name
-- Disable user triggers during bulk update to avoid conflicts with other table triggers (e.g. geom)
ALTER TABLE museum_objects DISABLE TRIGGER USER;
UPDATE museum_objects
SET search_vector = (
  setweight(to_tsvector('simple', coalesce(place_name, '')), 'A') ||
  setweight(to_tsvector('simple', coalesce(place_name_normalized, '')), 'B') ||
  setweight(to_tsvector('simple', coalesce(country_en, '')), 'B') ||
  setweight(to_tsvector('simple', coalesce(city_en, '')), 'C') ||
  setweight(to_tsvector('simple', coalesce(institution_name, '')), 'C')
);
ALTER TABLE museum_objects ENABLE TRIGGER USER;

-- ── 3. Trigger to keep search_vector current on insert/update ─────────────────
-- NOTE: This trigger was permanently dropped from the DB (2025-05) because it
-- blocked all museum_objects UPDATEs during ETL. The search_vector column is
-- populated by the bulk UPDATE above and refreshed via materialized views.
-- DO NOT re-enable without verifying the trigger does not conflict with ETL.
/*
CREATE OR REPLACE FUNCTION museum_objects_search_vector_trigger()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', coalesce(NEW.place_name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.place_name_normalized, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.country_en, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.city_en, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(NEW.institution_name, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS museum_objects_search_vector_update ON museum_objects;
CREATE TRIGGER museum_objects_search_vector_update
  BEFORE INSERT OR UPDATE OF
    place_name, place_name_normalized, country_en, city_en, institution_name
  ON museum_objects
  FOR EACH ROW EXECUTE FUNCTION museum_objects_search_vector_trigger();
*/

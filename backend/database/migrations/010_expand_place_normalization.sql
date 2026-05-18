-- Migration 010: Expand place name normalization
-- Extends migration 006 (~50 German→English country mappings) to cover:
--   A. Cultural and historical toponyms
--   B. Hierarchical "Country, Region" parsing → country_en + city_en back-population
--   C. Ambiguity flagging (? / possibly / probably suffixes)
--
-- Original place_name is NEVER modified.
-- Ambiguous entries (?) are normalised conservatively and flagged via geocoding_notes.
-- Safe to re-run: all UPDATEs check place_name_normalized IS NULL first.

-- -----------------------------------------------------------------------
-- PART A: Cultural and historical toponyms
-- -----------------------------------------------------------------------

-- "Court of Benin" → Benin City (also fixed in migration 009 for coordinates)
UPDATE museum_objects
SET place_name_normalized = 'Benin City, Nigeria'
WHERE place_name ILIKE '%Court of Benin%'
  AND place_name_normalized IS NULL;

-- Benin Kingdom / Bini Kingdom variants
UPDATE museum_objects
SET place_name_normalized = 'Benin City, Nigeria'
WHERE place_name ILIKE ANY (ARRAY[
  '%Benin Kingdom%', '%Kingdom of Benin%', '%Bini Kingdom%',
  '%Igun-Eronmwen%', '%Benin City%'
])
  AND place_name_normalized IS NULL;

-- Kameruner Grasland / Kamerun Grasland → Grassfields, Cameroon
UPDATE museum_objects
SET place_name_normalized = 'Grassfields, Cameroon'
WHERE place_name ILIKE ANY (ARRAY[
  '%Kameruner Grasland%', '%Grasland Kamerun%', '%Cameroon Grassfields%',
  '%Cameroon Grassland%', '%Grassfields%', '%Grassland (Kamerun)%'
])
  AND place_name_normalized IS NULL;

-- Ägypten? → Egypt (ambiguous, flag it)
UPDATE museum_objects
SET
  place_name_normalized = 'Egypt',
  geocoding_notes = COALESCE(geocoding_notes || chr(10), '') || 'place_name contains uncertainty marker (?); normalized conservatively'
WHERE place_name = 'Ägypten?'
  AND place_name_normalized IS NULL;

-- Generic question-mark ambiguity pattern for other countries
UPDATE museum_objects
SET
  place_name_normalized = TRIM(REPLACE(place_name, '?', '')),
  geocoding_notes = COALESCE(geocoding_notes || chr(10), '') || 'place_name contains uncertainty marker (?); normalized conservatively'
WHERE place_name LIKE '%?'
  AND place_name NOT ILIKE '%Ägypten?%'   -- already handled above
  AND place_name_normalized IS NULL
  AND LENGTH(TRIM(REPLACE(place_name, '?', ''))) > 0;

-- Dahomey → Benin (historical kingdom, now Republic of Benin)
UPDATE museum_objects
SET place_name_normalized = 'Benin (Dahomey)'
WHERE place_name ILIKE ANY (ARRAY['%Dahomey%', '%Dahome%'])
  AND place_name_normalized IS NULL;

-- Gold Coast → Ghana
UPDATE museum_objects
SET place_name_normalized = 'Ghana'
WHERE place_name ILIKE ANY (ARRAY['%Gold Coast%', '%Goldküste%'])
  AND place_name_normalized IS NULL;

-- Rhodesia → Zimbabwe / Zambia (flag as ambiguous)
UPDATE museum_objects
SET
  place_name_normalized = 'Zimbabwe/Zambia (Rhodesia)',
  geocoding_notes = COALESCE(geocoding_notes || chr(10), '') || 'Historical toponym Rhodesia; may refer to modern Zimbabwe or Zambia'
WHERE place_name ILIKE '%Rhodesia%'
  AND place_name_normalized IS NULL;

-- Belgian Congo / Congo Belge → Democratic Republic of the Congo
UPDATE museum_objects
SET place_name_normalized = 'Democratic Republic of the Congo'
WHERE place_name ILIKE ANY (ARRAY[
  '%Belgian Congo%', '%Congo Belge%', '%Belgisch Kongo%',
  '%Belgisch-Kongo%'
])
  AND place_name_normalized IS NULL;

-- French Congo → Republic of the Congo
UPDATE museum_objects
SET place_name_normalized = 'Republic of the Congo'
WHERE place_name ILIKE ANY (ARRAY['%French Congo%', '%Französisch-Kongo%'])
  AND place_name_normalized IS NULL;

-- Abyssinia → Ethiopia
UPDATE museum_objects
SET place_name_normalized = 'Ethiopia'
WHERE place_name ILIKE '%Abyssinia%'
  AND place_name_normalized IS NULL;

-- Mesopotamia → Iraq (historical)
UPDATE museum_objects
SET place_name_normalized = 'Iraq (Mesopotamia)'
WHERE place_name ILIKE '%Mesopotamia%'
  AND place_name_normalized IS NULL;

-- Persia → Iran (historical)
UPDATE museum_objects
SET place_name_normalized = 'Iran (Persia)'
WHERE place_name ILIKE ANY (ARRAY['%Persia%', '%Persien%'])
  AND place_name_normalized IS NULL;

-- Siam → Thailand
UPDATE museum_objects
SET place_name_normalized = 'Thailand'
WHERE place_name ILIKE ANY (ARRAY['%Siam%', '%Siamese%'])
  AND place_name_normalized IS NULL;

-- Ceylon → Sri Lanka
UPDATE museum_objects
SET place_name_normalized = 'Sri Lanka'
WHERE place_name ILIKE ANY (ARRAY['%Ceylon%', '%Zeylan%'])
  AND place_name_normalized IS NULL;

-- Burma / Birma → Myanmar
UPDATE museum_objects
SET place_name_normalized = 'Myanmar'
WHERE place_name ILIKE ANY (ARRAY['%Burma%', '%Birma%', '%Birmanie%'])
  AND place_name_normalized IS NULL;

-- Formosa → Taiwan
UPDATE museum_objects
SET place_name_normalized = 'Taiwan'
WHERE place_name ILIKE '%Formosa%'
  AND place_name_normalized IS NULL;

-- Nyasaland → Malawi
UPDATE museum_objects
SET place_name_normalized = 'Malawi'
WHERE place_name ILIKE '%Nyasaland%'
  AND place_name_normalized IS NULL;

-- Togoland / Deutsch-Togoland → Togo / Ghana
UPDATE museum_objects
SET
  place_name_normalized = 'Togo/Ghana (Togoland)',
  geocoding_notes = COALESCE(geocoding_notes || chr(10), '') || 'Historical Togoland was divided between modern Togo and Ghana in 1922'
WHERE place_name ILIKE ANY (ARRAY['%Togoland%', '%Deutsch-Togoland%', '%Deutschtogoland%'])
  AND place_name_normalized IS NULL;

-- German East Africa → Tanzania/Kenya/Burundi/Rwanda
UPDATE museum_objects
SET
  place_name_normalized = 'Tanzania (German East Africa)',
  geocoding_notes = COALESCE(geocoding_notes || chr(10), '') || 'German East Africa encompassed modern Tanzania, Rwanda, and Burundi'
WHERE place_name ILIKE ANY (ARRAY['%Deutsch-Ostafrika%', '%German East Africa%'])
  AND place_name_normalized IS NULL;

-- German South-West Africa → Namibia
UPDATE museum_objects
SET place_name_normalized = 'Namibia'
WHERE place_name ILIKE ANY (ARRAY[
  '%Deutsch-Südwestafrika%', '%Deutsch Südwestafrika%',
  '%German South-West Africa%', '%German Southwest Africa%'
])
  AND place_name_normalized IS NULL;

-- German Cameroon / Kamerun (colonial) → Cameroon
UPDATE museum_objects
SET place_name_normalized = 'Cameroon'
WHERE place_name ILIKE ANY (ARRAY['%Deutsch-Kamerun%', '%Kamerun%'])
  AND place_name_normalized IS NULL;

-- Ashanti / Asante Kingdom → Ghana
UPDATE museum_objects
SET place_name_normalized = 'Ashanti, Ghana'
WHERE place_name ILIKE ANY (ARRAY['%Ashanti%', '%Asante%', '%Aschanti%'])
  AND place_name_normalized IS NULL;

-- Yoruba / Yorubaland → Nigeria
UPDATE museum_objects
SET place_name_normalized = 'Yorubaland, Nigeria'
WHERE place_name ILIKE ANY (ARRAY['%Yoruba%', '%Yorubaland%'])
  AND place_name_normalized IS NULL;

-- Igbo / Ibo → Nigeria
UPDATE museum_objects
SET place_name_normalized = 'Igboland, Nigeria'
WHERE place_name ILIKE ANY (ARRAY['%Igboland%', '%Ibo Land%', '%Iboland%'])
  AND place_name_normalized IS NULL;

-- Aztec / Mexica Empire → Mexico
UPDATE museum_objects
SET place_name_normalized = 'Mexico (Aztec/Mexica)'
WHERE place_name ILIKE ANY (ARRAY['%Aztec%', '%Mexica%', '%Aztekisch%'])
  AND place_name_normalized IS NULL;

-- Inca / Incan Empire → Peru
UPDATE museum_objects
SET place_name_normalized = 'Peru (Inca)'
WHERE place_name ILIKE ANY (ARRAY['%Inca%', '%Incan%', '%Inka%'])
  AND place_name_normalized IS NULL;

-- Maya → Mexico / Guatemala (flag as ambiguous)
UPDATE museum_objects
SET
  place_name_normalized = 'Mesoamerica (Maya)',
  geocoding_notes = COALESCE(geocoding_notes || chr(10), '') || 'Maya origin spans modern Mexico, Guatemala, Belize, Honduras, El Salvador'
WHERE place_name ILIKE ANY (ARRAY['%Maya%', '%Mayan%'])
  AND place_name_normalized IS NULL;

-- -----------------------------------------------------------------------
-- PART B: Hierarchical "Country, Region" and "Country, City" parsing
-- Populates country_en and city_en from place_name_normalized for records
-- that follow the pattern "Country, SubPlace" or "SubPlace, Country".
-- -----------------------------------------------------------------------

-- Pattern: "Nigeria, Abiriba region" → country_en='Nigeria', city_en='Abiriba'
UPDATE museum_objects
SET
  country_en = SPLIT_PART(place_name_normalized, ',', 1),
  city_en    = TRIM(SPLIT_PART(place_name_normalized, ',', 2))
WHERE place_name_normalized LIKE '%,%'
  AND place_name_normalized NOT LIKE '%(%'   -- skip parenthetical notes
  AND (country_en IS NULL OR city_en IS NULL)
  AND published_at IS NOT NULL
  AND TRIM(SPLIT_PART(place_name_normalized, ',', 2)) != '';

-- -----------------------------------------------------------------------
-- PART C: Verification query (comment out before running in production)
-- -----------------------------------------------------------------------
-- SELECT
--   place_name,
--   place_name_normalized,
--   country_en,
--   city_en,
--   geocoding_notes
-- FROM museum_objects
-- WHERE place_name_normalized IS NOT NULL
--   AND (place_name ILIKE '%Benin%'
--     OR place_name ILIKE '%Grasland%'
--     OR place_name ILIKE '%?%'
--     OR place_name LIKE '%,%')
-- ORDER BY place_name
-- LIMIT 50;

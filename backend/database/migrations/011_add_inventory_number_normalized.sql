-- Migration 011: Add and populate inventory_number_normalized
--
-- Normalisation rules applied (in order):
--   1. Strip leading/trailing whitespace
--   2. Lowercase
--   3. Remove letter+suffix parts after the last numeric segment
--      e.g. "1991.17.58a, b" → "1991.17.58"
--   4. Strip trailing comma/space/semicolon artifacts
--
-- The original inventory_number column is NEVER modified.
-- Phase 6 roadmap target: lookup for "1991.17.58a, b" AND "1991.17.58" both succeed.

-- Step 1: Add the column
ALTER TABLE museum_objects
  ADD COLUMN IF NOT EXISTS inventory_number_normalized TEXT;

-- Step 2: Create a GIN-friendly index for fast normalized lookups
CREATE INDEX IF NOT EXISTS idx_museum_objects_inv_norm
  ON museum_objects (inventory_number_normalized);

-- Step 3: Populate via normalization expression
--
-- The expression:
--   LOWER(TRIM(
--     REGEXP_REPLACE(
--       TRIM(inventory_number),
--       '([a-z](\s*,\s*[a-z])*\s*)$',   -- strip trailing letter suffixes like "a, b" or "a,b,c"
--       '',
--       'i'
--     )
--   ))
--
-- Examples:
--   "1991.17.58a, b"   → "1991.17.58"
--   "III C 17a"        → "iii c 17"
--   "Oc1944,02.1"      → "oc1944,02.1"   (no trailing letter group — untouched)
--   "2014.628.63"      → "2014.628.63"
--   " Inv. 12345 "     → "inv. 12345"

UPDATE museum_objects
SET inventory_number_normalized =
  LOWER(
    TRIM(
      REGEXP_REPLACE(
        TRIM(inventory_number),
        -- Strip trailing ", a" / ", b" / ", c" letter-suffix groups (multi-part objects)
        '[,\s]*[a-zA-Z]\s*(,\s*[a-zA-Z]\s*)*$',
        '',
        'g'
      )
    )
  )
WHERE inventory_number IS NOT NULL
  AND inventory_number != ''
  AND inventory_number_normalized IS NULL;

-- Verification query:
-- SELECT inventory_number, inventory_number_normalized
-- FROM museum_objects
-- WHERE inventory_number ILIKE '%, %'
--    OR inventory_number ~ '[a-z],\s*[a-z]'
-- ORDER BY inventory_number
-- LIMIT 30;

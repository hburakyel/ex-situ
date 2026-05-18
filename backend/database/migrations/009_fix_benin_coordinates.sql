-- Migration 009: Fix Benin City coordinates and add coordinate_precision column
--
-- Part A: Add coordinate_precision field
--   Classifies how precise the stored lat/lon is relative to the actual origin.
--
-- Part B: Fix Benin bronzes (~500 km error)
--   Objects currently display at Nigeria's geographic centroid (7.99, 9.60).
--   The correct coordinates for Benin City are (5.6037, 7.0568).
--   The existing COALESCE(manual_latitude, latitude) in the query layer means
--   setting manual_latitude/manual_longitude is sufficient — source latitude/
--   longitude is preserved unchanged.

-- -----------------------------------------------------------------------
-- Part A: coordinate_precision column
-- -----------------------------------------------------------------------
ALTER TABLE museum_objects ADD COLUMN IF NOT EXISTS coordinate_precision TEXT
  CHECK (coordinate_precision IN ('exact', 'site', 'city', 'region', 'country'));

-- -----------------------------------------------------------------------
-- Part B: Benin City coordinate override
-- -----------------------------------------------------------------------
-- Target: all records where place_name matches known Benin Kingdom origin terms.
-- manual_latitude / manual_longitude were added by the initial schema; this sets
-- the correct Benin City centroid (5.6037°N, 7.0568°E).
--
-- Records matched by this update:
--   place_name ILIKE '%Court of Benin%'   — objects catalogued as from the royal court
--   place_name ILIKE '%Igun-Eronmwen%'    — bronze-casters' guild quarter in Benin City

UPDATE museum_objects
SET
  manual_latitude        = 5.6037,
  manual_longitude       = 7.0568,
  coordinate_precision   = 'city'
WHERE place_name ILIKE ANY (ARRAY['%Court of Benin%', '%Igun-Eronmwen%'])
  AND published_at IS NOT NULL;

-- Verification query (run after applying migration):
-- SELECT id, object_id, title, place_name,
--        latitude, longitude,
--        manual_latitude, manual_longitude,
--        COALESCE(manual_latitude, latitude)   AS displayed_lat,
--        COALESCE(manual_longitude, longitude) AS displayed_lon,
--        coordinate_precision
-- FROM museum_objects
-- WHERE place_name ILIKE ANY (ARRAY['%Court of Benin%', '%Igun-Eronmwen%'])
--   AND published_at IS NOT NULL
-- ORDER BY object_id;
--
-- Expected result: displayed_lat ≈ 5.60, displayed_lon ≈ 7.06 for all rows.

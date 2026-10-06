-- One Met object (inventory LC-2017.440) carries Berlin coordinates
-- (52.5174, 13.4007) as institution coordinates, so get_overview and the arc
-- queries list "The Metropolitan Museum of Art" twice. scrape_met_api.py writes
-- the correct values; this row was changed in the database.
--
-- Dry run: the SELECT should return exactly one row. Then run the UPDATE and
-- restart Strapi so the materialized views are rebuilt.
SELECT id, source_link, institution_latitude, institution_longitude
FROM museum_objects
WHERE institution_name = 'The Metropolitan Museum of Art'
  AND (institution_latitude IS DISTINCT FROM 40.779437
       OR institution_longitude IS DISTINCT FROM -73.963244);

UPDATE museum_objects
SET institution_latitude = 40.779437,
    institution_longitude = -73.963244,
    updated_at = NOW()
WHERE institution_name = 'The Metropolitan Museum of Art'
  AND review_status IS DISTINCT FROM 'verified'
  AND (institution_latitude IS DISTINCT FROM 40.779437
       OR institution_longitude IS DISTINCT FROM -73.963244);

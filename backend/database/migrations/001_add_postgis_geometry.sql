-- Note: PostGIS extension must already be installed by the DBA before running this migration.
-- It cannot be created inside a transaction. Run manually if needed:
--   sudo -u postgres psql -d museum_db -c "CREATE EXTENSION IF NOT EXISTS postgis;"
--
-- If PostGIS is not available this migration is a no-op — the app falls back to lat/lon queries.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
    RAISE NOTICE '001_add_postgis_geometry: PostGIS not installed — skipping geometry columns.';
    RETURN;
  END IF;

  -- Add geometry column to museum_objects table
  -- GEOGRAPHY type uses real-world coordinates (lat/lon) with accurate distance calculations
  EXECUTE 'ALTER TABLE museum_objects ADD COLUMN IF NOT EXISTS geom GEOGRAPHY(POINT, 4326)';

  -- Populate the geometry column from existing latitude/longitude data
  EXECUTE '
    UPDATE museum_objects
    SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
    WHERE latitude IS NOT NULL
      AND longitude IS NOT NULL
      AND geom IS NULL
  ';

  -- Create spatial index for fast bounding box queries
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_museum_objects_geom'
  ) THEN
    EXECUTE 'CREATE INDEX idx_museum_objects_geom ON museum_objects USING GIST(geom)';
  END IF;

  -- NOTE: The geom auto-update trigger was permanently removed (2025-05).
  -- The geom column does not exist in the Strapi-managed schema, causing trigger errors.
  -- Geometry is populated once by the UPDATE above; ETL scripts set it directly.

  -- Add institution geometry column for institution locations
  EXECUTE 'ALTER TABLE museum_objects ADD COLUMN IF NOT EXISTS institution_geom GEOGRAPHY(POINT, 4326)';

  -- Populate institution geometry
  EXECUTE '
    UPDATE museum_objects
    SET institution_geom = ST_SetSRID(ST_MakePoint(institution_longitude, institution_latitude), 4326)::geography
    WHERE institution_latitude IS NOT NULL
      AND institution_longitude IS NOT NULL
      AND institution_geom IS NULL
  ';

  -- Create spatial index for institution locations
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_museum_objects_institution_geom'
  ) THEN
    EXECUTE 'CREATE INDEX idx_museum_objects_institution_geom ON museum_objects USING GIST(institution_geom)';
  END IF;

END $$;

-- Create index on latitude and longitude for fallback queries (no PostGIS needed)
CREATE INDEX IF NOT EXISTS idx_museum_objects_lat_lon
ON museum_objects(latitude, longitude);

-- Note: PostGIS extension must already be installed by the DBA before running this migration.
-- It cannot be created inside a transaction. Run manually if needed:
--   sudo -u postgres psql -d museum_db -c "CREATE EXTENSION IF NOT EXISTS postgis;"

-- Add geometry column to museum_objects table
-- GEOGRAPHY type uses real-world coordinates (lat/lon) with accurate distance calculations
ALTER TABLE museum_objects
ADD COLUMN IF NOT EXISTS geom GEOGRAPHY(POINT, 4326);

-- Populate the geometry column from existing latitude/longitude data
UPDATE museum_objects
SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
WHERE latitude IS NOT NULL
  AND longitude IS NOT NULL
  AND geom IS NULL;

-- Create spatial index for fast bounding box queries
CREATE INDEX IF NOT EXISTS idx_museum_objects_geom
ON museum_objects USING GIST(geom);

-- Create index on latitude and longitude for fallback queries
CREATE INDEX IF NOT EXISTS idx_museum_objects_lat_lon
ON museum_objects(latitude, longitude);

-- Add a trigger to automatically update geom when lat/lon changes
CREATE OR REPLACE FUNCTION update_geom_from_lat_lon()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
        NEW.geom := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
    ELSE
        NEW.geom := NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER museum_objects_geom_trigger
BEFORE INSERT OR UPDATE OF latitude, longitude ON museum_objects
FOR EACH ROW
EXECUTE FUNCTION update_geom_from_lat_lon();

-- Add institution geometry column for institution locations
ALTER TABLE museum_objects
ADD COLUMN IF NOT EXISTS institution_geom GEOGRAPHY(POINT, 4326);

-- Populate institution geometry
UPDATE museum_objects
SET institution_geom = ST_SetSRID(ST_MakePoint(institution_longitude, institution_latitude), 4326)::geography
WHERE institution_latitude IS NOT NULL
  AND institution_longitude IS NOT NULL
  AND institution_geom IS NULL;

-- Create spatial index for institution locations
CREATE INDEX IF NOT EXISTS idx_museum_objects_institution_geom
ON museum_objects USING GIST(institution_geom);

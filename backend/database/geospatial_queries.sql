-- ============================================================================
-- Ex Situ Geospatial Queries - Raw SQL Reference
-- ============================================================================
-- This file contains all PostGIS queries used by the geospatial API endpoint
-- Use these for testing, optimization, or manual database queries
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. COUNTRY STATISTICS (Zoom < 5)
-- ----------------------------------------------------------------------------
-- Returns aggregated statistics by country for global view
-- No bounding box required
-- Performance: ~10ms for 132k objects

SELECT
  COALESCE(NULLIF(institution_place, ''), 'Unknown') as country_en,
  COUNT(*) as total_objects,
  json_agg(DISTINCT COALESCE(NULLIF(institution_name, ''), 'Unmapped')) as institutions,
  AVG(institution_latitude) as center_lat,
  AVG(institution_longitude) as center_lon,
  'country' as type
FROM museum_objects
WHERE published_at IS NOT NULL
GROUP BY COALESCE(NULLIF(institution_place, ''), 'Unknown')
ORDER BY total_objects DESC;


-- ----------------------------------------------------------------------------
-- 2. GRID-BASED CLUSTERING (Zoom 5-9)
-- ----------------------------------------------------------------------------
-- Uses ST_SnapToGrid to cluster nearby points
-- Grid size varies by zoom level (see calculateGridSize in service)
-- Performance: ~50-200ms depending on visible region

-- Example for zoom 7 (grid size 0.5 degrees)
WITH bbox_filter AS (
  SELECT
    id,
    object_id,
    title,
    latitude,
    longitude,
    institution_name,
    COALESCE(NULLIF(institution_place, ''), 'Unknown') as country_en,
    geom
  FROM museum_objects
  WHERE published_at IS NOT NULL
    AND latitude IS NOT NULL
    AND longitude IS NOT NULL
    AND latitude BETWEEN -90 AND 90      -- Replace with actual bbox.minLat and maxLat
    AND longitude BETWEEN -180 AND 180    -- Replace with actual bbox.minLon and maxLon
),
snapped_points AS (
  SELECT
    ST_SnapToGrid(
      ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography,
      0.5  -- Grid size in degrees (varies by zoom)
    ) as grid_point,
    latitude,
    longitude,
    country_en,
    institution_name,
    object_id,
    title
  FROM bbox_filter
)
SELECT
  ST_Y(grid_point::geometry) as cluster_lat,
  ST_X(grid_point::geometry) as cluster_lon,
  COUNT(*) as point_count,
  json_agg(
    json_build_object(
      'object_id', object_id,
      'title', title,
      'latitude', latitude,
      'longitude', longitude
    )
  ) FILTER (WHERE point_count <= 10) as sample_objects,
  COALESCE(NULLIF(MODE() WITHIN GROUP (ORDER BY country_en), ''), 'Unknown') as country_en,
  COALESCE(NULLIF(MODE() WITHIN GROUP (ORDER BY institution_name), ''), 'Unmapped') as institution_name,
  'cluster' as type
FROM snapped_points
GROUP BY grid_point
HAVING COUNT(*) > 0
ORDER BY point_count DESC;


-- ----------------------------------------------------------------------------
-- 3. INDIVIDUAL OBJECTS (Zoom 10+)
-- ----------------------------------------------------------------------------
-- Returns individual objects within bounding box
-- Requires bbox for memory efficiency
-- Performance: ~20-100ms for typical viewport

SELECT
  id,
  object_id,
  title,
  img_url,
  latitude,
  longitude,
  institution_place as country_en,
  institution_name,
  place_name,
  source_link,
  inventory_number,
  'object' as type
FROM museum_objects
WHERE published_at IS NOT NULL
  AND latitude BETWEEN -90 AND 90      -- Replace with actual bbox.minLat and maxLat
  AND longitude BETWEEN -180 AND 180    -- Replace with actual bbox.minLon and maxLon
  AND latitude IS NOT NULL
  AND longitude IS NOT NULL
ORDER BY object_id
LIMIT 5000;


-- ============================================================================
-- ALTERNATIVE CLUSTERING: ST_ClusterKMeans (Optional)
-- ============================================================================
-- Alternative to ST_SnapToGrid, groups points into K clusters
-- More computationally expensive but produces rounder clusters
-- Uncomment to use instead of grid-based clustering

/*
WITH bbox_filter AS (
  SELECT
    object_id,
    title,
    latitude,
    longitude,
    institution_name,
    COALESCE(NULLIF(institution_place, ''), 'Unknown') as country_en,
    geom
  FROM museum_objects
  WHERE published_at IS NOT NULL
    AND latitude IS NOT NULL
    AND longitude IS NOT NULL
    AND latitude BETWEEN -90 AND 90
    AND longitude BETWEEN -180 AND 180
),
clustered_points AS (
  SELECT
    object_id,
    title,
    latitude,
    longitude,
    country_en,
    institution_name,
    ST_ClusterKMeans(
      geom::geometry,
      100  -- Number of clusters (adjust based on zoom)
    ) OVER() as cluster_id
  FROM bbox_filter
)
SELECT
  cluster_id,
  AVG(latitude) as cluster_lat,
  AVG(longitude) as cluster_lon,
  COUNT(*) as point_count,
  COALESCE(MODE() WITHIN GROUP (ORDER BY country_en), 'Unknown') as country_en,
  COALESCE(MODE() WITHIN GROUP (ORDER BY institution_name), 'Unmapped') as institution_name,
  json_agg(
    json_build_object(
      'object_id', object_id,
      'title', title,
      'latitude', latitude,
      'longitude', longitude
    )
  ) FILTER (WHERE COUNT(*) <= 10) as sample_objects,
  'cluster' as type
FROM clustered_points
GROUP BY cluster_id
ORDER BY point_count DESC;
*/


-- ============================================================================
-- UTILITY QUERIES
-- ============================================================================

-- Check PostGIS version
SELECT PostGIS_Version();

-- Count objects with valid geometry
SELECT COUNT(*) as total_with_geometry
FROM museum_objects
WHERE geom IS NOT NULL;

-- Find objects without geometry (for debugging)
SELECT object_id, latitude, longitude
FROM museum_objects
WHERE geom IS NULL
  AND (latitude IS NOT NULL OR longitude IS NOT NULL)
LIMIT 10;

-- Get bounding box of all objects
SELECT
  MIN(latitude) as min_lat,
  MAX(latitude) as max_lat,
  MIN(longitude) as min_lon,
  MAX(longitude) as max_lon,
  ST_AsText(
    ST_Envelope(
      ST_Collect(geom::geometry)
    )
  ) as bbox_polygon
FROM museum_objects
WHERE geom IS NOT NULL;

-- Count objects per country
SELECT
  COALESCE(NULLIF(institution_place, ''), 'Unknown') as country,
  COUNT(*) as count
FROM museum_objects
WHERE published_at IS NOT NULL
GROUP BY country
ORDER BY count DESC;

-- Test spatial index usage
EXPLAIN ANALYZE
SELECT COUNT(*)
FROM museum_objects
WHERE latitude BETWEEN 50 AND 55
  AND longitude BETWEEN 10 AND 15;

-- Measure distance between two objects
SELECT
  a.object_id as object_a,
  b.object_id as object_b,
  ST_Distance(a.geom, b.geom) / 1000 as distance_km
FROM museum_objects a, museum_objects b
WHERE a.object_id = 127242
  AND b.object_id = 127243
  AND a.geom IS NOT NULL
  AND b.geom IS NOT NULL;

-- Find nearest objects to a point
SELECT
  object_id,
  title,
  latitude,
  longitude,
  ST_Distance(
    geom,
    ST_SetSRID(ST_MakePoint(13.405, 52.52), 4326)::geography
  ) / 1000 as distance_km
FROM museum_objects
WHERE geom IS NOT NULL
ORDER BY geom <-> ST_SetSRID(ST_MakePoint(13.405, 52.52), 4326)::geography
LIMIT 10;


-- ============================================================================
-- PERFORMANCE OPTIMIZATION QUERIES
-- ============================================================================

-- Check index usage statistics
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan as index_scans,
  idx_tup_read as tuples_read,
  idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE tablename = 'museum_objects'
ORDER BY idx_scan DESC;

-- Table statistics
SELECT
  schemaname,
  tablename,
  n_live_tup as live_tuples,
  n_dead_tup as dead_tuples,
  last_vacuum,
  last_autovacuum,
  last_analyze,
  last_autoanalyze
FROM pg_stat_user_tables
WHERE tablename = 'museum_objects';

-- Rebuild all indexes (run if queries are slow)
REINDEX TABLE museum_objects;

-- Update table statistics
ANALYZE museum_objects;

-- Vacuum and analyze (removes dead tuples)
VACUUM ANALYZE museum_objects;

-- Check table size
SELECT
  pg_size_pretty(pg_total_relation_size('museum_objects')) as total_size,
  pg_size_pretty(pg_relation_size('museum_objects')) as table_size,
  pg_size_pretty(pg_total_relation_size('museum_objects') - pg_relation_size('museum_objects')) as indexes_size;


-- ============================================================================
-- GRID SIZE REFERENCE
-- ============================================================================
-- Grid sizes used by calculateGridSize() in the service

-- Zoom 5: 2.0 degrees  (~220 km at equator)
-- Zoom 6: 1.0 degrees  (~110 km)
-- Zoom 7: 0.5 degrees  (~55 km)
-- Zoom 8: 0.25 degrees (~28 km)
-- Zoom 9: 0.1 degrees  (~11 km)

-- At the equator: 1 degree ≈ 111 km
-- At 45° latitude: 1 degree longitude ≈ 78 km


-- ============================================================================
-- SAMPLE DATA FOR TESTING
-- ============================================================================

-- Insert test object with geometry
/*
INSERT INTO museum_objects (
  object_id,
  title,
  latitude,
  longitude,
  institution_place,
  institution_name,
  published_at,
  created_at,
  updated_at
) VALUES (
  999999,
  'Test Object',
  52.52,
  13.405,
  'Germany',
  'Test Museum',
  NOW(),
  NOW(),
  NOW()
);
*/

-- Verify test object has geometry
/*
SELECT
  object_id,
  title,
  ST_AsText(geom::geometry) as geometry_text,
  ST_Y(geom::geometry) as lat,
  ST_X(geom::geometry) as lon
FROM museum_objects
WHERE object_id = 999999;
*/

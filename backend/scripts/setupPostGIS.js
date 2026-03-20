#!/usr/bin/env node

/**
 * PostGIS Setup Script
 * Enables PostGIS extension and sets up geometry columns for museum objects
 */

const fs = require('fs');
const path = require('path');

async function setupPostGIS() {
  console.log('🗺️  Setting up PostGIS for Ex Situ...\n');

  // Import Strapi
  const strapi = require('@strapi/strapi');
  const app = await strapi().load();

  const db = app.db.connection;

  try {
    // Read migration SQL
    const migrationPath = path.join(__dirname, '../database/migrations/001_add_postgis_geometry.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('📍 Enabling PostGIS extension...');

    // Split SQL by semicolons and execute each statement
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const statement of statements) {
      await db.raw(statement);
    }

    console.log('✅ PostGIS extension enabled');
    console.log('✅ Geometry columns added');
    console.log('✅ Spatial indexes created');
    console.log('✅ Auto-update triggers set up');

    // Verify setup
    const result = await db.raw(`
      SELECT COUNT(*) as count
      FROM museum_objects
      WHERE geom IS NOT NULL;
    `);

    const count = result.rows[0].count;
    console.log(`\n📊 Geometry data populated for ${count} objects\n`);

    // Test PostGIS functions
    console.log('🧪 Testing PostGIS functions...');
    const testResult = await db.raw(`
      SELECT
        ST_AsText(geom::geometry) as point,
        latitude,
        longitude
      FROM museum_objects
      WHERE geom IS NOT NULL
      LIMIT 1;
    `);

    if (testResult.rows.length > 0) {
      console.log('✅ PostGIS functions working correctly');
      console.log(`   Sample: ${testResult.rows[0].point}\n`);
    }

    console.log('🎉 PostGIS setup complete!\n');
    console.log('You can now use the geospatial endpoint:');
    console.log('   GET /api/museum-objects/geospatial?zoom=5&minLon=-180&minLat=-90&maxLon=180&maxLat=90\n');

  } catch (error) {
    console.error('❌ Error setting up PostGIS:', error.message);
    console.error('\nMake sure:');
    console.error('1. PostgreSQL is running');
    console.error('2. PostGIS extension is installed: sudo apt-get install postgresql-postgis');
    console.error('3. Database user has CREATE EXTENSION privileges\n');
    process.exit(1);
  } finally {
    await app.destroy();
  }
}

setupPostGIS();

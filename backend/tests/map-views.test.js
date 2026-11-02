'use strict';

/**
 * The map's view definitions (src/map-views.js), checked as SQL text: no database.
 * Run: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { MAP_VIEWS, POINTS_VIEW_SQL } = require('../src/map-views');

test('museum_object_points: both branches list the same columns in the same order', () => {
  const [own, named] = POINTS_VIEW_SQL.split('UNION ALL');
  // The select list ends at the FROM that starts a line (a FROM inside it is mid-line).
  const columns = (sql) => sql.slice(sql.indexOf('SELECT') + 6, sql.search(/\n\s*FROM /)).split(',').length;
  assert.equal(columns(own), columns(named));
  assert.match(own, /WHERE NOT EXISTS \(SELECT 1 FROM museum_object_origins/);
  // The named places carry their own point and country, no manual point and no precise place.
  assert.match(named, /o\.latitude, o\.longitude, NULL::double precision, NULL::double precision/);
});

test('arc and per-country views read the object points; per-object totals the table', () => {
  const sql = Object.fromEntries(MAP_VIEWS.map((v) => [v.name, v.sql]));
  for (const name of ['mv_country_institution_stats', 'mv_city_institution_stats', 'mv_place_suggest',
    'mv_time_bucket_by_group', 'mv_acquisition_year_by_group', 'mv_date_span_by_group']) {
    assert.match(sql[name], /FROM museum_object_points/, name);
  }
  for (const name of ['mv_time_bucket_stats', 'mv_acquisition_year_stats', 'mv_date_span_stats']) {
    assert.doesNotMatch(sql[name], /museum_object_points/, name);
  }
  assert.match(sql.mv_country_institution_stats, /AS primary_count/);
  assert.match(sql.mv_city_institution_stats, /AS primary_count/);
});

test('per-group views: once per country, and is_primary in the unique key', () => {
  for (const view of MAP_VIEWS.filter((v) => v.name.endsWith('_by_group'))) {
    assert.match(view.sql, /first_in_country/, view.name);
    assert.match(view.key, /is_primary/, view.name);
  }
});

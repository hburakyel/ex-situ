'use strict';

/**
 * Unit tests for the geospatial parts of the museum-object service.
 * No database or Strapi boot: @strapi/strapi is stubbed so createCoreService
 * returns the plain service object, and db.raw is a fake that records each
 * query and answers from a handler.
 *
 * Run: npm test (node:test, Node 20+)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Stub @strapi/strapi before the service requires it.
const strapiPath = require.resolve('@strapi/strapi');
require.cache[strapiPath] = {
  id: strapiPath,
  filename: strapiPath,
  loaded: true,
  exports: { factories: { createCoreService: (_uid, factory) => factory } },
};

const serviceFactory = require(path.join(__dirname, '../src/api/museum-object/services/museum-object.js'));

const noop = () => {};
const fakeStrapi = { log: { info: noop, debug: noop, error: noop, warn: noop } };

/** Fresh service per test, so the materialized-view cache doesn't leak. */
function makeService() {
  return serviceFactory({ strapi: fakeStrapi });
}

/**
 * Fake Knex connection. `mviews` lists materialized views that "exist";
 * `rows` is returned for every non-pg_matviews query.
 */
function makeDb({ mviews = [], rows = [] } = {}) {
  const calls = [];
  return {
    calls,
    schema: { hasColumn: async () => true },
    async raw(query, bindings) {
      if (query.includes('pg_matviews')) {
        return { rows: [{ exists: mviews.includes(bindings[0]) }] };
      }
      calls.push({ query, bindings });
      return { rows };
    },
  };
}

const withDb = (service, db) => {
  fakeStrapi.db = { connection: db };
  return service;
};

// ── Filter builders ─────────────────────────────────────────────────────────

test('buildMultiValueFilter: single value uses =, several use IN', () => {
  const s = makeService();
  assert.deepEqual(s.buildMultiValueFilter('country_en', 'Egypt', 'p'), {
    clause: 'AND country_en = :p_0 ',
    bindings: { p_0: 'Egypt' },
  });
  assert.deepEqual(s.buildMultiValueFilter('country_en', ' Egypt , ,Iraq', 'p'), {
    clause: 'AND country_en IN (:p_0, :p_1) ',
    bindings: { p_0: 'Egypt', p_1: 'Iraq' },
  });
});

test('buildMultiValueFilter: empty input adds nothing, values capped at 50', () => {
  const s = makeService();
  assert.deepEqual(s.buildMultiValueFilter('country_en', '', 'p'), { clause: '', bindings: {} });
  assert.deepEqual(s.buildMultiValueFilter('country_en', ' , ', 'p'), { clause: '', bindings: {} });

  const many = Array.from({ length: 60 }, (_, i) => `c${i}`).join(',');
  const { bindings } = s.buildMultiValueFilter('country_en', many, 'p');
  assert.equal(Object.keys(bindings).length, 50);
});

test('buildMultiValueFilter: values are bound, never inlined into SQL', () => {
  const s = makeService();
  const { clause, bindings } = s.buildMultiValueFilter('institution_name', "x'; DROP TABLE museum_objects; --", 'p');
  assert.ok(!clause.includes('DROP'));
  assert.equal(bindings.p_0, "x'; DROP TABLE museum_objects; --");
});

test('buildSiteFilter: splits on "|" so site names keep their commas', () => {
  const s = makeService();
  const { clause, bindings } = s.buildSiteFilter('Mortuary Temple of Sahure, Abusir | Giza', 'site', 'LOWER(origin_city)');
  assert.equal(clause, 'AND LOWER(origin_city) IN (LOWER(:site_0), LOWER(:site_1)) ');
  assert.deepEqual(bindings, { site_0: 'Mortuary Temple of Sahure, Abusir', site_1: 'Giza' });
  assert.deepEqual(s.buildSiteFilter(undefined, 'site'), { clause: '', bindings: {} });
});

test('buildDateRangeFilter: overlap test, and year 0 / BCE values count', () => {
  const s = makeService();
  assert.deepEqual(s.buildDateRangeFilter({ dateStart: -500, dateEnd: 0 }, 'd'), {
    clause: 'AND object_date_earliest <= :d_end AND object_date_latest >= :d_start ',
    bindings: { d_end: 0, d_start: -500 },
  });
  assert.deepEqual(s.buildDateRangeFilter({ dateStart: 1800 }, 'd'), {
    clause: 'AND object_date_latest >= :d_start ',
    bindings: { d_start: 1800 },
  });
  assert.deepEqual(s.buildDateRangeFilter({}, 'd'), { clause: '', bindings: {} });
});

test('buildDateRangeFilter: undated wins over a date range', () => {
  const s = makeService();
  assert.deepEqual(s.buildDateRangeFilter({ undated: true, dateStart: 1800 }, 'd'), {
    clause: "AND object_date_precision = 'unknown' ",
    bindings: {},
  });
});

test('buildAcquisitionDateRangeFilter: only confirmed acquisition dates match a range', () => {
  const s = makeService();
  const { clause, bindings } = s.buildAcquisitionDateRangeFilter({ acqDateStart: 1880, acqDateEnd: 1889 }, 'a');
  assert.match(clause, /^AND acquisition_date_confidence = 'confirmed' /);
  assert.match(clause, /acquisition_year_earliest <= :a_end/);
  assert.match(clause, /acquisition_year_latest >= :a_start/);
  assert.deepEqual(bindings, { a_end: 1889, a_start: 1880 });

  // "Unknown" bucket = everything not confirmed (inferred or missing)
  assert.equal(
    s.buildAcquisitionDateRangeFilter({ acqUndated: true }, 'a').clause,
    "AND (acquisition_date_confidence IS DISTINCT FROM 'confirmed') "
  );
  assert.deepEqual(s.buildAcquisitionDateRangeFilter({}, 'a'), { clause: '', bindings: {} });
});

// ── getRows ─────────────────────────────────────────────────────────────────

test('getRows handles the driver result shapes', () => {
  const s = makeService();
  assert.deepEqual(s.getRows({ rows: [1] }), [1]);
  assert.deepEqual(s.getRows([2]), [2]);
  assert.deepEqual(s.getRows({ 0: [3] }), [3]);
  assert.deepEqual(s.getRows(null), []);
});

// ── getGeospatialData routing ───────────────────────────────────────────────

test('getGeospatialData: zoom picks country stats / clusters / objects', async () => {
  const bbox = { minLat: 0, maxLat: 10, minLon: 0, maxLon: 10 };
  const cases = [[0, 'statistics'], [3.9, 'statistics'], [4, 'clusters'], [6.9, 'clusters'], [7, 'objects'], [12, 'objects']];
  for (const [zoom, type] of cases) {
    const s = withDb(makeService(), makeDb());
    const result = await s.getGeospatialData(zoom, bbox, {});
    assert.equal(result.type, type, `zoom ${zoom}`);
  }
});

// ── Country level (zoom < 4) ────────────────────────────────────────────────

test('getCountryStatistics: uses the materialized view when no city/date filter', async () => {
  const db = makeDb({
    mviews: ['mv_country_institution_stats'],
    rows: [{
      origin_country: 'Egypt', origin_lat: '26.8', origin_lon: '30.8',
      institution_name: 'Antikensammlung', inst_lat: '52.52', inst_lon: '13.39',
      object_count: '42', sample_img_url: null,
    }],
  });
  const s = withDb(makeService(), db);
  const result = await s.getCountryStatistics(db, { country: 'Egypt' });

  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].query, /FROM mv_country_institution_stats/);
  assert.match(db.calls[0].query, /origin_country = :cs_country_0/);
  assert.deepEqual(db.calls[0].bindings, { cs_country_0: 'Egypt' });

  assert.deepEqual(result.data[0], {
    place_name: 'Egypt', latitude: 26.8, longitude: 30.8,
    institution_name: 'Antikensammlung', institution_place: 'Antikensammlung',
    institution_latitude: 52.52, institution_longitude: 13.39,
    object_count: 42, sample_img_url: null, type: 'arc',
    cluster_id: 'arc_country_Egypt_Antikensammlung',
  });
});

test('getCountryStatistics: a date filter forces the live query (MV has no dates)', async () => {
  const db = makeDb({ mviews: ['mv_country_institution_stats'] });
  const s = withDb(makeService(), db);
  await s.getCountryStatistics(db, { dateStart: 1800, dateEnd: 1899 });

  assert.equal(db.calls.length, 1);
  const { query, bindings } = db.calls[0];
  assert.match(query, /FROM museum_objects/);
  assert.doesNotMatch(query, /mv_country_institution_stats/);
  assert.match(query, /published_at IS NOT NULL/);
  assert.match(query, /COALESCE\(manual_latitude, latitude\)/);
  assert.deepEqual(bindings, { fb_date_end: 1899, fb_date_start: 1800 });
});

test('getCountryStatistics: falls back to the live query when the MV is missing', async () => {
  const db = makeDb({ mviews: [] });
  const s = withDb(makeService(), db);
  await s.getCountryStatistics(db, { institution: 'Antikensammlung' });
  assert.match(db.calls[0].query, /FROM museum_objects/);
  assert.deepEqual(db.calls[0].bindings, { fb_inst_0: 'Antikensammlung' });
});

// ── City level (zoom 4–6) ───────────────────────────────────────────────────

test('getClusteredData: missing bbox defaults to the whole world', async () => {
  const db = makeDb({ mviews: ['mv_city_institution_stats'] });
  const s = withDb(makeService(), db);
  await s.getClusteredData(db, 5, undefined, {});
  assert.match(db.calls[0].query, /FROM mv_city_institution_stats/);
  assert.deepEqual(db.calls[0].bindings, { minLat: -90, maxLat: 90, minLon: -180, maxLon: 180 });
});

test('getClusteredData: 0 is a real bbox edge, not "missing"', async () => {
  const db = makeDb({ mviews: ['mv_city_institution_stats'] });
  const s = withDb(makeService(), db);
  await s.getClusteredData(db, 5, { minLat: 0, maxLat: 10, minLon: '0', maxLon: 'x' }, {});
  assert.deepEqual(db.calls[0].bindings, { minLat: 0, maxLat: 10, minLon: 0, maxLon: 180 });
});

test('getClusteredData: maps rows and keeps place_variants only when an array', async () => {
  const db = makeDb({
    mviews: ['mv_city_institution_stats'],
    rows: [
      { origin_city: 'Thebes', place_variants: ['Thebes', 'Theben'], country_en: 'Egypt', origin_lat: '25.7', origin_lon: '32.6', institution_name: 'Ägyptisches Museum und Papyrussammlung', inst_lat: '52.52', inst_lon: '13.40', object_count: 7 },
      { origin_city: 'Giza', place_variants: null, country_en: null, origin_lat: null, origin_lon: null, institution_name: 'X', inst_lat: null, inst_lon: null, object_count: null },
    ],
  });
  const s = withDb(makeService(), db);
  const { type, data } = await s.getClusteredData(db, 5, { minLat: 20, maxLat: 30, minLon: 25, maxLon: 35 }, { city: 'Thebes' });

  assert.equal(type, 'clusters');
  assert.match(db.calls[0].query, /LOWER\(origin_city\) IN \(LOWER\(:cl_city_0\)\)/);
  assert.deepEqual(data[0].place_variants, ['Thebes', 'Theben']);
  assert.equal(data[0].latitude, 25.7);
  assert.equal(data[0].cluster_id, 'arc_city_Thebes_Ägyptisches Museum und Papyrussammlung');
  assert.deepEqual(data[1].place_variants, []);
  assert.equal(data[1].country, null);
  assert.equal(data[1].object_count, 0);
});

test('getClusteredData: an acquisition filter forces the live query', async () => {
  const db = makeDb({ mviews: ['mv_city_institution_stats'] });
  const s = withDb(makeService(), db);
  await s.getClusteredData(db, 5, null, { acqUndated: true });
  assert.match(db.calls[0].query, /FROM museum_objects/);
  assert.match(db.calls[0].query, /acquisition_date_confidence IS DISTINCT FROM 'confirmed'/);
});

// ── Object level (zoom 7+) ──────────────────────────────────────────────────

test('getIndividualObjects: requires a valid bbox', async () => {
  const db = makeDb();
  const s = withDb(makeService(), db);
  await assert.rejects(s.getIndividualObjects(db, null, {}), /Bounding box is required/);
  await assert.rejects(
    s.getIndividualObjects(db, { minLat: 'a', maxLat: 1, minLon: 0, maxLon: 1 }, {}),
    /Invalid bbox/
  );
  assert.equal(db.calls.length, 0);
});

test('getIndividualObjects: binds bbox + filters and maps rows', async () => {
  const db = makeDb({
    rows: [{
      id: 1, object_id: 'o1', title: 't', img_url: null,
      resolved_latitude: '30.1', resolved_longitude: '31.2',
      institution_place: null, institution_city_en: 'Berlin', institution_name: 'Antikensammlung',
      place_name: 'Gizeh', place_name_normalized: 'Giza',
      source_link: 'https://example.org/record/1',
      object_link_url: 'https://example.org/record/1-permalink', object_link_display: 'Permalink',
      institution_latitude: '52.52', institution_longitude: '13.39',
      country_en: 'Egypt', city_en: 'Giza', manual_latitude: null, manual_longitude: null,
    }],
  });
  const s = withDb(makeService(), db);
  const bbox = { minLat: '29', maxLat: '31', minLon: '30', maxLon: '32' };
  const result = await s.getIndividualObjects(db, bbox, { institution: 'Antikensammlung', country: 'Egypt,Sudan' });

  const { query, bindings } = db.calls[0];
  assert.match(query, /DISTINCT ON/);
  assert.match(query, /LIMIT 5000/);
  assert.deepEqual(bindings, {
    minLat: 29, maxLat: 31, minLon: 30, maxLon: 32,
    io_inst_0: 'Antikensammlung', io_country_0: 'Egypt', io_country_1: 'Sudan',
  });

  assert.equal(result.type, 'objects');
  assert.equal(result.count, 1);
  const obj = result.data[0];
  assert.equal(obj.latitude, 30.1);
  assert.equal(obj.institution_place, 'Berlin');
  // The object link (institution permalink) takes priority over source_link.
  assert.equal(obj.source_link, 'https://example.org/record/1-permalink');
  assert.deepEqual(obj.object_links, [{ link_text: 'https://example.org/record/1-permalink', link_display: 'Permalink' }]);
  assert.equal(obj.manual_latitude, null);
  assert.equal(obj.cluster_id, 'object_o1');
});

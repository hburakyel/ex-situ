'use strict';

/**
 * Unit tests for searchObjects (GET /api/museum-objects/search) and the list
 * controller's public date. No database or Strapi boot: @strapi/strapi is stubbed
 * and db.raw is a fake that records each query and answers with fixed rows.
 *
 * Run: npm test (node:test, Node 20+)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const strapiPath = require.resolve('@strapi/strapi');
require.cache[strapiPath] = {
  id: strapiPath,
  filename: strapiPath,
  loaded: true,
  exports: { factories: { createCoreService: (_uid, factory) => factory } },
};

const serviceFactory = require(path.join(__dirname, '../src/api/museum-object/services/museum-object.js'));

const noop = () => {};

function makeService(rows = []) {
  const calls = [];
  const db = {
    async raw(query, bindings) {
      calls.push({ query, bindings });
      return { rows };
    },
  };
  const strapi = { db: { connection: db }, log: { info: noop, debug: noop, error: noop, warn: noop } };
  return { service: serviceFactory({ strapi }), calls, strapi };
}

const METROW = {
  id: 27375,
  inventory_number: '1974.294.2',
  institution_name: 'The Metropolitan Museum of Art',
  institution_place: 'New York',
  institution_city_en: null,
  place_name: 'probably Bukhara and Herat, present-day Uzbekistan and Afghanistan',
  place_display: 'probably Bukhara and Herat',
  city_en: 'probably Bukhara and Herat',
  country_en: null,
  img_url: 'https://images.metmuseum.org/x.jpg',
  source_link: 'https://www.metmuseum.org/art/collection/search/452670',
  latitude: null,
  longitude: null,
  manual_latitude: null,
  manual_longitude: null,
  object_date: null,
  acquisition_year: null,
  object_date_display: null,
  object_date_earliest: 1500,
  object_date_latest: 1560,
  object_date_precision: 'range',
  acquisition_date_confidence: null,
  acquisition_year_earliest: null,
  match_rank: 0,
};

test('short queries do not reach the database', async () => {
  const { service, calls } = makeService();
  assert.deepEqual(await service.searchObjects(' a '), []);
  assert.equal(calls.length, 0);
});

test('inventory number is matched exactly (normalized) and as a prefix', async () => {
  const { service, calls } = makeService();
  await service.searchObjects('27.13.2a, b');
  const { query, bindings } = calls[0];
  assert.equal(bindings.invExact, '27.13.2');
  assert.equal(bindings.invPrefix, '27.13.2a, b%');
  assert.match(query, /inventory_number_normalized = :invExact/);
  assert.match(query, /lower\(inventory_number\) LIKE :invPrefix/);
});

test('every word must appear; LIKE wildcards in the query are literal', async () => {
  const { service, calls } = makeService();
  await service.searchObjects('Herat 50%_x');
  const { query, bindings } = calls[0];
  assert.equal(bindings.w0, '%herat%');
  assert.equal(bindings.w1, '%50\\%\\_x%');
  assert.match(query, /LIKE :w0 AND .* LIKE :w1/s);
  assert.doesNotMatch(query, /title/, 'titles are not public and are not searched');
});

test('limit is clamped to 1..20', async () => {
  const { service, calls } = makeService();
  await service.searchObjects('herat', 500);
  await service.searchObjects('herat', 0);
  assert.equal(calls[0].bindings.limit, 20);
  assert.equal(calls[1].bindings.limit, 8);
});

test('rows come back with the public date and whether they are on the map', async () => {
  const { service } = makeService([METROW]);
  const [hit] = await service.searchObjects('1974.294.2');
  assert.equal(hit.id, 27375);
  assert.equal(hit.object_date, '1500–1560');
  assert.equal(hit.located, false);
  assert.equal(hit.match, 'inventory_number');
  assert.equal(hit.place_name, 'probably Bukhara and Herat');
  assert.equal('title' in hit, false);
});

test("a record with no city or country shows its own place text, not 'Unknown'", async () => {
  const { service } = makeService([{ ...METROW, place_display: 'Unknown', place_name: 'Spain or North Africa', match_rank: 2 }]);
  const [hit] = await service.searchObjects('spain');
  assert.equal(hit.place_name, 'Spain or North Africa');
  assert.equal(hit.match, 'text');
});

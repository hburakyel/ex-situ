'use strict';

const test = require('node:test');
const assert = require('node:assert');
const middleware = require('../src/middlewares/strip-object-titles');

const run = async (ctx) => {
  await middleware()(ctx, async () => {});
  return ctx.body;
};

test('removes title from a Strapi list response', async () => {
  const body = await run({
    method: 'GET',
    path: '/api/museum-objects',
    body: { data: [{ id: 1, attributes: { title: 'Raja Udai Mal', inventory_number: 'IM.9:123-1912' } }], meta: {} },
  });
  assert.deepStrictEqual(body.data[0].attributes, { inventory_number: 'IM.9:123-1912' });
});

test('removes title and sample_title from custom routes', async () => {
  const lookup = await run({
    method: 'GET',
    path: '/api/museum-objects/lookup',
    body: { total: 1, sample: [{ id: 1, title: 'x', place_name: 'Arita' }] },
  });
  assert.deepStrictEqual(lookup.sample[0], { id: 1, place_name: 'Arita' });

  const group = await run({
    method: 'GET',
    path: '/api/museum-objects/by-country',
    body: { data: [{ country_en: 'Japan', sample_title: 'x', count: 3 }] },
  });
  assert.deepStrictEqual(group.data[0], { country_en: 'Japan', count: 3 });
});

test('leaves other routes, other methods and curator routes alone', async () => {
  for (const ctx of [
    { method: 'GET', path: '/api/other', body: { title: 'keep' } },
    { method: 'POST', path: '/api/museum-objects/5/correct', body: { data: { title: 'keep' } } },
    { method: 'GET', path: '/api/museum-objects/review-queue', body: { data: [{ title: 'keep' }] } },
    { method: 'GET', path: '/api/museum-objects/pending-corrections', body: { data: [{ title: 'keep' }] } },
  ]) {
    const before = JSON.stringify(ctx.body);
    assert.strictEqual(JSON.stringify(await run(ctx)), before);
  }
});

test('ignores empty, string and stream bodies', async () => {
  assert.strictEqual(await run({ method: 'GET', path: '/api/museum-objects', body: undefined }), undefined);
  assert.strictEqual(await run({ method: 'GET', path: '/api/museum-objects', body: 'text' }), 'text');
  const stream = { pipe() {} , title: 'keep' };
  assert.strictEqual((await run({ method: 'GET', path: '/api/museum-objects', body: stream })).title, 'keep');
});

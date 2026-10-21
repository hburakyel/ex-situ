'use strict';

/**
 * Object titles are stored with the record but are not part of the public API:
 * the site does not show them (METHODOLOGY, "Titles"), and historical titles can
 * carry outdated or offensive language or a person's name. The institution's own
 * record, linked from every object, has the title.
 *
 * Applies to public GET responses under /api/museum-objects. The curator routes
 * (review queue, pending corrections) keep it.
 */

const STRIPPED_KEYS = new Set(['title', 'sample_title']);
const CURATOR_PATHS = ['/api/museum-objects/review-queue', '/api/museum-objects/pending-corrections'];

function strip(value) {
  if (Array.isArray(value)) {
    for (const item of value) strip(item);
  } else if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (STRIPPED_KEYS.has(key)) delete value[key];
      else strip(value[key]);
    }
  }
  return value;
}

const applies = (ctx) =>
  ctx.method === 'GET' &&
  ctx.path.startsWith('/api/museum-objects') &&
  !CURATOR_PATHS.some((p) => ctx.path === p || ctx.path.startsWith(`${p}/`));

module.exports = () => async (ctx, next) => {
  await next();
  const body = ctx.body;
  if (applies(ctx) && body && typeof body === 'object' && !Buffer.isBuffer(body) && typeof body.pipe !== 'function') {
    strip(body);
  }
};

module.exports.strip = strip;
module.exports.applies = applies;

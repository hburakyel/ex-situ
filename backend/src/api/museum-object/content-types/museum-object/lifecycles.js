'use strict';

/**
 * Lifecycle hooks for museum-object content type.
 *
 * Phase 5: Automatically refresh geospatial materialized views after any
 * create / update / delete event, so that arc counts on the map never
 * go stale after data imports.
 *
 * A 5-second debounce batches rapid bulk-import events into a single refresh.
 * The refresh itself is fire-and-forget (errors are logged, not thrown) so that
 * a failed refresh never blocks a successful write.
 */

let _debounceTimer = null;

/**
 * Schedule a debounced materialized view refresh.
 * If called again within 5 s (e.g. during a bulk import), the previous timer
 * is cleared and the clock resets — only one refresh fires after the burst ends.
 */
function scheduleRefresh(strapi) {
  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
  }
  _debounceTimer = setTimeout(async () => {
    _debounceTimer = null;
    try {
      await strapi
        .service('api::museum-object.museum-object')
        .refreshGeospatialViews();
    } catch (err) {
      strapi.log.error('Lifecycle: geospatial view refresh failed:', err?.message);
    }
  }, 5000);
}

module.exports = {
  afterCreate({ result, params }) {
    scheduleRefresh(strapi);
  },

  afterUpdate({ result, params }) {
    scheduleRefresh(strapi);
  },

  afterDelete({ result, params }) {
    scheduleRefresh(strapi);
  },

  afterDeleteMany({ result }) {
    scheduleRefresh(strapi);
  },
};

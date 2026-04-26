'use strict';

/**
 * Custom routes for museum-object (geospatial endpoint)
 */

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/museum-objects/geospatial',
      handler: 'museum-object.geospatial',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/museum-objects/by-country',
      handler: 'museum-object.byCountry',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/museum-objects/by-inventory/:inventoryNo',
      handler: 'museum-object.byInventoryNumber',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/museum-objects/resolver-stats',
      handler: 'museum-object.resolverStats',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/museum-objects/resolver-stats/:institution',
      handler: 'museum-object.resolverDetail',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/museum-objects/pending-corrections',
      handler: 'museum-object.pendingCorrections',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'PATCH',
      path: '/museum-objects/:id/correct',
      handler: 'museum-object.applyCorrection',
      config: {
        policies: [],
        middlewares: [],
      },
    }
  ]
};

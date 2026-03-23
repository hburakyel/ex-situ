'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/museum-objects/geospatial',
      handler: 'museum-object.geospatial',
      config: { auth: false, policies: [], middlewares: [] },
    },
    {
      method: 'GET',
      path: '/museum-objects/by-country',
      handler: 'museum-object.byCountry',
      config: { auth: false, policies: [], middlewares: [] },
    },
  ],
};

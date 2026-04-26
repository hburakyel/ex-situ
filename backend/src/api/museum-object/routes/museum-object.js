'use strict';

const { createCoreRouter } = require('@strapi/strapi').factories;

module.exports = createCoreRouter('api::museum-object.museum-object', {
  config: {
    find:    { auth: false, policies: [], middlewares: [] },
    findOne: { auth: false, policies: [], middlewares: [] },
  },
});

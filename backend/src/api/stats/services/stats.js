'use strict';

/**
 * stats service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::stats.stats');

'use strict';

/**
 * museum-object router
 */

const { createCoreRouter } = require('@strapi/strapi').factories;

module.exports = createCoreRouter('api::museum-object.museum-object', {
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
	],
});

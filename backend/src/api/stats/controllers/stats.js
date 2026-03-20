'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController("api::stats.stats", ({ strapi }) => ({
  async find(ctx) {
    try {
      const knex = strapi.db.connection;
      const result = await knex("museum_objects")
        .select("country_en", "city_en", "institution_name")
        .count("* as total_objects")
        .groupBy("country_en", "city_en", "institution_name")
        .orderBy("total_objects", "desc");

      return ctx.send(result);
    } catch (error) {
      console.error("Error fetching stats:", error);
      return ctx.badRequest("Failed to retrieve stats.");
    }
  },
}));

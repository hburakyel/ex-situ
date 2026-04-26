'use strict';

/**
 * museum-object controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::museum-object.museum-object', ({ strapi }) => ({
  /**
   * Custom geospatial endpoint
   * GET /api/museum-objects/geospatial?zoom=5&minLon=-180&minLat=-90&maxLon=180&maxLat=90&institution=...
   */
  async geospatial(ctx) {
    try {
      // Parse query parameters
      const { zoom, minLon, minLat, maxLon, maxLat, institution, city, country } = ctx.query;

      // Validate zoom parameter
      const zoomLevel = parseInt(zoom);
      if (isNaN(zoomLevel) || zoomLevel < 0 || zoomLevel > 20) {
        return ctx.badRequest('Invalid zoom level. Must be between 0 and 20.');
      }

      // Parse bounding box (optional for zoom < 7)
      // SAFETY GATE: Validate and parseFloat bbox coordinates
      let bbox = null;
      if (minLon && minLat && maxLon && maxLat) {
        // First parse - ensure we always get numbers
        const parsedMinLon = parseFloat(minLon);
        const parsedMinLat = parseFloat(minLat);
        const parsedMaxLon = parseFloat(maxLon);
        const parsedMaxLat = parseFloat(maxLat);

        // Validate immediately after parsing
        if (
          !isFinite(parsedMinLon) || !isFinite(parsedMinLat) ||
          !isFinite(parsedMaxLon) || !isFinite(parsedMaxLat)
        ) {
          strapi.log.error(`Invalid bbox - non-numeric values: minLon=${minLon}, minLat=${minLat}, maxLon=${maxLon}, maxLat=${maxLat}`);
          return ctx.badRequest('Bounding box coordinates must be valid numbers.');
        }

        // Validate ranges
        if (
          parsedMinLon < -180 || parsedMinLon > 180 ||
          parsedMaxLon < -180 || parsedMaxLon > 180 ||
          parsedMinLat < -90 || parsedMinLat > 90 ||
          parsedMaxLat < -90 || parsedMaxLat > 90
        ) {
          strapi.log.error(`Invalid bbox - out of range: minLon=${parsedMinLon}, minLat=${parsedMinLat}, maxLon=${parsedMaxLon}, maxLat=${parsedMaxLat}`);
          return ctx.badRequest('Bounding box coordinates out of valid range (lon: -180 to 180, lat: -90 to 90).');
        }

        // Validate min < max
        if (parsedMinLon >= parsedMaxLon || parsedMinLat >= parsedMaxLat) {
          strapi.log.error(`Invalid bbox - min >= max: minLon=${parsedMinLon}, minLat=${parsedMinLat}, maxLon=${parsedMaxLon}, maxLat=${parsedMaxLat}`);
          return ctx.badRequest('Invalid bounding box: minimum values must be less than maximum values.');
        }

        bbox = {
          minLon: parsedMinLon,
          minLat: parsedMinLat,
          maxLon: parsedMaxLon,
          maxLat: parsedMaxLat
        };

        // Debug logging
        strapi.log.debug(`Controller validated bbox: ${JSON.stringify(bbox)}`);
      } else if (zoomLevel >= 10) {
        // Require bbox for high zoom levels
        strapi.log.error(`Missing bbox parameters at zoom ${zoomLevel}: minLon=${minLon}, minLat=${minLat}, maxLon=${maxLon}, maxLat=${maxLat}`);
        return ctx.badRequest('Bounding box (minLon, minLat, maxLon, maxLat) is required for zoom level 10+');
      }

      // Build filters object
      const filters = {};
      if (institution) {
        filters.institution = institution;
      }
      if (city) {
        filters.city = city;
      }
      if (country) {
        filters.country = country;
      }

      // Call service method
      const data = await strapi
        .service('api::museum-object.museum-object')
        .getGeospatialData(zoomLevel, bbox, filters);

      // Return response
      ctx.send({
        zoom: zoomLevel,
        bbox: bbox,
        filters: filters,
        ...data
      });

    } catch (error) {
      strapi.log.error('Geospatial endpoint error:', error.message);
      strapi.log.error('Stack trace:', error.stack);
      ctx.internalServerError('Geospatial query failed');
    }
  },

  /**
   * Fast PostGIS endpoint for fetching objects by country
   * GET /api/museum-objects/by-country?country=Turkey&site=Pergamon&institution=...&page=1&pageSize=60
   */
  async byCountry(ctx) {
    try {
      const { country, site, institution, page, pageSize } = ctx.query;

      if (!country) {
        return ctx.badRequest('country parameter is required');
      }

      const pageNum = parseInt(page) || 1;
      const size = Math.min(parseInt(pageSize) || 60, 200);

      const data = await strapi
        .service('api::museum-object.museum-object')
        .getObjectsByCountry(country, {
          site: site || null,
          institution: institution || null,
          page: pageNum,
          pageSize: size,
        });

      ctx.send(data);
    } catch (error) {
      strapi.log.error('byCountry endpoint error:', error.message);
      ctx.internalServerError('Query failed');
    }
  },

  /**
   * Fetch a single object by inventory number (exact match)
   * GET /api/museum-objects/by-inventory/:inventoryNo
   */
  async byInventoryNumber(ctx) {
    try {
      const { inventoryNo } = ctx.params;
      if (!inventoryNo) {
        return ctx.badRequest('inventoryNo parameter is required');
      }

      const data = await strapi
        .service('api::museum-object.museum-object')
        .getObjectByInventoryNumber(decodeURIComponent(inventoryNo));

      if (!data) {
        return ctx.notFound('Object not found');
      }

      ctx.send({ data });
    } catch (error) {
      strapi.log.error('byInventoryNumber endpoint error:', error.message);
      ctx.internalServerError('Query failed');
    }
  },

  /**
   * Resolver stats endpoint — returns per-institution aggregation for the resolver dashboard
   * GET /api/museum-objects/resolver-stats
   */
  async resolverStats(ctx) {
    try {
      const data = await strapi
        .service('api::museum-object.museum-object')
        .getResolverStats();

      ctx.send(data);
    } catch (error) {
      strapi.log.error('resolverStats endpoint error:', error.message);
      ctx.internalServerError('Resolver stats query failed');
    }
  },

  /**
   * Resolver detail endpoint — returns detailed stats for a single institution
   * GET /api/museum-objects/resolver-stats/:institution
   */
  async resolverDetail(ctx) {
    try {
      const { institution } = ctx.params;
      if (!institution) {
        return ctx.badRequest('institution parameter is required');
      }

      const data = await strapi
        .service('api::museum-object.museum-object')
        .getResolverDetail(decodeURIComponent(institution));

      ctx.send(data);
    } catch (error) {
      strapi.log.error('resolverDetail endpoint error:', error.message);
      ctx.internalServerError('Resolver detail query failed');
    }
  },

  async pendingCorrections(ctx) {
    try {
      const { institution, page, pageSize } = ctx.query;
      const pageNum = parseInt(page) || 1;
      const size = Math.min(parseInt(pageSize) || 50, 200);

      const data = await strapi
        .service('api::museum-object.museum-object')
        .getPendingCorrections({
          institution: institution || null,
          page: pageNum,
          pageSize: size,
        });

      ctx.send(data);
    } catch (error) {
      strapi.log.error('pendingCorrections endpoint error:', error.message);
      ctx.internalServerError('Query failed');
    }
  },

  async applyCorrection(ctx) {
    try {
      const id = parseInt(ctx.params.id);
      if (!id || id <= 0) {
        return ctx.badRequest('Invalid object id');
      }

      const body = ctx.request.body || {};
      const { country_en, city_en, manual_latitude, manual_longitude, geocoding_status, note } = body;

      if (!country_en && !city_en && manual_latitude === undefined && manual_longitude === undefined) {
        return ctx.badRequest('Provide at least one of: country_en, city_en, manual_latitude, manual_longitude');
      }

      if (manual_latitude !== undefined) {
        const lat = parseFloat(manual_latitude);
        if (!isFinite(lat) || lat < -90 || lat > 90) {
          return ctx.badRequest('manual_latitude must be between -90 and 90');
        }
      }
      if (manual_longitude !== undefined) {
        const lon = parseFloat(manual_longitude);
        if (!isFinite(lon) || lon < -180 || lon > 180) {
          return ctx.badRequest('manual_longitude must be between -180 and 180');
        }
      }

      const correctionData = {};
      if (country_en) correctionData.country_en = String(country_en).slice(0, 100);
      if (city_en) correctionData.city_en = String(city_en).slice(0, 200);
      if (manual_latitude !== undefined) correctionData.manual_latitude = parseFloat(manual_latitude);
      if (manual_longitude !== undefined) correctionData.manual_longitude = parseFloat(manual_longitude);
      if (geocoding_status) correctionData.geocoding_status = geocoding_status;
      if (note) correctionData.note = String(note).slice(0, 500);

      const updated = await strapi
        .service('api::museum-object.museum-object')
        .applyCorrection(id, correctionData);

      ctx.send({ success: true, data: updated });
    } catch (error) {
      strapi.log.error('applyCorrection endpoint error:', error.message);
      ctx.internalServerError('Correction failed');
    }
  }
}));

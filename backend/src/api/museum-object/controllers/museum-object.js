'use strict';

/**
 * museum-object controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

/**
 * Parse the Time (dateStart/dateEnd/undated) and Migration
 * (acqDateStart/acqDateEnd/acqUndated) query params shared by the
 * geospatial and by-country endpoints. Returns { filters } on success or
 * { error } with a message suitable for ctx.badRequest on invalid input.
 */
function parseDateQueryFilters(query) {
  const { dateStart, dateEnd, undated, acqDateStart, acqDateEnd, acqUndated } = query;
  const filters = {};

  if (undated === 'true' || undated === '1') {
    filters.undated = true;
  } else {
    if (dateStart !== undefined) {
      const parsed = parseInt(dateStart, 10);
      if (isNaN(parsed)) return { error: 'Invalid dateStart. Must be an integer year (negative for BCE).' };
      filters.dateStart = parsed;
    }
    if (dateEnd !== undefined) {
      const parsed = parseInt(dateEnd, 10);
      if (isNaN(parsed)) return { error: 'Invalid dateEnd. Must be an integer year (negative for BCE).' };
      filters.dateEnd = parsed;
    }
  }

  if (acqUndated === 'true' || acqUndated === '1') {
    filters.acqUndated = true;
  } else {
    if (acqDateStart !== undefined) {
      const parsed = parseInt(acqDateStart, 10);
      if (isNaN(parsed)) return { error: 'Invalid acqDateStart. Must be an integer year.' };
      filters.acqDateStart = parsed;
    }
    if (acqDateEnd !== undefined) {
      const parsed = parseInt(acqDateEnd, 10);
      if (isNaN(parsed)) return { error: 'Invalid acqDateEnd. Must be an integer year.' };
      filters.acqDateEnd = parsed;
    }
  }

  return { filters };
}

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
      const { filters: dateFilters, error: dateError } = parseDateQueryFilters(ctx.query);
      if (dateError) return ctx.badRequest(dateError);
      Object.assign(filters, dateFilters);

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
   * Per-bucket counts for the "Time" and "Migration" left-panel filters.
   * GET /api/museum-objects/date-buckets?institution=...&city=...&country=...
   */
  async dateBuckets(ctx) {
    try {
      const { institution, city, country } = ctx.query;
      const filters = {};
      if (institution) filters.institution = institution;
      if (city) filters.city = city;
      if (country) filters.country = country;

      const data = await strapi
        .service('api::museum-object.museum-object')
        .getDateBucketCounts(filters);

      ctx.send(data);
    } catch (error) {
      strapi.log.error('Date buckets endpoint error:', error.message);
      strapi.log.error('Stack trace:', error.stack);
      ctx.internalServerError('Date buckets query failed');
    }
  },

  /**
   * Decade-level counts within a single Time century bucket.
   * GET /api/museum-objects/date-buckets/decades?century=ce-19&institution=...
   */
  async dateBucketDecades(ctx) {
    try {
      const { century, institution, city, country } = ctx.query;
      if (!century) return ctx.badRequest('century parameter is required');

      const filters = {};
      if (institution) filters.institution = institution;
      if (city) filters.city = city;
      if (country) filters.country = country;

      const data = await strapi
        .service('api::museum-object.museum-object')
        .getDecadeBucketCounts(century, filters);

      ctx.send(data);
    } catch (error) {
      strapi.log.error('Date bucket decades endpoint error:', error.message);
      strapi.log.error('Stack trace:', error.stack);
      ctx.internalServerError('Date bucket decades query failed');
    }
  },

  /**
   * Fast PostGIS endpoint for fetching objects by country
   * GET /api/museum-objects/by-country?country=Turkey&site=Pergamon&institution=...&page=1&pageSize=60
   */
  async byCountry(ctx) {
    try {
      const { country, site, institution, page, pageSize, onlyWithImages } = ctx.query;

      if (!country && !institution) {
        return ctx.badRequest('country or institution parameter is required');
      }

      const pageNum = parseInt(page) || 1;
      const size = Math.min(parseInt(pageSize) || 60, 200);

      const { filters: dateFilters, error: dateError } = parseDateQueryFilters(ctx.query);
      if (dateError) return ctx.badRequest(dateError);

      const data = await strapi
        .service('api::museum-object.museum-object')
        .getObjectsByCountry(country || null, {
          site: site || null,
          institution: institution || null,
          page: pageNum,
          pageSize: size,
          onlyWithImages: onlyWithImages === 'true',
          ...dateFilters,
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

  /**
   * Phase 7: Data quality statistics per institution
   * GET /api/museum-objects/quality-stats
   */
  async qualityStats(ctx) {
    try {
      const data = await strapi
        .service('api::museum-object.museum-object')
        .getQualityStats();
      ctx.send(data);
    } catch (error) {
      strapi.log.error('qualityStats endpoint error:', error.message);
      ctx.internalServerError('Quality stats query failed');
    }
  },

  async applyCorrection(ctx) {    try {
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
  },

  /**
   * Autocomplete suggest endpoint
   * GET /api/museum-objects/suggest?q=benin&limit=8
   */
  async suggest(ctx) {
    try {
      const { q, limit } = ctx.query;
      if (!q || String(q).trim().length < 2) {
        return ctx.send({ data: [] });
      }
      const results = await strapi
        .service('api::museum-object.museum-object')
        .getSuggestions(q, limit);
      ctx.send({ data: results });
    } catch (error) {
      strapi.log.error('suggest endpoint error:', error.message);
      ctx.internalServerError('Suggest query failed');
    }
  },

  async refreshViews(ctx) {
    try {
      await strapi
        .service('api::museum-object.museum-object')
        .refreshGeospatialViews();
      ctx.send({ success: true, message: 'Materialized views refreshed' });
    } catch (error) {
      strapi.log.error('refreshViews endpoint error:', error.message);
      ctx.internalServerError('Refresh failed');
    }
  },

  async lookup(ctx) {
    try {
      const { place_name, institution } = ctx.query;
      if (!place_name) return ctx.badRequest('place_name is required');
      const data = await strapi
        .service('api::museum-object.museum-object')
        .lookupByPlaceName(String(place_name).slice(0, 255), institution ? String(institution).slice(0, 255) : null);
      ctx.send(data);
    } catch (error) {
      strapi.log.error('lookup endpoint error:', error.message);
      ctx.internalServerError('Query failed');
    }
  },

  async bulkGeocode(ctx) {
    try {
      const { place_name, institution_name, updates } = ctx.request.body || {};
      if (!place_name) return ctx.badRequest('place_name is required');
      if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
        return ctx.badRequest('updates must be an object');
      }
      const data = await strapi
        .service('api::museum-object.museum-object')
        .bulkGeocode(
          String(place_name).slice(0, 255),
          institution_name ? String(institution_name).slice(0, 255) : null,
          updates
        );
      ctx.send({ success: true, ...data });
    } catch (error) {
      strapi.log.error('bulkGeocode endpoint error:', error.message);
      if (error.message.startsWith('Invalid') || error.message === 'No fields to update') {
        return ctx.badRequest(error.message);
      }
      ctx.internalServerError('Bulk update failed');
    }
  },

  /**
   * Synonyms table endpoint — returns all alias→canonical mappings
   * GET /api/museum-objects/synonyms
   */
  async synonyms(ctx) {
    try {
      const results = await strapi
        .service('api::museum-object.museum-object')
        .getSynonyms();
      ctx.send({ data: results });
    } catch (error) {
      strapi.log.error('synonyms endpoint error:', error.message);
      ctx.internalServerError('Synonyms query failed');
    }
  },
}));

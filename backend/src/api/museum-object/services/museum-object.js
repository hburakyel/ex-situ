'use strict';

/**
 * museum-object service
 */

const { createCoreService } = require('@strapi/strapi').factories;

let manualCoordsCache = null;

async function hasManualCoords(db) {
  if (manualCoordsCache !== null) return manualCoordsCache;
  const [hasManualLat, hasManualLon] = await Promise.all([
    db.schema.hasColumn('museum_objects', 'manual_latitude'),
    db.schema.hasColumn('museum_objects', 'manual_longitude')
  ]);
  manualCoordsCache = Boolean(hasManualLat && hasManualLon);
  return manualCoordsCache;
}

module.exports = createCoreService('api::museum-object.museum-object', ({ strapi }) => ({
  /**
   * Build parameterized SQL filter clause for a field that supports comma-separated values.
   * Returns { clause: string, bindings: object } for safe use with Knex .raw().
   * @param {string} fieldName - SQL column name (must be a known column, never user input)
   * @param {string} filterValue - Filter value (can be comma-separated)
   * @param {string} bindingPrefix - Unique prefix for named bindings to avoid collisions
   * @returns {{ clause: string, bindings: object }}
   */
  buildMultiValueFilter(fieldName, filterValue, bindingPrefix) {
    if (!filterValue) return { clause: '', bindings: {} };

    const values = filterValue
      .split(',')
      .map(v => v.trim())
      .filter(v => v.length > 0)
      .slice(0, 50); // cap at 50 values to prevent abuse

    if (values.length === 0) return { clause: '', bindings: {} };

    const bindings = {};
    if (values.length === 1) {
      const key = `${bindingPrefix}_0`;
      bindings[key] = values[0];
      return { clause: `AND ${fieldName} = :${key} `, bindings };
    }
    const placeholders = values.map((v, i) => {
      const key = `${bindingPrefix}_${i}`;
      bindings[key] = v;
      return `:${key}`;
    });
    return { clause: `AND ${fieldName} IN (${placeholders.join(', ')}) `, bindings };
  },

  /**
   * Get geospatial data based on zoom level, bounding box, and optional filters
   * @param {number} zoom - Map zoom level
   * @param {object} bbox - Bounding box {minLon, minLat, maxLon, maxLat}
   * @param {object} filters - Optional filters {institution: string (comma-sep), city: string (comma-sep), country: string (comma-sep)}
   * @returns {Promise<object>} - Geospatial data with appropriate aggregation
   */
  async getGeospatialData(zoom, bbox, filters = {}) {
    const db = strapi.db.connection;

    // Zoom < 4: Return country-level statistics (pre-aggregated)
    if (zoom < 4) {
      return await this.getCountryStatistics(db, filters);
    }

    // Zoom 4-7: Return clustered data (city level)
    if (zoom >= 4 && zoom < 7) {
      return await this.getClusteredData(db, zoom, bbox, filters);
    }

    // Zoom 7+: Return individual objects within bbox
    return await this.getIndividualObjects(db, bbox, filters);
  },

  /**
   * Extract rows from raw query result (handles different Knex driver formats)
   */
  getRows(result) {
    // PostgreSQL driver returns { rows: [...] }
    if (result && result.rows) {
      return result.rows;
    }
    // Some drivers return the array directly
    if (Array.isArray(result)) {
      return result;
    }
    // Knex sometimes wraps in [0] for some drivers
    if (result && result[0] && Array.isArray(result[0])) {
      return result[0];
    }
    // Fallback
    return [];
  },

  /**
   * Get country-level statistics (zoom < 4)
   * Returns ONE arc per country → institution pair
   * Uses materialized view for instant response (<10ms vs 15s+)
   */
  async getCountryStatistics(db, filters = {}) {
    try {
      // Build filter clauses (now supporting multi-select via comma-separated values)
      const instFilter = this.buildMultiValueFilter('institution_name', filters.institution, 'cs_inst');
      const countryFilter = this.buildMultiValueFilter('origin_country', filters.country, 'cs_country');

      // Check if materialized view exists — fall back to raw query if not
      const mvExists = await this._materializedViewExists(db, 'mv_country_institution_stats');

      if (mvExists && !filters.city) {
        // ── Fast path: pre-aggregated materialized view ──
        const query = `
          SELECT *
          FROM mv_country_institution_stats
          WHERE 1=1
            ${instFilter.clause}
            ${countryFilter.clause}
          ORDER BY object_count DESC;
        `;
        const result = await db.raw(query, { ...instFilter.bindings, ...countryFilter.bindings });
        const rows = this.getRows(result);

        return {
          type: 'statistics',
          data: rows.map(row => ({
            place_name: row.origin_country,
            latitude: parseFloat(row.origin_lat) || 0,
            longitude: parseFloat(row.origin_lon) || 0,
            institution_name: row.institution_name,
            institution_place: row.institution_name,
            institution_latitude: parseFloat(row.inst_lat) || 0,
            institution_longitude: parseFloat(row.inst_lon) || 0,
            object_count: parseInt(row.object_count) || 0,
            sample_img_url: row.sample_img_url || null,
            type: 'arc',
            cluster_id: `arc_country_${row.origin_country}_${row.institution_name}`
          }))
        };
      }

      // ── Fallback: raw query (runs if MV not yet created) ──
      const hasManual = await hasManualCoords(db);
      const latExpr = hasManual ? 'COALESCE(manual_latitude, latitude)' : 'latitude';
      const lonExpr = hasManual ? 'COALESCE(manual_longitude, longitude)' : 'longitude';
      const latFilter = hasManual ? '(manual_latitude IS NOT NULL OR latitude IS NOT NULL)' : 'latitude IS NOT NULL';
      const lonFilter = hasManual ? '(manual_longitude IS NOT NULL OR longitude IS NOT NULL)' : 'longitude IS NOT NULL';

      const fallbackInstitutionFilter = this.buildMultiValueFilter('institution_name', filters.institution, 'fb_inst');
      const fallbackCityFilter = this.buildMultiValueFilter('city_en', filters.city, 'fb_city');
      const fallbackCountryFilter = this.buildMultiValueFilter('country_en', filters.country, 'fb_country');

      const query = `
        WITH country_groups AS (
          SELECT
            COALESCE(NULLIF(country_en, ''), 'Unknown') as origin_country,
            AVG(${latExpr}) as origin_lat,
            AVG(${lonExpr}) as origin_lon,
            institution_name,
            AVG(institution_latitude) as inst_lat,
            AVG(institution_longitude) as inst_lon,
            COUNT(*)::integer as object_count,
            MIN(img_url) as sample_img_url
          FROM museum_objects
          WHERE published_at IS NOT NULL
            AND ${latFilter}
            AND ${lonFilter}
            AND institution_latitude IS NOT NULL
            AND institution_longitude IS NOT NULL
            AND country_en IS NOT NULL
            AND country_en != ''
            AND institution_name IS NOT NULL
            ${fallbackInstitutionFilter.clause}
            ${fallbackCityFilter.clause}
            ${fallbackCountryFilter.clause}
          GROUP BY 
            COALESCE(NULLIF(country_en, ''), 'Unknown'),
            institution_name
          HAVING COUNT(*) >= 1
        )
        SELECT * FROM country_groups
        ORDER BY object_count DESC;
      `;

      const result = await db.raw(query, {
        ...fallbackInstitutionFilter.bindings,
        ...fallbackCityFilter.bindings,
        ...fallbackCountryFilter.bindings,
      });
      const rows = this.getRows(result);

      return {
        type: 'statistics',
        data: rows.map(row => ({
          place_name: row.origin_country,
          latitude: parseFloat(row.origin_lat) || 0,
          longitude: parseFloat(row.origin_lon) || 0,
          institution_name: row.institution_name,
          institution_place: row.institution_name,
          institution_latitude: parseFloat(row.inst_lat) || 0,
          institution_longitude: parseFloat(row.inst_lon) || 0,
          object_count: parseInt(row.object_count) || 0,
          sample_img_url: row.sample_img_url || null,
          type: 'arc',
          cluster_id: `arc_country_${row.origin_country}_${row.institution_name}`
        }))
      };
    } catch (error) {
      strapi.log.error('Error in getCountryStatistics:', error);
      throw error;
    }
  },

  /**
   * Get city-level clustered data (zoom 4-7)
   * Returns ONE arc per city → institution pair
   * Uses materialized view when available for instant response.
   */
  async getClusteredData(db, zoom, bbox, filters = {}) {
    try {
      // Default bbox if not provided (global view)
      const minLat = Number(bbox?.minLat) || -90;
      const maxLat = Number(bbox?.maxLat) || 90;
      const minLon = Number(bbox?.minLon) || -180;
      const maxLon = Number(bbox?.maxLon) || 180;

      // Build filter clauses
      const institutionFilter = this.buildMultiValueFilter('institution_name', filters.institution, 'cl_inst');
      const cityFilter = this.buildMultiValueFilter('origin_city', filters.city, 'cl_city');
      const countryFilter = this.buildMultiValueFilter('country_en', filters.country, 'cl_country');

      strapi.log.info(`getClusteredData: zoom=${zoom}, bbox=[${minLat},${maxLat},${minLon},${maxLon}]`);

      const mvExists = await this._materializedViewExists(db, 'mv_city_institution_stats');

      let rows;

      if (mvExists) {
        // ── Fast path: materialized view with bbox filter on pre-computed coords ──
        const query = `
          SELECT
            origin_city, country_en, origin_lat, origin_lon,
            institution_name, inst_lat, inst_lon,
            object_count, sample_img_url
          FROM mv_city_institution_stats
          WHERE origin_lat BETWEEN :minLat AND :maxLat
            AND origin_lon BETWEEN :minLon AND :maxLon
            ${institutionFilter.clause}
            ${cityFilter.clause}
            ${countryFilter.clause}
          ORDER BY object_count DESC
          LIMIT 1000;
        `;
        const result = await db.raw(query, {
          minLat, maxLat, minLon, maxLon,
          ...institutionFilter.bindings,
          ...cityFilter.bindings,
          ...countryFilter.bindings,
        });
        rows = this.getRows(result);
      } else {
        // ── Fallback: raw query when MV not yet created ──
        const hasManual = await hasManualCoords(db);
        const latExpr = hasManual ? 'COALESCE(manual_latitude, latitude)' : 'latitude';
        const lonExpr = hasManual ? 'COALESCE(manual_longitude, longitude)' : 'longitude';
        const latFilter = hasManual ? '(manual_latitude IS NOT NULL OR latitude IS NOT NULL)' : 'latitude IS NOT NULL';
        const lonFilter = hasManual ? '(manual_longitude IS NOT NULL OR longitude IS NOT NULL)' : 'longitude IS NOT NULL';

        const fbInstitutionFilter = this.buildMultiValueFilter('institution_name', filters.institution, 'cfb_inst');
        const fbCityFilter = this.buildMultiValueFilter('city_en', filters.city, 'cfb_city');
        const fbCountryFilter = this.buildMultiValueFilter('country_en', filters.country, 'cfb_country');

        const query = `
          WITH bbox_filter AS (
            SELECT
              ${latExpr} as latitude,
              ${lonExpr} as longitude,
              city_en,
              country_en,
              institution_name,
              institution_latitude,
              institution_longitude,
              img_url
            FROM museum_objects
            WHERE published_at IS NOT NULL
              AND ${latFilter}
              AND ${lonFilter}
              AND institution_latitude IS NOT NULL
              AND institution_longitude IS NOT NULL
              AND ${latExpr} BETWEEN :minLat AND :maxLat
              AND ${lonExpr} BETWEEN :minLon AND :maxLon
              ${fbInstitutionFilter.clause}
              ${fbCityFilter.clause}
              ${fbCountryFilter.clause}
          ),
          city_aggregations AS (
            SELECT
              COALESCE(NULLIF(city_en, ''), COALESCE(NULLIF(country_en, ''), 'Unknown')) as origin_city,
              country_en,
              AVG(latitude) as origin_lat,
              AVG(longitude) as origin_lon,
              institution_name,
              AVG(institution_latitude) as inst_lat,
              AVG(institution_longitude) as inst_lon,
              COUNT(*)::integer as object_count,
              MIN(img_url) as sample_img_url
            FROM bbox_filter
            GROUP BY 
              COALESCE(NULLIF(city_en, ''), COALESCE(NULLIF(country_en, ''), 'Unknown')),
              country_en,
              institution_name
          )
          SELECT * FROM city_aggregations
          ORDER BY object_count DESC
          LIMIT 1000;
        `;
        const result = await db.raw(query, {
          minLat, maxLat, minLon, maxLon,
          ...fbInstitutionFilter.bindings,
          ...fbCityFilter.bindings,
          ...fbCountryFilter.bindings,
        });
        rows = this.getRows(result);
      }

      return {
        type: 'clusters',
        data: rows.map(row => ({
          place_name: row.origin_city,
          country: row.country_en || null,
          latitude: parseFloat(row.origin_lat) || 0,
          longitude: parseFloat(row.origin_lon) || 0,
          institution_name: row.institution_name,
          institution_place: row.institution_name,
          institution_latitude: parseFloat(row.inst_lat) || 0,
          institution_longitude: parseFloat(row.inst_lon) || 0,
          object_count: parseInt(row.object_count) || 0,
          sample_img_url: row.sample_img_url || null,
          type: 'arc',
          cluster_id: `arc_city_${row.origin_city}_${row.institution_name}`
        }))
      };
    } catch (error) {
      strapi.log.error('Error in getClusteredData:', error);
      throw error;
    }
  },

  /**
   * Get individual objects (zoom 7+)
   */
  async getIndividualObjects(db, bbox, filters = {}) {
    try {
      const hasManual = await hasManualCoords(db);
      const latExpr = hasManual ? 'COALESCE(manual_latitude, latitude)' : 'latitude';
      const lonExpr = hasManual ? 'COALESCE(manual_longitude, longitude)' : 'longitude';
      const latFilter = hasManual ? '(manual_latitude IS NOT NULL OR latitude IS NOT NULL)' : 'latitude IS NOT NULL';
      const lonFilter = hasManual ? '(manual_longitude IS NOT NULL OR longitude IS NOT NULL)' : 'longitude IS NOT NULL';
      const manualSelect = hasManual
        ? 'manual_latitude, manual_longitude'
        : 'NULL::float as manual_latitude, NULL::float as manual_longitude';
      if (!bbox) {
        throw new Error('Bounding box is required for individual object queries at zoom level 10+');
      }

      const minLat = Number(bbox.minLat);
      const maxLat = Number(bbox.maxLat);
      const minLon = Number(bbox.minLon);
      const maxLon = Number(bbox.maxLon);

      // Validate bbox coordinates
      if (isNaN(minLat) || isNaN(maxLat) || isNaN(minLon) || isNaN(maxLon)) {
        throw new Error(`Invalid bbox coordinates: minLat=${minLat}, maxLat=${maxLat}, minLon=${minLon}, maxLon=${maxLon}`);
      }

      // Build filter clauses (now supporting multi-select via comma-separated values)
      const institutionFilter = this.buildMultiValueFilter('institution_name', filters.institution, 'io_inst');
      const cityFilter = this.buildMultiValueFilter('city_en', filters.city, 'io_city');
      const countryFilter = this.buildMultiValueFilter('country_en', filters.country, 'io_country');

      strapi.log.info(`getIndividualObjects: bbox=[${minLat},${maxLat},${minLon},${maxLon}], institution=${filters.institution || 'all'}, city=${filters.city || 'all'}, country=${filters.country || 'all'}`);

      // SAFETY GATE: Use Named Bindings to ensure query always sees 4 bindings
      const query = `
        SELECT
          id,
          object_id,
          title,
          img_url,
          ${latExpr} as resolved_latitude,
          ${lonExpr} as resolved_longitude,
          institution_place,
          institution_name,
          place_name,
          source_link,
          inventory_number,
          institution_latitude,
          institution_longitude,
          country_en,
          city_en,
          ${manualSelect},
          (SELECT ol.link_text FROM museum_objects_components moc
           JOIN components_object_links_object_link_infos ol ON ol.id = moc.component_id
           WHERE moc.entity_id = museum_objects.id AND moc.field = 'object_links'
           ORDER BY moc."order" LIMIT 1) as object_link_url,
          (SELECT ol.link_display FROM museum_objects_components moc
           JOIN components_object_links_object_link_infos ol ON ol.id = moc.component_id
           WHERE moc.entity_id = museum_objects.id AND moc.field = 'object_links'
           ORDER BY moc."order" LIMIT 1) as object_link_display
        FROM museum_objects
        WHERE published_at IS NOT NULL
          AND ${latFilter}
          AND ${lonFilter}
          AND ${latExpr} BETWEEN :minLat AND :maxLat
          AND ${lonExpr} BETWEEN :minLon AND :maxLon
          ${institutionFilter.clause}
          ${cityFilter.clause}
          ${countryFilter.clause}
        ORDER BY object_id
        LIMIT 5000;
      `;

      // Create named bindings object
      const bindings = {
        minLat, maxLat, minLon, maxLon,
        ...institutionFilter.bindings,
        ...cityFilter.bindings,
        ...countryFilter.bindings,
      };
      
      // Debug logging
      strapi.log.debug('SQL Query:', query);
      strapi.log.debug('Named Bindings:', JSON.stringify(bindings));
      
      const result = await db.raw(query, bindings);

      const rows = this.getRows(result);

      return {
        type: 'objects',
        count: rows.length,
        data: rows.map(row => ({
          id: row.id,
          object_id: row.object_id,
          title: row.title,
          img_url: row.img_url,
          latitude: row.resolved_latitude ? parseFloat(row.resolved_latitude) : 0,
          longitude: row.resolved_longitude ? parseFloat(row.resolved_longitude) : 0,
          institution_place: row.institution_place || 'Unknown',
          institution_name: row.institution_name || 'Unmapped',
          place_name: row.place_name,
          source_link: row.object_link_url || row.source_link,
          inventory_number: row.inventory_number,
          institution_latitude: row.institution_latitude ? parseFloat(row.institution_latitude) : null,
          institution_longitude: row.institution_longitude ? parseFloat(row.institution_longitude) : null,
          country_en: row.country_en || null,
          city_en: row.city_en || null,
          manual_latitude: row.manual_latitude ? parseFloat(row.manual_latitude) : null,
          manual_longitude: row.manual_longitude ? parseFloat(row.manual_longitude) : null,
          object_links: row.object_link_url ? [{ link_text: row.object_link_url, link_display: row.object_link_display }] : null,
          type: 'object',
          cluster_id: `object_${row.object_id}`
        }))
      };
    } catch (error) {
      strapi.log.error('Error in getIndividualObjects:', error);
      throw error;
    }
  },

  /**
   * Calculate grid size based on zoom level
   * Smaller values = smaller grid cells = more clusters
   */
  calculateGridSize(zoom) {
    const gridSizes = {
      5: 2.0,    // ~220km grid cells
      6: 1.0,    // ~110km
      7: 0.5,    // ~55km
      8: 0.25,   // ~28km
      9: 0.1     // ~11km
    };

    return gridSizes[zoom] || 0.1;
  },

  /**
   * Get objects by country with optional site/institution filters
   * Uses direct PostGIS SQL for speed — bypasses Strapi's slow _q search
   * @param {string} country - Country name (matched against country_en)
   * @param {object} options - { site, institution, page, pageSize }
   * @returns {Promise<object>} - { data: [...], meta: { pagination: {...} } }
   */
  async getObjectsByCountry(country, options = {}) {
    const db = strapi.db.connection;
    const { site, institution, page = 1, pageSize = 60 } = options;
    const offset = (page - 1) * pageSize;

    try {
      const hasManual = await hasManualCoords(db);
      const latExpr = hasManual ? 'COALESCE(manual_latitude, latitude)' : 'latitude';
      const lonExpr = hasManual ? 'COALESCE(manual_longitude, longitude)' : 'longitude';
      // Build WHERE clauses with parameterized queries for safety
      // Match country_en OR place_name so that arc-click works at every zoom level.
      // At country level the arc passes a country name (matches country_en),
      // at city/object level it passes a place_name (may differ from country_en).
      let whereClause = `WHERE published_at IS NOT NULL AND (country_en ILIKE :country OR place_name ILIKE :country)`;
      const bindings = { country: `%${country}%` };

      if (site) {
        whereClause += ` AND (city_en ILIKE :site OR place_name ILIKE :site)`;
        bindings.site = `%${site}%`;
      }

      if (institution) {
        whereClause += ` AND institution_name ILIKE :institution`;
        bindings.institution = `%${institution}%`;
      }

      // Count query (fast with index)
      const countQuery = `SELECT COUNT(*)::integer as total FROM museum_objects ${whereClause}`;
      const countResult = await db.raw(countQuery, bindings);
      const total = this.getRows(countResult)[0]?.total || 0;

      // Data query — only the fields needed for the research grid
      const dataQuery = `
        SELECT
          id,
          object_id,
          title,
          img_url,
          place_name,
          city_en,
          country_en,
          institution_name,
          institution_place,
          inventory_number,
          source_link,
          ${latExpr} as latitude,
          ${lonExpr} as longitude,
          institution_latitude,
          institution_longitude,
          (SELECT ol.link_text FROM museum_objects_components moc
           JOIN components_object_links_object_link_infos ol ON ol.id = moc.component_id
           WHERE moc.entity_id = museum_objects.id AND moc.field = 'object_links'
           ORDER BY moc."order" LIMIT 1) as object_link_url,
          (SELECT ol.link_display FROM museum_objects_components moc
           JOIN components_object_links_object_link_infos ol ON ol.id = moc.component_id
           WHERE moc.entity_id = museum_objects.id AND moc.field = 'object_links'
           ORDER BY moc."order" LIMIT 1) as object_link_display
        FROM museum_objects
        ${whereClause}
        ORDER BY id DESC
        LIMIT :limit OFFSET :offset
      `;

      const dataResult = await db.raw(dataQuery, {
        ...bindings,
        limit: pageSize,
        offset: offset,
      });
      const rows = this.getRows(dataResult);

      const pageCount = Math.ceil(total / pageSize);

      return {
        data: rows.map(row => ({
          id: row.id,
          attributes: {
            object_id: row.object_id,
            title: row.title,
            img_url: row.img_url,
            place_name: row.place_name,
            city_en: row.city_en,
            country_en: row.country_en,
            country: row.country_en,
            institution_name: row.institution_name,
            institution_place: row.institution_place,
            inventory_number: row.inventory_number,
            source_link: row.object_link_url || row.source_link,
            object_links: row.object_link_url ? [{ link_text: row.object_link_url, link_display: row.object_link_display }] : null,
            latitude: row.latitude ? parseFloat(row.latitude) : null,
            longitude: row.longitude ? parseFloat(row.longitude) : null,
            institution_latitude: row.institution_latitude ? parseFloat(row.institution_latitude) : null,
            institution_longitude: row.institution_longitude ? parseFloat(row.institution_longitude) : null,
          }
        })),
        meta: {
          pagination: {
            page: page,
            pageSize: pageSize,
            pageCount: pageCount,
            total: total,
          }
        }
      };
    } catch (error) {
      strapi.log.error('Error in getObjectsByCountry:', error);
      throw error;
    }
  },

  /**
   * Check if a materialized view exists in the database.
   * Cached after first check to avoid repeated pg_matviews queries.
   */
  _mvExistsCache: {},
  async _materializedViewExists(db, viewName) {
    if (this._mvExistsCache[viewName] !== undefined) {
      return this._mvExistsCache[viewName];
    }
    try {
      const result = await db.raw(
        `SELECT EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = ?) AS exists`,
        [viewName]
      );
      const rows = this.getRows(result);
      const exists = rows[0]?.exists === true;
      this._mvExistsCache[viewName] = exists;
      return exists;
    } catch {
      return false;
    }
  },

  /**
   * Refresh all geospatial materialized views.
   * Call after data imports.
   */
  async refreshGeospatialViews() {
    const db = strapi.db.connection;
    try {
      await db.raw('SELECT refresh_geospatial_views()');
      // Invalidate cache so next check re-queries
      this._mvExistsCache = {};
      strapi.log.info('Geospatial materialized views refreshed successfully');
    } catch (error) {
      strapi.log.error('Error refreshing geospatial views:', error);
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Resolver Dashboard endpoints
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get aggregated stats per institution for the resolver dashboard.
   * Returns object counts, geocoding quality stats, origin type breakdown, etc.
   * Note: columns like geocoding_confidence, geocoder_source, geocoding_status,
   * review_status, origin_type, enrichment_confidence do not exist in the DB yet;
   * we return sensible defaults (0 / null) for those fields to keep the API shape
   * stable for the frontend.
   */
  async getResolverStats() {
    const db = strapi.db.connection;
    try {
      // Main per-institution aggregation (only existing columns)
      const query = `
        SELECT
          institution_name,
          institution_place,
          institution_latitude,
          institution_longitude,
          COUNT(*)::integer AS total_objects,
          COUNT(CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN 1 END)::integer AS geocoded_count,
          ROUND(
            COUNT(CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN 1 END)::numeric
            / NULLIF(COUNT(*), 0) * 100, 1
          ) AS resolved_pct,
          COUNT(DISTINCT country_en)::integer AS distinct_countries,
          MIN(img_url) AS sample_img_url
        FROM museum_objects
        WHERE published_at IS NOT NULL
          AND institution_name IS NOT NULL
          AND institution_name != ''
        GROUP BY institution_name, institution_place, institution_latitude, institution_longitude
        ORDER BY total_objects DESC;
      `;

      const result = await db.raw(query);
      const rows = this.getRows(result);

      // Global totals
      const totalsQuery = `
        SELECT
          COUNT(*)::integer AS total_objects,
          COUNT(CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN 1 END)::integer AS total_geocoded,
          COUNT(DISTINCT institution_name)::integer AS total_institutions,
          COUNT(DISTINCT country_en)::integer AS total_countries
        FROM museum_objects
        WHERE published_at IS NOT NULL;
      `;
      const totalsResult = await db.raw(totalsQuery);
      const totals = this.getRows(totalsResult)[0] || {};

      // Compute a simple "confidence" proxy: geocoded_pct / 100
      const totalObj = parseInt(totals.total_objects) || 1;
      const totalGeo = parseInt(totals.total_geocoded) || 0;
      const globalConf = Math.round((totalGeo / totalObj) * 100) / 100;

      return {
        totals: {
          totalObjects: parseInt(totals.total_objects) || 0,
          totalGeocoded: parseInt(totals.total_geocoded) || 0,
          totalInstitutions: parseInt(totals.total_institutions) || 0,
          totalCountries: parseInt(totals.total_countries) || 0,
          globalAvgConfidence: globalConf,
        },
        institutions: rows.map(row => {
          const total = parseInt(row.total_objects) || 0;
          const geocoded = parseInt(row.geocoded_count) || 0;
          const conf = total > 0 ? Math.round((geocoded / total) * 100) / 100 : 0;
          return {
            name: row.institution_name,
            place: row.institution_place || '',
            latitude: parseFloat(row.institution_latitude) || 0,
            longitude: parseFloat(row.institution_longitude) || 0,
            totalObjects: total,
            geocodedCount: geocoded,
            resolvedPct: parseFloat(row.resolved_pct) || 0,
            avgConfidence: conf,
            geocoderSource: {
              postgis: 0,
              nominatim: geocoded,
            },
            geocodingStatus: {
              ok: geocoded,
              ambiguous: 0,
              disputed: 0,
            },
            reviewStatus: {
              pending: total,
              verified: 0,
              rejected: 0,
            },
            originTypes: {
              valid: geocoded,
              historical: 0,
              cultural: 0,
              micro: 0,
              invalid: total - geocoded,
            },
            enrichedCount: 0,
            distinctCountries: parseInt(row.distinct_countries) || 0,
            sampleImgUrl: row.sample_img_url || null,
          };
        }),
      };
    } catch (error) {
      strapi.log.error('Error in getResolverStats:', error);
      throw error;
    }
  },

  /**
   * Get detailed stats for a single institution/resolver.
   * Includes recent objects, origin breakdown, geocoding quality distribution, etc.
   */
  async getResolverDetail(institutionName) {
    const db = strapi.db.connection;
    try {
      // Top origin countries — parameterized
      const countriesQuery = `
        SELECT
          COALESCE(NULLIF(country_en, ''), 'Unknown') AS country,
          COUNT(*)::integer AS count
        FROM museum_objects
        WHERE published_at IS NOT NULL
          AND institution_name = :institutionName
        GROUP BY COALESCE(NULLIF(country_en, ''), 'Unknown')
        ORDER BY count DESC
        LIMIT 20;
      `;

      // Recently updated objects — parameterized
      const recentQuery = `
        SELECT id, title, latitude, longitude, country_en, city_en,
               img_url, place_name, source_link, updated_at,
               (SELECT ol.link_text FROM museum_objects_components moc
                JOIN components_object_links_object_link_infos ol ON ol.id = moc.component_id
                WHERE moc.entity_id = museum_objects.id AND moc.field = 'object_links'
                ORDER BY moc."order" LIMIT 1) as object_link_url
        FROM museum_objects
        WHERE published_at IS NOT NULL
          AND institution_name = :institutionName
        ORDER BY updated_at DESC
        LIMIT 10;
      `;

      // Confidence distribution — parameterized
      const confidenceQuery = `
        SELECT
          CASE
            WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN '0.9-1.0'
            ELSE 'none'
          END AS bucket,
          COUNT(*)::integer AS count
        FROM museum_objects
        WHERE published_at IS NOT NULL
          AND institution_name = :institutionName
        GROUP BY bucket
        ORDER BY bucket DESC;
      `;

      const queryBindings = { institutionName };
      const [countriesResult, recentResult, confidenceResult] = await Promise.all([
        db.raw(countriesQuery, queryBindings),
        db.raw(recentQuery, queryBindings),
        db.raw(confidenceQuery, queryBindings),
      ]);

      return {
        institution: institutionName,
        topCountries: this.getRows(countriesResult).map(r => ({
          country: r.country,
          count: parseInt(r.count) || 0,
          avgConfidence: 0,
        })),
        recentObjects: this.getRows(recentResult).map(r => {
          const hasCoords = r.latitude != null && r.longitude != null;
          return {
            id: r.id,
            title: r.title,
            latitude: parseFloat(r.latitude) || null,
            longitude: parseFloat(r.longitude) || null,
            country: r.country_en,
            city: r.city_en,
            confidence: hasCoords ? 1.0 : null,
            status: hasCoords ? 'ok' : null,
            reviewStatus: null,
            originType: null,
            imgUrl: r.img_url,
            placeName: r.place_name,
            sourceLink: r.object_link_url || r.source_link,
            updatedAt: r.updated_at,
          };
        }),
        confidenceDistribution: this.getRows(confidenceResult).map(r => ({
          bucket: r.bucket,
          count: parseInt(r.count) || 0,
        })),
      };
    } catch (error) {
      strapi.log.error('Error in getResolverDetail:', error);
      throw error;
    }
  },

  async getPendingCorrections(options = {}) {
    const db = strapi.db.connection;
    const { institution, page = 1, pageSize = 50 } = options;
    const offset = (page - 1) * pageSize;
    try {
      let whereClause = `WHERE published_at IS NOT NULL AND review_status = 'pending'`;
      const countBindings = {};
      const dataBindings = { limit: parseInt(pageSize), offset: parseInt(offset) };

      if (institution) {
        whereClause += ` AND institution_name = :institution`;
        countBindings.institution = institution;
        dataBindings.institution = institution;
      }

      const countQuery = `SELECT COUNT(*)::integer AS total FROM museum_objects ${whereClause}`;
      const countResult = await db.raw(countQuery, countBindings);
      const total = this.getRows(countResult)[0]?.total || 0;

      const dataQuery = `
        SELECT
          id, object_id, title, img_url,
          place_name, country_en, city_en,
          latitude, longitude,
          manual_latitude, manual_longitude,
          geocoding_confidence, geocoding_status, geocoding_notes,
          review_status, institution_name
        FROM museum_objects
        ${whereClause}
        ORDER BY COALESCE(geocoding_confidence, -1) ASC, id ASC
        LIMIT :limit OFFSET :offset
      `;
      const dataResult = await db.raw(dataQuery, dataBindings);
      const rows = this.getRows(dataResult);

      return {
        data: rows.map(row => ({
          id: row.id,
          objectId: row.object_id,
          title: row.title,
          imgUrl: row.img_url,
          placeName: row.place_name,
          countryEn: row.country_en,
          cityEn: row.city_en,
          latitude: row.latitude != null ? parseFloat(row.latitude) : null,
          longitude: row.longitude != null ? parseFloat(row.longitude) : null,
          manualLatitude: row.manual_latitude != null ? parseFloat(row.manual_latitude) : null,
          manualLongitude: row.manual_longitude != null ? parseFloat(row.manual_longitude) : null,
          geocodingConfidence: row.geocoding_confidence != null ? parseFloat(row.geocoding_confidence) : null,
          geocodingStatus: row.geocoding_status,
          geocodingNotes: row.geocoding_notes,
          reviewStatus: row.review_status,
          institutionName: row.institution_name,
        })),
        meta: {
          pagination: {
            page: parseInt(page),
            pageSize: parseInt(pageSize),
            total,
            pageCount: Math.ceil(total / pageSize) || 1,
          },
        },
      };
    } catch (error) {
      strapi.log.error('Error in getPendingCorrections:', error);
      throw error;
    }
  },

  async applyCorrection(id, correctionData) {
    const db = strapi.db.connection;
    const { country_en, city_en, manual_latitude, manual_longitude, geocoding_status, note } = correctionData;
    try {
      const setClauses = [];
      const bindings = { id };

      if (country_en !== undefined) {
        setClauses.push('country_en = :country_en');
        bindings.country_en = country_en;
      }
      if (city_en !== undefined) {
        setClauses.push('city_en = :city_en');
        bindings.city_en = city_en;
      }
      if (manual_latitude !== undefined) {
        setClauses.push('manual_latitude = :manual_latitude');
        bindings.manual_latitude = manual_latitude;
      }
      if (manual_longitude !== undefined) {
        setClauses.push('manual_longitude = :manual_longitude');
        bindings.manual_longitude = manual_longitude;
      }

      const allowedStatuses = ['ok', 'ambiguous', 'disputed'];
      const safeStatus = allowedStatuses.includes(geocoding_status) ? geocoding_status : 'ok';
      setClauses.push('geocoding_status = :geocoding_status');
      bindings.geocoding_status = safeStatus;

      setClauses.push(`review_status = 'verified'`);
      setClauses.push('updated_at = NOW()');

      if (note) {
        setClauses.push(`geocoding_notes = CASE WHEN geocoding_notes IS NULL OR geocoding_notes = '' THEN :note ELSE geocoding_notes || chr(10) || :note END`);
        bindings.note = note;
      }

      const query = `
        UPDATE museum_objects
        SET ${setClauses.join(', ')}
        WHERE id = :id AND published_at IS NOT NULL
        RETURNING id, object_id, title, country_en, city_en,
                  manual_latitude, manual_longitude,
                  geocoding_status, review_status, geocoding_notes
      `;

      const result = await db.raw(query, bindings);
      const rows = this.getRows(result);
      if (rows.length === 0) {
        throw new Error(`Object with id=${id} not found or not published`);
      }

      await this.refreshGeospatialViews();

      strapi.log.info(`Correction applied: id=${id} country=${country_en} city=${city_en} lat=${manual_latitude} lon=${manual_longitude}`);
      return rows[0];
    } catch (error) {
      strapi.log.error('Error in applyCorrection:', error);
      throw error;
    }
  },
}));

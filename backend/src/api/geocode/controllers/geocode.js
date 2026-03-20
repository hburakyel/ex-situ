'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::geocode.geocode', ({ strapi }) => ({
  async find(ctx) {
    const { q, lng, lat, limit = '5' } = ctx.query;
    const db = strapi.db.connection;

    // ── Reverse geocoding (lng + lat → nearest place name) ────────────────
    if (lng != null && lat != null) {
      try {
        const result = await db.raw(
          `SELECT
             name,
             COALESCE(name_en, name) AS name_en,
             place_type,
             country_code,
             country_name,
             region_name,
             ST_X(geom::geometry) AS longitude,
             ST_Y(geom::geometry) AS latitude
           FROM gazetteer_places
           WHERE geom IS NOT NULL
           ORDER BY geom <-> ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography
           LIMIT 1`,
          [parseFloat(lng), parseFloat(lat)]
        );

        const rows = result.rows || (Array.isArray(result) ? result[0] : []);
        if (!rows || !rows.length) return ctx.send({ features: [] });

        const row = rows[0];
        const displayName = row.name_en || row.name;
        return ctx.send({
          features: [{
            place_name: [displayName, row.country_name].filter(Boolean).join(', '),
            text: displayName,
            center: [parseFloat(row.longitude), parseFloat(row.latitude)],
            place_type: [row.place_type || 'place'],
            bbox: null,
            context: [],
          }],
        });
      } catch (err) {
        strapi.log.error('[geocode] Reverse geocode failed:', err.message);
        return ctx.send({ features: [] });
      }
    }

    // ── Forward geocoding ─────────────────────────────────────────────────
    if (!q || !q.trim()) {
      return ctx.badRequest('Missing required parameter: q');
    }

    const limitNum = Math.min(parseInt(limit, 10) || 5, 10);

    try {
      // Primary: use the geocode_place() function (similarity threshold ~0.3)
      const result = await db.raw(
        'SELECT * FROM geocode_place(?, NULL, ?)',
        [q.trim(), limitNum]
      );
      let rows = result.rows || (Array.isArray(result) ? result[0] : []);

      // Fallback: looser threshold + ILIKE if no results
      if (!rows || rows.length === 0) {
        const fallback = await db.raw(
          `SELECT
             NULL::int        AS place_id,
             name,
             COALESCE(name_en, name) AS name_en,
             place_type,
             country_code,
             country_name,
             region_name,
             ST_Y(geom::geometry) AS latitude,
             ST_X(geom::geometry) AS longitude,
             GREATEST(
               similarity(name, ?),
               similarity(COALESCE(name_en, ''), ?)
             )                AS confidence,
             'trigram_loose'  AS match_type
           FROM gazetteer_places
           WHERE similarity(name, ?) > 0.15
              OR similarity(COALESCE(name_en, ''), ?) > 0.15
              OR name    ILIKE ?
              OR name_en ILIKE ?
           ORDER BY confidence DESC
           LIMIT ?`,
          [
            q.trim(), q.trim(),
            q.trim(), q.trim(),
            `%${q.trim()}%`, `%${q.trim()}%`,
            limitNum,
          ]
        );
        rows = fallback.rows || (Array.isArray(fallback) ? fallback[0] : []);
      }

      if (!rows || rows.length === 0) return ctx.send({ features: [] });

      const features = rows.map(row => {
        const displayName = row.name_en || row.name;
        const parts = [displayName, row.region_name, row.country_name].filter(Boolean);
        return {
          place_name: parts.join(', '),
          text: displayName,
          center: [parseFloat(row.longitude), parseFloat(row.latitude)],
          place_type: [row.place_type || 'place'],
          bbox: null,
          context: row.country_name
            ? [{ id: `country.${row.country_code || ''}`, text: row.country_name }]
            : [],
          confidence: row.confidence,
        };
      });

      return ctx.send({ features });
    } catch (err) {
      strapi.log.error('[geocode] Forward geocode failed:', err.message);
      return ctx.internalServerError('Geocoding failed');
    }
  },
}));

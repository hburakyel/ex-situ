'use strict';

/**
 * SQL for the origin "place" an object is grouped under on the map (zoom 3–6
 * clusters) and in the MCP server's site-level flows. Shared by
 * mv_city_institution_stats (src/index.js) and the live fallback query in
 * getClusteredData so the two never disagree.
 *
 * Priority:
 *   1. place_name_normalized — curated names (normalize_place_names.py, admin
 *      GeoCorrection) or the suffix-stripped city_en written by
 *      etl/fill_place_name_normalized.py — unless it is only the row's country
 *      while city_en names something finer (keeps city-level precision).
 *   2. city_en
 *   3. country_en, else 'Unknown'
 * Both name columns must be Latin script (accents included: "Fayûm", "Zincirli
 * Höyük"); names in other scripts (Arabic, Persian, Japanese…) fall through to
 * the next level. Mirrored by LATIN_ONLY in frontend/lib/site-label.ts.
 *
 * Group by PLACE_GROUP_KEY (case-insensitive) and display
 * mode() WITHIN GROUP (ORDER BY PLACE_GROUP_EXPR), the most common spelling.
 */

const LATIN_ONLY = "^[\\u0001-\\u024F\\u02B0-\\u02FF\\u1E00-\\u1EFF\\u2018\\u2019]*$";
const usable = (col) =>
  `(NULLIF(BTRIM(${col}), '') IS NOT NULL AND ${col} ~ '${LATIN_ONLY}')`;

const CITY_EXPR = `CASE WHEN ${usable('city_en')} THEN BTRIM(city_en) END`;

const PLACE_GROUP_EXPR = `COALESCE(
  CASE WHEN ${usable('place_name_normalized')}
        AND NOT (LOWER(BTRIM(place_name_normalized)) = LOWER(COALESCE(country_en, ''))
                 AND ${CITY_EXPR} IS NOT NULL)
       THEN BTRIM(place_name_normalized) END,
  ${CITY_EXPR},
  COALESCE(NULLIF(country_en::text, ''), 'Unknown')
)`;

const PLACE_GROUP_KEY = `LOWER(${PLACE_GROUP_EXPR})`;

/** Raw city_en spellings merged into a group (for the MCP server's `variants`). */
const PLACE_VARIANTS_AGG = `array_agg(DISTINCT BTRIM(city_en)) FILTER (WHERE NULLIF(BTRIM(city_en), '') IS NOT NULL)`;

module.exports = { PLACE_GROUP_EXPR, PLACE_GROUP_KEY, PLACE_VARIANTS_AGG };

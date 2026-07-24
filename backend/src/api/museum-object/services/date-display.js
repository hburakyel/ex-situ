'use strict';

/**
 * Collapses the internal, normalized date schema (migration 014:
 * object_date_earliest/latest/precision/display, acquisition_year_*) down to
 * the two simple, human-readable fields the public API/CSV export actually
 * expose: `object_date` (a display string) and `acquisition_year` (a number
 * or null). Precision/confidence never leak past this boundary as raw values.
 *
 * Institutions not yet migrated onto the new columns (object_date_precision
 * is NULL) fall back to their pre-migration raw columns unchanged, so this
 * is safe to wire in ahead of a full rollout — only rows that have actually
 * been backfilled (currently: Art Institute of Chicago) get the new logic.
 */

const JUNK_DISPLAY_TOKENS = new Set(['n/a', 'n.d', 'unknown', 'undated', '?', '']);

function isJunkDisplay(text) {
  if (text === null || text === undefined) return true;
  const normalized = String(text).trim().toLowerCase().replace(/\.$/, '');
  return JUNK_DISPLAY_TOKENS.has(normalized);
}

function formatYear(year) {
  return year < 0 ? `${Math.abs(year)} BCE` : `${year}`;
}

function buildObjectDatePublic(row) {
  if (!isJunkDisplay(row.object_date_display)) {
    return row.object_date_display.trim();
  }

  const hasEarliest = row.object_date_earliest !== null && row.object_date_earliest !== undefined;
  const hasLatest = row.object_date_latest !== null && row.object_date_latest !== undefined;

  // before/after are one-sided by design — only one bound will ever be set.
  if (row.object_date_precision === 'before' && hasLatest) {
    return `before ${formatYear(row.object_date_latest)}`;
  }
  if (row.object_date_precision === 'after' && hasEarliest) {
    return `after ${formatYear(row.object_date_earliest)}`;
  }
  if (!hasEarliest || !hasLatest) {
    return '';
  }
  const earliest = formatYear(row.object_date_earliest);
  const latest = formatYear(row.object_date_latest);
  const range = row.object_date_earliest === row.object_date_latest ? earliest : `${earliest}–${latest}`;
  return row.object_date_precision === 'circa' ? `circa ${range}` : range;
}

function buildAcquisitionYearPublic(row) {
  if (row.acquisition_date_confidence !== 'confirmed') return null;
  if (row.acquisition_year_earliest === null || row.acquisition_year_earliest === undefined) return null;
  return row.acquisition_year_earliest;
}

/**
 * @param {object} row - raw SQL row, must include object_date_precision,
 *   object_date_display, object_date_earliest, object_date_latest,
 *   acquisition_date_confidence, acquisition_year_earliest, plus the legacy
 *   object_date / acquisition_year columns for pre-migration fallback.
 * @returns {{ object_date: string, acquisition_year: number|null }}
 */
function buildPublicDateFields(row) {
  const isMigrated = row.object_date_precision !== null && row.object_date_precision !== undefined;

  const object_date = isMigrated
    ? buildObjectDatePublic(row)
    : (row.object_date || '');

  const hasMigratedAcquisition = row.acquisition_date_confidence !== null && row.acquisition_date_confidence !== undefined;
  const acquisition_year = hasMigratedAcquisition
    ? buildAcquisitionYearPublic(row)
    : (row.acquisition_year ?? null);

  return { object_date, acquisition_year };
}

module.exports = { buildPublicDateFields, isJunkDisplay, formatYear };

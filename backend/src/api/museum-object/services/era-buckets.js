'use strict';

/**
 * Time-period buckets for the "Time" (object creation date) left-panel
 * filter. MUST stay structurally in sync with frontend/lib/era-buckets.ts —
 * same ids and boundaries. The one intentional difference: this list omits
 * 'undated' (handled by callers as a separate predicate), while the
 * frontend's copy includes it as a normal, renderable list row.
 *
 * Extracted to its own module so both the live-query service
 * (museum-object.js) and the bootstrap-time materialized view DDL
 * (src/index.js) build the identical bucket list from one source.
 */
function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

function buildEraBuckets(currentYear) {
  const buckets = [
    { id: 'ancient', label: 'Before 500 BCE', start: null, end: -500 },
  ];
  for (let n = 5; n >= 1; n--) {
    buckets.push({ id: `bce-${n}`, label: `${ordinal(n)} century BCE`, start: -n * 100, end: -(n - 1) * 100 - 1 });
  }
  const currentCentury = Math.ceil(currentYear / 100);
  for (let n = 1; n <= currentCentury; n++) {
    const isCurrent = n === currentCentury;
    buckets.push({
      id: `ce-${n}`,
      label: `${ordinal(n)} century`,
      start: (n - 1) * 100 + 1,
      end: isCurrent ? null : n * 100,
    });
  }
  return buckets;
}

module.exports = { buildEraBuckets };

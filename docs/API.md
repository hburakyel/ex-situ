# Ex Situ public API (read-only reference)

Base URL: `https://exsitu.app/api` (production) · `http://localhost:1337/api` (local Strapi).
All endpoints below are public `GET`s — no auth. Responses are JSON.

Filter values are exact strings as stored, e.g. `country=Egypt`, `institution=Antikensammlung`,
`institution=Ethnologisches Museum` (URL-encode spaces). Dates are integer years, negative for BCE.

## Common filters

| Param | Meaning |
|---|---|
| `country` | Origin country (English name, e.g. `Egypt`, `Turkey`) |
| `institution` | Holding museum (e.g. `Antikensammlung`, `The Metropolitan Museum of Art`) |
| `city` | Origin city |
| `dateStart`, `dateEnd` | Object date range (years, negative = BCE) |
| `undated=true` | Only objects without an object date |
| `acqDateStart`, `acqDateEnd`, `acqUndated=true` | Same, for acquisition date |

## Endpoints

### `GET /museum-objects/geospatial`
Map arcs/clusters: where objects came from → which museum holds them.
Params: `zoom` (1–18; lower = coarser, country-level), `minLon,minLat,maxLon,maxLat` (bbox),
`country`, `institution`, `city`, date filters.
Returns `{zoom, bbox, filters, type, data: [...]}`; each item:
`place_name, country, latitude, longitude, institution_name, institution_latitude, institution_longitude, object_count, sample_img_url, type ("arc"), cluster_id`.

```
/museum-objects/geospatial?zoom=4&country=Egypt&institution=Antikensammlung
```

### `GET /museum-objects/by-country`
Paged object list. Params: `country` or `institution` (one is required), `site`, `page`, `pageSize`,
`onlyWithImages=true`, date filters.
Returns `{data: [{id, attributes}], meta: {pagination: {page, pageSize, pageCount, total}}}` —
`meta.pagination.total` is the object count for the filter.

### `GET /museum-objects/date-buckets`
Time histograms. Params: `country`, `institution`, `city`.
Returns `objectDateBuckets` / `acquisitionBuckets` (`[{id, label, count}]`),
`objectDateExactCount`, `acquisitionExactCount`, `objectDateSpans` (`[{earliest, latest, count}]`).

### `GET /museum-objects/date-buckets/decades`
Decade-level buckets. Params: `century`, `country`, `institution`, `city`.

### `GET /museum-objects/resolver-stats`
Dataset-wide totals and per-museum data quality: `totals {totalObjects, totalGeocoded, totalInstitutions, totalCountries, globalAvgConfidence}`
and `institutions[] {name, totalObjects, geocodedCount, resolvedPct, avgConfidence, geocodingStatus, reviewStatus, distinctCountries, …}`.
Best single call for "how many objects / museums / countries".

### `GET /museum-objects/resolver-stats/:institution`
Same detail for one museum.

### `GET /museum-objects/quality-stats`
Data-quality summary.

### `GET /museum-objects/suggest`
Place autocomplete. Params: `q`, `limit`. Returns `data: [{place_name, country_en, city_en, latitude, longitude, object_count}]`.

### `GET /museum-objects/lookup`
Objects at a named place. Params: `place_name` (required), `institution`.
Returns `{total, sample: [{id, title, place_name, institution_name, city_en, country_en, latitude, longitude, geocoding_notes}]}`.

### `GET /museum-objects/synonyms`
Place-name alias → canonical mappings.

### `GET /museum-objects`
Strapi default list with full-text search. Params: `_q`, `pagination[page]`, `pagination[pageSize]`,
`filters[latitude][$gte]` etc. Returns `{data, meta.pagination}`.

### `GET /stats`
Counts by country / city / institution. Note: currently reflects a 100-object sample
(`totalObjects: 100`), not the full dataset — use `resolver-stats` for real totals.

### `GET /museum-objects/by-inventory/:inventoryNo`
Single object by inventory number. Known issue (2026-10-04): returns a 500 for
`VII OA 0237.008`, an object that exists.

## Not for querying

These change data or need auth — never call them to answer a question:
`PATCH /museum-objects/:id/correct`, `PUT /museum-objects/refresh-views`, `PUT /museum-objects/bulk-geocode`,
`GET /museum-objects/pending-corrections`, `/webhook/*`.

`refresh-views` and `bulk-geocode` require a Strapi admin-panel JWT
(`backend/src/policies/is-admin-user.js`); they're called from the admin GeoCorrection page.

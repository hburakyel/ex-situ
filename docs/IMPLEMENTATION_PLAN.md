# Implementation plan: discoverability and entry pages

Status: **Phase 0, waiting for approval.** Nothing below is built yet.

Goal: turn Ex Situ from one map into a set of crawlable, data-generated pages that link into each
other, plus framing pages and cookie-free analytics. No accounts, no prose about individual artifacts
or places, no new tables, no hosted images.

---

## 1. What exists today

### Routes (frontend/app)

| Route | Rendering | Notes |
|---|---|---|
| `/` | server `redirect("/map")` | No home page. |
| `/map` | server page → client map (`map-client.tsx`, 1.6k lines) | `generateMetadata` gives `?place=` / `?institution=` views their own title, description and canonical (commit ce2d02b). The content is client-only, so crawlers see an empty page. |
| `/artifact/[id]` | server metadata + client redirect to `/map?artifactId=…` | Has OG tags and an image card, but no content. `<noscript>` meta-refresh. |
| `/research/arc/[slug]`, `/research/collection/[slug]` | server metadata, client content | Older pages. Nothing links to them and the sitemap doesn't list them. `/research` redirects to `/map`. |
| `/design` | design-system page | Internal. |
| `/sitemap.xml` | `app/sitemap.ts`, daily ISR | Lists `/`, `/map` and `/map?place=…` / `/map?institution=…` for every arc group. |
| `/robots.txt` | `app/robots.ts` | Disallows `/api/`. |
| `/api/proxy/*` | Next route handlers | Proxy to Strapi, image proxy (`img`, `institution-image`), MCP at `/api/proxy/mcp`. |

The prompt mentions `app/exsitu-v3`, which isn't in the repo. The map and its URL state live in
`app/map/*`, `components/map/*` and `hooks/*`. Those are the files I'll treat as off-limits except
for adding links.

### How data is fetched

- The frontend never talks to Postgres. Server components and route handlers `fetch()` Strapi at
  `NEXT_PUBLIC_API_BASE_URL` (default `http://localhost:1337/api`) with `next.revalidate`.
- Strapi custom endpoints run **raw SQL through knex** in
  `backend/src/api/museum-object/services/museum-object.js`. They don't use the entity service.
- `lib/arc-index.ts` gets every place→institution arc total from one cached
  `geospatial?zoom=1` call (backed by `mv_country_institution_stats`). The sitemap and map metadata
  are built from that call.
- Materialized views are created in `backend/src/index.js` bootstrap and dropped by
  `scripts/pre-strapi.js` before each start:
  - `mv_country_institution_stats`: country × institution, 516 rows
  - `mv_city_institution_stats`: site (place group) × country × institution, 5,163 rows
  - `mv_time_bucket_stats`, `mv_acquisition_year_stats`
  
  **Both arc views require coordinates.** About 25.5k published artifacts with no coordinates are
  missing from them.

### Columns available (flat `museum_objects`, about 195k rows, 180,057 published locally vs 180,068 in production)

| Dimension | Columns | Coverage (published) |
|---|---|---|
| Territory | `country_en` (+ `country_native`, `geocoded_country`) | 34,587 have no `country_en`. 181 distinct locally, 194 per the production MCP. |
| Site / place | `place_name` (raw, never shown as-is), `place_name_normalized`, `city_en`. The **place group** expression in `services/place-group.js` is what the map calls a "site". | 4,553 distinct place groups among located rows. |
| Coordinates | `COALESCE(manual_latitude, latitude)` / `COALESCE(manual_longitude, longitude)` | 25,543 have none. 25,257 have manual coordinates. |
| Geocoding quality | `geocoding_status` (ok/ambiguous/disputed), `geocoding_confidence`, `geocoding_notes`, `review_status` | **Status is NULL on about 99% of rows** (778 ambiguous, 231 disputed). Confidence is NULL on all but 17. Pages have to say "not recorded" rather than suggest "ok". |
| Institution | `institution_name` (source language), `institution_city_en`, `institution_country_en`, coordinates | 9 institutions. AIC has an empty `institution_city_en` locally (the MCP shows Chicago, so this is an ETL gap). |
| Period | `object_date_earliest/latest`, `object_date_precision`, `object_date_display`; era buckets from `lib/era-buckets.ts` (backend copy kept in sync) | 105,954 dated. 155k have a display string. |
| Acquisition | `acquisition_year_earliest/latest`, `acquisition_date_confidence` | 17.7k |
| Link out | `source_link` | 100% |
| Image | `img_url` (hotlinked, AIC goes through the existing `/api/proxy/img`) | 179.5k |
| Empty and not used | `cultural_context`, `transfer_method`, `origin_event_type_en`, `historical_relation`; the `places` table (0 rows) | |

### Indexes on `museum_objects`

pkey, created/updated_by FKs, three `COALESCE(manual_*, *)` coordinate indexes, a trigram GIN on
`COALESCE(place_name_normalized, place_name)`. **There are no indexes on `country_en`,
`institution_name` or dates.** `by-country` filters with `ILIKE '%…%'`, which is a substring match
("Niger" also matches "Nigeria"), so the new pages can't reuse it.

### Measured query cost (local Postgres, production-size data, warm cache, 3 runs)

| Query | Time |
|---|---|
| Territory summary (institution × site × status, `country_en = 'Japan'`, 20k rows) | ~250 ms |
| Territory artifact page (60 rows, images first, OFFSET 600) | 70–100 ms |
| Site filter by place-group expression (regex per row, full scan) | 260–330 ms |
| All groups (territory × site × institution, whole table) | ~360 ms |
| Period overlap count (19th century) | ~155 ms |
| Institution summary (Ethnologisches Museum, 77k rows) | ~110 ms |

With ISR none of these numbers would reach users, but cold renders and sitemap builds would hit
them. One small aggregate view plus three btree indexes would bring summaries under 10 ms (see §3).

---

## 2. Proposed URL scheme

Every public page is a server component with ISR. All main content is in the HTML without JS.

| Route | Content (generated from data only) | Static params | Revalidate |
|---|---|---|---|
| `/` | What Ex Situ is (static), live counts, entry points: map, random artifact, top territories and institutions | n/a | 1 day |
| `/territories` | All territories, artifact counts, institutions per territory | build | 1 day |
| `/territories/[territory]` | Count; institutions holding artifacts from here (→ route pages); sites (→ site pages); period distribution (→ period pages); geocoding status breakdown (ok / ambiguous / disputed / not recorded); paged artifact grid with images first, then inventory numbers; "Open on map" link | build (≈195) | 1 day |
| `/territories/[territory]/[site]` | Same blocks for one place group, including spelling variants (`place_name` values grouped under it), coordinate precision and status | on demand | 1 day |
| `/institutions` | 9 institutions with city and counts | build | 1 day |
| `/institutions/[institution]` | Territories and sites of origin, period distribution, located/unlocated share, artifact grid | build | 1 day |
| `/routes/[territory]/[institution]` | The arc: territory → institution. Count, sites, periods, acquisition years where confirmed, artifact grid | on demand | 1 day |
| `/periods`, `/periods/[era]` | Era buckets (`ce-19`, `bce-5`, `ancient`, `undated`, the ids from `era-buckets.ts`), territories and institutions in each | build | 1 day |
| `/artifact/[id]` | **Becomes a real page** (see question 1): title, inventory number, date display + precision, place (`COALESCE(place_name_normalized, place_name)` + raw `place_name` as source text), territory, coordinates with status/confidence, institution, prominent **"View at [institution] ↗"** to `source_link`, hotlinked image, "Open on map", "Suggest a correction" | on demand | 1 week |
| `/random` | 307 to a random published artifact (`noindex`, not cached) | n/a | dynamic |
| `/about`, `/method` | Static placeholder sections for you to write | build | static |
| `/developers` | Public GET endpoints + MCP tools, copy-paste examples, GitHub link (`/api` is taken by route handlers) | build | static |
| `/contribute` | Static: how an institution or collection can be added (what data, open API, licence), links to COLLECTIONS.md / GitHub issue template | build | static |

**Slugs:** lowercase ASCII from NFKD with diacritics stripped (`Ägyptisches Museum und
Papyrussammlung` → `agyptisches-museum-und-papyrussammlung`, `Côte d'Ivoire` → `cote-d-ivoire`).
Each slug is resolved through a name↔slug map built from the index endpoint. Collisions get a `-2`
suffix and unknown slugs return 404. Display names stay in the source language. Artifacts without
`country_en` get `/territories/not-recorded` so they're counted honestly rather than dropped.

**Pagination:** `?page=N`, 60 per page, canonical includes the page number,
`rel="prev"/"next"` links. Grid order follows CLAUDE.md: artifacts with an image first, then
inventory numbers, never placeholder graphics.

**Existing URLs:**
- `/map?place=X` / `/map?institution=Y` keep working unchanged. Their canonical moves to the new
  page. This is a metadata-only edit in `app/map/page.tsx`.
- `/research/arc/[slug]` → 308 to `/territories/[slug]`. `/research/collection/[slug]` → 308 to
  `/institutions/[slug]` (see question 3).

---

## 3. Backend additions (no schema or content-type changes)

**One new materialized view, `mv_entry_index`**, created and dropped alongside the others in
`src/index.js` / `pre-strapi.js`, refreshed by the existing `refresh-views` endpoint:

```
GROUP BY country_en, place group key (place-group.js), institution_name,
         geocoding_status, has_coords, has_image, era bucket id
→ count of distinct (inventory_number | id, institution_name), mode() display name,
  min/max date, array of raw place_name variants (capped)
```

Unlike the arc views, it has **no coordinate filter**, so unlocated artifacts are counted. It should
come to roughly 15–30k rows. Every summary block on every page is one indexed lookup on it.

**Indexes** (partial, `WHERE published_at IS NOT NULL`), only for the paged artifact grids:
`(country_en, id)`, `(institution_name, id)`, and an expression index on the place-group key if the
site grid stays above ~100 ms after the view lands. I'll create them in bootstrap with
`IF NOT EXISTS`. Building them on 195k rows should take seconds.

**New public GET endpoints** (custom routes in `museum-object`, raw SQL, parameterized, exact-match
filters, documented in docs/API.md):

```
GET /museum-objects/index/summary                         totals + territory/institution/period lists
GET /museum-objects/index/territory?name=…[&site=…]       summary blocks for a territory or site
GET /museum-objects/index/institution?name=…
GET /museum-objects/index/route?territory=…&institution=…
GET /museum-objects/index/period?era=…
GET /museum-objects/index/artifacts?territory|site|institution|era=…&page=…   images first
GET /museum-objects/index/random
```

I chose Strapi endpoints over querying Postgres from Next because that's how the rest of the app
works, it needs no `pg` dependency and no second set of DB credentials, and the MCP server and
third parties can use the same endpoints. Deploy order stays backend → frontend.

---

## 4. Phases (one commit each; nothing committed or deployed unless you say so)

1. **Analytics.** Umami script in `app/layout.tsx`, only when `NEXT_PUBLIC_UMAMI_SRC` and
   `NEXT_PUBLIC_UMAMI_WEBSITE_ID` are set. Umami sets no cookies. A tiny `lib/track.ts` wrapper
   (no-op without the script) records `arc_click`, `territory_drilldown`, `artifact_open`,
   `outbound_institution_click`, `share_click`, `command_palette_search`. On the new pages,
   outbound links use `data-umami-event` attributes, so tracking works without our JS.
   `docs/ANALYTICS.md`: docker-compose (Umami + its own Postgres DB) behind the existing reverse
   proxy on Hetzner, env vars, and a CSP note. Nothing gets deployed.
2. **Entry pages.** Backend view, indexes and endpoints. Frontend `lib/entry-index.ts` (fetch +
   slugs), a shared server-only layout (header: Map · Territories · Institutions · Periods · About),
   territory, site, institution, route, period and artifact pages, `/random`.
3. **Rabbit-hole linking.** Cross-links on every block (territory ↔ site ↔ institution ↔ route ↔
   period ↔ artifact), breadcrumbs, "nearby sites in the same territory", "same site at other
   institutions". The map's object panel and info panel get plain links to the matching entry
   pages (link-only edits).
4. **Indexability.** Sitemap index via `generateSitemaps` (static/territory/institution/site/route
   pages + artifact chunks of 45k), canonicals, `noindex` on `/random` and filtered map states,
   JSON-LD (`CollectionPage`/`ItemList`, `VisualArtwork` with `url` = `source_link`, never claiming
   to be the holder), map metadata copy fixed ("objects" → "artifacts").
5. **Framing pages.** Home, About/Method placeholders, `/developers`, `/contribute`, and a
   "Suggest a correction" link on artifact and site pages that opens a prefilled GitHub issue
   (`issues/new?title=…&body=…` with artifact id, inventory number, institution, current
   place/coordinates).

**Quality checks per phase:** `pnpm test`, `pnpm build`, `npm test`. Lighthouse (SEO +
accessibility) per page type with `npx lighthouse` run ad hoc, not added to package.json.
p50/p95 per page type from a scratch curl loop against `next start` + local Strapi on this
production-size DB (cold render and ISR hit reported separately). JS-disabled check with
`curl | grep` for main content.

---

## 5. Questions before I start

1. **`/artifact/[id]`:** OK to turn the redirect into a real server-rendered page with "Open on
   map"? Existing shared links would land on a page instead of jumping into the map. The other
   option is a new `/artifacts/[id]` with `/artifact/[id]` left as the redirect.
2. **`/`:** OK to replace the redirect to `/map` with the home page? (Phase 5. Until then `/`
   stays as it is.)
3. **`/research/*`:** OK to 308-redirect to the new pages, and later delete the old client code?
4. **Images on entry pages:** hotlinking `img_url` through the existing `resolveImageSrc`, exactly
   as the map does (no new proxy). OK?
5. **Analytics:** Umami (Postgres, which matches the stack) rather than Plausible (ClickHouse,
   heavier)?
6. **Territory names:** use `country_en` as stored (181–194 values, including historical ones the
   ETL left). Any value should be fixed in ETL, not here. I'll list oddities I notice for you
   rather than map them.
7. **Paging depth:** large territories (Japan 20k, Peru 15k) give 300+ grid pages. Cap indexable
   grid pages (e.g. 20 per entity) and rely on the artifact sitemap for the rest?

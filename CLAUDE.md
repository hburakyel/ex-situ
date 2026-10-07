# Ex Situ — notes for Claude

Spatial index of displaced cultural artifacts: origin place → holding museum. An **indexer, not a hoster**:
every record links back to the institution's own page; images are never copied. Read METHODOLOGY.md
before changing what data is shown or how places/dates are interpreted.

## Layout

- `frontend/` — Next.js 15 + React 19, Deck.gl/MapLibre, Tailwind. **pnpm** only.
  - `app/map/page.tsx`, `components/map/*` — map UI, object panel (exports: CSV/JSON/Markdown)
  - `lib/` — place/site labels, image URL rewriting (`image-src.ts`), MCP server (`lib/mcp/`)
  - `app/api/proxy/` — Next proxy to Strapi; public MCP endpoint at `/api/proxy/mcp`
- `backend/` — Strapi v4 + PostgreSQL/PostGIS. **npm** only (uses `overrides`; pnpm ignores them).
  - `src/api/museum-object/services/museum-object.js` — geospatial/arc queries, materialized views
  - `scripts/pre-strapi.js` runs before every start (drops views; bootstrap rebuilds them, ~1–2 min)
- `etl/` — Python resolvers and place/geocoding fixes. GeoNames gazetteer in `etl/data/gazetteer/`.
- `docs/` — API.md (public GET endpoints), ETL.md (pipeline order), DATA-AUDIT.md

## Commands

```bash
cd frontend && pnpm dev          # :3000
cd frontend && pnpm test         # vitest
cd frontend && pnpm build        # also the CI check
cd backend && npm run develop    # :1337
cd backend && npm test           # node:test, no DB needed
```

Live integration tests against production:
`MCP_URL=https://exsitu.app/api/proxy/mcp API_URL=https://exsitu.app/api pnpm test` (in frontend/).

## Data rules (don't break these)

- `place_name` is raw source data and is never changed; `place_name_normalized` is the English label.
- Never invent coordinates or precision. Ambiguous places get flagged, not guessed.
- Rows with `review_status = 'verified'` are never touched by scripts.
- Fuzzy place matching is opt-in (`--fuzzy`); it produced Lagos→Laos, Delphi→Delhi.
- Palestine is an ordinary country, not flagged as disputed.
- ETL scripts: dry run first, `--apply` only after reviewing output.
- After a data import: normalize_place_names.py → fill_place_name_normalized.py →
  normalize_place_labels.py → audit_places.py, then restart Strapi.
- Answer data questions via the public API / MCP tools, not by reading the large `etl/*.json` dumps.

## Conventions

- MCP tools stay read-only, zod-validated, and never accept URLs.
- Image grid: images first; objects without a loadable image (none, failed, server down, withdrawn)
  come after them as their inventory number — never gray/placeholder graphics. by-country sorts
  objects with an image first.
- Deploy backend before frontend (frontend build prerenders pages from the API).
- Never commit secrets, `.env` files, or server details — this repo is public.

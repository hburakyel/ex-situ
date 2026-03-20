# Basemap: Protomaps + MapLibre GL JS

Ex Situ uses **Protomaps** vector tiles rendered with **MapLibre GL JS**.
No Mapbox token is required for map tiles.

## Tile source priority

The app checks environment variables in this order:

1. **`NEXT_PUBLIC_PROTOMAPS_PMTILES_URL`** — URL to a self-hosted `.pmtiles` file
2. **`NEXT_PUBLIC_PROTOMAPS_KEY`** — Protomaps CDN key (tiles from `api.protomaps.com`)
3. **Fallback** — Public Protomaps basemap hosted on R2 (no key needed, works out of the box)

## Option A: Protomaps CDN (easiest)

1. Sign up at <https://protomaps.com> and get an API key
2. Add to `.env`:
   ```
   NEXT_PUBLIC_PROTOMAPS_KEY=your_key_here
   ```

## Option B: Self-hosted PMTiles

1. Download a PMTiles planet extract:
   ```bash
   # Full planet (~80 GB)
   curl -L -o public/basemap.pmtiles \
     "https://build.protomaps.com/20250101.pmtiles"

   # Or use pmtiles CLI to extract a region:
   npm install -g pmtiles
   pmtiles extract https://build.protomaps.com/20250101.pmtiles \
     public/basemap.pmtiles --bbox="-180,-85,180,85"
   ```

2. Place the file at `public/basemap.pmtiles` (no env var needed), or host it
   on a CDN and set:
   ```
   NEXT_PUBLIC_PROTOMAPS_PMTILES_URL=https://your-cdn.com/basemap.pmtiles
   ```

## Style

The dark basemap style is defined in `lib/protomaps-dark-style.ts`.
It uses Protomaps' `pmap:kind` attribute schema with colors matching
the Ex Situ dark palette (background `#1a1a1a`, water `#0d1117`).

## Geocoding

Place search uses the **self-hosted PostGIS gazetteer** via `/api/geocode`.
The `geocode_place()` function queries `gazetteer_places` with trigram similarity
and full-text search. No external API tokens required.

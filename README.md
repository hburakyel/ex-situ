# Ex Situ — Relational Spatial Index


[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-15-black)](https://nextjs.org)
[![Strapi](https://img.shields.io/badge/Strapi-4-2E7EEA)](https://strapi.io)
[![PostGIS](https://img.shields.io/badge/PostgreSQL-PostGIS-336791)](https://postgis.net)

![Ex Situ — provenance arc visualization](docs/screenshot.png)

**[https://exsitu.app](https://exsitu.app)**


Ex Situ is an open-source spatial digital commons platform and geospatial infrastructure that turns institutional hyperlinks into standardized geospatial data. While archives are increasingly digital, their data remains siloed and lacks the standardized coordinates necessary for spatial analysis. Ex Situ resolves fragmented cultural heritage metadata into a unified, machine-readable index — enabling the visualization and analysis of artifact provenance and movement across global museum collections.

Museums across Europe and North America hold hundreds of thousands of objects whose provenance — where they came from, under what circumstances — remains buried in institutional databases, invisible to researchers and the public. Ex Situ makes this visible: not by duplicating institutional data, but by indexing the relationships between origin sites and destination collections as a spatial commons  — connective tissue between archives that were never designed to speak to each other.

> 132,854+ museum objects resolved and geolocated across international institutions in 177 territories.

---

## How It Works

Ex Situ functions as a **Relational Spatial Index** — an indexer, not a hoster. It built around opt-in contribution rather than adversarial scraping.

Three foundational concepts:

| Concept | Description |
|---------|-------------|
| **Artifact** | Individual object record with resolved coordinates |
| **Arc** | Directional provenance connection between origin site and institution |
| **Resolver** | ETL pipeline that ingested and geolocated the data |

The map interface renders provenance arcs at multiple zoom levels using zoom-based spatial aggregation:

| Zoom | Strategy | Arc Logic |
|------|----------|-----------|
| 0–4 | Country statistics | Country → Institution |
| 5–9 | City clustering | City → Institution |
| 10+ | Individual objects | Precise coordinates |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15 (App Router), TypeScript, Deck.gl, MapLibre GL JS |
| Styling | Radix UI, Tailwind CSS, IBM Plex Mono |
| Backend | Strapi v4 (Community Edition), Node.js |
| Database | PostgreSQL + PostGIS, H3-pg (Phase 1) |
| Maps | Protomaps (PMTiles), MapLibre GL JS |
| ETL Pipeline | Python (geocoding, data normalization, fuzzy matching) |
| Hosting | Hetzner (self-hosted) |

---

## API

The geospatial endpoint returns zoom-level-appropriate arc data:

```
GET https://exsitu.app/api/museum-objects/geospatial
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `zoom` | integer | ✅ | Zoom level (0–20) |
| `minLon` | float | zoom ≥ 5 | Bounding box min longitude |
| `minLat` | float | zoom ≥ 5 | Bounding box min latitude |
| `maxLon` | float | zoom ≥ 5 | Bounding box max longitude |
| `maxLat` | float | zoom ≥ 5 | Bounding box max latitude |
| `institution` | string | — | Filter by institution name(s), comma-separated |
| `country` | string | — | Filter by origin country, comma-separated |
| `city` | string | — | Filter by origin city, comma-separated |

**Example response (zoom < 5):**

```json
{
  "type": "statistics",
  "data": [{
    "place_name": "Rwanda",
    "latitude": -1.95,
    "longitude": 29.87,
    "institution_name": "Ethnologisches Museum",
    "institution_latitude": 52.50,
    "institution_longitude": 13.29,
    "object_count": 1234,
    "type": "arc"
  }]
}
```

---

## Quick Start

### Prerequisites

- Node.js ≥ 18, npm / pnpm
- PostgreSQL 16+ with PostGIS extension
- Python 3.10+ (for ETL)

### 1 — Clone & configure

```bash
git clone https://github.com/hburakyel/ex-situ.git
cd ex-situ

# Backend
cp backend/.env.example backend/.env
# → fill in database credentials and secret keys

# Frontend
# → set NEXT_PUBLIC_API_BASE_URL in frontend/.env
```

See [backend/.env.example](backend/.env.example) for all required variables.

### 2 — Database setup

```bash
# Create database and enable extensions
psql -U postgres -c "CREATE USER exsitu WITH PASSWORD 'yourpassword';"
psql -U postgres -c "CREATE DATABASE exsitu_db OWNER exsitu;"
psql -U postgres -d exsitu_db -c "CREATE EXTENSION postgis;"
psql -U postgres -d exsitu_db -c "CREATE EXTENSION pg_trgm;"

# Run PostGIS migration
psql -U exsitu -d exsitu_db -f backend/database/migrations/001_add_postgis_geometry.sql
```

### 3 — Backend (Strapi)

```bash
cd backend
npm install
npm run develop   # development (auto-reload, http://localhost:1337)
# npm run build && npm run start   # production
```

### 4 — Frontend (Next.js)

```bash
cd frontend
pnpm install
pnpm dev          # development (http://localhost:3000)
# pnpm build && pnpm start   # production
```

---

## Project Structure

```
ex-situ/
├── frontend/                   # Next.js app
│   ├── app/                    # App Router pages + API proxy routes
│   ├── components/             # Map, object grid, search palette
│   ├── hooks/                  # Data fetching, arc worker, URL state
│   ├── workers/                # Web Worker for arc processing
│   └── lib/                    # API client, design system, Protomaps style
├── backend/                    # Strapi CMS + custom geospatial API
│   ├── src/api/museum-object/  # Controllers, services, routes
│   ├── database/migrations/    # PostGIS schema migrations
│   └── scripts/                # Data migration and admin scripts
└── etl/                        # Python ETL pipeline (available upon request)
```

---

## Self-Hosting

Ex Situ is designed to be fully self-hostable. All infrastructure runs on standard Ubuntu + PostgreSQL + Node.js — no proprietary cloud dependencies.

Key design choices for data sovereignty:
- All map tiles served from Protomaps CDN or self-hosted PMTiles
- Reverse geocoding via local Nominatim / PostGIS gazetteer
- No third-party analytics or tracking

Production deployment uses Nginx as reverse proxy with Let's Encrypt SSL.

---

## Attribution

### Map & Visualization

- **[Protomaps](https://protomaps.com)** — PMTiles tile format and basemap renderer ([BSD 2-Clause](https://github.com/protomaps/basemaps/blob/main/LICENSE))
- **[MapLibre GL JS](https://maplibre.org)** — Open-source WebGL map rendering engine ([BSD 2-Clause](https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt))
- **[Deck.gl](https://deck.gl)** — WebGL-powered geospatial visualization layers by [vis.gl](https://vis.gl) ([MIT](https://github.com/visgl/deck.gl/blob/master/LICENSE))

### Geodata

- **© [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)** — Base map data ([ODbL 1.0](https://opendatacommons.org/licenses/odbl/)). Map data is open data, licensed under the Open Data Commons Open Database License.
- **[Nominatim](https://nominatim.org)** — Reverse geocoding and place name resolution, powered by OpenStreetMap data
- **[Natural Earth](https://www.naturalearthdata.com)** — Public domain geodata for country and region boundaries

### Institutional Data Sources

- **[Staatliche Museen zu Berlin](https://www.smb.museum)** — SMB-Digital / SMB-AM collection metadata
- **[The Metropolitan Museum of Art](https://www.metmuseum.org)** — Open Access collection data ([CC0](https://creativecommons.org/publicdomain/zero/1.0/))

---

## Contributing

Ex Situ is in active development. Contributions are welcome, particularly:

- New institution resolvers (ETL plugins)
- Geocoding improvements for historical place names
- Frontend performance optimizations
- Translations of German place name variants

Please open an issue before submitting a pull request.

---


## Funding

This project has received support from 
[HAB Hessen-Abschlussförderung](https://hab-hessen.de) (2022).  

---

## License

Copyright © 2026 Hüseyin Burak Yel.  
Licensed under the [GNU Affero General Public License v3.0](LICENSE).
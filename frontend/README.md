# Ex Situ — Relational Spatial Index

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-15-black)](https://nextjs.org)
[![Strapi](https://img.shields.io/badge/Strapi-4-2E7EEA)](https://strapi.io)
[![PostGIS](https://img.shields.io/badge/PostgreSQL-PostGIS-336791)](https://postgis.net)

**[https://exsitu.app](https://exsitu.app)**

Ex Situ is an open-source spatial digital commons platform designed to resolve fragmented cultural heritage metadata into a unified, machine-readable geospatial index. By transforming siloed institutional hyperlinks into standardized geodata, Ex Situ enables the visualization and analysis of artifact provenance and movement across global museum collections.

> 132,854+ museum objects resolved and geolocated across international institutions.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15 (App Router), TypeScript, Deck.gl, MapLibre GL JS |
| Styling | Radix UI, Tailwind CSS |
| Backend | Strapi v4 (Community Edition), Node.js |
| Database | PostgreSQL + PostGIS |
| ETL Pipeline | Python (geocoding, LLM enrichment, data normalization) |
| Hosting | Hetzner (self-hosted, data sovereign) |

---

## Quick Start

### Prerequisites

- Node.js ≥ 18, npm / pnpm
- PostgreSQL with PostGIS extension
- Python 3.10+ (for ETL)

### 1 — Clone & configure

```bash
git clone https://github.com/your-org/ex-situ.git
cd ex-situ

# Backend
cp .env.example .env
# → fill in database credentials and secret keys

# Frontend
cp frontend/.env.example frontend/.env
# → set NEXT_PUBLIC_API_BASE_URL
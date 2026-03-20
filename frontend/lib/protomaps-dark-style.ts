/**
 * Protomaps dark basemap style for Ex Situ.
 *
 * Uses @protomaps/basemaps to generate correct v4-schema layers, with a
 * custom Flavor matching Ex Situ's color palette:
 *   - Background: #111111 (near black)
 *   - Water: #0d1117
 *   - Roads: subtle, low contrast
 *   - Labels: minimal, muted gray
 *   - Boundaries: visible but not dominant
 *   - No orange — reserved for Ex Situ's arc layer
 *
 * Tile source: Protomaps CDN (requires NEXT_PUBLIC_PROTOMAPS_KEY) or
 * self-hosted PMTiles file at /basemap.pmtiles.
 */
import type { StyleSpecification } from "maplibre-gl"
import { layers, DARK, namedFlavor, type Flavor } from "@protomaps/basemaps"

/** Ex Situ dark flavor — based on DARK with muted cartographic colors. */
const exSituFlavor: Flavor = {
  ...DARK,
  // Base surfaces
  background: "#111111",
  earth: "#1a1a1a",
  water: "#0d1117",
  buildings: "#1e1e1e",
  // Natural / parks
  park_a: "#161c16",
  park_b: "#141a14",
  wood_a: "#161c16",
  wood_b: "#141a14",
  // Roads — very subtle
  highway: "#333333",
  highway_casing_early: "#222222",
  highway_casing_late: "#222222",
  major: "#2e2e2e",
  major_casing_early: "#1e1e1e",
  major_casing_late: "#1e1e1e",
  minor_a: "#222222",
  minor_b: "#222222",
  minor_casing: "#1a1a1a",
  minor_service: "#1e1e1e",
  minor_service_casing: "#1a1a1a",
  other: "#1e1e1e",
  link: "#282828",
  link_casing: "#1a1a1a",
  // Tunnels
  tunnel_highway: "#2a2a2a",
  tunnel_highway_casing: "#1e1e1e",
  tunnel_major: "#252525",
  tunnel_major_casing: "#1a1a1a",
  tunnel_minor: "#1e1e1e",
  tunnel_minor_casing: "#1a1a1a",
  tunnel_link: "#222222",
  tunnel_link_casing: "#1a1a1a",
  tunnel_other: "#1a1a1a",
  tunnel_other_casing: "#161616",
  // Bridges
  bridges_highway: "#333333",
  bridges_highway_casing: "#222222",
  bridges_major: "#2e2e2e",
  bridges_major_casing: "#1e1e1e",
  bridges_minor: "#222222",
  bridges_minor_casing: "#1a1a1a",
  bridges_link: "#282828",
  bridges_link_casing: "#1a1a1a",
  bridges_other: "#1e1e1e",
  bridges_other_casing: "#161616",
  // Railway
  railway: "#2a2a2a",
  pier: "#1e1e1e",
  // Boundaries
  boundaries: "#2a2a2a",
  // Labels — muted gray, legible on dark bg
  country_label: "#777777",
  state_label: "#3d3d3d",
  state_label_halo: "#111111",
  city_label: "#888888",
  city_label_halo: "#111111",
  subplace_label: "#666666",
  subplace_label_halo: "#111111",
  ocean_label: "#2a3a4a",
  roads_label_major: "#555555",
  roads_label_major_halo: "#111111",
  roads_label_minor: "#444444",
  roads_label_minor_halo: "#111111",
  address_label: "#444444",
  address_label_halo: "#111111",
}

/** Layers to suppress — POIs and road shields add visual clutter. */
const SUPPRESSED_LAYERS = new Set(["pois", "roads_shields"])

/**
 * Return the tile source URL. Prefers self-hosted PMTiles when available,
 * falls back to the Protomaps CDN (v4 schema) with an API key.
 */
function getTileSource(): string {
  const selfHosted = process.env.NEXT_PUBLIC_PROTOMAPS_PMTILES_URL
  if (selfHosted) return `pmtiles://${selfHosted}`

  const key = process.env.NEXT_PUBLIC_PROTOMAPS_KEY
  if (key) {
    return `https://api.protomaps.com/tiles/v4/{z}/{x}/{y}.mvt?key=${key}`
  }

  console.warn(
    "[Ex Situ] No Protomaps tile source configured. " +
    "Set NEXT_PUBLIC_PROTOMAPS_KEY in .env.local. " +
    "Get a free key at https://protomaps.com/account"
  )
  return ""
}

export function protomapsCustomStyle(): StyleSpecification {
  const tileSource = getTileSource()
  const isCDN = tileSource.startsWith("https://")

  const protomapsSource = isCDN
    ? {
        type: "vector" as const,
        tiles: [tileSource],
        minzoom: 0,
        maxzoom: 15,
        attribution: "© Protomaps © OpenStreetMap contributors",
      }
    : {
        type: "vector" as const,
        url: tileSource,
        attribution: "© Protomaps © OpenStreetMap contributors",
      }

  // Generate all layers from @protomaps/basemaps (v4-schema compatible)
  const baseLayers = layers("protomaps", exSituFlavor, { lang: "en" })
    .filter((l) => !SUPPRESSED_LAYERS.has(l.id))

  return {
    version: 8,
    name: "Ex Situ Dark",
    sources: { protomaps: protomapsSource },
    glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
    layers: baseLayers,
  } as StyleSpecification
}

// ── Black flavor style ──────────────────────────────────────────────

const blackLayers = layers("protomaps", namedFlavor("black"), { lang: "en" })
  .filter((l) => !SUPPRESSED_LAYERS.has(l.id))

const blackFinalLayers = blackLayers.map((layer) =>
  layer.type === "symbol"
    ? {
        ...layer,
        layout: {
          ...layer.layout,
          "text-font": ["Noto Sans Mono Regular"],
          "text-letter-spacing": 0.06,
        },
        paint: {
          ...layer.paint,
          "text-halo-color": "#000000",
          "text-halo-width": 1,
        },
      }
    : layer
)

export function protomapsBlackStyle(): StyleSpecification {
  const tileSource = getTileSource()
  const isCDN = tileSource.startsWith("https://")

  const protomapsSource = isCDN
    ? {
        type: "vector" as const,
        tiles: [tileSource],
        minzoom: 0,
        maxzoom: 15,
        attribution: "© Protomaps © OpenStreetMap",
      }
    : {
        type: "vector" as const,
        url: tileSource,
        attribution: "© Protomaps © OpenStreetMap",
      }

  return {
    version: 8,
    name: "Ex Situ Black",
    glyphs:
      "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
    sprite:
      "https://protomaps.github.io/basemaps-assets/sprites/v4/black",
    sources: { protomaps: protomapsSource },
    layers: blackFinalLayers,
  } as StyleSpecification
}

// Active style — swap this line to switch themes
export { protomapsBlackStyle as protomapsDarkStyle }

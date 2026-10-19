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
import type { LayerSpecification, SourceSpecification, StyleSpecification, SymbolLayerSpecification } from "maplibre-gl"
import { layers, DARK, namedFlavor, type Flavor } from "@protomaps/basemaps"
import { COUNTRY_LABELS_SOURCE, COUNTRY_LABELS_URL, ORIGIN_LABELS_SOURCE } from "./country-labels"

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

/** Layers to suppress — POIs and road shields add visual clutter. Country
 *  labels are Ex Situ's own (exSituLabelLayers below). */
const SUPPRESSED_LAYERS = new Set(["pois", "roads_shields", "places_country"])

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
    sources: { protomaps: protomapsSource, ...exSituLabelSources },
    glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
    layers: withArcAnchor([...baseLayers, ...exSituLabelLayers]),
  } as StyleSpecification
}

// ── Black flavor style ──────────────────────────────────────────────

function applyBlackTextStyle(layer: LayerSpecification): LayerSpecification {
  return layer.type === "symbol"
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
}

// ── Ex Situ's own labels ────────────────────────────────────────────
// They look exactly like the basemap's labels, so nothing marks them as added.

// Country labels come from etl/build_country_labels.py instead of the basemap,
// which labels Israel from the world view on but Palestine only from zoom 6, as
// "Palestinian Territories" (METHODOLOGY.md, "Country labels").
const basemapLabel = (id: string) => {
  const { layout, paint } = applyBlackTextStyle(
    layers("protomaps", namedFlavor("black"), { lang: "en" }).find((l) => l.id === id)!,
  ) as SymbolLayerSpecification
  return { layout: layout!, paint: paint! }
}
const countryLabel = basemapLabel("places_country")
// Origin names take the basemap's town-name look, without its town dots.
const { "icon-image": _icon, "icon-size": _iconSize, "icon-padding": _iconPadding, ...townLabelLayout } =
  basemapLabel("places_locality").layout
const townLabelPaint = basemapLabel("places_locality").paint

// deck.gl draws the arcs just beneath this invisible layer, so every label stays
// above them. The style is reordered so that all labels come after all fills and
// lines: the low-zoom (local) and CDN basemap groups each have their own labels,
// and an anchor at the first label sat below the CDN group's land and water,
// which covered the arcs from zoom 6 on. The groups' zoom ranges don't overlap,
// so the reordering changes nothing else.
export const ARC_ANCHOR_LAYER = "arcs-beneath-labels"
function withArcAnchor(styleLayers: LayerSpecification[]): LayerSpecification[] {
  const anchor: LayerSpecification = { id: ARC_ANCHOR_LAYER, type: "background", paint: { "background-opacity": 0 } }
  return [
    ...styleLayers.filter((l) => l.type !== "symbol"),
    anchor,
    ...styleLayers.filter((l) => l.type === "symbol"),
  ]
}

const exSituLabelSources: Record<string, SourceSpecification> = {
  [COUNTRY_LABELS_SOURCE]: { type: "geojson", data: COUNTRY_LABELS_URL },
  [ORIGIN_LABELS_SOURCE]: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
}

const exSituLabelLayers: LayerSpecification[] = [
  // Below the world view the arcs start at sites: each start is named as the
  // source records give it (set by the map, with population_rank and sort_key
  // so the basemap's size and priority rules apply). Above the basemap's place
  // names, so these win collisions with them.
  {
    id: "origin-labels",
    type: "symbol",
    source: ORIGIN_LABELS_SOURCE,
    minzoom: 4,
    // From neighbourhood zoom on, the basemap's own names (streets, districts,
    // buildings) describe the place; a site label such as "Istanbul" drawn over
    // Dolmabahçe would read like a street name.
    maxzoom: 12,
    layout: { ...townLabelLayout, "text-field": ["get", "name"] },
    paint: townLabelPaint,
  },
  // Topmost, so country labels win every collision: Palestine is never hidden
  // behind another name.
  {
    id: "country-labels",
    type: "symbol",
    source: COUNTRY_LABELS_SOURCE,
    maxzoom: 9,
    filter: [">=", ["zoom"], ["get", "min_zoom"]],
    layout: { ...countryLabel.layout, "symbol-sort-key": ["get", "sort_key"], "text-field": ["get", "name"] },
    paint: countryLabel.paint,
  },
]

const blackFinalLayers = layers("protomaps", namedFlavor("black"), { lang: "en" })
  .filter((l) => !SUPPRESSED_LAYERS.has(l.id))
  .map(applyBlackTextStyle)

// Protomaps' hosted tile API intermittently returns 504s for the low-zoom
// "whole world" tiles (z0 and most of z1), which leaves visible gaps in the
// basemap at the global map view. Those tiles are trivial in size — a local
// cutout of the same planet build covering z0–5 is ~15MB (see
// `pmtiles extract <planet-build-url> --maxzoom=5`) — so self-host that range
// and let the CDN keep serving the detailed zooms where it doesn't 504.
const LOCAL_LOW_ZOOM_MAXZOOM = 5
const LOCAL_LOW_ZOOM_PMTILES_URL = "pmtiles:///basemap-global.pmtiles"

const localLowZoomLayers = layers("protomaps-local", namedFlavor("black"), { lang: "en" })
  .filter((l) => !SUPPRESSED_LAYERS.has(l.id))
  .map(applyBlackTextStyle)
  .map((l) => ({ ...l, id: `local-${l.id}`, maxzoom: LOCAL_LOW_ZOOM_MAXZOOM + 1 }))

const cdnLayersAboveLowZoom = blackFinalLayers.map((l) => ({
  ...l,
  minzoom: Math.max(l.minzoom ?? 0, LOCAL_LOW_ZOOM_MAXZOOM + 1),
}))

export function protomapsBlackStyle(): StyleSpecification {
  const tileSource = getTileSource()
  const isCDN = tileSource.startsWith("https://")

  if (!isCDN) {
    // Self-hosted full planet PMTiles — a single local source already covers
    // every zoom level, so it isn't affected by the CDN's low-zoom gaps.
    return {
      version: 8,
      name: "Ex Situ Black",
      glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
      sprite: "https://protomaps.github.io/basemaps-assets/sprites/v4/black",
      sources: {
        protomaps: {
          type: "vector",
          url: tileSource,
          attribution: "© Protomaps © OpenStreetMap",
        },
        ...exSituLabelSources,
      },
      layers: withArcAnchor([...blackFinalLayers, ...exSituLabelLayers]),
    } as StyleSpecification
  }

  return {
    version: 8,
    name: "Ex Situ Black",
    glyphs:
      "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
    sprite:
      "https://protomaps.github.io/basemaps-assets/sprites/v4/black",
    sources: {
      "protomaps-local": {
        type: "vector",
        url: LOCAL_LOW_ZOOM_PMTILES_URL,
        minzoom: 0,
        maxzoom: LOCAL_LOW_ZOOM_MAXZOOM,
        attribution: "© Protomaps © OpenStreetMap",
      },
      protomaps: {
        type: "vector",
        tiles: [tileSource],
        minzoom: LOCAL_LOW_ZOOM_MAXZOOM + 1,
        maxzoom: 15,
        attribution: "© Protomaps © OpenStreetMap",
      },
      ...exSituLabelSources,
    },
    layers: withArcAnchor([...localLowZoomLayers, ...cdnLayersAboveLowZoom, ...exSituLabelLayers]),
  } as StyleSpecification
}

// Active style — swap this line to switch themes
export { protomapsBlackStyle as protomapsDarkStyle }

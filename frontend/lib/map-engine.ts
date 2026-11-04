// The heavy part of the map page: MapLibre, deck.gl and the basemap style are over half of
// its JavaScript. map-view.tsx imports this after mount, so the panels don't wait for it.
import maplibregl from "maplibre-gl"
import { Protocol } from "pmtiles"
import { MapboxOverlay } from "@deck.gl/mapbox"
import { ArcLayer, ScatterplotLayer } from "@deck.gl/layers"
import { ARC_ANCHOR_LAYER, protomapsDarkStyle } from "@/lib/protomaps-dark-style"

// Lets MapLibre read .pmtiles files directly.
maplibregl.addProtocol("pmtiles", new Protocol().tile)

// Protomaps dark style — see lib/protomaps-dark-style.ts
// For full data sovereignty, the PMTiles planet file can be downloaded from
// https://protomaps.com/downloads and served as a static file from
// /public/basemap.pmtiles — this eliminates all external tile dependencies.
export const DARK_STYLE = protomapsDarkStyle()

export { maplibregl, MapboxOverlay, ArcLayer, ScatterplotLayer, ARC_ANCHOR_LAYER }

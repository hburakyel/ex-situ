// Selective re-export: only Protocol is used by the app.
// Importing from this shim instead of "pmtiles" directly ensures webpack
// can tree-shake the unused leafletRasterLayer export, which otherwise
// triggers Wappalyzer's "Leaflet" detection.
export { Protocol } from "pmtiles"

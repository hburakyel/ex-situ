/**
 * Shared types between the main thread and arc-worker.
 * No runtime code — types only. Both sides import from here.
 */

import type { GeospatialResponse, MuseumObject } from "@/types"

// ── Data types produced by the worker ──────────────────────────────

export interface ArcDatum {
  sourcePosition: [number, number]
  targetPosition: [number, number]
  fromName: string
  toName: string
  fromCity: string
  fromCountry: string
  toCity: string
  toCountry: string
  count: number
  sampleImgUrl?: string
  /** Network centrality — connection count of the source node (depth indicator) */
  connectionCount?: number
}

export interface ArcCardData {
  from: string
  to: string
  fromCity: string
  fromCountry: string
  fromLat: number | undefined
  fromLng: number | undefined
  toCity: string
  toCountry: string
  imgUrl: string
  count: number
  /** Serialized as string[] across the worker boundary (Set is not cloneable) */
  institutions: string[]
}

export type DataSource =
  | "geospatial-country"
  | "geospatial-city"
  | "geospatial-objects"
  | "fallback"
  | "none"

export interface ProcessedArcsResult {
  arcLayerData: ArcDatum[]
  arcCards: ArcCardData[]
  uniqueArcCount: number
  dataSource: DataSource
  layerStyle: {
    sourceColor: [number, number, number]
    targetColor: [number, number, number]
  }
}

// ── Messages: Main Thread → Worker ─────────────────────────────────

export interface ProcessGeospatialMessage {
  type: "process-geospatial"
  /** Monotonic job ID — worker discards results for stale IDs */
  jobId: number
  geospatialData: GeospatialResponse | null
  /** 
   * Fallback objects (legacy Strapi REST).
   * Sent as a flat array of attribute objects to avoid cloning MuseumObject wrapper.
   */
  fallbackObjects: FlatObjectAttrs[] | null
}

export interface CancelMessage {
  type: "cancel"
}

export type WorkerInMessage = ProcessGeospatialMessage | CancelMessage

// ── Messages: Worker → Main Thread ─────────────────────────────────

export interface ResultMessage {
  type: "result"
  jobId: number
  result: ProcessedArcsResult
}

export interface ErrorMessage {
  type: "error"
  jobId: number
  error: string
}

export type WorkerOutMessage = ResultMessage | ErrorMessage

// ── Flat attribute struct for transfer (avoids cloning MuseumObject) ─

export interface FlatObjectAttrs {
  longitude: number
  latitude: number
  institution_longitude: number
  institution_latitude: number
  place_name?: string
  institution_place?: string
  institution_name: string
  city_en?: string
  country_en?: string
  institution_city_en?: string
  institution_country_en?: string
  img_url?: string
}

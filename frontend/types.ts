export interface ObjectLink {
  id?: number
  link_text: string
  link_display?: string
  url?: string
}

export interface OriginalPlaceVariant {
  id?: number
  label?: string
  language?: string
  source?: string
}

export type GeocodingStatus = 'ok' | 'ambiguous' | 'disputed'
export type ReviewStatus = 'pending' | 'verified' | 'rejected'
export type OriginType = 'valid_location' | 'historical_toponym' | 'cultural_area' | 'archaeological_micro_location' | 'invalid'
export type EnrichmentConfidence = 'high' | 'medium' | 'low'

export interface MuseumObject {
  id: string
  attributes: {
    title: string
    img_url?: string
    longitude: number
    latitude: number
    inventory_number: string
    institution_name: string
    institution_longitude: number
    institution_latitude: number
    place_name?: string
    institution_place?: string
    country?: string
    country_en?: string
    country_native?: string
    city_en?: string
    city_native?: string
    institution_city_en?: string
    institution_city_native?: string
    institution_country_en?: string
    source_link?: string
    link_text?: string
    object_links?: ObjectLink[]
    original_place_variants?: OriginalPlaceVariant[]
    geocoded_country?: string
    geocoded_region?: string
    geocoder_source?: string
    geocoding_confidence?: number
    geocoding_status?: GeocodingStatus
    geocoding_notes?: string
    manual_latitude?: number
    manual_longitude?: number
    review_status?: ReviewStatus
    origin_type?: OriginType
    normalized_origin?: string
    cultural_context?: string
    transfer_method?: string
    historical_relation?: string
    enrichment_confidence?: EnrichmentConfidence
  }
}

export interface MapBounds {
  north: number
  south: number
  east: number
  west: number
}

// Selected arc for filtering objects
export interface SelectedArc {
  key: string           // Unique key for the arc (from-to)
  from: string          // Origin place name
  to: string            // Destination/institution place  
  fromLat: number
  fromLng: number
  toLat?: number
  toLng?: number
  fromCity?: string
  fromCountry?: string
  toCity?: string
  toCountry?: string
  objectCount?: number  // Total object count from geospatial API
}

export interface SearchResult {
  name: string
  longitude: number
  latitude: number
}

export interface CountryAggregation {
  country: string
  count: number
  latitude: number
  longitude: number
}

export interface CityAggregation {
  city: string
  country: string
  count: number
  latitude: number
  longitude: number
}

// Geospatial API Types
export type GeospatialDataType = 'statistics' | 'clusters' | 'objects'

export interface GeospatialBbox {
  minLon: number
  minLat: number
  maxLon: number
  maxLat: number
}

// Aggregated arc data (zoom < 5 and zoom 5-9)
// Matches backend API response from getCountryStatistics and getClusteredData
export interface AggregatedArc {
  place_name: string           // origin place name (country at zoom<5, city at zoom 5-9)
  latitude: number             // origin latitude
  longitude: number            // origin longitude
  institution_name: string
  institution_place: string    // same as institution_name
  institution_latitude: number
  institution_longitude: number
  object_count: number
  sample_img_url?: string      // optional sample image URL
  type: 'arc'
  cluster_id: string
}

// Legacy types for backwards compatibility
export interface CountryStatistic extends AggregatedArc {}

// Sample object in clusters
export interface SampleObject {
  object_id: string | number
  title: string
  latitude: number
  longitude: number
  img_url?: string
}

// Cluster point (zoom 5-9) - now returns arcs
export interface ClusterPoint extends AggregatedArc {}

// Individual object (zoom 10+)
export interface GeospatialObject {
  id: number
  object_id: string | number
  title: string
  img_url?: string
  latitude: number
  longitude: number
  country_en: string
  city_en?: string
  institution_name: string
  place_name?: string
  source_link?: string
  inventory_number?: string
  institution_latitude?: number
  institution_longitude?: number
  geocoded_country?: string
  geocoded_region?: string
  geocoder_source?: string
  geocoding_confidence?: number
  geocoding_status?: GeocodingStatus
  geocoding_notes?: string
  manual_latitude?: number
  manual_longitude?: number
  review_status?: ReviewStatus
  origin_type?: OriginType
  normalized_origin?: string
  cultural_context?: string
  transfer_method?: string
  historical_relation?: string
  enrichment_confidence?: EnrichmentConfidence
  type: 'object'
  cluster_id: string
}

// Response types
export interface GeospatialStatisticsResponse {
  zoom: number
  bbox: null
  type: 'statistics'
  data: CountryStatistic[]
}

export interface GeospatialClustersResponse {
  zoom: number
  bbox: GeospatialBbox
  type: 'clusters'
  gridSize: number
  data: ClusterPoint[]
}

export interface GeospatialObjectsResponse {
  zoom: number
  bbox: GeospatialBbox
  type: 'objects'
  count: number
  data: GeospatialObject[]
}

export type GeospatialResponse = 
  | GeospatialStatisticsResponse 
  | GeospatialClustersResponse 
  | GeospatialObjectsResponse

// --- Spatial Documents (Wikipedia, research notes, etc.) ---

export type SpatialDocumentContentType = 'wikipedia' | 'research_note' | 'news' | 'other'

export interface SpatialDocument {
  id: number
  content_type: SpatialDocumentContentType
  title: string
  description?: string
  img_url?: string
  source_url?: string
  source_name?: string
  language?: string
  latitude: number
  longitude: number
  geocoding_confidence?: number
  geocoding_source?: string
  review_status?: ReviewStatus
  tags?: string[]
  created_at?: string
  type: 'document'
  cluster_id: string
}

export interface SpatialDocumentCluster {
  latitude: number
  longitude: number
  source_name: string
  doc_count: number
  sample_img_url?: string
  sample_title: string
  content_types: SpatialDocumentContentType[]
  type: 'document_cluster'
  cluster_id: string
}

export interface SpatialDocumentClustersResponse {
  zoom: number
  bbox: GeospatialBbox | null
  type: 'document_clusters'
  data: SpatialDocumentCluster[]
}

export interface SpatialDocumentsResponse {
  zoom: number
  bbox: GeospatialBbox | null
  type: 'documents'
  count: number
  data: SpatialDocument[]
}

export type SpatialDocumentResponse =
  | SpatialDocumentClustersResponse
  | SpatialDocumentsResponse

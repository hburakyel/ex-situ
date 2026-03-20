// ─── Resolver Dashboard Types — Real data from backend ────────────────────

export interface ResolverTotals {
  totalObjects: number
  totalGeocoded: number
  totalInstitutions: number
  totalCountries: number
  globalAvgConfidence: number
}

export interface InstitutionStats {
  name: string
  place: string
  latitude: number
  longitude: number
  totalObjects: number
  geocodedCount: number
  resolvedPct: number
  avgConfidence: number
  geocoderSource: {
    postgis: number
    nominatim: number
  }
  geocodingStatus: {
    ok: number
    ambiguous: number
    disputed: number
  }
  reviewStatus: {
    pending: number
    verified: number
    rejected: number
  }
  originTypes: {
    valid: number
    historical: number
    cultural: number
    micro: number
    invalid: number
  }
  enrichedCount: number
  distinctCountries: number
  sampleImgUrl: string | null
}

export interface ResolverStatsResponse {
  totals: ResolverTotals
  institutions: InstitutionStats[]
}

// Detail endpoint types
export interface CountryBreakdown {
  country: string
  count: number
  avgConfidence: number
}

export interface RecentObject {
  id: number
  title: string
  latitude: number | null
  longitude: number | null
  country: string | null
  city: string | null
  confidence: number | null
  status: string | null
  reviewStatus: string | null
  originType: string | null
  imgUrl: string | null
  placeName: string | null
  sourceLink: string | null
  updatedAt: string
}

export interface ConfidenceBucket {
  bucket: string
  count: number
}

export interface ResolverDetailResponse {
  institution: string
  topCountries: CountryBreakdown[]
  recentObjects: RecentObject[]
  confidenceDistribution: ConfidenceBucket[]
}

// ─── Pending corrections types ────────────────────────────────────────────

export interface PendingCorrectionObject {
  id: number
  objectId: number | null
  title: string | null
  imgUrl: string | null
  placeName: string | null
  countryEn: string | null
  cityEn: string | null
  latitude: number | null
  longitude: number | null
  manualLatitude: number | null
  manualLongitude: number | null
  geocodingConfidence: number | null
  geocodingStatus: string | null
  geocodingNotes: string | null
  reviewStatus: string
  institutionName: string | null
}

export interface PendingCorrectionsResponse {
  data: PendingCorrectionObject[]
  meta: {
    pagination: {
      page: number
      pageSize: number
      total: number
      pageCount: number
    }
  }
}

// ─── ETL source metadata (static, known from codebase) ──────────────────────

export type ScrapingMethod = "museum-digital API" | "HTML scrape" | "Open API"
export type GeocodingMethod = "direct coord" | "nominatim" | "postgis + nominatim"

export interface ETLSourceMeta {
  institutionName: string
  city: string
  country: string
  method: ScrapingMethod
  geocoding: GeocodingMethod
  category: 1 | 2 | 3
  sourceUrl: string
  etlScript: string
  rateLimit?: string
}

// Known ETL sources from the codebase
export const ETL_SOURCES: Record<string, ETLSourceMeta> = {
  "Ethnologisches Museum": {
    institutionName: "Ethnologisches Museum",
    city: "Berlin",
    country: "Germany",
    method: "museum-digital API",
    geocoding: "direct coord",
    category: 1,
    sourceUrl: "https://smb.museum-digital.de/institution/11",
    etlScript: "scrape_smb_api.py",
  },
  "Antikensammlung": {
    institutionName: "Antikensammlung",
    city: "Berlin",
    country: "Germany",
    method: "museum-digital API",
    geocoding: "direct coord",
    category: 1,
    sourceUrl: "https://smb.museum-digital.de/institution/10",
    etlScript: "new_scrape_smb_am_api.py",
  },
  "Museum für Asiatische Kunst": {
    institutionName: "Museum für Asiatische Kunst",
    city: "Berlin",
    country: "Germany",
    method: "museum-digital API",
    geocoding: "direct coord",
    category: 1,
    sourceUrl: "https://smb.museum-digital.de/institution/3",
    etlScript: "scrape_smb_ak_api.py",
  },
  "Vorderasiatisches Museum": {
    institutionName: "Vorderasiatisches Museum",
    city: "Berlin",
    country: "Germany",
    method: "museum-digital API",
    geocoding: "direct coord",
    category: 1,
    sourceUrl: "https://smb.museum-digital.de/institution/8",
    etlScript: "scrape_smb_vm_api.py",
  },
  "Museum für Islamische Kunst": {
    institutionName: "Museum für Islamische Kunst",
    city: "Berlin",
    country: "Germany",
    method: "museum-digital API",
    geocoding: "direct coord",
    category: 1,
    sourceUrl: "https://smb.museum-digital.de/institution/5",
    etlScript: "scrape_smb_mfik_api.py",
  },
  "Ägyptisches Museum und Papyrussammlung": {
    institutionName: "Ägyptisches Museum und Papyrussammlung",
    city: "Berlin",
    country: "Germany",
    method: "museum-digital API",
    geocoding: "direct coord",
    category: 1,
    sourceUrl: "https://smb.museum-digital.de/institution/9",
    etlScript: "scrape_smb_amp_api.py",
  },
  "Museum für Vor- und Frühgeschichte": {
    institutionName: "Museum für Vor- und Frühgeschichte",
    city: "Berlin",
    country: "Germany",
    method: "museum-digital API",
    geocoding: "direct coord",
    category: 1,
    sourceUrl: "https://smb.museum-digital.de/institution/4",
    etlScript: "scrape_smb_mfvf_api.py",
  },
  "Münzkabinett": {
    institutionName: "Münzkabinett",
    city: "Berlin",
    country: "Germany",
    method: "museum-digital API",
    geocoding: "direct coord",
    category: 1,
    sourceUrl: "https://smb.museum-digital.de/institution/2",
    etlScript: "scrape_smb_api.py",
  },
  "British Museum": {
    institutionName: "British Museum",
    city: "London",
    country: "United Kingdom",
    method: "HTML scrape",
    geocoding: "nominatim",
    category: 2,
    sourceUrl: "https://www.britishmuseum.org/collection",
    etlScript: "scrape_british_museum.py",
    rateLimit: "1 req/s",
  },
  "The Metropolitan Museum of Art": {
    institutionName: "The Metropolitan Museum of Art",
    city: "New York",
    country: "United States",
    method: "Open API",
    geocoding: "postgis + nominatim",
    category: 3,
    sourceUrl: "https://metmuseum.github.io/",
    etlScript: "scrape_met_api.py",
    rateLimit: "~3 req/s",
  },
}

export function getETLMeta(institutionName: string): ETLSourceMeta | null {
  return ETL_SOURCES[institutionName] ?? null
}

// Category labels
export function categoryLabel(cat: 1 | 2 | 3): string {
  switch (cat) {
    case 1: return "direct coord"
    case 2: return "nominatim"
    case 3: return "postgis + fallback"
  }
}

// Determine resolver "health" status from stats
export function resolverStatus(inst: InstitutionStats): "ok" | "warn" | "err" {
  if (inst.resolvedPct >= 80 && inst.avgConfidence >= 0.6) return "ok"
  if (inst.resolvedPct >= 50 || inst.avgConfidence >= 0.4) return "warn"
  return "err"
}

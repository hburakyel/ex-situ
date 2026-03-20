import type { MuseumObject, MapBounds, SearchResult, GeospatialResponse, GeospatialBbox, SpatialDocumentResponse } from "../types"

// Node 18+ undici resolves "localhost" to IPv6 ::1; Strapi binds IPv4 only.
function fixLocalhost(url: string): string {
  return url.replace("://localhost", "://127.0.0.1")
}

// Simple in-memory cache with bounds-based keys
const apiCache: Record<string, { data: any; timestamp: number }> = {}
const CACHE_DURATION = 10 * 60 * 1000 // 10 minutes in milliseconds

// Rate limiting variables
let lastRequestTime = 0
const MIN_REQUEST_INTERVAL = 200 // Minimum 200ms between requests

// Function to wait for a specified time
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Generate a cache key for bounds
function getBoundsCacheKey(bounds: MapBounds, page: number, pageSize: number, zoom: number): string {
  // Round bounds to reduce cache fragmentation
  const roundedBounds = {
    north: Math.round(bounds.north * 10) / 10,
    south: Math.round(bounds.south * 10) / 10,
    east: Math.round(bounds.east * 10) / 10,
    west: Math.round(bounds.west * 10) / 10,
  }

  return `bounds:${JSON.stringify(roundedBounds)}:page:${page}:size:${pageSize}:zoom:${Math.floor(zoom)}`
}

// Function to make a rate-limited API request with caching and retry logic
async function fetchWithRateLimit(
  url: string,
  options: RequestInit = {},
  retries = 3,
  cacheKey?: string,
): Promise<any> {
  // Check cache first if a cache key is provided
  if (cacheKey && apiCache[cacheKey] && Date.now() - apiCache[cacheKey].timestamp < CACHE_DURATION) {
    console.log("Using cached data for:", url)
    return apiCache[cacheKey].data
  }

  // Implement rate limiting
  const now = Date.now()
  const timeSinceLastRequest = now - lastRequestTime

  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest
    console.log(`Rate limiting: waiting ${waitTime}ms before next request`)
    await wait(waitTime)
  }

  lastRequestTime = Date.now()

  try {
    console.log("Fetching from API:", url)
    const response = await fetch(url, options)

    if (!response.ok) {
      // Handle rate limiting specifically
      if (response.status === 429) {
        if (retries > 0) {
          // Get retry-after header or use exponential backoff
          const retryAfter =
            Number.parseInt(response.headers.get("retry-after") || "0") * 1000 || Math.pow(2, 4 - retries) * 1000
          console.log(`Rate limited. Retrying after ${retryAfter}ms. Retries left: ${retries - 1}`)
          await wait(retryAfter)
          return fetchWithRateLimit(url, options, retries - 1, cacheKey)
        } else {
          throw new Error(`Rate limit exceeded. Please try again later.`)
        }
      }

      const errorText = await response.text()
      throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`)
    }

    const data = await response.json()

    // Cache the successful response if a cache key is provided
    if (cacheKey) {
      apiCache[cacheKey] = { data, timestamp: Date.now() }
    }

    return data
  } catch (error) {
    if (error instanceof Error && error.message.includes("Rate limit") && retries > 0) {
      // Retry with exponential backoff for network errors too
      const retryAfter = Math.pow(2, 4 - retries) * 1000
      console.log(`Network error. Retrying after ${retryAfter}ms. Retries left: ${retries - 1}`)
      await wait(retryAfter)
      return fetchWithRateLimit(url, options, retries - 1, cacheKey)
    }
    throw error
  }
}

// Function to fetch country-level aggregated data
export async function fetchCountryAggregations() {
  const cacheKey = "country-aggregations"

  // Check cache first
  if (apiCache[cacheKey] && Date.now() - apiCache[cacheKey].timestamp < CACHE_DURATION) {
    return apiCache[cacheKey].data
  }

  try {
    const data = await fetchStatsData()
    const result = {
      data: data.countries,
      meta: { total: data.countries.length }
    }

    apiCache[cacheKey] = { data: result, timestamp: Date.now() }
    return result
  } catch (error) {
    console.error("Error fetching country aggregations:", error)
    return { data: [], meta: { total: 0 } }
  }
}

// Function to fetch city-level aggregated data
export async function fetchCityAggregations(bounds: MapBounds) {
  const cacheKey = `city-aggregations:${JSON.stringify(bounds)}`

  // Check cache first
  if (apiCache[cacheKey] && Date.now() - apiCache[cacheKey].timestamp < CACHE_DURATION) {
    return apiCache[cacheKey].data
  }

  try {
    const data = await fetchStatsData()
    // For now, filter cities that have at least some presence in the bounds if possible, 
    // but the stats API gives global city stats.
    const result = {
      data: data.cities,
      meta: { total: data.cities.length }
    }

    apiCache[cacheKey] = { data: result, timestamp: Date.now() }
    return result
  } catch (error) {
    console.error("Error fetching city aggregations:", error)
    return { data: [], meta: { total: 0 } }
  }
}

// Function to fetch global stats data including coordinates
export async function fetchStatsData() {
  const cacheKey = "global-stats-data"

  if (apiCache[cacheKey] && Date.now() - apiCache[cacheKey].timestamp < CACHE_DURATION) {
    return apiCache[cacheKey].data
  }

  try {
    const isServer = typeof window === "undefined"
    // On server, we need an absolute URL. We'll use NEXT_PUBLIC_API_BASE_URL 
    // to derive the host if possible, or rely on the fact that this is usually 
    // called within the same host. For now, since NEXT_PUBLIC_API_BASE_URL is 
    // likely on a different domain (Strapi), we'll assume the local API is 
    // reachable via localhost or similar. However, the most robust way is 
    // to use the absolute URL for the frontend.
    let url = "/api/stats"
    if (isServer) {
      // In a real production app, we'd use an environment variable for the frontend URL
      // For now, let's try to infer it or at least log the attempt
      const origin = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"
      url = fixLocalhost(`${origin}/api/stats`)
    }

    const response = await fetch(url)
    if (!response.ok) throw new Error("Failed to fetch stats")
    const data = await response.json()

    apiCache[cacheKey] = { data, timestamp: Date.now() }
    return data
  } catch (error) {
    console.error("Error fetching stats data:", error)
    throw error
  }
}

// Function to fetch museum objects with optimized fields based on zoom level
export async function fetchMuseumObjects(bounds: MapBounds, page = 1, pageSize = 50, zoom = 0) {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL
 

  // Ensure bounds are valid and not too restrictive
  const validBounds = {
    north: Math.min(bounds.north, 90),
    south: Math.max(bounds.south, -90),
    east: Math.min(bounds.east, 180),
    west: Math.max(bounds.west, -180),
  }

  // Remove the fields parameter as it's causing validation errors
  // Instead, we'll filter the data after receiving it
  const params = new URLSearchParams({
    [`filters[latitude][$gte]`]: validBounds.south.toString(),
    [`filters[latitude][$lte]`]: validBounds.north.toString(),
    [`filters[longitude][$gte]`]: validBounds.west.toString(),
    [`filters[longitude][$lte]`]: validBounds.east.toString(),
    "pagination[pageSize]": pageSize.toString(),
    "pagination[page]": page.toString(),
    populate: "*",
  })

  try {
    const isServer = typeof window === "undefined"
    let url = ""

    if (isServer) {
      // On server, call the API directly using the base URL
      url = fixLocalhost(`${apiBaseUrl}/museum-objects?${params.toString()}`)
    } else {
      // On client, use our local proxy
      url = `/api/proxy?${params.toString()}`
    }

    console.log("Full API URL being fetched:", url)
    console.log("Bounds used for fetch:", validBounds)

    // Generate a cache key based on the bounds, pagination, and zoom level
    const cacheKey = getBoundsCacheKey(validBounds, page, pageSize, zoom)

    const data = await fetchWithRateLimit(
      url,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      },
      3, // 3 retries
      cacheKey, // Pass the cache key
    )

    console.log("API response:", data)

    if (!data || !Array.isArray(data.data)) {
      console.error("Invalid data structure received from API:", data)
      throw new Error("Invalid data structure received from API")
    }

    // If no objects found, log a clear message
    if (data.data.length === 0) {
      console.log("No objects found in the current bounds. Try zooming out or panning to a different area.")
    }

    // Process the data to ensure we use the fields directly
    const processedObjects = data.data.map((obj: MuseumObject) => {
      // No need to extract or derive fields - use them directly
      return obj
    })

    return {
      objects: processedObjects,
      pagination: data.meta.pagination,
    }
  } catch (error) {
    console.error("Error fetching museum objects:", error)
    if (error instanceof Error) {
      console.error("Error name:", error.name)
      console.error("Error message:", error.message)
      if (error instanceof TypeError && error.message.includes("fetch")) {
        console.error(
          "This might be a network error. Please check if the API is accessible from the deployed environment.",
        )
      }
      throw new Error(`Failed to fetch museum objects: ${error.message}`)
    } else {
      console.error("Unknown error type:", typeof error)
      throw new Error("An unknown error occurred while fetching museum objects")
    }
  }
}

// Function to search museum objects by text query (independent of map bounds)
export async function searchMuseumObjects(query: string, page = 1, pageSize = 50) {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL
  if (!apiBaseUrl) {
    throw new Error("API_BASE_URL is not set")
  }

  const params = new URLSearchParams({
    "_q": query,
    "pagination[pageSize]": pageSize.toString(),
    "pagination[page]": page.toString(),
    "populate": "*",
  })

  try {
    const isServer = typeof window === "undefined"
    const url = isServer
      ? fixLocalhost(`${apiBaseUrl}/museum-objects?${params.toString()}`)
      : `/api/proxy?${params.toString()}`

    const cacheKey = `search:${query}:page:${page}:size:${pageSize}`

    const data = await fetchWithRateLimit(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    }, 3, cacheKey)

    if (!data || !Array.isArray(data.data)) {
      throw new Error("Invalid data structure received from search API")
    }

    return {
      objects: data.data as MuseumObject[],
      pagination: data.meta.pagination as { page: number; pageSize: number; pageCount: number; total: number },
    }
  } catch (error) {
    console.error("Error searching museum objects:", error)
    if (error instanceof Error) {
      throw new Error(`Failed to search museum objects: ${error.message}`)
    }
    throw new Error("An unknown error occurred while searching museum objects")
  }
}

// Function to fetch a limited set of objects for initial filtering
export async function fetchAllMuseumObjects(pageSize = 50) {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL
 

  try {
    // First, get the total count with a small request
    const countParams = new URLSearchParams({
      "pagination[pageSize]": "1",
      "pagination[page]": "1",
    })

    const countUrl = `/api/proxy?${countParams.toString()}`
    const countData = await fetchWithRateLimit(countUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    })

    const totalCount = countData.meta.pagination.total

    // Increase pageSize to get more objects for better arc selection
    const actualPageSize = Math.min(200, pageSize) // Get up to 200 objects for better selection

    console.log(`Fetching ${actualPageSize} objects (total available: ${totalCount})`)

    // Remove the fields parameter as it's causing validation errors
    const params = new URLSearchParams({
      "pagination[pageSize]": actualPageSize.toString(),
      "pagination[page]": "1",
      populate: "*",
    })

    const isServer = typeof window === "undefined"
    let url = ""

    if (isServer) {
      // On server, call the API directly using the base URL
      url = fixLocalhost(`${apiBaseUrl}/museum-objects?${params.toString()}`)
    } else {
      // On client, use our local proxy
      url = `/api/proxy?${params.toString()}`
    }

    console.log(`Fetching initial data:`, url)

    const data = await fetchWithRateLimit(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    })

    if (!data || !Array.isArray(data.data)) {
      console.error("Invalid data structure received from API:", data)
      throw new Error("Invalid data structure received from API")
    }

    // Process the data to ensure we use the fields directly
    const processedObjects = data.data.map((obj: MuseumObject) => {
      // No need to extract or derive fields - use them directly
      return obj
    })

    console.log(`Successfully fetched ${processedObjects.length} objects for initial load`)

    return {
      objects: processedObjects,
      pagination: {
        page: 1,
        pageSize: processedObjects.length,
        pageCount: Math.ceil(totalCount / actualPageSize),
        total: totalCount,
      },
    }
  } catch (error) {
    console.error("Error fetching all museum objects:", error)

    // Return empty data instead of mock data
    return {
      objects: [],
      pagination: {
        page: 1,
        pageSize: pageSize,
        pageCount: 1,
        total: 0,
      },
    }
  }
}

// Update the searchLocation function to handle errors better
// Find the searchLocation function and update it to ensure it's working correctly:
export async function searchLocation(query: string): Promise<SearchResult | null> {
  try {
    const params = new URLSearchParams({ q: query, limit: "1" })

    const isServer = typeof window === "undefined"
    let url = `/api/geocode?${params.toString()}`
    if (isServer) {
      const origin = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"
      url = fixLocalhost(`${origin}${url}`)
    }

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Search API returned status: ${response.status}`)
    }

    const data = await response.json()

    if (data.features?.length > 0) {
      const [lng, lat] = data.features[0].center
      const placeName = data.features[0].place_name
        .split(",")
        .map((part: string) => part.trim())
        .filter((part: string) => part !== "")
        .slice(0, 2)
        .join(", ")

      console.log("Found location:", { name: placeName, longitude: lng, latitude: lat })

      return {
        name: placeName,
        longitude: lng,
        latitude: lat,
      }
    }

    console.log("No location found for query:", query)
    return null
  } catch (error) {
    console.error("Error searching location:", error)
    // Return null instead of throwing to prevent breaking the UI
    return null
  }
}

// Function to fetch geospatial data with zoom-based aggregation
export async function fetchGeospatialData(
  zoom: number,
  bounds?: { minLon: number; minLat: number; maxLon: number; maxLat: number },
  filters?: { institutions?: string[]; countries?: string[]; cities?: string[] }
): Promise<GeospatialResponse> {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL

  const floorZoom = Math.floor(zoom)
  
  // Build query parameters
  const params = new URLSearchParams({
    zoom: floorZoom.toString(),
  })

  // Add bounding box only for zoom >= 7 (object level)
  // City-level (4-7) and country-level (< 4) show all arcs globally
  if (floorZoom >= 7 && bounds) {
    params.append('minLon', bounds.minLon.toString())
    params.append('minLat', bounds.minLat.toString())
    params.append('maxLon', bounds.maxLon.toString())
    params.append('maxLat', bounds.maxLat.toString())
  }

  // Add filters (arrays joined with comma for API)
  if (filters?.institutions && filters.institutions.length > 0) {
    params.append('institution', filters.institutions.join(','))
  }
  if (filters?.cities && filters.cities.length > 0) {
    params.append('city', filters.cities.join(','))
  }
  if (filters?.countries && filters.countries.length > 0) {
    params.append('country', filters.countries.join(','))
  }

  // Generate cache key (sorted for consistency)
  const institutionsKey = filters?.institutions?.sort().join(',') || 'all'
  const citiesKey = filters?.cities?.sort().join(',') || 'all'
  const countriesKey = filters?.countries?.sort().join(',') || 'all'
  const cacheKey = `geospatial:${floorZoom}:${bounds ? JSON.stringify(bounds) : 'global'}:${institutionsKey}:${citiesKey}:${countriesKey}`

  try {
    const isServer = typeof window === "undefined"
    let url = ""

    if (isServer) {
      url = fixLocalhost(`${apiBaseUrl}/museum-objects/geospatial?${params.toString()}`)
    } else {
      // Use proxy for client-side calls
      url = `/api/proxy/geospatial?${params.toString()}`
    }

    console.log(`[Geospatial API] Fetching zoom=${floorZoom}`, bounds ? `bbox=[${bounds.minLon.toFixed(2)},${bounds.minLat.toFixed(2)},${bounds.maxLon.toFixed(2)},${bounds.maxLat.toFixed(2)}]` : 'global')

    const data = await fetchWithRateLimit(
      url,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      },
      3,
      cacheKey
    )

    console.log(`[Geospatial API] Response type=${data.type}, count=${data.data?.length || 0}`)
    return data as GeospatialResponse
  } catch (error) {
    console.error("Error fetching geospatial data:", error)
    throw error
  }
}

// Function to fetch objects filtered by country (and optionally site/institution) via PostGIS
export async function fetchObjectsByCountry(
  country: string,
  page = 1,
  pageSize = 60,
  site?: string,
  institution?: string,
): Promise<{ objects: MuseumObject[]; pagination: { page: number; pageSize: number; pageCount: number; total: number } }> {
  const params = new URLSearchParams({
    country,
    page: page.toString(),
    pageSize: pageSize.toString(),
  })
  if (site) params.append('site', site)
  if (institution) params.append('institution', institution)

  const cacheKey = `by-country:${country}:${site || ''}:${institution || ''}:page:${page}:size:${pageSize}`

  try {
    const isServer = typeof window === "undefined"
    const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL
    const url = isServer
      ? fixLocalhost(`${apiBaseUrl}/museum-objects/by-country?${params.toString()}`)
      : `/api/proxy/by-country?${params.toString()}`

    console.log(`[ByCountry API] country=${country} site=${site || '-'} institution=${institution || '-'} page=${page}`)

    const data = await fetchWithRateLimit(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    }, 3, cacheKey)

    if (!data || !Array.isArray(data.data)) {
      throw new Error("Invalid data structure from by-country endpoint")
    }

    return {
      objects: data.data as MuseumObject[],
      pagination: data.meta.pagination as { page: number; pageSize: number; pageCount: number; total: number },
    }
  } catch (error) {
    console.error("Error fetching objects by country:", error)
    throw error
  }
}

// Helper to convert MapBounds to GeospatialBbox format
export function mapBoundsToGeospatialBbox(bounds: MapBounds): GeospatialBbox {
  return {
    minLon: bounds.west,
    minLat: bounds.south,
    maxLon: bounds.east,
    maxLat: bounds.north,
  }
}

// Function to clear the cache
export function clearApiCache() {
  Object.keys(apiCache).forEach((key) => delete apiCache[key])
  console.log("API cache cleared")
}

/**
 * Fetch a single museum object by ID
 * @param id - The object ID (can be string or number)
 * @returns The museum object or null if not found
 */
export async function fetchMuseumObjectById(id: string | number): Promise<MuseumObject | null> {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL
 

  const cacheKey = `object:${id}`

  // Check cache first
  if (apiCache[cacheKey] && Date.now() - apiCache[cacheKey].timestamp < CACHE_DURATION) {
    console.log("Using cached object for:", id)
    return apiCache[cacheKey].data
  }

  try {
    const isServer = typeof window === "undefined"
    let url = ""

    if (isServer) {
      url = fixLocalhost(`${apiBaseUrl}/museum-objects/${id}?populate=*`)
    } else {
      url = `/api/proxy/object/${id}`
    }

    console.log(`Fetching object by ID: ${id}`)

    const data = await fetchWithRateLimit(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    }, 3, cacheKey)

    if (!data || !data.data) {
      console.log(`Object with ID ${id} not found`)
      return null
    }

    const object = data.data as MuseumObject
    console.log(`Successfully fetched object: ${object.attributes?.title || object.id}`)

    return object
  } catch (error) {
    console.error(`Error fetching object ${id}:`, error)
    return null
  }
}

// ---------- Spatial Documents (Wikipedia, research notes, etc.) ----------

export async function fetchSpatialDocuments(
  zoom: number,
  bounds?: { minLon: number; minLat: number; maxLon: number; maxLat: number },
  filters?: { contentType?: string }
): Promise<SpatialDocumentResponse> {
  const floorZoom = Math.floor(zoom)

  const params = new URLSearchParams({ zoom: floorZoom.toString() })

  if (bounds) {
    params.append("minLon", bounds.minLon.toString())
    params.append("minLat", bounds.minLat.toString())
    params.append("maxLon", bounds.maxLon.toString())
    params.append("maxLat", bounds.maxLat.toString())
  }

  if (filters?.contentType) {
    params.append("contentType", filters.contentType)
  }

  const cacheKey = `spatial-docs:${floorZoom}:${bounds ? JSON.stringify(bounds) : "global"}:${filters?.contentType || "all"}`

  try {
    const isServer = typeof window === "undefined"
    let url: string

    if (isServer) {
      const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL
      url = fixLocalhost(`${apiBaseUrl}/spatial-documents/geospatial?${params.toString()}`)
    } else {
      url = `/api/proxy/spatial-documents?${params.toString()}`
    }

    console.log(`[SpatialDoc API] Fetching zoom=${floorZoom}`, bounds ? `bbox` : "global")

    const data = await fetchWithRateLimit(url, { method: "GET" }, 3, cacheKey)
    return data as SpatialDocumentResponse
  } catch (error) {
    console.error("Error fetching spatial documents:", error)
    throw error
  }
}

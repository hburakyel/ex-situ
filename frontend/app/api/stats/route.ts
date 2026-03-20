import { NextResponse } from "next/server"
import { fetchMuseumObjects } from "@/lib/api"

// In-memory cache for stats
interface StatsCache {
  data: any
  timestamp: number
  isRefreshing: boolean
}

const statsCache: StatsCache = {
  data: null,
  timestamp: 0,
  isRefreshing: false,
}

// Cache duration in milliseconds (10 minutes)
const CACHE_DURATION = 10 * 60 * 1000

// Function to fetch and process stats
async function fetchStats() {
  try {
    // Fetch a larger sample of objects to get better statistics
    const { objects } = await fetchMuseumObjects(
      { north: 90, south: -90, east: 180, west: -180 },
      1,
      1000, // Increased sample size
    )

    // Process countries, cities and institutions with coordinates
    const countries: Record<string, { count: number; lat: number; lng: number; inst_lat: number; inst_lng: number }> = {}
    const cities: Record<string, { count: number; lat: number; lng: number; inst_lat: number; inst_lng: number }> = {}
    const institutions: Record<string, { count: number; lat: number; lng: number }> = {}

    objects.forEach((obj: any) => {
      const { latitude, longitude, institution_latitude, institution_longitude, country_en, city_en, institution_name } = obj.attributes

      const hasCoords = latitude && longitude
      const hasInstCoords = institution_latitude && institution_longitude

      // Helper to update aggregates
      const updateAggregate = (record: any, key: string, lat: number, lng: number, ilat?: number, ilng?: number) => {
        if (!record[key]) {
          record[key] = { count: 0, lat: 0, lng: 0, inst_lat: 0, inst_lng: 0 }
        }
        const data = record[key]
        data.count++
        if (lat && lng) {
          data.lat = (data.lat * (data.count - 1) + lat) / data.count
          data.lng = (data.lng * (data.count - 1) + lng) / data.count
        }
        if (ilat && ilng) {
          data.inst_lat = (data.inst_lat * (data.count - 1) + ilat) / data.count
          data.inst_lng = (data.inst_lng * (data.count - 1) + ilng) / data.count
        }
      }

      if (country_en) {
        updateAggregate(countries, country_en, latitude, longitude, institution_latitude, institution_longitude)
      }

      if (city_en) {
        updateAggregate(cities, city_en, latitude, longitude, institution_latitude, institution_longitude)
      }

      if (institution_name) {
        if (!institutions[institution_name]) {
          institutions[institution_name] = { count: 0, lat: 0, lng: 0 }
        }
        institutions[institution_name].count++
        if (institution_latitude && institution_longitude) {
          const inst = institutions[institution_name]
          inst.lat = (inst.lat * (inst.count - 1) + institution_latitude) / inst.count
          inst.lng = (inst.lng * (inst.count - 1) + institution_longitude) / inst.count
        }
      }
    })

    // Convert to sorted arrays
    const sortedCountries = Object.entries(countries)
      .map(([name, data]) => ({
        name,
        count: data.count,
        latitude: data.lat,
        longitude: data.lng,
        institution_latitude: data.inst_lat,
        institution_longitude: data.inst_lng
      }))
      .sort((a, b) => b.count - a.count)

    const sortedCities = Object.entries(cities)
      .map(([name, data]) => ({
        name,
        count: data.count,
        latitude: data.lat,
        longitude: data.lng,
        institution_latitude: data.inst_lat,
        institution_longitude: data.inst_lng
      }))
      .sort((a, b) => b.count - a.count)

    const sortedInstitutions = Object.entries(institutions)
      .map(([name, data]) => ({
        name,
        count: data.count,
        latitude: data.lat,
        longitude: data.lng
      }))
      .sort((a, b) => b.count - a.count)

    return {
      countries: sortedCountries,
      cities: sortedCities,
      institutions: sortedInstitutions,
      totalObjects: objects.length,
      timestamp: Date.now(),
    }
  } catch (error) {
    console.error("Error fetching stats:", error)
    throw error
  }
}

// Background refresh function
async function refreshStatsInBackground() {
  if (statsCache.isRefreshing) return

  statsCache.isRefreshing = true
  try {
    const newStats = await fetchStats()
    statsCache.data = newStats
    statsCache.timestamp = Date.now()
    console.log("Stats refreshed in background at", new Date().toISOString())
  } catch (error) {
    console.error("Background stats refresh failed:", error)
  } finally {
    statsCache.isRefreshing = false
  }
}

export async function GET() {
  try {
    const now = Date.now()

    // If cache is empty or expired, fetch synchronously
    if (!statsCache.data || now - statsCache.timestamp > CACHE_DURATION) {
      console.log("Stats cache miss - fetching new data")
      statsCache.data = await fetchStats()
      statsCache.timestamp = now
    } else {
      // If cache is valid but getting older, refresh in background
      if (now - statsCache.timestamp > CACHE_DURATION / 2 && !statsCache.isRefreshing) {
        console.log("Stats cache hit, but refreshing in background")
        refreshStatsInBackground()
      } else {
        console.log("Stats cache hit")
      }
    }

    return NextResponse.json(statsCache.data, {
      headers: {
        "Cache-Control": "public, max-age=600", // 10 minutes
        "X-Cache": "HIT",
        "X-Cache-Timestamp": new Date(statsCache.timestamp).toISOString(),
      },
    })
  } catch (error) {
    console.error("Error in stats API:", error)
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 })
  }
}

/**
 * arc-worker.ts — Web Worker for geospatial arc data processing.
 *
 * Moved here from the main thread's processedArcs useMemo.
 * All loops (.forEach, .map, Map grouping, .sort) run off the main thread.
 *
 * Protocol:
 *   Main → Worker:  { type: "process-geospatial", jobId, geospatialData, fallbackObjects }
 *   Worker → Main:  { type: "result", jobId, result }  |  { type: "error", jobId, error }
 *   Main → Worker:  { type: "cancel" }  — sets a flag so the current job bails out early
 *
 * The worker is long-lived (one per MapView). It processes one job at a time.
 *
 * NOTE: This file CANNOT import from @/ aliases or React.
 *       It only uses the plain TS types copied here to stay self-contained.
 */

// ── Inline types (mirrors workers/arc-types.ts exactly) ─────────────
// We duplicate instead of importing so the worker bundle stays standalone.

interface ArcDatum {
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
  connectionCount?: number
}

interface ArcCardData {
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
  institutions: string[]
}

type DataSource =
  | "geospatial-country"
  | "geospatial-city"
  | "geospatial-objects"
  | "fallback"
  | "none"

interface ProcessedArcsResult {
  arcLayerData: ArcDatum[]
  arcCards: ArcCardData[]
  uniqueArcCount: number
  dataSource: DataSource
  layerStyle: {
    sourceColor: [number, number, number]
    targetColor: [number, number, number]
  }
}

interface FlatObjectAttrs {
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

// ── Cancellation flag ───────────────────────────────────────────────

let cancelled = false

// ── Processing functions ────────────────────────────────────────────

const EMPTY: ProcessedArcsResult = {
  arcLayerData: [],
  arcCards: [],
  uniqueArcCount: 0,
  dataSource: "none",
  layerStyle: {
    sourceColor: [239, 95, 0],
    targetColor: [239, 95, 0],
  },
}

function processStatisticsOrClusters(
  data: any[],
  dataType: string
): ProcessedArcsResult {
  const isCountryLevel = dataType === "statistics"
  const arcLayerData: ArcDatum[] = []
  const arcCards: ArcCardData[] = []

  for (let i = 0; i < data.length; i++) {
    // Bail out early if a newer job was posted
    if (cancelled) return EMPTY

    const arc = data[i]
    const originLat = arc.latitude
    const originLon = arc.longitude
    const targetLat = arc.institution_latitude
    const targetLon = arc.institution_longitude

    if (
      originLat == null ||
      originLon == null ||
      targetLat == null ||
      targetLon == null ||
      isNaN(originLat) ||
      isNaN(originLon) ||
      isNaN(targetLat) ||
      isNaN(targetLon) ||
      (Math.abs(originLon - targetLon) <= 0.01 &&
        Math.abs(originLat - targetLat) <= 0.01)
    ) {
      continue
    }

    const fromName = arc.place_name || "Unknown Origin"
    const toName =
      arc.institution_name || arc.institution_place || "Unknown"
    const fromCity = isCountryLevel ? "" : arc.city_en || arc.place_name || ""
    const fromCountry = isCountryLevel
      ? arc.place_name || ""
      : arc.country_en || arc.geocoded_country || ""
    const toCity = arc.institution_city_en || ""
    const toCountry = arc.institution_country_en || ""
    const count = arc.object_count || 1

    arcLayerData.push({
      sourcePosition: [originLon, originLat],
      targetPosition: [targetLon, targetLat],
      fromName,
      toName,
      fromCity,
      fromCountry,
      toCity,
      toCountry,
      count,
      sampleImgUrl: arc.sample_img_url || "",
    })

    arcCards.push({
      from: fromName,
      to: toName,
      fromCity,
      fromCountry,
      fromLat: originLat,
      fromLng: originLon,
      toCity,
      toCountry,
      imgUrl: arc.sample_img_url || "",
      count,
      institutions: [arc.institution_name],
    })
  }

  arcCards.sort((a, b) => b.count - a.count)

  return {
    arcLayerData,
    arcCards,
    uniqueArcCount: arcLayerData.length,
    dataSource: isCountryLevel ? "geospatial-country" : "geospatial-city",
    layerStyle: {
      sourceColor: [239, 95, 0],
      targetColor: [239, 95, 0],
    },
  }
}

function processObjects(data: any[]): ProcessedArcsResult {
  const arcGroups = new Map<string, ArcDatum>()

  for (let i = 0; i < data.length; i++) {
    if (cancelled) return EMPTY

    const obj = data[i]
    if (
      !obj.latitude ||
      !obj.longitude ||
      !obj.institution_latitude ||
      !obj.institution_longitude
    )
      continue
    if (
      Math.abs(obj.longitude - obj.institution_longitude) < 0.001 &&
      Math.abs(obj.latitude - obj.institution_latitude) < 0.001
    )
      continue

    const key = `${obj.longitude.toFixed(3)},${obj.latitude.toFixed(3)}-${obj.institution_longitude.toFixed(3)},${obj.institution_latitude.toFixed(3)}`

    const fromCity = obj.city_en || obj.place_name || ""
    const fromCountry = obj.country_en || obj.geocoded_country || ""
    const toCity = obj.institution_city_en || ""
    const toCountry = obj.institution_country_en || ""
    const sampleImgUrl = obj.img_url || ""

    if (!arcGroups.has(key)) {
      arcGroups.set(key, {
        sourcePosition: [obj.longitude, obj.latitude],
        targetPosition: [obj.institution_longitude, obj.institution_latitude],
        fromName: obj.place_name || "Unknown Origin",
        toName: obj.institution_name || obj.institution_place || "Unknown Destination",
        fromCity,
        fromCountry,
        toCity,
        toCountry,
        count: 0,
        sampleImgUrl,
      })
    }

    const group = arcGroups.get(key)!
    group.count++
    if (!group.sampleImgUrl && sampleImgUrl) {
      group.sampleImgUrl = sampleImgUrl
    }
    if (!group.fromCity && fromCity) {
      group.fromCity = fromCity
    }
    if (!group.fromCountry && fromCountry) {
      group.fromCountry = fromCountry
    }
    if (!group.toCity && toCity) {
      group.toCity = toCity
    }
    if (!group.toCountry && toCountry) {
      group.toCountry = toCountry
    }
  }

  const arcLayerData = Array.from(arcGroups.values())

  const arcCards: ArcCardData[] = arcLayerData.map((d) => ({
    from: d.fromName,
    to: d.toName,
    fromCity: d.fromCity,
    fromCountry: d.fromCountry,
    fromLat: d.sourcePosition[1],
    fromLng: d.sourcePosition[0],
    toCity: d.toCity,
    toCountry: d.toCountry,
    imgUrl: d.sampleImgUrl || "",
    count: d.count,
    institutions: [d.toName],
  }))
  arcCards.sort((a, b) => b.count - a.count)

  return {
    arcLayerData,
    arcCards,
    uniqueArcCount: arcLayerData.length,
    dataSource: "geospatial-objects",
    layerStyle: {
      sourceColor: [239, 95, 0],
      targetColor: [239, 95, 0],
    },
  }
}

function processFallbackObjects(
  objects: FlatObjectAttrs[]
): ProcessedArcsResult {
  const arcGroups = new Map<string, ArcDatum>()
  const cardMap = new Map<
    string,
    ArcCardData & { _institutionSet: Set<string> }
  >()
  let uniqueCount = 0

  for (let i = 0; i < objects.length; i++) {
    if (cancelled) return EMPTY

    const obj = objects[i]
    const { longitude: fromLng, latitude: fromLat, institution_longitude: toLng, institution_latitude: toLat } = obj
    if (fromLng == null || fromLat == null || toLng == null || toLat == null) continue
    if (isNaN(fromLng) || isNaN(fromLat) || isNaN(toLng) || isNaN(toLat)) continue
    if (Math.abs(fromLng - toLng) < 0.001 && Math.abs(fromLat - toLat) < 0.001) continue

    const layerKey = `${fromLng.toFixed(4)},${fromLat.toFixed(4)}-${toLng.toFixed(4)},${toLat.toFixed(4)}`
    if (!arcGroups.has(layerKey)) {
      arcGroups.set(layerKey, {
        sourcePosition: [fromLng, fromLat],
        targetPosition: [toLng, toLat],
        fromName: obj.place_name || "Unknown Origin",
        toName: obj.institution_place || obj.institution_name || "Unknown Destination",
        fromCity: obj.city_en || "",
        fromCountry: obj.country_en || "",
        toCity: obj.institution_city_en || "",
        toCountry: obj.institution_country_en || "",
        count: 0,
      })
      uniqueCount++
    }
    arcGroups.get(layerKey)!.count++

    if (obj.place_name) {
      const cardKey = `${obj.place_name}-${obj.institution_place || obj.institution_name || "Unknown"}`
      if (!cardMap.has(cardKey)) {
        cardMap.set(cardKey, {
          from: obj.place_name,
          to: obj.institution_place || obj.institution_name || "Unknown",
          fromCity: obj.city_en || "",
          fromCountry: obj.country_en || "",
          fromLat: obj.latitude,
          fromLng: obj.longitude,
          toCity: obj.institution_city_en || "",
          toCountry: obj.institution_country_en || "",
          imgUrl: obj.img_url || "",
          count: 1,
          institutions: [],
          _institutionSet: new Set([obj.institution_name]),
        })
      } else {
        const card = cardMap.get(cardKey)!
        card.count++
        card._institutionSet.add(obj.institution_name)
        if (!card.imgUrl && obj.img_url) card.imgUrl = obj.img_url
      }
    }
  }

  // Finalize: convert Set → string[] for structured clone transfer
  const arcCards = Array.from(cardMap.values()).map(
    ({ _institutionSet, ...rest }) => ({
      ...rest,
      institutions: Array.from(_institutionSet),
    })
  )
  arcCards.sort((a, b) => b.count - a.count)

  return {
    arcLayerData: Array.from(arcGroups.values()),
    arcCards,
    uniqueArcCount: uniqueCount,
    dataSource: "fallback",
    layerStyle: {
      sourceColor: [239, 95, 0],
      targetColor: [239, 95, 0],
    },
  }
}

// ── Message handler ─────────────────────────────────────────────────

/* eslint-disable no-restricted-globals */
/// <reference lib="webworker" />
export {} // ensure file is treated as a module

addEventListener("message", (e: MessageEvent) => {
  const msg = e.data

  if (msg.type === "cancel") {
    cancelled = true
    return
  }

  if (msg.type === "process-geospatial") {
    cancelled = false
    const { jobId, geospatialData, fallbackObjects } = msg

    try {
      let result: ProcessedArcsResult = EMPTY

      // Path A: Geospatial API data
      if (geospatialData?.data && geospatialData.data.length > 0) {
        const dataType = geospatialData.type
        if (dataType === "statistics" || dataType === "clusters") {
          result = processStatisticsOrClusters(geospatialData.data, dataType)
        } else if (dataType === "objects") {
          result = processObjects(geospatialData.data)
        }
      }
      // Path B: Fallback legacy objects
      else if (fallbackObjects && fallbackObjects.length > 0) {
        result = processFallbackObjects(fallbackObjects)
      }

      // Only send result if not cancelled
      if (!cancelled) {
        postMessage({ type: "result", jobId, result })
      }
    } catch (err: any) {
      if (!cancelled) {
        postMessage({
          type: "error",
          jobId,
          error: err?.message || "Unknown worker error",
        })
      }
    }
  }
})

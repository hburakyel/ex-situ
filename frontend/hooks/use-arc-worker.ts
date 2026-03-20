"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import type { GeospatialResponse, MuseumObject } from "@/types"
import type {
  ProcessedArcsResult,
  ArcDatum,
  ArcCardData,
  DataSource,
  FlatObjectAttrs,
  WorkerOutMessage,
} from "@/workers/arc-types"

// Re-export for consumers
export type { ProcessedArcsResult, ArcDatum, ArcCardData, DataSource }

const EMPTY_RESULT: ProcessedArcsResult = {
  arcLayerData: [],
  arcCards: [],
  uniqueArcCount: 0,
  dataSource: "none",
  layerStyle: {
    sourceColor: [0, 100, 255],
    targetColor: [0, 200, 255],
  },
}

interface UseArcWorkerReturn {
  /** Fully processed arc data — ready for deck.gl + UI cards */
  processedArcs: ProcessedArcsResult
  /** True while the worker is crunching numbers */
  processing: boolean
}

/**
 * Hook that manages a long-lived Web Worker for arc data processing.
 *
 * Flow:
 *   1. Caller passes `geospatialData` (from API) or `fallbackObjects` (legacy REST)
 *   2. Hook sends a `process-geospatial` message to the worker
 *   3. If a new job arrives before the old one finishes, a `cancel` message is
 *      posted first — the worker checks a `cancelled` flag in every inner loop
 *   4. Worker posts back `{ type: "result", jobId, result }`
 *   5. Hook ignores results for stale jobIds
 *   6. Main thread receives pre-processed data with ZERO iteration
 *
 * Lifecycle: Worker is created on mount, terminated on unmount.
 */
export function useArcWorker(
  geospatialData: GeospatialResponse | null,
  fallbackObjects: MuseumObject[]
): UseArcWorkerReturn {
  const [processedArcs, setProcessedArcs] = useState<ProcessedArcsResult>(EMPTY_RESULT)
  const [processing, setProcessing] = useState(false)

  const workerRef = useRef<Worker | null>(null)
  const jobIdRef = useRef(0)
  const pendingJobRef = useRef<number | null>(null)

  // Create worker on mount
  useEffect(() => {
    // Next.js webpack 5 supports this syntax for bundling workers
    const worker = new Worker(
      new URL("../workers/arc-worker.ts", import.meta.url)
    )

    worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
      const msg = e.data

      if (msg.type === "result") {
        // Ignore stale results
        if (msg.jobId !== pendingJobRef.current) return
        pendingJobRef.current = null
        setProcessedArcs(msg.result)
        setProcessing(false)
      }

      if (msg.type === "error") {
        if (msg.jobId !== pendingJobRef.current) return
        pendingJobRef.current = null
        console.error("[arc-worker] Processing error:", msg.error)
        setProcessing(false)
        // Keep last good result on error
      }
    }

    worker.onerror = (e) => {
      console.error("[arc-worker] Worker error:", e)
      setProcessing(false)
    }

    workerRef.current = worker

    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  // Post work to the worker whenever input data changes
  useEffect(() => {
    const worker = workerRef.current
    if (!worker) return

    // Nothing to process
    const hasGeospatial = geospatialData?.data && geospatialData.data.length > 0
    const hasFallback = fallbackObjects.length > 0

    if (!hasGeospatial && !hasFallback) {
      setProcessedArcs(EMPTY_RESULT)
      setProcessing(false)
      return
    }

    // Cancel any in-flight job
    if (pendingJobRef.current !== null) {
      worker.postMessage({ type: "cancel" })
    }

    // Increment job ID
    const jobId = ++jobIdRef.current
    pendingJobRef.current = jobId
    setProcessing(true)

    // Flatten fallback objects for structured clone (avoid cloning React wrapper)
    let flatFallback: FlatObjectAttrs[] | null = null
    if (!hasGeospatial && hasFallback) {
      flatFallback = fallbackObjects.map((obj) => ({
        longitude: obj.attributes.longitude,
        latitude: obj.attributes.latitude,
        institution_longitude: obj.attributes.institution_longitude,
        institution_latitude: obj.attributes.institution_latitude,
        place_name: obj.attributes.place_name,
        institution_place: obj.attributes.institution_place,
        institution_name: obj.attributes.institution_name,
        city_en: obj.attributes.city_en,
        country_en: obj.attributes.country_en,
        institution_city_en: obj.attributes.institution_city_en,
        institution_country_en: obj.attributes.institution_country_en,
        img_url: obj.attributes.img_url,
      }))
    }

    worker.postMessage({
      type: "process-geospatial",
      jobId,
      geospatialData: hasGeospatial ? geospatialData : null,
      fallbackObjects: flatFallback,
    })
  }, [geospatialData, fallbackObjects])

  return { processedArcs, processing }
}

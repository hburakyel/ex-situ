"use client"

import { useState, useEffect, useCallback } from "react"
import type {
  ResolverStatsResponse,
  ResolverDetailResponse,
  PendingCorrectionsResponse,
} from "./types"

// ─── Fetch resolver stats from real API ─────────────────────────────────────

export function useResolverStats() {
  const [data, setData] = useState<ResolverStatsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch_ = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/proxy/resolver-stats")
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`)
      }
      const json: ResolverStatsResponse = await res.json()
      setData(json)
    } catch (e: any) {
      console.error("[useResolverStats] Error:", e)
      setError(e.message || "Failed to fetch resolver stats")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetch_()
  }, [fetch_])

  return { data, loading, error, refetch: fetch_ }
}

// ─── Fetch detail for a specific institution ────────────────────────────────

export function useResolverDetail(institutionName: string | null) {
  const [data, setData] = useState<ResolverDetailResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!institutionName) {
      setData(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    fetch(`/api/proxy/resolver-stats/${encodeURIComponent(institutionName)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((json: ResolverDetailResponse) => {
        if (!cancelled) setData(json)
      })
      .catch((e: any) => {
        if (!cancelled) setError(e.message || "Failed to fetch detail")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [institutionName])

  return { data, loading, error }
}

// ─── Fetch objects pending geocoding correction ───────────────────────────

export function usePendingCorrections(institutionName: string | null, page = 1) {
  const [data, setData] = useState<PendingCorrectionsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetch_ = useCallback(async () => {
    if (!institutionName) {
      setData(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ institution: institutionName, page: String(page) })
      const res = await fetch(`/api/proxy/corrections?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: PendingCorrectionsResponse = await res.json()
      setData(json)
    } catch (e: any) {
      setError(e.message || "Failed to fetch corrections")
    } finally {
      setLoading(false)
    }
  }, [institutionName, page])

  useEffect(() => {
    fetch_()
  }, [fetch_])

  return { data, loading, error, refetch: fetch_ }
}

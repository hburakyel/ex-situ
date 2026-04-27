"use client"

import { useState, useEffect, useCallback, useRef, useMemo, use } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import type { MuseumObject } from "@/types"
import { useUnifiedSearch } from "@/hooks/use-unified-search"

async function fetchObjectsByInstitution(institution: string, page = 1, pageSize = 50) {
  const params = new URLSearchParams({
    "_q": institution,
    "pagination[pageSize]": pageSize.toString(),
    "pagination[page]": page.toString(),
    "populate": "*",
  })
  const res = await fetch(`/api/proxy?${params.toString()}`)
  if (!res.ok) {
    console.error("Proxy error:", res.status, await res.text().catch(() => ""))
    throw new Error("Failed to fetch objects")
  }
  const data = await res.json()
  return {
    objects: (data.data || []) as MuseumObject[],
    pagination: data.meta?.pagination as { page: number; pageSize: number; pageCount: number; total: number },
  }
}

async function fetchFilteredObjects(
  institution: string,
  country: string,
  page = 1,
  pageSize = 60,
) {
  // Use PostGIS by-country endpoint with institution filter
  try {
    const params = new URLSearchParams({
      country,
      institution,
      page: page.toString(),
      pageSize: pageSize.toString(),
    })
    const res = await fetch(`/api/proxy/by-country?${params.toString()}`)
    if (res.ok) {
      const data = await res.json()
      return {
        objects: (data.data || []) as MuseumObject[],
        pagination: data.meta?.pagination as { page: number; pageSize: number; pageCount: number; total: number },
      }
    }
  } catch (err) {
    console.warn("[collection] by-country endpoint failed, falling back", err)
  }

  // Fallback: _q search with client-side filtering
  const params = new URLSearchParams({
    "_q": institution,
    "pagination[pageSize]": pageSize.toString(),
    "pagination[page]": page.toString(),
    "populate": "*",
  })
  const res = await fetch(`/api/proxy?${params.toString()}`)
  if (!res.ok) throw new Error("Failed to fetch objects")
  const data = await res.json()
  const allObjects = (data.data || []) as MuseumObject[]
  const filtered = allObjects.filter((obj) => {
    const a = obj.attributes
    return (
      (a.country || "").toLowerCase().includes(country.toLowerCase()) ||
      (a.country_en || "").toLowerCase().includes(country.toLowerCase()) ||
      (a.geocoded_country || "").toLowerCase().includes(country.toLowerCase())
    )
  })
  return {
    objects: filtered,
    pagination: data.meta?.pagination as { page: number; pageSize: number; pageCount: number; total: number },
  }
}

export default function CollectionDetailClient({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const decodedSlug = decodeURIComponent(slug)
  const router = useRouter()
  const searchParams = useSearchParams()

  const { allCollections, arcData, isLoadingArcData } = useUnifiedSearch()

  // Active origin filter from URL
  const urlOrigin = searchParams.get("origin") || null
  const [activeOrigin, setActiveOrigin] = useState<string | null>(urlOrigin)

  const [objects, setObjects] = useState<MuseumObject[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const loadingRef = useRef(false)

  // Find the matching collection
  const collection = allCollections.find(
    (c) => c.name.toLowerCase() === decodedSlug || c.shortName.toLowerCase() === decodedSlug,
  )
  const institutionName = collection?.name || decodedSlug

  // Origins for this collection from arc data
  const originCountries = useMemo(() => {
    return arcData
      .filter((a) => a.institution_name.toLowerCase() === institutionName.toLowerCase())
      .sort((a, b) => b.object_count - a.object_count)
  }, [arcData, institutionName])

  // Resolve proper-cased origin name
  const resolvedOrigin = useMemo(() => {
    if (!activeOrigin) return null
    const match = originCountries.find(
      (a) => a.place_name.toLowerCase() === activeOrigin.toLowerCase(),
    )
    return match?.place_name || activeOrigin
  }, [originCountries, activeOrigin])

  // Update URL
  const updateUrl = useCallback((origin: string | null) => {
    const params = new URLSearchParams()
    if (origin) params.set("origin", origin.toLowerCase())
    const qs = params.toString()
    router.replace(
      `/research/collection/${encodeURIComponent(decodedSlug)}${qs ? `?${qs}` : ""}`,
      { scroll: false },
    )
  }, [router, decodedSlug])

  // Fetch objects — depends on whether an origin filter is active
  const fetchObjects = useCallback(async (pg: number, append = false) => {
    if (append) {
      loadingRef.current = true
    } else {
      setIsLoading(true)
    }
    try {
      const result = resolvedOrigin
        ? await fetchFilteredObjects(institutionName, resolvedOrigin, pg, 60)
        : await fetchObjectsByInstitution(institutionName, pg, 60)

      if (append) {
        setObjects((prev) => [...prev, ...result.objects])
      } else {
        setObjects(result.objects)
      }
      setTotalCount(result.pagination?.total || result.objects.length)
      setHasMore((result.pagination?.page || 1) < (result.pagination?.pageCount || 1))
      setPage(pg)
    } catch (err) {
      console.error("Failed to load objects:", err)
    } finally {
      setIsLoading(false)
      loadingRef.current = false
    }
  }, [institutionName, resolvedOrigin])

  // Refetch when institution or origin changes
  useEffect(() => {
    fetchObjects(1)
  }, [institutionName, resolvedOrigin, fetchObjects])

  // Load more
  const loadMore = useCallback(() => {
    if (loadingRef.current || !hasMore) return
    fetchObjects(page + 1, true)
  }, [page, hasMore, fetchObjects])

  // Toggle origin filter
  const toggleOrigin = (country: string) => {
    const next = activeOrigin?.toLowerCase() === country.toLowerCase() ? null : country
    setActiveOrigin(next)
    updateUrl(next)
    setObjects([])
    setPage(1)
  }

  // Infinite scroll observer
  const sentinelRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && hasMore && !isLoading) {
            loadMore()
          }
        },
        { threshold: 0.1 },
      )
      observer.observe(node)
      return () => observer.disconnect()
    },
    [hasMore, isLoading, loadMore],
  )

  return (
    <div className="max-w-5xl mx-auto px-5 py-4">
      {/* Header */}
      <div className="mb-4">
        <div>
          <span className="text-amber-500">
            {collection?.shortName || institutionName}
          </span>
          {collection && collection.shortName !== collection.name && (
            <span className="text-gray-300 ml-2">{collection.name}</span>
          )}
        </div>
        <div className="text-gray-400 mt-1">
          {totalCount > 0 && <span>{totalCount.toLocaleString()} links</span>}
          {originCountries.length > 0 && (
            <span className="ml-2">
              · {originCountries.length} origin{originCountries.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {/* Origin filter chips */}
      {originCountries.length > 0 && (
        <div className="mb-4 border-t border-gray-100 pt-3">
          <span className="text-gray-300 mr-2">origins:</span>
          <div className="inline-flex flex-wrap gap-1">
            {originCountries.map((arc) => (
              <button
                key={arc.cluster_id}
                onClick={() => toggleOrigin(arc.place_name)}
                className={`px-2 py-0.5 rounded-md text-sm border transition-colors ${
                  activeOrigin?.toLowerCase() === arc.place_name.toLowerCase()
                    ? "border-blue-400 bg-blue-100 text-blue-700"
                    : "border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700"
                }`}
              >
                {arc.place_name}
                <span className="text-gray-300 ml-1 tabular-nums text-xs">{arc.object_count.toLocaleString()}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Active filter summary */}
      {activeOrigin && (
        <div className="mb-3 flex items-center gap-2 text-sm">
          <span className="text-gray-300">showing:</span>
          <span className="text-blue-600">{resolvedOrigin || activeOrigin}</span>
          <span className="text-gray-300">→</span>
          <span className="text-amber-500">{collection?.shortName || institutionName}</span>
          <button
            onClick={() => { setActiveOrigin(null); updateUrl(null); setObjects([]); setPage(1) }}
            className="text-gray-300 hover:text-gray-500 ml-1"
          >
            [clear]
          </button>
        </div>
      )}

      {/* Loading */}
      {isLoading && objects.length === 0 && (
        <div className="py-12 text-gray-400">loading...</div>
      )}

      {/* Empty */}
      {!isLoading && objects.length === 0 && (
        <div className="text-gray-400 py-8">no links found.</div>
      )}

      {/* Object cards */}
      {objects.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-gray-100">
          {objects.map((obj, i) => (
            <Link
              key={`${obj.id}-${i}`}
              href={`/artifact/${obj.id}`}
              className="bg-white p-3 hover:bg-gray-50 group block"
            >
              {obj.attributes.img_url ? (
                <div className="mb-2">
                  <img
                    src={obj.attributes.img_url}
                    alt={obj.attributes.title || ""}
                    className="w-full h-40 object-contain bg-gray-50"
                    loading="lazy"
                  />
                  <div className="text-gray-300 text-[10px] mt-1 truncate">
                    {(() => { try { const p = obj.attributes.img_url.split("/"); return p[p.length-1]?.slice(0,40) } catch { return "" } })()}
                  </div>
                </div>
              ) : (
                <div className="w-full h-20 bg-gray-50 flex items-center justify-center mb-2">
                  <span className="text-gray-300">[no image]</span>
                </div>
              )}

              <div className="space-y-0.5">
                <div className="truncate">
                  <span className="text-gray-400">title: </span>
                  <span className="text-black/60 group-hover:text-black">
                    {obj.attributes.title || "untitled"}
                  </span>
                </div>
                {obj.attributes.inventory_number && (
                  <div className="truncate">
                    <span className="text-gray-400">inv: </span>
                    <span className="text-gray-600 tabular-nums">
                      {obj.attributes.inventory_number}
                    </span>
                  </div>
                )}
                <div className="truncate">
                  <span className="text-gray-400">from: </span>
                  <span className="text-blue-500">
                    {obj.attributes.place_name || obj.attributes.country || "—"}
                  </span>
                </div>
                <div className="truncate">
                  <span className="text-gray-400">held: </span>
                  <span className="text-amber-500">
                    {obj.attributes.institution_name}
                  </span>
                </div>
                {obj.attributes.source_link && (
                  <div className="truncate">
                    <span className="text-gray-400">src: </span>
                    <span className="text-blue-600 text-[10px]">
                      {obj.attributes.source_link.replace(/^https?:\/\//, "").slice(0, 40)}
                    </span>
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Sentinel for infinite scroll */}
      {hasMore && objects.length > 0 && (
        <div ref={sentinelRef} className="py-4 text-gray-400">
          loading...
        </div>
      )}
    </div>
  )
}

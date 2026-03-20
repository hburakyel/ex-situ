"use client"

import { useState, useEffect, useMemo, useCallback, use } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { useUnifiedSearch, type ArcData } from "@/hooks/use-unified-search"
import type { MuseumObject } from "@/types"

interface SubArc {
  place_name: string
  institution_name: string
  object_count: number
  latitude: number
  longitude: number
  sample_img_url: string | null
  cluster_id: string
}

async function fetchSubArcs(country: string): Promise<SubArc[]> {
  try {
    const params = new URLSearchParams({ zoom: "4", country })
    const res = await fetch(`/api/proxy/geospatial?${params.toString()}`)
    if (!res.ok) return []
    const data = await res.json()
    return (data.data || []) as SubArc[]
  } catch { return [] }
}

async function fetchObjectsForCountry(
  country: string,
  page = 1,
  pageSize = 60,
  site?: string,
  institution?: string,
) {
  // Try the fast PostGIS endpoint first
  try {
    const params = new URLSearchParams({
      country,
      page: page.toString(),
      pageSize: pageSize.toString(),
    })
    if (site) params.set("site", site)
    if (institution) params.set("institution", institution)

    const res = await fetch(`/api/proxy/by-country?${params.toString()}`)
    if (res.ok) {
      const data = await res.json()
      return {
        objects: (data.data || []) as MuseumObject[],
        pagination: data.meta?.pagination as {
          page: number; pageSize: number; pageCount: number; total: number
        },
      }
    }
    console.warn("[arc] by-country endpoint returned", res.status, "— falling back to _q search")
  } catch (err) {
    console.warn("[arc] by-country endpoint unavailable — falling back to _q search", err)
  }

  // Fallback: Strapi full-text search + client-side filtering
  const fallbackParams = new URLSearchParams({
    "_q": country,
    "pagination[pageSize]": pageSize.toString(),
    "pagination[page]": page.toString(),
    "populate": "*",
  })
  const res = await fetch(`/api/proxy?${fallbackParams.toString()}`)
  if (!res.ok) throw new Error("Failed to fetch objects")
  const data = await res.json()
  const allObjects = (data.data || []) as MuseumObject[]

  const filtered = allObjects.filter((obj) => {
    const a = obj.attributes
    const c = country.toLowerCase()
    const countryMatch =
      (a.country || "").toLowerCase().includes(c) ||
      (a.country_en || "").toLowerCase().includes(c) ||
      (a.geocoded_country || "").toLowerCase().includes(c)
    if (!countryMatch) return false
    if (site && !(a.place_name || "").toLowerCase().includes(site.toLowerCase())) return false
    if (institution && !(a.institution_name || "").toLowerCase().includes(institution.toLowerCase())) return false
    return true
  })

  return {
    objects: filtered,
    pagination: data.meta?.pagination as {
      page: number; pageSize: number; pageCount: number; total: number
    },
  }
}

function getImgFilename(url: string) {
  try {
    const parts = url.split("/")
    return parts[parts.length - 1]?.slice(0, 40) || url.slice(0, 40)
  } catch { return url.slice(0, 40) }
}

export default function ArcDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const slugDecoded = decodeURIComponent(slug)
  const router = useRouter()
  const searchParams = useSearchParams()

  const { arcData, isLoadingArcData } = useUnifiedSearch()

  // Resolve proper-cased country name from arcData (slug is lowercase)
  const country = useMemo(() => {
    const match = arcData.find(
      (a) => a.place_name.toLowerCase() === slugDecoded.toLowerCase(),
    )
    return match?.place_name || slugDecoded
  }, [arcData, slugDecoded])

  // Read filters from URL
  const urlSite = searchParams.get("site") || null
  const urlInstitution = searchParams.get("institution") || null

  // Local state synced with URL
  const [activeSite, setActiveSite] = useState<string | null>(urlSite)
  const [activeInstitution, setActiveInstitution] = useState<string | null>(urlInstitution)

  // Sub-arcs (sites) for this country
  const [subArcs, setSubArcs] = useState<SubArc[]>([])
  const [isLoadingSubArcs, setIsLoadingSubArcs] = useState(false)

  // Objects
  const [objects, setObjects] = useState<MuseumObject[]>([])
  const [isLoadingObjects, setIsLoadingObjects] = useState(false)
  const [objectPage, setObjectPage] = useState(1)
  const [totalObjects, setTotalObjects] = useState(0)
  const [hasMoreObjects, setHasMoreObjects] = useState(true)

  // Arcs for this country (from zoom=1 data)
  const countryArcs = useMemo(() => {
    return arcData
      .filter((a) => a.place_name.toLowerCase() === country.toLowerCase())
      .sort((a, b) => b.object_count - a.object_count)
  }, [arcData, country])

  const totalArcObjects = useMemo(
    () => countryArcs.reduce((sum, a) => sum + a.object_count, 0),
    [countryArcs],
  )

  // Group sub-arcs by place_name (sites) — filtered by active institution if one is selected
  const groupedSites = useMemo(() => {
    const source = activeInstitution && subArcs.length > 0
      ? subArcs.filter((a) => a.institution_name.toLowerCase() === activeInstitution.toLowerCase())
      : subArcs
    const map = new Map<string, { totalCount: number; institutions: Set<string> }>()
    source.forEach((arc) => {
      const existing = map.get(arc.place_name)
      if (existing) {
        existing.totalCount += arc.object_count
        existing.institutions.add(arc.institution_name)
      } else {
        map.set(arc.place_name, {
          totalCount: arc.object_count,
          institutions: new Set([arc.institution_name]),
        })
      }
    })
    return Array.from(map.entries())
      .map(([name, data]) => ({
        name,
        totalCount: data.totalCount,
        institutions: Array.from(data.institutions),
      }))
      .sort((a, b) => b.totalCount - a.totalCount)
  }, [subArcs, activeInstitution])

  // Institutions (collections) — filtered by active site if one is selected
  const institutions = useMemo(() => {
    if (activeSite && subArcs.length > 0) {
      // When a site is active, show only institutions that have arcs from that site
      const map = new Map<string, number>()
      subArcs
        .filter((a) => a.place_name.toLowerCase() === activeSite.toLowerCase())
        .forEach((a) => {
          map.set(a.institution_name, (map.get(a.institution_name) || 0) + a.object_count)
        })
      return Array.from(map.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
    }
    // No site filter — show all institutions from country-level arcs
    const map = new Map<string, number>()
    countryArcs.forEach((arc) => {
      map.set(arc.institution_name, (map.get(arc.institution_name) || 0) + arc.object_count)
    })
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
  }, [countryArcs, subArcs, activeSite])

  // Update URL when filters change
  const updateUrl = useCallback((site: string | null, institution: string | null) => {
    const params = new URLSearchParams()
    if (site) params.set("site", site)
    if (institution) params.set("institution", institution)
    const qs = params.toString()
    router.replace(
      `/research/arc/${encodeURIComponent(country.toLowerCase())}${qs ? `?${qs}` : ""}`,
      { scroll: false },
    )
  }, [router, country])

  // Fetch sub-arcs on mount (wait for proper-cased country from arcData)
  useEffect(() => {
    if (isLoadingArcData || !country) return
    let cancelled = false
    setIsLoadingSubArcs(true)
    fetchSubArcs(country).then((data) => {
      if (!cancelled) {
        setSubArcs(data)
        setIsLoadingSubArcs(false)
      }
    })
    return () => { cancelled = true }
  }, [country, isLoadingArcData])

  // Fetch objects when filters change
  const fetchObjects = useCallback(async (page: number, append = false) => {
    setIsLoadingObjects(true)
    try {
      const result = await fetchObjectsForCountry(
        country, page, 60,
        activeSite || undefined,
        activeInstitution || undefined,
      )
      if (append) {
        setObjects((prev) => [...prev, ...result.objects])
      } else {
        setObjects(result.objects)
      }
      setTotalObjects(result.pagination?.total || 0)
      setHasMoreObjects(
        (result.pagination?.page || 1) < (result.pagination?.pageCount || 1),
      )
      setObjectPage(page)
    } catch (err) {
      console.error("Failed to fetch objects:", err)
    } finally {
      setIsLoadingObjects(false)
    }
  }, [country, activeSite, activeInstitution])

  useEffect(() => {
    if (isLoadingArcData) return
    fetchObjects(1)
  }, [country, activeSite, activeInstitution, fetchObjects, isLoadingArcData])

  const loadMore = () => {
    if (!hasMoreObjects || isLoadingObjects) return
    fetchObjects(objectPage + 1, true)
  }

  // Filter handlers
  const toggleSite = (site: string) => {
    const next = activeSite === site ? null : site
    setActiveSite(next)
    // Clear institution if the newly selected site doesn't have that institution
    if (next && activeInstitution) {
      const siteData = groupedSites.find((s) => s.name === next)
      if (siteData && !siteData.institutions.includes(activeInstitution)) {
        setActiveInstitution(null)
        updateUrl(next, null)
        return
      }
    }
    updateUrl(next, activeInstitution)
    setObjects([])
    setObjectPage(1)
  }

  const toggleInstitution = (inst: string) => {
    const next = activeInstitution === inst ? null : inst
    setActiveInstitution(next)
    // Clear site if the newly selected institution doesn't have that site
    if (next && activeSite) {
      const instSites = subArcs
        .filter((a) => a.institution_name.toLowerCase() === next.toLowerCase())
        .map((a) => a.place_name)
      if (!instSites.includes(activeSite)) {
        setActiveSite(null)
        updateUrl(null, next)
        setObjects([])
        setObjectPage(1)
        return
      }
    }
    updateUrl(activeSite, next)
    setObjects([])
    setObjectPage(1)
  }

  const clearFilters = () => {
    setActiveSite(null)
    setActiveInstitution(null)
    updateUrl(null, null)
    setObjects([])
    setObjectPage(1)
  }

  return (
    <div className="max-w-6xl mx-auto px-5 py-4">
      {/* Header */}
      <div className="mb-4 flex items-center gap-1 flex-wrap">
        <Link href="/research" className="text-gray-400 hover:text-gray-600">
          origins
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-blue-500 capitalize">{country}</span>
        {totalObjects > 0 && (
          <span className="text-gray-300 ml-1">
            ({totalObjects.toLocaleString()} objects)
          </span>
        )}
        <Link
          href={`/map?place=${encodeURIComponent(country)}`}
          className="text-blue-600 hover:text-blue-500 ml-auto"
        >
          → map
        </Link>
      </div>

      {/* Loading arcs */}
      {isLoadingArcData && (
        <div className="py-12 text-gray-400">loading...</div>
      )}

      {!isLoadingArcData && (
        <>
          {/* Site filter chips */}
          {!isLoadingSubArcs && groupedSites.length > 0 && (
            <div className="mb-2">
              <span className="text-gray-300 mr-2">sites:</span>
              <div className="inline-flex flex-wrap gap-1">
                {groupedSites.map((s) => (
                  <button
                    key={s.name}
                    onClick={() => toggleSite(s.name)}
                    className={`px-2 py-0.5 text-sm border transition-colors ${
                      activeSite === s.name
                        ? "border-blue-400 text-blue-500 bg-blue-50"
                        : "border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700"
                    }`}
                  >
                    {s.name}
                    <span className="text-gray-300 ml-1 tabular-nums text-xs">
                      {s.totalCount.toLocaleString()}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {isLoadingSubArcs && (
            <div className="mb-2 text-gray-300 text-sm">loading sites...</div>
          )}

          {/* Collection filter chips */}
          {institutions.length > 0 && (
            <div className="mb-4">
              <span className="text-gray-300 mr-2">collections:</span>
              <div className="inline-flex flex-wrap gap-1">
                {institutions.map((inst) => (
                  <button
                    key={inst.name}
                    onClick={() => toggleInstitution(inst.name)}
                    className={`px-2 py-0.5 text-sm border transition-colors ${
                      activeInstitution === inst.name
                        ? "border-amber-400 text-amber-500 bg-amber-50"
                        : "border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700"
                    }`}
                  >
                    {inst.name}
                    <span className="text-gray-300 ml-1 tabular-nums text-xs">
                      {inst.count.toLocaleString()}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Active filters summary */}
          {(activeSite || activeInstitution) && (
            <div className="mb-3 flex items-center gap-2 text-sm">
              <span className="text-gray-300">showing:</span>
              {activeSite && (
                <span className="text-blue-500">{activeSite}</span>
              )}
              {activeSite && activeInstitution && (
                <span className="text-gray-300">→</span>
              )}
              {activeInstitution && (
                <span className="text-amber-500">{activeInstitution}</span>
              )}
              <button
                onClick={clearFilters}
                className="text-gray-300 hover:text-gray-500 ml-1"
              >
                [clear]
              </button>
            </div>
          )}

          {/* Objects grid */}
          {isLoadingObjects && objects.length === 0 && (
            <div className="py-8 text-gray-400">loading...</div>
          )}

          {!isLoadingObjects && objects.length === 0 && (
            <div className="text-gray-400 py-8">no objects found.</div>
          )}

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
                        {getImgFilename(obj.attributes.img_url)}
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
                      <span className="text-gray-800 group-hover:text-black">
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

          {hasMoreObjects && objects.length > 0 && (
            <div className="py-4">
              <button
                onClick={loadMore}
                disabled={isLoadingObjects}
                className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
              >
                {isLoadingObjects ? "loading..." : "— load more —"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

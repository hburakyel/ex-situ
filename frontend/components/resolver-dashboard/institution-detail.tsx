"use client"

import { useState, useEffect, useCallback } from "react"
import type { InstitutionStats, ResolverDetailResponse } from "./types"
import { getETLMeta, resolverStatus } from "./types"
import { usePendingCorrections } from "./use-resolver-data"

function StatusChip({ inst }: { inst: InstitutionStats }) {
  const status = resolverStatus(inst)
  const cls = status === "ok"
    ? "bg-emerald-50 text-emerald-600 border-emerald-100"
    : status === "warn"
    ? "bg-amber-50 text-amber-600 border-amber-100"
    : "bg-red-50 text-red-500 border-red-100"

  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded-md whitespace-nowrap border ${cls}`}>
      {status === "ok" ? "healthy" : status === "warn" ? "warning" : "issues"}
    </span>
  )
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="h-[4px] bg-secondary rounded-full flex-1 overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

interface InstitutionDetailProps {
  institution: InstitutionStats
  detail: ResolverDetailResponse | null
  detailLoading: boolean
  activeTab: string
  onTabChange: (tab: string) => void
}

export function InstitutionDetail({
  institution: inst,
  detail,
  detailLoading,
  activeTab,
  onTabChange,
}: InstitutionDetailProps) {
  const meta = getETLMeta(inst.name)
  const tabs = ["Overview", "Places", "Recent Artifacts", "Corrections"]

  const maxOrigin = Math.max(
    inst.originTypes.valid,
    inst.originTypes.historical,
    inst.originTypes.cultural,
    inst.originTypes.micro,
    inst.originTypes.invalid,
    1
  )

  // Corrections tab state
  const [corrPage, setCorrPage] = useState(1)
  const { data: corrData, loading: corrLoading, error: corrError, refetch: corrRefetch } = usePendingCorrections(inst.name, corrPage)
  const [edits, setEdits] = useState<Record<number, { lat: string; lon: string; country: string; city: string; notes: string }>>({})
  const [applying, setApplying] = useState<Record<number, boolean>>({})
  const [applied, setApplied] = useState<Record<number, boolean>>({})
  const [applyError, setApplyError] = useState<Record<number, string>>({})

  // Reset correction edits when institution changes
  useEffect(() => {
    setEdits({})
    setApplied({})
    setApplyError({})
    setCorrPage(1)
  }, [inst.name])

  const handleApply = useCallback(async (id: number) => {
    const e = edits[id]
    if (!e) return
    const body: Record<string, unknown> = {}
    if (e.lat !== "" && e.lon !== "") {
      body.manual_latitude = parseFloat(e.lat)
      body.manual_longitude = parseFloat(e.lon)
    }
    if (e.country !== "") body.country_en = e.country
    if (e.city !== "") body.city_en = e.city
    if (e.notes !== "") body.geocoding_notes = e.notes
    if (Object.keys(body).length === 0) return
    setApplying(prev => ({ ...prev, [id]: true }))
    setApplyError(prev => ({ ...prev, [id]: "" }))
    try {
      const res = await fetch(`/api/proxy/corrections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setApplyError(prev => ({ ...prev, [id]: d?.error?.message || `Error ${res.status}` }))
      } else {
        setApplied(prev => ({ ...prev, [id]: true }))
        setEdits(prev => ({ ...prev, [id]: { lat: "", lon: "", country: "", city: "", notes: "" } }))
      }
    } catch (err: any) {
      setApplyError(prev => ({ ...prev, [id]: err.message }))
    } finally {
      setApplying(prev => ({ ...prev, [id]: false }))
    }
  }, [edits])

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Tabs */}
      <div className="px-5 h-10 border-b border-border bg-background flex items-center gap-0 flex-shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            className={`
              text-[11px] tracking-wide px-4 h-full flex items-center
              border-b-[1.5px] transition-colors cursor-pointer
              ${activeTab === tab
                ? "text-foreground border-b-foreground"
                : "text-muted-foreground/50 border-b-transparent hover:text-muted-foreground"
              }
            `}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Info bar */}
      <div className="px-5 py-2.5 border-b border-border bg-secondary/50 flex items-center gap-4 flex-shrink-0">
        <span className="text-sm text-foreground truncate">
          {inst.name}
        </span>
        {meta && (
          <span className="text-[10px] text-muted-foreground/60 truncate">
            {meta.city}, {meta.country}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2 flex-shrink-0">
          <StatusChip inst={inst} />
          {meta?.rateLimit && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-md whitespace-nowrap bg-amber-50 text-amber-600 border border-amber-100">
              {meta.rateLimit}
            </span>
          )}
        </div>
      </div>

      {/* Tab content — scrollable */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "Overview" && (
          <div className="p-5 space-y-6">
            {/* ETL Info */}
            {meta && (
              <div>
                <h3 className="text-[9px] tracking-widest uppercase text-muted-foreground/60 mb-3">Source</h3>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: "Method", value: meta.method },
                    { label: "Geocoding", value: meta.geocoding },
                    { label: "Script", value: meta.etlScript },
                    { label: "Location", value: `${meta.city}, ${meta.country}` },
                    { label: "Category", value: `CAT ${meta.category}` },
                    { label: "Source", value: meta.sourceUrl },
                  ].map((item) => (
                    <div key={item.label} className="bg-secondary rounded-lg px-3 py-2">
                      <div className="text-[8px] text-muted-foreground/50 mb-0.5">{item.label}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{item.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Geocoding stats */}
            <div>
              <h3 className="text-[9px] tracking-widest uppercase text-muted-foreground/60 mb-3">Geocoding</h3>
              <div className="grid grid-cols-4 gap-px bg-border rounded-lg overflow-hidden">
                {[
                  { val: `${inst.resolvedPct}%`, label: "Resolved", color: inst.resolvedPct >= 80 ? "text-emerald-600" : "text-amber-600" },
                  { val: inst.avgConfidence > 0 ? inst.avgConfidence.toFixed(2) : "—", label: "Confidence", color: inst.avgConfidence >= 0.7 ? "text-emerald-600" : "text-amber-600" },
                  { val: inst.geocodedCount.toLocaleString(), label: "Geocoded", color: "text-foreground" },
                  { val: inst.distinctCountries.toString(), label: "Places", color: "text-foreground" },
                ].map((s) => (
                  <div key={s.label} className="bg-background px-3 py-2.5">
                    <div className={`text-sm mb-0.5 tracking-tight ${s.color}`}>{s.val}</div>
                    <div className="text-[9px] text-muted-foreground/50">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Geocoder source */}
            <div>
              <h3 className="text-[9px] tracking-widest uppercase text-muted-foreground/60 mb-3">Geocoder Source</h3>
              <div className="space-y-2">
                {[
                  { label: "PostGIS", count: inst.geocoderSource.postgis, color: "bg-emerald-400" },
                  { label: "Nominatim", count: inst.geocoderSource.nominatim, color: "bg-blue-400" },
                  { label: "None", count: inst.totalObjects - inst.geocoderSource.postgis - inst.geocoderSource.nominatim, color: "bg-muted-foreground/30" },
                ].filter(r => r.count > 0).map((r) => (
                  <div key={r.label} className="flex items-center gap-3">
                    <span className="text-[9px] text-muted-foreground w-20 flex-shrink-0">{r.label}</span>
                    <MiniBar value={r.count} max={inst.totalObjects} color={r.color} />
                    <span className="text-[9px] text-muted-foreground w-14 text-right">{r.count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Origin types */}
            <div>
              <h3 className="text-[9px] tracking-widest uppercase text-muted-foreground/60 mb-3">Origin Classification</h3>
              <div className="space-y-2">
                {[
                  { label: "Valid", count: inst.originTypes.valid, color: "bg-emerald-400" },
                  { label: "Historical", count: inst.originTypes.historical, color: "bg-blue-400" },
                  { label: "Cultural", count: inst.originTypes.cultural, color: "bg-amber-400" },
                  { label: "Micro", count: inst.originTypes.micro, color: "bg-orange-300" },
                  { label: "Invalid", count: inst.originTypes.invalid, color: "bg-red-400" },
                ].filter(r => r.count > 0).map((r) => (
                  <div key={r.label} className="flex items-center gap-3">
                    <span className="text-[9px] text-muted-foreground w-20 flex-shrink-0">{r.label}</span>
                    <MiniBar value={r.count} max={maxOrigin} color={r.color} />
                    <span className="text-[9px] text-muted-foreground w-14 text-right">{r.count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Review status */}
            <div>
              <h3 className="text-[9px] tracking-widest uppercase text-muted-foreground/60 mb-3">Review</h3>
              <div className="flex gap-3">
                {[
                  { label: "Pending", count: inst.reviewStatus.pending, color: "text-amber-600" },
                  { label: "Verified", count: inst.reviewStatus.verified, color: "text-emerald-600" },
                  { label: "Rejected", count: inst.reviewStatus.rejected, color: "text-red-500" },
                ].map((r) => (
                  <div key={r.label} className="bg-secondary rounded-lg px-3 py-2 flex-1">
                    <div className={`text-sm ${r.color}`}>{r.count.toLocaleString()}</div>
                    <div className="text-[9px] text-muted-foreground/50">{r.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Confidence distribution */}
            {detail && detail.confidenceDistribution.length > 0 && (
              <div>
                <h3 className="text-[9px] tracking-widest uppercase text-muted-foreground/60 mb-3">Confidence</h3>
                <div className="space-y-1.5">
                  {detail.confidenceDistribution.map((b) => (
                    <div key={b.bucket} className="flex items-center gap-3">
                      <span className="text-[9px] text-muted-foreground w-16 flex-shrink-0">{b.bucket}</span>
                      <MiniBar
                        value={b.count}
                        max={Math.max(...detail.confidenceDistribution.map(d => d.count))}
                        color={
                          b.bucket.startsWith("0.9") ? "bg-emerald-400" :
                          b.bucket.startsWith("0.8") ? "bg-emerald-300" :
                          b.bucket.startsWith("0.7") ? "bg-blue-300" :
                          b.bucket.startsWith("0.5") ? "bg-amber-300" :
                          "bg-red-300"
                        }
                      />
                      <span className="text-[9px] text-muted-foreground w-14 text-right">{b.count.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "Places" && (
          <div className="p-5">
            <h3 className="text-[9px] tracking-widest uppercase text-muted-foreground/60 mb-3">Top Origin Sites</h3>
            {detailLoading && (
              <div className="text-[10px] text-muted-foreground/50 animate-pulse py-4">loading...</div>
            )}
            {detail && detail.topCountries.length > 0 && (
              <div className="space-y-0">
                {detail.topCountries.map((c, i) => (
                  <div key={c.country} className="flex items-center gap-3 py-1.5 border-b border-border/50">
                    <span className="text-[9px] text-muted-foreground/50 w-4">{i + 1}</span>
                    <span className="text-[11px] text-foreground flex-1 truncate">{c.country}</span>
                    <MiniBar value={c.count} max={detail.topCountries[0].count} color="bg-blue-400" />
                    <span className="text-[9px] text-muted-foreground w-12 text-right">{c.count.toLocaleString()}</span>
                    <span className="text-[9px] text-muted-foreground/50 w-10 text-right">
                      {c.avgConfidence > 0 ? c.avgConfidence.toFixed(2) : "—"}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {detail && detail.topCountries.length === 0 && (
              <div className="text-[10px] text-muted-foreground/50 py-4">no place data</div>
            )}
          </div>
        )}

        {activeTab === "Recent Artifacts" && (
          <div className="p-5">
            <h3 className="text-[9px] tracking-widest uppercase text-muted-foreground/60 mb-3">Recent Artifacts</h3>
            {detailLoading && (
              <div className="text-[10px] text-muted-foreground/50 animate-pulse py-4">loading...</div>
            )}
            {detail && detail.recentObjects.length > 0 && (
              <div className="space-y-1.5">
                {detail.recentObjects.map((obj) => (
                  <div key={obj.id} className="border border-border rounded-lg p-3">
                    <div className="flex items-start gap-3">
                      {obj.imgUrl && (
                        <img
                          src={obj.imgUrl}
                          alt=""
                          className="w-9 h-9 rounded-md object-cover flex-shrink-0 bg-secondary"
                          loading="lazy"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] text-foreground truncate mb-0.5">{obj.title}</div>
                        <div className="text-[9px] text-muted-foreground flex flex-wrap gap-x-2 gap-y-0.5">
                          {obj.placeName && <span>{obj.placeName}</span>}
                          {obj.country && <span>{obj.country}</span>}
                          {obj.confidence != null && (
                            <span className={obj.confidence >= 0.7 ? "text-emerald-600" : "text-amber-600"}>
                              {obj.confidence.toFixed(2)}
                            </span>
                          )}
                          {obj.status && (
                            <span className={
                              obj.status === "ok" ? "text-emerald-600" :
                              obj.status === "disputed" ? "text-red-500" :
                              "text-amber-600"
                            }>
                              {obj.status}
                            </span>
                          )}
                        </div>
                        {obj.sourceLink && (
                          <a
                            href={obj.sourceLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[9px] text-primary/70 hover:text-primary mt-0.5 inline-block"
                          >
                            source →
                          </a>
                        )}
                      </div>
                      <div className="text-[8px] text-muted-foreground/50 flex-shrink-0">
                        {obj.latitude != null && obj.longitude != null
                          ? `${obj.latitude.toFixed(2)}, ${obj.longitude.toFixed(2)}`
                          : "—"
                        }
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {detail && detail.recentObjects.length === 0 && (
              <div className="text-[10px] text-muted-foreground/50 py-4">no recent artifacts</div>
            )}
          </div>
        )}

        {activeTab === "Corrections" && (
          <div className="p-5">
            <h3 className="text-[9px] tracking-widest uppercase text-muted-foreground/60 mb-3">
              Pending Corrections
              <span className="ml-2 normal-case text-muted-foreground/40">
                {corrData ? `${corrData.meta.pagination.total} objects` : ""}
              </span>
            </h3>

            {corrLoading && (
              <div className="text-[10px] text-muted-foreground/50 animate-pulse py-4">loading...</div>
            )}
            {corrError && (
              <div className="text-[9px] text-red-500 py-4">{corrError}</div>
            )}

            {corrData && corrData.data.length === 0 && (
              <div className="text-[10px] text-muted-foreground/50 py-4">no pending corrections</div>
            )}

            {corrData && corrData.data.length > 0 && (
              <div className="space-y-2">
                {corrData.data.map((obj) => {
                  const edit = edits[obj.id] ?? { lat: "", lon: "", country: "", city: "", notes: "" }
                  const isDirty = edit.lat !== "" || edit.lon !== "" || edit.country !== "" || edit.city !== "" || edit.notes !== ""
                  const isApplied = applied[obj.id]
                  const isApplying = applying[obj.id]
                  const err = applyError[obj.id]
                  const conf = obj.geocodingConfidence

                  return (
                    <div key={obj.id} className="bg-background border border-border rounded-lg p-3">
                      <div className="flex items-start gap-3 mb-2">
                        {obj.imgUrl && (
                          <img
                            src={obj.imgUrl}
                            alt=""
                            className="w-8 h-8 rounded-md object-cover flex-shrink-0 bg-secondary"
                            loading="lazy"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] text-foreground truncate">{obj.title}</div>
                          <div className="text-[9px] text-muted-foreground flex flex-wrap gap-x-2">
                            {obj.placeName && <span>{obj.placeName}</span>}
                            {obj.countryEn && <span>{obj.countryEn}</span>}
                            {conf != null && (
                              <span className={conf < 0.5 ? "text-red-500" : "text-amber-600"}>
                                conf: {conf.toFixed(2)}
                              </span>
                            )}
                            {obj.geocodingStatus && (
                              <span className={
                                obj.geocodingStatus === "ok" ? "text-emerald-600" :
                                obj.geocodingStatus === "disputed" ? "text-red-500" :
                                "text-amber-600"
                              }>
                                {obj.geocodingStatus}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-[8px] text-muted-foreground/50 flex-shrink-0 text-right">
                          {obj.manualLatitude != null
                            ? `${obj.manualLatitude.toFixed(2)}, ${obj.manualLongitude?.toFixed(2)} (manual)`
                            : obj.latitude != null
                            ? `${obj.latitude.toFixed(2)}, ${obj.longitude?.toFixed(2)}`
                            : "—"
                          }
                        </div>
                      </div>

                      {isApplied ? (
                        <div className="text-[9px] text-emerald-600 mt-1">correction saved</div>
                      ) : (
                        <>
                          <div className="grid grid-cols-2 gap-1.5 mb-1.5">
                            <input
                              type="text"
                              placeholder="lat (e.g. 33.3)"
                              value={edit.lat}
                              onChange={e => setEdits(prev => ({ ...prev, [obj.id]: { ...edit, lat: e.target.value } }))}
                              className="w-full bg-secondary border border-border text-foreground rounded-lg px-2.5 py-1.5 text-[10px] focus:border-primary focus:outline-none"
                            />
                            <input
                              type="text"
                              placeholder="lon (e.g. 44.4)"
                              value={edit.lon}
                              onChange={e => setEdits(prev => ({ ...prev, [obj.id]: { ...edit, lon: e.target.value } }))}
                              className="w-full bg-secondary border border-border text-foreground rounded-lg px-2.5 py-1.5 text-[10px] focus:border-primary focus:outline-none"
                            />
                            <input
                              type="text"
                              placeholder="country (e.g. Iraq)"
                              value={edit.country}
                              onChange={e => setEdits(prev => ({ ...prev, [obj.id]: { ...edit, country: e.target.value } }))}
                              className="w-full bg-secondary border border-border text-foreground rounded-lg px-2.5 py-1.5 text-[10px] focus:border-primary focus:outline-none"
                            />
                            <input
                              type="text"
                              placeholder="city (e.g. Baghdad)"
                              value={edit.city}
                              onChange={e => setEdits(prev => ({ ...prev, [obj.id]: { ...edit, city: e.target.value } }))}
                              className="w-full bg-secondary border border-border text-foreground rounded-lg px-2.5 py-1.5 text-[10px] focus:border-primary focus:outline-none"
                            />
                          </div>
                          <input
                            type="text"
                            placeholder="correction note (optional)"
                            value={edit.notes}
                            onChange={e => setEdits(prev => ({ ...prev, [obj.id]: { ...edit, notes: e.target.value } }))}
                            className="w-full bg-secondary border border-border text-foreground rounded-lg px-2.5 py-1.5 text-[10px] focus:border-primary focus:outline-none mb-1.5"
                          />
                          <div className="flex items-center justify-between">
                            {err && <span className="text-[9px] text-red-500">{err}</span>}
                            <button
                              onClick={() => handleApply(obj.id)}
                              disabled={!isDirty || isApplying}
                              className={`ml-auto text-[9px] px-3 py-1.5 rounded-lg border transition-colors cursor-pointer ${
                                isApplying
                                  ? "bg-secondary text-muted-foreground/30 border-border cursor-not-allowed"
                                  : isDirty
                                  ? "bg-blue-50 text-blue-600 border border-blue-100 hover:bg-blue-100 cursor-pointer"
                                  : "bg-secondary text-muted-foreground/30 border-border cursor-not-allowed"
                              }`}
                            >
                              {isApplying ? "saving..." : "apply"}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Pagination */}
            {corrData && corrData.meta.pagination.pageCount > 1 && (
              <div className="flex items-center justify-between mt-4">
                <button
                  onClick={() => setCorrPage(p => Math.max(1, p - 1))}
                  disabled={corrPage <= 1}
                  className="text-[9px] px-3 py-1.5 bg-secondary border border-border rounded-lg text-muted-foreground hover:text-foreground disabled:opacity-40 cursor-pointer"
                >
                  prev
                </button>
                <span className="text-[9px] text-muted-foreground/50">
                  {corrPage} / {corrData.meta.pagination.pageCount}
                </span>
                <button
                  onClick={() => setCorrPage(p => Math.min(corrData.meta.pagination.pageCount, p + 1))}
                  disabled={corrPage >= corrData.meta.pagination.pageCount}
                  className="text-[9px] px-3 py-1.5 bg-secondary border border-border rounded-lg text-muted-foreground hover:text-foreground disabled:opacity-40 cursor-pointer"
                >
                  next
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

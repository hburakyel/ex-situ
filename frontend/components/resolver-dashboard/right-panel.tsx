"use client"

import type { ResolverTotals, InstitutionStats } from "./types"
import { resolverStatus, getETLMeta } from "./types"

interface RightPanelProps {
  totals: ResolverTotals | null
  institution: InstitutionStats | null
  institutions: InstitutionStats[]
}

export function RightPanel({ totals, institution, institutions }: RightPanelProps) {
  const inst = institution
  const meta = inst ? getETLMeta(inst.name) : null

  const okCount = institutions.filter(i => resolverStatus(i) === "ok").length
  const warnCount = institutions.filter(i => resolverStatus(i) === "warn").length
  const errCount = institutions.filter(i => resolverStatus(i) === "err").length

  return (
    <div className="w-[240px] flex-shrink-0 border-l border-border bg-background flex flex-col overflow-hidden">
      {/* Global stats */}
      <div className="border-b border-border">
        <div className="px-4 py-2.5 border-b border-border">
          <span className="text-[9px] tracking-widest uppercase text-muted-foreground/60">
            Overview
          </span>
        </div>
        <div className="grid grid-cols-2 gap-px bg-border">
          {[
            { val: totals ? totals.totalObjects.toLocaleString() : "—", label: "Artifacts" },
            { val: totals ? totals.totalGeocoded.toLocaleString() : "—", label: "Geocoded" },
            { val: totals ? `${totals.globalAvgConfidence.toFixed(2)}` : "—", label: "Confidence" },
            { val: totals ? `${totals.totalCountries}` : "—", label: "Places" },
          ].map((s, i) => (
            <div key={i} className="bg-background px-3 py-2.5">
              <div className="text-sm text-foreground mb-0.5 tracking-tight">{s.val}</div>
              <div className="text-[9px] text-muted-foreground/50">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Health */}
      <div className="border-b border-border">
        <div className="px-4 py-2.5 border-b border-border">
          <span className="text-[9px] tracking-widest uppercase text-muted-foreground/60">Health</span>
        </div>
        <div className="px-4 py-2.5 space-y-1.5">
          {[
            { label: "Healthy", count: okCount, dot: "bg-emerald-400" },
            { label: "Warning", count: warnCount, dot: "bg-amber-400" },
            { label: "Issues", count: errCount, dot: "bg-red-400" },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.dot}`} />
              <span className="text-[11px] text-muted-foreground flex-1">{item.label}</span>
              <span className="text-xs text-foreground">{item.count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Pipeline */}
      {inst && (
        <div className="border-b border-border">
          <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
            <span className="text-[9px] tracking-widest uppercase text-muted-foreground/60">Pipeline</span>
          </div>
          <div className="px-4 py-3">
            {[
              {
                name: meta ? meta.etlScript : "scrape",
                detail: meta ? meta.method : "unknown",
                status: "ok" as const,
                time: `${inst.totalObjects.toLocaleString()}`,
              },
              {
                name: "geocode()",
                detail: meta ? meta.geocoding : "—",
                status: inst.geocodedCount > 0 ? "ok" as const : "idle" as const,
                time: `${inst.geocodedCount.toLocaleString()}`,
              },
              {
                name: "classify_origins",
                detail: `${inst.originTypes.valid + inst.originTypes.historical + inst.originTypes.cultural} classified`,
                status: (inst.originTypes.valid + inst.originTypes.historical + inst.originTypes.cultural) > 0 ? "ok" as const : "idle" as const,
                time: `${inst.originTypes.invalid} invalid`,
              },
              {
                name: "enrich (LLM)",
                detail: `${inst.enrichedCount} enriched`,
                status: inst.enrichedCount > 0 ? "ok" as const : "idle" as const,
                time: inst.enrichedCount > 0 ? `${Math.round(inst.enrichedCount / inst.totalObjects * 100)}%` : "—",
              },
              {
                name: "postgis_write",
                detail: "museum_objects",
                status: "ok" as const,
                time: `${inst.totalObjects.toLocaleString()}`,
              },
            ].map((stage, i) => (
              <div key={i}>
                {i > 0 && <div className="w-px h-1.5 bg-border ml-[7px] mb-0.5 -mt-1" />}
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-[14px] h-[14px] rounded-md flex items-center justify-center text-[8px] flex-shrink-0 ${
                    stage.status === "ok"
                      ? "bg-emerald-50 text-emerald-500"
                      : "bg-secondary text-muted-foreground/40"
                  }`}>
                    {stage.status === "ok" ? "✓" : "○"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] text-muted-foreground truncate">{stage.name}</div>
                    <div className="text-[9px] text-muted-foreground/50 truncate">{stage.detail}</div>
                  </div>
                  <span className="text-[9px] text-muted-foreground/50 flex-shrink-0">{stage.time}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All institutions */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-2.5 border-b border-border">
          <span className="text-[9px] tracking-widest uppercase text-muted-foreground/60">All</span>
        </div>
        <div className="px-4 py-1">
          {institutions.map((i) => {
            const status = resolverStatus(i)
            return (
              <div key={i.name} className="flex items-center gap-2 py-1.5 border-b border-border/50 last:border-0">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  status === "ok" ? "bg-emerald-400" : status === "warn" ? "bg-amber-400" : "bg-red-400"
                }`} />
                <span className="text-[10px] text-muted-foreground flex-1 truncate">{i.name}</span>
                <span className="text-[9px] text-muted-foreground/50">{i.resolvedPct}%</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

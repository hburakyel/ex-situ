"use client"

import { useState } from "react"
import type { InstitutionStats } from "./types"
import { getETLMeta, resolverStatus } from "./types"

function statusDotClass(status: string) {
  switch (status) {
    case "ok":    return "bg-emerald-400"
    case "warn":  return "bg-amber-400"
    case "err":   return "bg-red-400"
    default:      return "bg-muted-foreground/40"
  }
}

function categoryClasses(cat: 1 | 2 | 3) {
  switch (cat) {
    case 1: return "bg-emerald-50 text-emerald-600 border border-emerald-100"
    case 2: return "bg-blue-50 text-blue-600 border border-blue-100"
    case 3: return "bg-amber-50 text-amber-600 border border-amber-100"
  }
}

interface ResolverListProps {
  institutions: InstitutionStats[]
  activeIndex: number
  onSelect: (index: number) => void
  loading: boolean
}

export function ResolverList({ institutions, activeIndex, onSelect, loading }: ResolverListProps) {
  const [filter, setFilter] = useState("")

  const filtered = institutions.filter((inst) =>
    inst.name.toLowerCase().includes(filter.toLowerCase()) ||
    (inst.place && inst.place.toLowerCase().includes(filter.toLowerCase()))
  )

  return (
    <div className="w-[260px] flex-shrink-0 border-r border-border bg-background flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <span className="text-[9px] tracking-widest uppercase text-muted-foreground/60">
          Institutions
        </span>
        <span className="text-[10px] text-muted-foreground">
          {institutions.length}
        </span>
      </div>

      <div className="px-3 py-2 border-b border-border flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground/50">⌕</span>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter..."
          className="text-[11px] text-foreground placeholder:text-muted-foreground/40 bg-transparent border-none outline-none flex-1"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="px-4 py-8 text-center">
            <div className="text-[10px] text-muted-foreground/50 animate-pulse">loading...</div>
          </div>
        )}

        {!loading && filtered.map((inst) => {
          const origIdx = institutions.indexOf(inst)
          const isActive = origIdx === activeIndex
          const status = resolverStatus(inst)
          const meta = getETLMeta(inst.name)

          return (
            <div
              key={inst.name}
              onClick={() => onSelect(origIdx)}
              className={`
                px-4 py-2.5 border-b border-border cursor-pointer transition-colors duration-100
                ${isActive ? "bg-secondary border-l-2 border-l-foreground pl-3.5" : "hover:bg-secondary/50"}
              `}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-xs text-foreground truncate pr-2">
                  {inst.name}
                </span>
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDotClass(status)}`} />
              </div>

              <div className="text-[9px] text-muted-foreground flex gap-1.5 items-center">
                <span className="text-muted-foreground">{inst.totalObjects.toLocaleString()}</span>
                <span>·</span>
                <span>{inst.resolvedPct}%</span>
              </div>

              {inst.place && (
                <div className="text-[9px] text-muted-foreground/50 mt-0.5">
                  {inst.place}
                </div>
              )}

              {meta && (
                <span className={`text-[8px] px-1.5 py-px rounded-md mt-1 inline-block ${categoryClasses(meta.category)}`}>
                  CAT {meta.category}
                </span>
              )}
            </div>
          )
        })}

        {!loading && filtered.length === 0 && filter && (
          <div className="px-4 py-6 text-center text-[10px] text-muted-foreground/50">
            no matches for &quot;{filter}&quot;
          </div>
        )}
      </div>
    </div>
  )
}

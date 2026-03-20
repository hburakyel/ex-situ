"use client"

import type { ResolverTotals } from "./types"

interface TopBarProps {
  totals: ResolverTotals | null
}

export function TopBar({ totals }: TopBarProps) {
  return (
    <div className="flex items-center px-5 h-11 border-b border-border bg-background flex-shrink-0">
      <div className="text-xs tracking-wide text-foreground pr-5 border-r border-border mr-5">
        Ex Situ <span className="text-muted-foreground/50">/</span> <span className="text-muted-foreground">resolvers</span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <a
          href="/map"
          className="text-[10px] text-muted-foreground border border-border rounded-lg px-3 py-[5px] hover:border-foreground/30 hover:text-foreground transition-colors no-underline"
        >
          Map
        </a>
      </div>
    </div>
  )
}

interface BottomBarProps {
  totals: ResolverTotals | null
  loading: boolean
}

export function BottomBar({ totals, loading }: BottomBarProps) {
  return (
    <div className="h-[30px] border-t border-border bg-background flex items-center px-4 gap-4 flex-shrink-0">
      <div className="text-[9px] text-muted-foreground/60 flex items-center gap-1.5">
        <span className={`w-[5px] h-[5px] rounded-full ${loading ? "bg-amber-400 animate-pulse" : "bg-emerald-400"}`} />
        {loading ? "loading..." : "connected"}
      </div>
      {totals && (
        <>
          <div className="text-[9px] text-muted-foreground/60">
            {totals.totalInstitutions} institutions · {totals.totalObjects.toLocaleString()} artifacts
          </div>
          <div className="text-[9px] text-muted-foreground/60">
            {totals.totalGeocoded.toLocaleString()} geocoded · {totals.totalCountries} places
          </div>
        </>
      )}
      <div className="flex-1" />
      <div className="text-[9px] text-muted-foreground/60">
        PostGIS · Nominatim
      </div>
    </div>
  )
}

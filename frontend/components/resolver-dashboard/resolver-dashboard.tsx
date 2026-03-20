"use client"

import { useState, useMemo } from "react"
import { useResolverStats, useResolverDetail } from "./use-resolver-data"
import { TopBar, BottomBar } from "./topbar"
import { ResolverList } from "./resolver-list"
import { InstitutionDetail } from "./institution-detail"
import { RightPanel } from "./right-panel"

export function ResolverDashboard() {
  const { data, loading, error, refetch } = useResolverStats()
  const [activeIndex, setActiveIndex] = useState<number>(0)
  const [activeTab, setActiveTab] = useState("Overview")

  const institutions = useMemo(() => data?.institutions ?? [], [data])
  const totals = data?.totals ?? null

  const activeInst = institutions[activeIndex] ?? null
  const { data: detail, loading: detailLoading } = useResolverDetail(activeInst?.name ?? null)

  if (error && !data) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-background text-muted-foreground gap-4">
        <div className="text-xs text-destructive">Failed to load resolver stats</div>
        <div className="text-[10px] text-muted-foreground max-w-md text-center">{error}</div>
        <button
          onClick={refetch}
          className="mt-2 px-4 py-1.5 rounded-lg bg-background border border-border text-xs text-muted-foreground hover:border-foreground/30 transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      <TopBar totals={totals} />

      <div className="flex flex-1 overflow-hidden">
        <ResolverList
          institutions={institutions}
          activeIndex={activeIndex}
          onSelect={(i) => { setActiveIndex(i); setActiveTab("Overview") }}
          loading={loading}
        />

        <div className="flex-1 overflow-hidden">
          {loading && !data ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-xs text-gray-300 animate-pulse">Loading…</div>
            </div>
          ) : activeInst ? (
            <InstitutionDetail
              institution={activeInst}
              detail={detail}
              detailLoading={detailLoading}
              activeTab={activeTab}
              onTabChange={setActiveTab}
            />
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-xs text-gray-300">No institution selected</div>
            </div>
          )}
        </div>

        <RightPanel
          totals={totals}
          institution={activeInst}
          institutions={institutions}
        />
      </div>

      <BottomBar totals={totals} loading={loading} />
    </div>
  )
}

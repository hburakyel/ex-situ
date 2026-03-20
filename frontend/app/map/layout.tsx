"use client"

import type React from "react"

export default function MapLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden" suppressHydrationWarning>
      <main className="flex-1 min-h-0 relative" suppressHydrationWarning>
        {children}
      </main>
    </div>
  )
}

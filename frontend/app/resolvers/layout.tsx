import type React from "react"

export default function ResolversLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="resolver-dashboard-root">
      {children}
    </div>
  )
}

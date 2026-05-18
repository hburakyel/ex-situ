import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Design System — Ex Situ",
  description:
    "Ex Situ design system reference: tokens, components, and patterns used across the application.",
}

export default function DesignLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Allow scrolling and full height
  return (
    <div className="min-h-screen w-full bg-white">
      {children}
    </div>
  )
}

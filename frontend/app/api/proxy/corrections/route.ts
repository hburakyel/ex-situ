import { type NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const rawUrl = process.env.NEXT_PUBLIC_API_BASE_URL
  if (!rawUrl) {
    return NextResponse.json({ error: "API_BASE_URL is not configured" }, { status: 500 })
  }

  const apiBaseUrl = rawUrl.replace("://localhost", "://127.0.0.1")
  // Only forward known safe parameters
  const ALLOWED_PARAMS = new Set(['institution', 'page', 'pageSize'])
  const safeParams = new URLSearchParams()
  for (const [key, value] of request.nextUrl.searchParams.entries()) {
    if (ALLOWED_PARAMS.has(key)) {
      safeParams.set(key, value)
    }
  }
  const paramStr = safeParams.toString()
  const url = `${apiBaseUrl}/museum-objects/pending-corrections${paramStr ? `?${paramStr}` : ""}`

  try {
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    })
    const data = await response.json()
    if (!response.ok) {
      return NextResponse.json(data, { status: response.status })
    }
    return NextResponse.json(data)
  } catch (error: any) {
    console.error("[Corrections Proxy] GET error:", error.message)
    return NextResponse.json({ error: "Failed to fetch corrections" }, { status: 500 })
  }
}

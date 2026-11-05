import { type NextRequest, NextResponse } from "next/server"
import { usableDateSpans } from "@/lib/era-buckets"

// Bucket counts only change when the underlying data changes: cached by nginx in production.
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL

  if (!apiBaseUrl) {
    return NextResponse.json({ error: "API_BASE_URL is not configured" }, { status: 500 })
  }

  try {
    // Only forward known safe parameters
    const ALLOWED_PARAMS = new Set(['institution', 'city', 'country', 'precise'])
    const safeParams = new URLSearchParams()
    for (const [key, value] of searchParams.entries()) {
      if (ALLOWED_PARAMS.has(key)) safeParams.set(key, value)
    }
    const resolvedBaseUrl = apiBaseUrl.replace('localhost', '127.0.0.1')
    const apiURL = `${resolvedBaseUrl}/museum-objects/date-buckets?${safeParams.toString()}`

    const response = await fetch(apiURL, {
      headers: { "Content-Type": "application/json", "User-Agent": "ExSitu/1.0" },
      cache: "no-store",
    })
    if (!response.ok) throw new Error(`API error: ${response.status}`)
    const data = await response.json()
    if (Array.isArray(data.objectDateSpans) && Array.isArray(data.objectDateBuckets)) {
      const counts = Object.fromEntries(data.objectDateBuckets.map((b: { id: string; count: number }) => [b.id, b.count]))
      data.objectDateSpans = usableDateSpans(counts, data.objectDateSpans)
    }

    return NextResponse.json(data, { headers: { "Cache-Control": "public, max-age=300" } })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: "Failed to fetch date buckets", details: errorMessage }, { status: 500 })
  }
}

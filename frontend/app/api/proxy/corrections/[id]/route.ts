import { type NextRequest, NextResponse } from "next/server"

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const rawUrl = process.env.NEXT_PUBLIC_API_BASE_URL
  if (!rawUrl) {
    return NextResponse.json({ error: "API_BASE_URL is not configured" }, { status: 500 })
  }

  // Validate ID is numeric to prevent path traversal
  const { id } = params
  if (!id || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: "Invalid object ID" }, { status: 400 })
  }

  const apiBaseUrl = rawUrl.replace("://localhost", "://127.0.0.1")
  const url = `${apiBaseUrl}/museum-objects/${id}/correct`

  try {
    const body = await request.json()
    const response = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const data = await response.json()
    if (!response.ok) {
      return NextResponse.json(data, { status: response.status })
    }
    return NextResponse.json(data)
  } catch (error: any) {
    console.error("[Corrections Proxy] PATCH error:", error.message)
    return NextResponse.json({ error: "Failed to apply correction" }, { status: 500 })
  }
}

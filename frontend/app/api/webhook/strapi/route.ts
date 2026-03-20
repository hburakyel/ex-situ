import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { revalidateTag } from "next/cache"
import { timingSafeEqual } from "crypto"

// Constant-time token comparison to prevent timing attacks
function safeTokenCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

let lastWebhookUpdate = Date.now()

// Add OPTIONS method handler for CORS preflight requests
export async function OPTIONS() {
  const allowedOrigin = process.env.STRAPI_WEBHOOK_ORIGIN || process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:1337"
  return NextResponse.json(
    {},
    {
      headers: {
        "Access-Control-Allow-Origin": new URL(allowedOrigin).origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
      },
    },
  )
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    if (!body?.model) {
      console.warn("no model provided")
      return NextResponse.json({ message: "no model provided" }, { status: 400 })
    }

    const headersList = await headers()
    const authHeader = headersList.get("Authorization")

    // Check if STRAPI_API_TOKEN is set
    if (!process.env.STRAPI_API_TOKEN) {
      console.warn("STRAPI_API_TOKEN environment variable is not set")
      return NextResponse.json({ message: "API token not configured" }, { status: 500 })
    }

    // More flexible token verification
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.warn("No Bearer token provided")
      return NextResponse.json({ message: "Bearer token required" }, { status: 401 })
    }

    const token = authHeader.split(" ")[1] // Extract token from "Bearer <token>"

    if (!safeTokenCompare(token, process.env.STRAPI_API_TOKEN)) {
      return NextResponse.json({ message: "unauthorized" }, { status: 401 })
    }

    const tag = body.model

    if (!tag) {
      console.warn("no tag provided")
      return NextResponse.json({ message: "no tag provided" }, { status: 400 })
    }

    const now = Date.now()
    if (now - lastWebhookUpdate < 5000) {
      console.warn("webhook called too soon")
      return NextResponse.json({ message: "webhook called too soon" }, { status: 429 })
    }

    revalidateTag(tag)
    lastWebhookUpdate = now

    console.log(`revalidated tag ${tag}`)
    return NextResponse.json(
      {
        revalidated: true,
        now: Date.now(),
      },
    )
  } catch (error) {
    console.error("Error revalidating tag:", error)
    return NextResponse.json({ message: "Error revalidating tag" }, { status: 500 })
  }
}

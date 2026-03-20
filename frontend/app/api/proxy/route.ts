import { type NextRequest, NextResponse } from "next/server"

// Rate limiting variables
let lastRequestTime = 0
const MIN_REQUEST_INTERVAL = 1000 // Minimum 1 second between requests
const requestCounts: Record<string, { count: number; resetTime: number }> = {}

// Simple in-memory cache for API responses
const responseCache: Map<string, { data: any; timestamp: number }> = new Map()
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

// Function to wait for a specified time
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Verify webhook token if provided
const verifyWebhookToken = (request: NextRequest) => {
  const token = request.headers.get("x-webhook-token")
  if (process.env.STRAPI_WEBHOOK_TOKEN && token !== process.env.STRAPI_WEBHOOK_TOKEN) {
    return false
  }
  return true
}

// Allowed query parameters for the proxy
const ALLOWED_PARAMS = new Set([
  "filters[latitude][$gte]", "filters[latitude][$lte]",
  "filters[longitude][$gte]", "filters[longitude][$lte]",
  "filters[from_place][$containsi]", "filters[from_city][$containsi]",
  "filters[from_country][$containsi]", "filters[institution_name][$containsi]",
  "filters[institution_name][$eq]",
  "filters[title][$containsi]", "filters[inventory_number][$containsi]",
  "pagination[page]", "pagination[pageSize]",
  "sort", "populate",
])

// Strip disallowed query params to prevent Strapi filter injection
function sanitizeSearchParams(params: URLSearchParams): URLSearchParams {
  const sanitized = new URLSearchParams()
  for (const [key, value] of params.entries()) {
    if (ALLOWED_PARAMS.has(key)) {
      sanitized.set(key, value)
    }
  }
  return sanitized
}

export async function GET(request: NextRequest) {
  // Check if this is a webhook request with a token
  if (request.headers.has("x-webhook-token") && !verifyWebhookToken(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const searchParams = request.nextUrl.searchParams
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL
  const clientIp = request.headers.get("x-forwarded-for") || "unknown"

  // Generate cache key from the request URL
  const cacheKey = request.nextUrl.toString()

  // Check cache first
  const cachedResponse = responseCache.get(cacheKey)
  if (cachedResponse && Date.now() - cachedResponse.timestamp < CACHE_DURATION) {
    console.log("Using cached response for:", cacheKey)
    return NextResponse.json(cachedResponse.data, {
      headers: {
        "Cache-Control": "public, max-age=300", // Cache for 5 minutes
        "X-Cache": "HIT",
      },
    })
  }

  if (!apiBaseUrl) {
    return NextResponse.json({ error: "API_BASE_URL is not set" }, { status: 500 })
  }

  // Implement rate limiting
  const now = Date.now()

  // Reset counter if it's been more than 60 seconds
  if (!requestCounts[clientIp] || now > requestCounts[clientIp].resetTime) {
    requestCounts[clientIp] = { count: 0, resetTime: now + 60000 } // Reset after 60 seconds
  }

  // Increment request count
  requestCounts[clientIp].count++

  // If more than 10 requests in the window, rate limit
  if (requestCounts[clientIp].count > 10) {
    const retryAfter = Math.ceil((requestCounts[clientIp].resetTime - now) / 1000)
    return NextResponse.json(
      { error: "Too many requests, please try again later" },
      {
        status: 429,
        headers: {
          "Retry-After": retryAfter.toString(),
          "X-RateLimit-Limit": "10",
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": Math.ceil(requestCounts[clientIp].resetTime / 1000).toString(),
        },
      },
    )
  }

  // Add delay between requests
  const timeSinceLastRequest = now - lastRequestTime
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await wait(MIN_REQUEST_INTERVAL - timeSinceLastRequest)
  }
  lastRequestTime = Date.now()

  try {
    // Fix localhost DNS resolution issue in Node.js by converting to 127.0.0.1
    const fixedApiBaseUrl = apiBaseUrl.replace('localhost', '127.0.0.1')
    const sanitizedParams = sanitizeSearchParams(searchParams)
    const apiURL = `${fixedApiBaseUrl}/museum-objects?${sanitizedParams.toString()}`
    console.log("Proxying request to:", apiURL)

    const response = await fetch(apiURL, {
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "ExSitu/1.0", // Add a user agent to identify our app
      },
      cache: "force-cache", // Use cache when possible
    })

    // Handle rate limiting from the upstream API
    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after") || "60"
      return NextResponse.json(
        { error: "The upstream API is rate limiting our requests. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": retryAfter,
          },
        },
      )
    }

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`API error: ${response.status}`, errorText)
      return NextResponse.json(
        { error: `API error: ${response.status}`, details: errorText },
        { status: response.status },
      )
    }

    const data = await response.json()

    // Store in cache
    responseCache.set(cacheKey, { data, timestamp: Date.now() })

    // Clean up old cache entries if cache is too large
    if (responseCache.size > 100) {
      const oldestEntries = Array.from(responseCache.entries())
        .sort(([, a], [, b]) => a.timestamp - b.timestamp)
        .slice(0, 20) // Remove oldest 20 entries

      oldestEntries.forEach(([key]) => responseCache.delete(key))
    }

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, max-age=300", // Cache for 5 minutes
        "X-Cache": "MISS",
      },
    })
  } catch (error) {
    console.error("❌ Proxy Fetch Error:", error)
    return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 })
  }
}

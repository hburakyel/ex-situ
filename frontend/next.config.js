// 'unsafe-inline' is required by the App Router's inline bootstrap scripts
// (removing it means per-request nonces, which would make every page dynamic).
// 'unsafe-eval' is only needed by the dev server's React Refresh.
const isDev = process.env.NODE_ENV !== "production"
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://images.metmuseum.org https://recherche.smb.museum https://www.britishmuseum.org https://upload.wikimedia.org https://id.smb.museum https://framemark.vam.ac.uk https://smb.museum-digital.de https://asset.museum-digital.org https://search.smb.museum https://www.artic.edu",
  "connect-src 'self' https://api.protomaps.com https://fonts.openmaptiles.org https://protomaps.github.io",
  "font-src 'self' data: https://fonts.openmaptiles.org",
  "worker-src 'self' blob:",
  "child-src blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ")

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    // Add fallbacks for node modules
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      os: false,
    }

    // pnpm uses symlinked node_modules; webpack's snapshot resolver can't
    // follow the real paths, causing "Unable to snapshot resolve dependencies".
    // Setting managedPaths to [] makes webpack treat all paths uniformly.
    config.snapshot = {
      ...config.snapshot,
      managedPaths: [],
    }

    return config
  },
  async headers() {
    const allowedOrigin = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"
    return [
      // ── Security headers for all routes ──
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
        ],
      },
      // ── CORS for API routes — restricted to our own origin ──
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: allowedOrigin },
          { key: "Access-Control-Allow-Methods", value: "GET,POST,OPTIONS" },
          {
            key: "Access-Control-Allow-Headers",
            value:
              "X-Requested-With, Accept, Content-Type, Authorization",
          },
        ],
      },
    ]
  },
  async redirects() {
    return [
      {
        source: "/research/arc/:slug",
        destination: "/map?place=:slug",
        permanent: false,
      },
      {
        source: "/research/collection/:slug",
        destination: "/map?institution=:slug",
        permanent: false,
      },
      {
        source: "/research",
        destination: "/map",
        permanent: false,
      },
    ]
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

module.exports = nextConfig

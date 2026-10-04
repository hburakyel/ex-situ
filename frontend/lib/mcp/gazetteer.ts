import fs from "fs"
import path from "path"
import zlib from "zlib"
import type { Gazetteer } from "./origins"

// GeoNames-derived lookup built by etl/build_mcp_gazetteer.py. Read from disk
// once per server process (~1 MB gzipped) rather than bundled into the route.

let cached: Gazetteer | null | undefined

function candidatePaths(): string[] {
  const rel = path.join("lib", "mcp", "gazetteer.json.gz")
  return [path.join(process.cwd(), rel), path.join(process.cwd(), "frontend", rel)]
}

/** Returns null (precision labels are then omitted) if the file is missing or unreadable. */
export function loadGazetteer(): Gazetteer | null {
  if (cached !== undefined) return cached
  cached = null
  for (const file of candidatePaths()) {
    try {
      const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8"))
      cached = {
        countries: new Set<string>(data.countries),
        regions: new Set<string>(data.regions),
        cities: new Set<string>(data.cities),
      }
      break
    } catch {
      // try the next location
    }
  }
  if (!cached) console.error("[mcp] gazetteer.json.gz not found; origin precision labels disabled")
  return cached
}

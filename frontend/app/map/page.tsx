import type { Metadata } from "next"
import MapPageClient from "./map-page-client"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:1337/api"
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://exsitu.app"

function fixLocalhost(url: string) {
	return url.replace("localhost", "127.0.0.1")
}

interface GeoEntry {
	place_name?: string
	place_name_normalized?: string
	institution_name?: string
	object_count?: number
	sample_img_url?: string | null
}

async function fetchGeoEntries(zoom: "1" | "4", params: { country?: string; institution?: string }): Promise<GeoEntry[]> {
	try {
		const search = new URLSearchParams({ zoom })
		if (params.country) search.set("country", params.country)
		if (params.institution) search.set("institution", params.institution)

		const res = await fetch(fixLocalhost(`${API_BASE}/museum-objects/geospatial?${search.toString()}`), {
			next: { revalidate: 600 },
		})
		if (!res.ok) return []
		const json = await res.json()
		return Array.isArray(json?.data) ? (json.data as GeoEntry[]) : []
	} catch {
		return []
	}
}

// Mirrors ALLOWED_IMAGE_DOMAINS in app/api/img/route.ts — only those hosts can
// be proxied there, so an image outside this set must stay a direct link.
const PROXIABLE_IMAGE_DOMAINS = new Set([
	"images.metmuseum.org",
	"collectionapi.metmuseum.org",
	"www.britishmuseum.org",
	"recherche.smb.museum",
	"upload.wikimedia.org",
	"commons.wikimedia.org",
	"id.smb.museum",
	"framemark.vam.ac.uk",
	"smb.museum-digital.de",
	"asset.museum-digital.org",
	"search.smb.museum",
])

// Some source CDNs (e.g. id.smb.museum) hotlink-block requests that lack a
// browser-like User-Agent/Referer, which left link-preview bots with a broken
// og:image. Route those through our proxy (which spoofs the right headers);
// anything outside the proxy's allowlist stays a direct link.
function buildOgImageUrl(imgUrl: string): string {
	try {
		const hostname = new URL(imgUrl).hostname
		if (PROXIABLE_IMAGE_DOMAINS.has(hostname)) {
			return `${SITE_URL}/api/img?url=${encodeURIComponent(imgUrl)}&w=1200`
		}
	} catch {
		// not a valid absolute URL — fall through to raw
	}
	return imgUrl
}

const DEFAULT_TITLE = "Ex Situ — Map"
const DEFAULT_DESCRIPTION =
	"Explore the global spatial index of cultural heritage objects. Browse provenance arcs by country, institution, and collection on an interactive map."

export async function generateMetadata({
	searchParams,
}: {
	searchParams: Promise<{ place?: string; site?: string; institution?: string }>
}): Promise<Metadata> {
	const { place, site, institution } = await searchParams

	if (!place && !institution) {
		return { title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION }
	}

	const hasDistinctSite = !!site && site.toLowerCase() !== (place || "").toLowerCase()
	const locationLabel = hasDistinctSite ? site : place
	const title = locationLabel
		? `${locationLabel} | Ex Situ`
		: institution
			? `${institution} | Ex Situ`
			: DEFAULT_TITLE

	// Site-level entries live at zoom=4 (one row per site within a country);
	// country-level entries live at zoom=1 — same split the map UI itself uses.
	const entries = await fetchGeoEntries(hasDistinctSite ? "4" : "1", { country: place, institution })
	const scoped = hasDistinctSite
		? entries.filter((e) => (e.place_name_normalized || e.place_name || "").toLowerCase() === (site as string).toLowerCase())
		: entries
	const relevant = scoped.length > 0 ? scoped : entries

	const totalObjects = relevant.reduce((sum, e) => sum + (e.object_count ?? 0), 0)
	const institutions = [...new Set(relevant.map((e) => e.institution_name).filter(Boolean))].slice(0, 3) as string[]
	const sampleImage = relevant.find((e) => e.sample_img_url)?.sample_img_url

	const subject = locationLabel || institution || "this collection"
	const description = totalObjects > 0
		? `${totalObjects.toLocaleString()} cultural heritage objects from ${subject}${institutions.length > 0 ? `, held at ${institutions.join(", ")}` : ""}. Explore provenance on Ex Situ.`
		: `Explore cultural heritage objects from ${subject} and their institutional provenance on Ex Situ.`

	const images = sampleImage
		? [{ url: buildOgImageUrl(sampleImage), alt: `${subject} artifact` }]
		: undefined

	return {
		title,
		description,
		openGraph: {
			title,
			description,
			type: "website",
			images,
		},
		twitter: {
			card: images ? "summary_large_image" : "summary",
			title,
			description,
			images: images?.map((i) => i.url),
		},
	}
}

export default function MapPage() {
	return <MapPageClient />
}

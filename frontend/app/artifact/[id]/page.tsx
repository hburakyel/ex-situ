import type { Metadata } from "next"

import type { MuseumObject } from "@/types"

import ArtifactRedirect from "./artifact-redirect"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:1337/api"
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://exsitu.app"

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

function fixLocalhost(url: string) {
	return url.replace("localhost", "127.0.0.1")
}

// Some source CDNs (e.g. id.smb.museum) hotlink-block requests that lack a
// browser-like User-Agent/Referer, which left link-preview bots with a broken
// og:image. Route those through our proxy (which spoofs the right headers);
// anything outside the proxy's allowlist stays a direct link.
function buildOgImageUrl(rawUrl: string): string {
	try {
		const hostname = new URL(rawUrl).hostname
		if (PROXIABLE_IMAGE_DOMAINS.has(hostname)) {
			return `${SITE_URL}/api/img?url=${encodeURIComponent(rawUrl)}&w=1200`
		}
	} catch {
		// not a valid absolute URL — fall through to raw
	}
	return rawUrl
}

async function fetchArtifact(id: string): Promise<MuseumObject | null> {
	if (!/^\d+$/.test(id)) {
		return null
	}

	try {
		const response = await fetch(fixLocalhost(`${API_BASE}/museum-objects/${id}?populate=*`), {
			next: { revalidate: 600 },
		})

		if (!response.ok) {
			return null
		}

		const json = await response.json()
		return (json?.data as MuseumObject | undefined) ?? null
	} catch {
		return null
	}
}

function buildArtifactTitle(artifact: MuseumObject | null, id: string) {
	const rawTitle = artifact?.attributes.title?.trim()
	if (rawTitle) {
		return `${rawTitle} | Ex Situ`
	}

	const inventoryNumber = artifact?.attributes.inventory_number?.trim()
	if (inventoryNumber) {
		return `${inventoryNumber} | Ex Situ`
	}

	return `Artifact ${id} | Ex Situ`
}

function buildArtifactDescription(artifact: MuseumObject | null) {
	if (!artifact) {
		return "Explore this cultural heritage artifact and its provenance on Ex Situ."
	}

	const { attributes } = artifact
	const origin = attributes.place_name_normalized || attributes.place_name || attributes.country_en || "Unknown origin"
	const institution = attributes.institution_name || "Unknown collection"

	return `${origin} to ${institution}. Explore this cultural heritage artifact and its provenance on Ex Situ.`
}

function hasValidCoordinates(lat?: number | null, lng?: number | null) {
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
		return false
	}

	return Math.abs(lat as number) <= 90
		&& Math.abs(lng as number) <= 180
		&& !(Math.abs(lat as number) < 1e-6 && Math.abs(lng as number) < 1e-6)
}

function buildArtifactRedirectUrl(id: string, artifact: MuseumObject | null) {
	const params = new URLSearchParams({ artifactId: id })

	const originLat = artifact?.attributes.latitude
	const originLng = artifact?.attributes.longitude
	const fallbackLat = artifact?.attributes.institution_latitude
	const fallbackLng = artifact?.attributes.institution_longitude

	const targetLat = hasValidCoordinates(originLat, originLng)
		? originLat
		: hasValidCoordinates(fallbackLat, fallbackLng)
			? fallbackLat
			: null
	const targetLng = hasValidCoordinates(originLat, originLng)
		? originLng
		: hasValidCoordinates(fallbackLat, fallbackLng)
			? fallbackLng
			: null

	if (targetLat !== null && targetLng !== null) {
		params.set("lat", String(targetLat))
		params.set("lng", String(targetLng))
		params.set("zoom", "14")
	}

	return `/map?${params.toString()}`
}

export async function generateMetadata({
	params,
}: {
	params: Promise<{ id: string }>
}): Promise<Metadata> {
	const { id } = await params
	const artifact = await fetchArtifact(id)
	const title = buildArtifactTitle(artifact, id)
	const description = buildArtifactDescription(artifact)
	const canonicalUrl = `${SITE_URL}/artifact/${encodeURIComponent(id)}`
	const rawImageUrl = artifact?.attributes.img_url?.trim()
	const imageUrl = rawImageUrl ? buildOgImageUrl(rawImageUrl) : undefined

	return {
		title,
		description,
		alternates: { canonical: canonicalUrl },
		openGraph: {
			title,
			description,
			url: canonicalUrl,
			type: "website",
			images: imageUrl
				? [
						{
							url: imageUrl,
							alt: artifact?.attributes.title || artifact?.attributes.inventory_number || "Artifact image",
						},
					]
				: undefined,
		},
		twitter: {
			card: imageUrl ? "summary_large_image" : "summary",
			title,
			description,
			images: imageUrl ? [imageUrl] : undefined,
		},
	}
}

export default async function ArtifactPage(
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params
	const artifact = await fetchArtifact(id)
	const redirectUrl = buildArtifactRedirectUrl(id, artifact)

	return (
		<>
			<ArtifactRedirect url={redirectUrl} />
			<noscript>
				<meta httpEquiv="refresh" content={`0;url=${redirectUrl}`} />
			</noscript>
		</>
	)
}

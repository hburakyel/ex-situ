import type { Metadata } from "next"

import type { MuseumObject } from "@/types"

import ArtifactRedirect from "./artifact-redirect"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:1337/api"
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://exsitu.app"

function fixLocalhost(url: string) {
	return url.replace("localhost", "127.0.0.1")
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
	const imageUrl = artifact?.attributes.img_url?.trim()

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

import { redirect } from "next/navigation"

export default async function ArtifactPage(
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params
	redirect(`/map?artifactId=${encodeURIComponent(id)}`)
}

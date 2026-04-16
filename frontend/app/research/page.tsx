import type { Metadata } from "next"
import ResearchClient from "./research-client"

export const metadata: Metadata = {
  title: "Research — Cultural Heritage Provenance | Ex Situ",
  description:
    "Browse all provenance arcs and institutional collections. Explore cultural heritage objects by country of origin and the museums that hold them.",
  openGraph: {
    title: "Research — Cultural Heritage Provenance | Ex Situ",
    description:
      "Browse all provenance arcs and institutional collections. Explore cultural heritage objects by country of origin and the museums that hold them.",
    url: "https://exsitu.app/research",
  },
}

export default function ResearchPage() {
  return <ResearchClient />
}


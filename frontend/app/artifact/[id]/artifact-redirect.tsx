"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"

export default function ArtifactRedirect({ url }: { url: string }) {
  const router = useRouter()
  useEffect(() => {
    router.replace(url)
  }, [router, url])
  return null
}

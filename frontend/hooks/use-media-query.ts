"use client"

import { useState, useEffect } from "react"

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    // Set initial value
    const media = window.matchMedia(query)
    setMatches(media.matches)

    // Create event listener
    const listener = () => setMatches(media.matches)

    // Add listener
    media.addEventListener("change", listener)

    // Remove listener on cleanup
    return () => media.removeEventListener("change", listener)
  }, [query])

  return matches
}

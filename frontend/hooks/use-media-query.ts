"use client"

import { useCallback, useSyncExternalStore } from "react"

// Read through useSyncExternalStore so the first client render already has the real
// value: the map renders client-side only, and a useState(false) + useEffect hook
// drew one frame of the desktop layout on phones before switching. On a server
// render React uses getServerSnapshot (false) and updates after hydration, so
// server-rendered users of this hook don't get a hydration mismatch.
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const media = window.matchMedia(query)
      media.addEventListener("change", onChange)
      return () => media.removeEventListener("change", onChange)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  )
}

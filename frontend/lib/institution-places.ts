"use client"

import { useEffect, useState } from "react"
import { INSTITUTION_CITIES } from "@/hooks/use-unified-search"

// Destination of an arc as a place: the institution's city (and country), from
// resolver-stats ("Stockholm, Sweden"). Loaded once per page; until then, and for
// any institution it lacks, the short built-in list is used.
export interface InstitutionPlace { city: string; country: string | null }

let loaded: Record<string, InstitutionPlace> | null = null
let pending: Promise<Record<string, InstitutionPlace>> | null = null

function load(): Promise<Record<string, InstitutionPlace>> {
  if (loaded) return Promise.resolve(loaded)
  pending ??= fetch("/api/proxy/resolver-stats")
    .then((r) => (r.ok ? r.json() : { institutions: [] }))
    .then((d: { institutions?: { name: string; place?: string | null }[] }) => {
      const map: Record<string, InstitutionPlace> = {}
      for (const i of d.institutions ?? []) {
        if (!i.place) continue
        const [city, ...rest] = i.place.split(",").map((s) => s.trim())
        if (city) map[i.name] = { city, country: rest.join(", ") || null }
      }
      loaded = map
      return map
    })
    .catch(() => ({}))
  return pending
}

export function useInstitutionPlaces(): (name: string) => InstitutionPlace | null {
  const [places, setPlaces] = useState<Record<string, InstitutionPlace>>(loaded ?? {})
  useEffect(() => { if (!loaded) load().then(setPlaces) }, [])
  return (name: string) =>
    places[name] ?? (INSTITUTION_CITIES[name] ? { city: INSTITUTION_CITIES[name], country: null } : null)
}

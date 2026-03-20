"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { 
  ChevronDownIcon, 
  ChevronUpIcon, 
  Cross2Icon, 
  MixerHorizontalIcon,
  MagnifyingGlassIcon,
  CheckIcon
} from "@radix-ui/react-icons"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

// Faceted filter types - supports multiple selections
export interface FacetedFilters {
  institutions: string[]
  countries: string[]
  cities: string[]
}

interface FilterOption {
  value: string
  label: string
  count: number
  filteredCount?: number // Count after applying other filters
}

interface RawStatsItem {
  country_en: string | null
  city_en: string | null
  institution_name: string
  total_objects: string
}

interface FacetedFilterProps {
  filters: FacetedFilters
  onFiltersChange: (filters: FacetedFilters) => void
}

// Static collections with short labels
const COLLECTION_LABELS: Record<string, string> = {
  "Ethnologisches Museum": "Ethnologisches Museum",
  "The Metropolitan Museum of Art": "The Met",
  "Museum für Islamische Kunst": "Museum für Islamische Kunst",
  "Ägyptisches Museum und Papyrussammlung": "Ägyptisches Museum",
  "Antikensammlung": "Antikensammlung",
  "Museum für Asiatische Kunst": "Museum für Asiatische Kunst",
  "Vorderasiatisches Museum": "Vorderasiatisches Museum",
}

// The special institution name used for spatial_documents content
export const WIKIPEDIA_COLLECTION = "Wikipedia"

// Feature flag — set to true to re-enable Wikipedia spatial documents layer
export const ENABLE_WIKIPEDIA = false

export function FacetedFilter({ filters, onFiltersChange }: FacetedFilterProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>(null)
  const [rawData, setRawData] = useState<RawStatsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [wikiCount, setWikiCount] = useState<number>(0)
  const [searchTerms, setSearchTerms] = useState<Record<string, string>>({
    institutions: "",
    countries: "",
    cities: ""
  })

  // Fetch raw data once
  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch('https://www.exsitu.app/api/stats')
        const data = await response.json()
        if (Array.isArray(data)) {
          setRawData(data)
        }
      } catch (error) {
        console.error('Failed to fetch filter data:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  // Fetch Wikipedia spatial_documents count (retry up to 3 times in case backend is still booting)
  useEffect(() => {
    if (!ENABLE_WIKIPEDIA) return
    let cancelled = false
    const fetchWikiCount = async (attempt = 1): Promise<void> => {
      try {
        const res = await fetch('/api/proxy/spatial-documents?zoom=0')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        const count = data.data?.reduce?.((sum: number, d: any) => sum + (d.doc_count || 1), 0) || data.count || data.data?.length || 0
        console.log('[FacetedFilter] Wikipedia count:', count)
        if (!cancelled) setWikiCount(count)
      } catch (err) {
        console.warn('[FacetedFilter] Wikipedia count fetch failed (attempt', attempt, '):', err)
        if (attempt < 3 && !cancelled) {
          await new Promise(r => setTimeout(r, 3000 * attempt))
          return fetchWikiCount(attempt + 1)
        }
      }
    }
    fetchWikiCount()
    return () => { cancelled = true }
  }, [])

  // Compute faceted counts - this is the key to cross-filtering
  const facetedOptions = useMemo(() => {
    if (!rawData.length) return { institutions: [], countries: [], cities: [] }

    // Filter raw data based on current selections (for cross-filtering)
    const filterData = (excludeCategory?: keyof FacetedFilters) => {
      return rawData.filter(item => {
        const count = parseInt(item.total_objects || '0', 10)
        if (count <= 0) return false

        // Apply institution filter (unless we're computing institution options)
        if (excludeCategory !== 'institutions' && filters.institutions.length > 0) {
          if (!filters.institutions.includes(item.institution_name)) return false
        }
        // Apply country filter (unless we're computing country options)
        if (excludeCategory !== 'countries' && filters.countries.length > 0) {
          if (!item.country_en || !filters.countries.includes(item.country_en)) return false
        }
        // Apply city filter (unless we're computing city options)
        if (excludeCategory !== 'cities' && filters.cities.length > 0) {
          if (!item.city_en || !filters.cities.includes(item.city_en)) return false
        }
        return true
      })
    }

    // Compute institution options (filtered by country/city selections)
    const institutionData = filterData('institutions')
    const institutionMap = new Map<string, number>()
    institutionData.forEach(item => {
      const count = parseInt(item.total_objects || '0', 10)
      institutionMap.set(item.institution_name, (institutionMap.get(item.institution_name) || 0) + count)
    })
    const institutions: FilterOption[] = Array.from(institutionMap.entries())
      .map(([value, count]) => ({
        value,
        label: COLLECTION_LABELS[value] || value,
        count
      }))
      .sort((a, b) => b.count - a.count)

    // Inject Wikipedia as a synthetic collection (from spatial_documents table)
    if (wikiCount > 0) {
      institutions.push({
        value: WIKIPEDIA_COLLECTION,
        label: "Wikipedia",
        count: wikiCount,
      })
    }

    // Compute country options (filtered by institution/city selections)
    const countryData = filterData('countries')
    const countryMap = new Map<string, number>()
    countryData.forEach(item => {
      if (item.country_en) {
        const count = parseInt(item.total_objects || '0', 10)
        countryMap.set(item.country_en, (countryMap.get(item.country_en) || 0) + count)
      }
    })
    const countries: FilterOption[] = Array.from(countryMap.entries())
      .map(([value, count]) => ({ value, label: value, count }))
      .sort((a, b) => b.count - a.count)

    // Compute city options (filtered by institution/country selections)
    const cityData = filterData('cities')
    const cityMap = new Map<string, number>()
    cityData.forEach(item => {
      if (item.city_en) {
        const count = parseInt(item.total_objects || '0', 10)
        cityMap.set(item.city_en, (cityMap.get(item.city_en) || 0) + count)
      }
    })
    const cities: FilterOption[] = Array.from(cityMap.entries())
      .map(([value, count]) => ({ value, label: value, count }))
      .sort((a, b) => b.count - a.count)

    return { institutions, countries, cities }
  }, [rawData, filters, wikiCount])

  // Count total active filters
  const activeFilterCount = useMemo(() => {
    return filters.institutions.length + filters.countries.length + filters.cities.length
  }, [filters])

  // Toggle a single value in a multi-select filter
  const toggleFilter = useCallback((
    category: keyof FacetedFilters,
    value: string
  ) => {
    const current = filters[category]
    const newValues = current.includes(value)
      ? current.filter(v => v !== value)
      : [...current, value]
    
    onFiltersChange({
      ...filters,
      [category]: newValues
    })
  }, [filters, onFiltersChange])

  // Clear a single category
  const clearCategory = useCallback((category: keyof FacetedFilters) => {
    onFiltersChange({
      ...filters,
      [category]: []
    })
  }, [filters, onFiltersChange])

  // Clear all filters
  const clearAll = useCallback(() => {
    onFiltersChange({
      institutions: [],
      countries: [],
      cities: []
    })
  }, [onFiltersChange])

  // Toggle section expanded/collapsed
  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section)
  }

  // Filter options by search term
  const getFilteredOptions = (options: FilterOption[], category: string) => {
    const term = searchTerms[category]?.toLowerCase() || ''
    if (!term) return options
    return options.filter(opt => 
      opt.label.toLowerCase().includes(term) || 
      opt.value.toLowerCase().includes(term)
    )
  }

  // Render a filter section with multi-select
  const renderSection = (
    id: keyof FacetedFilters,
    label: string,
    options: FilterOption[],
    showSearch: boolean = false
  ) => {
    const selected = filters[id]
    const filteredOptions = getFilteredOptions(options, id)
    const hasSelections = selected.length > 0

    return (
      <div key={id} className="border-b border-border/50 last:border-b-0 pb-2 last:pb-0">
        {/* Section header */}
        <button
          onClick={() => toggleSection(id)}
          className="w-full flex items-center justify-between py-1.5 text-left hover:bg-muted/30 rounded px-1 -mx-1 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-foreground">{label}</span>
            {hasSelections && (
              <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">
                {selected.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {hasSelections && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation()
                  clearCategory(id)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    clearCategory(id);
                  }
                }}
                className="text-[10px] text-muted-foreground hover:text-foreground px-1 cursor-pointer"
                aria-label={`Clear ${label} filter`}
              >
                clear
              </span>
            )}
            {expandedSection === id ? (
              <ChevronUpIcon className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDownIcon className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </button>

        {/* Expanded content */}
        {expandedSection === id && (
          <div className="mt-1">
            {/* Search input for large lists */}
            {showSearch && options.length > 10 && (
              <div className="relative mb-2">
                <MagnifyingGlassIcon className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <input
                  type="text"
                  placeholder={`Search ${label.toLowerCase()}...`}
                  value={searchTerms[id] || ''}
                  onChange={(e) => setSearchTerms(prev => ({ ...prev, [id]: e.target.value }))}
                  className="w-full text-xs pl-7 pr-2 py-1.5 border rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
            )}

            {/* Options list */}
            <div className="max-h-[200px] overflow-y-auto space-y-0.5">
              {filteredOptions.length === 0 ? (
                <div className="text-xs text-muted-foreground py-2 text-center">
                  No matches found
                </div>
              ) : (
                filteredOptions.map((option) => {
                  const isSelected = selected.includes(option.value)
                  return (
                    <button
                      key={option.value}
                      onClick={() => toggleFilter(id, option.value)}
                      className={cn(
                        "w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition-colors",
                        "hover:bg-muted/50",
                        isSelected && "bg-primary/5"
                      )}
                    >
                      {/* Checkbox */}
                      <div className={cn(
                        "w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors",
                        isSelected 
                          ? "bg-primary border-primary text-primary-foreground" 
                          : "border-muted-foreground/30"
                      )}>
                        {isSelected && <CheckIcon className="h-3 w-3" />}
                      </div>
                      
                      {/* Label and count */}
                      <span className={cn(
                        "flex-1 truncate",
                        isSelected && "font-medium"
                      )}>
                        {option.label}
                      </span>
                      <span className="text-muted-foreground tabular-nums">
                        {option.count.toLocaleString()}
                      </span>
                    </button>
                  )
                })
              )}
            </div>

            {/* Show total when filtered */}
            {searchTerms[id] && filteredOptions.length > 0 && (
              <div className="text-[10px] text-muted-foreground mt-1 pt-1 border-t">
                Showing {filteredOptions.length} of {options.length}
              </div>
            )}
          </div>
        )}

        {/* Show selected items when collapsed */}
        {expandedSection !== id && hasSelections && (
          <div className="flex flex-wrap gap-1 mt-1">
            {selected.slice(0, 3).map(value => {
              const opt = options.find(o => o.value === value)
              return (
                <span 
                  key={value}
                  className="inline-flex items-center gap-1 text-[10px] bg-muted/50 text-foreground px-1.5 py-0.5 rounded"
                >
                  <span className="truncate max-w-[80px]">
                    {opt?.label || value}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleFilter(id, value)
                    }}
                    className="hover:text-destructive"
                  >
                    <Cross2Icon className="h-2.5 w-2.5" />
                  </button>
                </span>
              )
            })}
            {selected.length > 3 && (
              <span className="text-[10px] text-muted-foreground">
                +{selected.length - 3} more
              </span>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="maplibregl-ctrl-icon flex items-center justify-center w-[29px] h-[29px] p-0 m-0 bg-transparent border-none hover:bg-black/5 cursor-pointer outline-none relative"
          aria-label="Filter"
          type="button"
        >
          <MixerHorizontalIcon className="h-[15px] w-[15px] block" />
          {activeFilterCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[9px] rounded-full w-4 h-4 flex items-center justify-center font-medium">
              {activeFilterCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent 
        side="right" 
        align="end" 
        className="w-[320px] p-0 ml-3 z-[1000] bg-white/95 backdrop-blur-md shadow-lg border border-black/10"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="font-semibold text-sm text-foreground">FILTER</span>
          {activeFilterCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAll}
              className="h-6 px-2 py-0 text-xs text-muted-foreground hover:text-foreground"
            >
              Clear all ({activeFilterCount})
            </Button>
          )}
        </div>

        {/* Filter sections */}
        <div className="p-4 space-y-2">
          {loading ? (
            <div className="text-xs text-muted-foreground py-4 text-center">
              Loading filters...
            </div>
          ) : (
            <>
              {renderSection('institutions', 'Collection', facetedOptions.institutions, false)}
              {renderSection('countries', 'Country', facetedOptions.countries, true)}
              {renderSection('cities', 'City', facetedOptions.cities, true)}
            </>
          )}
        </div>

        {/* Footer with result summary */}
        {activeFilterCount > 0 && (
          <div className="px-4 py-2 border-t bg-muted/30 text-xs text-muted-foreground">
            {(() => {
              // Calculate total objects matching current filters
              const matchingData = rawData.filter(item => {
                if (filters.institutions.length > 0 && !filters.institutions.includes(item.institution_name)) return false
                if (filters.countries.length > 0 && (!item.country_en || !filters.countries.includes(item.country_en))) return false
                if (filters.cities.length > 0 && (!item.city_en || !filters.cities.includes(item.city_en))) return false
                return true
              })
              const total = matchingData.reduce((sum, item) => sum + parseInt(item.total_objects || '0', 10), 0)
              return `${total.toLocaleString()} objects match your filters`
            })()}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

export default FacetedFilter

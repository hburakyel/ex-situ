"use client"

import React, { useState } from "react"
import Link from "next/link"
import { ChevronDown, ChevronUp, Search, X, MoreHorizontal, Check } from "lucide-react"
import {
  IconClose,
  IconSearch,
  IconDownloadCsv,
  IconExpand,
  IconMinimize,
  IconPanelClosed,
  IconPanelOpen,
  IconShare,
  IconSource,
} from "@/components/icons"

type Tab = "tokens" | "components" | "patterns" | "stack"

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] uppercase tracking-wider mt-8 mb-3 panel-text-muted">
      {children}
    </p>
  )
}

function Swatch({
  bg,
  label,
  sub,
  outline,
}: {
  bg: string
  label: string
  sub: string
  outline?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <div
        className="w-10 h-10 rounded-[10px]"
        style={{
          background: bg,
          boxShadow: outline ? "inset 0 0 0 1px #e5e7eb" : undefined,
        }}
      />
      <span className="text-[10px] text-gray-400">{label}</span>
      <span className="text-[10px] text-gray-400">{sub}</span>
    </div>
  )
}

// Simple modal for code view
function CodeModal({ open, onClose, code }: { open: boolean; onClose: () => void; code: string }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full mx-4 p-4 relative">
        <button
          className="absolute top-2 right-2 h-8 w-8 flex items-center justify-center hover:bg-gray-100 rounded-md"
          onClick={onClose}
          aria-label="Close code view"
        >
          <X className="w-5 h-5 text-gray-500" />
        </button>
        <pre className="overflow-x-auto text-xs leading-snug bg-gray-50 rounded-lg p-4 border border-gray-100 max-h-[70vh] whitespace-pre-wrap">
          {code}
        </pre>
      </div>
    </div>
  )
}

export default function DesignPage() {
  const [tab, setTab] = useState<Tab>("tokens")
  // For code view modal
  const [codeModal, setCodeModal] = useState<{ open: boolean; code: string }>({ open: false, code: "" })

  // Pass open/close to PatternsTab
  return (
    <div className="flex flex-col w-full bg-white">
      <div className="px-4 pt-4 pb-3 flex items-center justify-between">
        <span className="text-sm text-black">Ex Situ — Design System</span>
        <Link href="/map" className="text-[10px] panel-text-muted">
          ← map
        </Link>
      </div>

      <div className="sticky top-0 z-10 bg-white border-b border-gray-100">
        <div className="flex px-4">
          {(["tokens", "components", "patterns", "stack"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`relative py-2 pr-6 text-sm capitalize ${
                tab === t ? "text-black font-medium" : "text-gray-400"
              }`}
            >
              {t}
              {tab === t && (
                <span className="absolute left-0 right-6 bottom-0 h-px bg-black" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 px-4 py-4 overflow-y-auto" style={{ WebkitOverflowScrolling: "touch" }}>
        {tab === "tokens" && <TokensTab />}
        {tab === "components" && <ComponentsTab />}
        {tab === "patterns" && <PatternsTab onShowCode={(code) => setCodeModal({ open: true, code })} />}
        {tab === "stack" && <StackTab />}
      </div>
      <CodeModal open={codeModal.open} onClose={() => setCodeModal({ open: false, code: "" })} code={codeModal.code} />
    </div>
  )
}

// \u2500\u2500\u2500 TOKENS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

function TokensTab() {
  return (
    <div>
      <SectionLabel>Colors \u2014 Surface</SectionLabel>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-4">
        <Swatch bg="#ffffff" label="bg-white" sub="#fff" outline />
        <Swatch bg="#f9fafb" label="bg-gray-50" sub="#f9fafb" />
        <Swatch bg="#f5f5f5" label="hover card" sub="#f5f5f5" />
        <Swatch bg="#111111" label="map bg" sub="#111" />
      </div>

      <SectionLabel>Colors \u2014 Text</SectionLabel>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-4">
        <Swatch bg="#000000" label="text-black" sub="#000" />
        <Swatch bg="rgba(0,0,0,0.6)" label="black/60" sub="60%" />
        <Swatch bg="rgba(0,0,0,0.3)" label="black/30" sub="30%" />
        <Swatch bg="#737373" label="muted" sub="#737373" />
        <Swatch bg="#9ca3af" label="gray-400" sub="#9ca3af" />
        <Swatch bg="#6b7280" label="gray-500" sub="#6b7280" />
      </div>

      <SectionLabel>Colors \u2014 Chips &amp; Nodes</SectionLabel>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-4">
        <Swatch bg="#dbeafe" label="blue-100" sub="country chip" />
        <Swatch bg="#eff6ff" label="blue-50" sub="active row" />
        <Swatch bg="#fff7ed" label="orange-50" sub="institution" />
        <Swatch bg="#d1fae5" label="emerald-100" sub="city node" />
        <Swatch bg="#fef3c7" label="amber-100" sub="coll. node" />
        <Swatch bg="#f3f4f6" label="gray-100" sub="other node" />
      </div>

      <SectionLabel>Colors \u2014 Arcs (deck.gl WebGL)</SectionLabel>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-4">
        <Swatch bg="rgb(239,95,0)" label="arc default" sub="rgb(239,95,0)" />
        <Swatch bg="rgb(59,130,246)" label="arc source" sub="highlighted" />
        <Swatch bg="rgb(147,51,234)" label="arc target" sub="highlighted" />
      </div>
      <p className="text-[10px] text-gray-400 mt-2">
        Default: rgb(239,95,0) \u00b7 Highlighted source: rgb(59,130,246) \u00b7 Highlighted target: rgb(147,51,234) \u00b7 Width: 0.5\u20133px (country) / 2\u20136px (objects)
      </p>

      <SectionLabel>Colors \u2014 Ring / Selection</SectionLabel>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-4">
        <Swatch bg="rgb(59,130,246)" label="ring-blue-500" sub="image hover" />
      </div>
      <p className="text-[10px] text-gray-400 mt-2">
        ring-2 ring-blue-500 \u00b7 rounded-[4px] \u00b7 on image hover &amp; selected
      </p>

      <SectionLabel>Typography</SectionLabel>
      <div className="space-y-5">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-gray-400">text-sm \u00b7 14px \u00b7 font-mono \u00b7 base size (all text)</span>
          <span className="text-sm text-black">132 objects from Rwanda</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-gray-400">
            text-[10px] uppercase tracking-wider \u00b7 section labels (panel-text-muted)
          </span>
          <span className="text-[10px] uppercase tracking-wider panel-text-muted">Places</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-gray-400">
            breadcrumb \u00b7 text-sm \u00b7 black/60 \u2192 separator black/30 \u2192 last font-medium
          </span>
          <div className="flex items-center text-sm">
            <span className="text-black/60">All</span>
            <span className="text-black/30 mx-1">/</span>
            <span className="text-black/60">Rwanda</span>
            <span className="text-black/30 mx-1">/</span>
            <span className="text-black font-medium">Kigali</span>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-gray-400">text-[10px] \u00b7 chips \u00b7 path nodes \u00b7 ESC badge \u00b7 10px secondary labels</span>
        </div>
      </div>

      <SectionLabel>Border Radius</SectionLabel>
      <div className="flex items-end gap-6 flex-wrap">
        {[
          { r: "4px", label: "rounded-[4px]", desc: "image card" },
          { r: "6px", label: "rounded-md", desc: "chip" },
          { r: "10px", label: "rounded-[10px]", desc: "card / tooltip" },
          { r: "20px", label: "rounded-[20px]", desc: "palette" },
          { r: "24px", label: "rounded-2xl", desc: "panel" },
          { r: "9999px", label: "rounded-full", desc: "dot" },
        ].map(({ r, label, desc }) => (
          <div key={r} className="flex flex-col items-center gap-1">
            <div className="bg-gray-100 w-12 h-12" style={{ borderRadius: r }} />
            <span className="text-[10px] text-gray-400">{label}</span>
            <span className="text-[10px] text-gray-400">{desc}</span>
          </div>
        ))}
      </div>

      <SectionLabel>Shadows</SectionLabel>
      <div className="flex flex-wrap gap-8 pb-2">
        <div className="flex flex-col gap-2">
          <div className="bg-white rounded-[10px] w-24 h-14 shadow-lg" />
          <span className="text-[10px] text-gray-400">shadow-lg</span>
          <span className="text-[10px] text-gray-400">header panel</span>
        </div>
        <div className="flex flex-col gap-2">
          <div className="bg-white rounded-[20px] w-24 h-14 shadow-2xl" />
          <span className="text-[10px] text-gray-400">shadow-2xl</span>
          <span className="text-[10px] text-gray-400">command palette</span>
        </div>
        <div className="flex flex-col gap-2">
          <div
            className="bg-white rounded-2xl w-24 h-14"
            style={{
              boxShadow: "0 -2px 20px rgba(0,0,0,0.10), 0 8px 24px rgba(0,0,0,0.07)",
            }}
          />
          <span className="text-[10px] text-gray-400">custom</span>
          <span className="text-[10px] text-gray-400">mobile sheet</span>
        </div>
      </div>

      <SectionLabel>Motion</SectionLabel>
      <div className="space-y-3">
        <div>
          <span className="text-sm text-black">Mobile bottom-sheet spring</span>
          <br />
          <span className="text-[10px] text-gray-400">
            cubic-bezier(0.32, 0.72, 0, 1) \u00b7 350ms height
          </span>
        </div>
        <div>
          <span className="text-sm text-black">Desktop panel resize</span>
          <br />
          <span className="text-[10px] text-gray-400">
            cubic-bezier(0.4, 0, 0.2, 1) \u00b7 260ms width &amp; height
          </span>
        </div>
      </div>
    </div>
  )
}

// \u2500\u2500\u2500 COMPONENTS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

// Object card: matches object-grid.tsx exactly
// Wrapper: group relative cursor-pointer bg-white p-1 h-44 flex items-center justify-center
// Ring container: relative inline-flex overflow-hidden bg-white rounded-[4px]
// Ring: ring-2 ring-blue-500 on hover or selected
function ObjectCard({
  selected,
  label,
}: {
  selected?: boolean
  label?: string
}) {
  const [hovered, setHovered] = useState(false)
  const active = selected || hovered
  return (
    <div
      className="group relative cursor-pointer transition-all duration-200 bg-white p-1 flex items-center justify-center"
      style={{ height: 88 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* inventory placeholder */}
      <span className="absolute inset-0 flex items-center justify-center z-0 pointer-events-none">
        <span className="text-[10px] text-gray-300 font-mono text-center px-2 break-all leading-tight max-w-full">
          {label || "III C 15987"}
        </span>
      </span>
      <div
        className={[
          "relative inline-flex overflow-hidden bg-gray-50 rounded-[4px] w-full h-full",
          active ? "ring-2 ring-blue-500" : "",
        ].join(" ")}
      />
    </div>
  )
}

function ComponentsTab() {
  const [placesOpen, setPlacesOpen] = useState(false)
  const [selectedCard, setSelectedCard] = useState<number | null>(null)

  return (
    <div>
      <SectionLabel>Object Card (image grid)</SectionLabel>
      <p className="text-[10px] text-gray-400 mb-3">
        group \u00b7 p-1 \u00b7 bg-white \u00b7 h-44 \u00b7 ring-2 ring-blue-500 on hover / click \u00b7 rounded-[4px] \u00b7 inventory number as placeholder
      </p>
      <div className="grid grid-cols-4 gap-3 max-w-xs">
        {["III C 15987", "III C 4832", "III E 1201", "III C 22011"].map((inv, i) => (
          <div
            key={inv}
            onClick={() => setSelectedCard(selectedCard === i ? null : i)}
          >
            <ObjectCard selected={selectedCard === i} label={inv} />
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-400 mt-2">Hover or click to see ring-2 ring-blue-500 state</p>

      <SectionLabel>Icon Buttons</SectionLabel>
      <p className="text-[10px] text-gray-400 mb-3">
        h-8 w-8 \u00b7 ghost \u00b7 icon only \u00b7 no label
      </p>
      <div className="flex flex-wrap gap-4">
        {(
          [
            { Icon: IconSearch, name: "Search" },
            { Icon: IconClose, name: "Close" },
            { Icon: IconDownloadCsv, name: "DownloadCsv" },
            { Icon: IconExpand, name: "Expand" },
            { Icon: IconMinimize, name: "Minimize" },
            { Icon: IconPanelOpen, name: "PanelOpen" },
            { Icon: IconPanelClosed, name: "PanelClosed" },
            { Icon: IconShare, name: "Share" },
            { Icon: IconSource, name: "Source" },
          ] as const
        ).map(({ Icon, name }) => (
          <div key={name} className="flex flex-col items-center gap-1">
            <button className="h-8 w-8 flex items-center justify-center hover:bg-gray-50 rounded-md">
              <Icon className="w-5 h-5 text-gray-500" />
            </button>
            <span className="text-[10px] text-gray-400">{name}</span>
          </div>
        ))}
        <div className="flex flex-col items-center gap-1">
          <button className="h-8 w-8 flex items-center justify-center hover:bg-gray-50 rounded-md">
            <MoreHorizontal className="h-5 w-5 text-gray-500" />
          </button>
          <span className="text-[10px] text-gray-400">More</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <button className="h-8 w-8 flex items-center justify-center hover:bg-gray-50 rounded-md">
            <ChevronDown className="h-5 w-5 text-gray-500" />
          </button>
          <span className="text-[10px] text-gray-400">Chevron</span>
        </div>
      </div>

      <SectionLabel>Filter Chips</SectionLabel>
      <FilterChipDemo />

      <SectionLabel>Search Input</SectionLabel>
      <div className="w-full max-w-sm border border-gray-200 rounded-[20px] overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
          <Search className="w-[18px] h-[18px] text-gray-400 flex-shrink-0" />
          <input
            type="text"
            placeholder="Search places, sites, collections\u2026"
            className="flex-1 text-sm bg-transparent outline-none placeholder:text-gray-400"
            readOnly
          />
          <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-1.5 text-[10px] text-gray-400">
            ESC
          </kbd>
        </div>
      </div>

      <SectionLabel>Breadcrumb</SectionLabel>
      <div className="flex items-center text-sm">
        <button className="text-black/60 hover:text-black transition-colors whitespace-nowrap">
          All
        </button>
        <span className="text-black/30 mx-1">/</span>
        <button className="text-black/60 hover:text-black transition-colors whitespace-nowrap">
          Rwanda
        </button>
        <span className="text-black/30 mx-1">/</span>
        <span className="text-black font-medium">Kigali</span>
      </div>

      <SectionLabel>Accordion Row</SectionLabel>
      <div className="max-w-xs">
        <div className="flex items-center justify-between">
          <span className="panel-text-muted">Places</span>
          <button
            className="h-8 w-8 flex items-center justify-center hover:bg-gray-50 rounded-md"
            onClick={() => setPlacesOpen((v) => !v)}
          >
            {placesOpen ? (
              <ChevronUp className="h-5 w-5 text-gray-500" />
            ) : (
              <ChevronDown className="h-5 w-5 text-gray-500" />
            )}
          </button>
        </div>
        {placesOpen && (
          <div className="space-y-0.5 max-h-40 overflow-y-auto pr-1">
            {[
              ["Rwanda", "132"],
              ["Nigeria", "87"],
              ["Ethiopia", "64"],
              ["Ghana", "51"],
            ].map(([name, count]) => (
              <div
                key={name}
                className="flex justify-between cursor-pointer hover:bg-gray-50 rounded-md px-1 py-0.5"
              >
                <span className="truncate max-w-[70%] text-sm">{name}</span>
                <span className="ml-2 text-gray-400 text-sm">{count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <SectionLabel>Path Nodes (Connection Finder)</SectionLabel>
      <div className="flex flex-wrap items-center gap-1">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-700">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
          Rwanda
        </span>
        <span className="text-violet-300 text-xs">\u2192</span>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-700">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          Kigali
        </span>
        <span className="text-violet-300 text-xs">\u2192</span>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          British Museum
        </span>
        <span className="text-[10px] text-violet-400 ml-2">2 hops</span>
      </div>
    </div>
  )
}

// Interactive filter chip demo
function FilterChipDemo() {
  const [chips, setChips] = useState([
    { id: "rw", label: "Rwanda", type: "country" as const },
    { id: "kg", label: "Kigali", type: "country" as const },
    { id: "bm", label: "British Museum", type: "institution" as const },
  ])
  const remove = (id: string) => setChips((c) => c.filter((x) => x.id !== id))
  if (chips.length === 0) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-gray-400">All chips removed.</span>
        <button
          className="text-[10px] text-blue-600 hover:underline"
          onClick={() =>
            setChips([
              { id: "rw", label: "Rwanda", type: "country" },
              { id: "kg", label: "Kigali", type: "country" },
              { id: "bm", label: "British Museum", type: "institution" },
            ])
          }
        >
          Reset
        </button>
      </div>
    )
  }
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <span
          key={chip.id}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] ${
            chip.type === "institution"
              ? "bg-orange-50 text-orange-700"
              : "bg-blue-100 text-blue-700"
          }`}
        >
          {chip.label}
          <button
            className="hover:bg-blue-100 rounded-md p-0.5"
            onClick={() => remove(chip.id)}
          >
            <X className="w-2.5 h-2.5" />
          </button>
        </span>
      ))}
    </div>
  )
}

// \u2500\u2500\u2500 PATTERNS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

// Dummy data
const MOCK_OBJECTS = [
  { id: "1", inv: "III C 15987", title: "Figur eines Ahnen" },
  { id: "2", inv: "III C 4832", title: "Maske" },
  { id: "3", inv: "III E 1201", title: "Objekt ohne Titel" },
  { id: "4", inv: "III C 22011", title: "Keramikgef\u00e4\u00df" },
  { id: "5", inv: "III C 9123", title: "Holzfigur" },
  { id: "6", inv: "III C 7741", title: "Ritualobjekt" },
]

function MapDots({ count = 6 }: { count?: number }) {
  const dots = [
    { top: "22%", left: "32%", size: 7, opacity: 0.85 },
    { top: "38%", left: "28%", size: 5, opacity: 0.7 },
    { top: "30%", left: "48%", size: 9, opacity: 0.9 },
    { top: "45%", left: "55%", size: 5, opacity: 0.65 },
    { top: "20%", left: "62%", size: 6, opacity: 0.8 },
    { top: "50%", left: "40%", size: 4, opacity: 0.6 },
    { top: "35%", left: "70%", size: 5, opacity: 0.7 },
    { top: "55%", left: "25%", size: 6, opacity: 0.75 },
  ].slice(0, count)
  return (
    <>
      {dots.map((d, i) => (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            top: d.top,
            left: d.left,
            width: d.size,
            height: d.size,
            background: "rgb(59,130,246)",
            opacity: d.opacity,
            pointerEvents: "none",
          }}
        />
      ))}
    </>
  )
}

// Helper: get code as string for a component
function getPatternCode(name: string): string {
  // These should match the function names below
  switch (name) {
    case "HeaderPanelPattern":
      return HeaderPanelPattern.toString()
    case "ObjectPanelDesktopPattern":
      return ObjectPanelDesktopPattern.toString()
    case "ObjectPanelMobilePattern":
      return ObjectPanelMobilePattern.toString()
    case "CommandPalettePattern":
      return CommandPalettePattern.toString()
    default:
      return ""
  }
}

function PatternsTab({ onShowCode }: { onShowCode: (code: string) => void }) {
  return (
    <div className="space-y-10">
      <div className="relative group">
        <HeaderPanelPattern />
        <button
          className="absolute top-2 right-2 z-10 text-[10px] px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded-md border border-gray-200 shadow-sm"
          onClick={() => onShowCode(getPatternCode("HeaderPanelPattern"))}
        >
          Show code
        </button>
      </div>
      <div className="relative group">
        <ObjectPanelDesktopPattern />
        <button
          className="absolute top-2 right-2 z-10 text-[10px] px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded-md border border-gray-200 shadow-sm"
          onClick={() => onShowCode(getPatternCode("ObjectPanelDesktopPattern"))}
        >
          Show code
        </button>
      </div>
      <div className="relative group">
        <ObjectPanelMobilePattern />
        <button
          className="absolute top-2 right-2 z-10 text-[10px] px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded-md border border-gray-200 shadow-sm"
          onClick={() => onShowCode(getPatternCode("ObjectPanelMobilePattern"))}
        >
          Show code
        </button>
      </div>
      <div className="relative group">
        <CommandPalettePattern />
        <button
          className="absolute top-2 right-2 z-10 text-[10px] px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded-md border border-gray-200 shadow-sm"
          onClick={() => onShowCode(getPatternCode("CommandPalettePattern"))}
        >
          Show code
        </button>
      </div>
    </div>
  )
}

// \u2500\u2500 Header Panel \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function HeaderPanelPattern() {
  const [showPlaces, setShowPlaces] = useState(false)
  const [showSites, setShowSites] = useState(false)
  const [showCollections, setShowCollections] = useState(false)
  const [activePlaces, setActivePlaces] = useState<string[]>([])
  const [breadcrumb, setBreadcrumb] = useState<string[]>(["All"])

  const PLACES = [
    { label: "Rwanda", count: 132 },
    { label: "Nigeria", count: 87 },
    { label: "Ethiopia", count: 64 },
  ]
  const SITES = [
    { label: "Kigali", count: 48 },
    { label: "Butare", count: 34 },
  ]
  const COLLECTIONS = [
    { label: "Ethnologisches Museum", count: 112 },
    { label: "British Museum", count: 20 },
  ]

  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider panel-text-muted mb-3">
        Header Panel \u00b7 desktop \u00b7 absolute top-10 left-10 sm:w-80 \u00b7 white panel \u00b7 rounded-2xl \u00b7 shadow-lg
      </p>
      <div
        className="relative overflow-hidden rounded-2xl"
        style={{ background: "#111", height: 320 }}
      >
        <MapDots />
        <div className="absolute top-6 left-6 w-72 bg-white rounded-2xl shadow-lg flex flex-col">
          {/* Top row: breadcrumb + actions */}
          <div className="flex items-center justify-between px-4 pt-2 pb-1">
            <div className="flex items-center min-w-0 flex-1 overflow-hidden text-sm text-black">
              {breadcrumb.map((seg, i) => (
                <span key={i} className="flex items-center flex-shrink-0">
                  {i > 0 && <span className="text-black/30 px-1">/</span>}
                  {i < breadcrumb.length - 1 ? (
                    <button
                      className="text-black/60 hover:text-black whitespace-nowrap"
                      onClick={() => setBreadcrumb(breadcrumb.slice(0, i + 1))}
                    >
                      {seg}
                    </button>
                  ) : (
                    <span className="font-medium truncate">{seg}</span>
                  )}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-1 ml-2">
              <button className="h-8 w-8 flex items-center justify-center hover:bg-gray-50 rounded-md">
                <IconPanelOpen className="h-5 w-5 text-gray-500" />
              </button>
              <button className="h-8 w-8 flex items-center justify-center hover:bg-gray-50 rounded-md">
                <IconSearch className="w-5 h-5 text-gray-500" />
              </button>
            </div>
          </div>
          {/* Artifact count */}
          <div className="px-4 pb-1">
            <span className="text-sm text-black">132 artifacts from Rwanda</span>
          </div>
          {/* Accordion rows */}
          <div className="px-4 pb-3">
            {/* Places */}
            <div>
              <div className="flex items-center justify-between">
                <span className="panel-text-muted">Places</span>
                <button
                  className="h-8 w-8 flex items-center justify-center hover:bg-gray-50 rounded-md"
                  onClick={() => setShowPlaces((v) => !v)}
                >
                  {showPlaces ? (
                    <ChevronUp className="h-5 w-5 text-gray-500" />
                  ) : (
                    <ChevronDown className="h-5 w-5 text-gray-500" />
                  )}
                </button>
              </div>
              {showPlaces && (
                <div className="space-y-0.5 max-h-28 overflow-y-auto pr-1">
                  {PLACES.map((p) => (
                    <div
                      key={p.label}
                      className={`flex justify-between cursor-pointer rounded-md px-1 py-0.5 ${
                        activePlaces.includes(p.label)
                          ? "bg-blue-50 text-blue-700"
                          : "hover:bg-gray-50"
                      }`}
                      onClick={() => {
                        if (activePlaces.includes(p.label)) {
                          setActivePlaces((a) => a.filter((x) => x !== p.label))
                        } else {
                          setActivePlaces((a) => [...a, p.label])
                          setBreadcrumb(["All", p.label])
                        }
                      }}
                    >
                      <span className="truncate max-w-[70%] text-sm">{p.label}</span>
                      <span className="ml-2 text-gray-400 text-sm">{p.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* Sites */}
            <div>
              <div className="flex items-center justify-between">
                <span className="panel-text-muted">Sites</span>
                <button
                  className="h-8 w-8 flex items-center justify-center hover:bg-gray-50 rounded-md"
                  onClick={() => setShowSites((v) => !v)}
                >
                  {showSites ? (
                    <ChevronUp className="h-5 w-5 text-gray-500" />
                  ) : (
                    <ChevronDown className="h-5 w-5 text-gray-500" />
                  )}
                </button>
              </div>
              {showSites && (
                <div className="space-y-0.5 max-h-28 overflow-y-auto pr-1">
                  {SITES.map((s) => (
                    <div
                      key={s.label}
                      className="flex justify-between cursor-pointer hover:bg-gray-50 rounded-md px-1 py-0.5"
                    >
                      <span className="truncate max-w-[70%] text-sm">{s.label}</span>
                      <span className="ml-2 text-gray-400 text-sm">{s.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* Collections */}
            <div>
              <div className="flex items-center justify-between">
                <span className="panel-text-muted">Collections</span>
                <button
                  className="h-8 w-8 flex items-center justify-center hover:bg-gray-50 rounded-md"
                  onClick={() => setShowCollections((v) => !v)}
                >
                  {showCollections ? (
                    <ChevronUp className="h-5 w-5 text-gray-500" />
                  ) : (
                    <ChevronDown className="h-5 w-5 text-gray-500" />
                  )}
                </button>
              </div>
              {showCollections && (
                <div className="space-y-0.5 max-h-28 overflow-y-auto pr-1">
                  {COLLECTIONS.map((c) => (
                    <div
                      key={c.label}
                      className="flex justify-between cursor-pointer hover:bg-gray-50 rounded-md px-1 py-0.5"
                    >
                      <span className="truncate max-w-[70%] text-sm">{c.label}</span>
                      <span className="ml-2 text-gray-400 text-sm">{c.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// \u2500\u2500 Object Panel Desktop \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function ObjectPanelDesktopPattern() {
  const [expanded, setExpanded] = useState(false)
  const [chips, setChips] = useState([
    { id: "rw", label: "Rwanda", type: "country" as const },
    { id: "bm", label: "British Museum", type: "institution" as const },
  ])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [copiedShare, setCopiedShare] = useState(false)
  const removeChip = (id: string) => setChips((c) => c.filter((x) => x.id !== id))

  const panelWidth = expanded ? "calc(100% - 3rem)" : "40%"
  const transition = "width 0.26s cubic-bezier(0.4,0,0.2,1), height 0.26s cubic-bezier(0.4,0,0.2,1)"

  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider panel-text-muted mb-3">
        Object Panel \u00b7 desktop \u00b7 right \u00b7 width 40% default / calc(100%\u22125rem) expanded \u00b7 sticky header \u00b7 260ms cubic-bezier(0.4,0,0.2,1)
      </p>
      <div
        className="relative overflow-hidden rounded-2xl"
        style={{ background: "#111", height: 400 }}
      >
        <MapDots count={5} />
        <div
          className="absolute top-0 right-0 bottom-0 bg-white flex flex-col"
          style={{ width: panelWidth, transition }}
        >
          {/* Sticky header */}
          <div className="sticky top-0 z-30 flex flex-row items-start bg-white">
            <div className="flex-1 min-w-0 p-4 pt-2">
              {/* Breadcrumb */}
              <div className="flex items-center text-sm">
                <button className="text-black/60 whitespace-nowrap hover:text-black">All</button>
                <span className="text-black/30 mx-1">/</span>
                <span className="text-black font-medium truncate">Rwanda</span>
              </div>
              {/* Count */}
              <div className="text-sm text-black mt-0.5">132 artifacts from Rwanda</div>
              {/* Filter chips */}
              {chips.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {chips.map((chip) => (
                    <span
                      key={chip.id}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] ${
                        chip.type === "institution"
                          ? "bg-orange-50 text-orange-700"
                          : "bg-blue-100 text-blue-700"
                      }`}
                    >
                      {chip.label}
                      <button
                        className="rounded-md p-0.5 hover:bg-blue-100"
                        onClick={() => removeChip(chip.id)}
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            {/* Action buttons */}
            <div className="flex items-center gap-1 pt-2 pr-4 shrink-0">
              <button
                className="h-8 w-8 flex items-center justify-center hover:bg-gray-50 rounded-md"
                title={expanded ? "Minimize" : "Expand"}
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? (
                  <IconMinimize className="h-5 w-5 text-gray-500" />
                ) : (
                  <IconExpand className="h-5 w-5 text-gray-500" />
                )}
              </button>
              {/* More menu: share + CSV */}
              <div className="relative group/menu">
                <button
                  className="h-8 w-8 flex items-center justify-center hover:bg-gray-50 rounded-md"
                  onClick={() => {
                    setCopiedShare(true)
                    setTimeout(() => setCopiedShare(false), 1500)
                  }}
                  title="Share"
                >
                  {copiedShare ? (
                    <Check className="h-5 w-5 text-green-500" />
                  ) : (
                    <MoreHorizontal className="h-5 w-5 text-gray-500" />
                  )}
                </button>
              </div>
            </div>
          </div>
          {/* Object grid */}
          <div className="flex-1 overflow-y-auto p-3" style={{ WebkitOverflowScrolling: "touch" }}>
            <div className="grid grid-cols-3 gap-2">
              {MOCK_OBJECTS.map((obj) => {
                const active = selectedId === obj.id || hoveredId === obj.id
                return (
                  <div
                    key={obj.id}
                    className="relative cursor-pointer bg-white p-1 flex items-center justify-center"
                    style={{ height: 72 }}
                    onClick={() => setSelectedId(selectedId === obj.id ? null : obj.id)}
                    onMouseEnter={() => setHoveredId(obj.id)}
                    onMouseLeave={() => setHoveredId(null)}
                  >
                    <span className="absolute inset-0 flex items-center justify-center z-0 pointer-events-none">
                      <span className="text-[10px] text-gray-300 font-mono text-center px-1 break-all leading-tight max-w-full">
                        {obj.inv}
                      </span>
                    </span>
                    <div
                      className={[
                        "relative w-full h-full overflow-hidden bg-gray-50 rounded-[4px]",
                        active ? "ring-2 ring-blue-500" : "",
                      ].join(" ")}
                    />
                  </div>
                )
              })}
            </div>
          </div>
          {/* Footer */}
          <div className="shrink-0 flex items-center justify-between px-4 py-2 border-t border-gray-100">
            <span className="text-[10px] text-gray-400">132 objects</span>
            <button className="flex items-center gap-1 text-gray-400 hover:text-black">
              <IconDownloadCsv className="h-4 w-4" />
              <span className="text-[10px]">Export CSV</span>
            </button>
          </div>
        </div>
      </div>
      <p className="text-[10px] text-gray-400 mt-2">
        Click expand icon to toggle panel width. Click cards to see ring-2 ring-blue-500. Click chip \u00d7 to remove.
      </p>
    </div>
  )
}

// \u2500\u2500 Object Panel Mobile \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
type SheetSize = "minimized" | "default" | "expanded"

function ObjectPanelMobilePattern() {
  const [size, setSize] = useState<SheetSize>("default")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const heights: Record<SheetSize, string> = {
    minimized: "88px",
    default: "44%",
    expanded: "80%",
  }
  const radii: Record<SheetSize, number> = {
    minimized: 24,
    default: 24,
    expanded: 0,
  }
  const ease = "cubic-bezier(0.32,0.72,0,1)"
  const transition = `height 0.35s ${ease}, border-radius 0.30s ${ease}`

  const cycleSize = () => {
    const order: SheetSize[] = ["minimized", "default", "expanded"]
    const i = order.indexOf(size)
    setSize(order[(i + 1) % order.length])
  }

  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider panel-text-muted mb-3">
        Object Panel \u00b7 mobile \u00b7 bottom sheet \u00b7 minimized 88px / default 44dvh / expanded 100dvh \u00b7 spring cubic-bezier(0.32,0.72,0,1) 350ms
      </p>
      <div
        className="relative overflow-hidden"
        style={{ background: "#111", height: 420, borderRadius: 24 }}
      >
        <MapDots count={6} />
        {/* Bottom sheet */}
        <div
          className="absolute left-3 right-3 bg-white flex flex-col overflow-hidden"
          style={{
            bottom: 12,
            height: heights[size],
            borderRadius: radii[size],
            boxShadow: "0 -2px 20px rgba(0,0,0,0.10), 0 8px 24px rgba(0,0,0,0.07)",
            transition,
          }}
        >
          {/* Drag handle — click to cycle */}
          <div
            className="flex justify-center pt-2 pb-1 cursor-pointer select-none"
            onClick={cycleSize}
            title="Click to cycle size"
          >
            <div className="w-14 h-1 rounded-full bg-gray-300" />
          </div>
          {/* Header */}
          <div className="sticky top-0 z-30 flex flex-col bg-white">
            <div className="flex items-center justify-between text-sm px-4">
              <div className="flex items-center min-w-0 flex-1 overflow-hidden">
                <button className="text-black/60 whitespace-nowrap hover:text-black">All</button>
                <span className="text-black/30 mx-1">/</span>
                <span className="text-black font-medium truncate">Rwanda</span>
              </div>
              <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                <button className="h-8 w-8 flex items-center justify-center hover:bg-gray-50 rounded-md">
                  <IconSearch className="w-5 h-5 text-gray-500" />
                </button>
              </div>
            </div>
            <div className="px-4 pt-0 pb-2">
              <span className="text-sm text-black">132 artifacts from Rwanda</span>
            </div>
          </div>
          {/* Grid */}
          <div className="flex-1 overflow-y-auto px-3 pb-4" style={{ WebkitOverflowScrolling: "touch" }}>
            <div className="grid grid-cols-3 gap-2">
              {MOCK_OBJECTS.map((obj) => {
                const active = selectedId === obj.id || hoveredId === obj.id
                return (
                  <div
                    key={obj.id}
                    className="relative cursor-pointer bg-white p-1 flex items-center justify-center"
                    style={{ height: 64 }}
                    onClick={() => setSelectedId(selectedId === obj.id ? null : obj.id)}
                    onMouseEnter={() => setHoveredId(obj.id)}
                    onMouseLeave={() => setHoveredId(null)}
                  >
                    <span className="absolute inset-0 flex items-center justify-center z-0 pointer-events-none">
                      <span className="text-[10px] text-gray-300 font-mono text-center px-1 break-all leading-tight max-w-full">
                        {obj.inv}
                      </span>
                    </span>
                    <div
                      className={[
                        "relative w-full h-full overflow-hidden bg-gray-50 rounded-[4px]",
                        active ? "ring-2 ring-blue-500" : "",
                      ].join(" ")}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
      <p className="text-[10px] text-gray-400 mt-2">
        Click drag handle to cycle: minimized \u2192 default \u2192 expanded. Click cards to see ring.
      </p>
    </div>
  )
}

// \u2500\u2500 Command Palette \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function CommandPalettePattern() {
  const [query, setQuery] = useState("")
  const [activeFilter, setActiveFilter] = useState("All")
  const [chips, setChips] = useState([
    { id: "rw", label: "Rwanda" },
  ])
  const [showPlaces, setShowPlaces] = useState(false)
  const [showSites, setShowSites] = useState(false)
  const removeChip = (id: string) => setChips((c) => c.filter((x) => x.id !== id))

  const FILTER_TABS = ["All", "Places", "Institutions", "Paths"]
  const RESULTS = [
    { label: "Rwanda", sub: "Country \u00b7 Central Africa" },
    { label: "Kigali, Rwanda", sub: "City \u00b7 RW" },
    { label: "Rwanda \u2192 Ethnologisches Museum", sub: "132 objects \u00b7 arc" },
  ].filter((r) => !query || r.label.toLowerCase().includes(query.toLowerCase()))

  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider panel-text-muted mb-3">
        Command Palette \u00b7 \u2318K \u00b7 fixed center modal \u00b7 rounded-[20px] \u00b7 shadow-2xl \u00b7 backdrop-blur-[2px] bg-black/25
      </p>
      <div
        className="relative overflow-hidden rounded-2xl"
        style={{ background: "#111", height: 420 }}
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0"
          style={{ background: "rgba(0,0,0,0.25)", backdropFilter: "blur(2px)" }}
        />
        {/* Palette */}
        <div className="absolute inset-0 flex items-start justify-center pt-8 px-6">
          <div className="w-full max-w-lg bg-white rounded-[20px] shadow-2xl border border-gray-200 overflow-hidden">
            {/* Search row */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
              <Search className="w-[18px] h-[18px] text-gray-400 flex-shrink-0" />
              <input
                type="text"
                placeholder="Search places, sites, collections\u2026"
                className="flex-1 text-sm bg-transparent outline-none placeholder:text-gray-400"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button onClick={() => setQuery("")}>
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              )}
              <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-1.5 text-[10px] text-gray-400">
                ESC
              </kbd>
            </div>
            {/* Active filter chips */}
            {chips.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-b border-gray-100 bg-gray-50/50">
                {chips.map((chip) => (
                  <span
                    key={chip.id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-[10px]"
                  >
                    {chip.label}
                    <button className="hover:bg-blue-100 rounded-md p-0.5" onClick={() => removeChip(chip.id)}>
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
                <button
                  className="text-[10px] text-gray-400 hover:text-gray-600 px-1"
                  onClick={() => setChips([])}
                >
                  Clear all
                </button>
              </div>
            )}
            {/* Category filter tabs */}
            <div className="flex items-center gap-0 px-4 py-2 border-b border-gray-100 overflow-x-auto">
              {FILTER_TABS.map((f) => (
                <button
                  key={f}
                  className={`px-2.5 py-0.5 rounded-full text-[10px] mr-1 ${
                    activeFilter === f
                      ? "bg-black text-white"
                      : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                  }`}
                  onClick={() => setActiveFilter(f)}
                >
                  {f}
                </button>
              ))}
            </div>
            {/* Results */}
            <div className="py-1 max-h-48 overflow-y-auto" style={{ WebkitOverflowScrolling: "touch" }}>
              {RESULTS.length === 0 ? (
                <div className="px-4 py-3 text-sm text-gray-400">No results for &ldquo;{query}&rdquo;</div>
              ) : (
                RESULTS.map((r, i) => (
                  <div
                    key={i}
                    className={`flex items-center justify-between pl-4 pr-3 py-2 cursor-pointer hover:bg-gray-50 ${
                      i === 0 && !query ? "bg-blue-50" : ""
                    }`}
                  >
                    <div>
                      <div className="text-sm text-gray-800">{r.label}</div>
                      <div className="text-[10px] text-gray-400">{r.sub}</div>
                    </div>
                    <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  </div>
                ))
              )}
            </div>
            {/* Sub-accordions (Places, Sites expandable sections) */}
            <div className="border-t border-gray-100">
              {[
                { label: "Places", count: 48, open: showPlaces, toggle: () => setShowPlaces((v) => !v) },
                { label: "Sites", count: 12, open: showSites, toggle: () => setShowSites((v) => !v) },
              ].map(({ label, count, open, toggle }) => (
                <div key={label}>
                  <div
                    className="flex items-center justify-between pl-4 pr-3 py-1 cursor-pointer hover:bg-gray-50"
                    onClick={toggle}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-700">{label}</span>
                      <span className="text-sm text-gray-400">{count}</span>
                    </div>
                    <button className="h-8 w-8 flex items-center justify-center hover:bg-gray-50 rounded-md">
                      {open ? (
                        <ChevronUp className="h-4 w-4 text-gray-500" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-gray-500" />
                      )}
                    </button>
                  </div>
                  {open && (
                    <div className="px-4 pb-2 space-y-0.5">
                      {["Rwanda", "Nigeria", "Ethiopia"].map((name) => (
                        <div
                          key={name}
                          className="flex justify-between cursor-pointer hover:bg-gray-50 rounded-md px-1 py-0.5"
                          onClick={() => setChips((c) => c.find((x) => x.label === name) ? c : [...c, { id: name.toLowerCase(), label: name }])}
                        >
                          <span className="text-sm">{name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <p className="text-[10px] text-gray-400 mt-2">
        Type to filter results. Click filter tabs. Click \u00d7 to remove chips. Click accordion rows to expand.
      </p>
    </div>
  )
}

// \u2500\u2500\u2500 STACK \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

const STACK_ITEMS = [
  { name: "Next.js 15", role: "Framework (App Router)", license: "MIT" },
  { name: "TypeScript", role: "Language", license: "Apache-2.0" },
  { name: "Tailwind CSS", role: "Styling", license: "MIT" },
  { name: "Radix UI Themes", role: "Base theme / design tokens", license: "MIT" },
  { name: "shadcn/ui", role: "Component primitives", license: "MIT" },
  { name: "MapLibre GL JS", role: "Map renderer", license: "BSD-3-Clause" },
  { name: "deck.gl", role: "WebGL arc & scatter layers", license: "MIT" },
  { name: "Protomaps / PMTiles", role: "Self-hosted vector tiles", license: "BSD-3-Clause" },
  { name: "Lucide React", role: "Icon library", license: "ISC" },
  { name: "Strapi", role: "CMS / REST API backend", license: "MIT" },
]

function StackTab() {
  return (
    <div>
      <SectionLabel>Frontend Stack</SectionLabel>
      <div>
        {STACK_ITEMS.map(({ name, role, license }) => (
          <div
            key={name}
            className="flex items-start justify-between gap-4 py-3 border-b border-gray-100"
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm text-black">{name}</div>
              <div className="text-[10px] text-gray-400 mt-0.5">{role}</div>
            </div>
            <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-[10px] flex-shrink-0">
              {license}
            </span>
          </div>
        ))}
      </div>

      <SectionLabel>App</SectionLabel>
      <div>
        <div className="flex items-center justify-between py-3 border-b border-gray-100">
          <span className="text-[10px] text-gray-400">App license</span>
          <span className="px-2 py-0.5 rounded-md bg-gray-100 text-gray-600 text-[10px]">
            AGPL-3.0
          </span>
        </div>
        <div className="flex items-center justify-between py-3 border-b border-gray-100">
          <span className="text-[10px] text-gray-400">Source</span>
          <a
            href="https://github.com/hburakyel/ex-situ-public"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-blue-700 hover:underline"
          >
            github.com/hburakyel/ex-situ-public
          </a>
        </div>
      </div>
    </div>
  )
}

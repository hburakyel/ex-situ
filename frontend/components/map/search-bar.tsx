import { IconSearch } from "@/components/icons"

// Input-looking trigger for the command palette (⌘K). It only opens the palette —
// typing happens there — so it is a button, not a text field. `[&_*]:text-inherit`
// beats the global `* { color }` reset so the icon strokes (currentColor) stay gray.
export default function SearchBar({ onOpen }: { onOpen?: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full h-8 items-center gap-2 rounded-md border border-gray-200 bg-white px-2.5 text-left text-sm text-gray-400 transition-colors hover:bg-gray-50 [&_*]:text-inherit"
      aria-label="Search places, sites, collections"
      aria-keyshortcuts="Meta+K"
    >
      <IconSearch className="w-4 h-4 flex-shrink-0" />
      <span className="flex-1 min-w-0 truncate">Search</span>
    </button>
  )
}

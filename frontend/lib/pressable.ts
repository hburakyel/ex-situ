import type React from "react"

// A clickable row or tile that isn't a <button>: reachable with Tab, pressed with Enter
// or Space, and announced as a button (WCAG 2.1.1, 4.1.2). `pressed` marks a pick that
// stays on (a selected site, time or collection).
export function pressable(onPress: () => void, pressed?: boolean) {
  return {
    role: "button" as const,
    tabIndex: 0,
    ...(pressed === undefined ? {} : { "aria-pressed": pressed }),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.target !== e.currentTarget) return
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault()
        onPress()
      }
    },
  }
}

// The ring a pressable shows when it is reached by keyboard (never on a mouse click).
export const PRESSABLE_FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"

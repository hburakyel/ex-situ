"use client"

import { useCallback, useEffect, useRef, useState } from "react"

// Which edges of a scrolling list hide more rows: the top/bottom fades show only
// there, so a short list (or the last row of a scrolled one) isn't washed out.
export function useScrollFades<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [fades, setFades] = useState({ top: false, bottom: false })

  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    const top = el.scrollTop > 1
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1
    setFades((f) => (f.top === top && f.bottom === bottom ? f : { top, bottom }))
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    update()
    el.addEventListener("scroll", update, { passive: true })
    // Rows load in after the list mounts; watch the rows as well as the box.
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null
    observer?.observe(el)
    for (const child of Array.from(el.children)) observer?.observe(child)
    const mutations = new MutationObserver(update)
    mutations.observe(el, { childList: true, subtree: true })
    return () => {
      el.removeEventListener("scroll", update)
      observer?.disconnect()
      mutations.disconnect()
    }
  }, [update])

  return { ref, fades }
}

// Copies text and says whether it worked, so a button never shows "copied" while the
// clipboard still holds something else.
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Permission denied, insecure context or an embedded pane: fall back to a selection copy.
    const area = document.createElement("textarea")
    area.value = text
    area.setAttribute("readonly", "")
    area.style.cssText = "position:fixed;top:0;left:0;opacity:0"
    document.body.appendChild(area)
    area.select()
    let ok = false
    try {
      ok = document.execCommand("copy")
    } catch {
      ok = false
    }
    document.body.removeChild(area)
    return ok
  }
}

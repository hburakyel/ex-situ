import { ImageResponse } from "next/og"

// Link-preview image (Telegram, WhatsApp, Slack, LinkedIn, X…): a plain fill in
// the favicon orange (app/icon.svg / icon.png). Artifact pages use the object's
// photo instead. Replace with a designed image here if one is made.

export const alt = "Ex Situ"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function OpengraphImage() {
  return new ImageResponse(<div style={{ width: "100%", height: "100%", background: "#f97316" }} />, size)
}

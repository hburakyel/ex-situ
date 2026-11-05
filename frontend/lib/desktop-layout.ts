// Desktop: the side panel narrows with the window. --edge is the margin around the
// panels (globals.css): smaller below 1200px.
export const SIDE_PANEL_WIDTH = "clamp(16rem, 26vw, 20rem)"
// The object panel is as wide as the map left between it and the side panel
// (edge + side panel + edge), and never so narrow that its header controls leave no room
// for the count and the filter chips.
export const OBJECT_PANEL_WIDTH = `max(22rem, calc((100vw - 2 * var(--edge) - ${SIDE_PANEL_WIDTH}) / 2))`
// Below this the panels and the map don't all fit: a selection closes the side panel,
// and with it closed map and object panel take half the screen each; the grid view starts
// without its map card (map-client.tsx).
export const NARROW_DESKTOP = "(min-width: 769px) and (max-width: 1199px)"
// Those halves stand an edge margin (1rem) apart. On a two-screen device each keeps that
// margin to the hinge.
const LEFT_HALF_END = "env(viewport-segment-right 0 0, calc(50vw + 0.5rem))"
const RIGHT_HALF_START = "env(viewport-segment-left 1 0, calc(50vw - 0.5rem))"
export const HALF_PANEL_WIDTH = `calc(100vw - ${RIGHT_HALF_START} - 2rem)`
// From the right edge of the screen: where whatever is left of the object panel ends.
export const HALF_CONTROLS_RIGHT = `calc(100vw - ${LEFT_HALF_END} + 1rem)`

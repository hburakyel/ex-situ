// Arc height (deck.gl ArcLayer getHeight, a multiple of the arc's length) as a
// continuous function of zoom. It used to switch in steps (1 / 0.35 / 0 at zoom
// 4 and 7), and on a pitched map every arc changed shape at those zooms.
// High arcs at world zoom; lower ones at regional zoom, where a tall arc near
// the screen edge projects as a wide band; flat from zoom 7, where an arc
// thousands of km long would already be far above the camera next to its origin.
const KNOTS: [zoom: number, height: number][] = [[3, 1], [4.5, 0.35], [7, 0]]

export function arcHeightForZoom(zoom: number): number {
  if (zoom <= KNOTS[0][0]) return KNOTS[0][1]
  for (let i = 1; i < KNOTS.length; i++) {
    const [z1, h1] = KNOTS[i]
    if (zoom <= z1) {
      const [z0, h0] = KNOTS[i - 1]
      return h0 + ((zoom - z0) / (z1 - z0)) * (h1 - h0)
    }
  }
  return KNOTS[KNOTS.length - 1][1]
}

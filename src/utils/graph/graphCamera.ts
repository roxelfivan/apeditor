/** Fit-to-view box, then zoom toward the center of that box. */

export const DEFAULT_GRAPH_ZOOM = 1;
export const MIN_GRAPH_ZOOM = 0.5;
export const MAX_GRAPH_ZOOM = 4;
export const GRAPH_ZOOM_FACTOR = 1.25;

export function clampGraphZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return DEFAULT_GRAPH_ZOOM;
  return Math.min(MAX_GRAPH_ZOOM, Math.max(MIN_GRAPH_ZOOM, zoom));
}

export function stepGraphZoom(zoom: number, direction: 1 | -1): number {
  const next =
    direction > 0
      ? zoom * GRAPH_ZOOM_FACTOR
      : zoom / GRAPH_ZOOM_FACTOR;
  return clampGraphZoom(next);
}

export function zoomedViewBox(
  minX: number,
  minY: number,
  width: number,
  height: number,
  zoom: number
): { x: number; y: number; w: number; h: number } {
  const z = clampGraphZoom(zoom);
  const w = width / z;
  const h = height / z;
  const cx = minX + width / 2;
  const cy = minY + height / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

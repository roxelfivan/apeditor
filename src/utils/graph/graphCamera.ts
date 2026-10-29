/**
 * Graph camera.
 *
 * Two coordinate systems live here:
 *
 *   world  — layout space produced by `layoutWorkspaceGraph`. Units are the
 *            same as the radial atom constants (NUCLEUS_RING, SHELL_GAP, …).
 *   screen — the SVG viewport, measured in CSS pixels from the top-left of
 *            the wrapper element.
 *
 * A `GraphCamera` maps world → screen. It is the single source of truth for
 * what is visible; nothing in `GraphView` should derive a viewBox from node
 * bounds anymore (that made the camera a pure function of the data, which
 * left no room to pan).
 */

export const DEFAULT_GRAPH_ZOOM = 1;
/**
 * Zoom floor: 0.05× (5%). Far enough out to take in a dense workspace
 * without the toolbar refusing Zoom − at a still-useful 25%. Past this
 * the map is a field of unreadable dots; Mindmap browsing of a tall tree
 * is native overflow, not further zoom-out.
 */
export const MIN_GRAPH_ZOOM = 0.05;
/**
 * Zoom ceiling: 12×. Enough to read a single heading's label from a
 * dense atom without letting the user get so far in that the viewBox
 * becomes numerically noisy.
 *
 * This must stay in step with `MAX_CONCEPT_DISTANCE`: Concept derives its
 * eye distance from this multiplier, and a ceiling here that outruns the
 * distance clamp means the toolbar reads "1200%" while the camera has
 * silently stopped at a lower number.
 */
export const MAX_GRAPH_ZOOM = 12;
export const GRAPH_ZOOM_FACTOR = 1.25;

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export interface GraphCamera {
  /** World coordinate at the centre of the viewport. */
  cx: number;
  cy: number;
  /** Screen pixels per world unit. 1 fits the map to the pane. */
  scale: number;
}

export interface ViewportSize {
  w: number;
  h: number;
}

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

/** The world point currently under the centre of the viewport. */
export function cameraCenter(camera: GraphCamera): Point {
  return { x: camera.cx, y: camera.cy };
}

/** Visible world rectangle for a camera and a viewport, in world units. */
export function cameraBounds(
  camera: GraphCamera,
  viewport: ViewportSize
): Bounds {
  const w = (viewport.w || 1) / (camera.scale || 1);
  const h = (viewport.h || 1) / (camera.scale || 1);
  return { minX: camera.cx - w / 2, minY: camera.cy - h / 2, width: w, height: h };
}

/**
 * Camera that fits `bounds` inside `viewport` at scale 1, the same
 * "meet" fit the viewBox used to perform implicitly.
 */
export function fitCameraTo(bounds: Bounds, viewport: ViewportSize): GraphCamera {
  const w = Math.max(bounds.width, 240);
  const h = Math.max(bounds.height, 240);
  const scale = Math.min((viewport.w || 1) / w, (viewport.h || 1) / h) || 1;
  return {
    cx: bounds.minX + bounds.width / 2,
    cy: bounds.minY + bounds.height / 2,
    scale,
  };
}

/**
 * Move the camera by a screen-space drag. A drag of `dx` screen pixels
 * moves the world by `-dx / scale`, so content follows the pointer
 * regardless of how far the view is zoomed.
 */
export function panCamera(
  camera: GraphCamera,
  dx: number,
  dy: number
): GraphCamera {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return camera;
  const scale = camera.scale || 1;
  return { ...camera, cx: camera.cx - dx / scale, cy: camera.cy - dy / scale };
}

/** World point under a screen pixel offset from the viewport centre. */
export function screenToWorld(
  camera: GraphCamera,
  offsetX: number,
  offsetY: number
): Point {
  const scale = camera.scale || 1;
  return { x: camera.cx + offsetX / scale, y: camera.cy + offsetY / scale };
}

/** Inverse of `screenToWorld`. */
export function worldToScreen(
  camera: GraphCamera,
  x: number,
  y: number
): Point {
  const scale = camera.scale || 1;
  return { x: (x - camera.cx) * scale, y: (y - camera.cy) * scale };
}

/**
 * Zoom toward a world-space anchor rather than the viewport centre.
 *
 * The world point under `anchor` (a screen offset from centre) must not move
 * when `nextScale` is applied, otherwise zooming drifts away from whatever
 * the user is pointing at.
 */
export function zoomCameraAt(
  camera: GraphCamera,
  nextScale: number,
  anchorX = 0,
  anchorY = 0
): GraphCamera {
  const scale = clampGraphZoom(nextScale);
  if (scale === camera.scale) return camera;
  const anchor = screenToWorld(camera, anchorX, anchorY);
  const nextCx = anchor.x - anchorX / scale;
  const nextCy = anchor.y - anchorY / scale;
  return { cx: nextCx, cy: nextCy, scale };
}

/** Zoom keeping the viewport centre fixed. */
export function zoomCamera(camera: GraphCamera, nextScale: number): GraphCamera {
  return zoomCameraAt(camera, nextScale, 0, 0);
}

/**
 * Fit-to-view box, then zoom toward the center of that box.
 *
 * Retained for the `viewBox`-shaped callers and the existing test suite.
 */
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

/**
 * SVG `viewBox` for a camera. Because the world and screen axes differ only
 * by a positive scale (never flipped), the viewBox maps directly onto the
 * rendered pixels 1:1.
 */
export function cameraViewBox(
  camera: GraphCamera,
  viewport: ViewportSize
): { x: number; y: number; w: number; h: number } {
  const b = cameraBounds(camera, viewport);
  return { x: b.minX, y: b.minY, w: b.width, h: b.height };
}
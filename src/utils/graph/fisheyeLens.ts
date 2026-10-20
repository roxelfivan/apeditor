/**
 * Graphical fisheye lens (Sarkar & Brown, CHI 1992), as reproduced in
 *
 *   Wang et al., "Structure-aware Fisheye Views for Efficient Large Graph
 *   Exploration", IEEE TVCG / Infovis 2018, Section 3.1.
 *
 * Eq. (1) of that paper:
 *
 *   β  = ‖xᵢ − c‖ / ‖bᵢ − c‖
 *   β' = (m + 1)·β / (m·β + 1)
 *   x'ᵢ = c + (bᵢ − c)·β'
 *
 * where `c` is the focal point and `bᵢ` is where the ray from `c` through
 * `xᵢ` meets the domain boundary. `m = 0` is the identity; larger `m`
 * pushes far nodes outward toward the boundary while magnifying what is
 * close to the focus.
 *
 * The lens is a pure position transform. It does not look at edges, which
 * is precisely why the 2018 paper's contribution exists — see
 * `structureAwareRefine.ts`, which re-solves these positions subject to
 * edge-orientation constraints.
 */

import type { Point } from '@/utils/graph/graphCamera';

/** Above this the lift is a no-op, so the lens can be skipped cheaply. */
export const MIN_FISHEYE_MAGNIFICATION = 1e-6;

export interface FisheyeBounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

/**
 * Magnification factor. Values above ~40 saturate: `β'` then approaches
 * `1 + 1/(mβ)` and the far field piles up on the boundary, which reads as a
 * wall of overlapping nodes.
 */
export const MAX_FISHEYE_MAGNIFICATION = 40;

export function clampMagnification(m: number): number {
  if (!Number.isFinite(m) || m <= MIN_FISHEYE_MAGNIFICATION) return 0;
  return Math.min(MAX_FISHEYE_MAGNIFICATION, m);
}

/**
 * The distortion curve for a normalised distance ratio.
 *
 * `β` is the node's distance from the focus as a fraction of the distance to
 * the boundary along the same ray. Exported for tests and so the refinement
 * solver can reason about the target without duplicating the algebra.
 */
export function fisheyeRatio(beta: number, magnification: number): number {
  const m = clampMagnification(magnification);
  if (m <= 0) return beta;
  const b = Math.max(beta, 0);
  return ((m + 1) * b) / (m * b + 1);
}

/**
 * Where the ray from `c` through `p` meets the boundary of `bounds`.
 *
 * Solving `c + t·(p − c)` for `t` against each of the four edges and taking
 * the smallest positive intersection gives the first crossing, which is the
 * boundary point the fisheye displaces the node toward.
 */
export function boundaryPointOnRay(
  focal: Point,
  p: Point,
  bounds: FisheyeBounds
): Point {
  const dx = p.x - focal.x;
  const dy = p.y - focal.y;

  // Focus coincides with the node: no ray, so no displacement.
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) {
    return { x: focal.x + bounds.width / 2, y: focal.y };
  }

  const right = bounds.minX + bounds.width;
  const bottom = bounds.minY + bounds.height;

  const candidates: number[] = [];

  if (Math.abs(dx) > 1e-9) {
    candidates.push((right - focal.x) / dx);
    candidates.push((bounds.minX - focal.x) / dx);
  }
  if (Math.abs(dy) > 1e-9) {
    candidates.push((bottom - focal.y) / dy);
    candidates.push((bounds.minY - focal.y) / dy);
  }

  let best = Infinity;
  for (const t of candidates) {
    // Only forward rays matter; the focus sits inside the bounds so t is
    // always positive, but guard anyway for a focal point dragged outside.
    if (t > 1e-9 && t < best) best = t;
  }

  if (!Number.isFinite(best)) return { x: focal.x + dx, y: focal.y + dy };
  return { x: focal.x + dx * best, y: focal.y + dy * best };
}

/**
 * Apply the lens to one point. `m = 0` returns `p` exactly, so callers can
 * leave the lens in the pipeline unconditionally.
 */
export function applyFisheye(
  p: Point,
  focal: Point,
  magnification: number,
  bounds: FisheyeBounds
): Point {
  const m = clampMagnification(magnification);
  if (m <= 0) return p;

  const b = boundaryPointOnRay(focal, p, bounds);
  const bx = b.x - focal.x;
  const by = b.y - focal.y;
  const boundaryDist = Math.hypot(bx, by);
  const nodeDist = Math.hypot(p.x - focal.x, p.y - focal.y);

  if (boundaryDist < 1e-9) return p;

  const beta = nodeDist / boundaryDist;
  const betaPrime = fisheyeRatio(beta, m);

  return {
    x: focal.x + bx * betaPrime,
    y: focal.y + by * betaPrime,
  };
}

/**
 * Apply the lens to every node in a set.
 *
 * Takes and returns the whole array so the caller can `useMemo` on the
 * result; nodes keep their identity so downstream `Map` lookups still work.
 */
export function applyFisheyeToNodes<T extends Point>(
  nodes: readonly T[],
  focal: Point,
  magnification: number,
  bounds: FisheyeBounds
): T[] {
  const m = clampMagnification(magnification);
  if (m <= 0) return nodes as T[];
  return nodes.map((n) => ({ ...n, ...applyFisheye(n, focal, m, bounds) }));
}

/**
 * How far the lens pulled a node away from its untransformed position.
 *
 * The refinement solver uses this to tell "the lens wanted to move this node
 * a lot" from "the lens left it alone", which decides how strongly the
 * structure constraints should hold.
 */
export function fisheyeDisplacement(original: Point, moved: Point): number {
  return Math.hypot(moved.x - original.x, moved.y - original.y);
}
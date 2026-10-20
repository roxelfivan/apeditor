/**
 * Spherical projection for the Graph view.
 *
 * The layout produced by `layoutWorkspaceGraph` is planar. To browse it "like
 * a globe" we map that plane onto a sphere with the inverse stereographic
 * projection, rotate the sphere with the pointer, and project what faces us
 * back to 2D. This is the iSphere approach from
 *
 *   Du et al., "iSphere: Focus+Context Sphere Visualization for
 *   Interactive Large Graph Exploration", CHI 2017.
 *
 * Conventions
 * -----------
 * The layout plane is treated as tangent to the sphere at the **near** pole,
 * so the layout origin (0, 0) maps to (0, 0, +R) — facing the viewer and
 * visible on load. We use the reflection of the textbook inverse
 * stereographic map to achieve that; the reflection is what makes
 * `toScreen` a `+Z` denominator rather than `-Z`.
 *
 * Layout units are therefore *tangent* units, not degrees: a layout spanning
 * thousands of units wraps around the sphere several times, which is what
 * makes the far field compress into a dense cap instead of leaving the
 * viewport.
 *
 * `toScreen` is the exact inverse of `toSphere` restricted to the visible
 * hemisphere, so rotating back to yaw=pitch=0 reproduces the original
 * coordinates to floating-point precision.
 */

import type { Point } from '@/utils/graph/graphCamera';

/** A point on the sphere. Always exactly `radius` units from the origin. */
export interface SpherePoint {
  x: number;
  y: number;
  z: number;
}

/** Orientation of the sphere in world space. Radians. */
export interface SphereOrientation {
  /** Spin about the vertical axis. */
  yaw: number;
  /** Tilt north/south, clamped away from the poles. */
  pitch: number;
}

export const IDENTITY_ORIENTATION: SphereOrientation = { yaw: 0, pitch: 0 };

/** Maximum tilt. At 90° the view pole sits on the equator and the layout
 *  degenerates into an infinitely thin band, so we stop short of it. */
export const MAX_SPHERE_PITCH = (Math.PI / 2) * 0.92;

/**
 * Scale a layout so it fits the sphere at a chosen density.
 *
 * The layout's own extent is unknown to this module; callers pass the world
 * radius they want to wrap. Keeping that a parameter means the same
 * projection works whether the workspace is one document or fifty.
 */
export const DEFAULT_SPHERE_RADIUS = 1000;

/**
 * Inverse stereographic projection: layout plane → sphere.
 *
 * With `S = x² + y² + R²`, the transverse coordinates are `2R²x/S` and
 * `2R²y/S`, and the axial coordinate must be `R(R² − x² − y²)/S` so that
 * `(2R²x/S)² + (2R²y/S)² + (R(R²−x²−y²)/S)² = R²` exactly.
 *
 * The `R² − x² − y²` ordering (not the textbook `x² + y² − R²`) is what puts
 * the layout origin at `z = +R`: the near pole, facing the viewer. That sign
 * choice keeps the visible cap on the `+Z` side, which is the side
 * `toScreen` expects.
 */
export function toSphere(x: number, y: number, radius: number): SpherePoint {
  const r = Math.abs(radius) || 1;
  const s = x * x + y * y + r * r;
  return {
    x: (2 * r * r * x) / s,
    y: (2 * r * r * y) / s,
    z: (r * (r * r - x * x - y * y)) / s,
  };
}

/**
 * Forward stereographic projection, near pole → plane.
 *
 * Valid only for points with `z > 0` (the visible hemisphere). The caller
 * must cull with `isFrontFacing` first; passing a back-facing point yields a
 * point behind the eye, which would render mirrored.
 */
export function toScreen(p: SpherePoint, radius: number): Point {
  const r = Math.abs(radius) || 1;
  const denom = r + p.z;
  if (Math.abs(denom) < 1e-9) {
    // Exactly on the horizon: clamp to the silhouette so the node lands on
    // the rim instead of at infinity.
    return { x: p.x * 1e4, y: p.y * 1e4 };
  }
  return { x: (r * p.x) / denom, y: (r * p.y) / denom };
}

/**
 * True when a point faces the viewer.
 *
 * The camera looks down +z, so the visible cap is `z > 0`. The epsilon keeps
 * nodes sitting exactly on the horizon from flickering as the sphere turns.
 */
export function isFrontFacing(p: SpherePoint, epsilon = 0): boolean {
  return p.z > -epsilon;
}

export function clampPitch(pitch: number): number {
  if (!Number.isFinite(pitch)) return 0;
  return Math.min(MAX_SPHERE_PITCH, Math.max(-MAX_SPHERE_PITCH, pitch));
}

/**
 * Rotate a sphere point by an orientation.
 *
 * Yaw spins about the **Y** axis, which is what makes dragging horizontally
 * roll the globe. This is worth spelling out because the near pole sits on
 * the +Z axis: rotating about Z would spin the globe *toward the camera*,
 * which is visually a no-op. Pitch then tips about X, so the two controls
 * move the visible cap independently the way a trackball does.
 *
 * Order is yaw-then-pitch, applied in the point's own frame.
 */
export function rotateSphere(
  p: SpherePoint,
  orientation: SphereOrientation
): SpherePoint {
  const { yaw } = orientation;
  const pitch = clampPitch(orientation.pitch);

  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const yawed: SpherePoint = {
    x: p.x * cy + p.z * sy,
    y: p.y,
    z: -p.x * sy + p.z * cy,
  };

  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return {
    x: yawed.x,
    y: yawed.y * cp + yawed.z * sp,
    z: -yawed.y * sp + yawed.z * cp,
  };
}

/**
 * Convert a pointer drag into an orientation delta.
 *
 * `pixelsPerRadian` sets the gain: how many screen pixels of drag equal one
 * radian of rotation. This must be derived from the *viewport*, not from the
 * world scale — the layout units a pixel represents shrink as you zoom in,
 * so a world-derived gain would make the globe spin wildly when zoomed out
 * and barely move when zoomed in.
 *
 * Callers pass roughly `viewportWidth / π`, which means dragging across the
 * whole pane turns the globe a half turn: one drag, one hemisphere.
 */
export function dragToOrientation(
  base: SphereOrientation,
  dxScreen: number,
  dyScreen: number,
  pixelsPerRadian: number
): SphereOrientation {
  const k = 1 / Math.max(pixelsPerRadian, 1e-6);
  return {
    yaw: base.yaw + dxScreen * k,
    pitch: clampPitch(base.pitch + dyScreen * k),
  };
}

/** Great-circle distance between two sphere points, in radians. */
export function angularDistance(a: SpherePoint, b: SpherePoint): number {
  const dot = Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z));
  return Math.acos(dot);
}
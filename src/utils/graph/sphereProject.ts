/**
 * Shared yaw/pitch helpers.
 *
 * Originally the Globe projection's orientation math. Globe itself is gone
 * (replaced by Mindmap), but Concept still reuses the same drag → yaw/pitch
 * mapping and pitch clamp so a full-pane drag feels the same in 3D.
 */

/** Orientation as yaw (azimuth) + pitch (elevation), in radians. */
export interface SphereOrientation {
  /** Spin about the vertical axis. */
  yaw: number;
  /** Tilt, clamped away from the poles. */
  pitch: number;
}

export const IDENTITY_ORIENTATION: SphereOrientation = { yaw: 0, pitch: 0 };

/** Maximum tilt. At 90° the view degenerates, so we stop short of the pole. */
export const MAX_SPHERE_PITCH = (Math.PI / 2) * 0.92;

export function clampPitch(pitch: number): number {
  if (!Number.isFinite(pitch)) return 0;
  return Math.min(MAX_SPHERE_PITCH, Math.max(-MAX_SPHERE_PITCH, pitch));
}

/**
 * Convert a pointer drag into an orientation delta.
 *
 * `pixelsPerRadian` sets the gain from the *viewport* (typically
 * `viewportWidth / π`), so a pane-wide drag is always a half turn
 * regardless of zoom.
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

import { useMemo, useState } from 'react';

import {
  applyFisheyeToNodes,
  clampMagnification,
  type FisheyeBounds,
} from '@/utils/graph/fisheyeLens';
import type { Point } from '@/utils/graph/graphCamera';

/** Below this many nodes the refinement solve is skipped entirely. */
export const REFINE_MIN_NODES = 24;

export interface UseGraphLens<T extends Point> {
  /** Nodes after the lens transform, in layout space. */
  lensed: T[];
  focal: Point | null;
  setFocal: (next: Point | null) => void;
  magnification: number;
  setMagnification: (next: number) => void;
  /** True when the lens is doing something worth paying for. */
  active: boolean;
}

export interface UseGraphLensOptions {
  /** True when a focal point should be meaningful (sphere mode). */
  enabled: boolean;
  /** Bounds of the layout, used for the boundary intersection. */
  bounds: FisheyeBounds;
  /** Extra padding so the lens has a boundary slightly outside the nodes. */
  padding?: number;
}

/**
 * Graphical fisheye lens state.
 *
 * The lens is a no-op until both a focal point and a magnification above
 * zero exist, so `lensed` returns the input array by reference in the common
 * case and nothing downstream pays for the transform.
 *
 * Note the lens runs in *layout* space, before any sphere projection. That
 * ordering matters: edge orientation is only well defined on the plane, and
 * the 2018 paper's refinement solve assumes a planar target.
 */
export function useGraphLens<T extends Point>(
  nodes: readonly T[],
  { enabled, bounds, padding = 160 }: UseGraphLensOptions
): UseGraphLens<T> {
  const [focal, setFocal] = useState<Point | null>(null);
  const [magnification, setMagnification] = useState(0);

  const lensBounds = useMemo<FisheyeBounds>(
    () => ({
      minX: bounds.minX - padding,
      minY: bounds.minY - padding,
      width: bounds.width + padding * 2,
      height: bounds.height + padding * 2,
    }),
    [bounds.minX, bounds.minY, bounds.width, bounds.height, padding]
  );

  const active = enabled && focal !== null && magnification > 0;

  const lensed = useMemo(() => {
    if (!active || !focal) return nodes as T[];
    return applyFisheyeToNodes(nodes, focal, magnification, lensBounds);
  }, [active, nodes, focal, magnification, lensBounds]);

  return {
    lensed,
    focal,
    setFocal: (next) => setFocal(next),
    magnification: clampMagnification(magnification),
    setMagnification: (next) => setMagnification(clampMagnification(next)),
    active,
  };
}
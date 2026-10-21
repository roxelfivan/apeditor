import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';

import {
  cameraViewBox,
  clampGraphZoom,
  fitCameraTo,
  panCamera,
  screenToWorld,
  type Bounds,
  type GraphCamera,
  type Point,
  type ViewportSize,
} from '@/utils/graph/graphCamera';
import {
  clampConceptPose,
  conceptDistanceFromZoom,
  DEFAULT_CONCEPT_DISTANCE,
  DEFAULT_CONCEPT_POSE,
  dragToConceptPose,
  type ConceptPose,
} from '@/utils/graph/conceptProject';
import {
  dragToOrientation,
  IDENTITY_ORIENTATION,
  type SphereOrientation,
} from '@/utils/graph/sphereProject';

/**
 * How the Graph view turns layout coordinates into screen pixels.
 *
 * All three are **projections within the Graph view**, not `viewMode`s.
 * `viewMode` stays `'write' | 'preview' | 'split' | 'graph'`; switching
 * projection never changes what the Graph can do, only how it is seen.
 */
export type GraphProjection =
  /** The layout, undistorted. Pan by dragging the background. */
  | 'flat'
  /** iSphere stereographic wrap. Drag the background to spin the sphere. */
  | 'sphere'
  /** 3D Concept: the layout as a floor, headings extruded upward. */
  | 'concept';

/** Layout units the sphere wraps. A multi-document workspace at its natural
 *  radial extent lands roughly on a hemisphere at the identity orientation. */
export const SPHERE_RADIUS = 2600;

export type GraphDragKind = 'pan' | 'orbit' | 'conceptOrbit';

/** Pointer travel before a background drag counts as navigation. */
const DRAG_THRESHOLD_PX = 3;

interface DragSession {
  pointerId: number;
  kind: GraphDragKind;
  startClientX: number;
  startClientY: number;
  startCamera: GraphCamera;
  startOrientation: SphereOrientation;
  /** Baseline for a `conceptOrbit` drag; rotations are deltas from here. */
  startConceptPose: ConceptPose;
  moved: boolean;
}

export interface UseGraphCamera {
  camera: GraphCamera;
  orientation: SphereOrientation;
  viewBox: { x: number; y: number; w: number; h: number };
  viewport: ViewportSize;
  /** Client (mouse) point → world coordinate, accounting for element origin. */
  worldAtClient: (clientX: number, clientY: number) => Point;
  beginDrag: (
    e: ReactPointerEvent,
    kind: GraphDragKind,
    orientation?: SphereOrientation
  ) => void;
  moveDrag: (e: ReactPointerEvent) => void;
  endDrag: () => void;
  zoomBy: (direction: 1 | -1, anchor?: Point) => void;
  /** True while a pointer drag is in flight. */
  dragging: boolean;
  /** Camera pose for the 3D Concept projection. */
  conceptPose: ConceptPose;
  /** Replace the Concept pose outright, e.g. when the layout recentres. */
  setConceptPose: (next: ConceptPose) => void;
  /**
   * Zoom for Concept mode. Moves the eye along its view vector rather than
   * scaling `camera.scale`, which the SVG path does.
   */
  zoomByConcept: (direction: 1 | -1) => void;
}

/**
 * Owns the Graph viewport: fit, pan, orbit, zoom, and viewport measurement.
 *
 * Extracted from `GraphView` so the component does not absorb another four
 * pieces of camera bookkeeping per navigation feature.
 *
 * Zoom is a *multiplier* on top of the fit scale rather than an absolute
 * scale, matching what the old bound-derived viewBox did. The distinction
 * matters: the fit scale changes whenever the layout or pane resizes, so
 * storing an absolute scale would let the two fight and either one lose. The
 * multiplier is what the toolbar's percentage reads and writes.
 *
 * The auto-fit contract: it re-centres only when the bounds actually change,
 * and never mid-drag. Re-fitting every render would fight the user's panning
 * — a problem the previous bound-derived viewBox avoided only by refusing to
 * pan at all.
 */
export function useGraphCamera(
  wrapperRef: RefObject<HTMLDivElement>,
  projection: GraphProjection,
  bounds: Bounds,
  zoomMultiplier: number,
  onZoomChange: (next: number) => void
): UseGraphCamera {
  const [viewport, setViewport] = useState<ViewportSize>({ w: 1, h: 1 });
  // Pan is an explicit centre in world units, which is what makes the view
  // independent of the node set.
  const [center, setCenter] = useState<Point>({
    x: bounds.minX + bounds.width / 2,
    y: bounds.minY + bounds.height / 2,
  });
  const [orientation, setOrientation] = useState<SphereOrientation>(
    IDENTITY_ORIENTATION
  );
  // Concept mode orbits a point rather than centring a rectangle, so its
  // "camera" is a pose. It starts at the layout's centre and is re-centred
  // by the same fitKey effect that drives `center`.
  const [conceptPose, setConceptPoseState] = useState<ConceptPose>({
    ...DEFAULT_CONCEPT_POSE,
    target: {
      x: bounds.minX + bounds.width / 2,
      y: bounds.minY + bounds.height / 2,
    },
  });
  // The pose hold a distance, and the toolbar holds a zoom multiplier. One
  // writer — usually the toolbar — drives the other through an effect.
// OrbitControls calls `setConceptPose` directly on wheel-dolly, so we
// write through `onZoomChange` *outside* the state updater, never from
// inside one (otherwise React warns "Cannot update while rendering").
const lastConceptDistanceApplied = useRef(0);
const setConceptPose = useCallback(
  (next: ConceptPose) => {
    const clamped = clampConceptPose(next);
    setConceptPoseState(clamped);
    const nextDistance = clamped.distance;
    if (lastConceptDistanceApplied.current !== nextDistance) {
      lastConceptDistanceApplied.current = nextDistance;
      const nextZoom = nextDistance / DEFAULT_CONCEPT_DISTANCE;
      if (nextZoom !== zoomMultiplier) onZoomChange(nextZoom);
    }
  },
  [zoomMultiplier, onZoomChange]
);
  const session = useRef<DragSession | null>(null);
  const dragging = session.current !== null;

  useLayoutEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    // Bail out when the size is unchanged. A fresh `{ w, h }` on every
    // ResizeObserver callback re-renders the SVG, which can re-tick the
    // observer (chat panel keystrokes shift the flex layout) and blow the
    // React update-depth limit — blanking the whole tab.
    const sync = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      setViewport((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [wrapperRef]);

  const fit = useMemo(() => fitCameraTo(bounds, viewport), [bounds, viewport]);
  const zoom = clampGraphZoom(zoomMultiplier);
  const camera = useMemo<GraphCamera>(
    () => ({ cx: center.x, cy: center.y, scale: fit.scale * zoom }),
    [center, fit.scale, zoom]
  );

  // Re-centre when the data or the pane changes, but not when the user pans.
  const fitKey = `${bounds.minX.toFixed(1)}:${bounds.minY.toFixed(1)}:${bounds.width.toFixed(
    1
  )}:${bounds.height.toFixed(1)}:${viewport.w}:${viewport.h}`;
  const lastFitKey = useRef('');
  useLayoutEffect(() => {
    if (fitKey === lastFitKey.current) return;
    lastFitKey.current = fitKey;
    if (session.current) return;
    setCenter({ x: fit.cx, y: fit.cy });
    // Concept orbits a layout-space point rather than framing a rectangle,
    // but it still needs the layout's centre when the data or pane changes.
    // Only the target moves — yaw, pitch and distance are the user's.
    setConceptPoseState((prev) => ({
      ...prev,
      target: { x: fit.cx, y: fit.cy },
    }));
  }, [fitKey, fit]);

  // The toolbar drives one `zoom` multiplier for every projection, so the
  // Concept eye distance is derived from it rather than tracked separately.
  // Two sources of truth would drift the moment the user pressed `Zoom +`
  // in one projection and switched to another. This runs on every zoom
  // change; `zoomByConcept` writes the multiplier, which lands back here.
  const conceptDistance = conceptDistanceFromZoom(zoom);
  const lastConceptDistance = useRef(conceptDistance);
  useLayoutEffect(() => {
    if (conceptDistance === lastConceptDistance.current) return;
    lastConceptDistance.current = conceptDistance;
    setConceptPoseState((prev) =>
      prev.distance === conceptDistance ? prev : { ...prev, distance: conceptDistance }
    );
  }, [conceptDistance]);

  const worldAtClient = useCallback(
    (clientX: number, clientY: number) => {
      const el = wrapperRef.current;
      if (!el) return { x: camera.cx, y: camera.cy };
      const rect = el.getBoundingClientRect();
      return screenToWorld(
        camera,
        clientX - rect.left - rect.width / 2,
        clientY - rect.top - rect.height / 2
      );
    },
    [camera, wrapperRef]
  );

  const beginDrag = useCallback(
    (
      e: ReactPointerEvent,
      kind: GraphDragKind,
      orient?: SphereOrientation
    ) => {
      session.current = {
        pointerId: e.pointerId,
        kind,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startCamera: camera,
        startOrientation: orient ?? orientation,
        startConceptPose: conceptPose,
        moved: false,
      };
    },
    [camera, orientation, conceptPose]
  );

  const moveDrag = useCallback((e: ReactPointerEvent) => {
    const s = session.current;
    if (!s || e.pointerId !== s.pointerId) return;
    const dx = e.clientX - s.startClientX;
    const dy = e.clientY - s.startClientY;
    if (!s.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    s.moved = true;

    if (s.kind === 'pan') {
      const next = panCamera(s.startCamera, dx, dy);
      setCenter({ x: next.cx, y: next.cy });
      return;
    }
    // Gain comes from the viewport, so a drag across the pane always turns
    // the globe by the same angle regardless of zoom or graph size. The
    // Concept projection reuses the identical rule, so the mouse feels the
    // same in all three projections.
    const pixelsPerRadian = Math.max(viewport.w, 320) / Math.PI;
    if (s.kind === 'conceptOrbit') {
      setConceptPoseState(
        dragToConceptPose(s.startConceptPose, dx, dy, pixelsPerRadian)
      );
      return;
    }
    setOrientation(dragToOrientation(s.startOrientation, dx, dy, pixelsPerRadian));
  }, [viewport.w]);

  const endDrag = useCallback(() => {
    session.current = null;
  }, []);

  const zoomBy = useCallback(
    (direction: 1 | -1, anchor?: Point) => {
      const nextZoom = clampGraphZoom(
        zoomMultiplier * (direction > 0 ? 1.25 : 1 / 1.25)
      );
      if (nextZoom === zoomMultiplier) return;
      onZoomChange(nextZoom);

      // Keep the anchored world point pinned under the cursor. Only the
      // centre needs recomputing — the fit scale is untouched because only
      // the multiplier moved.
      if (!anchor) return;
      const nextScale = fit.scale * nextZoom;
      const dx = (anchor.x - center.x) * camera.scale;
      const dy = (anchor.y - center.y) * camera.scale;
      setCenter({
        x: anchor.x - dx / nextScale,
        y: anchor.y - dy / nextScale,
      });
    },
    [zoomMultiplier, onZoomChange, fit.scale, center.x, center.y, camera.scale]
  );

  // Concept zoom moves the eye along its own view vector, but the toolbar's
  // `zoom` multiplier remains the single source of truth for the percentage
  // readout. Writing the multiplier lets the sync effect above derive the
  // distance, so there is no second place to keep in step.
  const zoomByConcept = useCallback(
    (direction: 1 | -1) => {
      const next = clampGraphZoom(
        zoomMultiplier * (direction > 0 ? 1.25 : 1 / 1.25)
      );
      if (next === zoomMultiplier) return;
      onZoomChange(next);
    },
    [zoomMultiplier, onZoomChange]
  );

  return {
    camera,
    // Orientation is meaningless outside sphere mode; reporting the identity
    // keeps callers from having to branch on projection themselves.
    orientation: projection === 'sphere' ? orientation : IDENTITY_ORIENTATION,
    viewBox: cameraViewBox(camera, viewport),
    viewport,
    worldAtClient,
    beginDrag,
    moveDrag,
    endDrag,
    zoomBy,
    dragging,
    conceptPose,
    setConceptPose,
    zoomByConcept,
  };
}
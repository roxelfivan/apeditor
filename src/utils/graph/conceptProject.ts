/**
 * Geometry for the 3D Concept projection.
 *
 * The Globe projection wraps the atom on a sphere; Concept instead keeps
 * the layout's (x, y) as the *floor* and lifts nodes along a third axis by
 * heading depth, so the document outline reads as a stack of layers you can
 * orbit around. This module holds the pure math; `Concept3DScene.tsx` owns
 * the three.js objects.
 *
 * Axes
 * -----
 * three.js is Y-up, so the layout is mapped as
 *
 *     world.x = layout.x
 *     world.y = height      (the extrusion — `slot.y` output)
 *     world.z = layout.y
 *
 * Mapping layout.y onto world.z rather than world.y is what makes the
 * 2D layout the floor: document nodes sit at height 0, and the floor
 * grid lies in the x/z plane.
 *
 * Two opposing y bands (v0.5.8)
 * -----------------------------
 * v0.5.8 piled headings and terms onto the same positive-y axis, so a tall
 * document with three heading tiers had its terms rendered on tier 4 — the
 * whole stack collapsed into one horizontal band on screen. v0.5.8 splits
 * the bands so they cannot visually merge:
 *
 *   world.y > 0  →  headings, rising by tree depth     (clear sky)
 *   world.y < 0  →  [[term]] satellites, on a ring     (underground)
 *   world.y = 0  →  document hubs                      (the floor)
 *
 * Conventions
 * -----------
 * `pitch` is elevation, not the sphere's tilt-about-X: **positive pitch
 * raises the camera**, so it looks *down* at the floor. `yaw` rotates the
 * eye about the vertical axis, positive turning right. Pitch is clamped
 * short of the pole exactly as `MAX_SPHERE_PITCH` is, so a near-vertical
 * camera cannot flip the scene.
 */

import type { Point } from '@/utils/graph/graphCamera';
import type { GraphEdge, GraphNodeKind } from '@/utils/graph/buildWorkspaceGraph';
import { headingDepthByNode } from '@/utils/graph/layoutWorkspaceGraph';
import { clampPitch, dragToOrientation } from '@/utils/graph/sphereProject';

/** A point in three.js world space. */
export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** Camera pose for the Concept projection. */
export interface ConceptPose {
  /** Azimuth in radians. Positive turns the eye to the right. */
  yaw: number;
  /** Elevation in radians. Positive looks down at the floor. */
  pitch: number;
  /** Eye distance from `target`, in layout units. */
  distance: number;
  /** Layout-space point the camera orbits and looks at. */
  target: Point;
}

/* --------------------------------------------------------------------- */
/* Slot / height                                                           */
/* --------------------------------------------------------------------- */

/**
 * Per-node placement inside the scene.
 *
 * `y` is in **layout units** along three.js's world Y. A document lives at
 * `y = 0` (the floor). Heading tiers are positive; `[[term]]` satellites
 * drop **below** the floor so they cannot merge with the heading stack
 * regardless of how tall a document grows.
 *
 * `term` is the kind discriminator the scene uses to pick materials, label
 * offsets, and edge zoning — it is also true for the term **wireframe**
 * ring drawn around each document's hub at `CONCEPT_TERM_RING_R`.
 */
export interface ConceptSlot {
  /** World Y this node mesh sits at. May be negative for terms. */
  y: number;
  /** Layout-space position on the floor (world.x, world.z). Documents only — zero for tiers. */
  ringX?: number;
  ringZ?: number;
  /** True for `[[term]]` nodes — distinct from headings so the scene can branch. */
  term: boolean;
}

/** Height of the first heading tier. Documents sit at 0, so this clears them. */
export const CONCEPT_HEADING_BASE_Z = 270;
/**
 * Vertical gap between heading tiers. Roughly 2× the document-sphere radius
 * (36), so a tier reads as its own band even with wrapped labels. The
 * invariant in `nodeRadius` is documented alongside the test.
 */
export const CONCEPT_Z_STEP = 135;
/**
 * Depth of the `[[term]]` ring below the floor. Pulled negative so terms
 * cannot visually merge with any heading tier, no matter how tall.
 */
export const CONCEPT_TERM_DEPTH = 200;
/**
 * Radial distance (in layout units) from a document hub to its terms'
 * underground ring. Sized to clear the document sphere (radius 36) without
 * crossing into a neighbouring document's own term ring.
 */
export const CONCEPT_TERM_RING_R = 360;

/**
 * Height of a heading at tree `depth`.
 *
 * Depth 0 (a top-level `#`) is the first tier. The step is deliberately
 * larger than a node radius so two tiers never interpenetrate.
 */
export function conceptZForDepth(depth: number): number {
  const d = Number.isFinite(depth) ? Math.max(0, Math.round(depth)) : 0;
  return CONCEPT_HEADING_BASE_Z + d * CONCEPT_Z_STEP;
}

/**
 * How many vertical stories a sibling ring occupies.
 *
 * Tree depth alone puts every `##` child on one floor, so a document like
 * App Plan (a dozen peer sections) still reads as a 2D fan in Graph 3D.
 * Extra stories open once a parent has more children than fit on one
 * band; the cap keeps a wide outline from becoming a skyscraper.
 */
export const CONCEPT_SIBLINGS_PER_STORY = 5;
export const CONCEPT_SIBLING_STORIES_MAX = 3;

export function siblingStoryCount(siblingCount: number): number {
  if (!Number.isFinite(siblingCount) || siblingCount <= CONCEPT_SIBLINGS_PER_STORY) {
    return 1;
  }
  return Math.min(
    CONCEPT_SIBLING_STORIES_MAX,
    Math.ceil(siblingCount / CONCEPT_SIBLINGS_PER_STORY)
  );
}

/**
 * World Y for a heading, including sibling-helix extras.
 *
 * `bandStories` is the graph-wide max of `siblingStoryCount`, so a nested
 * heading cannot land inside a shallower sibling helix. When every sibling
 * group is small this is 1 and the formula equals `conceptZForDepth`.
 */
export function conceptHeadingY(
  depth: number,
  extra: number,
  bandStories: number
): number {
  const d = Number.isFinite(depth) ? Math.max(0, Math.round(depth)) : 0;
  const e = Number.isFinite(extra) ? Math.max(0, Math.round(extra)) : 0;
  const b = Number.isFinite(bandStories)
    ? Math.max(1, Math.round(bandStories))
    : 1;
  return CONCEPT_HEADING_BASE_Z + (d * b + Math.min(e, b - 1)) * CONCEPT_Z_STEP;
}

/**
 * Y position for a `[[term]]` satellite: below the floor, on the term ring.
 *
 * `layoutAnchor` is the term's layout-space (x, y). The ring is dropped at
 * (-CONCEPT_TERM_DEPTH) and at the term's existing floor coordinates so a
 * wikilink chord from a heading reads vertically rather than collapsing
 * into the floor.
 */
export function conceptTermSlot(layoutAnchor: Point): ConceptSlot {
  return {
    y: -CONCEPT_TERM_DEPTH,
    ringX: layoutAnchor.x,
    ringZ: layoutAnchor.y,
    term: true,
  };
}

/* --------------------------------------------------------------------- */
/* Camera distance                                                         */
/* --------------------------------------------------------------------- */

export const MIN_CONCEPT_DISTANCE = 400;
export const MAX_CONCEPT_DISTANCE = 6000;
/** Reference distance that the toolbar's `100%` zoom reads as. */
export const DEFAULT_CONCEPT_DISTANCE = 1800;

export function clampConceptDistance(distance: number): number {
  if (!Number.isFinite(distance)) return DEFAULT_CONCEPT_DISTANCE;
  return Math.min(
    MAX_CONCEPT_DISTANCE,
    Math.max(MIN_CONCEPT_DISTANCE, distance)
  );
}

/**
 * Step the eye distance by one zoom factor.
 *
 * `direction > 0` moves **in** (closer), matching `stepGraphZoom`, so the
 * toolbar's `Zoom +` behaves identically in all three projections.
 */
export function conceptZoomBy(
  distance: number,
  direction: 1 | -1
): number {
  const next =
    direction > 0 ? distance / 1.25 : distance * 1.25;
  return clampConceptDistance(next);
}

/** Translate the toolbar's zoom multiplier into an eye distance. */
export function conceptDistanceFromZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return DEFAULT_CONCEPT_DISTANCE;
  return clampConceptDistance(zoom * DEFAULT_CONCEPT_DISTANCE);
}

/* --------------------------------------------------------------------- */
/* Pose                                                                    */
/* --------------------------------------------------------------------- */

/**
 * Opening pose: front-right and ~40° above the floor.
 *
 * The elevation is what makes the extrusion legible on load — at pitch 0
 * the floor is edge-on and the heading tiers line up into a single row.
 */
export const DEFAULT_CONCEPT_POSE: ConceptPose = {
  yaw: -0.6,
  pitch: 0.7,
  distance: DEFAULT_CONCEPT_DISTANCE,
  target: { x: 0, y: 0 },
};

/**
 * Polar-angle clamps for the camera's inclination, expressed in three.js's
 * `OrbitControls` convention (where `phi = polar`, and `phi = 0` points
 * straight down +Y).
 *
 * The relationship to our `pitch` (elevation) is `phi = π/2 - pitch`,
 * so `MIN_POLAR_ANGLE = π/2 - 0.7 ≈ 0.87` would let the camera look
 * horizontally without flipping; both poles are still excluded by
 * symmetric limits just shy of 0 and π.
 */
export const MIN_POLAR_ANGLE = Math.PI * 0.08;
export const MAX_POLAR_ANGLE = Math.PI * 0.92;

export function clampConceptPose(pose: ConceptPose): ConceptPose {
  return {
    yaw: Number.isFinite(pose.yaw) ? pose.yaw : 0,
    pitch: clampPitch(pose.pitch),
    distance: clampConceptDistance(pose.distance),
    target: {
      x: Number.isFinite(pose.target.x) ? pose.target.x : 0,
      y: Number.isFinite(pose.target.y) ? pose.target.y : 0,
    },
  };
}

/**
 * Orbit from a pointer drag.
 *
 * The gain rule is `dragToOrientation`'s, deliberately: one full pane drag
 * turns a half revolution in both projections, so switching between Flat,
 * Globe and Concept does not retune the mouse.
 */
export function dragToConceptPose(
  base: ConceptPose,
  dxScreen: number,
  dyScreen: number,
  pixelsPerRadian: number
): ConceptPose {
  const next = dragToOrientation(base, dxScreen, dyScreen, pixelsPerRadian);
  return clampConceptPose({ ...base, yaw: next.yaw, pitch: next.pitch });
}

/**
 * Eye position for a pose, in three.js world space.
 *
 * Spherical around `target`: yaw sweeps the azimuth, pitch lifts the eye.
 * At yaw 0 / pitch 0 the eye sits on `+Z` at eye level, looking down `-Z`.
 */
export function conceptCameraPosition(pose: ConceptPose): Point3 {
  const p = clampConceptPose(pose);
  const cosPitch = Math.cos(p.pitch);
  const d = p.distance;
  return {
    x: p.target.x + d * cosPitch * Math.sin(p.yaw),
    y: p.target.y + d * Math.sin(p.pitch),
    z: p.target.y + d * cosPitch * Math.cos(p.yaw),
  };
}

/**
 * Inverse of `conceptCameraPosition`.
 *
 * Given a camera's world position and what it is looking at, recover the
 * `(yaw, pitch, distance)` of the equivalent `ConceptPose`. Used by
 * `OrbitControls` to write its drag-induced spherical back into the same
 * pose state that `useGraphCamera` already owns.
 *
 * The maths is the spherical-coords identity in reverse:
 *
 *     distance = ‖eye − target‖
 *     pitch    = asin((eye.y − target.y) / distance)
 *     yaw      = atan2(eye.x − target.x, eye.z − target.y)
 *
 * Both terms and terms below the floor pass through this unchanged.
 */
export function conceptPoseFromCamera(
  eye: Point3,
  target: Point
): ConceptPose {
  const dx = eye.x - target.x;
  const dy = eye.y - target.y;
  const dz = eye.z - target.y;
  const distance = Math.hypot(dx, dy, dz) || 1;
  // `asin` is in [-π/2, π/2], which is exactly `clampPitch`'s range. The
  // tiny `clampMagnitude` keeps the result finite if `distance` rounds to 0.
  const pitch = Math.asin(Math.max(-1, Math.min(1, dy / distance)));
  const yaw = Math.atan2(dx, dz);
  return clampConceptPose({
    yaw,
    pitch,
    distance,
    target: { x: target.x, y: target.y },
  });
}

/* --------------------------------------------------------------------- */
/* Picking                                                                 */
/* --------------------------------------------------------------------- */

/**
 * Where a camera ray meets the floor, in **layout** coordinates.
 *
 * Drag overrides are stored in layout space (see `GraphView`), and the floor
 * is the plane a Concept-mode node drag slides along — so intersecting
 * `y = 0` and reading `(world.x, world.z)` back as `(x, y)` is exactly the
 * space `overrides` expects. Returns `null` for a ray parallel to the
 * floor, where no intersection exists.
 */
export function floorPointFromRay(origin: Point3, direction: Point3): Point | null {
  const dy = direction.y;
  if (!Number.isFinite(dy) || Math.abs(dy) < 1e-9) return null;
  const t = -origin.y / dy;
  if (!Number.isFinite(t)) return null;
  return {
    x: origin.x + t * direction.x,
    y: origin.z + t * direction.z,
  };
}

/** Layout point → three.js world position, at height `y`. */
export function layoutToWorld(x: number, y: number, worldY: number): Point3 {
  return { x, y: worldY, z: y };
}

/* --------------------------------------------------------------------- */
/* Heights                                                                */
/* --------------------------------------------------------------------- */

/** A node with just enough shape to be placed in the scene. */
export interface HeightInput {
  id: string;
  kind: GraphNodeKind;
  /** Layout coordinates — used to drop terms on the floor below their link source. */
  x: number;
  y: number;
  documentId: string | null;
}

/**
 * Assign a placement slot to every node.
 *
 * Documents are the floor at `y = 0`. Headings rise by their **tree**
 * depth, which `headingDepthByNode` computes separately — deliberately not
 * the radial `assignShells` map, because that collapses a lone page H1
 * onto the nucleus ring and would render that page one tier flat.
 *
 * Wide sibling rings (many `##` under one parent) then helix onto extra
 * stories so Graph 3D does not replay the 2D fan of overlapping labels.
 *
 * `[[term]]` satellites land on the underground ring at `-CONCEPT_TERM_DEPTH`,
 * preserving their `(world.x, world.z)` so a wikilink chord from a heading
 * reads downward rather than collapsing. Tests assert:
 *
 *   - every heading's `slot.y` is positive;
 *   - every term's `slot.y` is strictly negative;
 *   - the term's floor `(x, z)` matches its layout anchor;
 *   - tier spacing is at least `2 · nodeRadius('heading', false)`;
 *   - a wide sibling ring occupies more than one distinct `slot.y`.
 *
 * Kept here rather than in the React component so the harness can assert a
 * wrong tier before it reaches a canvas.
 */
export function assignConceptHeights(
  nodes: readonly HeightInput[],
  edges: readonly GraphEdge[]
): Map<string, ConceptSlot> {
  const depth = headingDepthByNode(edges);
  const slots = new Map<string, ConceptSlot>();
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const parentOf = new Map<string, string>();
  for (const e of edges) {
    if (e.kind !== 'heading') continue;
    parentOf.set(e.target, e.source);
  }

  const groups = new Map<string, HeightInput[]>();
  for (const n of nodes) {
    if (n.kind !== 'heading') continue;
    const parent = parentOf.get(n.id) ?? '';
    const list = groups.get(parent);
    if (list) list.push(n);
    else groups.set(parent, [n]);
  }

  let bandStories = 1;
  for (const group of groups.values()) {
    bandStories = Math.max(bandStories, siblingStoryCount(group.length));
  }

  const extraOf = new Map<string, number>();
  for (const [parentId, group] of groups) {
    const stories = siblingStoryCount(group.length);
    const parent = byId.get(parentId);
    const ox = parent?.x ?? 0;
    const oy = parent?.y ?? 0;
    const sorted = [...group].sort((a, b) => {
      const aa = Math.atan2(a.y - oy, a.x - ox);
      const bb = Math.atan2(b.y - oy, b.x - ox);
      if (aa !== bb) return aa - bb;
      return a.id.localeCompare(b.id);
    });
    sorted.forEach((n, i) => {
      extraOf.set(n.id, stories <= 1 ? 0 : i % stories);
    });
  }

  for (const n of nodes) {
    if (n.kind === 'document') {
      slots.set(n.id, { y: 0, term: false });
      continue;
    }
    if (n.kind === 'heading') {
      slots.set(n.id, {
        y: conceptHeadingY(
          depth.get(n.id) ?? 0,
          extraOf.get(n.id) ?? 0,
          bandStories
        ),
        term: false,
      });
      continue;
    }
    // Terms drop onto the underground ring at their layout anchor.
    slots.set(n.id, conceptTermSlot({ x: n.x, y: n.y }));
  }
  return slots;
}

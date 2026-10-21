/**
 * 3D Concept projection — a three.js view of the same workspace graph the
 * SVG Graph and the stereographic Globe draw.
 *
 * The layout from `layoutWorkspaceGraph` is planar, so this scene treats it
 * as a **floor**: `layout.x → world.x`, `layout.y → world.z`, and the third
 * axis is free. Heading tiers are extruded upward along `world.y`, which
 * turns a document's outline into a stack of layers you can orbit around.
 *
 * Design notes
 * ------------
 * - **three.js is imported dynamically.** `await import('three')` inside
 *   the effect keeps the library out of the main bundle entirely: a
 *   workspace that never opens the 3D projection never pays for it. This
 *   mirrors how `FileActionsButton` defers the OCR stack.
 * - **No `OrbitControls`.** The Graph already owns camera bookkeeping in
 *   `useGraphCamera`; a second controller would fight it. The scene is a
 *   pure renderer of the pose the hook produces.
 * - **Click parity with the SVG.** `onNodeClick` receives the same node
 *   objects `GraphView`'s SVG passes, so document selection and
 *   `openRange` behave identically in all three projections.
 */

import { useEffect, useMemo, useRef, type ReactElement, type PointerEvent as ReactPointerEvent } from 'react';
// Type-only import: erased at compile time, so it costs nothing at runtime
// and cannot pull three.js into the eager module graph. The runtime `import`
// happens inside the effect.
import type * as THREE_TYPES from 'three';

import {
  assignConceptHeights,
  conceptCameraPosition,
  conceptPoseFromCamera,
  layoutToWorld,
  MAX_CONCEPT_DISTANCE,
  MAX_POLAR_ANGLE,
  MIN_CONCEPT_DISTANCE,
  MIN_POLAR_ANGLE,
  type ConceptPose,
  type ConceptSlot,
} from '@/utils/graph/conceptProject';
import type { LaidOutNode } from '@/utils/graph/layoutWorkspaceGraph';
import type {
  GraphEdge,
  GraphNodeKind,
} from '@/utils/graph/buildWorkspaceGraph';

/**
 * Node radius → sphere radius.
 *
 * The layout's `nodeRadius` values (36 / 26 / 20 / 16) are tuned for an SVG
 * `r` in world units at fit scale. A 3D sphere needs to read as a ball
 * rather than a disc, so the radius is scaled up modestly and floored so a
 * `[[term]]` stays visibly smaller than a document hub.
 */
function sphereRadius(node: LaidOutNode): number {
  return Math.max(10, node.r * 1.15);
}

/**
 * Colour roles, mirroring the SVG's `fill-*` classes.
 *
 * Colours are resolved from the theme's CSS custom properties rather than
 * hardcoded hex pairs, so the scene follows the light/dark toggle for free —
 * `--cyber-primary` / `--cyber-muted` are space-separated `R G B` triplets
 * by design (they feed Tailwind's `<alpha-value>` slots), so they are
 * parsed component-wise, not as hex.
 */
export interface ConceptPalette {
  edge: number;
  floor: number;
  document: number;
  heading: number;
  term: number;
  current: number;
  label: string;
}

/** Parse a `R G B` CSS custom property into a packed 0xRRGGBB number. */
function readTriplet(
  css: CSSStyleDeclaration,
  name: string,
  fallback: number
): number {
  const parts = css.getPropertyValue(name).trim().split(/\s+/);
  if (parts.length < 3) return fallback;
  const [r, g, b] = parts.map((p) => parseFloat(p));
  if (![r, g, b].every((v) => Number.isFinite(v))) return fallback;
  return r * 65536 + g * 256 + b;
}

/** Parse a `#rrggbb` literal, tolerating the `rgb()` form Tailwind emits. */
function readHex(value: string, fallback: number): number {
  const n = parseInt(value.replace('#', '').slice(0, 6), 16);
  return Number.isFinite(n) ? n : fallback;
}

export function readConceptPalette(): ConceptPalette {
  const root = document.documentElement;
  const css = getComputedStyle(root);
  const dark = root.classList.contains('dark');

  return {
    edge: readTriplet(css, '--cyber-muted', dark ? 0xa8aea8 : 0x5c574f),
    floor: readTriplet(css, '--cyber-muted', dark ? 0xa8aea8 : 0x5c574f),
    // `cyber-clay` / `cyber-cyan` and the paper surfaces, from tailwind.config.
    current: readHex(dark ? '#6FBF99' : '#1B4636', 0x1b4636),
    document: readHex(dark ? '#222932' : '#FFFCF8', dark ? 0x222932 : 0xfffcf8),
    heading: readHex(dark ? '#1A2026' : '#EBE6DC', dark ? 0x1a2026 : 0xebe6dc),
    term: readHex(dark ? '#11171B' : '#F4F1EA', dark ? 0x11171b : 0xf4f1ea),
    label: dark ? '#F4F1EA' : '#171614',
  };
}

/** Fill colour for a node, given the palette and current-document state. */
function nodeColor(
  kind: GraphNodeKind,
  palette: ConceptPalette,
  isCurrent: boolean
): number {
  if (isCurrent) return palette.current;
  if (kind === 'document') return palette.document;
  if (kind === 'heading') return palette.heading;
  return palette.term;
}

/** Wrap a label the same way the SVG's `wrapLines` does. */
function wrapLines(text: string, maxChars = 16, maxLines = 3): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const word of words) {
    if (out.length >= maxLines) break;
    const chunk =
      word.length > maxChars ? `${word.slice(0, maxChars - 1)}…` : word;
    const next = cur ? `${cur} ${chunk}` : chunk;
    if (next.length <= maxChars) cur = next;
    else {
      if (cur) out.push(cur);
      cur = chunk;
    }
  }
  if (cur) out.push(cur);
  return out.length > 0 ? out : [text];
}

export interface Concept3DSceneProps {
  /** Nodes after layout, drag overrides, and the fisheye lens. */
  nodes: readonly LaidOutNode[];
  edges: readonly GraphEdge[];
  pose: ConceptPose;
  viewport: { w: number; h: number };
  /** On-screen label size in CSS pixels, matching the SVG path. */
  labelPx: number;
  /** Id of the document currently open in the editor. */
  currentDocumentId: string | null;
  /** Node the pointer is over, or `null`. Drives neighbour dimming. */
  hoverId: string | null;
  /** Ids lit by the hover — `hoverId` plus every node it touches. */
  hotIds: Set<string> | null;
  /** Node was clicked. Mirrors the SVG's `onNodeClick`. */
  onNodeClick: (node: LaidOutNode) => void;
  /** Pointer moved onto or off a node. */
  onHoverChange: (id: string | null) => void;
  /** Floor intersection of the last pointer position, in layout space. */
  onFloorPoint: (point: { x: number; y: number } | null) => void;
  /**
   * Pointer input the caller owns, forwarded from its own container.
   *
   * The scene attaches its listeners to the `<canvas>`, but the *drag
   * semantics* — orbit vs. move-a-node, and the override bookkeeping behind
   * it — live in `GraphView`, which already owns the drag session for the
   * SVG path. Handing over the raw React events keeps one drag model for
   * all three projections instead of a second one living inside three.js.
   */
  handlers: {
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => void;
    /**
     * Write the camera pose back to the hook. `OrbitControls` calls this
     * every time it drags, scrolls, or pans, so a navigation round-trip
     * survives remounts (including `Reset`, which clears scene-local state).
     */
    setConceptPose: (next: ConceptPose) => void;
  };
}

const FIELD_OF_VIEW = 45;
const NEAR = 1;
const FAR = 40000;
/** Sphere detail. 16 segments reads as a smooth ball at this node scale. */
const SPHERE_SEGMENTS = 16;
/** Hover ring grows the picked node so it reads as selected. */
const HOVER_SCALE = 1.25;

export default function Concept3DScene({
  nodes,
  edges,
  pose,
  viewport,
  labelPx,
  currentDocumentId,
  hoverId,
  hotIds,
  onNodeClick,
  onHoverChange,
  onFloorPoint,
  handlers,
}: Concept3DSceneProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelLayerRef = useRef<HTMLDivElement>(null);

  // Heights are stable for a given node/edge set, so recompute only when the
  // underlying data changes — not on every pointer move.
  const heights = useMemo(() => assignConceptHeights(nodes, edges), [nodes, edges]);

  // Latest props, readable from the render loop without re-subscribing. The
  // render loop is installed once; re-running it per hover would tear down
  // and rebuild every WebGL resource on each pointer move.
  const live = useRef({
    nodes,
    edges,
    heights,
    pose,
    viewport,
    labelPx,
    currentDocumentId,
    hoverId,
    hotIds,
    onNodeClick,
    onHoverChange,
    onFloorPoint,
    handlers,
  });
  live.current = {
    nodes,
    edges,
    heights,
    pose,
    viewport,
    labelPx,
    currentDocumentId,
    hoverId,
    hotIds,
    onNodeClick,
    onHoverChange,
    onFloorPoint,
    handlers,
  };

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    const teardown: (() => void)[] = [];

    void (async () => {
      const THREE = await import('three');
      if (cancelled) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      let palette = readConceptPalette();
      const w = Math.max(1, live.current.viewport.w);
      const h = Math.max(1, live.current.viewport.h);

      const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
      });
      renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(
        FIELD_OF_VIEW,
        w / h,
        NEAR,
        FAR
      );

      scene.add(new THREE.AmbientLight(0xffffff, 1.6));
      const key = new THREE.DirectionalLight(0xffffff, 1.2);
      key.position.set(-0.6, 1, 0.5);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0xffffff, 0.45);
      rim.position.set(0.8, 0.35, -0.8);
      scene.add(rim);

      /* ---------------- OrbitControls ---------------- */
      // Free 3D navigation: wheel zoom, shift+drag pan, right-drag pan,
      // keyboard arrow pan / +/- dolly. The hook remains the single source
      // of truth for the camera pose — `OrbitControls` writes back into it
      // on every change, so the next frame's `conceptCameraPosition(s.pose)`
      // round-trips through us, not through three.js.
      const { OrbitControls } = await import(
        'three/examples/jsm/controls/OrbitControls.js'
      );
      const controls = new OrbitControls(camera, canvas);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.rotateSpeed = 0.6;
      controls.zoomSpeed = 0.8;
      controls.panSpeed = 0.6;
      controls.minDistance = MIN_CONCEPT_DISTANCE;
      controls.maxDistance = MAX_CONCEPT_DISTANCE;
      // Polar angle ∈ [π/2 - pitch_max, π/2 + pitch_max]. `clampPitch`'s
      // bounds are 0.92·(π/2), so the symmetric OrbitControls limits are
      // just shy of 0 and π.
      controls.minPolarAngle = Math.max(MIN_POLAR_ANGLE, Math.PI * 0.08);
      controls.maxPolarAngle = Math.min(MAX_POLAR_ANGLE, Math.PI * 0.92);
      controls.target.set(live.current.pose.target.x, 0, live.current.pose.target.y);
      // Disable controls during a node drag so a node pick never also
      // starts an orbit. Re-enabled on `pointerup`.
      let controlsActive = true;
      void controlsActive;
      controls.enabled = true;
      controls.addEventListener('change', () => {
        // Sync the OrbitControls spherical back into our pose. We use
        // eye − target to recover (yaw, pitch, distance), which is exactly
        // the inverse of `conceptCameraPosition`.
        const eye: { x: number; y: number; z: number } = {
          x: camera.position.x,
          y: camera.position.y,
          z: camera.position.z,
        };
        const target = {
          x: controls.target.x,
          y: controls.target.z,
        };
        live.current.handlers.setConceptPose(
          conceptPoseFromCamera(eye, target)
        );
      });
      teardown.push(() => controls.dispose());

      /* ---------------- floor ---------------- */
      // A large circle in the x/z plane at height 0. Faint and unlit so it
      // reads as a depth cue without occluding anything behind it.
      const floorGeo = new THREE.CircleGeometry(9000, 64);
      const floorMat = new THREE.MeshBasicMaterial({
        color: palette.floor,
        transparent: true,
        opacity: 0.06,
        side: THREE.DoubleSide,
      });
      const floor = new THREE.Mesh(floorGeo, floorMat);
      floor.rotation.x = -Math.PI / 2;
      scene.add(floor);

      /* ---------------- edges ---------------- */
      // One `LineSegments` for every edge. Heading edges follow the
      // extrusion so a document's outline reads as a stack; wikilink and
      // `@` edges stay on the floor where the flat map draws them, so the
      // two do not fight for the same pixels.
      const edgeGeo = new THREE.BufferGeometry();
      // Two vertices per edge. Sized once from the edge count; a later graph
      // rebuild with more edges reallocates via `setDrawRange`.
      let edgeCapacity = Math.max(1, live.current.edges.length);
      let edgePos = new Float32Array(edgeCapacity * 6);
      edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgePos, 3));
      const edgeMat = new THREE.LineBasicMaterial({
        color: palette.edge,
        transparent: true,
        opacity: 0.7,
      });
      const edgeLines = new THREE.LineSegments(edgeGeo, edgeMat);
      scene.add(edgeLines);

      /* ---------------- nodes ---------------- */
      // One mesh per node. At ~150 nodes per workspace the per-mesh cost is
      // negligible next to the label layer, and per-mesh materials are what
      // let hover dimming be a single property write.
      const sphereGeo = new THREE.SphereGeometry(
        1,
        SPHERE_SEGMENTS,
        SPHERE_SEGMENTS
      );
      const nodeMeshes = new Map<
        string,
        { mesh: THREE_TYPES.Mesh; radius: number }
      >();

      /* ---------------- labels ---------------- */
      // A plain absolutely-positioned div per node. The *anchor* is a
      // world-space point on the node's story (layout label offset at
      // slot.y), projected each frame. Glyphs still face the camera —
      // that is how HTML overlays work — but they no longer sit on one
      // 2D pixel plane independent of heading height.
      const labelHost = labelLayerRef.current;
      const labelEls = new Map<string, HTMLDivElement>();

      /* ---------------- sync ---------------- */
      const syncScene = () => {
        const s = live.current;

        const vw = Math.max(1, s.viewport.w);
        const vh = Math.max(1, s.viewport.h);
        if (renderer.domElement.width !== Math.floor(vw * renderer.getPixelRatio()) ||
            renderer.domElement.height !== Math.floor(vh * renderer.getPixelRatio())) {
          renderer.setSize(vw, vh, false);
        }
        camera.aspect = vw / vh;
        camera.updateProjectionMatrix();

        const eye = conceptCameraPosition(s.pose);
        camera.position.set(eye.x, eye.y, eye.z);
        // Look at the layout point on the floor, nudged up to the middle of
        // the extrusion so a tall document is not framed off-centre.
        camera.lookAt(s.pose.target.x, s.pose.target.y, 0);

        // Nodes: add / remove / reposition.
        const wanted = new Set(s.nodes.map((n) => n.id));
        for (const [id, entry] of nodeMeshes) {
          if (wanted.has(id)) continue;
          scene.remove(entry.mesh);
          (entry.mesh.material as THREE.Material).dispose();
          nodeMeshes.delete(id);
        }
        for (const n of s.nodes) {
          let entry = nodeMeshes.get(n.id);
          if (!entry) {
            const mat = new THREE.MeshStandardMaterial({
              color: palette.heading,
              roughness: 0.5,
              metalness: 0.08,
              transparent: true,
              opacity: 1,
            });
            const mesh = new THREE.Mesh(sphereGeo, mat);
            mesh.userData.id = n.id;
            nodeMeshes.set(n.id, { mesh, radius: sphereRadius(n) });
            scene.add(mesh);
            entry = nodeMeshes.get(n.id) as { mesh: THREE_TYPES.Mesh; radius: number };
          }
          // Slots: documents at y=0 (the floor), headings rising by
          // tree depth, terms dropping to the underground ring. The slot
          // is computed once per data change (`heights`), not per frame.
          const slot: ConceptSlot = s.heights.get(n.id) ?? { y: 0, term: false };
          const world = layoutToWorld(n.x, n.y, slot.y);
          entry.mesh.position.set(world.x, world.y, world.z);
          entry.radius = sphereRadius(n);

          const isCurrent =
            n.kind === 'document' && n.documentId === s.currentDocumentId;
          const mat = entry.mesh.material as THREE.MeshStandardMaterial;
          mat.color.setHex(nodeColor(n.kind, palette, isCurrent));
          // Neighbour dimming: identical semantics to the SVG's `hot` set.
          const lit = !s.hotIds || s.hotIds.has(n.id);
          mat.opacity = lit ? 1 : 0.22;
          entry.mesh.scale.setScalar(
            entry.radius * (n.id === s.hoverId ? HOVER_SCALE : 1)
          );
        }

        // Edges.
        const byId = new Map(s.nodes.map((n) => [n.id, n]));
        if (s.edges.length > edgeCapacity) {
          edgeCapacity = s.edges.length;
          edgePos = new Float32Array(edgeCapacity * 6);
          edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgePos, 3));
        }
        let i = 0;
        for (const e of s.edges) {
          const a = byId.get(e.source);
          const b = byId.get(e.target);
          if (!a || !b) continue;
          // Every edge rides its endpoint's *slot*, not the floor.
          // Heading edges climb between tiers; wikilink and `@` chords
          // stay where their endpoints sit — so a heading-to-term chord
          // reads vertically rather than collapsing onto the floor.
          const slotA: ConceptSlot = s.heights.get(a.id) ?? { y: 0, term: false };
          const slotB: ConceptSlot = s.heights.get(b.id) ?? { y: 0, term: false };
          const wa = layoutToWorld(a.x, a.y, slotA.y);
          const wb = layoutToWorld(b.x, b.y, slotB.y);
          edgePos[i++] = wa.x;
          edgePos[i++] = wa.y;
          edgePos[i++] = wa.z;
          edgePos[i++] = wb.x;
          edgePos[i++] = wb.y;
          edgePos[i++] = wb.z;
        }
        const attr = edgeGeo.getAttribute('position') as THREE.BufferAttribute;
        attr.needsUpdate = true;
        // Only draw the vertices actually written this pass.
        edgeGeo.setDrawRange(0, i / 3);

        // Labels: project a world-space point on the node's own story.
        // Using layout labelDx/Dy at slot.y (not a screen-pixel nudge)
        // keeps wording on the 3D floor of that sphere, so a helix of
        // sibling stories does not collapse back into one 2D overlay.
        if (labelHost) {
          // Clamp to the *same* range the SVG path uses. This scene is
          // lazy-loaded, so it cannot read the SVG's constants at render
          // time without a static import cycle — the literals are the
          // duplication, and `label: the 3D layer honours the SVG label
          // range` is what keeps them honest.
          const fontPx = Math.max(6, Math.min(48, s.labelPx));
          const maxChars = Math.max(10, Math.min(22, Math.round((18 * 16) / s.labelPx)));
          for (const n of s.nodes) {
            const el = labelEls.get(n.id);
            const entry = nodeMeshes.get(n.id);
            if (!el || !entry) continue;
            const slot: ConceptSlot = s.heights.get(n.id) ?? { y: 0, term: false };
            const labelWorld = layoutToWorld(
              n.x + n.labelDx,
              n.y + n.labelDy,
              slot.y
            );
            const p = new THREE.Vector3(
              labelWorld.x,
              labelWorld.y,
              labelWorld.z
            ).project(camera);
            const lit = !s.hotIds || s.hotIds.has(n.id);
            // `p.z > 1` is the standard behind-the-camera test after project.
            if (p.z > 1) {
              el.style.opacity = '0';
              continue;
            }
            if (!el.isConnected) labelHost.appendChild(el);
            const sx = (p.x * 0.5 + 0.5) * vw;
            const sy = (-p.y * 0.5 + 0.5) * vh;
            el.textContent = wrapLines(n.label, maxChars).join('\n');
            el.style.fontSize = `${fontPx}px`;
            el.style.color = palette.label;
            el.style.opacity = lit ? '1' : '0.25';
            el.style.left = `${sx}px`;
            el.style.top = `${sy}px`;
          }
          // Drop labels for nodes that no longer exist.
          const liveIds = new Set(s.nodes.map((n) => n.id));
          for (const [id, el] of labelEls) {
            if (liveIds.has(id)) continue;
            el.remove();
            labelEls.delete(id);
          }
          // Add labels for nodes that appeared.
          for (const n of s.nodes) {
            if (labelEls.has(n.id)) continue;
            const el = document.createElement('div');
            el.dataset.graphNodeLabel = n.id;
            el.style.position = 'absolute';
            el.style.whiteSpace = 'pre';
            el.style.lineHeight = '1.2';
            el.style.fontWeight = '500';
            el.style.pointerEvents = 'none';
            el.style.userSelect = 'none';
            el.style.transform = 'translate(-50%, -50%)';
            labelHost.appendChild(el);
            labelEls.set(n.id, el);
          }
        }
      };

      /* ---------------- picking ---------------- */
      const raycaster = new THREE.Raycaster();
      const ndc = new THREE.Vector2();
      const rayOrigin = new THREE.Vector3();
      const rayDir = new THREE.Vector3();
      let pending = false;

      const pick = (clientX: number, clientY: number): string | null => {
        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return null;
        ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(ndc, camera);

        const meshes: THREE.Mesh[] = [];
        for (const entry of nodeMeshes.values()) meshes.push(entry.mesh);
        const hit = raycaster.intersectObjects(meshes, false)[0];

        // Floor intersection, in layout space, for node dragging.
        rayOrigin.copy(raycaster.ray.origin);
        rayDir.copy(raycaster.ray.direction);
        if (Math.abs(rayDir.y) > 1e-9) {
          const t = -rayOrigin.y / rayDir.y;
          live.current.onFloorPoint({
            x: rayOrigin.x + t * rayDir.x,
            y: rayOrigin.z + t * rayDir.z,
          });
        } else {
          live.current.onFloorPoint(null);
        }

        const id = hit ? ((hit.object.userData.id as string | undefined) ?? null) : null;
        canvas.style.cursor = id ? 'pointer' : '';
        if (id !== live.current.hoverId) live.current.onHoverChange(id);
        return id;
      };

      /**
       * The 3D pointerflow has a subtle bug: the canvas has no native
       * `click` event because we `setPointerCapture`-equivalent on `svg`,
       * not on `canvas`. We rely on `pointerdown` → `pointerup` instead.
       * But `pick()` runs at both events, and a one-pixel mouse jitter
       * between them is enough for the raycast to miss a node it just
       * hit — the user's intent (click on the node they pressed) is then
       * silently dropped because `pointerup`'s pick returns `null`.
       *
       * Capture the node id the user actually pressed on, and only fire
       * `onNodeClick` if the pointerup matches that id OR if the original
       * id is still set (i.e. it was a node-pickdown), gated by a small
       * click-vs-drag threshold. Mirrors how the SVG path uses
       * `setPointerCapture` to keep the click attached to the original
       * element.
       */
      const CLICK_DRAG_THRESHOLD_PX = 5;
      let downPickId: string | null = null;
      let downClientX = 0;
      let downClientY = 0;

      // The caller's drag model needs the *current* hover before it decides
      // between orbiting and moving a node, so picking happens first on
      // every event the caller sees. `pointermove` is coalesced to one pick
      // per frame — it fires far faster than the scene can usefully
      // re-project — but `down` / `up` pick synchronously so a click is
      // never a frame stale.
      const onPointerDown = (e: PointerEvent) => {
        const id = pick(e.clientX, e.clientY);
        // Capture which node (if any) the user pressed on so a click can
        // be resolved from `pointerup` even if `pick()` then misses.
        downPickId = id;
        downClientX = e.clientX;
        downClientY = e.clientY;
        // A node pick takes the camera out of the user's hands for the
        // duration of the drag — orbit / pan / dolly would compete for
        // the same pointer delta. Re-enabled on `pointerup`.
        controls.enabled = id === null;
        live.current.handlers.onPointerDown(
          e as unknown as ReactPointerEvent<HTMLDivElement>
        );
      };

      const onPointerMove = (e: PointerEvent) => {
        if (!pending) {
          pending = true;
          raf = requestAnimationFrame(() => {
            pending = false;
            pick(e.clientX, e.clientY);
          });
        }
        live.current.handlers.onPointerMove(
          e as unknown as ReactPointerEvent<HTMLDivElement>
        );
      };

      const onPointerUp = (e: PointerEvent) => {
        // Click, not drag: a node that was picked at pointer-down and is
        // still under the pointer when the button comes up. The caller's
        // drag threshold decides the rest, so a node drag never fires a
        // click and an orbit never fires one either.
        const id = pick(e.clientX, e.clientY);
        // Resolve the click from whichever node we captured, gating on
        // travel distance to distinguish a click from a drag. If the
        // pointerup pick matches the pointerdown pick, that's the cleanest
        // case. If pointerdown picked a node and the pointerup pick is
        // null (raycast jitter), still treat the press as a click on the
        // captured node. If pointerdown pick is null, only fire a click
        // when pointerup also picks a node.
        const travel = Math.hypot(e.clientX - downClientX, e.clientY - downClientY);
        const drag = travel >= CLICK_DRAG_THRESHOLD_PX;
        const clickedId =
          (downPickId && !drag) ? downPickId
            : (!drag && id) ? id
            : null;
        if (clickedId) {
          const node = live.current.nodes.find((n) => n.id === clickedId);
          if (node) live.current.onNodeClick(node);
        }
        downPickId = null;
        // Hand the camera back regardless of whether the up produced a
        // click — the previous down() either disabled or left it enabled.
        controls.enabled = true;
        live.current.handlers.onPointerUp(
          e as unknown as ReactPointerEvent<HTMLDivElement>
        );
      };

      const onPointerCancel = (e: PointerEvent) => {
        live.current.handlers.onPointerCancel(
          e as unknown as ReactPointerEvent<HTMLDivElement>
        );
      };

      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup', onPointerUp);
      canvas.addEventListener('pointercancel', onPointerCancel);
      teardown.push(() => {
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerCancel);
      });

      // Theme flips change every colour in the scene; re-read rather than
      // making the user remount the view.
      const themeObserver = new MutationObserver(() => {
        palette = readConceptPalette();
        edgeMat.color.setHex(palette.edge);
        floorMat.color.setHex(palette.floor);
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
      });
      teardown.push(() => themeObserver.disconnect());

      /* ---------------- loop ---------------- */
      const frame = () => {
        syncScene();
        // OrbitControls' damping resolves any in-flight input deltas; the
        // resulting (eye, target) trickles back through the `'change'`
        // listener into `live.current.handlers.setConceptPose`. We then
        // re-apply the canonical pose in `syncScene` so three.js never
        // diverges from our state.
        if (controls.enabled) controls.update();
        renderer.render(scene, camera);
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);

      teardown.push(() => {
        renderer.dispose();
        edgeGeo.dispose();
        edgeMat.dispose();
        floorGeo.dispose();
        floorMat.dispose();
        sphereGeo.dispose();
        for (const entry of nodeMeshes.values()) {
          (entry.mesh.material as THREE.Material).dispose();
        }
        nodeMeshes.clear();
        for (const el of labelEls.values()) el.remove();
        labelEls.clear();
      });
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      for (const fn of teardown) fn();
    };
    // `heights` is read through `live`, so the effect does not need to
    // re-run when the data changes — the render loop picks it up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="absolute inset-0" data-concept-scene>
      <canvas
        ref={canvasRef}
        className="block w-full h-full touch-none"
        role="img"
        aria-label="Workspace knowledge graph, 3D Concept projection"
      />
      <div
        ref={labelLayerRef}
        className="absolute inset-0 overflow-hidden pointer-events-none"
        data-concept-labels
      />
    </div>
  );
}
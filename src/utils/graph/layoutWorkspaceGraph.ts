// Atomic radial layout: the open document is the nucleus, headings
// sit on concentric shells in non-overlapping angular sectors, and
// wikilink / @ / other-doc satellites park on the same ray as their
// source so the initial view stays as radial as a Bohr atom.

import type { GraphEdge, GraphNode } from '@/utils/graph/buildWorkspaceGraph';

export interface LaidOutNode extends GraphNode {
  x: number;
  y: number;
  r: number;
  /** Label offset from the node center (away from the cluster hub). */
  labelDx: number;
  labelDy: number;
  labelAnchor: 'start' | 'middle' | 'end';
}

const CX = 0;
const CY = 0;
const MIN_NODE_GAP = 20;
/** Gap between the nucleus extent and a *linked* satellite cluster. */
const CLUSTER_GAP = 340;
/**
 * Unlinked satellites (e.g. Ideas with no [[wikilink]] into Welcome) used
 * to sit a full CLUSTER_GAP away, ballooning the viewBox so the nucleus
 * ring shrank on screen and labels stacked. Park orphans just outside
 * the nucleus ring edge instead.
 */
const ORPHAN_CLUSTER_GAP = 120;
const RELAX_ITERS = 80;
/** Chord length between sibling heading centers — sized for wrapped labels. */
const CHILD_SEP = 420;
/** Approx half-width/height of a wrapped GraphView label (world units). */
const LABEL_HALO = 180;
/** Unary page title (Welcome's H1) sits just outside the nucleus. */
const NUCLEUS_RING = 120;
const SHELL_GAP = 380;
/** Gap between the outer heading shell and the [[term]] ring after relax. */
const TERM_RING_GAP = 160;

export function nodeRadius(kind: GraphNode['kind'], isHub: boolean): number {
  if (kind === 'document') return 36;
  if (kind === 'heading') return isHub ? 26 : 20;
  return 16;
}

function headingChildren(id: string, edges: GraphEdge[]): string[] {
  return edges
    .filter((e) => e.kind === 'heading' && e.source === id)
    .map((e) => e.target);
}

function ringRadius(count: number, minSep: number, floor: number): number {
  if (count <= 1) return floor;
  return Math.max(floor, (count * minSep) / (2 * Math.PI));
}

function subtreeWidth(id: string, edges: GraphEdge[]): number {
  const kids = headingChildren(id, edges);
  if (kids.length === 0) return 1;
  return kids.reduce((sum, k) => sum + subtreeWidth(k, edges), 0);
}

function circularMean(angles: number[]): number {
  if (angles.length === 0) return 0;
  let x = 0;
  let y = 0;
  for (const a of angles) {
    x += Math.cos(a);
    y += Math.sin(a);
  }
  if (Math.hypot(x, y) < 1e-6) return angles[0];
  return Math.atan2(y, x);
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
  return (by - ay) * (cx - bx) - (bx - ax) * (cy - by);
}

/** True when AB and CD cross in their interiors (shared endpoints do not count). */
export function segmentsCrossProper(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number
): boolean {
  const o1 = orient(ax, ay, bx, by, cx, cy);
  const o2 = orient(ax, ay, bx, by, dx, dy);
  const o3 = orient(cx, cy, dx, dy, ax, ay);
  const o4 = orient(cx, cy, dx, dy, bx, by);
  if (o1 === 0 && o2 === 0 && o3 === 0 && o4 === 0) return false;
  const proper =
    Math.sign(o1) !== Math.sign(o2) &&
    Math.sign(o3) !== Math.sign(o4) &&
    o1 !== 0 &&
    o2 !== 0 &&
    o3 !== 0 &&
    o4 !== 0;
  if (proper) return true;
  return false;
}

export function countProperEdgeCrossings(
  nodes: { id: string; x: number; y: number }[],
  edges: { source: string; target: string }[]
): number {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const segs = edges
    .map((e) => {
      const a = byId.get(e.source);
      const b = byId.get(e.target);
      if (!a || !b) return null;
      return { id: `${e.source}->${e.target}`, a, b };
    })
    .filter((s): s is { id: string; a: { id: string; x: number; y: number }; b: { id: string; x: number; y: number } } =>
      s != null
    );
  let n = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const A = segs[i];
      const B = segs[j];
      const ids = new Set([A.a.id, A.b.id, B.a.id, B.b.id]);
      if (ids.size < 4) continue;
      if (
        segmentsCrossProper(A.a.x, A.a.y, A.b.x, A.b.y, B.a.x, B.a.y, B.b.x, B.b.y)
      ) {
        n += 1;
      }
    }
  }
  return n;
}

function assignAngles(
  id: string,
  a0: number,
  a1: number,
  edges: GraphEdge[],
  angle: Map<string, number>
) {
  const kids = headingChildren(id, edges);
  angle.set(id, (a0 + a1) / 2);
  if (kids.length === 0) return;
  const weights = kids.map((k) => subtreeWidth(k, edges));
  const total = weights.reduce((s, w) => s + w, 0);
  let acc = a0;
  kids.forEach((kid, i) => {
    const span = (weights[i] / total) * (a1 - a0);
    assignAngles(kid, acc, acc + span, edges, angle);
    acc += span;
  });
}

/**
 * Depth from the document. A single title heading under the document
 * stays on the nucleus ring so its children can occupy the first
 * full electron shell (Welcome's H1 + ten ##).
 */
function assignShells(
  docId: string,
  edges: GraphEdge[],
  shell: Map<string, number>
) {
  const top = headingChildren(docId, edges);
  const collapse =
    top.length === 1 && headingChildren(top[0], edges).length > 0;
  const walk = (id: string, depth: number) => {
    shell.set(id, depth);
    for (const kid of headingChildren(id, edges)) {
      walk(kid, depth + 1);
    }
  };
  if (collapse) {
    shell.set(top[0], 0);
    for (const kid of headingChildren(top[0], edges)) walk(kid, 1);
  } else {
    for (const id of top) walk(id, 1);
  }
}

function shellRadii(shell: Map<string, number>, minSep: number): number[] {
  const counts = new Map<number, number>();
  for (const d of shell.values()) {
    const k = Math.round(d);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const maxD = counts.size ? Math.max(...counts.keys()) : 0;
  const radii = [0];
  radii[0] = NUCLEUS_RING;
  for (let d = 1; d <= Math.max(maxD, 1); d++) {
    const n = counts.get(d) ?? 1;
    const need = ringRadius(n, minSep, SHELL_GAP);
    radii[d] = (radii[d - 1] ?? NUCLEUS_RING) + need;
  }
  return radii;
}

function seedAtom(
  docId: string,
  origin: { x: number; y: number },
  edges: GraphEdge[],
  nodeIds: Set<string>,
  pos: Map<string, { x: number; y: number }>,
  minSep: number,
  startAngle = -Math.PI / 2
) {
  pos.set(docId, { x: origin.x, y: origin.y });
  const top = headingChildren(docId, edges).filter((id) => nodeIds.has(id));
  if (top.length === 0) return;
  const angle = new Map<string, number>();
  assignAngles(docId, startAngle, startAngle + Math.PI * 2, edges, angle);
  const shell = new Map<string, number>();
  assignShells(docId, edges, shell);
  const radii = shellRadii(shell, minSep);
  for (const [id, d] of shell) {
    if (!nodeIds.has(id) || pos.has(id)) continue;
    const a = angle.get(id) ?? startAngle;
    const R = radii[Math.round(d)] ?? NUCLEUS_RING + SHELL_GAP * Math.max(d, 1);
    pos.set(id, {
      x: origin.x + Math.cos(a) * R,
      y: origin.y + Math.sin(a) * R,
    });
  }
}

function clusterExtent(
  origin: { x: number; y: number },
  memberIds: string[],
  pos: Map<string, { x: number; y: number }>
): number {
  let max = 40;
  for (const id of memberIds) {
    const p = pos.get(id);
    if (!p) continue;
    const d = Math.hypot(p.x - origin.x, p.y - origin.y);
    if (d > max) max = d;
  }
  return max + LABEL_HALO + 24;
}

function rayOf(
  origin: { x: number; y: number },
  p: { x: number; y: number }
): number {
  return Math.atan2(p.y - origin.y, p.x - origin.x);
}

function placeOnRay(
  origin: { x: number; y: number },
  angle: number,
  radius: number
): { x: number; y: number } {
  return {
    x: origin.x + Math.cos(angle) * radius,
    y: origin.y + Math.sin(angle) * radius,
  };
}

function neighborAngles(
  id: string,
  edges: GraphEdge[],
  pos: Map<string, { x: number; y: number }>,
  origin: { x: number; y: number }
): number[] {
  const out: number[] = [];
  for (const e of edges) {
    const other =
      e.source === id ? e.target : e.target === id ? e.source : null;
    if (!other) continue;
    const p = pos.get(other);
    if (!p) continue;
    out.push(rayOf(origin, p));
  }
  return out;
}

function separateAlongRays(
  ids: string[],
  pos: Map<string, { x: number; y: number }>,
  origin: { x: number; y: number },
  occupyOf: (id: string) => number,
  pinned: Set<string>
) {
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i];
      const b = ids[j];
      const pa = pos.get(a);
      const pb = pos.get(b);
      if (!pa || !pb) continue;
      let dx = pb.x - pa.x;
      let dy = pb.y - pa.y;
      let dist = Math.hypot(dx, dy);
      const minD = occupyOf(a) + occupyOf(b) + MIN_NODE_GAP;
      if (dist >= minD) continue;
      if (dist < 0.001) {
        dx = 0.7;
        dy = 0.4;
        dist = Math.hypot(dx, dy);
      }
      const da = Math.hypot(pa.x - origin.x, pa.y - origin.y);
      const db = Math.hypot(pb.x - origin.x, pb.y - origin.y);
      const push = minD - dist + 8;
      const moveOut = (id: string, p: { x: number; y: number }, d: number) => {
        if (pinned.has(id)) return;
        const ang = d < 0.001 ? 0 : Math.atan2(p.y - origin.y, p.x - origin.x);
        const next = d + push;
        p.x = origin.x + Math.cos(ang) * next;
        p.y = origin.y + Math.sin(ang) * next;
      };
      if (da <= db) moveOut(b, pb, db);
      else moveOut(a, pa, da);
    }
  }
}

function labelPlacement(
  x: number,
  y: number,
  r: number,
  hub: { x: number; y: number }
): Pick<LaidOutNode, 'labelDx' | 'labelDy' | 'labelAnchor'> {
  const dx = x - hub.x;
  const dy = y - hub.y;
  const dist = Math.hypot(dx, dy);
  const ux = dist < 0.001 ? 0 : dx / dist;
  const uy = dist < 0.001 ? 1 : dy / dist;
  const reach = r + 22;
  let anchor: LaidOutNode['labelAnchor'] = 'middle';
  if (ux > 0.35) anchor = 'start';
  else if (ux < -0.35) anchor = 'end';
  return {
    labelDx: ux * reach,
    labelDy: uy * reach + (anchor === 'middle' ? r + 6 : 3),
    labelAnchor: anchor,
  };
}

/**
 * Place the open document as a nucleus with concentric heading shells.
 * Satellites (terms, other documents) sit on the same rays as their
 * links so the initial drawing stays atomic.
 */
export function layoutWorkspaceGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  currentDocumentId: string | null
): LaidOutNode[] {
  const docs = nodes.filter((n) => n.kind === 'document');
  const current =
    docs.find((n) => n.documentId === currentDocumentId) ?? docs[0] ?? null;
  const others = docs.filter((n) => n.id !== current?.id);
  const pos = new Map<string, { x: number; y: number }>();
  const nodeIds = new Set(nodes.map((n) => n.id));
  const origin = { x: CX, y: CY };

  if (current) {
    seedAtom(current.id, origin, edges, nodeIds, pos, CHILD_SEP);
  }

  const membersOf = (docId: string) =>
    nodes
      .filter((n) => n.documentId === docId || n.id === `doc:${docId}`)
      .map((n) => n.id);

  const currentExtent = current
    ? clusterExtent(origin, membersOf(current.documentId ?? ''), pos)
    : 160;

  const terms = nodes.filter((n) => n.kind === 'term');
  const termR = currentExtent + 90;
  const usedTermAngles: number[] = [];
  for (const t of terms) {
    const raw = neighborAngles(t.id, edges, pos, origin);
    let a = raw.length ? circularMean(raw) : Math.PI / 6;
    for (const used of usedTermAngles) {
      if (Math.abs(Math.atan2(Math.sin(a - used), Math.cos(a - used))) < 0.18) {
        a += 0.22;
      }
    }
    usedTermAngles.push(a);
    pos.set(t.id, placeOnRay(origin, a, termR));
  }

  const placedAngles = (): number[] => {
    const out: number[] = [];
    for (const [id, p] of pos) {
      if (current && id === current.id) continue;
      out.push(rayOf(origin, p));
    }
    return out;
  };

  const largestGapAngle = (taken: number[]): number => {
    if (taken.length === 0) return 0;
    const sorted = [...taken].sort((a, b) => a - b);
    let bestSpan = -1;
    let bestMid = sorted[0] + Math.PI;
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      const b = sorted[(i + 1) % sorted.length] + (i + 1 === sorted.length ? Math.PI * 2 : 0);
      const span = b - a;
      if (span > bestSpan) {
        bestSpan = span;
        bestMid = a + span / 2;
      }
    }
    return Math.atan2(Math.sin(bestMid), Math.cos(bestMid));
  };

  others.forEach((doc) => {
    const memberSet = new Set(membersOf(doc.documentId ?? ''));
    const incoming: number[] = [];
    for (const e of edges) {
      if (e.kind === 'heading') continue;
      const aIn = memberSet.has(e.source);
      const bIn = memberSet.has(e.target);
      if (aIn === bIn) continue;
      const otherId = aIn ? e.target : e.source;
      const p = pos.get(otherId);
      if (p) incoming.push(rayOf(origin, p));
    }
    const scratch = { x: 0, y: 0 };
    const local = new Map<string, { x: number; y: number }>();
    const linked = incoming.length > 0;
    seedAtom(
      doc.id,
      scratch,
      edges,
      nodeIds,
      local,
      linked ? Math.max(160, CHILD_SEP * 0.85) : 100
    );
    if (!linked) {
      // Lone title pages otherwise inherit a full SHELL_GAP radius and
      // park so far out that the nucleus ring shrinks on screen.
      let maxD = 1;
      for (const [id, p] of local) {
        if (id === doc.id) continue;
        maxD = Math.max(maxD, Math.hypot(p.x, p.y));
      }
      const target = 160;
      if (maxD > target) {
        const s = target / maxD;
        for (const [id, p] of local) {
          if (id === doc.id) continue;
          p.x *= s;
          p.y *= s;
        }
      }
    }
    const extent = clusterExtent(scratch, [...local.keys()], local);
    const θ = linked
      ? circularMean(incoming)
      : largestGapAngle(placedAngles());
    let dist: number;
    if (linked) {
      dist = currentExtent + extent + CLUSTER_GAP;
    } else {
      // Hub sits just past the farthest nucleus member so orphans stay
      // inside the fitted view instead of dominating it.
      let ringEdge = NUCLEUS_RING;
      if (current) {
        for (const id of membersOf(current.documentId ?? '')) {
          const p = pos.get(id);
          if (!p) continue;
          ringEdge = Math.max(
            ringEdge,
            Math.hypot(p.x - origin.x, p.y - origin.y)
          );
        }
      }
      dist = ringEdge + ORPHAN_CLUSTER_GAP;
    }
    const hub = placeOnRay(origin, θ, dist);
    for (const [id, p] of local) {
      if (id === doc.id) {
        pos.set(id, { x: hub.x, y: hub.y });
        continue;
      }
      if (!linked) {
        // Keep orphan children outside the hub (same ray). A default
        // seedAtom angle can park them inward onto the nucleus ring,
        // and relaxation then shoves nearby headings outward.
        const radial = Math.hypot(p.x, p.y);
        pos.set(id, placeOnRay(origin, θ, dist + Math.max(radial, 160)));
      } else {
        pos.set(id, { x: hub.x + p.x, y: hub.y + p.y });
      }
    }
  });

  // Slide each satellite atom around the nucleus toward the circular
  // mean of its non-heading neighbors so leftover wikilink chords
  // stay on one side of the ring.
  for (let pass = 0; pass < 6; pass++) {
    for (const doc of others) {
      const members = membersOf(doc.documentId ?? '');
      const memberSet = new Set(members);
      const incoming: number[] = [];
      for (const e of edges) {
        if (e.kind === 'heading') continue;
        const aIn = memberSet.has(e.source);
        const bIn = memberSet.has(e.target);
        if (aIn === bIn) continue;
        const otherId = aIn ? e.target : e.source;
        const p = pos.get(otherId);
        if (p) incoming.push(rayOf(origin, p));
      }
      if (incoming.length === 0) continue;
      const hub = pos.get(doc.id);
      if (!hub) continue;
      const dist = Math.max(
        currentExtent + 200,
        Math.hypot(hub.x - origin.x, hub.y - origin.y)
      );
      const next = placeOnRay(origin, circularMean(incoming), dist);
      const dx = next.x - hub.x;
      const dy = next.y - hub.y;
      if (Math.hypot(dx, dy) < 1) continue;
      for (const id of members) {
        const p = pos.get(id);
        if (!p) continue;
        p.x += dx;
        p.y += dy;
      }
    }
  }

  for (const n of nodes) {
    if (!pos.has(n.id)) pos.set(n.id, { x: CX + 40, y: CY + 40 });
  }

  const childCount = new Map<string, number>();
  for (const e of edges) {
    if (e.kind !== 'heading') continue;
    childCount.set(e.source, (childCount.get(e.source) ?? 0) + 1);
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const occupyOf = (id: string) => {
    const n = byId.get(id);
    if (!n) return 10 + LABEL_HALO;
    return nodeRadius(n.kind, (childCount.get(id) ?? 0) > 0) + LABEL_HALO;
  };

  // Pin the nucleus and every satellite-document member. Global
  // ray-separation is relative to the Welcome origin; without this,
  // Ideas' own hub+heading (same ray, ~88px apart) get shoved thousands
  // of units apart, the viewBox balloons, and the nucleus ring shrinks
  // on screen until labels stack. Satellites already have local spacing
  // from seedAtom.
  const pinned = new Set<string>();
  if (current) pinned.add(current.id);
  for (const doc of others) {
    for (const id of membersOf(doc.documentId ?? '')) pinned.add(id);
  }
  const ids = nodes.map((n) => n.id);
  for (let iter = 0; iter < RELAX_ITERS; iter++) {
    separateAlongRays(ids, pos, origin, occupyOf, pinned);
  }

  // Re-park [[term]] satellites AFTER relaxation, staying on each
  // term's neighbor ray so wikilink chords do not cross the nucleus.
  let headingMaxR = NUCLEUS_RING;
  if (current) {
    for (const id of membersOf(current.documentId ?? '')) {
      const n = byId.get(id);
      if (!n || n.kind === 'term') continue;
      const p = pos.get(id);
      if (!p) continue;
      headingMaxR = Math.max(
        headingMaxR,
        Math.hypot(p.x - origin.x, p.y - origin.y)
      );
    }
  }
  const termFloor = headingMaxR + TERM_RING_GAP;
  const rayBuckets = new Map<string, number>();
  for (const t of terms) {
    const raw = neighborAngles(t.id, edges, pos, origin);
    let a = raw.length ? circularMean(raw) : Math.PI / 6;
    // Tiny nudge only when two terms share nearly the same ray.
    const key = (Math.round(a * 20) / 20).toFixed(2);
    const stack = rayBuckets.get(key) ?? 0;
    rayBuckets.set(key, stack + 1);
    if (stack > 0) a += stack * 0.08;
    pos.set(t.id, placeOnRay(origin, a, termFloor + stack * 48));
  }

  const hubOf = (n: GraphNode) => {
    if (!n.documentId) return origin;
    return pos.get(`doc:${n.documentId}`) ?? origin;
  };

  return nodes.map((n) => {
    const p = pos.get(n.id) ?? origin;
    const r = nodeRadius(n.kind, (childCount.get(n.id) ?? 0) > 0);
    const label = labelPlacement(p.x, p.y, r, hubOf(n));
    return { ...n, x: p.x, y: p.y, r, ...label };
  });
}

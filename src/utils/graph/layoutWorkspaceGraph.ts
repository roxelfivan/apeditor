// Deterministic graph layout: hierarchical seed, then push clusters
// and overlapping nodes apart so wikilink edges and labels stay readable.

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
const MIN_NODE_GAP = 36;
const CLUSTER_GAP = 180;
const RELAX_ITERS = 90;

export function nodeRadius(kind: GraphNode['kind'], isHub: boolean): number {
  if (kind === 'document') return 18;
  if (kind === 'heading') return isHub ? 13 : 10;
  return 8;
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

function placeOnCircle(
  count: number,
  radius: number,
  startAngle = -Math.PI / 2
): { x: number; y: number }[] {
  if (count <= 0) return [];
  if (count === 1) {
    return [{ x: Math.cos(startAngle) * radius, y: Math.sin(startAngle) * radius }];
  }
  return Array.from({ length: count }, (_, i) => {
    const a = startAngle + (i * 2 * Math.PI) / count;
    return { x: Math.cos(a) * radius, y: Math.sin(a) * radius };
  });
}

function layoutChildrenArc(
  parentId: string,
  parentPos: { x: number; y: number },
  parentAngle: number,
  edges: GraphEdge[],
  pos: Map<string, { x: number; y: number }>,
  minSep: number
) {
  const kids = headingChildren(parentId, edges).filter((id) => !pos.has(id));
  if (kids.length === 0) return;
  const sweep = Math.min(Math.PI * 1.35, Math.max(0.7, kids.length * 0.55));
  const radius = Math.max(88, (kids.length * minSep) / Math.max(sweep, 0.4));
  const start = parentAngle - sweep / 2;
  kids.forEach((id, i) => {
    const a =
      kids.length === 1
        ? parentAngle
        : start + (sweep * i) / Math.max(kids.length - 1, 1);
    const p = {
      x: parentPos.x + Math.cos(a) * radius,
      y: parentPos.y + Math.sin(a) * radius,
    };
    pos.set(id, p);
    layoutChildrenArc(id, p, a, edges, pos, minSep);
  });
}

function seedSubtree(
  docId: string,
  origin: { x: number; y: number },
  edges: GraphEdge[],
  nodeIds: Set<string>,
  pos: Map<string, { x: number; y: number }>,
  minSep: number,
  startAngle = -Math.PI / 2
) {
  const top = headingChildren(docId, edges).filter((id) => nodeIds.has(id));
  const radius = ringRadius(top.length, minSep, 130);
  const pts = placeOnCircle(top.length, radius, startAngle);
  top.forEach((id, i) => {
    const p = { x: origin.x + pts[i].x, y: origin.y + pts[i].y };
    pos.set(id, p);
    const angle = Math.atan2(p.y - origin.y, p.x - origin.x);
    layoutChildrenArc(id, p, angle, edges, pos, minSep);
  });
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
  return max + 48;
}

function separatePairs(
  ids: string[],
  pos: Map<string, { x: number; y: number }>,
  radiusOf: (id: string) => number,
  pinned: Set<string>,
  extraGap: number
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
      const minD = radiusOf(a) + radiusOf(b) + MIN_NODE_GAP + extraGap;
      if (dist >= minD) continue;
      if (dist < 0.001) {
        dx = 0.7;
        dy = 0.4;
        dist = Math.hypot(dx, dy);
      }
      const push = (minD - dist) / 2;
      const ux = dx / dist;
      const uy = dy / dist;
      const pinA = pinned.has(a);
      const pinB = pinned.has(b);
      if (!pinA && !pinB) {
        pa.x -= ux * push;
        pa.y -= uy * push;
        pb.x += ux * push;
        pb.y += uy * push;
      } else if (pinA && !pinB) {
        pb.x += ux * push * 2;
        pb.y += uy * push * 2;
      } else if (!pinA && pinB) {
        pa.x -= ux * push * 2;
        pa.y -= uy * push * 2;
      }
    }
  }
}

function relaxLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  pos: Map<string, { x: number; y: number }>,
  pinned: Set<string>,
  radiusOf: (id: string) => number
) {
  const ids = nodes.map((n) => n.id);
  const byDoc = new Map<string, string[]>();
  for (const n of nodes) {
    const key = n.documentId ?? n.id;
    const list = byDoc.get(key) ?? [];
    list.push(n.id);
    byDoc.set(key, list);
  }

  for (let iter = 0; iter < RELAX_ITERS; iter++) {
    for (const members of byDoc.values()) {
      separatePairs(members, pos, radiusOf, pinned, 8);
    }
    separatePairs(ids, pos, radiusOf, pinned, 4);

    for (const e of edges) {
      const pa = pos.get(e.source);
      const pb = pos.get(e.target);
      if (!pa || !pb) continue;
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const dist = Math.hypot(dx, dy) || 0.001;
      const rest = e.kind === 'heading' ? 100 : 220;
      const slack = dist - rest;
      // Only shorten runaway wikilinks / mentions; do not crush heading trees.
      if (e.kind === 'heading') {
        if (Math.abs(slack) < 18) continue;
        const pull = slack * 0.04;
        const ux = dx / dist;
        const uy = dy / dist;
        if (!pinned.has(e.source)) {
          pa.x += ux * pull;
          pa.y += uy * pull;
        }
        if (!pinned.has(e.target)) {
          pb.x -= ux * pull;
          pb.y -= uy * pull;
        }
      } else if (dist < rest * 0.55) {
        const push = (rest * 0.55 - dist) * 0.08;
        const ux = dx / dist;
        const uy = dy / dist;
        if (!pinned.has(e.source)) {
          pa.x -= ux * push;
          pa.y -= uy * push;
        }
        if (!pinned.has(e.target)) {
          pb.x += ux * push;
          pb.y += uy * push;
        }
      }
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
  const reach = r + 16;
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
 * Place nodes so each document is a spaced cluster, children sit on
 * wide arcs, and a short relax pass pushes leftover overlaps apart.
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
  const minSep = 78;

  if (current) pos.set(current.id, { x: CX, y: CY });

  if (current) {
    seedSubtree(current.id, { x: CX, y: CY }, edges, nodeIds, pos, minSep);
  }

  const membersOf = (docId: string) =>
    nodes.filter((n) => n.documentId === docId || n.id === `doc:${docId}`).map((n) => n.id);

  const currentExtent = current
    ? clusterExtent({ x: CX, y: CY }, membersOf(current.documentId ?? ''), pos)
    : 160;

  others.forEach((doc, i) => {
    const startAngle =
      others.length === 1 ? 0 : -Math.PI / 2 + (i * 2 * Math.PI) / others.length;
    // Temporary origin; we'll push it out after measuring the subtree.
    const scratch = { x: 0, y: 0 };
    const local = new Map<string, { x: number; y: number }>();
    local.set(doc.id, scratch);
    seedSubtree(doc.id, scratch, edges, nodeIds, local, Math.max(64, minSep * 0.85));
    const extent = clusterExtent(scratch, [...local.keys()], local);
    const dist = currentExtent + extent + CLUSTER_GAP;
    const origin = {
      x: CX + Math.cos(startAngle) * dist,
      y: CY + Math.sin(startAngle) * dist,
    };
    for (const [id, p] of local) {
      pos.set(id, { x: origin.x + p.x, y: origin.y + p.y });
    }
  });

  const terms = nodes.filter((n) => n.kind === 'term' && !pos.has(n.id));
  const termR = currentExtent + 90;
  const termPts = placeOnCircle(terms.length, termR, Math.PI / 6);
  terms.forEach((n, i) => {
    pos.set(n.id, { x: CX + termPts[i].x, y: CY + termPts[i].y });
  });

  for (const n of nodes) {
    if (!pos.has(n.id)) pos.set(n.id, { x: CX + 40, y: CY + 40 });
  }

  const childCount = new Map<string, number>();
  for (const e of edges) {
    if (e.kind !== 'heading') continue;
    childCount.set(e.source, (childCount.get(e.source) ?? 0) + 1);
  }
  const radiusOf = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    if (!n) return 10;
    return nodeRadius(n.kind, (childCount.get(id) ?? 0) > 0);
  };

  const pinned = new Set<string>();
  if (current) pinned.add(current.id);

  relaxLayout(nodes, edges, pos, pinned, radiusOf);

  const hubOf = (n: GraphNode) => {
    if (!n.documentId) return { x: CX, y: CY };
    return pos.get(`doc:${n.documentId}`) ?? { x: CX, y: CY };
  };

  return nodes.map((n) => {
    const p = pos.get(n.id) ?? { x: CX, y: CY };
    const r = radiusOf(n.id);
    const label = labelPlacement(p.x, p.y, r, hubOf(n));
    return { ...n, x: p.x, y: p.y, r, ...label };
  });
}

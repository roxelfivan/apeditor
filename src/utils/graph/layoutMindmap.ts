// Horizontal mindmap layout: a spanning tree of the workspace graph,
// drawn left-to-right, with leftover edges kept as cross-links.
//
// The tree is the hierarchical "bones" — heading edges first, then
// wikilinks, then `@` mentions — grown from the open document. Loops
// and secondary relationships stay in the graph; they are just not
// used to place nodes. `GraphView` draws those leftovers as dashed,
// low-opacity curves so the primary tree stays clean.
//
// Pure — no React, no store.

import type { GraphEdge, GraphNode } from '@/utils/graph/buildWorkspaceGraph';
import {
  nodeRadius,
  type LaidOutNode,
} from '@/utils/graph/layoutWorkspaceGraph';

/** Floor for the horizontal gap between a parent and its child column. */
export const MINDMAP_LAYER_X = 360;
/** Floor for the vertical gap between successive leaves. */
export const MINDMAP_LEAF_GAP = 280;
/**
 * Titles stay on one line so they use width instead of stacking into the
 * next sibling. Layout width estimates cap at this many characters so a
 * single long heading cannot blow the tree up to a mile.
 */
export const MINDMAP_LABEL_MAX_CHARS = 96;
export const MINDMAP_LABEL_MAX_LINES = 1;
/** Layout-unit width of one title character, used to push children past the parent label. */
export const MINDMAP_CHAR_W = 22;
/** Extra gap between the end of a parent label and the child column. */
export const MINDMAP_CONNECTOR = 120;
const MINDMAP_LABEL_PAD = 24;
/** Many siblings wrap into extra columns so they use pane width, not one tall stack. */
export const MINDMAP_SIBLING_COL_AFTER = 7;

export function mindmapSiblingColumns(count: number): number {
  if (count >= 15) return 3;
  if (count >= MINDMAP_SIBLING_COL_AFTER) return 2;
  return 1;
}

export interface MindmapLayout {
  nodes: LaidOutNode[];
  /** `GraphEdge.id` values that form the spanning tree. Everything else is a cross-link. */
  treeEdgeIds: Set<string>;
}

export interface MindmapSpanningTree {
  parentOf: Map<string, string | null>;
  childrenOf: Map<string, string[]>;
  treeEdgeIds: Set<string>;
  roots: string[];
}

const KIND_RANK: Record<GraphEdge['kind'], number> = {
  heading: 0,
  wikilink: 1,
  '@': 2,
};

function otherEnd(edge: GraphEdge, id: string): string | null {
  if (edge.source === id) return edge.target;
  if (edge.target === id) return edge.source;
  return null;
}

/**
 * Spanning forest of `nodes`, grown from `rootId` (the open document
 * when it is still in the graph).
 *
 * Heading edges are installed first, in document order, so the tree
 * matches the outline. A wikilink into a heading therefore cannot
 * steal that heading from its parent — it stays a dashed cross-link.
 * Leftover nodes attach through the cheapest unused edge onto the
 * *root* of their heading forest (usually another document).
 * Disconnected components become extra roots.
 */
export function spanningTree(
  nodes: GraphNode[],
  edges: GraphEdge[],
  rootId: string | null
): MindmapSpanningTree {
  const ids = nodes.map((n) => n.id);
  const idSet = new Set(ids);
  const parentOf = new Map<string, string | null>();
  const childrenOf = new Map<string, string[]>();
  const treeEdgeIds = new Set<string>();
  const visited = new Set<string>();

  for (const id of ids) {
    childrenOf.set(id, []);
    parentOf.set(id, null);
  }

  for (const e of edges) {
    if (e.kind !== 'heading') continue;
    if (!idSet.has(e.source) || !idSet.has(e.target)) continue;
    if (parentOf.get(e.target) != null) continue;
    parentOf.set(e.target, e.source);
    childrenOf.get(e.source)!.push(e.target);
    treeEdgeIds.add(e.id);
  }

  const headingRootOf = (id: string): string => {
    let cur = id;
    const seen = new Set<string>();
    while (parentOf.get(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = parentOf.get(cur)!;
    }
    return cur;
  };

  const leftoverEdges = edges
    .filter(
      (e) =>
        e.kind !== 'heading' && idSet.has(e.source) && idSet.has(e.target)
    )
    .sort(
      (a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.id.localeCompare(b.id)
    );

  const walkHeading = (id: string, queue: string[]) => {
    if (visited.has(id)) return;
    visited.add(id);
    queue.push(id);
    for (const kid of childrenOf.get(id) ?? []) walkHeading(kid, queue);
  };

  const grow = (start: string) => {
    const queue: string[] = [];
    walkHeading(start, queue);
    while (queue.length > 0) {
      const id = queue.shift()!;
      for (const e of leftoverEdges) {
        const o = otherEnd(e, id);
        if (o == null) continue;
        const attach = headingRootOf(o);
        if (visited.has(attach)) continue;
        parentOf.set(attach, id);
        childrenOf.get(id)!.push(attach);
        treeEdgeIds.add(e.id);
        walkHeading(attach, queue);
      }
    }
  };

  const roots: string[] = [];
  const hub = rootId && idSet.has(rootId) ? rootId : (ids[0] ?? null);
  if (hub) {
    grow(hub);
    roots.push(hub);
  }
  const leftoverNodes = [
    ...nodes.filter((n) => n.kind === 'document' && !visited.has(n.id)),
    ...nodes.filter((n) => n.kind !== 'document' && !visited.has(n.id)),
  ];
  for (const n of leftoverNodes) {
    if (visited.has(n.id)) continue;
    const start = headingRootOf(n.id);
    if (visited.has(start)) continue;
    grow(start);
    roots.push(start);
  }

  return { parentOf, childrenOf, treeEdgeIds, roots };
}

function mindmapLabel(
  r: number
): Pick<LaidOutNode, 'labelDx' | 'labelDy' | 'labelAnchor'> {
  return {
    labelDx: r + MINDMAP_LABEL_PAD,
    labelDy: 8,
    labelAnchor: 'start',
  };
}

export function mindmapLabelWidth(label: string, r: number): number {
  const chars = Math.min(Math.max(label.length, 1), MINDMAP_LABEL_MAX_CHARS);
  return r + MINDMAP_LABEL_PAD + chars * MINDMAP_CHAR_W;
}

export function mindmapLeafStride(_label?: string): number {
  return MINDMAP_LEAF_GAP;
}

/**
 * Place every node on a left-to-right tidy tree: each child column
 * starts after the parent's label, leaves pack on Y by title height,
 * parents sit at the vertical midpoint of their children.
 */
export function layoutMindmap(
  nodes: GraphNode[],
  edges: GraphEdge[],
  currentDocumentId: string | null
): MindmapLayout {
  const docs = nodes.filter((n) => n.kind === 'document');
  const current =
    docs.find((n) => n.documentId === currentDocumentId) ?? docs[0] ?? null;
  const tree = spanningTree(nodes, edges, current?.id ?? null);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const pos = new Map<string, { x: number; y: number }>();
  let nextLeafY = 0;

  const radiusOf = (id: string): number => {
    const n = byId.get(id);
    if (!n) return 16;
    const isHub = current != null && n.id === current.id;
    return nodeRadius(n.kind, isHub);
  };

  const place = (id: string, x: number) => {
    const node = byId.get(id);
    const kids = tree.childrenOf.get(id) ?? [];
    if (kids.length === 0) {
      pos.set(id, { x, y: nextLeafY });
      nextLeafY += mindmapLeafStride(node?.label ?? '');
      return;
    }
    const originX =
      x +
      Math.max(
        MINDMAP_LAYER_X,
        mindmapLabelWidth(node?.label ?? '', radiusOf(id)) + MINDMAP_CONNECTOR
      );
    const cols = mindmapSiblingColumns(kids.length);
    const colW = Math.max(
      MINDMAP_LAYER_X,
      ...kids.map((kid) =>
        mindmapLabelWidth(byId.get(kid)?.label ?? '', radiusOf(kid))
      )
    );
    if (cols === 1) {
      for (const kid of kids) place(kid, originX);
    } else {
      const rows = Math.ceil(kids.length / cols);
      for (let row = 0; row < rows; row++) {
        const yRow = nextLeafY;
        let yMax = yRow;
        for (let col = 0; col < cols; col++) {
          const i = row * cols + col;
          if (i >= kids.length) break;
          nextLeafY = yRow;
          place(kids[i], originX + col * colW);
          yMax = Math.max(yMax, nextLeafY);
        }
        nextLeafY = yMax;
      }
    }
    const ys = kids.map((k) => pos.get(k)!.y);
    pos.set(id, {
      x,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
    });
  };

  for (const root of tree.roots) {
    place(root, 0);
    nextLeafY += MINDMAP_LEAF_GAP * 0.35;
  }

  const pts = [...pos.values()];
  if (pts.length > 0) {
    const minX = Math.min(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    const maxY = Math.max(...pts.map((p) => p.y));
    const midY = (minY + maxY) / 2;
    for (const p of pts) {
      p.x -= minX;
      p.y -= midY;
    }
  }

  const laid: LaidOutNode[] = nodes.map((n) => {
    const p = pos.get(n.id) ?? { x: 0, y: 0 };
    const isHub = current != null && n.id === current.id;
    const r = nodeRadius(n.kind, isHub);
    return { ...n, x: p.x, y: p.y, r, ...mindmapLabel(r) };
  });

  return { nodes: laid, treeEdgeIds: tree.treeEdgeIds };
}

/** Smooth rightward cubic used for spanning-tree bones. */
export function mindmapTreePath(
  ax: number,
  ay: number,
  bx: number,
  by: number
): string {
  const dx = Math.max(48, Math.abs(bx - ax) * 0.55);
  const s = ax <= bx ? 1 : -1;
  return `M ${ax} ${ay} C ${ax + s * dx} ${ay}, ${bx - s * dx} ${by}, ${bx} ${by}`;
}

/**
 * Bowed quadratic for leftover graph edges. Vertical-ish links bow to
 * the right (away from the root), matching the dashed cross-link in a
 * horizontal mindmap.
 */
export function mindmapCrossPath(
  ax: number,
  ay: number,
  bx: number,
  by: number
): string {
  const dx = bx - ax;
  const dy = by - ay;
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  if (Math.abs(dy) >= Math.abs(dx)) {
    const bow = Math.min(140, Math.abs(dy) * 0.35 + 40);
    return `M ${ax} ${ay} Q ${Math.max(ax, bx) + bow} ${my} ${bx} ${by}`;
  }
  const bow = Math.min(100, Math.abs(dx) * 0.2 + 30);
  return `M ${ax} ${ay} Q ${mx} ${my + (dy >= 0 ? bow : -bow)} ${bx} ${by}`;
}

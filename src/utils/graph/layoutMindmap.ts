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
/**
 * Vertical gap between successive leaves, in layout units.
 *
 * Roughly three ems: enough that one title's line never sits on the next
 * sibling's, without spreading a long outline across the pane.
 */
export const MINDMAP_LEAF_GAP = 120;
/**
 * Longest line a title may occupy, counted in *columns*.
 *
 * A column is one Latin glyph; a CJK glyph counts as two, because it is
 * roughly twice as wide on screen. Counting characters instead made every
 * Chinese title half its true width, which is what let a child column land
 * on top of its parent's text.
 */
export const MINDMAP_LABEL_MAX_COLS = 40;
/**
 * Lines a title may wrap into before the rest is dropped behind an ellipsis.
 *
 * A title longer than one line wraps rather than running into the next
 * column, so a long heading costs height instead of width.
 */
export const MINDMAP_LABEL_MAX_LINES = 4;
/**
 * Font scale for a title that has to wrap.
 *
 * A long title is the one label that eats the most room, so it is also the
 * one that shrinks — and only that title. Every other label keeps the size
 * the user asked for, so the map does not read as uniformly small.
 */
export const MINDMAP_LONG_LABEL_SCALE = 0.85;
/**
 * World units for one em when the toolbar label size is the reference
 * (`MINDMAP_REF_LABEL_PX`). Larger/smaller toolbar sizes scale this.
 */
export const MINDMAP_EM_W = 36;
/** Toolbar label size that maps 1:1 onto `MINDMAP_EM_W`. */
export const MINDMAP_REF_LABEL_PX = 16;
/** CSS-px width of a glyph as a fraction of an em (typical sans). */
export const MINDMAP_GLYPH_EM = 0.6;
/** Extra gap between the end of a parent label and the child column. */
export const MINDMAP_CONNECTOR = 160;
/** Gap between a node and the start of its title. */
export const MINDMAP_LABEL_PAD = 24;
/** Line height as a multiple of the font size. */
export const MINDMAP_LINE_HEIGHT = 1.2;
/**
 * Clearance between the bottom of a title and the green connector (y = 0).
 * Keeps the wording from sitting on the line.
 */
export const MINDMAP_LABEL_LINE_CLEAR = 0.2;

/**
 * World font size for the current toolbar label size.
 *
 * `−` / `+` change this; the camera scale stays put, so only the text
 * grows or shrinks relative to the nodes and connectors.
 */
export function mindmapWorldFont(labelPx: number): number {
  const px = Number.isFinite(labelPx)
    ? Math.max(6, labelPx)
    : MINDMAP_REF_LABEL_PX;
  return MINDMAP_EM_W * (px / MINDMAP_REF_LABEL_PX);
}

/** Layout-unit width of one Latin glyph at the given em. */
export function mindmapCharW(em: number): number {
  return em * MINDMAP_GLYPH_EM;
}
/** Reference column width (`mindmapCharW(MINDMAP_EM_W)`). */
export const MINDMAP_CHAR_W = mindmapCharW(MINDMAP_EM_W);

/**
 * Camera scale for the Mindmap (before the zoom multiplier).
 *
 * Fixed against the reference label size so `−` / `+` change text size
 * instead of scaling the whole tree. Zoom still multiplies on top.
 */
export function mindmapScale(_labelPx?: number): number {
  return MINDMAP_REF_LABEL_PX / MINDMAP_EM_W;
}

/** CSS-pixel size of a mindmap SVG that paints `bounds` at `scale`. */
export function mindmapSvgPx(
  bounds: { width: number; height: number },
  scale: number
): { w: number; h: number } {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return {
    w: Math.max(1, bounds.width * s),
    h: Math.max(1, bounds.height * s),
  };
}

/** World point currently under the centre of a scrolled mindmap pane. */
export function mindmapWorldAtScrollCenter(
  bounds: { minX: number; minY: number },
  scale: number,
  scrollLeft: number,
  scrollTop: number,
  viewport: { w: number; h: number }
): { x: number; y: number } {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return {
    x: bounds.minX + (scrollLeft + viewport.w / 2) / s,
    y: bounds.minY + (scrollTop + viewport.h / 2) / s,
  };
}

/** Scroll offsets that put `world` at the pane centre. */
export function mindmapScrollToWorld(
  bounds: { minX: number; minY: number },
  scale: number,
  world: { x: number; y: number },
  viewport: { w: number; h: number }
): { left: number; top: number } {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return {
    left: (world.x - bounds.minX) * s - viewport.w / 2,
    top: (world.y - bounds.minY) * s - viewport.h / 2,
  };
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

/**
 * Width of one glyph in columns. CJK ideographs and full-width forms are
 * about twice as wide as a Latin glyph; everything else is one.
 */
export function mindmapGlyphCols(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  if (code < 0x1100) return 1;
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

/** Width of a string in columns. */
export function mindmapTextCols(text: string): number {
  let cols = 0;
  for (const ch of text) cols += mindmapGlyphCols(ch);
  return cols;
}

/**
 * Break a title into lines that each fit `maxCols` columns.
 *
 * Latin words stay whole where they can, and a word longer than the line
 * is broken by character. CJK text has no spaces, so it breaks anywhere.
 */
export function mindmapWrapLabel(
  label: string,
  maxCols = MINDMAP_LABEL_MAX_COLS
): string[] {
  const text = label.trim();
  if (!text) return [''];
  const limit = Math.max(1, maxCols);
  const lines: string[] = [];
  let cur = '';
  let curCols = 0;
  // A space separates two words but is never left dangling at the end of
  // a line, so it is tracked rather than appended.
  let pendingSpace = false;

  const push = () => {
    if (cur) lines.push(cur);
    cur = '';
    curCols = 0;
    pendingSpace = false;
  };

  // Split into tokens: CJK glyphs stand alone, Latin runs stay together.
  const tokens: string[] = [];
  let run = '';
  for (const ch of text) {
    if (mindmapGlyphCols(ch) === 2) {
      if (run) {
        tokens.push(run);
        run = '';
      }
      tokens.push(ch);
    } else if (/\s/.test(ch)) {
      if (run) {
        tokens.push(run);
        run = '';
      }
      tokens.push(' ');
    } else {
      run += ch;
    }
  }
  if (run) tokens.push(run);

  for (const token of tokens) {
    if (token === ' ') {
      pendingSpace = cur.length > 0;
      continue;
    }
    const cols = mindmapTextCols(token);
    if (cols > limit) {
      // A single token longer than the line: break it by character.
      push();
      let chunk = '';
      let chunkCols = 0;
      for (const ch of token) {
        const w = mindmapGlyphCols(ch);
        if (chunkCols + w > limit && chunk) {
          lines.push(chunk);
          chunk = '';
          chunkCols = 0;
        }
        chunk += ch;
        chunkCols += w;
      }
      cur = chunk;
      curCols = chunkCols;
      continue;
    }
    // A space between two words costs one column of its own.
    const spaceCols = pendingSpace ? 1 : 0;
    if (curCols + spaceCols + cols > limit) {
      push();
      cur = token;
      curCols = cols;
      continue;
    }
    if (pendingSpace) {
      cur += ' ';
      curCols += 1;
      pendingSpace = false;
    }
    cur += token;
    curCols += cols;
  }
  push();

  return lines.length > 0 ? lines : [''];
}

/**
 * How a title is drawn: its lines, the width of its longest line, and the
 * font scale that goes with it.
 *
 * The scale is the one knob that keeps a long title from crowding the
 * column it sits in: a title that has to wrap is drawn slightly smaller
 * than its neighbours, and only that title.
 */
export interface MindmapLabelPlan {
  /** The lines to draw, top to bottom. */
  lines: string[];
  /** Width of the widest line, in columns. */
  cols: number;
  /** Font scale for this title. 1 unless the title had to wrap. */
  scale: number;
  /** Font size in world units. */
  font: number;
  /**
   * Baseline offsets from the node's Y, top to bottom.
   *
   * Titles sit **above** the green connector (the node's Y), so the
   * wording does not run through the line.
   */
  baselines: number[];
  /** Top of the ink box, relative to the node's Y. */
  top: number;
  /** Bottom of the ink box, relative to the node's Y. */
  bottom: number;
}

/** Fraction of the font size above the baseline that ink reaches. */
const MINDMAP_ASCENT = 0.8;
/** Fraction of the font size below the baseline that ink reaches. */
const MINDMAP_DESCENT = 0.25;

export function mindmapLabelPlan(
  label: string,
  em: number = MINDMAP_EM_W
): MindmapLabelPlan {
  const all = mindmapWrapLabel(label);
  const lines = all.slice(0, MINDMAP_LABEL_MAX_LINES);
  if (all.length > MINDMAP_LABEL_MAX_LINES) {
    const last = lines[lines.length - 1] ?? '';
    lines[lines.length - 1] = `${last.slice(0, Math.max(0, last.length - 1))}…`;
  }
  let cols = 0;
  for (const line of lines) cols = Math.max(cols, mindmapTextCols(line));
  const scale = lines.length > 1 ? MINDMAP_LONG_LABEL_SCALE : 1;
  const font = em * scale;
  const gap = font * MINDMAP_LINE_HEIGHT;
  const extra = (lines.length - 1) * gap;
  // Last baseline sits so the ink bottom clears the connector by
  // `MINDMAP_LABEL_LINE_CLEAR` ems. Earlier lines stack above it.
  const last =
    -(font * MINDMAP_LABEL_LINE_CLEAR) - font * MINDMAP_DESCENT;
  const first = last - extra;
  const baselines = lines.map((_, i) => first + i * gap);
  return {
    lines,
    cols,
    scale,
    font,
    baselines,
    top: first - font * MINDMAP_ASCENT,
    bottom: last + font * MINDMAP_DESCENT,
  };
}

/**
 * Layout width of a title, from the node's edge to the end of its longest
 * line.
 *
 * This is what the child column is placed against, so it has to be the
 * width of the *widest* line rather than of the whole string — a wrapped
 * title is only as wide as its longest line.
 */
export function mindmapLabelWidth(
  label: string,
  r: number,
  em: number = MINDMAP_EM_W
): number {
  const plan = mindmapLabelPlan(label, em);
  return r + MINDMAP_LABEL_PAD + plan.cols * mindmapCharW(em) * plan.scale;
}

/**
 * Vertical space a leaf's title needs.
 *
 * Titles sit above the connector, so the stride has to cover the full
 * ink height or a tall title collides with the sibling above.
 */
export function mindmapLeafStride(
  label?: string,
  em: number = MINDMAP_EM_W
): number {
  const plan = mindmapLabelPlan(label ?? '', em);
  return MINDMAP_LEAF_GAP + Math.max(0, plan.bottom - plan.top);
}

/**
 * Tree depth of every node in the spanning forest.
 *
 * Depth is the column a node belongs to. It is derived from `parentOf`
 * rather than from a walk over `childrenOf`, so a node whose parent link
 * is missing still gets a depth instead of being dropped.
 */
export function treeDepths(tree: MindmapSpanningTree): Map<string, number> {
  const depth = new Map<string, number>();
  const resolve = (id: string): number => {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    // Walk up to the root, then write the whole chain back down. The
    // `seen` guard keeps a malformed forest (a cycle in `parentOf`)
    // from looping forever.
    const chain: string[] = [];
    const seen = new Set<string>();
    let cur: string | null = id;
    // Depth of the node *after* the chain — the root when the chain runs
    // to the top, or an already-known ancestor otherwise.
    let offset = 0;
    while (cur != null) {
      const known = depth.get(cur);
      if (known !== undefined) {
        offset = known + 1;
        break;
      }
      if (seen.has(cur)) break;
      seen.add(cur);
      chain.push(cur);
      const parent: string | null = tree.parentOf.get(cur) ?? null;
      if (parent == null) {
        // `cur` is a root, so it sits at depth 0 and the chain above it
        // counts up from there.
        offset = 0;
        break;
      }
      cur = parent;
    }
    for (let i = chain.length - 1; i >= 0; i--) {
      depth.set(chain[i], offset + (chain.length - 1 - i));
    }
    return depth.get(id) ?? 0;
  };
  for (const id of tree.parentOf.keys()) resolve(id);
  return depth;
}

/**
 * Nodes grouped by the column they sit in.
 *
 * The key is the node's X, which is the column's X by construction.
 */
function colGroups(
  pos: Map<string, { x: number; y: number }>,
  depth: Map<string, number>
): Map<number, string[]> {
  const groups = new Map<number, string[]>();
  for (const id of pos.keys()) {
    const d = depth.get(id) ?? 0;
    const list = groups.get(d) ?? [];
    list.push(id);
    groups.set(d, list);
  }
  // The map is keyed by depth but the caller wants to iterate columns in
  // X order; the X of a column is monotonic in depth, so sorting by depth
  // is the same thing.
  return new Map(
    [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => [k, v])
  );
}

/**
 * Place every node on a left-to-right tidy tree: each child column
 * starts after the widest title in the column before it, leaves pack on
 * Y by title height, parents sit at the vertical midpoint of their
 * children.
 *
 * The X of a column is measured from the *widest* title in the previous
 * column, not from one node's title. A sibling with a long title used
 * to run into the next column, because the column was only as wide as
 * the parent that happened to be laid out first.
 */
export function layoutMindmap(
  nodes: GraphNode[],
  edges: GraphEdge[],
  currentDocumentId: string | null,
  labelPx: number = MINDMAP_REF_LABEL_PX
): MindmapLayout {
  const em = mindmapWorldFont(labelPx);
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

  // One column per tree depth. The depth comes from `parentOf` rather
  // than a walk, so a node whose parent is missing still lands in a
  // column instead of dropping out of the layout.
  const depth = treeDepths(tree);

  // How far the widest title in each column reaches. The next column
  // starts after it, plus a buffer, so no title can cross a column.
  const colExtent = new Map<number, number>();
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    const reach = mindmapLabelWidth(n.label, radiusOf(n.id), em);
    colExtent.set(d, Math.max(colExtent.get(d) ?? 0, reach));
  }

  let maxDepth = 0;
  for (const d of depth.values()) maxDepth = Math.max(maxDepth, d);
  for (const d of colExtent.keys()) maxDepth = Math.max(maxDepth, d);

  const colX = new Map<number, number>();
  let cursorX = 0;
  for (let d = 0; d <= maxDepth; d++) {
    colX.set(d, cursorX);
    const reach = colExtent.get(d) ?? 0;
    cursorX += Math.max(MINDMAP_LAYER_X, reach + MINDMAP_CONNECTOR);
  }

  const place = (id: string) => {
    const node = byId.get(id);
    const kids = tree.childrenOf.get(id) ?? [];
    const x = colX.get(depth.get(id) ?? 0) ?? 0;
    if (kids.length === 0) {
      pos.set(id, { x, y: nextLeafY });
      nextLeafY += mindmapLeafStride(node?.label ?? '', em);
      return;
    }
    for (const kid of kids) place(kid);
    const ys = kids.map((k) => pos.get(k)!.y);
    pos.set(id, {
      x,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
    });
  };

  for (const root of tree.roots) {
    place(root);
    nextLeafY += MINDMAP_LEAF_GAP * 0.35;
  }

  // A title's ink has to clear the next title in the same column. Leaves
  // are packed with a stride that already accounts for their own height,
  // but a *parent* sits at the midpoint of its children, so a parent with
  // a tall title can still reach the row below it. One pass per column
  // pushes any colliding title down until it clears.
  for (const [, group] of colGroups(pos, depth)) {
    const sorted = [...group].sort((a, b) => pos.get(a)!.y - pos.get(b)!.y);
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      const ya = pos.get(a)!.y;
      const yb = pos.get(b)!.y;
      const bottomA =
        ya + mindmapLabelPlan(byId.get(a)?.label ?? '', em).bottom;
      const topB = yb + mindmapLabelPlan(byId.get(b)?.label ?? '', em).top;
      if (bottomA > topB) {
        // Push the rest of the column down by the difference, keeping
        // their relative spacing.
        const shift = bottomA - topB;
        for (let j = i + 1; j < sorted.length; j++) {
          const p = pos.get(sorted[j])!;
          p.y += shift;
        }
      }
    }
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

import { useMemo, useState } from 'react';
import { useStore, useCurrentDocument } from '@/store/useStore';
import {
  buildWorkspaceGraph,
  type GraphEdge,
  type GraphNode,
} from '@/utils/graph/buildWorkspaceGraph';

interface LaidOutNode extends GraphNode {
  x: number;
  y: number;
  r: number;
}

const CX = 0;
const CY = 0;
const INNER_R = 140;
const OUTER_R = 300;
const CHILD_R = 78;

function nodeRadius(kind: GraphNode['kind'], isHub: boolean): number {
  if (kind === 'document') return 18;
  if (kind === 'heading') return isHub ? 13 : 10;
  return 8;
}

function placeRing(
  count: number,
  radius: number,
  startAngle = -Math.PI / 2
): { x: number; y: number }[] {
  if (count <= 0) return [];
  if (count === 1) {
    return [{ x: CX + radius, y: CY }];
  }
  return Array.from({ length: count }, (_, i) => {
    const a = startAngle + (i * 2 * Math.PI) / count;
    return { x: CX + Math.cos(a) * radius, y: CY + Math.sin(a) * radius };
  });
}

function headingChildren(id: string, edges: GraphEdge[]): string[] {
  return edges
    .filter((e) => e.kind === 'heading' && e.source === id)
    .map((e) => e.target);
}

function layoutChildrenArc(
  parentId: string,
  parentPos: { x: number; y: number },
  parentAngle: number,
  edges: GraphEdge[],
  pos: Map<string, { x: number; y: number }>,
  radius: number
) {
  const kids = headingChildren(parentId, edges).filter((id) => !pos.has(id));
  if (kids.length === 0) return;
  const sweep = Math.min(Math.PI * 0.95, 0.5 * kids.length);
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
    layoutChildrenArc(id, p, a, edges, pos, Math.max(56, radius * 0.82));
  });
}

function layoutGraph(
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

  if (current) pos.set(current.id, { x: CX, y: CY });

  const otherPts = placeRing(others.length, OUTER_R);
  others.forEach((n, i) => pos.set(n.id, otherPts[i]));

  for (const doc of docs) {
    const origin = pos.get(doc.id) ?? { x: CX, y: CY };
    const top = headingChildren(doc.id, edges).filter((id) => nodeIds.has(id));
    const radius = doc.id === current?.id ? INNER_R : 88;
    const pts = placeRing(top.length, radius, -Math.PI / 2);
    top.forEach((id, i) => {
      const p = {
        x: origin.x + pts[i].x - CX,
        y: origin.y + pts[i].y - CY,
      };
      pos.set(id, p);
      const angle = Math.atan2(p.y - origin.y, p.x - origin.x);
      layoutChildrenArc(id, p, angle, edges, pos, CHILD_R);
    });
  }

  const terms = nodes.filter((n) => n.kind === 'term' && !pos.has(n.id));
  const termPts = placeRing(terms.length, (INNER_R + OUTER_R) / 2, Math.PI / 7);
  terms.forEach((n, i) => pos.set(n.id, termPts[i]));

  const childCount = new Map<string, number>();
  for (const e of edges) {
    if (e.kind !== 'heading') continue;
    childCount.set(e.source, (childCount.get(e.source) ?? 0) + 1);
  }

  return nodes.map((n) => {
    const p = pos.get(n.id) ?? { x: CX, y: CY };
    return {
      ...n,
      x: p.x,
      y: p.y,
      r: nodeRadius(n.kind, (childCount.get(n.id) ?? 0) > 0),
    };
  });
}

function neighborsOf(id: string, edges: GraphEdge[]): Set<string> {
  const next = new Set<string>([id]);
  for (const e of edges) {
    if (e.source === id) next.add(e.target);
    if (e.target === id) next.add(e.source);
  }
  return next;
}

function edgeCaption(kind: GraphEdge['kind']): string {
  if (kind === '@') return '@';
  if (kind === 'heading') return 'heading';
  return '[[wikilink]]';
}

function wrapLines(text: string, maxChars = 16, maxLines = 3): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  const push = (line: string) => {
    if (line) lines.push(line);
  };
  for (const word of words) {
    if (lines.length >= maxLines) break;
    const chunk =
      word.length > maxChars ? `${word.slice(0, maxChars - 1)}…` : word;
    const next = cur ? `${cur} ${chunk}` : chunk;
    if (next.length <= maxChars) {
      cur = next;
    } else {
      push(cur);
      cur = chunk;
    }
  }
  if (lines.length < maxLines) push(cur);
  const joined = lines.join(' ');
  if (joined.length < text.length && lines.length > 0) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = /…$/.test(last) ? last : `${last}…`;
  }
  return lines.length > 0 ? lines : [text];
}

export function GraphView() {
  const documents = useStore((s) => s.documents);
  const comments = useStore((s) => s.comments);
  const current = useCurrentDocument();
  const setCurrentDocument = useStore((s) => s.setCurrentDocument);
  const setEditorFocus = useStore((s) => s.setEditorFocus);

  const graph = useMemo(
    () => buildWorkspaceGraph(documents, comments),
    [documents, comments]
  );

  const laidOut = useMemo(
    () => layoutGraph(graph.nodes, graph.edges, current?.id ?? null),
    [graph.nodes, graph.edges, current?.id]
  );

  const [hoverId, setHoverId] = useState<string | null>(null);
  const hot = hoverId ? neighborsOf(hoverId, graph.edges) : null;
  const hovered = hoverId
    ? laidOut.find((n) => n.id === hoverId) ?? null
    : null;

  const empty =
    documents.length <= 1 &&
    graph.nodes.every((n) => n.kind === 'document');

  const xs = laidOut.map((n) => n.x);
  const ys = laidOut.map((n) => n.y);
  const pad = 72;
  const minX = (xs.length ? Math.min(...xs) : -100) - pad;
  const maxX = (xs.length ? Math.max(...xs) : 100) + pad;
  const minY = (ys.length ? Math.min(...ys) : -100) - pad;
  const maxY = (ys.length ? Math.max(...ys) : 100) + pad;
  const width = Math.max(maxX - minX, 240);
  const height = Math.max(maxY - minY, 240);

  const openRange = (documentId: string, start: number, end: number) => {
    if (current?.id !== documentId) setCurrentDocument(documentId);
    setEditorFocus(documentId, {
      focused: false,
      selectionStart: start,
      selectionEnd: end,
    });
    window.dispatchEvent(
      new CustomEvent('mvp:select-range', { detail: { start, end } })
    );
  };

  const onNodeClick = (node: LaidOutNode) => {
    if (node.kind === 'document' && node.documentId) {
      setCurrentDocument(node.documentId);
      return;
    }
    if (node.documentId != null && node.start != null && node.end != null) {
      openRange(node.documentId, node.start, node.end);
    }
  };

  return (
    <div
      className="relative flex-1 min-w-0 min-h-0 overflow-hidden bg-paper-base dark:bg-ape-base"
      data-graph-view
    >
      {hovered && (
        <div
          role="status"
          data-graph-label-tooltip
          className="absolute z-10 top-2 left-1/2 -translate-x-1/2 max-w-[min(36rem,calc(100%-1.5rem))] px-3 py-1.5 rounded border border-paper-hairline dark:border-cyber-border bg-paper-surface/95 dark:bg-ape-panel/95 text-paper-ink dark:text-cyber-primary text-[13px] leading-snug shadow-md pointer-events-none whitespace-pre-wrap break-words text-center"
        >
          {hovered.fullLabel || hovered.label}
        </div>
      )}
      {empty ? (
        <div className="h-full flex items-center justify-center px-6">
          <p className="text-sm text-paper-inkSoft dark:text-cyber-muted text-center max-w-sm">
            Add a heading or [[term]] (or @ another document) to grow this
            graph.
          </p>
        </div>
      ) : (
        <svg
          className="w-full h-full"
          viewBox={`${minX} ${minY} ${width} ${height}`}
          role="img"
          aria-label="Workspace knowledge graph"
        >
          {graph.edges.map((edge) => {
            const a = laidOut.find((n) => n.id === edge.source);
            const b = laidOut.find((n) => n.id === edge.target);
            if (!a || !b) return null;
            const active = !hot || (hot.has(edge.source) && hot.has(edge.target));
            const midX = (a.x + b.x) / 2;
            const midY = (a.y + b.y) / 2;
            const showCaption = hoverId && active && hot;
            return (
              <g
                key={edge.id}
                className={
                  active
                    ? 'text-paper-inkSoft dark:text-cyber-muted'
                    : 'text-paper-inkSoft/25 dark:text-cyber-muted/20'
                }
              >
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="currentColor"
                  strokeWidth={active ? 1.4 : 1}
                />
                {showCaption && (
                  <text
                    x={midX}
                    y={midY - 4}
                    textAnchor="middle"
                    className="fill-current text-[9px] font-mono"
                  >
                    {edgeCaption(edge.kind)}
                  </text>
                )}
              </g>
            );
          })}
          {laidOut.map((node) => {
            const active = !hot || hot.has(node.id);
            const isCurrent =
              node.kind === 'document' && node.documentId === current?.id;
            const fillClass =
              node.kind === 'document'
                ? isCurrent
                  ? 'fill-cyber-clay dark:fill-cyber-cyan'
                  : 'fill-paper-elevated dark:fill-ape-elevated'
                : node.kind === 'heading'
                  ? 'fill-paper-surface dark:fill-ape-panel'
                  : 'fill-paper-base dark:fill-ape-base';
            const lines = wrapLines(node.label);
            return (
              <g
                key={node.id}
                transform={`translate(${node.x} ${node.y})`}
                className={active ? 'opacity-100' : 'opacity-25'}
                onMouseEnter={() => setHoverId(node.id)}
                onMouseLeave={() =>
                  setHoverId((id) => (id === node.id ? null : id))
                }
              >
                <title>{node.fullLabel || node.label}</title>
                <circle
                  r={node.r}
                  className={`${fillClass} stroke-paper-ink dark:stroke-cyber-primary cursor-pointer`}
                  strokeWidth={isCurrent ? 2.2 : node.kind === 'term' ? 1.6 : 1.2}
                  onClick={() => onNodeClick(node)}
                  role="button"
                  tabIndex={0}
                  aria-label={node.fullLabel || node.label}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onNodeClick(node);
                    }
                  }}
                />
                <text
                  y={node.r + 11}
                  textAnchor="middle"
                  className="fill-paper-ink dark:fill-cyber-primary text-[10px] cursor-pointer"
                  onClick={() => onNodeClick(node)}
                >
                  {lines.map((line, i) => (
                    <tspan key={i} x={0} dy={i === 0 ? 0 : 11}>
                      {line}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

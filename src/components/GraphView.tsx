import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore, useCurrentDocument } from '@/store/useStore';
import {
  buildWorkspaceGraph,
  type GraphEdge,
} from '@/utils/graph/buildWorkspaceGraph';
import {
  layoutWorkspaceGraph,
  type LaidOutNode,
} from '@/utils/graph/layoutWorkspaceGraph';

/** Screen-pixel label size. Matches the editor / UI default (~14–16px). */
export const DEFAULT_GRAPH_LABEL_PX = 16;
export const MIN_GRAPH_LABEL_PX = 12;
export const MAX_GRAPH_LABEL_PX = 28;
export const GRAPH_LABEL_STEP = 2;

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

function labelOffset(
  x: number,
  y: number,
  r: number,
  hub: { x: number; y: number },
  userFont: number
): Pick<LaidOutNode, 'labelDx' | 'labelDy' | 'labelAnchor'> {
  const dx = x - hub.x;
  const dy = y - hub.y;
  const dist = Math.hypot(dx, dy);
  const ux = dist < 0.001 ? 0 : dx / dist;
  const uy = dist < 0.001 ? 1 : dy / dist;
  const reach = r + Math.max(18, userFont * 0.55);
  let anchor: LaidOutNode['labelAnchor'] = 'middle';
  if (ux > 0.35) anchor = 'start';
  else if (ux < -0.35) anchor = 'end';
  return {
    labelDx: ux * reach,
    labelDy: uy * reach + (anchor === 'middle' ? r + userFont * 0.2 : userFont * 0.15),
    labelAnchor: anchor,
  };
}

const graphToolClass =
  'h-9 inline-flex items-center justify-center rounded border border-paper-hairline dark:border-cyber-border bg-paper-surface dark:bg-ape-panel text-paper-inkSoft dark:text-cyber-muted hover:border-cyber-clay dark:hover:border-cyber-cyan hover:text-cyber-clay dark:hover:text-cyber-cyan disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-paper-hairline disabled:hover:text-paper-inkSoft dark:disabled:hover:border-cyber-border dark:disabled:hover:text-cyber-muted transition-colors';

export function GraphViewControls({
  labelPx,
  onLabelPx,
  onReset,
}: {
  labelPx: number;
  onLabelPx: (next: number) => void;
  onReset: () => void;
}) {
  const canMinus = labelPx > MIN_GRAPH_LABEL_PX;
  const canPlus = labelPx < MAX_GRAPH_LABEL_PX;
  return (
    <div
      className="inline-flex items-center gap-1 text-[15px] leading-none"
      data-graph-view-controls
    >
      <button
        type="button"
        className={`${graphToolClass} w-9`}
        aria-label="Smaller Graph labels"
        title="Smaller Graph labels"
        disabled={!canMinus}
        onClick={() =>
          onLabelPx(Math.max(MIN_GRAPH_LABEL_PX, labelPx - GRAPH_LABEL_STEP))
        }
      >
        −
      </button>
      <button
        type="button"
        className={`${graphToolClass} w-9`}
        aria-label="Larger Graph labels"
        title="Larger Graph labels"
        disabled={!canPlus}
        onClick={() =>
          onLabelPx(Math.min(MAX_GRAPH_LABEL_PX, labelPx + GRAPH_LABEL_STEP))
        }
      >
        +
      </button>
      <span
        className="min-w-[2.25rem] text-center text-[13px] font-mono text-paper-inkSoft dark:text-cyber-muted tabular-nums"
        aria-live="polite"
      >
        {labelPx}
      </span>
      <button
        type="button"
        className={`${graphToolClass} px-3`}
        aria-label="Reset Graph view"
        title="Reset Graph labels and view"
        onClick={onReset}
      >
        Reset
      </button>
    </div>
  );
}

export interface GraphViewProps {
  /** Desired on-screen label size in CSS pixels. */
  labelPx?: number;
}

export function GraphView({
  labelPx = DEFAULT_GRAPH_LABEL_PX,
}: GraphViewProps) {
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
    () => layoutWorkspaceGraph(graph.nodes, graph.edges, current?.id ?? null),
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

  const wrapRef = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState({ w: 1, h: 1 });
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const sync = () => setVp({ w: el.clientWidth || 1, h: el.clientHeight || 1 });
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [empty]);

  const xs = laidOut.map((n) => n.x);
  const ys = laidOut.map((n) => n.y);
  const fitScale = Math.min(vp.w / 800, vp.h / 600);
  const userFontGuess = labelPx / Math.max(fitScale, 0.15);
  const pad = 80 + userFontGuess * 3;
  const minX = (xs.length ? Math.min(...xs) : -100) - pad;
  const maxX = (xs.length ? Math.max(...xs) : 100) + pad;
  const minY = (ys.length ? Math.min(...ys) : -100) - pad;
  const maxY = (ys.length ? Math.max(...ys) : 100) + pad;
  const width = Math.max(maxX - minX, 240);
  const height = Math.max(maxY - minY, 240);
  const meet = Math.min(vp.w / width, vp.h / height) || 1;
  const userFont = labelPx / meet;
  const lineGap = userFont * 1.2;
  const maxChars = Math.max(10, Math.min(22, Math.round((18 * 16) / labelPx)));

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
      ref={wrapRef}
      className="relative flex-1 min-w-0 min-h-0 overflow-hidden bg-paper-base dark:bg-ape-base"
      data-graph-view
    >
      {hovered && (
        <div
          role="status"
          data-graph-label-tooltip
          className="absolute z-10 top-2 left-1/2 -translate-x-1/2 max-w-[min(36rem,calc(100%-8rem))] px-3 py-1.5 rounded border border-paper-hairline dark:border-cyber-border bg-paper-surface/95 dark:bg-ape-panel/95 text-paper-ink dark:text-cyber-primary text-[15px] leading-snug shadow-md pointer-events-none whitespace-pre-wrap break-words text-center"
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
                  strokeWidth={active ? 2.2 : 1.6}
                />
                {showCaption && (
                  <text
                    x={midX}
                    y={midY - userFont * 0.35}
                    textAnchor="middle"
                    fontSize={userFont * 0.75}
                    className="fill-current font-mono"
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
            const hub = node.documentId
              ? laidOut.find((n) => n.id === `doc:${node.documentId}`) ?? node
              : node;
            const label = labelOffset(node.x, node.y, node.r, hub, userFont);
            const lines = wrapLines(node.label, maxChars);
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
                  strokeWidth={isCurrent ? 3.2 : node.kind === 'term' ? 2.4 : 2}
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
                  x={label.labelDx}
                  y={label.labelDy}
                  textAnchor={label.labelAnchor}
                  fontSize={userFont}
                  className="fill-paper-ink dark:fill-cyber-primary cursor-pointer"
                  onClick={() => onNodeClick(node)}
                >
                  {lines.map((line, i) => (
                    <tspan key={i} x={label.labelDx} dy={i === 0 ? 0 : lineGap}>
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

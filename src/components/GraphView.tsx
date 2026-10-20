import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useStore, useCurrentDocument } from '@/store/useStore';
import {
  buildWorkspaceGraph,
  type GraphEdge,
} from '@/utils/graph/buildWorkspaceGraph';
import {
  layoutWorkspaceGraph,
  type LaidOutNode,
} from '@/utils/graph/layoutWorkspaceGraph';
import {
  clampGraphZoom,
  MAX_GRAPH_ZOOM,
  MIN_GRAPH_ZOOM,
  type Bounds,
  type Point,
} from '@/utils/graph/graphCamera';
import {
  isFrontFacing,
  rotateSphere,
  toScreen,
  toSphere,
} from '@/utils/graph/sphereProject';
import {
  SPHERE_RADIUS,
  useGraphCamera,
  type GraphProjection,
} from '@/hooks/useGraphCamera';
import { useGraphLens } from '@/hooks/useGraphLens';

/** Screen-pixel label size. Matches the editor / UI default (~14–16px). */
export const DEFAULT_GRAPH_LABEL_PX = 16;
export const MIN_GRAPH_LABEL_PX = 12;
export const MAX_GRAPH_LABEL_PX = 28;
export const GRAPH_LABEL_STEP = 2;

const DRAG_THRESHOLD_PX = 5;

/** A node after the lens and projection pipeline, in screen-ish coordinates. */
type ProjectedNode = LaidOutNode & {
  /** Depth on the sphere, normalised to [0, 1]. 1 = closest to the viewer. */
  depth: number;
  /** False for nodes on the far hemisphere in sphere mode. */
  visible: boolean;
};

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

/** Depth ramp for sphere mode: nearest nodes read as foreground. */
function depthScale(depth: number): number {
  return 0.55 + 0.45 * depth;
}

const graphToolClass =
  'h-9 inline-flex items-center justify-center rounded border border-paper-hairline dark:border-cyber-border bg-paper-surface dark:bg-ape-panel text-paper-inkSoft dark:text-cyber-muted hover:border-cyber-clay dark:hover:border-cyber-cyan hover:text-cyber-clay dark:hover:text-cyber-cyan disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-paper-hairline disabled:hover:text-paper-inkSoft dark:disabled:hover:border-cyber-border dark:disabled:hover:text-cyber-muted transition-colors';

const graphSegmentBase =
  'h-9 px-2.5 inline-flex items-center justify-center text-[13px] transition-colors';

export function GraphViewControls({
  labelPx,
  onLabelPx,
  zoom,
  onZoom,
  onReset,
  projection,
  onProjection,
}: {
  labelPx: number;
  onLabelPx: (next: number) => void;
  zoom: number;
  onZoom: (next: number) => void;
  onReset: () => void;
  projection: GraphProjection;
  onProjection: (next: GraphProjection) => void;
}) {
  const canMinus = labelPx > MIN_GRAPH_LABEL_PX;
  const canPlus = labelPx < MAX_GRAPH_LABEL_PX;
  const canZoomOut = zoom > MIN_GRAPH_ZOOM + 0.001;
  const canZoomIn = zoom < MAX_GRAPH_ZOOM - 0.001;
  return (
    <div
      className="inline-flex flex-wrap items-center gap-1 text-[15px] leading-none"
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
      <span className="min-w-[2.25rem] text-center text-[13px] font-mono text-paper-inkSoft dark:text-cyber-muted tabular-nums">
        {labelPx}
      </span>
      <span className="mx-1 h-5 w-px bg-paper-hairline dark:border-cyber-border" aria-hidden />
      <button
        type="button"
        className={`${graphToolClass} px-2.5`}
        aria-label="Zoom Graph out"
        title="Zoom Graph out"
        disabled={!canZoomOut}
        onClick={() => onZoom(clampGraphZoom(zoom / 1.25))}
      >
        Zoom −
      </button>
      <button
        type="button"
        className={`${graphToolClass} px-2.5`}
        aria-label="Zoom Graph in"
        title="Zoom Graph in"
        disabled={!canZoomIn}
        onClick={() => onZoom(clampGraphZoom(zoom * 1.25))}
      >
        Zoom +
      </button>
      <span className="min-w-[2.75rem] text-center text-[13px] font-mono text-paper-inkSoft dark:text-cyber-muted tabular-nums">
        {Math.round(zoom * 100)}%
      </span>
      <span className="mx-1 h-5 w-px bg-paper-hairline dark:border-cyber-border" aria-hidden />
      <div
        role="group"
        aria-label="Graph projection"
        className="inline-flex overflow-hidden rounded border border-paper-hairline dark:border-cyber-border"
      >
        <button
          type="button"
          aria-pressed={projection === 'flat'}
          title="Flat map — pan by dragging the background"
          className={`${graphSegmentBase} ${
            projection === 'flat'
              ? 'bg-cyber-clay text-paper-base dark:bg-ape-fire dark:text-white font-semibold'
              : 'text-paper-inkSoft dark:text-cyber-muted hover:bg-paper-elevated dark:hover:bg-ape-elevated hover:text-cyber-clay dark:hover:text-cyber-cyan'
          }`}
          onClick={() => onProjection('flat')}
        >
          Graph
        </button>
        <button
          type="button"
          aria-pressed={projection === 'sphere'}
          title="Globe — drag the background to spin the sphere"
          className={`${graphSegmentBase} border-l border-paper-hairline dark:border-cyber-border ${
            projection === 'sphere'
              ? 'bg-cyber-clay text-paper-base dark:bg-ape-fire dark:text-white font-semibold'
              : 'text-paper-inkSoft dark:text-cyber-muted hover:bg-paper-elevated dark:hover:bg-ape-elevated hover:text-cyber-clay dark:hover:text-cyber-cyan'
          }`}
          onClick={() => onProjection('sphere')}
        >
          Globe
        </button>
      </div>
      <button
        type="button"
        className={`${graphToolClass} px-3`}
        aria-label="Reset Graph view"
        title="Reset labels, zoom, projection, and re-lay out nodes (tidy atom layout)"
        onClick={onReset}
      >
        Reset
      </button>
    </div>
  );
}

export interface GraphViewProps {
  /** Desired on-screen label size in CSS pixels (at 100% zoom). */
  labelPx?: number;
  /** Zoom multiplier on top of the fit-to-pane scale. 1 = fitted. */
  zoom?: number;
  /** Reports zoom changes so the toolbar can drive the view. */
  onZoomChange?: (next: number) => void;
  /** Flat map or globe. The sphere is an inner toggle, not a view mode. */
  projection?: GraphProjection;
}

type NodeDragSession = {
  id: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  originX: number;
  originY: number;
  moved: boolean;
};

export function GraphView({
  labelPx = DEFAULT_GRAPH_LABEL_PX,
  zoom = 1,
  onZoomChange,
  projection = 'flat',
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

  // Manual node drags are stored in *layout* space, before the lens and the
  // projection. Composing the transform on top means a dragged node keeps
  // its overridden position instead of being fought by the lens.
  const [overrides, setOverrides] = useState<Record<string, { x: number; y: number }>>(
    {}
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const nodeDragRef = useRef<NodeDragSession | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const placed = useMemo(
    () =>
      laidOut.map((n) => {
        const o = overrides[n.id];
        return o ? { ...n, x: o.x, y: o.y } : n;
      }),
    [laidOut, overrides]
  );

  // Layout bounds drive both the lens boundary and the camera fit. In globe
  // mode the bound is fixed to the sphere so rotating does not refit.
  const layoutBounds = useMemo<Bounds>(() => {
    const xs = placed.map((n) => n.x);
    const ys = placed.map((n) => n.y);
    const minX = (xs.length ? Math.min(...xs) : -100) - 400;
    const maxX = (xs.length ? Math.max(...xs) : 100) + 400;
    const minY = (ys.length ? Math.min(...ys) : -100) - 400;
    const maxY = (ys.length ? Math.max(...ys) : 100) + 400;
    return {
      minX,
      minY,
      width: Math.max(maxX - minX, 240),
      height: Math.max(maxY - minY, 240),
    };
  }, [placed]);

  const isSphere = projection === 'sphere';
  const lens = useGraphLens(placed, {
    enabled: isSphere,
    bounds: layoutBounds,
  });

  const cam = useGraphCamera(
    wrapRef,
    projection,
    layoutBounds,
    zoom,
    onZoomChange ?? (() => {})
  );

  // Project every node through the lens, then the sphere. `depth` drives the
  // depth ramp; `visible` culls the far hemisphere, which would otherwise
  // mirror onto the viewport.
  const projected = useMemo<ProjectedNode[]>(() => {
    if (!isSphere) {
      return lens.lensed.map((n) => ({ ...n, depth: 1, visible: true }));
    }
    const out: ProjectedNode[] = [];
    for (const n of lens.lensed) {
      const p = rotateSphere(toSphere(n.x, n.y, SPHERE_RADIUS), cam.orientation);
      const front = isFrontFacing(p);
      const s = front ? toScreen(p, SPHERE_RADIUS) : { x: n.x, y: n.y };
      out.push({
        ...n,
        x: s.x,
        y: s.y,
        depth: Math.max(0, Math.min(1, (p.z / SPHERE_RADIUS + 1) / 2)),
        visible: front,
      });
    }
    return out;
  }, [lens.lensed, isSphere, cam.orientation]);

  const byId = useMemo(
    () => new Map(projected.map((n) => [n.id, n])),
    [projected]
  );

  const drawnEdges = useMemo(
    () =>
      graph.edges
        .map((e) => {
          const a = byId.get(e.source);
          const b = byId.get(e.target);
          // An edge with a culled endpoint would otherwise stretch across the
          // viewport to a node that is not being drawn.
          if (!a || !b || !a.visible || !b.visible) return null;
          return { edge: e, a, b };
        })
        .filter((v): v is NonNullable<typeof v> => v !== null),
    [graph.edges, byId]
  );

  const [hoverId, setHoverId] = useState<string | null>(null);
  const hot = hoverId ? neighborsOf(hoverId, graph.edges) : null;
  const hovered = hoverId ? byId.get(hoverId) ?? null : null;

  const empty =
    documents.length <= 1 && graph.nodes.every((n) => n.kind === 'document');

  const userFont = labelPx / Math.max(cam.camera.scale, 1e-6);
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

  const onNodeClick = (node: ProjectedNode) => {
    if (node.kind === 'document' && node.documentId) {
      setCurrentDocument(node.documentId);
      return;
    }
    if (node.documentId != null && node.start != null && node.end != null) {
      openRange(node.documentId, node.start, node.end);
    }
  };

  const endNodeDrag = (session: NodeDragSession, node: ProjectedNode | undefined) => {
    nodeDragRef.current = null;
    setDraggingId(null);
    cam.endDrag();
    if (!session.moved && node) onNodeClick(node);
  };

  const onNodePointerDown = useCallback(
    (node: ProjectedNode, e: ReactPointerEvent<SVGGElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const svg = svgRef.current;
      if (!svg) return;
      svg.setPointerCapture(e.pointerId);
      // Overrides live in layout space, so undo the projection to record
      // where the node actually sits in the graph.
      const layoutNode = placed.find((n) => n.id === node.id);
      nodeDragRef.current = {
        id: node.id,
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        originX: layoutNode?.x ?? node.x,
        originY: layoutNode?.y ?? node.y,
        moved: false,
      };
      setDraggingId(node.id);
      setHoverId(node.id);
    },
    [placed]
  );

  // Background drag: pan in flat mode, orbit in globe mode.
  const onBackgroundPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const svg = svgRef.current;
    if (!svg) return;
    svg.setPointerCapture(e.pointerId);
    cam.beginDrag(e, isSphere ? 'orbit' : 'pan', cam.orientation);
  };

  const onSvgPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const session = nodeDragRef.current;
    if (session && e.pointerId === session.pointerId) {
      const dist = Math.hypot(
        e.clientX - session.startClientX,
        e.clientY - session.startClientY
      );
      if (!session.moved && dist < DRAG_THRESHOLD_PX) return;
      session.moved = true;
      // Screen delta → layout delta. In globe mode the projection is not
      // affine, so nudge toward the world point under the cursor instead.
      const now = cam.worldAtClient(e.clientX, e.clientY);
      const start = cam.worldAtClient(session.startClientX, session.startClientY);
      setOverrides((prev) => ({
        ...prev,
        [session.id]: {
          x: session.originX + (now.x - start.x),
          y: session.originY + (now.y - start.y),
        },
      }));
      return;
    }
    cam.moveDrag(e);
  };

  const onSvgPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const session = nodeDragRef.current;
    const svg = svgRef.current;
    if (svg?.hasPointerCapture(e.pointerId)) {
      svg.releasePointerCapture(e.pointerId);
    }
    if (session && e.pointerId === session.pointerId) {
      endNodeDrag(session, byId.get(session.id));
      return;
    }
    cam.endDrag();
  };

  return (
    <div
      ref={wrapRef}
      className="relative flex-1 min-w-0 min-h-0 overflow-hidden bg-paper-base dark:bg-ape-base"
      data-graph-view
      data-graph-projection={projection}
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
          ref={svgRef}
          className={`w-full h-full ${
            isSphere
              ? draggingId
                ? 'cursor-grabbing'
                : 'cursor-grab'
              : draggingId
                ? 'cursor-grabbing'
                : 'cursor-default'
          }`}
          viewBox={`${cam.viewBox.x} ${cam.viewBox.y} ${cam.viewBox.w} ${cam.viewBox.h}`}
          role="img"
          aria-label={
            isSphere
              ? 'Workspace knowledge graph, globe projection'
              : 'Workspace knowledge graph'
          }
          onPointerDown={onBackgroundPointerDown}
          onPointerMove={onSvgPointerMove}
          onPointerUp={onSvgPointerUp}
          onPointerCancel={onSvgPointerUp}
        >
          {drawnEdges.map(({ edge, a, b }) => {
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
                opacity={isSphere ? depthScale(Math.min(a.depth, b.depth)) : 1}
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
          {projected.map((node) => {
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
              ? byId.get(`doc:${node.documentId}`) ?? node
              : node;
            const label = labelOffset(node.x, node.y, node.r, hub, userFont);
            const lines = wrapLines(node.label, maxChars);
            if (!node.visible) return null;
            // Globe mode dims by depth so the front of the sphere reads as
            // foreground; flat mode falls back to hover-only dimming.
            const dimmed = active ? 1 : 0.25;
            return (
              <g
                key={node.id}
                transform={`translate(${node.x} ${node.y})`}
                className={`${
                  draggingId === node.id ? 'cursor-grabbing' : 'cursor-grab'
                }`}
                opacity={isSphere ? depthScale(node.depth) * dimmed : dimmed}
                onPointerDown={(e) => onNodePointerDown(node, e)}
                onMouseEnter={() => setHoverId(node.id)}
                onMouseLeave={() => setHoverId((id) => (id === node.id ? null : id))}
              >
                <title>{node.fullLabel || node.label}</title>
                <circle
                  r={node.r}
                  className={`${fillClass} stroke-paper-ink dark:stroke-cyber-primary`}
                  strokeWidth={isCurrent ? 3.2 : node.kind === 'term' ? 2.4 : 2}
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
                  className="fill-paper-ink dark:fill-cyber-primary"
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

export type { Point };
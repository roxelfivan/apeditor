import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useStore } from '@/store/useStore';

const MIN_COL_PX = 48;
const DEFAULT_COL_PX = 140;

type ResizeCtx = {
  colCount: number;
  ensureWidths: () => number[];
  onResizeStart: (colIndex: number, e: ReactPointerEvent<HTMLElement>) => void;
};

const TableResizeContext = createContext<ResizeCtx | null>(null);

type TableProps = ComponentPropsWithoutRef<'table'> & {
  docId?: string | null;
  tableIndex: number;
  'data-line'?: string;
  children?: ReactNode;
};

function readHeaderCells(table: HTMLTableElement): Element[] {
  let cells = [
    ...table.querySelectorAll(
      'thead tr:first-child > th, thead tr:first-child > td'
    ),
  ];
  if (cells.length === 0) {
    cells = [
      ...table.querySelectorAll('tr:first-child > th, tr:first-child > td'),
    ];
  }
  return cells;
}

/**
 * Preview GFM table with drag-resizable columns.
 *
 * Widths are UI chrome (`layout.previewTableColWidths`) — they do not
 * rewrite Markdown. Once sized, cells wrap so narrowing a column
 * reflows text.
 */
export function ResizablePreviewTable({
  docId,
  tableIndex,
  children,
  className,
  style,
  'data-line': dataLine,
  ...rest
}: TableProps) {
  const tableRef = useRef<HTMLTableElement>(null);
  const reactId = useIdStable();
  const [colCount, setColCount] = useState(0);
  const [headerKey, setHeaderKey] = useState('');

  const storageKey = useMemo(() => {
    if (!docId) return `anon:${reactId}:${tableIndex}:${headerKey}`;
    return `${docId}:${tableIndex}:${headerKey}`;
  }, [docId, tableIndex, headerKey, reactId]);

  const storedWidths = useStore(
    (s) => s.layout.previewTableColWidths?.[storageKey]
  );
  const setPreviewTableColWidths = useStore((s) => s.setPreviewTableColWidths);

  const [localWidths, setLocalWidths] = useState<number[] | null>(null);
  const widths = localWidths ?? storedWidths ?? null;

  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    const cells = readHeaderCells(table);
    setColCount(cells.length);
    setHeaderKey(
      cells.map((c, i) => (c.textContent ?? '').trim() || `c${i}`).join('\u001f')
    );
  }, [children]);

  const measureWidths = useCallback((): number[] => {
    const table = tableRef.current;
    const n = colCount;
    if (!table || n < 1) {
      return Array.from({ length: Math.max(n, 1) }, () => DEFAULT_COL_PX);
    }
    const cells = readHeaderCells(table);
    const next: number[] = [];
    for (let i = 0; i < n; i++) {
      const el = cells[i] as HTMLElement | undefined;
      const w = el ? Math.round(el.getBoundingClientRect().width) : 0;
      next.push(Math.max(MIN_COL_PX, w || DEFAULT_COL_PX));
    }
    return next;
  }, [colCount]);

  const ensureWidths = useCallback((): number[] => {
    if (widths && widths.length === colCount && colCount > 0) return [...widths];
    const next = measureWidths();
    setLocalWidths(next);
    setPreviewTableColWidths(storageKey, next);
    return next;
  }, [
    widths,
    colCount,
    measureWidths,
    setPreviewTableColWidths,
    storageKey,
  ]);

  // Persist measured widths once headers are known so wrap + fixed layout
  // engage even before the first drag. Skip the store write when the
  // stored value already matches to avoid a render loop.
  useLayoutEffect(() => {
    if (colCount < 1) return;
    if (widths && widths.length === colCount) return;
    const next = measureWidths();
    setLocalWidths(next);
    const prev = storedWidths;
    const same =
      !!prev &&
      prev.length === next.length &&
      prev.every((w, i) => w === next[i]);
    if (!same) setPreviewTableColWidths(storageKey, next);
  }, [
    colCount,
    widths,
    storedWidths,
    measureWidths,
    setPreviewTableColWidths,
    storageKey,
  ]);

  const commitWidths = useCallback(
    (next: number[]) => {
      setLocalWidths(next);
      setPreviewTableColWidths(storageKey, next);
    },
    [setPreviewTableColWidths, storageKey]
  );

  const onResizeStart = useCallback(
    (colIndex: number, e: ReactPointerEvent<HTMLElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const base = ensureWidths();
      const startW = base[colIndex] ?? DEFAULT_COL_PX;
      const target = e.currentTarget;
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        // Some environments reject capture on synthetic events; window
        // listeners below still drive the drag.
      }
      document.body.classList.add('preview-col-resizing');

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const next = [...base];
        next[colIndex] = Math.max(MIN_COL_PX, Math.round(startW + dx));
        setLocalWidths(next);
      };
      const onUp = (ev: PointerEvent) => {
        try {
          if (target.hasPointerCapture?.(e.pointerId)) {
            target.releasePointerCapture(e.pointerId);
          }
        } catch {
          /* ignore */
        }
        document.body.classList.remove('preview-col-resizing');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        const dx = ev.clientX - startX;
        const next = [...base];
        next[colIndex] = Math.max(MIN_COL_PX, Math.round(startW + dx));
        commitWidths(next);
      };
      // Listen on window so fast drags outside the handle still track.
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [ensureWidths, commitWidths]
  );

  const hasWidths = !!widths && widths.length === colCount && colCount > 0;
  const ctx = useMemo<ResizeCtx>(
    () => ({ colCount, ensureWidths, onResizeStart }),
    [colCount, ensureWidths, onResizeStart]
  );

  // Strip react-markdown's `node` so it never hits the DOM.
  const { node: _node, ...domRest } = rest as typeof rest & { node?: unknown };

  return (
    <TableResizeContext.Provider value={ctx}>
      <div className="table-scroll" data-line={dataLine}>
        <table
          {...domRest}
          ref={tableRef}
          className={`preview-resizable-table${
            hasWidths ? ' is-sized' : ''
          }${className ? ` ${className}` : ''}`}
          style={style}
        >
          {hasWidths && (
            <colgroup>
              {widths!.map((w, i) => (
                <col key={i} style={{ width: `${w}px` }} />
              ))}
            </colgroup>
          )}
          {children}
        </table>
      </div>
    </TableResizeContext.Provider>
  );
}

function useIdStable(): string {
  const ref = useRef(`t${Math.random().toString(36).slice(2, 10)}`);
  return ref.current;
}

/** Header cell with an in-cell right-edge drag handle (always present). */
export function ResizablePreviewTh({
  children,
  ...props
}: ComponentPropsWithoutRef<'th'> & { node?: unknown }) {
  const ctx = useContext(TableResizeContext);
  const ref = useRef<HTMLTableCellElement>(null);
  const [colIndex, setColIndex] = useState(-1);

  // Drop react-markdown internals before they hit the DOM.
  const { node: _node, ...domProps } = props;

  useLayoutEffect(() => {
    const cell = ref.current;
    if (!cell) return;
    const row = cell.parentElement;
    if (!row) return;
    setColIndex([...row.children].indexOf(cell));
  }, [children]);

  const canResize = !!ctx && colIndex >= 0;

  return (
    <th {...domProps} ref={ref}>
      <div className="preview-th-inner">
        <div className="preview-th-label">{children}</div>
        {canResize && (
          <button
            type="button"
            className="preview-col-handle"
            aria-label={`Resize column ${colIndex + 1}`}
            title="Drag to resize column"
            onPointerDown={(e) => ctx!.onResizeStart(colIndex, e)}
          />
        )}
      </div>
    </th>
  );
}

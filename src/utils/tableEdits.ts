/**
 * `table-edit` fence parsing + resolution to a ProposedEdit that
 * carries span metadata for deterministic table Apply.
 *
 * Supported ops:
 *   - set-cell  (row + column + value) — default when those fields exist
 *   - delete-rows / keep-rows (rowIndices range or list)
 *   - remove-column / delete-column (header name or 1-based index)
 *   - add-column (header name + optional 1-based position + fill)
 *
 * The fence info-string must be exactly `table-edit` (sibling of
 * `proposed-edit`). Short cell values are never run through
 * `findEditAnchor` — Apply uses `tableEdit` spans instead.
 */

import type { ProposedEdit, TableEditMeta } from '@/types';
import {
  applyAddColumn,
  applyCellEdit,
  applyDeleteColumns,
  applyDeleteRows,
  findColumnIndex,
  parseMarkdownTables,
  resolveColumnRef,
  type AddColumnEdit,
  type ApplyAddColumnResult,
  type ApplyCellEditResult,
  type ApplyDeleteColumnsResult,
  type ApplyDeleteRowsResult,
  type CellEdit,
  type DeleteColumnsEdit,
  type DeleteRowsEdit,
} from '@/utils/tableModel';

export type TableEditOp =
  | {
      kind: 'set-cell';
      id: string;
      summary: string;
      rationale: string;
      tableIndex: number;
      row: number;
      column: string;
      value: string;
    }
  | {
      kind: 'delete-rows';
      id: string;
      summary: string;
      rationale: string;
      tableIndex: number;
      /** 1-based data rows named by the model. */
      rows: number[];
      /**
       * When true, `rows` are the rows to *keep*; resolve expands to
       * the complementary delete set against the live table.
       */
      keep?: boolean;
    }
  | {
      kind: 'delete-columns';
      id: string;
      summary: string;
      rationale: string;
      tableIndex: number;
      /** Column refs as emitted (names and/or indexes). */
      columns: Array<string | number>;
    }
  | {
      kind: 'add-column';
      id: string;
      summary: string;
      rationale: string;
      tableIndex: number;
      header: string;
      /** 1-based insert position; null = append. */
      at: number | null;
      fill: string;
    };

/**
 * Parse `r51-r636`, `51-636`, `r51,r52`, `[51,52]`, or a number array
 * into sorted unique 1-based row numbers.
 */
export function parseRowIndices(
  raw: unknown,
  maxRow?: number
): number[] | null {
  const out = new Set<number>();
  const addRange = (a: number, b: number) => {
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < 1) {
      return false;
    }
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (maxRow != null && hi > maxRow) return false;
    for (let n = lo; n <= hi; n++) out.add(n);
    return true;
  };
  const addOne = (n: number) => {
    if (!Number.isInteger(n) || n < 1) return false;
    if (maxRow != null && n > maxRow) return false;
    out.add(n);
    return true;
  };

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'number') {
        if (!addOne(item)) return null;
      } else if (typeof item === 'string') {
        const parsed = parseRowIndices(item, maxRow);
        if (!parsed) return null;
        for (const n of parsed) out.add(n);
      } else {
        return null;
      }
    }
  } else if (typeof raw === 'number') {
    if (!addOne(raw)) return null;
  } else if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return null;
    const parts = s.split(/[,;\s]+/).filter(Boolean);
    for (const part of parts) {
      const range = /^r?(\d+)\s*[-–—]\s*r?(\d+)$/i.exec(part);
      if (range) {
        if (!addRange(Number(range[1]), Number(range[2]))) return null;
        continue;
      }
      const one = /^r?(\d+)$/i.exec(part);
      if (one) {
        if (!addOne(Number(one[1]))) return null;
        continue;
      }
      return null;
    }
  } else {
    return null;
  }

  if (out.size === 0) return null;
  return [...out].sort((a, b) => a - b);
}

function isKeepOpName(name: string): boolean {
  return (
    name === 'keep-rows' ||
    name === 'keep_rows' ||
    name === 'keeprows' ||
    name === 'keep'
  );
}

function isDeleteRowsOpName(name: string): boolean {
  return (
    name === 'delete-rows' ||
    name === 'delete_rows' ||
    name === 'deleterows' ||
    name === 'remove-rows' ||
    name === 'remove_rows'
  );
}

function isDeleteColumnsOpName(name: string): boolean {
  return (
    name === 'remove-column' ||
    name === 'remove_column' ||
    name === 'removecolumn' ||
    name === 'delete-column' ||
    name === 'delete_column' ||
    name === 'deletecolumn' ||
    name === 'remove-columns' ||
    name === 'delete-columns' ||
    name === 'drop-column' ||
    name === 'drop_column'
  );
}

function isAddColumnOpName(name: string): boolean {
  return (
    name === 'add-column' ||
    name === 'add_column' ||
    name === 'addcolumn' ||
    name === 'insert-column' ||
    name === 'insert_column' ||
    name === 'insertcolumn' ||
    name === 'append-column' ||
    name === 'append_column'
  );
}

/**
 * Parse add-column header + 1-based position from common model shapes.
 * "Add blank column 6 called summary" → header=summary, at=6.
 */
function parseAddColumnFields(
  obj: Record<string, unknown>
): { header: string; at: number | null; fill: string } | null {
  const nameCand =
    (typeof obj.name === 'string' && obj.name.trim()) ||
    (typeof obj.header === 'string' && obj.header.trim()) ||
    (typeof obj.columnName === 'string' && obj.columnName.trim()) ||
    (typeof obj.title === 'string' && obj.title.trim()) ||
    '';

  let at: number | null = null;
  const atRaw = obj.at ?? obj.position ?? obj.index ?? obj.columnIndex;
  if (typeof atRaw === 'number' && Number.isInteger(atRaw) && atRaw >= 1) {
    at = atRaw;
  } else if (typeof atRaw === 'string') {
    const m = /^(?:column|col|c)?\s*#?\s*(\d+)$/i.exec(atRaw.trim());
    if (m) at = Number(m[1]);
  }

  let header = nameCand;
  const col = obj.column;
  if (typeof col === 'string' && col.trim()) {
    const positional = /^(?:column|col|c)?\s*#?\s*(\d+)$/i.exec(col.trim());
    if (positional) {
      if (at == null) at = Number(positional[1]);
      // column was only a position — keep header from nameCand
    } else if (!header) {
      header = col.trim();
    }
  } else if (typeof col === 'number' && Number.isInteger(col) && col >= 1) {
    if (at == null) at = col;
  }

  if (!header) return null;
  const fill = typeof obj.value === 'string' ? obj.value : '';
  return { header, at, fill };
}

function isSetCellOpName(name: string): boolean {
  return (
    name === '' ||
    name === 'set-cell' ||
    name === 'set_cell' ||
    name === 'setcell' ||
    name === 'set' ||
    name === 'update-cell' ||
    name === 'update_cell'
  );
}

/** Collect column refs from `column` / `columns` / `columnIndices`. */
function parseColumnRefs(obj: Record<string, unknown>): Array<string | number> | null {
  const refs: Array<string | number> = [];
  const push = (v: unknown) => {
    if (typeof v === 'number' && Number.isFinite(v)) {
      refs.push(v);
      return true;
    }
    if (typeof v === 'string' && v.trim()) {
      refs.push(v.trim());
      return true;
    }
    return false;
  };
  if (obj.column != null) {
    if (!push(obj.column)) return null;
  }
  if (Array.isArray(obj.columns)) {
    for (const c of obj.columns) {
      if (!push(c)) return null;
    }
  }
  if (Array.isArray(obj.columnIndices) || Array.isArray(obj.columnIndexes)) {
    const arr = (obj.columnIndices ?? obj.columnIndexes) as unknown[];
    for (const c of arr) {
      if (!push(c)) return null;
    }
  }
  if (typeof obj.columnIndices === 'string' || typeof obj.columnIndexes === 'string') {
    const raw = String(obj.columnIndices ?? obj.columnIndexes);
    for (const part of raw.split(/[,;\s]+/).filter(Boolean)) {
      if (/^\d+$/.test(part)) refs.push(Number(part));
      else refs.push(part);
    }
  }
  return refs.length > 0 ? refs : null;
}

/**
 * Parse a `table-edit` fence body. Accepts set-cell, delete-rows /
 * keep-rows, or remove-column. Returns null on any shape mismatch so
 * the fence falls through to plain text (same contract as `tryParseEdit`).
 */
export function tryParseTableEdit(body: string): TableEditOp | null {
  try {
    const obj = JSON.parse(body) as Record<string, unknown>;
    if (!obj || typeof obj !== 'object') return null;
    const id = obj.id;
    const summary = obj.summary;
    const table = obj.table ?? obj.tableIndex;
    if (
      typeof id !== 'string' ||
      typeof summary !== 'string' ||
      typeof table !== 'number' ||
      !Number.isInteger(table) ||
      table < 0
    ) {
      return null;
    }
    const rationale = typeof obj.rationale === 'string' ? obj.rationale : '';
    const opRaw =
      typeof obj.operation === 'string'
        ? obj.operation.trim().toLowerCase()
        : typeof obj.op === 'string'
          ? (obj.op as string).trim().toLowerCase()
          : '';

    const indicesRaw =
      obj.rowIndices ?? obj.rows ?? obj.rowRange ?? obj.range ?? null;

    // Column ops before row ops — "delete" alone is ambiguous.
    if (isAddColumnOpName(opRaw)) {
      const fields = parseAddColumnFields(obj);
      if (!fields) return null;
      return {
        kind: 'add-column',
        id,
        summary,
        rationale,
        tableIndex: table,
        header: fields.header,
        at: fields.at,
        fill: fields.fill,
      };
    }

    if (isDeleteColumnsOpName(opRaw)) {
      const columns = parseColumnRefs(obj);
      if (!columns) return null;
      return {
        kind: 'delete-columns',
        id,
        summary,
        rationale,
        tableIndex: table,
        columns,
      };
    }

    if (isDeleteRowsOpName(opRaw) || isKeepOpName(opRaw)) {
      const rows = parseRowIndices(indicesRaw);
      if (!rows || rows.length === 0) return null;
      return {
        kind: 'delete-rows',
        id,
        summary,
        rationale,
        tableIndex: table,
        rows,
        keep: isKeepOpName(opRaw),
      };
    }

    // Bare `operation: "delete"` — prefer rows when rowIndices present,
    // else columns when a column ref is present without a cell value.
    if (opRaw === 'delete' || opRaw === 'remove') {
      if (indicesRaw != null) {
        const rows = parseRowIndices(indicesRaw);
        if (rows && rows.length > 0) {
          return {
            kind: 'delete-rows',
            id,
            summary,
            rationale,
            tableIndex: table,
            rows,
            keep: false,
          };
        }
      }
      if (obj.value == null && obj.row == null) {
        const columns = parseColumnRefs(obj);
        if (columns) {
          return {
            kind: 'delete-columns',
            id,
            summary,
            rationale,
            tableIndex: table,
            columns,
          };
        }
      }
      return null;
    }

    // Infer delete-rows from indices-only payloads (no column/value).
    if (
      indicesRaw != null &&
      obj.column == null &&
      obj.value == null &&
      obj.row == null
    ) {
      const rows = parseRowIndices(indicesRaw);
      if (!rows || rows.length === 0) return null;
      return {
        kind: 'delete-rows',
        id,
        summary,
        rationale,
        tableIndex: table,
        rows,
        keep: false,
      };
    }

    // Infer add-column when a new header name is present without a row.
    if (
      obj.row == null &&
      (typeof obj.name === 'string' ||
        typeof obj.header === 'string' ||
        typeof obj.columnName === 'string') &&
      (obj.at != null || obj.position != null || obj.column != null)
    ) {
      const fields = parseAddColumnFields(obj);
      if (fields) {
        return {
          kind: 'add-column',
          id,
          summary,
          rationale,
          tableIndex: table,
          header: fields.header,
          at: fields.at,
          fill: fields.fill,
        };
      }
    }

    // Infer remove-column: column present, no row/value, no add-name.
    if (
      obj.value == null &&
      obj.row == null &&
      obj.name == null &&
      obj.header == null &&
      (obj.column != null || obj.columns != null || obj.columnIndices != null)
    ) {
      const columns = parseColumnRefs(obj);
      if (columns) {
        return {
          kind: 'delete-columns',
          id,
          summary,
          rationale,
          tableIndex: table,
          columns,
        };
      }
    }

    if (!isSetCellOpName(opRaw)) return null;

    const row = obj.row;
    const column = obj.column;
    const value = obj.value;
    if (
      typeof row !== 'number' ||
      !Number.isInteger(row) ||
      row < 1 ||
      typeof column !== 'string' ||
      column.trim().length === 0 ||
      typeof value !== 'string'
    ) {
      return null;
    }
    return {
      kind: 'set-cell',
      id,
      summary,
      rationale,
      tableIndex: table,
      row,
      column: column.trim(),
      value,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve a parsed table-edit op against the current document into a
 * ProposedEdit that carries `tableEdit` span metadata. Returns null
 * when the table/row/column cannot be resolved (card is not shown).
 */
export function resolveTableEditOp(
  content: string,
  op: TableEditOp
): ProposedEdit | null {
  const tables = parseMarkdownTables(content);
  const table = tables[op.tableIndex];
  if (!table) return null;

  if (op.kind === 'delete-rows') {
    let deleteRows = op.rows;
    if (op.keep) {
      const keep = new Set(op.rows);
      deleteRows = table.rows
        .map((r) => r.row)
        .filter((n) => !keep.has(n));
      if (deleteRows.length === 0) return null;
    }
    deleteRows = deleteRows.filter((n) => n >= 1 && n <= table.rows.length);
    if (deleteRows.length === 0) return null;

    const first = table.rows.find((r) => r.row === deleteRows[0]);
    const last = table.rows.find(
      (r) => r.row === deleteRows[deleteRows.length - 1]
    );
    if (!first || !last) return null;

    const previewLines = deleteRows.slice(0, 3).map((n) => {
      const row = table.rows.find((r) => r.row === n);
      return row?.lineText ?? `r${n}`;
    });
    const more =
      deleteRows.length > 3 ? `\n… (+${deleteRows.length - 3} more rows)` : '';

    const tableEdit: TableEditMeta = {
      kind: 'delete-rows',
      tableIndex: op.tableIndex,
      rows: deleteRows,
      expectedRowCount: table.rows.length,
      expectedFirstDeletedRowText: first.lineText,
      expectedLastDeletedRowText: last.lineText,
      rangeStart: first.lineStart,
      rangeEnd: last.lineEnd,
    };

    return {
      id: op.id,
      summary: op.summary,
      rationale: op.rationale,
      original: previewLines.join('\n') + more,
      replacement: `(delete ${deleteRows.length} row${
        deleteRows.length === 1 ? '' : 's'
      })`,
      tableEdit,
    };
  }

  if (op.kind === 'delete-columns') {
    const indexes = new Set<number>();
    for (const ref of op.columns) {
      const idx = resolveColumnRef(table.headers, ref);
      if (idx < 0) return null;
      indexes.add(idx);
    }
    const columnIndexes = [...indexes].sort((a, b) => a - b);
    if (columnIndexes.length === 0) return null;
    if (table.headers.length - columnIndexes.length < 2) return null;

    const removedHeaders = columnIndexes.map((i) => table.headers[i]);
    const tableEdit: TableEditMeta = {
      kind: 'delete-columns',
      tableIndex: op.tableIndex,
      columnIndexes,
      removedHeaders,
      expectedHeaders: [...table.headers],
      expectedHeaderLineText: table.headerLineText,
      rangeStart: table.start,
      rangeEnd: table.end,
    };

    return {
      id: op.id,
      summary: op.summary,
      rationale: op.rationale,
      original: `Columns: ${removedHeaders.join(', ')}`,
      replacement: `(remove ${removedHeaders.length} column${
        removedHeaders.length === 1 ? '' : 's'
      })`,
      tableEdit,
    };
  }

  if (op.kind === 'add-column') {
    const header = op.header.trim();
    if (!header) return null;
    const lower = header.toLowerCase();
    if (table.headers.some((h) => h.trim().toLowerCase() === lower)) {
      return null;
    }
    // 1-based at → 0-based insertIndex; omit/overflow = append.
    let insertIndex = table.headers.length;
    if (op.at != null) {
      insertIndex = Math.max(0, Math.min(op.at - 1, table.headers.length));
    }
    const tableEdit: TableEditMeta = {
      kind: 'add-column',
      tableIndex: op.tableIndex,
      header,
      insertIndex,
      fill: op.fill,
      expectedHeaders: [...table.headers],
      expectedHeaderLineText: table.headerLineText,
      rangeStart: table.start,
      rangeEnd: table.end,
    };
    const posLabel =
      insertIndex >= table.headers.length
        ? 'at end'
        : `at position ${insertIndex + 1}`;
    return {
      id: op.id,
      summary: op.summary,
      rationale: op.rationale,
      original: `(no column "${header}")`,
      replacement: `Add column "${header}" ${posLabel}${
        op.fill ? ` filled with ${JSON.stringify(op.fill)}` : ' (blank)'
      }`,
      tableEdit,
    };
  }

  const row = table.rows.find((r) => r.row === op.row);
  if (!row) return null;
  const colIdx = findColumnIndex(table.headers, op.column);
  if (colIdx < 0 || colIdx >= row.cells.length) return null;

  const expectedOriginal = row.cells[colIdx];
  const tableEdit: TableEditMeta = {
    kind: 'set-cell',
    tableIndex: op.tableIndex,
    row: op.row,
    column: table.headers[colIdx] ?? op.column,
    expectedOriginal,
    expectedRowText: row.lineText,
    rowStart: row.lineStart,
    rowEnd: row.lineEnd,
  };

  return {
    id: op.id,
    summary: op.summary,
    rationale: op.rationale,
    original: expectedOriginal,
    replacement: op.value,
    tableEdit,
  };
}

/** Convert a ProposedEdit's set-cell tableEdit meta into a CellEdit. */
export function cellEditFromProposed(edit: ProposedEdit): CellEdit | null {
  const meta = edit.tableEdit;
  if (!meta) return null;
  if (
    meta.kind === 'delete-rows' ||
    meta.kind === 'delete-columns' ||
    meta.kind === 'add-column'
  ) {
    return null;
  }
  // kind omitted or 'set-cell'
  return {
    tableIndex: meta.tableIndex,
    row: meta.row,
    column: meta.column,
    value: edit.replacement,
    expectedOriginal: meta.expectedOriginal,
    expectedRowText: meta.expectedRowText,
  };
}

/** Convert a ProposedEdit's delete-rows meta into a DeleteRowsEdit. */
export function deleteRowsEditFromProposed(
  edit: ProposedEdit
): DeleteRowsEdit | null {
  const meta = edit.tableEdit;
  if (!meta || meta.kind !== 'delete-rows') return null;
  if (
    !meta.rows ||
    meta.expectedRowCount == null ||
    meta.expectedFirstDeletedRowText == null ||
    meta.expectedLastDeletedRowText == null
  ) {
    return null;
  }
  return {
    tableIndex: meta.tableIndex,
    rows: meta.rows,
    expectedRowCount: meta.expectedRowCount,
    expectedFirstDeletedRowText: meta.expectedFirstDeletedRowText,
    expectedLastDeletedRowText: meta.expectedLastDeletedRowText,
  };
}

/** Convert a ProposedEdit's delete-columns meta into a DeleteColumnsEdit. */
export function deleteColumnsEditFromProposed(
  edit: ProposedEdit
): DeleteColumnsEdit | null {
  const meta = edit.tableEdit;
  if (!meta || meta.kind !== 'delete-columns') return null;
  return {
    tableIndex: meta.tableIndex,
    columnIndexes: meta.columnIndexes,
    expectedHeaders: meta.expectedHeaders,
    expectedHeaderLineText: meta.expectedHeaderLineText,
  };
}

/** Convert a ProposedEdit's add-column meta into an AddColumnEdit. */
export function addColumnEditFromProposed(
  edit: ProposedEdit
): AddColumnEdit | null {
  const meta = edit.tableEdit;
  if (!meta || meta.kind !== 'add-column') return null;
  return {
    tableIndex: meta.tableIndex,
    header: meta.header,
    insertIndex: meta.insertIndex,
    fill: meta.fill,
    expectedHeaders: meta.expectedHeaders,
    expectedHeaderLineText: meta.expectedHeaderLineText,
  };
}

export type ApplyTableEditResult =
  | (ApplyCellEditResult & { kind: 'set-cell' })
  | (ApplyDeleteRowsResult & { kind: 'delete-rows' })
  | (ApplyDeleteColumnsResult & { kind: 'delete-columns' })
  | (ApplyAddColumnResult & { kind: 'add-column' });

/** Apply whichever table op the ProposedEdit carries. */
export function applyTableEdit(
  content: string,
  edit: ProposedEdit
): ApplyTableEditResult | { ok: false; reason: 'not-table-edit' } {
  const meta = edit.tableEdit;
  if (!meta) return { ok: false, reason: 'not-table-edit' };
  const kind = meta.kind ?? 'set-cell';
  if (kind === 'delete-rows') {
    const del = deleteRowsEditFromProposed(edit);
    if (!del) return { ok: false, reason: 'not-table-edit' };
    return { kind: 'delete-rows', ...applyDeleteRows(content, del) };
  }
  if (kind === 'delete-columns') {
    const del = deleteColumnsEditFromProposed(edit);
    if (!del) return { ok: false, reason: 'not-table-edit' };
    return { kind: 'delete-columns', ...applyDeleteColumns(content, del) };
  }
  if (kind === 'add-column') {
    const add = addColumnEditFromProposed(edit);
    if (!add) return { ok: false, reason: 'not-table-edit' };
    return { kind: 'add-column', ...applyAddColumn(content, add) };
  }
  const cell = cellEditFromProposed(edit);
  if (!cell) return { ok: false, reason: 'not-table-edit' };
  return { kind: 'set-cell', ...applyCellEdit(content, cell) };
}

/**
 * GFM pipe-table model for chat table editing.
 *
 * Pure helpers: detect tables in a markdown document, address cells by
 * (tableIndex, row, column), and apply cell patches by byte span.
 * Detection is deliberately strict (header + delimiter, ≥2 columns,
 * skip fenced code) so prose `|` lines are never treated as tables.
 *
 * The document stays markdown. This module never invents a parallel
 * storage format — it re-parses the live string every time so offsets
 * stay honest after the user hand-edits.
 */

import {
  escapeTableCell,
  unescapeTableCell,
} from '@/utils/csvToMarkdown';

/** One data row inside a detected table (header is separate). */
export interface TableRow {
  /** 1-based data-row number (header is not numbered). */
  row: number;
  /** Decoded cell values, same length as the table header. */
  cells: string[];
  /** Absolute start offset of this row's line in the document. */
  lineStart: number;
  /**
   * Absolute end offset of this row's line content (exclusive of the
   * trailing `\n` when present). `content.slice(lineStart, lineEnd)`
   * is the exact source line.
   */
  lineEnd: number;
  /** Exact source line text (no trailing newline). */
  lineText: string;
}

export interface MarkdownTable {
  /** 0-based index among tables in document order. */
  index: number;
  /** Decoded header cell labels. */
  headers: string[];
  /** Header source line text. */
  headerLineText: string;
  headerLineStart: number;
  headerLineEnd: number;
  /** Delimiter source line text (`| --- | --- |`). */
  delimiterLineText: string;
  delimiterLineStart: number;
  delimiterLineEnd: number;
  rows: TableRow[];
  /** Absolute start of the table block (header line start). */
  start: number;
  /** Absolute end of the table block (last row's lineEnd). */
  end: number;
}

export interface CellEdit {
  tableIndex: number;
  /** 1-based data-row number. */
  row: number;
  /** Column header name (case-sensitive match first, then case-insensitive). */
  column: string;
  /** New decoded cell value (will be escaped on write). */
  value: string;
  /**
   * Expected decoded cell value at Apply time. When the live cell no
   * longer matches, Apply refuses (stale).
   */
  expectedOriginal: string;
  /** Expected exact source line of the row at suggestion time. */
  expectedRowText: string;
}

export type ApplyCellEditResult =
  | {
      ok: true;
      next: string;
      /** Full row before / after for the card + comment re-anchor. */
      originalRow: string;
      replacementRow: string;
      anchor: { idx: number; length: number };
    }
  | {
      ok: false;
      reason: 'table-missing' | 'row-missing' | 'column-missing' | 'stale';
    };

export interface DeleteRowsEdit {
  tableIndex: number;
  /** 1-based data rows to remove. */
  rows: number[];
  expectedRowCount: number;
  expectedFirstDeletedRowText: string;
  expectedLastDeletedRowText: string;
}

export type ApplyDeleteRowsResult =
  | {
      ok: true;
      next: string;
      /** Byte range removed (first deleted line start → last line end + NL). */
      anchor: { idx: number; length: number };
      deletedCount: number;
    }
  | {
      ok: false;
      reason: 'table-missing' | 'row-missing' | 'stale';
    };

export interface DeleteColumnsEdit {
  tableIndex: number;
  /** 0-based indexes to remove. */
  columnIndexes: number[];
  expectedHeaders: string[];
  expectedHeaderLineText: string;
}

export type ApplyDeleteColumnsResult =
  | {
      ok: true;
      next: string;
      anchor: { idx: number; length: number };
      deletedCount: number;
    }
  | {
      ok: false;
      reason:
        | 'table-missing'
        | 'column-missing'
        | 'stale'
        | 'too-few-columns';
    };

export interface AddColumnEdit {
  tableIndex: number;
  header: string;
  /** 0-based insert index; clamp to [0, headers.length]. */
  insertIndex: number;
  fill: string;
  expectedHeaders: string[];
  expectedHeaderLineText: string;
}

export type ApplyAddColumnResult =
  | {
      ok: true;
      next: string;
      anchor: { idx: number; length: number };
    }
  | {
      ok: false;
      reason: 'table-missing' | 'stale' | 'duplicate-header';
    };

/**
 * Replace a table's source block (header→last row) with `block`.
 * Preserves a trailing newline when the original had one.
 */
function spliceTableBlock(
  content: string,
  table: MarkdownTable,
  block: string
): { next: string; anchor: { idx: number; length: number } } {
  let end = table.end;
  let consumedNl = false;
  if (end < content.length && content.charCodeAt(end) === 10) {
    end += 1;
    consumedNl = true;
  }
  const next =
    content.slice(0, table.start) +
    block +
    (consumedNl ? '\n' : '') +
    content.slice(end);
  return {
    next,
    anchor: { idx: table.start, length: block.length },
  };
}

/** GFM delimiter row: at least two columns of `---` with optional `:`. */
const DELIMITER_RE =
  /^\|? *:?-{3,}:? *(?:\| *:?-{3,}:? *)+\|?[ \t]*$/;

/** Opening fence for code blocks (ATX CommonMark §4.5). */
const FENCE_OPEN_RE = /^(`{3,}|~{3,})/;

/**
 * Split `content` into lines with absolute offsets. Trailing `\n` on
 * the last line is optional; empty content yields one empty line at 0.
 */
export function splitLinesWithOffsets(
  content: string
): { text: string; start: number; end: number }[] {
  if (content.length === 0) return [{ text: '', start: 0, end: 0 }];
  const out: { text: string; start: number; end: number }[] = [];
  let start = 0;
  for (let i = 0; i <= content.length; i++) {
    if (i === content.length || content.charCodeAt(i) === 10) {
      out.push({ text: content.slice(start, i), start, end: i });
      start = i + 1;
    }
  }
  return out;
}

/**
 * Split a GFM table row into raw (still-escaped) cell strings.
 * Handles `\|` so a pipe inside a cell is not a separator.
 */
export function splitTableRowCells(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return [];
  // Walk characters; a pipe not preceded by an odd run of `\` is a split.
  const cells: string[] = [];
  let cur = '';
  let i = 0;
  // Drop a single leading `|`.
  if (trimmed.startsWith('|')) i = 1;
  while (i < trimmed.length) {
    const c = trimmed[i];
    if (c === '\\' && trimmed[i + 1] === '|') {
      cur += '\\|';
      i += 2;
      continue;
    }
    if (c === '|') {
      cells.push(cur.trim());
      cur = '';
      i += 1;
      continue;
    }
    cur += c;
    i += 1;
  }
  // Trailing `|` leaves an empty cur we should still push only when
  // the line ended with a non-pipe (last cell). If the line ends with
  // `|`, cur is empty and represents the padding after the last cell
  // — drop it.
  if (cur.length > 0 || !trimmed.endsWith('|')) {
    cells.push(cur.trim());
  } else if (cells.length === 0) {
    // `|` alone — no cells.
  }
  // A line ending with `|` already pushed every cell; empty trailing
  // from a final `|` is not a cell. But `split` of `| a | b |` should
  // yield ["a","b"]. Our walk does that.
  return cells;
}

function isDelimiterRow(line: string): boolean {
  return DELIMITER_RE.test(line.trim());
}

function looksLikeTableRow(line: string): boolean {
  const t = line.trim();
  if (!t.includes('|')) return false;
  // A real table row has at least one pipe that creates ≥2 cells.
  return splitTableRowCells(t).length >= 2;
}

/**
 * Detect GFM pipe tables in `content`. Skips fenced code blocks.
 * Requires a header row, a delimiter row, and ≥2 columns. Body rows
 * are optional (header-only tables are still detected).
 */
export function parseMarkdownTables(content: string): MarkdownTable[] {
  const lines = splitLinesWithOffsets(content);
  const tables: MarkdownTable[] = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].text;
    // Fence toggle — same rule as `collectMarkdownHeadings`: indented
    // fences are not fences (CommonMark §4.5).
    if (
      FENCE_OPEN_RE.test(line.trimStart()) &&
      !line.startsWith('    ')
    ) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    // Need header + delimiter.
    if (i + 1 >= lines.length) continue;
    if (!looksLikeTableRow(line)) continue;
    if (!isDelimiterRow(lines[i + 1].text)) continue;

    const headerCells = splitTableRowCells(line).map(unescapeTableCell);
    if (headerCells.length < 2) continue;

    const headerLine = lines[i];
    const delimLine = lines[i + 1];
    const rows: TableRow[] = [];
    let j = i + 2;
    while (j < lines.length) {
      const body = lines[j];
      // Blank line or non-row ends the table (GFM).
      if (body.text.trim() === '') break;
      if (!looksLikeTableRow(body.text)) break;
      // Another header+delimiter would start a new table — stop.
      if (
        j + 1 < lines.length &&
        isDelimiterRow(lines[j + 1].text) &&
        splitTableRowCells(body.text).length >= 2
      ) {
        break;
      }
      const rawCells = splitTableRowCells(body.text);
      // Pad / trim to header width so column addressing stays stable.
      const cells: string[] = [];
      for (let c = 0; c < headerCells.length; c++) {
        cells.push(unescapeTableCell(rawCells[c] ?? ''));
      }
      rows.push({
        row: rows.length + 1,
        cells,
        lineStart: body.start,
        lineEnd: body.end,
        lineText: body.text,
      });
      j += 1;
    }

    const lastEnd = rows.length > 0 ? rows[rows.length - 1].lineEnd : delimLine.end;
    tables.push({
      index: tables.length,
      headers: headerCells,
      headerLineText: headerLine.text,
      headerLineStart: headerLine.start,
      headerLineEnd: headerLine.end,
      delimiterLineText: delimLine.text,
      delimiterLineStart: delimLine.start,
      delimiterLineEnd: delimLine.end,
      rows,
      start: headerLine.start,
      end: lastEnd,
    });
    i = j - 1;
  }
  return tables;
}

/**
 * True when `[start, end)` overlaps a detected table row (not the
 * header/delimiter alone unless the range is inside that line).
 * Used by Best Effort expansion to clamp holes to a single row.
 */
export function findTableRowContaining(
  tables: MarkdownTable[],
  start: number,
  end: number
): { table: MarkdownTable; row: TableRow } | null {
  for (const table of tables) {
    for (const row of table.rows) {
      if (start < row.lineEnd && end > row.lineStart) {
        return { table, row };
      }
    }
    // Header / delimiter counts as "inside the table" for boundary stops
    // but Best Effort clamping to "one row" only applies to data rows.
  }
  return null;
}

/** True when offset `pos` falls inside any detected table block. */
export function offsetInsideTable(
  tables: MarkdownTable[],
  pos: number
): MarkdownTable | null {
  for (const table of tables) {
    if (pos >= table.start && pos <= table.end) return table;
  }
  return null;
}

/** Resolve a column name to a 0-based index. */
export function findColumnIndex(
  headers: string[],
  column: string
): number {
  const exact = headers.findIndex((h) => h === column);
  if (exact >= 0) return exact;
  const lower = column.trim().toLowerCase();
  return headers.findIndex((h) => h.trim().toLowerCase() === lower);
}

/**
 * Resolve a column reference to a 0-based index. Accepts header names
 * and positional forms: `6`, `"6"`, `"c6"`, `"col 6"`, `"column 6"`
 * (1-based). Falls back to 0-based when the number is in range and
 * 1-based is out of range.
 */
export function resolveColumnRef(
  headers: string[],
  ref: string | number
): number {
  if (typeof ref === 'number') {
    if (!Number.isInteger(ref)) return -1;
    if (ref >= 1 && ref <= headers.length) return ref - 1;
    if (ref >= 0 && ref < headers.length) return ref;
    return -1;
  }
  const byName = findColumnIndex(headers, ref);
  if (byName >= 0) return byName;
  const m = /^(?:columns?|cols?|c)?\s*#?\s*(\d+)$/i.exec(ref.trim());
  if (!m) return -1;
  return resolveColumnRef(headers, Number(m[1]));
}

/** Serialize a GFM delimiter row for `colCount` columns. */
export function serializeDelimiterRow(
  colCount: number,
  styleSample?: string
): string {
  const sample = styleSample?.trim() ?? '';
  const padded = !sample || /\| .+ \|/.test(sample) || sample.includes(' | ');
  const cells = Array.from({ length: colCount }, () => '---');
  if (padded) return `| ${cells.join(' | ')} |`;
  return `|${cells.join('|')}|`;
}

/**
 * Rebuild a table row line preserving the original pipe padding style
 * when possible: leading `| `, ` | ` separators, trailing ` |`.
 */
export function serializeTableRow(
  cells: string[],
  styleSample?: string
): string {
  const escaped = cells.map((c) => escapeTableCell(c));
  // Detect style from sample: `| a | b |` vs `|a|b|`.
  const sample = styleSample?.trim() ?? '';
  const padded = !sample || /\| .+ \|/.test(sample) || sample.includes(' | ');
  if (padded) {
    return `| ${escaped.join(' | ')} |`;
  }
  return `|${escaped.join('|')}|`;
}

/**
 * Apply one cell edit against `content`. Re-parses the live document,
 * verifies the expected row/cell, rebuilds that one row, and splices.
 */
export function applyCellEdit(
  content: string,
  edit: CellEdit
): ApplyCellEditResult {
  const tables = parseMarkdownTables(content);
  const table = tables[edit.tableIndex];
  if (!table) return { ok: false, reason: 'table-missing' };

  const row = table.rows.find((r) => r.row === edit.row);
  if (!row) return { ok: false, reason: 'row-missing' };

  if (row.lineText !== edit.expectedRowText) {
    return { ok: false, reason: 'stale' };
  }

  const colIdx = findColumnIndex(table.headers, edit.column);
  if (colIdx < 0 || colIdx >= row.cells.length) {
    return { ok: false, reason: 'column-missing' };
  }

  if (row.cells[colIdx] !== edit.expectedOriginal) {
    return { ok: false, reason: 'stale' };
  }

  const nextCells = row.cells.slice();
  nextCells[colIdx] = edit.value;
  const replacementRow = serializeTableRow(nextCells, row.lineText);

  // Preserve whether the source line had no trailing content quirks —
  // replace exactly `[lineStart, lineEnd)`.
  const next =
    content.slice(0, row.lineStart) +
    replacementRow +
    content.slice(row.lineEnd);

  return {
    ok: true,
    next,
    originalRow: row.lineText,
    replacementRow,
    anchor: { idx: row.lineStart, length: replacementRow.length },
  };
}

/**
 * Apply many cell edits. Spans are re-resolved after each successful
 * splice so later edits see the updated document. Failures are skipped
 * (caller inspects results).
 */
export function applyCellEdits(
  content: string,
  edits: CellEdit[]
): {
  next: string;
  applied: Array<{
    edit: CellEdit;
    originalRow: string;
    replacementRow: string;
    anchor: { idx: number; length: number };
  }>;
  skipped: Array<{ edit: CellEdit; reason: ApplyCellEditResult & { ok: false } }>;
} {
  let next = content;
  const applied: Array<{
    edit: CellEdit;
    originalRow: string;
    replacementRow: string;
    anchor: { idx: number; length: number };
  }> = [];
  const skipped: Array<{
    edit: CellEdit;
    reason: ApplyCellEditResult & { ok: false };
  }> = [];

  for (const edit of edits) {
    // After prior splices, expectedRowText may be stale if two edits
    // target the same row. Re-read expectedOriginal against live cells
    // but keep expectedRowText updated from the last successful same-row
    // apply when possible.
    const liveEdit: CellEdit = { ...edit };
    if (applied.length > 0) {
      const priorSame = [...applied]
        .reverse()
        .find(
          (a) =>
            a.edit.tableIndex === edit.tableIndex && a.edit.row === edit.row
        );
      if (priorSame) {
        liveEdit.expectedRowText = priorSame.replacementRow;
        // expectedOriginal for a different column is still the value
        // from suggestion time unless that column was also edited —
        // re-parse to get the live cell.
        const tables = parseMarkdownTables(next);
        const t = tables[edit.tableIndex];
        const r = t?.rows.find((row) => row.row === edit.row);
        const colIdx = t ? findColumnIndex(t.headers, edit.column) : -1;
        if (r && colIdx >= 0) {
          liveEdit.expectedOriginal = r.cells[colIdx];
          liveEdit.expectedRowText = r.lineText;
        }
      }
    }

    const result = applyCellEdit(next, liveEdit);
    if (!result.ok) {
      skipped.push({ edit, reason: result });
      continue;
    }
    next = result.next;
    applied.push({
      edit,
      originalRow: result.originalRow,
      replacementRow: result.replacementRow,
      anchor: result.anchor,
    });
  }
  return { next, applied, skipped };
}

/**
 * Remove one source line including its trailing newline when present.
 * Returns the next document and the absolute end offset that was cut.
 */
function removeLineAt(
  content: string,
  lineStart: number,
  lineEnd: number
): { next: string; removedEnd: number } {
  let end = lineEnd;
  if (end < content.length && content.charCodeAt(end) === 10) {
    end += 1;
  }
  return {
    next: content.slice(0, lineStart) + content.slice(end),
    removedEnd: end,
  };
}

/**
 * Delete data rows from a table. Re-parses the live document, checks
 * row-count + first/last deleted row fingerprints, then removes lines
 * from highest index to lowest so earlier offsets stay valid.
 */
export function applyDeleteRows(
  content: string,
  edit: DeleteRowsEdit
): ApplyDeleteRowsResult {
  const tables = parseMarkdownTables(content);
  const table = tables[edit.tableIndex];
  if (!table) return { ok: false, reason: 'table-missing' };

  if (table.rows.length !== edit.expectedRowCount) {
    return { ok: false, reason: 'stale' };
  }

  const unique = [...new Set(edit.rows)]
    .filter((n) => Number.isInteger(n) && n >= 1)
    .sort((a, b) => a - b);
  if (unique.length === 0) return { ok: false, reason: 'row-missing' };

  const first = table.rows.find((r) => r.row === unique[0]);
  const last = table.rows.find((r) => r.row === unique[unique.length - 1]);
  if (!first || !last) return { ok: false, reason: 'row-missing' };
  if (first.lineText !== edit.expectedFirstDeletedRowText) {
    return { ok: false, reason: 'stale' };
  }
  if (last.lineText !== edit.expectedLastDeletedRowText) {
    return { ok: false, reason: 'stale' };
  }

  // Contiguous fast path: one splice from first.lineStart through the
  // newline after last.lineEnd.
  const contiguous =
    unique[unique.length - 1] - unique[0] + 1 === unique.length &&
    unique.every((n, i) => n === unique[0] + i);

  if (contiguous) {
    let end = last.lineEnd;
    if (end < content.length && content.charCodeAt(end) === 10) end += 1;
    const next =
      content.slice(0, first.lineStart) + content.slice(end);
    return {
      ok: true,
      next,
      anchor: { idx: first.lineStart, length: 0 },
      deletedCount: unique.length,
    };
  }

  // Non-contiguous: delete high→low.
  let next = content;
  const descending = [...unique].sort((a, b) => b - a);
  for (const rowNum of descending) {
    const live = parseMarkdownTables(next)[edit.tableIndex];
    if (!live) return { ok: false, reason: 'table-missing' };
    const row = live.rows.find((r) => r.row === rowNum);
    if (!row) return { ok: false, reason: 'row-missing' };
    next = removeLineAt(next, row.lineStart, row.lineEnd).next;
  }
  return {
    ok: true,
    next,
    anchor: { idx: first.lineStart, length: 0 },
    deletedCount: unique.length,
  };
}

/**
 * Delete one or more columns from a table by rewriting the header,
 * delimiter, and every data row. Refuses when fewer than 2 columns
 * would remain, or when headers no longer match the suggestion.
 */
export function applyDeleteColumns(
  content: string,
  edit: DeleteColumnsEdit
): ApplyDeleteColumnsResult {
  const tables = parseMarkdownTables(content);
  const table = tables[edit.tableIndex];
  if (!table) return { ok: false, reason: 'table-missing' };

  if (
    table.headers.length !== edit.expectedHeaders.length ||
    table.headers.some((h, i) => h !== edit.expectedHeaders[i]) ||
    table.headerLineText !== edit.expectedHeaderLineText
  ) {
    return { ok: false, reason: 'stale' };
  }

  const drop = new Set(
    edit.columnIndexes.filter(
      (i) => Number.isInteger(i) && i >= 0 && i < table.headers.length
    )
  );
  if (drop.size === 0) return { ok: false, reason: 'column-missing' };

  const keepIdx = table.headers
    .map((_, i) => i)
    .filter((i) => !drop.has(i));
  if (keepIdx.length < 2) return { ok: false, reason: 'too-few-columns' };

  const newHeaders = keepIdx.map((i) => table.headers[i]);
  const headerLine = serializeTableRow(newHeaders, table.headerLineText);
  const delimLine = serializeDelimiterRow(
    newHeaders.length,
    table.delimiterLineText
  );
  const bodyLines = table.rows.map((row) =>
    serializeTableRow(
      keepIdx.map((i) => row.cells[i] ?? ''),
      row.lineText
    )
  );
  const block = [headerLine, delimLine, ...bodyLines].join('\n');
  const spliced = spliceTableBlock(content, table, block);
  return {
    ok: true,
    next: spliced.next,
    anchor: spliced.anchor,
    deletedCount: drop.size,
  };
}

/**
 * Insert a column at `insertIndex` (0-based). Existing headers must
 * still match; refuses a duplicate header name (case-insensitive).
 */
export function applyAddColumn(
  content: string,
  edit: AddColumnEdit
): ApplyAddColumnResult {
  const tables = parseMarkdownTables(content);
  const table = tables[edit.tableIndex];
  if (!table) return { ok: false, reason: 'table-missing' };

  if (
    table.headers.length !== edit.expectedHeaders.length ||
    table.headers.some((h, i) => h !== edit.expectedHeaders[i]) ||
    table.headerLineText !== edit.expectedHeaderLineText
  ) {
    return { ok: false, reason: 'stale' };
  }

  const header = edit.header.trim();
  if (!header) return { ok: false, reason: 'stale' };
  const lower = header.toLowerCase();
  if (table.headers.some((h) => h.trim().toLowerCase() === lower)) {
    return { ok: false, reason: 'duplicate-header' };
  }

  const insertAt = Math.max(
    0,
    Math.min(edit.insertIndex, table.headers.length)
  );
  const newHeaders = [
    ...table.headers.slice(0, insertAt),
    header,
    ...table.headers.slice(insertAt),
  ];
  const headerLine = serializeTableRow(newHeaders, table.headerLineText);
  const delimLine = serializeDelimiterRow(
    newHeaders.length,
    table.delimiterLineText
  );
  const bodyLines = table.rows.map((row) => {
    const cells = [
      ...row.cells.slice(0, insertAt),
      edit.fill,
      ...row.cells.slice(insertAt),
    ];
    // Pad if a ragged row was shorter than insertAt.
    while (cells.length < newHeaders.length) cells.push('');
    return serializeTableRow(cells.slice(0, newHeaders.length), row.lineText);
  });
  const block = [headerLine, delimLine, ...bodyLines].join('\n');
  const spliced = spliceTableBlock(content, table, block);
  return { ok: true, next: spliced.next, anchor: spliced.anchor };
}

/**
 * Hard cap on characters inlined into `sys-table-context`. Large
 * sheets degrade to header + first N rows + a truncation note.
 */
export const TABLE_CONTEXT_CHARS_CAP = 6000;

/**
 * Build the `sys-table-context` body for the chat prompt. Returns
 * `null` when the document has no tables.
 */
export function buildTableContextMessage(
  content: string,
  options?: { compact?: boolean; charCap?: number }
): string | null {
  const tables = parseMarkdownTables(content);
  if (tables.length === 0) return null;

  const compact = options?.compact ?? false;
  const cap = options?.charCap ?? TABLE_CONTEXT_CHARS_CAP;
  const parts: string[] = [];
  parts.push(
    `The open document contains ${tables.length} Markdown table` +
      `${tables.length === 1 ? '' : 's'}. Prefer a \`\`\`table-edit fence ` +
      `(not proposed-edit). Ops:\n` +
      `1) set-cell — {"id","summary","table":0,"row":1,"column":"<header>","value":"<new>"}\n` +
      `2) delete-rows — {"id","summary","operation":"delete-rows","table":0,"rowIndices":"r51-r636"}\n` +
      `3) keep-rows — {"id","summary","operation":"keep-rows","table":0,"rowIndices":"r1-r50"}\n` +
      `4) remove-column — {"id","summary","operation":"remove-column","table":0,"column":"Column 6"}\n` +
      `   (column may be a header name or 1-based index like "6" / "c6")\n` +
      `5) add-column — {"id","summary","operation":"add-column","table":0,"column":"summary","at":6,"value":""}\n` +
      `   (inserts a blank column named "summary" at 1-based position 6; omit at to append)\n` +
      `Address data rows by rN below (header is not a data row). ` +
      `Use only these operations. Do not fake add-column with set-cell.`
  );

  let used = parts.join('\n').length;

  for (const table of tables) {
    const header =
      `--- TABLE ${table.index} (${table.headers.length} columns × ` +
      `${table.rows.length} data rows) ---\n` +
      `Columns: ${table.headers.join(' | ')}\n`;

    if (compact) {
      // Local Gemma already has the body in <<<DOCUMENT>>> — emit
      // schema + row count only so we do not double-pay tokens.
      const block =
        header +
        `Rows: r1…r${table.rows.length} (read cell values from ` +
        `<<<DOCUMENT>>>). Prefer table-edit fences.\n` +
        `--- END TABLE ${table.index} ---`;
      if (used + block.length > cap) {
        parts.push(
          `--- TABLE ${table.index} truncated (prompt budget) ---`
        );
        break;
      }
      parts.push(block);
      used += block.length;
      continue;
    }

    const rowLines: string[] = [];
    let truncated = false;
    for (const row of table.rows) {
      const line =
        `r${row.row}: ` +
        table.headers
          .map((h, i) => `${h}=${stringifyCellForPrompt(row.cells[i] ?? '')}`)
          .join(', ');
      if (used + header.length + rowLines.join('\n').length + line.length + 40 > cap) {
        truncated = true;
        break;
      }
      rowLines.push(line);
    }
    const block =
      header +
      (rowLines.length > 0 ? rowLines.join('\n') + '\n' : '') +
      (truncated
        ? `(truncated after r${rowLines.length} of ${table.rows.length} rows)\n`
        : '') +
      `--- END TABLE ${table.index} ---`;
    parts.push(block);
    used += block.length;
    if (truncated) break;
  }

  return parts.join('\n\n');
}

function stringifyCellForPrompt(value: string): string {
  // Keep prompt readable; quote only when the value has commas/newlines.
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

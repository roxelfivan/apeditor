/**
 * CSV / TSV → GitHub-flavoured Markdown table.
 *
 * This is the third import path in the app (after OCR and the JSON
 * backup). Unlike OCR it makes **zero network calls** and needs no
 * API key: a table conversion is deterministic, so it runs entirely
 * in the browser and cannot be mangled by a model.
 *
 * The whole file is treated as *delimited text*. CSV and TSV are the
 * same format family — the only difference is the delimiter — so one
 * button handles both and the delimiter is detected from the content.
 *
 * Design notes (each one is load-bearing; see `scripts/test-csv-to-markdown.mjs`):
 *
 *   - **Delimiter detection is quote-aware.** Naive character counting
 *     mis-detects the common `de-DE` Excel export `Name;Preis` /
 *     `3,50`, where the comma is both the decimal separator and a
 *     candidate delimiter. We instead parse the file once per
 *     candidate and score by column-count uniformity.
 *   - **Cell escaping order matters.** Backslash must be escaped
 *     before the pipe, and `&` before `<`/`>`, or data is silently
 *     corrupted (`a\|b` → `a\`, and `&lt;` double-decodes to `<`).
 *   - **Numeric alignment is opt-in and integer-only.** `3.50` and
 *     `3,50` are indistinguishable by regex, and a leading-zero ID
 *     (`007`) looks numeric. Right-aligning an ID column is a visible
 *     data error, so we do not guess.
 *
 * The conversion is *literal*: a CSV carries no type information, so
 * currency, percentages, dates, and leading-zero IDs are reproduced as
 * text rather than interpreted.
 */

/** File picker accept list — CSV, TSV, and Excel's tab-delimited `.txt`. */
export const CSV_FILE_ACCEPT =
  '.csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain';

/** Per-file size limit in bytes (10 MB). */
export const CSV_MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Maximum number of data rows (excluding the header). */
export const CSV_MAX_ROWS = 20000;

/** Delimiters we know how to detect. */
export type CsvDelimiter = ',' | ';' | '\t';

const CANDIDATE_DELIMITERS: CsvDelimiter[] = [',', ';', '\t'];

/** User-facing import failure. The message is shown verbatim. */
export class CsvImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvImportError';
  }
}

/**
 * Decode raw file bytes to text.
 *
 * Excel on Windows still emits UTF-16 CSV (`FF FE` BOM), and `File.text()`
 * would decode that as UTF-8 and produce mojibake. We sniff the BOM
 * first, then fall back to UTF-8.
 */
export function decodeCsvBytes(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  // UTF-16LE BOM: FF FE. UTF-16BE BOM: FE FF.
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  // UTF-8 BOM: EF BB BF.
  const start =
    bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
      ? 3
      : 0;
  return new TextDecoder('utf-8').decode(bytes.subarray(start));
}

/**
 * Parse delimited text into rows of fields (RFC 4180, delimiter-
 * parameterised).
 *
 * Handles quoted fields, `""` escapes, delimiters and newlines inside
 * quotes, CRLF, and a trailing newline (which must not produce an
 * empty final row).
 */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        // `""` inside a quoted field is a literal quote.
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === delimiter) {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (c === '\r') {
      // Swallow CR; the following LF ends the record.
      i += 1;
      continue;
    }
    if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }

  // A trailing delimiter or field at EOF still belongs to a record.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/**
 * Detect the delimiter by parsing the file once per candidate and
 * scoring by column-count uniformity.
 *
 * Score = (modal column count) x (share of rows with that count).
 * A candidate whose modal column count is 1 is rejected — a real table
 * has at least two columns — so a single-column file falls back to `,`
 * instead of being split on every stray character.
 *
 * `filenameHint` only breaks ties; content always wins, so a file
 * named `.csv` that actually contains tabs still imports correctly.
 */
export function detectDelimiter(text: string, filenameHint?: string): CsvDelimiter {
  let best: CsvDelimiter | null = null;
  let bestScore = -1;

  for (const candidate of CANDIDATE_DELIMITERS) {
    const rows = parseCsv(text, candidate).filter((r) =>
      r.some((cell) => cell.trim().length > 0)
    );
    if (rows.length === 0) continue;

    const tally = new Map<number, number>();
    for (const r of rows) tally.set(r.length, (tally.get(r.length) ?? 0) + 1);

    let modal = 1;
    let modalCount = 0;
    for (const [count, hits] of tally) {
      if (hits > modalCount || (hits === modalCount && count > modal)) {
        modal = count;
        modalCount = hits;
      }
    }
    if (modal < 2) continue;

    const score = modal * (modalCount / rows.length);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  if (best) return best;

  // No candidate produced a multi-column table. A `.tsv` hint with
  // single-column content still means tab, so honour it before the
  // comma fallback.
  if (filenameHint?.toLowerCase().endsWith('.tsv')) return '\t';
  return ',';
}

/**
 * Normalise rows before the header is chosen:
 *   - drop fully-blank rows (Excel exports often start with them),
 *   - drop trailing all-empty columns (a stray `,` on every row is a
 *     common artefact and would otherwise add an empty column plus a
 *     spurious `---`).
 */
export function trimRows(rows: string[][]): string[][] {
  const kept = rows.filter((r) => r.some((cell) => cell.trim().length > 0));
  if (kept.length === 0) return kept;

  let width = Math.max(...kept.map((r) => r.length));
  while (width > 1) {
    const lastEmpty = kept.every((r) => (r[width - 1] ?? '').trim().length === 0);
    if (!lastEmpty) break;
    width -= 1;
  }
  return kept.map((r) => r.slice(0, width));
}

/**
 * Escape a cell for a GFM table cell.
 *
 * The order is load-bearing:
 *   1. `\` first — otherwise `a\|b` would escape the pipe we add next
 *      and render as `a\`.
 *   2. `&` before `<`/`>` — otherwise a cell containing `&lt;` would
 *      be double-decoded into `<`.
 *   3. `|` — structural; a raw pipe splits the cell.
 *   4. `<` / `>` — `rehype-raw` parses raw tags and `rehype-sanitize`
 *      allows `b`, `i`, `em` by default, so an unescaped `<b>` in a
 *      cell becomes real bold markup.
 */
export function escapeTableCell(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, '\\\\')
    .replace(/&/g, '&amp;')
    .replace(/\|/g, '\\|')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, '<br>');
}

/**
 * Inverse of `escapeTableCell`. Order is load-bearing and the reverse
 * of the escape path: entities first (`&amp;` last), then `\|`, then
 * doubled backslashes, then `<br>` → newline. Used when the table
 * model surfaces decoded cell values to the AI and when Apply
 * compares the live cell to an `expectedOriginal`.
 */
export function unescapeTableCell(escaped: string): string {
  return escaped
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\\\|/g, '|')
    .replace(/\\\\/g, '\\')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * A column is right-aligned only when every non-empty body cell is an
 * unambiguous integer quantity.
 *
 * Deliberately conservative: decimals are ambiguous (`3.50` is a US
 * decimal, `3,50` an EU one), currency and percentages are not
 * numbers, and a leading-zero ID (`007`) looks numeric but is an
 * identifier, not a quantity. Right-aligning an ID column is a visible
 * data error, so the leading zero disqualifies the column.
 */
function isIntegerColumn(cells: string[]): boolean {
  const values = cells.map((c) => c.trim()).filter((c) => c.length > 0);
  if (values.length === 0) return false;
  // `0`, `12`, `-5` are quantities. `007` and `-007` are identifiers.
  return values.every((v) => /^-?(0|[1-9]\d*)$/.test(v));
}

export interface CsvToMarkdownOptions {
  /**
   * Right-align columns that contain only integers. Off by default —
   * see `isIntegerColumn`.
   */
  alignNumericColumns?: boolean;
}

/**
 * Convert parsed rows into a GFM pipe table.
 *
 * The first row is the header. Every row is padded to the widest row,
 * because GFM silently drops extra cells and mis-renders missing ones.
 */
export function csvToMarkdown(
  rows: string[][],
  options?: CsvToMarkdownOptions
): string {
  if (rows.length === 0) {
    throw new CsvImportError('The file has no rows to convert.');
  }

  const width = Math.max(...rows.map((r) => r.length));
  if (width < 1) {
    throw new CsvImportError('The file has no columns to convert.');
  }

  const padded = rows.map((r) => {
    const copy = r.slice(0, width);
    while (copy.length < width) copy.push('');
    return copy;
  });

  const header = padded[0];
  const body = padded.slice(1);

  // An empty header cell gets a positional name so the table still has
  // a readable header row.
  const headerCells = header.map((cell, i) => {
    const trimmed = cell.trim();
    return trimmed.length > 0 ? trimmed : `Column ${i + 1}`;
  });

  const alignNumeric = options?.alignNumericColumns ?? false;
  const separators = headerCells.map((_, i) =>
    alignNumeric && isIntegerColumn(body.map((r) => r[i] ?? '')) ? '---:' : '---'
  );

  const lines: string[] = [];
  lines.push(`| ${headerCells.map(escapeTableCell).join(' | ')} |`);
  lines.push(`| ${separators.join(' | ')} |`);
  for (const row of body) {
    lines.push(`| ${row.map(escapeTableCell).join(' | ')} |`);
  }
  // Terminate the table with a blank line.
  //
  // GFM keeps consuming lines that look like table rows. If the table
  // is not closed by a blank line, whatever comes next in the document
  // is absorbed into the table and disappears from the rendered page.
  // Verified against the app's own plugin chain:
  //
  //   `| x |**Welcome**`  -> last cell reads "Welcome", text is gone.
  //   `| x |\n**Welcome**` -> an extra table row, text is gone.
  //   `| x |\n\n**Welcome**` -> the text stays a paragraph. Correct.
  //
  // One trailing newline is not enough — it needs a real blank line.
  return lines.join('\n') + '\n\n';
}

/**
 * Convert a file's raw bytes into a Markdown table.
 *
 * `filename` is used only as a tie-breaker for delimiter detection.
 * Throws `CsvImportError` with a user-facing message on any failure.
 */
export function buildCsvMarkdownTable(
  buffer: ArrayBuffer,
  options?: CsvToMarkdownOptions & { filename?: string }
): string {
  const text = decodeCsvBytes(buffer);
  if (text.trim().length === 0) {
    throw new CsvImportError('That file is empty.');
  }

  const delimiter = detectDelimiter(text, options?.filename);
  const rows = trimRows(parseCsv(text, delimiter));
  if (rows.length === 0) {
    throw new CsvImportError('That file has no rows to convert.');
  }

  const bodyRows = rows.length - 1;
  if (bodyRows > CSV_MAX_ROWS) {
    throw new CsvImportError(
      `That file has ${bodyRows.toLocaleString()} rows — the limit is ${CSV_MAX_ROWS.toLocaleString()}. Split it or import part of it.`
    );
  }

  return csvToMarkdown(rows, options);
}

/**
 * Validate the file size before we materialise the bytes in memory.
 * Returns an error message, or `null` when the file is acceptable.
 */
export function validateCsvFile(file: { name: string; size: number }): string | null {
  if (file.size > CSV_MAX_FILE_BYTES) {
    const limitMB = (CSV_MAX_FILE_BYTES / (1024 * 1024)).toFixed(0);
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
    return `${file.name} is ${sizeMB} MB — limit is ${limitMB} MB. Split it or trim the columns before importing.`;
  }
  return null;
}

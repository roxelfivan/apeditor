import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'csv-md-'));
const SOURCE = path.join(ROOT, 'src/utils/csvToMarkdown.ts');

await build({
  entryPoints: [SOURCE],
  outfile: path.join(TMP_DIR, 'bundle.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
});

const {
  CsvImportError,
  CSV_MAX_FILE_BYTES,
  CSV_MAX_ROWS,
  buildCsvMarkdownTable,
  csvToMarkdown,
  decodeCsvBytes,
  detectDelimiter,
  escapeTableCell,
  parseCsv,
  trimRows,
  validateCsvFile,
} = await import(pathToFileURL(path.join(TMP_DIR, 'bundle.mjs')).href);

/** Encode a string as UTF-8 bytes. */
function utf8(str) {
  return new TextEncoder().encode(str);
}

/** Encode a string as UTF-16LE bytes with a BOM, like Excel on Windows. */
function utf16leWithBom(str) {
  const out = [0xff, 0xfe];
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    out.push(code & 0xff, (code >> 8) & 0xff);
  }
  return new Uint8Array(out);
}

/** Build an ArrayBuffer from a byte array. */
function toBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log('csv to markdown tests\n');

/* ---------------------------------------------------------------------
 * Delimiter detection
 * ------------------------------------------------------------------ */

test('detects a comma-delimited file', () => {
  assert.equal(detectDelimiter('A,B,C\n1,2,3\n4,5,6\n'), ',');
});

test('detects a semicolon-delimited file (de-DE Excel export)', () => {
  // The comma is both the decimal separator and a candidate delimiter,
  // so naive counting picks the wrong one.
  assert.equal(detectDelimiter('Name;Preis;Menge\nWidget;3,50;12\n'), ';');
});

test('detects a tab-delimited file', () => {
  assert.equal(detectDelimiter('A\tB\n1\t2\n'), '\t');
});

test('content beats the file extension', () => {
  // A .csv file that actually contains tabs must still be read as TSV.
  assert.equal(detectDelimiter('A\tB\n1\t2\n', 'table.csv'), '\t');
});

test('a comma inside a quoted cell is not a delimiter', () => {
  assert.equal(detectDelimiter('A,B\n"x,y",2\n'), ',');
  const rows = parseCsv('A,B\n"x,y",2\n', ',');
  assert.deepEqual(rows[1], ['x,y', '2']);
});

test('a single-column file falls back to comma without crashing', () => {
  assert.equal(detectDelimiter('A\n1\n2\n'), ',');
});

test('the .tsv hint wins when nothing else qualifies', () => {
  assert.equal(detectDelimiter('only one column\n', 'data.tsv'), '\t');
});

/* ---------------------------------------------------------------------
 * Parsing
 * ------------------------------------------------------------------ */

test('parses quoted fields, escaped quotes, and embedded newlines', () => {
  const rows = parseCsv('a,"b,c","d""e","f\ng"\n', ',');
  assert.deepEqual(rows, [['a', 'b,c', 'd"e', 'f\ng']]);
});

test('handles CRLF line endings', () => {
  const rows = parseCsv('A,B\r\n1,2\r\n', ',');
  assert.deepEqual(rows, [
    ['A', 'B'],
    ['1', '2'],
  ]);
});

test('a trailing newline does not create an empty row', () => {
  assert.equal(parseCsv('A,B\n1,2\n', ',').length, 2);
});

/* ---------------------------------------------------------------------
 * Decoding
 * ------------------------------------------------------------------ */

test('strips a UTF-8 BOM', () => {
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('A,B')]);
  assert.equal(decodeCsvBytes(toBuffer(bytes)), 'A,B');
});

test('decodes UTF-16LE with a BOM (Excel on Windows)', () => {
  const text = decodeCsvBytes(toBuffer(utf16leWithBom('A,B\n1,2\n')));
  assert.equal(text, 'A,B\n1,2\n');
  assert.deepEqual(parseCsv(text, ','), [
    ['A', 'B'],
    ['1', '2'],
  ]);
});

test('decodes plain UTF-8', () => {
  assert.equal(decodeCsvBytes(toBuffer(utf8('Name;Preis\n'))), 'Name;Preis\n');
});

/* ---------------------------------------------------------------------
 * Row / column normalisation
 * ------------------------------------------------------------------ */

test('drops leading blank rows', () => {
  const rows = trimRows(parseCsv('\n\nName,Qty\nW,1\n', ','));
  assert.deepEqual(rows, [
    ['Name', 'Qty'],
    ['W', '1'],
  ]);
});

test('drops a trailing all-empty column', () => {
  const rows = trimRows(parseCsv('A,B,C,\n1,2,3,\n', ','));
  assert.deepEqual(rows, [
    ['A', 'B', 'C'],
    ['1', '2', '3'],
  ]);
});

/* ---------------------------------------------------------------------
 * Cell escaping
 * ------------------------------------------------------------------ */

test('escapes a pipe inside a cell', () => {
  assert.equal(escapeTableCell('a|b'), 'a\\|b');
});

test('escapes a backslash before the pipe', () => {
  // Without the backslash pass first this would render as "a\".
  assert.equal(escapeTableCell('a\\|b'), 'a\\\\\\|b');
});

test('escapes an ampersand before the angle brackets', () => {
  assert.equal(escapeTableCell('Tom & Jerry'), 'Tom &amp; Jerry');
  assert.equal(escapeTableCell('a &lt; b'), 'a &amp;lt; b');
});

test('escapes angle brackets so raw HTML cannot survive', () => {
  assert.equal(escapeTableCell('<b>raw</b>'), '&lt;b&gt;raw&lt;/b&gt;');
});

test('turns an embedded newline into a line break', () => {
  assert.equal(escapeTableCell('line1\nline2'), 'line1<br>line2');
});

/* ---------------------------------------------------------------------
 * Table building
 * ------------------------------------------------------------------ */

test('builds a pipe table with a header and separator row', () => {
  const md = csvToMarkdown([
    ['Name', 'Qty'],
    ['Widget', '12'],
  ]);
  assert.equal(
    md,
    ['| Name | Qty |', '| --- | --- |', '| Widget | 12 |', '', ''].join('\n')
  );
});

test('terminates the table with a blank line', () => {
  // GFM keeps consuming lines that look like table rows, so without a
  // trailing blank line the following document content is absorbed
  // into the table and vanishes from the rendered page. One trailing
  // newline is not enough — it needs a real blank line.
  const md = csvToMarkdown([
    ['A'],
    ['x'],
  ]);
  assert.ok(md.endsWith('|\n\n'), JSON.stringify(md));
});

test('pads ragged rows to a uniform width', () => {
  const md = csvToMarkdown([
    ['A', 'B', 'C'],
    ['1', '2'],
    ['3', '4', '5'],
  ]);
  const rows = md.split('\n').filter((r) => r.length > 0);
  assert.equal(rows.length, 4);
  assert.ok(rows.every((r) => r.split('|').length === 5), 'every row has 3 cells');
});

test('names an empty header cell positionally', () => {
  const md = csvToMarkdown([
    ['', 'Qty'],
    ['Widget', '12'],
  ]);
  assert.ok(md.startsWith('| Column 1 | Qty |'));
});

test('numeric alignment is off by default', () => {
  const md = csvToMarkdown([
    ['Name', 'Qty'],
    ['Widget', '12'],
  ]);
  assert.ok(md.includes('| --- | --- |'));
});

test('integer columns are right-aligned when alignment is enabled', () => {
  const md = csvToMarkdown(
    [
      ['Name', 'Qty'],
      ['Widget', '12'],
    ],
    { alignNumericColumns: true }
  );
  assert.ok(md.includes('| --- | ---: |'), md);
});

test('decimals, currency, and leading-zero IDs are not right-aligned', () => {
  for (const value of ['3.50', '3,50', '$45.50', '45%', '007']) {
    const md = csvToMarkdown(
      [
        ['Label', 'Value'],
        ['x', value],
      ],
      { alignNumericColumns: true }
    );
    assert.ok(md.includes('| --- | --- |'), `${value} should not be aligned: ${md}`);
  }
});

/* ---------------------------------------------------------------------
 * End to end
 * ------------------------------------------------------------------ */

test('converts a CSV end to end', () => {
  const md = buildCsvMarkdownTable(toBuffer(utf8('Name,Qty\nWidget,12\n')));
  assert.equal(
    md,
    ['| Name | Qty |', '| --- | --- |', '| Widget | 12 |', '', ''].join('\n')
  );
});

test('converts a TSV end to end identically to the equivalent CSV', () => {
  const csv = buildCsvMarkdownTable(toBuffer(utf8('Name,Qty\nWidget,12\n')));
  const tsv = buildCsvMarkdownTable(
    toBuffer(utf8('Name\tQty\nWidget\t12\n')),
    { filename: 'data.tsv' }
  );
  assert.equal(tsv, csv);
});

test('a de-DE semicolon export keeps 3,50 in one cell', () => {
  const md = buildCsvMarkdownTable(
    toBuffer(utf8('Name;Preis;Menge\nWidget;3,50;12\n'))
  );
  assert.ok(md.includes('| Widget | 3,50 | 12 |'), md);
});

test('an empty file raises a user-facing error', () => {
  assert.throws(
    () => buildCsvMarkdownTable(toBuffer(utf8('   \n'))),
    (err) => err instanceof CsvImportError && /empty/i.test(err.message)
  );
});

test('a file with no usable rows raises a user-facing error', () => {
  assert.throws(
    () => buildCsvMarkdownTable(toBuffer(utf8('\n\n\n'))),
    (err) => err instanceof CsvImportError
  );
});

test('too many rows raises a user-facing error', () => {
  const lines = ['A'];
  for (let i = 0; i <= CSV_MAX_ROWS + 1; i++) lines.push(String(i));
  assert.throws(
    () => buildCsvMarkdownTable(toBuffer(utf8(lines.join('\n')))),
    (err) => err instanceof CsvImportError && /limit is/i.test(err.message)
  );
});

test('the size guard rejects an oversized file', () => {
  const message = validateCsvFile({
    name: 'big.csv',
    size: CSV_MAX_FILE_BYTES + 1,
  });
  assert.ok(message && /limit is/i.test(message), message);
  assert.equal(validateCsvFile({ name: 'ok.csv', size: 10 }), null);
});

if (process.exitCode) {
  console.error('\ncsv to markdown tests failed');
} else {
  console.log(`\n${passed} passed`);
}

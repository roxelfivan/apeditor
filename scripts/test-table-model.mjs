// Standalone harness for GFM table parse + cell Apply.
// Bundles the real `src/utils/tableModel.ts` via esbuild.
//
// Usage:
//   node scripts/test-table-model.mjs
// or
//   npm run test:table-model

import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-test-'));

const SOURCE = path.join(ROOT, 'src/utils/tableModel.ts');

const TMP_SRC = path.join(TMP_DIR, 'entry.ts');
const ENTRY = `
import {
  parseMarkdownTables,
  applyCellEdit,
  applyCellEdits,
  applyDeleteRows,
  applyDeleteColumns,
  applyAddColumn,
  buildTableContextMessage,
  findColumnIndex,
  resolveColumnRef,
  offsetInsideTable,
  findTableRowContaining,
  TABLE_CONTEXT_CHARS_CAP,
} from '${SOURCE.replace(/\\/g, '/')}';
export {
  parseMarkdownTables,
  applyCellEdit,
  applyCellEdits,
  applyDeleteRows,
  applyDeleteColumns,
  applyAddColumn,
  buildTableContextMessage,
  findColumnIndex,
  resolveColumnRef,
  offsetInsideTable,
  findTableRowContaining,
  TABLE_CONTEXT_CHARS_CAP,
};
`;
await fs.writeFile(TMP_SRC, ENTRY);

await build({
  entryPoints: [TMP_SRC],
  outfile: path.join(TMP_DIR, 'bundle.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  alias: {
    '@': path.join(ROOT, 'src'),
  },
});

const mod = await import(pathToFileURL(path.join(TMP_DIR, 'bundle.mjs')).href);
const {
  parseMarkdownTables,
  applyCellEdit,
  applyCellEdits,
  applyDeleteRows,
  applyDeleteColumns,
  applyAddColumn,
  buildTableContextMessage,
  findColumnIndex,
  resolveColumnRef,
  offsetInsideTable,
  findTableRowContaining,
  TABLE_CONTEXT_CHARS_CAP,
} = mod;

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

const SAMPLE = `| Name | Qty | Price |
| --- | --- | --- |
| Widget | 12 | 3.50 |
| Gadget | 4 | 9.00 |
`;

console.log('table-model tests\n');

test('parses a strict GFM table with 1-based data rows', () => {
  const tables = parseMarkdownTables(SAMPLE);
  assert.equal(tables.length, 1);
  assert.deepEqual(tables[0].headers, ['Name', 'Qty', 'Price']);
  assert.equal(tables[0].rows.length, 2);
  assert.equal(tables[0].rows[0].row, 1);
  assert.deepEqual(tables[0].rows[0].cells, ['Widget', '12', '3.50']);
  assert.deepEqual(tables[0].rows[1].cells, ['Gadget', '4', '9.00']);
});

test('ignores prose pipes and fenced fake tables', () => {
  const content =
    'Use a | b as separators in prose.\n\n' +
    '```\n| Fake | Table |\n| --- | --- |\n| x | y |\n```\n\n' +
    SAMPLE;
  const tables = parseMarkdownTables(content);
  assert.equal(tables.length, 1);
  assert.deepEqual(tables[0].headers, ['Name', 'Qty', 'Price']);
});

test('unescapes pipe cells', () => {
  const content = `| A | B |
| --- | --- |
| a\\|b | c |
`;
  const tables = parseMarkdownTables(content);
  assert.equal(tables[0].rows[0].cells[0], 'a|b');
});

test('findColumnIndex is case-insensitive fallback', () => {
  assert.equal(findColumnIndex(['Name', 'Qty'], 'Qty'), 1);
  assert.equal(findColumnIndex(['Name', 'Qty'], 'qty'), 1);
  assert.equal(findColumnIndex(['Name', 'Qty'], 'Nope'), -1);
});

test('applyCellEdit rewrites one cell by span', () => {
  const tables = parseMarkdownTables(SAMPLE);
  const row = tables[0].rows[0];
  const r = applyCellEdit(SAMPLE, {
    tableIndex: 0,
    row: 1,
    column: 'Qty',
    value: '99',
    expectedOriginal: '12',
    expectedRowText: row.lineText,
  });
  assert.equal(r.ok, true);
  assert.ok(r.next.includes('| Widget | 99 | 3.50 |'));
  assert.ok(r.next.includes('| Gadget | 4 | 9.00 |'));
  // Neighbour row untouched.
  assert.equal(
    parseMarkdownTables(r.next)[0].rows[1].lineText,
    tables[0].rows[1].lineText
  );
});

test('stale expectedOriginal refuses Apply', () => {
  const tables = parseMarkdownTables(SAMPLE);
  const row = tables[0].rows[0];
  const r = applyCellEdit(SAMPLE, {
    tableIndex: 0,
    row: 1,
    column: 'Qty',
    value: '99',
    expectedOriginal: '11',
    expectedRowText: row.lineText,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'stale');
});

test('stale expectedRowText refuses Apply', () => {
  const r = applyCellEdit(SAMPLE, {
    tableIndex: 0,
    row: 1,
    column: 'Qty',
    value: '99',
    expectedOriginal: '12',
    expectedRowText: '| Widget | 0 | 3.50 |',
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'stale');
});

test('applyCellEdits can patch two columns on the same row', () => {
  const tables = parseMarkdownTables(SAMPLE);
  const row = tables[0].rows[0];
  const { next, applied, skipped } = applyCellEdits(SAMPLE, [
    {
      tableIndex: 0,
      row: 1,
      column: 'Qty',
      value: '20',
      expectedOriginal: '12',
      expectedRowText: row.lineText,
    },
    {
      tableIndex: 0,
      row: 1,
      column: 'Price',
      value: '4.00',
      expectedOriginal: '3.50',
      expectedRowText: row.lineText,
    },
  ]);
  assert.equal(skipped.length, 0);
  assert.equal(applied.length, 2);
  const cells = parseMarkdownTables(next)[0].rows[0].cells;
  assert.deepEqual(cells, ['Widget', '20', '4.00']);
});

test('buildTableContextMessage returns null without tables', () => {
  assert.equal(buildTableContextMessage('Just prose.\n\nNo pipes.'), null);
});

test('buildTableContextMessage inlines cell values (cloud)', () => {
  const msg = buildTableContextMessage(SAMPLE);
  assert.ok(msg);
  assert.ok(msg.includes('table-edit'));
  assert.ok(msg.includes('r1:'));
  assert.ok(msg.includes('Widget'));
  assert.ok(msg.includes('Qty=12'));
});

test('compact Local mode avoids inlining cell values', () => {
  const msg = buildTableContextMessage(SAMPLE, { compact: true });
  assert.ok(msg);
  assert.ok(msg.includes('<<<DOCUMENT>>>'));
  assert.ok(!msg.includes('Qty=12'));
  assert.ok(msg.length < TABLE_CONTEXT_CHARS_CAP);
});

test('offsetInsideTable / findTableRowContaining helpers', () => {
  const tables = parseMarkdownTables('Lead\n\n' + SAMPLE + '\nTail');
  const row = tables[0].rows[0];
  assert.ok(offsetInsideTable(tables, row.lineStart));
  assert.equal(offsetInsideTable(tables, 0), null);
  const hit = findTableRowContaining(tables, row.lineStart + 1, row.lineEnd);
  assert.ok(hit);
  assert.equal(hit.row.row, 1);
});

test('applyDeleteRows removes a contiguous tail', () => {
  const tables = parseMarkdownTables(SAMPLE);
  const last = tables[0].rows[1];
  const r = applyDeleteRows(SAMPLE, {
    tableIndex: 0,
    rows: [2],
    expectedRowCount: 2,
    expectedFirstDeletedRowText: last.lineText,
    expectedLastDeletedRowText: last.lineText,
  });
  assert.equal(r.ok, true);
  assert.equal(parseMarkdownTables(r.next)[0].rows.length, 1);
  assert.ok(r.next.includes('Widget'));
  assert.ok(!r.next.includes('Gadget'));
});

test('buildTableContextMessage documents delete-rows', () => {
  const msg = buildTableContextMessage(SAMPLE);
  assert.ok(msg.includes('delete-rows'));
  assert.ok(msg.includes('keep-rows'));
  assert.ok(msg.includes('remove-column'));
});

test('resolveColumnRef accepts name and 1-based index', () => {
  const headers = ['Name', 'Qty', 'Price'];
  assert.equal(resolveColumnRef(headers, 'Price'), 2);
  assert.equal(resolveColumnRef(headers, '3'), 2);
  assert.equal(resolveColumnRef(headers, 'Column 3'), 2);
  assert.equal(resolveColumnRef(headers, 3), 2);
});

test('applyDeleteColumns drops a column and rewrites the table', () => {
  const tables = parseMarkdownTables(SAMPLE);
  const r = applyDeleteColumns(SAMPLE, {
    tableIndex: 0,
    columnIndexes: [2],
    expectedHeaders: tables[0].headers,
    expectedHeaderLineText: tables[0].headerLineText,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(parseMarkdownTables(r.next)[0].headers, ['Name', 'Qty']);
  assert.deepEqual(parseMarkdownTables(r.next)[0].rows[0].cells, [
    'Widget',
    '12',
  ]);
});

test('applyAddColumn appends a blank summary column', () => {
  const tables = parseMarkdownTables(SAMPLE);
  const r = applyAddColumn(SAMPLE, {
    tableIndex: 0,
    header: 'summary',
    insertIndex: 3,
    fill: '',
    expectedHeaders: tables[0].headers,
    expectedHeaderLineText: tables[0].headerLineText,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(parseMarkdownTables(r.next)[0].headers, [
    'Name',
    'Qty',
    'Price',
    'summary',
  ]);
  assert.equal(parseMarkdownTables(r.next)[0].rows[0].cells[3], '');
});

test('buildTableContextMessage documents add-column', () => {
  const msg = buildTableContextMessage(SAMPLE);
  assert.ok(msg.includes('add-column'));
});

console.log(`\n${passed} tests passed`);
await fs.rm(TMP_DIR, { recursive: true, force: true });

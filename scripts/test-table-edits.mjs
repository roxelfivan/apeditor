// Standalone harness for table-edit fences + prose isolation.
// Bundles proposedEdit + tableEdits via esbuild.
//
// Usage:
//   node scripts/test-table-edits.mjs
// or
//   npm run test:table-edits

import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'te-test-'));

const PE = path.join(ROOT, 'src/utils/proposedEdit.ts');
const TE = path.join(ROOT, 'src/utils/tableEdits.ts');
const TM = path.join(ROOT, 'src/utils/tableModel.ts');

const TMP_SRC = path.join(TMP_DIR, 'entry.ts');
const ENTRY = `
import {
  parseProposedEdits,
  findEditAnchor,
  findBestEffortAnchor,
  applyEdit,
  expandBestEffortRange,
} from '${PE.replace(/\\/g, '/')}';
import {
  tryParseTableEdit,
  resolveTableEditOp,
  cellEditFromProposed,
  parseRowIndices,
  applyTableEdit,
} from '${TE.replace(/\\/g, '/')}';
import { applyCellEdit, parseMarkdownTables } from '${TM.replace(/\\/g, '/')}';
export {
  parseProposedEdits,
  findEditAnchor,
  findBestEffortAnchor,
  applyEdit,
  expandBestEffortRange,
  tryParseTableEdit,
  resolveTableEditOp,
  cellEditFromProposed,
  parseRowIndices,
  applyTableEdit,
  applyCellEdit,
  parseMarkdownTables,
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
  parseProposedEdits,
  findEditAnchor,
  findBestEffortAnchor,
  applyEdit,
  expandBestEffortRange,
  tryParseTableEdit,
  resolveTableEditOp,
  cellEditFromProposed,
  parseRowIndices,
  applyTableEdit,
  applyCellEdit,
  parseMarkdownTables,
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

const DOC = `Intro paragraph about the sheet.

| Name | Qty | Price |
| --- | --- | --- |
| Widget | 12 | 3.50 |
| Gadget | 4 | 9.00 |

Closing notes stay put.
`;

console.log('table-edits + isolation tests\n');

test('tryParseTableEdit requires the table-edit shape', () => {
  const ok = tryParseTableEdit(
    JSON.stringify({
      id: 't1',
      summary: 'bump qty',
      table: 0,
      row: 1,
      column: 'Qty',
      value: '99',
    })
  );
  assert.ok(ok);
  assert.equal(ok.row, 1);
  assert.equal(
    tryParseTableEdit(
      JSON.stringify({
        id: 'p1',
        summary: 'prose',
        original: 'x',
        replacement: 'y',
      })
    ),
    null
  );
});

test('resolveTableEditOp attaches span metadata', () => {
  const op = tryParseTableEdit(
    JSON.stringify({
      id: 't1',
      summary: 'bump qty',
      table: 0,
      row: 1,
      column: 'Qty',
      value: '99',
    })
  );
  const edit = resolveTableEditOp(DOC, op);
  assert.ok(edit);
  assert.equal(edit.original, '12');
  assert.equal(edit.replacement, '99');
  assert.ok(edit.tableEdit);
  assert.equal(edit.tableEdit.expectedOriginal, '12');
  assert.ok(edit.tableEdit.expectedRowText.includes('Widget'));
});

test('parseProposedEdits resolves table-edit with docContent', () => {
  const reply =
    'Updating the quantity.\n\n```table-edit\n' +
    JSON.stringify({
      id: 't1',
      summary: 'bump qty',
      table: 0,
      row: 1,
      column: 'Qty',
      value: '99',
    }) +
    '\n```\n';
  const segs = parseProposedEdits(reply, DOC);
  const edits = segs.filter((s) => s.kind === 'edit');
  assert.equal(edits.length, 1);
  assert.ok(edits[0].payload.tableEdit);
  assert.equal(edits[0].payload.replacement, '99');
});

test('table-edit without docContent stays text (safe fallback)', () => {
  const reply =
    '```table-edit\n' +
    JSON.stringify({
      id: 't1',
      summary: 'bump qty',
      table: 0,
      row: 1,
      column: 'Qty',
      value: '99',
    }) +
    '\n```';
  const segs = parseProposedEdits(reply);
  assert.equal(segs.filter((s) => s.kind === 'edit').length, 0);
  assert.ok(segs.some((s) => s.kind === 'text' && s.payload.includes('table-edit')));
});

test('proposed-edit fence path unchanged beside a table', () => {
  const reply =
    '```proposed-edit\n' +
    JSON.stringify({
      id: 'p1',
      summary: 'rewrite intro',
      original: 'Intro paragraph about the sheet.',
      replacement: 'Intro paragraph covering the sheet.',
    }) +
    '\n```';
  const segs = parseProposedEdits(reply, DOC);
  const edits = segs.filter((s) => s.kind === 'edit');
  assert.equal(edits.length, 1);
  assert.equal(edits[0].payload.tableEdit, undefined);
  const r = applyEdit(
    DOC,
    edits[0].payload.original,
    edits[0].payload.replacement
  );
  assert.equal(r.ok, true);
  assert.ok(r.next.includes('covering the sheet'));
  // Table untouched.
  assert.ok(r.next.includes('| Widget | 12 | 3.50 |'));
});

test('rescue pass promotes bare set-cell table-edit JSON', () => {
  const bare = JSON.stringify({
    id: 't1',
    summary: 'bump',
    table: 0,
    row: 1,
    column: 'Qty',
    value: '99',
  });
  const segs = parseProposedEdits('Here is a change:\n' + bare, DOC);
  const edits = segs.filter((s) => s.kind === 'edit');
  assert.equal(edits.length, 1);
  assert.equal(edits[0].payload.replacement, '99');
  assert.ok(edits[0].payload.tableEdit);
});

test('short cell values must not Apply via findEditAnchor', () => {
  // "12" and "4" appear in many places; Exact on a short cell is unsafe.
  const tables = parseMarkdownTables(DOC);
  const row = tables[0].rows[0];
  const edit = resolveTableEditOp(DOC, {
    id: 't1',
    summary: 'bump',
    rationale: '',
    tableIndex: 0,
    row: 1,
    column: 'Qty',
    value: '99',
  });
  assert.ok(edit);
  // Prose path would find the first "12" — possibly wrong.
  const proseAnchor = findEditAnchor(DOC, '12');
  assert.ok(proseAnchor);
  // Table path uses span Apply instead.
  const cell = cellEditFromProposed(edit);
  const r = applyCellEdit(DOC, cell);
  assert.equal(r.ok, true);
  assert.equal(r.originalRow, row.lineText);
  assert.ok(r.next.includes('| Widget | 99 | 3.50 |'));
  assert.ok(r.next.includes('| Gadget | 4 | 9.00 |'));
});

test('Best Effort expansion clamps inside a table row', () => {
  const tables = parseMarkdownTables(DOC);
  const row = tables[0].rows[0];
  const nextRow = tables[0].rows[1];
  const chunk = 'Widget';
  const idx = DOC.indexOf(chunk);
  const expanded = expandBestEffortRange(
    DOC,
    row.lineText,
    { idx, length: chunk.length },
    row.lineText.indexOf(chunk),
    row.lineText
  );
  // Must not swallow the next data row.
  const holeStart = expanded.idx;
  const holeEnd = holeStart + expanded.length;
  assert.ok(holeStart >= row.lineStart);
  assert.ok(
    holeEnd <= nextRow.lineStart,
    `hole end ${holeEnd} must stay before next row ${nextRow.lineStart}`
  );
  assert.ok(!DOC.slice(holeStart, holeEnd).includes('Gadget'));
});

test('Best Effort from prose stops at table boundary', () => {
  const intro = 'Intro paragraph about the sheet.';
  const original =
    intro +
    '\n\n| Name | Qty | Price |\n| --- | --- |\n| Widget | 12 | 3.50 |';
  // Partial match on intro only; expansion must not eat the table.
  const chunk = 'Intro paragraph';
  const idx = DOC.indexOf(chunk);
  const expanded = expandBestEffortRange(
    DOC,
    original,
    { idx, length: chunk.length },
    0,
    original
  );
  const holeStart = expanded.idx;
  const holeEnd = holeStart + expanded.length;
  const tableStart = parseMarkdownTables(DOC)[0].start;
  assert.ok(
    holeEnd <= tableStart,
    `prose hole must stop before table (${holeEnd} <= ${tableStart})`
  );
});

test('prose-only document Best Effort unchanged (no tables)', () => {
  const body =
    'The quick brown fox jumps over the lazy dog and then runs home quickly after lunch.';
  const content = `## Getting Started\n\n${body}\n\n## Next\n\nOther.`;
  const original =
    '## Getting Started\n\n' + body.slice(0, -12) + ' after supper.';
  const replacement =
    '## Getting Started\n\n' +
    'The quick brown fox leaps over the lazy dog and then runs home quickly after lunch.';
  assert.equal(findEditAnchor(content, original), null);
  const be = findBestEffortAnchor(content, original, replacement);
  assert.ok(be, 'prose-only Best Effort still finds an anchor');
});

test('misnamed fence is still rescued when body is table-edit JSON', () => {
  // Exact gate is `table-edit` / `json` / bare; other info-strings stay
  // text in the fence pass, then the rescue pass lifts the JSON body.
  const reply =
    '```proposed-edit-table\n' +
    JSON.stringify({
      id: 't1',
      summary: 'bump',
      table: 0,
      row: 1,
      column: 'Qty',
      value: '99',
    }) +
    '\n```';
  const segs = parseProposedEdits(reply, DOC);
  const edits = segs.filter((s) => s.kind === 'edit');
  assert.equal(edits.length, 1);
  assert.equal(edits[0].payload.replacement, '99');
});

test('parseRowIndices accepts r51-r636 ranges', () => {
  const rows = parseRowIndices('r51-r636');
  assert.ok(rows);
  assert.equal(rows[0], 51);
  assert.equal(rows[rows.length - 1], 636);
  assert.equal(rows.length, 636 - 51 + 1);
});

test('delete-rows op resolves and Applies', () => {
  const op = tryParseTableEdit(
    JSON.stringify({
      id: 'table0-keep-top-1',
      summary: 'drop second row',
      operation: 'delete-rows',
      table: 0,
      rowIndices: 'r2',
    })
  );
  assert.ok(op);
  assert.equal(op.kind, 'delete-rows');
  const edit = resolveTableEditOp(DOC, op);
  assert.ok(edit);
  assert.equal(edit.tableEdit.kind, 'delete-rows');
  const r = applyTableEdit(DOC, edit);
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'delete-rows');
  const tables = parseMarkdownTables(r.next);
  assert.equal(tables[0].rows.length, 1);
  assert.deepEqual(tables[0].rows[0].cells, ['Widget', '12', '3.50']);
  assert.ok(r.next.includes('Closing notes stay put.'));
});

test('keep-rows op keeps the named rows', () => {
  const op = tryParseTableEdit(
    JSON.stringify({
      id: 'keep',
      summary: 'keep r1',
      operation: 'keep-rows',
      table: 0,
      rowIndices: 'r1',
    })
  );
  const edit = resolveTableEditOp(DOC, op);
  assert.ok(edit);
  const r = applyTableEdit(DOC, edit);
  assert.equal(r.ok, true);
  assert.equal(parseMarkdownTables(r.next)[0].rows.length, 1);
});

test('```json fence with delete-rows becomes a card', () => {
  const reply =
    'Done.\n\n```json\n' +
    JSON.stringify({
      id: 'table0-keep-top-50-rows',
      summary: 'Keep table rows r1',
      rationale: '1. Before…',
      operation: 'delete-rows',
      table: 0,
      rowIndices: 'r2',
    }) +
    '\n```\n';
  const segs = parseProposedEdits(reply, DOC);
  const edits = segs.filter((s) => s.kind === 'edit');
  assert.equal(edits.length, 1);
  assert.equal(edits[0].payload.tableEdit.kind, 'delete-rows');
});

test('bare delete-rows JSON is rescued into a card', () => {
  const bare = JSON.stringify({
    id: 'table0-keep-top-50-rows',
    summary: 'Keep top row',
    operation: 'delete-rows',
    table: 0,
    rowIndices: 'r2',
  });
  const segs = parseProposedEdits('Here:\n' + bare + '\nThanks.', DOC);
  const edits = segs.filter((s) => s.kind === 'edit');
  assert.equal(edits.length, 1);
  assert.ok(edits[0].payload.tableEdit);
});

test('remove-column by header name Applies', () => {
  const op = tryParseTableEdit(
    JSON.stringify({
      id: 'table0-remove-column-6',
      summary: 'Remove Price',
      operation: 'remove-column',
      table: 0,
      column: 'Price',
    })
  );
  assert.ok(op);
  assert.equal(op.kind, 'delete-columns');
  const edit = resolveTableEditOp(DOC, op);
  assert.ok(edit);
  assert.equal(edit.tableEdit.kind, 'delete-columns');
  const r = applyTableEdit(DOC, edit);
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'delete-columns');
  const headers = parseMarkdownTables(r.next)[0].headers;
  assert.deepEqual(headers, ['Name', 'Qty']);
  assert.ok(!r.next.includes('3.50'));
});

test('remove-column by 1-based index "6" / "Column 6"', () => {
  const wide = `| C1 | C2 | C3 | C4 | C5 | C6 |
| --- | --- | --- | --- | --- | --- |
| a | b | c | d | e | f |
`;
  const op = tryParseTableEdit(
    JSON.stringify({
      id: 'rm6',
      summary: 'Remove Column 6',
      operation: 'remove-column',
      table: 0,
      column: 'Column 6',
    })
  );
  assert.ok(op);
  const edit = resolveTableEditOp(wide, op);
  assert.ok(edit, 'Column 6 should resolve as 1-based index 6');
  const r = applyTableEdit(wide, edit);
  assert.equal(r.ok, true);
  assert.deepEqual(parseMarkdownTables(r.next)[0].headers, [
    'C1',
    'C2',
    'C3',
    'C4',
    'C5',
  ]);
});

test('```json remove-column becomes a card', () => {
  const reply =
    '```json\n' +
    JSON.stringify({
      id: 'table0-remove-column-6',
      summary: 'Remove Price',
      rationale: '1. Before…',
      operation: 'remove-column',
      table: 0,
      column: 'Price',
    }) +
    '\n```';
  const segs = parseProposedEdits(reply, DOC);
  assert.equal(segs.filter((s) => s.kind === 'edit').length, 1);
});

test('add-column inserts blank named column at position 6', () => {
  const wide = `| C1 | C2 | C3 | C4 | C5 |
| --- | --- | --- | --- | --- |
| a | b | c | d | e |
`;
  const op = tryParseTableEdit(
    JSON.stringify({
      id: 'table0-add-summary-column',
      summary: 'Add blank Column 6 called summary',
      operation: 'add-column',
      table: 0,
      column: 'summary',
      at: 6,
      value: '',
    })
  );
  assert.ok(op);
  assert.equal(op.kind, 'add-column');
  assert.equal(op.header, 'summary');
  assert.equal(op.at, 6);
  const edit = resolveTableEditOp(wide, op);
  assert.ok(edit);
  assert.equal(edit.tableEdit.kind, 'add-column');
  const r = applyTableEdit(wide, edit);
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'add-column');
  const t = parseMarkdownTables(r.next)[0];
  assert.deepEqual(t.headers, ['C1', 'C2', 'C3', 'C4', 'C5', 'summary']);
  assert.deepEqual(t.rows[0].cells, ['a', 'b', 'c', 'd', 'e', '']);
});

test('add-column with name + Column 6 position', () => {
  const op = tryParseTableEdit(
    JSON.stringify({
      id: 'add',
      summary: 'add summary',
      operation: 'add-column',
      table: 0,
      name: 'summary',
      column: 'Column 6',
    })
  );
  assert.ok(op);
  assert.equal(op.kind, 'add-column');
  assert.equal(op.header, 'summary');
  assert.equal(op.at, 6);
});

console.log(`\n${passed} tests passed`);
await fs.rm(TMP_DIR, { recursive: true, force: true });

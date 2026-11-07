// Renders the shared Preview markdown renderer to a string and checks
// the markup.
//
// The table wrapper is the part worth asserting: it moves `data-line`
// from the inner <table> onto the wrapper so the source-line gutter
// numbers the block once. Horizontal scrolling is owned by the Preview
// pane (`.preview-scroll`), not a nested overflow box — a nested
// scroller buried the bar under tall sheets.
//
// Usage:
//   node scripts/test-preview-markdown-render.mjs
// or
//   npm run test:preview-markdown-render

import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'preview-render-'));
const TMP_SRC = path.join(TMP_DIR, 'entry.tsx');

const COMPONENT = path
  .join(ROOT, 'src/components/PreviewMarkdown.tsx')
  .replace(/\\/g, '/');
const CSV_UTIL = path
  .join(ROOT, 'src/utils/csvToMarkdown.ts')
  .replace(/\\/g, '/');

const ENTRY = [
  "import { createElement } from 'react';",
  "import { renderToStaticMarkup } from 'react-dom/server.browser';",
  "import { PreviewMarkdown } from '" + COMPONENT + "';",
  "import { csvToMarkdown } from '" + CSV_UTIL + "';",
  'export { csvToMarkdown };',
  'export function renderPreview(source, lineNumbers) {',
  '  return renderToStaticMarkup(',
  '    createElement(PreviewMarkdown, { source, lineNumbers: !!lineNumbers })',
  '  );',
  '}',
].join('\n');

await fs.writeFile(TMP_SRC, ENTRY);

await build({
  entryPoints: [TMP_SRC],
  outfile: path.join(TMP_DIR, 'bundle.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  jsx: 'automatic',
  alias: { '@': path.join(ROOT, 'src') },
  absWorkingDir: ROOT,
  nodePaths: [path.join(ROOT, 'node_modules')],
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: {
    js: [
      'import.meta.env = { VITE_DEFAULT_PROVIDER: "minimax" };',
    ].join('\n'),
  },
});

const { renderPreview, csvToMarkdown } = await import(
  pathToFileURL(path.join(TMP_DIR, 'bundle.mjs')).href
);

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (err) {
    console.error('  FAIL ' + name);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log('preview markdown render tests\n');

const TABLE = [
  '| Name | Qty |',
  '| --- | --- |',
  '| Widget | 12 |',
].join('\n');

test('renders a table inside a scroll wrapper', () => {
  const html = renderPreview(TABLE);
  assert.ok(html.includes('class="table-scroll"'), html);
  assert.ok(html.includes('<table'), html);
  assert.ok(
    html.indexOf('table-scroll') < html.indexOf('<table'),
    'the wrapper comes before the table'
  );
});

test('moves data-line from the table onto the wrapper', () => {
  const html = renderPreview(TABLE, true);
  const wrapper = html.match(/<div class="table-scroll"[^>]*>/)?.[0] ?? '';
  assert.ok(wrapper.includes('data-line='), wrapper);
  // The inner table must not carry its own data-line, or the gutter
  // would paint the line number twice.
  const tableTag = html.match(/<table[^>]*>/)?.[0] ?? '';
  assert.ok(!tableTag.includes('data-line'), tableTag);
});

test('renders the header and body cells', () => {
  const html = renderPreview(TABLE);
  assert.ok(html.includes('<th'), html);
  assert.ok(html.includes('Widget'), html);
  assert.ok(html.includes('12'), html);
});

test('an escaped pipe survives as one cell', () => {
  const html = renderPreview('| A |\n| --- |\n| a \\| b |');
  const cells = html.match(/<td[^>]*>([\s\S]*?)<\/td>/g) ?? [];
  assert.equal(cells.length, 1, html);
  assert.ok(cells[0].includes('a | b'), cells[0]);
});

test('raw HTML in a cell is not interpreted as markup', () => {
  const html = renderPreview('| A |\n| --- |\n| <b>raw</b> |');
  assert.ok(!html.includes('<b>raw</b>'), html);
});

test('a document with no table renders no wrapper', () => {
  const html = renderPreview('# Heading\n\nSome text.');
  assert.ok(!html.includes('table-scroll'), html);
});

test('content after a table is not absorbed into the last cell', () => {
  // Regression: GFM keeps consuming lines that look like table rows.
  // A table that is not closed by a blank line swallows whatever comes
  // next, and that content disappears from the rendered page.
  //
  // Built with the real converter so the test tracks the actual
  // output of the import path.
  const table = csvToMarkdown([
    ['Name', 'Qty'],
    ['Widget', '12'],
  ]);
  const html = renderPreview(table + '**# Welcome** rest of doc');
  const cells = html.match(/<td[^>]*>([\s\S]*?)<\/td>/g) ?? [];
  assert.equal(cells.length, 2, html);
  assert.ok(!cells[1].includes('Welcome'), cells[1]);
  assert.ok(html.includes('Welcome'), 'the following content still renders');
});

test('a table followed by a blank line keeps the next content outside it', () => {
  const table = csvToMarkdown([
    ['Name', 'Qty'],
    ['Widget', '12'],
  ]);
  const html = renderPreview(table + '**After**');
  const rows = html.match(/<tr[^>]*>/g) ?? [];
  assert.equal(rows.length, 2, html);
  assert.ok(html.includes('After'), html);
});

if (process.exitCode) {
  console.error('\npreview markdown render tests failed');
} else {
  console.log('\n' + passed + ' passed');
}

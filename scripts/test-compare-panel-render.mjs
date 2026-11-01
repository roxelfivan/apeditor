// Renders the Compare overlay to a string and checks the markup.
//
// This catches runtime errors that `tsc` cannot see — a bad hook order,
// a missing prop, an undefined segment — and asserts the side-by-side
// layout actually renders the unchanged content in both columns.
//
// The presentational `ComparePanelView` is rendered rather than the
// store-connected `CompareReviewPanel`: a zustand store has no
// server snapshot, so a connected component would always render its
// initial (empty) state here.
//
// Usage:
//   node scripts/test-compare-panel-render.mjs
// or
//   npm run test:compare-panel-render

import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'compare-render-'));
const TMP_SRC = path.join(TMP_DIR, 'entry.tsx');

const COMPONENT = path
  .join(ROOT, 'src/components/CompareReviewPanel.tsx')
  .replace(/\\/g, '/');
const COMPARE_UTIL = path
  .join(ROOT, 'src/utils/documentCompare.ts')
  .replace(/\\/g, '/');

// The app persists to localStorage, which Node does not provide.
// Install a minimal in-memory stand-in. esbuild hoists imports above
// top-level statements, so the shim lives in the banner (emitted
// before everything else).
const localStorageShim = `
const __store = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k) => (__store.has(k) ? __store.get(k) : null),
    setItem: (k, v) => { __store.set(k, String(v)); },
    removeItem: (k) => { __store.delete(k); },
    clear: () => { __store.clear(); },
    key: (i) => Array.from(__store.keys())[i] ?? null,
    get length() { return __store.size; },
  },
});
`;

const ENTRY = [
  "import { createElement } from 'react';",
  "import { renderToStaticMarkup } from 'react-dom/server.browser';",
  "import { ComparePanelView } from '" + COMPONENT + "';",
  "import { compareToProposedEdits } from '" + COMPARE_UTIL + "';",
  'export { compareToProposedEdits };',
  'export function renderCompare(original, revised) {',
  '  const result = compareToProposedEdits(original, revised);',
  '  const doc = {',
  "    id: 'doc-1',",
  "    title: 'Notes',",
  '    content: original,',
  '    createdAt: 0,',
  '    updatedAt: 0,',
  '  };',
  '  return renderToStaticMarkup(',
  '    createElement(ComparePanelView, {',
  '      session: {',
  "        sourceLabel: 'release-notes-v2.md',",
  '        edits: result.edits,',
  '        segments: result.segments,',
  '        skippedHunks: result.skippedHunks,',
  '      },',
  '      doc,',
  '      width: 560,',
  '      onWidthChange: () => {},',
  '      onClose: () => {},',
  '      onApplyEdits: () => {},',
  '    })',
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
  // The app reads Vite env vars at module scope; stub them so the
  // bundle can be evaluated outside Vite.
  banner: {
    js: [
      'import.meta.env = { VITE_DEFAULT_PROVIDER: "minimax" };',
      localStorageShim,
    ].join('\n'),
  },
});

const { renderCompare } = await import(
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

console.log('compare panel render tests\n');

const ORIGINAL = [
  '# Q3 Product Update',
  '',
  'Our team shipped 12 features this quarter.',
  '',
  '## Highlights',
  '',
  '- Dark mode across the app',
  '- New keyboard shortcuts',
  '',
].join('\n');

const REVISED = [
  '# Q3 Product Update',
  '',
  'Our team shipped 14 features this quarter.',
  '',
  '## Highlights',
  '',
  '- Dark mode across the app',
  '- New keyboard shortcuts',
  '- Offline mode',
  '',
].join('\n');

/** Count how many times `needle` appears in `html`. */
function countOf(html, needle) {
  let count = 0;
  let idx = html.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = html.indexOf(needle, idx + needle.length);
  }
  return count;
}

/** The change card's diff preview, without the rest of the card. */
function cardDiff(html) {
  const start = html.indexOf('pe-diff');
  if (start === -1) return '';
  const end = html.indexOf('pe-actions', start);
  return html.slice(start, end === -1 ? undefined : end);
}

test('the panel renders without throwing', () => {
  const html = renderCompare(ORIGINAL, REVISED);
  assert.ok(html.length > 0);
});

test('the panel shows the unchanged content', () => {
  const html = renderCompare(ORIGINAL, REVISED);
  assert.ok(html.includes('Q3 Product Update'), 'missing unchanged heading');
  assert.ok(
    html.includes('Dark mode across the app'),
    'missing unchanged bullet'
  );
  assert.ok(html.includes('Highlights'), 'missing unchanged subheading');
});

test('the panel renders both column headers', () => {
  const html = renderCompare(ORIGINAL, REVISED);
  assert.ok(html.includes('Original'), 'missing Original column header');
  assert.ok(html.includes('Revised'), 'missing Revised column header');
});

test('unchanged content is rendered in both columns', () => {
  const html = renderCompare(ORIGINAL, REVISED);
  // The unchanged bullet appears twice — once per column.
  assert.equal(
    countOf(html, 'Dark mode across the app'),
    2,
    'expected the unchanged bullet in both columns'
  );
});

test('the panel renders a change card for each edit', () => {
  const html = renderCompare(ORIGINAL, REVISED);
  assert.ok(html.includes('proposed-edit-card'), 'missing the change card');
  assert.ok(html.includes('Apply'), 'missing the Apply action');
});

test('the panel exposes a resize handle on its left edge', () => {
  const html = renderCompare(ORIGINAL, REVISED);
  assert.ok(html.includes('cmp-resize-handle'), 'missing the resize handle');
});

test('the changed text is not duplicated by the unchanged rows', () => {
  const html = renderCompare(ORIGINAL, REVISED);
  // The changed paragraph belongs to the change card only. It must not
  // also appear as unchanged text in the document rows.
  const rows = html.slice(0, html.indexOf('cmp-change'));
  assert.ok(
    !rows.includes('Our team shipped 12 features this quarter.'),
    'the changed text leaked into the unchanged rows'
  );
  assert.ok(
    cardDiff(html).includes('Our team shipped 12 features this quarter.'),
    'the change card should show the changed text'
  );
});

test('an insertion does not repeat the borrowed anchor context', () => {
  const html = renderCompare('one\nthree\n', 'one\ntwo\nthree\n');
  const diff = cardDiff(html);
  // The edit's anchor borrows "one" so Apply can find it. The preview
  // must show the hunk only — otherwise the borrowed line is shown
  // twice (once in the document rows, once in the card).
  assert.ok(
    !diff.includes('>one<'),
    'the card preview should not repeat the borrowed anchor context'
  );
  assert.ok(
    diff.includes('>two<'),
    'the card preview should show the inserted text'
  );
  // "one" still appears in the document rows, once per column.
  const rows = html.slice(0, html.indexOf('cmp-change'));
  assert.equal(countOf(rows, '>one<'), 2, 'expected "one" in both columns');
});

test('an identical document still renders its body', () => {
  const html = renderCompare('Same\n', 'Same\n');
  assert.ok(html.includes('Same'), 'missing the identical body');
});

if (process.exitCode) {
  console.error('\ncompare panel render tests failed');
} else {
  console.log(`\n${passed} passed`);
}

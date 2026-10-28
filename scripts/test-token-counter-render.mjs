// Renders `TokenCounter` to a string and checks the markup.
// Catches runtime errors that `tsc` cannot see and asserts the budget
// states render the right tone.
//
// Usage:
//   node scripts/test-token-counter-render.mjs
// or
//   npm run test:token-counter-render

import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'token-render-'));
const TMP_SRC = path.join(TMP_DIR, 'entry.tsx');

const COMPONENT = path
  .join(ROOT, 'src/components/TokenCounter.tsx')
  .replace(/\\/g, '/');

const ENTRY = [
  "import { createElement } from 'react';",
  // The browser build of react-dom/server — the Node build pulls in
  // `stream` and other built-ins that esbuild cannot bundle for an
  // ESM output file.
  "import { renderToStaticMarkup } from 'react-dom/server.browser';",
  "import { TokenCounter } from '" + COMPONENT + "';",
  'export function render(props) {',
  '  return renderToStaticMarkup(createElement(TokenCounter, props));',
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
  // React is bundled in (not external) so the temp bundle can resolve
  // it — the temp dir is outside the project, so node would not find
  // node_modules/react on its own.
  absWorkingDir: ROOT,
  nodePaths: [path.join(ROOT, 'node_modules')],
});

const { render } = await import(
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

console.log('token counter render tests\n');

test('renders the token count', () => {
  const html = render({ tokens: 1240 });
  assert.match(html, /1,240/);
  assert.match(html, /tok/);
});

test('renders zero tokens', () => {
  const html = render({ tokens: 0 });
  assert.match(html, />0</);
});

test('a negative count renders as zero', () => {
  const html = render({ tokens: -10 });
  assert.match(html, />0</);
});

test('a non-finite count renders as zero', () => {
  const html = render({ tokens: NaN });
  assert.match(html, />0</);
});

test('an in-budget prompt has no warning marker', () => {
  const html = render({ tokens: 1000, budget: 8192, reserve: 1024 });
  assert.doesNotMatch(html, /!/, 'no warning glyph when under budget');
  assert.doesNotMatch(html, /cyber-danger/, 'no danger tone when under budget');
});

test('a prompt past the budget is flagged as over-budget', () => {
  const html = render({ tokens: 8000, budget: 8192, reserve: 1024 });
  assert.match(html, /cyber-danger/, 'over-budget uses the danger tone');
  assert.match(html, /!/, 'over-budget shows a warning glyph');
  assert.match(html, /cut short/, 'the tooltip explains the truncation');
});

test('a prompt near the budget is flagged as near-budget', () => {
  const html = render({ tokens: 7000, budget: 8192, reserve: 1024 });
  assert.match(html, /cyber-warn/, 'near-budget uses the warn tone');
  assert.doesNotMatch(html, /cut short/, 'near-budget is not a hard failure');
});

test('the exact usable budget is not over-budget', () => {
  // 8192 - 1024 = 7168 usable.
  const html = render({ tokens: 7168, budget: 8192, reserve: 1024 });
  assert.doesNotMatch(html, /cyber-danger/, 'exactly at the limit is allowed');
});

test('one token over the usable budget is over-budget', () => {
  const html = render({ tokens: 7169, budget: 8192, reserve: 1024 });
  assert.match(html, /cyber-danger/, 'one token over should be flagged');
});

test('no budget means no budget check', () => {
  const html = render({ tokens: 999999 });
  assert.doesNotMatch(html, /cyber-danger/);
  assert.doesNotMatch(html, /cyber-warn/);
});

test('the tooltip names the budget', () => {
  const html = render({ tokens: 100, budget: 8192, reserve: 1024 });
  assert.match(html, /budget 7,168/);
});

test('a custom class is applied', () => {
  const html = render({ tokens: 100, className: 'cm-tray__token' });
  assert.match(html, /cm-tray__token/);
});

console.log('\n' + passed + ' passed');
if (process.exitCode) {
  console.error('\nsome tests failed');
} else {
  console.log('token counter render: all checks passed');
}

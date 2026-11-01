import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'outline-'));
const SOURCE = path.join(ROOT, 'src/utils/outlineNumbering.ts');

await build({
  entryPoints: [SOURCE],
  outfile: path.join(TMP_DIR, 'bundle.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
});

const {
  collectMarkdownHeadings,
  nextOutlineCounters,
  formatOutlineLabel,
  labelsForHeadings,
  toRoman,
  toLetter,
} = await import(pathToFileURL(path.join(TMP_DIR, 'bundle.mjs')).href);

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

console.log('outline numbering tests\n');

test('roman and letter helpers', () => {
  assert.equal(toRoman(1), 'I');
  assert.equal(toRoman(14), 'XIV');
  assert.equal(toLetter(1), 'a');
  assert.equal(toLetter(27), 'aa');
});

test('decimal counters skip unused levels', () => {
  let c = [];
  c = nextOutlineCounters(c, 1);
  assert.deepEqual(c, [1]);
  c = nextOutlineCounters(c, 3);
  assert.deepEqual(c, [1, 1, 1]);
  assert.equal(formatOutlineLabel(c, 'decimal'), '1.1.1');
  c = nextOutlineCounters(c, 2);
  assert.deepEqual(c, [1, 2]);
});

test('legal labels', () => {
  assert.equal(formatOutlineLabel([1], 'legal'), 'Article I');
  assert.equal(formatOutlineLabel([1, 2], 'legal'), 'Section 2');
  assert.equal(formatOutlineLabel([1, 2, 3], 'legal'), '(c)');
});

test('ATX and Setext, skip fenced code', () => {
  const md = `# Intro

\`\`\`
# not a heading
\`\`\`

## Details

Title
---
`;
  const headings = collectMarkdownHeadings(md);
  assert.equal(headings.length, 3);
  assert.equal(headings[0].level, 1);
  assert.equal(headings[1].level, 2);
  assert.equal(headings[2].level, 2);
  const labels = labelsForHeadings(md, 'decimal');
  assert.deepEqual(labels, ['1', '1.1', '1.2']);
});

test('off scheme is empty', () => {
  assert.deepEqual(labelsForHeadings('# A\n', 'off'), []);
});

if (process.exitCode) {
  console.error('\noutline numbering tests failed');
} else {
  console.log(`\n${passed} passed`);
}

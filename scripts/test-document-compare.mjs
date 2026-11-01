import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'compare-'));
const SOURCE = path.join(ROOT, 'src/utils/documentCompare.ts');

await build({
  entryPoints: [SOURCE],
  outfile: path.join(TMP_DIR, 'bundle.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  alias: {
    '@': path.join(ROOT, 'src'),
  },
});

const { compareToProposedEdits } = await import(
  pathToFileURL(path.join(TMP_DIR, 'bundle.mjs')).href
);

const peSource = path.join(ROOT, 'src/utils/proposedEdit.ts');
await build({
  entryPoints: [peSource],
  outfile: path.join(TMP_DIR, 'pe.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  alias: { '@': path.join(ROOT, 'src') },
});
const { findEditAnchor, applyAllEdits } = await import(
  pathToFileURL(path.join(TMP_DIR, 'pe.mjs')).href
);

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

console.log('document compare tests\n');

test('identical documents yield no edits', () => {
  const r = compareToProposedEdits('Hello\n', 'Hello\n');
  assert.equal(r.edits.length, 0);
});

test('line replace produces unique original', () => {
  const original = 'alpha\nbeta\ngamma\n';
  const revised = 'alpha\nBETA\ngamma\n';
  const r = compareToProposedEdits(original, revised);
  assert.ok(r.edits.length >= 1);
  const edit = r.edits[0];
  assert.ok(original.includes(edit.original));
  const anchor = findEditAnchor(original, edit.original);
  assert.ok(anchor);
  const { next, appliedIds } = applyAllEdits(original, r.edits);
  assert.equal(appliedIds.length, r.edits.length);
  assert.equal(next, revised);
});

test('insert uses surrounding context', () => {
  const original = 'one\nthree\n';
  const revised = 'one\ntwo\nthree\n';
  const r = compareToProposedEdits(original, revised);
  assert.ok(r.edits.length >= 1);
  const { next } = applyAllEdits(original, r.edits);
  assert.equal(next, revised);
});

test('delete hunk', () => {
  const original = 'keep\ngone\nstay\n';
  const revised = 'keep\nstay\n';
  const r = compareToProposedEdits(original, revised);
  const { next } = applyAllEdits(original, r.edits);
  assert.equal(next, revised);
});

test('empty original is a single replace-all edit', () => {
  const r = compareToProposedEdits('', '# New\n');
  assert.equal(r.edits.length, 1);
  assert.equal(r.edits[0].original, '');
  assert.equal(r.edits[0].replacement, '# New\n');
});

if (process.exitCode) {
  console.error('\ndocument compare tests failed');
} else {
  console.log(`\n${passed} passed`);
}

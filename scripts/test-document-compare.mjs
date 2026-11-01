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

test('identical documents still expose the unchanged body', () => {
  const r = compareToProposedEdits('Hello\n', 'Hello\n');
  assert.equal(r.segments.length, 1);
  assert.equal(r.segments[0].kind, 'unchanged');
  assert.equal(r.segments[0].text, 'Hello\n');
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

/* ---- Segments: the document skeleton shown inside the Compare popup ---- */

/** Rebuild the original / revised documents from the segment list. */
function reconstruct(segments) {
  let original = '';
  let revised = '';
  for (const seg of segments) {
    if (seg.kind === 'unchanged') {
      original += seg.text;
      revised += seg.text;
    } else {
      original += seg.originalText;
      revised += seg.revisedText;
    }
  }
  return { original, revised };
}

test('segments reconstruct both documents exactly', () => {
  const cases = [
    ['alpha\nbeta\ngamma\n', 'alpha\nBETA\ngamma\n'],
    ['one\nthree\n', 'one\ntwo\nthree\n'],
    ['a\nb\nc\nd\n', 'a\nX\nc\nY\nd\n'],
    ['a\nb\n', 'a\nb\nc\n'],
    ['a\nb\nc\n', 'a\nc\n'],
    [
      '# T\n\nintro\n\n## H\n\n- a\n- b\n',
      '# T\n\nintro changed\n\n## H\n\n- a\n- b\n- c\n',
    ],
  ];
  for (const [original, revised] of cases) {
    const r = compareToProposedEdits(original, revised);
    const { original: o, revised: v } = reconstruct(r.segments);
    assert.equal(o, original, `original mismatch for ${JSON.stringify(original)}`);
    assert.equal(v, revised, `revised mismatch for ${JSON.stringify(revised)}`);
  }
});

test('segments alternate unchanged and change in document order', () => {
  const original = 'a\nb\nc\nd\n';
  const revised = 'a\nX\nc\nY\nd\n';
  const r = compareToProposedEdits(original, revised);
  assert.deepEqual(
    r.segments.map((s) => s.kind),
    ['unchanged', 'change', 'unchanged', 'change', 'unchanged']
  );
});

test('every change segment points at a real edit', () => {
  const original = 'a\nb\nc\nd\n';
  const revised = 'a\nX\nc\nY\nd\n';
  const r = compareToProposedEdits(original, revised);
  const ids = new Set(r.edits.map((e) => e.id));
  const changeSegments = r.segments.filter((s) => s.kind === 'change');
  assert.equal(changeSegments.length, r.edits.length);
  for (const seg of changeSegments) {
    assert.ok(ids.has(seg.editId), `missing edit ${seg.editId}`);
  }
});

test('unchanged segment text is identical on both sides', () => {
  const original = 'keep\nsame\nend\n';
  const revised = 'keep\nCHANGED\nend\n';
  const r = compareToProposedEdits(original, revised);
  const unchanged = r.segments.filter((s) => s.kind === 'unchanged');
  assert.ok(unchanged.length >= 1);
  for (const seg of unchanged) {
    assert.ok(original.includes(seg.text));
    assert.ok(revised.includes(seg.text));
  }
});

test('an insertion segment has empty original text', () => {
  const original = 'one\nthree\n';
  const revised = 'one\ntwo\nthree\n';
  const r = compareToProposedEdits(original, revised);
  const change = r.segments.find((s) => s.kind === 'change');
  assert.ok(change);
  assert.equal(change.originalText, '');
  assert.equal(change.revisedText, 'two\n');
});

test('a deletion segment has empty revised text', () => {
  const original = 'keep\ngone\nstay\n';
  const revised = 'keep\nstay\n';
  const r = compareToProposedEdits(original, revised);
  const change = r.segments.find((s) => s.kind === 'change');
  assert.ok(change);
  assert.equal(change.originalText, 'gone\n');
  assert.equal(change.revisedText, '');
});

test('a change segment shows only the hunk, not the expanded anchor', () => {
  // An insertion has no removed text, so its edit anchor has to borrow
  // a neighbouring line to stay unique. The segment must still show
  // only the raw hunk so the borrowed line is not duplicated.
  const original = 'one\nthree\n';
  const revised = 'one\ntwo\nthree\n';
  const r = compareToProposedEdits(original, revised);
  const change = r.segments.find((s) => s.kind === 'change');
  assert.ok(change);
  assert.equal(change.originalText, '');
  assert.equal(change.revisedText, 'two\n');
  // The edit itself carries the expanded anchor used for Apply.
  const edit = r.edits.find((e) => e.id === change.editId);
  assert.ok(edit);
  assert.ok(edit.original.length > 0, 'the edit anchor needs context');
  assert.notEqual(edit.original, change.originalText);
});

test('an empty original produces a change segment for the whole document', () => {
  const r = compareToProposedEdits('', '# New\n');
  assert.equal(r.segments.length, 1);
  assert.equal(r.segments[0].kind, 'change');
  assert.equal(r.segments[0].editId, r.edits[0].id);
  assert.equal(r.segments[0].revisedText, '# New\n');
});

if (process.exitCode) {
  console.error('\ndocument compare tests failed');
} else {
  console.log(`\n${passed} passed`);
}

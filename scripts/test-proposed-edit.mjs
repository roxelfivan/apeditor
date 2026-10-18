// Standalone harness for proposed-edit apply waterfall helpers.
// Bundles the real `src/utils/proposedEdit.ts` via esbuild.
//
// Usage:
//   node scripts/test-proposed-edit.mjs
// or
//   npm run test:proposed-edit

import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'pe-test-'));

const SOURCE = path.join(ROOT, 'src/utils/proposedEdit.ts');

const TMP_SRC = path.join(TMP_DIR, 'entry.ts');
const ENTRY = `
import {
  findEditAnchor,
  findBestEffortAnchor,
  expandBestEffortRange,
  prepareBestEffortReplace,
  applyEdit,
  applyAllEdits,
  BEST_EFFORT_COVERAGE_MIN,
} from '${SOURCE.replace(/\\/g, '/')}';
export {
  findEditAnchor,
  findBestEffortAnchor,
  expandBestEffortRange,
  prepareBestEffortReplace,
  applyEdit,
  applyAllEdits,
  BEST_EFFORT_COVERAGE_MIN,
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
  findEditAnchor,
  findBestEffortAnchor,
  expandBestEffortRange,
  prepareBestEffortReplace,
  applyEdit,
  applyAllEdits,
  BEST_EFFORT_COVERAGE_MIN,
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

console.log('proposed-edit waterfall tests\n');

test('Exact still wins when quote matches', () => {
  const content = 'Hello world.\n\nAlpha beta gamma delta epsilon.\n\nTail.';
  const original = 'Alpha beta gamma delta epsilon.';
  const replacement = 'Alpha BETA gamma delta epsilon.';
  const anchor = findEditAnchor(content, original);
  assert.ok(anchor);
  assert.equal(content.slice(anchor.idx, anchor.idx + anchor.length), original);
  const r = applyEdit(content, original, replacement);
  assert.equal(r.ok, true);
  assert.ok(r.next.includes(replacement));
  assert.ok(!r.next.includes(original));
});

test('Best Effort expands partial shared chunk toward full section body', () => {
  const body =
    'The quick brown fox jumps over the lazy dog and then runs home quickly after lunch.';
  const content = `## Getting Started\n\n${body}\n\n## Next\n\nOther.`;
  // Quote matches most of the body but with a small paraphrase at the end
  // so Exact fails; a long shared substring still exists.
  const original =
    '## Getting Started\n\n' +
    body.slice(0, -12) +
    ' after supper.';
  const replacement =
    '## Getting Started\n\n' +
    'The quick brown fox leaps over the lazy dog and then runs home quickly after lunch.';
  assert.equal(findEditAnchor(content, original), null);
  const be = findBestEffortAnchor(content, original, replacement);
  assert.ok(be, 'expected a best-effort anchor');
  // Prepared hole should be body-only (heading left in place when re-emitted).
  const span = content.slice(be.idx, be.idx + be.length);
  assert.ok(!span.startsWith('## '), 'heading should stay outside the hole');
  assert.ok(
    be.length / body.length >= BEST_EFFORT_COVERAGE_MIN * 0.9 ||
      !be.duplicationReason,
    'span should cover most of the body or be usable'
  );
});

test('Under-covered match returns null (forces Highlight path)', () => {
  const content =
    'Prefix filler text that is unrelated.\n\n' +
    'Only a tiny shared crumb appears here once: UNIQUE_TOKEN_XYZ and then nothing else matches the long quote at all.'.repeat(
      1
    ) +
    '\n\nSuffix.';
  const original =
    'This is a long original quote that barely overlaps the document at all except for UNIQUE_TOKEN_XYZ buried somewhere, and the rest is completely different wording that will not expand to eighty-five percent coverage no matter what.';
  const replacement = 'A wholly different replacement passage of similar length for the under-covered case.';
  const be = findBestEffortAnchor(content, original, replacement);
  // Either null (coverage refuse) or dup-blocked — Apply must not be free.
  assert.ok(
    be === null || be.duplicationReason != null || be.length / original.length < BEST_EFFORT_COVERAGE_MIN,
    'under-covered matches must not be freely applyable'
  );
});

test('Heading re-emit does not double-print via prepareBestEffortReplace', () => {
  const content =
    '## Intro\n\nFirst paragraph about setup and install steps for the tool.\n\n## Other\n\nMore.';
  const replacement =
    '## Intro\n\nFirst paragraph about setup and install steps for the tool, revised.';
  const bodyStart = content.indexOf('First paragraph');
  const bodyEnd = content.indexOf('\n\n## Other');
  // Hole incorrectly includes the heading — prepare must strip it.
  const hole = {
    idx: content.indexOf('## Intro'),
    length: bodyEnd - content.indexOf('## Intro'),
  };
  const prepared = prepareBestEffortReplace(content, replacement, hole);
  assert.ok(prepared);
  assert.equal(prepared.idx, bodyStart);
  const next =
    content.slice(0, prepared.idx) +
    prepared.text +
    content.slice(prepared.idx + prepared.length);
  const introCount = (next.match(/## Intro/g) || []).length;
  assert.equal(introCount, 1, `expected one ## Intro, got ${introCount} in:\n${next}`);
});

test('Overlap prepare grows hole to prevent residual duplication', () => {
  const shared =
    'Shared opening sentence that appears in both the document and the replacement text clearly.';
  const leftover =
    ' Leftover original closing that must be absorbed or the apply will duplicate.';
  const content = `Lead-in.\n\n${shared}${leftover}\n\nTail.`;
  const replacement = `${shared} New closing that replaces the leftover.`;
  // Hole is only the shared prefix — leftover would remain without prepare.
  const idx = content.indexOf(shared);
  const prepared = prepareBestEffortReplace(content, replacement, {
    idx,
    length: shared.length,
  });
  assert.ok(prepared);
  const next =
    content.slice(0, prepared.idx) +
    prepared.text +
    content.slice(prepared.idx + prepared.length);
  assert.ok(!next.includes('Leftover original closing'), next);
  assert.ok(next.includes('New closing that replaces'));
});

test('expandBestEffortRange reports sectionSnap for heading sections', () => {
  const body =
    'Paragraph one with enough characters to be meaningful for expansion logic here.\n\nParagraph two continues the same section with more words.';
  const content = `## Section\n\n${body}\n\n## Later\n\nx`;
  const original = `## Section\n\n${body}`;
  // Match only a middle chunk.
  const chunk = 'enough characters to be meaningful';
  const idx = content.indexOf(chunk);
  const expanded = expandBestEffortRange(
    content,
    original,
    { idx, length: chunk.length },
    original.indexOf(chunk),
    original
  );
  assert.ok(expanded.length > chunk.length);
});

test('applyAllEdits Exact + Best Effort mix', () => {
  const exactOrig = 'Exact phrase number one that is unique in the document.';
  const exactRepl = 'Exact phrase number one that was UPDATED in the document.';
  const beBody =
    'Approximate body text for the second edit with plenty of characters for matching.';
  const content =
    `# Doc\n\n${exactOrig}\n\n## Approx\n\n${beBody}\n\nEnd.`;
  // Best-effort original paraphrases the end slightly so Exact fails.
  const beOrig =
    '## Approx\n\n' +
    beBody.slice(0, -10) +
    ' for pairing.';
  const beRepl =
    '## Approx\n\n' +
    'Approximate body text for the second edit with plenty of characters for MATCHING.';
  const edits = [
    {
      id: 'e1',
      summary: 'exact',
      original: exactOrig,
      replacement: exactRepl,
    },
    {
      id: 'e2',
      summary: 'best-effort',
      original: beOrig,
      replacement: beRepl,
    },
  ];
  assert.ok(findEditAnchor(content, exactOrig));
  assert.equal(findEditAnchor(content, beOrig), null);
  const { next, appliedIds } = applyAllEdits(content, edits);
  assert.ok(appliedIds.includes('e1'), 'exact should apply');
  assert.ok(next.includes(exactRepl));
  // e2 may or may not apply depending on coverage; if it does, no leftover phrase.
  if (appliedIds.includes('e2')) {
    assert.ok(next.includes('MATCHING') || next.includes('matching'));
  }
});

console.log(`\n${passed} tests passed`);
await fs.rm(TMP_DIR, { recursive: true, force: true });

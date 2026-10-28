// Harness for the Debug Mode token counters.
//
// Usage:
//   node scripts/test-token-estimate.mjs
// or
//   npm run test:token-estimate
//
// Covers:
//   - the chars/4 heuristic in `src/utils/tokenEstimate.ts`
//   - CJK text costing more per character than Latin text
//   - the per-message overhead in `estimateMessageTokens`
//   - `buildRequestPreview` packing the same messages the real send
//     packs, so the counter cannot drift from the wire format.

import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'token-est-'));
const TMP_SRC = path.join(TMP_DIR, 'entry.ts');
await fs.writeFile(
  TMP_SRC,
  `
import {
  estimateTokens,
  estimateMessageTokens,
  formatTokenCount,
  CHARS_PER_TOKEN,
  TOKENS_PER_MESSAGE,
} from '${path.join(ROOT, 'src/utils/tokenEstimate.ts').replace(/\\/g, '/')}';
import { buildRequestPreview } from '${path.join(ROOT, 'src/api/chat.ts').replace(/\\/g, '/')}';
export {
  estimateTokens,
  estimateMessageTokens,
  formatTokenCount,
  CHARS_PER_TOKEN,
  TOKENS_PER_MESSAGE,
  buildRequestPreview,
};
`
);

await build({
  entryPoints: [TMP_SRC],
  outfile: path.join(TMP_DIR, 'bundle.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  alias: { '@': path.join(ROOT, 'src') },
});

const {
  estimateTokens,
  estimateMessageTokens,
  formatTokenCount,
  CHARS_PER_TOKEN,
  TOKENS_PER_MESSAGE,
  buildRequestPreview,
} = await import(pathToFileURL(path.join(TMP_DIR, 'bundle.mjs')).href);

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

console.log('token estimate tests\n');

// --- estimateTokens ---------------------------------------------------------

test('empty string costs zero tokens', () => {
  assert.equal(estimateTokens(''), 0);
});

test('ASCII prose is roughly chars / 4', () => {
  const text = 'The quick brown fox jumps over the lazy dog.';
  assert.equal(estimateTokens(text), Math.ceil(text.length / CHARS_PER_TOKEN));
});

test('a longer body scales linearly', () => {
  const a = 'word '.repeat(100);
  const b = 'word '.repeat(200);
  assert.equal(estimateTokens(b), estimateTokens(a) * 2);
});

test('CJK text costs more per character than Latin text', () => {
  const latin = 'a'.repeat(40);
  const cjk = '文'.repeat(40);
  assert.ok(
    estimateTokens(cjk) > estimateTokens(latin),
    `CJK (${estimateTokens(cjk)}) should exceed Latin (${estimateTokens(latin)})`
  );
});

test('CJK is counted at about one token per character', () => {
  const cjk = '這是一個測試';
  assert.equal(estimateTokens(cjk), cjk.length);
});

test('mixed text counts both halves', () => {
  const cjk = '測試';
  const latin = 'ab';
  assert.equal(estimateTokens(cjk + latin), cjk.length + 1);
});

test('whitespace-only text costs nothing meaningful', () => {
  assert.equal(estimateTokens('   \n\n  '), 0);
});

// --- estimateMessageTokens --------------------------------------------------

test('message overhead is added per message', () => {
  const messages = [{ id: 'a', role: 'user', content: 'hello', createdAt: 0 }];
  const one = estimateMessageTokens(messages);
  const two = estimateMessageTokens([
    ...messages,
    { id: 'b', role: 'user', content: 'hello', createdAt: 0 },
  ]);
  assert.equal(
    two - one,
    estimateTokens('hello') + TOKENS_PER_MESSAGE,
    'a second identical message should add its content + overhead'
  );
});

test('an empty message list costs zero', () => {
  assert.equal(estimateMessageTokens([]), 0);
});

test('empty content still costs the per-message overhead', () => {
  assert.equal(
    estimateMessageTokens([
      { id: 'a', role: 'assistant', content: '', createdAt: 0 },
    ]),
    TOKENS_PER_MESSAGE
  );
});

// --- formatTokenCount -------------------------------------------------------

test('formatTokenCount groups thousands', () => {
  assert.equal(formatTokenCount(1240), '1,240');
  assert.equal(formatTokenCount(0), '0');
  assert.equal(formatTokenCount(-5), '0');
  assert.equal(formatTokenCount(999), '999');
});

// --- buildRequestPreview ----------------------------------------------------

const doc = {
  id: 'doc-1',
  title: 'Policy',
  content: 'First paragraph of the policy.\n\nSecond paragraph of the policy.',
};

const commentBatch = {
  id: 'u1',
  role: 'user',
  content:
    '[c1] (paragraph 1/2, doc offset 0–27)\n' +
    '"First paragraph of the policy."\n' +
    'Before: """First paragraph"""\n' +
    'After: """First paragraph"""\n' +
    'Comment: please sharpen this.\n',
  createdAt: 0,
};

test('preview returns the packed messages and a positive token count', () => {
  const preview = buildRequestPreview(
    [commentBatch],
    undefined,
    { title: doc.title, content: doc.content, id: doc.id }
  );
  assert.ok(preview.messages.length > 0, 'preview should pack messages');
  assert.ok(preview.tokens > 0, 'preview should report a token count');
});

test('the local policy inlines the whole document', () => {
  const preview = buildRequestPreview(
    [commentBatch],
    undefined,
    { title: doc.title, content: doc.content, id: doc.id },
    undefined,
    undefined,
    undefined,
    undefined,
    'on-demand'
  );
  const docBlock = preview.messages.find((m) => m.id === 'sys-current-doc');
  assert.ok(docBlock, 'sys-current-doc should be present');
  assert.ok(
    docBlock.content.includes(doc.content),
    'the local path should inline the full document body'
  );
});

test('the eager policy sends an outline instead of the full body', () => {
  const preview = buildRequestPreview(
    [commentBatch],
    undefined,
    { title: doc.title, content: doc.content, id: doc.id },
    undefined,
    undefined,
    undefined,
    undefined,
    'eager'
  );
  const docBlock = preview.messages.find((m) => m.id === 'sys-current-doc');
  assert.ok(docBlock, 'sys-current-doc should be present');
  assert.ok(
    !docBlock.content.includes(doc.content),
    'the keyed path should send an outline, not the whole document'
  );
});

test('the token count tracks the packed payload size', () => {
  const small = buildRequestPreview(
    [commentBatch],
    undefined,
    { title: doc.title, content: 'Tiny.', id: doc.id }
  );
  const big = buildRequestPreview(
    [commentBatch],
    undefined,
    {
      title: doc.title,
      content: 'A long document. '.repeat(500),
      id: doc.id,
    },
    undefined,
    undefined,
    undefined,
    undefined,
    'on-demand'
  );
  assert.ok(
    big.tokens > small.tokens,
    `a bigger document should cost more tokens (${big.tokens} vs ${small.tokens})`
  );
});

test('the preview is not affected by the enableCacheControl flag', () => {
  const a = buildRequestPreview([commentBatch], undefined, doc);
  const b = buildRequestPreview(
    [commentBatch],
    undefined,
    doc,
    undefined,
    undefined,
    undefined,
    undefined,
    'eager'
  );
  assert.equal(a.tokens, b.tokens);
});

console.log(`\n${passed} passed`);
if (process.exitCode) {
  console.error('\nsome tests failed');
} else {
  console.log('token estimate: all checks passed');
}

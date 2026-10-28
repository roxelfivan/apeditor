// Regression: the comment-batch and staged-rejection send paths must
// NOT send the user message twice.
//
// Both paths build an outbound history array. If the store snapshot
// is read AFTER the user message is appended, `userMsg` is already in
// the snapshot, and the `[..., userMsg, assistantMsg]` spread appends
// it a second time — sending the whole comment batch to the model
// twice.
//
// That doubled prompt is exactly what blows the Local Model's
// 8192-token KV cache, and it is invisible in the UI (the bubble
// looks normal). This test parses ChatPanel.tsx and asserts the
// snapshot is taken before the append.
//
// Usage:
//   node scripts/test-send-comments-dup.mjs
// or
//   npm run test:send-comments-dup

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(
  path.join(ROOT, 'src/components/ChatPanel.tsx'),
  'utf8'
);

let passed = 0;
function check(name, fn) {
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

console.log('send-comments duplicate-message regression\n');

/**
 * Locate a named function's body by its declaration and return the
 * source text up to its closing brace.
 */
function bodyOf(declMarker) {
  const start = src.indexOf(declMarker);
  assert.ok(start !== -1, `could not find ${declMarker}`);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces after ${declMarker}`);
}

check('onSendComments snapshots the history before appending the user message', () => {
  const body = bodyOf('const onSendComments = async');
  const snapshotAt = body.indexOf('const historyFromStore =');
  const appendAt = body.indexOf('appendMessage(currentDocumentId, userMsg)');
  assert.ok(snapshotAt !== -1, 'historyFromStore snapshot is missing');
  assert.ok(appendAt !== -1, 'the user-message append is missing');
  assert.ok(
    snapshotAt < appendAt,
    'historyFromStore must be read BEFORE the user message is appended, ' +
      'otherwise the batch is sent twice'
  );
});

check('onSendComments adds the user message it appended itself', () => {
  const body = bodyOf('const onSendComments = async');
  const historyLine = body.match(
    /const history = \[\.\.\.historyFromStore,[^\]]*\]/
  );
  assert.ok(historyLine, 'the history spread is missing');
  assert.match(
    historyLine[0],
    /userMsg/,
    'onSendComments should add the user message it appended itself'
  );
});

check('runAssistantReplyAfterCommit does not re-add the caller user message', () => {
  const body = bodyOf('const runAssistantReplyAfterCommit = async');
  const historyLine = body.match(
    /const history = \[\.\.\.historyFromStore,[^\]]*\]/
  );
  assert.ok(historyLine, 'the history spread is missing');
  assert.doesNotMatch(
    historyLine[0],
    /userMsg/,
    'runAssistantReplyAfterCommit receives an ALREADY-APPENDED user ' +
      'message; adding it again sends the body twice'
  );
  assert.doesNotMatch(
    body.match(/const runAssistantReplyAfterCommit = async[\s\S]*?\)\s*=>\s*\{/)[0],
    /userMsg/,
    'runAssistantReplyAfterCommit should not take a user message parameter'
  );
});

check('handleSend keeps using the render-closure history', () => {
  const body = bodyOf('const handleSend = async');
  const historyLine = body.match(/const history = \[\.\.\.messages,[^\]]*\]/);
  assert.ok(historyLine, 'handleSend should build history from `messages`');
});

console.log(`\nsend-comments duplicate regression: ${passed} checks passed`);

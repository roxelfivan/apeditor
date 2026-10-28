// Harness for Local Model comment-batch packing (dedupe, keep user text).
//
// Usage:
//   node scripts/test-local-prompt-compact.mjs
// or
//   npm run test:local-prompt-compact

import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'local-prompt-'));
const TMP_SRC = path.join(TMP_DIR, 'entry.ts');

await fs.writeFile(
  TMP_SRC,
  `
import {
  buildRequestMessages,
  compactCommentBatchForLocal,
  uniqueSubstringOffset,
  formatSelectionContext,
  buildFullWorkingDocMessage,
} from '${path.join(ROOT, 'src/api/chat.ts').replace(/\\\\/g, '/')}';
import { formatCommentBatch } from '${path.join(ROOT, 'src/utils/comments.ts').replace(/\\\\/g, '/')}';
export {
  buildRequestMessages,
  compactCommentBatchForLocal,
  uniqueSubstringOffset,
  formatSelectionContext,
  buildFullWorkingDocMessage,
  formatCommentBatch,
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
  buildRequestMessages,
  compactCommentBatchForLocal,
  uniqueSubstringOffset,
  formatSelectionContext,
  buildFullWorkingDocMessage,
  formatCommentBatch,
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

console.log('local prompt compact tests\n');

const SNIPPET = 'UNIQUE_SNIPPET_ALPHA_omega';
const COMMENT_BODY = 'Please sharpen this UNIQUE_COMMENT_BODY sentence.';
const OTHER_DOC_MARKER = 'OTHER_DOC_GLOSSARY_MARKER';

const currentDoc = {
  id: 'doc-current',
  title: 'Current Policy',
  content:
    `Intro paragraph.\n\n` +
    `The passage says ${SNIPPET} in the middle of the policy.\n\n` +
    `Closing paragraph.`,
};

const otherDoc = {
  id: 'doc-ref-glossary',
  title: 'Glossary',
  content: `Definitions live here. ${OTHER_DOC_MARKER} is a term.`,
};

const comments = [
  {
    id: 'c-real',
    documentId: currentDoc.id,
    start: currentDoc.content.indexOf(SNIPPET),
    end: currentDoc.content.indexOf(SNIPPET) + SNIPPET.length,
    snippet: SNIPPET,
    body: COMMENT_BODY,
    createdAt: 0,
    updatedAt: 0,
    outdated: false,
    sent: false,
    rounds: [],
  },
];

const fatBatch = formatCommentBatch(currentDoc.content, comments);

const mentionOther = {
  id: 'mb',
  kind: 'doc',
  documentId: otherDoc.id,
  documentTitle: 'Glossary',
  paragraphIndexes: [],
  createdAt: 0,
};

const mentionCurrentSection = {
  id: 'ms',
  kind: 'doc-section',
  documentId: currentDoc.id,
  documentTitle: 'Current Policy',
  paragraphIndexes: [1],
  createdAt: 0,
};

const lookup = (id) => {
  if (id === currentDoc.id) return currentDoc;
  if (id === otherDoc.id) return otherDoc;
  return null;
};

function pack(policy, extra = {}) {
  const user = {
    id: 'u1',
    role: 'user',
    content: fatBatch,
    createdAt: 0,
    ...extra,
  };
  return buildRequestMessages(
    [user],
    undefined,
    currentDoc,
    undefined,
    extra.mentions ?? [mentionOther, mentionCurrentSection],
    lookup,
    { 'c-real': [mentionOther] },
    false,
    policy
  );
}

test('compactCommentBatchForLocal drops snippet and Before/After, keeps body', () => {
  assert.match(fatBatch, new RegExp(SNIPPET));
  assert.match(fatBatch, /Before:/);
  assert.match(fatBatch, /After:/);
  const compact = compactCommentBatchForLocal(fatBatch);
  assert.doesNotMatch(compact, new RegExp(SNIPPET));
  assert.doesNotMatch(compact, /Before:/);
  assert.doesNotMatch(compact, /After:/);
  assert.match(compact, /\[c1\] \(paragraph/);
  assert.match(compact, new RegExp(COMMENT_BODY));
  assert.equal(compactCommentBatchForLocal(compact), compact);
});

test('on-demand pack has snippet once (document envelope, not user batch)', () => {
  const msgs = pack('on-demand');
  const joined = msgs.map((m) => m.content).join('\n---\n');
  const snippetHits = joined.split(SNIPPET).length - 1;
  assert.equal(snippetHits, 1, `expected 1 snippet copy, got ${snippetHits}`);
  const user = msgs.find((m) => m.id === 'u1');
  assert.ok(user);
  assert.doesNotMatch(user.content, new RegExp(SNIPPET));
  assert.match(user.content, new RegExp(COMMENT_BODY));
  const doc = msgs.find((m) => m.id === 'sys-current-doc');
  assert.ok(doc);
  assert.match(doc.content, new RegExp(SNIPPET));
  assert.match(doc.content, /<<<DOCUMENT>>>/);
  const batchSys = msgs.find((m) => m.id === 'u1-comments-batch');
  assert.ok(batchSys);
  assert.doesNotMatch(batchSys.content, /Before:/);
  assert.match(batchSys.content, /<<<DOCUMENT>>>/);
});

test('on-demand pack still includes other referenced doc and comment body', () => {
  const msgs = pack('on-demand');
  const joined = msgs.map((m) => m.content).join('\n');
  assert.match(joined, new RegExp(OTHER_DOC_MARKER));
  assert.match(joined, new RegExp(COMMENT_BODY));
  const currentSectionRef = msgs.filter((m) =>
    m.id.startsWith('sys-referenced-doc-')
  );
  assert.equal(currentSectionRef.length, 1);
  assert.match(currentSectionRef[0].content, /Glossary/);
});

test('eager pack is unchanged (still has Before/After and snippet in user batch)', () => {
  const msgs = pack('eager');
  const user = msgs.find((m) => m.id === 'u1');
  assert.equal(user.content, fatBatch);
  assert.match(user.content, /Before:/);
  assert.match(user.content, new RegExp(SNIPPET));
  const batchSys = msgs.find((m) => m.id === 'u1-comments-batch');
  assert.ok(batchSys);
  assert.match(batchSys.content, /Before:/);
  assert.match(batchSys.content, /doc outline/);
  const sectionRef = msgs.find((m) =>
    m.id.startsWith('sys-referenced-doc-')
  );
  assert.ok(sectionRef);
  // Eager keeps current-doc section mention plus the other doc.
  const refCount = msgs.filter((m) =>
    m.id.startsWith('sys-referenced-doc-')
  ).length;
  assert.equal(refCount, 2);
});

test('history comment batches are compacted on a later local turn', () => {
  const older = {
    id: 'u0',
    role: 'user',
    content: fatBatch,
    createdAt: 0,
  };
  const later = {
    id: 'u1',
    role: 'user',
    content: 'follow up',
    createdAt: 1,
  };
  const msgs = buildRequestMessages(
    [older, { id: 'a0', role: 'assistant', content: 'ok', createdAt: 0 }, later],
    undefined,
    currentDoc,
    undefined,
    undefined,
    lookup,
    undefined,
    false,
    'on-demand'
  );
  const packedOld = msgs.find((m) => m.id === 'u0');
  assert.doesNotMatch(packedOld.content, /Before:/);
  assert.match(packedOld.content, new RegExp(COMMENT_BODY));
});

test('unique selection becomes an offset note on local; duplicate stays verbatim', () => {
  const unique = formatSelectionContext(SNIPPET, currentDoc.content);
  assert.match(unique, /unique match at offset/);
  assert.doesNotMatch(unique, /BEGIN EDITOR SELECTION/);
  const missing = formatSelectionContext('not-in-doc', currentDoc.content);
  assert.match(missing, /BEGIN EDITOR SELECTION/);
  const dupDoc = `aa ${SNIPPET} bb ${SNIPPET}`;
  const ambiguous = formatSelectionContext(SNIPPET, dupDoc);
  assert.match(ambiguous, /BEGIN EDITOR SELECTION/);
  assert.equal(uniqueSubstringOffset(currentDoc.content, SNIPPET) !== null, true);
});

test('full working doc is inlined even when longer than the old 6k cap', () => {
  const huge = 'x'.repeat(7000);
  const msg = buildFullWorkingDocMessage('Huge', huge);
  assert.match(msg, /<<<DOCUMENT>>>/);
  assert.ok(msg.includes(huge));
  assert.doesNotMatch(msg, /too large to inline/);
});

console.log(`\n${passed} tests passed`);
await fs.rm(TMP_DIR, { recursive: true, force: true });

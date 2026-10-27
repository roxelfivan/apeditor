// Harness for `src/utils/chatAttachments.ts`.
//
// Usage:
//   node scripts/test-chat-attachments.mjs
// or
//   npm run test:chat-attachments

import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-att-'));
const SOURCE = path.join(ROOT, 'src/utils/chatAttachments.ts');

const TMP_SRC = path.join(TMP_DIR, 'entry.ts');
await fs.writeFile(
  TMP_SRC,
  `
import {
  EMPTY_ATTACHMENT_USER_REQUEST,
  buildAttachmentTurnPrompt,
  formatAttachedFileBlock,
  withOutboundAttachmentPrompt,
} from '${SOURCE.replace(/\\/g, '/')}';
export {
  EMPTY_ATTACHMENT_USER_REQUEST,
  buildAttachmentTurnPrompt,
  formatAttachedFileBlock,
  withOutboundAttachmentPrompt,
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
  EMPTY_ATTACHMENT_USER_REQUEST,
  buildAttachmentTurnPrompt,
  formatAttachedFileBlock,
  withOutboundAttachmentPrompt,
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

console.log('chat attachment prompt tests\n');

const photo = {
  id: 'a1',
  name: 'photo.jpg',
  mime: 'image/jpeg',
  extractedText: 'Invoice #12\nTotal 40',
};
const pdf = {
  id: 'a2',
  name: 'notes.pdf',
  mime: 'application/pdf',
  extractedText: 'Chapter one',
};

test('no attachments returns the typed text unchanged', () => {
  assert.equal(buildAttachmentTurnPrompt('hello', []), 'hello');
});

test('prompt includes both file extracts and the typed request', () => {
  const out = buildAttachmentTurnPrompt('summarise this', [photo, pdf]);
  assert.match(out, /^Do this in order:/);
  assert.match(out, /Convert each attached extract into clean Markdown/);
  assert.match(out, /Then answer the user request/);
  assert.match(out, /BEGIN ATTACHED FILE: photo\.jpg/);
  assert.match(out, /Invoice #12/);
  assert.match(out, /BEGIN ATTACHED FILE: notes\.pdf/);
  assert.match(out, /Chapter one/);
  assert.match(out, /BEGIN USER REQUEST/);
  assert.match(out, /summarise this/);
  assert.match(out, /END USER REQUEST/);
  const fileIdx = out.indexOf('BEGIN ATTACHED FILE: photo.jpg');
  const reqIdx = out.indexOf('BEGIN USER REQUEST');
  assert.ok(fileIdx < reqIdx, 'files must come before the user request');
});

test('empty typed text uses the files-only fallback', () => {
  const out = buildAttachmentTurnPrompt('   ', [photo]);
  assert.match(out, new RegExp(EMPTY_ATTACHMENT_USER_REQUEST.replace(/[()]/g, '\\$&')));
  assert.equal(
    formatAttachedFileBlock(photo.name, photo.extractedText).includes('Invoice'),
    true
  );
});

test('withOutboundAttachmentPrompt rewrites only user turns with files', () => {
  const user = {
    id: 'm1',
    role: 'user',
    content: 'what is the total?',
    createdAt: 1,
    attachments: [photo],
  };
  const outbound = withOutboundAttachmentPrompt(user);
  assert.notEqual(outbound.content, user.content);
  assert.match(outbound.content, /what is the total\?/);
  assert.match(outbound.content, /Invoice #12/);
  assert.equal(user.content, 'what is the total?');

  const plain = {
    id: 'm2',
    role: 'user',
    content: 'hi',
    createdAt: 1,
  };
  assert.equal(withOutboundAttachmentPrompt(plain), plain);

  const assistant = {
    id: 'm3',
    role: 'assistant',
    content: 'ok',
    createdAt: 1,
    attachments: [photo],
  };
  assert.equal(withOutboundAttachmentPrompt(assistant), assistant);
});

console.log(`\n${passed} tests passed`);
await fs.rm(TMP_DIR, { recursive: true, force: true });

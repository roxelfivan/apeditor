// Standalone harness for `src/utils/secrets.ts`.
//
// Usage:
//   node scripts/test-secrets.mjs
// or
//   npm run test:secrets

import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'secrets-'));

const SOURCE = path.join(ROOT, 'src/utils/secrets.ts');
const TMP_SRC = path.join(TMP_DIR, 'entry.ts');
const ENTRY = `
import {
  LIVE_SECRET_MIN_LENGTH,
  redactSecrets,
  redactSecretsInMessages,
  scrubLiveSecretFromExport,
  stripExactSecret,
} from '${SOURCE.replace(/\\/g, '/')}';
export {
  LIVE_SECRET_MIN_LENGTH,
  redactSecrets,
  redactSecretsInMessages,
  scrubLiveSecretFromExport,
  stripExactSecret,
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
  LIVE_SECRET_MIN_LENGTH,
  redactSecrets,
  redactSecretsInMessages,
  scrubLiveSecretFromExport,
  stripExactSecret,
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

console.log('secret redaction tests\n');

test('LIVE_SECRET_MIN_LENGTH is 8', () => {
  assert.equal(LIVE_SECRET_MIN_LENGTH, 8);
});

test('redactSecrets replaces OpenAI-style keys', () => {
  const key = 'sk-' + 'A'.repeat(20);
  const { text, count } = redactSecrets(`please use ${key} today`);
  assert.equal(count, 1);
  assert.equal(text.includes(key), false);
  assert.match(text, /\[redacted\]/);
});

test('redactSecrets replaces Bearer tokens', () => {
  const tok = 'Bearer ' + 'B'.repeat(20);
  const { text, count } = redactSecrets(tok);
  assert.equal(count, 1);
  assert.equal(text.includes('B'.repeat(20)), false);
});

test('redactSecretsInMessages covers content and selection', () => {
  const key = 'sk-proj-' + 'C'.repeat(20);
  const { messages, count } = redactSecretsInMessages([
    { content: `hi ${key}`, selection: `also ${key}` },
  ]);
  assert.equal(count, 2);
  assert.equal(messages[0].content.includes(key), false);
  assert.equal(messages[0].selection.includes(key), false);
});

test('stripExactSecret leaves short needles alone', () => {
  const { text, count } = stripExactSecret('abc abc', 'abc');
  assert.equal(count, 0);
  assert.equal(text, 'abc abc');
});

test('stripExactSecret replaces the live Settings key', () => {
  const secret = 'minimax-live-key-9f3a';
  const { text, count } = stripExactSecret(
    `draft mentions ${secret} twice ${secret}`,
    secret
  );
  assert.equal(count, 2);
  assert.equal(text.includes(secret), false);
  assert.equal(text, 'draft mentions [redacted] twice [redacted]');
});

test('scrubLiveSecretFromExport also catches JSON-escaped quotes', () => {
  const secret = 'key"with"quotes-ok';
  const payload = JSON.stringify({ body: `prefix ${secret} suffix` }, null, 2);
  const out = scrubLiveSecretFromExport(payload, secret);
  assert.equal(out.includes(secret), false);
  assert.equal(out.includes(JSON.stringify(secret).slice(1, -1)), false);
  assert.match(out, /\[redacted\]/);
});

test('scrubLiveSecretFromExport no-ops on empty key', () => {
  const payload = 'hello world';
  assert.equal(scrubLiveSecretFromExport(payload, ''), payload);
  assert.equal(scrubLiveSecretFromExport(payload, '   '), payload);
});

console.log(`\n${passed} tests passed`);
await fs.rm(TMP_DIR, { recursive: true, force: true });

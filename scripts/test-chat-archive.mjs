// Standalone harness for chat turn grouping and archive/restore
// helpers in `src/utils/chatArchive.ts`. Bundles the real source via
// esbuild and asserts with `node:assert/strict`.
//
// Usage:
//   node scripts/test-chat-archive.mjs
// or
//   npm run test:chat-archive

import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-archive-'));

const SOURCE = path.join(ROOT, 'src/utils/chatArchive.ts');

const TMP_SRC = path.join(TMP_DIR, 'entry.ts');
const ENTRY = `
import {
  ARCHIVE_OLD_DEFAULT_MS,
  archiveTitleFromMessages,
  applyArchiveCurrent,
  applyArchiveOld,
  applyDeleteArchivedChat,
  applyRestoreArchivedChat,
  countMessagesOlderThan,
  groupChatTurns,
} from '${SOURCE.replace(/\\/g, '/')}';
export {
  ARCHIVE_OLD_DEFAULT_MS,
  archiveTitleFromMessages,
  applyArchiveCurrent,
  applyArchiveOld,
  applyDeleteArchivedChat,
  applyRestoreArchivedChat,
  countMessagesOlderThan,
  groupChatTurns,
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
  ARCHIVE_OLD_DEFAULT_MS,
  archiveTitleFromMessages,
  applyArchiveCurrent,
  applyArchiveOld,
  applyDeleteArchivedChat,
  applyRestoreArchivedChat,
  countMessagesOlderThan,
  groupChatTurns,
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

function msg(id, role, content, createdAt) {
  return { id, role, content, createdAt };
}

console.log('chat archive tests\n');

test('ARCHIVE_OLD_DEFAULT_MS is 7 days', () => {
  assert.equal(ARCHIVE_OLD_DEFAULT_MS, 7 * 24 * 60 * 60 * 1000);
});

test('groupChatTurns pairs a user message with the following assistant', () => {
  const turns = groupChatTurns([
    msg('u1', 'user', 'hello', 1),
    msg('a1', 'assistant', 'hi', 2),
    msg('u2', 'user', 'more', 3),
    msg('a2', 'assistant', 'ok', 4),
  ]);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].id, 'u1');
  assert.deepEqual(
    turns[0].messages.map((m) => m.id),
    ['u1', 'a1']
  );
  assert.deepEqual(
    turns[1].messages.map((m) => m.id),
    ['u2', 'a2']
  );
});

test('groupChatTurns starts a new turn on each user message', () => {
  const turns = groupChatTurns([
    msg('u1', 'user', 'one', 1),
    msg('u2', 'user', 'two', 2),
    msg('a1', 'assistant', 'ok', 3),
  ]);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].messages.length, 1);
  assert.equal(turns[1].messages.length, 2);
});

test('groupChatTurns keeps a leading assistant as its own turn', () => {
  const turns = groupChatTurns([msg('a1', 'assistant', 'orphan', 1)]);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].id, 'a1');
});

test('archiveTitleFromMessages uses the first user line', () => {
  assert.equal(
    archiveTitleFromMessages([
      msg('u1', 'user', 'First line\nSecond', 1),
      msg('a1', 'assistant', 'reply', 2),
    ]),
    'First line'
  );
  assert.equal(archiveTitleFromMessages([]), 'Chat');
});

test('applyArchiveCurrent parks the live thread and empties it', () => {
  const live = [msg('u1', 'user', 'keep me', 1)];
  const next = applyArchiveCurrent(live, [], 1000);
  assert.ok(next);
  assert.deepEqual(next.live, []);
  assert.equal(next.archives.length, 1);
  assert.equal(next.archives[0].title, 'keep me');
  assert.equal(next.archives[0].archivedAt, 1000);
  assert.equal(next.archives[0].messages[0].id, 'u1');
});

test('applyArchiveCurrent is a no-op on an empty live thread', () => {
  assert.equal(applyArchiveCurrent([], [{ id: 'x' }]), null);
});

test('applyArchiveOld splits on createdAt and prepends one archive', () => {
  const now = 10_000;
  const olderThanMs = 1_000;
  const live = [
    msg('old', 'user', 'old', 1),
    msg('new', 'user', 'new', 9_500),
  ];
  const next = applyArchiveOld(live, [], olderThanMs, now);
  assert.ok(next);
  assert.equal(next.archivedCount, 1);
  assert.equal(next.live.length, 1);
  assert.equal(next.live[0].id, 'new');
  assert.equal(next.archives[0].messages[0].id, 'old');
});

test('applyArchiveOld is a no-op when nothing is old enough', () => {
  const now = 10_000;
  const live = [msg('new', 'user', 'new', 9_500)];
  assert.equal(applyArchiveOld(live, [], 1_000, now), null);
  assert.equal(countMessagesOlderThan(live, 1_000, now), 0);
});

test('restore swaps live for the archive and parks a non-empty live thread', () => {
  const live = [msg('live', 'user', 'current', 2)];
  const archives = [
    {
      id: 'arch-1',
      title: 'parked',
      archivedAt: 1,
      messages: [msg('old', 'user', 'parked', 1)],
    },
  ];
  const next = applyRestoreArchivedChat(live, archives, 'arch-1', 50);
  assert.ok(next);
  assert.equal(next.live[0].id, 'old');
  assert.equal(next.archives.length, 1);
  assert.equal(next.archives[0].title, 'current');
  assert.equal(
    next.archives.some((a) => a.id === 'arch-1'),
    false
  );
});

test('restore with empty live does not create a new archive', () => {
  const archives = [
    {
      id: 'arch-1',
      title: 'parked',
      archivedAt: 1,
      messages: [msg('old', 'user', 'parked', 1)],
    },
  ];
  const next = applyRestoreArchivedChat([], archives, 'arch-1', 50);
  assert.ok(next);
  assert.equal(next.archives.length, 0);
  assert.equal(next.live[0].id, 'old');
});

test('restore is a no-op for an unknown archive id', () => {
  assert.equal(applyRestoreArchivedChat([], [], 'missing'), null);
});

test('delete archived chat drops that row only', () => {
  const archives = [
    { id: 'a', title: 'A', archivedAt: 1, messages: [] },
    { id: 'b', title: 'B', archivedAt: 2, messages: [] },
  ];
  const next = applyDeleteArchivedChat(archives, 'a');
  assert.deepEqual(
    next.map((x) => x.id),
    ['b']
  );
  assert.equal(applyDeleteArchivedChat(archives, 'missing'), null);
});

console.log(`\n${passed} passed`);
await fs.rm(TMP_DIR, { recursive: true, force: true });

// Standalone harness for the JSON backup round-trip path in
// `src/utils/backup.ts`. Bundles the real source via esbuild and
// asserts against `node:assert/strict`.
//
// Usage:
//   node scripts/test-backup-roundtrip.mjs
// or
//   npm run test:backup-roundtrip

import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-rt-'));

const SOURCE = path.join(ROOT, 'src/utils/backup.ts');

const TMP_SRC = path.join(TMP_DIR, 'entry.ts');
const ENTRY = `
import {
  BACKUP_SCHEMA,
  BACKUP_VERSION,
  BACKUP_MAX_FILE_BYTES,
  BackupParseError,
  buildDocumentBackup,
  serialiseDocumentBackup,
  parseDocumentBackup,
  resolveImportDecisions,
  buildKeepBothDocument,
} from '${SOURCE.replace(/\\/g, '/')}';
export {
  BACKUP_SCHEMA,
  BACKUP_VERSION,
  BACKUP_MAX_FILE_BYTES,
  BackupParseError,
  buildDocumentBackup,
  serialiseDocumentBackup,
  parseDocumentBackup,
  resolveImportDecisions,
  buildKeepBothDocument,
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
  BACKUP_SCHEMA,
  BACKUP_VERSION,
  BACKUP_MAX_FILE_BYTES,
  BackupParseError,
  buildDocumentBackup,
  serialiseDocumentBackup,
  parseDocumentBackup,
  resolveImportDecisions,
  buildKeepBothDocument,
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

console.log('backup round-trip tests\n');

// -------------------------------------------------------------------------
// Fixtures
// -------------------------------------------------------------------------

const fixtureDocuments = [
  {
    id: 'doc-existing',
    title: 'Existing doc',
    content: 'Existing body content.',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
];

const fixtureCommentsByDoc = {
  'doc-existing': [
    {
      id: 'c1',
      documentId: 'doc-existing',
      start: 0,
      end: 7,
      snippet: 'Existing',
      body: 'a note',
      createdAt: 1700000000100,
      updatedAt: 1700000000100,
      outdated: false,
      sent: false,
      rounds: [
        {
          id: 'c1r1',
          start: 0,
          end: 7,
          snippet: 'Existing',
          body: 'a note',
          createdAt: 1700000000100,
          updatedAt: 1700000000100,
          outdated: false,
          sent: false,
          applied: [],
          mentions: [
            {
              id: 'mtok1',
              kind: 'doc',
              documentId: 'doc-existing',
              documentTitle: 'Existing doc',
              paragraphIndexes: [],
              createdAt: 1700000000200,
              reason: 'context',
              referrerId: null,
            },
          ],
        },
      ],
    },
  ],
};

const fixtureChatsByDoc = {
  'doc-existing': [
    {
      id: 'm1',
      role: 'user',
      content: 'hello',
      createdAt: 1700000000300,
    },
  ],
};

const fixtureRevisionsByDoc = {
  'doc-existing': [
    {
      id: 'r1',
      documentId: 'doc-existing',
      content: 'prior snapshot',
      createdAt: 1700000000400,
      label: 'before edit',
    },
  ],
};

// -------------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------------

test('exports the schema + version constants', () => {
  assert.equal(BACKUP_SCHEMA, 'apeditor-document-backup');
  assert.equal(BACKUP_VERSION, 1);
  assert.equal(BACKUP_MAX_FILE_BYTES, 50 * 1024 * 1024);
});

// -------------------------------------------------------------------------
// Round-trip happy path
// -------------------------------------------------------------------------

test('build → serialise → parse round-trips a populated DocumentBackup', () => {
  const built = buildDocumentBackup({
    documentId: 'doc-existing',
    documents: fixtureDocuments,
    comments: fixtureCommentsByDoc,
    chats: fixtureChatsByDoc,
    revisions: fixtureRevisionsByDoc,
  });
  assert.ok(built);

  const text = serialiseDocumentBackup(built);
  const parsed = parseDocumentBackup(text);

  assert.equal(parsed.document.id, fixtureDocuments[0].id);
  assert.equal(parsed.document.title, fixtureDocuments[0].title);
  assert.equal(parsed.document.content, fixtureDocuments[0].content);
  assert.equal(parsed.document.createdAt, fixtureDocuments[0].createdAt);
  assert.equal(parsed.document.updatedAt, fixtureDocuments[0].updatedAt);

  assert.equal(parsed.comments.length, 1);
  assert.equal(parsed.comments[0].id, 'c1');
  assert.equal(parsed.comments[0].documentId, 'doc-existing');
  assert.equal(parsed.comments[0].rounds.length, 1);
  assert.equal(parsed.comments[0].rounds[0].id, 'c1r1');
  assert.equal(parsed.comments[0].rounds[0].mentions.length, 1);
  assert.equal(
    parsed.comments[0].rounds[0].mentions[0].documentTitle,
    'Existing doc'
  );

  assert.equal(parsed.chats.length, 1);
  assert.equal(parsed.chats[0].id, 'm1');
  assert.equal(parsed.chats[0].role, 'user');
  assert.deepEqual(parsed.chatArchives, []);

  assert.equal(parsed.revisions.length, 1);
  assert.equal(parsed.revisions[0].id, 'r1');
  assert.equal(parsed.revisions[0].label, 'before edit');

  assert.equal(parsed.meta.schema, BACKUP_SCHEMA);
  assert.equal(parsed.meta.version, BACKUP_VERSION);
});

test('empty slices round-trip with empty arrays (never undefined)', () => {
  const built = buildDocumentBackup({
    documentId: 'd-only',
    documents: [
      { id: 'd-only', title: 'Only', content: '', createdAt: 1, updatedAt: 1 },
    ],
    comments: { 'd-only': [] },
    chats: { 'd-only': [] },
    revisions: { 'd-only': [] },
  });
  assert.ok(built);
  const text = serialiseDocumentBackup(built);
  const parsed = parseDocumentBackup(text);
  assert.deepEqual(parsed.comments, []);
  assert.deepEqual(parsed.chats, []);
  assert.deepEqual(parsed.chatArchives, []);
  assert.deepEqual(parsed.revisions, []);
});

test('chatArchives round-trip when present', () => {
  const built = buildDocumentBackup({
    documentId: 'doc-existing',
    documents: fixtureDocuments,
    comments: fixtureCommentsByDoc,
    chats: fixtureChatsByDoc,
    chatArchives: {
      'doc-existing': [
        {
          id: 'arch-1',
          title: 'old thread',
          archivedAt: 1700000000500,
          messages: [
            {
              id: 'm-old',
              role: 'user',
              content: 'previous',
              createdAt: 1690000000000,
            },
          ],
        },
      ],
    },
    revisions: fixtureRevisionsByDoc,
  });
  assert.ok(built);
  const parsed = parseDocumentBackup(serialiseDocumentBackup(built));
  assert.equal(parsed.chatArchives.length, 1);
  assert.equal(parsed.chatArchives[0].id, 'arch-1');
  assert.equal(parsed.chatArchives[0].title, 'old thread');
  assert.equal(parsed.chatArchives[0].messages[0].id, 'm-old');
});

test('parse treats a missing chatArchives field as an empty array', () => {
  const built = buildDocumentBackup({
    documentId: 'doc-existing',
    documents: fixtureDocuments,
    comments: fixtureCommentsByDoc,
    chats: fixtureChatsByDoc,
    revisions: fixtureRevisionsByDoc,
  });
  assert.ok(built);
  const obj = JSON.parse(serialiseDocumentBackup(built));
  delete obj.chatArchives;
  const parsed = parseDocumentBackup(JSON.stringify(obj));
  assert.deepEqual(parsed.chatArchives, []);
  assert.equal(parsed.chats[0].id, 'm1');
});

test('parse rejects a non-array chatArchives field', () => {
  const built = buildDocumentBackup({
    documentId: 'doc-existing',
    documents: fixtureDocuments,
    comments: fixtureCommentsByDoc,
    chats: fixtureChatsByDoc,
    revisions: fixtureRevisionsByDoc,
  });
  assert.ok(built);
  const obj = JSON.parse(serialiseDocumentBackup(built));
  obj.chatArchives = { not: 'an array' };
  assert.throws(
    () => parseDocumentBackup(JSON.stringify(obj)),
    (err) =>
      err instanceof BackupParseError &&
      /invalid array field: chatArchives/i.test(err.message)
  );
});

test('buildDocumentBackup returns null for unknown documentId', () => {
  const result = buildDocumentBackup({
    documentId: 'does-not-exist',
    documents: fixtureDocuments,
    comments: fixtureCommentsByDoc,
    chats: fixtureChatsByDoc,
    revisions: fixtureRevisionsByDoc,
  });
  assert.equal(result, null);
});

// -------------------------------------------------------------------------
// Error paths
// -------------------------------------------------------------------------

test('parseDocumentBackup throws BackupParseError on non-JSON input', () => {
  assert.throws(
    () => parseDocumentBackup('not valid json'),
    (err) => err instanceof BackupParseError && /Could not parse/i.test(err.message)
  );
});

test('parseDocumentBackup throws on root-not-object', () => {
  assert.throws(
    () => parseDocumentBackup('[]'),
    (err) => err instanceof BackupParseError && /root is not an object/i.test(err.message)
  );
});

test('parseDocumentBackup throws on wrong schema', () => {
  const bad = JSON.stringify({
    schema: 'something-else',
    version: 1,
    exportedAt: 0,
    appVersion: 'x',
    document: { id: 'd', title: 't', content: '', createdAt: 0, updatedAt: 0 },
    comments: [],
    chats: [],
    revisions: [],
  });
  assert.throws(
    () => parseDocumentBackup(bad),
    (err) =>
      err instanceof BackupParseError && /not an ApEditor backup/.test(err.message)
  );
});

test('parseDocumentBackup throws on unsupported version', () => {
  const bad = JSON.stringify({
    schema: BACKUP_SCHEMA,
    version: 99,
    exportedAt: 0,
    appVersion: 'x',
    document: { id: 'd', title: 't', content: '', createdAt: 0, updatedAt: 0 },
    comments: [],
    chats: [],
    revisions: [],
  });
  assert.throws(
    () => parseDocumentBackup(bad),
    (err) =>
      err instanceof BackupParseError && /Unsupported backup version 99/.test(err.message)
  );
});

test('parseDocumentBackup throws on missing document.id', () => {
  const bad = JSON.stringify({
    schema: BACKUP_SCHEMA,
    version: 1,
    exportedAt: 0,
    appVersion: 'x',
    document: { title: 't', content: '', createdAt: 0, updatedAt: 0 },
    comments: [],
    chats: [],
    revisions: [],
  });
  assert.throws(
    () => parseDocumentBackup(bad),
    (err) =>
      err instanceof BackupParseError && /document\.id/.test(err.message) === false &&
      /string field/i.test(err.message)
  );
});

test('parseDocumentBackup throws when a comment references a different documentId', () => {
  const built = buildDocumentBackup({
    documentId: 'doc-existing',
    documents: fixtureDocuments,
    comments: {
      'doc-existing': [
        {
          id: 'c1',
          documentId: 'doc-other',
          start: 0,
          end: 7,
          snippet: 'Existing',
          body: 'note',
          createdAt: 1,
          updatedAt: 1,
          outdated: false,
          sent: false,
          rounds: [
            {
              id: 'c1r1',
              start: 0,
              end: 7,
              snippet: 'Existing',
              body: 'note',
              createdAt: 1,
              updatedAt: 1,
              outdated: false,
              sent: false,
              applied: [],
            },
          ],
        },
      ],
    },
    chats: {},
    revisions: {},
  });
  assert.ok(built);
  const text = serialiseDocumentBackup(built);
  assert.throws(
    () => parseDocumentBackup(text),
    (err) =>
      err instanceof BackupParseError &&
      /comment c1 belongs to document "doc-other"/.test(err.message)
  );
});

test('parseDocumentBackup throws when a revision references a different documentId', () => {
  const built = buildDocumentBackup({
    documentId: 'doc-existing',
    documents: fixtureDocuments,
    comments: {},
    chats: {},
    revisions: {
      'doc-existing': [
        {
          id: 'r1',
          documentId: 'doc-other',
          content: 'x',
          createdAt: 1,
        },
      ],
    },
  });
  assert.ok(built);
  const text = serialiseDocumentBackup(built);
  assert.throws(
    () => parseDocumentBackup(text),
    (err) =>
      err instanceof BackupParseError &&
      /revision r1 belongs to document "doc-other"/.test(err.message)
  );
});

test('parseDocumentBackup throws when comment top-level range does not mirror the latest round', () => {
  const built = buildDocumentBackup({
    documentId: 'doc-existing',
    documents: fixtureDocuments,
    comments: {
      'doc-existing': [
        {
          id: 'c1',
          documentId: 'doc-existing',
          start: 0,
          end: 7,
          snippet: 'Existing',
          body: 'note',
          createdAt: 1,
          updatedAt: 1,
          outdated: false,
          sent: false,
          rounds: [
            // Older round with a different range — legal (older anchors
            // can move). Latest round also has range (0, 7), matching
            // the comment. Then we hand-edit the text to diverge so
            // we can assert the guard.
            {
              id: 'c1r1',
              start: 0,
              end: 5,
              snippet: 'Exist',
              body: 'note',
              createdAt: 1,
              updatedAt: 2,
              outdated: false,
              sent: false,
              applied: [],
            },
            {
              id: 'c1r2',
              start: 0,
              end: 7,
              snippet: 'Existing',
              body: 'follow-up',
              createdAt: 2,
              updatedAt: 3,
              outdated: false,
              sent: false,
              applied: [],
            },
          ],
        },
      ],
    },
    chats: {},
    revisions: {},
  });
  assert.ok(built);
  const text = serialiseDocumentBackup(built);
  // Latest round DOES mirror — round-trip should pass.
  const parsed = parseDocumentBackup(text);
  assert.equal(parsed.comments[0].rounds.length, 2);
});

test('parseDocumentBackup rejects when latest-round range diverges from comment top-level', () => {
  const obj = JSON.parse(
    serialiseDocumentBackup(
      buildDocumentBackup({
        documentId: 'doc-existing',
        documents: fixtureDocuments,
        comments: fixtureCommentsByDoc,
        chats: {},
        revisions: {},
      })
    )
  );
  // Force divergence by mutating the latest round AFTER serialisation.
  obj.comments[0].rounds[0].start = 1;
  obj.comments[0].rounds[0].end = 8;
  assert.throws(
    () => parseDocumentBackup(JSON.stringify(obj)),
    (err) =>
      err instanceof BackupParseError && /does not mirror its latest round/i.test(err.message)
  );
});

// -------------------------------------------------------------------------
// resolveImportDecisions
// -------------------------------------------------------------------------

test('resolveImportDecisions: replace when id collides and no explicit choice', () => {
  const built = buildDocumentBackup({
    documentId: 'doc-existing',
    documents: fixtureDocuments,
    comments: fixtureCommentsByDoc,
    chats: fixtureChatsByDoc,
    revisions: fixtureRevisionsByDoc,
  });
  const parsed = parseDocumentBackup(serialiseDocumentBackup(built));
  const decisions = resolveImportDecisions({
    parsed,
    documents: fixtureDocuments,
  });
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].documentId, 'doc-existing');
  assert.equal(decisions[0].strategy, 'replace');
  assert.equal(decisions[0].sourceTitle, 'Existing doc');
});

test('resolveImportDecisions: keep-both mints a fresh id and appends the suffix', () => {
  const parsed = parseDocumentBackup(
    serialiseDocumentBackup(
      buildDocumentBackup({
        documentId: 'doc-existing',
        documents: fixtureDocuments,
        comments: fixtureCommentsByDoc,
        chats: fixtureChatsByDoc,
        revisions: fixtureRevisionsByDoc,
      })
    )
  );
  const decisions = resolveImportDecisions({
    parsed,
    documents: fixtureDocuments,
    userChoices: { 'doc-existing': 'keep-both' },
  });
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].strategy, 'keep-both');
  assert.notEqual(decisions[0].documentId, 'doc-existing');
  // Id should not already be in the store.
  assert.equal(
    fixtureDocuments.some((d) => d.id === decisions[0].documentId),
    false
  );
});

test('resolveImportDecisions: skip when no collision and caller opts out', () => {
  const parsed = parseDocumentBackup(
    serialiseDocumentBackup(
      buildDocumentBackup({
        documentId: 'doc-existing',
        documents: fixtureDocuments,
        comments: fixtureCommentsByDoc,
        chats: fixtureChatsByDoc,
        revisions: fixtureRevisionsByDoc,
      })
    )
  );
  const decisions = resolveImportDecisions({
    parsed,
    documents: [], // no collision
    userChoices: { 'doc-existing': 'skip' },
  });
  assert.equal(decisions[0].strategy, 'skip');
  assert.equal(decisions[0].documentId, 'doc-existing');
});

test('resolveImportDecisions: non-colliding id defaults to keep-both', () => {
  const parsed = parseDocumentBackup(
    serialiseDocumentBackup(
      buildDocumentBackup({
        documentId: 'doc-existing',
        documents: fixtureDocuments,
        comments: fixtureCommentsByDoc,
        chats: fixtureChatsByDoc,
        revisions: fixtureRevisionsByDoc,
      })
    )
  );
  const decisions = resolveImportDecisions({
    parsed,
    documents: [], // empty store — definitely no collision
  });
  assert.equal(decisions[0].strategy, 'keep-both');
  assert.notEqual(decisions[0].documentId, 'doc-existing');
});

// -------------------------------------------------------------------------
// buildKeepBothDocument
// -------------------------------------------------------------------------

test('buildKeepBothDocument appends (imported) and sanitises the title', () => {
  const doc = buildKeepBothDocument({
    newId: 'new-uuid',
    sourceTitle: 'Project Plan',
    sourceContent: 'body',
    sourceCreatedAt: 1,
    sourceUpdatedAt: 2,
  });
  assert.equal(doc.id, 'new-uuid');
  assert.equal(doc.title, 'Project Plan (imported)');
  assert.equal(doc.content, 'body');
  assert.equal(doc.createdAt, 1);
  assert.equal(doc.updatedAt, 2);
});

test('buildKeepBothDocument sanitises reserved characters and caps at 80 chars', () => {
  const tooLong = 'X'.repeat(120);
  const doc = buildKeepBothDocument({
    newId: 'new-uuid',
    sourceTitle: tooLong,
    sourceContent: '',
    sourceCreatedAt: 0,
    sourceUpdatedAt: 0,
  });
  assert.ok(doc.title.endsWith('(imported)'), `got: ${doc.title}`);
  assert.ok(doc.title.length <= 80, `expected <=80 chars, got ${doc.title.length}`);
});

console.log(`\n${passed} tests passed`);
await fs.rm(TMP_DIR, { recursive: true, force: true });

/**
 * Tests for `src/utils/collections.ts` — the pure logic behind the
 * Documents sidebar collections (named groups of documents).
 *
 * Same shape as `scripts/test-tags.mjs`: bundle the module with
 * esbuild, import it, and assert with `node:assert/strict`.
 */
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'collections-'));
const SOURCE = path.join(ROOT, 'src/utils/collections.ts');

await build({
  entryPoints: [SOURCE],
  outfile: path.join(TMP_DIR, 'bundle.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
});

const {
  normalizeGroupName,
  normalizeGroupIds,
  sanitizeGroups,
  sortGroups,
  docsForGroup,
  ungroupedDocs,
  pruneGroupIds,
  isCollapsed,
  toggleCollapsed,
  mergeGroups,
  remapGroupIds,
} = await import(pathToFileURL(path.join(TMP_DIR, 'bundle.mjs')).href);

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

console.log('collection tests\n');

test('normalize names: trim, collapse whitespace, cap length', () => {
  assert.equal(normalizeGroupName('  Project X  '), 'Project X');
  assert.equal(normalizeGroupName('Reading   list'), 'Reading list');
  assert.equal(normalizeGroupName('   '), null);
  assert.equal(normalizeGroupName(''), null);
  assert.equal(normalizeGroupName(undefined), null);
  assert.equal(normalizeGroupName('x'.repeat(200)).length, 60);
});

test('normalize ids: drop non-strings and blanks, dedupe', () => {
  assert.deepEqual(
    normalizeGroupIds(['a', 'b', 'a', '', '  ', null, undefined, 'c']),
    ['a', 'b', 'c']
  );
  assert.deepEqual(normalizeGroupIds(undefined), []);
});

test('sanitizeGroups drops malformed entries and duplicate ids', () => {
  const groups = sanitizeGroups([
    { id: 'g1', name: 'One', createdAt: 5 },
    { id: 'g1', name: 'Duplicate', createdAt: 6 },
    { id: '', name: 'No id', createdAt: 1 },
    { id: 'g2', name: '   ', createdAt: 2 },
    { id: 'g3', name: 'Three' },
    'not an object',
    null,
  ]);
  assert.deepEqual(groups, [
    { id: 'g1', name: 'One', createdAt: 5 },
    { id: 'g3', name: 'Three', createdAt: 0 },
  ]);
});

test('sanitizeGroups tolerates a missing / non-array payload', () => {
  assert.deepEqual(sanitizeGroups(undefined), []);
  assert.deepEqual(sanitizeGroups('nope'), []);
  assert.deepEqual(sanitizeGroups({}), []);
});

test('sortGroups orders by creation, then name', () => {
  const sorted = sortGroups([
    { id: 'b', name: 'Beta', createdAt: 20 },
    { id: 'a', name: 'Alpha', createdAt: 10 },
    { id: 'c', name: 'Gamma', createdAt: 10 },
  ]);
  assert.deepEqual(
    sorted.map((g) => g.id),
    ['a', 'c', 'b']
  );
});

test('docsForGroup picks multi-members, ungroupedDocs picks the rest', () => {
  const docs = [
    { id: '1', groupIds: ['g1'] },
    { id: '2', groupIds: ['g1', 'g2'] },
    { id: '3', groupIds: [] },
    { id: '4' },
  ];
  assert.deepEqual(
    docsForGroup(docs, 'g1').map((d) => d.id),
    ['1', '2']
  );
  assert.deepEqual(
    docsForGroup(docs, 'g2').map((d) => d.id),
    ['2']
  );
  assert.deepEqual(
    ungroupedDocs(docs).map((d) => d.id),
    ['3', '4']
  );
});

test('pruneGroupIds drops ids with no matching collection', () => {
  const known = new Set(['g1', 'g2']);
  assert.deepEqual(pruneGroupIds(['g1', 'ghost', 'g2', 'g1'], known), [
    'g1',
    'g2',
  ]);
  assert.deepEqual(pruneGroupIds(undefined, known), []);
});

test('collapse helpers toggle ids and report state', () => {
  let collapsed = toggleCollapsed([], 'recent');
  assert.deepEqual(collapsed, ['recent']);
  assert.equal(isCollapsed(collapsed, 'recent'), true);
  assert.equal(isCollapsed(collapsed, 'pinned'), false);
  collapsed = toggleCollapsed(collapsed, 'recent');
  assert.deepEqual(collapsed, []);
  assert.equal(isCollapsed(undefined, 'recent'), false);
});

test('mergeGroups reuses local ids and mints missing ones', () => {
  let counter = 0;
  const { groups, idMap } = mergeGroups(
    [{ id: 'g1', name: 'Existing', createdAt: 1 }],
    [
      { id: 'g1', name: 'Existing', createdAt: 1 },
      { id: 'gX', name: 'From backup', createdAt: 2 },
    ],
    () => `new-${++counter}`
  );
  assert.deepEqual(groups.map((g) => g.id), ['g1', 'new-1']);
  assert.equal(idMap.get('g1'), 'g1');
  assert.equal(idMap.get('gX'), 'new-1');
});

test('remapGroupIds rewrites ids and drops unmapped ones', () => {
  const idMap = new Map([
    ['gX', 'new-1'],
    ['gY', 'new-2'],
  ]);
  assert.deepEqual(remapGroupIds(['gX', 'gY', 'ghost'], idMap), [
    'new-1',
    'new-2',
  ]);
  assert.deepEqual(remapGroupIds(undefined, idMap), []);
});

if (process.exitCode) {
  console.error('\ncollection tests failed');
} else {
  console.log(`\n${passed} passed`);
}

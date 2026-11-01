import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'tags-'));
const SOURCE = path.join(ROOT, 'src/utils/tags.ts');

await build({
  entryPoints: [SOURCE],
  outfile: path.join(TMP_DIR, 'bundle.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
});

const {
  normalizeTagPath,
  extractHashtags,
  mergeDocumentTags,
  buildTagTree,
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

console.log('tag tests\n');

test('normalize nested paths', () => {
  assert.equal(normalizeTagPath('#drafts/essays'), 'drafts/essays');
  assert.equal(normalizeTagPath('  drafts/essays  '), 'drafts/essays');
  assert.equal(normalizeTagPath('not a tag!'), null);
  assert.equal(normalizeTagPath('1bad'), null);
});

test('extract hashtags, ignore ATX and code', () => {
  const md = `# Heading is not a tag

Notes #drafts/essays and #inbox.

\`\`\`
#fake
\`\`\`

Inline \`#nope\` stays code.
`;
  assert.deepEqual(extractHashtags(md), ['drafts/essays', 'inbox']);
});

test('merge explicit + body tags', () => {
  const tags = mergeDocumentTags(['inbox'], 'Hello #drafts/essays');
  assert.deepEqual(tags, ['inbox', 'drafts/essays']);
});

test('nested tree groups exact paths', () => {
  const tree = buildTagTree([
    { id: 'a', tags: ['drafts/essays'] },
    { id: 'b', tags: ['drafts'] },
    { id: 'c', tags: ['inbox'] },
  ]);
  assert.equal(tree.length, 2);
  const drafts = tree.find((n) => n.name === 'drafts');
  assert.ok(drafts);
  assert.deepEqual(drafts.docIds, ['b']);
  assert.equal(drafts.children.length, 1);
  assert.equal(drafts.children[0].path, 'drafts/essays');
  assert.deepEqual(drafts.children[0].docIds, ['a']);
});

if (process.exitCode) {
  console.error('\ntag tests failed');
} else {
  console.log(`\n${passed} passed`);
}

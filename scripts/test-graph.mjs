// Standalone harness for Graph wikilink parse + workspace compile.
//
// Usage:
//   node scripts/test-graph.mjs
// or
//   npm run test:graph

import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-test-'));

const REACT_STUB = path.join(TMP_DIR, 'react-stub.js');
const STORE_STUB = path.join(TMP_DIR, 'store-stub.js');
await fs.writeFile(
  REACT_STUB,
  `export default {}; export const useState=()=>{}; export const useMemo=(f)=>f(); export const useEffect=()=>{};`
);
await fs.writeFile(
  STORE_STUB,
  `export const useStore = () => ({ documents: [], currentDocumentId: null });`
);

const TMP_SRC = path.join(TMP_DIR, 'entry.ts');
await fs.writeFile(
  TMP_SRC,
  `
import { extractWikilinks, resolveWikilink, normalizeWikiSlug } from '${path.join(ROOT, 'src/utils/graph/parseWikilinks.ts').replace(/\\/g, '/')}';
import { buildWorkspaceGraph, documentNodeId, headingNodeId, termNodeId, splitHeadingPath } from '${path.join(ROOT, 'src/utils/graph/buildWorkspaceGraph.ts').replace(/\\/g, '/')}';
export { extractWikilinks, resolveWikilink, normalizeWikiSlug, buildWorkspaceGraph, documentNodeId, headingNodeId, termNodeId, splitHeadingPath };
`
);

await build({
  entryPoints: [TMP_SRC],
  outfile: path.join(TMP_DIR, 'bundle.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  alias: {
    '@': path.join(ROOT, 'src'),
    react: REACT_STUB,
    '@/store/useStore': STORE_STUB,
  },
});

const {
  extractWikilinks,
  resolveWikilink,
  normalizeWikiSlug,
  buildWorkspaceGraph,
  documentNodeId,
  headingNodeId,
  termNodeId,
  splitHeadingPath,
} = await import(pathToFileURL(path.join(TMP_DIR, 'bundle.mjs')).href);

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

function doc(id, title, content) {
  return { id, title, content, createdAt: 1, updatedAt: 1 };
}

test('skips mention sentinels', () => {
  const content =
    'See \u200B[[mention:abc|doc|Ideas||ideas-id|context|]]\u200B and [[real-term]].';
  const links = extractWikilinks(content);
  assert.equal(links.length, 1);
  assert.equal(links[0].target, 'real-term');
});

test('parses alias and heading fragment', () => {
  const links = extractWikilinks('See [[Ideas#Just write|the ideas page]].');
  assert.equal(links.length, 1);
  assert.equal(links[0].target, 'Ideas');
  assert.equal(links[0].heading, 'Just write');
});

test('resolves matching document title', () => {
  const ideas = doc('ideas', 'Ideas', '# Just write\n\nHello.\n');
  const welcome = doc('welcome', 'Welcome', 'See [[Ideas]].');
  const match = extractWikilinks(welcome.content)[0];
  const resolved = resolveWikilink(match, [welcome, ideas], {});
  assert.equal(resolved.kind, 'document');
  assert.equal(resolved.documentId, 'ideas');
});

test('dangling [[word]] is a term slug', () => {
  const welcome = doc('welcome', 'Welcome', 'Mark [[photosynthesis]] here.');
  const match = extractWikilinks(welcome.content)[0];
  const resolved = resolveWikilink(match, [welcome], {});
  assert.equal(resolved.kind, 'term');
  assert.equal(resolved.slug, normalizeWikiSlug('photosynthesis'));
});

test('graph: resolved wikilink + dangling term + heading tree', () => {
  const ideas = doc('ideas', 'Ideas', '# Alpha\n\nbody\n\n## Beta\n\nmore\n');
  const welcome = doc(
    'welcome',
    'Welcome',
    '# Start\n\nSee [[Ideas]] and [[orphan-term]].\n'
  );
  const { nodes, edges } = buildWorkspaceGraph([welcome, ideas], {});
  assert.ok(nodes.some((n) => n.id === documentNodeId('welcome')));
  assert.ok(nodes.some((n) => n.id === documentNodeId('ideas')));
  assert.ok(nodes.some((n) => n.id === termNodeId('orphan-term')));
  assert.ok(
    nodes.some((n) => n.kind === 'heading' && n.label === 'Start')
  );
  assert.ok(
    edges.some(
      (e) =>
        e.kind === 'wikilink' &&
        e.target === documentNodeId('ideas')
    )
  );
  assert.ok(
    edges.some(
      (e) => e.kind === 'wikilink' && e.target === termNodeId('orphan-term')
    )
  );
  const alpha = nodes.find((n) => n.kind === 'heading' && n.label === 'Alpha');
  const beta = nodes.find((n) => n.kind === 'heading' && n.label === 'Beta');
  assert.ok(alpha && beta);
  assert.ok(
    edges.some(
      (e) =>
        e.kind === 'heading' &&
        e.source === headingNodeId('ideas', alpha.start) &&
        e.target === headingNodeId('ideas', beta.start)
    )
  );
});

test('graph: comment @ mention becomes an edge', () => {
  const ideas = doc('ideas', 'Ideas', 'plain');
  const welcome = doc('welcome', 'Welcome', 'plain');
  const comments = {
    welcome: [
      {
        id: 'c1',
        documentId: 'welcome',
        start: 0,
        end: 5,
        snippet: 'plain',
        body: 'see this',
        createdAt: 1,
        updatedAt: 1,
        outdated: false,
        sent: false,
        rounds: [
          {
            id: 'r1',
            start: 0,
            end: 5,
            snippet: 'plain',
            body: 'see this',
            createdAt: 1,
            updatedAt: 1,
            outdated: false,
            sent: false,
            applied: [],
            mentions: [
              {
                id: 'm1',
                kind: 'doc',
                documentId: 'ideas',
                documentTitle: 'Ideas',
                paragraphIndexes: [],
                createdAt: 1,
              },
            ],
          },
        ],
      },
    ],
  };
  const { edges } = buildWorkspaceGraph([welcome, ideas], comments);
  assert.ok(
    edges.some(
      (e) =>
        e.kind === '@' &&
        e.source === documentNodeId('welcome') &&
        e.target === documentNodeId('ideas')
    )
  );
});

test('splitHeadingPath on Comment > annotate', () => {
  assert.deepEqual(splitHeadingPath('Comment > annotate'), [
    'Comment',
    'annotate',
  ]);
  assert.deepEqual(splitHeadingPath('Predict → sentence suggestion'), [
    'Predict',
    'sentence suggestion',
  ]);
});

test('graph: path titles nest under a shared parent', () => {
  const ideas = doc(
    'ideas',
    'Ideas',
    '# Comment > annotate\n\na\n\n# Comment > feedback\n\nb\n\n# Predict > ghost text\n\nc\n\n# Predict > sentence suggestion\n\nd\n'
  );
  const { nodes, edges } = buildWorkspaceGraph([ideas], {});
  const comment = nodes.find(
    (n) => n.kind === 'heading' && n.label === 'Comment'
  );
  const predict = nodes.find(
    (n) => n.kind === 'heading' && n.label === 'Predict'
  );
  const annotate = nodes.find(
    (n) => n.kind === 'heading' && n.label === 'annotate'
  );
  const feedback = nodes.find(
    (n) => n.kind === 'heading' && n.label === 'feedback'
  );
  const ghost = nodes.find(
    (n) => n.kind === 'heading' && n.label === 'ghost text'
  );
  const sentence = nodes.find(
    (n) => n.kind === 'heading' && n.label === 'sentence suggestion'
  );
  assert.ok(comment && predict && annotate && feedback && ghost && sentence);
  assert.equal(
    nodes.filter((n) => n.label === 'Comment').length,
    1
  );
  assert.ok(
    edges.some(
      (e) =>
        e.kind === 'heading' &&
        e.source === comment.id &&
        e.target === annotate.id
    )
  );
  assert.ok(
    edges.some(
      (e) =>
        e.kind === 'heading' &&
        e.source === comment.id &&
        e.target === feedback.id
    )
  );
  assert.ok(
    edges.some(
      (e) =>
        e.kind === 'heading' &&
        e.source === predict.id &&
        e.target === ghost.id
    )
  );
  assert.ok(
    edges.some(
      (e) =>
        e.kind === 'heading' &&
        e.source === predict.id &&
        e.target === sentence.id
    )
  );
  assert.ok(
    !edges.some(
      (e) =>
        e.source === documentNodeId('ideas') && e.target === annotate.id
    )
  );
});

console.log(`${passed} passed`);

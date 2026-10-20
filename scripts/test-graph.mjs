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
import { layoutWorkspaceGraph, nodeRadius, countProperEdgeCrossings } from '${path.join(ROOT, 'src/utils/graph/layoutWorkspaceGraph.ts').replace(/\\/g, '/')}';
import { clampGraphZoom, stepGraphZoom, zoomedViewBox } from '${path.join(ROOT, 'src/utils/graph/graphCamera.ts').replace(/\\/g, '/')}';
export { extractWikilinks, resolveWikilink, normalizeWikiSlug, buildWorkspaceGraph, documentNodeId, headingNodeId, termNodeId, splitHeadingPath, layoutWorkspaceGraph, nodeRadius, countProperEdgeCrossings, clampGraphZoom, stepGraphZoom, zoomedViewBox };
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
  layoutWorkspaceGraph,
  nodeRadius,
  countProperEdgeCrossings,
  clampGraphZoom,
  stepGraphZoom,
  zoomedViewBox,
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

test('camera: zoom boxes shrink toward the center', () => {
  const box = zoomedViewBox(-100, -50, 200, 100, 2);
  assert.equal(box.w, 100);
  assert.equal(box.h, 50);
  assert.equal(box.x, -50);
  assert.equal(box.y, -25);
  assert.equal(clampGraphZoom(99), 4);
  assert.equal(clampGraphZoom(0), 0.5);
  assert.ok(stepGraphZoom(1, 1) > 1);
  assert.ok(stepGraphZoom(1, -1) < 1);
});

test('layout: node bullets are at least double the original size', () => {
  assert.equal(nodeRadius('document', false), 36);
  assert.equal(nodeRadius('heading', true), 26);
  assert.equal(nodeRadius('heading', false), 20);
  assert.equal(nodeRadius('term', false), 16);
});

test('layout: document clusters stay apart', () => {
  const welcome = doc(
    'welcome',
    'Welcome',
    '# One\n\na\n\n# Two\n\nb\n\n# Three\n\nc\n\nSee [[Ideas]].\n'
  );
  const ideas = doc(
    'ideas',
    'Ideas',
    '# Alpha\n\nx\n\n# Beta\n\ny\n\n# Gamma\n\nz\n'
  );
  const g = buildWorkspaceGraph([welcome, ideas], {});
  const laid = layoutWorkspaceGraph(g.nodes, g.edges, 'welcome');
  const w = laid.find((n) => n.kind === 'document' && n.documentId === 'welcome');
  const i = laid.find((n) => n.kind === 'document' && n.documentId === 'ideas');
  assert.ok(w && i);
  const dist = Math.hypot(w.x - i.x, w.y - i.y);
  assert.ok(dist > 280, `expected document hubs far apart, got ${dist}`);
});

test('layout: Welcome H1/H2 ring does not collapse', () => {
  const sections = Array.from({ length: 10 }, (_, i) => {
    const n = i + 1;
    return `## ${n}. Section title number ${n}\n\nbody\n`;
  }).join('\n');
  const welcome = doc(
    'welcome',
    'Welcome',
    `# Welcome to ApEditor\n\nintro\n\n${sections}`
  );
  const ideas = doc('ideas', 'Ideas', '# Ideas\n\n- note\n');
  const g = buildWorkspaceGraph([welcome, ideas], {});
  const laid = layoutWorkspaceGraph(g.nodes, g.edges, 'welcome');
  const minPair = 150;
  for (let i = 0; i < laid.length; i++) {
    for (let j = i + 1; j < laid.length; j++) {
      const a = laid[i];
      const b = laid[j];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      assert.ok(
        dist >= minPair,
        `overlap ${a.label} ↔ ${b.label}: ${dist.toFixed(1)} < ${minPair}`
      );
    }
  }
  const h1 = laid.find((n) => n.label === 'Welcome to ApEditor');
  const kids = laid.filter((n) => /^\d+\.\s/.test(n.label));
  assert.ok(h1 && kids.length === 10, `expected H1 + 10 H2s, got h1=${!!h1} kids=${kids.length}`);
  const radii = kids.map((n) => Math.hypot(n.x - h1.x, n.y - h1.y));
  const minR = Math.min(...radii);
  assert.ok(minR > 180, `H2s too close to H1: ${minR}`);
  const headingEdges = g.edges.filter((e) => e.kind === 'heading');
  const crosses = countProperEdgeCrossings(laid, headingEdges);
  assert.equal(crosses, 0, `heading edges should not cross, got ${crosses}`);
});

test('layout: wikilink satellites stay on heading rays', () => {
  const welcome = doc(
    'welcome',
    'Welcome',
    `# Hub\n\n## Alpha\n\nSee [[Ideas]] and [[photon]].\n\n## Beta\n\nSee [[quark]].\n`
  );
  const ideas = doc('ideas', 'Ideas', '# Ideas\n\nnote\n');
  const comment = doc(
    'comment',
    'Comment',
    '# Comment > annotate\n\nx\n\n# Comment > feedback\n\ny\n'
  );
  const g = buildWorkspaceGraph([welcome, ideas, comment], {});
  const laid = layoutWorkspaceGraph(g.nodes, g.edges, 'welcome');
  const headingEdges = g.edges.filter((e) => e.kind === 'heading');
  assert.equal(
    countProperEdgeCrossings(laid, headingEdges),
    0,
    'heading tree of a 3-doc workspace should stay planar-radial'
  );
  const hub = laid.find((n) => n.kind === 'document' && n.documentId === 'welcome');
  const ideasDoc = laid.find((n) => n.kind === 'document' && n.documentId === 'ideas');
  assert.ok(hub && ideasDoc);
  assert.ok(
    Math.hypot(hub.x - ideasDoc.x, hub.y - ideasDoc.y) > 280,
    'satellite document should sit outside the nucleus'
  );
});

console.log(`${passed} passed`);

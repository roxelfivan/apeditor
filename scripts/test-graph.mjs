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
import { extractWikilinks, resolveWikilink, normalizeWikiSlug, formatWikilinksForPreview } from '${path.join(ROOT, 'src/utils/graph/parseWikilinks.ts').replace(/\\/g, '/')}';
import { buildWorkspaceGraph, documentNodeId, headingNodeId, termNodeId, splitHeadingPath } from '${path.join(ROOT, 'src/utils/graph/buildWorkspaceGraph.ts').replace(/\\/g, '/')}';
import { layoutWorkspaceGraph, nodeRadius, countProperEdgeCrossings, headingDepthByNode } from '${path.join(ROOT, 'src/utils/graph/layoutWorkspaceGraph.ts').replace(/\\/g, '/')}';
import { clampGraphZoom, stepGraphZoom, zoomedViewBox, fitCameraTo, panCamera, screenToWorld, worldToScreen, zoomCameraAt, cameraBounds } from '${path.join(ROOT, 'src/utils/graph/graphCamera.ts').replace(/\\/g, '/')}';
import { toSphere, toScreen, rotateSphere, isFrontFacing, dragToOrientation, angularDistance, IDENTITY_ORIENTATION } from '${path.join(ROOT, 'src/utils/graph/sphereProject.ts').replace(/\\/g, '/')}';
import { applyFisheye, fisheyeRatio, boundaryPointOnRay, clampMagnification, applyFisheyeToNodes } from '${path.join(ROOT, 'src/utils/graph/fisheyeLens.ts').replace(/\\/g, '/')}';
import { conceptZForDepth, conceptHeadingY, siblingStoryCount, conceptTermSlot, conceptZoomBy, conceptCameraPosition, dragToConceptPose, clampConceptPose, conceptDistanceFromZoom, floorPointFromRay, layoutToWorld, assignConceptHeights, conceptPoseFromCamera, MIN_CONCEPT_DISTANCE, MAX_CONCEPT_DISTANCE, DEFAULT_CONCEPT_DISTANCE, DEFAULT_CONCEPT_POSE, CONCEPT_HEADING_BASE_Z, CONCEPT_Z_STEP, CONCEPT_TERM_DEPTH, CONCEPT_TERM_RING_R, CONCEPT_SIBLINGS_PER_STORY, CONCEPT_SIBLING_STORIES_MAX, MIN_POLAR_ANGLE, MAX_POLAR_ANGLE } from '${path.join(ROOT, 'src/utils/graph/conceptProject.ts').replace(/\\/g, '/')}';
export { extractWikilinks, resolveWikilink, normalizeWikiSlug, formatWikilinksForPreview, buildWorkspaceGraph, documentNodeId, headingNodeId, termNodeId, splitHeadingPath, layoutWorkspaceGraph, nodeRadius, countProperEdgeCrossings, headingDepthByNode, clampGraphZoom, stepGraphZoom, zoomedViewBox, fitCameraTo, panCamera, screenToWorld, worldToScreen, zoomCameraAt, cameraBounds, toSphere, toScreen, rotateSphere, isFrontFacing, dragToOrientation, angularDistance, IDENTITY_ORIENTATION, applyFisheye, fisheyeRatio, boundaryPointOnRay, clampMagnification, applyFisheyeToNodes, conceptZForDepth, conceptHeadingY, siblingStoryCount, conceptTermSlot, conceptZoomBy, conceptCameraPosition, dragToConceptPose, clampConceptPose, conceptDistanceFromZoom, floorPointFromRay, layoutToWorld, assignConceptHeights, conceptPoseFromCamera, MIN_CONCEPT_DISTANCE, MAX_CONCEPT_DISTANCE, DEFAULT_CONCEPT_DISTANCE, DEFAULT_CONCEPT_POSE, CONCEPT_HEADING_BASE_Z, CONCEPT_Z_STEP, CONCEPT_TERM_DEPTH, CONCEPT_TERM_RING_R, CONCEPT_SIBLINGS_PER_STORY, CONCEPT_SIBLING_STORIES_MAX, MIN_POLAR_ANGLE, MAX_POLAR_ANGLE };
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
  formatWikilinksForPreview,
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
  fitCameraTo,
  panCamera,
  screenToWorld,
  worldToScreen,
  zoomCameraAt,
  cameraBounds,
  toSphere,
  toScreen,
  rotateSphere,
  isFrontFacing,
  dragToOrientation,
  angularDistance,
  IDENTITY_ORIENTATION,
  applyFisheye,
  fisheyeRatio,
  boundaryPointOnRay,
  clampMagnification,
  applyFisheyeToNodes,
  headingDepthByNode,
  conceptZForDepth,
  conceptHeadingY,
  siblingStoryCount,
  conceptTermSlot,
  conceptZoomBy,
  conceptCameraPosition,
  dragToConceptPose,
  clampConceptPose,
  conceptDistanceFromZoom,
  floorPointFromRay,
  layoutToWorld,
  assignConceptHeights,
  conceptPoseFromCamera,
  MIN_CONCEPT_DISTANCE,
  MAX_CONCEPT_DISTANCE,
  DEFAULT_CONCEPT_DISTANCE,
  DEFAULT_CONCEPT_POSE,
  CONCEPT_HEADING_BASE_Z,
  CONCEPT_Z_STEP,
  CONCEPT_TERM_DEPTH,
  CONCEPT_TERM_RING_R,
  CONCEPT_SIBLINGS_PER_STORY,
  CONCEPT_SIBLING_STORIES_MAX,
  MIN_POLAR_ANGLE,
  MAX_POLAR_ANGLE,
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
  assert.equal(links[0].alias, 'the ideas page');
});

test('preview formats wikilinks without brackets', () => {
  const out = formatWikilinksForPreview(
    'See [[Ideas]] and [[Page#Heading|label]] plus [[orphan]].'
  );
  assert.equal(
    out,
    'See <span class="wiki-link">Ideas</span> and <span class="wiki-link">label</span> plus <span class="wiki-link">orphan</span>.'
  );
  assert.ok(!out.includes('[['));
  assert.ok(!out.includes(']]'));
});

test('preview skips mention sentinels', () => {
  const content =
    'Hi \u200B[[mention:abc|doc|Ideas||ideas-id|context|]]\u200B and [[term]].';
  const out = formatWikilinksForPreview(content);
  assert.ok(out.includes('[[mention:abc|doc|Ideas||ideas-id|context|]]'));
  assert.ok(out.includes('<span class="wiki-link">term</span>'));
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

// --- camera ---------------------------------------------------------------

test('camera: fit places the bounds centre at the viewport centre', () => {
  const cam = fitCameraTo(
    { minX: -400, minY: -200, width: 800, height: 400 },
    { w: 800, h: 400 }
  );
  assert.equal(cam.cx, 0);
  assert.equal(cam.cy, 0);
  assert.ok(Math.abs(cam.scale - 1) < 1e-9);
});

test('camera: fit uses "meet" so the whole bounds stay visible', () => {
  const cam = fitCameraTo(
    { minX: 0, minY: 0, width: 1000, height: 200 },
    { w: 500, h: 500 }
  );
  const b = cameraBounds(cam, { w: 500, h: 500 });
  assert.ok(b.width >= 1000, 'fitted bounds must cover the data width');
  assert.ok(b.height >= 200, 'fitted bounds must cover the data height');
});

test('camera: pan moves content with the pointer at any zoom', () => {
  for (const scale of [0.25, 1, 4]) {
    const start = { cx: 100, cy: 50, scale };
    const moved = panCamera(start, 30, -20);
    // Dragging right must move the world left, by exactly dx / scale.
    assert.ok(Math.abs(moved.cx - (100 - 30 / scale)) < 1e-9);
    assert.ok(Math.abs(moved.cy - (50 + 20 / scale)) < 1e-9);
    assert.equal(moved.scale, scale, 'pan must not change zoom');
  }
});

test('camera: screenToWorld and worldToScreen round-trip', () => {
  const cam = { cx: 120, cy: -40, scale: 2.5 };
  const s = worldToScreen(cam, 300, -90);
  const w = screenToWorld(cam, s.x, s.y);
  assert.ok(Math.abs(w.x - 300) < 1e-9);
  assert.ok(Math.abs(w.y - -90) < 1e-9);
});

test('camera: zoom keeps the anchored point under the cursor', () => {
  const cam = { cx: 0, cy: 0, scale: 1 };
  // Anchor at screen offset (80, -40).
  const worldBefore = screenToWorld(cam, 80, -40);
  const zoomed = zoomCameraAt(cam, 4, 80, -40);
  const after = worldToScreen(zoomed, worldBefore.x, worldBefore.y);
  assert.ok(Math.abs(after.x - 80) < 1e-9, `x drifted to ${after.x}`);
  assert.ok(Math.abs(after.y - -40) < 1e-9, `y drifted to ${after.y}`);
});

// --- sphere ---------------------------------------------------------------

test('sphere: layout maps onto a sphere of exactly R', () => {
  const R = 2600;
  for (const [x, y] of [[0, 0], [100, 0], [-900, 450], [2600, 0], [5000, -3000]]) {
    const p = toSphere(x, y, R);
    assert.ok(
      Math.abs(Math.hypot(p.x, p.y, p.z) - R) < 1e-6,
      `point ${x},${y} left the sphere: |P| = ${Math.hypot(p.x, p.y, p.z)}`
    );
  }
});

test('sphere: projection is an exact round-trip at identity orientation', () => {
  const R = 2600;
  for (const [x, y] of [[0, 0], [250, -125], [-1200, 800]]) {
    const back = toScreen(toSphere(x, y, R), R);
    assert.ok(Math.abs(back.x - x) < 1e-6, `x drift ${back.x - x}`);
    assert.ok(Math.abs(back.y - y) < 1e-6, `y drift ${back.y - y}`);
  }
});

test('sphere: the origin faces the viewer', () => {
  assert.ok(toSphere(0, 0, 2600).z > 0);
  assert.ok(isFrontFacing(toSphere(0, 0, 2600)));
});

test('sphere: rotation preserves the radius', () => {
  const R = 2600;
  const p = toSphere(400, -300, R);
  for (const orient of [
    { yaw: 0.7, pitch: 0.3 },
    { yaw: -2.1, pitch: -1.0 },
    IDENTITY_ORIENTATION,
  ]) {
    const q = rotateSphere(p, orient);
    assert.ok(
      Math.abs(Math.hypot(q.x, q.y, q.z) - R) < 1e-6,
      'rotation must be a pure rotation, not a rescaling'
    );
  }
});

test('sphere: identity rotation is a no-op', () => {
  const p = toSphere(123, -456, 2600);
  const q = rotateSphere(p, IDENTITY_ORIENTATION);
  assert.ok(Math.abs(q.x - p.x) < 1e-12);
  assert.ok(Math.abs(q.y - p.y) < 1e-12);
  assert.ok(Math.abs(q.z - p.z) < 1e-12);
});

test('sphere: yaw carries the near pole off the visible cap', () => {
  const R = 2600;
  const origin = toSphere(0, 0, R);
  const turned = rotateSphere(origin, { yaw: Math.PI / 2, pitch: 0 });
  // Yaw spins about Y, so a quarter turn moves the near pole onto the
  // horizon, where it sits exactly on the cap boundary.
  assert.ok(Math.abs(turned.z) < 1e-6, 'a quarter turn lands on the horizon');
  assert.ok(
    angularDistance(origin, turned) > 1.5,
    'the near pole must actually travel a quarter circumference'
  );
  // Past the quarter turn it is genuinely behind the viewer.
  assert.ok(
    !isFrontFacing(rotateSphere(origin, { yaw: Math.PI, pitch: 0 })),
    'a half turn must hide the near pole'
  );
});

test('sphere: drag maps horizontal travel to yaw', () => {
  // Gain is pixels-per-radian; a drag of exactly that many pixels is 1 rad.
  const gain = 400 / Math.PI;
  const o = dragToOrientation(IDENTITY_ORIENTATION, gain, 0, gain);
  assert.ok(Math.abs(o.yaw - 1) < 1e-9, `yaw ${o.yaw} should be 1 radian`);
  const back = dragToOrientation(IDENTITY_ORIENTATION, 0, gain, gain);
  assert.ok(Math.abs(back.pitch - 1) < 1e-9);
});

test('sphere: a pane-wide drag turns roughly a half revolution', () => {
  const pane = 900;
  const gain = pane / Math.PI;
  const o = dragToOrientation(IDENTITY_ORIENTATION, pane, 0, gain);
  assert.ok(
    Math.abs(o.yaw - Math.PI) < 1e-9,
    `pane-wide drag should be pi radians, got ${o.yaw}`
  );
});

test('sphere: pitch is clamped away from the poles', () => {
  const o = dragToOrientation(IDENTITY_ORIENTATION, 0, 1e9, 1);
  assert.ok(o.pitch <= Math.PI / 2, 'pitch must not reach the pole');
  assert.ok(o.pitch > 1.4, 'but must still allow a useful tilt');
});

// --- fisheye lens ---------------------------------------------------------

test('fisheye: m = 0 is an exact identity', () => {
  const bounds = { minX: -500, minY: -500, width: 1000, height: 1000 };
  const focal = { x: 0, y: 0 };
  for (const p of [{ x: 0, y: 0 }, { x: 300, y: -120 }, { x: -800, y: 450 }]) {
    const out = applyFisheye(p, focal, 0, bounds);
    assert.deepEqual(out, p, 'a zero magnification lens must not move anything');
  }
});

test('fisheye: ratio curve magnifies near and compresses far', () => {
  assert.equal(fisheyeRatio(0.4, 0), 0.4, 'm = 0 leaves beta alone');
  const m = 10;
  // The curve lifts every beta, but by a *decreasing* factor: that relative
  // squeeze is what compresses the far field toward the boundary while
  // leaving the focal region large. Check the ratios fall monotonically.
  const nearRatio = fisheyeRatio(0.05, m) / 0.05;
  const midRatio = fisheyeRatio(0.5, m) / 0.5;
  const farRatio = fisheyeRatio(0.95, m) / 0.95;
  assert.ok(nearRatio > midRatio, `${nearRatio} > ${midRatio}`);
  assert.ok(midRatio > farRatio, `${midRatio} > ${farRatio}`);
  assert.ok(nearRatio > 2, 'the focal region is meaningfully magnified');
  assert.ok(farRatio > 1, 'but nothing is pushed inward');
  for (const mm of [1, 10, 40]) {
    assert.ok(fisheyeRatio(1, mm) < 2, 'ratio must approach (m+1)/m, bounded');
  }
});

test('fisheye: boundary point lies on the bounds and on the ray', () => {
  const bounds = { minX: -500, minY: -300, width: 1000, height: 600 };
  const focal = { x: -100, y: 50 };
  const p = { x: 400, y: 200 };
  const b = boundaryPointOnRay(focal, p, bounds);
  const onRight = Math.abs(b.x - (bounds.minX + bounds.width)) < 1e-6;
  const onTop = Math.abs(b.y - bounds.minY) < 1e-6;
  assert.ok(onRight || onTop, 'boundary point must sit on an edge');
  // Collinear with focal → p.
  const cross =
    (p.x - focal.x) * (b.y - focal.y) - (p.y - focal.y) * (b.x - focal.x);
  assert.ok(Math.abs(cross) < 1e-6, 'boundary point must lie on the ray');
});

test('fisheye: magnification pushes nodes away from the focus', () => {
  const bounds = { minX: -1000, minY: -1000, width: 2000, height: 2000 };
  const focal = { x: 0, y: 0 };
  const p = { x: 600, y: 0 };
  const out = applyFisheye(p, focal, 10, bounds);
  const before = Math.hypot(p.x - focal.x, p.y - focal.y);
  const after = Math.hypot(out.x - focal.x, out.y - focal.y);
  assert.ok(after > before, 'the far field compresses outward, not inward');
});

test('fisheye: lens does not move the focus itself', () => {
  const bounds = { minX: -500, minY: -500, width: 1000, height: 1000 };
  const focal = { x: 120, y: -80 };
  const out = applyFisheye(focal, focal, 12, bounds);
  assert.ok(Math.hypot(out.x - focal.x, out.y - focal.y) < 1e-6);
});

test('fisheye: lens is skipped wholesale at m = 0', () => {
  const nodes = [{ id: 'a', x: 1, y: 2 }, { id: 'b', x: -3, y: 4 }];
  const bounds = { minX: -500, minY: -500, width: 1000, height: 1000 };
  assert.equal(
    applyFisheyeToNodes(nodes, { x: 0, y: 0 }, 0, bounds),
    nodes,
    'identity lens must return the same array, not a copy'
  );
});

test('fisheye: magnification is clamped to a usable range', () => {
  assert.equal(clampMagnification(-5), 0);
  assert.equal(clampMagnification(0), 0);
  assert.ok(clampMagnification(1e9) <= 40);
  assert.ok(clampMagnification(NaN) === 0);
});

// --- 3D Concept projection ------------------------------------------------

test('concept: heading depth is tree depth, not radial shell', () => {
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
  const depth = headingDepthByNode(g.edges);

  // The H1 is a root even though the 2D layout collapses it onto the
  // nucleus ring — that collapse is exactly why shell depth would be
  // wrong as a height coordinate.
  const h1 = g.nodes.find((n) => n.label === 'Welcome to ApEditor');
  const ideasH1 = g.nodes.find(
    (n) => n.kind === 'heading' && n.label === 'Ideas'
  );
  assert.ok(h1 && ideasH1, 'fixture should produce both H1s');
  assert.equal(depth.get(h1.id), 0, 'a top-level heading is depth 0');
  assert.equal(depth.get(ideasH1.id), 0);

  const kids = g.nodes.filter((n) => /^\d+\.\s/.test(n.label));
  assert.equal(kids.length, 10);
  for (const kid of kids) {
    assert.equal(depth.get(kid.id), 1, `${kid.label} should be one tier down`);
  }
});

test('concept: nested headings climb one tier per level', () => {
  const ideas = doc(
    'ideas',
    'Ideas',
    '# Comment > annotate\n\na\n\n# Comment > feedback\n\nb\n\n# Predict > ghost text\n\nc\n\n# Predict > sentence suggestion\n\nd\n'
  );
  const g = buildWorkspaceGraph([ideas], {});
  const depth = headingDepthByNode(g.edges);
  const byLabel = (label) =>
    g.nodes.find((n) => n.kind === 'heading' && n.label === label);

  // `heading-path:` prefix nodes are synthetic parents — real headings
  // hang one level below them, not at their depth.
  assert.equal(depth.get(byLabel('Comment').id), 0);
  assert.equal(depth.get(byLabel('annotate').id), 1);
  assert.equal(depth.get(byLabel('feedback').id), 1);
  assert.equal(depth.get(byLabel('Predict').id), 0);
  assert.equal(depth.get(byLabel('ghost text').id), 1);
});

test('concept: depth map holds no document or term nodes', () => {
  const welcome = doc('welcome', 'Welcome', '# Start\n\nSee [[orphan]].\n');
  const g = buildWorkspaceGraph([welcome], {});
  const depth = headingDepthByNode(g.edges);
  assert.equal(depth.size, 1, 'only the one heading carries a depth');
  assert.equal(depth.has(documentNodeId('welcome')), false);
  assert.equal(depth.has(termNodeId('orphan')), false);
});

test('concept: a cyclic heading edge list terminates', () => {
  // `buildWorkspaceGraph` cannot produce a cycle, but the walk must be
  // total so a malformed graph degrades instead of hanging the tab.
  const depth = headingDepthByNode([
    { id: 'a', source: 'x', target: 'y', kind: 'heading' },
    { id: 'b', source: 'y', target: 'z', kind: 'heading' },
    { id: 'c', source: 'z', target: 'y', kind: 'heading' },
  ]);
  assert.equal(depth.get('y'), 0);
  assert.equal(depth.get('z'), 1);
});

test('concept: heading tiers rise monotonically with depth', () => {
  // v0.5.8 spread the stack so a tall document does not collapse onto the
  // floor. The exact numbers are pin-stable — bump them deliberately and
  // update func_spec/10-graph-view.md together.
  assert.equal(conceptZForDepth(0), 270);
  assert.equal(conceptZForDepth(1), 405);
  assert.equal(conceptZForDepth(2), 540);
  // Documents sit at 0, so the first tier must clear them.
  assert.ok(conceptZForDepth(0) > 0, 'a heading tier must sit above the floor');
  // Non-integer and negative depths are clamped, not propagated.
  assert.equal(conceptZForDepth(-3), conceptZForDepth(0));
  assert.equal(conceptZForDepth(1.4), conceptZForDepth(1));
  assert.equal(conceptZForDepth(NaN), conceptZForDepth(0));
});

test('concept: headings space out at least one sphere-radius per tier', () => {
  // The slider value for `spacing per tier is wider than a node sphere'.
  // Step must exceed the heading node diameter so two tiers never
  // interpenetrate under any camera angle.
  const minRadius = nodeRadius('heading', false); // leaf heading
  const stepGap = conceptZForDepth(1) - conceptZForDepth(0);
  assert.ok(
    stepGap > 2 * minRadius,
    `tier gap ${stepGap} must exceed 2·minRadius (${2 * minRadius})`
  );
});

test('concept: terms drop to a negative y, below the floor', () => {
  // Terms no longer stack onto the highest tier; they sit on an
  // underground ring at -CONCEPT_TERM_DEPTH so a tall document's terms
  // cannot merge with its `##` columns.
  assert.ok(conceptTermSlot({ x: 0, y: 0 }).y < 0);
  const slot = conceptTermSlot({ x: 50, y: -120 });
  assert.equal(slot.term, true);
  assert.equal(slot.ringX, 50);
  assert.equal(slot.ringZ, -120);
});

test('concept: zoom moves the eye in and clamps', () => {
  const near = conceptZoomBy(2000, 1);
  const far = conceptZoomBy(2000, -1);
  assert.ok(near < 2000, 'Zoom + moves toward the scene');
  assert.ok(far > 2000, 'Zoom − moves away from the scene');
  // Step size matches the flat/globe 1.25 factor.
  assert.ok(Math.abs(near - 2000 / 1.25) < 1e-9);
  assert.ok(conceptZoomBy(MAX_CONCEPT_DISTANCE, -1) === MAX_CONCEPT_DISTANCE);
  assert.ok(conceptZoomBy(MIN_CONCEPT_DISTANCE, 1) === MIN_CONCEPT_DISTANCE);
});

test('concept: the toolbar zoom multiplier maps onto a distance', () => {
  assert.equal(conceptDistanceFromZoom(1), DEFAULT_CONCEPT_DISTANCE);
  assert.equal(conceptDistanceFromZoom(2), DEFAULT_CONCEPT_DISTANCE * 2);
  assert.equal(conceptDistanceFromZoom(0.5), DEFAULT_CONCEPT_DISTANCE * 0.5);
  // Out-of-range multipliers land on the clamps rather than NaN.
  assert.equal(conceptDistanceFromZoom(1000), MAX_CONCEPT_DISTANCE);
  assert.equal(conceptDistanceFromZoom(NaN), DEFAULT_CONCEPT_DISTANCE);
});

test('concept: eye position sits on the pose sphere, facing the target', () => {
  for (const pose of [
    DEFAULT_CONCEPT_POSE,
    { yaw: 1.2, pitch: -0.4, distance: 2500, target: { x: 120, y: -80 } },
    { yaw: -2.8, pitch: 1.1, distance: 900, target: { x: 0, y: 0 } },
  ]) {
    const p = clampConceptPose(pose);
    const eye = conceptCameraPosition(p);
    // The eye orbits `target` at exactly `distance`.
    const d = Math.hypot(
      eye.x - p.target.x,
      eye.y - p.target.y,
      eye.z - p.target.y
    );
    assert.ok(
      Math.abs(d - p.distance) < 1e-6,
      `eye drifted to ${d}, expected ${p.distance}`
    );
  }
});

test('concept: pitch is clamped away from the pole', () => {
  const up = dragToConceptPose(DEFAULT_CONCEPT_POSE, 0, 1e9, 1);
  assert.ok(up.pitch < Math.PI / 2, 'the camera must never pass the pole');
  const down = dragToConceptPose(DEFAULT_CONCEPT_POSE, 0, -1e9, 1);
  assert.ok(down.pitch > -Math.PI / 2);
});

test('concept: a pane-wide drag turns roughly a half revolution', () => {
  // Same gain rule as the globe, so the mouse feels the same in all three
  // projections — this is the whole point of reusing `dragToOrientation`.
  const pane = 900;
  const turned = dragToConceptPose(
    DEFAULT_CONCEPT_POSE,
    pane,
    0,
    pane / Math.PI
  );
  assert.ok(
    Math.abs(turned.yaw - DEFAULT_CONCEPT_POSE.yaw - Math.PI) < 1e-9,
    `expected a half turn, got ${turned.yaw}`
  );
  // Distance and target survive an orbit untouched.
  assert.equal(turned.distance, DEFAULT_CONCEPT_POSE.distance);
  assert.deepEqual(turned.target, DEFAULT_CONCEPT_POSE.target);
});

test('concept: layout (x, y) maps onto the floor, height onto world y', () => {
  const w = layoutToWorld(300, -120, 90);
  assert.equal(w.x, 300);
  assert.equal(w.z, -120, 'layout y becomes world z so the layout is the floor');
  assert.equal(w.y, 90, 'the extrusion is world y');
});

test('concept: a downward ray hits the floor at the layout point under it', () => {
  // Straight down from above layout (400, 300). World z = 300, so the
  // layout point under the eye is (400, 300) — not (400, 800).
  const p = floorPointFromRay({ x: 400, y: 800, z: 300 }, { x: 0, y: -1, z: 0 });
  assert.ok(p);
  assert.ok(Math.abs(p.x - 400) < 1e-9);
  assert.ok(Math.abs(p.y - 300) < 1e-9);
});

test('concept: an oblique ray intersects the floor ahead of the eye', () => {
  // Eye at height 10 looking down-and-forward: 10 units of drop over a
  // 45° slope puts the floor hit 10 units along +z.
  const p = floorPointFromRay(
    { x: 0, y: 10, z: 0 },
    { x: 0, y: -Math.SQRT1_2, z: Math.SQRT1_2 }
  );
  assert.ok(p);
  assert.ok(Math.abs(p.x) < 1e-9, 'a z-directed ray leaves x alone');
  assert.ok(Math.abs(p.y - 10) < 1e-6, `expected 10, got ${p.y}`);
});

test('concept: a ray parallel to the floor has no intersection', () => {
  assert.equal(floorPointFromRay({ x: 0, y: 5, z: 0 }, { x: 1, y: 0, z: 0 }), null);
});

test('concept: heights are assigned per node kind (ConceptSlot)', () => {
  const welcome = doc(
    'welcome',
    'Welcome',
    '# Start\n\nSee [[orphan]].\n\n## Detail\n\nmore\n'
  );
  const ideas = doc('ideas', 'Ideas', '# Ideas\n\nSee [[orphan]].\n');
  const g = buildWorkspaceGraph([welcome, ideas], {});
  const nodes = g.nodes.map((n) => ({
    id: n.id,
    kind: n.kind,
    documentId: n.documentId,
    x: 0,
    y: 0,
  }));
  const slots = assignConceptHeights(nodes, g.edges);

  // Documents are the floor.
  assert.equal(slots.get(documentNodeId('welcome'))?.y, 0);
  assert.equal(slots.get(documentNodeId('ideas'))?.y, 0);

  // The top-level # is tier 0; its ## child is tier 1.
  const start = g.nodes.find((n) => n.kind === 'heading' && n.label === 'Start');
  const detail = g.nodes.find((n) => n.kind === 'heading' && n.label === 'Detail');
  assert.ok(start && detail);
  assert.equal(slots.get(start.id)?.y, conceptZForDepth(0));
  assert.equal(slots.get(detail.id)?.y, conceptZForDepth(1));
  assert.ok(
    slots.get(detail.id).y > slots.get(start.id).y,
    'a nested heading must sit above its parent tier'
  );

  // The term lands on the underground ring — strictly negative y.
  const term = slots.get(termNodeId('orphan'));
  assert.ok(term?.term, 'term node must carry term: true');
  assert.ok(term.y < 0, `term.y should be negative, got ${term.y}`);
  assert.ok(
    Math.abs(term.y + CONCEPT_TERM_DEPTH) < 1e-9,
    `term.y should be -CONCEPT_TERM_DEPTH (${CONCEPT_TERM_DEPTH})`
  );
});

test('concept: terms and headings land on opposite signs of y', () => {
  const welcome = doc(
    'welcome',
    'Welcome',
    '# Start\n\n## Detail\n\nSee [[orphan]].\n'
  );
  const g = buildWorkspaceGraph([welcome], {});
  const nodes = g.nodes.map((n) => ({
    id: n.id,
    kind: n.kind,
    documentId: n.documentId,
    x: 0,
    y: 0,
  }));
  const slots = assignConceptHeights(nodes, g.edges);

  for (const n of nodes) {
    const slot = slots.get(n.id);
    assert.ok(slot, `every node gets a slot; missing for ${n.id}`);
    if (n.kind === 'heading') {
      assert.ok(
        slot.y > 0,
        `heading ${n.id} should be above the floor, got ${slot.y}`
      );
    } else if (n.kind === 'term') {
      assert.ok(
        slot.y < 0,
        `term ${n.id} should be below the floor, got ${slot.y}`
      );
    } else {
      assert.equal(slot.y, 0, `document ${n.id} should be at y=0`);
    }
  }
});

test('concept: a wide sibling ring helixes onto several stories', () => {
  const sections = Array.from({ length: 12 }, (_, i) => {
    const n = i + 1;
    return `## ${n}. Section title number ${n}\n\nbody\n`;
  }).join('\n');
  const welcome = doc(
    'app-plan',
    'App Plan',
    `# App Plan\n\nintro\n\n${sections}`
  );
  const g = buildWorkspaceGraph([welcome], {});
  const laid = layoutWorkspaceGraph(g.nodes, g.edges, welcome.id);
  const slots = assignConceptHeights(laid, g.edges);
  const kids = laid.filter((n) => n.kind === 'heading' && /^\d+\.\s/.test(n.label));
  assert.equal(kids.length, 12);
  const ys = new Set(kids.map((n) => slots.get(n.id).y));
  assert.ok(
    ys.size > 1,
    `peer headings must occupy several stories, got one y=${[...ys][0]}`
  );
  assert.equal(ys.size, siblingStoryCount(12));
  const expectedStories = Math.min(
    CONCEPT_SIBLING_STORIES_MAX,
    Math.ceil(12 / CONCEPT_SIBLINGS_PER_STORY)
  );
  assert.equal(siblingStoryCount(12), expectedStories);
  // Nested ## sit above the H1 floor even after the helix opens extra bands.
  const h1 = laid.find((n) => n.kind === 'heading' && n.label === 'App Plan');
  assert.ok(h1);
  const h1Y = slots.get(h1.id).y;
  for (const kid of kids) {
    assert.ok(
      slots.get(kid.id).y > h1Y,
      `${kid.label} should sit above the H1 story`
    );
  }
});

test('concept: a small sibling ring stays on one heading floor', () => {
  const welcome = doc(
    'welcome',
    'Welcome',
    '# Start\n\n## Detail\n\nmore\n'
  );
  const g = buildWorkspaceGraph([welcome], {});
  const nodes = g.nodes.map((n) => ({
    id: n.id,
    kind: n.kind,
    documentId: n.documentId,
    x: 0,
    y: 0,
  }));
  const slots = assignConceptHeights(nodes, g.edges);
  const detail = g.nodes.find((n) => n.kind === 'heading' && n.label === 'Detail');
  assert.ok(detail);
  assert.equal(slots.get(detail.id)?.y, conceptZForDepth(1));
  assert.equal(conceptHeadingY(1, 0, 1), conceptZForDepth(1));
});

test('concept: every node gets a ConceptSlot, none left undefined', () => {
  const welcome = doc('welcome', 'Welcome', '# Start\n\nSee [[orphan]].\n');
  const g = buildWorkspaceGraph([welcome], {});
  const nodes = g.nodes.map((n) => ({
    id: n.id,
    kind: n.kind,
    documentId: n.documentId,
    x: 0,
    y: 0,
  }));
  const slots = assignConceptHeights(nodes, g.edges);
  assert.equal(slots.size, nodes.length, 'one slot per node');
  for (const n of nodes) {
    const slot = slots.get(n.id);
    assert.ok(slot, `node ${n.id} (${n.kind}) has no slot`);
    assert.ok(
      Number.isFinite(slot.y),
      `node ${n.id} (${n.kind}) has non-finite y=${slot.y}`
    );
  }
});

test('concept: pose round-trips through camera and pose helpers', () => {
  // Driving the eye through `conceptCameraPosition` and back through
  // `conceptPoseFromCamera` must recover the original yaw / pitch /
  // distance — up to float precision. Multiple poses cover the corner
  // cases: the opening pose, a steep pitch, and a 180° flipped yaw.
  for (const pose of [
    DEFAULT_CONCEPT_POSE,
    { yaw: 1.2, pitch: -0.4, distance: 2500, target: { x: 120, y: -80 } },
    { yaw: -2.8, pitch: 1.1, distance: 900, target: { x: 0, y: 0 } },
    { yaw: Math.PI, pitch: 0, distance: 1000, target: { x: 0, y: 0 } },
  ]) {
    const eye = conceptCameraPosition(pose);
    const recovered = conceptPoseFromCamera(eye, pose.target);
    assert.ok(
      Math.abs(recovered.yaw - pose.yaw) < 1e-9,
      `yaw drift ${recovered.yaw - pose.yaw}`
    );
    assert.ok(
      Math.abs(recovered.pitch - pose.pitch) < 1e-9,
      `pitch drift ${recovered.pitch - pose.pitch}`
    );
    assert.ok(
      Math.abs(recovered.distance - pose.distance) < 1e-9,
      `distance drift ${recovered.distance - pose.distance}`
    );
  }
});

test('concept: MIN_POLAR_ANGLE / MAX_POLAR_ANGLE bracket the legal pole', () => {
  // OrbitControls clamps via `polar` (φ = π/2 − pitch). Symmetric limits
  // just shy of 0 and π keep the camera off both poles. The exact values
  // are mirrored around π/2 so the same pose reads the same through
  // both APIs without surprise drift.
  assert.ok(MIN_POLAR_ANGLE > 0, 'min polar must keep the camera off straight down');
  assert.ok(MAX_POLAR_ANGLE < Math.PI, 'max polar must keep the camera off straight up');
  assert.ok(
    MIN_POLAR_ANGLE < Math.PI / 2,
    'eye should be able to reach a downward-looking angle'
  );
  assert.ok(
    MAX_POLAR_ANGLE > Math.PI / 2,
    'eye should be able to reach an upward-looking angle'
  );
  // Symmetric around π/2 so a pose ⇄ camera round-trip stays self-consistent.
  assert.ok(
    Math.abs(MIN_POLAR_ANGLE + MAX_POLAR_ANGLE - Math.PI) < 1e-9,
    'polar limits should bracket π/2 symmetrically'
  );
});

console.log(`${passed} passed`);

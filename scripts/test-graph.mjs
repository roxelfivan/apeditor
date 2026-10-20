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
import { layoutWorkspaceGraph, nodeRadius, countProperEdgeCrossings } from '${path.join(ROOT, 'src/utils/graph/layoutWorkspaceGraph.ts').replace(/\\/g, '/')}';
import { clampGraphZoom, stepGraphZoom, zoomedViewBox, fitCameraTo, panCamera, screenToWorld, worldToScreen, zoomCameraAt, cameraBounds } from '${path.join(ROOT, 'src/utils/graph/graphCamera.ts').replace(/\\/g, '/')}';
import { toSphere, toScreen, rotateSphere, isFrontFacing, dragToOrientation, angularDistance, IDENTITY_ORIENTATION } from '${path.join(ROOT, 'src/utils/graph/sphereProject.ts').replace(/\\/g, '/')}';
import { applyFisheye, fisheyeRatio, boundaryPointOnRay, clampMagnification, applyFisheyeToNodes } from '${path.join(ROOT, 'src/utils/graph/fisheyeLens.ts').replace(/\\/g, '/')}';
export { extractWikilinks, resolveWikilink, normalizeWikiSlug, formatWikilinksForPreview, buildWorkspaceGraph, documentNodeId, headingNodeId, termNodeId, splitHeadingPath, layoutWorkspaceGraph, nodeRadius, countProperEdgeCrossings, clampGraphZoom, stepGraphZoom, zoomedViewBox, fitCameraTo, panCamera, screenToWorld, worldToScreen, zoomCameraAt, cameraBounds, toSphere, toScreen, rotateSphere, isFrontFacing, dragToOrientation, angularDistance, IDENTITY_ORIENTATION, applyFisheye, fisheyeRatio, boundaryPointOnRay, clampMagnification, applyFisheyeToNodes };
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

console.log(`${passed} passed`);

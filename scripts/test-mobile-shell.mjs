// Regression: phone / landscape-phone workspace uses a labeled bottom
// tab bar (Documents / Editor / Chat) instead of the slim edge chevrons,
// overlays sit above that bar, and clickable chrome keeps a pointer cursor.
//
// Usage:
//   node scripts/test-mobile-shell.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const css = read('src/index.css');
assert.match(css, /--app-bottom-nav-height/, 'reserves bottom-nav height');
assert.match(
  css,
  /@media \(max-width: 767px\), \(max-height: 540px\)/,
  'bottom-nav query matches NARROW_QUERY'
);
assert.match(css, /\.app-overlay-above-nav/, 'overlays leave the tab bar tappable');
assert.match(css, /cursor:\s*pointer/, 'clickable elements use pointer cursor');
assert.match(css, /prefers-reduced-motion:\s*reduce/, 'respects reduced motion');
assert.match(css, /button:focus-visible/, 'visible keyboard focus');

const app = read('src/App.tsx');
assert.match(app, /MobileBottomNav/, 'App mounts the phone tab bar');
assert.match(app, /!isNarrow && \(/, 'desktop keeps edge chevrons');
assert.match(app, /onOpenDocuments/, 'document title opens Documents');

const nav = read('src/components/MobileBottomNav.tsx');
assert.match(nav, /aria-label="Workspace"/, 'tab bar is named');
assert.match(nav, /Documents/, 'Documents tab');
assert.match(nav, /Editor/, 'Editor tab');
assert.match(nav, /Chat/, 'Chat tab');

const editor = read('src/components/Editor.tsx');
assert.match(editor, /role="tablist"/, 'view modes are tabs, not a dropdown');
assert.match(editor, /aria-label="Editor view mode"/, 'view tablist is labeled');
assert.equal(
  /<select[\s\S]*aria-label="Editor view mode"/.test(editor),
  false,
  'view mode is no longer a native select'
);

const sidebar = read('src/components/Sidebar.tsx');
assert.match(sidebar, /app-overlay-above-nav/, 'Documents overlay leaves the tab bar');

const chat = read('src/components/ChatPanel.tsx');
assert.match(chat, /app-overlay-above-nav/, 'Chat overlay leaves the tab bar');

console.log('mobile shell: 16 checks passed');

// Regression: phone PWA top chrome must reserve the status-bar inset
// without a fixed h-14/h-16 that box-sizing:border-box would eat.
//
// Usage:
//   node scripts/test-safe-area-topbar.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const css = read('src/index.css');
assert.match(css, /\.app-safe-top\s*\{/, 'defines .app-safe-top');
assert.match(
  css,
  /padding-top:\s*var\(--safe-area-top,\s*env\(safe-area-inset-top/,
  '.app-safe-top pads with env(safe-area-inset-top)'
);
assert.match(
  css,
  /\.app-safe-top--bar\s*\{[\s\S]*min-height:\s*calc\(3\.5rem \+ var\(--safe-area-top/,
  '.app-safe-top--bar min-height includes the inset (not a fixed h-14)'
);
assert.match(
  css,
  /\.app-shell-safe-top\s*\{/,
  'collapsed topbar still reserves the status-bar band'
);
assert.match(css, /\.edge-anchor--top\s*\{/, 'top chevron sits below the inset');

const app = read('src/App.tsx');
assert.match(app, /app-safe-top app-safe-top--bar/, 'Topbar uses the safe-area class');
assert.equal(
  /<header[^>]*\bh-14\b/.test(app),
  false,
  'Topbar must not use h-14 (border-box would crush it into the notch)'
);
assert.match(
  app,
  /topbarCollapsed \? 'app-shell-safe-top'/,
  'shell gets status-bar padding when the topbar is hidden'
);

for (const file of ['src/components/HelpDocs.tsx', 'src/components/FuncSpecDocs.tsx']) {
  const src = read(file);
  assert.match(src, /app-safe-top app-safe-top--help/, `${file} uses help safe-area class`);
  assert.equal(
    /<header[^>]*\bh-14\b/.test(src) ||
      /<header[^>]*pt-\[env\(safe-area-inset-top\)\]/.test(src),
    false,
    `${file} must not pair a fixed header height with inset padding`
  );
}

const html = read('index.html');
assert.match(html, /viewport-fit=cover/, 'viewport-fit=cover keeps env(safe-area-*) live');
assert.match(
  html,
  /apple-mobile-web-app-status-bar-style" content="black-translucent"/,
  'translucent status bar so time / signal / battery remain visible'
);

console.log('safe-area topbar: 8 checks passed');

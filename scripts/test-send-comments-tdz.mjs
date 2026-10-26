// Regression: Send to AI must not close over a `const` that lives
// after ChatPanel's `if (!chatOpen || chatCollapsed) return null`.
// That binding stays in the temporal dead zone whenever the panel is
// collapsed (Write mode / narrow viewport) and throws
// `Cannot access '…' before initialization` (minified as `ve`).
//
// Usage:
//   node scripts/test-send-comments-tdz.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(
  path.join(ROOT, 'src/components/ChatPanel.tsx'),
  'utf8'
);

const earlyReturn = src.indexOf('if (!chatOpen || chatCollapsed)');
assert.ok(earlyReturn !== -1, 'ChatPanel still early-returns when collapsed');

const moduleLookup = src.indexOf('function lookupDocumentById');
assert.ok(moduleLookup !== -1, 'lookupDocumentById is defined');
assert.ok(
  moduleLookup < src.indexOf('export function ChatPanel'),
  'lookupDocumentById must live at module scope, not inside ChatPanel'
);

assert.equal(
  src.includes('const documentLookup'),
  false,
  'do not reintroduce a ChatPanel-local documentLookup const'
);

const afterReturn = src.slice(earlyReturn);
assert.equal(
  /buildRequestMessages[\s\S]*?documentLookup/.test(afterReturn) ||
    /\bdocumentLookup\b/.test(afterReturn),
  false,
  'collapsed early-return must not be followed by a documentLookup binding'
);

function collapsedSend(lookup) {
  const chatCollapsed = true;
  if (chatCollapsed) {
    // Mirrors ChatPanel's early return: locals declared below never init.
  } else {
    const documentLookup = lookup;
    void documentLookup;
  }
  // The send-comments listener runs even when the panel returned null.
  return lookup('doc-1');
}

assert.deepEqual(collapsedSend((id) => ({ id })), { id: 'doc-1' });

function tdzPattern() {
  const chatCollapsed = true;
  const onSend = () => documentLookup('x');
  if (chatCollapsed) {
    try {
      onSend();
      return 'no-throw';
    } catch (err) {
      return err instanceof ReferenceError ? err.message : String(err);
    }
  }
  const documentLookup = (id) => id;
  return documentLookup('ok');
}

assert.match(
  tdzPattern(),
  /before initialization/,
  'sanity: the old pattern still throws TDZ'
);

console.log('send-comments TDZ regression: 4 checks passed');

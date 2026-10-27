// Initial-state constants for the zustand store: provider presets,
// API defaults, seed prompts, and the two starter documents (`Welcome`
// + `Ideas`) that ship on first run.
//
// Kept in its own module so the store creation file stays focused on
// wiring (persistence, rehydration, action implementations) and so
// future onboarding tweaks don't have to touch store.ts.

import { v4 as uuid } from 'uuid';
import type { ApiConfig, ApiProvider, DocumentRecord, Prompt } from '@/types';
import { getProvider } from '@/config/providers';

// Resolve the build-time default provider, then derive endpoint/model
// defaults from the matching preset. First-run default is Local Model
// (`local-gemma`). VITE_DEFAULT_PROVIDER can still force minimax or
// openai for keyed production deploys. The settings modal still needs
// a one-time download / load of the on-device model.
export const initialProvider: ApiProvider =
  import.meta.env.VITE_DEFAULT_PROVIDER === 'openai'
    ? 'openai'
    : import.meta.env.VITE_DEFAULT_PROVIDER === 'minimax'
      ? 'minimax'
      : 'local-gemma';

const initialPreset = getProvider(initialProvider);

export const defaultApiConfig: ApiConfig = {
  provider: initialProvider,
  apiKey: '',
  apiEndpoint:
    import.meta.env.VITE_DEFAULT_API_ENDPOINT || initialPreset.defaultEndpoint,
  model: import.meta.env.VITE_DEFAULT_MODEL || initialPreset.defaultModel,
  systemMessage: undefined,
  temperature: 0.7,
  // Rationale rules default to undefined so the chat pipeline falls
  // back to the hard-coded `PROPOSED_EDIT_RULES_DEFAULT` in
  // `src/api/chat.ts`. Existing persisted payloads (which never
  // wrote this field) keep the same behaviour.
  rationaleRulesOverride: undefined,
};

export const seedPrompts: Prompt[] = [
  {
    id: 'p-rewrite',
    name: 'Improve writing',
    body: 'Rewrite the selected text to be clearer and more concise. Preserve the meaning and tone.',
    createdAt: Date.now(),
  },
  {
    id: 'p-summarize',
    name: 'Summarize',
    body: 'Summarize the selected text in 3-5 bullet points.',
    createdAt: Date.now(),
  },
  {
    id: 'p-eli5',
    name: "Explain like I'm 5",
    body: "Explain the selected text as if speaking to a 5-year-old. Use simple words and a short example.",
    createdAt: Date.now(),
  },
  {
    id: 'p-continuation',
    name: 'Continue writing',
    body: 'Continue the document naturally from where the cursor/selection ends. Match the existing style and voice. Write 2-3 paragraphs.',
    createdAt: Date.now(),
  },
];

/**
 * Build a fresh `DocumentRecord` with a uuid + timestamps. Used by the
 * store's `createDocument` action and by the welcome-doc seeding pass.
 */
export function makeDoc(title: string, content = ''): DocumentRecord {
  const now = Date.now();
  return { id: uuid(), title, content, createdAt: now, updatedAt: now };
}

export const initialDocs: DocumentRecord[] = [
  makeDoc(
    'Welcome',
    `# 👋 Welcome to ApEditor

A local-first AI markdown editor. Your documents, comments, chat
history, and revisions live in this browser — nothing is uploaded
until you connect an AI.

## 1. 🔑 Connect an AI (optional)

**Settings defaults to Local Model (require around 2gb disk space)** —
no API key. Open the gear (top right), download the ~2 GB Gemma model
from Hugging Face once (or **Load from disk** / **Save to Disk**), wait
until status shows **Ready**, then use Chat. Needs WebGPU (recent
Chrome / Edge / Safari).

Prefer a cloud model? Switch **Provider** to **Minimax** or **OpenAI**
and paste an API key. The whole app also works with no AI at all.

## 2. ✍️ Write, Preview, Graph, or Split

**Pick a mode from the editor dropdown** (Write → Preview → Graph →
Split). **Write** is a plain textarea, **Preview** renders your
Markdown, **Graph** is the full-pane map, and **Split** keeps Write or
Preview on the left (use the tabs) with Graph on the right.
\`⌘/Ctrl + B\` / \`I\` / \`U\` bold, italicise, and underline while
you type; the **Format** menu also adjusts the text size.

## 3. 🕸️ Explore the Graph

**Pick Graph** for a full map, or **Split** to keep writing beside it.
Both show your workspace as documents, headings, and links — built
entirely in your browser. Link pages with \`[[Page]]\`, point at a
section with \`[[Page#Heading]]\`, and pull in another document by
typing \`@\` followed by its name. Three projections share one graph:

- **Graph** — a flat map. Drag the background to pan.
- **Globe** — the same nodes wrapped on a sphere. Drag to spin it.
- **3D** — headings rise into stacked tiers you can orbit.

Use **Filter** to narrow the graph to particular documents and
sections. Clicking a document node opens it; clicking a heading jumps
straight to that section.

## 4. 💬 Comment on a passage

**Select text → Comment in the editor toolbar.** A highlight and a
numbered margin badge mark the passage. Open a badge to **Edit** or
**Delete** it, even after sending. When you're ready, **Send to AI**
under the editor sends the article plus every comment as one batch,
and \`⌘/Ctrl + Z\` undoes the last comment change.

If the text under a comment is later edited, the comment turns
**Outdated**. The tray then offers **N stale comments — Re-link or
Dismiss**: **Re-link** opens a picker of headings and paragraphs so you
can point the comment at the right place again; **Dismiss** drops it.

## 5. ✅ Apply or Reject AI edits

**AI rewrites arrive as cards**, each with a rationale. Click **Apply**
or **Reject**. For several changes in one reply, use **Apply N changes**
in the chat footer. If a quote no longer matches the document, select
the target text and use **Highlight Apply** instead.

## 6. @ Reference another document

**Type \`@\` in Chat, a comment, or rejection feedback.** Pick another
document, then choose **Whole document** or tick individual headings
and **Use selection**. A chip — and often a \`§\` caption — shows what
you attached. You need at least two documents in the sidebar.

## 7. 📚 Use a saved prompt

**Open Prompt library** (bookmark, top bar) or press \`⌘/Ctrl + ,\`.
Click a prompt to drop it into the chat input, or write your own and
ask the AI to rewrite / shorten / expand the selection. Tick
**include selection** in the chat panel when you want the selected
text sent along with your message.

## 8. ✨ Get sentence suggestions while writing

**Predict starts off** and needs **Minimax** or **OpenAI** (not Local
Model). Click **Predict** (or \`⌘/Ctrl + \\\`) to turn it on and request
a suggestion at the cursor. Press \`Tab\` to insert it, \`Esc\` to
dismiss it. Click the same button again to turn it back off.

## 9. 💾 Save a snapshot

**Click Save in the editor toolbar** when you like a draft. Open
**Revision history** (clock, top bar, or \`⌘/Ctrl + h\`) later to diff
any two revisions and restore one.

## 10. 📷 Import text from photos or PDFs

**Open the import button in the editor toolbar** and pick an image or
a PDF. Recognition runs in your browser; the extracted text is
rewritten as readable Markdown by your configured Minimax/OpenAI model
and inserted at your caret. (OCR→Markdown rewrite needs a keyed
provider.) You can also click **+** in Chat to attach the same file
types to a question without inserting into the document.

## 11. 💾 Keep a copy outside the browser

The same import button also exports. **Export .md** downloads this
document as plain Markdown. **Export .json** packs the document with
its comments, chat history, and revisions into one versioned file —
worth taking before clearing browser data, or for moving a workspace
to another machine. **Import .json** restores one, asking before it
overwrites anything.

## 12. ❓ Help, shortcuts, and settings

**Help** (\`?\` in the top bar, or \`⌘/Ctrl + /\`) is the full guide,
including **What's new**. The **Settings** modal (\`⌘/Ctrl + .\`) holds
your provider (Local Model by default), key, model, and UI font size.
Turn on **Debug Mode** to edit System message, Rationale rules, and
Temperature. Light and dark themes follow the top-bar toggle.`}
  ),
  makeDoc(
    'Ideas',
    `# Ideas\n\n- A short story about a lighthouse keeper who hears the sea speak.\n- A field guide to imaginary birds.\n- An essay on why we read in the bath.\n`
  ),
];

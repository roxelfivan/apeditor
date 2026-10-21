# Product overview

> What ApEditor is for, who it is for, what it does, and — just as importantly — what it deliberately does not do.

---

## 1. The problem

Long-form technical and professional writing needs an AI assistant, but the mainstream tools all put the assistant between the author and the text in one of two bad ways:

- **Chat-in-the-middle.** You copy a paragraph out, paste it into a chat, copy the rewrite back. Voice drifts, context is lost, and you cannot batch several notes into one pass.
- **Black-box rewrite.** The tool edits your draft silently. You cannot see *why* a sentence changed, cannot reject one change out of twelve, and cannot trace an edit back to the note that caused it.

## 2. The product

ApEditor is a **local-first AI Markdown editor** that runs entirely in the browser. It has no backend, no account, and no server of its own.

Its central idea is the **comment round**:

> Write normally. Select a passage, attach a note. When you have a batch of notes, send *all of them plus a compact map of your document* to the model in a single turn. The model replies with a set of **proposed edits**, each independently acceptable or rejectable, each carrying a written rationale. Applying one re-anchors your original comment to the new text so you can read the AI's reasoning later, in place.

Three consequences follow from that design:

- **Nothing is written in place by the model.** Every change is a card the author applies deliberately.
- **Comments survive edits.** A comment's anchor is repaired automatically as the document changes, and the AI's rationale for each applied edit is stored on the comment round that caused it.
- **Your drafts stay local.** Documents, chats, comments, revisions, prompts, and settings all live in `localStorage`. The only outbound requests are the chat turns you send, to the endpoint you configured.

## 3. Users

ApEditor is built for a single, narrow audience:

| | |
|---|---|
| **Primary** | Technical and professional writers drafting long-form documents who want AI review without surrendering control of the prose. |
| **Secondary** | Developers maintaining this repository. |
| **Explicitly not** | General note-takers, collaborative teams, mobile-first users, or anyone who needs multi-user sync, sharing, or an account system. |

## 4. Capability map

### 4.1 Writing

| Capability | Where it lives |
|---|---|
| Multiple documents: create, rename, switch, delete | [`Sidebar.tsx`](../src/components/Sidebar.tsx) |
| Four editor views — **Write**, **Preview**, **Split**, **Graph** | [`Editor.tsx`](../src/components/Editor.tsx) |
| Markdown rendering with GFM, raw HTML, sanitization | [`utils/markdown.ts`](../src/utils/markdown.ts) |
| Bold / Italic / Underline + font size (10–24 px) | `wrapSelection` in [`Editor.tsx`](../src/components/Editor.tsx) |
| **Predict** — inline sentence completion, opt-in | [`useInlineCompletion.ts`](../src/hooks/useInlineCompletion.ts) |
| Revision history: snapshot, diff, restore | [`RevisionHistory.tsx`](../src/components/RevisionHistory.tsx) |
| Prompt library with `{{selection}}` interpolation | [`PromptLibrary.tsx`](../src/components/PromptLibrary.tsx) |

### 4.2 Commenting

| Capability | Where it lives |
|---|---|
| Select → **Comment** → floating composer | [`CommentComposer.tsx`](../src/components/CommentComposer.tsx) |
| Highlight + numbered margin badge | [`CommentLayer.tsx`](../src/components/CommentLayer.tsx), [`CommentMargin.tsx`](../src/components/CommentMargin.tsx) |
| Edit / delete, including after sending | [`CommentPopover.tsx`](../src/components/CommentPopover.tsx) |
| **Rounds** — editing a sent comment starts a new round | [`store/actions.ts`](../src/store/actions.ts) |
| Automatic re-anchoring as the document changes | [`utils/comments.ts`](../src/utils/comments.ts) |
| **Outdated** detection + **Re-link** / **Re-attach** | `reanchorComment`, [`ReanchorPicker.tsx`](../src/components/ReanchorPicker.tsx) |
| Per-session undo (⌘/Ctrl + Z, comment ops only) | `commentUndoStack` in [`store/types.ts`](../src/store/types.ts) |
| **Send to AI** — batch every comment into one turn | [`CommentTray.tsx`](../src/components/CommentTray.tsx) → [`ChatPanel.tsx`](../src/components/ChatPanel.tsx) |

### 4.3 AI

| Capability | Where it lives |
|---|---|
| Streaming chat with OpenAI-compatible wire format | [`api/chat.ts`](../src/api/chat.ts) |
| Three providers: MiniMax (default), OpenAI, **Google AI Mode (no key)** | [`config/providers.tsx`](../src/config/providers.tsx) |
| **include selection** / **selection only** context modes | [`ChatPanel.tsx`](../src/components/ChatPanel.tsx) |
| Outbound secret redaction | [`utils/secrets.ts`](../src/utils/secrets.ts) |
| Customizable System Message + Rationale Rules | [`api/chat.ts`](../src/api/chat.ts), [`SettingsModal.tsx`](../src/components/SettingsModal.tsx) |
| Proposed-edit cards with Apply / Reject / Highlight Apply | [`ProposedEditCard.tsx`](../src/components/ProposedEditCard.tsx), [`utils/proposedEdit.ts`](../src/utils/proposedEdit.ts) |
| Per-edit rationale stored on the comment round | `recordAppliedEdit` in [`store/actions.ts`](../src/store/actions.ts) |
| Reject-with-feedback batching | `formatRejectionBatch` in [`utils/proposedEdit.ts`](../src/utils/proposedEdit.ts) |

### 4.4 Structure

| Capability | Where it lives |
|---|---|
| `@`-references to other documents / heading sections | [`components/mentions/`](../src/components/mentions) |
| `[[wikilink]]` syntax resolution (Graph + Preview labels) | [`utils/graph/parseWikilinks.ts`](../src/utils/graph/parseWikilinks.ts) |
| Preview / Split: purple wikilink labels without brackets | `formatWikilinksForPreview` → [`Editor.tsx`](../src/components/Editor.tsx) |
| **Graph view** — a local knowledge map of the workspace | [`GraphView.tsx`](../src/components/GraphView.tsx), [`utils/graph/`](../src/utils/graph) |

### 4.5 Data ingress and egress

| Capability | Where it lives |
|---|---|
| Import text from photos and PDFs, fully in-browser | [`utils/ocr.ts`](../src/utils/ocr.ts), [`utils/pdf.ts`](../src/utils/pdf.ts) |
| Markdown rewrite of recognised text via the configured model | [`utils/ocrMarkdown.ts`](../src/utils/ocrMarkdown.ts) |
| Export the document as `.md` | [`FileActionsButton.tsx`](../src/components/FileActionsButton.tsx) |
| Export a versioned `.json` backup (document + comments + chat + revisions) | [`utils/backup.ts`](../src/utils/backup.ts) |

### 4.6 Workspace and settings

| Capability | Where it lives |
|---|---|
| Resizable sidebar / editor split / chat panel | [`useDragResize.ts`](../src/hooks/useDragResize.ts), [`ResizeHandle.tsx`](../src/components/ResizeHandle.tsx) |
| Collapsible edge anchors for every panel | [`EdgeAnchor.tsx`](../src/components/EdgeAnchor.tsx) |
| Light (paper) and Dark (ape) themes | [`tailwind.config.cjs`](../tailwind.config.cjs), [`index.css`](../src/index.css), [`utils/theme.ts`](../src/utils/theme.ts) |
| In-app Help (user guide) | [`docs/`](../docs), [`HelpDocs.tsx`](../src/components/HelpDocs.tsx) |
| In-app Functional Specification (this document) | [`func_spec/`](../func_spec), [`FuncSpecDocs.tsx`](../src/components/FuncSpecDocs.tsx) |
| Settings modal: provider, key, endpoint, model, prompts, temperature, font sizes, debug | [`SettingsModal.tsx`](../src/components/SettingsModal.tsx) |

## 5. Design principles

These are the recurring decisions that explain most of the code.

### 5.1 No backend, ever

There is no server component, no database, no telemetry, and no auth. The "backend" is whichever OpenAI-compatible endpoint the user names in Settings. This drives the whole architecture: one persisted store, no server-state sync, optimistic everything.

### 5.2 The model never writes the document directly

Every AI change is a `ProposedEdit` the user must accept. The model emits *proposals*, the store applies *decisions*. This is what makes the rationale, the per-edit rejection, and the revision history meaningful.

### 5.3 Prompts are a versioned contract

`buildRequestMessages` emits a fixed, ordered list of system messages with stable `id` tags. The parser on the way back depends on those tags and on the fenced-block format. Treat the emitter and parser as two halves of one contract — see [AI chat & prompts](07-ai-chat.md) and [Proposed edits](08-proposed-edits.md).

### 5.4 Components talk through events, not imports

`Editor.tsx` and `ChatPanel.tsx` are the two largest components in the repo and neither imports the other. They coordinate through `window` CustomEvents named `mvp:*`. This keeps both files from becoming a single unreadable blob. The full event table is in [Events & components](12-events-and-ui-contracts.md).

### 5.5 Tokens are a budget, not an afterthought

The prompt builder sends a **document outline** (one truncated line per paragraph) rather than the full document, unless the user explicitly asks for a section. Referenced documents are capped at 4,000 chars each and 8,000 chars per turn. Import is capped at 50 MB per file, 200 MB per batch, 500 PDF pages. The AI Mode URL is capped at 6,000 characters. These caps are enforced in code, not in the prompt text.

### 5.6 Degrade, do not block

A missing API key disables Predict rather than hiding it. An unmatched wikilink becomes a *term node* rather than an error. A proposed edit whose quote no longer exists falls back to Best Effort, then to Highlight Apply. Gated features show a tooltip explaining the gate.

## 6. Non-goals

These are out of scope for the MVP. They are listed in the README under "What's intentionally not here".

- **Rich text / Lexical.** The editor is a plain `<textarea>` by design.
- **Agentic tool use / function calling.**
- **Embeddings or semantic search.** The Graph view is a symbolic map, not a vector index.
- **Cloud sync.** No Google Drive, no GitHub sync, no Electron desktop build.
- **Token counting or cost tracking.**
- **Internationalisation.** UI strings are English only.
- **Real-time collaboration.**
- **A mobile-first layout.** Narrow viewports degrade to overlay drawers; the product is desktop-first.

## 7. Version history at a glance

Full changelogs are in [`RELEASE_NOTES.md`](../RELEASE_NOTES.md). The shape of the project:

| Version | What changed |
|---|---|
| v0.5.9 | **Graph scope filter, wider zoom / labels, deep-tier compression.** A Filter popover prunes documents and sections before layout (Flat / Globe / Concept inherit it). Zoom 0.25×–12× and labels 6–48 px; Concept distance is derived from the zoom ceiling. Heading tiers past depth 6 compress geometrically. Graph / 3D clicks switch to Split so the caret restore lands. |
| v0.5.8 | **Graph 3D: spread the stack, free navigation.** The Concept projection's extrusion step was small enough that a tall document rendered as one horizontal slab; terms and headings shared the same positive y-axis. v0.5.8 spreads the tiers (135 units per step, base at 270) and drops `[[term]]` satellites onto an underground ring at `y = -200`. `three.js`'s `OrbitControls` is mounted for free 3D navigation: wheel zoom, shift+drag pan, two-finger pinch / pan, and arrow-key pan / +/- dolly. The hook remains the single source of truth for the camera pose. |
| v0.5.8 | **Graph 3D Concept projection.** A third entry in the same projection toggle: the layout becomes a floor and heading tiers extrude upward, rendered with three.js and orbitable by dragging the background. three.js is loaded lazily, so the main bundle is unchanged. Flat and Globe are untouched, and it is still not a fifth `viewMode`. |
| v0.5.7 | **Graph navigation: pan, orbit, and Globe.** The view can finally be moved: drag empty space to pan in flat mode, drag to spin the sphere in globe mode. Sphere projection (iSphere, CHI 2017): layout plane → Riemann sphere → viewport, with back-hemisphere culling. The `Graph` / `Globe` control is a navigation toggle, not a fifth `viewMode`. |
| v0.5.6 | **Import full backup (JSON).** Round-trips the v1 `DocumentBackup` shipped in v0.5.3: backups can be re-imported with comments, chat history, and revisions intact. Per-row modal for id collisions; never overwrites silently. |
| v0.5.5 | **Preview wikilinks** without brackets (purple); Graph Reset tidy atom layout; in-app **Functional Specification**; Graph+Chat blank-tab fix. |
| v0.5.4 | **Graph view.** Documents, headings, `[[wikilinks]]`, and `@` mentions compiled into a local knowledge graph. Drag nodes, zoom the map. |
| v0.5.3 | JSON backup export; per-comment Re-link / Dismiss; gated-state copy; the Apply waterfall (Exact → Best Effort → Highlight). |
| v0.5.2 | **Internal refactor.** Removed four hardcoded debug POSTs from the chat pipeline. Split the 1,485-line store into 5 files. Moved the `@`-mention parser from `components/` to `utils/`. No behaviour change. |
| v0.5.1 | Selection-only chat, outbound secret redaction, outdated Dismiss / Re-attach, session-only API key, gated-state tooltips. |
| v0.5.0 | Export Markdown, import size/page caps, best-effort Apply. |
| v0.4.9 | Unified Format dropdown, draggable chat / card dividers. |
| v0.4.7 – v0.4.8 | `@`-document references, heading-grouped section picker, cascade, inline `§…` captions. |
| v0.4.5 | Comment **rounds** and **rationales**; Rationale Rules; Predict off by default. |
| v0.4.0 – v0.4.1 | **Comment + Send to AI**; Google AI Mode (no key); document outline instead of verbatim document. |
| v0.3.x | Import → Markdown, OCR under CSP, security hardening, Apply All, inline completion. |

## 8. Next

- How the pieces fit together → [Architecture](02-architecture.md)
- What actually happens at runtime → [Runtime flows](03-runtime-flows.md)
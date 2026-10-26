# Events & components

> Lookup material: the complete `mvp:*` event bus, and a one-row inventory of every React component with its props and responsibilities.

---

## 1. Why an event bus

ApEditor's two largest components, `Editor.tsx` (2,009 lines) and `ChatPanel.tsx` (1,381 lines), do not import each other. They coordinate through `window` CustomEvents whose names all begin with `mvp:`.

The direction is deliberate:

```
FileActionsButton ──▶ Editor          (import result)
useInlineCompletion ▶ Editor          (accepted completion)
GraphView ──────────▶ Editor          (node clicked)
ProposedEditCard ───▶ Editor          (edit applied)
ChatPanel ──────────▶ Editor          (range selection, streaming state, comments sent)
PromptLibrary ──────▶ Editor          (selection read), ChatPanel (prompt applied)
Editor ─────────────▶ ChatPanel       (selection published, comment batch sent)
Editor ─────────────▶ PromptLibrary   (selection published)
* ──────────────────▶ App             (open an overlay)
```

Editor → Chat is one-way, so the editor never imports chat internals.

To find every producer and consumer:

```bash
rg "mvp:" src/ -n
```

> **The `mvp:` prefix is historical.** The app was renamed from `ai-text-editor-mvp`; the prefix survived. Renaming it is a mechanical but wide change — a dedicated chore, not a drive-by edit.

---

## 2. The event bus

### 2.1 Table

| Event | `detail` | Dispatched by | Listened by |
|---|---|---|---|
| `mvp:get-selection` | *(none — a plain `Event`)* | `PromptLibrary.tsx` `readSelection()` | `Editor.tsx` |
| `mvp:editor-selection` | `{ text: string }` | `Editor.tsx` (only in response to `mvp:get-selection`) | `ChatPanel.tsx`, `PromptLibrary.tsx` |
| `mvp:fill-chat` | `string` — the raw prompt body, **not** wrapped in an object | `App.tsx` (PromptLibrary `onApply`) | `ChatPanel.tsx` |
| `mvp:insert-text` | `{ text: string }` | `FileActionsButton.tsx` (after OCR + Markdown) | `Editor.tsx` |
| `mvp:select-range` | `{ start: number; end: number }` | `GraphView.tsx`, `ProposedEditCard.tsx` (×2), `ChatPanel.tsx` | `Editor.tsx` |
| `mvp:accept-completion` | `{ text: string; caret: number }` — `text` is the **entire new document** | `useInlineCompletion.ts` `accept()` | `Editor.tsx` |
| `mvp:send-comments` | `{ commentIds: string[]; mentionsByCommentId: Record<string, MentionToken[]> }` | `Editor.tsx` `handleSendToAi` | `ChatPanel.tsx` |
| `mvp:mark-comments-sent` | `{ ids: string[] }` | `ChatPanel.tsx` | `Editor.tsx` |
| `mvp:chat-streaming` | `{ streaming: boolean }` | `ChatPanel.tsx` (3 send paths × on/off) | `Editor.tsx` |
| `mvp:open-help` | `HelpPageId` as a **bare string**, fallback `'home'` | `HelpDocs.tsx` `openHelpDocs()` | `App.tsx` |
| `mvp:open-func-spec` | a `FuncSpecPageId` string, or anything else for the overview | `FuncSpecDocs.tsx` `openFuncSpecDocs()` | `App.tsx` |

### 2.2 Three shapes worth knowing

1. **`mvp:fill-chat` carries a bare string.** Every other event carries an object. Wrapping or unwrapping it inconsistently is the easiest mistake to make here.
2. **`mvp:accept-completion` carries the whole document.** It is not a delta and not an insertion. Any new listener must replace the value, not append to it.
3. **`mvp:get-selection` / `mvp:editor-selection` is a synchronous request-response round trip.** `PromptLibrary` dispatches `mvp:get-selection` and installs a listener that removes itself; `Editor` replies **during** the same `dispatchEvent` call, which works because `dispatchEvent` is synchronous.

### 2.3 Adding an event

1. Dispatch with `window.dispatchEvent(new CustomEvent('mvp:your-event', { detail }))`.
2. Listen with `window.addEventListener('mvp:your-event', handler)` **and remove it in the effect's cleanup**.
3. Add the row to the table above.
4. Never import the consumer into the producer to "just call it directly" — that is the coupling the bus exists to prevent.

---

## 3. Component inventory

### 3.1 Composites

| Component | File | Props | Responsibility |
|---|---|---|---|
| `App` | [`App.tsx`](../src/App.tsx) | — | Composition, global hotkeys, overlay state, theme + UI-font sync, narrow-viewport collapse, first-run onboarding pop. Defines `Topbar` locally. |
| `Topbar` | `App.tsx` (local) | `{ onOpenSettings, onOpenPrompts, onOpenRevisions, onOpenHelp, onOpenFuncSpec }` | Logo, version, current document title, and the icon row: **?** (Help), **`{ }`** (Functional Specification), clock (revisions), bookmark (prompts), ☀/☾ (theme), ⚙ (settings). The settings button carries an amber dot when no API key is set. |

### 3.2 Layout

| Component | File | Props | Responsibility |
|---|---|---|---|
| `Sidebar` | [`Sidebar.tsx`](../src/components/Sidebar.tsx) | — | Document list, inline rename (double-click or ✎), delete with `confirm`, `+ New`. Returns `null` when collapsed. A narrow-viewport modal drawer otherwise. Resizes via `useDragResize`. |
| `EdgeAnchor` | [`EdgeAnchor.tsx`](../src/components/EdgeAnchor.tsx) | `{ side: 'left' \| 'right' \| 'top'; collapsed: boolean; label: string; onClick: () => void }` | A chevron strip that is both the hide and the show button. No state, no store. |
| `ResizeHandle` | [`ResizeHandle.tsx`](../src/components/ResizeHandle.tsx) | `{ handle: HandleName; onPointerDown; className? }` | One of 8 resize edges/corners. `role="separator"`, `data-resize-handle`. |
| `useDragResize` | [`useDragResize.ts`](../src/hooks/useDragResize.ts) | `{ mode: 'axis' \| 'free', axis?, onDelta }` → `{ start(handle, e) }` | rAF-coalesced pointer drag. Also exports every bounds constant. |

### 3.3 Editor

| Component | File | Responsibility |
|---|---|---|
| `Editor` | [`Editor.tsx`](../src/components/Editor.tsx) | The centre column: toolbar, textarea, mirror, margin, tray, suggestion panel, Graph host, split divider, and orchestration of the composer/popover. |
| `CommentLayer` | [`CommentLayer.tsx`](../src/components/CommentLayer.tsx) | `memo(forwardRef<HTMLDivElement>)`. Paints `<mark>` highlights behind the textarea and hosts the selection `Range`. Event-based segment merge. |
| `CommentMargin` | [`CommentMargin.tsx`](../src/components/CommentMargin.tsx) | Numbered badges, re-sorted by document position on every render. |
| `CommentComposer` | [`CommentComposer.tsx`](../src/components/CommentComposer.tsx) | Floating composer for a new comment. Wraps `MentionInput`. |
| `CommentPopover` | [`CommentPopover.tsx`](../src/components/CommentPopover.tsx) | Read/edit/delete one comment, multi-round rationale list, resize, persisted size. |
| `CommentTray` | [`CommentTray.tsx`](../src/components/CommentTray.tsx) | Send to AI bar plus the stale-comment Re-link / Dismiss list. |
| `ReanchorPicker` | [`ReanchorPicker.tsx`](../src/components/ReanchorPicker.tsx) | Heading/paragraph picker for re-linking a stale comment. Presentational only. |
| `GraphView` | [`GraphView.tsx`](../src/components/GraphView.tsx) | SVG rendering, drag, zoom, hover dimming, edge labels, the flat / sphere / concept projection switch. |
| `Concept3DScene` | [`Concept3DScene.tsx`](../src/components/Concept3DScene.tsx) | 3D Concept projection: three.js scene behind `React.lazy`. Raycasts, then forwards pointer events to `GraphView` so the drag model stays in one place. |
| `GraphViewControls` | `GraphView.tsx` | Label size, zoom, Reset (remounts `GraphView` via `graphEpoch`). The **Graph / Globe / 3D** segmented toggle, driven by the `PROJECTION_OPTIONS` table. |

### 3.4 AI

| Component | File | Responsibility |
|---|---|---|
| `ChatPanel` | [`ChatPanel.tsx`](../src/components/ChatPanel.tsx) | Streaming chat, keyless branch, comment-batch send, Apply All, rejection staging, selection toggles, panel resizing, the messages/input split, collapsible conversation, History / Archive header actions. |
| `ChatHistory` | [`ChatHistory.tsx`](../src/components/ChatHistory.tsx) | Overlay: current + archived sessions, read-only collapsible turns, archive / restore / delete. Opened from ChatPanel; no `mvp:` event. |
| `ChatTurnFrame` | [`ChatTurnFrame.tsx`](../src/components/ChatTurnFrame.tsx) | Accordion chrome for one user/assistant turn. |
| `ProposedEditCard` | [`ProposedEditCard.tsx`](../src/components/ProposedEditCard.tsx) | One proposal: Split/Inline, Apply, Highlight Apply, Reject, Reject-with-feedback, editor highlight, resize. |
| `PromptLibrary` | [`PromptLibrary.tsx`](../src/components/PromptLibrary.tsx) | Saved prompt CRUD plus `{{selection}}` substitution. |
| `SettingsModal` | [`SettingsModal.tsx`](../src/components/SettingsModal.tsx) | Every setting. See the field table in [Build & configuration §7](13-build-and-config.md#7-settings-modal-fields). |
| `RevisionHistory` | [`RevisionHistory.tsx`](../src/components/RevisionHistory.tsx) | Snapshot list, Preview / Diff tabs, restore, delete. |
| `FileActionsButton` | [`FileActionsButton.tsx`](../src/components/FileActionsButton.tsx) | Import popover plus the two export actions. Dynamic-imports the heavy OCR deps. |

### 3.5 Mentions

| Component | File | Responsibility |
|---|---|---|
| `MentionInput` | [`MentionInput.tsx`](../src/components/mentions/MentionInput.tsx) | The `@`-aware textarea: caption injection, ZWSP anchors, chip overlay, serialize/hydrate, plain-text diff. |
| `DocPicker` | [`DocPicker.tsx`](../src/components/mentions/DocPicker.tsx) | Stage one: filtered document list. Excludes the current document. |
| `SectionPicker` | [`SectionPicker.tsx`](../src/components/mentions/SectionPicker.tsx) | Stage two: heading-grouped checkboxes with downward cascade. |
| `MentionChip` | [`MentionChip.tsx`](../src/components/mentions/MentionChip.tsx) | The reference pill above an input: title, `§…` caption, re-open, remove. |

### 3.6 Documentation overlays

| Component | File | Renders | Nav | Heading anchors | Cross-file nav |
|---|---|---|---|:-:|:-:|
| `HelpDocs` | [`HelpDocs.tsx`](../src/components/HelpDocs.tsx) | `docs/*.md` | Flat page list | ✗ | ✓ within `docs/` |
| `FuncSpecDocs` | [`FuncSpecDocs.tsx`](../src/components/FuncSpecDocs.tsx) | `func_spec/*.md` | Grouped by part, with Prev/Next | ✓ | ✓ across `func_spec/` |

Both share the shell (fixed overlay, `role="dialog" aria-modal="true"`, Escape to close, theme tokens via `html.dark`) and the markdown plugin stack. `FuncSpecDocs` adds:

- **Heading ids** from a GitHub-compatible `slugify`, so `#anchor` deep links work. The Help viewer does not render heading ids, so in-page anchors there silently no-op.
- **Cross-file navigation.** A link to `./04-state-and-persistence.md#some-heading` switches page and scrolls to the anchor, instead of opening a browser tab. In-page `#anchor` links scroll within the article.
- **Prev / Next** buttons driven by `FUNC_SPEC_ORDER`.
- **Part grouping** in the sidebar, with each page's `blurb` as a `title` tooltip.

The two catalogs:

| | `src/docs/catalog.ts` | `src/docs/funcSpecCatalog.ts` |
|---|---|---|
| Glob | `'../../docs/*.md'` | `'../../func_spec/*.md'` |
| Entry list | `HELP_PAGES` | `FUNC_SPEC_PAGES` (+ `FUNC_SPEC_PARTS`) |
| Content getter | `getHelpPageContent(id)` | `getFuncSpecPageContent(id)` |
| Href resolver | `helpPageIdFromHref(href)` | `funcSpecPageIdFromHref(href)` |
| Extra | — | `FUNC_SPEC_PAGES_BY_PART`, `FUNC_SPEC_ORDER`, `FUNC_SPEC_DEFAULT_PAGE`, `isFuncSpecPageId` |
| Programmatic open | `openHelpDocs(page?)` | `openFuncSpecDocs(page?)` |

### 3.7 Hooks

| Hook | File | Returns |
|---|---|---|
| `useInlineCompletion` | [`useInlineCompletion.ts`](../src/hooks/useInlineCompletion.ts) | `{ ghost, streaming, onTextChange, onKeyDown, onBlur, triggerNow, accept, reject, stats, resetStats }` |
| `useDocumentMentions` | [`useDocumentMentions.ts`](../src/hooks/useDocumentMentions.ts) | `{ getSections, buildParagraphs, sectionsMatchingSelection, descendantSectionIndexes }` plus the pure helpers behind them |
| `useDragResize` | [`useDragResize.ts`](../src/hooks/useDragResize.ts) | `{ start }` |
| `useMediaQuery` | [`useMediaQuery.ts`](../src/hooks/useMediaQuery.ts) | `useIsNarrow()`, `useIsCommentSheet()`, and the two query constants |

## 4. Markdown rendering pipeline

One shared definition in [`utils/markdown.ts`](../src/utils/markdown.ts), used by the editor preview, the Help overlay, the Functional Specification overlay, ProposedEditCard's Split view, the comment rationale body, and the Revision History Preview pane:

```ts
export const remarkPlugins = [remarkGfm];
export const rehypePlugins = [rehypeRaw, [rehypeSanitize, sanitizeSchema]];
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'u', 'span'],
  attributes: {
    ...defaultSchema.attributes,
    span: [...(defaultSchema.attributes?.span ?? []), 'className'],
    mark: [...(defaultSchema.attributes?.mark ?? []), 'className'],
  },
};
```

| Addition | Why |
|---|---|
| `'u'` | Toolbar Underline (`<u>…</u>`) survives sanitization |
| `'span'` + `className` | Preview wikilink labels (`<span class="wiki-link">`) |
| `mark` + `className` | Proposed-edit Preview bands (`<mark class="pe-doc-highlight">`) |

Removing `rehype-raw` or these allow-list entries silently breaks Underline, Preview wikilinks, or PE highlights.

The threat model is stated in the file header: untrusted document and assistant content must not be able to execute scripts, because a stored XSS would let an attacker read the API key out of `localStorage`.

## 5. Styling surface

| File | Contains |
|---|---|
| [`index.css`](../src/index.css) | Tailwind layers; `.prose-md` markdown styles with a full `html.dark` block; `.help-docs-article` overrides; `.comment-textarea` / `.cm-mirror` geometry contract; `.cm-*` comment components; `.mention-popover*`; `.edge-anchor`; `.proposed-edit-card`; `.diff-add` / `.diff-remove`; `.btn-*` button primitives; theme CSS variables |
| [`tailwind.config.cjs`](../tailwind.config.cjs) | `paper.*` (light), `cyber.*` (accents, shared), `ape.*` (dark surfaces); `display` / `serif` / `mono` / `sans` font stacks; shadows; the `ape-fire` gradients |

Component CSS classes used across the codebase:

| Prefix | Belongs to |
|---|---|
| `.cm-*` | Comment layer, margin, composer, popover, tray, mirror |
| `.mention-popover*` | `@` doc picker, section picker, **and** `ReanchorPicker` |
| `.proposed-edit-card` / `.pe-*` | Proposed edit cards and their diff styling |
| `.diff-add` / `.diff-remove` | Line diff rows |
| `.btn-*` | Shared button primitives (`btn-icon-square`, `btn-icon-square-fire`, …) |
| `.edge-anchor` | Panel edge toggles |
| `.brand-mark` | The logo image |

## 6. Next

- Where events come from and go to → the per-subsystem chapters in Parts II–IV
- Styling tokens and build flags → [Build & configuration](13-build-and-config.md)
- Recipes for common changes → [Maintenance guide](15-maintenance-guide.md)
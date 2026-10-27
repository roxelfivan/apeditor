# Architecture

> How the codebase is organised, what each file is responsible for, and the dependency rules that keep it from collapsing.

---

## 1. Stack

| Layer | Choice | Version |
|---|---|---|
| UI runtime | React + React DOM | 18.3.1 |
| Language | TypeScript (strict) | 5.5.x |
| Build / dev server | Vite | 5.4.x |
| State | Zustand with `persist` middleware | 4.5.x |
| Markdown | `react-markdown` + `remark-gfm` + `rehype-raw` + `rehype-sanitize` | 9 / 4 / 7 / 6 |
| Diffing | `diff` | 5.x |
| IDs | `uuid` (v4 only) | 9.x |
| Styling | Tailwind CSS + PostCSS + autoprefixer | 3.4.x |
| Fonts | `@fontsource/source-sans-3`, `@fontsource/newsreader`, `@fontsource/ibm-plex-mono` | 5.x |
| OCR | `@paddleocr/paddleocr-js` (PP-OCRv6_tiny) | 0.4.2 |
| OCR runtime | `onnxruntime-web` (WASM build only) | 1.30.0 |
| PDF | `pdfjs-dist` | 4.x |

## 2. Size

| Metric | Value |
|---|---|
| TypeScript / TSX files under `src/` | 55 |
| Total lines under `src/` (`.ts` + `.tsx`) | ~19,400 |
| `src/index.css` | 2,090 lines |
| Components | 22 files (17 top-level + 5 under `components/mentions/`) |
| Largest file | `Editor.tsx` — 2,009 lines |
| Second largest | `ChatPanel.tsx` — 1,381 lines |
| Largest pure module | `utils/proposedEdit.ts` — 1,292 lines |
| Tests | 3 Node scripts, 0 test-framework dependencies |

Three files dominate: `Editor.tsx`, `ChatPanel.tsx`, and `utils/proposedEdit.ts`. The first two were deliberately *not* merged — see [the event bus](#6-the-event-bus).

## 3. Layer map

```
┌──────────────────────────────────────────────────────────────┐
│  Composites (always mounted, visibility driven by props)     │
│  App.tsx · SettingsModal · PromptLibrary · RevisionHistory   │
│  HelpDocs · FuncSpecDocs                                     │
└───────────────────────────┬──────────────────────────────────┘
                            │ reads useStore, dispatches mvp:* events
┌───────────────────────────▼──────────────────────────────────┐
│  Feature components                                          │
│  Sidebar · Editor · ChatPanel · GraphView                    │
│  Concept3DScene · Comment{Layer,Margin,Composer,Popover,Tray} │
│  ReanchorPicker · ProposedEditCard · FileActionsButton       │
│  mentions/*                                                 │
└───────────────────────────┬──────────────────────────────────┘
                            │ calls hooks + pure utils
┌───────────────────────────▼──────────────────────────────────┐
│  Hooks                                                        │
│  useInlineCompletion · useDocumentMentions · useDragResize    │
│  useMediaQuery                                               │
└───────────────────────────┬──────────────────────────────────┘
                            │
┌──────────────┬────────────▼─────────────┬─────────────────────┐
│  Store       │  Network                 │  Pure logic / I/O    │
│  src/store/  │  src/api/chat.ts         │  src/utils/         │
│  zustand +   │  streamChatCompletion     │  comments,          │
│  persist     │  buildRequestMessages    │  proposedEdit,      │
│              │                          │  graph/, ocr, pdf,  │
│              │                          │  backup, secrets…   │
└──────────────┴──────────────────────────┴─────────────────────┘
```

## 4. Module inventory

### `src/` (root)

| File | Lines | Responsibility |
|---|---:|---|
| [`App.tsx`](../src/App.tsx) | 378 | Composition, global hotkeys, overlay state, theme + UI-font sync, first-run onboarding pop. Defines `Topbar` locally. |
| [`main.tsx`](../src/main.tsx) | 37 | Boot: legacy storage migration, pre-paint theme apply, `createRoot`. |
| [`index.css`](../src/index.css) | 2,090 | Tailwind layers, `.prose-md` markdown styles, component classes (`.cm-*`, `.mention-popover`, `.edge-anchor`, `.proposed-edit-card`), theme tokens. |
| [`types.ts`](../src/types.ts) | 332 | Shared types: `ChatMessage`, `DocumentRecord`, `Revision`, `Prompt`, `ProposedEdit`, `ApiConfig`, `Comment`, `CommentRound`, `CommentOp`, `MentionToken`, `MentionKind`, `MentionReason`, `Theme`, `ApiProvider`. |
| [`vite-env.d.ts`](../src/vite-env.d.ts) | 22 | `ImportMetaEnv` declarations for the `VITE_*` variables. |

### `src/api/` — 1 file

| File | Lines | Public surface |
|---|---:|---|
| [`chat.ts`](../src/api/chat.ts) | 1,104 | `streamChatCompletion`, `buildRequestMessages`, `resolveChatEndpoint`, `assertSafeChatEndpoint`, `ApiError`, `DEFAULT_SYSTEM_MESSAGE`, `PROPOSED_EDIT_RULES_DEFAULT`, `formatSelectionBlock`, `buildDocOutline`, `buildReferencedDocMessage`, `REFERENCED_DOCS_TOTAL_CHARS_CAP`, `CACHE_CONTROL_META`, and the `normalize*` / `isCurrent*` / `isStale*` prompt reconcilers. |

This is the **only** place in the app that performs an HTTP request to a chat provider (the one exception being the OCR Markdown rewrite, which calls back into `streamChatCompletion`).

### `src/config/` — 1 file

| File | Lines | Public surface |
|---|---:|---|
| [`providers.tsx`](../src/config/providers.tsx) | 117 | `PROVIDERS`, `getProvider`, `requiresApiKey`, `ProviderPreset`. |

### `src/store/` — 5 files (split in v0.5.2 from one 1,485-line file)

| File | Lines | Responsibility |
|---|---:|---|
| [`types.ts`](../src/store/types.ts) | 296 | The `StoreState` interface, `EditorFocusState`, `ProposedEditHighlight`, plus a re-export of `DEFAULT_SYSTEM_MESSAGE`. |
| [`defaults.ts`](../src/store/defaults.ts) | 162 | `defaultApiConfig` (reads `VITE_DEFAULT_*`), `initialDocs` (the `Welcome` and `Ideas` starter documents), `seedPrompts`, `makeDoc`. |
| [`actions.ts`](../src/store/actions.ts) | 611 | Comment-round / undo / re-anchor implementations as **named exports** so each is unit-testable without instantiating the store: `addCommentAction`, `updateCommentBodyAction`, `appendCommentRoundAction`, `recordAppliedEditAction`, `markCommentsSentAction`, `deleteCommentAction`, `dismissOutdatedCommentsAction`, plus helpers `pushUndoOp`, `findCommentEntry`, `replaceComment`, `ensureRoundsShape`, `markLatestRoundSent`, `findCommentForEdit`, `snippetOverlapScore`. |
| [`store.ts`](../src/store/store.ts) | 634 | `create<StoreState>()(persist(...))` wiring, the light document/revision/chat/prompt/UI actions, `useCurrentDocument`, the `partialize` list, and `onRehydrateStorage` migrations. |
| [`useStore.ts`](../src/store/useStore.ts) | 11 | A **barrel only** — re-exports `useStore`, `useCurrentDocument`, `DEFAULT_SYSTEM_MESSAGE`, and the store types so existing imports keep resolving. |

> **Why the barrel matters:** 11 import sites use `@/store/useStore`. Keep it. The split was an internal refactor; the public import path did not change.

### `src/hooks/` — 4 files

| File | Lines | Responsibility |
|---|---:|---|
| [`useInlineCompletion.ts`](../src/hooks/useInlineCompletion.ts) | 566 | The Predict state machine: 300 ms debounce, suppression gates, SSE loop, ghost lifecycle, overlap stripping, Tab/Esc handling. |
| [`useDocumentMentions.ts`](../src/hooks/useDocumentMentions.ts) | 459 | Heading-section detection, paragraph tables, `descendantSectionIndexes` cascade, selection matching. |
| [`useDragResize.ts`](../src/hooks/useDragResize.ts) | 220 | Pointer-event drag with rAF coalescing. Also exports every `MIN_*` / `MAX_*` bound constant used across the app. |
| [`useMediaQuery.ts`](../src/hooks/useMediaQuery.ts) | 37 | `NARROW_QUERY` / `COMMENT_SHEET_QUERY` (`max-width: 767px` or `max-height: 540px`), `useIsNarrow`, `useIsCommentSheet`. |

### `src/components/` — 23 files

| File | Lines | Responsibility |
|---|---:|---|
| [`Editor.tsx`](../src/components/Editor.tsx) | 2,009 | Toolbar, textarea + mirror + comment layer, comment composer/popover orchestration, margin badge positioning, Predict panel, tray, Graph host, split divider. |
| [`ChatPanel.tsx`](../src/components/ChatPanel.tsx) | — | Streaming chat, Google AI Mode branch, comment-batch send, Apply All, rejection staging, selection toggles, composer **+** attachments, panel resizing. |
| [`ChatAttachmentChips.tsx`](../src/components/ChatAttachmentChips.tsx) | — | Filename chips for pending composer files and sent user bubbles. |
| [`ProposedEditCard.tsx`](../src/components/ProposedEditCard.tsx) | 925 | One AI proposal: Split/Inline view, Apply / Highlight Apply / Reject / Reject-with-feedback, editor highlight, resizable. |
| [`CommentPopover.tsx`](../src/components/CommentPopover.tsx) | 911 | Read/edit one comment, multi-round rationale list, resize, persistence of popover size. |
| [`SettingsModal.tsx`](../src/components/SettingsModal.tsx) | 834 | Provider, key, endpoint, model, system message, rationale rules, temperature, UI font size, debug mode. |
| [`FileActionsButton.tsx`](../src/components/FileActionsButton.tsx) | 517 | Import (images + PDFs → OCR → Markdown) and Export (`.md`, `.json`). Dynamic-imports the heavy OCR deps. |
| [`GraphView.tsx`](../src/components/GraphView.tsx) | — | SVG rendering, node drag, zoom, hover dimming, edge labels, `GraphViewControls`, the flat / sphere / concept projection switch. |
| [`Concept3DScene.tsx`](../src/components/Concept3DScene.tsx) | — | 3D Concept projection. three.js WebGL scene behind `React.lazy` + `await import('three')`, so it ships as its own chunk. Raycasts for hover/click, then forwards pointer events to `GraphView`. |
| [`CommentComposer.tsx`](../src/components/CommentComposer.tsx) | 246 | Floating composer for a new comment. |
| [`ReanchorPicker.tsx`](../src/components/ReanchorPicker.tsx) | 241 | Heading/paragraph picker for re-linking a stale comment. |
| [`RevisionHistory.tsx`](../src/components/RevisionHistory.tsx) | 232 | Snapshot list, Preview / Diff tabs, restore, delete. |
| [`mentions/MentionInput.tsx`](../src/components/mentions/MentionInput.tsx) | 1,042 | `@`-aware textarea: caption injection, ZWSP anchors, chip overlay, serialize/hydrate. |
| [`mentions/SectionPicker.tsx`](../src/components/mentions/SectionPicker.tsx) | 218 | Second-stage picker: heading-grouped checkboxes with cascade. |
| [`CommentTray.tsx`](../src/components/CommentTray.tsx) | 204 | **Send to AI** bar + the stale-comment Re-link / Dismiss list. |
| [`Sidebar.tsx`](../src/components/Sidebar.tsx) | 193 | Document list, inline rename, delete, width resize, narrow drawer. |
| [`HelpDocs.tsx`](../src/components/HelpDocs.tsx) | 185 | In-app viewer for `docs/*.md`. |
| [`mentions/DocPicker.tsx`](../src/components/mentions/DocPicker.tsx) | 135 | First-stage picker: filtered document list. |
| [`ResizeHandle.tsx`](../src/components/ResizeHandle.tsx) | 121 | One of 8 resize edges/corners. |
| [`FuncSpecDocs.tsx`](../src/components/FuncSpecDocs.tsx) | — | In-app viewer for `func_spec/*.md`. Adds heading anchors, part-grouped nav, and cross-file navigation. |
| [`CommentLayer.tsx`](../src/components/CommentLayer.tsx) | 181 | Mirror overlay that paints `<mark>` highlights behind the textarea and hosts the selection `Range`. |
| [`PromptLibrary.tsx`](../src/components/PromptLibrary.tsx) | 174 | Saved prompt CRUD + `{{selection}}` substitution. |
| [`mentions/MentionChip.tsx`](../src/components/mentions/MentionChip.tsx) | 83 | The reference pill above an input. |
| [`CommentMargin.tsx`](../src/components/CommentMargin.tsx) | 112 | Numbered badges in the right margin column. |
| [`EdgeAnchor.tsx`](../src/components/EdgeAnchor.tsx) | 70 | Edge-pinned chevron that reveals a collapsed panel. |

### `src/utils/` — 19 files

| File | Lines | Responsibility |
|---|---:|---|
| [`proposedEdit.ts`](../src/utils/proposedEdit.ts) | 1,292 | Fence parsing, `findEditAnchor` (6 strategies), the Best Effort matcher, `applyEdit`, `applyAllEdits`, `applyEditAtCaret`, `formatRejectionBatch`. Zero React. |
| [`comments.ts`](../src/utils/comments.ts) | 634 | `reanchorComment` / `reanchorAll`, `reattachCommentToRange`, `formatCommentBatch`, `getSelectionRect`, `clampToContainer`, `clampCommentBody`. Zero React. |
| [`graph/layoutWorkspaceGraph.ts`](../src/utils/graph/layoutWorkspaceGraph.ts) | 501 | Atomic radial layout, cluster placement, relaxation, label placement. |
| [`ocr.ts`](../src/utils/ocr.ts) | 400 | Lazy PaddleOCR singleton, MIME dispatch, size caps, strict cleanup. |
| [`mentions/parseMentions.ts`](../src/utils/mentions/parseMentions.ts) | 389 | The **only** place that knows the mention sentinel format. `parseRawWithMentions`, `serializeRawWithMentions`, `summarizeMention`, `plainTextDiff`. |
| [`graph/buildWorkspaceGraph.ts`](../src/utils/graph/buildWorkspaceGraph.ts) | 298 | Documents + headings + wikilinks + `@` mentions → nodes and edges. |
| [`googleAiMode.ts`](../src/utils/googleAiMode.ts) | 197 | Builds the keyless Google AI Mode deep-link URL from a chat payload. |
| [`storage.ts`](../src/utils/storage.ts) | 181 | Every `localStorage` / `sessionStorage` key constant, `migrateLegacyStorage`, `downloadTextFile`, `sanitizeFilename`, session-API-key helpers. |
| [`paragraphs.ts`](../src/utils/paragraphs.ts) | 56 | Shared `splitParagraphs` / `previewParagraph` / `trimOnWordBoundary` for outlines, mentions, comment batches, and re-anchor. |
| [`diff.ts`](../src/utils/diff.ts) | 77 | `lineDiff` (flat) and `splitDiff` (side-by-side rows) over the `diff` package. |
| [`backup.ts`](../src/utils/backup.ts) | 86 | `BACKUP_SCHEMA` / `BACKUP_VERSION`, `buildDocumentBackup`, `serialiseDocumentBackup`. |
| [`pdf.ts`](../src/utils/pdf.ts) | 92 | `pdfjs-dist` wrapper: `loadPdfFromBytes`, `pageHasNativeText`, `pageNativeText`, `renderPageToCanvas`. |
| [`ocrMarkdown.ts`](../src/utils/ocrMarkdown.ts) | 97 | Streams recognised text through the configured model to produce reader-friendly Markdown. |
| [`chatAttachments.ts`](../src/utils/chatAttachments.ts) | — | Chat **+** format-then-answer prompt (`buildAttachmentTurnPrompt`). |
| [`graph/parseWikilinks.ts`](../src/utils/graph/parseWikilinks.ts) | 131 | `extractWikilinks`, `normalizeWikiSlug`, `resolveWikilink`. |
| [`secrets.ts`](../src/utils/secrets.ts) | 52 | Three redaction regexes and `redactSecretsInMessages`. |
| [`markdown.ts`](../src/utils/markdown.ts) | 23 | The shared `remarkPlugins` / `rehypePlugins` arrays. |
| [`graph/graphCamera.ts`](../src/utils/graph/graphCamera.ts) | 34 | `clampGraphZoom`, `stepGraphZoom`, `zoomedViewBox`. |
| [`theme.ts`](../src/utils/theme.ts) | 12 | `applyThemeClass` — toggles `html.dark`. |

### `src/docs/` — 2 files

| File | Lines | Responsibility |
|---|---:|---|
| [`catalog.ts`](../src/docs/catalog.ts) | 95 | The user-guide catalog. `HelpPageId`, `HELP_PAGES`, `getHelpPageContent`, `helpPageIdFromHref`. |
| [`funcSpecCatalog.ts`](../src/docs/funcSpecCatalog.ts) | — | The Functional Specification catalog. Adds part grouping, reading order, and cross-file href resolution over `func_spec/*.md`. |

## 5. Composition tree

```
src/main.tsx
  ├─ migrateLegacyStorage()           // ai-text-editor-mvp → apeditor
  ├─ applyThemeClass(theme)           // pre-paint, read straight from localStorage
  └─ <App />
       ├─ <Topbar />                  // local to App.tsx
       │    logo · version · current doc title · ([⋯] on narrow) [?] [{ }] [🕐] [🔖] [☀/☾] [⚙]
       ├─ <div className="flex-1 flex min-h-0 relative">
       │    ├─ <Sidebar />           // returns null when sidebarCollapsed
       │    ├─ <Editor />            // the middle column
       │    ├─ <ChatPanel />         // returns null when chatCollapsed
       │    ├─ <EdgeAnchor side="left" />    // in the content row
       │    └─ <EdgeAnchor side="right" />
       ├─ <EdgeAnchor side="top" />   // sibling of Topbar → absolute top-0 is the page top
       ├─ <MoreSheet />               // narrow ⋯ bottom sheet, portaled to document.body
       ├─ <SettingsModal open={…} />
       ├─ <PromptLibrary open={…} />
       ├─ <RevisionHistory open={…} />
       ├─ <HelpDocs open={…} />
       └─ <FuncSpecDocs open={…} />
```

All overlays are **always mounted** and return `null` when `open` is false, so their effects stay registered and no mount/unmount flash occurs.

## 6. The event bus

Components never import each other. `Editor.tsx` does not import `ChatPanel.tsx`; they coordinate through `window` CustomEvents whose names all start with `mvp:`.

```
FileActionsButton ──mvp:insert-text──▶ Editor
useInlineCompletion ──mvp:accept-completion──▶ Editor
GraphView / Concept3DScene / ProposedEditCard / ChatPanel ──mvp:select-range──▶ Editor
Editor ──mvp:editor-selection──▶ ChatPanel, PromptLibrary
PromptLibrary ──mvp:fill-chat──▶ ChatPanel
Editor ──mvp:send-comments──▶ ChatPanel
ChatPanel ──mvp:mark-comments-sent──▶ Editor
ChatPanel ──mvp:chat-streaming──▶ Editor
PromptLibrary ──mvp:get-selection──▶ Editor
* ──mvp:open-help──▶ App
* ──mvp:open-func-spec──▶ App
```

The full table, with `detail` shapes, is in [Events & components](12-events-and-ui-contracts.md#2-the-event-bus). To find every producer/consumer:

```bash
rg "mvp:" src/ -n
```

> **The `mvp:` prefix is a historical artefact.** The app was renamed from `ai-text-editor-mvp`; the prefix survived several renames. Renaming it is a mechanical but wide change — treat it as a dedicated chore, not a drive-by edit.

## 7. Dependency rules

These are the invariants that keep the layering intact. Violating them is what produced the v0.5.2 refactor in the first place.

### 7.1 `utils/` must not import from `components/`

`utils/` is the pure layer. `parseMentions.ts` used to live under `components/mentions/` while being imported by `utils/proposedEdit.ts` — a `utils → components` dependency that is both a layering violation and a tree-shaking hazard. It now lives at [`utils/mentions/parseMentions.ts`](../src/utils/mentions/parseMentions.ts).

### 7.2 Only `api/chat.ts` talks to the network

If a new feature needs to call a model, it must go through `streamChatCompletion`. `ocrMarkdown.ts` is the only other network caller and it does so by delegating to `streamChatCompletion`.

### 7.3 Only `store/actions.ts` mutates comment state

Every comment mutation flows through the named action builders there. They are plain functions taking `set`, so they can be tested without constructing the store — that is the whole point of the v0.5.2 split.

### 7.4 One direction: child → store, never store → child

Components read via selectors and write via actions. The store never holds component references and never imports a component. Everything cross-component goes through events or through the store.

### 7.5 `@/` always resolves to `src/`

Configured in both `vite.config.ts` (`resolve.alias`) and `tsconfig.app.json` (`paths`). Never use a relative import that climbs out of `src/` from inside `src/`.

## 8. Build configuration highlights

The full detail is in [Build & configuration](13-build-and-config.md). The three settings that surprise people:

1. **COOP/COEP headers are mandatory.** `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` are set in `vite.config.ts` for dev and preview, and in `vercel.json` for production. Without them `SharedArrayBuffer` is unavailable and threaded ONNX Runtime cannot start. If OCR fails only in production, check these headers first.
2. **`onnxruntime-web` is aliased to the WASM-only build.** The alias points at `dist/ort.wasm.min.mjs` so the ~69 MB of WebGPU/JSEP variants is never loaded or deployed.
3. **`import.meta.env.VITE_APP_VERSION` is injected from `package.json`.** `vite.config.ts` reads the version at config-load time and `define`s it. Bump the version in `package.json`; the topbar, Help header, and Functional Specification header all follow automatically.

## 9. Known architectural rough edges

Honest list; each has a home in [Maintenance guide](15-maintenance-guide.md#5-known-rough-edges).

| Issue | Where | Impact |
|---|---|---|
| `Editor.tsx` owns ~25 pieces of local state | `Editor.tsx` | Largest file; the main refactor candidate |
| `chatOpen` and `chatCollapsed` are two flags for one concept | `store/types.ts` | Confusing; the code sets both when un-collapsing |
| No `version`/`migrate` on the persist config | `store.ts` | All migration is imperative in `onRehydrateStorage`; it works but is harder to reason about |
| `layout.previewSizes` is persisted but not in `setLayout`'s signature | `store.ts` | Has its own `setPreviewSize` action |
| `saveRevision` has no auto-generated labels despite the type comment | `store.ts` | Snapshots always render as "Snapshot" |
| No CI, no lint config committed | repo root | `npm run typecheck` is the only automated gate |
# Maintenance guide

> Recipes for common changes, the conventions the codebase follows, the invariants that are easy to break, and an honest list of rough edges.

---

## 1. Conventions

### 1.1 Imports

| Rule | Example |
|---|---|
| Use the `@/` alias inside `src/` | `import { useStore } from '@/store/useStore'` |
| Never climb out of `src/` with `../` | — |
| Import the store through the barrel | `@/store/useStore`, not `@/store/store` |
| `utils/` must not import from `components/` | The v0.5.2 refactor fixed exactly this violation |

### 1.2 Pure logic

Anything that can be pure **is** pure. The comment, proposed-edit, graph, and mention helpers have zero React and zero DOM imports. That is what makes them testable via esbuild bundling in plain Node.

If you find yourself writing a `useEffect` in a component to compute something derivable, it probably belongs in `utils/`.

### 1.3 Store actions

| Rule | Why |
|---|---|
| Never mutate — always `set(...)` | React compares by reference |
| Return the **same state object** when nothing changed | Lets zustand skip the re-render |
| Comments go in `actions.ts` as named exports taking `set` | Testable without constructing the store |
| Light actions stay in `store.ts` | Keeps the split meaningful |

### 1.4 Components

| Rule | Why |
|---|---|
| Overlays are always mounted and return `null` when closed | Effects stay registered; no mount flash |
| Coordinates: be explicit about which space you are in | Viewport vs wrapper-local vs margin-local |
| New cross-component communication goes through an `mvp:*` event | Keeps `Editor.tsx` and `ChatPanel.tsx` decoupled |
| Bounds constants live in `useDragResize.ts` | One definition, imported everywhere |
| Persist a size or geometry? Use a key from `utils/storage.ts` | Grep-able and prefixed |

### 1.5 Comments in code

This codebase explains *why*, not *what*. Existing comments document the bug that caused the code to exist:

- Why `''` is excluded from the Predict stop sequences (it truncated the stream to zero bytes).
- Why Strategy 4 is skipped for applied replacements (oversized highlights).
- Why badge positions must not add `scrollTop` (double-counted, causing drift).
- Why the store migrations queue through `queueMicrotask` (mutating the rehydrate snapshot does not propagate).
- Why `mvp:accept-completion` carries the whole document.

**Match that standard.** A comment that restates the code is noise; a comment that prevents a future regression is the most valuable thing in the file.

## 2. Where does X live?

| I want to… | Touch | Also check |
|---|---|---|
| Add a new AI provider | [`config/providers.tsx`](../src/config/providers.tsx) (preset) + the `ApiProvider` union in [`types.ts`](../src/types.ts) | Only add to `requiresApiKey` if it is genuinely keyless |
| Change the system prompt | `DEFAULT_SYSTEM_MESSAGE` in [`api/chat.ts`](../src/api/chat.ts) | Update `isStaleDefaultSystemMessage` so old copies normalise away |
| Change the rationale rules | `PROPOSED_EDIT_RULES_DEFAULT` | Update `isStaleRationaleRulesOverride` |
| Change the fence schema | `PROPOSED_EDIT_SCHEMA_RULES` in `api/chat.ts` + [`proposedEdit.ts`](../src/utils/proposedEdit.ts) | The parser and the schema reminder are two halves of one contract |
| Change what the model sees about the current document | `buildDocOutline` | `splitParagraphs` in [`useDocumentMentions.ts`](../src/hooks/useDocumentMentions.ts) must match |
| Change the comment-batch format | `formatCommentBatch` in [`comments.ts`](../src/utils/comments.ts) | **Three** places agree: the formatter, the instruction block in `api/chat.ts`, and the `looksLikeCommentBatch` regex |
| Add a store field | [`store/types.ts`](../src/store/types.ts) + `store.ts` (init, action, `partialize`, `onRehydrateStorage`) | See the checklist in [State & persistence §10](04-state-and-persistence.md#10-adding-a-store-field-the-checklist) |
| Add a comment action | [`store/actions.ts`](../src/store/actions.ts) + possibly a new `CommentOp` variant in [`types.ts`](../src/types.ts) | Update the popover and the badge |
| Change comment re-anchoring | `reanchorComment` in [`comments.ts`](../src/utils/comments.ts) | `isCommentStale` mirrors strategies 1 and 3 only |
| Change the Apply waterfall | [`proposedEdit.ts`](../src/utils/proposedEdit.ts) | Run `npm run test:proposed-edit` |
| Change the Predict behaviour | [`useInlineCompletion.ts`](../src/hooks/useInlineCompletion.ts) | The gating order in the state machine |
| Add a toolbar control | [`Editor.tsx`](../src/components/Editor.tsx) | Decide whether it should hide in `graph` mode |
| Add a view mode | `viewMode` union + `Editor.tsx` render branches + the toolbar `<select>` | The toolbar visibility matrix |
| Add a resizable panel | [`useDragResize.ts`](../src/hooks/useDragResize.ts) (bounds) + [`ResizeHandle.tsx`](../src/components/ResizeHandle.tsx) | — |
| Add a keyboard shortcut | [`App.tsx`](../src/App.tsx) for global, or the owning component for local | Respect the `editable` guard in the global handler |
| Add a new `mvp:*` event | Dispatch and listen | Add the row to the table in [Events & components §2](12-events-and-ui-contracts.md#22-three-shapes-worth-knowing) |
| Add a Help page | New `.md` under `docs/` + an entry in `HELP_PAGES` | — |
| Add a Functional Specification page | New `NN-slug.md` under `func_spec/` + an entry in `FUNC_SPEC_PAGES` | Prefix the filename with the next free `NN-` |
| Change theme tokens | [`tailwind.config.cjs`](../tailwind.config.cjs) + the matching `html.dark` rules in [`index.css`](../src/index.css) | Prefer making a token theme-aware like `cyber-primary` |
| Change a size or page cap | The `OCR_MAX_*` constants in [`ocr.ts`](../src/utils/ocr.ts) | There is no Settings surface for them |
| Add a dependency | `package.json` + a note in `README.md`'s libraries table | Check the bundle impact — `chunkSizeWarningLimit` is already at 12 MB |

## 3. Common tasks

### 3.1 Add a new persisted field

1. Add it to `StoreState` with its default documented.
2. Set the initial value in the store factory.
3. Add the action, following the return-`s`-when-unchanged convention.
4. Add it to `partialize` — or add a comment explaining why it is ephemeral.
5. Add a repair step in `onRehydrateStorage` if it needs a default on load.
6. Update the tables in [State & persistence §3](04-state-and-persistence.md#3-state-slices) and [Data types & glossary](16-glossary.md).
7. `npm run typecheck`.

### 3.2 Add a new Help page or spec page

| | Help | Functional Specification |
|---|---|---|
| File | `docs/NN-slug.md` | `func_spec/NN-slug.md` |
| Register in | `HELP_PAGES` | `FUNC_SPEC_PAGES` (+ pick a `part`) |
| Verify | `npm run dev`, click **?** | `npm run dev`, click **`{ }`** |

Both are picked up by `import.meta.glob(..., { query: '?raw' })` at build time. No separate docs build.

### 3.3 Change the prompt contract

1. Edit the constant in [`api/chat.ts`](../src/api/chat.ts).
2. Update the matching `isStale*` detector.
3. If `formatCommentBatch` changed, update **both** the instruction block and `looksLikeCommentBatch`.
4. If `buildDocOutline`'s paragraph rule changed, update `splitParagraphs` in `useDocumentMentions.ts`.
5. `npx vite-node scripts/measure-prompt.ts` to check the token impact.
6. Manually test a Send to AI round trip.

### 3.4 Add a view mode

1. Extend the `viewMode` union in [`store/types.ts`](../src/store/types.ts).
2. Add a render branch in `Editor.tsx` and derive `showWrite` / `showPreview` / `showGraph`.
3. Update the toolbar `<select>` options.
4. Update the toolbar visibility matrix in [Editor & writing §2](05-editor-and-writing.md#2-view-modes).

### 3.5 Refactor `Editor.tsx`

It is the file most likely to be tackled. Safest extraction order:

1. **`graphLabelPx` / `graphZoom` / `graphEpoch`** → a `useGraphView()` hook. They are three `useState` calls with a Reset handler.
2. **Composer and popover positioning** → a `useFloatingBox()` hook encapsulating `toWrapperLocal` + `clampToContainer` + `ResizeObserver` measurement. `CommentComposer` and `CommentPopover` share the algorithm.
3. **Predict wiring** → already mostly in `useInlineCompletion`; the remaining local state is `inlineOn`, `suggestionHeight`, and the panel render.
4. **Badge positioning** → a `useBadgePositions()` hook. The rule (no `scrollTop`) must travel with it.

Do **not** extract the store selectors — they are already minimal and correctly shaped.

## 4. Invariants and gotchas

The things that will bite you. Each has caused a real bug at some point.

### 4.1 Geometry

| # | Invariant |
|---|---|
| 1 | Three coordinate spaces coexist: **viewport**, **wrapper-local**, **margin-local**. Converting by even one `getBoundingClientRect()` puts the composer or popover hundreds of pixels off. |
| 2 | **Do not add `scrollTop` to badge positions.** The margin column does not scroll; only the textarea does. |
| 3 | The `.comment-textarea, .cm-mirror` shared rule is load-bearing. Any property added to one but not the other accumulates into vertical selection drift that grows with document length. |
| 4 | `isolation: 'isolate'` on `[data-cm-wrapper]` is what lets the composer/popover `z-index: 50` beat the mirror and textarea. |
| 5 | `getSelectionRect` returns **viewport** coordinates. Converting to margin-local subtracts `.cm-margin`'s viewport `top`, not the textarea's. |
| 6 | `setRangeEndpoints` must advance the TreeWalker to the **next node** when `startIdx === nodeEnd`. Setting offset `len` on the current node collapses the range and `getBoundingClientRect()` returns nothing. |

### 4.2 Comments

| # | Invariant |
|---|---|
| 7 | `outdated` is sticky — auto-recovery never re-runs once flagged. |
| 8 | The terminal `outdated` branch does not mirror into `rounds[last].outdated`. The popover header and `RationaleSection` read different surfaces. |
| 9 | `replaceCommentsForDocument` must never push an undo op — it runs on a 150 ms debounce after every edit. |
| 10 | `dismissOutdatedComments` pushes one undo op **per** comment. |
| 11 | ⌘Z must return **before** `preventDefault()` when the stack is empty, or native textarea undo breaks. |
| 12 | The auto-reanchor effect depends on `[doc?.id, viewMode]`. Dropping `viewMode` leaves the scroll listener bound to a detached textarea. |
| 13 | `hasRationale` reads `r.applied.length` with no `Array.isArray` guard. `ensureRoundsShape` is the only thing preventing a throw. |

### 4.3 AI and prompts

| # | Invariant |
|---|---|
| 14 | The model never writes the document. Every write goes through `applyEdit`, `applyAllEdits`, `applyEditAtCaret`, or a keystroke. |
| 15 | `applyAllEdits` threads the accumulator — a later edit may target text an earlier edit produced. |
| 16 | `requiresApiKey` is the single source of truth for key gating. Do not re-derive it. |
| 17 | `stripParagraphReferences` on `original` / `replacement` is load-bearing: models echo `[p10]@354` markers and the exact match fails without it. |
| 18 | The Best Effort probe is deferred to `requestIdleCallback`. Making it synchronous janks the chat scroll on large replies. |
| 19 | A blocked splice must never be silently dropped — the user must be pointed at Highlight Apply. |
| 20 | `enableCacheControl` defaults to `false` so proxies that reject unknown fields do not fail. |
| 21 | `formatCommentBatch`, the instruction block, and `looksLikeCommentBatch` must stay in sync. |

### 4.4 Mentions

| # | Invariant |
|---|---|
| 22 | `parseMentions.ts` is the only file that knows the sentinel format. Never hand-construct a sentinel. |
| 23 | The trailing ZWSP is the structural anchor. Deleting it drops the mention. |
| 24 | `Esc` in `DocPicker` must not consume the `@`. |
| 25 | The cascade is downward only. Ticking a child never ticks a parent. |
| 26 | `documentTitle` is captured at insert time and must not be re-read from the store for display. |
| 27 | Referenced documents **downgrade to outlines** when the budget is exhausted; they are never silently omitted. |

### 4.5 Graph

| # | Invariant |
|---|---|
| 28 | The graph is a pure derivation. It writes nothing to the store. |
| 29 | `extractWikilinks` must skip `mention:` targets, or every comment reference becomes a wikilink edge. |
| 30 | Only `level > 0` sections become heading nodes. |
| 31 | The current document's node is **pinned** during relaxation. |
| 32 | The single-child collapse in `assignShells` is what stops a one-H1 page collapsing into one ring. |
| 33 | Drag overrides are component state; only a remount (`graphEpoch`) clears them. |

### 4.6 Build and storage

| # | Invariant |
|---|---|
| 34 | COOP/COEP headers must exist in dev, preview, and production, or threaded ONNX fails to start. |
| 35 | The `ort.wasm.min.mjs` alias must stay — removing it pulls in ~69 MB of unused WebGPU variants. |
| 36 | Never add an API key to a `VITE_*` env var. |
| 37 | `sync-ocr-runtime-assets.mjs` must keep its prune step; it runs on every install and build. |
| 38 | Bounds constants live in `useDragResize.ts`. Change a bound in one place. |
| 39 | `cyber-primary` and `cyber-muted` are the only theme-aware tokens. |
| 40 | `tailwind.config.cjs`'s `content` array must list every directory containing class names. |

### 4.7 OCR

| # | Invariant |
|---|---|
| 41 | OCR makes zero network calls. All assets come from `public/`. |
| 42 | Every cleanup step stays in its `finally` block — ObjectURL revoke, `img.src = ''`, canvas zeroing, `pdf.destroy()`, `page.cleanup()`. |
| 43 | PaddleOCR is a module-level singleton. Do not instantiate per call. |
| 44 | Only the Markdown rewrite needs a key. Do not gate the whole import flow on it. |

## 5. Known rough edges

Honest list. None of these are urgent, but each is a future PR.

| Issue | Where | Impact / suggested fix |
|---|---|---|
| `Editor.tsx` owns ~25 pieces of local state | `Editor.tsx` | Largest file; extraction order is in §3.5 |
| `chatOpen` and `chatCollapsed` are two flags for one concept | `store/types.ts`, `store.ts` | Confusing; un-collapsing sets both. Collapse into one flag with a migration, or document the distinction harder |
| No `version` / `migrate` on the persist config | `store.ts` | All migration is imperative in `onRehydrateStorage`. It works; it is just harder to reason about |
| `layout.previewSizes` is persisted but not in `setLayout`'s signature | `store.ts` | Has its own `setPreviewSize` action. Either add it to `setLayout` or document why not |
| `saveRevision` has no auto-generated labels despite the type comment | `store.ts` | Snapshots always render as "Snapshot". The `labelDraft` state in `RevisionHistory` exists but has no input bound to it |
| `RevisionHistory.labelDraft` has no input | `RevisionHistory.tsx` | Dead state; either add a label input or remove it |
| `isCommentStale` has no consumer | `comments.ts` | Exported but unused. Useful for a future pre-flight validation |
| `splitDiff` is not used by `RevisionHistory` | `diff.ts` | Exported for other consumers; currently none |
| `CommentComposer` registers its Escape effect twice | `CommentComposer.tsx` | Verbatim duplicate; idempotent but a maintenance trap |
| `CommentMargin` fires `onSelect` on both `pointerup` and `click` | `CommentMargin.tsx` | Double invocation per tap. Harmless today; do not add side effects |
| `mvp:` prefix is historical | all of `src/` | Mechanical but wide rename |
| `VITE_DEFAULT_PROVIDER` missing from `.env.example` | `.env.example` | One line |
| No CI, no committed lint config | repo root | `npm run typecheck` is the only automated gate |
| Breakpoint mismatch at 640–767 px | `index.css` vs `useMediaQuery.ts` | Margin is still vertical while the split is stacked |
| `setRangeEndpoints` ignores its `visibleText` / `startNode` params | `comments.ts` | Reserved for a future fast path; `void`-discarded |

## 6. Release checklist

```bash
npm run typecheck
npm run test:heading-sections
npm run test:proposed-edit
npm run test:graph
npm run build
```

Then:

1. Bump `package.json`'s `version` — `VITE_APP_VERSION` follows automatically into the topbar, Help, and Functional Specification.
2. Write a `.release-notes-v<version>.md` at the repo root, following the existing pattern.
3. Add the entry to `RELEASE_NOTES.md` and the version table in `README.md`.
4. Update [`docs/whats-new.md`](../docs/whats-new.md) — it is a Help page and is shown to users.
5. Update this document's chapters for any behaviour change.
6. Tag and push; the GitHub release page picks up the notes.

## 7. Getting oriented in an unfamiliar area

| You need to understand… | Read, in order |
|---|---|
| The editor's rendering and positioning | [Editor & writing](05-editor-and-writing.md) → [Runtime flows §2–3](03-runtime-flows.md) |
| The comment lifecycle | [Comments](06-comments.md) → [`store/actions.ts`](../src/store/actions.ts) → [`utils/comments.ts`](../src/utils/comments.ts) |
| What the model sees | [AI chat & prompts §4](07-ai-chat.md#4-the-request-message-contract) → [`scripts/measure-prompt.ts`](../scripts/measure-prompt.ts) |
| Applying AI edits safely | [Proposed edits §4](08-proposed-edits.md#4-the-apply-waterfall) → `npm run test:proposed-edit` |
| Persistence and migrations | [State & persistence §5](04-state-and-persistence.md#5-rehydrate-migrations) → `onRehydrateStorage` |
| The graph layout | [Graph view §5](10-graph-view.md) → `npm run test:graph` |
| Why something is built the way it is | The code comments. They are unusually good and cite the specific bug that caused the code to exist. |

## 8. Next

- Field-by-field type reference → [Data types & glossary](16-glossary.md)
- Back to the index → [Functional Specification](README.md)
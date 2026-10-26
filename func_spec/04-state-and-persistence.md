# State & persistence

> The single Zustand store, every slice it holds, exactly what reaches `localStorage`, and how old payloads are repaired on load.

---

## 1. The one-store rule

ApEditor has **one** state container: `create<StoreState>()(persist(...))` in [`store/store.ts`](../src/store/store.ts). There is no second store, no context provider holding state, and no server cache.

Three things are deliberately **not** in the store:

| Thing | Where it lives instead | Why |
|---|---|---|
| The textarea's DOM value and caret | The DOM | React never owns the text while you type |
| The Predict ghost text | `useInlineCompletion` local state | Transient, must not survive a document switch |
| Per-card UI (ProposedEditCard status, popover geometry, Graph drag overrides) | Component local state / `localStorage` | Cosmetic and per-instance |

Everything else — documents, chats, revisions, prompts, settings, layout, comments — is store state.

## 2. Store file layout

Split from a single 1,485-line file in v0.5.2.

| File | Contains | Imports from |
|---|---|---|
| [`store/types.ts`](../src/store/types.ts) | The `StoreState` interface and supporting types | `@/types`, `@/api/chat` (for the `DEFAULT_SYSTEM_MESSAGE` re-export) |
| [`store/defaults.ts`](../src/store/defaults.ts) | `defaultApiConfig`, `initialDocs`, `seedPrompts`, `makeDoc` | `@/config/providers` |
| [`store/actions.ts`](../src/store/actions.ts) | Comment / undo / re-anchor actions as **named exports** | `@/utils/comments`, `@/utils/proposedEdit`, `@/types` |
| [`store/store.ts`](../src/store/store.ts) | The `create(...)` call, light actions, `partialize`, `onRehydrateStorage` | everything above |
| [`store/useStore.ts`](../src/store/useStore.ts) | Re-exports only | `./store`, `./types`, `@/api/chat` |

> **The barrel exists for a reason.** 11 import sites use `@/store/useStore`. Do not delete it; the split was internal and the public import path is unchanged.

## 3. State slices

`P` = persisted to `localStorage`.

### 3.1 Document and content

| Field | Type | Default | P | Notes |
|---|---|---|:-:|---|
| `documents` | `DocumentRecord[]` | `[Welcome, Ideas]` | ✅ | Newest-first; `createDocument` prepends |
| `currentDocumentId` | `string \| null` | `initialDocs[0].id` | ✅ | Falls back to `documents[0].id ?? null` on delete |

`DocumentRecord` = `{ id, title, content, createdAt, updatedAt }`.

### 3.2 Per-document collections

All three are `Record<documentId, …>`. They are deleted with the document.

| Field | Type | Default | P | Notes |
|---|---|---|:-:|---|
| `chats` | `Record<string, ChatMessage[]>` | `{}` | ✅ | Live thread. Cleared per-document by `clearChat`. Sent to the model. |
| `chatArchives` | `Record<string, ArchivedChat[]>` | `{}` | ✅ | Parked threads, newest first. Not sent to the model. |
| `revisions` | `Record<string, Revision[]>` | `{}` | ✅ | Oldest-first; the UI reverses for display |
| `comments` | `Record<string, Comment[]>` | `{}` | ✅ | Canonical order is **document position**, not creation order |

### 3.3 Library

| Field | Type | Default | P |
|---|---|---|:-:|
| `prompts` | `Prompt[]` | `seedPrompts` | ✅ |

`addPrompt` **prepends**, so user prompts appear above the four seeds.

### 3.4 Editor and view

| Field | Type | Default | P | Range |
|---|---|---|:-:|---|
| `viewMode` | `'write' \| 'preview' \| 'split' \| 'graph'` | `'split'` | ✅ | — |
| `editorFontSize` | `number` | `14` | ✅ | `10`–`24`, step 1 |
| `uiFontSize` | `number` | `14` | ✅ | `12`–`20`, step 1 |

`editorFontSize` applies to the textarea and the preview pane. `uiFontSize` is written to `<html style="font-size">` so every `rem`-based Tailwind text utility scales — **except** inside the editor, whose root is pinned to `fontSize: '14px'` so stray `text-xs` descendants are unaffected.

### 3.5 Panel visibility

| Field | Type | Default | P | Notes |
|---|---|---|:-:|---|
| `chatOpen` | `boolean` | `true` | ✅ | Legacy flag |
| `chatCollapsed` | `boolean` | `false` | ✅ | The flag the UI actually renders from |
| `sidebarCollapsed` | `boolean` | `false` | ✅ | `Sidebar` returns `null` |
| `topbarCollapsed` | `boolean` | `false` | ✅ | The top anchor renders as a `Topbar` sibling |

> **Two flags for the chat panel** is a known wart. `chatOpen` means "deliberately opened"; `chatCollapsed` means "hidden for this session". When un-collapsing, the code sets `chatCollapsed = false` **and** `chatOpen = true`. See [known rough edges](15-maintenance-guide.md#5-known-rough-edges).

### 3.6 Behaviour toggles

| Field | Type | Default | P | Notes |
|---|---|---|:-:|---|
| `includeSelection` | `boolean` | `true` | ✅ | Attaches the highlight on top of the outline |
| `sendSelectionOnly` | `boolean` | `false` | ✅ | Setting it force-sets `includeSelection = true` |
| `persistApiKey` | `boolean` | `true` | ✅ | `false` moves the key to `sessionStorage` |
| `debugMode` | `boolean` | `false` | ✅ | Shows the Predict status pill and counters |

### 3.7 Settings

| Field | Type | Default | P |
|---|---|---|:-:|
| `theme` | `'light' \| 'dark'` | `'light'` | ✅ |
| `api` | `ApiConfig` | `defaultApiConfig` | ✅ (conditionally — see below) |

`ApiConfig` = `{ provider, apiKey, apiEndpoint, model, systemMessage?, temperature, rationaleRulesOverride? }`.

`systemMessage` and `rationaleRulesOverride` are **`undefined` by design** — not empty strings. `undefined` means "use the live built-in from `api/chat.ts`", so updating the built-in propagates to every user who never overrode it. See [prompt reconcilers](#8-prompt-reconcilers).

### 3.8 Layout

| Field | Type | Default | P | Bounds |
|---|---|---|:-:|---|
| `layout.sidebarWidth` | `number` | `240` | ✅ | `160`–`480` px |
| `layout.chatWidth` | `number` | `384` | ✅ | `280`–`max(720, innerWidth × 2/3)` |
| `layout.editorSplitPct` | `number` | `50` | ✅ | `20`–`80` % (left pane of Split; Graph takes the rest) |
| `layout.splitLeftMode` | `'write' \| 'preview'` | `'write'` | ✅ | Left pane content in Split; missing values rehydrate to `'write'` |
| `layout.previewSizes` | `Record<string, {w,h}>` | `{}` | ✅ | Per ProposedEditCard, keyed `${messageId}:${editId}` |

> `previewSizes` is persisted but is **not** part of `setLayout`'s signature. It has its own `setPreviewSize(key, patch)` action.

### 3.9 Ephemeral (never persisted)

| Field | Type | Purpose |
|---|---|---|
| `editorFocus` | `Record<documentId, { focused, selectionStart, selectionEnd }>` | Lets ProposedEditCard decide whether Highlight Apply is available. `-1` offsets until the user has clicked in the editor. |
| `proposedEditHighlights` | `Record<documentId, ProposedEditHighlight[]>` | Temporary editor highlight of a card's matched span, keyed `${messageId}:${editId}`. |
| `commentUndoStack` | `CommentOp[]` | Session-only undo. A fresh reload starts empty **by design**. |

## 4. `localStorage` schema

### 4.1 The main blob

| | |
|---|---|
| Key | `apeditor` (`STORE_STORAGE_KEY = STORAGE_PREFIX` in [`utils/storage.ts`](../src/utils/storage.ts)) |
| Writer | zustand `persist` middleware |
| Format | `JSON.stringify({ state: <partialized>, version: 0 })` |
| Size driver | `documents`, `chats`, `chatArchives`, `revisions`, `comments` |

There is **no `version` / `migrate` pair configured** on the persist options. All migration is imperative inside `onRehydrateStorage`. See [migrations](#5-rehydrate-migrations).

### 4.2 `partialize`

Exactly these 21 keys are written:

```ts
{
  documents, currentDocumentId,
  chats, chatArchives, revisions, prompts,
  viewMode, editorFontSize, uiFontSize,
  chatOpen, sidebarCollapsed, chatCollapsed, topbarCollapsed,
  includeSelection, sendSelectionOnly, persistApiKey, debugMode,
  theme,
  api: s.persistApiKey ? s.api : { ...s.api, apiKey: '' },
  layout,
  comments,
}
```

`editorFocus`, `proposedEditHighlights`, `commentUndoStack`, and every action function are excluded.

### 4.3 Side-channel keys

| Key | Store | Purpose |
|---|---|---|
| `apeditor` | `localStorage` | The main store blob |
| `apeditor:onboarded` | `localStorage` | Suppresses the first-run Settings auto-pop |
| `apeditor:session-api-key` | `sessionStorage` | The API key when "forget on tab close" is on |
| `apeditor:chat-messages-height` | `localStorage` | Chat panel's vertical divider; `0` means "use the default" |
| `apeditor:suggestion-height` | `localStorage` | Predict panel height, clamped to `80`–`600` |
| `apeditor:settings-modal-size` | `localStorage` | Settings modal `{w,h}` |
| `apeditor:settings-system-msg-size` | `localStorage` | System message textarea `{w:0,h}` (only `h` is read) |
| `apeditor:settings-rationale-rules-size` | `localStorage` | Rationale rules textarea |
| `apeditor:popover-size:<commentId>` | `localStorage` | Comment popover geometry |
| `apeditor:pe-split:<messageId>:<editId>:split` | `localStorage` | ProposedEditCard split divider, 20–80 |
| `apeditor:cm-z-hint` | `sessionStorage` | One-shot "undo is comment-ops only" toast |

All constants live in [`utils/storage.ts`](../src/utils/storage.ts). Prefixes are `apeditor` (current) and `ai-text-editor-mvp` (legacy, migrated once at boot).

### 4.4 The API key lifecycle

`persistApiKey === true` (default):
1. The key lives in `localStorage['apeditor'].state.api.apiKey`.
2. `setApi` and `setPersistApiKey` both call `clearSessionApiKey()`.

`persistApiKey === false`:
1. `partialize` writes `apiKey: ''` — the key is **stripped from the blob**, not omitted.
2. `setApi` and `setPersistApiKey` call `writeSessionApiKey(key)`.
3. On rehydrate, step 12 below splices `readSessionApiKey()` back into `api.apiKey`.

All session helpers are `try`/`catch` guarded for private-mode browsers.

> **Security posture:** this is plaintext in `localStorage` by design. See [Testing & security](14-testing-and-security.md#7-threat-model).

## 5. Rehydrate migrations

`onRehydrateStorage` receives the loaded snapshot. **Mutating nested fields on `state` does not propagate to the live store**, so every repair is collected into a `repairs: Partial<StoreState>` object and applied with `useStore.setState(repairs)` inside a `queueMicrotask`, wrapped in `try/catch`.

Steps, in execution order:

| # | Repair | Detail |
|---|---|---|
| 1 | Theme | `applyThemeClass(state.theme)` synchronously, before the microtask |
| 2 | Layout clamps | Only assigns when out of range: `sidebarWidth` → `160`–`480`, `chatWidth` → `280`–`720`, `editorSplitPct` → `50` if not a finite number, else `20`–`80`; `splitLeftMode` → `'write'` when missing or invalid |
| 3 | `api` patch | Adds `provider: 'minimax'` if the key is missing; runs `normalizeRationaleRulesOverride` and `normalizeSystemMessage` |
| 4 | Microtask queued | Later steps below keep mutating the same `repairs` object |
| 5 | `comments` | Drops any `comments[docId]` that is not an array. For each comment, `ensureRoundsShape` wraps flat legacy comments in a single `CommentRound` built from the top-level fields, with a fresh `uuid()` and `applied: []` |
| 6 | Provider coercion | Any value outside `'minimax' \| 'openai' \| 'google-ai-mode'` → `'minimax'` |
| 7 | `debugMode` | Non-boolean → `false` |
| 8 | `uiFontSize` | Non-number → `14`; then clamp to `12`–`20` |
| 9 | `persistApiKey` | Non-boolean → `true` |
| 10 | `sendSelectionOnly` | Non-boolean → `false` |
| 11 | `proposedEditHighlights` | Falsy or non-object → `{}` (defensive for HMR) |
| 12 | Session API key | If `persistApiKey === false`, read `readSessionApiKey()` and restore it into `api.apiKey` |

### The flat-comment migration

Payloads written before comment rounds existed stored:

```ts
{ id, documentId, start, end, snippet, body, createdAt, updatedAt, outdated, sent }
```

`ensureRoundsShape` converts them to:

```ts
{ ...that,
  rounds: [ { id: uuid(), start, end, snippet, body, createdAt, updatedAt,
              outdated, sent, applied: [] } ] }
```

with the top-level mirrors re-synced from the new round. `ensureRoundsShape` returns the input unchanged when `rounds` is already a non-empty array, so it is safe to call on every read path.

## 6. Action catalogue

All actions follow the same pattern: never mutate, always `set(...)`, return the same state object when nothing changed so React can skip the re-render.

### 6.1 Documents

| Action | Behaviour |
|---|---|
| `createDocument(title?)` | `makeDoc(title?.trim() \|\| 'Untitled')`, **prepends**, sets `currentDocumentId`, returns the new id |
| `renameDocument(id, title)` | Trims; empty → `'Untitled'` |
| `deleteDocument(id)` | Removes the doc and `delete`s `chats[id]`, `chatArchives[id]`, `revisions[id]`, `comments[id]`; `currentDocumentId` → `documents[0]?.id ?? null` |
| `setCurrentDocument(id)` | Direct set |
| `updateDocumentContent(id, content)` | Bumps `updatedAt` |

### 6.2 Revisions

| Action | Behaviour |
|---|---|
| `saveRevision(documentId, label?)` | No-op if the doc is missing. Appends `{ id: uuid(), documentId, content, createdAt, label }` |
| `deleteRevision(documentId, revisionId)` | Filters |
| `restoreRevision(documentId, revisionId)` | No-op if the revision is missing. Sets `content` and bumps `updatedAt`. **Does not auto-snapshot** — the UI shows a `confirm()` |

Label regimes: the editor toolbar saves with **no label**; Chat saves `'Before AI send'`; Apply All saves `'Before Apply All'`. Unlabelled revisions render as `Snapshot`.

### 6.3 Chat

| Action | Behaviour |
|---|---|
| `appendMessage(documentId, msg)` | Appends |
| `updateLastAssistant(documentId, content)` | Scans **backwards** for the last `assistant` message and replaces only its `content`; no-op if none |
| `clearChat(documentId)` | Sets `chats[documentId] = []`, keeping the key |
| `archiveChat(documentId)` | If live messages exist, prepends an `ArchivedChat` and clears the live thread; no-op when empty |
| `archiveOldChat(documentId, olderThanMs)` | Messages with `createdAt <= now - olderThanMs` become one archive entry; newer stay live; no-op when nothing qualifies. Default cutoff in the UI is 7 days |
| `restoreArchivedChat(documentId, archiveId)` | Loads that archive as live. Non-empty live is archived first. Removes the restored row |
| `deleteArchivedChat(documentId, archiveId)` | Drops one archive row |

### 6.4 UI and settings

| Action | Behaviour |
|---|---|
| `setSendSelectionOnly(v)` | Force-sets `includeSelection = true` when `v` |
| `bumpEditorFontSize(delta)` | `clamp(current + delta, 10, 24)` |
| `setUiFontSize(size)` | `clamp(size, 12, 20)` |
| `toggleTheme()` | Flips and calls `applyThemeClass(next)` synchronously |
| `setApi(patch)` | Merges, then syncs the session key per `persistApiKey` |
| `setProposedEditHighlight(docId, cardKey, range)` | **Re-render-storm guard**: returns `s` when `range === null` and no entry exists, and when the range is deep-equal to the existing one |
| `setEditorFocus(docId, info)` | Writes focus + selection |

### 6.5 Comments — `store/actions.ts`

These are **named exports taking `set`**, not store methods, so they are testable in isolation.

| Helper | Behaviour |
|---|---|
| `pushUndoOp(stack, op)` | Appends, then drops oldest beyond `COMMENT_UNDO_STACK_LIMIT = 20` |
| `findCommentEntry(comments, id)` | Linear scan across all documents → `{ documentId, comment }` or `null` |
| `replaceComment(comments, id, next)` | Rebuilds the slice; **returns the original slice object** for untouched documents (referential stability) |
| `ensureRoundsShape(c)` | Wraps flat legacy comments; returns `c` unchanged when `rounds` is already valid |
| `markLatestRoundSent(c)` | Flips the **latest** round's `sent` and the top-level mirror; returns `c` unchanged when already sent (used as a no-change signal) |
| `findCommentForEdit(comments, info)` | Inference heuristic: skips comments whose latest round is not `sent`, scores each candidate with `snippetOverlapScore(lastRound.snippet, info.original)`, returns the best with score > 0 |
| `snippetOverlapScore(a, b)` | Longest common substring via a sliding window capped at 24, descending from `min(shorter, 24)` to `12`. **A match requires ≥ 12 shared characters.** |

| Action | Behaviour |
|---|---|
| `addCommentAction` | Seeds via `ensureRoundsShape`, pushes `CommentOp 'add'` |
| `updateCommentBodyAction` | **Sent round → new round** (`'append-round'`). Unsent → in-place (`'update-body'`). Identical body + identical mention id set → no-op |
| `appendCommentRoundAction` | Explicit new round. `createdAt` preserved from `rounds[0]`, `updatedAt` from the new round. Pushes `'append-round'` |
| `recordAppliedEditAction` | See [below](#7-recordappliededit) |
| `markCommentsSentAction` | Iterates all documents, flips the latest round. **Does not push an undo op** |
| `deleteCommentAction` | Filters; pushes `'delete'` |
| `dismissOutdatedCommentsAction` | Removes every `outdated` comment; pushes **one undo op per removal**; returns the count |

### 6.6 `reattachComment` and `undoLastCommentOp` (in `store.ts`)

| Action | Behaviour |
|---|---|
| `reattachComment(id, range)` | Resolves the entry, calls `reattachCommentToRange`, returns `false` with no state change if the comment/doc is missing or the range is invalid. On success pushes a `'update-body'` op |
| `replaceCommentsForDocument(docId, next)` | Wholesale replace. **Deliberately pushes no undo op** — the 150 ms auto-reanchor loop calls it continuously |
| `undoLastCommentOp()` | Pops and inverts the top op. `'add'` → remove; `'delete'` → append back; `'update-body'` / `'append-round'` / `'record-applied'` → restore the `before` snapshot. Returns the popped op or `null` |

## 7. `recordAppliedEdit`

The most consequential action in the store: it is what makes the AI's reasoning readable in place after an edit is applied.

**Signature**

```ts
recordAppliedEdit(info: {
  documentId: string;
  commentId?: string;      // explicit, or inferred
  messageId: string;
  editId: string;
  summary: string;
  rationale: string;
  original: string;
  replacement: string;
  appliedAt: number;
  newAnchor?: { start: number; end: number };
}): string | null
```

**Resolution order for the target comment**

1. `info.commentId` if supplied.
2. Otherwise `findCommentForEdit(docComments, info)` — the snippet-overlap heuristic over comments whose latest round is `sent`.

If no comment matches, nothing changes and `null` is returned.

**Idempotence guard** — if the latest round already has an entry with this `editId`, return the state unchanged (but still return the resolved id).

**Re-anchoring to the adopted text**, three sources in priority order:

1. **`newAnchor` + `replacement`** — verify `liveContent.slice(start, end) === replacement`. If the index drifted (e.g. a concurrent apply), rescue with `indexOf(replacement, max(0, start - 200))`, then fall back to a whole-document `indexOf`.
2. **No usable `newAnchor`** — run `findEditAnchor(liveContent, replacement)` (the exact → trimmed → whitespace-collapsed waterfall).
3. **Still nothing** — keep the existing anchor untouched, so a later `reanchorAll` can still recover.

The new `snippet` is always the authoritative `info.replacement` string, never a slice of the current document.

> **Why this matters.** After Apply, the original snippet no longer exists. If the round kept pointing at the old `(start, end)`, the next `reanchorAll` pass would relocate it via strategy 2/3/4 to a *much longer* span, producing a highlight that swallows the surrounding paragraph.

**Undo** — pushes a `'record-applied'` op capturing `before`, `after`, `roundId`, and `editId`, so undo removes exactly that one rationale entry without touching the rest of the round.

## 8. Prompt reconcilers

Three helpers in [`api/chat.ts`](../src/api/chat.ts) keep stored prompt overrides from going stale.

| Function | Behaviour |
|---|---|
| `isCurrentDefaultSystemMessage(text)` | `''` or exactly `DEFAULT_SYSTEM_MESSAGE.trim()` |
| `isStaleDefaultSystemMessage(text)` | A non-current default containing `/writing assistant/i` — i.e. a copy of an *older* built-in |
| `normalizeSystemMessage(text)` | `''`, current, or stale → `undefined`. Otherwise the trimmed string |
| `isCurrentRationaleRulesDefault(text)` / `isStaleRationaleRulesOverride(text)` / `normalizeRationaleRulesOverride(text)` | The same three-way shape against `PROPOSED_EDIT_RULES_DEFAULT`. The stale detector recognises three prior built-in eras by regex |
| `isCurrentRationaleRulesDefault` | Trim equality |

**Round-trip rule:** a textarea whose value still equals the built-in persists as `undefined`. That is why upgrading `DEFAULT_SYSTEM_MESSAGE` immediately affects users who never customised it — their stored value normalises away on the next save or rehydrate.

The Settings modal additionally clears a stale stored override **on open**, not only on save.

For the field-by-field interface and for every persisted type, see [Data types & glossary](16-glossary.md#2-domain-types).

## 9. Defaults

### 9.1 Provider defaults

```ts
initialProvider =
  VITE_DEFAULT_PROVIDER === 'openai'        ? 'openai'      :
  VITE_DEFAULT_PROVIDER === 'google-ai-mode'? 'google-ai-mode':
                                           'minimax'      // default, also for unknown values
```

`defaultApiConfig` = `{ provider: initialProvider, apiKey: '', apiEndpoint: VITE_DEFAULT_API_ENDPOINT || preset.defaultEndpoint, model: VITE_DEFAULT_MODEL || preset.defaultModel, systemMessage: undefined, temperature: 0.7, rationaleRulesOverride: undefined }`.

The env vars seed **defaults only**. The Settings modal always wins.

### 9.2 Starter documents

| Title | Shape |
|---|---|
| **Welcome** | H1 `# 👋 Welcome to ApEditor` plus **12** numbered `##` sections: Connect an AI · Write, Preview, Graph, or Split · Explore the Graph · Comment on a passage · Apply or Reject AI edits · Reference another document · Use a saved prompt · Get sentence suggestions while writing · Save a snapshot · Import text from photos or PDFs · Keep a copy outside the browser · Help, shortcuts, and settings. It is a live tutorial, not a changelog. |
| **Ideas** | H1 `# Ideas` plus three bullets: a lighthouse keeper who hears the sea, a field guide to imaginary birds, an essay on why we read in the bath. |

Both are created by `makeDoc(title, content)` with `uuid()` ids at store construction.

### 9.3 Seed prompts

| Id | Name | Body |
|---|---|---|
| `p-rewrite` | Improve writing | *Rewrite the selected text to be clearer and more concise. Preserve the meaning and tone.* |
| `p-summarize` | Summarize | *Summarize the selected text in 3-5 bullet points.* |
| `p-eli5` | Explain like I'm 5 | *Explain the selected text as if speaking to a 5-year-old. Use simple words and a short example.* |
| `p-continuation` | Continue writing | *Continue the document naturally from where the cursor/selection ends. Match the existing style and voice. Write 2-3 paragraphs.* |

User prompts get `uuid()` ids and are prepended; the seed ids are stable strings.

## 10. Adding a store field — the checklist

1. Add the field to `StoreState` in [`store/types.ts`](../src/store/types.ts) with its default documented.
2. Add the initial value in the store factory in [`store/store.ts`](../src/store/store.ts).
3. Add the action in `store.ts` (light) or `actions.ts` (comment-related), following the return-`s`-when-unchanged convention.
4. **If it should persist**, add it to `partialize`. Otherwise explicitly add a comment saying why it is ephemeral.
5. **If it needs a default on load**, add a repair step in `onRehydrateStorage` and number it in the table in this chapter.
6. Run `npm run typecheck`. Every call site surfaces immediately.

## 11. Next

- What writes to the store from the editor → [Editor & writing](05-editor-and-writing.md)
- The most stateful feature built on this store → [Comments](06-comments.md)
- Field-by-field type reference → [Data types & glossary](16-glossary.md)
# Data types & glossary

> Every persisted TypeScript interface, field by field, plus a glossary of the terms used throughout this document.

---

## 1. Where the types live

| File | Contents |
|---|---|
| [`src/types.ts`](../src/types.ts) | The domain types. Everything here is persisted. |
| [`src/store/types.ts`](../src/store/types.ts) | `StoreState` plus `EditorFocusState` and `ProposedEditHighlight` (both ephemeral). |
| [`src/utils/graph/buildWorkspaceGraph.ts`](../src/utils/graph/buildWorkspaceGraph.ts) | `GraphNode`, `GraphEdge`, `WorkspaceGraph`, and the `kind` unions. Not persisted. |
| [`src/utils/backup.ts`](../src/utils/backup.ts) | `DocumentBackup`. Serialised to disk on export. |
| [`src/docs/funcSpecCatalog.ts`](../src/docs/funcSpecCatalog.ts) | `FuncSpecPartMeta`, `FuncSpecPageMeta`. Not persisted. |

---

## 2. Domain types

### `Role`

```ts
type Role = 'system' | 'user' | 'assistant';
```

### `ChatMessage`

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `uuid()` |
| `role` | `Role` | |
| `content` | `string` | The visible text. `@` sentinels are stripped before this is set. |
| `selection` | `string?` | The editor highlight attached at send time |
| `selectionOnly` | `boolean?` | `true` when the turn omitted the document outline and sent only `selection` |
| `metadata` | `Record<string, unknown>?` | Provider-specific. Currently carries `cache_control` breakpoints. **`streamChatCompletion` does not forward it on its own** — it has to be deliberately read and routed. Kept generic so future fields ride along without a type change. |
| `createdAt` | `number` | `Date.now()` |

> Mentions are **not** stored on the message. They live in `ChatPanel` local state and are consumed at send time. Only *comment* mentions persist, on the round.

### `DocumentRecord`

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `uuid()` |
| `title` | `string` | Non-empty; blank input becomes `'Untitled'` |
| `content` | `string` | The entire document as one string |
| `createdAt` | `number` | |
| `updatedAt` | `number` | Bumped by `updateDocumentContent` |

### `Revision`

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `uuid()` |
| `documentId` | `string` | |
| `content` | `string` | A verbatim snapshot |
| `createdAt` | `number` | |
| `label` | `string?` | Optional. `r.label \|\| 'Snapshot'` at render. **The type comment says "auto-generated or user-supplied", but nothing auto-generates one today.** |

### `Prompt`

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `uuid()` for user prompts; stable strings for seeds |
| `name` | `string` | Blank input becomes `'Untitled prompt'` |
| `body` | `string` | May contain `{{selection}}` |
| `createdAt` | `number` | |

### `ProposedEdit`

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Model-chosen; the app only requires it to be a string |
| `summary` | `string` | One-line description shown on the card |
| `rationale` | `string?` | The Markdown explanation. Optional for backward compatibility with older replies; an empty string is treated the same as missing. |
| `original` | `string` | **Must** be a verbatim substring. No paraphrase. |
| `replacement` | `string` | The new text |

### `ProposedEditRationale`

An adopted edit, captured at Apply time so the rationale is tied to the **round** that produced it, not to the whole comment.

| Field | Type | Notes |
|---|---|---|
| `messageId` | `string` | The chat message that emitted the edit |
| `editId` | `string` | Matches `ProposedEdit.id` |
| `summary` | `string` | The AI's label for the change |
| `rationale` | `string` | Rendered verbatim as markdown in the comment popover |
| `original` | `string` | Kept so the popover can render a `+/−` preview without reading the live document |
| `replacement` | `string` | What was **actually** written — may differ from `ProposedEdit.replacement` for heading-stripped Best Effort applies |
| `appliedAt` | `number` | `Date.now()` at the moment Apply was clicked |

### `CommentRound`

One round of a comment. A round is born when the user attaches a comment, or when they re-comment on a passage after an AI edit was applied.

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `uuid()` |
| `start` | `number` | Inclusive offset into the document text for **this** round |
| `end` | `number` | Exclusive |
| `snippet` | `string` | Verbatim snapshot of the commented substring |
| `body` | `string` | The user's note. Plain text. |
| `createdAt` | `number` | |
| `updatedAt` | `number` | Bumped when the body or anchor changes |
| `outdated` | `boolean` | `true` when re-anchoring failed for this round |
| `sent` | `boolean` | `true` once this round's body has been included in a batch sent to the model |
| `applied` | `ProposedEditRationale[]` | 0 or 1 for most rounds; more if the user applied several edits from one batch |
| `mentions` | `MentionToken[]?` | `@` references for this round. Absent on rounds created before the feature shipped. |

### `Comment`

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `uuid()` |
| `documentId` | `string` | |
| `start`, `end` | `number` | **Mirrors** the latest round |
| `snippet` | `string` | Mirrors the latest round |
| `body` | `string` | Mirrors the latest round |
| `createdAt` | `number` | From **round 1** — never reset by appending a round |
| `updatedAt` | `number` | From the latest round |
| `outdated` | `boolean` | Mirrors the latest round |
| `sent` | `boolean` | Mirrors the latest round |
| `rounds` | `CommentRound[]` | Oldest first; the last entry is "current". Always at least one entry for a valid comment. |

> **Why the mirrors exist.** They let the many read sites — margin badges, the re-anchor pass, the batch formatter — keep reading the same field names. Every write goes through `withLatestRoundAnchor` or an action in `store/actions.ts`, which keeps both surfaces in step.

> **Ordering is canonical by document position**, not creation order. The comment margin re-numbers badges by document order on every render.

### `CommentOp`

The undo-stack entry. Session-only, capped at 20, FIFO.

| Variant | Payload | Undo |
|---|---|---|
| `add` | `comment` | Filter it out |
| `update-body` | `before`, `after` | Restore `before` |
| `append-round` | `before`, `after` | Restore `before` — drops the appended round |
| `record-applied` | `before`, `after`, `roundId`, `editId` | Restore `before` — removes exactly that one rationale entry |
| `delete` | `comment` | Append it back |

Each captures both `before` and `after` so undo is a clean apply/reverse rather than a reconstructed diff.

### `ApiProvider` and `KeyedApiProvider`

```ts
type ApiProvider = 'minimax' | 'openai' | 'google-ai-mode';
type KeyedApiProvider = Exclude<ApiProvider, 'google-ai-mode'>;
```

`minimax` and `openai` speak the OpenAI Chat Completions wire format, so the request layer does **not** branch on provider for them — the id is a UI/defaults concern. `google-ai-mode` does not speak that format and does not need a key; `ChatPanel` branches on it to open a new browser tab instead.

`requiresApiKey(id) => id !== 'google-ai-mode'` is the single source of truth.

### `ApiConfig`

| Field | Type | Default | Notes |
|---|---|---|---|
| `provider` | `ApiProvider` | `'minimax'` | |
| `apiKey` | `string` | `''` | Never seeded by env vars |
| `apiEndpoint` | `string` | `https://api.minimax.io/v1` | A full URL or a base URL; `/chat/completions` is appended when needed |
| `model` | `string` | `MiniMax-M2.7` | |
| `systemMessage` | `string?` | `undefined` | **`undefined` means "use the live built-in"**, not "empty" |
| `temperature` | `number` | `0.7` | |
| `rationaleRulesOverride` | `string?` | `undefined` | Same convention as `systemMessage` |

### `Theme`

```ts
type Theme = 'light' | 'dark';
```

Default `'light'`. Toggled by adding/removing the `dark` class on `<html>`.

### `MentionKind` and `MentionReason`

```ts
type MentionKind = 'doc' | 'doc-section';

type MentionReason =
  | 'context'      // general background reading (the default)
  | 'style'        // voice / tone match
  | 'facts'        // fact-check, reuse numbers or entities
  | 'terminology'  // consistent vocabulary / definitions
  | 'compare';     // ask the model to compare with this document
```

`MentionReason` exists so the prompt builder can emit a per-document focus hint and let the model prioritise relevant passages instead of re-reading everything.

### `MentionToken`

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `uuid()`. Also the React key and the sentinel id. |
| `kind` | `MentionKind` | |
| `documentId` | `string` | Lookup key in `useStore.documents` |
| `documentTitle` | `string` | Captured at insert time so a rename does not rewrite the chip |
| `paragraphIndexes` | `number[]` | 0-based. **Empty for `kind === 'doc'`.** Boundaries match `buildDocOutline` — one paragraph per `\n`. |
| `createdAt` | `number` | |
| `reason` | `MentionReason?` | Defaults to `'context'`. Round-trips through the sentinel. |
| `referrerId` | `string? \| null` | The `ChatMessage` or `Comment` that introduced it. Used to emit the per-comment `[comment → referenced docs]` map. `null` for legacy mentions, in which case the map is silently omitted. |

---

## 3. Store-only types

### `EditorFocusState` (ephemeral)

```ts
interface EditorFocusState {
  focused: boolean;
  selectionStart: number;   // -1 until the user has clicked/typed
  selectionEnd: number;     // -1 until the user has clicked/typed
}
```

Written by `Editor.tsx` on focus / blur / select / keyup. Read by `ProposedEditCard` to decide whether **Highlight Apply** is available.

### `ProposedEditHighlight` (ephemeral)

```ts
interface ProposedEditHighlight {
  cardKey: string;   // `${messageId}:${editId}` so cards don't clobber each other
  start: number;
  end: number;
}
```

A temporary editor highlight of a card's matched span. Cleared when the card unmounts or the anchor disappears.

---

## 4. Graph types

```ts
type GraphNodeKind = 'document' | 'heading' | 'term';
type GraphEdgeKind = 'heading' | '@' | 'wikilink';

interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;        // short on-canvas label
  fullLabel: string;    // hover text; differs for path-nested headings
  documentId: string | null;
  start: number | null;
  end: number | null;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: GraphEdgeKind;
}

interface WorkspaceGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
```

Node id formats:

| Constructor | Format |
|---|---|
| `documentNodeId(id)` | `doc:<id>` |
| `headingNodeId(documentId, start)` | `heading:<documentId>:<start>` |
| `headingPathNodeId(documentId, pathSlug)` | `heading-path:<documentId>:<slug>/<slug>` |
| `termNodeId(slug)` | `term:<slug>` |

Edge id: `${kind}:${source}->${target}`.

---

## 5. Backup type

```ts
const BACKUP_SCHEMA = 'apeditor-document-backup';
const BACKUP_VERSION = 1;

interface DocumentBackup {
  schema: 'apeditor-document-backup';
  version: 1;
  exportedAt: number;
  appVersion: string;         // VITE_APP_VERSION ?? 'unknown'
  document: DocumentRecord;
  comments: Comment[];        // [] when none — always present
  chats: ChatMessage[];       // [] when none
  revisions: Revision[];      // [] when none
}
```

Write-only as of v0.5.3. The `version` field exists so a future importer can detect and upgrade older payloads. Treat these files as sensitive.

---

## 6. Persisted shapes at a glance

| `localStorage` key | Shape |
|---|---|
| `apeditor` | `{ state: <partialized StoreState>, version: 0 }` — 20 keys, see [State & persistence §4.2](04-state-and-persistence.md#42-partialize) |
| `apeditor:onboarded` | `"1"` |
| `apeditor:chat-messages-height` | number; `0` means "use the 60% default" |
| `apeditor:suggestion-height` | number, `80`–`600` |
| `apeditor:settings-modal-size` | `{ w, h }` — `{ width, height }` also accepted on read |
| `apeditor:settings-system-msg-size` | `{ w: 0, h }` — only `h` is read |
| `apeditor:settings-rationale-rules-size` | `{ w: 0, h }` — only `h` is read |
| `apeditor:popover-size:<commentId>` | `{ width, height }` |
| `apeditor:pe-split:<messageId>:<editId>:split` | number, `20`–`80` |
| `sessionStorage['apeditor:session-api-key']` | the API key, when `persistApiKey` is `false` |
| `sessionStorage['apeditor:cm-z-hint']` | one-shot toast flag |

---

## 7. Glossary

| Term | Meaning |
|---|---|
| **Anchor** | The `(start, end)` offset pair plus the `snippet` text that locates a comment in a document |
| **Re-anchor** | Locating a comment's passage again after the document changed, via four strategies |
| **Outdated** | The state of a comment whose passage could no longer be found. Sticky until re-attached, edited, or deleted |
| **Round** | One iteration of a comment's life. Editing a **sent** comment starts a new round, preserving what the model was answering |
| **Mirrors** | The top-level `Comment` fields that duplicate the latest round's values so legacy call sites keep working |
| **Proposal / proposed edit** | A single `proposed-edit` fence the model emitted. Never written to the document until the user applies it |
| **Fence** | A ```` ```proposed-edit ```` code block in the model's reply carrying one `ProposedEdit` |
| **Exact match** | Applying an edit when `findEditAnchor` locates `original` byte-for-byte |
| **Best Effort** | Applying an edit after expanding and preparing a fuzzy match, gated on ≥85% coverage and a duplication check |
| **Highlight Apply** | Applying an edit over the user's current selection, ignoring the model's quote entirely |
| **Waterfall** | The Exact → Best Effort → Highlight Apply decision chain |
| **Duplication block** | Refusing a splice that would print the surrounding text twice |
| **Comment batch** | Sending every comment on a document as one chat turn |
| **Outline** | A compact per-paragraph map of the document: `[pN]@offset: <first 60 chars>`. The default context instead of the full document |
| **Selection only** | A chat mode that omits the outline and sends only the highlighted passage |
| **Selection only / include selection** | Two independent store flags; enabling selection-only force-enables include-selection |
| **Mention / `@`-reference** | Another document, or a section of one, attached to a chat turn, comment, or rejection |
| **Sentinel** | The zero-width-space-wrapped `[[mention:…]]` string serialised into the textarea |
| **ZWSP** | Zero-width space, `U+200B`. Structural anchor of a mention sentinel and of the visible caption |
| **Cascade** | Ticking a heading section also ticking every descendant section |
| **Document outline budget** | `4000` chars per referenced document, `8000` per turn, after which references downgrade to outlines |
| **Atom layout** | Laying the current document out at the origin as a nucleus and placing every other document relative to it |
| **Nucleus** | The current document's node in the graph. Pinned during relaxation. |
| **Shell / ring** | A radial depth band in the graph layout. Shell 0 is the nucleus ring |
| **Camera** | The graph's zoom + viewBox model. Zoom clamps to `[0.5, 4]` |
| **Stage** | Which match a proposed edit will use: Exact, Best Effort, or blocked |
| **Rationale** | The AI's Markdown explanation of a change, stored on the round that caused it |
| **Epoch** | A remount key. `graphEpoch` clears the graph's drag overrides by rebuilding the component |
| **Mirror** | The `aria-hidden` overlay behind the textarea that paints highlights and hosts the selection `Range` |
| **Event bus** | The `mvp:*` `window` CustomEvents that decouple `Editor.tsx` and `ChatPanel.tsx` |
| **Gated state** | A UI element that is visible but disabled, with a tooltip explaining what is missing |
| **Transient / ephemeral** | Store state that is deliberately not persisted — `editorFocus`, `proposedEditHighlights`, `commentUndoStack` |
| **Reconcile** | Collapsing a stale stored prompt back to `undefined` so the live built-in applies |

## 8. Next

- Back to the index → [Functional Specification](README.md)
- Recipes and invariants → [Maintenance guide](15-maintenance-guide.md)
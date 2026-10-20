# Comments

> The most stateful feature in ApEditor. A comment is an anchor into a mutable document, a conversation with the model across multiple rounds, and a place to store the AI's reasoning. This chapter covers all three.

---

## 1. The data model

```ts
interface Comment {
  id: string;
  documentId: string;
  start: number;        // mirrors the latest round
  end: number;          // mirrors the latest round
  snippet: string;      // mirrors the latest round — verbatim snapshot
  body: string;         // mirrors the latest round
  createdAt: number;    // from round 1
  updatedAt: number;    // from the latest round
  outdated: boolean;    // mirrors the latest round
  sent: boolean;        // mirrors the latest round
  rounds: CommentRound[];  // oldest first; last entry is "current"
}

interface CommentRound {
  id: string;
  start: number;
  end: number;
  snippet: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  outdated: boolean;
  sent: boolean;
  applied: ProposedEditRationale[];   // 0..n per round
  mentions?: MentionToken[];          // @-references for this round
}
```

### Why the mirrors exist

The top-level `start` / `end` / `snippet` / `body` / `outdated` / `sent` fields are **convenience mirrors of the latest round**. They exist so the many read sites — margin badges, the re-anchor pass, the batch formatter — can keep reading the same field names they always have. Every write goes through `withLatestRoundAnchor` or an action in [`store/actions.ts`](../src/store/actions.ts), which keeps both surfaces in step.

> **One asymmetry to know about:** `withLatestRoundAnchor` mirrors `outdated` onto both surfaces, but the terminal "give up" branch of `reanchorComment` returns `{ ...comment, outdated: true }` **without** updating `rounds[last].outdated`. The popover header and margin badge read the top-level flag; `RationaleSection` reads the round. They can disagree on a comment that has fully lost its anchor.

### Two anchor surfaces

| Surface | Strength | Weakness |
|---|---|---|
| `(start, end)` offsets | Exact and cheap | Drifts the moment anything before the anchor changes |
| `snippet` text | Survives edits | Ambiguous if the same text appears twice |

Re-anchoring tries the offsets first and falls back to the text. Full algorithm below.

## 2. Lifecycle

### 2.1 Create

`addComment` (see [Runtime flows §3](03-runtime-flows.md#3-comment-a-passage)). The editor always seeds `rounds: [ … ]`; `addCommentAction` additionally runs `ensureRoundsShape` defensively for older callers.

### 2.2 Edit

`updateCommentBody(id, body, mentions?)` decides between two behaviours:

| Latest round `sent` | Behaviour | `CommentOp` |
|---|---|---|
| `false` | Update the round **in place**: `{ ...lastRound, body, updatedAt }`. Mentions are set, or `delete updatedRound.mentions` when there are none. | `'update-body'` |
| `true` | **Append a new round**: fresh `uuid()`, `sent: false`, `applied: []`, anchor copied from the previous round. Top-level mirrors point at it. | `'append-round'` |

Guard: if `body.trim() === lastRound.body.trim()` **and** the comma-joined mention id sets are equal, return the state unchanged.

**Why.** Overwriting a sent round would erase the record of what the AI was actually answering and would orphan already-applied rationales under the wrong round. Editing a sent comment therefore starts Round 2. The Welcome document explains this to users as: *"Editing the body after a send starts a new round (history is preserved)."*

`appendCommentRound` is the explicit variant: it builds a brand-new round but preserves `createdAt` from `rounds[0]`, so the comment's creation time never resets.

### 2.3 Delete and dismiss

| Action | Behaviour |
|---|---|
| `deleteComment(id)` | Removes; pushes `'delete'`. Sent comments remain deletable. |
| `dismissOutdatedComments(documentId)` | Removes every `outdated` comment; pushes **one undo op per removal** and returns the count. So sweeping 10 stale comments costs 10 ⌘Z presses. |

### 2.4 Mark sent

`markCommentsSent(ids)` flips the **latest** round's `sent` and the top-level mirror. It returns the state unchanged when nothing changed, and it **does not push an undo op** — sending is not an edit the user made to their comment.

Only the latest round is flipped on purpose: a follow-up round starts with `sent: false` and must be flippable on the next **Send to AI**.

## 3. Re-anchoring

The core problem: a comment is anchored to `(start, end)` offsets, but the document is edited constantly. Every content or comment change, the editor schedules a **150 ms debounce** that runs `reanchorAll`.

### 3.1 `reanchorComment(doc, comment)`

**Step 0 — terminal short-circuit.** If `comment.outdated` is already `true`, return it unchanged. Once outdated, automatic recovery never runs again; only `reattachComment`, an edit, or a delete clears the flag.

**Target selection.** The snippet to search for is:

```ts
const lastApplied = comment.rounds[rounds.length - 1].applied[rounds.length - 1];
const targetSnippet =
  lastApplied?.replacement?.length > 0 ? lastApplied.replacement : comment.snippet;
```

After an AI Apply, the search target is the **adopted replacement**, not the now-deleted original.

**Empty-target guard.** If the target is empty, return `{ ...comment, outdated: true }`.

Then four strategies, in order:

| # | Strategy | Detail |
|---|---|---|
| 1 | **Offset-preserving** | Clamp `start` / `end` into `doc`. If `doc.slice(safeStart, safeEnd) === targetSnippet`, done — return the comment unchanged if `snippet === targetSnippet`, otherwise re-anchor with the corrected snippet. |
| 2 | **Local ±200** | Search `doc.slice(max(0, start-200), min(len, end+200))` for the target. The narrow window keeps the match near the original position when the passage merely shifted. |
| 3 | **Whole-document fuzzy** | `findEditAnchor(doc, targetSnippet)` — the exact → trimmed → whitespace-collapsed → setext → ATX → markdown-escape waterfall from [`proposedEdit.ts`](../src/utils/proposedEdit.ts). On a hit, re-anchor but **keep `targetSnippet`** as the snippet rather than a fuzzy-expanded slice. |
| 4 | **Head/tail fallback** | `head = target.slice(0, 30)`, `tail = target.slice(-30)`. Requires `head && tail && head !== tail`. Find `headIdx`, then `tailIdx = indexOf(tail, headIdx + head.length)` to force ordering. Accepted only when `headIdx < newEnd`. |

**Strategy 4 is deliberately skipped when the target is an applied replacement.** Expanding by head/tail across a replacement produced oversized highlights that no longer matched the proposed text.

Otherwise: `{ ...comment, outdated: true }`.

### 3.2 `reanchorAll(doc, comments)`

Pure. Runs `reanchorComment` per comment and collects `changed` entries by **reference inequality** (`r !== c`).

The driver in `Editor.tsx` then does a strict field-equality check across `start`, `end`, `outdated`, and `snippet` for every comment, and calls `replaceCommentsForDocument` **only if something actually changed**. Typing outside comment ranges therefore does not churn the store.

`replaceCommentsForDocument` deliberately pushes **no undo op** — it runs on every keystroke burst and would otherwise fill the 20-entry stack with noise.

### 3.3 `reattachCommentToRange(content, comment, start, end)`

The manual escape hatch. Returns `null` when `start < 0`, `end <= start`, `end > content.length`, `start > content.length`, or the slice is empty. Otherwise re-anchors with `outdated: false`.

The store's `reattachComment(id, range)` wraps it and returns `boolean`, pushing a `'update-body'` undo op on success.

### 3.4 `isCommentStale(comment, content)`

A lighter predicate mirroring strategies 1 and 3 only (strategy 4 is excluded to avoid false positives). It is exported but currently has **no consumer** in the app — it is available if you add a pre-flight validation UI.

## 4. Outdated comments and recovery

A badge whose anchor could not be re-found flips to **Outdated**:

- The badge gets an `--outdated` modifier class.
- The popover shows a `role="alert"` banner and the header becomes `Outdated — anchor needs attention`.
- `CommentTray` grows a collapsed `N stale comments — Re-link or Dismiss` list.

### Recovery paths

| Path | Trigger | Behaviour |
|---|---|---|
| **Re-attach** | The popover, when `comment.outdated` and the editor has a selection | `reattachComment(id, selection)` |
| **Re-link** | The tray's per-row button | Opens [`ReanchorPicker.tsx`](../src/components/ReanchorPicker.tsx) |
| **Dismiss** | The tray's per-row button | `deleteComment(id)` — undoable with ⌘Z |
| **Dismiss outdated** | The tray's header action | `dismissOutdatedComments` — one undo op per comment |

### `ReanchorPicker`

Purely presentational: no store access, no events.

- If the document has heading sections, one row per heading — `key = h-${i}-${s.start}`, `level = s.level`, `title = s.title || '(untitled heading)'`, `preview = docContent.slice(s.start, s.end).slice(0, 120)`.
- Otherwise one row per blank-line paragraph — `key = p-${i}`, `title = 'Paragraph ' + (i+1)`, `level: 0`.
- `position: fixed` at the viewport `anchor`, `minWidth: 320`, `maxHeight` default `360`. Reuses the `.mention-popover` styles.
- Keyboard is bound to `window` in the **capture** phase: `ArrowDown` / `ArrowUp` move, `Enter` confirms with `{ start, end, label }`, `Escape` cancels.
- Because the capture listener runs before the composer/popover Escape handlers, `Enter` / `Escape` pre-empt them **while the picker is open**. The editor closes the picker on confirm or cancel, so this is normally invisible.

## 5. Rendering

### 5.1 `CommentLayer` — the highlight mirror

`memo(forwardRef<HTMLDivElement>)`. Renders `aria-hidden` alternating `<span>` / `<mark>` children built from the content and the merged comment + proposed-edit highlight list.

The merge is event-based:

1. Build `Event[]` of `{ at, type: 'start' | 'end', id, outdated?, proposed? }`. Extra (proposed-edit) highlights get synthetic ids `` `pe-extra-${i}` ``.
2. Sort by `a.at - b.at || (a.type === 'end' ? -1 : 1)` — **ends sort before starts at the same offset**, so adjacent comments do not overlap by one character.
3. Walk with an `openStack`, emitting a `mark` segment up to the next event offset.
4. Drop zero-length and out-of-bounds ranges.
5. `commentId` is taken from the first **non-proposed** open event, so a range covered only by a proposed-edit highlight renders a `<mark>` with no `data-comment-id`.

> The card's `cardKey` (`${messageId}:${editId}`) never reaches the mirror — it is replaced by the synthetic `pe-extra-${i}` id during the merge.

### 5.2 `CommentMargin` — the badges

- Re-sorts by `a.start - b.start` in a `useMemo`, so **badge numbers follow document order, not creation order**.
- Skips any comment missing from `badgePositions` (it has not been measured yet this render).
- Renders `.cm-margin__badge-rationale` when any round has `applied.length > 0`.
- `aria-label` = `Comment ${i+1}: ${body.slice(0,30)}` plus `(anchor needs attention)` or `(has rationale)`.
- Both `onClick` and `onPointerUp` call `onSelect`, and `onPointerUp` calls `preventDefault()` to stop the textarea blurring. That means a single tap fires the callback twice — idempotent, but a real double invocation.

### 5.3 `CommentComposer` — creating a comment

Props: `initialBody`, `initialMentions`, `position`, `onSave(body, mentions)`, `onCancel`, `bottomSheet`, `containerBounds`.

- Wraps a `MentionInput`, so `@` references work in a new comment.
- Shows a live `{body.length}/{COMMENT_SOFT_CAP}` counter and a `— long comment` hint above the soft cap.
- **Save** is disabled unless `body.trim().length > 0`.
- Positions its top-right at the selection's top-right, then clamps with `clampToContainer`. Measured with a `useLayoutEffect` + `ResizeObserver`; `boxSize` starts at `{ width: 320, height: 200 }`.
- No CSS transform is used — the box is positioned at top-left directly.

> Known duplication: the Escape-cancel effect is registered **twice** (a verbatim copy-paste). Both listeners call `onCancel()`, so behaviour is correct, but it is a maintenance trap.

### 5.4 `CommentPopover` — reading and editing

Props include `comment`, `index`, `position`, `onSaveBody`, `onDelete`, `onReattach`, `canReattach`, `onClose`, `bottomSheet`, `containerBounds`.

| Region | Contents |
|---|---|
| Header | Index, title (`Outdated — anchor needs attention` / `Sent to AI` / `Comment`), close `×` |
| Alert | Outdated banner (`role="alert"`) when applicable |
| Body | Edit mode → `MentionInput` + counter. Read mode → `CommentBodyWithChips`, which renders `@` references as clickable pills that switch the editor to the referenced document |
| Rationale | `RationaleSection` → one `RoundRationale` per round. The latest is expanded; older ones collapse. `+` / `−` toggles |
| Footer | Read mode → `Delete`, `Re-attach` (only when `outdated && onReattach`, `disabled={!canReattach}`), `Edit`. Edit mode → `Cancel`, `Save` |

- **Save gating:** `canSave = trimmed.length > 0 || draftMentions.length > 0` — a body consisting only of `@` references is valid.
- **Escape:** in edit mode it exits edit and resets the draft from the comment; otherwise it closes.
- **Resize:** 8 handles, suppressed entirely in `bottomSheet` mode. Size persists to `apeditor:popover-size:<commentId>`; `loadPopoverSize` rejects payloads outside the popover bounds and accepts both `{w,h}` and the older `{width,height}` shape.
- `RationaleEntry` renders a compact diff: `lineDiff(entry.original, entry.replacement)` filtered to at most 2 removes then 2 adds, with `+` / `−` markers, `aria-hidden`.

### 5.5 `CommentTray` — Send to AI

Renders `null` when there are no comments.

- **Header row** — `"N comments"`, or `"N of M comments ready (K outdated)"` when some are stale. Optional bulk **Dismiss outdated**.
- **Send to AI** — `disabled` while `sending` or when `sendableCount === 0`; the label becomes `Sending…` while `mvp:chat-streaming` is true.
- **Stale list** — a collapsible `▸ / ▾` toggle with `aria-controls="cm-stale-list"`, a nested `Dismiss all` span with Enter/Space handling, then one `<li>` per outdated comment showing its index, a quoted snippet truncated to 60 characters, and **Re-link** / **Dismiss** buttons.

`hasPerRowControls` is true whenever `onDismissOne`, `onReanchor`, and the `outdatedComments` array are all supplied.

## 6. Undo

`CommentOp` is a five-variant union, each capturing `before` and `after` so undo is a clean apply/reverse rather than a reconstructed diff.

```ts
type CommentOp =
  | { kind: 'add'; comment: Comment }
  | { kind: 'update-body'; before: Comment; after: Comment }
  | { kind: 'append-round'; before: Comment; after: Comment }
  | { kind: 'record-applied'; before: Comment; after: Comment; roundId: string; editId: string }
  | { kind: 'delete'; comment: Comment };
```

| Op | Undo |
|---|---|
| `add` | Filter the comment out |
| `delete` | Append it back to the end of the array (the UI sorts by position, so appending is fine) |
| `update-body` / `append-round` | `replaceComment(comments, before.id, before)` — for `append-round` this drops the new round |
| `record-applied` | Restore `before` — removes exactly that one rationale entry |

### The ⌘Z handler

`Editor.tsx` binds ⌘/Ctrl+Z and returns early unless `document.activeElement === textareaRef.current`.

**Critical ordering:** it returns **before** calling `preventDefault()` when there is nothing to undo. That lets the browser's native textarea undo run normally. If you refactor this handler, preserve that ordering or plain-text undo breaks.

When an undo does happen, the toast label is derived coarsely: anything that is not `add` or `delete` renders as `Comment edit undone`. The toast is one-shot, gated on `sessionStorage['apeditor:cm-z-hint']`, and clears after 4 seconds.

The stack is capped at `COMMENT_UNDO_STACK_LIMIT = 20` (FIFO) and is **session-only** — a reload starts empty by design.

## 7. Send to AI

`Editor.handleSendToAi()`:

1. Filters `!c.outdated`.
2. Fills in missing mention fields: `referrerId: m.referrerId ?? c.id`, `reason: m.reason ?? 'context'`.
3. Dispatches `mvp:send-comments` with `{ commentIds, mentionsByCommentId }`.

`ChatPanel.onSendComments`:

1. Guards on `streaming`, the current document, and a non-empty list; re-filters `outdated` **again** (the two sides read different snapshots, so the guard is belt-and-braces).
2. Merges mentions — event payload first, else `c.rounds[c.rounds.length - 1].mentions` — deduping by `id`.
3. `body = formatCommentBatch(doc.content, comments)`.
4. `appendMessage`, then `markCommentsSent`, then dispatches `mvp:mark-comments-sent` so the editor can close any open popover for a sent comment.
5. Builds the request with `mentionsByCommentId` passed through, which is what enables the `[comment → referenced docs]` cross-reference map.

### `formatCommentBatch(doc, comments)`

Sorts by `start`. Precomputes paragraph starts by splitting on `\n` — **single newlines count as paragraph breaks**. Six lines per comment:

```
[cN] (paragraph <p+1>/<total>, doc offset <start>–<end>)
"<snippet>"
Before: """<up to 120 chars, trimmed to the first space>"""
After: """<up to 120 chars, trimmed to the last space>"""
Comment: <body>

```

Blocks joined with `'\n'`, `trimEnd()`, plus a trailing `'\n'`.

> **Coupled to `api/chat.ts`.** `looksLikeCommentBatch` matches this exact shape with `/\[c\d+\] \(paragraph\b[\s\S]*?Comment:/`. The comment-batch system message in `buildRequestMessages` also documents the same field labels. Three places must agree.

## 8. Applied rationales

When an AI edit is applied, `recordAppliedEdit` stores a `ProposedEditRationale` on the round that was current when the AI answered:

```ts
interface ProposedEditRationale {
  messageId: string;   // the chat message that emitted the edit
  editId: string;      // matches ProposedEdit.id
  summary: string;
  rationale: string;   // the model's Markdown
  original: string;
  replacement: string; // what was actually written
  appliedAt: number;
}
```

The diff fields are kept so the popover can render a `+` / `−` preview without reading the live document.

The full algorithm — comment resolution, idempotence, and the three-source re-anchoring — is in [State & persistence §7](04-state-and-persistence.md#7-recordappliededit).

Which comment an edit belongs to is **inferred** when the caller does not supply `commentId`: `findCommentForEdit` considers only comments whose latest round is `sent`, scores each by `snippetOverlapScore(lastRound.snippet, edit.original)` — a longest-common-substring match requiring **at least 12 shared characters** — and picks the best score above zero.

## 9. Invariants and gotchas

| # | Invariant |
|---|---|
| 1 | `outdated` is **sticky**. `reanchorComment` returns unchanged when already outdated. Only `reattachComment`, an edit, or a delete clears it. |
| 2 | Strategy 4 (head/tail) is suppressed for applied replacements on purpose. A comment whose AI replacement was applied and later moved far may therefore go straight to `outdated`. |
| 3 | The terminal `outdated` branch does not mirror into `rounds[last].outdated`. |
| 4 | `replaceCommentsForDocument` must never push an undo op — it runs on a 150 ms debounce after every edit. |
| 5 | `dismissOutdatedComments` pushes one undo op **per** comment. |
| 6 | ⌘Z must return before `preventDefault()` when the stack is empty, or native textarea undo breaks. |
| 7 | The auto-reanchor effect depends on `[doc?.id, viewMode]`. Dropping `viewMode` leaves the scroll-sync listener bound to a detached textarea after a mode switch. |
| 8 | `hasRationale` reads `r.applied.length` with no `Array.isArray` guard. A round missing `applied` throws. `ensureRoundsShape` is what prevents this. |
| 9 | `CommentMargin` invokes `onSelect` twice per tap (`onPointerUp` then `onClick`). Idempotent, but do not add side effects to the handler. |
| 10 | `CommentComposer` registers its Escape effect twice. |

## 10. Next

- Where comments are stored → [State & persistence](04-state-and-persistence.md)
- What happens after Send to AI → [AI chat & prompts](07-ai-chat.md)
- Applying the returned edits → [Proposed edits](08-proposed-edits.md)
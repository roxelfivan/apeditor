# Proposed edits

> The model never writes the document. It emits fenced proposals; ApEditor parses them, decides which ones it can apply safely, and lets you accept or reject each one — with the reasoning attached to the comment that caused it.

---

## 1. The contract

```ts
interface ProposedEdit {
  id: string;
  summary: string;
  rationale?: string;   // defaults to ''
  original: string;     // MUST be a verbatim substring of the document
  replacement: string;  // the new text
}
```

The model emits one ```` ```proposed-edit ```` fence per change. The schema is **always** sent in the `sys-proposed-edit-rules` system message and cannot be overridden. Only the *rationale formatting* is user-overridable. See [AI chat & prompts §4.5](07-ai-chat.md#45-sys-proposed-edit-rules-the-fence-schema).

## 2. Parsing

### `parseProposedEdits(content)`

Returns `ProposedEditSegment[]` where a segment is either plain text or an edit.

```
/```([^\n`]*)\n([\s\S]*?)(?:```|$)/g
```

- The regex tolerates an **unterminated** trailing fence (`(?:```|$)`), so a truncated stream still parses.
- A fence becomes an `edit` segment only when `infoString.trim() === 'proposed-edit'` **and** `tryParseEdit(body)` succeeds.
- Everything else — other info strings, malformed bodies — stays a `text` segment so the reply remains readable.

### `tryParseEdit(body)`

`JSON.parse(body)` then requires `id`, `summary`, `original`, and `replacement` to all be `string`. `rationale` is optional and defaults to `''`.

Both `original` and `replacement` are post-processed:

```ts
strip = (s) => stripParagraphReferences(parseMentionsFromSentinels(s).plain)
```

`stripParagraphReferences` collapses model-echoed `[p10]@354` markers (and bare `@<digits>` when the brackets were dropped) and re-collapses whitespace. Models routinely echo the outline format back inside `original`, and without this the exact match fails.

### `tryParseEditLenient(body)`

The rescue path for malformed JSON. `extractJsonString` walks the body tolerantly, allowing a literal `"` inside a value by scanning ahead for the next `,` or `}` — so a model can write `"Higher or Equal"` unescaped and still be parsed.

### `rescueRawJsonEdits(segments)`

A final pass over `text` segments looking for bare `ProposedEdit`-shaped JSON that was never fenced. Used when a model forgets the fence but still emits the object.

## 3. `findEditAnchor(content, original)`

The exact-match waterfall. Returns `{ idx, length }` or `null`.

| # | Strategy | Detail |
|---:|---|---|
| 0 | Guard | `null` if either input is empty |
| 1 | **Exact** | `content.indexOf(original)` |
| 2 | **Trimmed** | `content.indexOf(original.trim())` when it differs |
| 3 | **Whitespace-collapsed regex** | `original.replace(/\s+/g, ' ').trim()`, regex-escaped, spaces replaced with `\s+` |
| 4 | **Setext heading** | Matches `^([^\n]+)\n[=-]{2,}\n`. If `titleOnly` is in `content`, locate it, then try to extend the span to the first non-empty body line found after the heading |
| 5 | **ATX prefix strip** | `original.match(/^#{1,6}\s+/)` — search for the remainder, then for the trimmed remainder |
| 6 | **Markdown-escape normalisation** | Only when `original` contains any of ``[\\`*_{}\[\]()#+\-.!|>~]``. Builds a per-char regex where each markdown-significant character becomes `\\?X`, so the document may carry an optional leading backslash. Flagged `s` so `.` matches newlines |

Strategies 4–6 exist because models normalise headings and escapes when quoting. They are ordered from cheapest to most permissive.

## 4. The Apply waterfall

```
Apply
  ├─ Exact match?                     → apply, label "exact"
  ├─ Best Effort match, no duplication? → apply, label "best effort"
  └─ otherwise                        → blocked; the card points at Highlight Apply
```

The user presses **one** Apply button. The card never offers separate Exact and Best Effort buttons.

### 4.1 Best Effort entry conditions

`findBestEffortAnchor(content, original, replacement)` returns `null` immediately when:

| Condition | Value |
|---|---|
| `content.length > MAX_BEST_EFFORT_DOC_BYTES` | `100 * 1024` = `102400` |
| `original.length < 30` | — |
| `!content \|\| !original` | — |

### 4.2 Substring path

`findLongestSubstringAnchor`:

- `SUBSTRING_MIN_LEN = 40`, `maxLen = min(original.length, 500)`.
- Binary search the longest slice length between `40` and `maxLen`.
- For each candidate length, scan `original` offsets where `i === 0` or the previous character is whitespace — **no mid-word matches**.
- The first hit wins; `confidence = min(1, length / original.length)`.

If `confidence >= 0.25`, the anchor is finalised.

### 4.3 Token sweep

If the substring path fails, a fuzzy token match runs:

- `origTokens = tokenizeForBestEffort(original)` — split on `/\s+/`.
- `contentTokens` from `/\S+/g`.
- `n = origTokens.length`; `maxSkip = max(2, floor(n * 0.5))`; `LOOKAHEAD = min(8, max(5, floor(n * 0.25)))`; `maxMatchedTokens = ceil(n * 1.5)`.
- `normalizeToken` lowercases and strips leading/trailing markdown wrappers `[*_`~#><()[]{}"'“”‘’.,;:!?]`.
- `isNearToken` allows exact normalised equality, or **one character of difference** when both tokens are within 8 characters of each other.
- **A 12 ms wall-clock deadline** (`performance.now() + 12`). The sweep gives up rather than janking the UI.
- Accepted at `confidence >= BEST_EFFORT_MIN_CONFIDENCE = 0.4`.

### 4.4 Expansion to a form-safe range

`expandBestEffortRange(content, original, anchor)` widens the hole:

1. Try the exact prefix and suffix around the matched chunk. When `original` and `replacement` **both start with the same heading**, chop the heading out of the prefix so it is not printed twice.
2. If still `length < original.length * 0.85`, snap to the next markdown heading boundary (`^#{1,level}\s` searched from `headingEnd`, skipping the heading line itself). A section is accepted when `secLen >= 8 && secLen <= original.length * 2.2`.
3. Final fallback: `expandToBlockBoundaries` — walk back to the previous blank line or preceding heading, forward to the next blank line or next heading.

### 4.5 Preparing the replacement

`prepareBestEffortReplace(content, replacement, anchor)` grows the hole so the splice is form-safe:

1. **Grow right** into adjacent identical prefixes, then **grow left** into identical suffixes — but refuse to re-absorb an ATX heading that `replacement` will re-emit (`maxK` runs from `min(content.length - end, text.length, 200)` down to `>= 8`).
2. Absorb residual original text on the same paragraph by extending to the next `\n`.
3. If still `end - start < replBodyLen * 0.85`, expand to block boundaries again.
4. Strip a leading ATX heading from both the hole and the inserted text when `firstLine === replHead`.
5. Run the final duplication check. **Return `null` if it trips.**

The return is `{ idx, length, text }`, where `text` may be the heading-stripped variant of `replacement`.

### 4.6 Coverage gate

```ts
const BEST_EFFORT_COVERAGE_MIN = 0.85;
```

`finaliseBestEffortAnchor` accepts when coverage `>= 0.85`, **or** when the expansion was a `sectionSnap`. Coverage is computed against `original.length`, or against `original` with the heading stripped.

### 4.7 When a splice is blocked

`checkReplacementDuplication(content, anchor, replacement)` blocks when:

- A contentful **2- or 3-gram** appears in both the leading context (≤60 chars before) and the trailing context (≤100 chars after) of the matched span. A `STOPWORDS` set filters 1-grams so common words do not cause false positives.
- The replacement's **first two contentful words** match the first two contentful words of the trailing context. Cause string: `The start of the replacement ("X Y") already begins the text after the matched passage — applying would duplicate it`.

A blocked edit is **not silently dropped**. The card shows the matched passage and points the user at **Highlight Apply**.

### 4.8 `applyAllEdits(content, edits)`

Runs the waterfall per edit against a running accumulator, so a later edit sees the result of an earlier one.

```
acc = content; appliedAnchors = []
for edit of edits:
    exact = findEditAnchor(acc, edit.original)
    if exact:                splice edit.replacement;  record anchor
    else:
        be = findBestEffortAnchor(acc, edit.original, edit.replacement)
        if !be or be.duplicationReason:  continue        // skipped
        prepared = prepareBestEffortReplace(acc, edit.replacement, { idx: be.idx, length: be.length })
        if !prepared:           continue                 // skipped
        splice prepared.text over prepared span;  record anchor with replacement: prepared.text
```

Skipped edits are surfaced to the user by the caller as `Applied X of Y changes (Z skipped — not anchored). Use Highlight Apply on those cards.`

### 4.9 `applyEditAtCaret(content, replacement, caret)`

Highlight Apply. No anchor lookup at all.

Rejects with `{ ok: false, reason: 'caret-missing' }` when `selectionStart` / `selectionEnd` are not numbers, are `NaN`, are negative, exceed `content.length`, or `selectionStart > selectionEnd`. Otherwise returns `{ ok: true, next, replaced: selectionStart !== selectionEnd }` — replacing the selection, or inserting at the caret.

## 5. `ProposedEditCard`

Props:

```ts
interface Props {
  edit: ProposedEdit;
  docId: string;
  messageId: string;
  staged?: boolean;
  committed?: boolean;
  onStageReject?: (info: { editId: string; comment: string; mentions: MentionToken[] }) => void;
}
```

Internal status:

```ts
type CardStatus =
  | { kind: 'idle' }
  | { kind: 'applied' }
  | { kind: 'best-effort-applied' }
  | { kind: 'rejected' }     // card hides itself
  | { kind: 'committed' };   // card hides itself
```

### Actions

| Action | Behaviour |
|---|---|
| **Apply** | If `anchorInfo.found` → `applyEdit` and status `applied`. Else if `bestEffortAnchor && !duplicationReason` → `prepareBestEffortReplace`, status `best-effort-applied`, and record the confidence. If `applyEdit` returns `{ ok: false }` (a race), the status resets to `idle`. |
| **Highlight Apply** | Only rendered when the editor has a selection. Refuses when `liveDocId !== docId`. Calls `applyEditAtCaret`, records the applied edit with an exact `newAnchor`, dispatches `mvp:select-range`, and sets status `applied`. |
| **Reject** | `setStatus({ kind: 'rejected' })`. No chat message, no store write. |
| **Reject with feedback** | If the textarea is empty and there are no mentions, it degrades to a plain Reject. Otherwise calls `onStageReject` and the card enters a `staged` outline. |

Every apply path funnels through `performReplace(anchor)`:

```ts
useStore.getState().updateDocumentContent(doc.id, next);
useStore.getState().recordAppliedEdit({ …, newAnchor: { start, end } });
window.dispatchEvent(new CustomEvent('mvp:select-range', { detail: { start, end } }));
```

### Anchor detection and the deferred Best Effort probe

`findEditAnchor` runs synchronously in a `useMemo` — it is cheap. It also re-runs against `content.slice(anchor.idx + anchor.length)` to set a `multiple` flag; when true, the Apply tooltip reads `Exact match (multiple found; the first will be replaced)`.

`findBestEffortAnchor` is **deferred** via `requestIdleCallback({ timeout: 200 })` with a `setTimeout(0)` fallback, and cancelled on unmount. `canApply = anchorInfo.found || bestEffortUsable`.

### Editor highlight

A `useEffect` writes the matched span to the store via `setProposedEditHighlight(docId, cardKey, { start, end })`, where `cardKey = \`${messageId}:${edit.id}\``. It clears on `applied`, `best-effort-applied`, `rejected`, `committed`, and on unmount — so you can see where Apply would land before you click.

### Views and sizing

| Concern | Behaviour |
|---|---|
| Split / Inline | Local state only, not persisted. Split shows Original and Proposed as Preview-style markdown; Inline is a unified line diff. |
| Split divider | Draggable, persisted at `apeditor:pe-split:<messageId>:<editId>:split`, valid range `20`–`80`. |
| Card size | `layout.previewSizes['<messageId>:<editId>']`, default `320×220`, bounded by `MIN/MAX_CARD_WIDTH` and `MIN/MAX_CARD_HEIGHT`. |
| Resize handles | 8 (`tl tr bl br top bottom left right`) via `ResizeHandle`. |

### State panels

| State | Shown |
|---|---|
| `!anchorInfo.found && !showBestEffortPanel` | A "Potential mismatch detected" warning |
| `!anchorInfo.found && edit.original` | A `<details>` "Show what the AI was looking for", truncated to 800 characters |
| `best-effort-applied` | A "Best effort match …" panel with the post-apply snapshot |
| `applied \|\| best-effort-applied` | A "Applied to document." status pill |

## 6. Reject with feedback

Rejecting is only half the loop. Reject-with-feedback stages a reason for a follow-up turn:

1. `onStageReject({ editId, comment, mentions })` — ChatPanel holds it in `stagedRejections[messageId]`; the card enters `staged`.
2. The chat bubble footer shows **Send N rejection comments** and **Clear staged**.
3. `commitStagedRejections(messageId)`:
   - `formatRejectionBatch(items)`.
   - `appendMessage` the batch.
   - Mark each `editId` as `committed` so the cards hide without a flicker.
   - Clear the bucket.
   - `runAssistantReplyAfterCommit(mergedMentions)` for a follow-up reply. The user message is already in the store, so it is not passed in again — re-adding it would send the rejection body twice.

`formatRejectionBatch` uses a different header for one item versus several:

```
Please revise the following rejected proposed edit. The `[id]` in brackets refers to that change's `id`.
```

```
Please revise the following rejected proposed edits. Each `[id]` in brackets refers to that change's `id`; address only those.
```

Body: `[<editId>] <cleanComment>` per non-empty item, where `cleanComment` runs `parseMentionsFromSentinels(comment).plain` so `@` sentinels are stripped from what the model sees. Whitespace-only items are dropped.

> The rejection path passes `mentionsByCommentId = undefined` to `buildRequestMessages`, so no cross-reference map is emitted. A rejection batch covers many edits from one turn; a per-comment map would be misleading.

## 7. Apply N changes (bulk)

`ChatPanel.applyAllForMessage(messageId)`:

1. Re-read `liveDocId` from the store at click time, so a document switch mid-stream cannot apply to the wrong document.
2. Resolve the assistant message and `parseProposedEdits(message.content)`.
3. `applyAllEdits(doc.content, edits)` — the same waterfall, per edit.
4. If nothing applied, return early: no snapshot, no bookkeeping.
5. **Pre-apply snapshot:** `saveRevision(doc.id, 'Before Apply All')`.
6. `updateDocumentContent`.
7. `recordAppliedEdit` per applied edit, with `newAnchor` from `appliedAnchors`. Edits whose anchor is unknown skip `newAnchor` and are re-anchored by the store's own fallback.
8. If any anchor was recorded, dispatch `mvp:select-range` for the most recent one, so the editor selects the last applied passage.
9. Mark the applied ids `committed` so the cards disappear.
10. Set `applyAllSummary[messageId] = { applied, total, at }`, auto-cleared after `4000` ms.

The footer count subtracts `committed` ids, so **Apply N changes** shows only what is still outstanding.

## 8. Constants at a glance

| Constant | Value | Purpose |
|---|---:|---|
| `MAX_BEST_EFFORT_DOC_BYTES` | `102400` | Refuse Best Effort on very large documents |
| `SUBSTRING_MIN_LEN` | `40` | Minimum substring slice considered |
| `maxLen` | `500` | Longest substring slice considered |
| `BEST_EFFORT_MIN_CONFIDENCE` | `0.4` | Token-sweep acceptance threshold |
| `BEST_EFFORT_COVERAGE_MIN` | `0.85` | Coverage required after expansion |
| `maxSkip` | `max(2, floor(n * 0.5))` | Token-sweep skip budget |
| `LOOKAHEAD` | `min(8, max(5, floor(n * 0.25)))` | Token-sweep lookahead window |
| `maxMatchedTokens` | `ceil(n * 1.5)` | Token-sweep window cap |
| Sweep deadline | `12` ms | Wall-clock budget for the token sweep |
| Overlap tolerance | `1` character, tokens ≤ 8 chars | `isNearToken` fuzziness |
| Duplication window | 60 before / 100 after | `checkReplacementDuplication` context |

## 9. Invariants and gotchas

| # | Invariant |
|---|---|
| 1 | The model **never** writes the document. Every write goes through `applyEdit`, `applyAllEdits`, `applyEditAtCaret`, or a manual keystroke. |
| 2 | `applyAllEdits` threads the accumulator. Do not refactor it to always match against the original content — a later edit may target text an earlier edit produced. |
| 3 | The card hides itself on `rejected` and `committed`, and those are committed to the store separately. Do not conflate the two. |
| 4 | `recordAppliedEdit` is idempotent per `(editId, roundId)`. Applying the same edit twice is a no-op. |
| 5 | The Best Effort probe is deferred to `requestIdleCallback`. Making it synchronous will jank the chat scroll on large replies. |
| 6 | A blocked splice must never be silently dropped — the user needs to be pointed at Highlight Apply. |
| 7 | `stripParagraphReferences` on `original` / `replacement` is load-bearing. Without it, models that echo `[p10]@354` markers fail the exact match. |
| 8 | `mvp:select-range` is dispatched after every apply so the caret lands on the changed text. Removing it makes Apply feel like nothing happened. |
| 9 | `parseProposedEdits` tolerates an unterminated fence. Preserve the `\|(?:```\|$)` alternative. |

## 10. Next

- The prompt that produces these fences → [AI chat & prompts](07-ai-chat.md)
- Where the rationale is stored and displayed → [Comments §8](06-comments.md#8-applied-rationales)
- Coverage of these algorithms in tests → [Testing & security](14-testing-and-security.md)
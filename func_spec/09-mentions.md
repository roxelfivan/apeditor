# @-references

> Attaching another document — or a specific section of it — to a chat message, a comment, or a rejection. The system is a two-stage picker backed by a single sentinel format.

---

## 1. Where it applies

`@` works in four surfaces, all sharing [`MentionInput.tsx`](../src/components/mentions/MentionInput.tsx):

| Surface | Owner | Mention source |
|---|---|---|
| Chat input | `ChatPanel` | Local state, sent with the turn |
| A new comment | `CommentComposer` → `Editor.handleSaveComment` | Stored on `CommentRound.mentions` |
| A comment popover in edit mode | `CommentPopover` | Replaces the round's `mentions` on save |
| A proposed edit's rejection feedback | `ProposedEditCard` → `ChatPanel` | Sent with the rejection batch |

A `MentionToken` is also **inferred from comments** when the Graph view compiles, which is how `@` edges appear in the graph. See [Graph view](10-graph-view.md).

## 2. The token

```ts
interface MentionToken {
  id: string;                    // local uuid; also the React key and the sentinel id
  kind: 'doc' | 'doc-section';
  documentId: string;            // lookup key into useStore.documents
  documentTitle: string;         // captured at insert time — the chip stays stable across renames
  paragraphIndexes: number[];    // 0-based; empty for whole-document mentions
  createdAt: number;
  reason?: MentionReason;        // 'context' | 'style' | 'facts' | 'terminology' | 'compare'
  referrerId?: string | null;    // the ChatMessage or Comment that introduced it
}

type MentionReason =
  | 'context'        // general background reading (the default)
  | 'style'          // voice / tone match
  | 'facts'          // fact-check, reuse numbers or entities
  | 'terminology'    // consistent vocabulary / definitions
  | 'compare';       // ask the model to compare with this document
```

> `documentTitle` is captured at insert time **on purpose**. A later rename of the source document must not silently rewrite the chip's visible text. If the source document is **deleted**, callers render the chip as `(deleted)` and drop the mention from the prompt.

## 3. The sentinel

### Format

```
\u200B[[mention:<id>|<kind>|<documentTitle>|<paragraphCSV>|<documentId>|<reason>|<referrerId>]]\u200B
```

```ts
export const MENTION_SENTINEL_OPEN = '\u200B[[mention:';
export const MENTION_SENTINEL_CLOSE = ']]\u200B';
```

The **zero-width space** (U+200B) brackets the whole sentinel. Fields are pipe-separated; `\` and `|` inside a field are escaped by `encodeField` and unescaped by `decodeField`.

### Backward compatibility

The parser accepts **5, 6, or 7** fields. Missing trailing fields default:

- Field 6 (`reason`) → `'context'`, and is only assigned when the decoded value is one of the five valid `MentionReason` values; otherwise the field is dropped.
- Field 7 (`referrerId`) → `null`; only assigned when non-empty.

Fields were appended at the tail over successive releases, so old sentinels keep parsing.

> **Never hand-construct a sentinel.** Use `buildSentinel(token)` to write and `parseMentions` / `parseMentionsWithRanges` / `parseRawWithMentions` to read. [`utils/mentions/parseMentions.ts`](../src/utils/mentions/parseMentions.ts) is the **only** file that knows this format.

### Loss tolerance

An unterminated sentinel, or a malformed one, is preserved as **plain text** rather than dropped. Losing a user's typed content silently would be worse than leaving a visible artefact.

## 4. The textarea model

The source of truth in the textarea is **plain text**. Sentinels are a serialisation, not the working representation.

```
plainText                                    ← what the user sees and edits
mentions: MentionToken[]                    ← parallel array
positions: Map<mentionId, { plainStart, plainEnd }>
```

### Display hydration

`hydrateDisplayCaptions` inserts `caption + '\u200B'` into the plain text at each mention's `plainStart`, and expands `plainEnd` to match. It runs whenever the `value` prop changes, so an external reset (a prompt library insert, say) does not visually lose the markers.

A leading space is added when the character immediately before `plainStart` is non-whitespace.

> **The trailing ZWSP is the structural anchor.** `plainEnd - 1` is the ZWSP position; the input diff treats a deletion that reaches it as "drop the mention". Delete the ZWSP and the reference disappears.

### Serialisation and parsing

| Function | Direction |
|---|---|
| `serializeRawWithMentions(plainText, positions, mentions)` | plain → raw. Places each mention's sentinel at `plainStart`, skipping the caption range `plainStart … plainEnd`. Overlapping or out-of-order positions are dropped silently. |
| `parseRawWithMentions(value)` | raw → `{ plain, mentions, positions }`. Offsets advance by `start - end` for each consumed sentinel. |
| `parseMentions(value)` | raw → `{ plain, mentions }` only |
| `parseMentionsWithRanges(value)` | raw → plain text with ranges annotated |
| `plainTextDiff(a, b)` | Character-level diff used by the input handler to detect insert / delete / replace and move positions |
| `summarizeMention(token)` | The chip caption, e.g. `Title` or `Title §Heading` |

### Delete

`deleteMention(id)` removes `[plainStart, plainEnd)` and shifts every later position left by `plainEnd - plainStart`. Used by the chip's `×` button and by the ZWSP-deletion path.

## 5. The two-stage picker

```
"@" typed with no popover open
  → MentionInput queueMicrotask, measure the caret → open DocPicker
```

The `queueMicrotask` matters: the caret must be measured **after** the `@` is in the DOM.

### Stage 1 — `DocPicker`

| Behaviour | Detail |
|---|---|
| Filter | Case-insensitive substring on `d.title \|\| 'Untitled'` |
| Excluded | The **current document** is always excluded — referencing the document you are already in is pointless, and `sys-current-doc` already carries its outline |
| Cap | 50 candidates |
| `↑` / `↓` | Move the active row (resets to 0 on every query change) |
| `Enter` / `Tab` | Pick the active row |
| `Esc` | Close — **without consuming the `@`** |
| Focus | `onPointerDown` / `onMouseDown` both `preventDefault` so the editor keeps focus and caret |
| Position | `position: fixed` at `anchor`, `minWidth: 240`, `maxHeight` default `240` |

Three distinguished empty states, exposed as `data-empty-reason` for testing and analytics:

| `emptyReason` | Copy |
|---|---|
| `no-workspace` | "No documents yet. Create one in the sidebar, then reference it with `@`." |
| `only-current` | "Only the current document is open. Create another in the sidebar to reference it with `@`." |
| `no-match` | "No matching documents." |

### Stage 2 — `SectionPicker`

Opens when the picked document has heading sections. Documents with no headings skip it and attach the whole document.

| Behaviour | Detail |
|---|---|
| Initial state | `selected = new Set(sectionsMatchingSelection(sections, initialSelection))`, active row = the first match |
| `↑` / `↓` | Move active |
| `Space` or `Enter` | Toggle the active section |
| `⌘/Ctrl + A` | Select all sections |
| `Esc` | Cancel — aborts **without** attaching |
| Footer | `Whole document` \| `Cancel` \| `Use selection` (disabled until something is selected) |
| Indent | `paddingLeft: 8 + (level - 1) * 12` |
| Header | "pick sections — parent ticks cascade to children (Esc to cancel)" |
| Position | `position: fixed`, `minWidth: 320`, `maxHeight` default `320` |

Reuses the `.mention-popover` styles, as does `ReanchorPicker`.

### Cascade

Toggling a section also flips every **descendant**:

```ts
descendantSectionIndexes(sections, sectionIndex)
```

walks **forward** from the index, collecting sections while `sections[i].level > ancestor.level`, and stops at the first section whose level is `<=`.

- Ticking a parent ticks all children.
- Unticking a parent unticks all children.
- **Ticking a child never affects the parent.** The cascade is strictly downward.
- Preamble and blank-line fallback blocks have `level: 0` and cascade to `[]`.

`confirmSelection` expands the selected sections into the sorted union of their `paragraphIndexes` before handing them to `onConfirm`. `confirmFull` calls `onConfirm([])`, which is a whole-document mention.

## 6. Sending references

Each mention becomes one `sys-referenced-doc-N` system message, appended in order after the doc outline and the cross-reference map.

### `buildReferencedDocMessage(token, doc, ctx)`

**Whole-document mentions** get the compact outline — the token-cheap default.

**Section-scoped mentions** get only the picked paragraphs:

```
[p<idx+1>]
<paragraph slice>

[p<idx+2>]
<paragraph slice>
```

### Budgets

| Constant | Value | Scope |
|---|---:|---|
| `REFERENCED_SECTION_CHARS_CAP` | `4000` | Verbatim paragraphs per referenced document |
| `REFERENCED_DOCS_TOTAL_CHARS_CAP` | `8000` | All referenced documents per turn |
| *(removed)* Google AI Mode URL cap | — | Retired with Google AI Mode in v0.6.4 |

`remainingBudget = max(0, min(4000, ctx.totalCap - ctx.totalConsumed))`.

Behaviour:

| Situation | Result |
|---|---|
| `remainingBudget > 256` and all sections fit | Emit the sections |
| The **first** slice already exceeds the per-document cap | Emit one truncated paragraph plus `…(remaining sections omitted)…` |
| Sections fit but the turn budget runs out mid-doc | Emit what fit plus `…(remaining sections omitted — referenced-doc budget exhausted)…` |
| `remainingBudget <= 256` | **Downgrade to the outline** |

The turn loop in `buildRequestMessages` breaks once `totalConsumed >= 8000`.

### Self-reference suppression

A **whole-document** mention of the current document is dropped, because `sys-current-doc` already carries its outline. A **section-scoped** mention of the current document is kept — it pins paragraphs the outline does not include verbatim.

### Dedupe

```ts
dedupeKey(token) = `${documentId}::${kind}::${[...paragraphIndexes].sort().join(',')}`
```

A section-scoped mention and a whole-document mention of the same document produce different keys, so **both** survive. Two identical mentions collapse to one.

### Cross-reference map

On comment-batch turns, when `mentionsByCommentId` has at least two entries and at least one resolves to references, an extra system message `${lastUser.id}-comments-xref` is emitted:

```
[c1] → referenced docs: "Ideas", "Notes §Summary"
[c2] → referenced docs: "Ideas"
```

This tells the model *why* each referenced document was pulled in for each specific comment. The plain chat path passes `mentionsByCommentId = undefined`, so the map is omitted there; the rejection-batch path also omits it, because one rejection turn covers many edits.

### Per-comment focus hints

`computeFocusForDoc` classifies a document's mentions by `reason` and emits a per-document focus line so the model can prioritise the relevant passages rather than re-reading everything.

## 7. Storage and lifetime

| Where | How |
|---|---|
| Chat turn | Mentions live in `ChatPanel` local state, merged into the request at send time. Not persisted with the message. |
| Comment | `CommentRound.mentions`, persisted with the comment so a reload keeps the reference. |
| Rejection | Merged into the staged batch and sent with the follow-up turn. |
| Graph | Read back from `rounds[].mentions` by `mentionTokensFromComments`, which flattens **all** rounds of every comment on a document. |

When the user re-edits a comment through the popover, `updateCommentBody` **replaces** the round's mentions if the `mentions` argument is supplied, and **preserves** them when it is omitted. An empty array is stored as `undefined`, not `[]`.

`handleSendToAi` fills in defaults at dispatch time: `referrerId: m.referrerId ?? c.id`, `reason: m.reason ?? 'context'`.

## 8. Keyboard summary

| Key | Context | Behaviour |
|---|---|---|
| `@` | Any mention input | Opens `DocPicker` at the caret |
| `↑` / `↓` | `DocPicker` / `SectionPicker` | Move the active row |
| `Enter` / `Tab` | `DocPicker` | Pick the document |
| `Space` / `Enter` | `SectionPicker` | Toggle the section |
| `⌘/Ctrl + A` | `SectionPicker` | Select all |
| `Esc` | `DocPicker` | Close without consuming the `@` |
| `Esc` | `SectionPicker` | Cancel without attaching |
| `⌘/Ctrl + Enter` | `MentionInput` | Submit the surrounding form (never with `Shift`) |

Typing more characters while the picker is open filters it. When the `@` index drops below zero, the picker closes automatically.

An outside click closes the picker unless the target is inside `.mention-popover` or inside the input container.

## 9. Reading references in other UI

- **Comment popover, read mode** — `CommentBodyWithChips` renders each reference as an inline clickable pill. Clicking it calls `setCurrentDocument(id)`, switching the editor to the referenced document so the source can be read in context.
- **Comment popover, edit mode** — the draft is rebuilt with `buildEditableMentionBody(comment.body, latestRoundMentions)` and the mentions are re-parsed from the body, falling back to the round's stored list.
- **Graph view** — every `@` mention becomes an edge. See [Graph view §4](10-graph-view.md).

## 10. Invariants and gotchas

| # | Invariant |
|---|---|
| 1 | `parseMentions.ts` is the only file that knows the sentinel format. Moving it back under `components/` recreates the v0.5.2 layering bug. |
| 2 | Never hand-construct a sentinel. Use `buildSentinel` / `parseMentions`. |
| 3 | The trailing ZWSP is the structural anchor. Deleting it drops the mention. |
| 4 | Malformed and unterminated sentinels become plain text — never dropped. |
| 5 | `documentTitle` is captured at insert time and must not be re-read from the store for display. |
| 6 | `Esc` in `DocPicker` must not consume the `@`. |
| 7 | Cascade is downward only. Ticking a child never ticks a parent. |
| 8 | `paragraphIndexes` are **0-based** and must match `buildDocOutline`'s paragraph boundaries, which split on every `\n`. |
| 9 | Referenced documents **downgrade to outlines** when the budget is exhausted — they are never silently omitted. |
| 10 | The whole-document mention of the current document is suppressed; the section-scoped one is not. |
| 11 | The `DocPicker` cap of 50 and the `data-empty-reason` attribute are relied on by tests. |

## 11. Next

- How the system messages are assembled → [AI chat & prompts §4.7](07-ai-chat.md#47-sys-referenced-doc-n)
- Mentions as graph edges → [Graph view](10-graph-view.md)
- Round-trip coverage in tests → [Testing & security](14-testing-and-security.md)
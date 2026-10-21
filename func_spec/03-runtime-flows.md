# Runtime flows

> Eight end-to-end walks through the app. Each lists the ordered steps, the files touched, and the events fired. Use these as the map when tracing a bug or planning a change.

---

## 1. Boot

| Step | What happens | File |
|---|---|---|
| 1 | `migrateLegacyStorage()` copies any `ai-text-editor-mvp*` `localStorage` keys to `apeditor*`, then removes the legacy keys. Runs before any read. | [`utils/storage.ts`](../src/utils/storage.ts) |
| 2 | The persisted theme is read **directly out of `localStorage`** (`JSON.parse(raw).state.theme`) and applied with `applyThemeClass` so the first paint is already correct. Any parse error falls back to `'light'`. | [`main.tsx`](../src/main.tsx) |
| 3 | `createRoot(...).render(<React.StrictMode><App /></React.StrictMode>)`. | [`main.tsx`](../src/main.tsx) |
| 4 | Zustand rehydrates from `localStorage['apeditor']`, then `onRehydrateStorage` runs its repair pass. | [`store/store.ts`](../src/store/store.ts) |
| 5 | `App` applies the theme class and sets `<html style="font-size">` from `uiFontSize`. | [`App.tsx`](../src/App.tsx) |
| 6 | If the active provider needs a key and none is set and `apeditor:onboarded` is absent, the Settings modal auto-opens and the flag is written. Google AI Mode is exempt. | [`App.tsx`](../src/App.tsx) |
| 7 | The first-run effect that collapses both side panels on a narrow viewport fires. | [`App.tsx`](../src/App.tsx) |

> StrictMode double-invokes effects in development. The `migrateLegacyStorage()` call is module-level in `main.tsx`, so it runs once; the store's rehydrate is idempotent.

## 2. Typing → Predict → accept

The Predict (inline completion) flow. **Predict is off by default** — the user must click the toolbar button or press `⌘/Ctrl + \` first.

```
user types
  → Editor.onChange
      → useStore.updateDocumentContent(id, value)          ← store
      → inline.onTextChange(value)                         ← only when inlineEnabled
          ├─ ghost already showing? → cancel(), return     ← no re-request
          ├─ next.length <= prev.length? → return          ← undo / paste / IME
          └─ arm 300 ms debounce
              → attemptFire({ manual: false })
                  ├─ prefix = text.slice(caret - 600, caret)
                  ├─ abort any in-flight AbortController
                  ├─ stats.requested++
                  └─ streamInlineCompletion(...)
                        POST resolveChatEndpoint(apiEndpoint)
                        { model, messages:[system, user], temperature: min(api.temperature, 0.4),
                          max_tokens: 500, stop: ['\n\n','\n','   ',' #',' ##',' ```'], stream: true }
                        SSE loop → processDelta → stripPrefixOverlap → setGhost
                          → Editor renders the suggestion panel
Tab (or Accept button)
  → inline.accept()
      → next = value.slice(0,caret) + ghost + value.slice(selectionEnd)
      → dispatch mvp:accept-completion { text: next, caret }
  → Editor listener: updateDocumentContent(id, next); restoreCaret(ta, caret, caret)
```

| Concern | Value / behaviour | File |
|---|---|---|
| Context window sent | Last **600** chars before the caret (`MAX_PREFIX_CHARS`) | [`useInlineCompletion.ts`](../src/hooks/useInlineCompletion.ts) |
| Debounce | **300 ms** (`DEBOUNCE_MS`) | same |
| Max output | **500** tokens (`MAX_OUTPUT_TOKENS`) | same |
| Temperature | `Math.min(api.temperature, 0.4)` — always cooled | same |
| Stop sequences | `['\n\n', '\n', '   ', ' #', ' ##', ' ```']`. **The empty string is deliberately excluded** — a server-side stop on `""` truncated the stream to zero bytes. | same |
| Overlap stripping | `stripPrefixOverlap` finds the largest `n` in `[4, min(80, prefix.length, ghost.length)]` where the last `n` chars of the prefix match the first `n` of the ghost with ≤1 mismatch, then returns `ghost.slice(n)`. | same |
| Reasoning blocks | `<think>…</think>` and `<reasoning>…</reasoning>` are stripped by `processDelta`; an unclosed opener truncates the rest. | same |
| Gating | Requires a keyed provider + a key + an endpoint. `apiConfigured = requiresApiKey(provider) && Boolean(apiKey && apiEndpoint)`. Google AI Mode is permanently not configured. | [`Editor.tsx`](../src/components/Editor.tsx) |

> **Gotcha:** `mvp:accept-completion` carries the **entire new document**, not a delta. Any new listener must not assume it is an insertion.

## 3. Comment a passage

```
user selects text in Write (or the Write side of Split)
  → Editor.openComposer()
      ├─ selectionStart === selectionEnd? → bail (no selection)
      ├─ mirrorRef.current missing?      → bail
      ├─ getSelectionRect(doc, mirror, start, end)   → viewport rect (DOM Range against the MIRROR)
      └─ toWrapperLocal(rect) → clampToContainer → setComposerPosition()
  → <CommentComposer> renders, autoFocus
      ⌘/Ctrl+Enter saves · Esc cancels · body capped at COMMENT_HARD_CAP = 4000
  → Editor.handleSaveComment(body, mentions)
      → useStore.addComment({
            id: uuid(), documentId, start, end, snippet: doc.slice(start,end),
            body, createdAt, updatedAt, outdated:false, sent:false,
            rounds: [ { id: uuid(), start, end, snippet, body, createdAt, updatedAt,
                        outdated:false, sent:false, applied:[], mentions } ]
        })
      → store writes → CommentLayer paints a <mark>
                    → CommentMargin paints a numbered badge
```

| Concern | Value / behaviour |
|---|---|
| Comment body soft cap | `COMMENT_SOFT_CAP = 2000` — shows a "— long comment" hint |
| Comment body hard cap | `COMMENT_HARD_CAP = 4000` — `clampCommentBody` truncates |
| Undo stack cap | `COMMENT_UNDO_STACK_LIMIT = 20` — FIFO, session only |
| Save gating in the popover | `body.trim().length > 0 \|\| draftMentions.length > 0` — a body of only `@` references is valid |

## 4. Send to AI → propose → apply

This is the headline flow.

```
Editor.CommentTray "Send to AI"
  → handleSendToAi()
      ├─ filters c.outdated === false
      └─ dispatch mvp:send-comments { commentIds, mentionsByCommentId }
  → ChatPanel.onSendComments(detail)
      ├─ merge mentions: event payload first, else rounds[last].mentions; dedupe by id
      ├─ body = formatCommentBatch(doc.content, comments)
      ├─ appendMessage(docId, userMsg)
      ├─ useStore.markCommentsSent(ids)          → sent: true on the latest round
      ├─ dispatch mvp:mark-comments-sent { ids }
      ├─ dispatch mvp:chat-streaming { streaming: true }
      ├─ redactSecretsInMessages(buildRequestMessages(...))
      └─ streamChatCompletion(...) → onDelta → updateLastAssistant(docId, acc)
  → AssistantContent parses the finished reply
      → parseProposedEdits(content)   → segments: text | edit
      → <ProposedEditCard> per edit

user clicks Apply on a card
  → performReplace(anchor)
      ├─ useStore.getState().updateDocumentContent(docId, next)
      ├─ useStore.getState().recordAppliedEdit({ ..., newAnchor })
      └─ dispatch mvp:select-range { start, end }
  → Editor restores the caret over the new text
  → the related comment re-anchors to the REPLACEMENT and stores the rationale
  → open the comment badge → Rationale → the AI's explanation, collapsible per round
```

### The prompt this produces

`buildRequestMessages` emits, in order:

| # | `id` | Content |
|---|---|---|
| 1 | `sys` | The user's System Message, or `DEFAULT_SYSTEM_MESSAGE` |
| 2 | `sys-current-doc` | The document **outline** — `[pN]@offset: <first 60 chars>` per paragraph — or, when selection-only, the `BEGIN/END EDITOR SELECTION` block |
| 3 | `sys-proposed-edit-rules` | The fence schema (always) + `PROPOSED_EDIT_RULES_DEFAULT` or the user's override |
| 4 | `<userMsgId>-comments-xref` | Only on comment-batch turns with ≥2 mentions: a `[comment → referenced docs]` map |
| 5 | `sys-referenced-doc-1..N` | One per `@`-reference, deduped, budgeted at 8,000 chars total |
| 6 | *(history)* | Every non-system message, plus a `<id>-sel` selection note when a message carried a selection |
| 7 | `<userMsgId>-comments-batch` | Only on comment-batch turns: instructions to address every `[id]` and keep the document coherent |

The exact wording of every block is in [AI chat & prompts](07-ai-chat.md#4-the-request-message-contract).

### The comment-batch block format

Produced by `formatCommentBatch` in [`utils/comments.ts`](../src/utils/comments.ts), one block per comment in document order:

```
[c1] (paragraph 7/32, doc offset 1840–1920)
"<verbatim snippet>"
Before: "<up to 120 chars before, trimmed to first space>"
After: "<up to 120 chars after, trimmed to last space>"
Comment: <user's body>
```

> **Keep in sync:** `looksLikeCommentBatch` in [`api/chat.ts`](../src/api/chat.ts) detects this format with the regex `/\[c\d+\] \(paragraph\b[\s\S]*?Comment:/`. Change one and you must change the other, or comment batching silently stops being recognised.

## 5. Editing a comment after it was sent → a new round

```
user opens the badge → Edit → changes the body → Save
  → useStore.updateCommentBody(id, body, mentions)
      ├─ lastRound.sent === false  → in-place update of the latest round
      │                              (CommentOp 'update-body')
      └─ lastRound.sent === true   → appendCommentRoundAction
                                     (CommentOp 'append-round')
                                     new round: sent:false, applied:[]
                                     top-level body/updatedAt mirror it
                                     createdAt preserved from round 1
```

**Why it matters:** overwriting a sent round would erase the history of what the AI was actually answering, and would orphan already-applied rationales under the wrong round. Editing a sent comment therefore *starts Round 2*, and each round keeps its own anchor and its own applied rationales.

Guard: if the trimmed body is identical **and** the mention id sets are identical, the action is a no-op and returns the state unchanged.

## 6. `@`-reference flow

```
user types "@" in chat / a new comment / the popover edit mode / rejection feedback
  → MentionInput queueMicrotask, measure the caret
  → <DocPicker> opens
        ↑ ↓ move · Enter / Tab pick · Esc cancel
        filter: case-insensitive substring on the title, EXCLUDES the current document
        capped at 50 candidates
        empty states distinguished by a data-empty-reason attribute:
          no-workspace | only-current | no-match
  → user picks a document
        └─ if it has headings → <SectionPicker> opens
              parent tick CASCADES to descendants (downward only)
              Space or Enter toggles · ⌘/Ctrl+A selects all · Esc cancels
              footer: Whole document | Cancel | Use selection
        └─ else → whole-document mention
  → a chip appears above the input; the textarea holds a caption + ZWSP anchor
  → on send, each mention becomes a sys-referenced-doc-N system message
```

Sentinel format, budget, and cascade semantics are in [@-references](09-mentions.md).

## 7. OCR / PDF import

```
FileActionsButton → popover → "Import photos / PDFs"
  ├─ gated on api.apiKey && api.apiEndpoint
  │    (OCR itself is local; the Markdown rewrite needs a model)
  ├─ pick languages (eng default; at least one must remain checked)
  └─ pick files (accept="image/*,application/pdf", multiple)
       → validateOcrBatch(files)
            per file > OCR_MAX_FILE_BYTES   (50 MB)
            total     > OCR_MAX_BATCH_BYTES  (200 MB)
       → extractTextFromFiles(files, langs, onProgress)
            per file, dispatch on MIME:
              application/pdf (or .pdf name) → PDF path
                  ├─ pdf.js getTextContent
                  │     joined.length >= 2  → text-native fast path, no OCR
                  │     else                → rasterize at scale 2.0 → OCR
                  └─ > OCR_MAX_PDF_PAGES (500) → friendly error
              image/* or empty MIME          → image path
                    decode via ObjectURL → resize so the longest edge ≤ 2000
                    → canvas → PaddleOCR
            finally: revoke ObjectURLs, zero <img> and <canvas> backing buffers,
                     pdf.destroy(), page.cleanup()
       → formatOcrAsMarkdown(text, api)      ← streams through streamChatCompletion
            system: OCR_MARKDOWN_SYSTEM_PROMPT
            user:   --- BEGIN EXTRACTED TEXT --- … --- END EXTRACTED TEXT ---
            temperature: min(api.temperature, 0.3)
            strips <think> / <reasoning> and unwraps an accidental outer fence
       → dispatch mvp:insert-text { text: markdown }
  → Editor splices at the caret (or appends if the textarea was never touched)
```

PaddleOCR is a **module-level singleton** (`enginePromise`) — models load once per tab and are reused.

## 8. Graph compilation and layout

Pure and synchronous; no store writes, no network, no React.

```
viewMode === 'graph'
  → Editor renders <GraphView key={graphEpoch} labelPx zoom />
  → buildWorkspaceGraph(documents, commentsByDoc)
      Pass 0  one node per document                          doc:<id>
      Pass 1  one node per real heading (level > 0)          heading:<docId>:<start>
              splitHeadingPath() on '>' / '›' / '→' → label = last segment
      Pass 2  alias table: single-segment headings register their slug
      Pass 3  heading edges
                path prefixes → synthetic heading-path:<docId>:<slug> nodes
                else nearest preceding heading with a strictly lower level
                else the document node
      Pass 4  wikilinks
                document title match → edge kind 'wikilink'
                title + heading match  → edge to that heading node
                no match                → term:<slug> node, edge kind 'wikilink'
                [[mention:…]] sentinels are skipped
      Pass 5  @ mentions from comment rounds
                section-scoped → the heading with the most matching paragraphs
                edge kind '@', always sourced from the document node
  → layoutWorkspaceGraph(graph, currentDocumentId)
      1. seed the CURRENT document as an atom at the origin
           assignAngles weighted by subtreeWidth
           assignShells collapses a lone H1 + its children so the ring does not collapse
           shellRadii → radii[0] = NUCLEUS_RING (88), then +SHELL_GAP (280) floors
      2. term satellites at currentExtent + 90, placed on circularMean of their neighbours
      3. each OTHER document laid out as its own mini-atom at minSep = 204
           placed at currentExtent + extent + CLUSTER_GAP (340)
      4. six refinement passes slide clusters toward the mean incoming ray
      5. RELAX_ITERS = 80 separation passes; the current doc node is pinned
      6. labelPlacement pushes labels outward, anchors start/middle/end by radial x
  → GraphView renders, wires drag / zoom / hover / click
      projection 'flat'    → <svg>, layout coordinates unchanged
      projection 'sphere'  → toSphere → rotateSphere → toScreen, back-hemisphere culled
      projection 'concept' → <Concept3DScene> (lazy), three.js WebGL
          headingDepthByNode(edges) → depth → ConceptSlot {y, term}
             document 0, heading 270 + depth·135 (positive y),
             term on underground ring at y = -200 (negative y)
          orbit drag → ConceptPose {yaw, pitch, distance, target}
          wheel / shift+drag / arrows / touch → OrbitControls, mirroring
          the pose through setConceptPose so the toolbar zoom + Reset
          still read from the same source
```

`viewMode` is still `'write' | 'preview' | 'split' | 'graph'` — the three projections are an inner toggle within the Graph view, not three panes.

See [Graph view](10-graph-view.md) for the full algorithm and the exported test helpers.

## 9. Cross-cutting: what runs on every keystroke

Worth knowing when chasing input lag.

| Trigger | Work performed |
|---|---|
| Textarea `onChange` | `updateDocumentContent`, mirror re-render, `CommentLayer` segment rebuild, badge position recompute (via `ResizeObserver` on the textarea), `inline.onTextChange`, and a 150 ms debounced `reanchorAll` pass over comments |
| Selection change | `setEditorFocus(docId, { focused, selectionStart, selectionEnd })` — used by ProposedEditCard to decide whether Highlight Apply is available |
| Caret report | Only when the editor has focus; the store holds `-1` until the user has interacted |
| Store `set` | Zustand notifies only the selectors whose slice changed; components use fine-grained selectors to avoid re-rendering the whole tree |

## 10. Next

- The store that all of this writes into → [State & persistence](04-state-and-persistence.md)
- The editor internals behind flows 2 and 3 → [Editor & writing](05-editor-and-writing.md)
- The prompt builder behind flow 4 → [AI chat & prompts](07-ai-chat.md)
# AI chat & prompts

> The chat / AI layer in ApEditor. This chapter covers keyed SSE transport, Local Model (LiteRT-LM / WebGPU), the ordered prompt contract, secret redaction, and Chat **+** attachments.

---

## 1. Scope

Everything outbound lives in [`src/api/chat.ts`](../src/api/chat.ts), with one exception: [`ocrMarkdown.ts`](../src/utils/ocrMarkdown.ts) reformats imported OCR text, and it does so by calling back into `streamChatCompletion`.

| Symbol | Role |
|---|---|
| `streamChatCompletion(messages, config, options)` | Transport. SSE reader. |
| `buildRequestMessages(...)` | Prompt assembly. Ten parameters, all optional after the first two. |
| `buildRequestPreview(...)` | Debug Mode wrapper: packs the request the same way and returns `{ messages, tokens }`. |
| `resolveChatEndpoint(endpoint)` | Base URL → final URL |
| `assertSafeChatEndpoint(endpoint)` | Security gate before a Bearer token is attached |
| `ApiError` | The only error class the API path throws |
| `DEFAULT_SYSTEM_MESSAGE` | The built-in system prompt |
| `PROPOSED_EDIT_RULES_DEFAULT` | The built-in rationale rules |
| `buildDocOutline(title, content, isCommentBatch)` | Document outline builder |
| `buildReferencedDocMessage(token, doc, ctx)` | One `@`-reference system message |
| `REFERENCED_DOCS_TOTAL_CHARS_CAP` | `8000` — per-turn reference budget |
| `CACHE_CONTROL_META` | `{ cache_control: { type: 'ephemeral' } }` |

## 2. Transport

### `streamChatCompletion(messages, config, { signal, onDelta })`

1. `endpoint = resolveChatEndpoint(config.apiEndpoint)`.
2. Empty endpoint → `ApiError('No API endpoint configured. Open Settings to set one.')`.
3. Missing key → `ApiError('No API key configured. Open Settings to set one.')`.
4. `assertSafeChatEndpoint(endpoint)` — **mandatory** before any request is built.
5. `fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: \`Bearer ${config.apiKey}\` }, body: JSON.stringify({ model, messages: messages.map(m => ({ role, content })), temperature, stream: true }), signal })`.
6. Non-2xx or no body → `ApiError(\`API request failed (${res.status}): ${text || res.statusText}\`, res.status, text)`.
7. `res.body.getReader()` + `TextDecoder`. SSE frames split on `'\n\n'`; the first `data:` line in a frame is parsed. `[DONE]` terminates. The delta is `choices[0].delta.content ?? choices[0].message.content`. Malformed JSON is silently ignored so one bad frame cannot kill the stream.

**There is no retry and no back-off.** Abort is caller-initiated via the `signal`; only the `fetch` honours it. Network errors bubble as-is; `ApiError` is the only class the API path throws.

### `resolveChatEndpoint(endpoint)`

```ts
const trimmed = endpoint.trim().replace(/\/+$/, '');
if (!trimmed) return trimmed;
if (/\/chat\/completions$/.test(trimmed)) return trimmed;
if (/\/completions$/.test(trimmed)) return trimmed;
if (/\/responses$/.test(trimmed)) return trimmed;
return `${trimmed}/chat/completions`;
```

A base URL like `https://api.minimax.io/v1` becomes `…/v1/chat/completions`. The three recognised suffixes are returned verbatim.

> **On your hook:** `/completions` and `/responses` are accepted but produce a *non*-Chat-Completions request shape. Support depends on the endpoint.

### `assertSafeChatEndpoint(endpoint)`

```ts
const host = url.hostname.toLowerCase();
const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
if (url.protocol === 'https:') return;
if (url.protocol === 'http:' && isLocal) return;
throw new ApiError(`Refusing to send your API key to a non-HTTPS endpoint (${url.protocol}//${url.host}). Use https:// or a localhost http:// URL.`);
```

An unparseable URL throws `'API endpoint must be an absolute URL (e.g. https://api.example.com/v1).'`. The hostname comparison is lowercased, so case tricks do not bypass it.

`http://localhost` is allowed specifically so users can point ApEditor at a local proxy or a self-hosted model.

## 3. Providers

[`config/providers.tsx`](../src/config/providers.tsx) holds the presets.

| `id` | Label | Default endpoint | Model presets | Default model |
|---|---|---|---|---|
| `minimax` | Minimax | `https://api.minimax.io/v1` | `MiniMax-M3`, `MiniMax-M3-fast`, `MiniMax-M2.7`, `MiniMax-M2.7-highspeed` | `MiniMax-M2.7` |
| `openai` | OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini`, `gpt-4o`, `gpt-4-turbo`, `o1-mini`, `o1`, `gpt-3.5-turbo` | `gpt-4o-mini` |
| `local-gemma` | Local Model (require around 2gb disk space) | Hugging Face model page (display only) | *(none)* | `gemma-4-E2B-it-web` |

```ts
export function requiresApiKey(id: ApiProvider | undefined | null): boolean {
  return id !== 'local-gemma';
}

export function getProvider(id): ProviderPreset {
  if (!id) return PROVIDERS[0];
  return PROVIDERS.find(p => p.id === id) ?? PROVIDERS[0];
}
```

`requiresApiKey` is the **single source of truth** for key gating. It is consulted by first-run onboarding, the Predict button, the Settings API-key field, and `ChatPanel`'s Local Model branch. Never re-derive "does this provider need a key" anywhere else.

First-run default is `local-gemma` (override with `VITE_DEFAULT_PROVIDER=minimax|openai`). Persisted `google-ai-mode` migrates to `local-gemma` on rehydrate.

> **The request layer does not branch on `provider`** for `minimax` and `openai` — both speak the same OpenAI Chat Completions wire format. Only `local-gemma` takes a different runtime path (`streamLocalGemma` in [`localGemma.ts`](../src/api/localGemma.ts)).

## 4. The request-message contract

`buildRequestMessages` is the most important function in the app. Both the emitter here and the parser in [`proposedEdit.ts`](../src/utils/proposedEdit.ts) are two halves of one contract.

```ts
buildRequestMessages(
  history, systemMessage, currentDocument?, rationaleRulesOverride?,
  referencedDocuments?, documentLookup?, mentionsByCommentId?,
  enableCacheControl = false, proposedEditPolicy = 'eager',
)
```

`proposedEditPolicy`: `'eager'` (Minimax/OpenAI — always remind fences) vs `'on-demand'` (Local Gemma — prose by default; fences only when the user asks for edits or on comment Send to AI).

### 4.1 Ordered output

| Order | `id` | Emitted when | Content |
|---:|---|---|---|
| 1 | `sys` | Always (unless the effective system message is empty) | Built-in or override; Local Gemma may use a shorter on-demand contract |
| 2 | `sys-current-doc` | Keyed path + document content | Compact outline (`buildDocOutline`) |
| 3 | `sys-proposed-edit-rules` | Always (shape depends on policy) | Fence schema + rationale rules (eager) or short Local Gemma rationale (on-demand) |
| 4 | `${lastUser.id}-comments-xref` | Comment-batch turn **and** `mentionsByCommentId` has ≥2 entries with refs | The `[comment → referenced docs]` map |
| 5 | `sys-referenced-doc-1..N` | Per ordered mention | One per reference, deduped, budgeted |
| 6 | *(history)* | Per non-system message | The message, plus `${m.id}-sel` when it carried a selection; Local Gemma may fold a `<<<DOCUMENT>>>` envelope into the last user turn |
| 7 | `${lastUser.id}-comments-batch` | Comment-batch turn | Comment-batch instructions |

All system blocks get `createdAt: 0` — they are not ordered by creation time.

### 4.2 `DEFAULT_SYSTEM_MESSAGE` (verbatim)

```
You are a writing assistant. Be concise, preserve the user's voice, and emit one
proposed-edit fence per paragraph so edits can be accepted independently. Include
`rationale` per RATIONALE RULES; do not discuss those rules inside the rationale.
Escape JSON double-quotes as \".
```

### 4.3 `sys-current-doc` — the document outline

```ts
buildDocOutline(title, content, isCommentBatch)
```

> `isCommentBatch` is accepted and **ignored** (`void isCommentBatch`) — the outline is identical either way.

Output:

```
--- DOC "<title>" (<content.length> chars, <n> paras) ---
[p1]@0: <first 60 chars of paragraph 1>
[p2]@84: <first 60 chars of paragraph 2>
...
--- END DOC ---
```

- Paragraph boundaries are **every `\n`** (char code 10), via `splitParagraphs` in [`paragraphs.ts`](../src/utils/paragraphs.ts). Chat outlines, @-mention pickers, comment batches, and the re-anchor fallback share that helper.
- Each preview has whitespace collapsed to single spaces, is trimmed, then truncated at `OUTLINE_PREVIEW_CHARS = 60` on a word boundary, else ellipsised with `…` (`previewParagraph`).
- `trimOnWordBoundary` prefers a tail space within the last `max / 2` characters.

**This outline replaces the full document.** That single change cut comment-batch prompts by roughly 70% versus v0.4.0.

### 4.4 Local Gemma document envelope

When `proposedEditPolicy === 'on-demand'`, the open document is **not** sent as `sys-current-doc` outline. `buildFullWorkingDocMessage` inlines the **full** body (no char-cap / outline fallback) in:

```
<<<DOCUMENT>>>
<body>
<<<END DOCUMENT>>>
```

The LiteRT adapter lifts that envelope onto the user turn. Token budget is saved by **not duplicating** excerpts, not by truncating user text:

- Comment-batch user messages are compacted for the request (`compactCommentBatchForLocal`): keep `[cN] (paragraph …, doc offset S–E)` and `Comment:` bodies; drop snippet / Before / After (those spans are already in the envelope). Stored chat bubbles stay in the fat `formatCommentBatch` shape.
- `@` of the **current** document (whole **or** section) is suppressed; other documents are unchanged.
- **include selection:** if the highlight is a unique substring of the open document, emit an offset note; otherwise keep `BEGIN/END EDITOR SELECTION`.

### 4.5 `sys-proposed-edit-rules` — the fence schema

Always sent, never overridable:

````
To propose document edits, emit one fence per change (info-string exactly "proposed-edit"):

```proposed-edit
{
  "id": "<short id, e.g. p1>",
  "summary": "<one-line change description>",
  "rationale": "<REQUIRED: structured Markdown, ≥7 numbered points, ≥100 words, keywords bold+underlined — see RATIONALE RULES>",
  "original": "<verbatim substring from the document>",
  "replacement": "<new text>"
}
```

Rules:
- "original" MUST match the document byte-for-byte (spaces, newlines, punctuation). No paraphrase. If no exact match, skip that change.
- Copy "original" from the document; keep it short but unique. Document is authoritative.
- Multiple fences per reply OK. Optional prose outside fences is fine.
````

### 4.6 `PROPOSED_EDIT_RULES_DEFAULT` (verbatim)

```
RATIONALE RULES ("rationale" REQUIRED, non-empty, on every proposed-edit):
- Write in a clear, **structured** professional style that explains why the proposed edit is warranted. No marketing copy.
- GitHub-flavored Markdown (rendered in the comment popover). Prefer a numbered list; blank line between major points. Escape `"` as `\"` and newlines as `\n` inside JSON.
- ≥100 words total.
- ≥7 numbered points (1. … 2. … 3.1 … 3.2 … 3.3 … 4. … 5. …), each on its own line.
- Keywords MUST be both bold and underlined: wrap each as **<u>keyword</u>**. Emphasize key terms, obligations, and changed requirements — not whole sentences. No other raw HTML.
- Cover, in order:
  1. Pre-change: what the prior wording said, and what gap or problem it left (plain language).
  2. Post-change: what the amended wording now requires or clarifies (plain language).
  3. Why the change is necessary. Write exactly 3 sub-points, each ≥30 words:
     (3.1) Problem or weakness before the change (e.g. ambiguity, inconsistent standards, missing guidance, incomplete coverage).
     (3.2) How this amendment addresses that problem, and how the new wording improves this paragraph / section.
     (3.3) Why the document is stronger after the change (clarity, consistency with related sections, auditability).
  Do not mention these rules inside the rationale.
  4. How the amendment answers the reviewer's comment and strengthens this paragraph.
  5. Benefit to the broader document (cross-section consistency, readability, residual issues reduced).
- Full professional sentences, not fragments. Shown in the comment popover after Apply.
```

When the user has overridden the rules, the message becomes:

```
PROPOSED_EDIT_SCHEMA_RULES

RATIONALE RULES (AUTHORITATIVE — override any earlier rationale format. Follow exactly.
Do not quote or discuss these rules in the rationale; explain only the document change):

<user-override>
```

The override replaces **only** the rationale section. The schema reminder is always present.

> `normalizeRationaleRulesOverride` recognises three prior built-in eras by regex and collapses stale stored copies to `undefined`, so upgrading this constant reaches every user who never customised it. See [State & persistence §8](04-state-and-persistence.md#8-prompt-reconcilers).

### 4.7 `sys-referenced-doc-N`

One system message per ordered mention. Full rules in [@-references](09-mentions.md). Two behaviours worth stating here:

- **Self-reference suppression** — a whole-document mention of the *current* document is dropped, because the document is already in `sys-current-doc`. Section-scoped mentions of the current document are **kept** on the keyed (`eager`) path. Local Model (`on-demand`) also drops section mentions of the current document (the envelope already has the full body).
- **Dedupe key** — `<docId>::<kind>::<sortedParagraphsCSV>`. A section-scoped mention and a whole-document mention of the same document are distinct and both survive.

Budget: `REFERENCED_SECTION_CHARS_CAP = 4000` per document, `REFERENCED_DOCS_TOTAL_CHARS_CAP = 8000` per turn. Once the turn-wide budget is exhausted, later references **downgrade to the outline** rather than verbatim paragraphs.

### 4.8 `<lastUser.id>-comments-batch`

```
Latest user message is an inline-comment batch. Each block:
  [id] (paragraph N/M, doc offset S–E)
  "<verbatim snippet>"
  Before: """…"""
  After: """…"""
  Comment: <text>

Address every [id]: emit a proposed-edit fence, or briefly say why no edit is possible.
Consistency:
- Replacements must match the document's voice, terms, names, facts, numbers, style. Use Before/After and the doc outline.
- If one fix implies another change elsewhere, emit an extra proposed-edit; do not leave inconsistencies.
- On conflicting [id]s, prefer document coherence; note the conflict briefly.
- Tie replies to [id]s. Do not quote Before/After back.
```

The field labels here must match `formatCommentBatch` in [`utils/comments.ts`](../src/utils/comments.ts) on the keyed path. **Three places agree on the fat shape:** the formatter, the eager instruction block, and the `looksLikeCommentBatch` regex (which also matches the compact Local form).

**Local Model (`on-demand`)** uses a shorter instruction: header + `Comment:` only, and tells the model to copy `"original"` from `<<<DOCUMENT>>>` at the given offsets. Snippet / Before / After are not restated.

### 4.9 `enableCacheControl`

When `true`, stable system messages receive `metadata = CACHE_CONTROL_META` (`{ cache_control: { type: 'ephemeral' } }`). **It defaults to `false`** and `ChatPanel` passes `false` explicitly, so proxies that reject unknown fields do not fail.

### 4.10 Comment-batch detection

```ts
looksLikeCommentBatch(content) // → /\[c\d+\] \(paragraph\b[\s\S]*?Comment:/.test(content)
```

## 5. Secret redaction

[`utils/secrets.ts`](../src/utils/secrets.ts). Three patterns, replaced with the literal `[redacted]`:

```ts
const SECRET_PATTERNS: RegExp[] = [
  // OpenAI-style secret keys (sk-… / sk-proj-…)
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g,
  // Bearer tokens in prose
  /\bBearer\s+[A-Za-z0-9._\-+=/]{16,}/gi,
  // api_key / apikey / secret / token assignments
  /\b(?:api[_-]?key|secret|access[_-]?token|auth[_-]?token)\s*[:=]\s*['"]?[A-Za-z0-9._\-+=/]{16,}['"]?/gi,
];
const REDACTED = '[redacted]';
```

`redactSecretsInMessages(messages)` walks `content` and `selection` on each message and returns `{ messages, count }`. A message with no match keeps its original object reference so there is no needless allocation.

`ChatPanel` shows a banner when `count > 0`: `Redacted N secret-looking string(s) from this send.`

**The document itself is never rewritten.** Only the outbound payload is filtered.

## 6. The send pipeline

`ChatPanel.handleSend`:

1. Guard `currentDocumentId`, `!streaming`, `!ocrBusy`, and either non-empty text or at least one ready Chat **+** attachment.
2. `parseMentions(input)` strips sentinels → the plain text is the user message body.
3. **Auto-snapshot:** `saveRevision(documentId, 'Before AI send')`.
4. Reset local state; build `userMsg` with `selection` when `includeSelection`, and optional `attachments` (name / mime / raw extract).
5. `appendMessage` stores the typed prose. The request clone uses `withOutboundAttachmentPrompt` so the model sees a single format-then-answer body (`BEGIN ATTACHED FILE` + `BEGIN USER REQUEST`) when files are present. No pre-send `formatOcrAsMarkdown()` call.
6. **Local Model branch** (§7) or **keyed SSE branch**.
7. Both paths: append an empty `assistantMsg`, dispatch `mvp:chat-streaming { streaming: true }`, create an `AbortController`, build and redact the request, stream deltas into `updateLastAssistant`.
8. Errors: `AbortError` is silent; `ApiError` sets its message; anything else sets `err.message || 'Unknown error'`.
9. `finally`: `setStreaming(false)`, dispatch `mvp:chat-streaming { streaming: false }`, clear `abortRef`.

> Auto-snapshots happen on **chat send** and on **Apply All**. Individual card Apply does **not** snapshot — use the toolbar floppy disk or the history modal if you want a point-in-time restore before a single edit.

### `runAssistantReplyAfterCommit(extraMentions?)`

The streaming tail without the input-handling. Used by the rejection-commit path, which needs a follow-up turn that does not touch the chat textarea.

The user message is **not** a parameter: the caller has already appended it to the store, so the history snapshot already contains it. Passing it in and re-adding it would send the message body to the model **twice**.

### History snapshots — read BEFORE the append

Every send path builds its outbound history as `[...historyFromStore, ...newMessages]`. The `historyFromStore` snapshot must be read **before** the user message is appended to the store:

| Path | Snapshot taken | User message added by |
|---|---|---|
| `handleSend` | render closure (`messages`) | the spread |
| `onSendComments` (comment batch) | `getState().chats[docId]` **before** `appendMessage` | the spread |
| `runAssistantReplyAfterCommit` | `getState().chats[docId]` (already contains it) | the caller's earlier `appendMessage` |

Reading the snapshot after the append puts `userMsg` in the array twice. The model then sees the whole comment batch (or rejection body) twice — doubling the prompt size, which on the Local Model path is enough to blow the 8192-token KV cache. The bug is invisible in the UI because the chat bubble renders normally.

Regression test: `npm run test:send-comments-dup` parses `ChatPanel.tsx` and asserts the ordering.

## 6a. Local Model token counter

A rough estimate of what the **next** request will cost, shown only when the **Local Model** is the active provider (`!requiresApiKey(api.provider)`). The counter is a local-budget affordance, not a debug readout, so it is **decoupled from `debugMode`** — a keyed provider has no comparable budget to warn about and shows no counter at all.

| Surface | Shows |
|---|---|
| Chat composer (left of **Send**) | estimated tokens for the next chat send, plus `sent ~N` for the last completed send |
| Comment tray (next to **Send to AI**) | estimated tokens for the next comment batch |

### How the number is produced

`buildRequestPreview(...)` in [`chat.ts`](../src/api/chat.ts) calls `buildRequestMessages` with the same arguments the real send uses and returns `{ messages, tokens }`. The estimate is therefore derived from the **same packing function** as the real request — not a parallel reimplementation — so it includes the document outline / full body, the referenced-doc blocks, the comment batch, and the selection context.

`estimateMessageTokens` ([`tokenEstimate.ts`](../src/utils/tokenEstimate.ts)) sums `estimateTokens(content)` plus `TOKENS_PER_MESSAGE` (4) per message.

### The estimator

`estimateTokens` is a heuristic, not a tokenizer — deliberately, to avoid a dependency and per-keystroke compute:

- Latin text: `ceil(chars / 4)` — the same rule of thumb used by `scripts/measure-prompt.ts`.
- CJK text: ~1 token per character (SentencePiece splits most CJK characters individually).
- Whitespace-only text: 0.

The error direction is deliberate: for English prose the heuristic sits slightly **above** the true SentencePiece count, so it can warn that a prompt is too big when it technically still fits — but it will not let a prompt silently exceed the context window.

### Budget check

For the Local Model the prompt and the reply share one KV cache, so a full-length reply needs the prompt to fit in `LOCAL_MAX_NUM_TOKENS - LOCAL_MAX_OUTPUT_TOKENS` (8192 − 1024 = 7168) tokens. The pill turns amber above 90 % of that and red above it. Keyed providers have no comparable local budget, so no budget check is shown for them.

`LOCAL_MAX_NUM_TOKENS` and `LOCAL_MAX_OUTPUT_TOKENS` are exported from [`localGemma.ts`](../src/api/localGemma.ts) and used by the runtime itself, so the UI cannot drift from what the engine enforces.

### Performance

Both previews are debounced (250 ms) and skipped entirely when the Local Model is **not** the active provider, because the Local Model path inlines the whole document on every pack and `doc` gets a new identity on every editor keystroke.

The chat preview re-packs when the input, mentions, attachments, selection, chat history, or API settings change — it does **not** re-pack on document keystrokes. The comment-tray preview re-packs when the document, the comments, the chat history, or the API settings change, and it only runs for documents that actually have comments.

Tests: `npm run test:token-estimate`, `npm run test:token-counter-render`.

## 7. Local Model (`local-gemma`)

When `!requiresApiKey(api.provider)` the send path streams via LiteRT-LM instead of SSE:

1. Ensure the model is loaded (`ensureLocalGemmaReady` — Cache API, or prior disk load).
2. `buildRequestMessages(..., proposedEditPolicy: 'on-demand')`.
3. `splitMessagesForLocalGemma` — system preface + a single user turn (LiteRT history contract).
4. `createConversation` sets `sessionConfig.maxOutputTokens: LOCAL_MAX_OUTPUT_TOKENS` (1024) so decode shares the `LOCAL_MAX_NUM_TOKENS` (8192) KV cache with the prompt. Both are exported constants so the Local Model token counter measures against the same numbers the runtime enforces.
5. `streamLocalGemma` yields text chunks; `ChatPanel` mirrors the keyed assistant accumulator / AbortController lifecycle.
6. Fences in the reply still go through `parseProposedEdits` (on-demand: usually prose unless the user asked for edits or used Comment **Send to AI**).

Settings UI (`LocalGemmaControls`): download from Hugging Face into Cache API `apeditor-local-gemma-v1`, **Load from disk**, **Save to Disk** (File System Access or download fallback), **Last saved** filename + time, **Clear cached model**. Tips every 5% from `localGemmaTips.ts`. Predict and OCR→Markdown rewrite remain keyed-only.

## 8. Chat input context controls

| Control | Store field | Effect |
|---|---|---|
| **include selection** | `includeSelection` (default `true`) | Attaches the highlight on top of document context. Keyed path pastes the span; Local Model uses an offset note when the span is unique in the open document. |
| **paste selection ({count})** | — | Drops the current selection text straight into the input (no sentinel) |
| **+** (composer) | local `pendingAttachments` | Hidden file input, `accept={IMPORT_FILE_ACCEPT}` (`image/*,application/pdf`). In-browser OCR via `extractTextFromFiles`. Does not insert into the editor. |

**selection only** was removed in v0.6.4.

## 9. Editing or adding to the prompt contract

1. Change the constant in [`api/chat.ts`](../src/api/chat.ts).
2. If it is `DEFAULT_SYSTEM_MESSAGE` or `PROPOSED_EDIT_RULES_DEFAULT`, update the matching `isStale*` detector so already-persisted copies of the old built-in normalise away.
3. If you change `formatCommentBatch`'s output, update **both** comment-batch instruction blocks (`COMMENT_BATCH_INSTRUCTION_EAGER` / `_LOCAL`) and `looksLikeCommentBatch` / `compactCommentBatchForLocal`.
4. If you change `buildDocOutline`'s paragraph boundary, change `splitParagraphs` in [`paragraphs.ts`](../src/utils/paragraphs.ts) — heading sections and outline offsets import the same helper.
5. Run `npx vite-node scripts/measure-prompt.ts` to check the token impact.

## 10. Next

- Parsing and applying what comes back → [Proposed edits](08-proposed-edits.md)
- The referenced-document system messages → [@-references](09-mentions.md)
- Threats and mitigations → [Testing & security](14-testing-and-security.md)
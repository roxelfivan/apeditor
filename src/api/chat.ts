// Minimal OpenAI-compatible chat client. Works with MiniMax by default.
// The user supplies apiKey + apiEndpoint (and optionally model/systemMessage).
import type { ApiConfig, ChatMessage, DocumentRecord, MentionToken } from '@/types';
import { previewParagraph, splitParagraphs } from '@/utils/paragraphs';

/**
 * Built-in default system message. Single source of truth for the
 * "no override" path — chat, Settings, and persistence all import
 * this. Users can replace it via Settings (the empty value is
 * normalized back to this on save so future updates stay in sync).
 */
export const DEFAULT_SYSTEM_MESSAGE =
  "You are a writing assistant. Be concise, preserve the user's voice, " +
    "and emit one proposed-edit fence per paragraph so edits can be " +
    "accepted independently. Include `rationale` per RATIONALE RULES; " +
    "do not discuss those rules inside the rationale. Escape JSON " +
    'double-quotes as \\".';

/**
 * Build the final chat-completions URL. If the user provided a base URL
 * (no /chat/completions suffix), append it. Otherwise return as-is.
 */
export function resolveChatEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, '');
  if (!trimmed) return trimmed;
  if (/\/chat\/completions$/.test(trimmed)) return trimmed;
  if (/\/completions$/.test(trimmed)) return trimmed;
  if (/\/responses$/.test(trimmed)) return trimmed;
  return `${trimmed}/chat/completions`;
}

/**
 * Reject cleartext / non-http(s) endpoints before attaching a Bearer token.
 * Localhost over http is allowed for local proxy / self-hosted models.
 */
export function assertSafeChatEndpoint(endpoint: string): void {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new ApiError(
      'API endpoint must be an absolute URL (e.g. https://api.example.com/v1).'
    );
  }
  const host = url.hostname.toLowerCase();
  const isLocal =
    host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  if (url.protocol === 'https:') return;
  if (url.protocol === 'http:' && isLocal) return;
  throw new ApiError(
    `Refusing to send your API key to a non-HTTPS endpoint (${url.protocol}//${url.host}). Use https:// or a localhost http:// URL.`
  );
}

export class ApiError extends Error {
  status?: number;
  body?: string;
  constructor(message: string, status?: number, body?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

interface SendOptions {
  signal?: AbortSignal;
  onDelta: (delta: string) => void;
}

/**
 * Send a chat completion request and stream deltas via onDelta.
 * Resolves when the stream ends. Throws ApiError on failure.
 */
export async function streamChatCompletion(
  messages: ChatMessage[],
  config: ApiConfig,
  options: SendOptions
): Promise<void> {
  const endpoint = resolveChatEndpoint(config.apiEndpoint);
  if (!endpoint) {
    throw new ApiError('No API endpoint configured. Open Settings to set one.');
  }
  if (!config.apiKey) {
    throw new ApiError('No API key configured. Open Settings to set one.');
  }
  assertSafeChatEndpoint(endpoint);

  const body = {
    model: config.model,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    temperature: config.temperature,
    stream: true,
  };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new ApiError(
      `API request failed (${res.status}): ${text || res.statusText}`,
      res.status,
      text
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by \n\n
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return;
      if (!payload) continue;
      try {
        const json = JSON.parse(payload);
        const delta: string | undefined =
          json?.choices?.[0]?.delta?.content ??
          json?.choices?.[0]?.message?.content ??
          undefined;
        if (delta) options.onDelta(delta);
      } catch {
        // ignore malformed frame
      }
    }
  }
}

/**
 * Build the message array that gets sent to the API: system + history + current.
 * If a `selection` is present on the most recent user message, append a system
 * note telling the model what the highlighted text is.
 *
 * `referencedDocuments` are the @-mention tokens attached to the
 * user message (or to a comment batch that's about to be sent). For
 * each token we resolve the source document by id from
 * `documentLookup` (when provided) and append a separate
 * `sys-referenced-doc-N` system message with either the compact
 * outline (whole-doc mentions) or the verbatim paragraph text
 * (section-scoped mentions). Tokens whose source document is
 * missing from the lookup are dropped silently.
 *
 * Token-saving strategies applied here:
 *   1. Whole-doc mention that targets the *currently open* doc is
 *      suppressed — the doc is already in `sys-current-doc`.
 *   2. Composite dedupe key `(documentId, paragraphIndexes)` so a
 *      section + whole-doc combo on the same doc keeps the section
 *      instead of being silently overwritten.
 *   3. Turn-wide char cap on referenced-doc payload; once exhausted,
 *      trailing docs downgrade from verbatim to outline-only.
 *   4. Per-comment `[comment -> docs]` cross-reference map so the
 *      LLM knows which doc maps to which comment instead of
 *      re-reading everything.
 *   5. Optional `cache_control` metadata on stable system messages
 *      (Anthropic + OpenAI prompt-cache compatible); gated on
 *      `enableCacheControl` so proxies that reject unknown fields
 *      don't fail.
 */
export function buildRequestMessages(
  history: ChatMessage[],
  systemMessage: string | undefined,
  currentDocument?: { title: string; content: string; id?: string } | null,
  /**
   * Optional override for the rationale rules block. When the user
   * has customized `api.rationaleRulesOverride` in Settings, the
   * chat pipeline passes that string here. When undefined or empty,
   * the hard-coded `PROPOSED_EDIT_RULES_DEFAULT` is used so the
   * prompt stays sensible for callers that don't know about the
   * override (tests, other entry points).
   */
  rationaleRulesOverride?: string,
  /**
   * @-document references attached to the outgoing turn. Each token
   * resolves to a separate system message appended after
   * `sys-current-doc`. Pass `documentLookup` when the tokens point
   * at documents the caller does not already have in `currentDocument`
   * (i.e. always for chat; tests may skip it).
   */
  referencedDocuments?: MentionToken[],
  documentLookup?: (id: string) => DocumentRecord | null,
  /**
   * Per-comment grouping of mentions. Lets the prompt builder emit a
   * `[comment -> referenced docs]` cross-reference map so the LLM
   * can resolve each comment to its relevant doc(s) without
   * re-reading the whole referenced payload. Only emitted when the
   * current user turn is a comment batch AND the map has 2+ entries
   * (single-mention batches are obvious from the comment body
   * itself).
   */
  mentionsByCommentId?: Record<string, MentionToken[]>,
  /**
   * Set `true` to attach `cache_control` metadata on stable system
   * messages (`sys`, `sys-current-doc`, `sys-proposed-edit-rules`)
   * so providers that support prompt caching (Anthropic, OpenAI)
   * can cache them. Defaults to `false` so the default
   * OpenAI-compatible request shape is unchanged and unrecognized
   * proxies don't reject unknown fields.
   */
  enableCacheControl = false,
  /**
   * How to frame proposed-edit fences. `'eager'` (default) keeps the
   * historical Minimax/OpenAI contract. `'on-demand'` (Local Gemma)
   * prefers prose unless the user asks for document edits or this
   * turn is a comment batch.
   */
  proposedEditPolicy: ProposedEditPolicy = 'eager'
): ChatMessage[] {
  // Local Gemma uses a dedicated system contract (prose-by-default,
  // edits on request). Custom Settings systemMessage still wins.
  const effectiveSystem =
    (systemMessage && systemMessage.trim()) ||
    (proposedEditPolicy === 'on-demand'
      ? LOCAL_GEMMA_SYSTEM
      : DEFAULT_SYSTEM_MESSAGE);
  const out: ChatMessage[] = [];
  const stableMeta = enableCacheControl ? CACHE_CONTROL_META : undefined;
  // Stable-system-message helper: assigns `createdAt: 0` so the
  // ChatMessage shape is consistent with the rest of the system
  // blocks; threads `cache_control` metadata through `metadata`
  // when caching is enabled. Untyped callers don't have to know
  // about either detail.
  const push = (message: Omit<ChatMessage, 'createdAt'>) => {
    const base: ChatMessage = { ...message, createdAt: 0 };
    if (stableMeta) base.metadata = stableMeta;
    out.push(base);
  };
  if (effectiveSystem.trim()) {
    push({
      id: 'sys',
      role: 'system',
      content: effectiveSystem,
    });
  }
  // When the user kept the eager DEFAULT_SYSTEM_MESSAGE (or a custom
  // one that always asks for fences), still pin Local Gemma to
  // on-demand behavior via a short override. Skipped when the built-in
  // LOCAL_GEMMA_SYSTEM is already the effective system.
  if (
    proposedEditPolicy === 'on-demand' &&
    effectiveSystem !== LOCAL_GEMMA_SYSTEM
  ) {
    push({
      id: 'sys-response-mode',
      role: 'system',
      content: SYS_RESPONSE_MODE_ON_DEMAND,
    });
  }
  // Attach the currently-open document so the model can see it when the
  // user asks things like "read the document", "summarize this", etc.
  //
  // We push three separate system messages (rather than one giant
  // blob) so each role is independently inspectable / cacheable by
  // the provider and so the user's custom `systemMessage` stays
  // orthogonal to the edit schema:
  //   1. `sys-current-doc` — a short structural outline of the doc
  //      (paragraph starts + first 60 chars each) plus, only when
  //      the most recent user message is a comment batch, the
  //      verbatim text of the paragraphs that contain commented
  //      snippets. This keeps the prompt O(outline + referenced
  //      paragraphs) instead of O(full document) on every turn.
  //      Local Gemma instead gets a full-body envelope; comment
  //      batches are compacted so excerpts are not sent twice.
  //   2. `sys-proposed-edit-rules` — the proposed-edit fence schema
  //      and rules. Lifted out of the per-turn doc block so it
  //      reads as a stable contract, and so the user can keep their
  //      own `systemMessage` focused on tone / style.
  // Detect comment-batch once — used for the doc outline signal and
  // the per-batch instruction note below.
  const lastUser = [...history].reverse().find((m) => m.role === 'user');
  const isCommentBatch =
    !!lastUser && looksLikeCommentBatch(lastUser.content);
  const isLocalPack = proposedEditPolicy === 'on-demand';

  if (currentDocument && currentDocument.content.trim()) {
    const title = currentDocument.title?.trim() || 'Untitled';
    if (isLocalPack) {
      // Local Gemma: full body in a clean envelope (no outline
      // fallback — truncating the open document would drop user
      // text). The LiteRT adapter lifts this onto the user turn so
      // the small model cannot miss it.
      push({
        id: 'sys-current-doc',
        role: 'system',
        content: buildFullWorkingDocMessage(
          title,
          currentDocument.content
        ),
      });
    } else {
      push({
        id: 'sys-current-doc',
        role: 'system',
        content:
          `Open document "${title}". Treat the outline below as the ` +
          `working text when the user refers to "the document" / ` +
          `"this text".\n\n` +
          buildDocOutline(title, currentDocument.content, isCommentBatch),
      });
    }
    push({
      id: 'sys-proposed-edit-rules',
      role: 'system',
      content: buildProposedEditRulesMessage(
        rationaleRulesOverride,
        proposedEditPolicy
      ),
    });
  }

  // Append @-referenced documents as separate system messages so the
  // model can address them by title in the reply. Each token is one
  // message, numbered sequentially.
  // Dedupe key is (documentId, paragraphIndexes sort-key) so the
  // same doc referenced as both a whole-doc and a section-scoped
  // mention keeps the section (was being silently overwritten
  // before this refactor). Tokens whose source document is no
  // longer available in the lookup are dropped silently.
  if (referencedDocuments && referencedDocuments.length > 0) {
    // First: build a per-doc focus map so each referenced-doc
    // message can carry a `[context: c1+2 referenced as facts]`
    // line. Only emits the map system message when the current turn
    // is a comment batch AND there's more than one comment, since a
    // single-mention batch is already obvious from the body.
    const crossRefMap = isCommentBatch
      ? buildCrossReferenceMap(mentionsByCommentId, currentDocument?.id)
      : undefined;

    // Composite dedupe: (documentId, sorted paragraphIndexes key).
    const seen = new Map<string, MentionToken>();
    const ordered: { token: MentionToken; doc: DocumentRecord }[] = [];
    for (const token of referencedDocuments) {
      const key = dedupeKey(token);
      if (seen.has(key)) continue;
      const doc = documentLookup?.(token.documentId);
      if (!doc || !doc.content.trim()) continue;
      // Self-reference suppression: skipping mentions of the doc
      // already rendered in `sys-current-doc`. Keyed path keeps
      // section-scoped mentions (verbatim paragraphs vs outline).
      // Local Model already inlines the full body, so section
      // mentions of the current doc are also dropped.
      if (currentDocument?.id && token.documentId === currentDocument.id) {
        const wholeDoc =
          token.kind === 'doc' || token.paragraphIndexes.length === 0;
        if (wholeDoc || isLocalPack) {
          seen.set(key, token);
          continue;
        }
      }
      seen.set(key, token);
      ordered.push({ token, doc });
    }

    // Optionally emit the cross-reference map as its own system
    // message BEFORE the per-doc ones, so the LLM sees the index
    // first and knows which doc to pull from for which comment.
    if (crossRefMap) {
      push({
        id: `${lastUser!.id}-comments-xref`,
        role: 'system',
        content: crossRefMap,
      });
    }

    // Per-doc emitter. Tracks turn-wide char consumption so the
    // global cap (`REFERENCED_DOCS_TOTAL_CHARS_CAP`) downgrades
    // trailing docs to outline-only once exhausted.
    let totalConsumed = 0;
    let counter = 0;
    for (const { token, doc } of ordered) {
      const ctx: {
        totalConsumed: number;
        totalCap: number;
        focus?: ReferencedDocContext;
      } = {
        totalConsumed,
        totalCap: REFERENCED_DOCS_TOTAL_CHARS_CAP,
      };
      // Attach focus hint if any referrer pulls this doc in.
      const focus = computeFocusForDoc(token, mentionsByCommentId);
      if (focus) ctx.focus = focus;
      const message = buildReferencedDocMessage(token, doc, ctx);
      counter++;
      push({
        id: `sys-referenced-doc-${counter}`,
        role: 'system',
        content: message,
      });
      // Track the actual emitted length so the next doc's
      // `totalConsumed` reflects what we've already spent.
      totalConsumed += message.length;
      if (totalConsumed >= REFERENCED_DOCS_TOTAL_CHARS_CAP) {
        // Subsequent iterations will see the cap binding and
        // downgrade to outline-only via `buildReferencedDocMessage`.
        break;
      }
    }
  }
  for (const m of history) {
    if (m.role === 'system') continue;
    const packedUser =
      isLocalPack && m.role === 'user' && looksLikeCommentBatch(m.content)
        ? { ...m, content: compactCommentBatchForLocal(m.content) }
        : m;
    out.push(packedUser);
    if (m.role === 'user' && m.selection && m.selection.trim()) {
      out.push({
        id: `${m.id}-sel`,
        role: 'system',
        content: formatSelectionContext(
          m.selection,
          isLocalPack ? currentDocument?.content : undefined
        ),
        createdAt: 0,
      });
    }
  }

  // Comment-batch instruction: how to address each `[id]` block.
  // Keep eager labels in sync with `formatCommentBatch`. Local Model
  // omits snippet / Before / After (the envelope already has the body).
  if (lastUser && isCommentBatch) {
    out.push({
      id: `${lastUser.id}-comments-batch`,
      role: 'system',
      content: isLocalPack
        ? COMMENT_BATCH_INSTRUCTION_LOCAL
        : COMMENT_BATCH_INSTRUCTION_EAGER,
      createdAt: 0,
    });
  }

  return out;
}

/** Delimiters around editor highlights in outbound prompts. */
export function formatSelectionBlock(selection: string): string {
  return (
    `----- BEGIN EDITOR SELECTION -----\n` +
    `${selection.trimEnd()}\n` +
    `----- END EDITOR SELECTION -----`
  );
}

/**
 * Local Model: if the highlight is a unique substring of the open
 * document, point at offsets instead of pasting the same text again.
 * Ambiguous or missing matches keep the verbatim selection block.
 */
export function formatSelectionContext(
  selection: string,
  currentDocContent?: string
): string {
  const trimmed = selection.trimEnd();
  if (currentDocContent && trimmed) {
    const start = uniqueSubstringOffset(currentDocContent, trimmed);
    if (start !== null) {
      return (
        `Highlighted selection from the document: unique match at ` +
        `offset ${start}–${start + trimmed.length}. Copy that span ` +
        `from <<<DOCUMENT>>> (do not ask the user to paste it).`
      );
    }
  }
  return (
    `Highlighted selection from the document:\n\n` +
    formatSelectionBlock(selection)
  );
}

/** First index of `needle` in `haystack`, or null if missing / not unique. */
export function uniqueSubstringOffset(
  haystack: string,
  needle: string
): number | null {
  if (!needle) return null;
  const first = haystack.indexOf(needle);
  if (first < 0) return null;
  if (haystack.indexOf(needle, first + 1) >= 0) return null;
  return first;
}

/**
 * Build a composite dedupe key from a mention token. Two mentions
 * with the same key (same doc + same paragraph indexes, in any
 * order) collapse to one emission. Mentions with the same doc but
 * different paragraph indexes remain distinct, so a section +
 * whole-doc combo keeps both. Whole-doc tokens (`kind === 'doc'`
 * OR empty `paragraphIndexes`) collide on `documentId` alone.
 */
function dedupeKey(token: MentionToken): string {
  const paragraphs = [...token.paragraphIndexes].sort((a, b) => a - b);
  return `${token.documentId}::${token.kind}::${paragraphs.join(',')}`;
}

/**
 * For one doc, build the per-doc focus context — which comments
 * pulled it in (and with what reason). Used by the prompt builder
 * to enrich each `sys-referenced-doc-N` with a one-line
 * `[context: c1+2 referenced as facts]` hint so the LLM knows which
 * doc matters most for each commented passage.
 *
 * Returns `null` when no comment-level focus exists (chat-only
 * mentions or all mentions came from the same comment with the
 * default reason — no useful signal to emit).
 */
function computeFocusForDoc(
  token: MentionToken,
  mentionsByCommentId?: Record<string, MentionToken[]>
): ReferencedDocContext | null {
  if (!mentionsByCommentId) return null;
  const docId = token.documentId;
  const docTitle = token.documentTitle || 'Untitled';
  const referrerIds: string[] = [];
  const reasons = new Map<string, NonNullable<MentionToken['reason']>>();
  for (const [commentId, tokens] of Object.entries(mentionsByCommentId)) {
    for (const m of tokens) {
      if (m.documentId !== docId) continue;
      if (!referrerIds.includes(commentId)) {
        referrerIds.push(commentId);
        if (m.reason) reasons.set(commentId, m.reason);
      }
    }
  }
  if (referrerIds.length === 0) return null;
  return { title: docTitle, referrerIds, reasons };
}

/**
 * Build the per-comment `[comment -> referenced docs]` cross-
 * reference map. Only emitted when:
 *   - the current turn is a comment batch, AND
 *   - the map has >1 comment (single-comment batches are obvious
 *     from the body itself), AND
 *   - at least one comment actually has a mention attached.
 *
 * Each line is `c1 -> "Doc Title"@[p3,p7] (facts)`. Output stays
 * under ~400 chars on a 3-comment 2-doc map. The map itself does
 * not know paragraph numbers per doc up-front (a comment can pull
 * whole-doc or section-scoped), so we describe per-mention
 * `kind` instead: `whole` for whole-doc, `@[pN,pM]` for section.
 */
function buildCrossReferenceMap(
  mentionsByCommentId: Record<string, MentionToken[]> | undefined,
  _currentDocumentId: string | undefined
): string | undefined {
  if (!mentionsByCommentId) return undefined;
  const entries = Object.entries(mentionsByCommentId).filter(
    ([, tokens]) => tokens && tokens.length > 0
  );
  if (entries.length < 2) return undefined;
  const lines: string[] = [
    `[comment -> referenced docs] Each line tells you which ` +
      `referenced docs are most relevant to that comment. Use ` +
      `this to focus attention — do NOT re-read every referenced ` +
      `doc for every comment.`,
  ];
  for (const [commentId, tokens] of entries) {
    const refs = tokens
      .map((t) => describeMention(t))
      .filter((s) => s.length > 0);
    if (refs.length === 0) continue;
    lines.push(`${commentId} -> ${refs.join(' ; ')}`);
  }
  // Final safety: a single line with no actual references would be
  // pointless. Caller already requires >=2 comments; the
  // `refs.length === 0` filter above prunes the no-mentions case.
  if (lines.length <= 1) return undefined;
  return lines.join('\n');
}

/**
 * One-line description of a mention for the cross-reference map.
 * `whole` for whole-doc mentions, `§[p3,p7]` for section-scoped.
 * Truncates the title so a long doc title doesn't crowd the map.
 */
function describeMention(token: MentionToken): string {
  const titleRaw = (token.documentTitle || '').trim() || 'Untitled';
  const title =
    titleRaw.length > 32 ? titleRaw.slice(0, 31) + '…' : titleRaw;
  const where =
    token.kind === 'doc' || token.paragraphIndexes.length === 0
      ? 'whole'
      : `§[${[...token.paragraphIndexes]
          .map((p) => p + 1)
          .sort((a, b) => a - b)
          .join(',')}]`;
  const reason = token.reason && token.reason !== 'context' ? ` (${token.reason})` : '';
  return `"${title}"${where}${reason}`;
}

/**
 * Detect the comment-batch format emitted by `formatCommentBatch` in
 * `src/utils/comments.ts`. We require at least one `[id]` block
 * (the new shape is `[cN] (paragraph …)`) followed eventually by a
 * `Comment:` line. Matches `c1`, `c2`, … which is what the
 * serializer uses. Also matches the Local Model packed form that
 * omits snippet / Before / After.
 */
export function looksLikeCommentBatch(content: string): boolean {
  if (!content) return false;
  // At least one `[cN] (paragraph ...)` header followed by a
  // `Comment:` line somewhere later in the block.
  return /\[c\d+\] \(paragraph\b[\s\S]*?Comment:/.test(content);
}

const COMMENT_HEADER_RE = /^\[c\d+\] \(paragraph\b/;
const COMMENT_BODY_RE = /^Comment:/m;

/**
 * Strip duplicated document excerpts from a stored comment-batch
 * user message for Local Model packing. Keeps `[cN]` headers and
 * every `Comment:` body (including continuation lines). Idempotent
 * on an already-compact batch.
 */
export function compactCommentBatchForLocal(content: string): string {
  if (!looksLikeCommentBatch(content)) return content;
  const parts = content.split(/(?=\[c\d+\] \(paragraph\b)/);
  const out: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    if (!COMMENT_HEADER_RE.test(part)) {
      const trimmed = part.trimEnd();
      if (trimmed) out.push(trimmed);
      continue;
    }
    const headerLine = part.split('\n', 1)[0] ?? part;
    const commentMatch = part.match(COMMENT_BODY_RE);
    if (!commentMatch || commentMatch.index === undefined) {
      out.push(headerLine);
      continue;
    }
    const commentBlock = part.slice(commentMatch.index).trimEnd();
    out.push(`${headerLine}\n${commentBlock}`);
  }
  return out.join('\n\n').trimEnd() + '\n';
}

const COMMENT_BATCH_INSTRUCTION_EAGER =
  `Latest user message is an inline-comment batch. Each block:\n` +
  `  [id] (paragraph N/M, doc offset S–E)\n` +
  `  "<verbatim snippet>"\n` +
  `  Before: """…"""\n` +
  `  After: """…"""\n` +
  `  Comment: <text>\n\n` +
  `Address every [id]: emit a proposed-edit fence, or briefly ` +
  `say why no edit is possible.\n` +
  `Consistency:\n` +
  `- Replacements must match the document's voice, terms, ` +
  `names, facts, numbers, style. Use Before/After and the ` +
  `doc outline.\n` +
  `- If one fix implies another change elsewhere, emit an ` +
  `extra proposed-edit; do not leave inconsistencies.\n` +
  `- On conflicting [id]s, prefer document coherence; note ` +
  `the conflict briefly.\n` +
  `- Tie replies to [id]s. Do not quote Before/After back.`;

const COMMENT_BATCH_INSTRUCTION_LOCAL =
  `Latest user message is an inline-comment batch. Each block:\n` +
  `  [id] (paragraph N/M, doc offset S–E)\n` +
  `  Comment: <text>\n\n` +
  `The working text is already between <<<DOCUMENT>>> and ` +
  `<<<END DOCUMENT>>>. Copy "original" byte-for-byte from that ` +
  `body at the given offsets (not the markers).\n` +
  `Address every [id]: emit a proposed-edit fence, or briefly ` +
  `say why no edit is possible.\n` +
  `Consistency:\n` +
  `- Replacements must match the document's voice, terms, ` +
  `names, facts, numbers, style.\n` +
  `- If one fix implies another change elsewhere, emit an ` +
  `extra proposed-edit; do not leave inconsistencies.\n` +
  `- On conflicting [id]s, prefer document coherence; note ` +
  `the conflict briefly.\n` +
  `- Tie replies to [id]s.`;

/**
 * Proposed-edit fence schema + rules. Extracted from the per-turn
 * doc block so the rules are a stable contract: the user's
 * `systemMessage` is now free to focus on tone / style without
 * needing to mention the schema, and the rules themselves are
 * pushed as their own system message (separately inspectable /
 * cacheable) rather than being inlined into a giant doc block.
 *
 * Split into two parts so the user can override ONLY the
 * rationale-format rules without losing the JSON schema reminder
 * for the proposed-edit fence:
 *
 *   - `PROPOSED_EDIT_SCHEMA_RULES` — JSON shape, original /
 *     replacement byte-exact rules. Always sent.
 *   - `PROPOSED_EDIT_RULES_DEFAULT` — the rationale-format rules
 *     that follow. Replaced by `api.rationaleRulesOverride` when
 *     the user has customized them in Settings.
 *
 * The Settings modal's "Reset" button restores
 * `PROPOSED_EDIT_RULES_DEFAULT` exactly.
 */
/**
 * Eager (default) framing — used by Minimax / OpenAI. Encourages
 * proposed-edit fences as the primary reply shape.
 */
const PROPOSED_EDIT_SCHEMA_RULES: string =
  `To propose document edits, emit one fence per change ` +
  `(info-string exactly "proposed-edit"):\n\n` +
  '```proposed-edit\n' +
  `{\n` +
  `  "id": "<short id, e.g. p1>",\n` +
  `  "summary": "<one-line change description>",\n` +
  `  "rationale": "<REQUIRED: structured Markdown, ≥7 numbered points, ≥100 words, keywords bold+underlined — see RATIONALE RULES>",\n` +
  `  "original": "<verbatim substring from the document>",\n` +
  `  "replacement": "<new text>"\n` +
  `}\n` +
  '```\n\n' +
  `Rules:\n` +
  `- "original" MUST match the document byte-for-byte (spaces, ` +
  `newlines, punctuation). No paraphrase. If no exact match, skip ` +
  `that change.\n` +
  `- Copy "original" from the document; keep it short but unique. ` +
  `Document is authoritative.\n` +
  `- Multiple fences per reply OK. Optional prose outside fences ` +
  `is fine.\n\n`;

/**
 * On-demand framing — used by Local Gemma. Same JSON schema; fences
 * only when the user actually wants document changes. Rationale is
 * kept short so the small on-device model can finish a real edit.
 */
const PROPOSED_EDIT_SCHEMA_RULES_ON_DEMAND: string =
  `When the user asks to change, rewrite, edit, improve, propose, ` +
  `or elaborate on the open document (or any "paragraph" / "point" ` +
  `in it), emit one fence per change (info-string exactly ` +
  `"proposed-edit"). For pure questions or summaries, reply in ` +
  `markdown prose with no fences.\n\n` +
  '```proposed-edit\n' +
  `{\n` +
  `  "id": "p1",\n` +
  `  "summary": "Add ## heading above the lighthouse bullet",\n` +
  `  "rationale": "<2–5 sentences why this edit helps>",\n` +
  `  "original": "<verbatim substring copied from inside <<<DOCUMENT>>>",\n` +
  `  "replacement": "<improved text for that substring>"\n` +
  `}\n` +
  '```\n\n' +
  `Rules:\n` +
  `- "id" must be unique per fence (p1, p2, p3…) — never the word ` +
  `"proposed-edit".\n` +
  `- "summary" is a short human title of the change (what the user ` +
  `sees on the card). Never leave it blank or set it to ` +
  `"proposed-edit".\n` +
  `- "original" MUST be copied byte-for-byte from inside ` +
  `<<<DOCUMENT>>> … <<<END DOCUMENT>>> (not the markers, not ` +
  `instructions). Prefer one bullet or one short paragraph per fence.\n` +
  `- Never ask the user to paste the open document. A short list ` +
  `of bullets IS enough context — elaborate those lines in place.\n` +
  `- Multiple fences per reply when several points change.\n\n`;

/** Short rationale block for Local Gemma (replaces the 7-point memo). */
const PROPOSED_EDIT_RULES_LOCAL: string =
  `RATIONALE RULES (Local Gemma):\n` +
  `- 2–5 clear sentences. Markdown OK.\n` +
  `- Explain the document change only — do not discuss these rules.\n` +
  `- Escape " as \\" and newlines as \\n inside JSON.\n\n`;

/**
 * Built-in system contract for Local Gemma when the user has not set
 * a custom Settings system message. Replaces the eager
 * "emit one proposed-edit fence per paragraph" default.
 */
export const LOCAL_GEMMA_SYSTEM: string =
  `You are ApEditor's on-device writing assistant.\n` +
  `- Each user turn may include the open document between ` +
  `<<<DOCUMENT>>> and <<<END DOCUMENT>>>. That body is the working ` +
  `text.\n` +
  `- "the document", "the paragraph", "the points", "each point", ` +
  `or "this text" always mean that body. Never ask the user to ` +
  `paste or specify it again.\n` +
  `- Questions / summaries / explanations → normal markdown prose.\n` +
  `- Requests to propose, change, rewrite, edit, improve, or ` +
  `elaborate → proposed-edit fences that rewrite the listed lines ` +
  `in place (one fence per bullet or paragraph).\n` +
  `- Be concise. Preserve the user's voice.`;

/** How aggressively to push proposed-edit fences in the packed prompt. */
export type ProposedEditPolicy = 'eager' | 'on-demand';

const SYS_RESPONSE_MODE_ON_DEMAND: string =
  `RESPONSE MODE (AUTHORITATIVE — overrides any earlier instruction ` +
  `to always emit proposed-edit fences):\n` +
  `- Default: normal markdown prose.\n` +
  `- Emit proposed-edit fences when the user asks to change, rewrite, ` +
  `edit, improve, propose, or elaborate on document text, or on ` +
  `comment-batch Send to AI.\n` +
  `- The open document between <<<DOCUMENT>>> markers IS the text. ` +
  `Never ask the user to paste it. Elaborate short outlines in place.`;

/**
 * Default rationale-format rules. Sent when the user has not
 * customized `api.rationaleRulesOverride`. Exported for Settings Reset.
 * Replaced wholesale by the user's override (schema above is kept).
 *
 * Voice: structured professional memo explaining the edit.
 * Structure: 1, 2, 3.1, 3.2, 3.3, 4, 5 — ≥100 words; 3.1–3.3 each
 * ≥30 words. Markdown + bold/underline keywords.
 */
export const PROPOSED_EDIT_RULES_DEFAULT: string =
  `RATIONALE RULES ("rationale" REQUIRED, non-empty, on every ` +
  `proposed-edit):\n` +
  `- Write in a clear, **structured** professional style that ` +
  `explains why the proposed edit is warranted. No marketing copy.\n` +
  `- GitHub-flavored Markdown (rendered in the comment popover). ` +
  `Prefer a numbered list; blank line between major points. Escape ` +
  `" as \\" and newlines as \\n inside JSON.\n` +
  `- ≥100 words total.\n` +
  `- ≥7 numbered points (1. … 2. … 3.1 … 3.2 … 3.3 … 4. … 5. …), ` +
  `each on its own line.\n` +
  `- Keywords MUST be both bold and underlined: wrap each as ` +
  `**<u>keyword</u>**. Emphasize key terms, obligations, and ` +
  `changed requirements — not whole sentences. No other raw HTML.\n` +
  `- Cover, in order:\n` +
  `  1. Pre-change: what the prior wording said, and what gap or ` +
  `problem it left (plain language).\n` +
  `  2. Post-change: what the amended wording now requires or ` +
  `clarifies (plain language).\n` +
  `  3. Why the change is necessary. Write exactly 3 sub-points, ` +
  `each ≥30 words:\n` +
  `    (3.1) Problem or weakness before the change (e.g. ambiguity, ` +
  `inconsistent standards, missing guidance, incomplete coverage).\n` +
  `    (3.2) How this amendment addresses that problem, and how ` +
  `the new wording improves this paragraph / section.\n` +
  `    (3.3) Why the document is stronger after the change ` +
  `(clarity, consistency with related sections, auditability).\n` +
  `  Do not mention these rules inside the rationale.\n` +
  `  4. How the amendment answers the reviewer's comment and ` +
  `strengthens this paragraph.\n` +
  `  5. Benefit to the broader document (cross-section consistency, ` +
  `readability, residual issues reduced).\n` +
  `- Full professional sentences, not fragments. Shown in the ` +
  `comment popover after Apply.`;

/**
 * True when `text` is empty or identical to the current built-in
 * default (so callers should persist `undefined` and keep tracking
 * future built-in updates).
 */
export function isCurrentRationaleRulesDefault(
  text: string | undefined | null
): boolean {
  const trimmed = text?.trim() ?? '';
  return !trimmed || trimmed === PROPOSED_EDIT_RULES_DEFAULT.trim();
}

/**
 * Older builds showed the built-in default in Settings and, on Save,
 * wrote that full string into `rationaleRulesOverride` — freezing it
 * forever. Detect those stale frozen defaults (prior structured
 * default, pre-3a fence-shape, and 3a / Logical-reason era) so we
 * can fall back to the current structured-style built-in.
 */
export function isStaleRationaleRulesOverride(
  text: string | undefined | null
): boolean {
  const trimmed = text?.trim() ?? '';
  if (!trimmed || isCurrentRationaleRulesDefault(trimmed)) return false;
  // Prior structured built-in (bank policy / prudential fingerprint).
  const looksLikePriorStructuredBuiltin =
    /a bank \*\*policy\*\*, \*\*procedure\*\*, or \*\*guideline\*\*/i.test(
      trimmed
    ) || /prudential alignment/i.test(trimmed);
  // Pre-3a era default (fence-shape doc) and 3a-era default
  // (Logical reason).
  const looksLikeVeryOldBuiltin =
    /When you propose changes to the document above/i.test(trimmed) &&
    /one fence per change/i.test(trimmed);
  const looksLikeThreeAEraBuiltin =
    /\b3a\./i.test(trimmed) && /Logical reason/i.test(trimmed);
  return (
    looksLikePriorStructuredBuiltin ||
    looksLikeVeryOldBuiltin ||
    looksLikeThreeAEraBuiltin
  );
}

/**
 * Resolve the effective override for persistence / Settings display:
 * empty, current built-in, or a stale frozen built-in → `undefined`.
 */
export function normalizeRationaleRulesOverride(
  text: string | undefined | null
): string | undefined {
  const trimmed = text?.trim() ?? '';
  if (!trimmed) return undefined;
  if (isCurrentRationaleRulesDefault(trimmed)) return undefined;
  if (isStaleRationaleRulesOverride(trimmed)) return undefined;
  return trimmed;
}

/**
 * True when `text` is empty / a literal copy of the current default
 * system message / a recognizably stale writing-assistant default.
 */
export function isCurrentDefaultSystemMessage(
  text: string | undefined | null
): boolean {
  const trimmed = text?.trim() ?? '';
  if (!trimmed) return true;
  if (trimmed === DEFAULT_SYSTEM_MESSAGE.trim()) return true;
  return false;
}

/**
 * Older builds shipped a writing-assistant default system message
 * ("You are a writing assistant. Be concise, …"). Persisted
 * overrides that match the OLD built-in are treated as "no
 * override" so the live built-in is used and Settings shows it.
 */
export function isStaleDefaultSystemMessage(
  text: string | undefined | null
): boolean {
  const trimmed = text?.trim() ?? '';
  if (!trimmed) return false;
  if (isCurrentDefaultSystemMessage(trimmed)) return false;
  return /writing assistant/i.test(trimmed);
}

/**
 * Resolve the effective System Message override for persistence:
 * empty / current built-in / stale writing-assistant → `undefined`.
 */
export function normalizeSystemMessage(
  text: string | undefined | null
): string | undefined {
  const trimmed = text?.trim() ?? '';
  if (!trimmed) return undefined;
  if (isCurrentDefaultSystemMessage(trimmed)) return undefined;
  if (isStaleDefaultSystemMessage(trimmed)) return undefined;
  return trimmed;
}

/**
 * Schema rules + rationale rules (default or user override).
 * Override replaces only the rationale section. Schema framing
 * depends on `proposedEditPolicy` (eager vs on-demand).
 */
function buildProposedEditRulesMessage(
  rationaleRulesOverride: string | undefined,
  proposedEditPolicy: ProposedEditPolicy = 'eager'
): string {
  const schema =
    proposedEditPolicy === 'on-demand'
      ? PROPOSED_EDIT_SCHEMA_RULES_ON_DEMAND
      : PROPOSED_EDIT_SCHEMA_RULES;
  const trimmed = normalizeRationaleRulesOverride(rationaleRulesOverride);
  if (!trimmed) {
    return (
      schema +
      (proposedEditPolicy === 'on-demand'
        ? PROPOSED_EDIT_RULES_LOCAL
        : PROPOSED_EDIT_RULES_DEFAULT)
    );
  }
  // AUTHORITATIVE header: treat override as format rules for
  // `rationale`, not content to discuss; ignore conflicting earlier
  // length/structure hints (e.g. a stale System message).
  return (
    schema +
    `RATIONALE RULES (AUTHORITATIVE — override any earlier ` +
    `rationale format. Follow exactly. Do not quote or discuss ` +
    `these rules in the rationale; explain only the document ` +
    `change):\n` +
    trimmed
  );
}

/**
 * Full working-document envelope for Local Gemma. Markers are
 * instructions only — `"original"` must quote the body between them,
 * never the markers themselves (the old `--- DOC ---` wrapper was
 * being copied into proposed-edit originals). Always inlines the
 * full body; Local packing saves tokens by not duplicating excerpts
 * elsewhere, not by truncating the open document.
 */
export function buildFullWorkingDocMessage(
  title: string,
  content: string
): string {
  const header =
    `Open document "${title}". Text between <<<DOCUMENT>>> and ` +
    `<<<END DOCUMENT>>> is the working text. "the document" / ` +
    `"the paragraph" / "the points" / "each point" refer to it. ` +
    `Do not ask the user to paste it. Quote "original" only from ` +
    `inside the markers.\n\n`;
  return (
    header +
    `<<<DOCUMENT>>>\n` +
    content +
    `\n<<<END DOCUMENT>>>`
  );
}

/**
 * Compact doc outline for `sys-current-doc`: title, size, and one
 * ~60-char preview line per paragraph. Far cheaper than sending the
 * full document. The `isCommentBatch` flag is a coarse signal — the
 * outline stays cheap either way; comment batches rely on
 * Before/After context in `formatCommentBatch` for byte-exact matches.
 */
export function buildDocOutline(
  title: string,
  content: string,
  isCommentBatch: boolean
): string {
  // `isCommentBatch` is reserved for future expansion (e.g. inlining
  // referenced paragraphs). Keeping the parameter so callers can stay
  // stable; the outline itself does not depend on it yet.
  void isCommentBatch;
  const starts = splitParagraphs(content);

  const lines: string[] = [];
  lines.push(
    `--- DOC "${title}" (${content.length} chars, ${starts.length} paras) ---`
  );
  for (let p = 0; p < starts.length; p++) {
    const start = starts[p];
    const end = p + 1 < starts.length ? starts[p + 1] : content.length;
    lines.push(
      `[p${p + 1}]@${start}: ${previewParagraph(content.slice(start, end))}`
    );
  }
  lines.push('--- END DOC ---');
  return lines.join('\n');
}

/**
 * Hard cap on the total characters inlined from section-scoped
 * referenced documents. When the picked paragraphs exceed this we
 * fall back to a compact outline and append a truncation note so
 * the model still has orientation but the prompt stays bounded.
 */
const REFERENCED_SECTION_CHARS_CAP = 4000;

/**
 * Sum across all referenced-doc system messages in a single turn.
 * Once exceeded, subsequent referenced docs downgrade from verbatim
 * sections to outlines-only so the prompt stays bounded. Tuned so a
 * 2-doc comment batch with section picks stays verbatim on both; a
 * 3+ doc batch sees the trailing doc(s) downgrade. Mirrors the
 * "CHUNK_SIZE = 6000" pattern from Obsidian Copilot's
 * `src/constants.ts`, but per-turn instead of per-message because
 * @-mention traffic is dense in this app.
 */
export const REFERENCED_DOCS_TOTAL_CHARS_CAP = 8000;

/**
 * Stable system messages (`sys`, `sys-current-doc`,
 * `sys-proposed-edit-rules`) repeat verbatim across many turns and
 * are prime candidates for the provider's prompt cache. The
 * `cache_control` metadata field is honored by Anthropic and
 * OpenAI's prompt-caching APIs. Feature-flagged via
 * `enableCacheControl` in `buildRequestMessages` so proxies that
 * reject unknown fields do not break.
 */
export const CACHE_CONTROL_META: Record<string, unknown> = {
  cache_control: { type: 'ephemeral' },
};

/**
 * Context threaded through the referenced-doc emitter. The accumulator
 * lets the builder downgrade a doc to outline-only when the turn-wide
 * cap is exhausted; `referrerMap` lets it emit a per-doc focus hint
 * (which `Comment` referenced this doc, and with what reason) so the
 * LLM can prioritize the most relevant passage.
 */
export interface ReferencedDocContext {
  /** Title of the doc — cached so the focus hint can address it
   * without re-resolving. */
  title: string;
  /** Set of comment ids that pulled this doc in. Empty for
   * chat-only mentions. Sorted/deduped at the call site. */
  referrerIds: string[];
  /** Map of comment id -> reason for this doc; populated only when
   * distinct comments have distinct reasons. Falls back to
   * the token's `reason` when no comment-specific reason exists. */
  reasons: Map<string, NonNullable<MentionToken['reason']>>;
}

/**
 * Build the system message for a single @-referenced document.
 * Whole-doc mentions get the same compact outline used for the
 * current document (token-cheap, lets the model address the doc
 * by title without seeing the full text). Section-scoped mentions
 * get the verbatim paragraph text for the picked indexes (capped),
 * so the model can quote / propose edits against the exact passage.
 *
 * Public + shared so Local Gemma (and other non-SSE paths) reuse the
 * exact same outline-vs-
 * sectioned logic instead of duplicating a raw-text truncation.
 *
 * @param token             the @-mention token for this doc
 * @param doc               the resolved `DocumentRecord`
 * @param ctx.totalConsumed  chars already spent on referenced docs
 *                           in this turn (used to enforce
 *                           `REFERENCED_DOCS_TOTAL_CHARS_CAP`)
 * @param ctx.totalCap       per-turn cap on referenced-doc chars
 * @param ctx.focus          optional per-doc focus hint
 *                           (referrerIds / reasons), when the
 *                           comment batch supplies a cross-
 *                           reference map
 */
export function buildReferencedDocMessage(
  token: MentionToken,
  doc: DocumentRecord,
  ctx: {
    totalConsumed: number;
    totalCap: number;
    focus?: ReferencedDocContext;
  } = { totalConsumed: 0, totalCap: REFERENCED_DOCS_TOTAL_CHARS_CAP }
): string {
  const title = (doc.title || token.documentTitle || 'Untitled').trim();
  const reason = token.reason ?? 'context';

  const focusLine = ctx.focus
    ? buildReferencedDocFocusLine(ctx.focus, reason)
    : '';

  // Whole-doc mention — outline only.
  if (token.kind === 'doc' || token.paragraphIndexes.length === 0) {
    return (
      `Referenced document: "${title}". ` +
      `Treat the outline below as the working text when the user ` +
      `refers to it by name.` +
      `${focusLine ? ` ${focusLine}` : ''}\n\n` +
      buildDocOutline(title, doc.content, false)
    );
  }

  const starts = splitParagraphs(doc.content);
  const picked: number[] = [];
  for (const idx of token.paragraphIndexes) {
    if (idx >= 0 && idx < starts.length) picked.push(idx);
  }
  // Bad indexes (deleted paragraphs, drifted offsets) → fall back to
  // outline so the prompt is never empty for this token.
  if (picked.length === 0) {
    return (
      `Referenced document: "${title}". ` +
      `The user picked sections, but none could be located; falling ` +
      `back to the outline.` +
      `${focusLine ? ` ${focusLine}` : ''}\n\n` +
      buildDocOutline(title, doc.content, false)
    );
  }

  // Per-doc cap (= REFERENCED_SECTION_CHARS_CAP) keeps one doc from
  // drowning the prompt on its own; turn-wide cap (=
  // REFERENCED_DOCS_TOTAL_CHARS_CAP) prevents multi-doc fans from
  // stacking up.
  const remainingBudget = Math.max(
    0,
    Math.min(REFERENCED_SECTION_CHARS_CAP, ctx.totalCap - ctx.totalConsumed)
  );
  // Below the turn-wide budget — emit verbatim.
  if (remainingBudget > 256) {
    const sections: string[] = [];
    let used = 0;
    for (const idx of picked) {
      const start = starts[idx];
      const end =
        idx + 1 < starts.length ? starts[idx + 1] : doc.content.length;
      const slice = doc.content.slice(start, end);
      if (used + slice.length > remainingBudget) {
        // Per-doc cap was the binding constraint — emit the partial
        // slice (truncation note appended below).
        if (sections.length === 0) {
          // First slice already exceeds the per-doc cap — emit a
          // truncated version of just the first paragraph.
          sections.push(
            `[p${idx + 1}]\n` + truncateSliceOnWordBoundary(slice, remainingBudget)
          );
          return (
            `Referenced document: "${title}". ` +
            `Sections picked by the user (verbatim — quote / propose edits ` +
            `against this exact text; remaining sections omitted to fit the ` +
            `prompt budget).` +
            `${focusLine ? ` ${focusLine}` : ''}\n\n` +
            sections.join('') +
            `\n…(remaining sections omitted)…`
          );
        }
        return (
          `Referenced document: "${title}". ` +
          `Sections picked by the user (verbatim — quote / propose edits ` +
          `against this exact text).\n\n` +
          sections.join('') +
          `\n…(remaining sections omitted — referenced-doc budget exhausted)…`
        );
      }
      sections.push(`[p${idx + 1}]\n${slice}`);
      used += slice.length;
    }
    return (
      `Referenced document: "${title}". ` +
      `Sections picked by the user (verbatim — quote / propose edits ` +
      `against this exact text).` +
      `${focusLine ? ` ${focusLine}` : ''}\n\n` +
      sections.join('')
    );
  }

  // Turn-wide budget exhausted — downgrade to outline-only and
  // annotate so the model still has orientation.
  return (
    `Referenced document: "${title}". ` +
    `Sections picked but truncated to fit the turn-wide prompt budget — ` +
    `refer to the outline below for orientation.` +
    `${focusLine ? ` ${focusLine}` : ''}\n\n` +
    buildDocOutline(title, doc.content, false)
  );
}

/**
 * Render a one-line focus hint for a referenced doc — which
 * `Comment`(s) pulled it in and with what reason. Single line so
 * the hint itself stays cheap (≤40 chars typically).
 */
function buildReferencedDocFocusLine(
  focus: ReferencedDocContext,
  fallbackReason: NonNullable<MentionToken['reason']>
): string {
  if (focus.referrerIds.length === 0) return '';
  const reasons = focus.reasons;
  // Resolve a single representative reason (most common, deterministic
  // — earliest comment wins ties).
  const representative =
    focus.referrerIds
      .map((id) => reasons.get(id) ?? fallbackReason)
      .sort()
      .reduce(
        (best, cur) =>
          cur === 'facts' || cur === 'compare' ? cur : best,
        fallbackReason
      ) ?? fallbackReason;
  const idPreview =
    focus.referrerIds.length === 1
      ? `[${focus.referrerIds[0]}]`
      : `[${focus.referrerIds[0]}+${focus.referrerIds.length - 1}]`;
  return `[context: ${idPreview} referenced as ${representative}]`;
}

/**
 * Trim `s` to at most `max` characters, ending on a word boundary
 * when feasible. Used when a single paragraph would blow the
 * per-doc cap so we keep the start of the passage verbatim instead
 * of silently dropping it.
 */
function truncateSliceOnWordBoundary(s: string, max: number): string {
  if (s.length <= max) return s;
  const sliced = s.slice(0, max);
  const sp = sliced.lastIndexOf(' ');
  if (sp > max / 2) return sliced.slice(0, sp) + ' …';
  return sliced + ' …';
}

// Cheap, dependency-free token estimation for the Local Model counters.
//
// WHY A HEURISTIC, NOT A TOKENIZER
// -------------------------------
// The point of these numbers is to answer "will my prompt fit the
// budget?" — e.g. the Local Model's 8192-token LiteRT KV cache, of
// which 1024 is reserved for the reply's decode. A real BPE tokenizer
// would buy accuracy we do not need, at the cost of bundle size and
// per-keystroke compute. The rule of thumb below is the same one the
// prompt-size script already uses (see `scripts/measure-prompt.ts`):
// roughly 1 token per 4 characters of English prose.
//
// WHICH DIRECTION THE ERROR GOES
// ------------------------------
// Gemma uses a SentencePiece vocabulary, and CJK text is far denser in
// tokens per character than English (roughly 1 token per 1–2 chars
// rather than per 4). We count CJK characters as ~1 token each, which
// keeps the estimate honest for non-English documents.
//
// For English prose this heuristic sits slightly ABOVE the true count
// for SentencePiece and close to it for BPE. Over-estimating is the
// safe direction for this feature: it can warn the user that a prompt
// is too big when it technically still fits, but it will not let a
// prompt silently blow the context window.
//
// Pure module — no React, no DOM, no imports.

import type { ChatMessage } from '@/types';

/**
 * Average characters per token for English prose. Matches the
 * approximation used by `scripts/measure-prompt.ts` and OpenAI's own
 * guidance for GPT-3.5/4 content blocks.
 */
export const CHARS_PER_TOKEN = 4;

/**
 * Per-message overhead for the role marker and the message framing
 * that the provider wraps around each content block (roughly
 * `<|im_start|>role\n…<|im_end|>\n`). Small, but it adds up across a
 * long chat history and it keeps the estimate from reading as
 * "0 tokens" for an empty conversation.
 */
export const TOKENS_PER_MESSAGE = 4;

/**
 * Token cost of a single CJK character. SentencePiece splits most
 * CJK characters into one token each, and common ones into more, so
 * 1 is a fair floor.
 */
const CJK_TOKENS_PER_CHAR = 1;

/**
 * Matches the CJK + fullwidth punctuation ranges that SentencePiece
 * treats as one token per character.
 */
const CJK_RE =
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/g;

/**
 * Estimate how many tokens `text` will cost.
 *
 * Counts CJK characters at ~1 token each and everything else at
 * ~1 token per `CHARS_PER_TOKEN` characters. Whitespace-only text
 * costs nothing.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  let cjk = 0;
  CJK_RE.lastIndex = 0;
  while (CJK_RE.exec(text) !== null) {
    cjk++;
  }
  if (cjk === text.length) {
    // Pure CJK — skip the ASCII division entirely.
    return cjk * CJK_TOKENS_PER_CHAR;
  }

  // Whitespace carries no tokens of its own, but it does occupy space
  // in the token stream, so count the non-whitespace remainder.
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const rest = trimmed.length - cjk;
  return cjk * CJK_TOKENS_PER_CHAR + Math.ceil(rest / CHARS_PER_TOKEN);
}

/**
 * Estimate the total prompt cost of a packed message array — the
 * system blocks, the history, and the outgoing user turn.
 *
 * Use this on the output of `buildRequestMessages` so the number
 * reflects what actually goes on the wire (the document outline, the
 * referenced-doc blocks, the comment batch, …) rather than just the
 * text the user typed.
 */
export function estimateMessageTokens(messages: ChatMessage[]): number {
  let total = 0;
  for (const m of messages) {
    total += estimateTokens(m.content ?? '') + TOKENS_PER_MESSAGE;
  }
  return total;
}

/**
 * Format a token count for the debug pills: `1,240` (thousands
 * separated, no decimals).
 */
export function formatTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return '0';
  return Math.round(tokens).toLocaleString('en-US');
}

import type { MentionToken, ProposedEdit } from '@/types';
import { parseMentions as parseMentionsFromSentinels } from '@/utils/mentions/parseMentions';

export type ProposedEditSegment =
  | { kind: 'text'; payload: string }
  | { kind: 'edit'; payload: ProposedEdit };

/**
 * Split an assistant reply into segments. Fenced code blocks whose
 * info-string is exactly `proposed-edit` and whose body parses as a valid
 * `ProposedEdit` JSON object become `kind: 'edit'` segments. Everything
 * else (regular prose, malformed fences, normal code fences) becomes
 * `kind: 'text'` so it falls through to the markdown renderer.
 *
 * The regex matches the smallest possible opening fence so a fence inside
 * another fence isn't accidentally consumed.
 */
export function parseProposedEdits(content: string): ProposedEditSegment[] {
  let segments: ProposedEditSegment[] = [];
  const fenceRe = /```([^\n`]*)\n([\s\S]*?)(?:```|$)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = fenceRe.exec(content)) !== null) {
    const [full, infoString, body] = m;
    const start = m.index;
    if (start > lastIndex) {
      segments.push({ kind: 'text', payload: content.slice(lastIndex, start) });
    }

    if (infoString.trim() === 'proposed-edit') {
      const edit = tryParseEdit(body);
      if (edit) {
        segments.push({ kind: 'edit', payload: edit });
      } else {
        segments.push({ kind: 'text', payload: full });
      }
    } else {
      segments.push({ kind: 'text', payload: full });
    }
    lastIndex = start + full.length;
  }

  if (lastIndex < content.length) {
    segments.push({ kind: 'text', payload: content.slice(lastIndex) });
  }

  // Rescue pass: if no edit segments were produced (or even if some
  // were), scan the text segments for raw JSON objects that look like
  // `ProposedEdit` and split them out. The AI sometimes emits the JSON
  // without the `proposed-edit` fence, and we want to show a card
  // anyway rather than dumping the raw JSON to the user.
  segments = rescueRawJsonEdits(segments);
  return segments;
}

/**
 * Walk every `text` segment looking for JSON objects with the four
 * `ProposedEdit` fields (`id`, `summary`, `original`, `replacement`).
 * Each match is split out into its own `edit` segment, with the JSON
 * itself replaced by a placeholder note so the user knows the AI
 * skipped the fence.
 */
function rescueRawJsonEdits(
  segments: ProposedEditSegment[]
): ProposedEditSegment[] {
  const out: ProposedEditSegment[] = [];
  // The JSON object regex matches a top-level `{` followed by
  // `"id"` / `"summary"` / `"original"` / `"replacement"` string
  // properties, then balanced braces. We allow unescaped `"` inside the
  // string values so we can rescue AI output that contains
  // double-quoted phrases like `"Higher or Equal"`. `tryParseEdit` will
  // still reject anything that doesn't actually parse.
  const jsonRe = /\{\s*"id"\s*:\s*"[^"]+"\s*,\s*"summary"\s*:\s*"[\s\S]*?"\s*,\s*"original"\s*:\s*"[\s\S]*?"\s*,\s*"replacement"\s*:\s*"[\s\S]*?"\s*\}/g;
  for (const seg of segments) {
    if (seg.kind !== 'text') {
      out.push(seg);
      continue;
    }
    const text = seg.payload;
    let cursor = 0;
    let mm: RegExpExecArray | null;
    jsonRe.lastIndex = 0;
    while ((mm = jsonRe.exec(text)) !== null) {
      const start = mm.index;
      const end = start + mm[0].length;
      if (start > cursor) {
        out.push({ kind: 'text', payload: text.slice(cursor, start) });
      }
      const edit = tryParseEditLenient(mm[0]);
      if (edit) {
        out.push({ kind: 'edit', payload: edit });
      } else {
        out.push({ kind: 'text', payload: mm[0] });
      }
      cursor = end;
    }
    if (cursor < text.length) {
      out.push({ kind: 'text', payload: text.slice(cursor) });
    }
  }
  return out;
}

/**
 * Strip paragraph-reference markers (e.g. `[p10]@354`) that the chat
 * pipeline injects so the LLM knows which paragraph the user picked.
 * The model sometimes echoes those back inside `original` / `replacement`,
 * and they should never land in the user's document. Also strips a
 * trailing `@<digits>` if the brackets were dropped.
 */
function stripParagraphReferences(s: string): string {
  if (!s) return s;
  let out = s.replace(/\s*\[p\d+\]@?\d*/gi, '');
  out = out.replace(/\s+@\d+(?=\s|$)/g, '');
  // Collapse multiple blank lines left over after removal.
  out = out.replace(/[ \t]{2,}/g, ' ');
  return out;
}

/**
 * Try `tryParseEdit` first; on failure, attempt a tolerant repair by
 * escaping unescaped `"` characters that appear inside the AI's string
 * values. The AI frequently emits strings containing literal double
 * quotes (e.g. `"Higher or Equal"`) without escaping them, which makes
 * the surrounding JSON invalid.
 */
function tryParseEditLenient(body: string): ProposedEdit | null {
  const direct = tryParseEdit(body);
  if (direct) return direct;
  // Extract the string values with a tolerant regex, then re-build
  // a valid JSON object. Use a non-greedy match that allows nested
  // quotes so we can capture phrases like `"Higher or Equal"`. The
  // `rationale` field is optional for backward compatibility with
  // older AI replies; we default to an empty string when missing.
  const id = extractJsonString(body, 'id');
  const summary = extractJsonString(body, 'summary');
  const originalRaw = extractJsonString(body, 'original');
  const replacementRaw = extractJsonString(body, 'replacement');
  if (id && summary && originalRaw !== null && replacementRaw !== null) {
    const rationale = extractJsonString(body, 'rationale') ?? '';
    // Strip @-mention sentinels + paragraph refs.
    const strip = (s: string) =>
      stripParagraphReferences(parseMentionsFromSentinels(s).plain);
    return {
      id,
      summary,
      rationale,
      original: strip(originalRaw),
      replacement: strip(replacementRaw),
    };
  }
  return null;
}

function extractJsonString(body: string, key: string): string | null {
  // Find `"key":` then capture everything up to the next `,` or `}`
  // that is followed by a known field, or to the closing `}`. We
  // require the match to start with `"` so the AI's value is quoted.
  const keyRe = new RegExp(`"${key}"\\s*:\\s*"`, 'g');
  const m = keyRe.exec(body);
  if (!m) return null;
  const start = m.index + m[0].length;
  // Walk forward, tracking backslash escapes. Stop at the first `"` that
  // is followed by `,` or `}` or end-of-string — this heuristic gives
  // us a tolerant end-of-string detection.
  let i = start;
  while (i < body.length) {
    const c = body[i];
    if (c === '\\' && i + 1 < body.length) {
      i += 2;
      continue;
    }
    if (c === '"') {
      // Look ahead for a `,` or `}` (with optional whitespace) — if
      // present, treat this as the closing quote.
      let j = i + 1;
      while (j < body.length && /\s/.test(body[j])) j++;
      if (j >= body.length || body[j] === ',' || body[j] === '}') {
        return body.slice(start, i);
      }
    }
    i++;
  }
  return null;
}

function tryParseEdit(body: string): ProposedEdit | null {
  try {
    const obj = JSON.parse(body);
    if (
      obj &&
      typeof obj.id === 'string' &&
      typeof obj.summary === 'string' &&
      typeof obj.original === 'string' &&
      typeof obj.replacement === 'string'
    ) {
      // `rationale` is optional; older replies may not include it.
      // Empty string is treated the same as missing by the UI.
      const rationale =
        typeof obj.rationale === 'string' ? obj.rationale : '';
      // Strip @-mention sentinels + paragraph refs from original/replacement
      // so they don't leak as raw text into the diff preview or the
      // document after Apply (e.g. "[p33] @1184" or "[p10]@354").
      const strip = (s: string) =>
        stripParagraphReferences(parseMentionsFromSentinels(s).plain);
      return {
        id: obj.id,
        summary: obj.summary,
        rationale,
        original: strip(obj.original),
        replacement: strip(obj.replacement),
      };
    }
  } catch {
    // fall through
  }
  return null;
}

export type ApplyEditResult =
  | {
      ok: true;
      next: string;
      /**
       * The byte range that was replaced in the source `content`.
       * `idx` is the position of the matched original, and
       * `end = idx + length` is the end of the inserted
       * replacement in `next`. Useful for re-anchoring comments
       * to the adopted text.
       */
      anchor: { idx: number; length: number };
    }
  | { ok: false; reason: 'anchor-missing' };

/**
 * Locate the substring of `content` that should be replaced for a
 * `proposed-edit` block. The AI is told to emit a verbatim substring, but
 * in practice it often emits text that differs from the document by
 * leading/trailing whitespace, line endings, or a single collapsed
 * whitespace run (e.g. when the user re-flowed the paragraph). We try a
 * sequence of progressively looser searches so Apply still works on
 * these near-matches. Returns the index and the actual span that matched
 * (so the caller can slice with the matched length, not the AI's
 * `original` length).
 */
export function findEditAnchor(
  content: string,
  original: string
): { idx: number; length: number } | null {
  if (!content) return null;
  // An empty `original` would `indexOf` to 0 in every string, so the
  // card would always render as "found". Reject that explicitly so the
  // disabled-state message still appears.
  if (!original) return null;

  // 1) Exact match.
  let idx = content.indexOf(original);
  if (idx !== -1) {
    return { idx, length: original.length };
  }

  // 2) Trimmed match.
  const trimmed = original.trim();
  if (trimmed && trimmed !== original) {
    idx = content.indexOf(trimmed);
    if (idx !== -1) {
      return { idx, length: trimmed.length };
    }
  }

  // 3) Whitespace-collapsed regex match. Any run of whitespace in the
  // AI's text matches any run of whitespace in the document.
  const collapsed = original.replace(/\s+/g, ' ').trim();
  if (collapsed && collapsed !== original) {
    const escaped = collapsed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped.replace(/ /g, '\\s+'));
    const m = re.exec(content);
    if (m) {
      return { idx: m.index, length: m[0].length };
    }
  }

  // 4) Setext heading normalisation. The AI sometimes writes
  //    `Title\n-------\n` (Setext h2) or `Title\n=======\n` (Setext h1)
  //    where the document uses ATX (`## Title`). We strip the underline
  //    and search for the body of the heading instead, so the rest of
  //    the `original` text can be located by following the heading.
  const setext = original.match(/^([^\n]+)\n[=-]{2,}\n/);
  if (setext) {
    const titleOnly = setext[1].trim();
    if (titleOnly) {
      const i = content.indexOf(titleOnly);
      if (i !== -1) {
        // The body of the original is everything after the underline.
        // Try to extend the match to include the body in the document.
        const bodyStart = setext[0].length;
        const body = original.slice(bodyStart);
        if (body) {
          // Look for the first non-empty line of the body shortly after
          // the heading, ignoring any markdown decoration on the
          // heading line itself.
          const bodyHead = body.replace(/^\s+/, '').split('\n')[0].trim();
          if (bodyHead) {
            const searchFrom = i + titleOnly.length;
            const j = content.indexOf(bodyHead, searchFrom);
            if (j !== -1) {
              return { idx: i, length: j + bodyHead.length - i };
            }
          }
        }
        return { idx: i, length: titleOnly.length };
      }
    }
  }

  // 5) ATX heading prefix stripping. The AI sometimes prepends `## ` /
  //    `### ` etc. to the `original` when the document doesn't have
  //    that prefix. Strip any leading `#` characters and search again.
  const atx = original.match(/^#{1,6}\s+/);
  if (atx) {
    const stripped = original.slice(atx[0].length);
    idx = content.indexOf(stripped);
    if (idx !== -1) {
      return { idx, length: stripped.length };
    }
    const strippedTrimmed = stripped.trim();
    if (strippedTrimmed && strippedTrimmed !== stripped) {
      idx = content.indexOf(strippedTrimmed);
      if (idx !== -1) {
        return { idx, length: strippedTrimmed.length };
      }
    }
  }

  // 6) Markdown escape normalisation. The document may use backslash
  //    escapes (`\.`, `\_`, `\*`, ...) to display Markdown-significant
  //    characters literally. The AI typically strips these when quoting
  //    a substring, so an exact-match search fails. We build a regex
  //    where every Markdown-significant character in the AI's text
  //    optionally allows a leading backslash in the document, then
  //    match the regex to find the right span.
  const mdPattern = /[\\`*_{}\[\]()#+\-.!|>~]/;
  if (mdPattern.test(original)) {
    // Escape regex special chars in `original` (besides the MD chars
    // we're going to wrap). Each MD-significant char becomes `\\?X`
    // so the document can have an optional preceding backslash.
    const specialRe = /[.*+?^${}()|[\]\\]/g;
    const reSource = original
      .split('')
      .map((c) => {
        if (/[\\`*_{}\[\]()#+\-.!|>~]/.test(c)) {
          return '\\\\?' + c.replace(specialRe, '\\$&');
        }
        return c.replace(specialRe, '\\$&');
      })
      .join('');
    const re = new RegExp(reSource, 's');
    const m = re.exec(content);
    if (m) {
      return { idx: m.index, length: m[0].length };
    }
  }

  return null;
}

/**
 * Best-effort anchor for a proposed edit whose `original` quote cannot
 * be matched by `findEditAnchor` (six existing strategies failed). The
 * intent is to recover from "near misses" — the user re-flowed a
 * paragraph, swapped a few words, or the model paraphrased instead of
 * quoting — without ever silently rewriting text. The function returns
 * a confidence score alongside the anchor so the UI can show the matched
 * passage; Apply is blocked when `duplicationReason` is set (user falls
 * through to Highlight Apply).
 *
 * Strategy (order matches implementation):
 *   1. Longest exact substring of `original` in `content` (≥ 40 chars),
 *      then `expandBestEffortRange` + `prepareBestEffortReplace`.
 *   2. If that fails, token sweep (≥ 40% in-order overlap), then expand
 *      + prepare the same way.
 *   3. Refuse unless the prepared span covers ≥ ~85% of `original`, or
 *      a coherent markdown section body was snapped. Refuse on
 *      duplication. Refuse if `content` is over
 *      `MAX_BEST_EFFORT_DOC_BYTES`.
 */
export interface BestEffortAnchor {
  idx: number;
  length: number;
  /** 0..1, fraction of the original tokens found in the matched window in order. */
  confidence: number;
  /**
   * Reason string if replacing this anchor with the replacement text would
   * create a word-duplication artefact, otherwise null.
   */
  duplicationReason: string | null;
}

/**
 * After replacing `anchor` in `content` with `replacement`, check whether
 * the character immediately before or after the replaced span would now
 * appear adjacent to identical text, creating a duplication artefact.
 * Returns the reason string if duplication would occur, or null if safe.
 */
export function checkReplacementDuplication(
  content: string,
  anchor: { idx: number; length: number },
  replacement: string
): string | null {
  // Walk backwards from anchor start, collecting up to BEFORE_MAX chars.
  const BEFORE_MAX = 60;
  const AFTER_MAX = 100;
  const leading = content.slice(
    Math.max(0, anchor.idx - BEFORE_MAX),
    anchor.idx
  );
  // Walk forwards from anchor end, collecting up to AFTER_MAX chars.
  const trailing = content.slice(
    anchor.idx + anchor.length,
    anchor.idx + anchor.length + AFTER_MAX
  );

  // Collect n-grams (1, 2, 3 words) from leading and trailing context.
  const wordRe = /\b\w+\b/g;
  const leadingWords: string[] = [];
  let lm: RegExpExecArray | null;
  wordRe.lastIndex = 0;
  while ((lm = wordRe.exec(leading)) !== null) leadingWords.push(lm[0]);

  const trailingWords: string[] = [];
  let tm: RegExpExecArray | null;
  while ((tm = wordRe.exec(trailing)) !== null) trailingWords.push(tm[0]);

  // Build n-gram sets for each side (only meaningful for N>1).
  const toNgrams = (words: string[], n: number): Set<string> => {
    const s = new Set<string>();
    for (let i = 0; i <= words.length - n; i++) {
      s.add(words.slice(i, i + n).join(' '));
    }
    return s;
  };

  // Check if any leading 2-gram or 3-gram also appears in trailing.
  // 1-gram check is too aggressive — common words like "the", "is", "and"
  // appear in both leading and trailing 100% of the time. The 2-gram
  // check catches real phrase-level duplication without false positives.
  // We also filter out n-grams that are entirely stopwords.
  const STOPWORDS = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at', 'for', 'by',
    'with', 'this', 'that', 'it', 'as', 'from', 'not', 'so',
  ]);
  const isContentful = (words: string[]) => words.some((w) => !STOPWORDS.has(w.toLowerCase()));
  for (const ngrams of [
    toNgrams(leadingWords, 3),
    toNgrams(leadingWords, 2),
  ]) {
    for (const ng of ngrams) {
      const ngWords = ng.split(' ');
      if (!isContentful(ngWords)) continue;
      if (trailingWords.join(' ').includes(ng)) {
        return `The phrase "${ng}" appears on both sides of the matched passage — applying would duplicate it`;
      }
    }
  }

  // Adjacent overlap only: if the start of `replacement` matches the
  // start of the trailing context (2+ contentful words), the splice
  // would double-print that lead-in. Checking "anywhere in trailing
  // 100 chars" was too noisy for common nouns.
  if (replacement && replacement.length > 0) {
    const replWords = (replacement.match(/\b\w+\b/g) ?? []).filter(
      (w) => !STOPWORDS.has(w.toLowerCase())
    );
    if (replWords.length >= 2 && trailingWords.length >= 2) {
      const lead = replWords.slice(0, 2).join(' ').toLowerCase();
      const trailLead = trailingWords
        .filter((w) => !STOPWORDS.has(w.toLowerCase()))
        .slice(0, 2)
        .join(' ')
        .toLowerCase();
      if (lead && lead === trailLead) {
        return `The start of the replacement ("${replWords.slice(0, 2).join(' ')}") already begins the text after the matched passage — applying would duplicate it`;
      }
    }
  }

  return null;
}

const MAX_BEST_EFFORT_DOC_BYTES = 100 * 1024;

/**
 * Cheap word-tokeniser that splits on whitespace + common markdown
 * boundaries so a heading marker or list bullet doesn't fuse into
 * the adjacent word. Punctuation stays attached to the token — the
 * match pass strips it via `normalizeToken` before comparing.
 */
function tokenizeForBestEffort(s: string): string[] {
  if (!s) return [];
  // Split on runs of whitespace, line breaks, or markdown block
  // boundaries. Inline emphasis markers (`` ` ``, `*`, `_`) stay
  // attached to their containing word; `normalizeToken` strips them.
  return s.split(/\s+/).filter((t) => t.length > 0);
}

/** Strip case / punctuation / markdown wrappers so `potential,` ≈ `potential`. */
function normalizeToken(t: string): string {
  return t
    .toLowerCase()
    .replace(/^[\*_`~#>\[\]()"'“”‘’•·]+/, '')
    .replace(/[\*_`~#>\[\]()"'“”‘’.,;:!?]+$/g, '');
}

/**
 * 1-edit-distance check between two short tokens (≤ 8 chars), after
 * normalisation. Longer tokens must match exactly once normalised.
 */
function isNearToken(a: string, b: string): boolean {
  const na = normalizeToken(a);
  const nb = normalizeToken(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (Math.abs(na.length - nb.length) > 1) return false;
  const len = Math.max(na.length, nb.length);
  if (len > 8) return false;
  let diffs = 0;
  for (let i = 0; i < len; i++) {
    if (na[i] !== nb[i]) {
      diffs++;
      if (diffs > 1) return false;
    }
  }
  return diffs <= 1;
}

const BEST_EFFORT_MIN_CONFIDENCE = 0.4;
const SUBSTRING_MIN_LEN = 40;

/**
 * Longest contiguous substring of `original` that appears verbatim in
 * `content`. Also returns `origOffset` — where that slice starts inside
 * `original` — so callers can expand to the full quoted span.
 */
function findLongestSubstringAnchor(
  content: string,
  original: string
): { idx: number; length: number; origOffset: number; confidence: number } | null {
  if (original.length < SUBSTRING_MIN_LEN) return null;
  const maxLen = Math.min(original.length, 500);
  let best: { idx: number; length: number; origOffset: number } | null = null;

  // Binary search on substring length; for each candidate length, scan
  // original offsets for a hit in content.
  let lo = SUBSTRING_MIN_LEN;
  let hi = maxLen;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    let hit: { idx: number; length: number; origOffset: number } | null = null;
    for (let i = 0; i + mid <= original.length; i++) {
      // Prefer cuts that start on a whitespace/boundary so we don't
      // match mid-word crumbs.
      if (i > 0 && !/\s/.test(original[i - 1])) continue;
      const slice = original.slice(i, i + mid);
      const at = content.indexOf(slice);
      if (at !== -1) {
        hit = { idx: at, length: mid, origOffset: i };
        break;
      }
    }
    if (hit) {
      best = hit;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (!best) return null;
  return {
    idx: best.idx,
    length: best.length,
    origOffset: best.origOffset,
    confidence: Math.min(1, best.length / Math.max(original.length, 1)),
  };
}

/** Minimum fraction of `original.length` a Best Effort span must cover. */
export const BEST_EFFORT_COVERAGE_MIN = 0.85;

function firstNonEmptyLine(s: string): string {
  return s.split('\n').find((l) => l.trim().length > 0)?.trim() ?? '';
}

/**
 * Expand start/end to the nearest markdown block boundaries that contain
 * the match: previous blank line (or after a heading), next blank line
 * or next ATX heading of any level.
 */
function expandToBlockBoundaries(
  content: string,
  start: number,
  end: number
): { start: number; end: number } {
  let s = start;
  let e = end;
  // Walk start back to the previous blank line, but stop after a heading
  // line so we don't pull the heading into the hole when the next step
  // will leave it in place.
  while (s > 0) {
    const prevNl = content.lastIndexOf('\n', s - 1);
    const lineStart = prevNl < 0 ? 0 : prevNl + 1;
    const line = content.slice(lineStart, s).replace(/\n$/, '');
    if (line.trim() === '') {
      s = lineStart;
      break;
    }
    if (/^#{1,6}\s+\S/.test(line.trim())) {
      // Leave heading outside the hole.
      break;
    }
    s = lineStart;
    if (prevNl < 0) break;
  }
  // Walk end forward to next blank line or next heading.
  while (e < content.length) {
    const nextNl = content.indexOf('\n', e);
    if (nextNl < 0) {
      e = content.length;
      break;
    }
    const lineStart = nextNl + 1;
    const nextNext = content.indexOf('\n', lineStart);
    const lineEnd = nextNext < 0 ? content.length : nextNext;
    const line = content.slice(lineStart, lineEnd);
    if (line.trim() === '' || /^#{1,6}\s+\S/.test(line.trim())) {
      e = nextNl;
      break;
    }
    e = lineEnd;
  }
  return { start: s, end: e };
}

/**
 * Expand a partial substring match so Best Effort replaces the
 * whole AI-quoted passage — not just the shared chunk. Without this,
 * `replacement` is spliced into a short hole and the rest of `original`
 * stays in the document (reads as duplication).
 *
 * Strategy:
 *   1. Exact prefix/suffix of `original` around the matched slice.
 *   2. Else snap to the markdown section BODY that contains the match —
 *      the heading itself is NOT included when `replacement` re-emits
 *      the same heading line.
 *   3. Else expand to paragraph / block boundaries containing the match.
 */
export function expandBestEffortRange(
  content: string,
  original: string,
  anchor: { idx: number; length: number },
  origOffset = -1,
  replacement = ''
): { idx: number; length: number; sectionSnap: boolean } {
  let start = anchor.idx;
  let end = anchor.idx + anchor.length;
  let sectionSnap = false;
  if (start < 0 || end > content.length || start >= end) {
    return { idx: anchor.idx, length: anchor.length, sectionSnap: false };
  }

  const matched = content.slice(start, end);
  let off = origOffset;
  if (off < 0) {
    off = original.indexOf(matched);
  }

  const firstOrigLine = firstNonEmptyLine(original);
  const firstReplLine = firstNonEmptyLine(replacement);
  const isHeadingQuote = /^#{1,6}\s+\S/.test(firstOrigLine);
  // Skip absorbing the heading into the hole when the replacement
  // re-emits the same heading (or when we only have the original quote
  // and it starts with a heading — conservative default).
  const skipHeadingInHole =
    isHeadingQuote &&
    (!firstReplLine || firstReplLine === firstOrigLine);

  if (off >= 0) {
    let prefix = original.slice(0, off);
    if (skipHeadingInHole) {
      const hlEnd = prefix.indexOf('\n');
      prefix = hlEnd >= 0 ? prefix.slice(hlEnd + 1) : '';
    }
    const suffix = original.slice(off + matched.length);

    if (
      prefix &&
      start >= prefix.length &&
      content.slice(start - prefix.length, start) === prefix
    ) {
      start -= prefix.length;
    }
    if (suffix && content.slice(end, end + suffix.length) === suffix) {
      end += suffix.length;
    }
  }

  // If we still cover less than ~85% of the quote, snap to the
  // section body. We deliberately do NOT include the heading line
  // when replacement re-emits it.
  if (end - start < original.length * BEST_EFFORT_COVERAGE_MIN) {
    const firstLine = firstOrigLine;
    const heading = firstLine.match(/^(#{1,6})\s+/);
    if (heading && firstLine.length >= 4) {
      const searchFrom = Math.max(0, start - original.length);
      const searchTo = Math.min(content.length, end + 80);
      const window = content.slice(searchFrom, searchTo);
      const rel = window.indexOf(firstLine);
      if (rel !== -1) {
        const headingEnd = searchFrom + rel + firstLine.length;
        let bodyStart = headingEnd;
        if (content[bodyStart] === '\n') bodyStart += 1;
        const level = heading[1].length;
        const after = content.slice(headingEnd);
        const nextRe = new RegExp(`\\n#{1,${level}}\\s`);
        const m = nextRe.exec(after);
        let candidateEnd = end;
        if (m && typeof m.index === 'number') {
          candidateEnd = headingEnd + m.index;
        } else {
          candidateEnd = Math.min(
            content.length,
            Math.max(end, bodyStart + original.length)
          );
        }
        const secStart = skipHeadingInHole ? bodyStart : searchFrom + rel;
        const secLen = candidateEnd - secStart;
        if (secLen >= 8 && secLen <= original.length * 2.2) {
          start = secStart;
          end = candidateEnd;
          sectionSnap = true;
        }
      }
    }
  }

  // Still short: grow to paragraph / block boundaries containing the match.
  if (end - start < original.length * BEST_EFFORT_COVERAGE_MIN) {
    const block = expandToBlockBoundaries(content, start, end);
    const blockLen = block.end - block.start;
    if (
      blockLen >= end - start &&
      blockLen <= original.length * 2.2 &&
      blockLen >= 8
    ) {
      start = block.start;
      end = block.end;
    }
  }

  return { idx: start, length: Math.max(0, end - start), sectionSnap };
}

/**
 * Finalise a Best Effort hole before splice: strip a re-emitted heading
 * from the matched span, and grow the hole (prefer) or trim the
 * replacement when adjacent text would duplicate the start/end of
 * `replacement`. Returns null if the result would still duplicate.
 */
export function prepareBestEffortReplace(
  content: string,
  replacement: string,
  anchor: { idx: number; length: number }
): { idx: number; length: number; text: string } | null {
  let start = anchor.idx;
  let end = anchor.idx + anchor.length;
  if (start < 0 || end > content.length || start > end) return null;
  let text = replacement;

  // Grow hole right when content immediately after matches a suffix of text.
  {
    const maxK = Math.min(content.length - end, text.length, 200);
    for (let k = maxK; k >= 8; k--) {
      if (content.slice(end, end + k) === text.slice(text.length - k)) {
        end += k;
        break;
      }
    }
  }

  // Grow hole left when content immediately before matches a prefix of text,
  // but never re-absorb an ATX heading that replacement will re-emit.
  {
    const replHead = firstNonEmptyLine(text);
    const skipHead =
      /^#{1,6}\s+\S/.test(replHead) ? replHead : null;
    const maxK = Math.min(start, text.length, 200);
    for (let k = maxK; k >= 8; k--) {
      const before = content.slice(start - k, start);
      if (before !== text.slice(0, k)) continue;
      if (skipHead) {
        const beforeFirst = firstNonEmptyLine(before);
        if (beforeFirst === skipHead) continue;
      }
      start -= k;
      break;
    }
  }

  // If trailing still starts with the start of text, grow to absorb it.
  {
    const trailing = content.slice(end);
    const maxK = Math.min(text.length, trailing.length, 200);
    for (let k = maxK; k >= 8; k--) {
      if (trailing.startsWith(text.slice(0, k))) {
        end += k;
        break;
      }
    }
  }

  // Absorb residual original text on the same paragraph line (classic
  // short-hole duplication: replacement is a full rewrite but the match
  // only covered a shared prefix). Then, if still short vs replacement,
  // grow to block boundaries.
  if (end < content.length && content[end] !== '\n') {
    const nl = content.indexOf('\n', end);
    end = nl === -1 ? content.length : nl;
  }
  {
    const replBodyLen = text.length;
    if (end - start < replBodyLen * 0.85) {
      const block = expandToBlockBoundaries(content, start, end);
      if (
        block.end > end &&
        block.end - start <= Math.max(replBodyLen * 2.2, end - start + 200)
      ) {
        end = block.end;
      }
    }
  }

  // Strip leading ATX heading from the hole LAST so grow-left cannot
  // put it back. When the heading stays in the document, also strip the
  // same heading from the inserted text so it is not double-printed.
  {
    const span = content.slice(start, end);
    const lineEnd = span.indexOf('\n');
    if (lineEnd > 0) {
      const firstLine = span.slice(0, lineEnd).trim();
      if (/^#{1,6}\s/.test(firstLine)) {
        const replHead = text.split('\n', 1)[0].trim();
        if (replHead === firstLine) {
          start += lineEnd + 1;
          while (start < end && content[start] === '\n') start += 1;
          // Drop the re-emitted heading (+ following blank lines) from text.
          const textNl = text.indexOf('\n');
          if (textNl >= 0) {
            let t = textNl + 1;
            while (t < text.length && text[t] === '\n') t += 1;
            text = text.slice(t);
          } else {
            text = '';
          }
        }
      }
    }
  }
  // If the hole no longer includes the heading (already body-only) but
  // replacement still starts with that heading line sitting immediately
  // before the hole, strip it from text the same way.
  {
    const replHead = firstNonEmptyLine(text);
    if (/^#{1,6}\s+\S/.test(replHead)) {
      const before = content.slice(Math.max(0, start - replHead.length - 2), start);
      if (before.includes(replHead)) {
        const textNl = text.indexOf('\n');
        if (textNl >= 0) {
          let t = textNl + 1;
          while (t < text.length && text[t] === '\n') t += 1;
          text = text.slice(t);
        }
      }
    }
  }
  if (start > end) return null;

  const prepared = { idx: start, length: Math.max(0, end - start), text };
  const dup = checkReplacementDuplication(
    content,
    { idx: prepared.idx, length: prepared.length },
    prepared.text
  );
  if (dup) return null;
  return prepared;
}

/**
 * Finalise a raw match into a BestEffortAnchor: expand, prepare (heading
 * strip + overlap grow), coverage-gate, and duplication-check. Returns
 * null when the match is too short or would duplicate.
 */
function finaliseBestEffortAnchor(
  content: string,
  original: string,
  replacement: string,
  raw: { idx: number; length: number; confidence: number },
  origOffset = -1
): BestEffortAnchor | null {
  const expanded = expandBestEffortRange(
    content,
    original,
    { idx: raw.idx, length: raw.length },
    origOffset,
    replacement
  );
  const prepared = prepareBestEffortReplace(
    content,
    replacement,
    { idx: expanded.idx, length: expanded.length }
  );
  if (!prepared) {
    // Still surface the expanded span with a duplication reason so the
    // card can show the matched passage and steer the user to Highlight.
    const dup =
      checkReplacementDuplication(
        content,
        { idx: expanded.idx, length: expanded.length },
        replacement
      ) ?? 'Applying here would duplicate surrounding text';
    return {
      idx: expanded.idx,
      length: expanded.length,
      confidence: Math.min(
        1,
        Math.max(raw.confidence, expanded.length / Math.max(original.length, 1))
      ),
      duplicationReason: dup,
    };
  }

  // When replacement re-emits the same ATX heading, the prepared hole
  // is body-only — measure coverage against the body of `original`.
  let origForCoverage = original;
  {
    const firstOrig = firstNonEmptyLine(original);
    const firstRepl = firstNonEmptyLine(replacement);
    if (
      /^#{1,6}\s+\S/.test(firstOrig) &&
      firstRepl === firstOrig
    ) {
      const hlEnd = original.indexOf('\n');
      if (hlEnd >= 0) origForCoverage = original.slice(hlEnd + 1);
    }
  }
  const coverage = prepared.length / Math.max(origForCoverage.length, 1);
  const coverageOk =
    coverage >= BEST_EFFORT_COVERAGE_MIN || expanded.sectionSnap;
  if (!coverageOk) return null;

  return {
    idx: prepared.idx,
    length: prepared.length,
    confidence: Math.min(1, Math.max(raw.confidence, coverage)),
    duplicationReason: null,
  };
}

export function findBestEffortAnchor(
  content: string,
  original: string,
  replacement: string
): BestEffortAnchor | null {
  if (!content || !original) return null;
  if (content.length > MAX_BEST_EFFORT_DOC_BYTES) return null;
  if (original.length < 30) return null;

  let substringFallback: BestEffortAnchor | null = null;

  // Cheap path first: longest exact substring, then expand + prepare.
  {
    const sub = findLongestSubstringAnchor(content, original);
    if (sub && sub.confidence >= 0.25) {
      const finalised = finaliseBestEffortAnchor(
        content,
        original,
        replacement,
        {
          idx: sub.idx,
          length: sub.length,
          confidence: sub.confidence,
        },
        sub.origOffset
      );
      // Usable (no duplication) wins immediately. A dup-blocked match
      // still falls through to the token sweep in case that yields a
      // cleaner span; if not, we return the dup-blocked result below.
      if (finalised && !finalised.duplicationReason) return finalised;
      if (finalised) substringFallback = finalised;
    }
  }

  // Token sweep only when substring failed or was dup-blocked.
  let best: BestEffortAnchor | null = null;
  {
    const origTokens = tokenizeForBestEffort(original);
    if (origTokens.length >= 3) {
      const contentTokens: { token: string; start: number; end: number }[] = [];
      {
        const re = /\S+/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(content)) !== null) {
          contentTokens.push({
            token: m[0],
            start: m.index,
            end: m.index + m[0].length,
          });
        }
      }
      if (contentTokens.length >= 3) {
        const n = origTokens.length;
        const maxSkip = Math.max(2, Math.floor(n * 0.5));
        const LOOKAHEAD = Math.min(8, Math.max(5, Math.floor(n * 0.25)));
        const maxMatchedTokens = Math.ceil(n * 1.5);
        const seedNorms = new Set(
          origTokens
            .slice(0, Math.min(6, n))
            .map((t) => normalizeToken(t))
            .filter(Boolean)
        );
        const deadline = performance.now() + 12;

        for (let start = 0; start < contentTokens.length; start++) {
          if (performance.now() > deadline) break;
          if (!seedNorms.has(normalizeToken(contentTokens[start].token))) {
            continue;
          }
          let oi = 0;
          let skips = 0;
          let firstMatch = -1;
          let lastMatch = -1;
          let matchedCount = 0;
          for (let ci = start; ci < contentTokens.length; ci++) {
            const ct = contentTokens[ci];
            if (oi >= n) break;
            let matchedAt = -1;
            const limit = Math.min(n, oi + LOOKAHEAD + 1);
            for (let k = oi; k < limit; k++) {
              if (isNearToken(ct.token, origTokens[k])) {
                matchedAt = k;
                break;
              }
            }
            if (matchedAt !== -1) {
              if (firstMatch === -1) firstMatch = ci;
              lastMatch = ci;
              oi = matchedAt + 1;
              matchedCount++;
            } else {
              skips++;
              if (skips > maxSkip) break;
            }
            if (lastMatch !== -1 && ci - start + 1 > maxMatchedTokens) break;
          }
          if (matchedCount === 0) continue;
          const matchedTokenCount = lastMatch - firstMatch + 1;
          if (matchedTokenCount > maxMatchedTokens) continue;
          const confidence = matchedCount / n;
          if (confidence < BEST_EFFORT_MIN_CONFIDENCE) continue;
          if (best === null || confidence > best.confidence) {
            best = {
              idx: contentTokens[firstMatch].start,
              length:
                contentTokens[lastMatch].end - contentTokens[firstMatch].start,
              confidence,
              duplicationReason: null,
            };
            if (confidence >= 1.0) break;
          }
        }
      }
    }
  }

  if (best) {
    const finalised = finaliseBestEffortAnchor(
      content,
      original,
      replacement,
      best
    );
    if (finalised && !finalised.duplicationReason) return finalised;
    if (finalised) return finalised;
  }

  return substringFallback;
}

/**
 * Replace the first verbatim occurrence of `original` in `content` with
 * `replacement`. Mirrors the disabled-state check so Apply and the
 * re-evaluation logic in the card share one code path.
 */
export function applyEdit(
  content: string,
  original: string,
  replacement: string
): ApplyEditResult {
  const anchor = findEditAnchor(content, original);
  if (!anchor) return { ok: false, reason: 'anchor-missing' };
  const next =
    content.slice(0, anchor.idx) +
    replacement +
    content.slice(anchor.idx + anchor.length);
  return { ok: true, next, anchor };
}

/**
 * Apply a batch of `ProposedEdit`s in order against a running string
 * accumulator. Waterfall per edit: Exact → Best Effort (prepared) → skip.
 * Each lookup runs against the *current* accumulator so overlapping
 * edits compose correctly.
 *
 * Edits that cannot be Exact- or Best-Effort-anchored are skipped
 * silently. The caller derives the skip count from
 * `edits.length - appliedIds.length` for the "Apply N" footer.
 */
export function applyAllEdits(
  content: string,
  edits: ProposedEdit[]
): {
  next: string;
  appliedIds: string[];
  /**
   * Per-edit anchor info for the edits that were applied. Each
   * entry's `idx` is the position of the original substring in
   * the running accumulator, and `replacement` is the new text
   * the caller should use to re-anchor the producing comment.
   * One entry per applied id; the order matches `appliedIds`.
   */
  appliedAnchors: Array<{ id: string; idx: number; replacement: string }>;
} {
  let acc = content;
  const appliedIds: string[] = [];
  const appliedAnchors: Array<{
    id: string;
    idx: number;
    replacement: string;
  }> = [];
  for (const edit of edits) {
    const exact = findEditAnchor(acc, edit.original);
    if (exact) {
      acc =
        acc.slice(0, exact.idx) +
        edit.replacement +
        acc.slice(exact.idx + exact.length);
      appliedIds.push(edit.id);
      appliedAnchors.push({
        id: edit.id,
        idx: exact.idx,
        replacement: edit.replacement,
      });
      continue;
    }
    const be = findBestEffortAnchor(acc, edit.original, edit.replacement);
    if (!be || be.duplicationReason) continue;
    const prepared = prepareBestEffortReplace(
      acc,
      edit.replacement,
      { idx: be.idx, length: be.length }
    );
    if (!prepared) continue;
    acc =
      acc.slice(0, prepared.idx) +
      prepared.text +
      acc.slice(prepared.idx + prepared.length);
    appliedIds.push(edit.id);
    appliedAnchors.push({
      id: edit.id,
      idx: prepared.idx,
      replacement: prepared.text,
    });
  }
  return { next: acc, appliedIds, appliedAnchors };
}

/**
 * Insert / replace at a known caret or selection in `content`. Used by
 * Highlight Apply on a ProposedEditCard when the user manually selects
 * the span to replace. This helper does no anchor lookup.
 *
 * - If `selectionStart !== selectionEnd`, the selected range is replaced
 *   with `replacement`.
 * - Otherwise, `replacement` is inserted at the caret.
 *
 * Returns `{ ok: false, reason: 'caret-missing' }` if the caret position
 * is outside the document, missing, or otherwise unusable; the caller
 * should bail without mutating state.
 */
export function applyEditAtCaret(
  content: string,
  replacement: string,
  caret: { selectionStart: number; selectionEnd: number }
):
  | { ok: true; next: string; replaced: boolean }
  | { ok: false; reason: 'caret-missing' } {
  const { selectionStart, selectionEnd } = caret;
  if (
    typeof selectionStart !== 'number' ||
    typeof selectionEnd !== 'number' ||
    Number.isNaN(selectionStart) ||
    Number.isNaN(selectionEnd) ||
    selectionStart < 0 ||
    selectionEnd < 0 ||
    selectionStart > content.length ||
    selectionEnd > content.length ||
    selectionStart > selectionEnd
  ) {
    return { ok: false, reason: 'caret-missing' };
  }
  const replaced = selectionStart !== selectionEnd;
  const next =
    content.slice(0, selectionStart) +
    replacement +
    content.slice(selectionEnd);
  return { ok: true, next, replaced };
}

export interface RejectionItem {
  /** The id of the rejected ProposedEdit. */
  editId: string;
  /** The user's free-text comment. Trimmed before formatting. */
  comment: string;
  /**
   * @-document references the user attached to the rejection comment.
   * Empty / undefined for cards where the user did not use `@`.
   * When the staged rejections are committed, the merged mention
   * list is forwarded to the prompt builder so the model sees the
   * referenced doc(s) alongside the rejection batch.
   */
  mentions?: MentionToken[];
}

/**
 * Build the body of the user message that gets appended to the chat when
 * the user commits one or more staged "Reject with feedback" actions.
 *
 * Format 1 from the plan: a short header followed by one `[id]` line per
 * rejected change. The `[id]` prefix is an unambiguous anchor that the
 * model can match against the `id` field of the `proposed-edit` JSON it
 * emits, so each comment is kept distinct from the others.
 *
 * Items with empty/whitespace-only comments are skipped — those should
 * have used the plain "Reject" button instead.
 *
 * The `comment` strings passed in may contain @-mention sentinel
 * sequences (e.g. `\u200B[[mention:…]]\u200B`). We strip those here
 * via `cleanCommentForPrompt` before formatting so the user-visible
 * chat message is plain prose — the referenced docs are conveyed
 * separately through the prompt builder's `referencedDocuments`
 * argument.
 */
export function formatRejectionBatch(items: RejectionItem[]): string {
  const lines = items
    .map((it) => ({
      editId: it.editId,
      comment: cleanCommentForPrompt(it.comment).trim(),
    }))
    .filter((it) => it.comment.length > 0);

  if (lines.length === 0) return '';

  const header =
    lines.length === 1
      ? "Please revise the following rejected proposed edit. The `[id]` in brackets refers to that change's `id`."
      : "Please revise the following rejected proposed edits. Each `[id]` in brackets refers to that change's `id`; address only those.";

  const body = lines.map((l) => `[${l.editId}] ${l.comment}`).join('\n');
  return `${header}\n\n${body}\n`;
}

/**
 * Strip @-mention sentinels from a comment string. Thin wrapper
 * around the canonical parser in `components/mentions/parseMentions.ts`
 * so there is a single source of truth for the sentinel format.
 * The `components/mentions/parseMentions.ts` module is pure (no
 * React / DOM imports), so the `utils/` layer can depend on it
 * without dragging in UI tree-shake weight.
 */
export function cleanCommentForPrompt(text: string): string {
  if (!text) return '';
  return parseMentionsFromSentinels(text).plain;
}
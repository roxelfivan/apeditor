/**
 * Turn a two-document line diff into a `ProposedEdit[]` that the
 * existing Apply waterfall can consume. Current document = Original;
 * the imported / other document = Revised (Word Compare).
 *
 * The result also carries `segments` — the whole document in document
 * order — so the Compare popup can render the unchanged text that the
 * edit list alone omits.
 */

import { diffLines } from 'diff';
import type { ProposedEdit } from '@/types';

export interface CompareResult {
  edits: ProposedEdit[];
  skippedHunks: number;
  /**
   * The compared document in document order, interleaving unchanged
   * text with the changes.
   */
  segments: CompareSegment[];
}

/**
 * One contiguous piece of the compared document.
 *
 * - `unchanged` — text present identically in both documents. It is
 *   rendered in both columns of the side-by-side view.
 * - `change` — a hunk that became an applyable edit. `editId` matches
 *   an entry in `CompareResult.edits`. `originalText` / `revisedText`
 *   hold the raw diff text for this hunk (before the anchor expansion
 *   that `ProposedEdit.original` / `.replacement` need), so rendering a
 *   segment never repeats text that already lives in an unchanged
 *   segment.
 * - `skipped` — a hunk that could not be turned into a unique anchor
 *   and therefore has no applyable edit. It is still shown (muted, no
 *   Apply button) so the document view stays continuous and the
 *   difference is not hidden.
 */
export type CompareSegment =
  | { kind: 'unchanged'; text: string }
  | {
      kind: 'change';
      editId: string;
      originalText: string;
      revisedText: string;
    }
  | { kind: 'skipped'; originalText: string; revisedText: string };

function occurrenceCount(haystack: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let from = 0;
  while (from <= haystack.length) {
    const i = haystack.indexOf(needle, from);
    if (i < 0) return n;
    n += 1;
    from = i + Math.max(needle.length, 1);
  }
  return n;
}

function lineStartAt(text: string, index: number): number {
  if (index <= 0) return 0;
  const prev = text.lastIndexOf('\n', index - 1);
  return prev < 0 ? 0 : prev + 1;
}

function lineEndAt(text: string, index: number): number {
  if (index >= text.length) return text.length;
  const next = text.indexOf('\n', index);
  return next < 0 ? text.length : next + 1;
}

function summarizeHunk(original: string, replacement: string): string {
  const origLines = original ? original.split('\n').filter((l, i, a) => !(i === a.length - 1 && l === '')).length : 0;
  const newLines = replacement ? replacement.split('\n').filter((l, i, a) => !(i === a.length - 1 && l === '')).length : 0;
  if (!original && replacement) {
    return newLines <= 1 ? 'Insert line' : `Insert ${newLines} lines`;
  }
  if (original && !replacement) {
    return origLines <= 1 ? 'Delete line' : `Delete ${origLines} lines`;
  }
  if (origLines <= 1 && newLines <= 1) return 'Replace line';
  return `Replace ${origLines} line${origLines === 1 ? '' : 's'}`;
}

interface InsertCtx {
  start: number;
  end: number;
  text: string;
  where: 'before' | 'after';
}

function pickInsertContext(content: string, at: number): InsertCtx | null {
  if (!content) return null;
  const beforeStart = lineStartAt(content, Math.max(0, at - 1));
  if (beforeStart < at) {
    const text = content.slice(beforeStart, at);
    if (text) {
      return { start: beforeStart, end: at, text, where: 'before' };
    }
  }
  const afterEnd = lineEndAt(content, at);
  if (afterEnd > at) {
    const text = content.slice(at, afterEnd);
    if (text) {
      return { start: at, end: afterEnd, text, where: 'after' };
    }
  }
  return { start: 0, end: content.length, text: content, where: 'before' };
}

function expandUntilUnique(
  content: string,
  start: number,
  end: number,
  originalCore: string,
  replacementCore: string
): { original: string; replacement: string } | null {
  let s = start;
  let e = end;
  for (let guard = 0; guard < 64; guard++) {
    const prefix = content.slice(s, start);
    const suffix = content.slice(end, e);
    const original = prefix + originalCore + suffix;
    if (!original) return null;
    if (occurrenceCount(content, original) <= 1) {
      return { original, replacement: prefix + replacementCore + suffix };
    }
    const grew = s > 0 || e < content.length;
    if (!grew) {
      return { original, replacement: prefix + replacementCore + suffix };
    }
    if (s > 0) s = lineStartAt(content, s - 1);
    else e = lineEndAt(content, e);
  }
  return null;
}

/**
 * Diff `original` (the open document) against `revised` (the imported
 * file) and emit applyable proposed edits.
 *
 * The result carries two parallel views of the same diff:
 *
 * - `edits` — applyable `ProposedEdit`s. Their `original` is expanded
 *   with surrounding context until the span is unique in the document,
 *   so the Apply waterfall can anchor on it.
 * - `segments` — the document skeleton. Unchanged text is preserved
 *   verbatim, and each change segment carries only the hunk's own raw
 *   diff text, so the popup can render the whole document without
 *   repeating the context that the expansion added to the edit.
 */
export function compareToProposedEdits(
  original: string,
  revised: string
): CompareResult {
  if (original === revised) {
    return {
      edits: [],
      skippedHunks: 0,
      segments: original ? [{ kind: 'unchanged', text: original }] : [],
    };
  }
  if (!original) {
    return {
      edits: [
        {
          id: 'compare-1',
          summary: 'Replace empty document',
          rationale: 'Produced by document compare (not an AI suggestion).',
          original: '',
          replacement: revised,
        },
      ],
      skippedHunks: 0,
      segments: [
        {
          kind: 'change',
          editId: 'compare-1',
          originalText: '',
          revisedText: revised,
        },
      ],
    };
  }

  const parts = diffLines(original, revised);
  type Hunk = {
    origStart: number;
    origEnd: number;
    original: string;
    replacement: string;
  };
  // The diff walk emits parts in document order: equal text, then the
  // removed/added text of a hunk, then equal text again. Collapse that
  // into one ordered list of items so the document view can be rebuilt
  // without guessing which unchanged run belongs before which hunk.
  type Item =
    | { kind: 'equal'; text: string }
    | { kind: 'hunk'; hunk: Hunk };
  const items: Item[] = [];
  let origPos = 0;
  let pending: Hunk | null = null;
  // Accumulates equal text for the current unchanged run.
  let pendingEqual = '';
  const flushHunk = () => {
    if (pending) {
      items.push({ kind: 'hunk', hunk: pending });
      pending = null;
    }
  };
  const flushEqual = () => {
    if (!pendingEqual) return;
    // Merge with a preceding equal item so consecutive equal parts do
    // not fragment the document into many tiny segments.
    const last = items[items.length - 1];
    if (last && last.kind === 'equal') last.text += pendingEqual;
    else items.push({ kind: 'equal', text: pendingEqual });
    pendingEqual = '';
  };

  for (const part of parts) {
    const len = part.value.length;
    if (part.added) {
      // A change starts, so any equal text collected so far comes first.
      flushEqual();
      if (!pending) {
        pending = {
          origStart: origPos,
          origEnd: origPos,
          original: '',
          replacement: '',
        };
      }
      pending.replacement += part.value;
    } else if (part.removed) {
      flushEqual();
      if (!pending) {
        pending = {
          origStart: origPos,
          origEnd: origPos,
          original: '',
          replacement: '',
        };
      }
      pending.original += part.value;
      pending.origEnd = origPos + len;
      origPos += len;
    } else {
      // Equal text closes the hunk that precedes it.
      flushHunk();
      pendingEqual += part.value;
      origPos += len;
    }
  }
  flushHunk();
  flushEqual();

  const edits: ProposedEdit[] = [];
  const segments: CompareSegment[] = [];
  let skippedHunks = 0;
  let n = 0;
  for (const item of items) {
    if (item.kind === 'equal') {
      segments.push({ kind: 'unchanged', text: item.text });
      continue;
    }

    const hunk = item.hunk;
    n += 1;
    let coreOriginal = hunk.original;
    let coreReplacement = hunk.replacement;
    let start = hunk.origStart;
    let end = hunk.origEnd;

    if (!coreOriginal) {
      const ctx = pickInsertContext(original, hunk.origStart);
      if (!ctx) {
        skippedHunks += 1;
        segments.push({
          kind: 'skipped',
          originalText: hunk.original,
          revisedText: hunk.replacement,
        });
        continue;
      }
      start = ctx.start;
      end = ctx.end;
      coreOriginal = ctx.text;
      coreReplacement =
        ctx.where === 'before'
          ? ctx.text + hunk.replacement
          : hunk.replacement + ctx.text;
    }

    const expanded = expandUntilUnique(
      original,
      start,
      end,
      coreOriginal,
      coreReplacement
    );
    if (!expanded) {
      skippedHunks += 1;
      segments.push({
        kind: 'skipped',
        originalText: hunk.original,
        revisedText: hunk.replacement,
      });
      continue;
    }

    const editId = `compare-${n}`;
    edits.push({
      id: editId,
      summary: summarizeHunk(hunk.original, hunk.replacement),
      rationale: 'Produced by document compare (not an AI suggestion).',
      original: expanded.original,
      replacement: expanded.replacement,
    });
    segments.push({
      kind: 'change',
      editId,
      // The raw hunk text — NOT the expanded anchor. The expansion adds
      // neighbouring lines that are also present in the unchanged runs,
      // so rendering it here would duplicate that text.
      originalText: hunk.original,
      revisedText: hunk.replacement,
    });
  }

  return { edits, skippedHunks, segments };
}

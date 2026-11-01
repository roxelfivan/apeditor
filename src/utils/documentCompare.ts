/**
 * Turn a two-document line diff into a `ProposedEdit[]` that the
 * existing Apply waterfall can consume. Current document = Original;
 * the imported / other document = Revised (Word Compare).
 */

import { diffLines } from 'diff';
import type { ProposedEdit } from '@/types';

export interface CompareResult {
  edits: ProposedEdit[];
  skippedHunks: number;
}

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
 */
export function compareToProposedEdits(
  original: string,
  revised: string
): CompareResult {
  if (original === revised) return { edits: [], skippedHunks: 0 };
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
    };
  }

  const parts = diffLines(original, revised);
  type Hunk = {
    origStart: number;
    origEnd: number;
    original: string;
    replacement: string;
  };
  const hunks: Hunk[] = [];
  let origPos = 0;
  let pending: Hunk | null = null;
  const flush = () => {
    if (pending) hunks.push(pending);
    pending = null;
  };

  for (const part of parts) {
    const len = part.value.length;
    if (part.added) {
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
      flush();
      origPos += len;
    }
  }
  flush();

  const edits: ProposedEdit[] = [];
  let skippedHunks = 0;
  let n = 0;
  for (const hunk of hunks) {
    n += 1;
    let coreOriginal = hunk.original;
    let coreReplacement = hunk.replacement;
    let start = hunk.origStart;
    let end = hunk.origEnd;

    if (!coreOriginal) {
      const ctx = pickInsertContext(original, hunk.origStart);
      if (!ctx) {
        skippedHunks += 1;
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
      continue;
    }

    edits.push({
      id: `compare-${n}`,
      summary: summarizeHunk(hunk.original, hunk.replacement),
      rationale: 'Produced by document compare (not an AI suggestion).',
      original: expanded.original,
      replacement: expanded.replacement,
    });
  }

  return { edits, skippedHunks };
}

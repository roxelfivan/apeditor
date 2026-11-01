/**
 * Preview-only heading numbering for legal / structured documents.
 *
 * Labels are computed from ATX and Setext headings in source order and
 * painted by the Preview renderer. Stored markdown is never rewritten.
 */

export type OutlineScheme = 'off' | 'decimal' | 'legal';

export function isOutlineScheme(value: unknown): value is OutlineScheme {
  return value === 'off' || value === 'decimal' || value === 'legal';
}

const ATX_HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const SETEXT_H1_RE = /^=+\s*$/;
const SETEXT_H2_RE = /^-{2,}\s*$/;

export interface HeadingMark {
  level: number;
  title: string;
  /** 1-based source line of the heading title. */
  line: number;
}

/**
 * Collect ATX / Setext headings, skipping fenced code blocks.
 * Indented `#` lines are not headings (CommonMark §4.2).
 */
export function collectMarkdownHeadings(content: string): HeadingMark[] {
  const lines = content.split('\n');
  const out: HeadingMark[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^(`{3,}|~{3,})/.test(line.trimStart()) && !line.startsWith('    ')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^[ \t]/.test(line)) continue;

    const atx = line.match(ATX_HEADING_RE);
    if (atx) {
      out.push({
        level: atx[1].length,
        title: atx[2].replace(/\s+#+\s*$/, '').trim(),
        line: i + 1,
      });
      continue;
    }

    const next = lines[i + 1];
    if (next !== undefined && !/^[ \t]/.test(next)) {
      if (SETEXT_H1_RE.test(next) && line.trim()) {
        out.push({ level: 1, title: line.trim(), line: i + 1 });
        i += 1;
        continue;
      }
      if (SETEXT_H2_RE.test(next) && line.trim()) {
        out.push({ level: 2, title: line.trim(), line: i + 1 });
        i += 1;
      }
    }
  }
  return out;
}

/** Advance a 1-based heading-level counter stack. */
export function nextOutlineCounters(counters: number[], level: number): number[] {
  const depth = Math.max(1, Math.min(6, Math.floor(level)));
  const next = counters.slice(0, depth);
  while (next.length < depth) next.push(0);
  next[depth - 1] = (next[depth - 1] ?? 0) + 1;
  for (let i = 0; i < next.length; i++) {
    if (next[i] < 1) next[i] = 1;
  }
  return next;
}

const ROMAN = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
] as const;

export function toRoman(n: number): string {
  let remaining = Math.max(1, Math.floor(n));
  let out = '';
  for (const [value, glyph] of ROMAN) {
    while (remaining >= value) {
      out += glyph;
      remaining -= value;
    }
  }
  return out;
}

/** 1 → a, 26 → z, 27 → aa. */
export function toLetter(n: number): string {
  let remaining = Math.max(1, Math.floor(n));
  let out = '';
  while (remaining > 0) {
    remaining -= 1;
    out = String.fromCharCode(97 + (remaining % 26)) + out;
    remaining = Math.floor(remaining / 26);
  }
  return out;
}

export function formatOutlineLabel(
  counters: number[],
  scheme: OutlineScheme
): string {
  if (scheme === 'off' || counters.length === 0) return '';
  if (scheme === 'decimal') return counters.join('.');
  const [article, section, clause, ...rest] = counters;
  if (counters.length === 1) return `Article ${toRoman(article)}`;
  if (counters.length === 2) return `Section ${section}`;
  if (counters.length === 3) return `(${toLetter(clause)})`;
  return [article, section, clause, ...rest].join('.');
}

/** One label per heading in source order. Empty when scheme is off. */
export function labelsForHeadings(
  content: string,
  scheme: OutlineScheme
): string[] {
  if (scheme === 'off') return [];
  const headings = collectMarkdownHeadings(content);
  const labels: string[] = [];
  let counters: number[] = [];
  for (const heading of headings) {
    counters = nextOutlineCounters(counters, heading.level);
    labels.push(formatOutlineLabel(counters, scheme));
  }
  return labels;
}

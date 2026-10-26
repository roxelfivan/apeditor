/**
 * Shared paragraph-boundary and preview helpers.
 *
 * Chat outlines (`buildDocOutline`), @-mention pickers
 * (`useDocumentMentions`), comment-batch serialization, and the
 * re-anchor fallback all treat every `\n` as a paragraph break so
 * offsets stay identical across those surfaces. Keep that rule here
 * — do not reimplement the loop in a caller.
 */

/** Length of the per-paragraph preview used in outlines and pickers. */
export const OUTLINE_PREVIEW_CHARS = 60;

/**
 * Compute paragraph start offsets for `content`. Each `\n` (char
 * code 10) starts a new paragraph; consecutive newlines still produce
 * distinct starts so soft-wrapped and blank-line docs stay aligned.
 */
export function splitParagraphs(content: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) {
      const next = i + 1;
      if (next < content.length && starts[starts.length - 1] !== next) {
        starts.push(next);
      }
    }
  }
  return starts;
}

/**
 * Trim `s` so the returned string is at most `max` characters,
 * ending at a whitespace boundary when that cut is past `max / 2`.
 */
export function trimOnWordBoundary(s: string, max: number): string {
  if (s.length <= max) return s;
  const sliced = s.slice(0, max);
  const sp = sliced.lastIndexOf(' ');
  if (sp > max / 2) return sliced.slice(0, sp);
  return sliced;
}

/**
 * Collapse whitespace, then truncate to `max` on a word boundary
 * with a trailing ellipsis. Used for outline lines and picker titles.
 */
export function previewParagraph(
  raw: string,
  max: number = OUTLINE_PREVIEW_CHARS
): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return trimOnWordBoundary(collapsed, max) + '…';
}

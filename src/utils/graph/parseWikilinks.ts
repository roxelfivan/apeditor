// Wikilink helpers for the Graph view. Syntax matches LLM wiki /
// Obsidian: `[[Page]]`, `[[Page|label]]`, `[[Page#heading]]`,
// `[[Page#heading|label]]`.
//
// Must ignore ApEditor `@` mention sentinels:
//   `\u200B[[mention:id|kind|…]]\u200B`
// Those are not user-authored wikilinks.

import type { DocumentRecord } from '@/types';
import type { HeadingSection } from '@/hooks/useDocumentMentions';

/**
 * Capture groups:
 *   1 — page / term target (stops at `|`, `#`, or `]`)
 *   2 — optional heading fragment after `#`
 * Alias after `|` is accepted and discarded (display-only).
 */
const WIKILINK_RE = /\[\[([^\]|#]+?)(?:#([^\]|]+?))?(?:\|[^\]]+?)?\]\]/g;

export interface WikilinkMatch {
  /** Full `[[…]]` including brackets. */
  raw: string;
  /** Page / term target, trimmed. */
  target: string;
  /** Heading fragment after `#`, if present. */
  heading: string | null;
  /** Inclusive start offset of `raw` in the source string. */
  start: number;
  /** Exclusive end offset of `raw` in the source string. */
  end: number;
}

export type ResolvedWikilink =
  | {
      kind: 'document';
      documentId: string;
      match: WikilinkMatch;
    }
  | {
      kind: 'heading';
      documentId: string;
      headingStart: number;
      headingEnd: number;
      match: WikilinkMatch;
    }
  | {
      kind: 'term';
      slug: string;
      match: WikilinkMatch;
    };

/** Case-fold + collapse whitespace / underscores to a single hyphen. */
export function normalizeWikiSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function extractWikilinks(content: string): WikilinkMatch[] {
  const out: WikilinkMatch[] = [];
  const re = new RegExp(WIKILINK_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const target = (m[1] ?? '').trim();
    if (!target || /^mention:/i.test(target)) continue;
    const headingRaw = (m[2] ?? '').trim();
    out.push({
      raw: m[0],
      target,
      heading: headingRaw.length > 0 ? headingRaw : null,
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

export function findDocumentByWikiTarget(
  documents: DocumentRecord[],
  target: string
): DocumentRecord | undefined {
  const slug = normalizeWikiSlug(target);
  if (!slug) return undefined;
  return documents.find((d) => normalizeWikiSlug(d.title) === slug);
}

export function findHeadingByWikiTarget(
  sections: HeadingSection[] | undefined,
  heading: string
): HeadingSection | undefined {
  if (!sections) return undefined;
  const slug = normalizeWikiSlug(heading);
  if (!slug) return undefined;
  return sections.find(
    (s) => s.level > 0 && normalizeWikiSlug(s.title) === slug
  );
}

export function resolveWikilink(
  match: WikilinkMatch,
  documents: DocumentRecord[],
  sectionsByDocId: Record<string, HeadingSection[]>
): ResolvedWikilink {
  const doc = findDocumentByWikiTarget(documents, match.target);
  if (doc) {
    if (match.heading) {
      const heading = findHeadingByWikiTarget(
        sectionsByDocId[doc.id],
        match.heading
      );
      if (heading) {
        return {
          kind: 'heading',
          documentId: doc.id,
          headingStart: heading.start,
          headingEnd: heading.end,
          match,
        };
      }
    }
    return { kind: 'document', documentId: doc.id, match };
  }
  return {
    kind: 'term',
    slug: normalizeWikiSlug(match.target),
    match,
  };
}

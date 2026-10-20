// Compile a workspace knowledge graph from documents, headings,
// `[[wikilinks]]`, and comment `@` mentions. Pure — no React.

import type { Comment, DocumentRecord, MentionToken } from '@/types';
import {
  buildHeadingSections,
  type HeadingSection,
} from '@/hooks/useDocumentMentions';
import {
  extractWikilinks,
  normalizeWikiSlug,
  resolveWikilink,
} from '@/utils/graph/parseWikilinks';

export type GraphNodeKind = 'document' | 'heading' | 'term';
export type GraphEdgeKind = 'heading' | '@' | 'wikilink';

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  /** Short label shown on the canvas (last path segment). */
  label: string;
  /**
   * Full heading / path for hover. Same as `label` unless the source
   * title was a nested path (`Comment > annotate`).
   */
  fullLabel: string;
  documentId: string | null;
  start: number | null;
  end: number | null;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: GraphEdgeKind;
}

export interface WorkspaceGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function documentNodeId(documentId: string): string {
  return `doc:${documentId}`;
}

export function headingNodeId(documentId: string, start: number): string {
  return `heading:${documentId}:${start}`;
}

export function termNodeId(slug: string): string {
  return `term:${slug}`;
}

export function headingPathNodeId(documentId: string, pathSlug: string): string {
  return `heading-path:${documentId}:${pathSlug}`;
}

/**
 * Split a heading title on path separators so
 * `Comment > annotate` becomes `["Comment", "annotate"]`.
 * Markdown heading *level* still wins when titles have no separator.
 */
export function splitHeadingPath(title: string): string[] {
  return title
    .split(/\s*(?:>|›|→)\s*/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function pathSlugKey(documentId: string, segments: string[]): string {
  return `${documentId}:${segments.map((s) => normalizeWikiSlug(s)).join('/')}`;
}

function parentHeading(
  sections: HeadingSection[],
  index: number
): HeadingSection | null {
  const me = sections[index];
  if (!me || me.level <= 0) return null;
  for (let i = index - 1; i >= 0; i--) {
    const prev = sections[i];
    if (prev.level > 0 && prev.level < me.level) return prev;
  }
  return null;
}

function enclosingHeading(
  sections: HeadingSection[],
  offset: number
): HeadingSection | null {
  for (const s of sections) {
    if (s.level > 0 && offset >= s.start && offset < s.end) return s;
  }
  return null;
}

function headingForParagraphs(
  sections: HeadingSection[],
  indexes: number[]
): HeadingSection | null {
  if (indexes.length === 0) return null;
  const wanted = new Set(indexes);
  let best: HeadingSection | null = null;
  let bestHits = 0;
  for (const s of sections) {
    if (s.level <= 0) continue;
    let hits = 0;
    for (const i of s.paragraphIndexes) {
      if (wanted.has(i)) hits += 1;
    }
    if (hits > bestHits) {
      bestHits = hits;
      best = s;
    }
  }
  return best;
}

function mentionTokensFromComments(comments: Comment[]): MentionToken[] {
  const out: MentionToken[] = [];
  for (const c of comments) {
    if (c.rounds && c.rounds.length > 0) {
      for (const r of c.rounds) {
        if (r.mentions) out.push(...r.mentions);
      }
    }
  }
  return out;
}

export function buildWorkspaceGraph(
  documents: DocumentRecord[],
  commentsByDoc: Record<string, Comment[]> = {}
): WorkspaceGraph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();

  const addNode = (node: GraphNode) => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  };
  const addEdge = (edge: Omit<GraphEdge, 'id'>) => {
    const id = `${edge.kind}:${edge.source}->${edge.target}`;
    if (edges.has(id)) return;
    edges.set(id, { ...edge, id });
  };

  const sectionsByDocId: Record<string, HeadingSection[]> = {};
  for (const doc of documents) {
    sectionsByDocId[doc.id] = buildHeadingSections(doc);
    addNode({
      id: documentNodeId(doc.id),
      kind: 'document',
      label: doc.title,
      fullLabel: doc.title,
      documentId: doc.id,
      start: null,
      end: null,
    });
  }

  for (const doc of documents) {
    const sections = sectionsByDocId[doc.id] ?? [];
    const real = sections.filter((s) => s.level > 0);
    const alias = new Map<string, string>();

    const ensurePathPrefix = (segments: string[]): string => {
      let parentId = documentNodeId(doc.id);
      const acc: string[] = [];
      for (const seg of segments) {
        acc.push(seg);
        const key = pathSlugKey(doc.id, acc);
        let id = alias.get(key);
        if (!id) {
          id = headingPathNodeId(doc.id, acc.map((s) => normalizeWikiSlug(s)).join('/'));
          addNode({
            id,
            kind: 'heading',
            label: seg,
            fullLabel: acc.join(' > '),
            documentId: doc.id,
            start: null,
            end: null,
          });
          addEdge({ source: parentId, target: id, kind: 'heading' });
          alias.set(key, id);
        }
        parentId = id;
      }
      return parentId;
    };

    for (const s of real) {
      const segs = splitHeadingPath(s.title);
      const label = segs[segs.length - 1] ?? s.title;
      addNode({
        id: headingNodeId(doc.id, s.start),
        kind: 'heading',
        label,
        fullLabel: s.title,
        documentId: doc.id,
        start: s.start,
        end: s.end,
      });
    }

    for (const s of real) {
      const segs = splitHeadingPath(s.title);
      if (segs.length === 1) {
        alias.set(pathSlugKey(doc.id, segs), headingNodeId(doc.id, s.start));
      }
    }

    for (let i = 0; i < real.length; i++) {
      const s = real[i];
      const id = headingNodeId(doc.id, s.start);
      const segs = splitHeadingPath(s.title);
      const mdParent = parentHeading(real, i);
      let parentId: string;
      if (segs.length > 1) {
        parentId = ensurePathPrefix(segs.slice(0, -1));
      } else if (mdParent) {
        parentId = headingNodeId(doc.id, mdParent.start);
      } else {
        parentId = documentNodeId(doc.id);
      }
      addEdge({ source: parentId, target: id, kind: 'heading' });
    }
  }

  for (const doc of documents) {
    const sections = sectionsByDocId[doc.id] ?? [];
    for (const match of extractWikilinks(doc.content)) {
      const resolved = resolveWikilink(match, documents, sectionsByDocId);
      const fromHeading = enclosingHeading(sections, match.start);
      const source = fromHeading
        ? headingNodeId(doc.id, fromHeading.start)
        : documentNodeId(doc.id);

      if (resolved.kind === 'document') {
        addEdge({
          source,
          target: documentNodeId(resolved.documentId),
          kind: 'wikilink',
        });
        continue;
      }
      if (resolved.kind === 'heading') {
        addEdge({
          source,
          target: headingNodeId(resolved.documentId, resolved.headingStart),
          kind: 'wikilink',
        });
        continue;
      }
      if (!resolved.slug) continue;
      const tid = termNodeId(resolved.slug);
      const existing = nodes.get(tid);
      if (!existing) {
        addNode({
          id: tid,
          kind: 'term',
          label: match.target,
          fullLabel: match.target,
          documentId: doc.id,
          start: match.start,
          end: match.end,
        });
      }
      addEdge({ source, target: tid, kind: 'wikilink' });
    }
  }

  for (const doc of documents) {
    const tokens = mentionTokensFromComments(commentsByDoc[doc.id] ?? []);
    const sourceId = documentNodeId(doc.id);
    for (const token of tokens) {
      const targetDoc = documents.find((d) => d.id === token.documentId);
      if (!targetDoc) continue;
      const targetSections = sectionsByDocId[targetDoc.id] ?? [];
      const heading =
        token.kind === 'doc-section'
          ? headingForParagraphs(targetSections, token.paragraphIndexes)
          : null;
      addEdge({
        source: sourceId,
        target: heading
          ? headingNodeId(targetDoc.id, heading.start)
          : documentNodeId(targetDoc.id),
        kind: '@',
      });
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

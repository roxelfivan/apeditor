/**
 * Bear-style nested tags. Paths are stored without a leading `#`
 * (`drafts/essays`) and may appear in document metadata and/or as
 * hashtags in the markdown body.
 */

const TAG_TOKEN = '[A-Za-z][A-Za-z0-9_-]*';
const HASHTAG_RE = new RegExp(
  `(^|[^A-Za-z0-9_/#])#(${TAG_TOKEN}(?:\\/${TAG_TOKEN})*)\\b`,
  'g'
);

export function normalizeTagPath(raw: string): string | null {
  const trimmed = raw.trim().replace(/^#+/, '').replace(/^\/+|\/+$/g, '');
  if (!trimmed) return null;
  const parts = trimmed.split('/').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const ok = parts.every((p) => new RegExp(`^${TAG_TOKEN}$`).test(p));
  if (!ok) return null;
  return parts.join('/');
}

export function normalizeTagList(tags: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags ?? []) {
    const n = normalizeTagPath(tag);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function segmentsOutsideCode(content: string): string[] {
  const parts = content.split(/(```[\s\S]*?(?:```|$))/);
  const out: string[] = [];
  for (const part of parts) {
    if (part.startsWith('```')) continue;
    // Drop inline `code` so `#tag` inside it is ignored.
    out.push(part.replace(/`[^`]*`/g, ' '));
  }
  return out;
}

/** Hashtags in the body, excluding fenced / inline code and ATX headings. */
export function extractHashtags(content: string): string[] {
  const found: string[] = [];
  for (const segment of segmentsOutsideCode(content)) {
    const lines = segment.split('\n');
    for (const line of lines) {
      if (/^#{1,6}\s/.test(line)) continue;
      HASHTAG_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = HASHTAG_RE.exec(line))) {
        const n = normalizeTagPath(m[2]);
        if (n) found.push(n);
      }
    }
  }
  return normalizeTagList(found);
}

export function mergeDocumentTags(
  explicit: readonly string[] | undefined,
  content: string
): string[] {
  return normalizeTagList([...(explicit ?? []), ...extractHashtags(content)]);
}

export interface TagNode {
  name: string;
  path: string;
  children: TagNode[];
  /** Documents tagged with this exact path (not descendants). */
  docIds: string[];
}

export function buildTagTree(
  docs: readonly { id: string; tags?: readonly string[] }[]
): TagNode[] {
  const roots: TagNode[] = [];

  const ensure = (parts: string[]): TagNode => {
    let list = roots;
    let path = '';
    let node: TagNode | undefined;
    for (const name of parts) {
      path = path ? `${path}/${name}` : name;
      node = list.find((n) => n.name === name);
      if (!node) {
        node = { name, path, children: [], docIds: [] };
        list.push(node);
      }
      list = node.children;
    }
    return node!;
  };

  for (const doc of docs) {
    for (const tag of normalizeTagList(doc.tags)) {
      const node = ensure(tag.split('/'));
      if (!node.docIds.includes(doc.id)) node.docIds.push(doc.id);
    }
  }

  const sortNodes = (nodes: TagNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    for (const n of nodes) sortNodes(n.children);
  };
  sortNodes(roots);
  return roots;
}

export function tagMatchesQuery(path: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return path.toLowerCase().includes(q.replace(/^#/, ''));
}

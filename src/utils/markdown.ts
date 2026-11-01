// Shared react-markdown plugin wiring.
//
// Raw HTML is allowed so the B/I/U toolbar's `<u>` tags render, but every
// HTML node is run through rehype-sanitize afterward so untrusted document
// or assistant content cannot execute scripts (stored XSS → localStorage
// API-key theft).
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema, type Options as SanitizeOptions } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import type { PluggableList } from 'unified';

const sanitizeSchema: SanitizeOptions = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'u', 'span'],
  attributes: {
    ...defaultSchema.attributes,
    // Preview injects `<span class="wiki-link">` and `<mark class="pe-doc-highlight">`.
    span: [...(defaultSchema.attributes?.span ?? []), 'className'],
    mark: [...(defaultSchema.attributes?.mark ?? []), 'className'],
    // Source-line gutters (`data-line` from mdast positions).
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'dataLine'],
  },
};

interface HastLike {
  type?: string;
  children?: unknown[];
  properties?: Record<string, unknown>;
  position?: { start?: { line?: number } };
}

/** Stamp `data-line` from mdast positions onto block elements for Preview gutters. */
export function rehypeSourceLines() {
  return (tree: HastLike) => {
    const walk = (node: HastLike) => {
      if (node.type === 'element') {
        const line = node.position?.start?.line;
        if (typeof line === 'number' && line > 0) {
          node.properties = node.properties ?? {};
          if (node.properties.dataLine == null) {
            node.properties.dataLine = String(line);
          }
        }
      }
      if (Array.isArray(node.children)) {
        for (const child of node.children) {
          if (child && typeof child === 'object') walk(child as HastLike);
        }
      }
    };
    walk(tree);
  };
}

export const remarkPlugins: PluggableList = [remarkGfm];

/** Parse raw HTML, then strip dangerous tags/attrs (scripts, handlers, …). */
export const rehypePlugins: PluggableList = [
  rehypeRaw,
  rehypeSourceLines,
  [rehypeSanitize, sanitizeSchema],
];

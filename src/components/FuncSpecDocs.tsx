/**
 * In-app Functional Specification viewer — a documentation overlay
 * that renders the markdown files under `func_spec/`.
 *
 * Structurally a sibling of `HelpDocs.tsx` (same shell, same theme
 * tokens, same markdown plugin stack) but with three differences that
 * matter for a developer manual:
 *
 *  1. The sidebar is grouped by *part* (Part I … Part V) instead of
 *     being a flat page list.
 *  2. Headings get generated `id` anchors, so `#anchor` deep links
 *     inside the manual actually work (the Help viewer does not
 *     render heading ids, so in-page anchors silently no-op there).
 *  3. Cross-file markdown links (`./04-state-and-persistence.md#…`)
 *     navigate within the viewer rather than opening a browser tab,
 *     and the target anchor is scrolled into view after render.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import { remarkPlugins, rehypePlugins } from '@/utils/markdown';
import {
  FUNC_SPEC_PAGES,
  FUNC_SPEC_PAGES_BY_PART,
  FUNC_SPEC_PARTS,
  FUNC_SPEC_ORDER,
  FUNC_SPEC_DEFAULT_PAGE,
  getFuncSpecPageContent,
  getFuncSpecPageMeta,
  funcSpecPageIdFromHref,
} from '@/docs/funcSpecCatalog';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Optional deep-link when opening (defaults to the overview page). */
  initialPage?: string;
}

const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? '0.0.0';

/**
 * GitHub-compatible heading slug. Must stay in sync with what a
 * developer would type after `#` on github.com, because the same
 * anchors are reused from the README and PR descriptions.
 */
function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\- ]+/g, '')
    .replace(/\s+/g, '-');
}

/**
 * Per-render heading slugger. React renders heading components in
 * document order, so a mutable counter closure assigned into the
 * components map gives stable, unique ids without a remark plugin.
 */
function makeSlugger() {
  const seen = new Map<string, number>();
  return (text: string): string => {
    const base = slugify(String(text ?? '')) || 'section';
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };
}

/**
 * Scroll the element with `id` into view inside the article scroller.
 * Deferred by one frame because the article has not been painted on
 * the render that changes `pageId`.
 */
function useScrollToAnchor(scrollerRef: React.RefObject<HTMLElement>, anchor: string | null) {
  useEffect(() => {
    if (!anchor) return;
    const frame = window.requestAnimationFrame(() => {
      const root = scrollerRef.current;
      if (!root) return;
      const target = root.querySelector(`#${CSS.escape(anchor)}`);
      if (target instanceof HTMLElement) {
        target.scrollIntoView({ block: 'start' });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [anchor, scrollerRef]);
}

export function FuncSpecDocs({ open, onClose, initialPage }: Props) {
  const [pageId, setPageId] = useState<string>(initialPage ?? FUNC_SPEC_DEFAULT_PAGE);
  const [anchor, setAnchor] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Reset to the requested page whenever the overlay is (re)opened.
  useEffect(() => {
    if (open) {
      setPageId(initialPage ?? FUNC_SPEC_DEFAULT_PAGE);
      setAnchor(null);
    }
  }, [open, initialPage]);

  // Escape closes (same as the Help overlay).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useScrollToAnchor(scrollerRef, anchor);

  const content = useMemo(() => getFuncSpecPageContent(pageId), [pageId]);
  const meta = getFuncSpecPageMeta(pageId) ?? FUNC_SPEC_PAGES[0];

  const slugger = useMemo(() => makeSlugger(), [pageId]);

  const heading = useCallback(
    (Tag: 'h1' | 'h2' | 'h3' | 'h4') =>
      ({ children, ...rest }: { children?: React.ReactNode }) => {
        const id = slugger(
          typeof children === 'string' ? children : String(children ?? ''),
        );
        return (
          <Tag id={id} {...rest}>
            {children}
          </Tag>
        );
      },
    [slugger],
  );

  const markdownComponents = useMemo<Components>(
    () => ({
      h1: heading('h1'),
      h2: heading('h2'),
      h3: heading('h3'),
      h4: heading('h4'),
      a: ({ href, children, ...rest }) => {
        const target = href ? funcSpecPageIdFromHref(href) : null;
        if (target) {
          const [, hash = ''] = (href ?? '').split('#');
          return (
            <a
              {...rest}
              href={href}
              onClick={(e) => {
                e.preventDefault();
                setPageId(target);
                setAnchor(hash || null);
              }}
            >
              {children}
            </a>
          );
        }
        if (href?.startsWith('#')) {
          const hash = href.slice(1);
          return (
            <a {...rest} href={href} onClick={(e) => {
              e.preventDefault();
              setAnchor(hash || null);
            }}>
              {children}
            </a>
          );
        }
        return (
          <a {...rest} href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        );
      },
      // Give fenced code blocks the app's own surface so wide tables and
      // TypeScript stay readable inside the article column.
      code: ({ className, children, ...rest }) => (
        <code {...rest} className={className}>
          {children}
        </code>
      ),
    }),
    [heading],
  );

  if (!open) return null;

  const order = FUNC_SPEC_ORDER[pageId] ?? 0;
  const prevPage = FUNC_SPEC_PAGES[order - 1];
  const nextPage = FUNC_SPEC_PAGES[order + 1];

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col bg-paper-base dark:bg-ape-base"
      role="dialog"
      aria-modal="true"
      aria-label="ApEditor Functional Specification"
    >
      <header className="h-14 sm:h-16 px-4 flex items-center gap-3 border-b border-paper-hairline dark:border-cyber-border bg-paper-surface/95 dark:bg-ape-panel/95 backdrop-blur-sm shrink-0 pt-[env(safe-area-inset-top)]">
        <img
          src="/apeditor-logo-transparent.png"
          alt=""
          className="brand-mark h-9 w-9 object-contain"
        />
        <div className="flex flex-col leading-tight min-w-0">
          <span className="display text-lg text-paper-ink dark:text-cyber-primary truncate">
            Functional Specification
          </span>
          <span className="text-[10px] text-paper-inkSoft dark:text-cyber-muted font-mono truncate">
            Developer guide · v{APP_VERSION} · func_spec/
          </span>
        </div>
        <div className="flex-1" />
        <p className="hidden lg:block text-xs text-paper-inkSoft dark:text-cyber-muted max-w-sm text-right">
          Architecture, contracts, and maintenance notes for the codebase.
          Same pages as{' '}
          <code className="font-mono text-[11px]">func_spec/</code>.
        </p>
        <button
          type="button"
          className="btn-icon-square"
          onClick={onClose}
          title="Close Functional Specification (Esc)"
          aria-label="Close Functional Specification"
        >
          <span className="text-lg leading-none" aria-hidden>
            ×
          </span>
        </button>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        <nav
          className="lg:w-72 shrink-0 border-b lg:border-b-0 lg:border-r border-paper-hairline dark:border-cyber-border overflow-x-auto lg:overflow-y-auto bg-paper-elevated/40 dark:bg-ape-elevated/40 max-h-44 lg:max-h-none"
          aria-label="Functional Specification sections"
        >
          <div className="p-3 lg:p-2 flex lg:block gap-2 lg:gap-0">
            {FUNC_SPEC_PARTS.map((part) => {
              const pages = FUNC_SPEC_PAGES_BY_PART[part.id] ?? [];
              return (
                <section key={part.id} className="mb-1 min-w-0">
                  <h2 className="px-3 py-1.5 text-[10px] uppercase tracking-wider font-semibold text-paper-inkSoft dark:text-cyber-muted whitespace-nowrap lg:whitespace-normal">
                    {part.title}
                  </h2>
                  <ul className="flex lg:block gap-1">
                    {pages.map((page) => {
                      const active = page.id === pageId;
                      return (
                        <li key={page.id} className="shrink-0">
                          <button
                            type="button"
                            title={page.blurb}
                            aria-current={active ? 'page' : undefined}
                            onClick={() => {
                              setPageId(page.id);
                              setAnchor(null);
                            }}
                            className={`w-full text-left px-3 py-1.5 text-sm whitespace-nowrap lg:whitespace-normal border-b-2 lg:border-b-0 lg:border-l-2 transition-colors ${
                              active
                                ? 'border-cyber-clay dark:border-cyber-cyan bg-paper-surface dark:bg-ape-panel text-cyber-clay dark:text-cyber-cyan font-semibold'
                                : 'border-transparent text-paper-ink dark:text-cyber-primary hover:bg-paper-surface/70 dark:hover:bg-ape-panel/70'
                            }`}
                          >
                            {page.title}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        </nav>

        <div ref={scrollerRef} className="flex-1 overflow-y-auto min-h-0">
          <article className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8 prose-md help-docs-article">
            <p className="text-[11px] uppercase tracking-wider font-semibold text-cyber-clay dark:text-cyber-cyan mb-3 !mt-0">
              {meta.title}
            </p>
            <ReactMarkdown
              remarkPlugins={remarkPlugins}
              rehypePlugins={rehypePlugins}
              components={markdownComponents}
            >
              {content}
            </ReactMarkdown>

            <nav
              className="mt-10 pt-4 border-t border-paper-hairline dark:border-cyber-border flex items-stretch gap-2 not-prose"
              aria-label="Previous and next page"
            >
              {prevPage ? (
                <button
                  type="button"
                  onClick={() => {
                    setPageId(prevPage.id);
                    setAnchor(null);
                  }}
                  className="flex-1 text-left px-3 py-2 rounded border border-paper-hairline dark:border-cyber-border text-sm hover:bg-paper-elevated/60 dark:hover:bg-ape-elevated/60 min-w-0"
                >
                  <span className="block text-[10px] uppercase tracking-wider text-paper-inkSoft dark:text-cyber-muted">
                    ← Previous
                  </span>
                  <span className="block truncate">{prevPage.title}</span>
                </button>
              ) : (
                <span className="flex-1" />
              )}
              {nextPage ? (
                <button
                  type="button"
                  onClick={() => {
                    setPageId(nextPage.id);
                    setAnchor(null);
                  }}
                  className="flex-1 text-right px-3 py-2 rounded border border-paper-hairline dark:border-cyber-border text-sm hover:bg-paper-elevated/60 dark:hover:bg-ape-elevated/60 min-w-0"
                >
                  <span className="block text-[10px] uppercase tracking-wider text-paper-inkSoft dark:text-cyber-muted">
                    Next →
                  </span>
                  <span className="block truncate">{nextPage.title}</span>
                </button>
              ) : (
                <span className="flex-1" />
              )}
            </nav>
          </article>
        </div>
      </div>
    </div>
  );
}

/** Open the Functional Specification from outside React. */
export function openFuncSpecDocs(page?: string): void {
  window.dispatchEvent(new CustomEvent('mvp:open-func-spec', { detail: page }));
}
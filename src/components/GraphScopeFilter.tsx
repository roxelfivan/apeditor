// GraphScopeFilter — the popover behind the Graph view's "Filter"
// button. Chooses which documents and which of their sections appear
// in the graph.
//
// The visual language is `.mention-popover*`, the same family as the
// `@`-section picker: checkbox rows, a level gutter, and cascading
// parent ticks. Reusing the classes is the point — a filter and a
// `@`-section picker are the same mental operation, and a second
// bespoke widget for it would read as a different product.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DocumentRecord } from '@/types';
import { buildHeadingSections } from '@/hooks/useDocumentMentions';
import {
  createNoneScope,
  createScope,
  isScopeEmpty,
  normalizeScope,
  resolveDocumentIds,
  type GraphScope,
} from '@/utils/graph/graphFilter';

/** Viewport padding when clamping the popover on screen. */
const VIEWPORT_PAD = 8;
const POPOVER_WIDTH = 320;

interface SectionEntry {
  kind: 'section';
  docId: string;
  /** `heading:<docId>:<start>` — the node id this row toggles. */
  nodeId: string;
  level: number;
  title: string;
  /** Row position in the flat keyboard-walk order. */
  rowIndex: number;
}

interface DocEntry {
  kind: 'doc';
  doc: DocumentRecord;
  rowIndex: number;
  sections: SectionEntry[];
}

interface Props {
  documents: DocumentRecord[];
  currentDocumentId: string | null;
  scope: GraphScope;
  onChange: (next: GraphScope) => void;
  onClose: () => void;
  /** Viewport-space rect of the Filter button. */
  anchor: DOMRect;
}

/**
 * Section rows are derived from the document's own headings rather
 * than from the graph, so the panel cannot offer a row the compiler
 * never made a node for. `level > 0` mirrors Pass 1 of
 * `buildWorkspaceGraph` exactly — preamble and blank-line fallback
 * blocks are not nodes, so they are not rows.
 */
function buildEntries(documents: DocumentRecord[]): DocEntry[] {
  const entries: DocEntry[] = [];
  let row = 0;
  for (const doc of documents) {
    const docRow = row++;
    const sections: SectionEntry[] = [];
    for (const s of buildHeadingSections(doc)) {
      if (s.level <= 0) continue;
      sections.push({
        kind: 'section',
        docId: doc.id,
        nodeId: `heading:${doc.id}:${s.start}`,
        level: s.level,
        title: s.title || '(untitled section)',
        rowIndex: row++,
      });
    }
    entries.push({ kind: 'doc', doc, rowIndex: docRow, sections });
  }
  return entries;
}

/**
 * Pin the popover to the viewport so the Filter button, which sits in
 * a wrapping toolbar, cannot shove it off a narrow layout. Mirrors
 * `clampPopoverToViewport` in `FileActionsButton.tsx`.
 */
function clampToViewport(panel: HTMLElement, anchor: DOMRect) {
  const pad = VIEWPORT_PAD;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxW = Math.min(POPOVER_WIDTH, Math.max(0, vw - pad * 2));
  panel.style.width = `${maxW}px`;
  panel.style.maxWidth = `${Math.max(0, vw - pad * 2)}px`;

  let left = Math.min(anchor.left, vw - pad - maxW);
  if (left < pad) left = pad;

  const h = panel.offsetHeight;
  panel.style.maxHeight = `${Math.max(0, vh - pad * 2)}px`;
  let top = anchor.top;
  if (top + h > vh - pad) top = Math.max(pad, vh - pad - h);

  panel.style.position = 'fixed';
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

export function GraphScopeFilter({
  documents,
  currentDocumentId,
  scope,
  onChange,
  onClose,
  anchor,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  const entries = useMemo(() => buildEntries(documents), [documents]);
  const rowCount = useMemo(
    () => entries.reduce((n, e) => n + 1 + e.sections.length, 0),
    [entries]
  );

  const includedDocs = useMemo(
    () => resolveDocumentIds(scope, entries.map((e) => e.doc.id)),
    [scope, entries]
  );

  /**
   * Expanded section selection per document: a document with no entry
   * in `scope.sectionIds` shows all of its sections, so the panel has
   * to resolve that shorthand before it can draw a tick. Stale ids are
   * dropped too — a heading the user deleted since the scope was set
   * would otherwise keep its checkbox lit.
   */
  const includedSections = useMemo(() => {
    const out = new Map<string, Set<string>>();
    for (const e of entries) {
      const only = scope.sectionIds.get(e.doc.id);
      out.set(
        e.doc.id,
        only
          ? new Set(
              [...only].filter((id) => e.sections.some((s) => s.nodeId === id))
            )
          : new Set(e.sections.map((s) => s.nodeId))
      );
    }
    return out;
  }, [scope, entries]);

  const includedDocCount = entries.filter((e) =>
    includedDocs.has(e.doc.id)
  ).length;
  const activeFilter = !isScopeEmpty(scope);

  // Emit only scopes that actually restrict something. Without this a
  // fully-ticked panel would report a filter as active, and Reset would
  // not look like it had taken.
  const emit = (next: GraphScope) =>
    onChange(normalizeScope(next, entries.map((e) => e.doc.id)));

  const toggleDocument = (docId: string) => {
    const nextDocs = new Set(includedDocs);
    const wasIncluded = nextDocs.has(docId);
    if (wasIncluded) nextDocs.delete(docId);
    else nextDocs.add(docId);
    // Deselecting a document takes its sections with it. Otherwise a
    // later re-tick would restore a section choice the user cannot see
    // was ever made.
    const nextSections = new Map(scope.sectionIds);
    if (wasIncluded) nextSections.delete(docId);
    // Empty after an untick must not become the "show everything"
    // shorthand — that made unticking the last document a no-op.
    if (wasIncluded && nextDocs.size === 0) {
      emit(createNoneScope());
      return;
    }
    emit({ documentIds: nextDocs, sectionIds: nextSections });
  };

  const toggleSection = (docId: string, section: SectionEntry) => {
    const entry = entries.find((e) => e.doc.id === docId);
    if (!entry) return;
    const current = includedSections.get(docId) ?? new Set<string>();
    const willSelect = !current.has(section.nodeId);
    const next = new Set(current);
    if (willSelect) next.add(section.nodeId);
    else next.delete(section.nodeId);

    // Cascade. Ticking a parent selects its descendants; unticking
    // removes them. Matches the @-section picker, where one click has
    // to cover a whole sub-outline.
    for (const s of entry.sections) {
      if (s.rowIndex <= section.rowIndex) continue;
      if (s.level <= section.level) break;
      if (willSelect) next.add(s.nodeId);
      else next.delete(s.nodeId);
    }

    const nextSections = new Map(scope.sectionIds);
    // A fully-selected document is the default; drop the entry so the
    // scope normalizes back to "no filter for this document".
    if (next.size === entry.sections.length) nextSections.delete(docId);
    else nextSections.set(docId, next);
    emit({ documentIds: new Set(includedDocs), sectionIds: nextSections });
  };

  /** Row at `index` in the flat keyboard walk, or null when out of range. */
  const rowAt = (index: number): DocEntry | SectionEntry | null => {
    for (const e of entries) {
      if (e.rowIndex === index) return e;
      for (const s of e.sections) {
        if (s.rowIndex === index) return s;
      }
    }
    return null;
  };

  const toggleRow = (index: number) => {
    const row = rowAt(index);
    if (!row) return;
    if (row.kind === 'doc') toggleDocument(row.doc.id);
    else toggleSection(row.docId, row);
  };

  const setAll = (on: boolean) => {
    if (on) {
      onChange(createScope());
      return;
    }
    // "None" still has to leave a graph that lays out, and the user
    // needs a way back that does not involve hunting for Reset. Keeping
    // the current document reads as "nothing but this page", which is
    // both useful and reversible.
    const fallback = documents.some((d) => d.id === currentDocumentId)
      ? currentDocumentId
      : null;
    emit({
      documentIds: new Set(fallback ? [fallback] : []),
      sectionIds: new Map(),
    });
  };

  const invert = () => {
    const nextDocs = new Set<string>();
    for (const e of entries) {
      if (!includedDocs.has(e.doc.id)) nextDocs.add(e.doc.id);
    }
    const nextSections = new Map<string, Set<string>>();
    for (const e of entries) {
      const current = includedSections.get(e.doc.id) ?? new Set<string>();
      const flipped = e.sections
        .filter((s) => !current.has(s.nodeId))
        .map((s) => s.nodeId);
      if (flipped.length > 0) nextSections.set(e.doc.id, new Set(flipped));
    }
    // Invert of "everything" is "nothing", not the empty-set shorthand.
    if (nextDocs.size === 0) {
      emit(createNoneScope());
      return;
    }
    emit({ documentIds: nextDocs, sectionIds: nextSections });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, rowCount - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        toggleRow(active);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'a' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setAll(true);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // `toggleRow` closes over state that changes every render; the
    // listener is re-bound on each of those renders, which is cheap
    // next to the popover's own re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowCount, active, entries, scope, onClose]);

  // Outside press closes, matching the Format menu's `pointerdown`
  // listener. `pointerdown` rather than `click` so the close lands
  // before a click reaches whatever is underneath.
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-graph-scope-filter]')) return;
      if (target.closest('[data-graph-view-controls]')) return;
      onClose();
    };
    window.addEventListener('pointerdown', handler);
    return () => window.removeEventListener('pointerdown', handler);
  }, [onClose]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    clampToViewport(panel, anchor);
  }, [anchor]);

  return createPortal(
    <div
      className="graph-scope-filter-root"
      data-graph-scope-filter
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="graph-scope-filter-backdrop"
        aria-label="Close filter"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Filter graph documents and sections"
        className="mention-popover graph-scope-filter"
        style={{ minWidth: Math.min(POPOVER_WIDTH, window.innerWidth - 16) }}
      >
      <div className="mention-popover__header">
        <span className="mention-popover__icon" aria-hidden>
          ⌗
        </span>
        <span className="mention-popover__title">Filter</span>
        <span className="mention-popover__hint hidden sm:inline">
          space toggles · esc closes
        </span>
      </div>
      <div className="mention-popover__list">
        {entries.length === 0 ? (
          <div className="mention-popover__empty">
            No documents yet. Create one in the sidebar to include it.
          </div>
        ) : (
          entries.map((entry) => {
            const docId = entry.doc.id;
            const docIncluded = includedDocs.has(docId);
            const sections = includedSections.get(docId) ?? new Set<string>();
            return (
              <div key={docId}>
                <button
                  type="button"
                  role="option"
                  aria-selected={docIncluded}
                  className={`mention-popover__item ${
                    entry.rowIndex === active
                      ? 'mention-popover__item--active'
                      : ''
                  }`}
                  onMouseEnter={() => setActive(entry.rowIndex)}
                  onClick={() => toggleDocument(docId)}
                >
                  <span
                    className={`mention-popover__checkbox ${
                      docIncluded ? 'mention-popover__checkbox--checked' : ''
                    }`}
                    aria-hidden
                  >
                    {docIncluded ? '☑' : '☐'}
                  </span>
                  <span className="mention-popover__icon" aria-hidden>
                    📄
                  </span>
                  <span className="mention-popover__preview">
                    {entry.doc.title || 'Untitled'}
                  </span>
                  <span className="mention-popover__count">
                    {docIncluded
                      ? `${sections.size}/${entry.sections.length}`
                      : '—'}
                  </span>
                </button>
                {/* Sections collapse with their document. Hiding them
                    beats showing a ticked checkbox the filter is not
                    yet honouring. */}
                {docIncluded &&
                  entry.sections.map((section) => {
                    const isChecked = sections.has(section.nodeId);
                    return (
                      <button
                        key={section.nodeId}
                        type="button"
                        role="option"
                        aria-selected={isChecked}
                        className={`mention-popover__item mention-popover__item--row ${
                          section.rowIndex === active
                            ? 'mention-popover__item--active'
                            : ''
                        }`}
                        style={{
                          paddingLeft: 8 + (section.level - 1) * 12,
                        }}
                        onMouseEnter={() => setActive(section.rowIndex)}
                        onClick={() => toggleSection(docId, section)}
                      >
                        <span
                          className={`mention-popover__checkbox ${
                            isChecked ? 'mention-popover__checkbox--checked' : ''
                          }`}
                          aria-hidden
                        >
                          {isChecked ? '☑' : '☐'}
                        </span>
                        <span className="mention-popover__level" aria-hidden>
                          H{section.level}
                        </span>
                        <span className="mention-popover__preview">
                          {section.title}
                        </span>
                      </button>
                    );
                  })}
              </div>
            );
          })
        )}
      </div>
      <div className="mention-popover__footer">
        <button
          type="button"
          className="mention-popover__btn"
          onClick={() => setAll(true)}
          title="Show every document and section (the default)"
        >
          All
        </button>
        <button
          type="button"
          className="mention-popover__btn"
          onClick={() => setAll(false)}
          title="Show only the current document"
        >
          None
        </button>
        <button
          type="button"
          className="mention-popover__btn"
          onClick={invert}
          title="Flip the current selection"
        >
          Invert
        </button>
        <div className="flex-1" />
        <span className="mention-popover__count">
          {includedDocCount}/{entries.length} docs
        </span>
        {activeFilter && (
          <button
            type="button"
            className="mention-popover__btn mention-popover__btn--primary"
            onClick={() => {
              onChange(createScope());
              onClose();
            }}
          >
            Clear
          </button>
        )}
      </div>
      </div>
    </div>,
    document.body,
  );
}
import { memo, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useStore, useCurrentDocument } from '@/store/useStore';
import { ProposedEditCard } from '@/components/ProposedEditCard';
import { ResizeHandle } from '@/components/ResizeHandle';
import {
  useDragResize,
  clamp,
  MIN_COMPARE_WIDTH,
  MAX_COMPARE_WIDTH,
  DEFAULT_COMPARE_WIDTH,
} from '@/hooks/useDragResize';
import { remarkPlugins, rehypePlugins } from '@/utils/markdown';
import { applyAllEdits } from '@/utils/proposedEdit';
import type { CompareSegment } from '@/utils/documentCompare';
import type { DocumentRecord, ProposedEdit } from '@/types';

/** How a change stopped being pending. */
type ResolvedState = 'applied' | 'skipped';

/** The shape the overlay needs from the compare session. */
export interface CompareSession {
  sourceLabel: string;
  edits: ProposedEdit[];
  segments: CompareSegment[];
  skippedHunks: number;
}

export interface ComparePanelViewProps {
  session: CompareSession;
  doc: DocumentRecord;
  /** Current panel width in px. */
  width: number;
  onWidthChange: (next: number) => void;
  onClose: () => void;
  /** Apply the given edits to the document. Returns the ids that were
   *  applied, so the caller can mark exactly those as resolved. */
  onApplyEdits: (edits: ProposedEdit[]) => string[];
}

/**
 * Session overlay for document compare. Shows the whole compared
 * document as an Original | Revised view:
 *
 * - Unchanged text is rendered in both columns, in document order, so
 *   it keeps its proper horizontal position among the changes.
 * - Each pending change is rendered as a full `ProposedEditCard`,
 *   which carries its own side-by-side preview plus Apply / Skip.
 *
 * The panel is right-docked and resizable from its left edge; the
 * width is persisted with the rest of the layout.
 */
export function CompareReviewPanel() {
  const session = useStore((s) => s.compareSession);
  const setCompareSession = useStore((s) => s.setCompareSession);
  const doc = useCurrentDocument();
  const saveRevision = useStore((s) => s.saveRevision);
  const updateContent = useStore((s) => s.updateDocumentContent);
  const compareWidth = useStore((s) => s.layout.compareWidth);
  const setLayout = useStore((s) => s.setLayout);

  if (!session || !doc) return null;

  const applyEdits = (edits: ProposedEdit[]): string[] => {
    if (edits.length === 0) return [];
    // The empty-document case has no anchor to replace, so it needs
    // its own path.
    if (!doc.content && edits.length === 1 && edits[0].original === '') {
      saveRevision(doc.id, 'Before compare');
      updateContent(doc.id, edits[0].replacement);
      setCompareSession(null);
      return edits.map((e) => e.id);
    }
    const { next, appliedIds } = applyAllEdits(doc.content, edits);
    if (appliedIds.length === 0) return [];
    saveRevision(doc.id, 'Before compare');
    updateContent(doc.id, next);
    return appliedIds;
  };

  // Pre-rehydrate snapshots may briefly leave compareWidth undefined;
  // fall back so the panel never paints with a NaN width.
  const width =
    typeof compareWidth === 'number' && !Number.isNaN(compareWidth)
      ? compareWidth
      : DEFAULT_COMPARE_WIDTH;

  return (
    <ComparePanelView
      session={session}
      doc={doc}
      width={width}
      onWidthChange={(next) => setLayout({ compareWidth: next })}
      onClose={() => setCompareSession(null)}
      onApplyEdits={applyEdits}
    />
  );
}

/**
 * The presentational half of the compare overlay. Kept free of store
 * access so it can be rendered in isolation (see
 * `scripts/test-compare-panel-render.mjs`).
 */
export function ComparePanelView({
  session,
  doc,
  width,
  onWidthChange,
  onClose,
  onApplyEdits,
}: ComparePanelViewProps) {
  // Changes that are no longer pending, and why.
  const [resolved, setResolved] = useState<Map<string, ResolvedState>>(
    () => new Map()
  );
  const panelRef = useRef<HTMLDivElement>(null);

  const remaining = useMemo(
    () => session.edits.filter((e) => !resolved.has(e.id)),
    [session.edits, resolved]
  );

  // The left edge tracks the pointer: the panel is right-docked, so its
  // right edge is fixed and the width is the distance from the pointer
  // to that edge. Mirrors the ChatPanel's left handle.
  const { start: startResize } = useDragResize({
    mode: 'axis',
    axis: 'horizontal',
    onDelta: ({ absX }) => {
      const rect = panelRef.current?.getBoundingClientRect();
      if (!rect) return;
      onWidthChange(
        clamp(rect.right - absX, MIN_COMPARE_WIDTH, MAX_COMPARE_WIDTH)
      );
    },
  });

  const markResolved = (id: string, state: ResolvedState) => {
    setResolved((prev) => {
      const next = new Map(prev);
      next.set(id, state);
      return next;
    });
  };

  const applyAll = () => {
    if (remaining.length === 0) return;
    // Only the edits that actually applied become resolved — an edit
    // whose anchor no longer matches stays pending so the user can
    // still see why it failed.
    for (const id of onApplyEdits(remaining)) markResolved(id, 'applied');
  };

  const editsById = new Map<string, ProposedEdit>(
    session.edits.map((e) => [e.id, e])
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Document compare"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        aria-label="Close compare"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="relative z-10 h-full bg-paper-panel dark:bg-ape-panel border-l border-paper-hairline dark:border-cyber-border shadow-ape-paper-lift dark:shadow-2xl flex flex-col"
        style={{
          width: clamp(width, MIN_COMPARE_WIDTH, MAX_COMPARE_WIDTH),
          maxWidth: '100%',
        }}
      >
        <ResizeHandle
          handle="left"
          className="cmp-resize-handle"
          onPointerDown={(e) => startResize('left', e)}
        />
        <div className="px-3 py-2 border-b border-paper-hairline dark:border-cyber-border flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-medium text-paper-ink dark:text-cyber-primary">
              Compare
            </div>
            <p className="text-[12px] text-paper-inkSoft dark:text-cyber-muted leading-snug">
              Suggested edits to bring this document in line with{' '}
              <span className="text-paper-ink dark:text-cyber-primary">
                {session.sourceLabel}
              </span>
              . Apply each like a chat proposal.
            </p>
            {session.skippedHunks > 0 && (
              <p className="text-[11px] text-cyber-warn mt-1">
                {session.skippedHunks} hunk
                {session.skippedHunks === 1 ? '' : 's'} could not be
                turned into a unique original span.
              </p>
            )}
          </div>
          <button
            type="button"
            className="btn-ghost-sm shrink-0"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="px-3 py-2 border-b border-paper-hairline dark:border-cyber-border flex items-center gap-2">
          <button
            type="button"
            className="btn-fire-sm"
            disabled={remaining.length === 0}
            onClick={applyAll}
          >
            Apply all ({remaining.length})
          </button>
          <span className="text-[11px] text-paper-inkSoft dark:text-cyber-muted">
            {session.edits.length} change
            {session.edits.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="cmp-cols-head">
            <div className="cmp-col-head cmp-col-head--orig">Original</div>
            <div className="cmp-col-head cmp-col-head--rev">Revised</div>
          </div>

          {session.segments.length === 0 ? (
            <p className="p-3 text-sm text-paper-inkSoft dark:text-cyber-muted">
              {session.edits.length === 0
                ? 'The two documents are identical.'
                : 'Every remaining change was skipped or applied.'}
            </p>
          ) : (
            <div className="cmp-doc">
              {session.segments.map((segment, i) => (
                <CompareSegmentRow
                  key={`${segment.kind}-${i}`}
                  segment={segment}
                  edit={
                    segment.kind === 'change'
                      ? editsById.get(segment.editId)
                      : undefined
                  }
                  resolved={
                    segment.kind === 'change'
                      ? resolved.get(segment.editId)
                      : undefined
                  }
                  docId={doc.id}
                  onDismiss={(id) => markResolved(id, 'skipped')}
                  onApplied={(id) => markResolved(id, 'applied')}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One row of the document view. Unchanged text occupies both columns
 * (identical on each side); a change occupies the full width and
 * carries its own ProposedEditCard, which renders the original /
 * proposed panes internally.
 *
 * Memoized: dragging the panel edge updates the width on every frame,
 * and re-parsing the document's markdown each time would be costly.
 */
const CompareSegmentRow = memo(function CompareSegmentRow({
  segment,
  edit,
  resolved,
  docId,
  onDismiss,
  onApplied,
}: {
  segment: CompareSegment;
  edit?: ProposedEdit;
  resolved?: ResolvedState;
  docId: string;
  onDismiss: (editId: string) => void;
  onApplied: (editId: string) => void;
}) {
  if (segment.kind === 'unchanged') {
    return (
      <div className="cmp-row cmp-row--same">
        <div className="cmp-cell cmp-cell--same">
          <MarkdownBlock text={segment.text} />
        </div>
        <div className="cmp-cell cmp-cell--same">
          <MarkdownBlock text={segment.text} />
        </div>
      </div>
    );
  }

  if (segment.kind === 'skipped') {
    // A hunk that could not be anchored. Show it as a difference but
    // without an Apply affordance so nothing is hidden.
    return (
      <div className="cmp-row cmp-row--resolved">
        <div className="cmp-cell cmp-cell--del">
          <MarkdownBlock text={segment.originalText} empty="—" />
        </div>
        <div className="cmp-cell cmp-cell--add">
          <MarkdownBlock text={segment.revisedText} empty="—" />
        </div>
        <div className="cmp-note cmp-note--warn">
          This change could not be turned into a unique span, so it
          cannot be applied automatically.
        </div>
      </div>
    );
  }

  if (!edit) return null;

  // Already applied or skipped — keep the row so the document stays
  // continuous, but drop the interactive card.
  if (resolved) {
    return (
      <div className="cmp-row cmp-row--resolved">
        <div className="cmp-cell cmp-cell--del">
          <MarkdownBlock text={segment.originalText} empty="—" />
        </div>
        <div className="cmp-cell cmp-cell--add">
          <MarkdownBlock text={segment.revisedText} empty="—" />
        </div>
        <div
          className={
            resolved === 'applied'
              ? 'cmp-note cmp-note--applied'
              : 'cmp-note cmp-note--muted'
          }
        >
          {resolved === 'applied' ? 'Applied' : 'Skipped'}
        </div>
      </div>
    );
  }

  return (
    <div className="cmp-change">
      <ProposedEditCard
        edit={edit}
        docId={docId}
        messageId="compare"
        dismissOnly
        fillParent
        // Show only the hunk's own text. The edit's `original` is
        // expanded with neighbouring lines so Apply can anchor on it,
        // and those lines are already visible in the document view
        // above and below this card.
        previewOriginal={segment.originalText}
        previewReplacement={segment.revisedText}
        onDismiss={onDismiss}
        onApplied={onApplied}
      />
    </div>
  );
});

/**
 * Render a markdown fragment with the shared plugin pipeline.
 *
 * Memoized for the same reason as the row above: the panel width
 * changes on every frame of a resize drag.
 */
const MarkdownBlock = memo(function MarkdownBlock({
  text,
  empty,
}: {
  text: string;
  empty?: string;
}) {
  if (!text.trim()) {
    return (
      <span className="cmp-empty text-paper-inkSoft dark:text-cyber-muted">
        {empty ?? ''}
      </span>
    );
  }
  return (
    <div className="cmp-md prose-md">
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
        {text}
      </ReactMarkdown>
    </div>
  );
});

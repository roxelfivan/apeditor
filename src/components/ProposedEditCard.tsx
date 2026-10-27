import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import { useStore } from '@/store/useStore';
import type { MentionToken, ProposedEdit } from '@/types';
import { lineDiff } from '@/utils/diff';
import { remarkPlugins, rehypePlugins } from '@/utils/markdown';
import {
  applyEdit,
  applyEditAtCaret,
  deriveProposedEditSummary,
  findEditAnchor,
  findBestEffortAnchor,
  prepareBestEffortReplace,
  type BestEffortAnchor,
} from '@/utils/proposedEdit';
import { ResizeHandle } from '@/components/ResizeHandle';
import { MentionInput } from '@/components/mentions/MentionInput';
import {
  useDragResize,
  applyHandle,
  clamp,
  MIN_CARD_WIDTH,
  MAX_CARD_WIDTH,
  MIN_CARD_HEIGHT,
  MAX_CARD_HEIGHT,
  type ResizeHandle as HandleName,
} from '@/hooks/useDragResize';
import { peSplitKey } from '@/utils/storage';

interface Props {
  edit: ProposedEdit;
  docId: string;
  messageId: string;
  /**
   * Whether this card's rejection comment is currently staged for sending.
   * When `true`, the card renders a "staged" outline and skips the
   * "Reject with feedback" affordance — the comment has already been
   * queued by the parent and only the plain Reject button remains so the
   * user can still drop the card without sending.
   */
  staged?: boolean;
  /**
   * Whether this card has been committed (the user clicked "Send N
   * rejection comments" in the assistant message footer). When `true`,
   * the card hides itself immediately rather than waiting for an explicit
   * plain-Reject click.
   */
  committed?: boolean;
  /**
   * Notify the parent that the user wants to stage this card's comment for
   * a batched send. Called with the comment text (which may include
   * @-mention sentinel sequences) and the list of @-document references
   * the user attached. If the comment is empty, the parent should treat
   * the call as a plain rejection instead.
   */
  onStageReject?: (info: {
    editId: string;
    comment: string;
    mentions: MentionToken[];
  }) => void;
}

type CardStatus =
  | { kind: 'idle' }
  | { kind: 'applied' }
  | { kind: 'best-effort-applied' }
  | { kind: 'rejected' }
  | { kind: 'committed' };

/** Which way the diff preview is rendered. */
type ViewMode = 'split' | 'unified';

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 220;

/**
 * Inline track-changes preview for a single AI-proposed edit.
 *
 * Reads the current document content from the store on every render so it
 * picks up user changes (and any sibling applies) live. Apply performs a
 * single-substring replace; if the `original` anchor is no longer present,
 * Apply is disabled with an inline explanation.
 *
 * The card is resizable from all 8 edges + corners via `useDragResize`
 * (`free` mode). Per-card size is keyed by `${messageId}:${edit.id}` and
 * persisted via the `layout.previewSizes` slice of the store.
 */
export function ProposedEditCard({ edit, docId, messageId, staged, committed, onStageReject }: Props) {
  // Subscribe to documents so re-renders fire on store updates.
  const documents = useStore((s) => s.documents);
  const doc = documents.find((d) => d.id === docId);
  const content = doc?.content ?? '';

  const sizeKey = `${messageId}:${edit.id}`;
  const storedSize = useStore((s) => s.layout.previewSizes[sizeKey]);
  const setPreviewSize = useStore((s) => s.setPreviewSize);
  // Editor focus + caret state for the doc this card is anchored against.
  // Used to decide whether Highlight Apply can run (requires a selection).
  // Subscribing to a per-doc record keeps re-renders scoped to the doc
  // in question, not every keystroke in any doc.
  const editorState = useStore((s) => s.editorFocus[docId]);

  const [status, setStatus] = useState<CardStatus>({ kind: 'idle' });
  // When the parent marks this card as committed (the user clicked "Send
  // N rejection comments"), flip our local status so the card hides
  // itself immediately. Done in an effect rather than at the call site so
  // any in-flight local state changes (typing in the textarea, etc.)
  // don't race the parent.
  useEffect(() => {
    if (committed && status.kind !== 'committed') {
      setStatus({ kind: 'committed' });
    }
  }, [committed, status.kind]);
  // Per-card diff view mode. Default to side-by-side split.
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  // Free-text comment the user typed to explain a reject. Held locally
  // until they click "Reject with feedback", at which point we hand it up
  // to ChatPanel so it can batch with sibling rejections. The raw
  // textarea value (with any @-mention sentinel sequences) is kept
  // here so we can hand the full body to the parent on stage.
  const [comment, setComment] = useState('');
  // @-document references the user attached to the comment. Lifted
  // out of MentionInput so the staged state can survive the textarea
  // becoming read-only, and so the parent can include them in the
  // rejection prompt.
  const [mentions, setMentions] = useState<MentionToken[]>([]);
  // Ref to the card's root element, used to read its actual rendered size
  // when a drag starts (so a card that auto-sizes to its parent resizes
  // smoothly from its real on-screen dimensions rather than from the
  // DEFAULT_WIDTH constant).
  const cardRef = useRef<HTMLDivElement>(null);
  // Remember the size at the start of a drag so we can apply deltas.
  const startSizeRef = useRef<{ w: number; h: number }>(
    storedSize ?? { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT }
  );

  // Anchor lookup + multiple-match detection. We use a shared helper that
  // also drives `applyEdit` so the disabled-state and Apply click are
  // always looking for the same span.
  const anchorInfo = useMemo(() => {
    if (!content) return { found: false, idx: -1, length: 0, multiple: false };
    const anchor = findEditAnchor(content, edit.original);
    if (!anchor) return { found: false, idx: -1, length: 0, multiple: false };

    // To detect multiple matches cheaply, run the same lookup starting
    // one character past the first hit and see if anything else surfaces.
    const second = findEditAnchor(
      content.slice(anchor.idx + anchor.length),
      edit.original
    );
    return {
      found: true,
      idx: anchor.idx,
      length: anchor.length,
      multiple: second !== null,
    };
  }, [content, edit.original]);

  // Best-effort match is deferred off the render path so a long document
  // + many proposed-edit cards cannot freeze first paint. Exact-anchor
  // lookup above stays synchronous (cheap).
  const [bestEffortAnchor, setBestEffortAnchor] =
    useState<BestEffortAnchor | null>(null);
  useEffect(() => {
    if (anchorInfo.found || !content || !edit.original) {
      setBestEffortAnchor(null);
      return;
    }
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      setBestEffortAnchor(
        findBestEffortAnchor(content, edit.original, edit.replacement)
      );
    };
    // Prefer idle time; fall back to a macrotask so the UI can paint.
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const ric = (
      globalThis as unknown as {
        requestIdleCallback?: (
          cb: () => void,
          opts?: { timeout: number }
        ) => number;
        cancelIdleCallback?: (id: number) => void;
      }
    ).requestIdleCallback;
    if (typeof ric === 'function') {
      idleId = ric(run, { timeout: 200 });
    } else {
      timeoutId = setTimeout(run, 0);
    }
    return () => {
      cancelled = true;
      if (idleId !== undefined) {
        (
          globalThis as unknown as { cancelIdleCallback?: (id: number) => void }
        ).cancelIdleCallback?.(idleId);
      }
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  }, [anchorInfo.found, content, edit.original, edit.replacement]);

  // Track whether user has a text selection in the editor (required for
  // Highlight Apply). Re-renders when the user selects text.
  const hasSelection = useMemo(
    () =>
      editorState &&
      typeof editorState.selectionStart === 'number' &&
      typeof editorState.selectionEnd === 'number' &&
      editorState.selectionStart !== editorState.selectionEnd,
    [editorState]
  );

  /** Best Effort is only applyable when the match has no duplication block. */
  const bestEffortUsable =
    !!bestEffortAnchor && !bestEffortAnchor.duplicationReason;

  /** Primary Apply is available via Exact or usable Best Effort. */
  const canApply =
    anchorInfo.found || bestEffortUsable;

  // Publish the matched Original span into the editor (Write/Preview/Split)
  // so the user can see where Apply would land. Cleared on unmount / when
  // no anchor remains / after the card is dismissed.
  const setProposedEditHighlight = useStore((s) => s.setProposedEditHighlight);
  const cardKey = `${messageId}:${edit.id}`;
  const highlightStart = anchorInfo.found
    ? anchorInfo.idx
    : bestEffortAnchor?.idx ?? -1;
  const highlightEnd = anchorInfo.found
    ? anchorInfo.idx + anchorInfo.length
    : bestEffortAnchor
      ? bestEffortAnchor.idx + bestEffortAnchor.length
      : -1;
  useEffect(() => {
    // Guard: store action may be missing for one frame after HMR.
    if (typeof setProposedEditHighlight !== 'function') return;
    if (
      status.kind === 'rejected' ||
      status.kind === 'committed' ||
      status.kind === 'applied' ||
      status.kind === 'best-effort-applied'
    ) {
      setProposedEditHighlight(docId, cardKey, null);
      return;
    }
    const range =
      highlightStart >= 0 && highlightEnd > highlightStart
        ? { start: highlightStart, end: highlightEnd }
        : null;
    setProposedEditHighlight(docId, cardKey, range);
    return () => {
      if (typeof setProposedEditHighlight === 'function') {
        setProposedEditHighlight(docId, cardKey, null);
      }
    };
  }, [
    docId,
    cardKey,
    highlightStart,
    highlightEnd,
    status.kind,
    setProposedEditHighlight,
  ]);

  // Show the best-effort info panel when there is no exact match and a
  // best-effort span exists, or after a best-effort apply.
  const showBestEffortPanel =
    (!anchorInfo.found && !!bestEffortAnchor) ||
    status.kind === 'best-effort-applied';

  // Track the confidence + duplication reason of the applied best-effort edit.
  // Stored separately from bestEffortAnchor because anchor idx/length become
  // stale once the document changes (another edit, typing, etc.).
  const [appliedBestEffortInfo, setAppliedBestEffortInfo] = useState<{
    confidence: number;
    duplicationReason: string | null;
    /** The passage that was actually replaced (captured at apply time, not recomputed). */
    appliedText: string;
  } | null>(null);

  // Unified (Inline) view still uses a line-level +/- diff. Split view
  // renders full Original / Proposed columns as Preview-style markdown
  // instead of line-synced monospace rows.
  const flatDiff = useMemo(
    () => lineDiff(edit.original, edit.replacement),
    [edit.original, edit.replacement]
  );
  const unifiedLines = useMemo(
    () => flatDiff.filter((l) => l.kind !== 'context'),
    [flatDiff]
  );
  const hasTextChange =
    edit.original !== edit.replacement &&
    (edit.original.length > 0 || edit.replacement.length > 0);

  // Resize wiring. The hook only gives us the pointer delta; we apply it
  // to the start size using the dragged handle to compute the new rect.
  const { start: beginResize } = useDragResize({
    mode: 'free',
    onDelta: ({ dx, dy }) => {
      const next = applyHandle(
        activeHandleRef.current!,
        startSizeRef.current.w,
        startSizeRef.current.h,
        dx,
        dy
      );
      const w = clamp(next.w, MIN_CARD_WIDTH, MAX_CARD_WIDTH);
      const h = clamp(next.h, MIN_CARD_HEIGHT, MAX_CARD_HEIGHT);
      const current = storedSize ?? { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT };
      if (w !== current.w || h !== current.h) {
        setPreviewSize(sizeKey, { w, h });
      }
    },
  });
  const activeHandleRef = useRef<HandleName | null>(null);
  const onResizePointerDown = (handle: HandleName) =>
    (e: ReactPointerEvent<HTMLElement>) => {
      // Anchor the start size to the card's actual rendered dimensions
      // when it has no explicit stored size. This makes the drag feel
      // continuous regardless of whether the card is in its default
      // "fill-parent" mode or in a previously resized pixel mode.
      if (storedSize) {
        startSizeRef.current = storedSize;
      } else if (cardRef.current) {
        const rect = cardRef.current.getBoundingClientRect();
        startSizeRef.current = { w: rect.width, h: rect.height };
      } else {
        startSizeRef.current = { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT };
      }
      activeHandleRef.current = handle;
      beginResize(handle, e);
    };

  // Per-card column split between the "Original" and "Proposed" panes
  // in Split view mode. Persisted in localStorage keyed by the same
  // `${messageId}:${edit.id}` we use for the card size, so each
  // card remembers its own split across reloads. 50 = equal split.
  // The valid range is 20..80 so neither column can collapse.
  const splitStorageKey = `${messageId}:${edit.id}:split`;
  const [splitPct, setSplitPct] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(peSplitKey(splitStorageKey));
      if (!raw) return 50;
      const n = parseInt(raw, 10);
      if (!Number.isFinite(n)) return 50;
      return Math.min(80, Math.max(20, n));
    } catch {
      return 50;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(
        peSplitKey(splitStorageKey),
        String(splitPct)
      );
    } catch {
      /* ignore quota errors */
    }
  }, [splitPct, splitStorageKey]);
  // Drag wiring for the column split. Uses horizontal axis mode so
  // dx translates directly into a column-width delta. The split
  // percentage is clamped 20..80 on every tick to keep both
  // columns usable.
  const splitStartPctRef = useRef<number>(splitPct);
  const { start: beginSplitDrag } = useDragResize({
    mode: 'axis',
    axis: 'horizontal',
    onDelta: ({ dx }) => {
      // Convert pixel delta to a percentage of the current row width.
      // We measure the parent of the drag handle (the content row)
      // lazily via the closure in `onSplitHandleDown`, so this
      // handler reads the stored row width off a ref instead of
      // querying the DOM every move.
      const row = splitRowRef.current;
      if (!row) return;
      const w = row.clientWidth;
      if (w <= 0) return;
      const deltaPct = (dx / w) * 100;
      setSplitPct((prev) => {
        const next = prev + deltaPct;
        return Math.min(80, Math.max(20, next));
      });
    },
  });
  const splitRowRef = useRef<HTMLDivElement>(null);
  const onSplitHandleDown = (
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    splitStartPctRef.current = splitPct;
    beginSplitDrag('left', e);
  };

  if (status.kind === 'rejected' || status.kind === 'committed') return null;

  /**
   * Splice `text` over `anchor` and record the applied edit. Shared by
   * Exact, Best Effort, and (via a separate path) used for bookkeeping
   * consistency with Highlight Apply.
   */
  const performReplace = (
    anchor: { idx: number; length: number },
    text: string = edit.replacement
  ) => {
    if (!doc) return;
    const next =
      doc.content.slice(0, anchor.idx) +
      text +
      doc.content.slice(anchor.idx + anchor.length);
    useStore.getState().updateDocumentContent(doc.id, next);
    const newStart = anchor.idx;
    const newEnd = anchor.idx + text.length;
    useStore.getState().recordAppliedEdit({
      documentId: doc.id,
      messageId,
      editId: edit.id,
      summary: edit.summary,
      rationale: edit.rationale ?? '',
      original: edit.original,
      replacement: edit.replacement,
      appliedAt: Date.now(),
      newAnchor: { start: newStart, end: newEnd },
    });
    window.dispatchEvent(
      new CustomEvent('mvp:select-range', {
        detail: { start: newStart, end: newEnd },
      })
    );
  };

  /**
   * Primary Apply: Exact if anchored, else usable Best Effort.
   * Status is set before the mutation so the button disables immediately.
   */
  const handleApply = () => {
    if (!doc) return;
    if (anchorInfo.found) {
      setStatus({ kind: 'applied' });
      const r = applyEdit(doc.content, edit.original, edit.replacement);
      if (r.ok) {
        performReplace(r.anchor);
      } else {
        setStatus({ kind: 'idle' });
      }
      return;
    }
    if (!bestEffortAnchor || bestEffortAnchor.duplicationReason) return;
    const captured = bestEffortAnchor;
    const prepared = prepareBestEffortReplace(
      doc.content,
      edit.replacement,
      { idx: captured.idx, length: captured.length }
    );
    if (!prepared) return;
    const appliedText = doc.content.slice(
      prepared.idx,
      prepared.idx + prepared.length
    );
    setStatus({ kind: 'best-effort-applied' });
    setAppliedBestEffortInfo({
      confidence: captured.confidence,
      duplicationReason: null,
      appliedText,
    });
    performReplace(
      { idx: prepared.idx, length: prepared.length },
      prepared.text
    );
  };

  /**
   * Highlight Apply: replace the user's current selection with the
   * replacement. Manual override when Exact/Best Effort are unavailable
   * or the user wants a different span.
   */
  const handleHighlightApply = () => {
    if (!doc) return;
    const liveDocId = useStore.getState().currentDocumentId;
    if (liveDocId !== docId) return;
    const r = applyEditAtCaret(doc.content, edit.replacement, {
      selectionStart: editorState.selectionStart,
      selectionEnd: editorState.selectionEnd,
    });
    if (!r.ok) return;
    useStore.getState().updateDocumentContent(doc.id, r.next);
    const insertedStart = editorState.selectionStart ?? 0;
    const insertedEnd = insertedStart + edit.replacement.length;
    useStore.getState().recordAppliedEdit({
      documentId: doc.id,
      messageId,
      editId: edit.id,
      summary: edit.summary,
      rationale: edit.rationale ?? '',
      original: edit.original,
      replacement: edit.replacement,
      appliedAt: Date.now(),
      newAnchor: { start: insertedStart, end: insertedEnd },
    });
    window.dispatchEvent(
      new CustomEvent('mvp:select-range', {
        detail: { start: insertedStart, end: insertedEnd },
      })
    );
    setStatus({ kind: 'applied' });
  };

  const handleReject = () => {
    // Plain Reject — hide right now, no chat message.
    setStatus({ kind: 'rejected' });
  };

  const handleRejectWithFeedback = () => {
    // Decide if the comment is "non-empty" after stripping @-mention
    // sentinels. A card whose only content is a single @-doc reference
    // (no plain prose) should still count as a rejection-with-feedback
    // — the referenced doc is the rejection's substance.
    const trimmed = comment.trim();
    const hasContent = trimmed.length > 0;
    if (!hasContent && mentions.length === 0) {
      // No comment typed and no @-references: fall back to a plain
      // reject so the user isn't stuck with a button that does nothing.
      setStatus({ kind: 'rejected' });
      return;
    }
    if (onStageReject) {
      onStageReject({ editId: edit.id, comment, mentions });
      // Keep `comment` populated so the user can still see what they
      // typed. The textarea flips to read-only when `staged` is true, so
      // the card visually settles into a "waiting to send" state without
      // erasing the user's text. `mentions` is kept too so the chip
      // bar above the textarea stays in sync.
    } else {
      // No parent wiring: behave like a plain reject so the card doesn't
      // get stuck open forever.
      setStatus({ kind: 'rejected' });
    }
  };

  const appliedOrBusy =
    status.kind === 'applied' || status.kind === 'best-effort-applied';
  const applyPathLabel = anchorInfo.found
    ? 'Exact match'
    : bestEffortUsable
      ? `Best effort · ${Math.round((bestEffortAnchor?.confidence ?? 0) * 100)}%`
      : null;

  const size = storedSize ?? { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT };
  const isSized = !!storedSize;

  return (
    <div
      ref={cardRef}
      className={`proposed-edit-card ${isSized ? 'pe-card-sized' : ''} flex flex-col w-full`}
      style={
        isSized
          ? { width: size.w, height: size.h }
          : undefined
      }
    >
      <div className="pe-header shrink-0">
        <span className="pe-id" title={`Change id: ${edit.id}`}>
          {edit.id}
        </span>
        <span
          className="pe-summary"
          title={deriveProposedEditSummary(edit)}
        >
          {deriveProposedEditSummary(edit)}
        </span>
        {/* View-mode toggle: side-by-side vs inline. */}
        <div
          className="ml-auto inline-flex rounded border border-paper-hairline dark:border-cyber-border overflow-hidden text-[10px] font-mono"
          role="tablist"
          aria-label="Diff view mode"
        >
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'split'}
            className={`px-1.5 py-0.5 ${
              viewMode === 'split'
                ? 'bg-cyber-clay text-paper-base dark:bg-ape-fire dark:text-white font-semibold'
                : 'bg-white dark:bg-ape-base text-paper-inkSoft dark:text-cyber-muted hover:bg-paper-elevated dark:hover:bg-ape-elevated hover:text-cyber-clay dark:hover:text-cyber-cyan'
            }`}
            onClick={() => setViewMode('split')}
            title="Side-by-side markdown preview: original on the left, proposed on the right"
          >
            Split
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'unified'}
            className={`px-1.5 py-0.5 border-l border-paper-hairline dark:border-cyber-border ${
              viewMode === 'unified'
                ? 'bg-cyber-clay text-paper-base dark:bg-ape-fire dark:text-white font-semibold'
                : 'bg-white dark:bg-ape-base text-paper-inkSoft dark:text-cyber-muted hover:bg-paper-elevated dark:hover:bg-ape-elevated hover:text-cyber-clay dark:hover:text-cyber-cyan'
            }`}
            onClick={() => setViewMode('unified')}
            title="Inline unified diff"
          >
            Inline
          </button>
        </div>
      </div>

      <div className="pe-diff flex-1 min-h-0">
        {!anchorInfo.found && !showBestEffortPanel && (
          <div
            className="mb-2 py-1.5 px-2 rounded border border-cyber-warn/50 bg-cyber-warn/10 text-[11px] leading-snug text-cyber-warn"
            role="status"
          >
            <div className="font-semibold mb-0.5 text-cyber-warn">
              Potential mismatch detected
            </div>
            <div className="text-paper-inkSoft dark:text-cyber-muted">
              The AI&rsquo;s original quote doesn&rsquo;t appear in the
              current document &mdash; it may have been edited since this
              reply was generated, or the AI quoted a different wording.
              <br />
              Select text in the editor and use{' '}
              <span className="font-semibold text-cyber-warn">Highlight Apply</span>{' '}
              to replace your selection.
            </div>
          </div>
        )}
        {/* Best-effort info panel: pre-apply match preview, or post-apply
            snapshot of what was replaced. */}
        {showBestEffortPanel && content && (
          <div
            className="mb-2 py-1.5 px-2 rounded border border-cyber-warn/60 bg-cyber-warn/10 text-[11px] leading-snug"
            role="status"
          >
            <div className="font-semibold mb-1 text-cyber-warn">
              Best effort match
            </div>
            <div className="text-paper-inkSoft dark:text-cyber-muted mb-1">
              {status.kind === 'best-effort-applied'
                ? <>Applied at {appliedBestEffortInfo && <span className="font-mono text-cyber-warn font-semibold">{Math.round(appliedBestEffortInfo.confidence * 100)}%</span>} confidence.</>
                : bestEffortAnchor
                  ? <>Matched passage at <span className="font-mono text-cyber-warn font-semibold">{Math.round(bestEffortAnchor.confidence * 100)}%</span> confidence. Apply uses this approximate span.</>
                  : null}
              {bestEffortAnchor?.duplicationReason && status.kind !== 'best-effort-applied' && (
                <span className="ml-2 text-cyber-danger text-[10px]">
                  Apply blocked — {bestEffortAnchor.duplicationReason}. Select text and use Highlight Apply.
                </span>
              )}
            </div>
            <div className="mt-1 p-1.5 rounded bg-white/70 dark:bg-ape-base/70 border border-paper-hairline dark:border-cyber-border font-mono text-[11px] whitespace-pre-wrap break-words max-h-24 overflow-auto">
              {status.kind === 'best-effort-applied' && appliedBestEffortInfo
                ? appliedBestEffortInfo.appliedText
                : bestEffortAnchor
                  ? content.slice(bestEffortAnchor.idx, bestEffortAnchor.idx + bestEffortAnchor.length)
                  : ''}
            </div>
          </div>
        )}
        {!hasTextChange || (viewMode === 'unified' && unifiedLines.length === 0) ? (
          <div className="text-xs text-paper-inkSoft dark:text-cyber-muted italic px-3">
            (no textual change)
          </div>
        ) : viewMode === 'split' ? (
          <MarkdownSplitPreview
            original={edit.original}
            replacement={edit.replacement}
            splitPct={splitPct}
            onSplitPointerDown={onSplitHandleDown}
            splitRowRef={splitRowRef}
          />
        ) : (
          <div className="pe-diff-unified">
            {unifiedLines.map((line, i) => (
              <div
                key={i}
                className={
                  line.kind === 'add'
                    ? 'diff-add'
                    : line.kind === 'remove'
                      ? 'diff-remove'
                      : ''
                }
              >
                <span className="inline-block w-4 select-none opacity-60">
                  {line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' '}
                </span>
                {line.text || ' '}
              </div>
            ))}
          </div>
        )}
        {!canApply && !hasSelection && (
          <div className="mt-1 px-3 text-[10px] text-paper-inkSoft dark:text-cyber-muted italic">
            Select text in the editor to enable Highlight Apply.
          </div>
        )}
      </div>

      <div className="pe-actions shrink-0">
        <button
          type="button"
          className="btn-ghost-sm"
          onClick={handleReject}
          disabled={appliedOrBusy}
          title="Dismiss this proposed change"
        >
          Reject
        </button>
        <button
          type="button"
          className="btn-fire-sm"
          onClick={handleApply}
          disabled={!canApply || appliedOrBusy}
          title={
            anchorInfo.found
              ? anchorInfo.multiple
                ? 'Exact match (multiple found; the first will be replaced)'
                : 'Apply using exact match in the document'
              : bestEffortUsable
                ? 'No exact match — apply using the best-effort span shown above'
                : 'No applyable anchor — select text and use Highlight Apply'
          }
        >
          Apply
        </button>
        {applyPathLabel && !appliedOrBusy && (
          <span className="text-[10px] text-paper-inkSoft dark:text-cyber-muted">
            {applyPathLabel}
          </span>
        )}
        {hasSelection && (
          <button
            type="button"
            className="text-xs px-2 py-1 rounded font-medium border border-cyber-cyan/60 text-cyber-cyan bg-cyber-cyan/5 transition-colors hover:bg-cyber-cyan/15 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleHighlightApply}
            disabled={appliedOrBusy}
            title="Replace your current selection with the proposed text"
          >
            Highlight Apply
          </button>
        )}
      </div>

      {/* Comment box for "Reject with feedback". The user types a reason
          here and clicks the button below; the card then waits for the
          parent to commit the batched rejections before it disappears.
          When the card is staged we keep the typed text visible but flip
          the textarea to read-only so the user can review what they sent
          without being able to edit a comment that has already been
          queued for the next chat turn. */}
      <div className="pe-comment shrink-0">
        <label
          htmlFor={`pe-comment-${messageId}-${edit.id}`}
          className="block text-[10px] uppercase tracking-wide text-cyber-clay dark:text-cyber-cyan mb-1"
        >
          Comment (optional)
        </label>
        <MentionInput
          value={comment}
          onChange={(v) => {
            setComment(v.text);
            setMentions(v.mentions);
          }}
          ariaLabel={`Rejection comment for ${edit.id}`}
          placeholder="Why reject? (sent to the AI as revision feedback) — type @ to reference a document"
          className="ape-field pe-comment__textarea"
          disabled={status.kind === 'applied' || status.kind === 'best-effort-applied' || !!staged}
          containerClassName={`pe-comment__input ${
            staged
              ? 'pe-comment__input--staged'
              : ''
          }`}
        />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="text-[10px] text-paper-inkSoft dark:text-cyber-muted">
            {staged
              ? 'Staged. Click "Send rejection comments" in the message footer to send.'
              : 'Tip — leave empty to use plain Reject.'}
          </span>
          <button
            type="button"
            className="btn-cyan-sm disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleRejectWithFeedback}
            disabled={
              status.kind === 'applied' ||
              status.kind === 'best-effort-applied' ||
              staged ||
              (!comment.trim() && mentions.length === 0)
            }
            title={
              staged
                ? 'Already staged'
                : 'Stage this rejection with the typed comment and any @-references'
            }
          >
            Reject with feedback
          </button>
        </div>
      </div>

      {(status.kind === 'applied' || status.kind === 'best-effort-applied') && (
        <div className="pe-status applied">Applied to document.</div>
      )}
      {!anchorInfo.found && edit.original && (
        <details className="pe-status text-[11px] opacity-90 mt-1">
          <summary className="cursor-pointer select-none text-paper-inkSoft dark:text-cyber-muted">
            Show what the AI was looking for
          </summary>
          <div className="mt-1 max-h-40 overflow-auto rounded bg-white dark:bg-ape-base p-2 text-[11px] leading-snug text-paper-ink dark:text-cyber-primary border border-paper-hairline dark:border-cyber-border prose-md">
            <ReactMarkdown
              remarkPlugins={remarkPlugins}
              rehypePlugins={rehypePlugins}
            >
              {edit.original.length > 800
                ? edit.original.slice(0, 800) + '\n\n*(truncated)*'
                : edit.original}
            </ReactMarkdown>
          </div>
        </details>
      )}

      {/* 8 resize handles */}
      <ResizeHandle handle="top" onPointerDown={onResizePointerDown('top')} />
      <ResizeHandle handle="bottom" onPointerDown={onResizePointerDown('bottom')} />
      <ResizeHandle handle="left" onPointerDown={onResizePointerDown('left')} />
      <ResizeHandle handle="right" onPointerDown={onResizePointerDown('right')} />
      <ResizeHandle handle="tl" onPointerDown={onResizePointerDown('tl')} />
      <ResizeHandle handle="tr" onPointerDown={onResizePointerDown('tr')} />
      <ResizeHandle handle="bl" onPointerDown={onResizePointerDown('bl')} />
      <ResizeHandle handle="br" onPointerDown={onResizePointerDown('br')} />
    </div>
  );
}

/**
 * Side-by-side reader preview: Original and Proposed as full markdown
 * columns (same ReactMarkdown + prose-md stack as the Editor Preview
 * tab). Not line-synced — use Inline for a textual +/- diff.
 *
 * Layout: two horizontal flex rows — a header row (Original | Proposed)
 * and a content row (Original | divider | Proposed). The divider
 * between the content columns is draggable; the percentage of the row
 * given to the Original column is controlled by the parent and clamped
 * 20..80. The header row uses the same widths so the labels stay
 * aligned with their columns.
 */
function MarkdownSplitPreview({
  original,
  replacement,
  splitPct,
  onSplitPointerDown,
  splitRowRef,
}: {
  original: string;
  replacement: string;
  splitPct: number;
  onSplitPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  splitRowRef: React.RefObject<HTMLDivElement>;
}) {
  const proposedPct = 100 - splitPct;
  return (
    <div className="flex flex-col text-xs min-h-0 h-full">
      {/* Desktop header: widths mirror the content columns. */}
      <div className="hidden md:flex shrink-0 min-w-0 border-b border-paper-hairline dark:border-cyber-border">
        <div
          className="px-2 py-1 text-[10px] uppercase tracking-wide text-[#a83232] dark:text-cyber-danger/80 border-r border-paper-hairline dark:border-cyber-border bg-[rgba(190,50,50,0.06)] dark:bg-cyber-danger/5 text-center"
          style={{ width: `${splitPct}%` }}
        >
          Original
        </div>
        <div
          className="px-2 py-1 text-[10px] uppercase tracking-wide text-[#1f6f3e] dark:text-cyber-cyan/80 bg-[rgba(0,130,70,0.08)] dark:bg-cyber-cyan/5 text-center"
          style={{ width: `${proposedPct}%` }}
        >
          Proposed
        </div>
      </div>
      {/* Content: side-by-side on md+, stacked on narrow phones. */}
      <div
        ref={splitRowRef}
        className="flex flex-1 min-h-0 min-w-0 max-md:flex-col"
      >
        <div
          className="min-h-0 min-w-0 overflow-auto border-r max-md:border-r-0 max-md:border-b border-paper-hairline dark:border-cyber-border bg-[rgba(190,50,50,0.06)] dark:bg-cyber-danger/10 px-2 py-1.5 prose-md pe-md-split pe-md-split--original max-md:!w-full max-md:max-h-[40vh]"
          style={{ width: `${splitPct}%` }}
        >
          <div className="md:hidden px-0 pb-1 text-[10px] uppercase tracking-wide text-[#a83232] dark:text-cyber-danger/80">
            Original
          </div>
          <ReactMarkdown
            remarkPlugins={remarkPlugins}
            rehypePlugins={rehypePlugins}
          >
            {original || '*Empty*'}
          </ReactMarkdown>
        </div>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize Original / Proposed columns"
          aria-valuenow={splitPct}
          aria-valuemin={20}
          aria-valuemax={80}
          onPointerDown={onSplitPointerDown}
          data-pe-split-handle
          className="shrink-0 cursor-col-resize bg-paper-hairline/40 dark:bg-cyber-border/40 hover:bg-cyber-clay/60 dark:hover:bg-cyber-cyan/60 transition-colors max-md:hidden"
          style={{ width: 6, touchAction: 'none', userSelect: 'none' }}
        />
        <div
          className="min-h-0 min-w-0 overflow-auto bg-[rgba(0,130,70,0.08)] dark:bg-cyber-cyan/10 px-2 py-1.5 prose-md pe-md-split pe-md-split--proposed max-md:!w-full max-md:max-h-[40vh]"
          style={{ width: `${proposedPct}%` }}
        >
          <div className="md:hidden px-0 pb-1 text-[10px] uppercase tracking-wide text-[#1f6f3e] dark:text-cyber-cyan/80">
            Proposed
          </div>
          <ReactMarkdown
            remarkPlugins={remarkPlugins}
            rehypePlugins={rehypePlugins}
          >
            {replacement || '*Empty*'}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

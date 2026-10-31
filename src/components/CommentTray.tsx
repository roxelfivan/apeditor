/**
 * Bottom-sticky bar shown whenever the document has ≥ 1 comment.
 * Displays the count and a primary "Send to AI" button.
 *
 * The button is disabled / dimmed while a chat reply is streaming
 * (`sending` prop, set by `Editor.tsx` from the `mvp:chat-streaming`
 * window event) so a double-tap can't dispatch two requests.
 *
 * When there are outdated comments the tray grows an expandable
 * per-comment list with **Re-link** (opens `ReanchorPicker`) and
 * **Dismiss** (per-row) buttons. The bulk `Dismiss outdated` button
 * remains as the swept-everything path when callers don't supply
 * per-row callbacks.
 */
import { useState } from 'react';
import type { Comment } from '@/types';
import { TokenCounter } from '@/components/TokenCounter';

interface Props {
  /** Total number of comments on the current document. */
  count: number;
  /** Number of comments flagged as outdated (excluded from the send). */
  outdatedCount: number;
  /**
   * The outdated comments themselves, in document order. Used to
   * render the per-comment list under the tray. When omitted, only
   * the bulk `Dismiss outdated` button is rendered (preserving the
   * v0.5.1 UX for callers that don't have the v0.5.3 wiring).
   */
  outdatedComments?: Comment[];
  /** Whether a chat send / stream is already in flight. */
  sending?: boolean;
  /**
   * Estimated tokens for the next **Send to AI** batch. Supplied by
   * `Editor.tsx` from the same `buildRequestPreview` the real send
   * uses. When omitted (keyed providers / Local Model off) no
   * counter is rendered.
   */
  tokenEstimate?: number;
  /**
   * Total token budget the batch must fit into (the Local Model's
   * 8192 KV cache). Omit to render the count without a budget check.
   */
  tokenBudget?: number;
  /**
   * Tokens reserved for the reply's decode. The batch must fit in
   * `tokenBudget - tokenReserve` for a full-length reply.
   */
  tokenReserve?: number;
  /** Send handler. */
  onSend: () => void;
  /**
   * Delete every outdated comment on this document. Bulk action for
   * callers that don't expose per-row Dismiss — kept for the sweep
   * path.
   */
  onDismissOutdated?: () => void;
  /**
   * Per-row Dismiss handler. Wired through to the store's
   * `deleteComment` action.
   */
  onDismissOne?: (commentId: string) => void;
  /**
   * Per-row Re-link handler. The parent typically opens the
   * `ReanchorPicker` modal and, on confirm, calls
   * `reattachComment(id, { start, end })` from the store.
   */
  onReanchor?: (commentId: string) => void;
}

export function CommentTray({
  count,
  outdatedCount,
  outdatedComments,
  sending,
  tokenEstimate,
  tokenBudget,
  tokenReserve,
  onSend,
  onDismissOutdated,
  onDismissOne,
  onReanchor,
}: Props) {
  const [staleOpen, setStaleOpen] = useState(false);
  if (count === 0) return null;

  const sendableCount = count - outdatedCount;
  const sendableLabel =
    sendableCount === count
      ? `${count} ${count === 1 ? 'comment' : 'comments'}`
      : `${sendableCount} of ${count} comments ready (${outdatedCount} outdated)`;

  const hasPerRowControls =
    !!onDismissOne && !!onReanchor && outdatedComments;
  const staleList = outdatedComments ?? [];

  return (
    <div className="cm-tray" role="region" aria-label="Comment actions">
      <div className="cm-tray__row">
        <div className="cm-tray__label">{sendableLabel}</div>
        {outdatedCount > 0 && onDismissOutdated && !hasPerRowControls && (
          <button
            type="button"
            className="cm-tray__btn"
            onClick={() => onDismissOutdated()}
            disabled={sending}
            title="Delete all outdated comments on this document. ⌘Z undoes one at a time."
          >
            Dismiss outdated
          </button>
        )}
        <button
          type="button"
          className={[
            'cm-tray__btn cm-tray__btn--primary',
            sending ? 'cm-tray__btn--sending' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={() => onSend()}
          disabled={sending || sendableCount === 0}
        >
          {sending ? 'Sending…' : 'Send to AI'}
        </button>
        {/* Local Model: estimated tokens for this batch. */}
        {tokenEstimate !== undefined && (
          <TokenCounter
            tokens={tokenEstimate}
            budget={tokenBudget}
            reserve={tokenReserve}
            className="cm-tray__token"
            label="this Send to AI batch"
          />
        )}
      </div>

      {/* Per-comment stale list. Hidden until the user expands it so
          the tray stays a single row most of the time. Rendered only
          when both per-row callbacks are supplied so the affordance
          degrades gracefully for callers that haven't wired the
          v0.5.3 paths yet. */}
      {hasPerRowControls && outdatedCount > 0 && (
        <div className="cm-tray__stale">
          <button
            type="button"
            className="cm-tray__stale-toggle"
            onClick={() => setStaleOpen((v) => !v)}
            aria-expanded={staleOpen}
            aria-controls="cm-stale-list"
            title="Show every outdated comment with per-row Dismiss / Re-link"
          >
            <span className="cm-tray__stale-caret" aria-hidden>
              {staleOpen ? '▾' : '▸'}
            </span>
            <span>
              {outdatedCount} stale comment
              {outdatedCount === 1 ? '' : 's'} — Re-link or Dismiss
            </span>
            {onDismissOutdated && (
              <span
                className="cm-tray__stale-bulk"
                onClick={(e) => {
                  e.stopPropagation();
                  onDismissOutdated();
                }}
                title="Delete every outdated comment on this document. ⌘Z undoes one at a time."
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    onDismissOutdated();
                  }
                }}
              >
                Dismiss all
              </span>
            )}
          </button>
          {staleOpen && (
            <ul
              id="cm-stale-list"
              className="cm-stale-list"
              role="list"
              aria-label="Stale comments"
            >
              {staleList.map((c, i) => (
                <li
                  key={c.id}
                  className="cm-stale-list__row"
                  role="listitem"
                >
                  <span className="cm-stale-list__num" aria-hidden>
                    {i + 1}
                  </span>
                  <span
                    className="cm-stale-list__snippet"
                    title={c.snippet}
                  >
                    "
                    {c.snippet.length > 60
                      ? c.snippet.slice(0, 60) + '…'
                      : c.snippet}
                    "
                  </span>
                  <span className="cm-stale-list__actions">
                    <button
                      type="button"
                      className="cm-tray__btn cm-tray__btn--ghost"
                      onClick={() => onReanchor!(c.id)}
                      disabled={sending}
                      title="Re-anchor this comment to a new heading or paragraph"
                    >
                      Re-link
                    </button>
                    <button
                      type="button"
                      className="cm-tray__btn cm-tray__btn--ghost"
                      onClick={() => onDismissOne!(c.id)}
                      disabled={sending}
                      title="Delete this stale comment. ⌘Z restores it."
                    >
                      Dismiss
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

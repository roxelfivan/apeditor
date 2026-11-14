import { useMemo } from 'react';
import type { Comment } from '@/types';

/**
 * Right-margin strip that renders one numbered badge per comment,
 * positioned at the y-offset of the comment's first line.
 *
 * Badges are numbered in **document order** on every render — by
 * ascending `(start, end)` offset — regardless of creation order.
 * This matches the locked decision: the numbering follows the
 * passages, not the chronology.
 *
 * Tapping a badge opens `CommentPopover` (parent-controlled via
 * `onSelect`). Outdated comments render with a dashed border + a small
 * warning icon so they read as "needs attention" at a glance.
 *
 * The parent (`Editor`) is responsible for measuring the badge's
 * y-offset via `getSelectionRect(mirrorEl, start, end)` from
 * `src/utils/comments.ts` and supplying it via `badgePositions`.
 */
interface Props {
  /** All comments for the current document. */
  comments: Comment[];
  /** Map from comment id → y-offset (in pixels) inside the editor pane. */
  badgePositions: Record<string, number>;
  /** Tap / click handler; parent typically opens the popover. */
  onSelect: (commentId: string) => void;
  /**
   * Optional className appended to the strip (used by the editor to
   * switch to a horizontal chip lane on `< sm` viewports).
   */
  className?: string;
  /**
   * `column` (default) absolutely positions each badge on its line.
   * `inline` is a centred row (phone tray): no `top` offset, every
   * comment is shown even before line metrics land.
   */
  layout?: 'column' | 'inline';
}

export function CommentMargin({
  comments,
  badgePositions,
  onSelect,
  className,
  layout = 'column',
}: Props) {
  // Sort by document position so the numbering is stable and matches
  // the order the passages appear in the article.
  const sorted = useMemo(
    () => [...comments].sort((a, b) => a.start - b.start),
    [comments]
  );

  if (sorted.length === 0) return null;

  return (
    <div
      className={['cm-margin', className].filter(Boolean).join(' ')}
      role="list"
      aria-label="Inline comments"
    >
      {sorted.map((comment, i) => {
        const y = badgePositions[comment.id];
        if (layout === 'column' && typeof y !== 'number') return null;
        // True when the comment has at least one applied-edit
        // rationale attached across any of its rounds. The badge
        // shows a small dot to indicate "this comment has a
        // rationale" at a glance.
        const hasRationale =
          Array.isArray(comment.rounds) &&
          comment.rounds.some((r) => r.applied.length > 0);
        return (
          <button
            key={comment.id}
            type="button"
            role="listitem"
            className={[
              'cm-margin__badge',
              comment.outdated ? 'cm-margin__badge--outdated' : '',
              comment.sent ? 'cm-margin__badge--sent' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            // Desktop column: absolute y from line position. Inline
            // (phone tray) must not set `top` — it would stack chips.
            style={layout === 'column' && typeof y === 'number' ? { top: `${y}px` } : undefined}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(comment.id);
            }}
            onPointerUp={(e) => {
              // Prevent the parent textarea from blurring. Inline
              // chips use click only so one tap cannot hit two ids.
              e.stopPropagation();
              if (layout === 'inline') return;
              e.preventDefault();
              onSelect(comment.id);
            }}
            aria-label={
              `Comment ${i + 1}: ${comment.body.slice(0, 30)}` +
              (comment.outdated ? ' (anchor needs attention)' : '') +
              (hasRationale ? ' (has rationale)' : '')
            }
            title={comment.body}
          >
            <span className="cm-margin__badge-num">{i + 1}</span>
            {hasRationale && (
              <span
                className="cm-margin__badge-rationale"
                aria-hidden
                title="This comment has at least one applied-edit rationale"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

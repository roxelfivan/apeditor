/**
 * Debug Mode token counter pill.
 *
 * Shows the estimated size of the NEXT outgoing request, measured
 * against the budget it has to fit into. Rendered next to both send
 * affordances (the Chat composer's **Send** and the comment tray's
 * **Send to AI**) so the user can see, before sending, whether the
 * Local Model has room for a full reply.
 *
 * The estimate comes from `buildRequestPreview`, which packs the
 * request with the same `buildRequestMessages` the real send uses —
 * so this is the real payload size, not the length of the typed text.
 *
 * The pill only appears when Debug Mode is on; the callers gate it.
 */

import { formatTokenCount } from '@/utils/tokenEstimate';

export interface TokenCounterProps {
  /** Estimated tokens for the next request. */
  tokens: number;
  /**
   * Total budget the prompt must fit into (the Local Model's 8192
   * KV cache). Omit to render the count without a budget bar.
   */
  budget?: number;
  /**
   * Tokens reserved for the reply's decode. The prompt must fit in
   * `budget - reserve` for a full-length reply. Omit to skip the
   * "no room for a full reply" check.
   */
  reserve?: number;
  /**
   * What the counter is measuring — e.g. "Chat send" / "Send to AI".
   * Used in the tooltip.
   */
  label?: string;
  /** Extra classes for the pill (the tray uses its own CSS vars). */
  className?: string;
}

export function TokenCounter({
  tokens,
  budget,
  reserve,
  label = 'this send',
  className = '',
}: TokenCounterProps) {
  const safeTokens = Number.isFinite(tokens) ? Math.max(0, tokens) : 0;

  // The prompt has to leave room for the reply's decode budget, or
  // the model cannot produce a full-length answer.
  const usable = budget !== undefined ? budget - (reserve ?? 0) : undefined;
  const overBudget = usable !== undefined && safeTokens > usable;
  const nearBudget =
    usable !== undefined && !overBudget && safeTokens > usable * 0.9;

  const title = overBudget
    ? `~${formatTokenCount(safeTokens)} tokens for ${label}. ` +
      `The local model allows ${formatTokenCount(budget ?? 0)} tokens in ` +
      `total and reserves ${formatTokenCount(reserve ?? 0)} for the ` +
      `reply, so only ${formatTokenCount(Math.max(0, usable ?? 0))} are ` +
      `left for the prompt. The reply will be cut short — shorten the ` +
      `document or send fewer comments.`
    : nearBudget
      ? `~${formatTokenCount(safeTokens)} tokens for ${label}. ` +
        `Close to the ${formatTokenCount(usable ?? 0)}-token prompt ` +
        `budget — the reply may be truncated.`
      : `~${formatTokenCount(safeTokens)} tokens for ${label}` +
        (usable !== undefined
          ? ` (budget ${formatTokenCount(usable ?? 0)} for the prompt)`
          : '');

  const tone = overBudget
    ? 'border-cyber-danger/50 bg-cyber-danger/10 text-cyber-danger'
    : nearBudget
      ? 'border-cyber-warn/50 bg-cyber-warn/10 text-cyber-warn'
      : 'border-paper-hairline dark:border-cyber-border bg-paper-surface dark:bg-ape-panel text-paper-inkSoft dark:text-cyber-muted';

  return (
    <span
      className={[
        'inline-flex items-center gap-1 h-7 px-2 rounded border font-mono text-[11px] leading-none select-none whitespace-nowrap',
        tone,
        className,
      ].join(' ')}
      title={title}
      aria-label={title}
      role="status"
    >
      <span aria-hidden>~</span>
      <span>{formatTokenCount(safeTokens)}</span>
      <span aria-hidden className="opacity-70">
        tok
      </span>
      {overBudget && (
        <span aria-hidden className="font-semibold">
          !
        </span>
      )}
    </span>
  );
}

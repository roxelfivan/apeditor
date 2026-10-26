import type { ReactNode } from 'react';
import type { ChatTurn } from '@/utils/chatArchive';
import { turnPreview } from '@/utils/chatArchive';

function formatTurnTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return '';
  }
}

/**
 * Accordion chrome around one chat turn (user prompt + assistant
 * reply). Latest turn starts open; older turns start closed. Parent
 * owns expanded state so Expand all / Collapse older can drive it.
 */
export function ChatTurnFrame({
  turn,
  expanded,
  onToggle,
  children,
}: {
  turn: ChatTurn;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const preview = turnPreview(turn);
  const timestamp = turn.messages[0]?.createdAt ?? 0;
  return (
    <div className="rounded border border-paper-hairline dark:border-cyber-border bg-paper-panel/40 dark:bg-ape-panel/40">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-paper-elevated/70 dark:hover:bg-ape-elevated/50 transition-colors"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={expanded ? `Collapse turn: ${preview}` : `Expand turn: ${preview}`}
      >
        <span
          className="w-4 shrink-0 text-center text-paper-inkSoft dark:text-cyber-muted font-mono text-xs"
          aria-hidden
        >
          {expanded ? '−' : '+'}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-paper-ink dark:text-cyber-primary">
          {preview}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-paper-inkSoft dark:text-cyber-muted">
          {formatTurnTime(timestamp)}
        </span>
      </button>
      {expanded && <div className="px-2 pb-2 space-y-3">{children}</div>}
    </div>
  );
}

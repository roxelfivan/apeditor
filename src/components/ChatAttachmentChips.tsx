import type { ChatAttachment } from '@/types';

export interface ChatAttachmentChipItem extends ChatAttachment {
  previewUrl?: string;
  reading?: boolean;
}

interface Props {
  items: ChatAttachmentChipItem[];
  onRemove?: (id: string) => void;
  /** Darker chips on the clay/fire user bubble. */
  tone?: 'composer' | 'bubble';
}

export function ChatAttachmentChips({
  items,
  onRemove,
  tone = 'composer',
}: Props) {
  if (items.length === 0) return null;
  const onBubble = tone === 'bubble';
  return (
    <ul
      className={`flex flex-wrap gap-1.5 ${onBubble ? 'mb-1.5' : ''}`}
      aria-label="Attached files"
    >
      {items.map((item) => (
        <li
          key={item.id}
          className={
            onBubble
              ? 'inline-flex items-center gap-1 max-w-full rounded border border-paper-base/30 bg-black/15 px-1.5 py-0.5 text-[11px] font-medium'
              : 'inline-flex items-center gap-1 max-w-full rounded border border-paper-hairline dark:border-cyber-border bg-paper-elevated dark:bg-ape-elevated px-1.5 py-0.5 text-[11px] text-paper-ink dark:text-cyber-primary'
          }
        >
          {item.previewUrl ? (
            <img
              src={item.previewUrl}
              alt=""
              className="h-5 w-5 rounded object-cover shrink-0"
            />
          ) : (
            <span aria-hidden className="shrink-0 opacity-80">
              {item.mime === 'application/pdf' ||
              item.name.toLowerCase().endsWith('.pdf')
                ? 'PDF'
                : 'IMG'}
            </span>
          )}
          <span className="truncate max-w-[10rem]" title={item.name}>
            {item.name}
          </span>
          {item.reading && (
            <span className="opacity-70 shrink-0">reading…</span>
          )}
          {onRemove && (
            <button
              type="button"
              className="shrink-0 opacity-70 hover:opacity-100 leading-none"
              aria-label={`Remove ${item.name}`}
              onClick={() => onRemove(item.id)}
            >
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

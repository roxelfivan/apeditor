import { useEffect, useMemo, useState } from 'react';
import type { ArchivedChat, ChatMessage } from '@/types';
import { useStore } from '@/store/useStore';
import { ChatTurnFrame } from '@/components/ChatTurnFrame';
import { ChatAttachmentChips } from '@/components/ChatAttachmentChips';
import {
  ARCHIVE_OLD_DEFAULT_MS,
  countMessagesOlderThan,
  groupChatTurns,
} from '@/utils/chatArchive';

interface Props {
  documentId: string;
  onClose: () => void;
}

type Selection = { kind: 'current' } | { kind: 'archive'; id: string };

function formatWhen(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return '';
  }
}

function ReadOnlyBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
          isUser
            ? 'bg-cyber-clay text-paper-base dark:bg-ape-fire dark:text-white font-medium border border-cyber-clay/40 dark:border-cyber-fire/40'
            : 'bg-paper-elevated text-paper-ink dark:bg-ape-elevated dark:text-cyber-primary border border-paper-hairline dark:border-cyber-border'
        }`}
      >
        {isUser && message.attachments && message.attachments.length > 0 && (
          <ChatAttachmentChips items={message.attachments} tone="bubble" />
        )}
        {message.content ? (
          message.content
        ) : (
          <span className="opacity-60">
            {isUser
              ? message.attachments?.length
                ? ''
                : '(empty)'
              : 'thinking…'}
          </span>
        )}
      </div>
    </div>
  );
}

function HistoryThread({
  messages,
  label,
}: {
  messages: ChatMessage[];
  label: string;
}) {
  const turns = useMemo(() => groupChatTurns(messages), [messages]);
  const latestId = turns[turns.length - 1]?.id;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const messageSig = messages.map((m) => m.id).join('|');
  useEffect(() => {
    setExpanded({});
  }, [messageSig]);
  const isOpen = (id: string) => expanded[id] ?? id === latestId;

  if (messages.length === 0) {
    return (
      <p className="p-4 text-sm text-paper-inkSoft dark:text-cyber-muted">
        {label} is empty.
      </p>
    );
  }

  return (
    <div className="p-3 space-y-2">
      {turns.map((turn) => (
        <ChatTurnFrame
          key={turn.id}
          turn={turn}
          expanded={isOpen(turn.id)}
          onToggle={() =>
            setExpanded((prev) => ({
              ...prev,
              [turn.id]: !isOpen(turn.id),
            }))
          }
        >
          {turn.messages.map((m) => (
            <ReadOnlyBubble key={m.id} message={m} />
          ))}
        </ChatTurnFrame>
      ))}
    </div>
  );
}

export function ChatHistory({ documentId, onClose }: Props) {
  const doc = useStore((s) => s.documents.find((d) => d.id === documentId));
  const live = useStore((s) => s.chats[documentId] ?? []);
  const archives = useStore((s) => s.chatArchives[documentId] ?? []);
  const archiveChat = useStore((s) => s.archiveChat);
  const archiveOldChat = useStore((s) => s.archiveOldChat);
  const restoreArchivedChat = useStore((s) => s.restoreArchivedChat);
  const deleteArchivedChat = useStore((s) => s.deleteArchivedChat);

  const [selected, setSelected] = useState<Selection>({ kind: 'current' });

  const selectedArchive: ArchivedChat | null =
    selected.kind === 'archive'
      ? archives.find((a) => a.id === selected.id) ?? null
      : null;

  const oldCount = countMessagesOlderThan(live, ARCHIVE_OLD_DEFAULT_MS);

  if (!doc) return null;

  const paneMessages =
    selected.kind === 'current' ? live : selectedArchive?.messages ?? [];
  const paneLabel = selected.kind === 'current' ? 'Current chat' : 'This archive';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-2 sm:p-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <div
        className="w-full max-w-5xl h-[min(85vh,85dvh)] max-h-[calc(100dvh-1rem)] bg-paper-panel dark:bg-ape-panel rounded-lg shadow-ape-paper-lift dark:shadow-2xl border border-paper-hairline dark:border-cyber-border flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label="Chat history"
      >
        <div className="px-3 sm:px-4 py-3 border-b border-paper-hairline dark:border-cyber-border flex items-center gap-2 bg-paper-elevated/50 dark:bg-ape-elevated/50">
          <h2 className="font-semibold text-cyber-clay dark:text-cyber-cyan uppercase tracking-wider text-sm truncate min-w-0">
            Chat history —{' '}
            <span className="text-paper-ink dark:text-cyber-primary normal-case tracking-normal">
              {doc.title}
            </span>
          </h2>
          <div className="flex-1" />
          <button
            className="text-paper-inkSoft dark:text-cyber-muted hover:text-cyber-clay dark:hover:text-cyber-cyan transition-colors text-lg leading-none shrink-0"
            onClick={onClose}
            title="Close"
          >
            ×
          </button>
        </div>

        <div className="flex-1 flex flex-col md:flex-row min-h-0">
          <div className="md:w-64 shrink-0 border-b md:border-b-0 md:border-r border-paper-hairline dark:border-cyber-border overflow-y-auto bg-paper-base dark:bg-ape-base max-h-48 md:max-h-none">
            <ul>
              <li>
                <button
                  type="button"
                  className={`w-full text-left px-3 py-2 border-b border-paper-hairline dark:border-cyber-border border-l-2 transition-colors ${
                    selected.kind === 'current'
                      ? 'bg-paper-elevated dark:bg-ape-elevated border-l-cyber-clay dark:border-l-cyber-cyan'
                      : 'border-l-transparent hover:bg-paper-elevated/60 dark:hover:bg-ape-elevated/60'
                  }`}
                  onClick={() => setSelected({ kind: 'current' })}
                >
                  <div className="text-sm text-paper-ink dark:text-cyber-primary font-medium">
                    Current
                  </div>
                  <div className="text-[11px] text-paper-inkSoft dark:text-cyber-muted">
                    {live.length} {live.length === 1 ? 'message' : 'messages'}
                  </div>
                </button>
              </li>
              {archives.length === 0 && (
                <li className="px-3 py-2 text-xs text-paper-inkSoft dark:text-cyber-muted">
                  No archived chats yet.
                </li>
              )}
              {archives.map((a) => {
                const active =
                  selected.kind === 'archive' && selected.id === a.id;
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      className={`w-full text-left px-3 py-2 border-b border-paper-hairline dark:border-cyber-border border-l-2 transition-colors ${
                        active
                          ? 'bg-paper-elevated dark:bg-ape-elevated border-l-cyber-clay dark:border-l-cyber-cyan'
                          : 'border-l-transparent hover:bg-paper-elevated/60 dark:hover:bg-ape-elevated/60'
                      }`}
                      onClick={() => setSelected({ kind: 'archive', id: a.id })}
                    >
                      <div className="text-sm text-paper-ink dark:text-cyber-primary truncate">
                        {a.title}
                      </div>
                      <div className="text-[11px] text-paper-inkSoft dark:text-cyber-muted">
                        {formatWhen(a.archivedAt)} · {a.messages.length}{' '}
                        {a.messages.length === 1 ? 'message' : 'messages'}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto bg-paper-base dark:bg-ape-base">
            {selected.kind === 'archive' && !selectedArchive ? (
              <p className="p-4 text-sm text-paper-inkSoft dark:text-cyber-muted">
                That archive is gone.
              </p>
            ) : (
              <HistoryThread messages={paneMessages} label={paneLabel} />
            )}
          </div>
        </div>

        <div className="px-3 sm:px-4 py-2 border-t border-paper-hairline dark:border-cyber-border flex flex-wrap items-center gap-2 bg-paper-elevated/40 dark:bg-ape-elevated/40">
          {selected.kind === 'current' ? (
            <>
              <button
                type="button"
                className="btn-cyan-sm"
                disabled={live.length === 0}
                onClick={() => {
                  archiveChat(documentId);
                }}
                title="Park the live conversation and start a new empty chat"
              >
                Archive current
              </button>
              <button
                type="button"
                className="btn-ghost text-xs"
                disabled={oldCount === 0}
                onClick={() => {
                  if (
                    !window.confirm(
                      `Archive ${oldCount} message${
                        oldCount === 1 ? '' : 's'
                      } older than 7 days? Newer messages stay in Current.`
                    )
                  ) {
                    return;
                  }
                  archiveOldChat(documentId, ARCHIVE_OLD_DEFAULT_MS);
                }}
                title="Move messages older than 7 days into a new archive entry"
              >
                Archive older than 7 days
                {oldCount > 0 ? ` (${oldCount})` : ''}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn-fire-sm"
                disabled={!selectedArchive}
                onClick={() => {
                  if (!selectedArchive) return;
                  restoreArchivedChat(documentId, selectedArchive.id);
                  setSelected({ kind: 'current' });
                }}
                title="Make this the live chat. The current live thread is archived first if it has messages."
              >
                Restore as current
              </button>
              <button
                type="button"
                className="text-xs text-paper-inkSoft dark:text-cyber-muted hover:text-cyber-danger transition-colors"
                disabled={!selectedArchive}
                onClick={() => {
                  if (!selectedArchive) return;
                  if (
                    !window.confirm(
                      'Delete this archived chat? This cannot be undone.'
                    )
                  ) {
                    return;
                  }
                  deleteArchivedChat(documentId, selectedArchive.id);
                  setSelected({ kind: 'current' });
                }}
              >
                Delete archive
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

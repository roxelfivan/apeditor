/**
 * Pure helpers for grouping chat turns and parking old conversations.
 *
 * The Zustand store calls these so archive/restore/split behaviour can
 * be unit-tested without mounting React or the persist middleware.
 */

import { v4 as uuid } from 'uuid';
import type { ArchivedChat, ChatMessage } from '@/types';

/** Default cutoff for "Archive older than 7 days". */
export const ARCHIVE_OLD_DEFAULT_MS = 7 * 24 * 60 * 60 * 1000;

const TITLE_MAX = 80;

/** One user prompt plus any assistant replies that follow it. */
export interface ChatTurn {
  id: string;
  messages: ChatMessage[];
}

export function groupChatTurns(messages: ChatMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const message of messages) {
    if (message.role === 'user' || turns.length === 0) {
      turns.push({ id: message.id, messages: [message] });
    } else {
      turns[turns.length - 1].messages.push(message);
    }
  }
  return turns;
}

export function archiveTitleFromMessages(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user') ?? messages[0];
  const raw = firstUser?.content ?? '';
  const line = raw.trim().split('\n')[0] ?? '';
  const trimmed = line.slice(0, TITLE_MAX).trim();
  return trimmed.length > 0 ? trimmed : 'Chat';
}

export function turnPreview(turn: ChatTurn): string {
  return archiveTitleFromMessages(turn.messages);
}

export function buildArchivedChat(
  messages: ChatMessage[],
  now = Date.now(),
  id = uuid()
): ArchivedChat {
  return {
    id,
    title: archiveTitleFromMessages(messages),
    archivedAt: now,
    messages,
  };
}

export function countMessagesOlderThan(
  live: ChatMessage[],
  olderThanMs: number,
  now = Date.now()
): number {
  const cutoff = now - olderThanMs;
  return live.filter((m) => m.createdAt <= cutoff).length;
}

export function applyArchiveCurrent(
  live: ChatMessage[],
  archives: ArchivedChat[],
  now = Date.now()
): { live: ChatMessage[]; archives: ArchivedChat[] } | null {
  if (live.length === 0) return null;
  return {
    live: [],
    archives: [buildArchivedChat(live, now), ...archives],
  };
}

export function applyArchiveOld(
  live: ChatMessage[],
  archives: ArchivedChat[],
  olderThanMs: number,
  now = Date.now()
): { live: ChatMessage[]; archives: ArchivedChat[]; archivedCount: number } | null {
  const cutoff = now - olderThanMs;
  const oldMsgs = live.filter((m) => m.createdAt <= cutoff);
  if (oldMsgs.length === 0) return null;
  const rest = live.filter((m) => m.createdAt > cutoff);
  return {
    live: rest,
    archives: [buildArchivedChat(oldMsgs, now), ...archives],
    archivedCount: oldMsgs.length,
  };
}

export function applyRestoreArchivedChat(
  live: ChatMessage[],
  archives: ArchivedChat[],
  archiveId: string,
  now = Date.now()
): { live: ChatMessage[]; archives: ArchivedChat[] } | null {
  const found = archives.find((a) => a.id === archiveId);
  if (!found) return null;
  let nextArchives = archives.filter((a) => a.id !== archiveId);
  if (live.length > 0) {
    nextArchives = [buildArchivedChat(live, now), ...nextArchives];
  }
  return { live: found.messages, archives: nextArchives };
}

export function applyDeleteArchivedChat(
  archives: ArchivedChat[],
  archiveId: string
): ArchivedChat[] | null {
  if (!archives.some((a) => a.id === archiveId)) return null;
  return archives.filter((a) => a.id !== archiveId);
}

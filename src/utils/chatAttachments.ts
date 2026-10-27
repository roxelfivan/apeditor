// Chat composer attachments: delimiters + the single format-then-answer
// prompt. Import still calls `formatOcrAsMarkdown()` (output-only
// Markdown). Chat reuses those conversion rules in one user message so
// the model formats extracts first, then answers — one completion.

import type { ChatAttachment, ChatMessage } from '@/types';

export const EMPTY_ATTACHMENT_USER_REQUEST =
  '(no additional message — work from the attachments)';

export function formatAttachedFileBlock(
  name: string,
  extractedText: string
): string {
  return (
    `----- BEGIN ATTACHED FILE: ${name} -----\n` +
    `${extractedText.trimEnd()}\n` +
    `----- END ATTACHED FILE -----`
  );
}

/**
 * One outbound user body: format each extract as Markdown, then answer
 * the typed request. The stored bubble `content` stays the typed prose;
 * call this only when building the outbound request.
 */
export function buildAttachmentTurnPrompt(
  userText: string,
  attachments: ChatAttachment[]
): string {
  if (attachments.length === 0) return userText;
  const files = attachments
    .map((a) => formatAttachedFileBlock(a.name, a.extractedText))
    .join('\n\n');
  const request = userText.trim() || EMPTY_ATTACHMENT_USER_REQUEST;
  return (
    `Do this in order:\n` +
    `1. Convert each attached extract into clean Markdown (preserve every fact; ` +
    `repair OCR wraps/hyphens/spacing; use headings, lists, tables when the ` +
    `source implies them; invent nothing).\n` +
    `2. Then answer the user request using that Markdown as the attachment text. ` +
    `Refer to files by name. Do not dump the converted Markdown unless the user asked to see it.\n\n` +
    `${files}\n\n` +
    `----- BEGIN USER REQUEST -----\n` +
    `${request}\n` +
    `----- END USER REQUEST -----`
  );
}

/** Swap in the format-then-answer body when a user turn has files. */
export function withOutboundAttachmentPrompt(
  message: ChatMessage
): ChatMessage {
  if (message.role !== 'user' || !message.attachments?.length) {
    return message;
  }
  return {
    ...message,
    content: buildAttachmentTurnPrompt(message.content, message.attachments),
  };
}

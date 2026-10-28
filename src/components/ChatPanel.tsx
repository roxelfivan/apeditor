import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { v4 as uuid } from 'uuid';
import ReactMarkdown from 'react-markdown';
import { useStore } from '@/store/useStore';
import { buildRequestMessages, buildRequestPreview, streamChatCompletion, ApiError } from '@/api/chat';
import {
  isLocalGemmaEngineReady,
  streamLocalGemmaCompletion,
  tryLoadLocalGemmaFromCache,
} from '@/api/localGemma';
import { redactSecretsInMessages } from '@/utils/secrets';
import type { ChatAttachment, ChatMessage, MentionToken, ProposedEdit } from '@/types';
import { ChatAttachmentChips } from '@/components/ChatAttachmentChips';
import { withOutboundAttachmentPrompt } from '@/utils/chatAttachments';
import { IMPORT_FILE_ACCEPT } from '@/utils/ocr';
import { ProposedEditCard } from '@/components/ProposedEditCard';
import { LocalGemmaControls } from '@/components/LocalGemmaControls';
import { ResizeHandle } from '@/components/ResizeHandle';
import { useDragResize, clamp, MIN_CHAT_WIDTH, MAX_CHAT_WIDTH } from '@/hooks/useDragResize';
import { parseProposedEdits, formatRejectionBatch, applyAllEdits } from '@/utils/proposedEdit';
import { formatCommentBatch } from '@/utils/comments';
import { remarkPlugins, rehypePlugins } from '@/utils/markdown';
import { requiresApiKey } from '@/config/providers';
import { MentionInput } from '@/components/mentions/MentionInput';
import { parseMentions } from '@/utils/mentions/parseMentions';
import {
  CHAT_MESSAGES_COLLAPSED_KEY,
  CHAT_MESSAGES_HEIGHT_KEY,
} from '@/utils/storage';
import { useIsNarrow } from '@/hooks/useMediaQuery';
import { ChatHistory } from '@/components/ChatHistory';
import { ChatTurnFrame } from '@/components/ChatTurnFrame';
import { TokenCounter } from '@/components/TokenCounter';
import { groupChatTurns } from '@/utils/chatArchive';
import { estimateMessageTokens } from '@/utils/tokenEstimate';
import {
  LOCAL_MAX_NUM_TOKENS,
  LOCAL_MAX_OUTPUT_TOKENS,
} from '@/api/localGemma';

// Maximum fraction of the viewport width the chat panel is allowed to
// occupy. The static MAX_CHAT_WIDTH is still used as a floor so the panel
// can grow on wider displays without losing the old 720px default ceiling.
const MAX_CHAT_FRACTION = 2 / 3;
const computeMaxChatWidth = () =>
  Math.max(MAX_CHAT_WIDTH, Math.floor(window.innerWidth * MAX_CHAT_FRACTION));

// Clamp the persisted chat width on read so a stale localStorage entry
// (e.g. values written before bounds existed) cannot push the panel off-screen.
const useChatWidth = () => {
  const raw = useStore((s) => s.layout.chatWidth);
  return clamp(raw, MIN_CHAT_WIDTH, computeMaxChatWidth());
};

// Resolve an @-mention document from the live store. Defined at
// module scope so the `mvp:send-comments` listener can call it even
// when ChatPanel early-returns (chat closed or collapsed). A `const`
// after that return stays in the temporal dead zone and throws
// `Cannot access '…' before initialization` (minified as `ve` in
// production) the moment Send to AI runs from Write mode.
/**
 * Stream an assistant reply for the active provider. Keyed providers
 * use OpenAI-compatible SSE; Local Gemma uses in-browser LiteRT-LM.
 */
async function streamAssistantReply(
  messages: ChatMessage[],
  api: ReturnType<typeof useStore.getState>['api'],
  options: { signal?: AbortSignal; onDelta: (delta: string) => void }
): Promise<void> {
  if (!requiresApiKey(api.provider)) {
    if (!isLocalGemmaEngineReady()) {
      const loaded = await tryLoadLocalGemmaFromCache(options.signal);
      if (!loaded) {
        throw new ApiError(
          'Local Gemma is not ready. Open Settings and download the model from Hugging Face (or load a .litertlm file).'
        );
      }
    }
    await streamLocalGemmaCompletion(messages, options);
    return;
  }
  await streamChatCompletion(messages, api, options);
}

function lookupDocumentById(id: string) {
  return useStore.getState().documents.find((d) => d.id === id) ?? null;
}

export function ChatPanel() {
  const chatOpen = useStore((s) => s.chatOpen);
  const setChatOpen = useStore((s) => s.setChatOpen);
  const chatCollapsed = useStore((s) => s.chatCollapsed);
  const setChatCollapsed = useStore((s) => s.setChatCollapsed);
  const isNarrow = useIsNarrow();
  const currentDocumentId = useStore((s) => s.currentDocumentId);
  const chats = useStore((s) => s.chats);
  const appendMessage = useStore((s) => s.appendMessage);
  const updateLastAssistant = useStore((s) => s.updateLastAssistant);
  const clearChat = useStore((s) => s.clearChat);
  const archiveChat = useStore((s) => s.archiveChat);
  const api = useStore((s) => s.api);
  const includeSelection = useStore((s) => s.includeSelection);
  const setIncludeSelection = useStore((s) => s.setIncludeSelection);
  // Debug Mode gates the token counter next to the Send button.
  const debugMode = useStore((s) => s.debugMode);

  const [input, setInput] = useState('');
  // Document mentions attached to the current chat input. Populated by
  // the MentionInput when the user picks a doc (and optionally a set
  // of paragraphs) via the @ picker. Forwarded to buildRequestMessages
  // alongside the current document so the model sees the referenced
  // doc(s) in the system prompt.
  const [mentions, setMentions] = useState<MentionToken[]>([]);
  // Composer “+” attachments. Object URLs are composer-only (revoked
  // on remove / send / unmount) and never persisted on ChatMessage.
  const [pendingAttachments, setPendingAttachments] = useState<
    Array<ChatAttachment & { previewUrl?: string; reading?: boolean }>
  >([]);
  const [ocrBusy, setOcrBusy] = useState(false);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const pendingAttachmentsRef = useRef(pendingAttachments);
  pendingAttachmentsRef.current = pendingAttachments;
  const [selection, setSelection] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Per-assistant-message staged rejection comments. Keyed by the
  // assistant message id so multiple in-flight replies can each have their
  // own batch. Value entries are the (editId, comment, mentions) tuples
  // the user has queued via "Reject with feedback"; a card flips to its
  // staged outline when its entry is present.
  const [stagedRejections, setStagedRejections] = useState<
    Record<
      string,
      Array<{ editId: string; comment: string; mentions: MentionToken[] }>
    >
  >({});
  // After a staged-rejection batch is committed, the matching cards need
  // to disappear without a re-render flash. We flip them into a
  // "committed" set keyed by editId so the card hides itself immediately.
  const [committedRejections, setCommittedRejections] = useState<
    Record<string, Record<string, true>>
  >({});
  // Per-message "Apply All" summary, shown briefly in the message footer
  // after a bulk apply finishes. Keyed by assistant message id. The
  // `at` timestamp is used by a per-message useEffect to clear the entry
  // after a short delay so it fades out on its own.
  const [applyAllSummary, setApplyAllSummary] = useState<
    Record<string, { applied: number; total: number; at: number }>
  >({});
  const abortRef = useRef<AbortController | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const chatWidth = useChatWidth();
  const setLayout = useStore((s) => s.setLayout);
  const containerRef = useRef<HTMLDivElement>(null);
  const isKeyless = !requiresApiKey(api.provider);
  const [localGemmaReady, setLocalGemmaReady] = useState(() =>
    isLocalGemmaEngineReady()
  );

  // Memoized so the identity is stable when the document has no chat
  // yet (`?? []` would otherwise allocate a new array on every render,
  // which would re-trigger the token-preview effect below forever).
  const messages: ChatMessage[] = useMemo(
    () => (currentDocumentId ? chats[currentDocumentId] ?? [] : []),
    [chats, currentDocumentId]
  );
  const turns = useMemo(() => groupChatTurns(messages), [messages]);
  const latestTurnId = turns[turns.length - 1]?.id;
  const [turnExpanded, setTurnExpanded] = useState<Record<string, boolean>>(
    {}
  );

  // ---------------------------------------------------------------------------
  // Debug Mode: estimated size of the NEXT chat send.
  //
  // Mirrors `handleSend`'s packing exactly (same history, same synthetic
  // user turn, same mention list, same proposed-edit policy) so the number
  // reflects the real payload rather than the length of the typed text.
  //
  // Packing is not free — the Local Model path inlines the whole document —
  // so the recompute is debounced and skipped entirely when Debug Mode is
  // off. `buildRequestPreview` delegates to the same `buildRequestMessages`
  // the real send uses, so the two cannot drift.
  // ---------------------------------------------------------------------------
  const [previewTokens, setPreviewTokens] = useState(0);
  // Debug Mode: the prompt size of the most recent completed send.
  // Useful for confirming whether the Local Model actually had room for
  // a full reply (a reply that stops mid-sentence usually means the
  // prompt ate the decode budget).
  const [lastSentTokens, setLastSentTokens] = useState(0);
  const previewInput = useMemo(() => {
    // Cheap snapshot of everything the packed payload depends on. Used as
    // the debounce key so we only re-pack when one of these changes.
    const { plain } = parseMentions(input);
    const readyAttachments: ChatAttachment[] = pendingAttachments
      .filter((a) => !a.reading && a.extractedText.trim())
      .map(({ id, name, mime, extractedText }) => ({
        id,
        name,
        mime,
        extractedText,
      }));
    return {
      text: plain.trim(),
      mentions,
      attachments: readyAttachments,
      selection: includeSelection ? selection : '',
    };
  }, [input, mentions, pendingAttachments, selection, includeSelection]);

  useEffect(() => {
    if (!debugMode) {
      setPreviewTokens(0);
      return;
    }
    // Debounce: packing runs over the whole document, so a per-keystroke
    // recompute would be wasteful on a long draft.
    const timer = window.setTimeout(() => {
      const userMsg: ChatMessage = {
        id: 'preview-user',
        role: 'user',
        content: previewInput.text,
        selection: previewInput.selection || undefined,
        ...(previewInput.attachments.length > 0
          ? { attachments: previewInput.attachments }
          : {}),
        createdAt: 0,
      };
      const outboundUserMsg = withOutboundAttachmentPrompt(userMsg);
      const assistantMsg: ChatMessage = {
        id: 'preview-assistant',
        role: 'assistant',
        content: '',
        createdAt: 0,
      };
      const docSnap = currentDocumentId
        ? useStore.getState().documents.find((d) => d.id === currentDocumentId)
        : null;
      const preview = buildRequestPreview(
        [...messages, outboundUserMsg, assistantMsg],
        api.systemMessage,
        docSnap
          ? { title: docSnap.title, content: docSnap.content, id: docSnap.id }
          : null,
        api.rationaleRulesOverride,
        previewInput.mentions,
        lookupDocumentById,
        undefined,
        api.provider === 'local-gemma' ? 'on-demand' : 'eager'
      );
      setPreviewTokens(preview.tokens);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    debugMode,
    messages,
    api.systemMessage,
    api.rationaleRulesOverride,
    api.provider,
    currentDocumentId,
    previewInput,
  ]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [messagesCollapsed, setMessagesCollapsed] = useState(() => {
    try {
      return localStorage.getItem(CHAT_MESSAGES_COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(
        CHAT_MESSAGES_COLLAPSED_KEY,
        messagesCollapsed ? '1' : '0'
      );
    } catch {
      /* ignore quota errors */
    }
  }, [messagesCollapsed]);
  useEffect(() => {
    setTurnExpanded({});
  }, [currentDocumentId]);
  useEffect(() => {
    return () => {
      for (const item of pendingAttachmentsRef.current) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
    };
  }, []);
  const isTurnExpanded = (id: string) =>
    turnExpanded[id] ?? id === latestTurnId;

  const clearPendingAttachments = () => {
    setPendingAttachments((prev) => {
      for (const item of prev) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
      return [];
    });
  };

  const removePendingAttachment = (id: string) => {
    setPendingAttachments((prev) => {
      const hit = prev.find((a) => a.id === id);
      if (hit?.previewUrl) URL.revokeObjectURL(hit.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  };

  const onAttachFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const fileArray = Array.from(files);
    e.target.value = '';
    const staged = fileArray.map((file) => {
      const isImage = file.type.startsWith('image/');
      return {
        id: uuid(),
        name: file.name,
        mime: file.type || (file.name.toLowerCase().endsWith('.pdf')
          ? 'application/pdf'
          : ''),
        extractedText: '',
        previewUrl: isImage ? URL.createObjectURL(file) : undefined,
        reading: true,
        file,
      };
    });
    setPendingAttachments((prev) => [
      ...prev,
      ...staged.map((s) => ({
        id: s.id,
        name: s.name,
        mime: s.mime,
        extractedText: s.extractedText,
        previewUrl: s.previewUrl,
        reading: s.reading,
      })),
    ]);
    setOcrBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { extractTextFromFiles } = await import('@/utils/ocr');
      const texts = await extractTextFromFiles(
        staged.map((s) => s.file),
        ['eng'],
        undefined
      );
      setPendingAttachments((prev) => {
        const next = [...prev];
        const recognized: string[] = [];
        for (let i = 0; i < staged.length; i++) {
          const idx = next.findIndex((a) => a.id === staged[i].id);
          if (idx === -1) continue;
          const text = (texts[i] ?? '').trim();
          if (!text) {
            if (next[idx].previewUrl) URL.revokeObjectURL(next[idx].previewUrl);
            next.splice(idx, 1);
            continue;
          }
          recognized.push(staged[i].name);
          next[idx] = {
            ...next[idx],
            extractedText: text,
            reading: false,
          };
        }
        if (recognized.length === 0) {
          setError('No text was recognized in the selected file(s).');
        }
        return next;
      });
    } catch (err) {
      setPendingAttachments((prev) => {
        const ids = new Set(staged.map((s) => s.id));
        const kept: typeof prev = [];
        for (const item of prev) {
          if (ids.has(item.id)) {
            if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
          } else {
            kept.push(item);
          }
        }
        return kept;
      });
      setError((err as Error).message || 'OCR failed.');
    } finally {
      setOcrBusy(false);
    }
  };

  // Listen for selection events from the editor, fill-chat from PromptLibrary,
  // and window resize to re-clamp the chat width against the 2/3 viewport cap.
  useEffect(() => {
    const onSel = (e: Event) => {
      const detail = (e as CustomEvent<{ text: string }>).detail;
      setSelection(detail?.text ?? '');
    };
    const onFill = (e: Event) => {
      const body = (e as CustomEvent<string>).detail;
      if (typeof body === 'string') {
        setInput((prev) => (prev.trim() ? `${prev}\n\n${body}` : body));
      }
    };
    const onResize = () => {
      const max = computeMaxChatWidth();
      const raw = useStore.getState().layout.chatWidth;
      if (raw > max) {
        setLayout({ chatWidth: clamp(raw, MIN_CHAT_WIDTH, max) });
      }
    };
    // Comment-batch send: triggered by `CommentTray` in the editor
    // via the `mvp:send-comments` window event. We build the user
    // message body from the current document + the selected
    // comments, append it, then stream the assistant reply through
    // the same pipeline as a normal chat send.
    const onSendComments = async (e: Event) => {
      const detail = (
        e as CustomEvent<{
          commentIds: string[];
          mentionsByCommentId?: Record<string, MentionToken[]>;
        }>
      ).detail;
      if (!detail || !Array.isArray(detail.commentIds)) return;
      if (!currentDocumentId || streaming) return;
      const docSnap = useStore
        .getState()
        .documents.find((d) => d.id === currentDocumentId);
      if (!docSnap) return;
      const allComments = useStore.getState().comments[currentDocumentId] ?? [];
      const comments = allComments.filter(
        (c) => detail.commentIds.includes(c.id) && !c.outdated
      );
      if (comments.length === 0) return;
      // Reveal the panel so the user sees the turn. Write mode and
      // narrow viewports keep chat collapsed; the listener still
      // runs in that state, which is why document lookup lives at
      // module scope rather than after the render early-return.
      setChatOpen(true);
      setChatCollapsed(false);
      if (isNarrow) {
        useStore.getState().setSidebarCollapsed(true);
      }
      useStore.getState().saveRevision(currentDocumentId, 'Before AI send');
      // Gather document mentions attached to each comment's latest
      // round. Prefer the event payload (most recent) and fall back
      // to reading the round's stored `mentions` so the prompt still
      // includes references for comments created before this
      // listener was updated to forward the payload.
      const seen = new Set<string>();
      const mergedMentions: MentionToken[] = [];
      const payload = detail.mentionsByCommentId ?? {};
      for (const c of comments) {
        const list =
          payload[c.id] ??
          (c.rounds.length > 0
            ? c.rounds[c.rounds.length - 1].mentions
            : undefined) ??
          [];
        for (const m of list) {
          if (seen.has(m.id)) continue;
          seen.add(m.id);
          mergedMentions.push(m);
        }
      }
      const body = formatCommentBatch(docSnap.content, comments);
      const userMsg: ChatMessage = {
        id: uuid(),
        role: 'user',
        content: body,
        createdAt: Date.now(),
      };
      // Snapshot the history BEFORE appending `userMsg`. Reading it
      // after the append would put `userMsg` in the store already, and
      // the `[..., userMsg, ...]` spread below would then send the
      // whole comment batch to the model TWICE — doubling the prompt
      // size and, on the Local Model path, blowing the 8192-token KV
      // cache.
      const historyFromStore =
        useStore.getState().chats[currentDocumentId] ?? [];
      appendMessage(currentDocumentId, userMsg);
      // Mark the sent comments in the store + notify any open
      // popover that the comments have been committed.
      useStore
        .getState()
        .markCommentsSent(comments.map((c) => c.id));
      window.dispatchEvent(
        new CustomEvent('mvp:mark-comments-sent', {
          detail: { ids: comments.map((c) => c.id) },
        })
      );
      // Stream the assistant reply through the same pipeline as a
      // normal chat send. We inline the streaming body here so the
      // listener doesn't need to reference `runAssistantReplyAfterCommit`
      // (which is defined further down the component body).
      const assistantMsg: ChatMessage = {
        id: uuid(),
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
      };
      appendMessage(currentDocumentId, assistantMsg);
      const history = [...historyFromStore, userMsg, assistantMsg];
      setStreaming(true);
      setError(null);
      // Notify other components (e.g. the editor's CommentTray) that
      // a chat send is in progress so they can dim / disable their
      // own "Send to AI" button to prevent double-sends.
      window.dispatchEvent(new CustomEvent('mvp:chat-streaming', { detail: { streaming: true } }));
      abortRef.current = new AbortController();
      let acc = '';
      try {
        const packed = redactSecretsInMessages(
          buildRequestMessages(
            history,
            api.systemMessage,
            docSnap
              ? { title: docSnap.title, content: docSnap.content, id: docSnap.id }
              : null,
            api.rationaleRulesOverride,
            mergedMentions,
            lookupDocumentById,
            // Pass through the per-comment mapping so the prompt
            // builder can emit the `[comment -> referenced docs]`
            // cross-reference map. Prefer the fresh payload, fall
            // back to the round-stored mentions (same merge logic
            // as `mergedMentions` above so the two arrays stay in
            // sync — first-emission wins per mention id).
            payload,
            false,
            api.provider === 'local-gemma' ? 'on-demand' : 'eager'
          )
        );
        if (packed.count > 0) {
          setNotice(
            `Redacted ${packed.count} secret-looking string${
              packed.count === 1 ? '' : 's'
            } from this send.`
          );
        }
        // Debug Mode: remember the prompt size that actually went out.
        setLastSentTokens(estimateMessageTokens(packed.messages));
        await streamAssistantReply(packed.messages, api, {
          signal: abortRef.current.signal,
          onDelta: (delta) => {
            acc += delta;
            updateLastAssistant(currentDocumentId, acc);
          },
        });
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          // user cancelled
        } else if (err instanceof ApiError) {
          setError((err as ApiError).message);
        } else {
          setError((err as Error).message || 'Unknown error');
        }
      } finally {
        setStreaming(false);
        // Notify other components the chat is no longer streaming.
        window.dispatchEvent(new CustomEvent('mvp:chat-streaming', { detail: { streaming: false } }));
        abortRef.current = null;
      }
    };
    window.addEventListener('mvp:editor-selection', onSel);
    window.addEventListener('mvp:fill-chat', onFill);
    window.addEventListener('resize', onResize);
    window.addEventListener('mvp:send-comments', onSendComments);
    return () => {
      window.removeEventListener('mvp:editor-selection', onSel);
      window.removeEventListener('mvp:fill-chat', onFill);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('mvp:send-comments', onSendComments);
    };
  }, [
    setLayout,
    currentDocumentId,
    streaming,
    appendMessage,
    updateLastAssistant,
    api,
    isNarrow,
    setChatOpen,
    setChatCollapsed,
  ]);

  // Auto-scroll to bottom on new messages / streaming.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  // The chat's left edge handle: dragging it rightward (toward the chat)
  // shrinks the chat; leftward widens it. The panel's right edge is
  // positioned at the mouse X (clamped to [MIN, dynamic MAX]) so the handle
  // and cursor stay aligned. The upper bound is recomputed per drag tick so
  // it tracks the current viewport (up to 2/3 of the window).
  const { start } = useDragResize({
    mode: 'axis',
    axis: 'horizontal',
    onDelta: ({ absX }) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const next = clamp(
        rect.right - absX,
        MIN_CHAT_WIDTH,
        computeMaxChatWidth()
      );
      setLayout({ chatWidth: next });
    },
  });

  // Vertical split between the messages (output) area and the input
  // area. Persisted in localStorage so the user's preferred split
  // survives reloads. Defaults to 60% of the panel height, clamped
  // to a sensible range on render. Dragging the divider updates
  // this height; the input area below fills the remaining space.
  const [messagesHeight, setMessagesHeight] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(CHAT_MESSAGES_HEIGHT_KEY);
      if (!raw) return 0; // 0 ⇒ "use default (60% of panel)"
      const n = parseInt(raw, 10);
      if (!Number.isFinite(n)) return 0;
      // Clamp to a sane range: 120 ≤ n ≤ 1200. Stale values that fall
      // outside this range are treated as 0 (use default) rather than
      // collapsed, so a tiny/oversized stored value cannot trap the
      // user with a 0-px or screen-filling messages area.
      if (n < 120 || n > 1200) return 0;
      return n;
    } catch {
      return 0;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(
        CHAT_MESSAGES_HEIGHT_KEY,
        String(messagesHeight)
      );
    } catch {
      /* ignore quota errors */
    }
  }, [messagesHeight]);
  // Clamp the messages height against the live panel height so the
  // divider cannot drag the input area off-screen. The min keeps the
  // input area (composer field + Send) usable; the max keeps the
  // messages area from pushing the input off the bottom.
  const clampMessagesHeight = (px: number): number => {
    const panel = containerRef.current;
    const max = panel ? Math.max(160, panel.clientHeight - 180) : 1000;
    return Math.min(max, Math.max(120, px));
  };
  const messagesHeightAnchor = useRef<number>(messagesHeight);
  const messagesHeightStart = useRef<number>(messagesHeight);
  const { start: beginMessagesResize } = useDragResize({
    mode: 'axis',
    axis: 'vertical',
    onDelta: ({ dy }) => {
      // dy is cumulative from drag start; dragging DOWN grows the
      // messages area (so we ADD dy to the start height). The anchor
      // is converted to an absolute height and clamped on the fly.
      messagesHeightAnchor.current =
        messagesHeightStart.current + dy;
      setMessagesHeight(
        clampMessagesHeight(messagesHeightAnchor.current)
      );
    },
  });
  const onMessagesHandleDown = (
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    messagesHeightStart.current = messagesHeight;
    messagesHeightAnchor.current = messagesHeight;
    beginMessagesResize('top', e);
  };

  if (!chatOpen || chatCollapsed) {
    // When the panel is closed (topbar Chat toggle) or explicitly
    // collapsed (edge-anchor), render nothing. The edge-anchor button
    // rendered by App.tsx is responsible for bringing it back. We
    // deliberately do not render the old top-right "Chat" floating
    // button — it would clash with the edge-anchor strip.
    return null;
  }

  const handleSend = async () => {
    if (!currentDocumentId) return;
    // Strip mention sentinels from the displayed text so the user
    // message that gets persisted / sent to the model does not carry
    // opaque `[[mention:…]]` sequences. The chips in the UI are the
    // canonical representation; the message body should be the prose
    // the user typed.
    const { plain } = parseMentions(input);
    const text = plain.trim();
    const readyAttachments: ChatAttachment[] = pendingAttachments
      .filter((a) => !a.reading && a.extractedText.trim())
      .map(({ id, name, mime, extractedText }) => ({
        id,
        name,
        mime,
        extractedText,
      }));
    if (streaming || ocrBusy) return;
    if (!text && readyAttachments.length === 0) return;
    // Snapshot current document before the AI turn so the user can
    // restore via Revision history if later applies go wrong.
    useStore.getState().saveRevision(currentDocumentId, 'Before AI send');
    setError(null);
    setNotice(null);
    setInput('');
    setMentions([]);
    clearPendingAttachments();

    const docSnap = useStore.getState().documents.find(
      (d) => d.id === currentDocumentId
    );

    const userMsg: ChatMessage = {
      id: uuid(),
      role: 'user',
      content: text,
      selection: includeSelection ? selection || undefined : undefined,
      ...(readyAttachments.length > 0
        ? { attachments: readyAttachments }
        : {}),
      createdAt: Date.now(),
    };
    // Persist typed prose + chips; the request clone wraps attachments
    // in the format-then-answer prompt.
    appendMessage(currentDocumentId, userMsg);
    const outboundUserMsg = withOutboundAttachmentPrompt(userMsg);

    const assistantMsg: ChatMessage = {
      id: uuid(),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
    };
    appendMessage(currentDocumentId, assistantMsg);

    const history = [...messages, outboundUserMsg, assistantMsg];
    setStreaming(true);
    window.dispatchEvent(new CustomEvent('mvp:chat-streaming', { detail: { streaming: true } }));
    abortRef.current = new AbortController();
    let acc = '';
    try {
      const packed = redactSecretsInMessages(
        buildRequestMessages(
          history,
          api.systemMessage,
          docSnap
            ? { title: docSnap.title, content: docSnap.content, id: docSnap.id }
            : null,
          api.rationaleRulesOverride,
          mentions,
          lookupDocumentById,
          // Chat messages have no per-comment bucket — pass
          // `undefined` so the cross-reference map (comment-batch
          // only) is silently dropped.
          undefined,
          false,
          api.provider === 'local-gemma' ? 'on-demand' : 'eager'
        )
      );
      if (packed.count > 0) {
        setNotice(
          `Redacted ${packed.count} secret-looking string${
            packed.count === 1 ? '' : 's'
          } from this send.`
        );
      }
      // Debug Mode: remember the prompt size that actually went out.
      setLastSentTokens(estimateMessageTokens(packed.messages));
      await streamAssistantReply(packed.messages, api, {
        signal: abortRef.current.signal,
        onDelta: (delta) => {
          acc += delta;
          updateLastAssistant(currentDocumentId, acc);
        },
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        // user cancelled
      } else if (e instanceof ApiError) {
        setError(e.message);
      } else {
        setError((e as Error).message || 'Unknown error');
      }
    } finally {
      setStreaming(false);
      window.dispatchEvent(new CustomEvent('mvp:chat-streaming', { detail: { streaming: false } }));
      abortRef.current = null;
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleSendSelection = () => {
    if (!selection) return;
    setInput((prev) => (prev ? `${prev}\n\n${selection}` : selection));
  };

  // Stage a rejection-with-feedback for a given assistant message. If the
  // same (editId, comment, mentions) tuple is already staged (e.g. the
  // user double-clicked the button) we keep just one entry.
  const stageReject = (
    messageId: string,
    info: { editId: string; comment: string; mentions: MentionToken[] }
  ) => {
    // Reject if there is no comment prose AND no @-references. A card
    // that only has an @-reference (no plain text) is still a valid
    // rejection — the referenced doc IS the rejection's substance.
    const trimmed = info.comment.trim();
    if (!trimmed && info.mentions.length === 0) return;
    setStagedRejections((prev) => {
      const existing = prev[messageId] ?? [];
      // Dedup by (editId, comment, mentions-by-id). Two cards with
      // the same text + same @-refs collapse to one entry.
      const sameMentions = (a: MentionToken[], b: MentionToken[]) => {
        if (a.length !== b.length) return false;
        const ids = new Set(a.map((m) => m.id));
        return b.every((m) => ids.has(m.id));
      };
      const dup = existing.some(
        (e) =>
          e.editId === info.editId &&
          e.comment === info.comment &&
          sameMentions(e.mentions, info.mentions)
      );
      if (dup) return prev;
      return {
        ...prev,
        [messageId]: [
          ...existing,
          { editId: info.editId, comment: info.comment, mentions: info.mentions },
        ],
      };
    });
  };

  // Send all staged rejections for a message as a single user turn, then
  // drop the staged entries. Cards react to the cleared staged map and
  // commit themselves out of view (the parent flips their status).
  const commitStagedRejections = (messageId: string) => {
    const items = stagedRejections[messageId] ?? [];
    if (!items.length || !currentDocumentId) return;
    const body = formatRejectionBatch(items);
    if (!body) {
      setStagedRejections((prev) => {
        const next = { ...prev };
        delete next[messageId];
        return next;
      });
      return;
    }
    // Gather @-document references attached to each rejection. The
    // body of the user message has the sentinels stripped by
    // `formatRejectionBatch`, so the references have to be conveyed
    // separately via `referencedDocuments` in the prompt builder.
    const seen = new Set<string>();
    const mergedMentions: MentionToken[] = [];
    for (const it of items) {
      for (const m of it.mentions) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        mergedMentions.push(m);
      }
    }
    const userMsg: ChatMessage = {
      id: uuid(),
      role: 'user',
      content: body,
      createdAt: Date.now(),
    };
    appendMessage(currentDocumentId, userMsg);
    // Mark the affected edit ids as committed so the corresponding cards
    // hide themselves immediately (the staged map is also cleared below,
    // but a card that already flipped to `committed` returns null first
    // and avoids a one-frame "staged → present → gone" flicker).
    setCommittedRejections((prev) => {
      const existing = prev[messageId] ?? {};
      const added: Record<string, true> = {};
      for (const it of items) added[it.editId] = true;
      return { ...prev, [messageId]: { ...existing, ...added } };
    });
    setStagedRejections((prev) => {
      const next = { ...prev };
      delete next[messageId];
      return next;
    });
    // Trigger an AI response by feeding the message we just appended
    // through the existing send pipeline. The simplest path is to ask the
    // store for the updated messages and run the same flow as handleSend
    // (minus the textarea). We replicate the stream setup here rather
    // than reshare code, since handleSend is tied to the local `input`
    // state. The rejection-card mentions are forwarded as
    // `extraMentions` so the prompt builder emits a `sys-referenced-doc-N`
    // message for each referenced document.
    void runAssistantReplyAfterCommit(mergedMentions);
  };

  const clearStagedRejections = (messageId: string) => {
    setStagedRejections((prev) => {
      if (!prev[messageId]) return prev;
      const next = { ...prev };
      delete next[messageId];
      return next;
    });
  };

  // Bulk-apply every anchorable ProposedEdit in an assistant message in
  // one document update (Exact → Best Effort waterfall). Skips edits
  // that cannot be anchored — those keep their mismatch banner and the
  // user can still use Highlight Apply manually.
  const applyAllForMessage = (messageId: string) => {
    // Doc-switch safety: re-read the current doc id at click time so a
    // stale closure can't write to the wrong document.
    const liveDocId = useStore.getState().currentDocumentId;
    if (!liveDocId) return;
    const doc = useStore.getState().documents.find((d) => d.id === liveDocId);
    if (!doc) return;
    const msg = (useStore.getState().chats[liveDocId] ?? []).find(
      (m) => m.id === messageId && m.role === 'assistant'
    );
    if (!msg) return;
    const segments = parseProposedEdits(msg.content);
    const edits: ProposedEdit[] = [];
    for (const seg of segments) {
      if (seg.kind === 'edit') edits.push(seg.payload);
    }
    if (edits.length === 0) return;
    const { next, appliedIds, appliedAnchors } = applyAllEdits(
      doc.content,
      edits
    );
    if (appliedIds.length === 0) return;
    // Snapshot pre-apply content before the bulk write so Apply All
    // is reversible via Revision history (same path as Snapshot now).
    useStore.getState().saveRevision(doc.id, 'Before Apply All');
    useStore.getState().updateDocumentContent(doc.id, next);
    // Record each adopted edit as a rationale on the comment that
    // produced it. The store resolves the comment via anchor/sent-
    // round overlap so we don't need to track which comment belongs
    // to which edit here. Each per-edit `appliedAnchors` entry
    // carries the exact byte range that was replaced, which we
    // forward to the store so the comment re-anchors to the
    // ADOPTED text rather than the original (preventing the
    // highlight from drifting to a wider span on the next
    // re-anchor pass).
    const recordApplied = useStore.getState().recordAppliedEdit;
    const appliedSet = new Set(appliedIds);
    const appliedAt = Date.now();
    const anchorById = new Map(appliedAnchors.map((a) => [a.id, a]));
    let lastRange: { start: number; end: number } | null = null;
    for (const edit of edits) {
      if (!appliedSet.has(edit.id)) continue;
      const anchor = anchorById.get(edit.id);
      const newAnchor = anchor
        ? {
            start: anchor.idx,
            end: anchor.idx + anchor.replacement.length,
          }
        : undefined;
      if (newAnchor) lastRange = newAnchor;
      recordApplied({
        documentId: doc.id,
        messageId,
        editId: edit.id,
        summary: edit.summary,
        rationale: edit.rationale ?? '',
        original: edit.original,
        replacement: edit.replacement,
        appliedAt,
        ...(newAnchor ? { newAnchor } : {}),
      });
    }
    if (lastRange) {
      window.dispatchEvent(
        new CustomEvent('mvp:select-range', {
          detail: lastRange,
        })
      );
    }
    // Mark applied ids as committed so the cards hide without flicker,
    // mirroring the existing staged-rejection commit pattern.
    setCommittedRejections((prev) => {
      const existing = prev[messageId] ?? {};
      const added: Record<string, true> = {};
      for (const id of appliedIds) added[id] = true;
      return { ...prev, [messageId]: { ...existing, ...added } };
    });
    setApplyAllSummary((prev) => ({
      ...prev,
      [messageId]: {
        applied: appliedIds.length,
        total: edits.length,
        at: appliedAt,
      },
    }));
  };

  const clearApplyAllSummary = (messageId: string) => {
    setApplyAllSummary((prev) => {
      if (!prev[messageId]) return prev;
      const next = { ...prev };
      delete next[messageId];
      return next;
    });
  };

  // Stream a follow-up assistant reply after the user has submitted
  // a batched message (rejection comments OR a comment-batch send from
  // the editor's CommentTray). Mirrors the streaming logic in
  // handleSend but is keyed off an already-appended user message
  // instead of the textarea contents. Returns when the stream ends;
  // errors are surfaced via the same `error` state.
  //
  // The user message is NOT passed in: the caller has already appended
  // it to the store, so the history snapshot below already contains
  // it. Re-adding it would send the body to the model twice.
  //
  // `extraMentions` lets the caller attach @-document references
  // gathered from comment rounds that have their own mentions.
  // Defaults to the current chat-panel `mentions` so the regular
  // `handleSend` path (which already passed mentions to its own
  // `streamChatCompletion` call) is unchanged.
  const runAssistantReplyAfterCommit = async (
    extraMentions?: MentionToken[]
  ) => {
    if (!currentDocumentId) return;
    const docSnap = useStore.getState().documents.find(
      (d) => d.id === currentDocumentId
    );
    // The caller has ALREADY appended the user message to the store,
    // so the snapshot below already contains it. Append only the
    // assistant placeholder — adding the user message again would send
    // the body twice and double the prompt size.
    const historyFromStore = useStore.getState().chats[currentDocumentId] ?? [];
    const assistantMsg: ChatMessage = {
      id: uuid(),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
    };
    appendMessage(currentDocumentId, assistantMsg);
    const history = [...historyFromStore, assistantMsg];
    const effectiveMentions = extraMentions ?? mentions;
    setStreaming(true);
    setError(null);
    window.dispatchEvent(new CustomEvent('mvp:chat-streaming', { detail: { streaming: true } }));
    abortRef.current = new AbortController();
    let acc = '';
    try {
      const packed = redactSecretsInMessages(
        buildRequestMessages(
          history,
          api.systemMessage,
          docSnap
            ? { title: docSnap.title, content: docSnap.content, id: docSnap.id }
            : null,
          api.rationaleRulesOverride,
          effectiveMentions,
          lookupDocumentById,
          // The staged-rejection path has no per-comment grouping
          // by design (one rejection body covers many edits in a
          // single user message). Drop the cross-reference map.
          undefined,
          false,
          api.provider === 'local-gemma' ? 'on-demand' : 'eager'
        )
      );
      if (packed.count > 0) {
        setNotice(
          `Redacted ${packed.count} secret-looking string${
            packed.count === 1 ? '' : 's'
          } from this send.`
        );
      }
      // Debug Mode: remember the prompt size that actually went out.
      setLastSentTokens(estimateMessageTokens(packed.messages));
      await streamAssistantReply(packed.messages, api, {
        signal: abortRef.current.signal,
        onDelta: (delta) => {
          acc += delta;
          updateLastAssistant(currentDocumentId, acc);
        },
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        // user cancelled
      } else if (e instanceof ApiError) {
        setError(e.message);
      } else {
        setError((e as Error).message || 'Unknown error');
      }
    } finally {
      setStreaming(false);
      window.dispatchEvent(new CustomEvent('mvp:chat-streaming', { detail: { streaming: false } }));
      abortRef.current = null;
    }
  };

  const closeChat = () => {
    setChatCollapsed(true);
    setChatOpen(false);
  };

  const aside = (
      <aside
        className="h-full border-l border-paper-hairline dark:border-cyber-border flex flex-col bg-paper-panel dark:bg-ape-panel"
        style={{ width: '100%' }}
      >
      {historyOpen && currentDocumentId && (
        <ChatHistory
          documentId={currentDocumentId}
          onClose={() => setHistoryOpen(false)}
        />
      )}
      <div className="px-3 py-2 border-b border-paper-hairline dark:border-cyber-border flex items-center flex-wrap gap-2 bg-paper-elevated/50 dark:bg-ape-elevated/40 pt-[max(0.5rem,env(safe-area-inset-top))] max-md:pt-2">
        <button
          type="button"
          className="text-[15px] font-medium text-paper-ink dark:text-cyber-primary flex items-center gap-1 min-w-0"
          onClick={() => setMessagesCollapsed((v) => !v)}
          aria-expanded={!messagesCollapsed}
          title={
            messagesCollapsed
              ? 'Show conversation'
              : 'Hide conversation (keep the input)'
          }
        >
          <span aria-hidden className="font-mono text-xs w-3 shrink-0">
            {messagesCollapsed ? '+' : '−'}
          </span>
          <span>Chat</span>
        </button>
        <span className="text-xs text-paper-inkSoft dark:text-cyber-muted font-mono truncate">
          {isKeyless ? 'local-gemma' : api.model}
        </span>
        <div className="flex-1" />
        {!messagesCollapsed && turns.length > 1 && (
          <button
            type="button"
            className="text-xs text-paper-inkSoft dark:text-cyber-muted hover:text-cyber-clay dark:hover:text-cyber-cyan transition-colors"
            onClick={() => {
              const latestOpen = latestTurnId
                ? { [latestTurnId]: true }
                : {};
              const allOpen = Object.fromEntries(
                turns.map((t) => [t.id, true])
              );
              const allExpanded = turns.every((t) => isTurnExpanded(t.id));
              setTurnExpanded(allExpanded ? latestOpen : allOpen);
            }}
            title="Expand every turn, or collapse all but the latest"
          >
            {turns.every((t) => isTurnExpanded(t.id))
              ? 'Collapse older'
              : 'Expand all'}
          </button>
        )}
        <button
          type="button"
          className="text-xs text-paper-inkSoft dark:text-cyber-muted hover:text-cyber-clay dark:hover:text-cyber-cyan transition-colors"
          onClick={() => setHistoryOpen(true)}
          disabled={!currentDocumentId}
          title="Browse current and archived chats"
        >
          History
        </button>
        <button
          type="button"
          className="text-xs text-paper-inkSoft dark:text-cyber-muted hover:text-cyber-clay dark:hover:text-cyber-cyan transition-colors"
          onClick={() => currentDocumentId && archiveChat(currentDocumentId)}
          disabled={!messages.length}
          title="Park this conversation and start a new empty chat"
        >
          Archive
        </button>
        <button
          className="text-xs text-paper-inkSoft dark:text-cyber-muted hover:text-cyber-danger transition-colors"
          onClick={() => currentDocumentId && clearChat(currentDocumentId)}
          disabled={!messages.length}
          title="Delete the live conversation without archiving"
        >
          Clear
        </button>
        <button
          className="text-paper-inkSoft dark:text-cyber-muted hover:text-cyber-clay dark:hover:text-cyber-cyan transition-colors"
          onClick={closeChat}
          title="Close chat"
        >
          ×
        </button>
      </div>

      {/* Messages (output) area. The height is drag-resizable via the
          divider below. When `messagesHeight` is 0 (default / no
          stored value) we fall back to `flex-1` so the input area
          pins to the bottom and the messages area fills the rest of
          the panel — the same behaviour as before this feature
          existed. Once the user drags once, the explicit pixel height
          takes over and the input area below becomes whatever space
          remains. */}
      <div
        ref={scrollerRef}
        hidden={messagesCollapsed}
        className={
          messagesCollapsed
            ? 'hidden'
            : messagesHeight > 0
              ? 'overflow-y-auto p-3 space-y-3 bg-paper-base dark:bg-ape-base min-h-0 shrink-0'
              : 'flex-1 overflow-y-auto p-3 space-y-3 bg-paper-base dark:bg-ape-base min-h-0'
        }
        style={
          messagesCollapsed
            ? undefined
            : messagesHeight > 0
              ? { height: `${messagesHeight}px` }
              : undefined
        }
      >
        {!messages.length && (
          <p className="text-sm text-paper-inkSoft dark:text-cyber-muted">
            Ask anything, attach a photo or PDF with +, or highlight text in the
            editor and send a prompt from the library.
          </p>
        )}
        {turns.map((turn) => (
          <ChatTurnFrame
            key={turn.id}
            turn={turn}
            expanded={isTurnExpanded(turn.id)}
            onToggle={() =>
              setTurnExpanded((prev) => ({
                ...prev,
                [turn.id]: !isTurnExpanded(turn.id),
              }))
            }
          >
            {turn.messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                staged={stagedRejections[m.id] ?? []}
                committed={committedRejections[m.id] ?? {}}
                onStageReject={(info) => stageReject(m.id, info)}
                onCommit={() => commitStagedRejections(m.id)}
                onClearStaged={() => clearStagedRejections(m.id)}
                onApplyAll={() => applyAllForMessage(m.id)}
                applyAllSummary={applyAllSummary[m.id] ?? null}
                onClearApplyAllSummary={() => clearApplyAllSummary(m.id)}
              />
            ))}
          </ChatTurnFrame>
        ))}
        {isKeyless && !localGemmaReady && (
          <div className="rounded border border-cyber-clay/40 dark:border-cyber-cyan/40 bg-cyber-clay/5 dark:bg-cyber-cyan/10 p-3 space-y-2">
            <p className="text-xs text-paper-ink dark:text-cyber-primary font-medium">
              Local Gemma needs a one-time model download
            </p>
            <LocalGemmaControls
              compact
              onReadyChange={setLocalGemmaReady}
            />
          </div>
        )}
        {notice && (
          <div className="text-xs text-paper-inkSoft dark:text-cyber-muted bg-paper-elevated dark:bg-ape-elevated border border-paper-hairline dark:border-cyber-border rounded p-2">
            {notice}
          </div>
        )}
        {error && (
          <div className="text-xs text-cyber-danger bg-cyber-danger/10 border border-cyber-danger/40 rounded p-2 whitespace-pre-wrap">
            {error}
          </div>
        )}
      </div>
      {messagesCollapsed && (notice || error) && (
        <div className="px-3 py-2 space-y-1">
          {notice && (
            <div className="text-xs text-paper-inkSoft dark:text-cyber-muted bg-paper-elevated dark:bg-ape-elevated border border-paper-hairline dark:border-cyber-border rounded p-2">
              {notice}
            </div>
          )}
          {error && (
            <div className="text-xs text-cyber-danger bg-cyber-danger/10 border border-cyber-danger/40 rounded p-2 whitespace-pre-wrap">
              {error}
            </div>
          )}
        </div>
      )}

      {/* Draggable divider between the messages (output) area and the
          input area. Mirrors the editor's suggestion-panel handle so
          the two dividers look and feel consistent. The 8px-tall
          strip is the hit target; a 4px-wide centred pill is the
          visual affordance. Pointer-drag updates `messagesHeight`
          above; the messages div re-renders with the new height
          and the input panel below fills the remaining space. */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize chat messages area"
        aria-valuenow={messagesHeight}
        aria-valuemin={120}
        aria-valuemax={1200}
        onPointerDown={onMessagesHandleDown}
        className="relative shrink-0 h-2 cursor-ns-resize group flex items-center justify-center border-t border-paper-hairline dark:border-cyber-border bg-paper-panel dark:bg-ape-panel hover:bg-paper-elevated dark:hover:bg-ape-elevated transition-colors"
        data-chat-messages-handle
      >
        <span
          aria-hidden
          className="block w-12 h-1 rounded-full bg-paper-hairline dark:bg-cyber-border group-hover:bg-cyber-clay/60 dark:group-hover:bg-cyber-cyan/60 transition-colors"
        />
      </div>

      <div className="border-t border-paper-hairline dark:border-cyber-border p-3 space-y-2 bg-paper-panel dark:bg-ape-panel">
        <div className="flex items-center gap-2 text-xs text-paper-inkSoft dark:text-cyber-muted flex-wrap">
          <label className="flex items-center gap-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeSelection}
              onChange={(e) => setIncludeSelection(e.target.checked)}
              className="accent-cyber-clay dark:accent-cyber-cyan"
            />
            include selection
          </label>
          {selection && (
            <button
              className="px-1.5 py-0.5 rounded border border-cyber-clay/40 dark:border-cyber-cyan/40 text-cyber-clay dark:text-cyber-cyan hover:bg-cyber-clay/5 dark:hover:bg-cyber-cyan/10 transition-colors"
              onClick={handleSendSelection}
              title="Paste the selection into the input"
            >
              paste selection ({selection.length})
            </button>
          )}
        </div>
        <input
          ref={attachInputRef}
          type="file"
          accept={IMPORT_FILE_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => void onAttachFiles(e)}
        />
        <div className="rounded border border-paper-hairline dark:border-cyber-border bg-paper-surface dark:bg-ape-base focus-within:border-cyber-clay dark:focus-within:border-cyber-cyan flex flex-col min-w-0">
          {pendingAttachments.length > 0 && (
            <div className="px-2 pt-2">
              <ChatAttachmentChips
                items={pendingAttachments}
                onRemove={removePendingAttachment}
              />
            </div>
          )}
          <MentionInput
            value={input}
            onChange={(v) => {
              setInput(v.text);
              setMentions(v.mentions);
            }}
            onSubmit={() => void handleSend()}
            ariaLabel="Chat message"
            placeholder={
              isKeyless
                ? 'Ask Local Gemma, or ⌘/Ctrl+Enter to send… type @ to reference a document'
                : 'Ask, or ⌘/Ctrl+Enter to send… type @ to reference a document'
            }
            containerClassName="min-w-0"
            className="w-full h-24 px-2.5 py-2 text-sm resize-none font-sans bg-transparent border-0 outline-none shadow-none focus:outline-none focus:ring-0 text-paper-ink dark:text-paper-base placeholder:text-paper-inkSoft dark:placeholder:text-cyber-muted"
          />
          <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-t border-paper-hairline dark:border-cyber-border">
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded text-lg leading-none font-medium text-paper-inkSoft dark:text-cyber-muted hover:text-cyber-clay dark:hover:text-cyber-cyan hover:bg-paper-elevated dark:hover:bg-ape-elevated transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Attach photos or PDFs"
              title={
                ocrBusy
                  ? 'Reading file…'
                  : 'Attach photos or PDFs (same types as Import). Sent with this message.'
              }
              disabled={!currentDocumentId || streaming || ocrBusy}
              onClick={() => attachInputRef.current?.click()}
            >
              {ocrBusy ? (
                <span className="inline-flex gap-0.5">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-current opacity-50 animate-pulse" style={{ animationDelay: '0ms' }} />
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-current opacity-50 animate-pulse" style={{ animationDelay: '150ms' }} />
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-current opacity-50 animate-pulse" style={{ animationDelay: '300ms' }} />
                </span>
              ) : (
                <span aria-hidden>+</span>
              )}
            </button>
            {streaming ? (
              <button
                className="text-sm px-3 py-1.5 rounded bg-cyber-danger text-white font-semibold hover:bg-cyber-danger/80 transition-colors"
                onClick={handleStop}
              >
                Stop
              </button>
            ) : (
              <button
                className="btn-fire-sm"
                onClick={handleSend}
                disabled={
                  !currentDocumentId ||
                  ocrBusy ||
                  (!input.trim() &&
                    !pendingAttachments.some(
                      (a) => !a.reading && a.extractedText.trim()
                    ))
                }
                title={
                  isKeyless
                    ? 'Runs Gemma locally in this browser (WebGPU)'
                    : undefined
                }
              >
                Send
              </button>
            )}
            {/* Debug Mode: estimated tokens for the next send, measured
                against the Local Model's budget so the user can tell
                whether a full reply will fit. */}
            {debugMode && (
              <>
                <TokenCounter
                  tokens={previewTokens}
                  budget={isKeyless ? LOCAL_MAX_NUM_TOKENS : undefined}
                  reserve={isKeyless ? LOCAL_MAX_OUTPUT_TOKENS : undefined}
                  label="this chat send"
                />
                {lastSentTokens > 0 && (
                  <span
                    className="text-[11px] font-mono text-paper-inkSoft dark:text-cyber-muted whitespace-nowrap select-none"
                    title={`The previous send used about ${lastSentTokens} tokens of prompt.`}
                  >
                    sent ~{lastSentTokens.toLocaleString('en-US')}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      </aside>
  );

  // Narrow: full-screen overlay over the editor (not a peer column).
  if (isNarrow) {
    return (
      <div className="fixed inset-0 z-40 flex justify-end">
        <button
          type="button"
          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          aria-label="Close chat"
          onClick={closeChat}
        />
        <div
          ref={containerRef}
          className="relative z-10 h-full w-full max-w-lg shadow-ape-paper-lift dark:shadow-2xl pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]"
          role="dialog"
          aria-modal="true"
          aria-label="Chat"
        >
          {aside}
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative shrink-0" style={{ width: chatWidth }}>
      <ResizeHandle handle="left" onPointerDown={(e) => start('left', e)} />
      {aside}
    </div>
  );
}

function MessageBubble({
  message,
  staged,
  committed,
  onStageReject,
  onCommit,
  onClearStaged,
  onApplyAll,
  applyAllSummary,
  onClearApplyAllSummary,
}: {
  message: ChatMessage;
  staged: Array<{ editId: string; comment: string; mentions: MentionToken[] }>;
  committed: Record<string, true>;
  onStageReject: (info: {
    editId: string;
    comment: string;
    mentions: MentionToken[];
  }) => void;
  onCommit: () => void;
  onClearStaged: () => void;
  onApplyAll: () => void;
  applyAllSummary: { applied: number; total: number; at: number } | null;
  onClearApplyAllSummary: () => void;
}) {
  const isUser = message.role === 'user';
  const currentDocumentId = useStore((s) => s.currentDocumentId);

  // Count ProposedEdit segments in this assistant message and how many
  // of them are still unapplied (i.e. not already in the `committed`
  // map). The footer shows the "Apply N change(s)" button only when
  // there is at least one unapplied edit.
  const { totalEdits, unappliedEdits } = useMemo(() => {
    if (isUser) return { totalEdits: 0, unappliedEdits: 0 };
    const segments = parseProposedEdits(message.content);
    let total = 0;
    let unapplied = 0;
    for (const seg of segments) {
      if (seg.kind !== 'edit') continue;
      total++;
      if (!committed[seg.payload.id]) unapplied++;
    }
    return { totalEdits: total, unappliedEdits: unapplied };
  }, [isUser, message.content, committed]);

  // Auto-clear the "Applied X of Y" summary after a short delay so it
  // fades out without the user having to dismiss it. The effect is
  // keyed on `applyAllSummary?.at` so re-applying restarts the timer.
  useEffect(() => {
    if (!applyAllSummary) return;
    const t = window.setTimeout(onClearApplyAllSummary, 4000);
    return () => window.clearTimeout(t);
  }, [applyAllSummary, onClearApplyAllSummary]);

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[min(85%,calc(100vw-2rem))] rounded-lg px-3 py-2 text-sm ${
          isUser
            ? 'bg-cyber-clay text-paper-base dark:bg-ape-fire dark:text-white font-medium border border-cyber-clay/40 dark:border-cyber-fire/40 dark:shadow-ape-fire-soft'
            : 'bg-paper-elevated text-paper-ink dark:bg-ape-elevated dark:text-cyber-primary border border-paper-hairline dark:border-cyber-border'
        }`}
      >
        {message.selection && isUser && (
          <div className="mb-1 text-[10px] uppercase tracking-wide text-paper-base/70 dark:text-white/80 font-mono">
            ▸ selection ({message.selection.length} chars)
          </div>
        )}
        {isUser && message.attachments && message.attachments.length > 0 && (
          <ChatAttachmentChips items={message.attachments} tone="bubble" />
        )}
        {isUser ? (
          message.content ? (
            <div className="whitespace-pre-wrap">{message.content}</div>
          ) : message.attachments?.length ? null : (
            <div className="whitespace-pre-wrap opacity-70">(empty)</div>
          )
        ) : (
          <>
            <AssistantContent
              content={message.content}
              docId={currentDocumentId}
              messageId={message.id}
              staged={staged}
              committed={committed}
              onStageReject={onStageReject}
            />
            {(staged.length > 0 || unappliedEdits > 0 || applyAllSummary) && (
              <div className="mt-2 -mx-1 rounded border border-paper-hairline dark:border-cyber-border bg-paper-base/50 dark:bg-ape-base/40 p-2 space-y-1.5">
                {unappliedEdits > 0 && (
                  <div className="flex items-center gap-2 max-[420px]:flex-col max-[420px]:items-stretch">
                    <span className="text-xs text-paper-inkSoft dark:text-cyber-muted flex-1">
                      {totalEdits === 1
                        ? '1 proposed change in this reply.'
                        : `${totalEdits} proposed changes in this reply.`}
                    </span>
                    <button
                      type="button"
                      className="btn-fire-sm"
                      onClick={onApplyAll}
                      title="Apply every change whose original text is found in the current document (one document update). Edits that cannot be anchored are skipped."
                    >
                      Apply {unappliedEdits}{' '}
                      {unappliedEdits === 1 ? 'change' : 'changes'}
                    </button>
                  </div>
                )}
                {staged.length > 0 && (
                  <div className="flex items-center gap-2 rounded border border-cyber-clay/40 dark:border-cyber-cyan/50 bg-cyber-clay/5 dark:bg-cyber-cyan/10 p-1.5">
                    <span className="text-xs text-cyber-clay dark:text-cyber-cyan flex-1">
                      {staged.length === 1
                        ? '1 rejection comment staged.'
                        : `${staged.length} rejection comments staged.`}
                    </span>
                    <button
                      type="button"
                      className="btn-fire-sm"
                      onClick={onCommit}
                      title="Append all staged rejection comments to the chat and ask the AI to revise"
                    >
                      Send {staged.length} rejection{' '}
                      {staged.length === 1 ? 'comment' : 'comments'}
                    </button>
                    <button
                      type="button"
                      className="btn-cyan-sm"
                      onClick={onClearStaged}
                      title="Discard all staged rejection comments"
                    >
                      Clear staged
                    </button>
                  </div>
                )}
                {applyAllSummary && (
                  <div
                    className="text-[11px] text-paper-inkSoft dark:text-cyber-muted"
                    role="status"
                    aria-live="polite"
                  >
                    {applyAllSummary.applied === applyAllSummary.total
                      ? `Applied all ${applyAllSummary.total} change${
                          applyAllSummary.total === 1 ? '' : 's'
                        }.`
                      : `Applied ${applyAllSummary.applied} of ${
                          applyAllSummary.total
                        } changes (${
                          applyAllSummary.total - applyAllSummary.applied
                        } skipped — not anchored). Use Highlight Apply on those cards.`}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function AssistantContent({
  content,
  docId,
  messageId,
  staged,
  committed,
  onStageReject,
}: {
  content: string;
  docId: string | null;
  messageId: string;
  staged: Array<{ editId: string; comment: string; mentions: MentionToken[] }>;
  committed: Record<string, true>;
  onStageReject: (info: {
    editId: string;
    comment: string;
    mentions: MentionToken[];
  }) => void;
}) {
  if (!content) {
    return <span className="opacity-60">thinking…</span>;
  }
  const segments = parseProposedEdits(content);
  const docIdForCard = docId ?? '';
  return (
    <div className="space-y-2">
      {segments.map((seg, i) => {
        if (seg.kind === 'text') {
          if (!seg.payload.trim()) return null;
          return (
            <div key={i} className="prose-md">
              <ReactMarkdown
                remarkPlugins={remarkPlugins}
                rehypePlugins={rehypePlugins}
              >
                {seg.payload}
              </ReactMarkdown>
            </div>
          );
        }
        return (
          <ProposedEditCard
            key={`${messageId}-${seg.payload.id}-${i}`}
            edit={seg.payload}
            docId={docIdForCard}
            messageId={messageId}
            staged={staged.some((s) => s.editId === seg.payload.id)}
            committed={!!committed[seg.payload.id]}
            onStageReject={onStageReject}
          />
        );
      })}
    </div>
  );
}

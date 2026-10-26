// Shared store types. Value re-exports such as `DEFAULT_SYSTEM_MESSAGE`
// live on the `useStore` barrel so historical
// `import { DEFAULT_SYSTEM_MESSAGE } from '@/store/useStore'` calls
// keep resolving; this file is types only.

import type {
  ApiConfig,
  ArchivedChat,
  ChatMessage,
  Comment,
  CommentOp,
  CommentRound,
  DocumentRecord,
  MentionToken,
  Prompt,
  Revision,
  Theme,
} from '@/types';

/** Per-document editor focus + caret state (kept in the store, not persisted). */
export interface EditorFocusState {
  /** Whether the editor textarea currently has focus for this doc. */
  focused: boolean;
  /**
   * Current textarea caret / selection range for this doc. Both fields
   * are -1 until the user has clicked/typed in the editor at least once.
   */
  selectionStart: number;
  selectionEnd: number;
}

/**
 * Temporary highlight of a proposed-edit's matched Original span in the
 * Write / Preview / Split panes. Not persisted — cleared when the card
 * unmounts or the anchor disappears.
 */
export interface ProposedEditHighlight {
  /** `${messageId}:${editId}` so multiple cards don't clobber each other. */
  cardKey: string;
  start: number;
  end: number;
}

export interface StoreState {
  // Documents
  documents: DocumentRecord[];
  currentDocumentId: string | null;

  // Per-document chat histories, keyed by documentId.
  chats: Record<string, ChatMessage[]>;

  /**
   * Parked conversations per document. Live sends use `chats` only;
   * these threads stay out of the model prompt until restored.
   */
  chatArchives: Record<string, ArchivedChat[]>;

  // Revisions keyed by documentId, newest last.
  revisions: Record<string, Revision[]>;

  // Saved prompts (user library).
  prompts: Prompt[];

  // Editor view mode: write (textarea), preview, split, or graph.
  viewMode: 'write' | 'preview' | 'split' | 'graph';

  // Editor font size in pixels (applies to both the textarea and the
  // prose preview). Step is 1px; range is [10, 24]. Persisted.
  editorFontSize: number;

  // Global UI font size in pixels. Applied to <html> as the base font
  // size, so every `rem`-based Tailwind text utility (text-xs, text-sm,
  // text-[11px], etc.) scales uniformly. The editor is excluded because
  // its own subtree sets an explicit font-size on its root. Step is 1px;
  // range is [12, 20]. Persisted.
  uiFontSize: number;

  // Whether the chat panel is open.
  chatOpen: boolean;

  // Whether the sidebar is collapsed (hidden but still toggleable via anchor).
  sidebarCollapsed: boolean;

  // Whether the chat panel is collapsed (hidden but still toggleable via anchor).
  // chatCollapsed is a separate flag from chatOpen so we can keep the
  // "floating reopen" behaviour distinct from the deliberate "I want to
  // hide this for the rest of the session" collapse. By default we treat
  // chatOpen === !chatCollapsed, but the user can collapse while open.
  chatCollapsed: boolean;

  // Whether the top bar is collapsed (hidden but still toggleable via anchor).
  topbarCollapsed: boolean;

  // Whether to include the current selection with each chat message.
  includeSelection: boolean;
  /**
   * When true, Chat omits the document outline and sends only the
   * highlighted selection as working text. Requires a non-empty
   * selection. Persisted.
   */
  sendSelectionOnly: boolean;
  /**
   * When false, the API key is kept in memory + sessionStorage and
   * stripped from the persisted localStorage blob so closing the tab
   * forgets it. Default true (key lives in localStorage).
   */
  persistApiKey: boolean;

  // Whether to show developer-style diagnostics in the UI:
  //   - the inline-completion status pill (idle / thinking / ready)
  //     in the editor toolbar, and
  //   - the inline-completion request/accept counters next to it.
  // The underlying inline-completion state machine keeps running
  // even when this flag is off, so toggling it only changes which
  // diagnostic UI is visible — it never pauses or restarts the
  // feature. Defaults to off so the toolbar stays minimal for
  // end users.
  debugMode: boolean;

  // Settings
  theme: Theme;
  api: ApiConfig;

  // Layout sizes (persisted).
  layout: {
    sidebarWidth: number;
    chatWidth: number;
    /** Left-pane width as % of the editor Split row (Graph takes the rest). */
    editorSplitPct: number;
    /**
     * Which content the left pane shows in Split mode. Right pane is
     * always Graph. Standalone Write / Preview viewModes are unchanged.
     */
    splitLeftMode: 'write' | 'preview';
    previewSizes: Record<string, { w: number; h: number }>;
  };

  /**
   * Per-document editor focus + caret state. Updated by `Editor.tsx` on
   * focus / blur / select / keyup so the ProposedEditCard can decide
   * whether Highlight Apply is available. Not persisted.
   */
  editorFocus: Record<string, EditorFocusState>;

  /**
   * Per-document temporary proposed-edit highlights (Write/Preview/Split).
   * Keyed by documentId; each entry is the set of active card ranges.
   * Not persisted.
   */
  proposedEditHighlights: Record<string, ProposedEditHighlight[]>;

  /**
   * Per-document inline comments, keyed by documentId. Each entry is a
   * list ordered by `(start, end)` position in the document — the
   * comment margin re-numbers badges by document order on every render
   * rather than by creation order, so the ordering here is canonical
   * and the comment component sorts before assigning badge numbers.
   *
   * Persisted.
   */
  comments: Record<string, Comment[]>;

  /**
   * Per-session undo stack for comment operations (add / update-body /
   * delete). Capped at `COMMENT_UNDO_STACK_LIMIT` entries —
   * older entries are dropped FIFO. Not persisted (a fresh reload
   * starts with an empty stack by design).
   */
  commentUndoStack: CommentOp[];

  // Actions
  createDocument: (title?: string) => string;
  renameDocument: (id: string, title: string) => void;
  deleteDocument: (id: string) => void;
  setCurrentDocument: (id: string | null) => void;
  updateDocumentContent: (id: string, content: string) => void;

  /**
   * Apply one resolved ImportPlan to the store. Built alongside the
   * Import-backup feature in `FileActionsButton.tsx`; the UI computes
   * plans via `resolveImportDecisions` and feeds them in, one at a
   * time. `strategy` is the per-document user choice; see
   * `src/utils/backup.ts` for the three options and their semantics.
   *
   * Returns the **final** id the document lives under, or `null`
   * when the plan was `'skip'`. The caller uses this to call
   * `setCurrentDocument` for auto-selection.
   */
  applyImportPlan: (plan: ImportPlan) => { importedId: string | null };

  saveRevision: (documentId: string, label?: string) => void;
  deleteRevision: (documentId: string, revisionId: string) => void;
  restoreRevision: (documentId: string, revisionId: string) => void;

  appendMessage: (documentId: string, msg: ChatMessage) => void;
  updateLastAssistant: (documentId: string, content: string) => void;
  clearChat: (documentId: string) => void;
  /**
   * Move the live thread into `chatArchives` (newest first) and empty
   * `chats[documentId]`. No-op when the live thread is empty.
   */
  archiveChat: (documentId: string) => void;
  /**
   * Park live messages whose `createdAt` is at or before
   * `now - olderThanMs`. Newer messages stay live. No-op when nothing
   * qualifies.
   */
  archiveOldChat: (documentId: string, olderThanMs: number) => void;
  /**
   * Load an archived thread as the live chat. If the live thread is
   * non-empty it is archived first. Removes the restored row.
   */
  restoreArchivedChat: (documentId: string, archiveId: string) => void;
  /** Drop one archived thread. */
  deleteArchivedChat: (documentId: string, archiveId: string) => void;

  addPrompt: (name: string, body: string) => void;
  updatePrompt: (id: string, patch: Partial<Omit<Prompt, 'id'>>) => void;
  deletePrompt: (id: string) => void;

  setViewMode: (mode: StoreState['viewMode']) => void;
  bumpEditorFontSize: (delta: number) => void;
  setUiFontSize: (size: number) => void;
  setChatOpen: (open: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setChatCollapsed: (collapsed: boolean) => void;
  setTopbarCollapsed: (collapsed: boolean) => void;
  setIncludeSelection: (v: boolean) => void;
  setSendSelectionOnly: (v: boolean) => void;
  setPersistApiKey: (v: boolean) => void;
  setDebugMode: (v: boolean) => void;
  toggleTheme: () => void;
  setApi: (patch: Partial<ApiConfig>) => void;
  setLayout: (
    patch: Partial<{
      sidebarWidth: number;
      chatWidth: number;
      editorSplitPct: number;
      splitLeftMode: 'write' | 'preview';
    }>
  ) => void;
  setPreviewSize: (
    key: string,
    patch: Partial<{ w: number; h: number }>
  ) => void;
  setEditorFocus: (
    documentId: string,
    info: { focused: boolean; selectionStart: number; selectionEnd: number }
  ) => void;

  /**
   * Upsert or clear one proposed-edit highlight for a document. Pass
   * `range: null` to remove the card's entry.
   */
  setProposedEditHighlight: (
    documentId: string,
    cardKey: string,
    range: { start: number; end: number } | null
  ) => void;

  // Comment actions. All operate on a single document and never mutate
  // the input `Comment` — each `set(...)` builds a new array so React
  // re-renders fire correctly.
  addComment: (comment: Comment) => void;
  /**
   * Update the latest round's body. Optional `mentions` replaces the
   * round's @-document references (used when the user re-edits a
   * comment via the popover's MentionInput). When omitted, existing
   * mentions on the round are preserved.
   */
  updateCommentBody: (
    id: string,
    body: string,
    mentions?: MentionToken[]
  ) => void;
  /**
   * Append a new round to an existing comment. Used when the user
   * adds a follow-up body on a revised passage (after an AI edit
   * was applied), or when the system needs to push a new round
   * for any reason. The new round is added at the end of
   * `rounds[]`; the top-level `body` / `start` / `end` / `snippet`
   * / `outdated` / `sent` convenience mirrors are updated to point
   * at the new round.
   */
  appendCommentRound: (
    id: string,
    round: Omit<CommentRound, 'id' | 'applied'>
  ) => void;
  /**
   * Record an adopted proposed edit against the comment whose
   * current round was the one the AI was responding to. The
   * `commentId` is resolved inside the action via anchor/sent-round
   * lookup, so the caller can pass either an explicit id OR leave
   * it undefined and let the action find the matching comment
   * from the most recent batch. Returns the resolved comment id,
   * or `null` if no match was found.
   */
  recordAppliedEdit: (info: {
    documentId: string;
    /** Explicit comment id, if the caller already knows it. */
    commentId?: string;
    messageId: string;
    editId: string;
    summary: string;
    rationale: string;
    original: string;
    replacement: string;
    appliedAt: number;
    /**
     * Explicit new anchor range for the adopted edit, when the
     * caller has computed it (e.g. `applyEdit` returns the match
     * position). When omitted, the store re-anchors the comment
     * by searching the *post-apply* document content for the
     * `replacement` text. Set this from `applyAllEdits` so each
     * per-edit anchor is exact.
     */
    newAnchor?: { start: number; end: number };
  }) => string | null;
  markCommentsSent: (ids: string[]) => void;
  deleteComment: (id: string) => void;
  /** Delete every outdated comment on a document (one undo step each). */
  dismissOutdatedComments: (documentId: string) => number;
  /**
   * Re-attach an outdated comment to a new editor range. Returns false
   * when the range is empty or the comment is missing.
   */
  reattachComment: (
    id: string,
    range: { start: number; end: number }
  ) => boolean;
  replaceCommentsForDocument: (documentId: string, comments: Comment[]) => void;
  undoLastCommentOp: () => CommentOp | null;
}

/**
 * One resolved ImportPlan produced by `resolveImportDecisions` in
 * `src/utils/backup.ts`. Re-exported so the store and the UI can
 * share a single type for the per-document import payload.
 *
 * The store action `applyImportPlan` performs the mutation under
 * `strategy`. The UI never writes ImportPlan-shaped objects to the
 * store directly — it always goes through this action so the
 * keep-both rename / id-reuse rules stay in one place.
 */
export interface ImportPlan {
  document: DocumentRecord;
  comments: Comment[];
  chats: ChatMessage[];
  chatArchives: ArchivedChat[];
  revisions: Revision[];
  /**
   * Final id the document will live under once the plan lands.
   * Equals the file's id for `'replace'` and `'skip'`, or a
   * freshly-minted uuid for `'keep-both'`.
   */
  resolvedId: string;
  strategy: 'replace' | 'skip' | 'keep-both';
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore, useCurrentDocument } from '@/store/useStore';
// Type-only: keep pdfjs / PaddleOCR / OpenCV out of the initial app chunk.
// The OCR module is loaded via dynamic import() when the user picks files.
import { IMPORT_FILE_ACCEPT, type OcrLang, type OcrProgress } from '@/utils/ocr';
import { formatOcrAsMarkdown } from '@/utils/ocrMarkdown';
import { downloadTextFile, sanitizeFilename } from '@/utils/storage';
import { scrubLiveSecretFromExport } from '@/utils/secrets';
import {
  buildDocumentBackup,
  serialiseDocumentBackup,
  parseDocumentBackup,
  resolveImportDecisions,
  BACKUP_MAX_FILE_BYTES,
  BackupParseError,
  type ParsedDocumentBackup,
  type ImportDecision,
} from '@/utils/backup';
import type { ImportPlan } from '@/store/types';

const VIEWPORT_PAD = 8;
const POPOVER_WIDTH = 288; // Tailwind w-72

/**
 * Pin a popover to the viewport so a left-side (or wrapped) Import
 * button cannot shove it off-screen on a narrow/vertical layout.
 * Uses `fixed` coordinates measured from the toggle button.
 */
function clampPopoverToViewport(panel: HTMLElement, anchor: HTMLElement) {
  const pad = VIEWPORT_PAD;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxW = Math.min(POPOVER_WIDTH, Math.max(0, vw - pad * 2));
  panel.style.width = `${maxW}px`;
  panel.style.maxWidth = `${Math.max(0, vw - pad * 2)}px`;
  panel.style.maxHeight = `${Math.max(0, vh - pad * 2)}px`;
  panel.style.overflowY = 'auto';

  const ar = anchor.getBoundingClientRect();
  // Prefer right-aligning to the button (desktop toolbar), then clamp
  // so both edges stay on screen.
  let left = ar.right - maxW;
  if (left < pad) left = pad;
  if (left + maxW > vw - pad) left = Math.max(pad, vw - pad - maxW);

  let top = ar.bottom + 4;
  const h = panel.offsetHeight;
  if (top + h > vh - pad) {
    const above = ar.top - 4 - h;
    top = above >= pad ? above : Math.max(pad, vh - pad - h);
  }

  panel.style.position = 'fixed';
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.right = 'auto';
  panel.style.marginTop = '0';
}

type Lang = OcrLang;

const LANG_OPTIONS: { code: Lang; label: string }[] = [
  { code: 'eng', label: 'English' },
  { code: 'chi_sim', label: 'Simplified Chinese' },
  { code: 'chi_tra', label: 'Traditional Chinese' },
];

interface ImportMediaButtonProps {
  /** Disabled when no document is open. */
  disabled?: boolean;
}

/**
 * Toolbar button that opens a popover with two file actions for the
 * current document:
 *   1. **Import** photos or PDFs — pick one or more files, the OCR
 *      pipeline runs locally, the extracted text is rewritten as
 *      reader-friendly Markdown by your configured chat model, then
 *      inserted into the editor via a `mvp:insert-text` event. The
 *      language picker is the three checkboxes (English, Simplified
 *      Chinese, Traditional Chinese); at least one must stay checked.
 *   2. **Export** the current document as Markdown — the only durable
 *      off-tab backup of your writing today. Filename is the document
 *      title, sanitised; defaults to `untitled.md`.
 *
 * The toolbar icon (a page with up + down arrows) intentionally reads
 * as both directions rather than picking one; the toggle's
 * `aria-label` and `title` mention Import first because that's the
 * primary identity of the button, but Export is always visible inside
 * the popover too.
 *
 * Cleanup: after every OCR batch the file input is reset to '' so the
 * same files can be re-picked without a refresh. The OCR util itself
 * handles revoking ObjectURLs, releasing canvases, and terminating the
 * worker.
 */
export function FileActionsButton({ disabled = false }: ImportMediaButtonProps) {
  const api = useStore((s) => s.api);
  const currentDoc = useCurrentDocument();
  // Pulled from the store for the JSON backup export. Independent
  // selectors so a typing keystroke in the editor does not re-render
  // this button, but each call is a shallow read — cheap.
  const documents = useStore((s) => s.documents);
  const commentsByDoc = useStore((s) => s.comments);
  const chatsByDoc = useStore((s) => s.chats);
  const chatArchivesByDoc = useStore((s) => s.chatArchives);
  const revisionsByDoc = useStore((s) => s.revisions);
  const setCurrentDocument = useStore((s) => s.setCurrentDocument);
  const applyImportPlan = useStore((s) => s.applyImportPlan);
  const inputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const importModalRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [langs, setLangs] = useState<Set<Lang>>(() => new Set(['eng']));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Import-backup flow state. Lives in the component (not the store)
   * because the modal is a transient UI concern; the store only ever
   * sees clean ImportPlan objects via `applyImportPlan`.
   *
   *   `pendingParsed` — the parsed backup awaiting user decision.
   *   `pendingChoices` — per-id user choice (Replace / Skip / Keep both);
   *     for non-colliding ids the only legal default is `'keep-both'`,
   *     and we preserve any explicit choice the user makes.
   *   The modal is open iff `pendingParsed !== null`.
   */
  const [pendingParsed, setPendingParsed] = useState<ParsedDocumentBackup | null>(
    null
  );
  const [pendingChoices, setPendingChoices] = useState<
    Record<string, 'replace' | 'skip' | 'keep-both'>
  >({});
  const panelVisible =
    open || busy || Boolean(error) || pendingParsed !== null;

  // Close the popover on outside click. While the import modal is
  // open the popover must NOT close — otherwise the modal's anchor
  // disappears behind another panel and the viewport-clamp reference
  // is gone. The modal has its own Cancel / Apply buttons so it stays
  // dismissible on its own terms.
  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      if (importModalRef.current?.contains(target)) return;
      // Also ignore clicks on the toggle button itself (which controls `open`).
      const btn = (e.target as HTMLElement | null)?.closest(
        '[data-file-actions-toggle]'
      );
      if (btn) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDocPointer);
    return () => document.removeEventListener('pointerdown', onDocPointer);
  }, [open]);

  // Reset error when popover opens.
  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  // Keep the language / progress / error panels inside the viewport
  // after wrap (mobile) or when the window is resized / scrolled.
  useLayoutEffect(() => {
    if (!panelVisible) return;
    const panel = popoverRef.current;
    const anchor = anchorRef.current;
    if (!panel || !anchor) return;
    const apply = () => clampPopoverToViewport(panel, anchor);
    apply();
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
    window.addEventListener('scroll', apply, true);
    return () => {
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
      window.removeEventListener('scroll', apply, true);
    };
  }, [panelVisible, open, busy, error]);

  // Pin the collision-resolution modal to the viewport the same way
  // the popover is, so on a narrow/vertical layout the modal never
  // spills off-screen.
  useLayoutEffect(() => {
    if (!pendingParsed) return;
    const panel = importModalRef.current;
    const anchor = anchorRef.current;
    if (!panel || !anchor) return;
    const apply = () => clampPopoverToViewport(panel, anchor);
    apply();
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
    window.addEventListener('scroll', apply, true);
    return () => {
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
      window.removeEventListener('scroll', apply, true);
    };
  }, [pendingParsed]);

  const toggleLang = (code: Lang) => {
    setLangs((prev) => {
      const next = new Set(prev);
      if (next.has(code)) {
        // Disallow clearing the last remaining language.
        if (next.size === 1) return prev;
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  };

  const onPickClick = () => {
    if (busy) return;
    if (langs.size === 0) {
      setError('Select at least one language.');
      return;
    }
    inputRef.current?.click();
  };

  /**
   * Export the current document as Markdown. Surfaces a friendly error
   * if no document is open (e.g. user reached the popover while the
   * sidebar selection was empty) — we deliberately do NOT close the
   * popover on click so the error stays visible.
   *
   * Filename is the document title, sanitised. Content is the live
   * document text — revisions / comments are intentionally out of
   * scope for this slice (see docs/UX_SLICE_1.md Item 2).
   */
  const onExportClick = () => {
    if (!currentDoc) {
      setError('Open a document first, then export.');
      return;
    }
    const base = sanitizeFilename(currentDoc.title, 'untitled');
    downloadTextFile(
      `${base}.md`,
      scrubLiveSecretFromExport(currentDoc.content, api.apiKey),
      'text/markdown;charset=utf-8'
    );
  };

  /**
   * Export the current document as a JSON backup. The payload
   * includes the document + its comments + chat history + archived
   * chats + revisions
   * in one file so a user can move a working session between
   * profiles / devices without losing context. Filename matches the
   * existing `${title}.md` pattern with a `.json` extension.
   *
   * Same UX shape as `onExportClick`: surfaces an inline error when
   * no document is open and does NOT close the popover so the error
   * stays visible. The schema is versioned
   * (`schema: 'apeditor-document-backup'`, `version: 1`) so a future
   * re-importer can detect / upgrade older backups — v0.5.3 is
   * write-only.
   */
  const onBackupClick = () => {
    if (!currentDoc) {
      setError('Open a document first, then export.');
      return;
    }
    const backup = buildDocumentBackup({
      documentId: currentDoc.id,
      documents,
      comments: commentsByDoc,
      chats: chatsByDoc,
      chatArchives: chatArchivesByDoc,
      revisions: revisionsByDoc,
      appVersion: import.meta.env.VITE_APP_VERSION ?? 'unknown',
    });
    if (!backup) return;
    const base = sanitizeFilename(currentDoc.title, 'untitled');
    downloadTextFile(
      `${base}.json`,
      scrubLiveSecretFromExport(serialiseDocumentBackup(backup), api.apiKey),
      'application/json;charset=utf-8'
    );
  };

  /**
   * Open the OS file picker filtered to `.json`. Mirrors `onPickClick`
   * for the OCR import — the actual parsing happens in
   * `onBackupFile` after the user picks a file.
   */
  const onImportBackupClick = () => {
    if (busy || pendingParsed) return;
    backupInputRef.current?.click();
  };

  /**
   * Handle the picked `.json` file:
   *   1. Reject on size (`BACKUP_MAX_FILE_BYTES`).
   *   2. Read text, run through `parseDocumentBackup`. Errors are
   *      surfaced inline as a friendly message; the popover stays
   *      open so the user can retry.
   *   3. Compute collision decisions with default `keep-both` for
   *      new ids.
   *   4. If every decision is the auto-default (no collisions, all
   *      `keep-both`), apply directly without the modal — one tap
   *      import for the clean case.
   *   5. Otherwise open the modal so the user can flip choices.
   */
  const onBackupFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > BACKUP_MAX_FILE_BYTES) {
      const limitMB = (BACKUP_MAX_FILE_BYTES / (1024 * 1024)).toFixed(0);
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      setError(
        `${file.name} is ${sizeMB} MB — limit is ${limitMB} MB. Compress it or split it before re-importing.`
      );
      e.target.value = '';
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch (err) {
      setError(
        `Could not read ${file.name}: ${(err as Error).message || 'unknown error'}`
      );
      e.target.value = '';
      return;
    }
    let parsed: ParsedDocumentBackup;
    try {
      parsed = parseDocumentBackup(text);
    } catch (err) {
      // BackupParseError messages are already user-facing; anything
      // unexpected gets a generic prefix.
      if (err instanceof BackupParseError) {
        setError(err.message);
      } else {
        setError(
          `Could not import the backup: ${(err as Error).message || 'unknown error'}`
        );
      }
      e.target.value = '';
      return;
    }
    const decisions = resolveImportDecisions({ parsed, documents });
    const incomingId = parsed.document.id;
    const exists = documents.some((d) => d.id === incomingId);
    const autoChoice: 'replace' | 'keep-both' = exists ? 'replace' : 'keep-both';
    const isAuto =
      decisions.length === 1 && decisions[0].strategy === autoChoice;
    if (isAuto) {
      // Clean case: apply without the modal, then close the popover
      // so the editor switches over cleanly.
      e.target.value = '';
      runImport(parsed, decisions);
      setOpen(false);
    } else {
      // Pop the modal. Default choices match the auto path, and the
      // user can override per row.
      setPendingParsed(parsed);
      setPendingChoices({ [incomingId]: autoChoice });
    }
  };

  /**
   * Convert resolved decisions into ImportPlans, apply each via the
   * store action, and switch to the first successfully-imported doc.
   * Errors fall through to the inline error slot (does not close
   * the modal — the user can fix and retry).
   */
  const runImport = (
    parsed: ParsedDocumentBackup,
    decisions: ImportDecision[]
  ) => {
    let firstImportedId: string | null = null;
    for (const d of decisions) {
      if (d.strategy === 'skip') continue;
      if (d.strategy === 'keep-both') {
        const plan: ImportPlan = {
          document: parsed.document,
          comments: parsed.comments,
          chats: parsed.chats,
          chatArchives: parsed.chatArchives,
          revisions: parsed.revisions,
          resolvedId: d.documentId,
          strategy: 'keep-both',
        };
        const { importedId } = applyImportPlan(plan);
        if (firstImportedId === null && importedId) {
          firstImportedId = importedId;
        }
      } else {
        // replace — use the document id verbatim
        const plan: ImportPlan = {
          document: parsed.document,
          comments: parsed.comments,
          chats: parsed.chats,
          chatArchives: parsed.chatArchives,
          revisions: parsed.revisions,
          resolvedId: d.documentId,
          strategy: 'replace',
        };
        const { importedId } = applyImportPlan(plan);
        if (firstImportedId === null && importedId) {
          firstImportedId = importedId;
        }
      }
    }
    if (firstImportedId) {
      setCurrentDocument(firstImportedId);
    }
  };

  /**
   * Apply the user's per-row choices. Called from the modal's Apply
   * button; resolves final decisions via `resolveImportDecisions`
   * (which handles defaulting for un-touched rows) and pipes them
   * to `runImport`. On success the modal closes; the popover stays
   * open until the user clicks the toolbar again.
   */
  const onImportApply = () => {
    if (!pendingParsed) return;
    const decisions = resolveImportDecisions({
      parsed: pendingParsed,
      documents,
      userChoices: pendingChoices,
    });
    runImport(pendingParsed, decisions);
    setPendingParsed(null);
    setPendingChoices({});
    if (backupInputRef.current) backupInputRef.current.value = '';
  };

  const onImportCancel = () => {
    setPendingParsed(null);
    setPendingChoices({});
    if (backupInputRef.current) backupInputRef.current.value = '';
  };

  /**
   * Compute the modal's per-row display list. For now a v1 backup
   * contains exactly one document, so the modal is a single-row
   * view. If `DocumentBackup` later grows to allow multiple
   * documents (WorkspaceBackup), this is the seam that scales.
   */
  const modalRows = (() => {
    if (!pendingParsed) return [];
    const incoming = pendingParsed.document;
    const exists = documents.some((d) => d.id === incoming.id);
    return [
      {
        incomingId: incoming.id,
        incomingTitle: incoming.title,
        collides: exists,
        choice: pendingChoices[incoming.id] ?? (exists ? 'replace' : 'keep-both'),
      },
    ];
  })();

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (langs.size === 0) {
      setError('Select at least one language.');
      // Clear the input so the same files can be re-picked.
      e.target.value = '';
      return;
    }
    if (!api.apiKey || !api.apiEndpoint) {
      setError('Open Settings and add an API key so imported text can be formatted as Markdown.');
      e.target.value = '';
      return;
    }
    const langArray = Array.from(langs) as Lang[];
    const fileArray = Array.from(files);
    setBusy(true);
    setError(null);
    setProgress({ done: 0, total: fileArray.length, label: 'starting…' });
    setOpen(false);
    try {
      // Lazy-load OCR (+ pdfjs, PaddleOCR, OpenCV) only when importing.
      const { extractTextFromFiles } = await import('@/utils/ocr');
      const results = await extractTextFromFiles(
        fileArray,
        langArray,
        (p) => setProgress(p)
      );
      // Drop empty results so we don't send stray blank files to the model.
      const blocks = results
        .map((r) => r.trim())
        .filter((r) => r.length > 0);
      if (blocks.length === 0) {
        setError('No text was recognized in the selected file(s).');
        return;
      }
      setProgress({
        done: fileArray.length,
        total: fileArray.length,
        label: 'formatting as Markdown…',
      });
      const markdown = await formatOcrAsMarkdown(blocks.join('\n\n'), api);
      window.dispatchEvent(
        new CustomEvent('mvp:insert-text', { detail: { text: markdown } })
      );
    } catch (err) {
      setError((err as Error).message || 'OCR failed.');
    } finally {
      setBusy(false);
      setProgress(null);
      // CRITICAL: clear the file input so the browser releases its hold
      // on the picked File objects, and so the user can pick the same
      // files again without a refresh.
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const statusLabel = busy && progress ? progress.label : '';
  // PP-OCRv6_tiny is a unified multilingual model — it handles English
  // + Simplified Chinese + Traditional Chinese in one pass, so the
  // checkbox state is informational only (no model swap).
  const strategyLabel = `${langs.size} language${langs.size === 1 ? '' : 's'} checked (single pass; multilingual model)`;

  return (
    <div ref={anchorRef} className="relative inline-flex items-center">
      <button
        type="button"
        data-file-actions-toggle
        aria-label="Document file actions — Import photos / PDFs or Export this document as Markdown"
        className="btn-icon-square disabled:opacity-50"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || busy}
        title={
          busy
            ? 'Reading file…'
            : 'Document file actions: Import photos / PDFs (OCR) or Export this document as Markdown'
        }
      >
        {busy ? (
          // Spinner — three small dots that pulse in sequence. Pure CSS,
          // mirrors the one used in the editor's streaming indicator.
          <span className="inline-flex gap-0.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-current opacity-50 animate-pulse" style={{ animationDelay: '0ms' }} />
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-current opacity-50 animate-pulse" style={{ animationDelay: '150ms' }} />
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-current opacity-50 animate-pulse" style={{ animationDelay: '300ms' }} />
          </span>
        ) : (
          // Document-with-arrows icon: a page (rectangle with a folded
          // corner) flanked by an upward arrow (Export out) and a
          // downward arrow (Import in). Reads as "this button handles
          // both directions for a document" without picking one, so
          // neither label is misleading. Stroke geometry matches the
          // rest of the editor toolbar (16×16 viewBox, 1.5 stroke).
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {/* Up arrow (Export) — sits left of the page. */}
            <path d="M2.5 7 L2.5 2.5" />
            <path d="M1 4 L2.5 2.5 L4 4" />
            {/* Page outline with a folded top-right corner. */}
            <path d="M6 2 L11 2 L13.5 4.5 L13.5 14 L6 14 Z" />
            <path d="M11 2 L11 4.5 L13.5 4.5" />
            {/* Down arrow (Import) — sits right of the page. */}
            <path d="M13.5 9 L13.5 13.5" />
            <path d="M12 12 L13.5 13.5 L15 12" />
          </svg>
        )}
      </button>
      {open && !busy && (
        <div
          ref={popoverRef}
          className="fixed z-40 w-72 max-w-[calc(100vw-1rem)] bg-paper-panel dark:bg-ape-panel border border-paper-hairline dark:border-cyber-border rounded shadow-ape-paper-lift dark:shadow-lg p-3 text-xs space-y-2 box-border"
        >
          {/* Section 1: Import (primary identity of the toolbar button). */}
          <div className="font-semibold text-sm text-cyber-clay dark:text-cyber-cyan uppercase tracking-wide">
            Import photos / PDFs
          </div>
          <p className="text-paper-inkSoft dark:text-cyber-muted leading-snug">
            Pick one or more images or PDF files; recognition runs in
            the browser, then the extracted text is rewritten as
            readable Markdown via your configured model and inserted
            into the editor.
          </p>
          <div className="space-y-1">
            {LANG_OPTIONS.map((opt) => {
              const checked = langs.has(opt.code);
              const lastOne = checked && langs.size === 1;
              return (
                <label
                  key={opt.code}
                  className="flex items-center gap-2 cursor-pointer select-none text-paper-ink dark:text-cyber-primary"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleLang(opt.code)}
                    disabled={lastOne}
                    className="accent-cyber-clay dark:accent-cyber-cyan"
                  />
                  <span>{opt.label}</span>
                </label>
              );
            })}
          </div>
          <div className="text-[11px] text-paper-inkSoft dark:text-cyber-muted font-mono">
            Strategy: {strategyLabel}.
          </div>
          {/* Gated-state hint. Surfaces WHY import will or won't work
            without an API key — OCR runs locally, but Markdown
            rewrite goes through the chat endpoint, which needs one.
            Replaces the previous static "Needs API key" paragraph
            with a flip so the user always knows which path they're
            on. */}
          <p className="text-[11px] text-paper-inkSoft dark:text-cyber-muted leading-snug">
            {api.apiKey && api.apiEndpoint ? (
              <>
                <span className="font-semibold text-cyber-clay dark:text-cyber-cyan">
                  Key configured.
                </span>{' '}
                Files are OCR'd locally and rewritten as Markdown via your model before insertion.
              </>
            ) : (
              <>
                <span className="font-semibold text-cyber-warn">
                  OCR works without an API key.
                </span>{' '}
                Adding one in Settings lets the recognised text be rewritten as Markdown before insertion. Without a key, raw text is inserted as-is.
              </>
            )}
          </p>
          <div className="flex items-center justify-end pt-1">
            <button
              type="button"
              className="btn-fire-sm disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={onPickClick}
              disabled={busy}
              title="Open the file picker — selected files are OCR'd, rewritten as Markdown, and inserted"
            >
              Choose Import File(s)
            </button>
          </div>
          <div className="border-t border-paper-hairline dark:border-cyber-border" />
          {/* Section 2: Export (the second action exposed by the same
              toolbar button). Same primary CTA style as the Import
              button above so the two sections feel symmetric. */}
          <div className="font-semibold text-sm text-cyber-clay dark:text-cyber-cyan uppercase tracking-wide">
            Export this document
          </div>
          <p className="text-paper-inkSoft dark:text-cyber-muted leading-snug">
            Download the current document as Markdown so you have a
            copy outside the browser; local storage can be cleared
            without warning. The Settings API key is never written
            into this file.
          </p>
          <div className="flex items-center justify-end pt-1">
            <button
              type="button"
              className="btn-fire-sm disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={onExportClick}
              disabled={!currentDoc}
              title={
                currentDoc
                  ? 'Download this document as Markdown'
                  : 'Open a document first to export it'
              }
            >
              Export .md
            </button>
          </div>
          <div className="border-t border-paper-hairline dark:border-cyber-border" />
          {/* Section 3: Import full backup (JSON). Round-trip
              counterpart to Section 4 below. Same header / two-
              sentence description / right-aligned primary CTA
              template as the other three sections so the popover
              keeps a consistent rhythm. */}
          <div className="font-semibold text-sm text-cyber-clay dark:text-cyber-cyan uppercase tracking-wide">
            Import full backup (JSON)
          </div>
          <p className="text-paper-inkSoft dark:text-cyber-muted leading-snug">
            Restore a document plus its comments, chat history,
            archived chats, and revisions from a{' '}
            <code className="font-mono">.json</code>{' '}
            file produced by an earlier Export. Conflicts with existing
            documents ask before overwriting.
          </p>
          <div className="flex items-center justify-end pt-1">
            <button
              type="button"
              data-import-backup-toggle
              className="btn-fire-sm disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={onImportBackupClick}
              disabled={busy || pendingParsed !== null}
              title="Restore a document and its slices from a JSON backup file"
            >
              Import .json
            </button>
          </div>
          <div className="border-t border-paper-hairline dark:border-cyber-border" />
          {/* Section 4: Full JSON backup export. Same structural
              template as the three sections above so the popover
              keeps a consistent rhythm: header → two-sentence
              description → primary CTA aligned right. */}
          <div className="font-semibold text-sm text-cyber-clay dark:text-cyber-cyan uppercase tracking-wide">
            Export full backup (JSON)
          </div>
          <p className="text-paper-inkSoft dark:text-cyber-muted leading-snug">
            Download the document plus its comments, chat history,
            archived chats, and revisions as a single JSON file —
            useful before clearing browser storage or switching
            devices. Settings (including the API key) are not in
            this file.
          </p>
          <div className="flex items-center justify-end pt-1">
            <button
              type="button"
              data-backup-toggle
              className="btn-fire-sm disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={onBackupClick}
              disabled={!currentDoc}
              title={
                currentDoc
                  ? 'Download a full JSON backup (document + comments + chat + revisions)'
                  : 'Open a document first to export a backup'
              }
            >
              Export .json
            </button>
          </div>
          <div className="flex items-center justify-end pt-2">
            <button
              type="button"
              className="btn-cyan-sm"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>
          {error && (
            <div className="text-[11px] text-cyber-danger">
              {error}
            </div>
          )}
        </div>
      )}
      {busy && progress && (
        <div
          ref={popoverRef}
          className="fixed z-40 w-72 max-w-[calc(100vw-1rem)] bg-paper-panel dark:bg-ape-panel border border-cyber-clay/40 dark:border-cyber-cyan/60 rounded shadow-ape-paper-lift dark:shadow-lg px-3 py-2 text-xs box-border"
        >
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-cyber-clay dark:bg-cyber-cyan animate-pulse" />
            <span className="flex-1 truncate text-paper-ink dark:text-cyber-primary">{statusLabel}</span>
            <span className="text-paper-inkSoft dark:text-cyber-muted font-mono">
              {progress.done}/{progress.total}
            </span>
          </div>
        </div>
      )}
      {error && !open && !busy && (
        <div
          ref={popoverRef}
          className="fixed z-40 w-72 max-w-[calc(100vw-1rem)] bg-paper-panel dark:bg-ape-panel border border-cyber-danger/40 dark:border-cyber-danger/60 rounded shadow-ape-paper-lift dark:shadow-lg px-3 py-2 text-xs text-cyber-danger box-border"
        >
          {error}
        </div>
      )}
      {pendingParsed && (
        // Collision-resolution modal. Same width / border / typography
        // vocabulary as the popover; sits on top with `z-50` so the
        // popover stays visible underneath if the user wants it for
        // reference. The "outside click" handler below intentionally
        // does NOT close the modal — only Cancel / Apply do.
        <div
          ref={importModalRef}
          className="fixed z-50 w-80 max-w-[calc(100vw-1rem)] bg-paper-panel dark:bg-ape-panel border border-cyber-clay/40 dark:border-cyber-cyan/60 rounded shadow-ape-paper-lift dark:shadow-lg p-3 text-xs space-y-2 box-border"
        >
          <div className="font-semibold text-sm text-cyber-clay dark:text-cyber-cyan uppercase tracking-wide">
            Import backup
          </div>
          <p className="text-paper-inkSoft dark:text-cyber-muted leading-snug">
            One document in this backup. Choose what to do with it:
          </p>
          <ul className="space-y-2">
            {modalRows.map((row) => (
              <li
                key={row.incomingId}
                className="border border-paper-hairline dark:border-cyber-border rounded p-2 space-y-1 bg-paper-elevated/40 dark:bg-ape-elevated/40"
              >
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate text-paper-ink dark:text-cyber-primary font-medium">
                    {row.incomingTitle || '(untitled)'}
                  </span>
                </div>
                <div className="text-[11px] text-paper-inkSoft dark:text-cyber-muted">
                  {row.collides
                    ? 'A document with this id already exists locally.'
                    : 'New id; will land under a fresh id with (imported) in the title.'}
                </div>
                <label className="flex items-center gap-2 text-paper-ink dark:text-cyber-primary">
                  <span className="text-[11px] text-paper-inkSoft dark:text-cyber-muted w-16">
                    Action
                  </span>
                  <select
                    data-import-choice={row.incomingId}
                    className="flex-1 bg-paper-panel dark:bg-ape-panel border border-paper-hairline dark:border-cyber-border rounded px-1 py-0.5 text-paper-ink dark:text-cyber-primary"
                    value={row.choice}
                    onChange={(e) => {
                      const next = e.target.value as
                        | 'replace'
                        | 'skip'
                        | 'keep-both';
                      setPendingChoices((prev) => ({
                        ...prev,
                        [row.incomingId]: next,
                      }));
                    }}
                  >
                    <option value="replace">Replace</option>
                    <option value="skip">Skip</option>
                    <option value="keep-both">Keep both</option>
                  </select>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              className="btn-cyan-sm"
              onClick={onImportCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              data-import-apply
              className="btn-fire-sm"
              onClick={onImportApply}
              disabled={modalRows.every(
                (r) => r.choice === 'skip'
              )}
              title={
                modalRows.every((r) => r.choice === 'skip')
                  ? 'Pick at least one document to import'
                  : 'Apply the choices and switch to the first imported document'
              }
            >
              Apply
            </button>
          </div>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={IMPORT_FILE_ACCEPT}
        multiple
        className="hidden"
        onChange={onFiles}
      />
      <input
        ref={backupInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={onBackupFile}
      />
    </div>
  );
}
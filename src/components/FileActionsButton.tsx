import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore, useCurrentDocument } from '@/store/useStore';
// Type-only: keep pdfjs / PaddleOCR / OpenCV out of the initial app chunk.
// The OCR module is loaded via dynamic import() when the user picks files.
import { IMPORT_FILE_ACCEPT, type OcrLang, type OcrProgress } from '@/utils/ocr';
import { formatOcrAsMarkdown } from '@/utils/ocrMarkdown';
import { downloadTextFile, sanitizeFilename } from '@/utils/storage';
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
 * Pin a popover to the viewport under the sidebar File trigger.
 * Prefers left-aligning to the button (Documents column is on the
 * far left), then clamps so both edges stay on screen.
 */
function clampPopoverToViewport(panel: HTMLElement, anchor: HTMLElement) {
  const pad = VIEWPORT_PAD;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const lockWidth = panel.dataset.lockWidth !== 'false';
  const desired = lockWidth ? POPOVER_WIDTH : panel.offsetWidth || 200;
  const maxW = Math.min(desired, Math.max(0, vw - pad * 2));
  if (lockWidth) {
    panel.style.width = `${maxW}px`;
  } else {
    panel.style.width = 'auto';
  }
  panel.style.maxWidth = `${Math.max(0, vw - pad * 2)}px`;
  panel.style.maxHeight = `${Math.max(0, vh - pad * 2)}px`;
  panel.style.overflowY = 'auto';

  const ar = anchor.getBoundingClientRect();
  const width = lockWidth ? maxW : Math.min(panel.offsetWidth || maxW, maxW);
  let left = ar.left;
  if (left < pad) left = pad;
  if (left + width > vw - pad) left = Math.max(pad, vw - pad - width);

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

const MENU_ITEM_CLASS =
  'w-full text-left px-3 py-1.5 text-[15px] text-paper-ink dark:text-cyber-primary hover:bg-paper-elevated dark:hover:bg-ape-elevated hover:text-cyber-clay dark:hover:text-cyber-cyan transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-paper-ink dark:disabled:hover:text-cyber-primary';

type FilePanel = 'closed' | 'menu' | 'ocr';

/**
 * Sidebar **File** menu. Owns document create / snapshot / duplicate
 * plus the import and export actions that used to live on the editor
 * toolbar:
 *   - **New / Save / Save As** — store actions.
 *   - **Export .md / Export .json** — download the current document.
 *   - **Import photos / PDFs** — OCR panel (language checkboxes, then
 *     a file picker). Extracted text is rewritten as Markdown and
 *     inserted via `mvp:insert-text`.
 *   - **Import .json** — restore a versioned document backup.
 *
 * Cleanup: after every OCR batch the file input is reset to '' so the
 * same files can be re-picked without a refresh. The OCR util itself
 * handles revoking ObjectURLs, releasing canvases, and terminating the
 * worker.
 */
export function FileActionsButton() {
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
  const createDocument = useStore((s) => s.createDocument);
  const saveRevision = useStore((s) => s.saveRevision);
  const duplicateDocument = useStore((s) => s.duplicateDocument);
  const inputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const importModalRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [panel, setPanel] = useState<FilePanel>('closed');
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
  const menuOpen = panel === 'menu';
  const ocrOpen = panel === 'ocr';
  const panelVisible =
    panel !== 'closed' || busy || Boolean(error) || pendingParsed !== null;

  // Close the menu / OCR panel on outside click. While the import
  // modal is open the panel must NOT close — otherwise the modal's
  // anchor disappears. The modal has its own Cancel / Apply buttons.
  useEffect(() => {
    if (panel === 'closed') return;
    const onDocPointer = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      if (importModalRef.current?.contains(target)) return;
      const btn = (e.target as HTMLElement | null)?.closest(
        '[data-file-actions-toggle]'
      );
      if (btn) return;
      setPanel('closed');
    };
    document.addEventListener('pointerdown', onDocPointer);
    return () => document.removeEventListener('pointerdown', onDocPointer);
  }, [panel]);

  useEffect(() => {
    if (panel === 'closed') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (pendingParsed) return;
      setPanel('closed');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel, pendingParsed]);

  // Reset error when the File menu opens.
  useEffect(() => {
    if (panel === 'menu') setError(null);
  }, [panel]);

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
  }, [panelVisible, panel, busy, error]);

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
    downloadTextFile(`${base}.md`, currentDoc.content, 'text/markdown;charset=utf-8');
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
      serialiseDocumentBackup(backup),
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
      setPanel('closed');
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
    setPanel('closed');
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
  const hasDoc = Boolean(currentDoc);

  const onNew = () => {
    createDocument();
    setPanel('closed');
  };
  const onSave = () => {
    if (!currentDoc) return;
    saveRevision(currentDoc.id);
    setPanel('closed');
  };
  const onSaveAs = () => {
    if (!currentDoc) return;
    const next = window.prompt(
      'Save as',
      `${currentDoc.title || 'Untitled'} copy`
    );
    if (next === null || next.trim() === '') return;
    duplicateDocument(currentDoc.id, next);
    setPanel('closed');
  };
  const onExportMd = () => {
    onExportClick();
    if (currentDoc) setPanel('closed');
  };
  const onExportJson = () => {
    onBackupClick();
    if (currentDoc) setPanel('closed');
  };
  const onImportJson = () => {
    onImportBackupClick();
    setPanel('closed');
  };

  return (
    <div ref={anchorRef} className="relative inline-flex items-center">
      <button
        type="button"
        data-file-actions-toggle
        aria-haspopup="menu"
        aria-expanded={menuOpen || ocrOpen}
        aria-label="File"
        className="btn-fire-sm !text-[15px] !py-1.5 disabled:opacity-50"
        onClick={() =>
          setPanel((p) => (p === 'menu' ? 'closed' : 'menu'))
        }
        disabled={busy}
        title={busy ? 'Reading file…' : 'File — new, save, import, and export'}
      >
        {busy ? (
          <span className="inline-flex gap-0.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-current opacity-50 animate-pulse" style={{ animationDelay: '0ms' }} />
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-current opacity-50 animate-pulse" style={{ animationDelay: '150ms' }} />
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-current opacity-50 animate-pulse" style={{ animationDelay: '300ms' }} />
          </span>
        ) : (
          <>
            <span>File</span>
            <svg
              aria-hidden="true"
              viewBox="0 0 10 10"
              className={`h-2.5 w-2.5 transition-transform ${
                menuOpen || ocrOpen ? 'rotate-180' : ''
              }`}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2 4 L5 7 L8 4" />
            </svg>
          </>
        )}
      </button>
      {menuOpen && !busy && (
        <div
          ref={popoverRef}
          role="menu"
          aria-label="File"
          data-lock-width="false"
          className="fixed z-40 min-w-[200px] rounded border border-paper-hairline dark:border-cyber-border bg-paper-surface dark:bg-ape-panel shadow-lg py-1"
        >
          <button
            type="button"
            role="menuitem"
            className={MENU_ITEM_CLASS}
            onClick={onNew}
            title="Create a blank Untitled document"
          >
            New
          </button>
          <button
            type="button"
            role="menuitem"
            className={MENU_ITEM_CLASS}
            onClick={onSave}
            disabled={!hasDoc}
            title={
              hasDoc
                ? 'Save current content as a revision'
                : 'Open a document first to save a revision'
            }
          >
            Save
          </button>
          <button
            type="button"
            role="menuitem"
            className={MENU_ITEM_CLASS}
            onClick={onSaveAs}
            disabled={!hasDoc}
            title={
              hasDoc
                ? 'Duplicate this document under a new title'
                : 'Open a document first to save a copy'
            }
          >
            Save As
          </button>
          <div
            className="my-1 border-t border-paper-hairline dark:border-cyber-border"
            aria-hidden
          />
          <button
            type="button"
            role="menuitem"
            className={MENU_ITEM_CLASS}
            onClick={onExportMd}
            disabled={!hasDoc}
            title={
              hasDoc
                ? 'Download this document as Markdown'
                : 'Open a document first to export it'
            }
          >
            Export .md
          </button>
          <button
            type="button"
            role="menuitem"
            data-backup-toggle
            className={MENU_ITEM_CLASS}
            onClick={onExportJson}
            disabled={!hasDoc}
            title={
              hasDoc
                ? 'Download a full JSON backup (document + comments + chat + revisions)'
                : 'Open a document first to export a backup'
            }
          >
            Export .json
          </button>
          <div
            className="my-1 border-t border-paper-hairline dark:border-cyber-border"
            aria-hidden
          />
          <button
            type="button"
            role="menuitem"
            className={MENU_ITEM_CLASS}
            onClick={() => setPanel('ocr')}
            title="Import text from photos or PDFs"
          >
            Import photos / PDFs
          </button>
          <button
            type="button"
            role="menuitem"
            data-import-backup-toggle
            className={MENU_ITEM_CLASS}
            onClick={onImportJson}
            disabled={busy || pendingParsed !== null}
            title="Restore a document and its slices from a JSON backup file"
          >
            Import .json
          </button>
        </div>
      )}
      {ocrOpen && !busy && (
        <div
          ref={popoverRef}
          className="fixed z-40 w-72 max-w-[calc(100vw-1rem)] bg-paper-panel dark:bg-ape-panel border border-paper-hairline dark:border-cyber-border rounded shadow-ape-paper-lift dark:shadow-lg p-3 text-xs space-y-2 box-border"
        >
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
          {error && (
            <div className="text-[11px] text-cyber-danger">{error}</div>
          )}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              className="btn-cyan-sm"
              onClick={() => setPanel('closed')}
            >
              Close
            </button>
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
      {error && panel === 'closed' && !busy && (
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
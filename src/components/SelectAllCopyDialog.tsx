import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { writeClipboardText } from '@/utils/clipboard';

export type SelectAllSource = 'write' | 'preview';

interface Props {
  text: string;
  source: SelectAllSource;
  onClose: () => void;
}

/**
 * Confirm-copy dialog opened after Select All. The editor already
 * highlighted the contents; this box asks whether those contents
 * should go on the clipboard. Cancel / backdrop / Escape close
 * without copying. Copy writes the captured text (not a live
 * selection — opening the dialog moves focus off the editor).
 */
export function SelectAllCopyDialog({ text, source, onClose }: Props) {
  const titleId = useId();
  const descId = useId();
  const copyBtnRef = useRef<HTMLButtonElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const empty = text.length === 0;
  const surface = source === 'write' ? 'Write' : 'Preview';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    (empty ? cancelBtnRef.current : copyBtnRef.current)?.focus();
  }, [empty]);

  const onCopy = async () => {
    if (empty || busy) return;
    setBusy(true);
    setError(null);
    try {
      await writeClipboardText(text);
      onClose();
    } catch (err) {
      setError(
        (err as Error).message || 'Could not copy to the clipboard.'
      );
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/45"
        aria-label="Cancel copy"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="relative z-10 w-full max-w-lg max-h-[min(32rem,calc(100vh-2rem))] flex flex-col rounded border border-paper-hairline dark:border-cyber-border bg-paper-panel dark:bg-ape-panel shadow-ape-paper-lift dark:shadow-2xl"
      >
        <div className="px-4 pt-3 pb-2 border-b border-paper-hairline dark:border-cyber-border">
          <h2
            id={titleId}
            className="text-sm font-semibold text-cyber-clay dark:text-cyber-cyan uppercase tracking-wide"
          >
            Copy to clipboard?
          </h2>
          <p
            id={descId}
            className="mt-1 text-sm text-paper-inkSoft dark:text-cyber-muted leading-snug"
          >
            {empty
              ? `Nothing in ${surface} to copy.`
              : `All ${surface} contents are selected. Copy them to the clipboard?`}
          </p>
        </div>
        <pre
          className="flex-1 min-h-0 overflow-auto px-4 py-3 text-xs font-mono whitespace-pre-wrap break-words text-paper-ink dark:text-cyber-primary bg-paper-elevated/40 dark:bg-ape-elevated/40"
          aria-label={`${surface} contents`}
        >
          {empty ? '(empty)' : text}
        </pre>
        {error && (
          <div className="px-4 py-2 text-xs text-cyber-danger border-t border-paper-hairline dark:border-cyber-border">
            {error}
          </div>
        )}
        <div className="px-4 py-3 border-t border-paper-hairline dark:border-cyber-border flex justify-end gap-2 bg-paper-elevated/40 dark:bg-ape-elevated/30">
          <button
            ref={cancelBtnRef}
            type="button"
            className="btn-ghost"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            ref={copyBtnRef}
            type="button"
            className="btn-fire disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={onCopy}
            disabled={empty || busy}
            title={empty ? `Nothing in ${surface} to copy` : 'Copy the selected contents'}
          >
            {busy ? 'Copying…' : 'Copy'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// Settings / Chat controls for downloading, importing, loading,
// exporting, and clearing the in-browser Local Gemma (LiteRT-LM) model.

import { useEffect, useRef, useState } from 'react';
import {
  LOCAL_GEMMA_MODEL_LABEL,
  LOCAL_GEMMA_MODEL_PAGE_URL,
  LOCAL_GEMMA_SIZE_LABEL,
  clearCachedLocalGemma,
  downloadLocalGemmaFromHuggingFace,
  ensureLocalGemmaEngine,
  exportCachedLocalGemmaToDisk,
  hasCachedLocalGemma,
  importLocalGemmaFile,
  isLocalGemmaEngineReady,
  isWebGpuAvailable,
  readLocalGemmaLastSave,
  tryLoadLocalGemmaFromCache,
  type LocalGemmaDownloadProgress,
  type LocalGemmaLastSave,
} from '@/api/localGemma';
import { tipForDownloadProgress } from '@/utils/localGemmaTips';

function formatBytes(n: number): string {
  if (n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatSavedAt(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return new Date(ts).toISOString();
  }
}

type Phase =
  | 'checking'
  | 'unsupported'
  | 'missing'
  | 'cached'
  | 'downloading'
  | 'loading'
  | 'ready'
  | 'error';

export function LocalGemmaControls({
  compact = false,
  onReadyChange,
}: {
  compact?: boolean;
  onReadyChange?: (ready: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<LocalGemmaDownloadProgress | null>(
    null
  );
  const [lastSave, setLastSave] = useState<LocalGemmaLastSave | null>(() =>
    readLocalGemmaLastSave()
  );
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const setPhaseAndNotify = (next: Phase) => {
    setPhase(next);
    onReadyChange?.(next === 'ready');
  };

  const refresh = async () => {
    if (!isWebGpuAvailable()) {
      setPhaseAndNotify('unsupported');
      return;
    }
    if (isLocalGemmaEngineReady()) {
      setPhaseAndNotify('ready');
      return;
    }
    const cached = await hasCachedLocalGemma();
    setPhaseAndNotify(cached ? 'cached' : 'missing');
  };

  useEffect(() => {
    void refresh();
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const runLoadFromCache = async () => {
    setError(null);
    setPhaseAndNotify('loading');
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    try {
      const ok = await tryLoadLocalGemmaFromCache(abortRef.current.signal);
      if (!ok) {
        setPhaseAndNotify('missing');
        setError('No cached model found. Download or load from disk.');
        return;
      }
      setPhaseAndNotify('ready');
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setError((e as Error).message || 'Failed to load model into GPU.');
      setPhaseAndNotify('cached');
    }
  };

  const runDownload = async () => {
    if (!isWebGpuAvailable()) {
      setPhaseAndNotify('unsupported');
      return;
    }
    setError(null);
    setProgress({ loaded: 0, total: 0, ratio: 0 });
    setPhaseAndNotify('downloading');
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    try {
      const blob = await downloadLocalGemmaFromHuggingFace(
        (p) => setProgress(p),
        abortRef.current.signal
      );
      setPhaseAndNotify('loading');
      await ensureLocalGemmaEngine(blob, { signal: abortRef.current.signal });
      setProgress(null);
      setPhaseAndNotify('ready');
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        setProgress(null);
        void refresh();
        return;
      }
      setError((e as Error).message || 'Download failed.');
      setProgress(null);
      void refresh();
    }
  };

  const runImport = async (file: File) => {
    if (!isWebGpuAvailable()) {
      setPhaseAndNotify('unsupported');
      return;
    }
    setError(null);
    setPhaseAndNotify('loading');
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    try {
      const blob = await importLocalGemmaFile(file);
      await ensureLocalGemmaEngine(blob, { signal: abortRef.current.signal });
      setPhaseAndNotify('ready');
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setError((e as Error).message || 'Failed to load file.');
      void refresh();
    }
  };

  const runSaveToDisk = async () => {
    setError(null);
    setSaving(true);
    try {
      const meta = await exportCachedLocalGemmaToDisk();
      setLastSave(meta);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setError((e as Error).message || 'Failed to save model to disk.');
    } finally {
      setSaving(false);
    }
  };

  const runClear = async () => {
    setError(null);
    abortRef.current?.abort();
    await clearCachedLocalGemma();
    setProgress(null);
    setPhaseAndNotify(isWebGpuAvailable() ? 'missing' : 'unsupported');
  };

  if (phase === 'checking') {
    return (
      <p className="text-xs text-paper-inkSoft dark:text-cyber-muted">
        Checking Local Gemma…
      </p>
    );
  }

  if (phase === 'unsupported') {
    return (
      <div className="rounded border border-cyber-danger/40 bg-cyber-danger/10 p-3 space-y-1">
        <p className="text-sm text-cyber-danger font-medium">
          WebGPU not available
        </p>
        <p className="text-xs text-paper-inkSoft dark:text-cyber-muted">
          Local Gemma needs a recent Chrome, Edge, or Safari with WebGPU and
          about 1.8 GB of GPU memory. Switch to Minimax or OpenAI with an API
          key, or try another browser / device.
        </p>
      </div>
    );
  }

  const pct =
    progress && progress.total > 0
      ? Math.round(progress.ratio * 100)
      : null;
  const tip =
    phase === 'downloading' && pct !== null
      ? tipForDownloadProgress(pct)
      : phase === 'downloading'
        ? tipForDownloadProgress(0)
        : null;

  const showSaveToDisk = phase === 'cached' || phase === 'ready';
  const busy = phase === 'downloading' || phase === 'loading' || saving;

  return (
    <div
      className={
        compact
          ? 'space-y-2 text-xs'
          : 'rounded border border-paper-hairline dark:border-cyber-border bg-paper-elevated/40 dark:bg-ape-elevated/40 p-3 space-y-2'
      }
    >
      {!compact && (
        <>
          <p className="text-sm text-paper-ink dark:text-cyber-primary">
            No API key needed — runs on your device.
          </p>
          <p className="text-xs text-paper-inkSoft dark:text-cyber-muted">
            Model{' '}
            <code className="font-mono text-[11px]">
              {LOCAL_GEMMA_MODEL_LABEL}
            </code>{' '}
            ({LOCAL_GEMMA_SIZE_LABEL}). Cached in this browser after download;
            never uploaded to ApEditor servers. Use Save to Disk for an offline
            `.litertlm` copy.
          </p>
        </>
      )}

      <p className="text-xs text-paper-inkSoft dark:text-cyber-muted">
        Status:{' '}
        <span className="text-paper-ink dark:text-cyber-primary font-medium">
          {phase === 'ready'
            ? 'Ready'
            : phase === 'cached'
              ? 'Downloaded — load into GPU'
              : phase === 'downloading'
                ? 'Downloading…'
                : phase === 'loading'
                  ? 'Loading into GPU…'
                  : 'Not downloaded'}
        </span>
      </p>

      <p className="text-xs text-paper-inkSoft dark:text-cyber-muted">
        Last saved:{' '}
        {lastSave ? (
          <span className="text-paper-ink dark:text-cyber-primary font-medium break-all">
            {lastSave.fileName}
            <span className="font-normal text-paper-inkSoft dark:text-cyber-muted">
              {' '}
              · {formatSavedAt(lastSave.savedAt)}
            </span>
          </span>
        ) : (
          <span className="text-paper-inkSoft dark:text-cyber-muted">
            Not saved to disk yet.
          </span>
        )}
      </p>

      {phase === 'downloading' && progress && (
        <div className="space-y-1.5">
          <div className="h-1.5 rounded bg-paper-hairline dark:bg-cyber-border overflow-hidden">
            <div
              className="h-full bg-cyber-clay dark:bg-cyber-cyan transition-[width]"
              style={{
                width: pct !== null ? `${pct}%` : '30%',
              }}
            />
          </div>
          <p className="text-[11px] text-paper-inkSoft dark:text-cyber-muted font-mono">
            {formatBytes(progress.loaded)}
            {progress.total > 0
              ? ` / ${formatBytes(progress.total)}${pct !== null ? ` (${pct}%)` : ''}`
              : ' downloaded…'}
          </p>
          {tip && (
            <p
              className="text-[11px] leading-snug text-paper-ink dark:text-cyber-primary rounded border border-paper-hairline dark:border-cyber-border bg-paper-base/60 dark:bg-ape-base/50 px-2 py-1.5"
              role="status"
              aria-live="polite"
            >
              <span className="text-paper-inkSoft dark:text-cyber-muted font-medium">
                Tip:{' '}
              </span>
              {tip}
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="text-xs text-cyber-danger whitespace-pre-wrap">{error}</p>
      )}

      <div className="flex flex-wrap gap-2">
        {phase === 'missing' && (
          <button
            type="button"
            className="btn-fire-sm"
            onClick={() => void runDownload()}
          >
            Download from Hugging Face
          </button>
        )}
        {phase === 'cached' && (
          <button
            type="button"
            className="btn-fire-sm"
            onClick={() => void runLoadFromCache()}
          >
            Load into GPU
          </button>
        )}
        {showSaveToDisk && (
          <button
            type="button"
            className="btn-cyan-sm"
            disabled={busy}
            onClick={() => void runSaveToDisk()}
            title="Save the cached model as a .litertlm file on your computer"
          >
            {saving ? 'Saving…' : 'Save to Disk'}
          </button>
        )}
        {(phase === 'missing' || phase === 'cached' || phase === 'ready') && (
          <button
            type="button"
            className="btn-cyan-sm"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            Load from disk…
          </button>
        )}
        {(phase === 'downloading' || phase === 'loading') && (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => abortRef.current?.abort()}
          >
            Cancel
          </button>
        )}
        {(phase === 'cached' || phase === 'ready') && (
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={() => void runClear()}
          >
            Clear cached model
          </button>
        )}
        {phase === 'missing' && (
          <a
            className="btn-ghost inline-flex items-center"
            href={LOCAL_GEMMA_MODEL_PAGE_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open on Hugging Face
          </a>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".litertlm,application/octet-stream"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void runImport(file);
        }}
      />
    </div>
  );
}

// In-browser Local Gemma (LiteRT-LM) adapter.
//
// The ~2 GB `gemma-4-E2B-it-web.litertlm` is downloaded from Hugging
// Face (or loaded from a user-picked File) into the browser Cache API,
// then run with WebGPU via `@litert-lm/core`. The model is never
// shipped in the GitHub / Vercel deploy.

import type { ChatMessage } from '@/types';
import { ApiError } from '@/api/chat';
import { LOCAL_GEMMA_LAST_SAVE_KEY } from '@/utils/storage';

// Types only — the heavy `@litert-lm/core` runtime is dynamically
// imported when the user actually loads Local Gemma so keyed-provider
// users do not download ~10 MB of LiteRT JS up front.
type LiteRtEngine = import('@litert-lm/core').Engine;
type LiteRtConversation = import('@litert-lm/core').Conversation;
type LiteRtMessage = import('@litert-lm/core').Message;

/** Hugging Face resolve URL for the web-optimized Gemma 4 E2B weights. */
export const LOCAL_GEMMA_MODEL_URL =
  'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.litertlm';

/** Model file page on Hugging Face (UI link; not used for fetch). */
export const LOCAL_GEMMA_MODEL_PAGE_URL =
  'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/blob/main/gemma-4-E2B-it-web.litertlm';

export const LOCAL_GEMMA_MODEL_LABEL = 'gemma-4-E2B-it-web';

/** Approx on-disk size shown in UI copy (HF reports ~2.01 GB). */
export const LOCAL_GEMMA_SIZE_LABEL = '~2 GB';

const CACHE_NAME = 'apeditor-local-gemma-v1';
const CACHE_REQUEST = new Request(LOCAL_GEMMA_MODEL_URL, { method: 'GET' });

let engineSingleton: LiteRtEngine | null = null;
let conversationSingleton: LiteRtConversation | null = null;
let engineSourceKey: string | null = null;
let loadPromise: Promise<void> | null = null;

export type LocalGemmaDownloadProgress = {
  loaded: number;
  total: number;
  /** 0–1 when total is known; otherwise 0. */
  ratio: number;
};

export function isWebGpuAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    Boolean((navigator as Navigator & { gpu?: unknown }).gpu)
  );
}

export async function hasCachedLocalGemma(): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(CACHE_REQUEST);
    return Boolean(hit);
  } catch {
    return false;
  }
}

export async function clearCachedLocalGemma(): Promise<void> {
  await disposeLocalGemma();
  if (typeof caches === 'undefined') return;
  try {
    await caches.delete(CACHE_NAME);
  } catch {
    /* ignore */
  }
}

async function putBlobInCache(blob: Blob): Promise<void> {
  const cache = await caches.open(CACHE_NAME);
  const response = new Response(blob, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(blob.size),
    },
  });
  await cache.put(CACHE_REQUEST, response);
}

export async function getCachedLocalGemmaBlob(): Promise<Blob | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(CACHE_REQUEST);
    if (!hit) return null;
    return await hit.blob();
  } catch {
    return null;
  }
}

/**
 * Download the model from Hugging Face with progress, then persist it
 * in the Cache API for subsequent visits.
 */
export async function downloadLocalGemmaFromHuggingFace(
  onProgress?: (p: LocalGemmaDownloadProgress) => void,
  signal?: AbortSignal
): Promise<Blob> {
  const res = await fetch(LOCAL_GEMMA_MODEL_URL, {
    mode: 'cors',
    credentials: 'omit',
    signal,
  });
  if (!res.ok) {
    throw new ApiError(
      `Failed to download Local Gemma from Hugging Face (${res.status} ${res.statusText}).`
    );
  }
  if (!res.body) {
    throw new ApiError('Hugging Face response had no body.');
  }

  const totalHeader = Number(res.headers.get('content-length') || 0);
  const reader = res.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      // Copy into a plain ArrayBuffer so BlobPart typing is happy
      // under TS 5.x (SharedArrayBuffer-capable ArrayBufferLike).
      const copy = new ArrayBuffer(value.byteLength);
      new Uint8Array(copy).set(value);
      chunks.push(copy);
      loaded += value.byteLength;
      onProgress?.({
        loaded,
        total: totalHeader,
        ratio: totalHeader > 0 ? Math.min(1, loaded / totalHeader) : 0,
      });
    }
  }

  const blob = new Blob(chunks, { type: 'application/octet-stream' });
  try {
    await putBlobInCache(blob);
  } catch (e) {
    console.warn(
      '[localGemma] cache put failed; model still usable this session',
      e
    );
  }
  return blob;
}

/**
 * Persist a user-picked `.litertlm` File into the Cache API and return it.
 */
export async function importLocalGemmaFile(file: File): Promise<Blob> {
  const blob: Blob = file;
  try {
    await putBlobInCache(blob);
  } catch (e) {
    console.warn(
      '[localGemma] cache put failed; model still usable this session',
      e
    );
  }
  return blob;
}

function sourceKeyFor(blob: Blob): string {
  const file = blob as File;
  if (typeof file.name === 'string' && file.name) {
    return `file:${file.name}:${file.size}:${file.lastModified ?? 0}`;
  }
  return `blob:${blob.size}`;
}

function messageText(msg: LiteRtMessage): string {
  const content = msg.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  let out = '';
  for (const part of content) {
    if (
      part &&
      typeof part === 'object' &&
      'type' in part &&
      part.type === 'text'
    ) {
      const text = (part as { text?: string }).text;
      if (typeof text === 'string') out += text;
    }
  }
  return out;
}

/**
 * Map ApEditor ChatMessages into a LiteRT-native shape:
 * - `preface`: non-doc system messages + prior turns (`assistant` → `model`)
 * - `outgoing`: latest user message, with `sys-current-doc` prepended
 *
 * The open document is attached **once**, on the user turn — not also
 * as a system preface message. Runtime evidence showed the model saw
 * a duplicated `--- DOC ---` wrapper and copied those markers into
 * proposed-edit `"original"`, while still asking for "the paragraph".
 */
export function splitMessagesForLocalGemma(messages: ChatMessage[]): {
  preface: LiteRtMessage[];
  outgoing: LiteRtMessage;
} {
  const preface: LiteRtMessage[] = [];
  const history: LiteRtMessage[] = [];
  let docBlock = '';

  for (const m of messages) {
    if (m.role === 'system') {
      const text = (m.content || '').trim();
      if (!text) continue;
      // Lift the working document onto the user turn only.
      if (m.id === 'sys-current-doc') {
        docBlock = text;
        continue;
      }
      preface.push({ role: 'system', content: text });
      continue;
    }
    // Skip empty assistant placeholders from the in-flight turn.
    if (m.role === 'assistant' && !(m.content || '').trim()) continue;
    history.push({
      // LiteRT chat templates use `model` for assistant turns.
      role: m.role === 'assistant' ? 'model' : 'user',
      content: m.content || '',
    });
  }

  let lastUser = history.pop();
  while (lastUser && lastUser.role !== 'user') {
    lastUser = history.pop();
  }
  for (const h of history) preface.push(h);

  const userText =
    typeof lastUser?.content === 'string' && lastUser.content.trim()
      ? lastUser.content
      : '(empty)';
  const outgoingContent = docBlock
    ? `${docBlock}\n\nUser request:\n${userText}`
    : userText;

  return {
    preface,
    outgoing: { role: 'user', content: outgoingContent },
  };
}

export async function ensureLocalGemmaEngine(
  model: Blob,
  options?: { signal?: AbortSignal }
): Promise<void> {
  if (!isWebGpuAvailable()) {
    throw new ApiError(
      'Local Gemma needs WebGPU. Use a recent Chrome, Edge, or Safari on a device with enough GPU memory (~1.8 GB).'
    );
  }
  const key = sourceKeyFor(model);
  if (engineSingleton && engineSourceKey === key) return;
  if (loadPromise) {
    await loadPromise;
    if (engineSingleton && engineSourceKey === key) return;
  }

  loadPromise = (async () => {
    if (options?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    await disposeLocalGemma();
    const { Engine } = await import('@litert-lm/core');
    const engine = await Engine.create({
      model,
      mainExecutorSettings: {
        maxNumTokens: 8192,
      },
    });
    if (options?.signal?.aborted) {
      await engine.delete();
      throw new DOMException('Aborted', 'AbortError');
    }
    engineSingleton = engine;
    engineSourceKey = key;
    conversationSingleton = null;
  })();

  try {
    await loadPromise;
  } finally {
    loadPromise = null;
  }
}

async function getOrCreateConversation(
  preface: LiteRtMessage[]
): Promise<LiteRtConversation> {
  if (!engineSingleton) {
    throw new ApiError(
      'Local Gemma engine is not loaded. Download or load the model in Settings.'
    );
  }
  if (conversationSingleton) {
    try {
      await conversationSingleton.delete();
    } catch {
      /* ignore */
    }
    conversationSingleton = null;
  }
  conversationSingleton = await engineSingleton.createConversation({
    preface: preface.length > 0 ? { messages: preface } : undefined,
    prefillPrefaceOnInit: preface.length > 0,
  });
  return conversationSingleton;
}

/**
 * Stream a completion from the loaded Local Gemma engine. `messages`
 * should already be the packed `buildRequestMessages` result.
 */
export async function streamLocalGemmaCompletion(
  messages: ChatMessage[],
  options: {
    signal?: AbortSignal;
    onDelta: (delta: string) => void;
  }
): Promise<void> {
  if (!engineSingleton) {
    throw new ApiError(
      'Local Gemma is not ready. Open Settings → Local Gemma and download or load the model.'
    );
  }
  const { preface, outgoing } = splitMessagesForLocalGemma(messages);
  const conversation = await getOrCreateConversation(preface);

  const onAbort = () => {
    try {
      conversation.cancel();
    } catch {
      /* ignore */
    }
  };
  if (options.signal) {
    if (options.signal.aborted) {
      onAbort();
      throw new DOMException('Aborted', 'AbortError');
    }
    options.signal.addEventListener('abort', onAbort, { once: true });
  }

  let previous = '';
  try {
    const stream = conversation.sendMessageStreaming(outgoing);
    for await (const chunk of stream as unknown as AsyncIterable<LiteRtMessage>) {
      if (options.signal?.aborted) {
        conversation.cancel();
        throw new DOMException('Aborted', 'AbortError');
      }
      const text = messageText(chunk);
      if (!text) continue;
      if (text.startsWith(previous)) {
        const delta = text.slice(previous.length);
        previous = text;
        if (delta) options.onDelta(delta);
      } else {
        previous += text;
        options.onDelta(text);
      }
    }
  } finally {
    if (options.signal) {
      options.signal.removeEventListener('abort', onAbort);
    }
  }
}

export async function disposeLocalGemma(): Promise<void> {
  if (conversationSingleton) {
    try {
      await conversationSingleton.delete();
    } catch {
      /* ignore */
    }
    conversationSingleton = null;
  }
  if (engineSingleton) {
    try {
      await engineSingleton.delete();
    } catch {
      /* ignore */
    }
    engineSingleton = null;
  }
  engineSourceKey = null;
}

export function isLocalGemmaEngineReady(): boolean {
  return engineSingleton !== null;
}

/**
 * Load engine from Cache API if present. Returns false when nothing cached.
 */
export async function tryLoadLocalGemmaFromCache(
  signal?: AbortSignal
): Promise<boolean> {
  const blob = await getCachedLocalGemmaBlob();
  if (!blob) return false;
  await ensureLocalGemmaEngine(blob, { signal });
  return true;
}

/** Suggested filename when exporting the cached model to disk. */
export const LOCAL_GEMMA_SAVE_FILENAME = `${LOCAL_GEMMA_MODEL_LABEL}.litertlm`;

export type LocalGemmaLastSave = {
  fileName: string;
  savedAt: number;
};

export function readLocalGemmaLastSave(): LocalGemmaLastSave | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LOCAL_GEMMA_LAST_SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalGemmaLastSave>;
    if (
      typeof parsed.fileName !== 'string' ||
      !parsed.fileName.trim() ||
      typeof parsed.savedAt !== 'number' ||
      !Number.isFinite(parsed.savedAt)
    ) {
      return null;
    }
    return { fileName: parsed.fileName.trim(), savedAt: parsed.savedAt };
  } catch {
    return null;
  }
}

export function writeLocalGemmaLastSave(meta: LocalGemmaLastSave): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_GEMMA_LAST_SAVE_KEY, JSON.stringify(meta));
  } catch {
    /* ignore quota / private mode */
  }
}

function downloadBlobFile(filename: string, blob: Blob): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<{
    name: string;
    createWritable: () => Promise<{
      write: (data: Blob) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
};

/**
 * Export the Cache API model blob to a user-chosen disk file.
 * Prefers File System Access API; falls back to a browser download.
 * Returns the filename recorded for the "Last saved" UI line.
 */
export async function exportCachedLocalGemmaToDisk(): Promise<LocalGemmaLastSave> {
  const blob = await getCachedLocalGemmaBlob();
  if (!blob) {
    throw new ApiError(
      'No cached Local Gemma model to save. Download or load from disk first.'
    );
  }

  const suggested = LOCAL_GEMMA_SAVE_FILENAME;
  const win = window as SaveFilePickerWindow;
  let fileName = suggested;

  if (typeof win.showSaveFilePicker === 'function') {
    try {
      const handle = await win.showSaveFilePicker({
        suggestedName: suggested,
        types: [
          {
            description: 'LiteRT-LM model',
            accept: { 'application/octet-stream': ['.litertlm'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      fileName = handle.name || suggested;
    } catch (e) {
      // User cancelled the picker — surface as AbortError for the UI.
      if ((e as Error).name === 'AbortError') throw e;
      // Picker unsupported mid-flight or permission denied → download.
      downloadBlobFile(suggested, blob);
      fileName = suggested;
    }
  } else {
    downloadBlobFile(suggested, blob);
    fileName = suggested;
  }

  const meta: LocalGemmaLastSave = { fileName, savedAt: Date.now() };
  writeLocalGemmaLastSave(meta);
  return meta;
}

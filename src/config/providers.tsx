// Provider presets for the Settings modal.
//
// Each entry bundles the per-provider defaults that the UI needs to
// show: the default endpoint, the model presets for the datalist,
// the default model, helper text, and the API-key placeholder.
//
// Keyed cloud providers (minimax, openai) and local OpenAI-compatible
// HTTP servers (ollama, lm-studio) speak the same OpenAI Chat
// Completions wire format (see src/api/chat.ts), so the request layer
// does NOT branch on `provider` for them — this config is purely UI /
// defaults metadata for that path. Ollama / LM Studio hide the API key
// field (`requiresApiKey` is false) but still use HTTP streaming.
//
// Local Gemma does NOT use the OpenAI wire format and does NOT need an
// API key. ChatPanel streams via in-browser LiteRT-LM (WebGPU). Use
// `usesLocalGemmaEngine` — not `!requiresApiKey` — to select that path.
import type { ApiConfig, ApiProvider } from '@/types';
import {
  LOCAL_GEMMA_MODEL_LABEL,
  LOCAL_GEMMA_SIZE_LABEL,
} from '@/api/localGemma';

export interface ProviderPreset {
  id: ApiProvider;
  label: string;
  defaultEndpoint: string;
  modelPresets: string[];
  defaultModel: string;
  helpText: React.ReactNode;
  apiKeyPlaceholder: string;
}

export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'minimax',
    label: 'Minimax',
    defaultEndpoint: 'https://api.minimax.io/v1',
    modelPresets: [
      'MiniMax-M3',
      'MiniMax-M3-fast',
      'MiniMax-M2.7',
      'MiniMax-M2.7-highspeed',
    ],
    defaultModel: 'MiniMax-M2.7',
    helpText: (
      <>
        OpenAI-compatible. A base URL like{' '}
        <code>https://api.minimax.io/v1</code> is fine —{' '}
        <code>/chat/completions</code> is appended automatically.
      </>
    ),
    apiKeyPlaceholder: 'Paste your Minimax API key…',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    defaultEndpoint: 'https://api.openai.com/v1',
    modelPresets: [
      'gpt-4o-mini',
      'gpt-4o',
      'gpt-4-turbo',
      'o1-mini',
      'o1',
      'gpt-3.5-turbo',
    ],
    defaultModel: 'gpt-4o-mini',
    helpText: (
      <>
        Standard OpenAI endpoint. A base URL like{' '}
        <code>https://api.openai.com/v1</code> is fine —{' '}
        <code>/chat/completions</code> is appended automatically.
      </>
    ),
    apiKeyPlaceholder: 'sk-…',
  },
  {
    id: 'local-gemma',
    label: 'Local Model (require around 2gb disk space)',
    // Placeholder endpoint — never used for fetch. Kept non-empty so
    // Settings / chat header have a stable string to display.
    defaultEndpoint: 'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm',
    modelPresets: [],
    defaultModel: LOCAL_GEMMA_MODEL_LABEL,
    helpText: (
      <>
        Free, no API key. Runs{' '}
        <code>{LOCAL_GEMMA_MODEL_LABEL}</code> in your browser with WebGPU
        (LiteRT-LM). Download the model ({LOCAL_GEMMA_SIZE_LABEL}) once from
        Hugging Face, or load a <code>.litertlm</code> file from disk. Prompts
        stay on your device. Requires a recent Chrome, Edge, or Safari with
        enough GPU memory (~1.8 GB). Predict and OCR→Markdown rewrite still
        need a keyed provider or a local HTTP server (Ollama / LM Studio).
      </>
    ),
    apiKeyPlaceholder: '(not used — no API key required)',
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    defaultEndpoint: 'http://localhost:11434/v1',
    modelPresets: [
      'llama3.2',
      'mistral',
      'qwen2.5',
      'gemma2',
      'phi3',
    ],
    defaultModel: 'llama3.2',
    helpText: (
      <>
        OpenAI-compatible local server. Default base{' '}
        <code>http://localhost:11434/v1</code> —{' '}
        <code>/chat/completions</code> is appended automatically. Model name
        must match a model you have pulled in Ollama (e.g.{' '}
        <code>ollama pull llama3.2</code>). No API key. Allow this app&apos;s
        origin in <code>OLLAMA_ORIGINS</code> so the browser can reach Ollama
        (CORS).
      </>
    ),
    apiKeyPlaceholder: '(not used — no API key required)',
  },
  {
    id: 'lm-studio',
    label: 'LM Studio (local)',
    defaultEndpoint: 'http://localhost:1234/v1',
    modelPresets: [],
    defaultModel: 'local-model',
    helpText: (
      <>
        OpenAI-compatible local server. Default base{' '}
        <code>http://localhost:1234/v1</code> —{' '}
        <code>/chat/completions</code> is appended automatically. Type the
        model id shown in LM Studio for the loaded server model. No API key.
        Enable CORS in LM Studio&apos;s local server / developer settings so
        the browser can reach it.
      </>
    ),
    apiKeyPlaceholder: '(not used — no API key required)',
  },
];

export function getProvider(id: ApiProvider | undefined | null): ProviderPreset {
  if (!id) return PROVIDERS[0];
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

/**
 * Whether the given provider requires an API key in Settings. Only the
 * cloud keyed providers return true. Keyless Local Gemma and local HTTP
 * servers (Ollama, LM Studio) return false — callers must not treat
 * "no key" as "use the in-browser Gemma engine"; use
 * `usesLocalGemmaEngine` for that branch.
 */
export function requiresApiKey(id: ApiProvider | undefined | null): boolean {
  return id === 'minimax' || id === 'openai';
}

/**
 * Whether Chat / Comment streaming should use in-browser LiteRT Local
 * Gemma instead of the OpenAI-compatible HTTP client.
 */
export function usesLocalGemmaEngine(
  id: ApiProvider | undefined | null
): boolean {
  return id === 'local-gemma';
}

/**
 * Whether the HTTP OpenAI-compatible chat path is ready: non-empty
 * endpoint, plus a key when the provider requires one. Ollama / LM
 * Studio need only an endpoint (and a model name for the request body).
 */
export function isHttpChatConfigured(
  api: Pick<ApiConfig, 'provider' | 'apiKey' | 'apiEndpoint'> | null | undefined
): boolean {
  if (!api || usesLocalGemmaEngine(api.provider)) return false;
  if (!api.apiEndpoint?.trim()) return false;
  if (requiresApiKey(api.provider) && !api.apiKey?.trim()) return false;
  return true;
}

// Provider presets for the Settings modal.
//
// Each entry bundles the per-provider defaults that the UI needs to
// show: the default endpoint, the model presets for the datalist,
// the default model, helper text, and the API-key placeholder.
//
// The two keyed providers (minimax, openai) speak the same OpenAI
// Chat Completions wire format (see src/api/chat.ts), so the request
// layer does NOT branch on `provider` for them — this config is purely
// UI / defaults metadata for that path.
//
// The third entry (local-gemma) does NOT use the OpenAI wire format
// and does NOT need an API key. ChatPanel streams via in-browser
// LiteRT-LM (WebGPU). It still appears here so it can be selected
// from the same Settings dropdown.
import type { ApiProvider } from '@/types';
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
        need a keyed provider.
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
 * Whether the given provider requires an API key in Settings. Currently
 * only `local-gemma` returns false; the two keyed providers keep
 * the existing behaviour. Callers that need to gate on this (the
 * Settings modal's API-key field, the chat panel's "needs a key" affordance,
 * the first-run onboarding auto-pop, the inline-completion hook) all
 * branch on this single source of truth instead of hard-coding the
 * keyless provider id.
 */
export function requiresApiKey(id: ApiProvider | undefined | null): boolean {
  return id !== 'local-gemma';
}

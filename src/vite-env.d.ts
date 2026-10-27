/// <reference types="vite/client" />

/** Markdown user-guide pages imported as raw strings for in-app Help. */
declare module '*.md?raw' {
  const content: string;
  export default content;
}

interface ImportMetaEnv {
  readonly VITE_DEFAULT_API_ENDPOINT?: string;
  readonly VITE_DEFAULT_MODEL?: string;
  // Default provider at build time. When unset, the app defaults to
  // `local-gemma` (Local Model). Set `minimax` or `openai` to ship a
  // keyed-provider default instead.
  readonly VITE_DEFAULT_PROVIDER?: 'minimax' | 'openai' | 'local-gemma';
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

# Build & configuration

> Every build-time and runtime configuration surface: Vite, TypeScript, Tailwind tokens, the CSP, cross-origin headers, environment overrides, npm scripts, and the Settings modal fields.

---

## 1. npm scripts

| Script | Command | What it does |
|---|---|---|
| `dev` | `vite` | Dev server on port **5174** with HMR and the COOP/COEP headers |
| `build` | `tsc -b && vite build` | Type-check, then bundle to `dist/` |
| `preview` | `vite preview` | Serve the production build, also with COOP/COEP |
| `typecheck` | `tsc -b --noEmit` | Type-check only. **The single automated gate in the repo.** |
| `postinstall` | `node scripts/sync-ocr-runtime-assets.mjs` | Prune and copy the OCR runtime assets |
| `prebuild` | same | Same, before every production build |
| `sync:ocr-assets` | same | Manual invocation |
| `test:heading-sections` | `node scripts/test-heading-sections.mjs` | Heading-section, cascade, and mention round-trip fixtures |
| `test:proposed-edit` | `node scripts/test-proposed-edit.mjs` | Anchor, Best Effort, and Apply fixtures |
| `test:graph` | `node scripts/test-graph.mjs` | Wikilink parse, graph compile, layout, camera fixtures |
| `test:chat-attachments` | `node scripts/test-chat-attachments.mjs` | Format-then-answer prompt for Chat **+** files |
| `test:local-prompt-compact` | `node scripts/test-local-prompt-compact.mjs` | Local Model comment-batch packing: one snippet copy, keep comment bodies |

There is **no lint script and no CI configuration**. `npm run typecheck` plus the three `test:*` scripts is the full quality gate.

## 2. `vite.config.ts`

### App version injection

```ts
const APP_VERSION = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')).version;

export default defineConfig({
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(APP_VERSION) },
  // …
});
```

The version is read from `package.json` at config-load time, so `package.json` is the single source of truth. The topbar, the Help header, and the Functional Specification header all read `import.meta.env.VITE_APP_VERSION`.

### Plugins

| Plugin | Purpose |
|---|---|
| `@vitejs/plugin-react` | Fast Refresh + JSX |
| `stripImportQueryPlugin` | `apply: 'serve'` only. A Connect middleware that, for URLs matching `^/ocr/`, `^/pdfjs/`, `^/ort/` that contain `?`, strips the query string so Vite's SPA fallback does not return `index.html` for a dynamically imported runtime asset. |

### Aliases

| Alias | Target | Why |
|---|---|---|
| `@` | `<root>/src` | Matches `tsconfig.app.json` `paths` |
| `/^onnxruntime-web$/` | `node_modules/onnxruntime-web/dist/ort.wasm.min.mjs` | Forces the WASM-only extern build, avoiding the WebGPU / JSEP glue |

### Server and preview

| Setting | Value |
|---|---|
| `server.port` | `5174` |
| `server.headers` | `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp` |
| `preview.headers` | Same |

> **These headers are mandatory.** Without COOP/COEP the browser does not expose `SharedArrayBuffer`, and threaded ONNX Runtime cannot start. **If OCR works in dev and fails in production, check the headers first.**

### `optimizeDeps`

```ts
optimizeDeps: {
  exclude: ['onnxruntime-web', '@paddleocr/paddleocr-js'],
  include: ['clipper-lib', 'js-yaml', '@techstark/opencv-js'],
}
```

The `include` entries are nested CommonJS dependencies that are only reachable through PaddleOCR's dynamic import; Vite's scanner does not find them on its own.

### Build

```ts
build: { chunkSizeWarningLimit: 12000 }
```

Raised because PaddleOCR's OpenCV dependency and its worker entry are each around 10–11 MB. **No `manualChunks` or explicit rollup chunking strategy is configured** — the default applies.

## 3. `index.html` and the CSP

```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:;
  font-src 'self' data:;
  connect-src 'self' data: https: http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*;
  worker-src 'self' blob:;
  child-src 'self' blob:;
  object-src 'none';
  base-uri 'self';
  form-action 'self';
" />
```

### Why each directive is what it is

| Directive | Justification |
|---|---|
| `script-src 'wasm-unsafe-eval'` | `WebAssembly.compile` for ONNX Runtime and OpenCV |
| `script-src 'unsafe-eval'` | OpenCV.js embind uses the `Function` constructor. **This is the one genuinely broad permission.** |
| `style-src 'unsafe-inline'` | React inline styles |
| `img-src data: blob:` | ObjectURLs and in-memory images from the OCR pipeline |
| `font-src data:` | Fontsource packaging |
| `connect-src data:` | OpenCV fetches its embedded WASM from a data URL |
| `connect-src https:` | The user-configured chat endpoint |
| `connect-src http://localhost:* …` | Local dev servers and websocket HMR |
| `worker-src blob:` / `child-src blob:` | ONNX and pdf.js workers |
| `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` | Baseline hardening |

> **This is a meta tag, not a header.** A meta CSP applies only to the document that carries it and cannot express `report-uri` or `frame-ancestors`. Prefer setting it as a real HTTP header. See [Testing & security](14-testing-and-security.md#7-threat-model).

Other head/body content:

- Favicon is an inline SVG data URI — a `#171614` rounded square with a `#1B4636` moss ring and pupil.
- `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />` — `viewport-fit=cover` enables the `env(safe-area-inset-*)` usage throughout the layout.
- `<meta name="theme-color" content="#F4F1EA" />`
- `<body class="h-full bg-ape-base text-cyber-primary antialiased">`
- `<div id="root" class="h-full">`

## 4. TypeScript

### `tsconfig.json` — solution file

```json
{ "files": [], "references": ["./tsconfig.app.json", "./tsconfig.node.json"] }
```

### `tsconfig.app.json`

| Option | Value |
|---|---|
| `target` / `lib` | `ES2022` / `["ES2022", "DOM", "DOM.Iterable"]` |
| `module` / `moduleResolution` | `ESNext` / `"bundler"` |
| `jsx` | `"react-jsx"` — no need to import React |
| `strict` | `true` |
| `noUnusedLocals` | `true` |
| `noUnusedParameters` | `true` |
| `noFallthroughCasesInSwitch` | `true` |
| `isolatedModules` | `true` |
| `moduleDetection` | `"force"` |
| `noEmit` | `true` |
| `baseUrl` / `paths` | `"."` / `{ "@/*": ["src/*"] }` |
| `include` | `["src"]` |

`noUnusedLocals` and `noUnusedParameters` are why dead code fails the typecheck rather than silently accumulating. They caught a leftover `defaultPage` variable during this document's own build.

### `tsconfig.node.json`

`target ES2022`, `lib ["ES2023"]`, `module ESNext`, `moduleResolution "bundler"`, `allowSyntheticDefaultImports`, `strict`, `noEmit`, `include: ["vite.config.ts"]`.

## 5. Tailwind design tokens

[`tailwind.config.cjs`](../tailwind.config.cjs)

```js
content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
darkMode: 'class',
plugins: [],
```

### 5.1 Font stacks

| Token | Stack |
|---|---|
| `sans` | `Source Sans 3`, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto |
| `serif` | `Newsreader`, Georgia, `Times New Roman` |
| `display` | Same as `serif` |
| `mono` | `IBM Plex Mono`, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas |

All three come from `@fontsource/*` packages.

### 5.2 Colour families

Three families, and each token is the **only** one the codebase uses — the aliases that accumulated during the v0.2.5 → v0.3.0 rebrand were pruned.

**`ape.*` — dark surfaces**

| Token | Value |
|---|---|
| `ape-base` | `#11171B` |
| `ape-panel` | `#1A2026` |
| `ape-elevated` | `#222932` |

**`paper.*` — light surfaces**

| Token | Value |
|---|---|
| `paper-base` | `#F4F1EA` |
| `paper-surface` | `#FFFCF8` |
| `paper-panel` | `#FFFCF8` |
| `paper-elevated` | `#EBE6DC` |
| `paper-hairline` | `#E3DDD1` |
| `paper-ink` | `#171614` |
| `paper-inkSoft` | `#5C574F` |

**`cyber.*` — shared accents**

| Token | Value | Role |
|---|---|---|
| `cyber-border` | `#2A2F35` | Borders |
| `cyber-clay` | `#1B4636` | Moss-green primary (light mode) |
| `cyber-cyan` | `#6FBF99` | Moss-green primary (dark mode) |
| `cyber-cyanSoft` | `#A8D6BB` | Hover state |
| `cyber-claySoft` | `#E5F0EA` | Primary-tinted background |
| `cyber-brickSoft` | `#F6E8E4` | Warning-tinted background |
| `cyber-brickSoftDark` | `#3D2620` | The same, for dark mode |
| `cyber-fire` | `#7A1B3D` | Crimson-purple CTA accent |
| `cyber-brick` | `#8D3A30` | Strike (brick-red) |
| `cyber-brickBright` | `#D39080` | Strike highlight |
| `cyber-danger` | `#C0432B` | Destructive |
| `cyber-warn` | `#B7791F` | Caution |
| `cyber-primary` | `rgb(var(--cyber-primary) / <alpha-value>)` | Text — flips per theme via a CSS custom property |
| `cyber-muted` | `rgb(var(--cyber-muted) / <alpha-value>)` | Same |

> `cyber-primary` and `cyber-muted` are the two **theme-aware** tokens. They are defined as CSS custom properties so `text-cyber-primary` resolves to a high-contrast colour in *both* themes without a `dark:` variant. Everything else is a literal hex, and light/dark switching happens via a `dark:` class prefix.

### 5.3 Shadows and gradients

| Token | Value |
|---|---|
| `ape-paper` | `0 1px 2px rgba(23,22,20,0.04), 0 1px 3px rgba(23,22,20,0.06)` |
| `ape-paper-lift` | `0 2px 4px rgba(23,22,20,0.06), 0 4px 8px rgba(23,22,20,0.05)` |
| `ape-glow-soft` | `0 0 6px rgba(111,191,153,0.3)` |
| `ape-fire` | `0 0 14px rgba(122,27,61,0.55), 0 0 4px rgba(75,22,64,0.7)` |
| `ape-fire-soft` | `0 0 8px rgba(122,27,61,0.35)` |
| `ape-fire` (background) | `linear-gradient(135deg, #7A1B3D 0%, #4B1640 50%, #2A0E2E 100%)` |
| `ape-fire-hover` | `linear-gradient(135deg, #8E2347 0%, #5A1B4D 50%, #321238 100%)` |

### 5.4 Theme switching

```ts
applyThemeClass(theme) → document.documentElement.classList.toggle('dark', theme === 'dark')
```

Called from three places: `main.tsx` (pre-paint), `toggleTheme` (synchronously inside `set`), and `onRehydrateStorage`.

The global `uiFontSize` is applied as `<html style="font-size">`, so every `rem`-based Tailwind text utility scales together. The editor root is pinned to `fontSize: '14px'` to opt out.

## 6. Environment variables

### Declared

`src/vite-env.d.ts`:

```ts
interface ImportMetaEnv {
  readonly VITE_DEFAULT_API_ENDPOINT?: string;
  readonly VITE_DEFAULT_MODEL?: string;
  readonly VITE_DEFAULT_PROVIDER?: 'minimax' | 'openai' | 'local-gemma';
  readonly VITE_APP_VERSION?: string;   // injected by vite.config.ts define
}
```

### `.env.example`

```bash
# Default provider for first-run (Settings always wins afterwards).
# Omit or set local-gemma for on-device Gemma; use minimax|openai for keyed deploys.
VITE_DEFAULT_PROVIDER=local-gemma
VITE_DEFAULT_API_ENDPOINT=https://api.minimax.io/v1
VITE_DEFAULT_MODEL=MiniMax-M2.7
```

### Resolution

```ts
initialProvider =
  VITE_DEFAULT_PROVIDER === 'openai'  ? 'openai'  :
  VITE_DEFAULT_PROVIDER === 'minimax' ? 'minimax' :
                                     'local-gemma'; // default and unknown values
```

The env vars seed **first-run defaults only**. The Settings modal always wins afterwards.

> **Never put an API key in `.env` as a `VITE_*` variable.** Vite embeds `VITE_*` values into the client bundle in plain text. The API key is entered in Settings and lives in `localStorage` or `sessionStorage`. See `SECURITY.md`.

The threat model, including the residual-risk table, is in [Testing & security §7](14-testing-and-security.md#7-threat-model).

### `postcss.config.cjs`

```js
module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

## 7. Settings modal fields

| Field | Control | Range / behaviour |
|---|---|---|
| **Provider** | `<select>` over `PROVIDERS` | Switching **auto-swaps** the endpoint and model to the new preset's defaults. The API key is deliberately **not** touched. |
| **API key** | `<input type="password">` with Show/Hide | Only rendered when `requiresApiKey(provider)`. `autoComplete="off"`, `spellCheck={false}` |
| **Forget API key when this tab closes** | checkbox | Drives `setPersistApiKey` → `sessionStorage` |
| **API endpoint** | `<input>` | Placeholder = `preset.defaultEndpoint`; help text = `preset.helpText` (keyed only) |
| **Model** | `<input list="mvp-model-list">` + `<datalist>` | Datalist from `preset.modelPresets` (keyed only) |
| **Local Model controls** | `LocalGemmaControls` | Download / Load from disk / Save to Disk / Clear / Last saved / progress tips |
| **Debug Mode** | `role="switch"` with `aria-checked` | — |
| **UI font size** | `<input type="range">` + **Reset** | `12`–`20`, step 1. `DEFAULT_UI_FONT_SIZE = 14`. Reset disabled at 14 |
| **System message** | textarea + bottom `ResizeHandle` | **Only when Debug Mode is on.** Height `100`–`600`. **Reset** → `DEFAULT_SYSTEM_MESSAGE` |
| **Rationale rules** | textarea + bottom `ResizeHandle` | **Only when Debug Mode is on.** Placeholder "Leave empty to use the built-in default" |
| **Temperature** | `<input type="range">` | **Only when Debug Mode is on.** `min=0`, `max=2`, `step=0.05` |

Footer **Cancel** / **Save**. `save()` runs `setPersistApiKey` → `setApi({...})` → `setUiFontSize` → `onClose()`.

### Sizing

`DEFAULT_SETTINGS_SIZE = { w: 520, h: 620 }`, with CSS `max-w-lg max-h-[min(90vh,90dvh)]`. Bounds are the `MIN/MAX_SETTINGS_*` constants, further clamped to `min(MAX, window.innerWidth - 32)` and `min(MAX, window.innerHeight - 32)`. Eight resize handles.

Sizes persist under `SETTINGS_SIZE_KEYS`. `loadSize` accepts **both** the modern `{w,h}` and the older `{width,height}` shapes and rejects out-of-bounds values. The two prompt textareas persist `{w: 0, h}` — only `h` is read back.

### Prompt round-trip

On **open**, the textareas are seeded with `normalizeSystemMessage(api.systemMessage) ?? DEFAULT_SYSTEM_MESSAGE`, so the field always shows the **live active prompt**, not a stale stored copy. If a stale built-in is detected, `setApi({ systemMessage: undefined })` is called immediately, dropping it. On **Save**, both are re-normalised so the built-in round-trips back to `undefined`.

## 8. Deployment

### `vercel.json`

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
        { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" }
      ]
    }
  ]
}
```

Nothing else — no builds, rewrites, or functions. The app is a pure static SPA.

### `.gitignore`

```
node_modules
dist
.DS_Store
*.log
.env
.env.local
tsconfig.app.tsbuildinfo
tsconfig.node.tsbuildinfo
*.tsbuildinfo
.cursor/
```

## 9. Local development

```bash
npm install        # also runs the OCR asset sync
npm run dev        # http://localhost:5174
```

There are **no unit tests and no mock server**. To exercise the chat path you need a real key in Settings, or Local Model with WebGPU and a downloaded/cached `.litertlm`. The `test:*` scripts cover the pure logic without any key.

To measure prompt size without spending tokens:

```bash
npx vite-node scripts/measure-prompt.ts
```

## 10. Invariants and gotchas

| # | Invariant |
|---|---|
| 1 | COOP/COEP headers must exist in **dev**, **preview**, and **production**, or threaded ONNX fails to start. |
| 2 | The `onnxruntime-web` alias to `ort.wasm.min.mjs` must stay. Removing it pulls in the WebGPU/JSEP glue and ~69 MB. |
| 3 | `VITE_APP_VERSION` is injected by `define`, not by a `.env` file. Do not add a duplicate declaration. |
| 4 | Never add an API key to a `VITE_*` env var. |
| 5 | `applyThemeClass` toggles `html.dark`; `darkMode: 'class'` in Tailwind depends on it. |
| 6 | `cyber-primary` / `cyber-muted` are the only theme-aware tokens. New colour tokens need a matching `html.dark` rule in `index.css` if they are not one of these two. |
| 7 | `content` in `tailwind.config.cjs` must include every directory containing class names. Adding a new top-level source folder means updating this array. |
| 8 | Bounds constants live in `useDragResize.ts` and are imported by consumers. Change a bound in one place. |
| 9 | `noUnusedLocals` and `noUnusedParameters` are on. Run `npm run typecheck` before assuming a change compiles. |
| 10 | `sync:ocr-runtime-assets.mjs` runs on `postinstall` **and** `prebuild` and must keep its prune step. |

## 11. Next

- Where the same values are defined at runtime → [State & persistence §9](04-state-and-persistence.md#9-defaults)
- Test coverage and the threat model → [Testing & security](14-testing-and-security.md)
- Recipes → [Maintenance guide](15-maintenance-guide.md)
# Import & export

> The two places where bytes enter or leave ApEditor. Import runs recognition **entirely in the browser** and then asks the model to rewrite the result as Markdown. Export writes the document out as `.md`, or a versioned `.json` backup.

---

## 1. Two pipelines, one button

[`FileActionsButton.tsx`](../src/components/FileActionsButton.tsx) owns a single popover with three sections:

1. **Import photos / PDFs** — recognition plus Markdown rewrite.
2. **Export this document** — `.md`.
3. **Export full backup (JSON)** — `.json`.

> The component was renamed from `ImportMediaButton.tsx` in v0.5.0 when export was added. Old references in comments and docs still mention the old name.

### Popover geometry

| Constant | Value |
|---|---:|
| `POPOVER_WIDTH` | `288` (`w-72`) |
| `VIEWPORT_PAD` | `8` |

`clampPopoverToViewport` positions with `fixed` coordinates measured from the toggle, prefers right-aligning to the button, flips above when it would overflow the bottom, and re-applies on `resize`, `orientationchange`, and capture-phase `scroll`.

## 2. Import

### 2.1 Accepted formats

| Type | Detection | Path |
|---|---|---|
| PDF | `mime === 'application/pdf'` **or** a filename ending `.pdf` (case-insensitive) | PDF path |
| Image | `mime.startsWith('image/')` **or** `mime === ''` | Image path |
| Anything else | — | Returns `''` with the progress label `unsupported file type for <name>: <mime>` |

The file input is `accept="image/*,application/pdf"` with `multiple`. Mixed batches are processed in order.

### 2.2 Limits

| Constant | Value | Scope |
|---|---:|---|
| `OCR_MAX_FILE_BYTES` | `50 * 1024 * 1024` | One file |
| `OCR_MAX_BATCH_BYTES` | `200 * 1024 * 1024` | One batch |
| `OCR_MAX_PDF_PAGES` | `500` | One PDF |
| Longest image edge | `2000` px | Resize before OCR |

`validateOcrBatch(files)` returns the **first** violation string, or `null`:

```
"<name> is <size> — limit is <limit>. Compress it or split it before re-importing."
"Batch is <total> — limit is <limit>. Import fewer files at once."
"<name> has <n> pages — limit is 500. Try splitting it or selecting a section."
```

`formatOcrSize(bytes)` renders MB with one decimal at or above 1 MB, whole KB below.

Page count is validated inside `extractFromPdfFile` rather than in the batch validator, because it requires reading the PDF header and would otherwise mean a second full read.

### 2.3 Languages

```ts
LANG_OPTIONS = [
  { code: 'eng',     label: 'English' },
  { code: 'chi_sim', label: 'Simplified Chinese' },
  { code: 'chi_tra', label: 'Traditional Chinese' },
]
```

The default selection is `new Set(['eng'])`. **The last remaining checked box is disabled** — the set cannot be cleared to zero. `extractTextFromFiles` additionally throws `'At least one OCR language must be selected.'` when the array is empty.

### 2.4 The engine

`getEngine` lazily creates a **module-level singleton** (`enginePromise`):

```ts
PaddleOCR.create({
  ortOptions: {
    wasmPaths: '/ort/',
    backend: 'wasm',
    numThreads: clamp(navigator.hardwareConcurrency || 2, 1, 4),
    simd: true,
  },
  textDetectionModelAsset:    { url: '/ocr/PP-OCRv6_tiny_det.tar' },
  textRecognitionModelAsset: { url: '/ocr/PP-OCRv6_tiny_rec.tar' },
  ocrVersion: 'PP-OCRv6',
  textDetectionModelName:    'PP-OCRv6_tiny_det',
  textRecognitionModelName:  'PP-OCRv6_tiny_rec',
})
```

`backend: 'wasm'` is not optional — it keeps the WebGPU variants out of the bundle entirely.

### 2.5 The PDF path

```
loadPdfFromBytes(bytes)  → pdf.js getDocument({ data, disableAutoFetch: true, disableStream: true, isEvalSupported: false })
  per page:
    pageHasNativeText(page)          → items joined, length >= 2
      true  → pageNativeText(page)    (no OCR)
      false → renderPageToCanvas(page, scale = 2.0) → PaddleOCR
    pages joined with '\n\n'
```

Text-native PDFs are read directly and never rasterised — that is the common case and it is fast.

`isEvalSupported: false` is a deliberate security measure: it stops pdf.js from compiling expressions from the document.

### 2.6 The image path

`imageFileToResizedCanvas(file, 2000)` decodes via an ObjectURL, computes a scale so the **longest edge is at most 2000**, and draws to a canvas. Errors: `failed to decode <name>`, `empty image: <name>`, `Canvas 2D context unavailable.`

### 2.7 Cleanup contract

Documented at the top of [`utils/ocr.ts`](../src/utils/ocr.ts), and it is a security property, not a nicety:

1. ObjectURLs revoked in `finally`, guarded by a `urlRevoked` flag so a returned canvas is never double-revoked.
2. `<img>` pixel buffers released via `img.src = ''`.
3. `<canvas>` backing buffers released via `canvas.width = 0; canvas.height = 0`.
4. `pdf.destroy()` in `finally`.
5. `page.cleanup()` per page in `finally`.
6. The PaddleOCR engine is module-level and persists for the tab's lifetime — models are loaded once.
7. Only the recognised **text string** survives. No binary image data is retained in app state.

One file failing does not kill the batch: each file is caught individually and contributes `''`.

### 2.8 The Markdown rewrite

Recognition alone gives you a wall of unstructured lines. `formatOcrAsMarkdown(raw, api, options?)` in [`utils/ocrMarkdown.ts`](../src/utils/ocrMarkdown.ts) streams the text through the configured model.

`OCR_MARKDOWN_SYSTEM_PROMPT` requires: preserve meaning and facts, repair recognition artefacts, use Markdown structure, output **only** Markdown, and never emit `<think>`, ```` ``` ````, or `<reasoning>`.

The user message wraps the text:

```
--- BEGIN EXTRACTED TEXT ---
<raw>
--- END EXTRACTED TEXT ---
```

| Detail | Value |
|---|---|
| Message ids | `ocr-md-sys`, `ocr-md-user` |
| Temperature | `min(api.temperature, 0.3)` — lowered |
| Transport | `streamChatCompletion` — the same path as chat |
| `stripThinkBlocks` | Removes complete `<think>…</think>` and `<reasoning>…</reasoning>` (global, case-insensitive), then **truncates at any unclosed opener** |
| `unwrapImportedMarkdown` | Strips an accidental outer fence matching `/^```(?:markdown\|md)?\r?\n([\s\S]*?)\r?\n```$/i` |
| Errors | `'Nothing to format — the import produced no text.'` / `'The model returned empty Markdown. Try again or check Settings.'` |

> **This is why import needs an API key** even though OCR does not. The import popover shows a contextual paragraph explaining exactly that, which flips to a cyan "Key configured" state once a key exists.

### 2.9 Insertion

After the rewrite:

```ts
window.dispatchEvent(new CustomEvent('mvp:insert-text', { detail: { text: markdown } }));
```

`Editor.tsx` listens and splices the Markdown **at the caret**, or appends to the end if the textarea was never interacted with, then restores the caret past the inserted text.

## 3. Assets

| Path | Size | Source |
|---|---:|---|
| `public/ocr/PP-OCRv6_tiny_det.tar` | 1,792,000 B | `@paddleocr/paddleocr-js` |
| `public/ocr/PP-OCRv6_tiny_rec.tar` | 4,526,080 B | `@paddleocr/paddleocr-js` |
| `public/ort/ort-wasm-simd-threaded.wasm` | 14,239,897 B | `onnxruntime-web/dist` |
| `public/ort/ort-wasm-simd-threaded.mjs` | 24,381 B | `onnxruntime-web/dist` |
| `public/pdfjs/pdf.worker.min.mjs` | 1,375,838 B | `pdfjs-dist/build` |

### `scripts/sync-ocr-runtime-assets.mjs`

Runs on **`postinstall`**, **`prebuild`**, and manually via `npm run sync:ocr-assets`.

```js
ORT_FILES = ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs'];
PDF_WORKER = 'pdf.worker.min.mjs';
```

It `mkdirSync`s the destination, asserts each source exists (`missing source file: <path> (run npm install)`), copies, then **deletes anything in the destination not in the keep set**.

> **Why the pruning matters.** The WebGPU, Asyncify, and JSPI ONNX variants total roughly 69 MB and are never loaded. Leaving them in `public/` would count against Vercel's Hobby-tier deployment storage on **every** build.

`vite.config.ts` also aliases `onnxruntime-web` to `node_modules/onnxruntime-web/dist/ort.wasm.min.mjs`, so the WASM-only build is what the bundler sees. A dev-only Connect middleware, `stripImportQueryPlugin`, strips query strings from `/ocr/`, `/pdfjs/`, and `/ort/` requests so Vite's SPA fallback does not return `index.html` for a dynamically imported runtime asset.

## 4. Export

### 4.1 Markdown

```ts
sanitizeFilename(currentDoc.title, 'untitled') + '.md'
downloadTextFile(filename, currentDoc.content, 'text/markdown;charset=utf-8');
```

Content is the **live document only** — no comments, chat, or revisions.

### 4.2 JSON backup

```ts
const backup = buildDocumentBackup({
  documentId, documents, commentsByDoc, chatsByDoc, revisionsByDoc,
  appVersion: import.meta.env.VITE_APP_VERSION ?? 'unknown',
});
downloadTextFile(`${base}.json`, serialiseDocumentBackup(backup), 'application/json;charset=utf-8');
```

### `sanitizeFilename(name, fallback = 'untitled')`

Replaces the character class `[\\/:*?"<>|\u0000-\u001f]` with a space, collapses whitespace, trims, and **caps at 80 characters**. Falls back to `untitled`.

> No timestamp is added. The filename is stable across exports, so the browser will offer `…(1).md` rather than an accumulating set of dated copies.

### `downloadTextFile(filename, content, mime)`

`Blob` → `URL.createObjectURL` → a hidden `<a rel="noopener" style="display:none">` appended to `document.body` → `click()` → cleanup on `setTimeout(..., 0)` that removes the anchor and revokes the URL. No-ops when `document` or `URL` is undefined; all errors are swallowed.

### Backup schema

[`utils/backup.ts`](../src/utils/backup.ts):

```ts
export const BACKUP_SCHEMA = 'apeditor-document-backup';
export const BACKUP_VERSION = 1;

export interface DocumentBackup {
  schema: 'apeditor-document-backup';
  version: 1;
  exportedAt: number;      // Date.now()
  appVersion: string;      // VITE_APP_VERSION ?? 'unknown'
  document: DocumentRecord;
  comments: Comment[];     // [] when none — always present
  chats: ChatMessage[];    // [] when none
  chatArchives: ArchivedChat[]; // [] when none; omitted on older files
  revisions: Revision[];   // [] when none
}
```

Parse still accepts older v1 files that omit `chatArchives` and treats the field as `[]`. A present non-array is rejected.

| | |
|---|---|
| Serialisation | `serialiseDocumentBackup(backup)` → pretty-printed JSON with a replacer that drops `apiKey` / `authorization`-style keys. The download path then runs `scrubLiveSecretFromExport` so the live Settings key cannot appear in the file. |
| Unknown document | `buildDocumentBackup` returns `null` |
| Round-trip? | **Yes.** `parseDocumentBackup` is the inverse: a v1 payload produced today can be re-imported losslessly. See §5. |
| Button | `data-backup-toggle`, labelled **Export .json** |

> **Treat backup files as sensitive.** They contain document content, comments, and chat history. See [Testing & security](14-testing-and-security.md#7-threat-model).

## 5. Import

The backup round-trip counterpart to §4.2 — a v1 `DocumentBackup` produced by `serialiseDocumentBackup` can be parsed and merged into the live store through a new "Import full backup (JSON)" section in the same `FileActionsButton` popover. The popover catalogue is now:

1. **Import photos / PDFs** — recognition plus Markdown rewrite.
2. **Export this document** — `.md`.
3. **Import full backup (JSON)** — restore a `.json` file.
4. **Export full backup (JSON)** — `.json`.

### 5.1 Detection + limits

| Constant | Value | Scope |
|---|---:|---|
| `BACKUP_MAX_FILE_BYTES` | `50 * 1024 * 1024` | One file |

Validating the file size before `File.text()` avoids materialising a multi-MB string in memory just to reject it.

### 5.2 The pipeline

```
hidden <input type="file" accept="application/json,.json">
  → onChange handler in FileActionsButton.onBackupFile:
      1. Check file.size against BACKUP_MAX_FILE_BYTES. Over-cap →
         "<name> is <size> MB — limit is 50 MB. Compress it or split it
          before re-importing." (popover stays open).
      2. Read text with File.text(). Read failure → inline error.
      3. parseDocumentBackup(text) — throws BackupParseError on any
         structural problem (see §5.3).
      4. resolveImportDecisions({ parsed, documents }) — produces an
         ImportDecision[] of length 1 (v1 backups are single-doc).
      5. Branch:
           default-only path (no collision OR explicit choice matches
           auto-default): apply via the store and close the popover.
           otherwise: open the collision-resolution modal (§5.5).
```

### 5.3 Parsing and validation

[`parseDocumentBackup(raw)`](../src/utils/backup.ts) walks every slice and rejects any of:

| Condition | Error message |
|---|---|
| `JSON.parse` throws | `Could not parse the file as JSON: <browser message>` |
| Root is not an object | `Backup root is not an object` |
| `schema !== 'apeditor-document-backup'` | `This file is not an ApEditor backup (expected schema "apeditor-document-backup", got "<…>").` |
| `version !== BACKUP_VERSION` | `Unsupported backup version <n>. This build only imports version <v>.` |
| Any required string field missing or wrong type | `Backup is missing or has an invalid string field: <key>` |
| Any required number field missing or non-finite | `Backup is missing or has an invalid number field: <key>` |
| Any required boolean field missing or wrong type | `Backup is missing or has an invalid boolean field: <key>` |
| Identity-bearing string field (`id`, `documentId`) empty | `Backup is missing or has an invalid non-empty string field: <key>` |
| A comment belongs to a different `documentId` than the parent document | `Backup is inconsistent: comment <id> belongs to document "<…>", not "<…>".` |
| A revision belongs to a different `documentId` than the parent document | `Backup is inconsistent: revision <id> belongs to document "<…>", not "<…>".` |
| A comment's top-level `(start, end)` does not mirror its latest round | `Backup is inconsistent: comment <id> top-level range (<s>, <e>) does not mirror its latest round (<s'>, <e'>).` |

Identity-bearing fields (`id`, `documentId`, `kind`) reject the empty string because a missing/empty value would silently mis-link a record; `body`, `snippet`, `content`, `label`, `title` accept the empty string (a brand-new doc from `makeDoc` legitimately has empty content).

### 5.4 Round-trip contract

`buildDocumentBackup → serialiseDocumentBackup → parseDocumentBackup` produces a `ParsedDocumentBackup` whose `document` / `comments` / `chats` / `chatArchives` / `revisions` are deep-equal to the live state at export time (modulo the renumbered-rounds / migrated-shape work the comment restore-path may add via `reattachCommentToRange`). `npm run test:backup-roundtrip` covers:

- Round-trip of a populated backup with comments / chats / chatArchives / revisions
- Empty-slice round-trip (`[]` not `undefined`)
- Missing `chatArchives` on an older v1 file parses as `[]`
- `buildDocumentBackup` returns `null` for unknown `documentId`
- Every error path in §5.3
- `resolveImportDecisions` per-strategy behaviour
- `buildKeepBothDocument` title sanitisation + 80-char cap

### 5.5 Collision resolution

`resolveImportDecisions({ parsed, documents })` produces a single `ImportDecision` per `DocumentBackup` (length 1; future `WorkspaceBackup` slices will grow this) with three legal strategies:

| Strategy | Effect |
|---|---|
| `replace` | Overwrite `documents[id]` in place; replace the `comments[id]`, `chats[id]`, `chatArchives[id]`, `revisions[id]` slices wholesale. Default when the file's id collides with an existing local doc. |
| `skip` | Drop the import payload silently; return `null`. The doc never lands. |
| `keep-both` | Mint a fresh uuid, copy the `document` under it with title `${title} (imported)` (after `sanitizeFilename`, reserving 11 chars for the suffix so the marker is always visible), and store the comment / chat / archive / revision slices under the new id. Default when the file's id does not collide. |

The collision-resolution modal lists every importable row with a `Select`:

- Header: `Import backup`
- Description: `One document in this backup. Choose what to do with it:`
- Per-row body: title, collision note (`A document with this id already exists locally.` vs. `New id; will land under a fresh id with (imported) in the title.`), and the dropdown
- Footer: `Cancel` / `Apply` (Apply is disabled iff every row is `Skip`)

The popover stays open while the modal is shown — clicking outside closes the popover but never the modal, and the modal's only exits are Cancel / Apply. Apply resolves via `resolveImportDecisions({ userChoices })` so any untouched rows keep their auto-default, then runs each plan through the store's `applyImportPlan` action and switches to the first successfully-imported doc.

### 5.6 The store action

`StoreState.applyImportPlan(plan: ImportPlan): { importedId: string | null }` is the only writer. It lives next to the document actions in [`store.ts`](../src/store/store.ts):

| Strategy | Mutation |
|---|---|
| `replace` | `documents[id] ← plan.document`; `comments[id]`, `chats[id]`, `chatArchives[id]`, `revisions[id]` replaced wholesale. If `id` is new (no prior local doc), the new doc lands at the top of `documents[]`. |
| `skip` | No-op; returns `{ importedId: null }`. |
| `keep-both` | New uuid via `buildKeepBothDocument({ newId, sourceTitle, sourceContent, sourceCreatedAt, sourceUpdatedAt })`. Prepends to `documents[]` so the new doc lands at the top, the same convention `createDocument` uses. `comments[newId]`, `chats[newId]`, `chatArchives[newId]`, `revisions[newId]` are written. |

The store does NOT auto-switch to the imported document — `FileActionsButton.onImportApply` calls `setCurrentDocument(firstImportedId)` after the loop so the editor moves over to the imported doc.

## 6. The OCR-vs-key gate

The import popover shows a contextual paragraph under the language checker so the user always knows which path they are on.

**No key configured:**

> OCR works without an API key. Adding one in Settings lets the recognised text be rewritten as Markdown before insertion. Without a key, raw text is inserted as-is.

**Key configured** (cyan):

> Key configured. Files are OCR'd locally and rewritten as Markdown via your model before insertion.

The import action itself is gated: without a key it raises `'Open Settings and add an API key so imported text can be formatted as Markdown.'`

## 7. Invariants and gotchas

| # | Invariant |
|---|---|
| 1 | OCR makes **zero network calls**. All models, the ONNX WASM, and the pdf.js worker come from `public/`. |
| 2 | `backend: 'wasm'` and the `ort.wasm.min.mjs` alias keep the WebGPU variants out. Changing either reintroduces ~69 MB. |
| 3 | Every cleanup step in §2.7 must stay in its `finally` block. |
| 4 | PaddleOCR is a module-level singleton — do not instantiate per call. |
| 5 | The Markdown rewrite is the only part of OCR import that needs a key. Do not gate the whole flow on it. |
| 6 | `mvp:insert-text` inserts **at the caret**, and the caret is restored past the inserted text. |
| 7 | The file input is reset to `''` in a `finally` (both the OCR input and the backup input) so the same files can be re-picked. |
| 8 | `sync-ocr-runtime-assets.mjs` must keep its prune step. It runs on every install and every build. |
| 9 | `sanitizeFilename` caps at 80 characters and adds no timestamp. |
| 10 | `DocumentBackup` v1 is **bidirectional**. The `version` field must remain a single source of truth; future versions bump it and refuse any non-matching payload. |
| 11 | Backup imports **never silently overwrite**. Every collision is resolved through the per-row modal before any `applyImportPlan` runs. |
| 12 | `buildKeepBothDocument` reserves 11 chars for the `(imported)` suffix so the marker is always visible regardless of source title length. |

## 8. Next

- The rewrite's transport → [AI chat & prompts](07-ai-chat.md)
- Build and asset configuration → [Build & configuration](13-build-and-config.md)
- The threat model → [Testing & security](14-testing-and-security.md)
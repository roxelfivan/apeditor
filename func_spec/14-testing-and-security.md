# Testing & security

> The three executable test harnesses, what they actually cover, and the current threat model.

---

## 1. Testing philosophy

ApEditor has **no test framework dependency and no CI suite**. Verification is three hand-rolled Node scripts that:

1. Bundle the **real** source files with `esbuild` (platform `node`, target `node18`, format `esm`).
2. Stub out `react` and `@/store/useStore` with trivial modules, so hooks and store-dependent code can be imported in plain Node.
3. Alias `@` → `<ROOT>/src`.
4. Dynamically import the bundle and assert with `node:assert/strict`.
5. Print `ok` / `FAIL` per case and set `process.exitCode = 1` on failure.
6. Clean up their temp directory.

What this buys: the tests run against the actual modules with **zero** transpile step and **zero** mocking of the code under test. What it costs: no coverage reporting, no watch mode, and every run bundles from scratch.

### Running them

```bash
npm run typecheck            # the primary gate
npm run test:heading-sections
npm run test:proposed-edit
npm run test:graph
npm run test:backup-roundtrip
npm run test:chat-archive
npm run test:chat-attachments
npm run test:send-comments-tdz
```

---

## 2. `scripts/test-graph.mjs`

```bash
npm run test:graph
```

13 cases across four groups.

### Wikilink parsing and resolution

| # | Case | Asserts |
|---|---|---|
| 1 | `skips mention sentinels` | `\u200B[[mention:abc|doc|Ideas\|\|ideas-id\|context\|]]\u200B and [[real-term]]` yields exactly **1** link, target `real-term` |
| 2 | `parses alias and heading fragment` | `[[Ideas#Just write\|the ideas page]]` → target `Ideas`, heading `Just write`, alias `the ideas page` |
| 3 | `preview formats wikilinks without brackets` | `[[Ideas]]` / `[[Page#Heading\|label]]` / `[[orphan]]` → purple `<span class="wiki-link">` labels; no `[[` / `]]` left |
| 4 | `preview skips mention sentinels` | mention sentinel text preserved; only `[[term]]` becomes a span |
| 5 | `resolves matching document title` | `{ kind: 'document', documentId: 'ideas' }` |
| 6 | `dangling [[word]] is a term slug` | `{ kind: 'term', slug: normalizeWikiSlug('photosynthesis') }` |

Case 1 is the regression guard for the `mention:` filter that keeps comment sentinels out of the graph. Cases 3–4 cover Preview display (v0.5.5).

### Graph compilation

| # | Case | Asserts |
|---|---|---|
| 7 | `resolved wikilink + dangling term + heading tree` | `doc:welcome`, `doc:ideas`, `term:orphan-term` nodes exist; a heading node labelled `Start`; wikilink edges to `doc:ideas` and to `term:orphan-term`; a `heading`-kind edge `alpha → beta` inside `Ideas` |
| 8 | `comment @ mention becomes an edge` | a full comment fixture with one round holding a `{ kind: 'doc', documentId: 'ideas' }` mention produces `{ kind: '@', source: doc:welcome, target: doc:ideas }` |
| 9 | `splitHeadingPath` | `Comment > annotate` → `['Comment','annotate']`; `Predict → sentence suggestion` for the `→` separator |
| 10 | `path titles nest under a shared parent` | two `Comment > …` and two `Predict > …` headings produce **exactly one** node per prefix, four `heading` edges from them, and **no** edge directly from `doc:ideas` to the `annotate` leaf |

### Camera

| # | Case | Asserts |
|---|---|---|
| 11 | `zoom boxes shrink toward the center` | `zoomedViewBox(-100,-50,200,100,2)` → `{ w: 100, h: 50, x: -50, y: -25 }`; `clampGraphZoom(99) === 4`; `clampGraphZoom(0) === 0.5`; `stepGraphZoom(1,1) > 1`; `stepGraphZoom(1,-1) < 1` |

### Layout

| # | Case | Asserts |
|---|---|---|
| 12 | `node bullets are at least double the original size` | `nodeRadius` document `36`, heading-hub `26`, heading `20`, term `16` |
| 13 | `document clusters stay apart` | hub-to-hub distance `> 280` |
| 14 | `Welcome H1/H2 ring does not collapse` | with `# Welcome to ApEditor` plus ten `##` sections: **every** node pair `>= 150` apart; H1 + exactly 10 H2s found; min H2→H1 radius `> 180`; **`countProperEdgeCrossings(laid, headingEdges) === 0`** |
| 15 | `wikilink satellites stay on heading rays` | a 3-document workspace asserts `0` heading-edge crossings and that the satellite hub sits `> 280` from the nucleus |

Cases 12–15 are the regression guards for Graph layout polish through v0.5.5.

---

## 3. `scripts/test-proposed-edit.mjs`

```bash
npm run test:proposed-edit
```

7 cases against the real [`utils/proposedEdit.ts`](../src/utils/proposedEdit.ts) — `findEditAnchor`, `findBestEffortAnchor`, `expandBestEffortRange`, `prepareBestEffortReplace`, `applyEdit`, `applyAllEdits`, `BEST_EFFORT_COVERAGE_MIN`.

| # | Case | Asserts |
|---|---|---|
| 1 | Exact wins when the quote matches | Exact anchoring is preferred over Best Effort |
| 2 | Best Effort expands toward the full section body | The shared chunk expands to the section, **and the `##` heading stays outside the hole** |
| 3 | An under-covered match is never freely applyable | Result is `null` **or** dup-blocked |
| 4 | No double-printed heading | `prepareBestEffortReplace` produces exactly one `## Intro` |
| 5 | Overlap-prepare grows the hole | `Leftover original closing` is absorbed |
| 6 | `expandBestEffortRange` grows a mid-section chunk | — |
| 7 | `applyAllEdits` mixes Exact and Best Effort | Both paths apply in one call |

Case 3 is the most important one in the repo: it is the guard against ApEditor silently mangling a user's document.

---

## 4. `scripts/test-heading-sections.mjs`

```bash
npm run test:heading-sections
```

The largest suite. A richer `eq()` / `group()` harness with green/red output and a final `All N checks passed.` / `X of N checks failed.` summary, exiting `0` or `1`.

### Heading detection

| Group | Asserts |
|---|---|
| Indentation | 1-space, 4-space, and tab-indented `#` are **not** headings |
| ATX basics | `#` through `######` are detected with the right levels |
| ATX trailing hashes | `## Title ##` is a level-2 heading titled `Title` |
| Too many hashes | A 7-hash prefix is not a heading |
| Setext | `Title\n=====` is an H1 |
| **Bug 2** | A setext underline immediately after an ATX heading does **not** steal the body or create a phantom L1 |
| Setext after a blank line | Detected normally |
| Preamble | Content before the first heading is skipped |
| Empty preamble | Not emitted as a section |

### Section fallbacks

| Group | Asserts |
|---|---|
| No headings | Blank-line blocks become `level: 0` sections |
| Empty document | 0 sections |
| Whitespace-only document | 1 section titled `(empty)` |

### Selection and offsets

| Group | Asserts |
|---|---|
| `sectionsMatchingSelection` | Correct section chosen for a caret position |
| `buildParagraphs` | Paragraph offsets align with the split-on-`\n` rule |

### Cascade

`descendantSectionIndexes`:

| Asserts |
|---|
| H2 → its H3/H4/H5 children |
| H1 → its H2 children |
| `level: 0` never cascades |
| Out-of-range index → `[]` |
| Tick and untick round-trip |
| A realistic nested "Collateral Full Memo" structure |

### Mention round-trips

`plainTextDiff`: insert, delete, replace, empty, identical, append, fully different.
`parseRawWithMentions` / `serializeRawWithMentions`: prose-only; one mention mid-prose; two mentions; a 47-paragraph real-world reproduction; inline-caption + ZWSP strip-on-serialise (round-trip must be **byte-identical and idempotent**); and the two range-diff behaviours — **deleting the ZWSP drops the mention**, while **editing inside the caption preserves it**.

---

## 5. `scripts/measure-prompt.ts`

```bash
npx vite-node scripts/measure-prompt.ts
```

Not a test — a **measurement**. Five scenarios over `buildRequestMessages` and `REFERENCED_DOCS_TOTAL_CHARS_CAP`. Token estimate is `ceil(chars / 4)`. It prints character and token counts for each scenario and asserts by logging:

| # | Scenario | Expected |
|---|---|---|
| 1 | Plain chat | 0 referenced-doc messages |
| 2 | Self-reference | 0 — the current document is suppressed |
| 3 | Comment batch + 2 referenced docs | Cross-reference map emitted with the `u1-comments-xref` prefix; both `sys-referenced-doc-` messages present |
| 4 | Section + whole-doc mention of the **same** document | **2** referenced-doc messages — the composite dedupe key keeps both |
| 5 | 3 large documents | The trailing document is downgraded to the outline |

Run this after touching `buildRequestMessages`, `buildDocOutline`, or the referenced-doc budgets.

## 6. What is **not** covered

Honest list. If you add tests, these are the gaps with the highest value:

| Gap | Risk |
|---|---|
| The SSE loop in `streamChatCompletion` | Malformed frames, mid-stream aborts |
| `redactSecretsInMessages` | A missed pattern leaks a key into a prompt |
| The OCR / pdf.js pipeline | Browser-only; hard to unit test, but the cleanup contract is worth extracting and asserting |
| Store rehydrate migrations | A bad migration silently corrupts user data |
| `getSelectionRect` and `clampToContainer` | Geometry; needs a DOM environment |
| `CommentLayer.buildSegments` | The ends-before-starts sort is subtle |
| `Editor` / `ChatPanel` behaviour | Would need a component test framework, which the repo deliberately does not have |

> The repo's stance is that pure logic is unit-testable via esbuild bundling, and UI behaviour is verified by hand. That is a deliberate trade, not an oversight.

---

## 7. Threat model

Framed in `SECURITY.md` as v0.5.3, local-first, **no backend** — the browser talks directly to the configured endpoint.

### 7.1 Repository hygiene

- No `.env` or `.env.local` is committed; only `.env.example` with public endpoint and model strings.
- No hardcoded keys anywhere.
- `VITE_*` is limited to endpoint, model, provider, and version.
- **Explicit warning:** do not put API keys in `.env` as `VITE_*` values — Vite embeds them into the client bundle in plain text.

### 7.2 Residual risks

| Severity | Risk | Status |
|---|---|---|
| **High** | Stored XSS via `rehype-raw` without sanitisation would steal the API key from `localStorage` | **Mitigated** — `rehype-sanitize` runs after `rehype-raw`, allowing only `<u>` beyond the default schema |
| **High** | API key stored in plaintext in `localStorage` | **By design** — opt-in `sessionStorage` via "Forget API key when this tab closes"; a local proxy or passphrase-wrapped Web Crypto would be the next step; avoid shared browsers |
| **Medium** | Bearer token sent to any user-typed URL | **Mitigated** — HTTPS required, `http://localhost` allowed; an endpoint allowlist would be better |
| **Medium** | The full document is sent to the model each turn | **Mitigated** — opt-in "selection only" omits the outline; the selection is delimited by `BEGIN/END EDITOR SELECTION`; outbound prompts redact common key shapes; comment **Send to AI** still includes a compact outline; archived chats are excluded from the live `chats` array used on send |
| **Medium** | No host-level CSP beyond the meta tag | **Open** — prefer HTTP headers; Vercel already sends COOP/COEP via `vercel.json` |
| **Medium** | OpenCV.js embind requires `'unsafe-eval'` | **Required** by PaddleOCR. The `ort.wasm.min.mjs` alias keeps the WebGPU/JSEP glue — which also uses `new Function` — from ever loading, and `connect-src` allows `data:` |
| **Medium** | No size or page caps on import | **Mitigated** — 50 MB per file, 200 MB per batch, 500 PDF pages |
| **Low** | Backup JSON reveals content and chat | Accepted — versioned `DocumentBackup` (`schema: 'apeditor-document-backup'`, `version: 1`); treat files as sensitive |
| **Low** | `npm audit` high findings are in the Tailwind/Vite toolchain (`braces`, Vite path traversal) | Build-time only |
| **Low** | `uuid` buffer issue | Only `v4()` is used |

### 7.3 Practices already in place

| Practice | Where |
|---|---|
| OCR runs fully in-browser with models served from `public/` | [`utils/ocr.ts`](../src/utils/ocr.ts) |
| `isEvalSupported: false` stops pdf.js compiling document expressions | [`utils/pdf.ts`](../src/utils/pdf.ts) |
| User chat bubbles render as plain text, not markdown | `ChatPanel` |
| The Settings UI documents where the key is stored and the `Authorization: Bearer` header | `SettingsModal` |
| `sanitizeFilename` strips path separators and caps length before download | [`utils/storage.ts`](../src/utils/storage.ts) |
| `downloadTextFile` uses `rel="noopener"` and revokes its ObjectURL | same |
| Comments and rationales render through the sanitised markdown pipeline | `utils/markdown.ts` |
| Selection rects and popovers are clamped inside their container | `clampToContainer` |

### 7.4 Reporting

Open a GitHub issue on the repository. **Redact any keys before filing.**

## 8. Pre-release checklist

```bash
npm run typecheck
npm run test:heading-sections
npm run test:proposed-edit
npm run test:graph
npm run build
```

Then, by hand:

| Check | Why |
|---|---|
| OCR import with and without an API key | Two code paths, two gate messages |
| Google AI Mode send → paste → fences render as cards | The whole keyless loop |
| Send to AI → Apply → open the comment badge → read the rationale | The headline feature |
| Apply with a deliberately mangled quote | Best Effort and the Highlight Apply fallback |
| Comment → Send to AI → Edit the comment → Send again | Round 2 creation |
| Graph view: drag, zoom, Reset, click a heading | The atom layout and the remount-on-reset path |
| Reload the page with data in every panel | Rehydrate migrations |
| Narrow the window below 767 px, or height below 540 px | Overlay drawers, stacked split, compact topbar, bottom sheets |
| Toggle the theme | Token coverage in both palettes |
| Export `.md` and `.json` | Both download paths |

## 9. Next

- Recipes for common changes → [Maintenance guide](15-maintenance-guide.md)
- Field-by-field data reference → [Data types & glossary](16-glossary.md)
# ApEditor — Functional Specification

> The developer-facing manual for this repository. It describes **what ApEditor does, how it is built, and the contracts you must respect when you change it.**

**Applies to:** `v0.6.1` · package version **0.6.1** · MIT licensed
**Audience:** engineers new to the repo, and anyone returning to it after a few months.

---

## About this document

This is *not* the user guide. The user guide lives in [`docs/`](../docs) and is what an end user reads; it ships inside the app behind the **?** button. This document is the engineering counterpart:

| | User guide | Functional Specification |
|---|---|---|
| Lives in | `docs/` | `func_spec/` |
| In-app button | **?** | **`{ }`** (next to **?**) |
| Hotkey | `⌘/Ctrl + /` or `?` | `⌘/Ctrl + Shift + E` |
| Catalog | `src/docs/catalog.ts` | `src/docs/funcSpecCatalog.ts` |
| Viewer | `src/components/HelpDocs.tsx` | `src/components/FuncSpecDocs.tsx` |
| Answers | "How do I do X?" | "Where does X live and what must I not break?" |

Both sets of markdown files are loaded into the bundle with `import.meta.glob(..., { query: '?raw' })`, so **editing a file and reloading the app is enough** — there is no separate build step for docs.

### How to read it

- **New to the repo?** Read [Part I](02-architecture.md) end to end, then skim [Part V](15-maintenance-guide.md).
- **Adding a feature?** Start at the "Where does X live?" table in [Maintenance guide](15-maintenance-guide.md#2-where-does-x-live).
- **Debugging a bug?** Jump to the relevant Part II/III chapter, then check [Invariants and gotchas](15-maintenance-guide.md#4-invariants-and-gotchas).
- **Looking up a type or term?** [Data types & glossary](16-glossary.md).

### Conventions used here

- `file.ts` / `Component.tsx` — a real file, path relative to the repo root (or to `src/` where obvious).
- `symbolName` — a real exported or module-local identifier.
- `"literal"` / `'literal'` — a string or regex that exists verbatim in the source.
- Numbers such as `0.85` or `50 * 1024 * 1024` are the real constants, not paraphrases.
- Tables are exhaustive unless they say "notable" or "key".

### Keeping this document honest

This spec describes the code as it is. When you change behaviour:

1. Update the affected chapter(s) in `func_spec/` in the same PR.
2. If you add a module, add it to the inventories in [Architecture](02-architecture.md) and [Events & components](12-events-and-ui-contracts.md).
3. If you add a store field, update the persistence tables in [State & persistence](04-state-and-persistence.md) and the type tables in [Data types & glossary](16-glossary.md).
4. If you add a `mvp:*` event, add it to the event table in [Events & components](12-events-and-ui-contracts.md).

---

## Table of contents

### Part I — Orientation

*The shape of the product and the system.*

1. [Product overview](01-product-overview.md) — problem, users, capability list, explicit non-goals.
2. [Architecture](02-architecture.md) — layer map, module inventory with sizes, dependency rules, composition tree.
3. [Runtime flows](03-runtime-flows.md) — eight end-to-end sequence walks, each with the files and events touched.

### Part II — Runtime behaviour

*What happens when the app runs.*

4. [State & persistence](04-state-and-persistence.md) — the single Zustand store, every slice, the localStorage schema, rehydrate migrations.
5. [Editor & writing](05-editor-and-writing.md) — view modes, textarea + mirror, formatting, Predict, revisions, layout.
6. [Comments](06-comments.md) — anchoring, rounds, re-anchoring, outdated recovery, undo, Send to AI.

### Part III — The AI contract

*How ApEditor talks to a model. The parts most likely to need changing.*

7. [AI chat & prompts](07-ai-chat.md) — providers, SSE, the ordered system-message contract, redaction, keyless mode.
8. [Proposed edits](08-proposed-edits.md) — fence schema, tolerant parsing, the Apply waterfall.
9. [@-references](09-mentions.md) — sentinel format, two-stage picker, cascade, character budgets.

### Part IV — Views & data ingress

*The two places bytes enter or leave the app.*

10. [Graph view](10-graph-view.md) — node/edge model, wikilink resolution, radial layout, camera, interactions.
11. [Import & export](11-import-ocr-backup.md) — in-browser OCR, PDF extraction, Markdown rewrite, backups.

### Part V — Reference

*Lookup material.*

12. [Events & components](12-events-and-ui-contracts.md) — the `mvp:*` bus and every React component.
13. [Build & configuration](13-build-and-config.md) — Vite, TypeScript, Tailwind, CSP, env, scripts.
14. [Testing & security](14-testing-and-security.md) — the three test harnesses and the threat model.
15. [Maintenance guide](15-maintenance-guide.md) — recipes, conventions, invariants, known rough edges.
16. [Data types & glossary](16-glossary.md) — every persisted interface, field by field.

---

## Quick orientation: 60 seconds

If you read nothing else:

1. **`src/store/` is the only state container.** Everything on screen is a projection of the Zustand store. See [State & persistence](04-state-and-persistence.md).
2. **`src/api/chat.ts` is the only network layer.** Two entry points: `streamChatCompletion` (SSE transport) and `buildRequestMessages` (prompt assembly). See [AI chat & prompts](07-ai-chat.md).
3. **The `mvp:*` window events are the cross-component bus.** Components never import each other; they dispatch events. See [Events & components](12-events-and-ui-contracts.md).
4. **The comment system is the most stateful feature.** Anchors + rounds + re-anchoring + undo. Read [Comments](06-comments.md) before touching it.
5. **The editor is a plain `<textarea>` plus a mirrored `<div>` overlay.** The textarea is the source of truth for text; the mirror only paints highlights and hosts the selection `Range`. See [Editor & writing](05-editor-and-writing.md).

## Repository shape

```
apeditor/
├── docs/                  # User guide markdown → in-app Help (?)
├── func_spec/             # This document → in-app Functional Specification ({ })
├── public/                # Logo + OCR models + ONNX runtime + pdf.js worker
├── scripts/               # Node test harnesses + the OCR asset sync script
├── src/
│   ├── api/               # Network layer (1 file)
│   ├── components/        # React UI (22 files, incl. mentions/)
│   ├── config/            # Provider presets
│   ├── docs/              # In-app docs catalogs (Help + Func Spec)
│   ├── hooks/             # Shared behaviour (drag/resize, mentions, predict, media)
│   ├── store/             # Zustand store split across 5 files
│   ├── utils/             # Pure logic + browser integrations (incl. graph/)
│   ├── App.tsx            # Composition, global hotkeys, overlay orchestration
│   ├── main.tsx           # Boot: storage migration, pre-paint theme
│   ├── index.css          # Tailwind layers + component CSS + theme tokens
│   └── types.ts           # Shared TS types
├── index.html             # CSP meta tag, root element
├── vite.config.ts         # Build, aliases, COOP/COEP, dev port 5174
└── tailwind.config.cjs    # Design tokens (paper / cyber / ape)
```

## Build and verify

```bash
npm install          # also runs the OCR asset sync (postinstall)
npm run dev          # http://localhost:5174
npm run typecheck    # tsc -b --noEmit  ← run this after every change
npm run test:graph   # wikilink parse + graph compile + layout fixtures
npm run test:proposed-edit
npm run test:heading-sections
npm run build        # type-check + production build to dist/
```

There is no test framework and no CI suite. The three `test:*` scripts are hand-rolled Node harnesses that bundle the real source with `esbuild` and assert against `node:assert/strict`. See [Testing & security](14-testing-and-security.md).
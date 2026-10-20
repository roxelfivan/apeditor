/**
 * Functional Specification catalog.
 *
 * Content is loaded from the repo's `func_spec/*.md` files via Vite's
 * `import.meta.glob(..., { query: '?raw' })`, exactly like the user
 * guide (`src/docs/catalog.ts` + `docs/*.md`).
 *
 * The difference from the Help catalog is that a Functional
 * Specification is organised into *parts* (chapters of one manual)
 * rather than a flat list of task pages, so the catalog carries a
 * `part` on every page and the viewer groups by it.
 *
 * To add a page: drop a `NN-slug.md` file into `func_spec/` and add
 * one entry to `FUNC_SPEC_PAGES` below. The filename number is the
 * reading order; the array order is the sidebar order.
 */

export interface FuncSpecPartMeta {
  id: string;
  title: string;
  /** One line shown under the part heading in the sidebar / index. */
  blurb: string;
}

export interface FuncSpecPageMeta {
  id: string;
  /** Sidebar label. Keep it short — the sidebar is narrow. */
  title: string;
  /** Basename under /func_spec (e.g. `04-state-and-persistence.md`). */
  file: string;
  /** Owning part id. Must match a `FUNC_SPEC_PARTS` entry. */
  part: string;
  /** One-line summary, shown on hover and used by the index page. */
  blurb: string;
}

/** Part order — drives both the sidebar grouping and the index page. */
export const FUNC_SPEC_PARTS: FuncSpecPartMeta[] = [
  {
    id: 'orientation',
    title: 'Part I — Orientation',
    blurb: 'What the product is, how the system is put together, and the rules that hold the layers apart.',
  },
  {
    id: 'runtime',
    title: 'Part II — Runtime behaviour',
    blurb: 'What actually happens at runtime: end-to-end flows, state, persistence, the editor, and comments.',
  },
  {
    id: 'ai',
    title: 'Part III — The AI contract',
    blurb: 'How ApEditor talks to a model: providers, prompt assembly, the proposed-edit fence, and @-references.',
  },
  {
    id: 'views',
    title: 'Part IV — Views & data ingress',
    blurb: 'The Graph view and the OCR/PDF import + export pipelines — the two places bytes enter or leave the app.',
  },
  {
    id: 'reference',
    title: 'Part V — Reference',
    blurb: 'Lookup material: the event bus, component inventory, build config, testing, and the maintenance playbook.',
  },
];

export const FUNC_SPEC_PAGES: FuncSpecPageMeta[] = [
  // ── Part I ────────────────────────────────────────────────────────────
  {
    id: 'overview',
    title: 'Product overview',
    file: '01-product-overview.md',
    part: 'orientation',
    blurb: 'Problem, users, the capability list, and what is deliberately out of scope.',
  },
  {
    id: 'architecture',
    title: 'Architecture',
    file: '02-architecture.md',
    part: 'orientation',
    blurb: 'Layer map, module inventory with sizes, dependency rules, and the top-level composition tree.',
  },
  {
    id: 'runtime-flows',
    title: 'Runtime flows',
    file: '03-runtime-flows.md',
    part: 'orientation',
    blurb: 'Eight end-to-end sequence walks with the files and events touched at each step.',
  },

  // ── Part II ───────────────────────────────────────────────────────────
  {
    id: 'state',
    title: 'State & persistence',
    file: '04-state-and-persistence.md',
    part: 'runtime',
    blurb: 'The single Zustand store, every persisted slice, the localStorage schema, and the rehydrate migrations.',
  },
  {
    id: 'editor',
    title: 'Editor & writing',
    file: '05-editor-and-writing.md',
    part: 'runtime',
    blurb: 'View modes, the textarea + mirror overlay, formatting, Predict, revisions, and the layout system.',
  },
  {
    id: 'comments',
    title: 'Comments',
    file: '06-comments.md',
    part: 'runtime',
    blurb: 'Anchoring, rounds, the four re-anchor strategies, outdated recovery, undo, and Send to AI.',
  },

  // ── Part III ──────────────────────────────────────────────────────────
  {
    id: 'ai-chat',
    title: 'AI chat & prompts',
    file: '07-ai-chat.md',
    part: 'ai',
    blurb: 'Providers, SSE streaming, the ordered system-message contract, redaction, and the keyless path.',
  },
  {
    id: 'proposed-edits',
    title: 'Proposed edits',
    file: '08-proposed-edits.md',
    part: 'ai',
    blurb: 'The fence schema, tolerant parsing, and the Exact → Best Effort → Highlight Apply waterfall.',
  },
  {
    id: 'mentions',
    title: '@-references',
    file: '09-mentions.md',
    part: 'ai',
    blurb: 'The sentinel format, the two-stage picker, cascade rules, and per-turn character budgets.',
  },

  // ── Part IV ───────────────────────────────────────────────────────────
  {
    id: 'graph',
    title: 'Graph view',
    file: '10-graph-view.md',
    part: 'views',
    blurb: 'Node/edge model, wikilink resolution, the atomic radial layout, camera, and interactions.',
  },
  {
    id: 'import',
    title: 'Import & export',
    file: '11-import-ocr-backup.md',
    part: 'views',
    blurb: 'In-browser OCR and PDF text extraction, Markdown rewrite, plus Markdown and JSON backup export.',
  },

  // ── Part V ────────────────────────────────────────────────────────────
  {
    id: 'contracts',
    title: 'Events & components',
    file: '12-events-and-ui-contracts.md',
    part: 'reference',
    blurb: 'The `mvp:*` window event bus and a one-row inventory of every React component.',
  },
  {
    id: 'build',
    title: 'Build & configuration',
    file: '13-build-and-config.md',
    part: 'reference',
    blurb: 'Vite, TypeScript, Tailwind tokens, CSP, COOP/COEP, env overrides, and npm scripts.',
  },
  {
    id: 'testing',
    title: 'Testing & security',
    file: '14-testing-and-security.md',
    part: 'reference',
    blurb: 'The three executable test harnesses, what they cover, and the current threat model.',
  },
  {
    id: 'maintenance',
    title: 'Maintenance guide',
    file: '15-maintenance-guide.md',
    part: 'reference',
    blurb: 'Recipes for common changes, coding conventions, and the invariants that are easy to break.',
  },
  {
    id: 'glossary',
    title: 'Data types & glossary',
    file: '16-glossary.md',
    part: 'reference',
    blurb: 'Every persisted TypeScript interface field-by-field, plus a term glossary.',
  },
];

const rawByPath = import.meta.glob('../../func_spec/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const contentByFile = new Map<string, string>();
for (const [path, content] of Object.entries(rawByPath)) {
  const file = path.split('/').pop();
  if (file) contentByFile.set(file, content);
}

/** Pages grouped by part id, in catalog order. */
export const FUNC_SPEC_PAGES_BY_PART: Record<string, FuncSpecPageMeta[]> =
  FUNC_SPEC_PARTS.reduce<Record<string, FuncSpecPageMeta[]>>((acc, part) => {
    acc[part.id] = FUNC_SPEC_PAGES.filter((p) => p.part === part.id);
    return acc;
  }, {});

/** Where each page sits in reading order, used for Prev / Next. */
export const FUNC_SPEC_ORDER: Record<string, number> = FUNC_SPEC_PAGES.reduce<
  Record<string, number>
>((acc, page, i) => {
  acc[page.id] = i;
  return acc;
}, {});

export const FUNC_SPEC_DEFAULT_PAGE = 'overview';

export function getFuncSpecPageMeta(id: string): FuncSpecPageMeta | undefined {
  return FUNC_SPEC_PAGES.find((p) => p.id === id);
}

export function getFuncSpecPageContent(id: string): string {
  const meta = getFuncSpecPageMeta(id);
  if (!meta) return '_Page not found._';
  return (
    contentByFile.get(meta.file) ?? `_Missing func_spec/${meta.file}._`
  );
}

/**
 * Resolve an in-document markdown href to a Functional Spec page id.
 *
 * Accepts `03-runtime-flows.md`, `./03-runtime-flows.md`,
 * `03-runtime-flows.md#some-heading`, and the bare slug
 * `03-runtime-flows`. Returns `null` for anything that is not a spec
 * page so callers can fall through to external-link handling.
 */
export function funcSpecPageIdFromHref(href: string): string | null {
  const cleaned = href.replace(/^\.\//, '').split('#')[0]?.trim() ?? '';
  if (!cleaned) return null;
  const file = cleaned.endsWith('.md') ? cleaned : `${cleaned}.md`;
  const page = FUNC_SPEC_PAGES.find((p) => p.file === file);
  return page?.id ?? null;
}

export function isFuncSpecPageId(value: string): boolean {
  return FUNC_SPEC_PAGES.some((p) => p.id === value);
}
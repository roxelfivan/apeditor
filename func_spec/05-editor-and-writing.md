# Editor & writing

> The centre of the app: the textarea, the mirror overlay that paints highlights behind it, the four view modes, formatting, Predict, revisions, and the whole layout system.

---

## 1. Why a textarea plus a mirror

ApEditor deliberately does **not** use a rich-text editor. The visible text lives in a plain `<textarea>`; highlights, badges, and selection rectangles are painted by a sibling `<div class="cm-mirror">` that sits behind it.

```
┌─ [data-cm-wrapper]  isolation: isolate ────────────────────┐
│                                                           │
│   ┌─ .cm-mirror ────────────┐  z-index 0, pointer-events: │
│   │ <span>…</span>          │  none, user-select: none,   │
│   │ <mark data-comment-id>  │  overflow hidden            │
│   │   …</mark><span>…</span>│                             │
│   └─────────────────────────┘                             │
│   ┌─ textarea.comment-textarea ────────────────────────┐  │
│   │  color: transparent !important                     │  │ z-index 1
│   │  caret-color: #e85d3b (light) / #00e5ff (dark)    │  │
│   │  spellCheck={false}                               │  │
│   └───────────────────────────────────────────────────┘  │
│   ┌─ .cm-margin ──┐  36 px, numbered badges, position: absolute
│                                                           │
│   ┌─ .cm-tray ────────┐  Send to AI + stale list          │
└───────────────────────────────────────────────────────────┘
```

The mirror's concatenated text-node content is byte-identical to the document, so **document offsets map 1:1 onto visible-text offsets**. That single invariant is what lets `getSelectionRect` build a real DOM `Range` against the mirror and get the pixel rectangle of a textarea selection — a textarea cannot host a `Range`, which is why the mirror exists at all.

### The geometric contract

[`index.css`](../src/index.css) applies one shared rule to both elements:

```css
.comment-textarea, .cm-mirror {
  font-family: <mono stack>;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: break-word;
  padding: 16px;
  box-sizing: border-box;
  border: 0;
  margin: 0;
  tab-size: 4;
  letter-spacing: normal;
}
```

> **This is load-bearing.** Any property added to one element but not the other accumulates into vertical selection drift that grows with document length. If highlights or the composer start floating away from the text, check this rule first.

Additional details:

- `.comment-textarea` uses `color: transparent !important` and `background: transparent !important` to beat Tailwind's `.dark .bg-ape-base` (specificity 0,2,0 vs 0,1,0). **Any Tailwind colour utility added to that textarea will silently lose.**
- `isolation: 'isolate'` on `[data-cm-wrapper]` creates a new stacking context so the composer/popover `z-index: 50` beats the mirror, textarea, and toolbar.
- Scroll sync: a passive `scroll` listener copies `scrollTop` / `scrollLeft` onto the mirror; a `ResizeObserver` on the textarea and a `window` `resize` listener re-sync. The effect depends on `[doc?.id, viewMode]` — Preview unmounts the write pane, so without the `viewMode` dep the listener would stay bound to a detached textarea after a mode switch.
- Scrollbar compensation: `sb = max(0, ta.offsetWidth - ta.clientWidth)`, then `mirror.style.right = ${sb}px` so the mirror's wrap width equals the textarea's content width.

## 2. View modes

`viewMode: 'write' | 'preview' | 'split' | 'graph'`, stored and persisted.

```ts
const isSplit = viewMode === 'split';
const showWrite =
  viewMode === 'write' || (isSplit && splitLeftMode === 'write');
const showPreview =
  viewMode === 'preview' || (isSplit && splitLeftMode === 'preview');
const showGraph = viewMode === 'graph' || isSplit;
const showWriteTools = showWrite;
```

`splitLeftMode: 'write' | 'preview'` lives on `layout` (persisted). It only affects Split: the left pane shows Write or Preview; the right pane is always Graph. The view-mode `<select>` option order is **Write → Preview → Graph → Split**.

### Toolbar visibility matrix

| Control | write | preview | split (left Write) | split (left Preview) | graph |
|---|:-:|:-:|:-:|:-:|:-:|
| View-mode `<select>` | ✅ | ✅ | ✅ | ✅ | ✅ |
| Left-pane Write \| Preview tabs | — | — | ✅ | ✅ | — |
| `GraphViewControls` | — | — | ✅ | ✅ | ✅ |
| **Format** dropdown (B/I/U + Size ±) | ✅ | — | ✅ | — | — |
| **Comment** | ✅ | — | ✅ | — | — |
| Predict | ✅ | — | ✅ | — | — |
| Debug status pill / counters | ✅\* | — | ✅\* | — | — |
| Comment tray **Send to AI** token counter | ✅† | — | ✅† | — | — |
| File actions | ✅ | ✅ | ✅ | ✅ | ✅ |
| Save revision | ✅ | ✅ | ✅ | ✅ | ✅ |

\* only when `debugMode` is on.
† the comment tray only renders in Write panes, and the counter only renders when `debugMode` is on. See [AI chat & prompts](07-ai-chat.md#6a-debug-mode-token-counter).

In full `graph` mode the text panes are replaced entirely; Format, Comment, and Predict hide because they need the textarea. In Split they appear only when the left pane is Write. File actions and Save stay.

### Pane rendering

| Mode | Layout |
|---|---|
| **write** | One write pane, `flex-1`, no divider border |
| **preview** | Only `<ReactMarkdown>` in `flex-1 overflow-y-auto p-4 prose-md` at `editorFontSize`, `lineHeight: 1.55`. No textarea, no margin column, no comment UI |
| **split** | Left Write **or** Preview (toggle) + right Graph. Left pane gets `flex: 0 0 {pct}%` **and** `minWidth: 20%` / `maxWidth: 80%`, plus a right border and a Write \| Preview tablist. A `ResizeHandle` renders only when `isSplit && !isNarrow` |
| **graph** | `<GraphView key={graphEpoch} labelPx zoom projection />` full pane |

`graphEpoch` is a remount key. `GraphViewControls`'s **Reset** bumps it, which is how the drag override map is cleared.

The Graph view has its own inner projection toggle — `Graph` / `Globe` / `3D` — rendered by `GraphViewControls`. Those are **projections, not view modes**: `viewMode` keeps exactly four values. See [Graph view](10-graph-view.md#9d-3d-concept-projection).

### Preview with proposed-edit highlights and wikilinks

`previewMarkdown` is built in two passes over the raw document source:

1. **Proposed-edit highlights** — inject `<mark class="pe-doc-highlight">` wrappers around each highlighted span, inserted **from the end backwards** so earlier offsets stay valid, with each range clamped to `[0, out.length]` and empty ranges skipped. (Offsets are relative to the raw document, so this pass must run first.)
2. **Wikilink display** — `formatWikilinksForPreview` (from [`parseWikilinks.ts`](../src/utils/graph/parseWikilinks.ts)) replaces each `[[…]]` match with `<span class="wiki-link">label</span>`, where `label` is **alias → heading → target**. Mention sentinels (`[[mention:…]]`) are skipped. Labels are HTML-escaped before injection.

Empty content renders `*Nothing to preview yet.*`. Write mode is unchanged — it still shows the raw `[[…]]` syntax.

This only works because `rehype-raw` is enabled and the shared sanitize schema allows `span` / `mark` with `className`. Styled by `.wiki-link` in [`index.css`](../src/index.css) (purple in light and dark).

## 3. Formatting

### 3.1 Bold / Italic / Underline

`wrapSelection(kind: WrapKind)` where `type WrapKind = 'bold' | 'italic' | 'underline'`.

| Kind | Open | Close | Rendered as |
|---|---|---|---|
| `bold` | `**` | `**` | `<strong>` |
| `italic` | `*` | `*` | `<em>` |
| `underline` | `<u>` | `</u>` | raw HTML via `rehype-raw` |

Flow:

1. Read `ta.selectionStart` / `selectionEnd`.
2. Clamp defensively: `safeStart = max(0, min(start, value.length))`, `safeEnd = max(0, min(end, value.length))` — an AI reply landing mid-keystroke can make `selectionStart > value.length`.
3. Split into `before` / `selected` / `after`.
4. Detect whether the selection is **already** wrapped by inspecting the text *around* the selection, not the selection itself.
5. Unwrap (strip the markers, caret collapses to the inner text) or wrap (insert the pair, caret inside).
6. `updateContent(doc.id, next)` then `restoreCaret(ta, caretStart, caretEnd, { preserveScroll: true })`.

Detection rules:

| Kind | Condition |
|---|---|
| underline | `before` ends with `<u>` **and** `after` starts with `</u>` |
| bold | two chars before are `**` and two after are `**`, **and** `value[safeStart-3] !== '*'` **and** `value[safeEnd+2] !== '*'` |
| italic | `value[safeStart-1] === '*'` and `value[safeEnd] === '*'`, **and** `value[safeStart-2] !== '*'` **and** `value[safeEnd+1] !== '*'` |

The extra guards are the bold/italic disambiguation: without them, applying Italic inside `**bold**` would unwrap the bold markers instead of adding `*`.

With no selection, the bare pair is inserted and the caret is placed between the markers.

> **Not markdown-aware.** This is a purely textual toggle. Selecting the whole `**bold**` and clicking Bold produces `****bold****`. That is accepted behaviour, not a bug.

Keyboard: `⌘/Ctrl + B / I / U` in the textarea `onKeyDown`, gated on `!altKey && !shiftKey`, and handled **before** the Predict handler.

### 3.2 Font size

The **Format** dropdown contains five `role="menuitem"` buttons — Bold, Italic, Underline, a separator, then **Size +** and **Size −** — plus an `aria-label="Format"` trigger showing `Format ▾`.

| | |
|---|---|
| Range | `10`–`24` px, step `1` |
| Authoritative clamp | `bumpEditorFontSize` in `store.ts`: `clamp(current + delta, 10, 24)` |
| UI disabled state | `Size +` disabled at `>= 24`; `Size −` disabled at `<= 10`. The label uses the Unicode minus `−`, not a hyphen. |
| Applies to | the `data-cm-wrapper`, the `<textarea>`, the preview pane, and the Predict panel body — **not** the toolbar chrome or `uiFontSize` |
| Positioning (v0.6.1) | The menu panel is `position: fixed`, not `absolute` inside the trigger wrapper. The toolbar scroller (`overflow-x: auto`) forces a computed `overflow-y: auto`, which clips overflowing children — an absolute menu mounts but is invisible. A `useLayoutEffect` anchors `left` / `top` to the trigger button and clamps both edges to the viewport; it re-runs on `resize` and capture-phase `scroll`. Same contract as `FileActionsButton` and the Graph Filter. |

> The two clamps must stay in sync. Changing the range means changing both the store clamp and the two `disabled` expressions in `Editor.tsx`.

Every menu item uses `onMouseDown={e => e.preventDefault()}` so the textarea does not lose its selection, then closes the menu. An outside `pointerdown` listener closes it unless the target is inside `[data-format-menu]`.

### 3.3 The two font sizes

| | `editorFontSize` | `uiFontSize` |
|---|---|---|
| Range | `10`–`24` | `12`–`20` |
| Target | Inline styles on the wrapper, textarea, preview, suggestion panel | `<html style="font-size">` |
| Scope | Document text only | Every `rem`-based Tailwind text utility |
| Escape hatch | — | The editor root is pinned to `fontSize: '14px'`, so stray `text-xs` descendants inside the editor are unaffected |

## 4. Predict

Full flow is in [Runtime flows §2](03-runtime-flows.md#2-typing-predict-accept). The editor-side details:

### State ownership

| State | Owner | Persisted |
|---|---|---|
| `inlineOn` (opt-in toggle) | `Editor.tsx` `useState` | No |
| `ghost`, `streaming`, `stats` | `useInlineCompletion` | No |
| Panel height | `localStorage['apeditor:suggestion-height']`, default `160`, clamped `80`–`600` | Yes |

`inlineOn` starts **`false`**. Predict never fires until the user opts in.

### Toggling

- **OFF → ON**: set the flag first, then `queueMicrotask(() => { if (inlineOnRef.current && apiConfigured) inline.triggerNow() })`. The microtask is required so the hook has already re-rendered with `enabled === true`.
- **ON → OFF**: call `inline.onBlur()` **first** (aborts the in-flight request and drops the ghost), then clear the flag.

`⌘/Ctrl + \` focuses the textarea if it is not active, then triggers. The listener is bound to `window` and mounted only while `inlineEnabled`.

### The panel

Rendered only when `inline.ghost || inline.streaming`. Height is the persisted value, `maxHeight: 60%`. Header reads `Suggestion · Tab to accept · Esc to dismiss`. Buttons `Reject` and `Accept` (disabled without a ghost).

Both buttons use `onMouseDown={e => e.preventDefault()}`. This is **mandatory**: clicking would blur the textarea first, and `onBlur` calls `cancel()`, nulling the ghost that `accept()` is about to read.

Body shows `ghost` text in `whitespace-pre-wrap`, or three pulsing dots at `animationDelay` `0ms` / `150ms` / `300ms` while waiting for the first token.

### Gating, outermost first

| Gate | Condition |
|---|---|
| Button enabled | `apiConfigured = requiresApiKey(provider) && Boolean(apiKey && apiEndpoint)` |
| Hook enabled | `apiConfigured && inlineOn` |
| `attemptFire` | `enabled` |
| Ghost guard | Returns if a ghost is already showing — **even for the manual trigger** |
| Selection guard | Non-manual triggers return when `caret !== end` |
| Empty prefix | Returns if `!prefix.trim()` |
| Network | `!endpoint \|\| !apiKey` → `onError()`. `assertSafeChatEndpoint` throws → `onError()`. |

### Keybindings

| Key | Behaviour |
|---|---|
| `Tab` | `preventDefault()` + `accept()` — **only when a ghost exists**, otherwise a literal tab is inserted |
| `Escape` | `preventDefault()` + `cancel()`, only when a ghost exists |
| Any other key | `cancel()` — the ghost dies on the first keystroke; it never auto-re-requests |
| `⌘/Ctrl + \` | Toggle on + request a suggestion |

### What "streaming" means

`streaming` is set `true` when the `fetch` resolves with `res.ok && res.body`, and set `false` **as soon as the first visible delta arrives** — not when the stream ends. So the three-dot indicator really means "request open, no visible token yet".

## 5. Revisions

`Revision = { id, documentId, content, createdAt, label? }`. Stored oldest-first per document.

### Creating a snapshot

| Call site | Label |
|---|---|
| Editor toolbar floppy disk | *(none)* → renders as `Snapshot` |
| `RevisionHistory` **Snapshot now** | `labelDraft \|\| undefined` — and there is currently no input bound to `labelDraft`, so this is always `undefined` |
| Chat **Send** | `'Before AI send'` |
| Chat **Apply N changes** | `'Before Apply All'` |

There is no auto-generated label, no deduplication, and no timestamp in the label. Every click creates an entry even if the content is unchanged.

### The modal

`fixed inset-0 z-30`, panel `max-w-5xl h-[min(85vh,85dvh)]`, safe-area padding.

- **Header** — `Revisions — <title>`, **Snapshot now**, close.
- **Left list** (`md:w-64`) — `revisions.slice().reverse()`. Each row shows `r.label || 'Snapshot'` and `new Date(r.createdAt).toLocaleString()`, plus **Restore** and **Delete** (both `stopPropagation` and `confirm()`-gated).
- **Right pane** — a `role="tablist"` with **Preview** and **Diff**.
  - **Preview** — `<ReactMarkdown>` with the same plugin stack as the live editor preview, so a revision renders exactly as the editor would. Empty revisions render `*Empty revision.*`.
  - **Diff** — `lineDiff(selected.content, doc.content)`, i.e. **revision → current**. Rows are `diff-add` / `diff-remove` with a fixed 4-unit marker column (`+` / `-` / space).

### Diff helpers

[`utils/diff.ts`](../src/utils/diff.ts) wraps `diffLines` from the `diff` package with `{ newlineIsToken: false }`.

| Function | Shape |
|---|---|
| `lineDiff(oldText, newText)` | Flat `DiffLine[]` of `{ kind: 'add' \| 'remove' \| 'context', text }`, in part order |
| `splitDiff(flat)` | Side-by-side `SplitRow[]`; a run of removes followed by a run of adds is paired by index and padded with `null` |

`splitDiff` is exported but not used by `RevisionHistory` — it exists for other consumers.

## 6. Selection geometry

### `getSelectionRect(doc, mirrorEl, start, end)`

Returns a viewport-space rect, or `null` when there is no mirror, the range is empty, `start < 0`, or `end > doc.length`.

1. Clamp `safeStart` / `safeEnd` into the document.
2. `findFirstTextNode(mirrorEl)` via `createTreeWalker(SHOW_TEXT).nextNode()`.
3. `collectVisibleText(mirrorEl)` — concatenate every text node's `nodeValue`.
4. Clamp `startIdx` / `endIdx` into that string.
5. `setRangeEndpoints(...)` — walk **all** text nodes in the whole mirror subtree, assigning `(node, offset)` for both endpoints.
6. `range.getBoundingClientRect()`; `null` if width and height are both 0.

> **The boundary bug this code avoids:** when `startIdx === nodeEnd`, advancing the walker to the next node with offset `0` is correct. Setting offset `len` on the current node collapses the range to zero width and `getBoundingClientRect()` returns nothing.

### Three coordinate spaces

This is the highest-risk area in the editor.

| Space | Origin | Consumers |
|---|---|---|
| **Viewport** | `window` | `getSelectionRect` output |
| **Wrapper-local** | `[data-cm-wrapper]`'s `getBoundingClientRect()` | `CommentComposer.position`, `CommentPopover.position` |
| **Margin-local** | `.cm-margin`'s viewport `top` | `badgePositions[id]` |

Conversions in `Editor.tsx`:

- `toWrapperLocal(rect)` — subtracts the wrapper's `left` / `top`, falling back to the pane rect.
- `badgePositions` — subtracts `.cm-margin`'s viewport `top` (falling back to the textarea's). **Do not add `scrollTop`.** The margin column does not scroll; only the textarea does. Adding it double-counts and makes badges drift with document length.
- `handleSelectComment` — synthesises a popover anchor from `paneRect.right - 12` and `badgePositions[id] + paneRect.top - 16`, then subtracts the wrapper rect.

`paneBounds` is always `{ left: 0, top: 0, right: wrapperWidth, bottom: wrapperHeight }` — measured on the **wrapper**, not the pane, because the pane includes the 36 px margin column.

Badge positions are clamped to `[0, pane.clientHeight - 32]`.

### `clampToContainer(container, box, preferred, padding = 8)`

```
minLeft  = container.left + padding
minTop   = container.top  + padding
maxRight = container.right  - padding
maxBottom= container.bottom - padding
maxLeft  = max(minLeft,  maxRight  - box.width)
maxTop   = max(minTop,   maxBottom - box.height)
```

Both composer and popover use it. The hard ceiling on `maxTop` matters: without it a stale `preferred.top` of 1300+ would survive the flip-above heuristic and paint off-screen.

## 7. Layout system

### Storage

```ts
layout: {
  sidebarWidth: number;    // px
  chatWidth: number;       // px
  editorSplitPct: number;  // % of the editor split row (left pane; Graph takes the rest)
  splitLeftMode: 'write' | 'preview';  // Split left content; default 'write'
  previewSizes: Record<string, { w: number; h: number }>;
}
```

Defaults: `240`, `384`, `50`, `{}`.

### Clamps

All bounds live in [`useDragResize.ts`](../src/hooks/useDragResize.ts) and are imported by consumers, so a bound is changed in exactly one place.

| Constant | Value |
|---|---|
| `MIN_SIDEBAR_WIDTH` / `MAX_SIDEBAR_WIDTH` | `160` / `480` |
| `MIN_CHAT_WIDTH` / `MAX_CHAT_WIDTH` | `280` / `720` |
| `MIN_EDITOR_SPLIT_PCT` / `MAX_EDITOR_SPLIT_PCT` | `20` / `80` |
| `DEFAULT_EDITOR_SPLIT_PCT` | `50` |
| `MIN_CARD_WIDTH` / `MAX_CARD_WIDTH` | `220` / `800` |
| `MIN_CARD_HEIGHT` / `MAX_CARD_HEIGHT` | `140` / `600` |
| `MIN_POPOVER_WIDTH` / `MAX_POPOVER_WIDTH` | `280` / `720` |
| `MIN_POPOVER_HEIGHT` / `MAX_POPOVER_HEIGHT` | `220` / `800` |
| `MIN_SETTINGS_WIDTH` / `MAX_SETTINGS_WIDTH` | `360` / `960` |
| `MIN_SETTINGS_HEIGHT` / `MAX_SETTINGS_HEIGHT` | `420` / `900` |
| `MIN/MAX_SETTINGS_TEXTAREA_HEIGHT` | `100` / `600` |

The chat panel additionally caps at `max(MAX_CHAT_WIDTH, floor(window.innerWidth * 2/3))` so a persisted 720 px value cannot push the panel off-screen on a narrow window. A `window` resize listener re-clamps and writes back only when the stored value exceeds the new maximum.

### `useDragResize`

```ts
useDragResize({ mode: 'axis', axis, onDelta })      // → { start(handle, e) }
useDragResize({ mode: 'free', onDelta })            // corner/edge drags
```

- `if (!e.isPrimary) return;` then `preventDefault()` and a `try/catch` `setPointerCapture`.
- `optsRef` keeps the latest `onDelta` reachable without rebinding listeners.
- **rAF coalescing**: at most one `onDelta` per animation frame; `pointerup` does a final `flush()`.
- `dx` / `dy` are cumulative from drag start; `absX` / `absY` are raw client coordinates.
- The `handle` argument is ignored in axis mode — axis consumers track their own anchor. Only `mode: 'free'` consumers read it, from their own `activeHandleRef`.

`applyHandle(handle, startW, startH, dx, dy)` returns the new size. Values may go negative; callers clamp.

### `ResizeHandle`

`role="separator"`, `data-resize-handle={handle}`, `position: absolute`, `zIndex: 20`, `touchAction: 'none'`, `userSelect: 'none'`. Edge strips are 6 px, corners 12×12, each centred on its edge via a `-size/2` offset. Cursors map to `ew-resize`, `ns-resize`, `ne-resize`, `nw-resize`, `se-resize`, `sw-resize`.

The parent must supply `position: relative`.

### `EdgeAnchor`

A pure presentational chevron strip that acts as both the hide **and** the show button for a collapsed panel.

| Side | Collapsed | Expanded |
|---|---|---|
| `top` | `⌄` | `⌃` |
| `left` | `›` | `‹` |
| `right` | `‹` | `›` |

Three instances live in `App.tsx`. Left and right are siblings **inside** the content row, so their `absolute left-0` / `right-0` resolve against that row. The top anchor is a **sibling of `Topbar`**, so its `absolute top-0` resolves to the very top of the page whether or not the topbar is visible.

## 8. Narrow viewports

### Breakpoints

| Constant | Query | Drives |
|---|---|---|
| `NARROW_QUERY` | `(max-width: 767px), (max-height: 540px)` | `isNarrow` — panel overlays, the editor split stacking, compact topbar |
| `COMMENT_SHEET_QUERY` | same as `NARROW_QUERY` | `isCommentSheet` — composer/popover as bottom sheets and the comment chip lane |

`useMediaQuery` returns `false` during SSR and syncs on `change`. `App.tsx` also has a module-level `isNarrowViewport()` reading `matchMedia` synchronously, for keydown handlers.

### Collapse-on-entry

A `wasNarrowRef` effect collapses **both** side panels on the transition *into* narrow, then early-returns while `wasNarrow === true`, so a panel the user opened on a narrow screen is not immediately closed again.

### Layout switches

| Concern | Narrow behaviour |
|---|---|
| Sidebar | `fixed inset-0 z-40` modal drawer with a backdrop button; `w-[min(100%,20rem)] max-w-[85vw]`; `role="dialog" aria-modal="true"`; safe-area insets. Picking a document auto-collapses it. |
| Chat | `fixed inset-0 z-40 flex justify-end` overlay; panel `w-full max-w-lg`; `role="dialog" aria-modal="true"` |
| Editor split | Row becomes `flex-col`; the write pane swaps `border-r` for `border-b` and **drops the percentage flex**; the `ResizeHandle` is hidden |
| Comment margin | CSS at the same narrow query turns `.cm-margin` into a 44 px-high horizontal chip lane below the textarea (`display: flex; flex-direction: row; overflow-x: auto`) and `.cm-margin__badge { position: static }`, so the inline `top` style is ignored |
| Composer / popover | `position: fixed`, inset left/right/bottom with `env(safe-area-inset-*)`, `width: auto`, `max-height: min(60vh, 60dvh)`, `z-index: 60`. The popover's 8 resize handles are **not rendered** in this mode. |

## 9. Global hotkeys

`App.tsx` owns the window keydown handler. It bails early when the event target is editable:

```ts
const editable =
  t instanceof HTMLTextAreaElement ||
  (t instanceof HTMLInputElement && /^(text|search|email|url|tel|password|number)$/.test(t.type)) ||
  (t?.isContentEditable ?? false);
if (editable) return;
```

| Key | Action |
|---|---|
| `⌘/Ctrl + .` | Settings |
| `⌘/Ctrl + ,` | Prompt library |
| `⌘/Ctrl + H` | Revision history |
| `⌘/Ctrl + /` or `?` | Help (user guide) |
| `⌘/Ctrl + Shift + E` | **Functional Specification** |
| `⌘/Ctrl + B` | Toggle sidebar (deferred while typing) |
| `⌘/Ctrl + Shift + C` | Toggle chat panel |

`?` is Shift+/ on many layouts, so both keys are accepted.

On narrow viewports only one overlay panel is open at a time: expanding the sidebar collapses the chat and vice versa.

## 10. Next

- The state this writes into → [State & persistence](04-state-and-persistence.md)
- The most stateful feature layered on the editor → [Comments](06-comments.md)
- Adding a toolbar control or a view mode → [Maintenance guide](15-maintenance-guide.md)
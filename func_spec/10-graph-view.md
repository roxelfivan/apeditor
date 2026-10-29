# Graph view

> A local knowledge graph of the workspace, compiled entirely in the browser from documents, headings, `[[wikilinks]]`, and `@` mentions. No LLM call, no new dependency, no store-schema change. Added in v0.5.4. Pan / orbit navigation added in v0.5.7. The 3D Concept projection added in v0.5.8. Spreading the Concept stack and OrbitControls-driven free navigation in v0.5.8. The document / section scope filter added in v0.5.9, together with zoom widened to 0.25×–12× (which also fixes a silent Concept distance clamp), labels widened to 6–48px across all three projections, and heading tiers made depth-compressed so deep `Comment > A > B > …` paths stay legible. In v0.6.0 the Concept labels were made legible while rotating — typographic hierarchy by node kind, a camera-distance ramp, near-over-far paint order, and a halo — the dark-mode sphere colours were lifted off the background, and the editor toolbar became a single non-wrapping row. The Globe projection was later replaced by a horizontal **Mindmap** (spanning tree plus dashed cross-links), and Graph / Mindmap / 3D collapsed into one toolbar dropdown.

---

## 1. What it is

Graph is available as a full-pane viewMode and as the **right pane of Split** (left pane is Write or Preview). It is a **symbolic** map, not a vector index — there is no embedding, no similarity search, and no indexing step. Everything is derived from text you already have.

| Property | Value |
|---|---|
| Input | `documents: DocumentRecord[]` and `comments: Record<docId, Comment[]>` |
| Output | `{ nodes: GraphNode[]; edges: GraphEdge[] }` |
| Cost | Zero network calls, zero new dependencies |
| Persistence | **None.** It is a pure derivation of store state, recomputed on render |

In full `graph` mode, Format / Comment / Predict hide because they need the textarea. In Split they appear when the left pane is Write. File actions and Save revision stay. A short click on a heading / term from full Graph switches to Split with left Write so the caret can land; from Split with Write already open, `viewMode` does not change.

**`viewMode` is unchanged by the Mindmap and Concept work.** It remains `'write' | 'preview' | 'split' | 'graph'`. A projection is a navigation aid *within* the Graph view, not a fifth pane:

| Why not a fifth `viewMode` |
|---|
| Flat, Mindmap and Concept are the same data with a different layout / camera; a sibling pane would imply different capabilities |
| `viewMode` is persisted via `partialize`, so a new default would silently change what the app opens to between sessions |
| Keeping them all reachable preserves the comparison — same nodes, undistorted, treed, and extruded |

## 2. Data model

```ts
export type GraphNodeKind = 'document' | 'heading' | 'term';
export type GraphEdgeKind = 'heading' | '@' | 'wikilink';

interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;        // short on-canvas label
  fullLabel: string;    // hover text; differs from `label` for path-nested headings
  documentId: string | null;
  start: number | null;
  end: number | null;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: GraphEdgeKind;
}

interface WorkspaceGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
```

### Node id formats

| Constructor | Format |
|---|---|
| `documentNodeId(id)` | `doc:<id>` |
| `headingNodeId(documentId, start)` | `heading:<documentId>:<start>` |
| `headingPathNodeId(documentId, pathSlug)` | `heading-path:<documentId>:<slug>/<slug>` |
| `termNodeId(slug)` | `term:<slug>` |

Edge ids are `${kind}:${source}->${target}`. Both nodes and edges are inserted into `Map`s, so duplicates are dropped automatically — two documents referencing the same term produce **one** term node and two edges.

## 3. Wikilink parsing

[`utils/graph/parseWikilinks.ts`](../src/utils/graph/parseWikilinks.ts)

```ts
const WIKILINK_RE = /\[\[([^\]|#]+?)(?:#([^\]|]+?))?(?:\|[^\]]+?)?\]\]/g;
```

Group 1 is the page or term target (stops at `|`, `#`, `]`). Group 2 is the optional `#heading` fragment. The `|alias` part is accepted and **discarded** — it is display-only.

Supported forms:

```
[[Page]]
[[Page|label]]
[[Page#Heading]]
[[Page#Heading|label]]
```

```ts
interface WikilinkMatch {
  raw: string;           // the full [[…]]
  target: string;        // trimmed group 1
  heading: string | null;
  alias: string | null;  // display alias after `|` (group 3)
  start: number;         // inclusive index in the source
  end: number;           // exclusive
}
```

`extractWikilinks(text)` constructs a **fresh** `RegExp(WIKILINK_RE.source, 'g')` per call, so `lastIndex` never bleeds between calls. Empty targets are skipped. Alias is used for Preview display only (`wikilinkDisplayLabel` / `formatWikilinksForPreview`); Graph resolution still keys off `target` + `heading`.

### Preview formatting (not Graph)

`formatWikilinksForPreview(markdown)` walks matches **from the end** and replaces each with `<span class="wiki-link">escapedLabel</span>`, where the label is **alias → heading → target**. Editor Preview / Split call this after PE `<mark>` injection. See [Editor & writing §2](05-editor-and-writing.md#preview-with-proposed-edit-highlights-and-wikilinks).

### The `mention:` guard

```ts
if (/^mention:/i.test(target)) continue;
```

This is how the `@`-mention sentinels are excluded from the graph's wikilink edges — they are stored in comment bodies in exactly the `[[mention:…]]` shape, and would otherwise produce a dense ring of nonsense edges. The test harness asserts this explicitly.

### `normalizeWikiSlug(value)`

`trim()` → `toLowerCase()` → `[\s_]+` becomes `-` → collapse repeated `-` → strip leading and trailing `-`.

### `resolveWikilink(match, documents)`

Returns one of three shapes:

| Result | Condition |
|---|---|
| `{ kind: 'document', documentId, match }` | `normalizeWikiSlug(d.title)` equals `normalizeWikiSlug(match.target)` |
| `{ kind: 'heading', documentId, headingStart, headingEnd, match }` | The document matched **and** `findHeadingByWikiTarget` finds a section with `level > 0` and a slug-matching title |
| `{ kind: 'term', slug, match }` | No document title matched |

A heading-fragment match **falls back to `document`** when the document matches but the heading does not. An unresolved name becomes a **term** node — it never creates a new document.

## 4. `buildWorkspaceGraph(documents, commentsByDoc)`

Six passes, in order.

### Pass 0 — document nodes

One `doc:<id>` per document, `label = fullLabel = doc.title`, `start = end = null`. Heading sections are computed once per document and cached.

### Pass 1 — heading nodes and the `>` split rule

Only sections with **`level > 0`** become nodes. The preamble and the blank-line fallback blocks (`level: 0`) do not.

```ts
splitHeadingPath(title)   // splits on /\s*(?:>|›|→)\s*/, drops empty parts
```

`Comment > annotate` becomes `['Comment', 'annotate']`. The node's `label` is the **last** segment; `fullLabel` is the whole title.

### Pass 2 — the alias table

Single-segment headings register `pathSlugKey(docId, [segment]) → headingNodeId(docId, start)`, so `[[Segment]]` resolves to a leaf heading node rather than to a document.

### Pass 3 — heading edges

For each real heading in document order:

| Condition | Parent |
|---|---|
| `segs.length > 1` | The synthetic `heading-path:` prefix node, created on demand via `ensurePathPrefix(segs.slice(0, -1))` and memoised in the alias map so two headings sharing a prefix share one parent |
| Otherwise, a previous section with a **strictly lower** level exists | That heading node |
| Otherwise | The document node |

Edge kind `'heading'`. Markdown heading **level** still governs the parent when a title contains no separator.

### Pass 4 — wikilinks

`fromHeading = enclosingHeading(sections, match.start)` — the first section with `level > 0` where `start <= offset < end`, falling back to the document node for links in the preamble.

| Resolution | Edge |
|---|---|
| `document` | `fromHeading → doc:<target>`, kind `'wikilink'` |
| `heading` | `fromHeading → heading:<targetDoc>:<headingStart>`, kind `'wikilink'` |
| `term` | Create `term:<slug>` if absent, with `documentId` / `start` / `end` taken from the **first** document that mentioned it. Edge to it, kind `'wikilink'` |

### Pass 5 — `@` mention edges

`mentionTokensFromComments` flattens `r.mentions` across **all rounds** of every comment on the document.

| Token | Target |
|---|---|
| The referenced document no longer exists | Skipped |
| `kind === 'doc-section'` | `headingForParagraphs(targetSections, token.paragraphIndexes)` — the section with `level > 0` holding the **most** matching paragraph indexes |
| Otherwise | `doc:<target>` |

Edge kind `'@'`. The source is **always the document node**, never a heading — an `@` is a document-level statement, not a passage-level one.

## 5. `layoutWorkspaceGraph(graph, currentDocumentId)`

### 5.1 Constants

| Constant | Value | Role |
|---|---:|---|
| `CX`, `CY` | `0`, `0` | Origin |
| `MIN_NODE_GAP` | `20` | Minimum centre-to-centre separation during relaxation |
| `CLUSTER_GAP` | `340` | Nucleus edge → satellite cluster |
| `RELAX_ITERS` | `80` | Separation passes |
| `CHILD_SEP` | `240` | Minimum angular separation per node on a shell |
| `LABEL_HALO` | `110` | World units reserved for a node's label |
| `NUCLEUS_RING` | `88` | Radius of the nucleus ring (a unary page H1) |
| `SHELL_GAP` | `280` | Floor increment between shells |

```ts
nodeRadius(kind, isHub) = 'document' → 36
                           'heading'  → isHub ? 26 : 20      // hub = has heading children
                           'term'     → 16
```

```ts
LaidOutNode = GraphNode & {
  x, y, r,
  labelDx, labelDy,
  labelAnchor: 'start' | 'middle' | 'end',
}
```

### 5.2 The atom

The current document is laid out as an **atom** at the origin, and everything else is placed relative to it. This is the fix from commit `7f45655` ("lay out Graph as an atom so initial edges do not cross") — the previous approach let satellites land inside the nucleus ring, producing crossing edges.

`seedAtom(docId, origin, edges, nodeIds, pos, minSep, startAngle = -π/2)`:

1. **`assignAngles`** — the document gets the midpoint of `[startAngle, startAngle + 2π]`; heading children recursively split the interval **weighted by `subtreeWidth`** (total leaf count). A big subtree gets a proportionally larger sector.
2. **`assignShells`** — if the document has **exactly one** top-level heading and that heading itself has children, the heading sits at shell `0` (the nucleus ring) and its children start at shell `1`. Otherwise all top-level headings start at shell `1`. **This is what stops the Welcome document's lone H1 plus ten `##` from collapsing into a single ring.**
3. **`shellRadii`** — `radii[0] = NUCLEUS_RING`, then `radii[d] = radii[d-1] + ringRadius(counts[d], minSep, SHELL_GAP)` where `ringRadius(n, sep, floor) = n <= 1 ? floor : max(floor, (n * sep) / (2π))`.
4. Each node lands at `(origin.x + cos(a)·R, origin.y + sin(a)·R)`.

### 5.3 Cluster extents

```ts
clusterExtent(origin, memberIds, pos) = max(40, maxMemberDistance) + LABEL_HALO + 24
```

A satellite document falls back to `160` when there is nothing to measure.

### 5.4 Term satellites

Placed at `termR = currentExtent + 90`, on the **circular mean** of their already-placed neighbours' rays — so a term satellite sits on the same ray as the heading that linked to it, rather than scattering randomly.

`circularMean` sums unit vectors and returns `atan2`. Degenerate when `hypot < 1e-6`, in which case it returns `angles[0]`. With no neighbours at all, the default angle is `Math.PI / 6`.

A collision nudge keeps used term angles apart: for each already-used angle within `0.18` rad, add `0.22`.

### 5.5 Satellite documents

Each other document is laid out as its own mini-atom into a scratch `local` map at `(0, 0)` with `minSep = max(160, CHILD_SEP * 0.85)` = `204`, then translated.

| Step | Rule |
|---|---|
| Angle | `circularMean(incoming)` over the rays of already-placed **non-heading** edge counterparts. With no incoming edges, `largestGapAngle(placedAngles())` — the midpoint of the widest angular gap, so satellites spread evenly |
| Distance | `currentExtent + extent + CLUSTER_GAP` |
| Placement | `placeOnRay(origin, θ, dist)` for the hub, then translate all members to `hub + local` |

### 5.6 Six refinement passes

For each other document, recompute the circular mean of its incoming rays and **translate the whole cluster** — not just the hub — to `placeOnRay(origin, mean, max(currentExtent + 200, currentHubDistance))`. Leftover wikilink chords stay on one side of the ring.

### 5.7 Fallback and relaxation

Any node still without a position gets `(CX + 40, CY + 40)`.

Then `RELAX_ITERS = 80` passes of `separateAlongRays`:

- `occupyOf(id) = nodeRadius(kind, hasChildren) + LABEL_HALO`.
- For any pair closer than `occupyOf(a) + occupyOf(b) + MIN_NODE_GAP`, the node **farther from the origin** is pushed radially outward by `(minD - dist + 8)`.
- A degenerate near-zero distance uses a fixed `(0.7, 0.4)` nudge direction.
- The **current document node is pinned** — it never moves.

### 5.8 Label placement

`labelPlacement` pushes the label outward from the node's own document hub by `reach = r + 22`. The anchor becomes `'start'` when the unit radial x is `> 0.35`, `'end'` when `< -0.35`, otherwise `'middle'` with a vertical `+ r + 6` offset to clear the circle.

`GraphView` recomputes the offset itself with `reach = r + max(18, userFont * 0.55)`, superseding the layout's value, because the rendered font size depends on the current fit scale.

### 5.9 Test-support exports

| Symbol | Purpose |
|---|---|
| `segmentsCrossProper(...)` | Strict orientation-based proper-crossing test. Collinear pairs return `false`. |
| `countProperEdgeCrossings(nodes, edges)` | O(n²) pair scan, skipping edge pairs that share an endpoint. |
| `headingDepthByNode(edges)` | Tree depth per heading node. Consumed by `assignConceptZ` in the 3D scene; asserted directly so a wrong tier is caught before it reaches a canvas. |

The first two exist so `scripts/test-graph.mjs` can assert "no initial edges cross".

## 6. Camera

[`utils/graph/graphCamera.ts`](../src/utils/graph/graphCamera.ts)

```ts
DEFAULT_GRAPH_ZOOM = 1
MIN_GRAPH_ZOOM     = 0.25
MAX_GRAPH_ZOOM     = 12
GRAPH_ZOOM_FACTOR  = 1.25

interface GraphCamera { cx: number; cy: number; scale: number }
interface Bounds { minX: number; minY: number; width: number; height: number }
```

| Function | Behaviour |
|---|---|
| `clampGraphZoom(z)` | Non-finite → `1`; otherwise clamped to `[0.5, 4]` |
| `stepGraphZoom(zoom, direction)` | `zoom * 1.25` or `zoom / 1.25`, then clamped |
| `fitCameraTo(bounds, viewport)` | "Meet" fit: `scale = min(vp.w / w, vp.h / h)`, centre at the bounds centre |
| `panCamera(camera, dx, dy)` | Moves the world **against** the drag: `cx -= dx / scale`, `cy -= dy / scale`. Scale is untouched |
| `screenToWorld(camera, ox, oy)` | `ox`/`oy` are **screen pixel offsets from the viewport centre** |
| `worldToScreen(camera, x, y)` | Exact inverse of the above |
| `zoomCameraAt(camera, scale, ax, ay)` | Zooms so the world point under the screen anchor `(ax, ay)` stays pinned |
| `zoomedViewBox(minX, minY, width, height, zoom)` | Legacy `viewBox`-shaped helper, retained for tests |
| `cameraBounds` / `cameraViewBox` | Visible world rectangle, and the matching SVG `viewBox` |

### Zoom is a multiplier, not an absolute scale

`useGraphCamera` stores the **fitted** scale and the zoom *multiplier* separately, composing them into `camera.scale`. This is deliberate: the fit scale changes whenever the layout or the pane resizes, so persisting one absolute scale would let the two fight and either one lose. The multiplier is what `GraphViewControls` displays as a percentage.

### Auto-fit contract

`useGraphCamera` re-centres **only when the layout bounds or the viewport actually change** — keyed by a rounded signature string — and **never while a pointer drag is in flight**. Nudging a node changes the bounds, and re-fitting mid-drag would yank the viewport out from under the pointer. The pre-refactor code handled this with a `frozenBox` ref; the hook makes the same guarantee without a second source of truth.

## 7. Rendering

`GraphView.tsx` exports `DEFAULT_GRAPH_LABEL_PX = 16`, `MIN_GRAPH_LABEL_PX = 12`, `MAX_GRAPH_LABEL_PX = 28`, `GRAPH_LABEL_STEP = 2`, plus `GraphView`, `GraphViewControls`, and `GraphViewProps`.

### Fit to content

A `ResizeObserver` on `div[data-graph-view]` tracks the viewport `{ w, h }` inside `useGraphCamera`. The label font is derived from the camera scale rather than a separately computed fit:

```
userFont = labelPx / max(camera.scale, 1e-6)   // world-units font size
maxChars = max(10, min(22, round((18 * 16) / labelPx)))
```

### Projection pipeline

Nodes pass through three pure transforms, in this order:

```
filterWorkspaceGraph                      (prunes the scope filter; see §11)
  → layoutWorkspaceGraph                  (flat + concept)
    or layoutMindmap                      (mindmap: spanning tree on X)
  → manual drag overrides                 (layout space)
  → applyFisheyeToNodes                   (layout space; currently inert, m = 0)
```

`projection: 'flat'` returns the radial layout coordinates unchanged and is the default.

**Concept is the exception.** It reads `lens.lensed` directly and builds a three.js world from the *unprojected* coordinates; see [§9d](#9d-3d-concept-projection).

**Mindmap is a layout, not a camera.** Switching to it re-runs `layoutMindmap` instead of wrapping the atom. Leftover edges stay in `graph.edges` and are drawn as dashed cross-links; see [§9b](#9b-mindmap-projection).

### SVG structure

```
<svg viewBox={cameraViewBox(...)} role="img" aria-label="Workspace knowledge graph">
  <line /> × N          ← edges, drawn first so nodes sit on top
  <text />              ← edge captions, hover only
  <g transform="translate(x,y)">  × N   ← nodes
      <circle r />
      <title>{fullLabel || label}</title>
      <text><tspan />…</text>
  </g>
</svg>
```

| Element | Styling |
|---|---|
| Edge | `stroke="currentColor"`, width `2.2` active / `1.6` dimmed; `text-paper-inkSoft` / `dark:text-cyber-muted`, `/25` and `/20` when dimmed |
| Edge caption | Only on hover of an active edge, at the midpoint, `y - userFont * 0.35`, `fontSize = userFont * 0.75`, `className="fill-current font-mono"` |
| Caption text | `edgeCaption(kind)`: `'@'` → `"@"`, `'heading'` → `"heading"`, otherwise `"[[wikilink]]"` |
| Node circle | document = `fill-cyber-clay dark:fill-cyber-cyan` when current, else `fill-paper-elevated dark:fill-ape-elevated`; heading = `fill-paper-surface dark:fill-ape-panel`; term = `fill-paper-base dark:bg-ape-base`. `stroke-paper-ink dark:stroke-cyber-primary`, width `3.2` current / `2.4` term / `2` otherwise |
| Label | One `<tspan>` per wrapped line, `dy = userFont * 1.2` after the first |

### Empty state

When `documents.length <= 1 && graph.nodes.every(n => n.kind === 'document')`:

> Add a heading or `[[term]]` (or `@` another document) to grow this graph.

### Hover tooltip

A `role="status"` `div[data-graph-label-tooltip]` pinned top-centre showing `hovered.fullLabel || hovered.label`. Each `<circle>` also carries a `<title>` for the native browser tooltip.

## 8. Interaction

### Neighbour dimming

`neighborsOf(id, edges)` returns `{id}` plus every source and target touching that node. While `hoverId` is set, everything outside that set drops to `opacity-25` and its edges dim. Cursors: `cursor-grab`, `cursor-grabbing` for the dragged node or while dragging anywhere on the SVG.

### Dragging

| Detail | Value |
|---|---|
| Start | `onNodePointerDown`, only `e.button === 0`; `preventDefault()` + `stopPropagation()`; `svg.setPointerCapture(e.pointerId)` |
| Threshold | `DRAG_THRESHOLD_PX = 5` — until the pointer moves this far, the session stays `moved: false` |
| Coordinate conversion | `svg.getScreenCTM()` + `createSVGPoint().matrixTransform(ctm.inverse())`, so the handler works off-node too |
| Storage | `overrides` is a plain `useState` map applied over `laidOut` in a `useMemo` |

> **Overrides live in layout space, not screen space.** They are recorded in the coordinate system the layout produced, *before* the fisheye lens. Recording a screen position would make manual drags drift as the camera pans. This is also why the label notes the origin is recovered from `placed`, not from the projected node. Overrides are cleared when the projection changes, because Mindmap and the radial map do not share coordinates.

> **Drag overrides are ephemeral.** They are lost on re-layout or remount. That is why `GraphViewControls`'s **Reset** bumps `graphEpoch`, which is used as `key={graphEpoch}` on `<GraphView>` — the remount is what clears the map.

### Clicking

`onNodeClick`:

| Node | Action |
|---|---|
| `kind === 'document'` | `setCurrentDocument` |
| `documentId != null && start != null && end != null` | `openRange`: switch document if needed, `setEditorFocus(documentId, { focused: false, selectionStart: start, selectionEnd: end })`, and dispatch `mvp:select-range` with `{ start, end }` |

Click and drag are disambiguated in `endDrag`: `if (!session.moved && node) onNodeClick(node)`.

### Background drag

Dragging empty SVG space starts a **navigation** session (`useGraphCamera`), distinct from node dragging:

| Projection | `kind` | Effect |
|---|---|---|
| `flat` | `pan` | `panCamera` — content follows the pointer at any zoom |
| `mindmap` | `pan` | `panCamera` — same as flat |
| `concept` | `conceptOrbit` | `dragToConceptPose` — the eye orbits its target |

All three start at `DRAG_THRESHOLD_PX = 3`. The node drag threshold stays at `5`; they are separate sessions with separate refs, so a node drag never rotates the scene.

### Keyboard

Each `<circle>` has `role="button"` and `tabIndex={0}`, with an `onKeyDown` that fires `onNodeClick` on `Enter` or `' '` (both `preventDefault()`).

**There are no arrow-key panning, wheel zoom, or wheel handlers.** Zoom is buttons-only. The 3D scene can still be explored with a pointer.

> **Concept has no keyboard path.** Flat and Mindmap put every node in the DOM as a focusable `<circle>`, so `Tab` reaches them and `Enter` opens them. A `<canvas>` cannot host focusable children, so the 3D view is pointer-only. This is a real accessibility gap, not an oversight — the [§9d](#9d-3d-concept-projection) label layer is `pointer-events: none` by design.

## 9. `GraphViewControls`

| Control | Behaviour | Disabled |
|---|---|---|
| `−` | `labelPx -= GRAPH_LABEL_STEP` | `labelPx <= 6` |
| `+` | `labelPx += GRAPH_LABEL_STEP` | `labelPx >= 48` |
| Readout | The raw `labelPx`, `tabular-nums` | — |
| **Zoom −** | `zoom /= 1.25`, clamped | `zoom <= 0.25` |
| **Zoom +** | `zoom *= 1.25`, clamped | `zoom >= 12` |
| Zoom readout | `{Math.round(zoom * 100)}%` | — |
| **Graph / Mindmap / 3D** | Single dropdown (`aria-haspopup="menu"`). Driven by the `PROJECTION_OPTIONS` table, so the trigger label and the menu rows cannot drift apart. `position: fixed` so the toolbar scroller cannot clip it | Never |
| **Filter** | Toggles the scope popover. `aria-expanded` tracks it; an `on` badge appears when the scope is non-empty | Never |
| **Reset** | `labelPx → 16`, `zoom → 1`, `projection → 'flat'`, `scope → empty`, `graphEpoch++` | Never |

`graphLabelPx`, `graphZoom`, `graphProjection`, `graphScope`, and `graphEpoch` are **`useState` in `Editor.tsx`, not store state.** They are intentionally not persisted.

The same `zoom` multiplier drives all three projections; Concept derives its eye distance from it ([§9d](#9d-3d-concept-projection)) rather than keeping a second value that could drift.

### The toolbar is one row, always

The editor toolbar in `Editor.tsx` and the controls group here were **both `flex-wrap`**, which stacked twice over: the controls broke internally at *their own* width, and the outer toolbar broke again at the pane's, dropping **Filter / Reset** onto a second line and then **Import / Save** onto a third. The overflow point drifted with pane width, so the same controls sat differently at every size.

Both are now `flex-nowrap`, and the toolbar row scrolls horizontally instead:

| Element | Contract |
|---|---|
| Toolbar row | `flex flex-nowrap`, one band at any width |
| `div[data-editor-toolbar-scroll]` | `flex-1 min-w-0 overflow-x-auto` — the controls slide under the Import / Save cluster rather than stacking |
| `GraphViewControls` | `inline-flex flex-nowrap shrink-0` — one unbreakable unit inside the scroller |
| Import / Save | `shrink-0`, **outside** the scroller, so they never move off the right edge |
| `flex-1 min-w-2` spacer | **Removed.** With a `nowrap` row it had nothing to push against, and it was the element whose wrap the second row used to break on |

`min-w-0` on the scroller is load-bearing: a flex item keeps its intrinsic content width by default, so without it `overflow-x` never engages and the pinned cluster gets shoved out instead of the row scrolling.

**The Filter popover is portaled to `document.body`** (v0.6.2) with a dim backdrop and solid fills (`.graph-scope-filter`, `z-index: 10000`). Concept-mode HTML labels use z-index up to 2000 for depth sorting; that layer is `isolate`d so those values cannot compete with Filter. The panel is still `position: fixed` and clamped; `GraphViewControls` re-measures the Filter button on capture-phase `scroll` and on `resize` so a toolbar scroll cannot leave the panel stranded. The **Format** menu in `Editor.tsx` follows the same fixed + re-measure contract (fixed in v0.6.1 after the scroller clipped an absolute dropdown).

## 9b. Mindmap projection

[`utils/graph/layoutMindmap.ts`](../src/utils/graph/layoutMindmap.ts)

Replaces the former Globe wrap. The same compiled graph is stripped to a **spanning tree** (the hierarchical bones) and drawn left-to-right. Loops and secondary relationships stay in `graph.edges` and are painted as **dashed, low-opacity cross-links**.

| Piece | Behaviour |
|---|---|
| Root | The open document node, else `docs[0]`, else the first node |
| Tree growth | BFS. Heading children of a node are claimed first, then `wikilink`, then `@`. Disconnected components become extra roots, stacked in Y |
| Placement | Child column starts after the parent's label. Seven or more siblings wrap into extra columns (2, then 3) so titles use pane width instead of one tall stack. Leaves pack on Y at `MINDMAP_LEAF_GAP`. A parent sits at the vertical midpoint of its children. The drawing is then centred on the origin |
| Tree edges | Cubic `mindmapTreePath` — control points stay on each endpoint's Y so the curve leaves a parent going right and arrives at a child from the left |
| Cross-links | Quadratic `mindmapCrossPath`, `stroke-dasharray: 8 10`, opacity ~0.45. Vertical-ish leftovers bow to the right (away from the root) |
| Navigation | Identical to Flat: background drag pans. No sphere, no far-side culling |
| Labels | Sit to the **right** of the node (`textAnchor: start`), **one line**, never wrapped. The camera fit scale is floored so a leaf row is at least 36 CSS pixels, which may overflow the pane (pan) rather than overlap titles |

`layoutMindmap` returns `{ nodes, treeEdgeIds }`. `treeEdgeIds` is a `Set` of `GraphEdge.id`; `GraphView` uses it only for stroke style. Click, hover, Filter, and Reset are the Flat path.

`sphereProject.ts` remains in the tree as the rotation helper Concept reuses (`dragToOrientation`); it is no longer a Graph projection.

## 9c. Fisheye lens

[`utils/graph/fisheyeLens.ts`](../src/utils/graph/fisheyeLens.ts)

Graphical fisheye (Sarkar & Brown 1992), Eq. (1) of Wang et al. 2018:

```
β  = ‖x − c‖ / ‖b − c‖
β' = (m + 1)·β / (m·β + 1)
x' = c + (b − c)·β'
```

`b` is the ray-intersection of `c → x` with the boundary (`boundaryPointOnRay`, taking the smallest positive `t` against all four edges).

| Detail | Rule |
|---|---|
| Identity | `m = 0` returns the input **object**, and `applyFisheyeToNodes` returns the input **array**, so an inactive lens costs nothing |
| Clamp | `MAX_FISHEYE_MAGNIFICATION = 40`. Above that `β' → 1 + 1/(mβ)` and the far field piles onto the boundary as a wall of overlapping nodes |
| Direction | Every `β` is lifted, but by a decreasing factor — that relative squeeze *is* the effect. Near nodes gain ~7× at `m = 10`, far nodes ~1.1× |
| Focus | `applyFisheye(c, c, …)` returns `c`; the focus never moves |
| State | `useGraphLens` — `focal` starts `null` and `magnification` starts `0`, so the lens is inert until both exist |

**The lens is currently not exposed in the UI.** `useGraphLens` is wired into the pipeline with `enabled: false`, so it is an identity until a focal-point control lands.

## 9d. 3D Concept projection

[`utils/graph/conceptProject.ts`](../src/utils/graph/conceptProject.ts) · [`components/Concept3DScene.tsx`](../src/components/Concept3DScene.tsx)

The third projection. Where Mindmap **re-lays** the graph as a tree, Concept keeps the radial layout planar and **extrudes** it: `layout.x → world.x`, `layout.y → world.z`, and heading tiers rise along `world.y`. The atom becomes a floor plan with a stack over it.

> `viewMode` is still `'write' | 'preview' | 'split' | 'graph'`. Concept is the third entry in the same projection dropdown as Graph and Mindmap, for the reason [§1](#1-what-it-is) gives: same nodes, same clicks, different camera. It is **not** a fifth pane.

### Pipeline divergence

```
buildWorkspaceGraph → filter → layout (radial or mindmap) → drag overrides → fisheye (inert)
                                                             │
        ┌────────────────────────────────────────────────────┤
        │                                                    │
   flat / mindmap: <svg>                             concept: THREE.WebGLRenderer
                                                              (reads `lens.lensed` directly)
```

Concept is the one projection **not** implemented as an SVG coordinate map on `placed`. It hands `lens.lensed` to a `three.js` scene, because building a 3D world needs the *unprojected* layout coordinates — a projected point cannot be lifted onto an axis. `projected` still returns them unchanged (with `depth: 1, visible: true`) so `byId`, the hover ring, and `onNodeClick` stay identical across all three.

The fisheye lens stays **off** in Concept and Mindmap: `β` is a planar boundary ratio and has no meaning on a tilted floor, and Mindmap already unpacks hierarchy in layout.

### Heights — two opposing y-bands

v0.5.8 split headings and terms onto opposite signs of the world Y axis. A tall document used to read as one horizontal slab because the extrusion step (`60 + depth · 70`) was small relative to a layout radius that clears 200–400 units, and terms piled onto the highest tier anyway. Both bands now separate cleanly:

| Node | `slot.y` | Notes |
|---|---|---|
| `document` | `0` | The floor — `world.y = 0` |
| `heading` | `conceptHeadingY(depth, extra, bandStories)` | Virtual depth `depth · bandStories + extra` fed through `conceptZForDepth` (gaps compress past depth 6). A parent with more than 5 heading children helixes extras onto up to 3 stories so Graph 3D does not replay a 2D fan of overlapping labels. `bandStories` is the graph-wide max. Small outlines (`≤ 5` siblings) keep `bandStories = 1` and match `conceptZForDepth(depth)`. |
| `term` | `-CONCEPT_TERM_DEPTH` = `-200` | On the underground ring at the term's `(world.x, world.z)` |

   520|`headingDepthByNode` reports **tree** depth, and the distinction from the radial shell is load-bearing. `assignShells` deliberately collapses a lone page H1 onto the nucleus ring (invariant 5) so its `##` children get a full shell — under that collapse Welcome's H1 and its ten `##` share one tier, and using shell depth would render the page one layer flat. The walk seeds the **children** of every root at `0`, not the roots themselves, because a root's parent is a document or a synthetic `heading-path:` node and neither is a heading.

The walk is **iterative** and keys on `depth.has(id)`. `buildWorkspaceGraph` cannot produce a cycle, but a hand-built edge list could, and recursion would blow the stack; `concept: a cyclic heading edge list terminates` asserts totality.

### Tier spacing compresses with depth

Markdown tops out at six heading levels, but `splitHeadingPath` (`Comment > A > B > C…`) is **unbounded** — so a path heading can produce as many tiers as someone cares to type. At a flat `135` per tier, a 40-tier document reached `~5,500` units and had to be framed from a distance that made every label unreadable. The spacing now **tapers with depth**:

| Constant | Value | Role |
|---|---:|---|
| `CONCEPT_Z_STEP` | `135` | Gap at shallow depth |
| `CONCEPT_Z_COMPRESS_AFTER` | `6` | Where compression engages — exactly where plain markdown stops |
| `CONCEPT_Z_COMPRESS_RATIO` | `0.82` | Per-tier multiplier past that point |
| `MIN_CONCEPT_Z_STEP` | `56` | Floor; still ~2× a heading sphere's world radius (`20 × 1.15`) |

```
conceptZStep(d) = d <= 6 ? 135 : max(56, 135 · 0.82^(d-6))
```

Two properties make this safe rather than merely smaller:

- **Ordinary documents do not move.** Six tiers of plain markdown — every normal document — still sit at `270 + 6 · 135 = 1080`, exactly where they did. The threshold is *chosen* to be CommonMark's heading ceiling, so compression only ever engages on path headings.
- **Geometry converges before it collides.** Repeated multiplication means the total height stops being a function of nesting depth: 40 tiers land at `3,041` (55% of linear) instead of `5,535`, and the gap floors at `56` by tier 15 rather than decaying forever. A tall stack is still navigable; an interpenetrating one would not be, which is why the floor sits at `56` and not lower.

The spacing test walks **all 60 tiers** rather than checking depth 1 — with a taper, a shallow-only check passes while a deep outline's tiers have already sunk into each other.

### Zoom range is one number, not two

`MAX_CONCEPT_DISTANCE` is **derived**: `MAX_GRAPH_ZOOM × DEFAULT_CONCEPT_DISTANCE`. That is not tidiness, it is a bug fix.

> Before this, the ceilings were independent: `MAX_GRAPH_ZOOM = 4` against `MAX_CONCEPT_DISTANCE = 6000`. Since `1800 × 4 = 7200 > 6000`, the toolbar happily read **400%** while `clampConceptDistance` had already stopped the eye at 333% — a silent clamp, visible only as a camera that refuses to move. `zoom: the Concept eye distance never clamps below its own zoom range` now asserts the *property*, so a future retune of either constant cannot reintroduce the disagreement.

### Labels — two ranges that must not drift

`GraphView` exposes `MIN/MAX_GRAPH_LABEL_PX` for the SVG; `Concept3DScene` re-clamps its own projected label layer. The scene is lazy-loaded and cannot import those constants without a static cycle back through `GraphView`, so the literals are the duplication.

> They were silently wrong before this: the SVG allowed `12–28px` while the 3D layer clamped to `[10, 26]`. A user at 28px would see larger labels in Flat and identical labels in 3D, with no indication anything had been dropped. Both now read `[6, 48]`, and the test suite asserts the two agree by parsing both files.

### Label legibility — hierarchy, depth, and separation

Every label rendered at the same size, the same weight, and the same ink, at any camera distance, painted in DOM insertion order. Orbiting therefore collapsed the graph into one undifferentiated field of same-shaped words: the sphere radii already distinguished a hub from a heading from a `[[term]]`, and the label layer threw that information away.

Four mechanisms now compose, all inside the existing label loop:

| Mechanism | Rule | Why |
|---|---|---|
| **Kind hierarchy** | `conceptLabelStyle` — document `1.0` / `700`, heading `0.92` / `600`, term `0.82` / `500`. The current document is pinned to `1.0` / `700` | Mirrors `nodeRadius` (`36` / `20–26` / `16`). Type now carries the same distinction the geometry already draws |
| **Depth ramp** | `conceptLabelDepth` — opacity `1 → 0.25`, scale `1 → 0.7` across `[0.55, 1.9] × poseDistance` | The 3D layer had **no** depth cue, so a node 50 units away and one 3000 units away looked identical |
| **Z-order** | `z-index = 2000 · (1 − t)`, from the ramp's own `t` | DOM order decided occlusion, so rotating the scene arbitrarily shuffled which label won an overlap |
| **Halo** | Three-pass `text-shadow` in the canvas surface colour | The standard map-label treatment — keeps two overlapping words individually readable without a background plate |

**Nearest wins, nothing disappears.** No label is ever hidden; the near one paints solid on top while the far one fades toward `0.25`. "Collision" is resolved by paint order and contrast, not by removal — the graph never silently loses wording.

**The ramp is zoom-invariant by construction.** Both bounds are ratios of `poseDistance`, never absolute distances. Zooming tightens the readable band along with the geometry, so the ramp looks the same at 25% and 1200%. Absolute bounds would need a ceiling of their own and would silently disagree with `MAX_CONCEPT_DISTANCE` the moment either was retuned — the same bug class that constant is derived to prevent. `label: the depth ramp is zoom-invariant` asserts the property rather than the values.

**Hover opts out of the fade.** The node under the pointer renders at full size and full opacity. Fading it would hide precisely the thing the user aimed at. The neighbour-lit set keeps the existing `0.25` dim.

**The clamp survives the kind scale.** `Math.max(6, Math.min(48, s.labelPx))` is still the first thing the label block computes, and per-kind scaling is applied *after* it — folding the multiplier into the clamp would break `label: the 3D layer honours the SVG label range`, which parses that literal out of the source. `conceptLabelStyle` re-applies the floor afterwards so a `0.82`-scaled term at a 6px base cannot render at 4.9px.

Two incidental fixes in the same block: labels are now **created before** they are positioned (a node appearing mid-session used to sit unpositioned for one frame, flashing at the layer origin), and the theme observer now rewrites the halo alongside the edge and floor materials, so a light-mode halo does not survive a dark flip as a fringe.

### Sphere colours are lifted in dark mode

`ConceptPalette`'s dark values originally reused the `ape.*` **surface** tokens. Those are right as SVG fills — a flat circle needs only to be distinguishable from the canvas — but the 3D spheres are `MeshStandardMaterial` under real lights, and an albedo that dark renders at essentially the background value:

| Kind | Was | Contrast | Now | Contrast |
|---|---|:-:|---|:-:|
| `document` | `#222932` | 1.23:1 | `#5F738C` | 3.71:1 |
| `heading` | `#1A2026` | 1.10:1 | `#465767` | 2.43:1 |
| `term` | `#11171B` | **1.00:1** | `#3A4C58` | 2.03:1 |

`term` was **byte-identical to the `ape.base` canvas**, so `[[term]]` spheres were not "dark" so much as invisible. A whole-frame luminance histogram confirmed it: 98.5% of pixels fell in the darkest eighth of the range, with the two brightest buckets empty.

The replacements preserve the original **hue and saturation exactly** and raise only lightness, so the cool blue-grey family is unchanged and the three kinds stay related. `document` is the lightest because a hub is the anchor you navigate by. Light mode is unchanged.

> **Do not "simplify" these back to the `ape.*` tokens.** They read as fills in the SVG and as near-black albedo here. The two surfaces want different colours for the same node kind.

### Slot shape

`assignConceptHeights` returns `Map<string, ConceptSlot>`, not `Map<string, number>`. The scene reads `slot.y` to place the mesh and `slot.term` to branch materials / label offsets:

```ts
interface ConceptSlot {
  y: number;       // world Y the mesh sits at
  ringX?: number;  // floor x for the underground term ring
  ringZ?: number;
  term: boolean;   // true for [[term]] nodes only
}
```

A term's `(ringX, ringZ)` equals its layout anchor — preserved so a heading-to-term wikilink chord reads vertically downward (every edge chord now follows both endpoints' `slot.y`, not the floor; the old `e.kind === 'heading'` distinction in the scene was retired with this change).

### Pose

```ts
interface ConceptPose { yaw: number; pitch: number; distance: number; target: Point }
```

| Detail | Rule |
|---|---|
| Yaw | Azimuth about the vertical axis. Positive turns the eye right |
| Pitch | **Elevation**, positive looks *down*. Opposite sign to the sphere's tilt, because a camera above a floor is the natural reading |
| Distance | Eye-to-target radius. `conceptDistanceFromZoom(zoom) = zoom · 1800`, clamped `[400, 6000]` |
| Target | Layout-space orbit centre; re-centred by the same `fitKey` effect that drives the flat camera's `center`, so a resize or data change still reframes |
| Default | `{ yaw: -0.6, pitch: 0.7, distance: 1800 }` — front-right, ~40° up. At pitch 0 the floor is edge-on and the tiers line up into a single row |
| Clamp | `clampConceptPose` reuses `clampPitch` from `sphereProject.ts` |

   530|### Zoom is derived, not stored

`distance` is recomputed from the toolbar's `zoom` multiplier on every change rather than held as independent state. `GraphViewControls` drives **one** `zoom` for all three projections; a separate `distance` would drift the moment the user pressed `Zoom +` in one projection and switched to another — the same failure mode as storing an absolute SVG scale alongside a fit scale.

### Rotation gain

`dragToConceptPose` delegates to `dragToOrientation` with `pixelsPerRadian = max(viewport.w, 320) / π`. One full-pane drag is a half revolution. This is asserted.

### Free navigation (v0.5.8)

`three.js`'s `OrbitControls` is mounted on the scene's `<canvas>`. The hook remains the single source of truth for `ConceptPose` — `OrbitControls` reads `pose.distance` / `pose.target`, drags them around, and writes back via `setConceptPose`. Distance changes are mirrored into the toolbar's `zoom` multiplier on the same callback, so wheel-dolly shows in the readout.

| Gesture | Effect | Notes |
|---|---|---|
| Left drag, empty space | Orbit | Existing `conceptOrbit` path; OrbitControls observes the same drag delta without re-emitting |
| Left drag on a node | Move the node | OrbitControls' `enabled` flips to `false` for the duration (invariant 16) |
| Shift + left drag | Pan | OrbitControls default |
| Right drag | Pan | OrbitControls default |
| Two-finger drag | Pan | OrbitControls touch handler |
| Pinch | Dolly | OrbitControls touch handler |
| Mouse wheel | Dolly | Wheel-to-zoom |
| `+` / `-` keys | Dolly | OrbitControls keydown on the wrapper |
| Arrow keys | Pan | OrbitControls keydown |
| Click on a node | Select (document) / open range (heading) | Unchanged raycast path |

Polar-angle clamps are `MIN_POLAR_ANGLE = π · 0.08` and `MAX_POLAR_ANGLE = π · 0.92`, symmetric around π/2 so OrbitControls' `phi = π/2 - pitch` matches `clampPitch` exactly. The terse range is what keeps the camera off both poles — at the north pole the floor flips; at the south pole the scene's `lookAt` becomes singular.

Damping (`dampingFactor = 0.08`) keeps the camera moving briefly after `pointerup`, which is what makes a quick wheel flick feel like a flick rather than a snap. Damping is skipped during node drags because `controls.update()` is gated behind `controls.enabled`.

### Edges are zoned

| Edge kind | Z of both endpoints |
|---|---|
| `heading` | The lifted heights, so an outline reads as a stack |
| `wikilink`, `@` | **Each endpoint's own `slot.y`**, which places terms-below-floor and headings-above-floor correctly |

Lifting wikilinks would put every cross-document chord through the heading stack, where the extrusion hides it. The v0.5.8 zoning mirrors the slot rather than the heading kind, so a heading-to-term chord reads cleanly downward through the negative-y band.

### Interaction parity

The scene owns a `Raycaster`, but **not** the drag model. On every pointer event it raycasts first, then forwards the event to `GraphView` through a `handlers` prop, so orbit-vs-node-move and the override bookkeeping live in one place for all three projections.

| Step | Rule |
|---|---|
| Hover | `onHoverChange(id)` sets the same `hoverId` the SVG uses, so the tooltip and the `neighborsOf` dimming ring are the same code |
| Click | Resolved on `pointerup` from a fresh pick, then `onConceptNodeClick` routes through `byId`. `endNodeDrag(…, fireClick = false)` suppresses the SVG's own click so it cannot double-fire |
| Node drag | The scene reports the pointer ray's intersection with `y = 0` in **layout** space (`floorPointFromRay`); the override is anchored at `floorAnchorRef` captured on pointer-down. Overrides stay layout-space within a projection; switching projection clears them because Mindmap does not share the radial coordinates |
| Orbit | Background press with no hovered node → `cam.beginDrag(e, 'conceptOrbit')` |
| Label | A `position: absolute` div per node. The anchor is the layout label offset (`labelDx` / `labelDy`) at `slot.y`, projected each frame, so wording rides the heading helix instead of a fixed screen-pixel nudge. `p.z > 1` hides nodes behind the camera |

### Bundle

three.js is reached through `React.lazy` **and** an `await import('three')` inside the effect, so it lands in its own chunk:

| Chunk | Size |
|---|---|
| `Concept3DScene-*.js` | 7.8 kB (3.4 kB gz) |
| `three.module-*.js` | 667 kB (172 kB gz) |
| `index-*.js` | +11 kB — this document's prose, since the Func Spec viewer bundles `func_spec/` as a shipped asset. No three.js. |

A workspace that never opens the 3D projection never pays for it, matching how `FileActionsButton` defers the OCR stack.

Colours resolve from the theme's CSS custom properties rather than a hardcoded hex pair, so the scene follows the light/dark toggle for free; a `MutationObserver` on `<html class>` re-reads them on a flip instead of requiring a remount. `--cyber-primary` / `--cyber-muted` are space-separated `R G B` triplets by design (they feed Tailwind's `<alpha-value>` slots), so they are parsed component-wise rather than as hex.

## 10. Invariants and gotchas

| # | Invariant |
|---|---|
| 1 | The graph is a **pure derivation**. It writes nothing to the store and reads nothing that is not already there. Do not add persistence without a strong reason. |
| 2 | `mention:` sentinels must be skipped by `extractWikilinks`. Without the guard, every comment reference becomes a wikilink edge. |
| 3 | Only sections with `level > 0` become heading nodes. Preamble and blank-line fallback blocks do not. |
| 4 | The current document's node is **pinned** during relaxation. Moving it breaks the "atom" framing the whole layout depends on. |
| 5 | The single-child collapse in `assignShells` is what stops a one-H1 page from collapsing into one ring. Do not simplify it away. |
| 6 | Drag overrides live in component state and are cleared by remounting. Anything that must survive a drag has to move into the layout. |
| 7 | `edgeCaption(kind)` is the only place edge labels are decided; `ProposedEditCard` and `CommentLayer` have no relationship to it. |
| 8 | `countProperEdgeCrossings` skips edge pairs sharing an endpoint — without that, every node with two children would count as a crossing. |
| 9 | `heading-path:` nodes are synthetic; they have `documentId = null` and `start = end = null`, so clicking them does nothing. |
| 10 | Format / Comment / Predict follow `showWrite`, not `showGraph`. Graph controls follow `showGraph` (full Graph **or** Split). Do not hide write tools merely because Graph is visible. |
| 11 | Concept heights come from `headingDepthByNode` (**tree** depth), never from `assignShells`. The shell map collapses a lone page H1 onto the nucleus ring, so reusing it would render Welcome — an H1 plus ten `##` — one tier flat. |
| 12 | `headingDepthByNode` seeds the **children** of each root at depth `0`, never the roots themselves. A root's parent is a document or a `heading-path:` node, neither of which is a heading. |
| 13 | The 3D scene forwards pointer events to `GraphView`; it must not start a drag of its own. Two drag models would drift the moment the threshold or the override anchor changed. |
| 14 | three.js stays behind `React.lazy` **and** `await import('three')`. Eagerly importing it costs every workspace 667 kB for a view most never open. |
| 15 | Headings live on `world.y > 0` and `[[term]]` satellites on `world.y < 0` — `concept: terms and headings land on opposite signs of y` enforces it. A term that crept onto the highest tier would re-introduce the v0.5.8 single-slab bug. |
| 16 | `OrbitControls.enabled` flips to `false` for the duration of a node drag — the same pointer delta cannot both move a node and orbit the camera. Re-enabled on `pointerup`. |
| 17 | The scope filter runs **between `buildWorkspaceGraph` and `layoutWorkspaceGraph`**, never after layout. Filtering after would leave excluded nodes occupying layout space and force a second pass over the camera, the lens, and the three.js scene. |
| 18 | Excluding the current document **is allowed**. The filter checkbox must match the graph; `layoutWorkspaceGraph` then re-anchors on `docs[0]` among whatever remains. Pinning the current page made unticking it a silent no-op. |
| 19 | The ancestor walk that restores a `heading-path:` scaffold stops at the first **real** heading node. Dragging in a real ancestor would resurrect a `##` the user just unticked under a selected `###`. |
| 20 | A `[[term]]` survives on **reachability, not on selection**. It belongs to the workspace rather than to any one document, so it is kept iff a surviving node still links to it. |
| 21 | `MAX_CONCEPT_DISTANCE` is **derived** from `MAX_GRAPH_ZOOM × DEFAULT_CONCEPT_DISTANCE`, never set independently. Two independent ceilings let the toolbar read a percentage the camera never reached. |
| 22 | The 3D label clamp must equal `MIN/MAX_GRAPH_LABEL_PX`. The scene is lazy-loaded and cannot import them, so the literals drift unless a test diffs the two. |
| 23 | `CONCEPT_Z_COMPRESS_AFTER = 6` is **CommonMark's heading ceiling** on purpose. Any larger and compression would move ordinary documents; any smaller and it would engage on documents that never needed it. |
| 24 | The tier spacing test walks **every** tier, not depth 1. A taper makes a shallow-only check pass while deep tiers have already interpenetrated. |

## 11. Scope filter

[`utils/graph/graphFilter.ts`](../src/utils/graph/graphFilter.ts) · [`components/GraphScopeFilter.tsx`](../src/components/GraphScopeFilter.tsx)

Before this, the graph showed every document and every section, always. On a workspace of any size that is unreadable, and there was no way to narrow it. The filter is the missing control.

### It is a pre-layout pass, not a display toggle

The whole design follows from one placement decision:

```
buildWorkspaceGraph
  → filterWorkspaceGraph          ← the scope filter
  → layout (radial or mindmap)
  → drag overrides → fisheye lens → (flat | mindmap | concept)
```

Layout is a pure derivation of `(nodes, edges)`, so a pruned graph simply **lays out smaller**. Nothing downstream learns that a filter exists — the fisheye lens, the mindmap strokes, and `Concept3DScene` are untouched, and all three projections inherit the filter for free.

> Filtering *after* layout would have been the obvious alternative and the wrong one. The excluded nodes would still occupy layout space, still widen the camera's fitted bounds, and still force every downstream pass to re-derive what to skip — in three places instead of one.

### The scope

```ts
interface GraphScope {
  /** Empty = every document. `__graph_scope_none__` alone = no documents. */
  documentIds: Set<string>;
  /** docId → included `heading:<docId>:<start>` ids. No entry = all sections. */
  sectionIds: Map<string, Set<string>>;
}
```

Two shorthands, both resolved by helpers rather than at the call site:

| Shape | Means |
|---|---|
| `documentIds` empty | Every document |
| `documentIds` = `{__graph_scope_none__}` | No documents (`createNoneScope()`) |
| `sectionIds` has no entry for a document | Every section of that document |
| `sectionIds[doc]` is an **empty** set | That document, with none of its sections |

> The empty-set-means-everything shorthand is what lets **Reset** and the popover's **All** both be `createScope()`, and it is why `normalizeScope` exists: a fully-ticked panel has to collapse back to the default, or the Filter button would light up for a selection that restricts nothing. Unticking the last document must emit the none sentinel instead, or it would collapse into the same shorthand and restore the full graph.

### Pruning rules

| # | Node kind | Kept when |
|---|---|---|
| 1 | `document` | Its id is in the included set |
| 2 | `heading` | Its document is included, and its doc has no section filter or its id is listed |
| 3 | `heading-path:` | A surviving real heading walks up through it. These are synthetic, `start === null`, and never listed in the panel — a section filter cannot address one |
| 4 | `term` | At least one surviving node links to it, transitively |
| 5 | any edge | **Both** endpoints survive |

Rule 4 is a worklist, not a single pass, so a term chained to another term still terminates. Rule 5 is the same guarantee SVG already relies on: an edge to a node that is not drawn would otherwise stretch across the viewport to nothing.

> **The empty scope returns the input object by reference.** The unfiltered case is the overwhelmingly common one, and it should cost a comparison rather than two array filters.

### The panel

A popover reusing the `.mention-popover*` family — the same classes, `☑`/`☐` rows, and level gutter as the `@`-section picker. A graph filter and a section picker are the same mental operation; a second bespoke widget would read as a different product.

| Element | Behaviour |
|---|---|
| Document row | Toggles the document. Deselecting **drops its `sectionIds` entry**, so a later re-tick does not restore a choice the user cannot see was made. Shows `n/m` sections |
| Section row | Toggles one heading. Indented by `level`, hidden when its document is off |
| Cascade | Ticking a heading selects its descendants, unticking removes them — one click for a whole sub-outline, matching the `@`-picker |
| **All / None / Invert** | `All` = `createScope()`. `None` **keeps the current document**, so the result is still a layable graph with a visible way back |
| **Clear** | Appears only when the scope is non-empty |
| Keyboard | Arrows walk the flat row sequence, Space/Enter toggles, Escape closes, Cmd/Ctrl+A selects all |

Rows are derived from `buildHeadingSections(doc).filter(s => s.level > 0)`, the same predicate as Pass 1 of `buildWorkspaceGraph`, so the panel **cannot offer a row the compiler never made a node for**. Stale ids are filtered out on read, so a heading deleted since the scope was set cannot keep its checkbox lit.

Outside press closes, via a `pointerdown` listener that ignores both `[data-graph-scope-filter]` and `[data-graph-view-controls]` — the same pattern as the Format menu.

### Empty state

The pre-filter empty state could only say *"Add a heading or `[[term]]`…"*. A filter that excludes everything needs different words, or the user hunts for a bug that is not there — so the two are distinguished and the dead-end offers **Clear the filter** inline.

## 12. Next

- Wikilink syntax in the user guide → [Product overview §4.4](01-product-overview.md)
- Mentions that become `@` edges → [@-references](09-mentions.md)
- Layout fixtures → [Testing & security](14-testing-and-security.md)
- **Keyboard access in the 3D view** — the label layer is `pointer-events: none`, so Concept is currently pointer-only. Promoting it to a focusable DOM list is the fix.
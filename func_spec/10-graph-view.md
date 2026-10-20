# Graph view

> A local knowledge graph of the workspace, compiled entirely in the browser from documents, headings, `[[wikilinks]]`, and `@` mentions. No LLM call, no new dependency, no store-schema change. Added in v0.5.4. Pan / orbit navigation and the Globe projection added in v0.5.7.

---

## 1. What it is

Graph replaces the text panes in the editor's view dropdown. It is a **symbolic** map, not a vector index — there is no embedding, no similarity search, and no indexing step. Everything is derived from text you already have.

| Property | Value |
|---|---|
| Input | `documents: DocumentRecord[]` and `comments: Record<docId, Comment[]>` |
| Output | `{ nodes: GraphNode[]; edges: GraphEdge[] }` |
| Cost | Zero network calls, zero new dependencies |
| Persistence | **None.** It is a pure derivation of store state, recomputed on render |

In `graph` mode, Format / Comment / Predict hide because they need the textarea. File actions and Save revision stay.

**`viewMode` is unchanged by the Globe work.** It remains `'write' | 'preview' | 'split' | 'graph'`. A projection is a navigation aid *within* the Graph view, not a fifth pane:

| Why not a fifth `viewMode` |
|---|
| Graph and Globe are the same data with a different camera; a sibling pane would imply different capabilities |
| `viewMode` is persisted via `partialize`, so a new default would silently change what the app opens to between sessions |
| Keeping both reachable preserves the paper's own comparison — same nodes, undistorted vs. wrapped |

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

Both exist so `scripts/test-graph.mjs` can assert "no initial edges cross".

## 6. Camera

[`utils/graph/graphCamera.ts`](../src/utils/graph/graphCamera.ts)

```ts
DEFAULT_GRAPH_ZOOM = 1
MIN_GRAPH_ZOOM     = 0.5
MAX_GRAPH_ZOOM     = 4
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
layoutWorkspaceGraph
  → manual drag overrides              (layout space)
  → applyFisheyeToNodes                (layout space; m = 0 is an exact identity)
  → toSphere → rotateSphere → toScreen (sphere space; flat mode skips this)
```

The fisheye lens runs **before** the projection because edge orientation is only well defined on the plane — the refinement solve assumes a planar target.

`projection: 'flat'` returns the layout coordinates unchanged and is the default. That is an invariant the test suite asserts, not merely a convention.

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

> **Overrides live in layout space, not screen space.** They are recorded in the coordinate system the layout produced, *before* the fisheye lens and the sphere projection. Recording a projected position would make manual drags drift as the globe turns. This is also why the label notes the origin is recovered from `placed`, not from the projected node.

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
| `sphere` | `orbit` | `dragToOrientation` — the globe rotates |

Both start at `DRAG_THRESHOLD_PX = 3`. The node drag threshold stays at `5`; they are separate sessions with separate refs, so a node drag never rotates the globe.

### Keyboard

Each `<circle>` has `role="button"` and `tabIndex={0}`, with an `onKeyDown` that fires `onNodeClick` on `Enter` or `' '` (both `preventDefault()`).

**There are no arrow-key panning, wheel zoom, or wheel handlers.** Zoom is buttons-only. The globe can still be explored with a pointer.

## 9. `GraphViewControls`

| Control | Behaviour | Disabled |
|---|---|---|
| `−` | `labelPx -= GRAPH_LABEL_STEP` | `labelPx <= 12` |
| `+` | `labelPx += GRAPH_LABEL_STEP` | `labelPx >= 28` |
| Readout | The raw `labelPx`, `tabular-nums` | — |
| **Zoom −** | `zoom /= 1.25`, clamped | `zoom <= MIN + 0.001` |
| **Zoom +** | `zoom *= 1.25`, clamped | `zoom >= MAX - 0.001` |
| Zoom readout | `{Math.round(zoom * 100)}%` | — |
| **Graph / Globe** | Segmented `role="group"` toggle, `aria-pressed` on each | Never |
| **Reset** | `labelPx → 16`, `zoom → 1`, `projection → 'flat'`, `graphEpoch++` | Never |

`graphLabelPx`, `graphZoom`, `graphProjection`, and `graphEpoch` are **`useState` in `Editor.tsx`, not store state.** They are intentionally not persisted.

## 9b. Globe projection

[`utils/graph/sphereProject.ts`](../src/utils/graph/sphereProject.ts)

The layout plane is treated as tangent to a sphere at the **near** pole, so the layout origin `(0, 0)` maps to `(0, 0, +R)` and is visible on load. `SPHERE_RADIUS = 2600` layout units.

| Function | Behaviour |
|---|---|
| `toSphere(x, y, R)` | Inverse stereographic. `z = R(R² − x² − y²) / S` — the `R² − …` ordering is what puts the origin at `+R`. `\|P\| = R` exactly |
| `toScreen(p, R)` | Forward stereographic, `(R·x)/(R + z)`. Valid only for `z > 0` |
| `isFrontFacing(p)` | `z > 0`; the visible cap |
| `rotateSphere(p, {yaw, pitch})` | **Yaw spins about Y**, pitch about X |
| `clampPitch(p)` | `±0.92·(π/2)`, short of the degenerate pole |
| `dragToOrientation(base, dx, dy, pixelsPerRadian)` | `yaw += dx / gain`, `pitch += dy / gain`, pitch clamped |
| `angularDistance(a, b)` | Great-circle angle in radians, via `acos` of the clamped dot product |

### Why yaw rotates about Y

The near pole sits on the **+Z** axis, and Z is also the viewing axis. Rotating about Z would spin the globe *toward the camera*, which is visually a no-op. Yaw therefore rotates about Y, which rolls the visible cap horizontally. This is asserted directly by `sphere: yaw carries the near pole off the visible cap`.

### Rotation gain

`pixelsPerRadian = max(viewport.w, 320) / π`, so dragging across the full pane turns the globe a half revolution — one drag, one hemisphere.

The gain is deliberately derived from the **viewport**, not from `camera.scale`. A world-derived gain shrinks as you zoom in, which makes the globe spin wildly when zoomed out and barely move when zoomed in.

### Culling and depth

| Detail | Rule |
|---|---|
| Back hemisphere | `isFrontFacing` false → node is not rendered. Projecting it would place it behind the eye and render it mirrored |
| Edges | An edge is dropped unless **both** endpoints survive; otherwise it would stretch across the viewport to an undrawn node |
| Depth ramp | `depthScale(d) = 0.55 + 0.45·d` where `d = (z/R + 1) / 2`, applied to node and edge `opacity` |
| Lookup | `byId` is a `Map`, replacing the previous `placed.find()` scan inside `edges.map()` — that was O(E·N) and became the hot loop once every node re-projects on each `pointermove` |

> **The horizon loses context.** Culling the back hemisphere is what makes the globe readable, but it also means a far node can be entirely off-screen. The 2018 paper's own participants reported this of iSphere (*"the other far-way node is often lost"*). `Reset` returns to the fitted flat view as the escape hatch.

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

**The lens is currently not exposed in the UI.** `useGraphLens` is wired into the pipeline and gated on `projection === 'sphere'`, but nothing sets a focal point yet; it activates when focal-point placement lands.

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
| 10 | Graph mode hides Format / Comment / Predict because they need the textarea. If you add a toolbar control that works without the textarea, add it to the `showGraph` branch too. |

## 11. Next

- Wikilink syntax in the user guide → [Product overview §4.4](01-product-overview.md)
- Mentions that become `@` edges → [@-references](09-mentions.md)
- Layout fixtures → [Testing & security](14-testing-and-security.md)
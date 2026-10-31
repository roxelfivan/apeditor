## v0.6.8 — Toolbar polish, compact Mindmap, Preview default

Patch on top of [v0.6.7](https://github.com/roxelfivan/apeditor/releases/tag/v0.6.7). Quieter editor/Graph controls, tighter Mindmap packing, first-run **Preview**, and propose-edit / Local Model token tidy-ups.

### Highlights

- **Predict icon-only; Preview Size ±.** Sparkle without the word; caption font buttons when Preview is selected.
- **Mindmap stays compact and on-canvas.** Parent-relative horizontal packing; SVG pad tracks enlarged labels (up to 96px); magnifier zoom icons.
- **Default view is Preview.** Fresh installs open in Preview.
- **Propose-edit + tokens.** Reject disclosure, collapsed mismatch banner; token counters gate on Local Model (Send left of the counter).

### Notes

- See [`.release-notes-v0.6.8.md`](.release-notes-v0.6.8.md) for the full surface list.
- `package.json` version bumped to `0.6.8`.

## v0.6.7 — Chat composer follows the divider

Patch on top of [v0.6.6](https://github.com/roxelfivan/apeditor/releases/tag/v0.6.6). Dragging the strip between the conversation and the input moves **include selection** and grows the chat box with the divider — no empty gap under the handle.

### Highlights

- **Divider = top of the composer.** Drag up to grow the input; drag down to shrink it. Messages fill the leftover space above.
- **Include selection sticks to the handle.** The checkbox and the input’s upper edge follow the divider.
- **Typing area expands.** When a height is set, the textarea flexes to fill the composer block.
- **Persistence.** Same key `apeditor:chat-messages-height`, now meaning composer height (`0` = natural). Values outside 140–800 reset to natural.

### Notes

- See [`.release-notes-v0.6.7.md`](.release-notes-v0.6.7.md) for the full surface list.
- `package.json` version bumped to `0.6.7`.

## v0.6.6 — Mindmap labels that stay readable

Patch on top of [v0.6.5](https://github.com/roxelfivan/apeditor/releases/tag/v0.6.5). Mindmap titles wrap instead of overlapping, sit above the green connectors, and grow with toolbar **−** / **+** without scaling the whole tree. The Flat / Mindmap / 3D dropdown replaces the old Graph / Globe naming; Globe stereographic math is removed.

### Highlights

- **Wrap + column packing.** Titles wrap at ~40 columns (CJK = 2); only the wrapping title shrinks. Each column starts after the widest title before it.
- **Labels above the line.** Wording clears the green connector instead of sitting on it.
- **− / + = text size; Zoom = map scale.** Mindmap camera scale is pinned; font size drives layout and drawing.
- **Drag-to-scroll** on empty Mindmap space; radial projection renamed **Flat**.
- **Globe cleanup.** Stereographic projection and unused orbit camera state removed; Concept still reuses yaw/pitch helpers.

### Notes

- See [`.release-notes-v0.6.6.md`](.release-notes-v0.6.6.md) for the full surface list.
- `package.json` version bumped to `0.6.6`.

## v0.6.5 — Debug token counter, single-send comment batches

Patch on top of [v0.6.4](https://github.com/roxelfivan/apeditor/releases/tag/v0.6.4). A Debug Mode token counter sits next to both send buttons so you can see how big the next request is — and whether the Local Model has room for a full reply — before sending. Comment batches and rejection sends no longer transmit the message body twice.

### Added

- **Debug token counter.** Next to **Send** in Chat and **Send to AI** in the comment tray, when **Debug Mode** is on. Measures the **real packed request** (document, `@` references, comment batch), not just the typed text. Rough estimate at about 4 characters per token — no tokenizer dependency.
- **Local Model budget.** The pill shows the on-device limit: 8,192 tokens total, 1,024 reserved for the reply, so about 7,168 for the prompt. Amber when close, red when it does not fit, with a tooltip explaining that the reply will be cut short.

### Fixed

- **Comment batches sent twice.** The comment **Send to AI** path and the staged-rejection path read the chat history after appending the user message, then appended it again — so the model saw the whole batch twice, doubling the prompt and risking the 8192-token KV cache. Both now snapshot correctly.

### Internal

- See [`.release-notes-v0.6.5.md`](.release-notes-v0.6.5.md) for the full surface list.
- `package.json` version bumped to `0.6.5`.
- `npm run test:token-estimate`, `npm run test:token-counter-render`, `npm run test:send-comments-dup`.

## v0.6.4 — Local Model (Gemma), Chat attachments

Patch on top of [v0.6.3](https://github.com/roxelfivan/apeditor/releases/tag/v0.6.3). Keyless Google AI Mode is replaced by in-browser **Local Model** (Gemma / LiteRT-LM / WebGPU); first launch defaults to that provider; Settings hides advanced prompt fields unless Debug Mode is on. Chat **+** attachments from v0.6.3 remain.

### Added

- **Local Model (require around 2gb disk space).** Download Gemma into the browser Cache API, load/save `.litertlm` from disk, download tips every 5%. Chat + Comment Send to AI run locally (WebGPU). Predict and OCR→Markdown still need a keyed provider.

### Changed

- Default provider is `local-gemma` (was Minimax). `google-ai-mode` migrates to Local Model.
- Removed **selection only**. Removed Google AI Mode paste/URL path.
- **System message / Rationale / Temperature** only when Debug Mode is on.
- Welcome + Help call out Local Model as the default.

### Internal

- See [`.release-notes-v0.6.4.md`](.release-notes-v0.6.4.md) for the full surface list.
- `package.json` version bumped to `0.6.4`. New dep: `@litert-lm/core`.

## v0.6.3 — Chat composer attachments

Patch on top of [v0.6.2](https://github.com/roxelfivan/apeditor/releases/tag/v0.6.2). Attach photos or PDFs in Chat with **+**. Recognition stays in the browser. Send is one prompt: format the extracts as Markdown, then answer.

### Added

- **Chat +.** Same image/PDF types as Import. OCR via `extractTextFromFiles`. Extract rides with the turn; the document is unchanged.
- **Format-then-answer prompt.** `buildAttachmentTurnPrompt` wraps files and the typed request. No second `formatOcrAsMarkdown()` call.
- **Composer bar.** One field: textarea above, **+** left and **Send** right.

### Internal

- See [`.release-notes-v0.6.3.md`](.release-notes-v0.6.3.md) for the full surface list.
- `package.json` version bumped to `0.6.3`.
- `npm run test:chat-attachments`.

## v0.6.2 — Phone layout, chat archives, Graph Filter stacking

Patch on top of [v0.6.1](https://github.com/roxelfivan/apeditor/releases/tag/v0.6.1). Phones (including landscape) use overlay panels instead of three columns; Chat can collapse turns and archive threads; the Graph Filter stays opaque and above 3D labels.

### Added

- **Collapsible Chat and archives.** Click **Chat** to hide the message list (input stays). Older turns start collapsed. **History** / **Archive** park threads without deleting them; the next Send uses only Current. JSON backups include archives.
- **Phone / Android shell.** Viewports ≤767 px wide **or** ≤540 px tall collapse sidebar and chat to overlays. Help / spec / history / prompts live under **⋯** as a bottom sheet that sits above the editor. Settings is full-bleed on narrow screens.

### Fixed

- **Send to AI** no longer throws when Chat is collapsed (#35).
- **⋯ menu** was under the editor and clipped on iOS; it is now a `document.body` bottom sheet.
- **Graph Filter** no longer lets SVG / 3D titles (including the green current-document label) paint through the checklist. Solid panel + isolated 3D label layer + Filter `z-index: 10000`.

### Internal

- See [`.release-notes-v0.6.2.md`](.release-notes-v0.6.2.md) for the full surface list.
- `package.json` version bumped to `0.6.2`.

## v0.6.1 — Format menu, Split = Write/Preview | Graph

Patch on top of [v0.6.0](https://github.com/roxelfivan/apeditor/releases/tag/v0.6.0). The Format dropdown is visible again; Split keeps text beside Graph; Graph node clicks scroll the Write pane to the selected passage.

### Fixed

- **Format menu was clipped.** The toolbar's `overflow-x: auto` forces a computed `overflow-y: auto`, so an absolutely positioned dropdown below the trigger sat outside the clip rect (~145 px tall under a ~32 px scroller). The menu is now `position: fixed`, anchored to the trigger and clamped to the viewport (same pattern as Import / Export and Filter).
- **Graph clicks left the selection off-screen.** `mvp:select-range` from Graph now passes `scrollIntoView: true`; the Write pane scrolls so the range sits near the top quarter. The `.cm-mirror` overlay (visible words) is synced with the textarea on that scroll, and the scroll listener rebinds when Split remounts Write.

### Changed

- **Split = Write/Preview | Graph.** Left pane toggles Write or Preview (`layout.splitLeftMode`, persisted); right pane is Graph. View select order is Write → Preview → Graph → Split. Format / Comment / Predict follow Write; Graph controls show whenever Graph is visible. Full Graph still opens Split + Write on a heading click when needed.

### Internal

- See [`.release-notes-v0.6.1.md`](.release-notes-v0.6.1.md) for the full surface list.
- `package.json` version bumped to `0.6.1`.

## v0.6.0 — Legible 3D, single-row toolbar, refreshed onboarding

Minor release on top of [v0.5.9](https://github.com/roxelfivan/apeditor/releases/tag/v0.5.9). The 3D Concept projection is now readable while orbiting **and** has visible dark-mode spheres; the editor toolbar no longer stacks onto multiple rows; and the first-run Welcome document finally covers the Graph view.

### Fixed

- **3D labels were typographically identical.** Document / heading / term all rendered at the same size, weight, and ink. Labels now follow the sphere radii: document `1.0` / `700`, heading `0.92` / `600`, term `0.82` / `500`, with the current document pinned to full size and bold.
- **3D had no depth cue at all.** Flat and Globe fade by `depthScale`; the 3D layer did not, so a node 50 units away and one 3000 units away looked identical. Labels now fade (`1 → 0.25`) and shrink (`1 → 0.7`) with camera distance. The hovered node opts out.
- **DOM order decided occlusion.** No `z-index` meant rotating shuffled which label won an overlap. Nearest-to-camera now paints on top, derived from the same ramp position the fade uses.
- **Dark-mode 3D spheres were invisible.** The palette used the `ape.*` surface tokens — right as SVG fills, wrong for a lit 3D canvas. `term` was *byte-identical* to the background (`#11171B`), rendering at `rgb(22,22,22)` on `rgb(17,23,27)`. Colours lifted to 3.71:1 / 2.43:1 / 2.03:1 with hue and saturation preserved.
- **Overlapping words merged into a blob.** Labels get a three-pass text halo in the canvas surface colour, following the theme toggle.
- **Editor toolbar stacked onto 2–3 rows.** Both the row and the graph controls were `flex-wrap`, stacking twice over as pane width changed. Both are now `flex-nowrap` with a horizontal scroller; Import / Save stay pinned right.

### Added

- **Welcome document rewritten**, 10 → 12 sections. The Graph view was absent from onboarding entirely; JSON/Markdown export and the Re-link / Dismiss stale-comment flow were also missing. The AI section no longer implies a key is required.

### Internal

- See [`.release-notes-v0.6.0.md`](.release-notes-v0.6.0.md) for the full surface list.
- `package.json` version bumped to `0.6.0`.
- `npm run test:graph` — **83** cases.

## v0.5.9 — Graph scope filter, wider zoom / labels, deep-tier compression

Patch release on top of [v0.5.8](https://github.com/roxelfivan/apeditor/releases/tag/v0.5.8). The Graph view gains a document / section **Filter**, wider zoom (0.25×–12×) and label (6–48 px) ranges that also fix a silent Concept distance clamp, depth-compressed 3D tiers for tall path headings, and click fixes so a Graph node opens the document in Split.

### Added

- **Filter.** Toolbar popover to include / exclude documents and headings before layout. Flat, Globe, and Concept inherit the same pruned graph. Empty scope = everything; an explicit none sentinel covers "show nothing" without colliding with Reset.
- **Wider zoom and labels.** 0.25×–12× zoom; 6–48 px labels across all three projections. `MAX_CONCEPT_DISTANCE` is derived from `MAX_GRAPH_ZOOM` so the readout and the camera stay in lockstep.
- **Depth-compressed Concept tiers.** Past depth 6 the vertical gap tapers geometrically (floor 56), so deep `Comment > …` stacks stay legible. Wide sibling rings helix onto up to three stories so peer headings do not pile on one floor.

### Fixed

- Graph / 3D node clicks switch to Split and restore the caret (textarea is unmounted in Graph).
- 3D clicks no longer drop when the pointerup raycast misses after a clean pointerdown.

### Internal

- See [`.release-notes-v0.5.9.md`](.release-notes-v0.5.9.md) for the full surface list.
- `package.json` version bumped to `0.5.9`.
- `npm run test:graph` — **75** cases.

## v0.5.8 — Graph 3D: spread the stack, free navigation

Patch release on top of [v0.5.7](https://github.com/roxelfivan/apeditor/releases/tag/v0.5.7). The Concept projection learned two new things: how to look like a real 3D document outline instead of a flat slab of labels, and how to navigate freely.

### Added

- **Spread the y-axis.** Headings now rise 135 units per tier (was 70), so a tall document's `##` columns read as distinct bands. `[[term]]` satellites drop onto an underground ring at `y = -200`, so they cannot merge with heading tiers. The slot shape returned by `assignConceptHeights` tells the scene which side of the floor a node lives on.
- **Free 3D navigation via OrbitControls.** three.js's `OrbitControls` writes back into the same `ConceptPose` the hook already owns. Mouse wheel dollies, shift+drag pans, touch two-finger pans and pinches, arrow keys pan, `+` / `-` dolly, with damping. The toolbar's zoom readout follows a wheel-dolly on the same callback.

### Behaviour that did NOT change

- **`viewMode`** stays `'write' | 'preview' | 'split' | 'graph'`. The three projections remain an inner toggle.
- **Flat and Globe** are byte-identical, including their focusable `<circle>` nodes.
- **The store.** No new fields, no migrations.

### Known limitations

- **The 3D view is still pointer-only for navigation.** Promoting the label layer to focusable DOM is the tracked fix.

### Internal

- `src/utils/graph/conceptProject.ts` — `ConceptSlot`, `conceptTermSlot`, `conceptPoseFromCamera`, polar clamps.
- `src/components/Concept3DScene.tsx` — mounts `OrbitControls`; gates `controls.enabled` during node drag; edges follow each endpoint's `slot.y`.
- `src/hooks/useGraphCamera.ts` — `setConceptPose` writes through to the toolbar `zoom` multiplier on distance changes.
- See [`.release-notes-v0.5.8.md`](.release-notes-v0.5.8.md) for the full surface list and a tracking of the `ConceptSlot` change.

### Verification

- `npm run test:graph` — **57** (was 53; 4 new Concept cases). `npm run check:docs` — 349 / 349. `npm run typecheck` — clean. `npm run build` — clean. `OrbitControls` ships inside the existing `Concept3DScene-*.js` lazy chunk (8.6 kB / 3.8 kB gz, up from 7.8 kB); the main bundle and `three.module-*.js` are unchanged.

## v0.5.8 — Graph view: 3D Concept projection

Patch release on top of [v0.5.7](https://github.com/roxelfivan/apeditor/releases/tag/v0.5.7). The Graph view gains a **third projection**: a WebGL scene where the workspace graph is a *floor plan* and heading tiers stack upward, which you orbit. Flat and Globe are untouched. First release to add a runtime dependency (`three`), deferred behind `React.lazy` so a workspace that never opens 3D never downloads it.

### Added

- **`Graph` / `Globe` / `3D` toggle.** A third segmented button in the existing `GraphViewControls` row, now generated from a single `PROJECTION_OPTIONS` table so the three cannot drift apart. Default is still flat; **Reset** still returns to flat.
- **3D Concept projection.** `src/components/Concept3DScene.tsx` renders the same graph in three.js with the layout as the floor and heading tiers extruded upward. Orbit by dragging the background; click a document to select it or a heading to open its range, through the same code path as the SVG.
- **Heading tiers from tree depth.** New `headingDepthByNode(edges)` export: a top-level `#` sits at height `60`, each nested level adds `70`, and `[[term]]` satellites float `90` above their document's deepest tier. Deliberately **tree** depth, not the radial `assignShells` map — that one collapses a lone page H1 onto the nucleus ring and would render the Welcome document as a single flat tier.
- **Bundle split.** `Concept3DScene-*.js` is 7.8 kB (3.4 kB gz) and `three.module-*.js` is 667 kB (172 kB gz), both lazy chunks. The main bundle gains no three.js; its ~11 kB increase is the added `func_spec/` prose, which the in-app Func Spec viewer ships as an asset.

### Behaviour that did NOT change

- **`viewMode`** stays exactly `'write' | 'preview' | 'split' | 'graph'`. All three projections are a navigation aid *within* the Graph view, not three panes.
- **Flat and Globe** are behaviourally identical, including their focusable `<circle>` nodes.
- **The store** — no new fields, no migrations. **The fisheye lens** stays gated on `'sphere'` and inert; a planar boundary ratio means nothing on a tilted floor.

### Known limitations

- **The 3D view is pointer-only.** A `<canvas>` cannot host focusable children, so Concept has no keyboard path where Flat and Globe have one. Promoting the label overlay to a focusable DOM list is the tracked fix.

### Internal

- `src/utils/graph/conceptProject.ts` (new), `src/components/Concept3DScene.tsx` (new) — see [`.release-notes-v0.5.8.md`](.release-notes-v0.5.8.md) for the full surface list.
- `func_spec/10-graph-view.md` — new **§9d 3D Concept projection**; invariants 11–14 added.

### Verification

- `npm run test:graph` — **53** (was 36; 17 new Concept cases). `npm run check:docs` — 349 / 349. `npm run typecheck` — clean. `npm run build` — clean.

## v0.5.7 — Graph navigation: pan, orbit, Globe

Patch release on top of [v0.5.6](https://github.com/roxelfivan/apeditor/releases/tag/v0.5.6). The Graph view can finally be moved around — drag empty space to pan the flat map; flip the toolbar's new **Globe** toggle to spin the same nodes onto a sphere. Three new pure modules in `src/utils/graph/` and two in `src/hooks/`; zero new dependencies, no store-schema change, no `viewMode` change.

### Added

- **Pan in the flat map.** Background drag now moves the camera. At any zoom, content follows the pointer in world units (`dx / scale`). Wrapped in `useGraphCamera`, alongside the existing zoom controls. The auto-fit re-centres only when the layout bounds or the pane actually resize, and never mid-drag.
- **`Graph` / `Globe` toggle.** A segmented control in the existing `GraphViewControls` row, after the zoom buttons. Switching re-projects the same nodes through `toSphere` → `rotateSphere` → `toScreen` from `src/utils/graph/sphereProject.ts`. Default is flat. **Reset** returns to flat.
- **Spherical navigation.** Dragging in Globe mode spins the sphere, not the camera. Yaw rotates about Y — so dragging horizontally actually rolls the visible cap, the way users expect from a globe (rotating about Z would spin the visible cap toward the camera and visually do nothing). Rotation gain is `viewport.w / π`; a full-pane drag is one half revolution regardless of zoom level. Sphere radius is `SPHERE_RADIUS = 2600` layout units.
- **Back-hemisphere culling.** Nodes on the far side of the sphere (`z < 0` after rotation) are not drawn rather than mirrored onto the screen. Edges are dropped unless both endpoints are front-facing, so a single culled node does not strand its edges across the viewport. Depth ramp `0.55 + 0.45·d` applied to opacity, where `d = (z/R + 1) / 2`.
- **Graphical fisheye lens.** `src/utils/graph/fisheyeLens.ts` implements Sarkar & Brown's graphical fisheye, Eq. (1) of Wang et al. Infovis 2018: `β' = (m + 1)β / (mβ + 1)`. `m = 0` returns the input object and array by identity, so an inactive lens is free. Not yet UI-exposed — `useGraphLens` is wired in but inert until a focal point can be set.

### Fixed

- **Dark-mode Graph labels were invisible.** `dark:text-cyber-primary` sets the CSS `color` property, which SVG `<text>` ignores. Swapped to `dark:fill-cyber-primary`, the matching SVG fill token from the same `--cyber-primary` custom property; verified by reading the computed `fill` in dark mode (`rgb(244, 241, 234)` — the warm cream already used by other `--cyber-primary` consumers). Light mode (`fill-paper-ink`) is unchanged.

### Internal

- `src/utils/graph/graphCamera.ts` — `GraphCamera { cx, cy, scale }`, `fitCameraTo`, `panCamera`, `screenToWorld`, `worldToScreen`, `zoomCameraAt`, `cameraBounds`, `cameraViewBox`. `zoomedViewBox` retained for the existing test.
- `src/utils/graph/sphereProject.ts` — `toSphere` (inverse stereographic, exact `|P| = R`), `toScreen` (forward stereographic, requires `z > 0`), `rotateSphere` (yaw about Y, pitch about X), `isFrontFacing`, `dragToOrientation`, `clampPitch`, `angularDistance`, `IDENTITY_ORIENTATION`.
- `src/utils/graph/fisheyeLens.ts` — `applyFisheye`, `fisheyeRatio`, `boundaryPointOnRay`, `clampMagnification`, `applyFisheyeToNodes`. `m = 0` is an exact identity.
- `src/hooks/useGraphCamera.ts` — owns viewport measurement, fit, pan, orbit, zoom, anchored zoom. Zoom is a *multiplier* on top of the fit scale; fits adjust independently of zoom.
- `src/hooks/useGraphLens.ts` — owns the lens state; off when `focal == null` or `m == 0`.
- `src/components/GraphView.tsx` — props now `labelPx`, `zoom`, `onZoomChange`, `projection`. Render pipeline: layout → manual drag overrides → fisheye lens → sphere projection → camera. The `placed.find()` inside `edges.map()` is replaced by a `Map`.
- `src/components/Editor.tsx` — `graphProjection` is local `useState` (not persisted), default `'flat'`. `Reset` returns to `'flat'`.
- `scripts/test-graph.mjs` — 21 new test cases (`npm run test:graph`: 15 → 36).

---

## v0.5.6 — Round-trip JSON backups

Patch release on top of [v0.5.5](https://github.com/roxelfivan/apeditor/releases/tag/v0.5.5). Round-trips the v1 `DocumentBackup` shape introduced in v0.5.3: a backup produced today can be re-imported with comments, chat history, and revisions intact.

### Added

- **Import full backup (JSON).** A new **Import .json** button (one popover section below the existing **Export .json**) restores a document plus its comments, chat history, and revisions from a backup file. The hidden file picker accepts `application/json`; inline errors surface for the size cap (`BACKUP_MAX_FILE_BYTES = 50 MB`), JSON parse failures, missing `schema`, and version mismatches. The clean case (no id collisions) imports in one tap without any modal; colliding ids open a per-row modal with **Replace / Skip / Keep both** so imports never silently overwrite. Successful imports land the new doc at the top of the sidebar and the editor switches to it.
- **Bidirectional `DocumentBackup` v1.** `parseDocumentBackup` is the inverse of `serialiseDocumentBackup` — exporting and re-importing produces a deep-equal document state, including comment rounds, mention tokens, and revisions. The shape is unchanged so existing backup files stay importable.

### Internal

- `src/utils/backup.ts` — `parseDocumentBackup`, `resolveImportDecisions`, `buildKeepBothDocument`, `BackupParseError`, `BACKUP_MAX_FILE_BYTES`. Id collisions, malformed records, and version mismatches each throw a `BackupParseError` with a user-facing message; id collisions with the live store are intentionally NOT errors (the modal resolves them).
- `src/store/store.ts` + `src/store/types.ts` — `applyImportPlan(plan: ImportPlan)` is the single writer; the UI computes plans via `resolveImportDecisions` and feeds them in.
- `src/components/FileActionsButton.tsx` — fourth popover section + collision-resolution modal. Outside-click is skipped while the modal is open so the popover's anchor stays in place.
- `scripts/test-backup-roundtrip.mjs` — 19 esbuild + `node:assert/strict` cases. Wired as `npm run test:backup-roundtrip`.
- `package.json` — `test:backup-roundtrip` script.
- `func_spec/11-import-ocr-backup.md` — §5 Import added; invariants §7 items 10–12 rewritten for the bidirectional path.
- `SECURITY.md` — threat-model entry updated for bidirectional v1 + Ask-only overwrite.
- `package.json` version bumped to `0.5.6`.

### Verification

- `npm run test:backup-roundtrip` — 19 cases cover round-trip, every error path, collision strategy defaults, and `buildKeepBothDocument` sanitisation.
- `npm run test:heading-sections` — clean.
- `npm run test:proposed-edit` — clean.
- `npm run test:graph` — clean.
- `npm run typecheck` — clean.
- `npm run build` — clean.

---

## v0.5.5 — Preview wikilinks, Graph polish, Functional Specification

User-visible release on top of [v0.5.4](https://github.com/roxelfivan/apeditor/releases/tag/v0.5.4). Preview / Split render `[[wikilinks]]` as purple labels without brackets; Graph Reset re-lays out a tidier atom map; an in-app **Functional Specification** ships beside Help; and Graph-open + Chat typing no longer blanks the tab.

### Added

- **Preview / Split wikilink display.** `formatWikilinksForPreview` turns `[[Name]]`, `[[Name|label]]`, and `[[Name#Heading]]` into `<span class="wiki-link">…</span>` (alias → heading → target). Write mode keeps the raw `[[…]]` syntax. Mention sentinels (`[[mention:…]]`) are skipped.
- **Functional Specification overlay.** Top-bar **`{ }`** and `⌘/Ctrl+Shift+E` open `FuncSpecDocs` over `func_spec/*.md` (catalog in `src/docs/funcSpecCatalog.ts`). Esc closes Help or the Functional Specification.
- **`npm run check:docs`.** `scripts/check-func-spec-links.mjs` verifies Functional Specification internal links.

### Changed

- **Graph Reset** remounts via `graphEpoch` and re-runs the atom layout (title: tidy atom layout).
- **Graph layout** — compact orphan parking and post-relax term re-park on neighbor rays so leftover wikilink chords cross the nucleus less often.

### Fixed

- **Maximum update depth / blank tab** when Graph is open and the user types in Chat — `GraphView` viewport `setVp` and `MentionInput` chip/position maps bail out when measurements are unchanged.

### Behaviour that did NOT change

- Chat prompts, proposed-edit JSON schema, Apply waterfall, JSON backup, OCR, session-only API key.
- Graph compile rules. `@` mention sentinels are still not treated as wikilinks.

### Internal

- `src/utils/graph/parseWikilinks.ts` — capture alias; `wikilinkDisplayLabel` / `formatWikilinksForPreview`.
- `src/utils/markdown.ts` — sanitize allows `span` + `className` (and `mark` + `className`) for Preview injects.
- `src/components/Editor.tsx` — Preview pipeline: PE `<mark>` inject, then wikilink spans.
- `src/index.css` — `.wiki-link` purple (light / dark).
- `src/components/FuncSpecDocs.tsx`, `src/docs/funcSpecCatalog.ts`, `func_spec/` — developer guide.
- `src/App.tsx` — `{ }` button, hotkey, `mvp:open-func-spec`.
- `src/components/GraphView.tsx` / `MentionInput.tsx` — equality bailouts.
- `src/utils/graph/layoutWorkspaceGraph.ts` — layout polish.
- `package.json` version bumped to `0.5.5`.

### Verification

- `npm run test:graph` — clean (15 cases).
- `npm run typecheck` — clean.
- `npm run build` — clean.
- Manual: Write `[[Ideas]]` → Preview shows purple **Ideas** without brackets; Graph Reset tidy; open Graph + type in Chat without blanking; open **`{ }`** Functional Specification.

---

## v0.5.4 — Graph view with `[[wikilink]]` term nodes

User-visible release on top of [v0.5.3](https://github.com/roxelfivan/apeditor/releases/tag/v0.5.3). Adds a fourth editor view that compiles the workspace into a local knowledge graph. No LLM call, no new npm dependencies, no store-schema migration, and no change to chat / proposed-edit contracts.

### Added

- **Graph editor view.** The Write / Preview / Split dropdown now includes **Graph**. It replaces the write and preview panes. Format, Comment, and Predict hide (they need the textarea). File actions and Save stay.
- **Document and heading nodes.** Every sidebar document is a node. Every Markdown heading (`#` / Setext, `level > 0`) is a child node, using the same `buildHeadingSections` algorithm as the `@` picker.
- **`[[wikilink]]` term nodes.** Write `[[Name]]`, `[[Name|label]]`, or `[[Name#Heading]]` in a document (Obsidian / LLM wiki syntax). A matching document title (or heading) becomes an edge to that node. An unresolved name becomes a **term** node; the same slug in two docs is one node with two edges.
- **`@` mention edges.** Comment-round `@` references draw edges to the target document or heading.
- **Explore UX.** Hover a node to dim non-neighbors and show the edge reason (`heading`, `@`, or `[[wikilink]]`). Click a document to open it. Click a heading or term to open its document and select that span (`mvp:select-range` + `editorFocus`). Graph does not auto-create a document when you click a term.
- **Help — What's new.** In-app Help (`?`) now has a **What's new** page for the current release, kept in sync with `docs/whats-new.md`.

### Behaviour that did NOT change

- Chat prompts, proposed-edit JSON schema, Apply waterfall, JSON backup, OCR, and session-only API key.
- `@` mention sentinels (`\u200B[[mention:…]]\u200B`) are not treated as wikilinks.
- No wiki ingest, Louvain communities, Graph Insights, or embeddings.

### Internal

- `src/utils/graph/parseWikilinks.ts` — extract / resolve wikilinks; skip `mention:` sentinels.
- `src/utils/graph/buildWorkspaceGraph.ts` — pure compile of documents, headings, `@` mentions, and wikilinks.
- `src/components/GraphView.tsx` — SVG radial layout, hover dim, click to open / select.
- `src/store/types.ts` — `viewMode` union includes `'graph'` (already persisted).
- `src/components/Editor.tsx` — Graph option, hide write-only toolbar, mount `GraphView`.
- `src/docs/catalog.ts` + `docs/whats-new.md` — Help catalog entry.
- `scripts/test-graph.mjs` + `npm run test:graph`.
- `package.json` version bumped to `0.5.4`.

### Verification

- `npm run test:graph` — clean (6 cases).
- `npm run typecheck` — clean.
- `npm run build` — clean.
- Manual: Write → Graph → Preview; hover dim; click a document node; `[[Ideas]]` and a dangling `[[orphan-term]]` appear as a doc edge and a term node.

---

## v0.5.3 — JSON backup, comment Re-link / Dismiss, gated-state polish, Apply waterfall

User-visible release on top of [v0.5.2](https://github.com/roxelfivan/apeditor/releases/tag/v0.5.2) (the internal-only refactor + debug-POST strip). v0.5.2 itself did not ship any of these features, and the session-only API key feature shipped earlier under the name `persistApiKey` ([`src/store/types.ts`](src/store/types.ts), default `true`). The two custom-install branches `feat/v0.5.2-slice-b` and `feat/v0.5.3-slice-c` that previously attempted to ship this code were closed without merging; v0.5.3 is the canonical home for everything in them.

### Added

- **Export full backup (JSON).** A new **Export .json** button at the bottom of the file-actions popover (sibling to **Export .md**) downloads the current document, its comments, its chat history, and its revisions as a single file. Filename matches the existing `${title}.md` pattern with a `.json` extension. The payload is versioned (`schema: 'apeditor-document-backup'`, `version: 1`) so a future re-importer can detect and upgrade older backups; v0.5.3 ships write-only.
- **OCR-vs-key gate copy.** The Import popover now shows a contextual paragraph under the language checker explaining what runs locally versus what needs an API key. With no key: *"OCR works without an API key. Adding one in Settings lets the recognised text be rewritten as Markdown before insertion. Without a key, raw text is inserted as-is."* When a key is configured the paragraph switches to a confirmation ("Key configured. Files are OCR'd locally and rewritten as Markdown via your model before insertion.") so the user always knows which path they're on.
- **Two-step Google AI Mode paste hint.** When the provider is `google-ai-mode` and a paste is awaiting, a numbered list now sits between the section header and the paste textarea spelling out: (1) Google AI Mode opened in a new tab with your prompt, (2) copy the answer out of that tab, (3) paste it below — ⌘/Ctrl+Enter to commit. First-time users no longer paste their original question here by mistake.
- **Per-row stale list in the comment tray.** When the document has any outdated comments, the tray now grows a collapsed-by-default *"N stale comments — Re-link or Dismiss"* expandable list. Each row shows the original snippet, a **Re-link** button, and a **Dismiss** button. A small *Dismiss all* (the previous bulk action) lives in the row header so the swept-everything path is still one click.
- **`ReanchorPicker` modal.** A new picker component (renders in the editor pane, mirrors `SectionPicker`'s visual style) lists the current document's heading structure (or its paragraphs when there are no headings). Selecting a row emits the byte `(start, end)` of that slice and calls the existing `reattachComment(id, { start, end })` store action. Keyboard: `↑` / `↓` to move, `Enter` to confirm, `Esc` to cancel.
- **`isCommentStale(comment, content)` helper.** New pure export from [`src/utils/comments.ts`](src/utils/comments.ts) that mirrors the strategies used by `reanchorComment` so a UI surface can flag stale rows without mutating anything.
- **Proposed-edit editor highlight.** While a card is open, the matched Exact or Best Effort span is painted in the editor so you can see where Apply would land.

### Changed

- **Comment tray UX.** The bulk *Dismiss outdated* button is demoted to a secondary *Dismiss all* action on the stale list header — the new per-row *Dismiss* is now the fastest single-comment path.
- **Empty-state copy in the `@` doc picker.** When there are no other documents to mention, the picker now spells out the reason instead of showing "No matching documents" across the board. Three states are distinguished by a `data-empty-reason` attribute (`no-workspace` / `only-current` / `no-match`).
- **Proposed-edit Apply waterfall.** Cards expose a single **Apply** button (Exact if the quote matches, otherwise Best Effort) plus **Highlight Apply** only when the editor has a selection. Separate Exact / Best Effort / always-visible Force-apply affordances are gone. **Apply N** uses the same Exact → Best Effort waterfall per edit.
- **Form-safer Best Effort.** Matching requires ~85% coverage of the quoted passage (or a coherent section snap), expands to markdown block / section boundaries, strips re-emitted ATX headings from both the hole and the inserted text, grows residual same-line leftovers into the hole, and **blocks** Apply when a splice would duplicate surrounding text (user falls through to Highlight Apply). Softened the previous noisy first/last-word duplication heuristic.
- **Onboarding / skip copy.** Welcome text and Apply-All skip messaging say **Highlight Apply** instead of Force-apply.

### Fixed

- **Debug ingest POSTs on the proposed-edit path.** Hardcoded `fetch('http://127.0.0.1:7578/ingest/...')` blocks left in `ProposedEditCard` / `findBestEffortAnchor` during waterfall development are removed so they cannot leak into the production bundle.

### Behaviour that did NOT change

- The Markdown export flow.
- OCR pipeline, language picker, import size / page caps.
- Google AI Mode URL generation — only the in-app paste affordance copy changed.
- The `Comment` system, the `Document` model, and the `Comment`-round / undo / reanchor logic (aside from the new tray / picker UI).
- The session-only API key feature (shipped in v0.5.2 as `persistApiKey`) — its UI / store are unchanged.
- All prompt, store, and LLM-facing contracts (proposed-edit JSON schema unchanged; only client-side apply matching / UX changed).

### Internal

- `src/utils/backup.ts` — new module. `buildDocumentBackup({documentId, documents, comments, chats, revisions, appVersion})` returns a `DocumentBackup` (or `null` for unknown ids); `serialiseDocumentBackup` emits pretty-printed JSON. `BACKUP_SCHEMA` and `BACKUP_VERSION` are exported so a future importer can match. No React / DOM imports.
- `src/components/ReanchorPicker.tsx` — new component. Heading sections (or paragraph fallback) rendered as rows; emits `{ start, end, label }`. Reuses the `.mention-popover` CSS classes so the picker is visually consistent with the @-section picker.
- `src/components/FileActionsButton.tsx` — added four store selectors (`documents`, `commentsByDoc`, `chatsByDoc`, `revisionsByDoc`), `onBackupClick` mirroring the existing `onExportClick` error / UX shape, a third popover section ("Export full backup (JSON)") with the same structural template as the two previous sections, and the contextual OCR-vs-key paragraph under the language checker. The new button carries `data-backup-toggle` for future keyboard wiring.
- `src/components/mentions/DocPicker.tsx` — added an `emptyReason` derivation (`no-workspace` / `only-current` / `no-match`) from a memoised `othersCount` plus the existing `candidates` list, and replaced the one-size-fits-all "No matching documents." with the three context-appropriate strings. Carries `data-empty-reason={reason}` for any future analytics / testing selector.
- `src/components/ChatPanel.tsx` — added a three-step `<ol>` between the "Paste the AI Mode answer" `<label>` and the existing `<textarea>` placeholder. Rendered only when `isKeyless && awaitingPaste`, so it never affects users on a keyed provider. Apply-All skip copy updated for Highlight Apply; `applyAllEdits` now waterfalls Exact → Best Effort.
- `src/components/CommentTray.tsx` — extended with `outdatedComments`, `onDismissOne`, `onReanchor` props. When both per-row callbacks are provided, the old bulk `Dismiss outdated` button is replaced with the new expandable stale list.
- `src/components/Editor.tsx` — wires the re-link picker; paints ephemeral `proposedEditHighlights` for open cards.
- `src/components/ProposedEditCard.tsx` — single `handleApply` waterfall; Highlight Apply only with selection; best-effort transparency panel retained.
- `src/utils/proposedEdit.ts` — `expandBestEffortRange`, `prepareBestEffortReplace`, coverage gate, duplication block, waterfall `applyAllEdits`.
- `src/utils/comments.ts` — new `isCommentStale(comment, content): boolean` export. Mirrors strategies 1 + 3 of `reanchorComment` and short-circuits on already-flagged comments.
- `src/index.css` — new `.cm-tray__btn--ghost`, `.cm-tray__stale*`, `.cm-stale-list*`, `.relink-picker`, and proposed-edit highlight rules.
- `scripts/test-proposed-edit.mjs` + `npm run test:proposed-edit` — harness for Exact / Best Effort / heading / overlap / `applyAllEdits`.
- `package.json` version bumped to `0.5.3`.

### Verification

- `npm run typecheck` — clean.
- `npm run test:proposed-edit` — clean (7 cases).
- `npm run build` — clean.
- Manual:
  - File actions popover, with a document that has comments and chat history → **Export .json** → file downloads as `<title>.json` (correctly sanitised). Opening the file shows `schema`, `version`, `exportedAt`, `appVersion`, `document`, `comments`, `chats`, `revisions`. Open with no document → button disabled.
  - File actions popover with no API key configured → paragraph shows the warn-coloured "OCR works without an API key" message. Add a key in Settings → paragraph switches to the cyan "Key configured" confirmation.
  - Mention picker: type `@` in the chat input with only the current document open → "Only the current document is open. Create another in the sidebar to reference it with @." Delete all docs → "No documents yet. Create one in the sidebar, then reference it with @." Type a query that matches nothing → "No matching documents."
  - Settings → Provider → Google AI Mode, then send a chat with ⌘+Enter → Google opens in a new tab. Switch back → the three numbered steps appear above the paste textarea; ⌘+Enter commits as before.
  - Edit a document so a comment's anchor moves; reload ApEditor → comment flips to **Outdated**. Open the comment tray → the stale list appears collapsed. Click the caret → list expands with one row showing the snippet, **Re-link** + **Dismiss** buttons. Click *Dismiss* → row disappears, the bulk *Send to AI* count drops by one. ⌘Z → row reappears.
  - Same starting state. Click *Re-link* → the picker modal opens in the editor pane with the document's headings listed (or paragraphs when there are no headings). `↓` to a heading, `Enter` → the picker closes, the comment's anchor updates to the chosen slice, the badge moves to the new location. The undo toast *"Comment re-anchored — ⌘Z to revert"* briefly appears. ⌘Z → comment flips back to outdated and the old anchor is restored.
  - Proposed-edit card with an exact quote → one **Apply** button labelled with "Exact match"; click applies once. With a paraphrased quote that still overlaps → "Best effort · N%"; Apply replaces the section body without double-printing the heading. With no usable match → tip to select text → **Highlight Apply** appears after selection.

---

## v0.5.2 — Codebase sanity pass + long-term sustainability refactor

Internal-only release on top of [v0.5.1](https://github.com/roxelfivan/apeditor/releases/tag/v0.5.1). No user-visible behaviour changes; one shipped bug-fix (a debug-instrumentation leak in the production bundle) plus a layered refactor of the two files that had grown to the point of blocking sustainable development. UI, store schema, and `localStorage` payloads are unchanged; no migration is required to upgrade.

### Fixed

- **Debug POSTs stripped from production.** Four hardcoded `fetch('http://127.0.0.1:7578/ingest/...')` blocks had been left behind in `src/components/ChatPanel.tsx` by an earlier substrate debug session. None of them were gated behind a `process.env.NODE_ENV !== 'production'` check, so they would have shipped in the production bundle and made every chat key on every send try to hit a localhost ingest endpoint. They have been removed. No external HTTP call now happens from any chat code path — the only outbound network traffic is the user-initiated `/chat/completions` request. Also: removed a stray `void App;` in `src/main.tsx` that was a leftover suppress-unused-import experiment.

### Changed

- **`src/store/useStore.ts` split into 5 single-responsibility files.** The 1,485-line zustand store is now:
  - `src/store/types.ts` — the `StoreState` + `EditorFocusState` interfaces and the `DEFAULT_SYSTEM_MESSAGE` re-export. Importable on its own so future modules / tests can take a typed state dependency without paying for the implementation.
  - `src/store/defaults.ts` — the build-time `initialProvider`, `defaultApiConfig`, the seed prompt library, and the `Welcome` / `Ideas` starter documents. Onboarding tweaks no longer have to touch the store wiring.
  - `src/store/actions.ts` — the comment-round / undo / reanchor action implementations, plus their shared helpers (`pushUndoOp`, `findCommentEntry`, `replaceComment`, `ensureRoundsShape`, `markLatestRoundSent`, `findCommentForEdit`, `snippetOverlapScore`). Every action is a named export now, so each one can be unit-tested independently of the store.
  - `src/store/store.ts` — the `create<StoreState>()(persist(...))` wiring, the lightweight settings/document actions, the `partialize` shape, and the rehydration migrations. Also hosts `useCurrentDocument`.
  - `src/store/useStore.ts` — a thin barrel that re-exports `useStore`, `useCurrentDocument`, and `DEFAULT_SYSTEM_MESSAGE` so the existing 11 import sites (`App.tsx`, `Sidebar.tsx`, `SettingsModal.tsx`, `Editor.tsx`, `ChatPanel.tsx`, etc.) keep working unchanged.
- **`@`-mention parser moved to `utils/`.** `src/components/mentions/parseMentions.ts` has zero React / DOM imports, but `src/utils/proposedEdit.ts` was importing it from `components/` — a `utils → components` layering violation and a tree-shake time-bomb the day someone tightens bundling. The module now lives at `src/utils/mentions/parseMentions.ts`. Every caller (`MentionInput`, `MentionChip`, `CommentPopover`, `ChatPanel`, `proposedEdit`) imports from the new path. The old file is deleted.

### Behaviour that did NOT change

- **No UI changes.** All keyboard shortcuts, gating, panels, modals, and theme behaviour are exactly as they were in v0.5.1.
- **No store-schema changes.** The `persist` `partialize` shape is byte-identical, so existing `localStorage` payloads continue to load with no migration.
- **No provider / API changes.** OpenAI-compatible stream-parsing, Anthropic / OpenAI prompt caching, outbound secret redaction, selection-only mode, and everything in `src/api/chat.ts` is untouched.
- **No OCR / import / export changes.** The `import('@/utils/ocr')` dynamic import boundary, the 50 MB / 500-page / 200 MB caps, and the Export Markdown downloader are all as in v0.5.0 / v0.5.1.
- **All comment-round / undo / reanchor logic is byte-identical.** The action implementations were cut and pasted verbatim into `actions.ts`; only their location changed.

### Internal

- New / refactored files: `src/store/types.ts`, `src/store/defaults.ts`, `src/store/actions.ts`, `src/store/store.ts`, `src/utils/mentions/parseMentions.ts`.
- Deleted files: `src/components/mentions/parseMentions.ts` (relocated).
- Deleted code: the four debug POSTs in `src/components/ChatPanel.tsx` (useEffect mount, `mvp:send-comments` entry, `mvp:send-comments` pre-docSnap + TDZ try/catch, `handleSend` entry) and the `void App;` line in `src/main.tsx`.
- README updated: new `## What's new in v0.5.2` block at the top, version badge bumped to `v0.5.2`.

### Verification

- `npm run typecheck` — clean.
- `npm run build` — clean. Main entry chunk is 790.43 kB (was 791.91 kB in v0.5.1 — a 1.5 kB reduction from the deleted debug code; OCR / pdfjs / worker-entry chunks are unchanged).

---

## v0.5.1 — Phase 1 polish + Phase 2 daily friction

Patch on [v0.5.0](https://github.com/roxelfivan/apeditor/releases/tag/v0.5.0). Completes UX **Phase 1** (docs, gated-state tooltips, ⌘Z teaching toast) and **Phase 2** (selection-only send, outbound secret redaction, outdated-comment dismiss/re-attach, session-only API key). Export Markdown, import caps, and best-effort Apply stay as in v0.5.0.

### Added

- **Selection only** in Chat — send the highlight instead of the document outline, with `BEGIN/END EDITOR SELECTION` delimiters.
- **Outbound secret redaction** (`src/utils/secrets.ts`) — common key/token shapes replaced with `[redacted]` on send only.
- **Dismiss outdated** on the comment tray; **Re-attach** on the outdated popover to the current editor selection.
- **Forget API key when this tab closes** — key in `sessionStorage`; documents/chat stay in `localStorage`.

### Changed

- Predict tooltip + `aria-disabled` for Google AI Mode; `@` gated until ≥2 sidebar documents; Import popover API-key hint.
- First ⌘/Ctrl+Z that is not a comment-op shows a one-shot toast (native text undo still runs).
- `docs/workspace.md` documents editor font size in the **Format** menu.
- Apply All skip line points at Apply anyway / Force-apply on leftover cards.

### Removed

- No-op mentions chip-layout `useLayoutEffect`.

### Internal

- `src/utils/secrets.ts`, `formatSelectionBlock` in `src/api/chat.ts`, `reattachCommentToRange` in `src/utils/comments.ts`, `sendSelectionOnly` / `persistApiKey` on the store, `API_KEY_SESSION_KEY` in `src/utils/storage.ts`.

### Verification

- `npm run typecheck` — clean.

---

## v0.5.0 — Export Markdown, import size caps, best-effort Apply, file-actions alignment

Feature release on top of [v0.4.9](https://github.com/roxelfivan/apeditor/releases/tag/v0.4.9). Three user-visible wins from the UX roadmap ([ux-enhancement-plan-fba2](https://github.com/roxelfivan/apeditor/blob/cursor/ux-enhancement-plan-fba2/tmp/ux-enhancement-phases.md)) — Export Markdown, import size / page caps with friendly errors, and a one-click best-effort Apply for mismatched AI quotes — plus a follow-up alignment pass on the new Import / Export popover and a rename of the toolbar component from `ImportMediaButton` to `FileActionsButton`. One new doc (`docs/UX_SLICE_1.md`) captures the slice design rationale.

### Added

- **Export Markdown.** A new **Export .md** button at the top of the Import popover (in the editor toolbar) downloads the current document as a Markdown file. Filename is the document title, sanitised; defaults to `untitled.md`. This is the only durable off-tab backup of your writing today — `localStorage` can be wiped by browser data clearing, private-mode expiry, or quota eviction, with no warning. The download helper (`downloadTextFile` + `sanitizeFilename` in `src/utils/storage.ts`) is the foundation for a future JSON backup that includes comments, chat history, and revisions.
- **Inline confirmation prompt for best-effort Apply.** When the AI's `original` quote can't be matched in the current document by any of the six existing strategies (exact / trimmed / whitespace-collapsed / Setext heading / ATX-prefix / markdown-escape), Apply no longer silently fails. A new `findBestEffortAnchor` utility in `src/utils/proposedEdit.ts` runs a token-overlap match with an adaptive lookahead, a skip budget, and a 100 KB content cap. If it finds a candidate, the card shows an inline alert with the matched passage and a confidence percentage; the user confirms or cancels before any text changes. The Apply button stays enabled whenever EITHER a strict OR a best-effort match is available, with the tooltip reflecting which path will run.

### Changed

- **Import size and page caps.** Imports now refuse with a friendly inline error before doing any heavy work if any file is over 50 MB, the batch is over 200 MB total, or a PDF has more than 500 pages. Previously the OCR pipeline read the entire PDF into memory and rasterised every page, which could freeze or evict the tab on a multi-hundred-page scan.
- **File-actions popover alignment.** The Export and Import sections inside the popover now share the same structural template (section header → two-sentence description → primary-CTA action button row aligned right). The Export button was upgraded from `btn-ghost-sm` (tertiary, muted) to `btn-fire-sm` (primary CTA) so both sections have visually identical primary actions. Popover reorder: Import first (the toolbar button's primary semantic identity), Export second.
- **Toolbar icon reframed.** The down-arrow-into-tray glyph (which read as "Import only") is replaced by a page-with-arrows glyph: a small page outline flanked by an up arrow (Export) on the left and a down arrow (Import) on the right. Direction-neutral — reads as "this button handles files in and out for a document." The toggle's `aria-label` and `title` were updated in lockstep.

### Renamed

- **`ImportMediaButton` → `FileActionsButton`** (component + file). The old name stopped being accurate when the popover gained a second action; the rename is purely a name correction, no behaviour change. `git mv` preserves blame history (78 % similarity). All doc references in `README.md`, `RELEASE_NOTES.md`, `docs/ARCHITECTURE.md`, `docs/REFACTORING.md`, `docs/UX_SLICE_1.md` are updated to the new name with `(formerly ImportMediaButton)` breadcrumbs so the old name stays grep-fable.

### Behaviour that did NOT change

- The six existing `findEditAnchor` strategies (preserved verbatim).
- The Force-apply path — still the right escape hatch when no anchor of any kind is available.
- Apply All in `ChatPanel` — still reports `"Applied x of y changes (z skipped — not anchored)"` for batches. Per-skipped "Apply individually" link is queued for the next slice.
- The **Potential mismatch detected** warning UI on `ProposedEditCard` — kept; only the inline message copy is now conditional on whether a best-effort is available.
- All prompt, store, and LLM-facing contracts.
- All other toolbar buttons.

### Internal

- `src/utils/storage.ts` — added `downloadTextFile` + `sanitizeFilename`.
- `src/utils/ocr.ts` — added `validateOcrBatch`, `formatOcrSize`, and three limit constants; pre-flight checks in `extractTextFromFiles` and `extractFromPdfFile`.
- `src/utils/proposedEdit.ts` — added `findBestEffortAnchor` + `BestEffortAnchor` type.
- `src/components/FileActionsButton.tsx` (formerly `src/components/ImportMediaButton.tsx`) — added `useCurrentDocument()`, `onExportClick`, an Export section in the popover, and the alignment pass (both sections now use `btn-fire-sm` for their primary CTA; both descriptions follow the same two-sentence template; the toolbar SVG was redrawn as a page-with-arrows glyph). The component was renamed because the toolbar button now exposes both Import and Export actions, not just Import; `aria-label`, `title`, and the `data-file-actions-toggle` selector were updated in lockstep.
- `src/components/ProposedEditCard.tsx` — added `bestEffortAnchor` memo, `pendingBestEffort` state + stale-span effect, `performReplace` helper, confirmation handlers, and the inline prompt JSX. `handleApply` routes between strict and best-effort paths.
- `docs/UX_SLICE_1.md` — new document capturing the full slice design.

### Verification

- `npx tsc --noEmit -p tsconfig.app.json` — clean.
- `npm run build` — clean.
- `findBestEffortAnchor` smoke tests — 10 / 10 pass.

---

## v0.4.9 — Unified Format dropdown + draggable Chat / ProposedEditCard splits

UI-focused release on top of [v0.4.8](https://github.com/roxelfivan/apeditor/releases/tag/v0.4.8). The editor toolbar consolidates the two small pill groups (B/I/U and font size +/−) into a single **Format** dropdown, the Chat panel gains a draggable boundary between its messages and input areas, and every **ProposedEditCard** in Split view now has a draggable divider between the **Original** and **Proposed** columns. No prompt, store, or LLM-facing changes.

### Added

- **Unified Format dropdown** on the editor toolbar. A single button labelled **Format** replaces the previous two pill groups (B / I / U and + / −). Click it to open a menu with five items:
  - **Bold** — wraps the current selection in `**...**`.
  - **Italic** — wraps in `*...*`.
  - **Underline** — wraps in `<u>...</u>`.
  - **Size +** — `bumpEditorFontSize(+1)`. Disabled when the editor is at the 24 px ceiling.
  - **Size −** — `bumpEditorFontSize(-1)`. Disabled at the 10 px floor.
  The menu closes after any action and when the user clicks outside it. The existing `Ctrl/Cmd+B / I / U` keyboard shortcuts are unchanged; the `wrapSelection` and `bumpEditorFontSize` functions are reused as-is.
- **Draggable Chat panel split.** A drag handle now lives between the messages area and the input area in the right-hand Chat panel. Drag up to give the messages more room, down to give the input more room. The split is persisted in `localStorage` under `apeditor:chat-messages-height` and is clamped 120–1,200 px (and never eats the input area). When no value is stored, the panel falls back to the previous flex layout.
- **Draggable Original / Proposed split on every ProposedEditCard.** In Split view, the vertical line between the two markdown columns is a drag handle. Drag it to resize the columns; the split is persisted per card (keyed by `${messageId}:${edit.id}:split`) in `localStorage` and clamped 20–80 % so neither column can collapse. The header row ("Original" / "Proposed") re-flows with the columns so the labels stay centred over their content. The unified (Inline) diff view and the 8 outer card resize handles are unchanged.

### Changed

- **Editor toolbar layout.** Two pill groups are gone; the toolbar now has one button (`Format`) where they used to be. The Predict / Comment / Save / Import controls are unchanged, and the toolbar still wraps cleanly on narrow widths.
- **ProposedEditCard layout** (Split view only). The previous `grid-cols-2` is now a two-row flex (header row + content row + draggable divider). Behaviour and classes for the columns themselves (`.pe-md-split--original` / `.pe-md-split--proposed`) are preserved.

### Keyboard

- `Ctrl/Cmd+B`, `Ctrl/Cmd+I`, `Ctrl/Cmd+U` — bold, italic, underline (unchanged; still work while the editor is focused even with the Format menu closed).

### Internal

- `src/components/Editor.tsx` — `formatMenuOpen` state + `formatMenuRef`; outside-click effect targeting `[data-format-menu]`; single dropdown container replaces the two pill groups. `wrapSelection` and `bumpEditorFontSize` are unchanged.
- `src/components/ChatPanel.tsx` — `messagesHeight` state with `localStorage` persistence, vertical `useDragResize` handle, `clampMessagesHeight` live-clamp against the live panel size, draggable divider between the scroller and the input panel. Keyboard shortcuts, streaming, and the `ResizeHandle` left-edge drag are unchanged.
- `src/components/ProposedEditCard.tsx` — `splitPct` state with `localStorage` persistence, horizontal `useDragResize` for the column split, `MarkdownSplitPreview` refactored to a flex layout (header row + content row + 6 px draggable divider). The 8 outer resize handles, the view-mode toggle, and the unified diff view are unchanged.

### Verification

- `npm run typecheck` — clean.
- `npm run build` — clean.
- Manual:
  - Editor: click **Format** → pick **Bold / Italic / Underline**; selection wraps; click the same item again to unwrap. Pick **Size + / Size −**; the editor text grows / shrinks. The `Ctrl/Cmd+B/I/U` shortcuts still work. The dropdown closes on outside click and after each action.
  - Chat panel: drag the divider between the messages area and the input area; reload — the split is preserved. The Send / Stop / include-selection controls and the streaming bubble all render correctly at the new size.
  - ProposedEditCard (Split view): drag the column divider; both columns resize live. Reload — the same card's split is preserved. Switch a card to Inline view and back — split is preserved. Drag a sibling card's divider — independent splits.

---

## v0.4.8 — Heading-grouped @-mention sections + inline § captions

Feature release on top of [v0.4.7](https://github.com/roxelfivan/apeditor/releases/tag/v0.4.7). The `@` section picker groups a referenced document by its Markdown headings (instead of every paragraph line), and the selected scope appears as a readable `§…` caption both on the chip bar and inside the textarea. Selecting a parent heading cascades to its descendant sections; Cancel aborts without attaching a mention. Prompt scoping is unchanged: section picks still send only the picked paragraphs (capped), not the whole document.

### Added

- **Heading-grouped section picker.** After picking a document with `@`, the second stage lists Markdown heading sections (ATX `#`…`######` and Setext underlines). Each row is a heading title; ticking it selects that heading's paragraph indexes. Documents without headings fall back to the previous blank-line / paragraph list.
- **Parent → child cascade.** Ticking a parent heading selects (or deselects) all descendant heading sections under it. Child ticks do not force the parent on.
- **Cancel** on the section picker closes without creating or updating a mention (the typed `@` query text is left as-is).
- **Inline `§…` captions in the textarea.** When you confirm a section pick, a reader-friendly caption (e.g. `§ 4.1 Title +3 more`) is inserted in the prose at the caret, matching the chip summary. A trailing zero-width space anchors the mention for delete/edit. Captions are stripped when serializing to sentinels for the LLM; they are re-hydrated when the parent re-feeds the raw value so the marker stays visible.
- **Clickable inline overlay.** Clicking the in-textarea caption re-opens the section picker (same as clicking the chip's section line).
- **`npm run test:heading-sections`** — harness for heading detection edge cases (ATX indent, trailing `#`, setext-after-ATX, cascade indexes).

### Changed

- **Section summary on chips** prefers heading titles when a section resolver is available (`§ <first title> +N more`), falling back to paragraph previews when the doc has no headings.
- **Mention ranges** in the textarea are caption + ZWSP (`[plainStart, plainEnd)`), not zero-width sentinel slots. `serializeRawWithMentions` replaces that range with the sentinel; `parseRawWithMentions` + display hydrate restore the caption for editing.
- **Section picker UX** — Cancel + Confirm; cascade toggle; clearer empty / no-headings states.

### Token / prompt behavior (unchanged contract)

- Whole-doc mention → compact outline only.
- Section-scoped mention → verbatim text of **picked paragraph indexes only** (≤ 4,000 chars per doc, ≤ 8,000 chars turn-wide across referenced docs). Not the full document.
- Picking a high-level heading can still pull in many descendant paragraphs — that is intentional cascade scope.

### Keyboard

- `↑` / `↓` — move through the heading (or paragraph) list
- `Enter` / `Tab` — confirm the highlighted row / Confirm selection
- `Space` — toggle the current section (with cascade)
- `Esc` — Cancel / close the picker

### Internal

- `src/hooks/useDocumentMentions.ts` — heading section detection (`HeadingSection`), `descendantSectionIndexes`, ATX indent / trailing-hash / setext-after-ATX guards.
- `src/components/mentions/SectionPicker.tsx` — heading rows, cascade toggle, Cancel.
- `src/components/mentions/MentionInput.tsx` — plain-text display with caption + ZWSP, hydrate-on-value-sync, overlay chip rects, equality guards to avoid resync loops.
- `src/components/mentions/parseMentions.ts` — range-aware serialize/parse; caption strip on serialize.
- `src/components/mentions/MentionChip.tsx` — section-title-aware summary.
- `src/types.ts` — heading-section related typing as needed by the picker.
- `src/index.css` — inline mention overlay styles.
- `scripts/test-heading-sections.mjs` — Node harness for heading logic.

### Verification

- `npm run test:heading-sections` — harness cases pass.
- `npm run typecheck` / `npm run build` — clean.
- Manual: `@` → pick doc → tick heading (parent cascades) → Confirm → `§…` visible in textarea and chip bar; Cancel leaves no mention; Send still scopes referenced content to picked sections only.

---

## v0.4.7 — @-document references in chat, comments, and rejection feedback

Feature release on top of [v0.4.6](https://github.com/roxelfivan/apeditor/releases/tag/v0.4.6). The chat input, comment composer, comment popover (edit mode), and Proposed Edit card's **Comment (optional)** all support an `@`-trigger that lets the user attach another document (or a specific paragraph of one) to the outgoing turn. The referenced document(s) are folded into the system prompt alongside the current document, so the model sees exactly what the user pointed at.

### Added

- **`@-document references` in chat and comments.** Type `@` in the chat input or in any comment composer / edit box to open a doc picker. Pick a document, optionally narrow it to one or more paragraphs, and the reference appears as a deletable compound chip above the input. On **Send** (chat) / **Send to AI** (comments) / **Send N rejection comments** (proposed edits), every reference is folded into the prompt as a separate `sys-referenced-doc-N` system message.
  - **Whole-doc mention** — uses the same compact outline (`≤60 chars / paragraph`) the current doc uses, so it's token-cheap.
  - **Section-scoped mention** — inlines the verbatim paragraph text of the picked sections (≤ 4,000 chars total across all picked sections; falls back to outline + truncation note if exceeded). The same outline format the AI already uses, so picking paragraphs from a referenced doc gives the model byte-exact text to quote / propose edits against.
  - **Compound chip** — two lines: doc title on top, section summary on the bottom (`full document` or `§ preview +N more`). Click the bottom line to re-open the section picker; `×` removes the reference. The chip survives the staged → committed lifecycle for rejections and comment rounds, so a card never silently loses its references between re-renders.
  - **Deleted-doc handling** — if a referenced doc is deleted, the chip flips to `(deleted)` and the mention is dropped from the prompt (round mentions are stored by id + captured title so renames don't break the chip).
  - **Persisted on comment rounds.** `CommentRound.mentions?: MentionToken[]` is the source of truth for a comment's references; the comment body is the same `parseMentions`-aware string the textarea stores. Reloads keep the references intact.
  - **Sentinel encoding** — `\u200B[[mention:<id>|<kind>|<escaped-title>|<paragraphCSV>|<escaped-docId>]]\u200B`. Survives textarea editing without showing as visible text; `parseMentions` extracts them and `buildSentinel` round-trips.
  - **Keyless Google AI Mode path** — `buildGoogleAiModeUrl` also receives the references and wraps them in `[Context — referenced document "<title>"]` blocks so the AI Mode tab sees the same context the OpenAI path does.
- **`@-references` in ProposedEditCard's Comment (optional) box.** Typing `@` in the rejection-comment textarea now opens the same picker, so a "Reject with feedback" note can point at another document (e.g. *"see the policy in `<Other Doc>` § Risk Owners"*) and the model gets that context when the batch is sent.
- **`@-references` in the comment popover's edit mode.** The plain-text edit textarea was replaced with `MentionInput`, so re-editing a comment supports the same `@` flow as creating one. Existing references are restored from the round's `mentions` (or from the body sentinels) so the user can add / remove / re-pick references without leaving edit mode.

### Changed

- **Rejection / comment-batch user messages strip mention sentinels.** `formatRejectionBatch` (and the existing `formatCommentBatch` flow) now strip mention sentinel sequences from the user-visible body so the chat history stays readable. References are conveyed through the prompt builder's new `referencedDocuments` argument, not as raw sentinel text in the user message.
- **The `RejectionItem` shape now carries `mentions`.** `RejectionItem.mentions?: MentionToken[]`; `ChatPanel.commitStagedRejections` dedups and merges the per-card mentions and forwards them to `runAssistantReplyAfterCommit(userMsg, extraMentions)`, so all three send paths (chat, comment batch, rejection batch) share the same merge / dedup / dedup-by-docId logic.
- **`updateCommentBody` accepts an optional `mentions` argument.** When omitted, existing round mentions are preserved; when supplied, they replace the round's list. In-place edits keep the existing round; sent-round edits create a new round and copy the prior round's mentions (so a follow-up body never silently loses references).
- **Dark-mode contrast for the rejection-comment `MentionInput`.** Explicit light/dark colors on `.pe-comment__input .mention-input__textarea` (light: white-on-#171614, dark: cream-on-#12100e) so the textarea is readable in both themes. The composer / popover dark theme tokens were tightened in the same pass.

### Keyboard

- `↑` / `↓` — move through the picker (doc or section list)
- `Enter` / `Tab` — confirm the highlighted row
- `Space` — toggle the current paragraph in the section picker
- `Esc` — close the picker (does not consume the `@` you typed)

### Internal

- `src/components/mentions/` — new module with `MentionInput.tsx`, `MentionChip.tsx`, `DocPicker.tsx`, `SectionPicker.tsx`, `parseMentions.ts`. Backed by a real `<textarea>` so the user keeps full caret / IME / keyboard support.
- `src/hooks/useDocumentMentions.ts` — shared hook. Paragraph splitter mirrors `buildDocOutline` so picker previews and the prompt outline describe the same shape.
- `src/types.ts` — `MentionToken`, `MentionKind`, `CommentRound.mentions?`.
- `src/api/chat.ts` — `buildRequestMessages` accepts `referencedDocuments?` and a `documentLookup?`; emits one `sys-referenced-doc-N` per dedup'd referenced doc (4,000-char cap on section-scoped inlines). `buildReferencedDocMessage` / `splitParagraphs` helpers.
- `src/utils/proposedEdit.ts` — `RejectionItem.mentions`; `formatRejectionBatch` strips sentinels via a pure `cleanCommentForPrompt` (no UI imports).
- `src/utils/googleAiMode.ts` — `buildGoogleAiModeUrl` accepts the same `referencedDocuments` + `documentLookup` and wraps each in a `[Context — referenced document "<title>"]` block.
- `src/store/useStore.ts` — `updateCommentBody(id, body, mentions?)`. `addComment` already carries `rounds[]`, so the comment composer sets the round's `mentions` directly. `ensureRoundsShape` migration is unchanged (the new field is optional).
- `src/components/ChatPanel.tsx` — `mentions` state, `stageReject` / `commitStagedRejections` / `runAssistantReplyAfterCommit` extended to carry / forward rejection mentions alongside the chat-input mentions.
- `src/components/CommentComposer.tsx` — `<textarea>` swapped for `MentionInput`; `onSave(body, mentions)`.
- `src/components/CommentPopover.tsx` — edit mode now uses `MentionInput`; `buildEditableMentionBody` rebuilds the editable text from sentinels or round mentions; `CommentBodyWithChips` renders the read view with inline reference pills (clicking a pill switches to the referenced doc).
- `src/components/ProposedEditCard.tsx` — `<textarea>` swapped for `MentionInput`; `mentions` lifted to the card so the chip bar persists through the staged → committed lifecycle.
- `src/components/Editor.tsx` — `handleSaveComment` writes `rounds[0].mentions` on creation; `mvp:send-comments` event now also carries `mentionsByCommentId`.
- `src/index.css` — `.mention-input`, `.mention-chip`, `.mention-popover`, `.cm-popover__ref` styles with light + dark theme parity.

### Verification

- `npm run typecheck` — clean.
- `npm run build` — clean (entry chunk still under the 12 MB warning limit; new mentions module is < 5 KB gzipped).
- Manual end-to-end on each surface:
  - Chat: type `@`, pick a doc, optionally pick a section, Send → AI reply references the picked doc by title.
  - New comment: type `@`, pick a doc, save → chip in the popover read view; click the chip → editor switches to the referenced doc.
  - Re-edit comment: open a comment that has a reference, click Edit → chip reappears in the edit bar, type more text, add / remove references, Save → popover reflects the new state.
  - Reject with feedback: type `@`, pick a doc, Reject with feedback → Send N rejection comments → reply addresses the referenced doc.

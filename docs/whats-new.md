# What's new

This page is the in-app changelog. It stays with the version in the top bar. Older releases are summarized at the bottom; the full developer changelog is [RELEASE_NOTES.md](https://github.com/roxelfivan/apeditor/blob/main/RELEASE_NOTES.md) on GitHub.

## v0.6.2 — Phone layout, chat archives, Graph Filter

**Use the app on a phone, park old chats, and keep Filter above the 3D graph.**

- **Phone / Android.** Sidebar and chat open as overlays (including landscape). Help, Functional spec, Revision history, and Prompt library live under **⋯** and slide up from the bottom so you can tap them. Settings fills the screen on a narrow phone.
- **Collapsible Chat and archives.** Click **Chat** to hide the message list (the input stays). Older turns start collapsed; the latest stays open. **History** / **Archive** park threads without deleting them. The next Send uses only Current. **Clear** still wipes Current without saving. JSON backups include archives; older files still import.
- **Graph Filter stays on top.** In Graph (including 3D), node titles — including the green current-document label — no longer show through the Filter checklist.

No new Settings. No migration.

---

## v0.6.1 — Format menu, Split beside Graph

**Format works again, and Split keeps writing next to the map.**

- **Format menu is visible and clickable.** Making the toolbar a horizontal scroller in v0.6.0 clipped the Format menu — it opened in the accessibility tree but sat below the scroller edge, so you could not see Bold / Italic / Underline / Size. The menu now floats above the page (`position: fixed`) and stays on screen, the same way Import / Export and Filter already do.
- **Split is Write or Preview on the left, Graph on the right.** Use the tabs at the top of the left pane to switch Write / Preview; the choice is remembered. Full Write, Preview, and Graph modes are unchanged. The view dropdown order is Write → Preview → Graph → Split.
- **Clicking a Graph heading or term scrolls the Write pane** to that passage (Flat, Globe, and 3D). Words and the selection stay locked together while you scroll.

No new settings, no migration.

---

## v0.6.0 — Legible 3D, one-row toolbar

**Spin the 3D view without losing the words, and see the balls in dark mode.**

- **3D labels stay readable while you rotate.** Labels now differ by node kind — a document title is largest and boldest, a `[[term]]` is smallest — and they fade and shrink as they move away from you, so the near field reads clearly and the far field settles into texture. Labels nearer the camera always paint on top of the ones behind. **Nothing is ever hidden**, and the label under your pointer stays at full size.
- **Overlapping labels stay separate.** Each label gets a soft halo in the background colour, the same treatment map labels use. It follows the Light / Dark toggle.
- **Dark-mode spheres are visible.** They had been using the flat background-surface colours that the 2D map uses, which left `[[term]]` spheres rendering at exactly the same colour as the background. All three sphere colours are now lifted while keeping their original tone, and the current document still stands out in green.
- **The editor toolbar stays on one row.** It used to wrap, so Filter / Reset moved to a second line and Import / Save to a third as the pane narrowed. The row now scrolls sideways instead, and Import / Save always stay at the right edge.
- **The Welcome document is rewritten** (12 sections) and now includes the Graph view — the three projections, the Filter, and `[[Page]]` / `[[Page#Heading]]` linking — which was missing from the original.

No new settings, no migration. The Flat map and Globe look exactly as before.

---

## v0.5.9 — Graph Filter, wider zoom / labels

**Narrow the map, zoom further, click to open.**

- **Filter.** In the Graph toolbar, **Filter** opens a checklist of documents and headings. Untick what you do not want; the map, Globe, and 3D view all update together. **Reset** clears the filter. Unticking everything shows an empty graph with **Clear the filter** — it does not silently restore the whole workspace.
- **Wider zoom and labels.** Zoom from **25% to 1200%**. Label size from **6 px to 48 px**, including in 3D.
- **Tall 3D stacks stay readable.** Very deep heading paths compress their vertical gap after the usual Markdown depth, so a long `Comment > …` chain does not shoot out of frame. A wide ring of peer headings (more than five under one parent) helixes onto extra stories so wording does not pile on one floor.
- **Click opens the document.** A short click on a node leaves Graph for Split and selects the heading or `[[term]]` passage.

---

## v0.5.8 — Graph view: 3D Concept

**A third projection joins the Graph view.** Open the Graph, click **3D** in the toolbar — the layout becomes a 3D scene where headings stack as separate bands and `[[term]]` satellites sit on an underground ring.

- **`Graph` / `Globe` / `3D` is now one toggle.** The three buttons are generated from a single table so they cannot drift apart; Reset still returns to the flat map.
- **Spread the stack.** Heading tiers rise 135 units per level (was 70), so a tall document reads as a column of bands rather than one slab. Terms drop beneath the floor at `y = -200`, on a ring around each document at radius 360.
- **Free 3D navigation.** Mouse wheel dollies, Shift+drag pans, two-finger gestures pan / pinch, arrow keys pan, `+` / `-` dolly. The toolbar's zoom readout follows a wheel-dolly on the same callback — one source of truth for the pose.
- **Same data, same clicks.** Document spheres open the document, heading spheres open the heading range, hover highlights the closed neighbourhood (documents + headings + wikilinks / `@` keywords in the same set).

Flat and Globe are byte-identical in behaviour. The 3D scene mounts `three.js` lazily — workspaces that never open it never download it. `viewMode` is still four values (write / preview / split / graph); the projection is a navigation aid *within* the Graph view, not a fifth pane.

---

## v0.5.7 — Graph navigation: pan, zoom, and Globe

**Graph can finally be moved around.**

- **Drag empty space to pan** in the flat map. At any zoom, content follows the pointer.
- **`Graph` and `Globe` are now one toggle.** Click **Globe** in the Graph toolbar to wrap the map onto a sphere; drag to spin it. Yaw rotates about the visible axis (so dragging horizontally actually rolls the globe, instead of spinning toward the camera). A pane-wide drag is one half revolution, regardless of zoom.
- **Back-hemisphere culling**: nodes on the far side of the sphere are not drawn rather than mirrored onto the screen. Press **Reset** any time to return to the flat map.
- **Graph / Globe / Reset** all sit in the same toolbar row. The projection is a navigation aid, not a separate view — the editor view dropdown is unchanged.

Accessibility, the node drag, and the existing label / zoom controls are unchanged.

---

## v0.5.6 — Round-trip JSON backups

**Import full backup (JSON)** ships. A new **Import .json** button sits one popover section below the existing **Export .json** and restores a document plus its comments, chat history, and revisions from a backup file.

- **Clean case (no id collisions).** Pick a `.json` file, see the editor switch to the imported document. No modal.
- **Id collisions.** A small **Import backup** modal opens. Per row, choose **Replace** (overwrite in place), **Skip** (drop the import), or **Keep both** (copy under a fresh id with `(imported)` in the title). **Apply** runs the plan and switches to the first imported doc; **Cancel** dismisses with nothing changed.
- **Inline errors stay in the popover.** Over-cap file size (`50 MB`), malformed JSON, missing `schema`, version mismatches, and inconsistent records all surface as a single red line — close the popover to dismiss, no modal storm.
- **No network.** Everything parses and writes locally; restoring a backup never calls the model.

`DocumentBackup` v1 — the JSON shape produced by **Export .json** since v0.5.3 — is now bidirectional: exporting and re-importing produces a deep-equal document state, comment rounds and revisions included.

Backups produced by v0.5.3 / v0.5.4 / v0.5.5 can be re-imported unchanged; the schema is the same.

---

## v0.5.5 — Preview wikilinks, Graph polish, Functional Specification

**Preview and Split** now show `[[wikilinks]]` as normal purple text — no `[[` or `]]`.

- Write `[[Ideas]]` → Preview shows **Ideas** in purple.
- Write `[[Page|label]]` → Preview shows **label**.
- Write `[[Page#Heading]]` → Preview shows **Heading**.
- Write mode still shows the raw `[[…]]` syntax so you can edit it.

**Graph Reset** restores label size and zoom, then redraws a tidy atom layout (fewer crossed lines).

**Functional Specification** — click **`{ }`** next to **?** in the top bar (or press `⌘/Ctrl+Shift+E`) for the developer guide to the codebase. It is separate from this user guide. Press **Esc** to close either.

Also fixed: with Graph open, typing in Chat no longer blanks the whole tab.

Full steps: [Writing](writing.md) · [Your workspace](workspace.md).

## Earlier releases

- **v0.5.4** — **Graph** view: documents, headings, `[[wikilinks]]`, and `@` mentions as a local knowledge map. Help **What's new** page.
- **v0.5.3** — Export full backup (JSON); clearer empty / gated-state copy; per-row stale-comment **Re-link** / **Dismiss**; proposed-edit **Apply** waterfall (Exact → Best Effort → Highlight).
- **v0.5.2** — Internal refactor (store split, debug POSTs removed). No user-visible behaviour change.
- **v0.5.1** — Format-menu font size, gated-state tooltips, Chat **selection only**, secret redaction, session-only API key, outdated-comment dismiss / re-attach.
- **v0.5.0** — Export Markdown, import size / page caps, best-effort Apply.

Graph compile rules and JSON backup from earlier releases are unchanged in v0.5.5.

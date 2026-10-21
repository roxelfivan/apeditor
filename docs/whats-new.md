# What's new

This page is the in-app changelog. It stays with the version in the top bar. Older releases are summarized at the bottom; the full developer changelog is [RELEASE_NOTES.md](https://github.com/roxelfivan/apeditor/blob/main/RELEASE_NOTES.md) on GitHub.

## v0.5.8 — Graph view: 3D Concept

**A third projection joins the Graph view.** Open the Graph, click **3D** in the toolbar — the layout becomes a 3D scene where headings stack as separate bands and `[[term]]` satellites sit on an underground ring.

- **`Graph` / `Globe` / `3D` is now one toggle.** The three buttons are generated from a single table so they cannot drift apart; Reset still returns to the flat map.
- **Spread the stack.** Heading tiers rise 135 units per level (was 70), so a tall document reads as a column of bands rather than one slab. A wide ring of peer headings (more than five under one parent) helixes onto extra stories so Graph **3D** does not keep every wording on one 2D fan. Terms drop beneath the floor at `y = -200`, on a ring around each document at radius 360.
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

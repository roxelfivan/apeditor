# What's new

This page is the in-app changelog. It stays with the version in the top bar. Older releases are summarized at the bottom; the full developer changelog is [RELEASE_NOTES.md](https://github.com/roxelfivan/apeditor/blob/main/RELEASE_NOTES.md) on GitHub.

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

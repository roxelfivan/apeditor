# What's new

This page is the in-app changelog. It stays with the version in the top bar. Older releases are summarized at the bottom; the full developer changelog is [RELEASE_NOTES.md](https://github.com/roxelfivan/apeditor/blob/main/RELEASE_NOTES.md) on GitHub.

## v0.5.4 — Graph view

The editor dropdown is now **Write · Preview · Split · Graph**.

**Graph** is a map of your workspace. It does not call an AI and it does not invent concepts. It only compiles what you already wrote.

- Each sidebar **document** is a node. The open document is marked.
- Each Markdown **heading** is a node under its document.
- Write `[[Name]]` in a document (optional `[[Name|label]]` or `[[Name#Heading]]`) to add a wikilink — the same syntax as Obsidian / LLM wiki.
  - If `Name` matches another document title (or heading), Graph draws a line to that node.
  - If it does not, Graph adds a **term** node. Click it to select that `[[…]]` span. Graph does not create a new document.
- `@` mentions on comments also draw lines to the referenced document or heading.

Hover a node to dim everything that is not a neighbor and to read the **full label** in the bar at the top of Graph. Click a document to open it. Click a heading or term to open its document and select the passage.

Headings written as `Comment > annotate` share a **Comment** parent node. The same happens with Markdown subheadings (`##`).

In Graph, **Format**, **Comment**, and **Predict** hide because there is no textarea. File actions and Save stay.

Full steps: [Writing — Graph and `[[term]]`](writing.md).

## Earlier releases

- **v0.5.3** — Export full backup (JSON); clearer empty / gated-state copy; per-row stale-comment **Re-link** / **Dismiss**; proposed-edit **Apply** waterfall (Exact → Best Effort → Highlight).
- **v0.5.2** — Internal refactor (store split, debug POSTs removed). No user-visible behaviour change.
- **v0.5.1** — Format-menu font size, gated-state tooltips, Chat **selection only**, secret redaction, session-only API key, outdated-comment dismiss / re-attach.
- **v0.5.0** — Export Markdown, import size / page caps, best-effort Apply.

JSON backup, comment Re-link, and the Apply waterfall from v0.5.3 are unchanged in v0.5.4.

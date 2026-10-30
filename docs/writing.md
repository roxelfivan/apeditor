# Writing

The center pane is your Markdown editor. You always edit plain Markdown; Preview shows how it will look. Graph maps the workspace from that Markdown. Split keeps both a text pane and Graph side by side.

## Write, Preview, Graph, and Split

Use the dropdown on the left of the editor toolbar (order: Write → Preview → Graph → Split):

| Mode | What you see |
| --- | --- |
| **Write** | Editable text. Placeholder: *Start writing in Markdown…* |
| **Preview** | Rendered Markdown (headings, lists, links, tables, and so on). `[[wikilinks]]` appear as purple labels without brackets. |
| **Graph** | A full-pane map of your documents, headings, `[[wikilinks]]`, and `@` mentions. Format, Comment, and Predict hide — there is no textarea. |
| **Split** | Left pane is Write or Preview (tabs at the top of that pane); right pane is Graph. Drag the divider. |

An empty Preview shows *Nothing to preview yet.*

### Wikilinks in Preview

In **Write**, keep the Obsidian-style syntax: `[[Name]]`, `[[Name|label]]`, or `[[Name#Heading]]`.

In **Preview** and when Split’s left pane is **Preview**, those links render as purple text without `[[` `]]`:

| You write | Preview shows |
| --- | --- |
| `[[Ideas]]` | Ideas |
| `[[Page\|label]]` | label |
| `[[Page#Heading]]` | Heading |

The same `[[…]]` still feeds the Graph (edges and term nodes). `@` mention chips in comments are unrelated and stay as chips.

You can comment only in **Write** or when Split’s left pane is **Write**. Select text there, then use **Comment**.

### Graph and `[[term]]`

Graph compiles what is already in the workspace. It does not ask an AI to invent concepts.

- Each sidebar document is a node. The open document is marked.
- Each Markdown heading (`#` / Setext) is a node under its document. Titles with `>` nest: `# Comment > annotate` and `# Comment > feedback` share a **Comment** node that links to **annotate** and **feedback**. Subheadings (`##`) nest the same way.
- Hover a node or its label to read the **full title** in the bar at the top of Graph (labels wrap on the canvas; long lines still get a tooltip). The initial map is atomic: the open document is the nucleus, headings sit on concentric shells, and `[[wikilink]]` / other-doc satellites park on the same ray as their source so lines do not cross through the ring.
- **−** / **+** on the Graph toolbar change label size (6–48 px, default 16). On Mindmap that grows or shrinks the wording relative to the nodes; on Flat and 3D it is the same on-screen label size control. **Zoom −** / **Zoom +** scale the whole map (5–1200%). **Filter** chooses which documents and headings appear. **Reset** restores label size, zoom, projection, filter, and node positions, then redraws the map.
- The **Flat / Mindmap / 3D** dropdown on the Graph toolbar switches how the same map is seen. **Flat** is the radial overview. **Mindmap** draws a left-to-right heading tree, with leftover `[[wikilink]]` / `@` loops as dashed curves; when the tree is larger than the pane, the map scrolls. **3D** extrudes headings upward (deep stacks compress so they stay readable).
- Drag a node (or its label) to rearrange it. A short click from full Graph opens **Split** with Write on the left and selects the heading / `[[term]]`. From Split with Write already open, the selection lands without leaving Split. Positions last until **Reset** or you leave Graph.
- Drag **empty space** to navigate: in **Flat** it pans the map (at any zoom); in **Mindmap** it scrolls the tree under your cursor; in **3D** it orbits.
- Write `[[Name]]` (optional `[[Name|label]]` or `[[Name#Heading]]`) to add a wikilink, the same syntax as Obsidian / LLM wiki.
- If `Name` matches another document title, Graph draws a line to that document (or heading). If it does not, Graph adds a **term** node. Click it to select that `[[…]]` span.
- `@` mentions on comments also draw lines to the referenced document or heading.

Hover a node to dim everything that is not a neighbor. Click a document to open it. Click a heading or term to open its document and select the passage. Graph does not create a new document when you click a term.

**About Mindmap.** The solid curves are a spanning tree of the workspace — headings first, then leftover links. Extra relationships stay visible as dashed, faded cross-links so the tree itself stays readable. A title too long for one line **wraps** onto a second line, and only that title is drawn a little smaller; every other title keeps the size you set. Titles sit **above** the green connector so they do not run through the line. Each column starts after the widest title above it, so titles never cross into the next column. On Mindmap, toolbar **−** / **+** change text size; **Zoom −** / **Zoom +** scale the whole map. A tree that does not fit the pane is scrollable — drag the background to walk around it. **Reset** returns to the Flat map.

**Reading labels in 3D.** Labels change size by node kind — a document title is largest and boldest, a `[[term]]` smallest — and they fade and shrink as they move away from you, so the near field is clear and the far field settles into texture. Labels nearer the camera always draw on top of the ones behind, and no label is ever removed. Hovering a node keeps its label at full size and brightness. Each label carries a soft halo, so two overlapping labels stay individually readable.

**About the toolbar row.** The editor toolbar is a single row. If the window is too narrow for every control, the row scrolls sideways and **Import** / **Save** stay pinned at the right edge.

## Bold, italic, underline

Select text, then click **Format** in the toolbar and pick **Bold**, **Italic**, or **Underline** from the menu.

| Menu item | Shortcut | Markdown |
| --- | --- | --- |
| **Bold** | `Ctrl+B` / `⌘B` | `**bold**` |
| **Italic** | `Ctrl+I` / `⌘I` | `*italic*` |
| **Underline** | `Ctrl+U` / `⌘U` | `<u>underline</u>` |

The keyboard shortcuts work while the editor is focused, even if the **Format** menu is closed. Click the same menu item again to unwrap the markers. The dropdown closes after each action; click outside it to dismiss without acting.

## Editor font size

Open the **Format** menu on the toolbar and pick **Size +** or **Size −**. Range is 10–24 pixels. The buttons disable at the upper and lower bounds. This does not change menus or Chat — those use UI font size in [Settings](settings.md).

## Predict (optional sentence completion)

**Predict** is **off** until you turn it on. It needs a Minimax or OpenAI key. It is not available with **Local Model**.

1. Click **Predict** on the toolbar, or press `Ctrl+\` / `⌘\` (when the control is enabled).
2. A suggestion panel appears under the write pane: **Suggestion · Tab to accept · Esc to dismiss**.
3. Press **Tab** or **Accept** to insert the suggestion.
4. Press **Esc** or **Reject** to dismiss it.

Click **Predict** again to stop requesting suggestions.

If the button is disabled, the tooltip explains why (missing key, or Local Gemma).

You can drag the top of the suggestion panel to make it taller or shorter.

## Import photos and PDFs

The camera-style control on the toolbar imports text from images or PDFs. Full steps: [Import from photos or PDFs](import.md).

## Save a revision

The floppy-disk control saves a snapshot of the current document. Open the clock in the top bar to browse snapshots. See [Revision history](revisions.md).

Chat **Send** and **Apply N changes** also save snapshots automatically (`Before AI send` and `Before Apply All`) so you can undo a large AI change from history.

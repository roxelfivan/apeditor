# Your workspace

The main window has four regions: **top bar**, **Documents** sidebar, **editor**, and **Chat**. You can hide any of the chrome, resize the columns, and switch light or dark theme.

## Top bar

The top bar shows the ApEditor logo, version, and the title of the open document (after a `/`).

On a phone **home-screen / PWA**, the top bar sits in the **safe area** below the system status bar. Time, signal, and battery stay visible; the app chrome starts underneath. Landscape notches get the same left/right inset. If you hide the top bar, the editor still starts below that status-bar band.

| Control | What it does |
| --- | --- |
| **?** | Opens this [user guide](README.md) as in-app Help (same Light / Dark theme). The sidebar includes [What's new](whats-new.md). |
| **{ }** | Opens the **Functional Specification** — a developer guide to the codebase, with architecture, contracts, and maintenance notes. Groups pages into Parts. Not part of this user guide. |
| Clock | Opens [Revision history](revisions.md) |
| Bookmark | Opens the [Prompt library](prompt-library.md) |
| **☀ Light** / **☾ Dark** | Toggles theme (also restyles Help) |
| Gear | Opens [Settings](settings.md) |

Press `Ctrl+/` / `⌘/` (or `Ctrl+Shift+/` / `⌘Shift+/` for `?` on some keyboards) when you are not typing in a field to open Help. Press `Ctrl+Shift+E` / `⌘Shift+E` to open the Functional Specification. Press **Esc** to close either.

If Minimax or OpenAI is selected and you have not saved an API key, the gear shows a small amber reminder.

To hide the top bar, click the chevron on the **top edge** of the window. Click it again to show the bar.

## Sidebar and Chat

The left column lists your documents, grouped so a large workspace stays scannable. The right column is Chat.

**Search** at the top of the sidebar filters by title, tag path, or collection name.

The sidebar is a stack of collapsible sections: **Collections**, **Pinned** (star on a row), **Recent** (the last ten documents you opened), **Tags**, and **Other** (documents that are neither tagged nor filed in a collection). Click a section heading to fold it away.

**Tags** are Bear-style nested paths. Write `#drafts/essays` in the markdown (not an ATX heading), or click **#** on a row and type `drafts/essays`. Nested folders expand in the sidebar. A document can have several tags.

**Collections** are your own named groups. Click **＋** next to **Collections** to create one, and the **📁** button on a row to file a document in it. A document can be in several collections at once — each collection lists it on its own. See [Documents](documents.md#collections).

Every section heading and every collection has a **▸ / ▾** arrow, so you can fold away the files you no longer want to see. What you folded is remembered in this browser.

| Edge | Shortcut | Action |
| --- | --- | --- |
| Left chevron | `Ctrl+B` / `⌘B` | Show or hide the sidebar |
| Right chevron | `Ctrl+Shift+C` / `⌘Shift+C` | Show or hide Chat |

Those shortcuts apply when you are **not** typing in the editor. Inside the editor, `Ctrl+B` / `⌘B` is **Bold**.

Chat also has an **×** in its header. After you close it that way, use the right-edge chevron (or the shortcut) to bring Chat back.

## Resize columns

Drag the divider on the **right edge of the sidebar** to change its width.

Drag the divider on the **left edge of Chat** to change Chat width.

In **Split** view, drag the divider between the left pane (Write or Preview) and Graph. Your split (between 20% and 80% left) is remembered, as is whether the left pane was Write or Preview.

Settings, comment popovers, and proposed-edit cards can also be resized by dragging their edges. Those sizes are remembered in this browser.

## Theme

ApEditor ships two looks:

- **Light** — paper-style (default)
- **Dark** — high-contrast

Use the top-bar button. The choice is saved on this device.

## Two font sizes

- **UI font size** — Settings slider (12–20 px). Scales menus, Chat, and chrome. Default is 14.
- **Editor font size** — **Size +** / **Size −** in the **Format** menu (10–24 px). Only the document text. Default is 14.

Reset UI font size in Settings; editor size is only in the Format menu.

## What is remembered

Layout (sidebar width, Chat width, split, collapsed panels, theme, font sizes) is stored in this browser with your documents. Another browser or device starts from defaults.

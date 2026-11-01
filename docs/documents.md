# Documents

Each document is a Markdown file you keep in the left **Documents** list. Chat, comments, and revisions belong to that document.

## Sample documents

The first time you open ApEditor you get:

- **Welcome** — a short tour of the product
- **Ideas** — a tiny sample list

You can rename or delete them like any other document.

## Create a document

Open **File** at the far left of the Documents header and click **New**. The new document is named **Untitled** and opens immediately.

If the editor says **No document selected**, click **Create one**.

## File menu

**File** sits on the far left of the Documents header:

- **New** — blank Untitled document
- **Save** — snapshot of the current document (same as the editor floppy-disk). The live draft still auto-saves in this browser
- **Save As** — duplicate the current document's text under a new title
- **Export .md** — download the current document as Markdown
- **Export .json** — download the document plus comments, chat, and revisions
- **Import photos / PDFs** — OCR into the editor at the caret. See [Import from photos or PDFs](import.md)
- **Import .json** — restore a JSON backup, asking before overwrite
- **Compare…** — redline another `.md` / `.json` / `.docx` or workspace document and produce suggested edits. See [Import](import.md#compare-with-another-file)

## Switch documents

Click a title in the sidebar. The top bar shows `/` plus that title.

Each document has its own Chat thread. Switching documents switches the conversation too.

Other documents can be attached to a Chat or comment turn with `@`. The picker lists every document **except** the one you are editing. See [Reference other documents](reference-other-documents.md).

## Pin, recent, and tags

- **☆ / ★** pins a document at the top of the sidebar
- **Recent** lists the last ten documents you opened
- **#** on a row adds a nested tag (`drafts/essays`). Hashtags in the body (`#drafts/essays`) are picked up on save. See [Your workspace](workspace.md)

The search box filters by title or tag.

## Rename

- Click the pencil (**Rename**) on the row, or
- Double-click the title

Press Enter or click away to save. Escape cancels. An empty name becomes **Untitled**.

## Delete

Click **×** on the row. Confirm **Delete "{title}"?**

Deleting a document also removes its chat, comments, and revisions. This cannot be undone from inside the app. If you might need the text later, copy it out or save a revision and copy from there first.

After a delete, ApEditor opens the first remaining document, or shows **No document selected** if the list is empty.

## Empty list

If you delete everything, the sidebar shows **No documents yet.** Use **File → New** to start again.

## Auto-save

There is no separate Save for the live draft. Edits persist in this browser after a short pause. The editor header shows **saved just now** (then seconds, minutes, hours, or days ago).

A **revision** is a named snapshot you can restore later — see [Revision history](revisions.md). That is different from auto-save.

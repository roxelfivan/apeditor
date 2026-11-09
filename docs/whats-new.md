# What's new

This page is the in-app changelog. It stays with the version in the top bar. Older releases are summarized at the bottom; the full developer changelog is [RELEASE_NOTES.md](https://github.com/roxelfivan/apeditor/blob/main/RELEASE_NOTES.md) on GitHub.

## v0.6.14 — Selection stays aligned at the bottom of Write

**Highlight and edit the last lines without the selection band drifting off the words.**

- **Bottom-of-document fix.** When a note ends with a newline (most do), Write no longer shifts the caret / selection one line above the visible text at the bottom of the panel.
- **Comments and typing stay on target.** The mirror overlay that paints the words now matches the textarea’s line count, so what you select is what gets highlighted.

## v0.6.13 — Chat edits imported tables as cells

**Ask Chat to change a spreadsheet table without treating cells as prose.**

- **Table-aware Chat.** When the open document has a Markdown table, the model sees a compact table context and can propose **table-edit** cards — set a cell, delete or keep rows, remove a column, or add a column.
- **Safe Apply.** Cell changes refuse if the cell went stale; short values like `12` are not matched as the first `12` elsewhere in the file.
- **Safer Best Effort near tables.** Prose Best Effort no longer expands into neighbouring table rows.
- **Preview column resize.** Drag a table header’s right edge; text wraps; widths are remembered in this browser (not written into the Markdown).
- **Local Model stays lean.** Local Gemma keeps reading cell values from the full document envelope instead of paying for the table twice.

## v0.6.12 — Import a spreadsheet table

**Bring an Excel export into the editor as a Markdown table.**

- **File → Import .csv / .tsv.** Pick a file and the table appears at your caret. One button covers both formats — the separator is worked out from the file, so a tab-delimited file named `.csv` still imports correctly.
- **No AI key needed.** The conversion happens in your browser and is deterministic, so it works offline and never sends your sheet anywhere.
- **Reads what spreadsheets write.** UTF-8 and UTF-16 files, European (`;`) exports, and quoted fields that contain the separator all come through correctly.
- **Plain Markdown.** The table is ordinary text — edit it by hand, keep it in a revision, export it to `.md`, or hand it to Chat.

Two things worth knowing:

- The conversion is **literal**. A spreadsheet file has no type information, so currency, percentages, dates, and codes with leading zeros (`007`) stay text. ApEditor will not guess that a column is money.
- **Wide tables now scroll inside their own box** instead of pushing the whole Preview pane sideways.

No migration.

---

## v0.6.11 — Compare shows the whole document

**Side-by-side Original \| Revised, with unchanged text among the changes, and a resizable panel.**

- **Document order.** Unchanged paragraphs sit between the change cards, so you can see where each edit lands.
- **Resize.** Drag the left edge of Compare; the width is remembered.
- **Cards still Apply / Skip.** Each pending change is the same proposed-edit card as before; Apply all works as before.

No migration.

---

## v0.6.10 — Dependency security fixes and spec refresh

**No user-visible changes.** A maintenance release that clears the outstanding `npm audit` findings and refreshes the Functional Specification.

- **Security.** `npm audit` now reports **0 vulnerabilities** (was 3 moderate + 1 high). The build toolchain moves to Vite 6, and `uuid` / `postcss-selector-parser` are patched.
- **Install scripts.** The three pending npm lifecycle-script approvals (`esbuild`, `fsevents`, `protobufjs`) are recorded in `package.json`.
- **Docs.** The Functional Specification's toolchain and size tables, and both release checklists, are back in sync with the code.

Nothing changes in the app itself — same features, same behaviour.

---

## v0.6.9 — Sidebar tags, Preview numbering, document compare

**Nested tags, pin/recent, legal Preview, and Word-style compare.**

- **Sidebar.** Search titles and tags. Star a document to pin it. Recent lists the last ten opened files. Nested tags (`#drafts/essays` in the body, or **#** on a row) group the list. Untagged documents stay in their own section.
- **Preview / print.** The numbered-list icon opens **line numbers** and heading **outline** (`1 / 1.1 / 1.1.1` or **Article / Section / (a)**). **Print** hides chrome and keeps those labels.
- **Compare.** **File → Compare…** imports another `.md`, `.json` backup, `.docx`, or workspace document and builds a full suggested-edit set against the open draft. Apply or skip each change like a chat proposal.

Older documents gain empty `tags`, `starred: false`, and `lastOpenedAt` on load. Hashtags already in the body are picked up automatically.

---

## v0.6.8 — Toolbar polish, compact Mindmap, Preview default

**Quieter controls, tighter Mindmap, and first-run Preview.**

- **Predict is the sparkle only.** Preview shows **Size +** / **Size −** for the caption font. Fresh installs open in **Preview**.
- **Mindmap packing.** Each child sits just past its own parent title; long siblings no longer stretch short branches. Labels can go up to 96px without clipping off the edge. Zoom uses magnifier icons.
- **Propose-edit + Local Model tokens.** Reject opens a disclosure; the mismatch banner is one line until expanded. Token counters appear for Local Model (Send sits left of the Chat counter).

No migration.

---

## v0.6.7 — Chat composer follows the divider

**Drag the Chat divider and the input area moves with it.**

- **Include selection sticks to the handle.** Drag the thin strip between the conversation and the input up or down — the checkbox and the chat box’s top edge follow. No empty gap under the divider.
- **Typing area grows upward.** Dragging up gives you a taller input; the messages list keeps the leftover space above.
- **Still remembered.** The split persists across reloads (same preference key; unset means the compact default height).

No migration.

---

## v0.6.6 — Mindmap labels that stay readable

**Mindmap titles wrap cleanly, sit above the green lines, and resize with − / +.**

- **No more overlapping titles.** Long headings wrap onto a few lines; only that title is drawn a little smaller. Each child packs just past its own parent title (CJK counted wider than Latin), so a long sibling does not stretch short branches.
- **Wording above the green line.** Node titles sit just above the connector so they no longer run through the stroke.
- **− / + change text size.** On Mindmap, the size buttons next to the Graph view control grow or shrink the labels relative to the nodes. Magnifier buttons still scale the whole map.
- **Drag to walk the tree.** Drag empty Mindmap space to scroll. The projection menu is **Flat / Mindmap / 3D** (Flat is the radial overview; Globe is gone).

No migration.

---

## v0.6.5 — Debug token counter

**See how big the next request is before you send it — and whether the Local Model has room for a full reply.**

- **Token counter.** Turn on **Debug Mode** in Settings and a count appears next to **Send** in Chat and next to **Send to AI** in the comment tray. It measures the whole request — your document, any `@`-referenced files, the comment batch — not just what you typed. The Chat panel also shows `sent ~N` for the previous send.
- **Budget warning.** On the Local Model the pill shows the limit: about 7,168 tokens for the prompt (8,192 total, 1,024 kept back for the reply). It turns amber when you are close and red when the prompt will not fit, which is when replies get cut off mid-sentence.
- **Comment batches are sent once.** Comment **Send to AI** and staged rejections were transmitting the message body twice, which doubled the prompt and could exhaust the on-device memory. Fixed.

The count is a rough estimate (about 4 characters per token), so treat it as a guide. Minimax and OpenAI have no local limit, so they show the size without a budget check.

No migration.

---

## v0.6.4 — Local Model (Gemma), Chat attachments

**Run AI on your device by default, attach files in Chat, and simplify Settings.**

- **Local Model is the default.** Settings → **Local Model (require around 2gb disk space)** replaces the old Google AI Mode paste flow. Download Gemma once from Hugging Face (WebGPU), or **Load from disk** / **Save to Disk**. Tips appear every 5% while downloading. No API key for Chat.
- **Chat + attachments.** Click **+** next to the chat box to send photos or PDFs with your question (same types as Import). Recognition stays in the browser; the bubble shows filename chips. Chat **+** does not insert into the document.
- **Settings cleaned up.** System message, Rationale rules, and Temperature appear only when **Debug Mode** is on. **selection only** is removed; **include selection** remains.

No migration. Existing browsers that already saved Minimax/OpenAI keep that provider until you change it.

---

## v0.6.3 — Attach photos and PDFs in Chat

**Click + in the chat box to send a file with your question.**

- The picker accepts the same images and PDFs as **Import**. Recognition stays in the browser.
- Send includes both the extracted text and what you typed. The model is asked to clean the extract as Markdown first, then answer. Import still inserts into the document; Chat **+** does not.
- **+** and **Send** sit on one bar inside the message field.
- The bubble shows filename chips. History and JSON backups keep the extract, not the original file.

No new Settings. No migration.

---
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
- **Clicking a Graph heading or term scrolls the Write pane** to that passage (Graph, Mindmap, and 3D). Words and the selection stay locked together while you scroll.

No new settings, no migration.

---

## Earlier releases

- **v0.6.5** — Debug token counter; comment batches sent once.
- **v0.6.4** — Local Model default, Chat attachments, Debug-gated Settings.
- **v0.6.3** — Chat **+** photo/PDF attachments.
- **v0.6.2** — Phone overlay shell, Chat archives, Graph Filter stacking.
- **v0.6.1** — Format menu visible; Split = Write/Preview \| Graph.
- **v0.6.0** — Legible 3D labels and dark-mode spheres; one-row toolbar; Welcome covers Graph.
- **v0.5.0 – v0.5.9** — Graph (map / Globe / 3D / Filter; Globe later replaced by Mindmap), JSON backup export/import, Preview wikilinks, Functional Specification, Apply waterfall, selection-only chat, secret redaction, session-only API key.
- **v0.4.0 – v0.4.9** — Comment + Send to AI, rounds / rationales, Google AI Mode, `@` mentions with heading sections, Format dropdown.
- **v0.3.0 – v0.3.4** — Design system, Import → Markdown / OCR, Apply All, Predict, B/I/U.
- **v0.2.x** — Early UI overhauls.

Full developer notes: [RELEASE_NOTES.md](https://github.com/roxelfivan/apeditor/blob/main/RELEASE_NOTES.md).

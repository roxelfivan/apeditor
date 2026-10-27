# What's new

This page is the in-app changelog. It stays with the version in the top bar. Older releases are summarized at the bottom; the full developer changelog is [RELEASE_NOTES.md](https://github.com/roxelfivan/apeditor/blob/main/RELEASE_NOTES.md) on GitHub.

## v0.6.3 — Attach photos and PDFs in Chat

**Click + in the chat box to send a file with your question.**

- The picker accepts the same images and PDFs as **Import**. Recognition stays in the browser.
- Send includes both the extracted text and what you typed. The model is asked to clean the extract as Markdown first, then answer. Import still inserts into the document; Chat **+** does not.
- **+** and **Send** sit on one bar inside the message field.
- The bubble shows filename chips. History and JSON backups keep the extract, not the original file.

No new Settings.

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
- **Clicking a Graph heading or term scrolls the Write pane** to that passage (Flat, Globe, and 3D). Words and the selection stay locked together while you scroll.

No new settings, no migration.

---

## Earlier releases

- **v0.6.0** — Legible 3D labels and dark-mode spheres; one-row toolbar; Welcome covers Graph.
- **v0.5.0 – v0.5.9** — Graph (map, Globe, 3D, Filter), JSON backup export/import, Preview wikilinks, Functional Specification, Apply waterfall, selection-only chat, secret redaction, session-only API key.
- **v0.4.0 – v0.4.9** — Comment + Send to AI, rounds / rationales, Google AI Mode, `@` mentions with heading sections, Format dropdown.
- **v0.3.0 – v0.3.4** — Design system, Import → Markdown / OCR, Apply All, Predict, B/I/U.
- **v0.2.x** — Early UI overhauls.

Full developer notes: [RELEASE_NOTES.md](https://github.com/roxelfivan/apeditor/blob/main/RELEASE_NOTES.md).

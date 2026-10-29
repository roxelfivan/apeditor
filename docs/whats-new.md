# What's new

This page is the in-app changelog. It stays with the version in the top bar. Older releases are summarized at the bottom; the full developer changelog is [RELEASE_NOTES.md](https://github.com/roxelfivan/apeditor/blob/main/RELEASE_NOTES.md) on GitHub.

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

- **v0.6.0** — Legible 3D labels and dark-mode spheres; one-row toolbar; Welcome covers Graph.
- **v0.5.0 – v0.5.9** — Graph (map, Globe, 3D, Filter), JSON backup export/import, Preview wikilinks, Functional Specification, Apply waterfall, selection-only chat, secret redaction, session-only API key.
- **v0.4.0 – v0.4.9** — Comment + Send to AI, rounds / rationales, Google AI Mode, `@` mentions with heading sections, Format dropdown.
- **v0.3.0 – v0.3.4** — Design system, Import → Markdown / OCR, Apply All, Predict, B/I/U.
- **v0.2.x** — Early UI overhauls.

Full developer notes: [RELEASE_NOTES.md](https://github.com/roxelfivan/apeditor/blob/main/RELEASE_NOTES.md).

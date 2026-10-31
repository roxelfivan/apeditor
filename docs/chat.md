# Chat

Chat is the right-hand panel. Use it for free-form questions, selection-based rewrites, and replies that include proposed edits.

## Header

- **Chat** (with **+** / **−**) plus the current model name (or `local-gemma`). Click **Chat** to tuck the conversation away so only the header and input remain. That preference persists across reloads.
- **Expand all** / **Collapse older** — when there is more than one turn, expand every prompt/reply or collapse all but the latest. Older turns start collapsed; the latest stays open.
- **History** — browse the live thread and archived conversations for this document
- **Archive** — park the live conversation and start a new empty chat (disabled when empty). Archived threads are **not** sent to the model on the next prompt.
- **Clear** — deletes this document’s **live** conversation without archiving (disabled when empty)
- **×** — hides the panel (show it again from the right-edge chevron)

You can drag the left edge of the panel to resize its width, and drag the thin divider between the messages area and the input area to grow or shrink the composer (**include selection** and the typing box move with the handle; the messages list fills the leftover space above). Both splits persist across reloads.

If you have never sent a message, Chat shows: *Ask anything, or highlight text in the editor and send a prompt from the library.*

## History and archive

**History** opens an overlay (same idea as revision history):

- **Current** is the live thread. **Archive current** parks it. **Archive older than 7 days** moves only messages whose timestamps fall on or before that cutoff; newer messages stay live.
- Each archived session lists a title (first line of the first user message), the archive date, and a message count. Open one to read it. Turns are collapsible; proposed-edit cards are not interactive here.
- **Restore as current** makes that archive the live chat. If Current is not empty, it is archived first.
- **Delete archive** removes that parked thread after a confirm. **Clear** still only wipes Current.

JSON backup export/import includes archived chats. Older backup files without that field import with an empty archive list.

## Send a message (Minimax or OpenAI)

1. Type in the box (*Ask, or ⌘/Ctrl+Enter to send… type @ to reference a document*).
   - Type `@` to attach another document (or selected headings / sections) — see [Reference other documents](reference-other-documents.md).
   - Click **+** next to the box to attach photos or PDFs (the same types as [Import](import.md)). Recognition runs in the browser. On Send, the model is asked to turn those extracts into Markdown first, then answer your typed request. The bubble shows chips plus what you typed; the document is not changed. You can send attachments with no typed text.
2. Optionally check **include selection** so the highlighted editor text is sent with the message (along with the usual document context).
3. **paste selection (n)** inserts the highlight into the input if you would rather see it in the box.
4. Click **Send** or press `Ctrl+Enter` / `⌘Enter`.

While a reply is streaming, **Send** becomes **Stop**. The assistant may show **thinking…** until text arrives.

On the Local Model, a **token counter** sits immediately to the left of **Send** — see [Token counter](#token-counter-local-model).

Before each send, ApEditor stores a revision labeled **Before AI send**.

If the request fails, a red error appears (or **Unknown error**). Check your key, endpoint, and network, then try again. See [Troubleshooting](troubleshooting.md).

## Include selection

**include selection** is on by default. It attaches the highlight *in addition to* the usual document context (outline for Minimax/OpenAI, full body for Local Model when size allows). User messages that included a highlight can show **▸ selection (n chars)** on the bubble.

Highlights are wrapped in `BEGIN EDITOR SELECTION` / `END EDITOR SELECTION` markers so the model can see the bounds.

ApEditor also redacts secret-looking strings (API keys, Bearer tokens) from the outbound prompt and shows a quiet notice when it does.

Use include/selection-only when you want a rewrite of a specific passage without creating comments. For many notes on one draft, [Comments](comments.md) plus **Send to AI** is usually clearer.

## Local Model

If Settings → **Provider** is **Local Model (require around 2gb disk space)**:

1. Download the ~2 GB `gemma-4-E2B-it-web.litertlm` model from Hugging Face once (or **Load from disk** if you already have the file). Requires WebGPU (recent Chrome / Edge / Safari) and enough GPU memory (~1.8 GB).
2. Wait until status shows **Ready**, then send chat as usual — replies stream in the panel.
3. Comment **Send to AI** uses the same local engine.

Local Gemma answers in normal prose for questions and explanations. **Proposed Edit** cards appear only when you ask for document changes, or when you use Comment **Send to AI**. The open document is attached on the user turn (full body, capped) so “the paragraph” / “each point” resolve to that text. (Minimax and OpenAI keep their usual edit-oriented outline prompt.)

The model is stored in this browser’s Cache API; it is never uploaded to ApEditor servers and is not part of the GitHub / Vercel deploy.

**Predict** and OCR→Markdown rewrite still need Minimax or OpenAI with an API key.

## Prompt library

Saved prompts can fill the Chat input, including the current selection. See [Prompt library](prompt-library.md).

## Staged rejection comments

If you **Reject with feedback** on a proposed-edit card, Chat shows how many rejection comments are staged. Use **Send n rejection comments** to send them together, or **Clear staged** to drop them. Details: [Proposed edits](proposed-edits.md).

## Token counter (Local Model)

When the **Local Model** is the active provider, a token pill sits left of **Send** in the composer: the estimated size of the message you are about to send, plus `sent ~N` for the previous send. It is a rough estimate and turns amber or red as the prompt approaches the on-device budget. Keyed providers (Minimax, OpenAI) have no local budget, so no counter is shown.

## Reference other documents with `@`

Type `@` in the chat input to attach another document. Pick a doc, then choose **Whole document** or tick heading sections and click **Use selection**. A chip (and often a `§…` caption) shows what you attached. Details: [Reference other documents](reference-other-documents.md).

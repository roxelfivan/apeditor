# Troubleshooting

## Settings keeps asking for a key

Minimax and OpenAI need an API key. Paste it in **Settings** and click **Save**. Or switch **Provider** to **Local Model (require around 2gb disk space)** and download the on-device model if you do not want a key.

The amber dot on the gear means no key is stored yet.

## Chat shows an error

- Confirm **Save** in Settings (unsaved key/endpoint will not be used)
- Check that the key is valid for that provider
- Confirm you are online
- Try **Stop** if a reply is stuck, then send again

The red box shows the provider message, or **Unknown error**.

## Proposed edits will not Apply

**Apply** tries an exact match first, then Best Effort. If both fail (or Best Effort is blocked to avoid duplication), select the target text and use **Highlight Apply**. Or restore a **Before AI send** revision. See [Proposed edits](proposed-edits.md).

**Apply n changes** may report that some items were skipped because they were not anchored — use Highlight Apply on those cards.

## Comment says Outdated

The highlighted sentence changed too much to find. Edit or delete the comment from the badge. Outdated comments are skipped by **Send to AI**.

## Predict is greyed out

Turn on Minimax or OpenAI and save a key. Predict is off by default; click **Predict** to start. It does not run under Local Gemma in v1.

## Import will not format Markdown

OCR can read the file in the browser, but rewriting as Markdown needs a keyed provider. Add a key in Settings. Also select at least one OCR language.

## Chat + found no text

The same image and PDF types as Import. If you see **No text was recognized**, the file was empty or unreadable. A file that is too large uses the same size limits as Import. Chat **+** never inserts into the document — use Import for that.

If you see **No text was recognized in the selected file(s).**, try a clearer image, a different language, or a text-based PDF.

## Chat or sidebar disappeared

Use the chevrons on the left, right, or top edge of the window. Shortcuts: `Ctrl+B` / `⌘B` for the sidebar (when not typing in the editor), `Ctrl+Shift+C` / `⌘Shift+C` for Chat.

If you clicked **×** on Chat, use the right-edge chevron to show it again.

## My documents vanished

They lived in this browser’s storage. Another browser, a private window, or cleared site data starts fresh. ApEditor cannot recover that data from the cloud.

If you still have a **revision** in the same profile, open [Revision history](revisions.md) before deleting documents.

## Local Gemma will not load

- Confirm the browser supports **WebGPU** (recent Chrome, Edge, or Safari) and has enough GPU memory (~1.8 GB)
- Try **Download from Hugging Face** again, or **Load from disk** with `gemma-4-E2B-it-web.litertlm`
- If download fails under a corporate proxy, use Load from disk after fetching the file outside the browser
- **Clear cached model** in Settings, then download again if the cache looks corrupt

## Local Model reply is cut short

The reply stops mid-sentence because the prompt used up the model's memory. The on-device model has a total budget of **8,192 tokens** for the prompt *and* the reply, and reserves **1,024** of them for the reply. That leaves about **7,168 tokens** for what you send.

Turn on **Debug Mode** in Settings and look at the token counter next to **Send** (Chat) or **Send to AI** (comments):

- **Green / grey** — the prompt fits, a full reply should come through.
- **Amber** — close to the limit. The reply may be trimmed.
- **Red** — the prompt does not fit. The reply will be cut off.

To shrink the prompt:

- Send fewer comments at once, or send them in smaller batches.
- Shorten the document, or work on a section rather than the whole file.
- Remove `@`-references you do not need — each one adds its own text.

The counter is a rough estimate (about 4 characters per token), so treat it as a guide rather than an exact number. On Minimax and OpenAI there is no local memory limit, so the counter shows the size without a budget check.

## Undo typed the wrong thing

`Ctrl+Z` / `⌘Z` in the editor undoes the last **comment** operation if one is on the stack; otherwise the browser undoes typing. Use **Revision history** to roll back a large AI apply.

## Debug numbers on the toolbar

**Debug Mode** is on in Settings. Turn it off and **Save** if you do not need completion counters or the token counters next to **Send** / **Send to AI**.

## `@` picker shows No matching documents

The picker lists every document **except** the one you are editing. Create or open a second document in the sidebar, then type `@` again.

## `@` chip says (deleted)

The source document was removed. Delete the chip or pick another document. Deleted references are not sent to the AI.

## Where is the user guide?

Click **?** in the top bar, or press `Ctrl+/` / `⌘/`. Help uses the same Light / Dark theme as the app.

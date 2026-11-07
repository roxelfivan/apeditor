# Privacy and your data

ApEditor is built to keep drafts on your machine. There is no ApEditor account and no ApEditor server that stores your documents.

## What stays in the browser

This browser keeps:

- Documents and their text
- Chat history per document
- Comments, rounds, and applied rationales
- Revisions
- Prompt library
- Settings (including API keys, unless you chose “forget key when this tab closes”)
- Layout, theme, and font sizes

Closing the tab or restarting the computer does **not** wipe this. Another browser profile, private window, or device will **not** see it.

## What leaves the browser

You send data when you:

- **Send** a Chat message, **Send to AI** comments, or send rejection feedback — to the **Minimax, OpenAI, Ollama, or LM Studio endpoint** you configured (including any `@`-referenced documents attached to that turn, and any photo/PDF text attached with Chat **+**)
- **Import** a photo or PDF — recognition is local; the extracted text is then sent to that same endpoint to format as Markdown
- **Chat +** — recognition is local, same as Import; only the extracted text (plus your typed request) is sent on Send. There is no separate Markdown-rewrite call; formatting is part of that one chat prompt
- Use **Local Model** — after a one-time model download from Hugging Face, chat runs entirely in the browser (WebGPU). Prompts for that provider do not leave the device
- Use **Ollama** or **LM Studio** — prompts go to the local server on your machine over `http://localhost` (still cross-origin from the web app; CORS must allow this origin)

ApEditor does not intermediate HTTP chat requests. For Minimax / OpenAI your API key is sent only as `Authorization: Bearer …` to the URL in Settings. Ollama / LM Studio send no key. Non-HTTPS endpoints are refused, except `http://localhost` for local servers.

## Shared and public computers

Anyone with access to this browser profile can open ApEditor and read your drafts and key.

When you finish on a shared machine, clear this site’s data (or use a private window and close it). That removes documents, chats, keys, and layout.

## Import and OCR

Choosing **File → Import photos / PDFs** in the Documents sidebar runs recognition on-device. Files are not uploaded to ApEditor. After recognition, only the extracted text is sent to your AI provider for Markdown formatting.

Chat **+** uses the same on-device recognition. Original images and PDFs are not kept in chat history — only filenames and the extracted text.

## What clearing data does

Clearing cookies/site storage for ApEditor resets you to a first-run state (sample **Welcome** and **Ideas** documents, empty Chat, no key). Export anything you need first by copying Markdown out of the editor.

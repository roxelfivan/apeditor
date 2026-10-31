# Settings

Open **Settings** from the gear in the top bar, or press `Ctrl+.` / `⌘.` when you are not typing in a field. On first launch, Settings may open by itself if the current provider needs a key.

Drag the edges of the window to resize it. **Cancel** discards unsaved edits; **Save** applies them.

## Provider

| Option | API key | Typical use |
| --- | --- | --- |
| **Local Model (require around 2gb disk space)** | None | Default on first launch. In-browser Gemma via WebGPU; download once from Hugging Face |
| **Minimax** | Required | Streaming Chat in the panel |
| **OpenAI** | Required | Streaming Chat with OpenAI models |

Changing provider updates the default endpoint and model list. You can still type a custom model name.

## API key

Paste the key from your provider. **Show** / **Hide** toggles visibility.

The key is stored only in this browser’s local storage by default. Check **Forget API key when this tab closes** to keep it in session storage instead — closing the tab forgets the key; documents and chat stay. It is sent as a Bearer token to the HTTPS endpoint you set — not to an ApEditor backend. Do not leave a key on a shared computer; clear site data when you are done.

For Local Gemma the field is unused — use the download / load controls instead.

## API endpoint and model

**API endpoint** is the base URL for Minimax or OpenAI. You usually keep the preset (`https://api.minimax.io/v1` or `https://api.openai.com/v1`).

**Model** offers presets you can pick or type over:

- Minimax: `MiniMax-M3`, `MiniMax-M3-fast`, `MiniMax-M2.7`, `MiniMax-M2.7-highspeed` (default `MiniMax-M2.7`)
- OpenAI: `gpt-4o-mini`, `gpt-4o`, `gpt-4-turbo`, `o1-mini`, `o1`, `gpt-3.5-turbo` (default `gpt-4o-mini`)

Local Gemma does not use these fields for requests. Download **gemma-4-E2B-it-web** (~2 GB) from Hugging Face (cached in this browser), or **Load from disk** a `.litertlm` file. After it is cached, **Save to Disk** exports a copy you choose (or downloads to your Downloads folder). The box shows **Last saved** as the filename and time — browsers do not expose the full folder path. Clear the cached model from Settings when you want to free browser storage. While downloading, short ApEditor tips appear every 5%.

## Debug Mode

When **off** (default), Settings hides **System message**, **Rationale rules**, and **Temperature**. Turn **Debug Mode** on to edit those advanced prompt controls, and to show inline-completion status (`thinking` / `ready · tab` / `idle`) and request/accept counters on the editor toolbar. Click the counters to reset them. Most people can leave this off.

The **token counter** next to both send buttons is not part of Debug Mode — it follows the provider:

- **Chat** — left of **Send**, the estimated size of the message you are about to send, plus `sent ~N` for the previous send.
- **Comments** — next to **Send to AI**, the estimated size of the comment batch.

It appears when the **Local Model** is the active provider, because the on-device memory limit is what it warns about. Keyed providers (Minimax, OpenAI) have no local budget, so no counter is shown there.

The number is a rough estimate (about 4 characters per token), not an exact count. On the Local Model the pill turns amber when the prompt is close to the budget and red when it does not fit — a red pill means the reply will be cut short. See [Troubleshooting](troubleshooting.md#local-model-reply-is-cut-short).

## System message

Visible only when **Debug Mode** is on. Standing instruction for the assistant (voice, how it should propose edits, and so on).

Edit the box, then **Save**. **Reset** restores the built-in default. Changes apply to the **next** send; existing Chat history is unchanged.

## Rationale rules

Visible only when **Debug Mode** is on. These rules shape the **rationale** on each proposed edit (what you read on the comment badge after **Apply**). The default is a long, structured style in Markdown, with numbered points and important terms **bold and underlined**.

Leave the field as the default, customize it, or **Reset**. An empty field after save uses the built-in default.

## Temperature

Visible only when **Debug Mode** is on. Default **0.7**. Lower values make replies more repeatable; higher values more varied. Drag the slider and **Save**.

## UI font size

Slider from 12 to 20 pixels (default 14). **Reset** returns to 14. Editor body size stays on the editor toolbar.

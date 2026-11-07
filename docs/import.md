# Import photos, PDFs, and tables

You can pull text out of images or PDF files and insert it as Markdown at the caret. Recognition runs **in this browser**. Turning the raw text into readable Markdown uses the same AI settings as Chat, so an HTTP provider is required for that last step (Minimax or OpenAI with a key, or Ollama / LM Studio with a local endpoint).

Chat has a separate **+** next to the message box. It accepts the same image and PDF types, but it attaches the extract to that chat turn instead of inserting into the document. See [Chat](chat.md).

**Spreadsheet tables** (CSV / TSV) use a different button — see [Import a table from CSV or TSV](#import-a-table-from-csv-or-tsv) below. That path needs no AI provider at all.

## What you can import

- **Images** — common formats such as PNG, JPEG, and WebP
- **PDFs** — text PDFs are read as text; scanned PDFs are treated as images and recognized on-device
- Several files in one batch, processed in order

## How to import

1. Open a document and click where the text should appear.
2. Open **File** in the Documents sidebar and click **Import photos / PDFs**.
3. Choose at least one **OCR language**: **English**, **Simplified Chinese**, **Traditional Chinese**.
4. Click **Choose Import File(s)** and pick files.
5. Wait for the progress chip (for example `2/5`, then **formatting as Markdown…**).
6. Formatted Markdown is inserted at the caret.

**Close** dismisses the language popover without importing.

The popover explains: recognition stays in the browser; after a successful import, extracted text is rewritten as readable Markdown using only the API key, endpoint, and model from Settings.

## Requirements

- At least one language checked, or you will see **Select at least one language.**
- An HTTP chat provider in Settings (Minimax, OpenAI, Ollama, or LM Studio — not Local Gemma) for Markdown formatting, or a Settings error asking you to configure one.
- Recognizable text in the files, or **No text was recognized in the selected file(s).**
- If the engine fails: **OCR failed.**

While work is in progress, the **File** button shows a pulse and stays disabled.

## Privacy

Image and PDF recognition does **not** upload your files to ApEditor (there is no ApEditor server). The recognized text is then sent to **your** configured AI endpoint so it can be rewritten as Markdown, the same way Chat sends prompts.

Clear the inserted text from the document if you do not want it kept in local storage with the rest of the draft.

## Import a table from CSV or TSV

**File → Import .csv / .tsv** turns a spreadsheet export into a Markdown table and drops it in at your caret.

This path is **entirely local** — no AI provider is used and nothing is uploaded. It works offline.

### How to import

1. Open a document and click where the table should appear.
2. Open **File** in the Documents sidebar and click **Import .csv / .tsv**.
3. Pick the file. The table appears at your caret.

### What it accepts

- **`.csv`** — comma separated
- **`.tsv`** — tab separated
- **`.txt`** — some spreadsheet programs export tab-delimited files with a `.txt` name

You do not have to pick the right one. ApEditor works out the separator from the file itself, so a tab-delimited file named `.csv` still imports correctly. A comma inside a quoted field is not mistaken for a separator, and a European export (`Name;Preis` with `3,50` as the decimal) is detected as well.

Files saved by spreadsheet programs as UTF-8 or UTF-16 are both read correctly.

### What the table looks like

The first row becomes the header. The result is a plain Markdown table:

```markdown
| Name | Qty | Price |
| --- | --- | --- |
| Widget | 12 | 3.50 |
```

Because it is ordinary Markdown, you can edit it by hand, keep it in a revision, or export it to `.md`. Ask Chat to change cells and it proposes **table-edit** cards that Apply one cell at a time (without treating short values like `12` as prose quotes). See [Proposed edits](proposed-edits.md#table-cells).

### Things to know

- **The conversion is literal.** A spreadsheet file has no type information, so currency, percentages, dates, and codes with leading zeros (`007`) come through exactly as text. ApEditor cannot tell a currency column from a text column and will not guess.
- **Numbers are not right-aligned by default**, so a column of identifiers is never mistaken for a quantity.
- **Cells are escaped** so the table cannot break: a `|` inside a cell is kept as text, and HTML in a cell is shown as text rather than being run.
- **A file over 10 MB** or with more than 20,000 rows is rejected — split it and import the parts.

## Compare with another file

**File → Compare…** redlines a second document against the one you have open (the open file is the original; the imported file is the revision).

You can pick:

- A `.md` or `.txt` file
- An ApEditor `.json` backup (uses that backup’s document body)
- A `.docx` file (converted in the browser)
- Another document already in the sidebar

The result is a panel of **suggested edits**, the same cards Chat uses. **Apply**, **Skip**, or **Apply all**. A revision snapshot labelled **Before compare** is saved before a bulk apply. This does not send the files to an AI.

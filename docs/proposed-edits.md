# Proposed edits

When the AI wants to change the document, the reply includes one or more **cards** instead of silently rewriting your draft. You decide what lands in the file.

## Read a card

Each card has a short **summary** (or **Proposed edit** if none was given) and a change id.

**Split** (default) shows two rendered Markdown columns: **Original** and **Proposed**. Empty sides show *Empty*. Drag the vertical divider between the two columns to resize them — the split is remembered per card across reloads, and is clamped so neither side can collapse.

**Inline** shows a line-by-line diff of the same two texts.

While the card is open, the editor highlights the span Apply would replace (exact quote, or a best-effort match).

If the model quoted text that is not in the current document, you may see **Potential mismatch detected** — one line. Click it to read the details. Apply then uses Best Effort when a safe approximate span is found; otherwise select text and use **Highlight Apply**.

## Apply

**Apply** uses a waterfall:

1. **Exact** — if the quoted original still exists in the document, that span is replaced.
2. **Best Effort** — if Exact fails, ApEditor looks for a high-coverage approximate span (shown on the card with a confidence %). Apply replaces that span when it is safe; it is blocked when a splice would duplicate surrounding text.

A muted label next to Apply shows **Exact match** or **Best effort · N%**.

After a successful apply:

- The document updates
- The related comment highlight moves to the new wording
- The rationale is stored on the comment’s current round (open the badge to read it)
- The card shows **Applied to document.**

## Highlight Apply

When neither Exact nor Best Effort can apply safely, select the target text in the editor. **Highlight Apply** appears and replaces your selection with the proposed text.

Use Highlight Apply carefully — you choose the span; ApEditor does not re-check the quote.

If Original and Proposed are identical, the card can show **(no textual change)**.

## Apply several changes at once

At the bottom of an assistant message you may see **1 proposed change in this reply** or **n proposed changes in this reply**, plus **Apply n change(s)**.

That action:

1. Saves a revision labeled **Before Apply All**
2. Applies every change via the same Exact → Best Effort waterfall
3. Skips the rest (use Highlight Apply on those cards)

You will see **Applied all n change(s).** or **Applied x of y changes (z skipped — not anchored). Use Highlight Apply on those cards.**

## Reject

**Reject** opens a small panel on the card. The panel holds both ways to reject:

- **Reject** — discards that card without changing the document and without sending anything to the AI.
- **Reject with feedback** — sends your reason back to the model.

Close the panel with **Cancel** (or `Esc`) if you change your mind; the button in the card's action row goes back to **Reject**.

## Reject with feedback

Use this when you want the model to try again with your reason:

1. Click **Reject** on the card — the panel opens with the **Comment (optional)** box focused.
2. Optionally fill it — *Why reject? (sent to the AI as revision feedback) — type @ to reference a document*
   - Type `@` to attach another document or heading sections. See [Reference other documents](reference-other-documents.md).
   - You can stage feedback with `@` chips even if the comment box is empty.
   - `⌘/Ctrl+Enter` stages the feedback; `Enter` starts a new line.
3. Click **Reject with feedback**

The reason is **staged**, not sent yet. While staged, the comment is read-only but the attached chips (including any `@`-references) stay visible so you can review what you're about to send. The tip reads: *Staged. Click "Send rejection comments" in the message footer to send.* If you leave the box empty, use the plain **Reject** button in the panel.

In the message footer, **Send n rejection comments** sends every staged reason (with merged `@`-references) in one Chat turn. **Clear staged** drops them.

## Missing quotes

Edits apply automatically when **original** is still findable (exact or best-effort). Common reasons both fail:

- You edited that paragraph after the reply started
- The model paraphrased too far from the document
- You already applied a nearby change that shifted the wording

Open **Show what the AI was looking for** on the card if you need to see the quote. Then either restore the old wording from [Revision history](revisions.md), or select the target span and use **Highlight Apply**.

## Reference other documents in rejection feedback

The **Comment (optional)** box on a proposed-edit card supports `@`, so you can attach another document to your rejection reason. For example, *“see the policy in `<Other Doc>` § Risk Owners”* — the model gets that context when you **Send N rejection comments**. Details: [Reference other documents](reference-other-documents.md).

/**
 * Short ApEditor feature tips shown during Local Gemma download.
 * One tip every 5% progress (0% → index 0, 5% → 1, …, 100% → last).
 * Keep each tip ≤20 words.
 */

export const LOCAL_GEMMA_DOWNLOAD_TIPS: readonly string[] = [
  'Chat sits on the right. Ask anything about the open document.',
  'Highlight text, then include selection so the model focuses on that passage.',
  'Type @ in Chat to attach another document or heading sections.',
  'Proposed Edit cards let you Apply or Reject each change independently.',
  'Paste selection inserts the highlight into the Chat input when you prefer.',
  'Apply All runs Exact match first, then Best Effort for near matches.',
  'Reject with feedback stages a comment; send them together when ready.',
  'Select a passage and Comment, then Send to AI for a batch review.',
  'Stale comments can be re-linked or dismissed from the comment margin.',
  'Predict suggests the next sentence; Tab accepts, Esc dismisses.',
  'Predict needs Minimax or OpenAI — it is off for Local Gemma.',
  'Save a revision anytime; restore earlier drafts from history.',
  'Archive Chat parks the thread so the next prompt starts fresh.',
  'Graph view maps documents and headings; Filter narrows what you see.',
  'Split view shows Write beside Graph for navigation while editing.',
  'Import photos or PDFs; OCR runs in the browser before Markdown rewrite.',
  'Prompt library fills Chat with saved rewrites and continuations.',
  'Your API key stays in this browser; ApEditor has no login server.',
  'Documents auto-save locally; export Markdown or JSON when you need a backup.',
  'Local Gemma runs on WebGPU — replies never leave your device.',
  'After download, use Save to Disk to keep a .litertlm copy offline.',
];

/**
 * Tip for a download percent in 0–100. Unknown/invalid pct → first tip.
 */
export function tipForDownloadProgress(pct: number): string {
  const tips = LOCAL_GEMMA_DOWNLOAD_TIPS;
  if (tips.length === 0) return '';
  if (!Number.isFinite(pct) || pct < 0) return tips[0];
  const index = Math.min(Math.floor(pct / 5), tips.length - 1);
  return tips[index];
}

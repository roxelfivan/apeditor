/**
 * Copy plain text to the clipboard. Prefers the async Clipboard API
 * (secure contexts) and falls back to a hidden textarea +
 * `document.execCommand('copy')` so the confirm-dialog path still
 * works on http://localhost and older browsers.
 */
export async function writeClipboardText(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Permissions / insecure context — try the execCommand path.
    }
  }
  fallbackCopy(text);
}

function fallbackCopy(text: string): void {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  ta.style.top = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  if (!ok) {
    throw new Error('Could not copy to the clipboard.');
  }
}

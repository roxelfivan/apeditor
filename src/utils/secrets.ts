/**
 * Soft secret redaction for outbound model payloads and file downloads.
 *
 * Matches common BYO-key / token shapes in free text so a draft that
 * accidentally contains an API key is not forwarded verbatim. Downloads
 * also strip the live Settings key (`scrubLiveSecretFromExport`) so a
 * key pasted into a document or chat cannot leave via Export .md / .json.
 * This is a best-effort filter, not a security boundary — session-only
 * keys and not pasting secrets into the document remain the real controls.
 */

const SECRET_PATTERNS: RegExp[] = [
  // OpenAI-style secret keys (sk-… / sk-proj-…).
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g,
  // Bearer tokens in prose.
  /\bBearer\s+[A-Za-z0-9._\-+=/]{16,}/gi,
  // api_key / apikey / secret / token assignments.
  /\b(?:api[_-]?key|secret|access[_-]?token|auth[_-]?token)\s*[:=]\s*['"]?[A-Za-z0-9._\-+=/]{16,}['"]?/gi,
];

const REDACTED = '[redacted]';

/** Ignore tiny strings so a short password like "abc" cannot wipe an export. */
export const LIVE_SECRET_MIN_LENGTH = 8;

/**
 * Replace every occurrence of `secret` with `[redacted]`.
 * Used so a Settings API key that was pasted into a document or chat
 * cannot ride along in a Markdown or JSON download.
 */
export function stripExactSecret(
  text: string,
  secret: string
): { text: string; count: number } {
  if (!text) return { text, count: 0 };
  const needle = secret.trim();
  if (needle.length < LIVE_SECRET_MIN_LENGTH) return { text, count: 0 };
  if (!text.includes(needle)) return { text, count: 0 };
  const parts = text.split(needle);
  return { text: parts.join(REDACTED), count: parts.length - 1 };
}

/**
 * Scrub a download payload of the live Settings API key, including the
 * JSON-escaped form (`\"`, `\\`, …) that appears inside `.json` backups.
 */
export function scrubLiveSecretFromExport(
  content: string,
  liveSecret: string
): string {
  const raw = liveSecret.trim();
  if (raw.length < LIVE_SECRET_MIN_LENGTH) return content;
  let next = stripExactSecret(content, raw).text;
  const jsonEscaped = JSON.stringify(raw).slice(1, -1);
  if (jsonEscaped !== raw) {
    next = stripExactSecret(next, jsonEscaped).text;
  }
  return next;
}

export function redactSecrets(text: string): { text: string; count: number } {
  if (!text) return { text, count: 0 };
  let next = text;
  let count = 0;
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    next = next.replace(pattern, () => {
      count += 1;
      return REDACTED;
    });
  }
  return { text: next, count };
}

export function redactSecretsInMessages<T extends { content: string; selection?: string }>(
  messages: T[]
): { messages: T[]; count: number } {
  let count = 0;
  const messagesOut = messages.map((m) => {
    const body = redactSecrets(m.content);
    count += body.count;
    let selection = m.selection;
    if (selection) {
      const sel = redactSecrets(selection);
      count += sel.count;
      selection = sel.text;
    }
    if (body.count === 0 && selection === m.selection) return m;
    return { ...m, content: body.text, ...(selection !== undefined ? { selection } : {}) };
  });
  return { messages: messagesOut, count };
}

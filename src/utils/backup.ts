/**
 * Single-document backup export + import.
 *
 * `buildDocumentBackup` and `serialiseDocumentBackup` are the pure,
 * UI-free primitives used by `FileActionsButton.tsx` to serialise a
 * document and its associated state into a single JSON blob the user
 * can download. The goal is "durable off-tab backup of one document's
 * working state" — comments, chat history, and revisions ride along
 * with `document.content` so a user can move a writing session between
 * profiles / devices without losing context.
 *
 * `parseDocumentBackup` is the inverse — it validates that a JSON
 * string matches the v1 shape and throws a `BackupParseError` on any
 * mismatch. Id collisions with the live store are NOT checked here;
 * that is a UI concern handled by `resolveImportDecisions` + the
 * collision-resolution modal in `FileActionsButton.tsx`.
 *
 * The shape is intentionally versioned (`schema` + `version`) so a
 * future re-import path can detect / upgrade older payloads. v1 is
 * fully bidirectional — exporting and re-importing a payload produces
 * a deep-equal document state (round-trip safe). Schema upgrades will
 * land in a future slice; this module refuses any non-v1 payload.
 *
 * No React imports, no DOM imports — same pattern as
 * `src/utils/comments.ts` and `src/utils/proposedEdit.ts`.
 */

import type {
  ArchivedChat,
  ChatAttachment,
  ChatMessage,
  Comment,
  CommentRound,
  DocumentRecord,
  MentionToken,
  ProposedEditRationale,
  Revision,
} from '@/types';
import { v4 as uuid } from 'uuid';
import { sanitizeFilename } from '@/utils/storage';

/**
 * JSON keys that must never appear in a downloaded backup. The v1
 * `DocumentBackup` shape has no credentials; this is a guard so a
 * future extra field (or a poisoned object) cannot leak Settings.
 */
const CREDENTIAL_JSON_KEYS = new Set([
  'apikey',
  'persistapikey',
  'authorization',
  'bearertoken',
  'accesstoken',
]);

function isCredentialJsonKey(key: string): boolean {
  return CREDENTIAL_JSON_KEYS.has(key.replace(/[_-]/g, '').toLowerCase());
}

export const BACKUP_SCHEMA = 'apeditor-document-backup';
export const BACKUP_VERSION = 1;

/**
 * Hard cap on a single imported `.json` backup file. Mirrors the OCR
 * per-file limit (`OCR_MAX_FILE_BYTES`) so the two import paths have
 * the same ceiling. Validated before `File.text()` so the browser
 * does not have to materialise a multi-MB string in memory first.
 */
export const BACKUP_MAX_FILE_BYTES = 50 * 1024 * 1024;

export interface DocumentBackup {
  /** Stable, grep-friendly identifier so future importers can match. */
  schema: typeof BACKUP_SCHEMA;
  /** Schema version of this payload. Bump on breaking changes. */
  version: typeof BACKUP_VERSION;
  /** Epoch milliseconds when the backup was produced. */
  exportedAt: number;
  /** App version that produced the backup (informational). */
  appVersion: string;
  document: DocumentRecord;
  comments: Comment[];
  chats: ChatMessage[];
  /**
   * Parked conversations. Always emitted (empty array when none) so
   * the file shape stays predictable. Older v1 files omit the field;
   * parse treats that as `[]`.
   */
  chatArchives: ArchivedChat[];
  revisions: Revision[];
}

/**
 * A backup that has been successfully parsed. Mirrors `DocumentBackup`
 * but separates the metadata envelope (`meta`) from the data slices
 * so callers can reach for either without a one-off destructure.
 */
export interface ParsedDocumentBackup {
  document: DocumentRecord;
  comments: Comment[];
  chats: ChatMessage[];
  chatArchives: ArchivedChat[];
  revisions: Revision[];
  meta: {
    schema: typeof BACKUP_SCHEMA;
    version: number;
    exportedAt: number;
    appVersion: string;
  };
}

/**
 * Per-document import decision returned by `resolveImportDecisions`.
 *
 *   - `documentId` is the **final** id the document will live under
 *     after the import lands in the store. Equals the file's id for
 *     `replace` and `skip`, and a freshly-minted uuid for `keep-both`.
 *   - `strategy` mirrors the user's choice in the collision modal.
 *   - `sourceTitle` is the title from the file BEFORE any rename —
 *     useful for the modal's row label, and as the seed for the
 *     `(imported)` suffix on `keep-both`.
 */
export interface ImportDecision {
  documentId: string;
  strategy: 'replace' | 'skip' | 'keep-both';
  sourceTitle: string;
}

/**
 * Thrown by `parseDocumentBackup` for every structural problem:
 * non-JSON input, wrong / missing `schema`, unsupported `version`,
 * missing or wrong-typed required fields, or a record whose
 * `documentId` differs from the parent document's `id` (which would
 * leave an orphan slice in the store).
 *
 * The original cause (when applicable) is attached via `cause` so the
 * UI can show the JSON parser's own message — which is normally far
 * more useful than "JSON parse failed".
 */
export class BackupParseError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'BackupParseError';
  }
}

/**
 * Build a `DocumentBackup` from the live store slices for `documentId`.
 *
 * Empty `comments` / `chats` / `chatArchives` / `revisions` arrays are
 * still emitted so
 * the file shape stays predictable (downstream code never has to guard
 * for `undefined`).
 *
 * Returns `null` for unknown `documentId` so the caller can surface a
 * friendly error rather than writing an orphan payload.
 */
export function buildDocumentBackup(args: {
  documentId: string;
  documents: DocumentRecord[];
  comments: Record<string, Comment[]>;
  chats: Record<string, ChatMessage[]>;
  chatArchives?: Record<string, ArchivedChat[]>;
  revisions: Record<string, Revision[]>;
  appVersion?: string;
}): DocumentBackup | null {
  const document = args.documents.find((d) => d.id === args.documentId);
  if (!document) return null;
  return {
    schema: BACKUP_SCHEMA,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    appVersion: args.appVersion ?? 'unknown',
    document,
    comments: args.comments[args.documentId] ?? [],
    chats: args.chats[args.documentId] ?? [],
    chatArchives: args.chatArchives?.[args.documentId] ?? [],
    revisions: args.revisions[args.documentId] ?? [],
  };
}

/**
 * Serialise a `DocumentBackup` to a pretty-printed JSON string. The
 * caller is responsible for triggering the download via
 * `downloadTextFile` from `@/utils/storage` — kept out of this module
 * so it stays DOM-free and easy to unit-test. Credential-shaped keys
 * (`apiKey`, `authorization`, …) are omitted if they ever appear.
 */
export function serialiseDocumentBackup(backup: DocumentBackup): string {
  return JSON.stringify(
    backup,
    (key, value) => (isCredentialJsonKey(key) ? undefined : value),
    2
  );
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== 'string') {
    throw new BackupParseError(
      `Backup is missing or has an invalid string field: ${key}`
    );
  }
  return v;
}

/**
 * Like `requireString` but additionally rejects the empty string. Used
 * for identity-bearing fields (id, documentId, kind discriminator) that
 * the rest of the editor never produces as empty in practice, and
 * which a missing/empty value here would silently mis-link a record
 * to the wrong document.
 */
function requireNonEmptyString(
  obj: Record<string, unknown>,
  key: string
): string {
  const v = obj[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new BackupParseError(
      `Backup is missing or has an invalid non-empty string field: ${key}`
    );
  }
  return v;
}

function requireNumber(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new BackupParseError(
      `Backup is missing or has an invalid number field: ${key}`
    );
  }
  return v;
}

function requireBoolean(obj: Record<string, unknown>, key: string): boolean {
  const v = obj[key];
  if (typeof v !== 'boolean') {
    throw new BackupParseError(
      `Backup is missing or has an invalid boolean field: ${key}`
    );
  }
  return v;
}

function optionalString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') {
    throw new BackupParseError(
      `Backup has an invalid string field (expected string or undefined): ${key}`
    );
  }
  return v;
}

function requireArray(obj: Record<string, unknown>, key: string): unknown[] {
  const v = obj[key];
  if (!Array.isArray(v)) {
    throw new BackupParseError(
      `Backup is missing or has an invalid array field: ${key}`
    );
  }
  return v;
}

function parseDocument(value: unknown): DocumentRecord {
  if (!isPlainObject(value)) {
    throw new BackupParseError('Backup document is not an object');
  }
  return {
    id: requireNonEmptyString(value, 'id'),
    title: requireString(value, 'title'),
    content: requireString(value, 'content'),
    createdAt: requireNumber(value, 'createdAt'),
    updatedAt: requireNumber(value, 'updatedAt'),
  };
}

function parseMention(value: unknown): MentionToken {
  if (!isPlainObject(value)) {
    throw new BackupParseError('Comment mention is not an object');
  }
  const kind = value.kind;
  if (kind !== 'doc' && kind !== 'doc-section') {
    throw new BackupParseError('Comment mention has invalid kind');
  }
  const reason = value.reason;
  if (
    reason !== undefined &&
    reason !== 'context' &&
    reason !== 'style' &&
    reason !== 'facts' &&
    reason !== 'terminology' &&
    reason !== 'compare'
  ) {
    throw new BackupParseError('Comment mention has invalid reason');
  }
  return {
    id: requireNonEmptyString(value, 'id'),
    kind,
    documentId: requireNonEmptyString(value, 'documentId'),
    documentTitle: requireString(value, 'documentTitle'),
    paragraphIndexes: (() => {
      const idx = value.paragraphIndexes;
      if (!Array.isArray(idx)) {
        throw new BackupParseError(
          'Comment mention paragraphIndexes must be an array'
        );
      }
      return idx.map((n, i) => {
        if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
          throw new BackupParseError(
            `Comment mention paragraphIndexes[${i}] must be a non-negative integer`
          );
        }
        return n;
      });
    })(),
    createdAt: requireNumber(value, 'createdAt'),
    ...(reason !== undefined ? { reason } : {}),
    ...(value.referrerId === undefined || value.referrerId === null
      ? {}
      : { referrerId: value.referrerId as string }),
  };
}

function parseAppliedRationale(value: unknown): ProposedEditRationale {
  if (!isPlainObject(value)) {
    throw new BackupParseError('Comment applied rationale is not an object');
  }
  return {
    messageId: requireNonEmptyString(value, 'messageId'),
    editId: requireNonEmptyString(value, 'editId'),
    summary: requireString(value, 'summary'),
    rationale: optionalString(value, 'rationale') ?? '',
    original: requireString(value, 'original'),
    replacement: requireString(value, 'replacement'),
    appliedAt: requireNumber(value, 'appliedAt'),
  };
}

function parseCommentRound(value: unknown): CommentRound {
  if (!isPlainObject(value)) {
    throw new BackupParseError('Comment round is not an object');
  }
  const start = requireNumber(value, 'start');
  const end = requireNumber(value, 'end');
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
    throw new BackupParseError(
      `Comment round has invalid range: start=${start} end=${end}`
    );
  }
  const mentionsRaw = value.mentions;
  const mentions: MentionToken[] | undefined = mentionsRaw
    ? (mentionsRaw as unknown[]).map((m, i) => {
        try {
          return parseMention(m);
        } catch (err) {
          throw new BackupParseError(
            `Comment mention[${i}] of round ${requireString(value, 'id')}: ${
              (err as Error).message
            }`,
            err
          );
        }
      })
    : undefined;
  const appliedRaw = value.applied;
  if (!Array.isArray(appliedRaw)) {
    throw new BackupParseError(
      `Comment round has invalid applied field (must be array)`
    );
  }
  const roundId = requireString(value, 'id');
  const applied = appliedRaw.map((a, i) => {
    try {
      return parseAppliedRationale(a);
    } catch (err) {
      throw new BackupParseError(
        `Comment applied[${i}] of round ${roundId}: ${
          (err as Error).message
        }`,
        err
      );
    }
  });

  return {
    id: roundId,
    start,
    end,
    snippet: requireString(value, 'snippet'),
    body: requireString(value, 'body'),
    createdAt: requireNumber(value, 'createdAt'),
    updatedAt: requireNumber(value, 'updatedAt'),
    outdated: requireBoolean(value, 'outdated'),
    sent: requireBoolean(value, 'sent'),
    applied,
    ...(mentions ? { mentions } : {}),
  };
}

function parseComment(value: unknown): Comment {
  if (!isPlainObject(value)) {
    throw new BackupParseError('Backup comment is not an object');
  }
  const id = requireNonEmptyString(value, 'id');
  const documentId = requireNonEmptyString(value, 'documentId');
  const start = requireNumber(value, 'start');
  const end = requireNumber(value, 'end');
  const roundsRaw = requireArray(value, 'rounds');
  const rounds = roundsRaw.map((r, i) => {
    try {
      return parseCommentRound(r);
    } catch (err) {
      throw new BackupParseError(
        `Backup comment ${id} rounds[${i}]: ${(err as Error).message}`,
        err
      );
    }
  });
  return {
    id,
    documentId,
    start,
    end,
    snippet: requireString(value, 'snippet'),
    body: requireString(value, 'body'),
    createdAt: requireNumber(value, 'createdAt'),
    updatedAt: requireNumber(value, 'updatedAt'),
    outdated: requireBoolean(value, 'outdated'),
    sent: requireBoolean(value, 'sent'),
    rounds,
  };
}

function parseChatAttachment(value: unknown): ChatAttachment {
  if (!isPlainObject(value)) {
    throw new BackupParseError('Backup chat attachment is not an object');
  }
  return {
    id: requireNonEmptyString(value, 'id'),
    name: requireString(value, 'name'),
    mime: requireString(value, 'mime'),
    extractedText: requireString(value, 'extractedText'),
  };
}

function parseChatMessage(value: unknown): ChatMessage {
  if (!isPlainObject(value)) {
    throw new BackupParseError('Backup chat message is not an object');
  }
  const role = value.role;
  if (role !== 'system' && role !== 'user' && role !== 'assistant') {
    throw new BackupParseError('Backup chat message has invalid role');
  }
  let attachments: ChatAttachment[] | undefined;
  if (value.attachments !== undefined) {
    if (!Array.isArray(value.attachments)) {
      throw new BackupParseError(
        'Backup chat message attachments must be an array'
      );
    }
    attachments = value.attachments.map((item, i) => {
      try {
        return parseChatAttachment(item);
      } catch (err) {
        throw new BackupParseError(
          `Backup chat message attachments[${i}]: ${(err as Error).message}`,
          err
        );
      }
    });
  }
  return {
    id: requireNonEmptyString(value, 'id'),
    role,
    content: requireString(value, 'content'),
    createdAt: requireNumber(value, 'createdAt'),
    ...optionalString(value, 'selection') !== undefined
      ? { selection: optionalString(value, 'selection') as string }
      : {},
    ...(value.metadata !== undefined
      ? { metadata: value.metadata as Record<string, unknown> }
      : {}),
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
  };
}

function parseArchivedChat(value: unknown): ArchivedChat {
  if (!isPlainObject(value)) {
    throw new BackupParseError('Backup archived chat is not an object');
  }
  const messagesRaw = requireArray(value, 'messages');
  const messages = messagesRaw.map((m, i) => {
    try {
      return parseChatMessage(m);
    } catch (err) {
      throw new BackupParseError(
        `Backup archived chat messages[${i}]: ${(err as Error).message}`,
        err
      );
    }
  });
  return {
    id: requireNonEmptyString(value, 'id'),
    title: requireString(value, 'title'),
    archivedAt: requireNumber(value, 'archivedAt'),
    messages,
  };
}

function parseRevision(value: unknown): Revision {
  if (!isPlainObject(value)) {
    throw new BackupParseError('Backup revision is not an object');
  }
  return {
    id: requireNonEmptyString(value, 'id'),
    documentId: requireNonEmptyString(value, 'documentId'),
    content: requireString(value, 'content'),
    createdAt: requireNumber(value, 'createdAt'),
    ...optionalString(value, 'label') !== undefined
      ? { label: optionalString(value, 'label') as string }
      : {},
  };
}

/**
 * Parse + validate a JSON string produced by `serialiseDocumentBackup`
 * (or hand-crafted with the same shape). Throws a `BackupParseError`
 * on any structural problem — non-JSON, wrong/missing `schema`,
 * unsupported `version`, missing required fields, or a record whose
 * `documentId` does not match the parent document's id (which would
 * otherwise orphan a slice in the store).
 *
 * Id collisions with the live store are NOT checked here. Resolve
 * them with `resolveImportDecisions` after parsing.
 */
export function parseDocumentBackup(raw: string): ParsedDocumentBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new BackupParseError(
      `Could not parse the file as JSON: ${(err as Error).message}`,
      err
    );
  }
  if (!isPlainObject(parsed)) {
    throw new BackupParseError('Backup root is not an object');
  }

  const schema = parsed.schema;
  if (schema !== BACKUP_SCHEMA) {
    throw new BackupParseError(
      `This file is not an ApEditor backup (expected schema "${BACKUP_SCHEMA}", got "${
        String(schema)
      }").`
    );
  }
  const version = parsed.version;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    throw new BackupParseError('Backup version is missing or not an integer');
  }
  if (version !== BACKUP_VERSION) {
    throw new BackupParseError(
      `Unsupported backup version ${version}. This build only imports version ${BACKUP_VERSION}.`
    );
  }
  const exportedAt = requireNumber(parsed, 'exportedAt');
  const appVersion = optionalString(parsed, 'appVersion') ?? 'unknown';

  const document = parseDocument(parsed.document);

  // Slices — declared as a single field each so a non-array rejects
  // with a stable error rather than a TypeError later.
  const commentsRaw = requireArray(parsed, 'comments');
  const chatsRaw = requireArray(parsed, 'chats');
  const chatArchivesRaw =
    parsed.chatArchives === undefined
      ? []
      : requireArray(parsed, 'chatArchives');
  const revisionsRaw = requireArray(parsed, 'revisions');

  const comments = commentsRaw.map((c, i) => {
    try {
      return parseComment(c);
    } catch (err) {
      throw new BackupParseError(
        `Backup comments[${i}]: ${(err as Error).message}`,
        err
      );
    }
  });
  const chats = chatsRaw.map((m, i) => {
    try {
      return parseChatMessage(m);
    } catch (err) {
      throw new BackupParseError(
        `Backup chats[${i}]: ${(err as Error).message}`,
        err
      );
    }
  });
  const chatArchives = chatArchivesRaw.map((a, i) => {
    try {
      return parseArchivedChat(a);
    } catch (err) {
      throw new BackupParseError(
        `Backup chatArchives[${i}]: ${(err as Error).message}`,
        err
      );
    }
  });
  const revisions = revisionsRaw.map((r, i) => {
    try {
      return parseRevision(r);
    } catch (err) {
      throw new BackupParseError(
        `Backup revisions[${i}]: ${(err as Error).message}`,
        err
      );
    }
  });

  // Cross-record sanity: every comment, revision must belong to this
  // document. Chat messages have no documentId and are accepted as-is.
  for (const c of comments) {
    if (c.documentId !== document.id) {
      throw new BackupParseError(
        `Backup is inconsistent: comment ${c.id} belongs to document "${c.documentId}", not "${document.id}".`
      );
    }
    // Per the Comment contract, the top-level (start, end) mirror the
    // latest round only — older rounds may carry different ranges that
    // were valid at the time. No consistency check beyond that.
    const latest = c.rounds[c.rounds.length - 1];
    if (
      latest &&
      (latest.start !== c.start || latest.end !== c.end)
    ) {
      throw new BackupParseError(
        `Backup is inconsistent: comment ${c.id} top-level range (${c.start}, ${c.end}) does not mirror its latest round (${latest.start}, ${latest.end}).`
      );
    }
  }
  for (const r of revisions) {
    if (r.documentId !== document.id) {
      throw new BackupParseError(
        `Backup is inconsistent: revision ${r.id} belongs to document "${r.documentId}", not "${document.id}".`
      );
    }
  }

  return {
    document,
    comments,
    chats,
    chatArchives,
    revisions,
    meta: {
      schema: BACKUP_SCHEMA,
      version,
      exportedAt,
      appVersion,
    },
  };
}

/**
 * Decide the final id and per-record strategy for a parsed backup
 * given the user's collision choices.
 *
 * `userChoices` maps the incoming `document.id` to one of:
 *   - `'replace'`    — overwrite the local doc with the same id
 *   - `'skip'`       — drop the incoming payload entirely
 *   - `'keep-both'`  — land the incoming doc under a freshly-minted
 *                      id with `${title} (imported)` as the new title
 *
 * The default for a colliding id is `'replace'`; non-colliding ids
 * default to `'keep-both'` (a no-op rename + copy). Callers should
 * only pass a `userChoices` map for ids the user explicitly chose
 * something for; resolveImportDecisions fills in defaults for the rest.
 *
 * Returning an array instead of a map keeps order deterministic —
 * important for the modal's row rendering and for applying plans in
 * sequence when the same import contains multiple documents (future
 * workspace backup).
 *
 * Note: this slice deals with exactly one document (`DocumentBackup`
 * is single-doc). Multi-doc is a workspace backup concern and is out
 * of scope; we still return an array of length one for uniformity.
 */
export function resolveImportDecisions(args: {
  parsed: ParsedDocumentBackup;
  documents: DocumentRecord[];
  userChoices?: Record<string, 'replace' | 'skip' | 'keep-both'>;
}): ImportDecision[] {
  const incomingId = args.parsed.document.id;
  const exists = args.documents.some((d) => d.id === incomingId);
  const explicit = args.userChoices?.[incomingId];

  let strategy: 'replace' | 'skip' | 'keep-both';
  if (explicit) {
    strategy = explicit;
  } else if (exists) {
    strategy = 'replace';
  } else {
    strategy = 'keep-both';
  }

  const documentId =
    strategy === 'keep-both' ? makeNewDocumentId(args.documents) : incomingId;

  return [
    {
      documentId,
      strategy,
      sourceTitle: args.parsed.document.title,
    },
  ];
}

/**
 * Mint a fresh uuid-style id that does not collide with any existing
 * document. Uses the `uuid` package that already powers the rest of
 * the editor (MakeDoc, revisions, comments); retries a few times to
 * dodge the astronomically unlikely uuidv4 collision.
 */
function makeNewDocumentId(existing: DocumentRecord[]): string {
  const ids = new Set(existing.map((d) => d.id));
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = uuid();
    if (!ids.has(candidate)) return candidate;
  }
  return `${uuid()}-${Date.now()}`;
}

/**
 * Build a `DocumentRecord` for a `keep-both` import. The id is
 * caller-supplied (so the matching `comments` / `chats` / `revisions`
 * slices can also be written under it); the title is suffixed
 * `(imported)` and run through `sanitizeFilename` so the new doc
 * matches the rest of the editor's filename/title hygiene rules.
 *
 * The 80-char `sanitizeFilename` cap is applied to the BASE title
 * (without the suffix) so the `(imported)` marker is always visible
 * — without that, a 4 KB source title would eat the marker and the
 * user would lose the visual cue that the doc is the imported copy.
 */
export function buildKeepBothDocument(args: {
  newId: string;
  sourceTitle: string;
  sourceContent: string;
  sourceCreatedAt: number;
  sourceUpdatedAt: number;
}): DocumentRecord {
  const SUFFIX = ' (imported)';
  const baseSafe = sanitizeFilename(args.sourceTitle, '');
  // Reserve room for the suffix. If the sanitised base is already too
  // long to leave room for the suffix, trim it to fit; if it became
  // empty after sanitation, drop the base entirely so we always end
  // up with a usable title.
  const suffixRoom = 80 - SUFFIX.length;
  const trimmedBase =
    baseSafe.length > suffixRoom ? baseSafe.slice(0, suffixRoom) : baseSafe;
  const safeTitle = sanitizeFilename(
    `${trimmedBase}${SUFFIX}`,
    SUFFIX.trim()
  );
  return {
    id: args.newId,
    title: safeTitle,
    content: args.sourceContent,
    createdAt: args.sourceCreatedAt,
    updatedAt: args.sourceUpdatedAt,
  };
}

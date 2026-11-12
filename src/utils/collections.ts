/**
 * Collections — user-defined groups of documents in the Documents
 * sidebar.
 *
 * A collection is a flat, named list of documents. Unlike tags (which
 * are nested paths and also harvested from `#hashtags` in the body),
 * a collection is an explicit, user-owned grouping: it is created,
 * renamed, and deleted by the user, and a document may belong to
 * several collections at once.
 *
 * This module holds the pure logic so the store and the sidebar share
 * one set of rules. It deliberately imports nothing at runtime so the
 * node test script (`scripts/test-collections.mjs`) can bundle it
 * standalone.
 */

import type { DocumentGroup } from '@/types';

/** Longest collection name we keep. Longer names are truncated. */
export const MAX_GROUP_NAME_LENGTH = 60;

/**
 * Normalise a user-typed collection name.
 *
 * Trims, collapses runs of whitespace into single spaces, and caps the
 * length. Returns `null` when nothing usable is left, so callers can
 * treat "blank name" as a rejected create / rename.
 */
export function normalizeGroupName(raw: string | undefined | null): string | null {
  if (typeof raw !== 'string') return null;
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;
  return collapsed.slice(0, MAX_GROUP_NAME_LENGTH);
}

/**
 * Clean a list of collection ids: drop non-strings and blanks, then
 * de-duplicate while keeping the original order.
 */
export function normalizeGroupIds(
  ids: readonly (string | undefined | null)[] | undefined
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids ?? []) {
    if (typeof id !== 'string') continue;
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * Parse an unknown persisted payload into a clean `DocumentGroup[]`.
 *
 * Used on rehydrate: old workspaces have no `documentGroups` at all,
 * and a hand-edited payload can hold anything. Entries without a usable
 * id or name are dropped; duplicate ids keep the first occurrence.
 */
export function sanitizeGroups(value: unknown): DocumentGroup[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: DocumentGroup[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Partial<DocumentGroup>;
    if (typeof entry.id !== 'string') continue;
    const id = entry.id.trim();
    if (!id || seen.has(id)) continue;
    const name = normalizeGroupName(entry.name);
    if (!name) continue;
    seen.add(id);
    out.push({
      id,
      name,
      createdAt:
        typeof entry.createdAt === 'number' && Number.isFinite(entry.createdAt)
          ? entry.createdAt
          : 0,
    });
  }
  return out;
}

/**
 * Sort collections for display: oldest first, then by name so two
 * collections created in the same millisecond keep a stable order.
 */
export function sortGroups(groups: readonly DocumentGroup[]): DocumentGroup[] {
  return [...groups].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.name.localeCompare(b.name);
  });
}

/** Documents that belong to `groupId` (membership is multi-valued). */
export function docsForGroup<T extends { groupIds?: readonly string[] }>(
  docs: readonly T[],
  groupId: string
): T[] {
  return docs.filter((d) => (d.groupIds ?? []).includes(groupId));
}

/** Documents that belong to no collection at all. */
export function ungroupedDocs<T extends { groupIds?: readonly string[] }>(
  docs: readonly T[]
): T[] {
  return docs.filter((d) => (d.groupIds ?? []).length === 0);
}

/**
 * Drop ids that no longer resolve to a known collection. Used when a
 * payload is loaded, so a deleted collection never leaves a dangling
 * membership behind.
 */
export function pruneGroupIds(
  groupIds: readonly (string | undefined | null)[] | undefined,
  knownGroupIds: ReadonlySet<string>
): string[] {
  return normalizeGroupIds(groupIds).filter((id) => knownGroupIds.has(id));
}

/** Is `id` in the collapsed list? */
export function isCollapsed(
  collapsed: readonly string[] | undefined,
  id: string
): boolean {
  return (collapsed ?? []).includes(id);
}

/** Toggle `id` in a collapsed list and return a new array. The list
 * order is preserved so the persisted payload stays stable.
 */
export function toggleCollapsed(
  collapsed: readonly string[] | undefined,
  id: string
): string[] {
  const current = collapsed ?? [];
  return current.includes(id)
    ? current.filter((x) => x !== id)
    : [...current, id];
}

/**
 * Merge the collections carried by a backup into the local list.
 *
 * A collection that already exists locally (same id) is reused as-is;
 * a missing one is created with a fresh id from `newId`. The returned
 * map translates the incoming group ids into the local ones, so an
 * imported document's memberships can be rewritten to match.
 */
export function mergeGroups(
  localGroups: readonly DocumentGroup[],
  incomingGroups: readonly DocumentGroup[],
  newId: () => string
): { groups: DocumentGroup[]; idMap: Map<string, string> } {
  const groups = [...localGroups];
  const idMap = new Map<string, string>();
  const localIds = new Set(groups.map((g) => g.id));
  for (const incoming of incomingGroups) {
    if (localIds.has(incoming.id)) {
      idMap.set(incoming.id, incoming.id);
      continue;
    }
    const id = newId();
    localIds.add(id);
    idMap.set(incoming.id, id);
    groups.push({ id, name: incoming.name, createdAt: incoming.createdAt });
  }
  return { groups, idMap };
}

/**
 * Rewrite collection ids through an id map (see `mergeGroups`). Ids
 * that are not in the map are dropped — they point at a collection the
 * payload never carried.
 */
export function remapGroupIds(
  groupIds: readonly (string | undefined | null)[] | undefined,
  idMap: ReadonlyMap<string, string>
): string[] {
  const out: string[] = [];
  for (const id of normalizeGroupIds(groupIds)) {
    const local = idMap.get(id);
    if (local && !out.includes(local)) out.push(local);
  }
  return out;
}

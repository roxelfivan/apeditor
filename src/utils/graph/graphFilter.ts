// Narrow a compiled workspace graph to a user-chosen scope of
// documents and sections. Pure — no React, no store access — so the
// same pruning runs for the flat map, the globe, and the 3D Concept
// projection, and is assertable from `scripts/test-graph.mjs`.
//
// Filtering happens *before* layout on purpose. `layoutWorkspaceGraph`
// is a pure derivation of `(nodes, edges)`, so a smaller graph simply
// lays out smaller — nothing downstream (fisheye lens, sphere
// projection, three.js scene) has to learn that a filter exists.

import type {
  GraphEdge,
  GraphNode,
  WorkspaceGraph,
} from '@/utils/graph/buildWorkspaceGraph';

/**
 * Synthetic prefix nodes from `Comment > annotate` style titles.
 *
 * They are the one node family the compiler invents rather than reads
 * out of the document, and they carry `kind: 'heading'` with
 * `start === null`, so the id prefix is the only reliable marker.
 */
const HEADING_PATH_PREFIX = 'heading-path:';

/**
 * Sentinel document id meaning "include no documents".
 *
 * Needed because `documentIds` empty already means *every* document
 * (Reset / All). Unticking the last checked document must not collapse
 * into that shorthand, or the graph snaps back to the full workspace.
 */
export const SCOPE_NO_DOCUMENTS = '__graph_scope_none__';

export interface GraphScope {
  /**
   * Documents to include. **Empty means every document**, which makes
   * `{ documentIds: new Set(), sectionIds: new Map() }` both the
   * "show everything" scope and the value Reset restores.
   *
   * A set containing only {@link SCOPE_NO_DOCUMENTS} means include
   * nothing — distinct from the empty-set shorthand.
   */
  documentIds: Set<string>;
  /**
   * `docId -> included heading node ids`.
   *
   * A document with **no entry** keeps all of its sections. A document
   * with an entry keeps exactly those, so an *empty* set means "this
   * document is shown, but none of its sections". The ids are the
   * `heading:<docId>:<start>` nodes `buildWorkspaceGraph` emitted.
   */
  sectionIds: Map<string, Set<string>>;
}

/** A fresh "everything" scope. Never share one — the sets are mutable. */
export function createScope(): GraphScope {
  return { documentIds: new Set(), sectionIds: new Map() };
}

/** A scope that keeps no documents. */
export function createNoneScope(): GraphScope {
  return { documentIds: new Set([SCOPE_NO_DOCUMENTS]), sectionIds: new Map() };
}

/** True when the scope restricts nothing. */
export function isScopeEmpty(scope: GraphScope): boolean {
  return scope.documentIds.size === 0 && scope.sectionIds.size === 0;
}

/** True when the scope explicitly keeps zero documents. */
export function isNoneScope(scope: GraphScope): boolean {
  return (
    scope.documentIds.size === 1 && scope.documentIds.has(SCOPE_NO_DOCUMENTS)
  );
}

/**
 * The documents a scope actually keeps, expanded against the workspace.
 *
 * `filterWorkspaceGraph` does not need this (it tests membership
 * directly), but the filter panel has to render a checkbox per
 * document, and "unchecked" only exists once the empty-is-everything
 * shorthand has been resolved.
 */
export function resolveDocumentIds(
  scope: GraphScope,
  allDocumentIds: readonly string[]
): Set<string> {
  if (isNoneScope(scope)) return new Set();
  if (scope.documentIds.size === 0) return new Set(allDocumentIds);
  return new Set(
    [...scope.documentIds].filter((id) => id !== SCOPE_NO_DOCUMENTS)
  );
}

/**
 * The heading node ids a scope keeps for one document, expanded
 * against that document's real heading nodes.
 */
export function resolveSectionIds(
  scope: GraphScope,
  docId: string,
  allSectionIds: readonly string[]
): Set<string> {
  const only = scope.sectionIds.get(docId);
  if (!only) return new Set(allSectionIds);
  return new Set(only);
}

/**
 * Drop scope entries that restate the default, so "no filter" has one
 * representation. A fully-included document list collapses to the
 * empty set, and a fully-included section list drops its map entry.
 * Without this a panel showing every tick would report a filter as
 * active, and Reset would not look like it took.
 */
export function normalizeScope(
  scope: GraphScope,
  allDocumentIds: readonly string[]
): GraphScope {
  // Preserve the explicit "none" sentinel — stripping it would turn
  // "show nothing" into "show everything".
  if (isNoneScope(scope)) return createNoneScope();

  const documentIds = new Set(
    [...scope.documentIds].filter((id) => id !== SCOPE_NO_DOCUMENTS)
  );
  if (
    documentIds.size === allDocumentIds.length &&
    allDocumentIds.every((id) => documentIds.has(id))
  ) {
    documentIds.clear();
  }
  const sectionIds = new Map<string, Set<string>>();
  for (const [docId, ids] of scope.sectionIds) {
    if (ids.size > 0) sectionIds.set(docId, new Set(ids));
  }
  return { documentIds, sectionIds };
}

function indexByKind(
  nodes: GraphNode[],
  kind: GraphNode['kind']
): Map<string, GraphNode> {
  const out = new Map<string, GraphNode>();
  for (const n of nodes) {
    if (n.kind === kind) out.set(n.id, n);
  }
  return out;
}

function outgoingAdjacency(edges: readonly GraphEdge[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const e of edges) {
    const list = out.get(e.source);
    if (list) list.push(e.target);
    else out.set(e.source, [e.target]);
  }
  return out;
}

/**
 * Prune `graph` down to the nodes `scope` selects.
 *
 * Excluding the current document is allowed — the filter checkbox must
 * match what the graph shows. `layoutWorkspaceGraph` then re-anchors
 * on `docs[0]` among whatever remains, which is the intended reframing
 * when the user drops the page they were editing.
 */
export function filterWorkspaceGraph(
  graph: WorkspaceGraph,
  scope: GraphScope
): WorkspaceGraph {
  // Identity fast path: an empty scope restricts nothing, so the
  // common case allocates nothing and stays bit-identical to the input.
  if (isScopeEmpty(scope)) return graph;

  const documents = indexByKind(graph.nodes, 'document');
  const terms = indexByKind(graph.nodes, 'term');

  const allDocIds = [...documents.values()].map((n) => n.documentId ?? '');
  const includedDocs = resolveDocumentIds(scope, allDocIds);

  const sectionAllowed = (node: GraphNode): boolean => {
    const docId = node.documentId;
    if (docId == null || !includedDocs.has(docId)) return false;
    const only = scope.sectionIds.get(docId);
    if (!only) return true;
    return only.has(node.id);
  };

  // Parent pointers over `heading` edges only. Used to pull the
  // synthetic prefix spine back in when a leaf survives.
  const parentOf = new Map<string, string>();
  for (const e of graph.edges) {
    if (e.kind !== 'heading') continue;
    if (!parentOf.has(e.target)) parentOf.set(e.target, e.source);
  }

  const keep = new Set<string>();
  for (const node of graph.nodes) {
    if (node.kind === 'document') {
      if (includedDocs.has(node.documentId ?? '')) keep.add(node.id);
      continue;
    }
    // `heading-path:` nodes carry `kind: 'heading'` but are decided by
    // their surviving descendants, not by `scope.sectionIds` — the
    // panel never lists them, so a section filter cannot address one.
    if (node.id.startsWith(HEADING_PATH_PREFIX)) continue;
    if (node.kind === 'heading') {
      if (!sectionAllowed(node)) continue;
      keep.add(node.id);
      // Pull back only the synthetic `heading-path:` spine above this
      // heading. A *real* ancestor heading is filtered like any other
      // and must not be dragged in — ticking a `###` under a `##` the
      // user unticked would silently resurrect the parent. The walk
      // stops at the document node, which rule 1 already decided.
      for (let p = parentOf.get(node.id); p != null; p = parentOf.get(p)) {
        if (p.startsWith(HEADING_PATH_PREFIX)) keep.add(p);
        else break;
      }
    }
  }

  // A `[[term]]` has no place in the scope of its own — it belongs to
  // the workspace — but it should not outlive its last reference, or a
  // deselected document leaves its vocabulary floating in the void.
  // Worklist rather than a single pass: a hand-built edge list could
  // chain term to term, and termination is what matters here.
  const outgoing = outgoingAdjacency(graph.edges);
  const queue = [...keep];
  for (let i = 0; i < queue.length; i++) {
    for (const target of outgoing.get(queue[i]) ?? []) {
      if (!terms.has(target) || keep.has(target)) continue;
      keep.add(target);
      queue.push(target);
    }
  }

  return {
    nodes: graph.nodes.filter((n) => keep.has(n.id)),
    edges: graph.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
  };
}
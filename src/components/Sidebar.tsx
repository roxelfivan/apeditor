import { useMemo, useRef, useState } from 'react';
import { useStore } from '@/store/useStore';
import { FileActionsButton } from '@/components/FileActionsButton';
import { ResizeHandle } from '@/components/ResizeHandle';
import {
  useDragResize,
  clamp,
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
} from '@/hooks/useDragResize';
import { useIsNarrow } from '@/hooks/useMediaQuery';
import { buildTagTree, type TagNode } from '@/utils/tags';
import { docsForGroup, sortGroups } from '@/utils/collections';
import { SidebarDocRow } from '@/components/sidebar/SidebarDocRow';
import { SidebarSection } from '@/components/sidebar/SidebarSection';
import { CollectionBranch } from '@/components/sidebar/CollectionBranch';
import type { DocumentRecord } from '@/types';

const RECENT_LIMIT = 10;

/** Ids of the collapsible sections in the sidebar. */
const SECTION_COLLECTIONS = 'collections';
const SECTION_PINNED = 'pinned';
const SECTION_RECENT = 'recent';
const SECTION_TAGS = 'tags';
const SECTION_OTHER = 'other';

const useSidebarWidth = () => {
  const raw = useStore((s) => s.layout.sidebarWidth);
  return clamp(raw, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
};

function matchesQuery(
  doc: DocumentRecord,
  q: string,
  groupNames: readonly string[]
): boolean {
  if (!q) return true;
  const hay = `${doc.title} ${(doc.tags ?? []).join(' ')}`.toLowerCase();
  if (hay.includes(q)) return true;
  // A collection name match pulls the whole collection in.
  return groupNames.some((name) => name.toLowerCase().includes(q));
}

function SidebarTagBranch({
  node,
  depth,
  docsById,
  currentId,
  editingKey,
  draft,
  setDraft,
  setEditingKey,
  onOpen,
  expanded,
  toggleExpanded,
}: {
  node: TagNode;
  depth: number;
  docsById: Map<string, DocumentRecord>;
  currentId: string | null;
  editingKey: string | null;
  draft: string;
  setDraft: (v: string) => void;
  setEditingKey: (key: string | null) => void;
  onOpen: (id: string) => void;
  expanded: Set<string>;
  toggleExpanded: (path: string) => void;
}) {
  const open = expanded.has(node.path);
  const docs = node.docIds
    .map((id) => docsById.get(id))
    .filter((d): d is DocumentRecord => Boolean(d));
  return (
    <div>
      <button
        type="button"
        className="w-full flex items-center gap-1 px-2 py-1 text-left text-[12px] text-paper-inkSoft dark:text-cyber-muted hover:text-cyber-clay dark:hover:text-cyber-cyan"
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => toggleExpanded(node.path)}
        aria-expanded={open}
      >
        <span className="w-3 inline-block">{open ? '▾' : '▸'}</span>
        <span className="truncate">#{node.name}</span>
      </button>
      {open && (
        <ul>
          {docs.map((doc) => (
            <SidebarDocRow
              key={doc.id}
              doc={doc}
              rowKey={`tag:${node.path}:${doc.id}`}
              active={doc.id === currentId}
              isEditing={editingKey === `tag:${node.path}:${doc.id}`}
              draft={draft}
              setDraft={setDraft}
              setEditingKey={setEditingKey}
              onOpen={() => onOpen(doc.id)}
            />
          ))}
          {node.children.map((child) => (
            <li key={child.path} className="list-none">
              <SidebarTagBranch
                node={child}
                depth={depth + 1}
                docsById={docsById}
                currentId={currentId}
                editingKey={editingKey}
                draft={draft}
                setDraft={setDraft}
                setEditingKey={setEditingKey}
                onOpen={onOpen}
                expanded={expanded}
                toggleExpanded={toggleExpanded}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Sidebar() {
  const documents = useStore((s) => s.documents);
  const currentId = useStore((s) => s.currentDocumentId);
  const setCurrentDocument = useStore((s) => s.setCurrentDocument);
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useStore((s) => s.setSidebarCollapsed);
  const width = useSidebarWidth();
  const setLayout = useStore((s) => s.setLayout);
  const expandedTags = useStore((s) => s.layout.sidebarExpandedTags) ?? [];
  const collapsedSections = useStore((s) => s.layout.sidebarCollapsedSections) ?? [];
  const collapsedGroups = useStore((s) => s.layout.sidebarCollapsedGroups) ?? [];
  const documentGroups = useStore((s) => s.documentGroups);
  const createDocumentGroup = useStore((s) => s.createDocumentGroup);
  const isNarrow = useIsNarrow();
  const containerRef = useRef<HTMLDivElement>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [newGroupName, setNewGroupName] = useState<string | null>(null);
  // Strict Mode remounts the new-collection input; that blur must not
  // create a second collection.
  const skipNewGroupBlur = useRef(false);
  const { start } = useDragResize({
    mode: 'axis',
    axis: 'horizontal',
    onDelta: ({ absX }) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const next = clamp(absX - rect.left, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
      setLayout({ sidebarWidth: next });
    },
  });

  const groups = useMemo(() => sortGroups(documentGroups), [documentGroups]);
  const groupNames = useMemo(
    () => groups.map((g) => g.name),
    [groups]
  );

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => documents.filter((d) => matchesQuery(d, q, groupNames)),
    [documents, q, groupNames]
  );
  const docsById = useMemo(
    () => new Map(filtered.map((d) => [d.id, d])),
    [filtered]
  );
  const pinned = filtered.filter((d) => d.starred);
  const recent = useMemo(() => {
    return [...filtered]
      .filter((d) => d.lastOpenedAt > 0)
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
      .slice(0, RECENT_LIMIT);
  }, [filtered]);
  const tagTree = useMemo(() => buildTagTree(filtered), [filtered]);
  const taggedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const d of filtered) {
      if ((d.tags ?? []).length > 0) ids.add(d.id);
    }
    return ids;
  }, [filtered]);
  // The flat section lists the documents that are NOT shown anywhere
  // else — i.e. neither tagged (they live in the tag tree) nor filed
  // in a collection (they live in that collection). With no tags and
  // no collections this is every document, which is the "All" list.
  const restDocs = useMemo(
    () =>
      filtered.filter(
        (d) => !taggedIds.has(d.id) && (d.groupIds ?? []).length === 0
      ),
    [filtered, taggedIds]
  );
  const expanded = useMemo(() => new Set(expandedTags), [expandedTags]);
  const collapsedSectionSet = useMemo(
    () => new Set(collapsedSections),
    [collapsedSections]
  );
  const collapsedGroupSet = useMemo(
    () => new Set(collapsedGroups),
    [collapsedGroups]
  );

  const toggleExpanded = (path: string) => {
    const next = new Set(expandedTags);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setLayout({ sidebarExpandedTags: [...next] });
  };

  const toggleSection = (id: string) => {
    const next = new Set(collapsedSections);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setLayout({ sidebarCollapsedSections: [...next] });
  };

  const toggleGroup = (id: string) => {
    const next = new Set(collapsedGroups);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setLayout({ sidebarCollapsedGroups: [...next] });
  };

  const onOpen = (id: string) => {
    setCurrentDocument(id);
    if (isNarrow) setSidebarCollapsed(true);
  };

  const createGroup = (name: string) => {
    const id = createDocumentGroup(name);
    setNewGroupName(null);
    return id;
  };

  /** Commit the new-collection input (Enter or blur). */
  const commitNewGroup = () => {
    if (skipNewGroupBlur.current) {
      skipNewGroupBlur.current = false;
      return;
    }
    const name = newGroupName ?? '';
    if (name.trim()) createGroup(name);
    else setNewGroupName(null);
  };
  if (sidebarCollapsed) return null;

  const aside = (
    <aside
      className="h-full border-r border-paper-hairline dark:border-cyber-border flex flex-col bg-paper-panel dark:bg-ape-panel"
      style={{ width: '100%' }}
    >
      <div className="px-3 py-2 border-b border-paper-hairline dark:border-cyber-border flex items-center justify-start gap-2 bg-paper-elevated/50 dark:bg-ape-elevated/40">
        <FileActionsButton />
        <span className="text-[15px] font-medium text-paper-ink dark:text-cyber-primary">
          Documents
        </span>
      </div>
      <div className="px-2 py-1.5 border-b border-paper-hairline dark:border-cyber-border">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title, #tag, or collection"
          aria-label="Search documents"
          className="w-full bg-white dark:bg-ape-base border border-paper-hairline dark:border-cyber-border rounded px-2 py-1 text-sm text-paper-ink dark:text-cyber-primary outline-none focus:border-cyber-clay dark:focus:border-cyber-cyan"
        />
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {documents.length === 0 && (
          <p className="px-3 py-4 text-sm text-paper-inkSoft dark:text-cyber-muted">
            No documents yet. Open File → New.
          </p>
        )}
        {documents.length > 0 && filtered.length === 0 && (
          <p className="px-3 py-4 text-sm text-paper-inkSoft dark:text-cyber-muted">
            No matching documents.
          </p>
        )}
        {groups.length > 0 || documents.length > 0 ? (
          <SidebarSection
            id={SECTION_COLLECTIONS}
            label="Collections"
            count={groups.length}
            collapsed={collapsedSectionSet.has(SECTION_COLLECTIONS)}
            onToggle={() => toggleSection(SECTION_COLLECTIONS)}
            action={
              newGroupName === null ? (
                <button
                  type="button"
                  data-new-collection
                  title="New collection"
                  aria-label="New collection"
                  onClick={() => setNewGroupName('')}
                  className="text-paper-inkSoft dark:text-cyber-muted hover:text-cyber-clay dark:hover:text-cyber-cyan text-xs px-1"
                >
                  ＋
                </button>
              ) : (
                <input
                  autoFocus
                  value={newGroupName}
                  placeholder="Collection name"
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onBlur={(e) => {
                    // Strict Mode remounts the input; that blur must
                    // not create the collection.
                    if (!e.currentTarget.isConnected) return;
                    commitNewGroup();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      // Commit directly — waiting for the blur would
                      // lose the collection in browsers that swallow
                      // the focus change.
                      commitNewGroup();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      skipNewGroupBlur.current = true;
                      setNewGroupName(null);
                    }
                  }}
                  className="w-24 bg-white dark:bg-ape-base border border-cyber-clay dark:border-cyber-cyan text-paper-ink dark:text-cyber-primary rounded px-1 text-[11px] outline-none"
                />
              )
            }
          >
            {groups.map((group) => (
              <CollectionBranch
                key={group.id}
                group={group}
                docs={docsForGroup(filtered, group.id)}
                collapsed={collapsedGroupSet.has(group.id)}
                onToggle={() => toggleGroup(group.id)}
                currentId={currentId}
                editingKey={editingKey}
                draft={draft}
                setDraft={setDraft}
                setEditingKey={setEditingKey}
                onOpen={onOpen}
              />
            ))}
          </SidebarSection>
        ) : null}
        {pinned.length > 0 && (
          <SidebarSection
            id={SECTION_PINNED}
            label="Pinned"
            count={pinned.length}
            collapsed={collapsedSectionSet.has(SECTION_PINNED)}
            onToggle={() => toggleSection(SECTION_PINNED)}
          >
            <ul>
              {pinned.map((doc) => (
                <SidebarDocRow
                  key={`pin-${doc.id}`}
                  doc={doc}
                  rowKey={`pin:${doc.id}`}
                  active={doc.id === currentId}
                  isEditing={editingKey === `pin:${doc.id}`}
                  draft={draft}
                  setDraft={setDraft}
                  setEditingKey={setEditingKey}
                  onOpen={() => onOpen(doc.id)}
                  compact
                />
              ))}
            </ul>
          </SidebarSection>
        )}
        {recent.length > 0 && (
          <SidebarSection
            id={SECTION_RECENT}
            label="Recent"
            count={recent.length}
            collapsed={collapsedSectionSet.has(SECTION_RECENT)}
            onToggle={() => toggleSection(SECTION_RECENT)}
          >
            <ul>
              {recent.map((doc) => (
                <SidebarDocRow
                  key={`recent-${doc.id}`}
                  doc={doc}
                  rowKey={`recent:${doc.id}`}
                  active={doc.id === currentId}
                  isEditing={editingKey === `recent:${doc.id}`}
                  draft={draft}
                  setDraft={setDraft}
                  setEditingKey={setEditingKey}
                  onOpen={() => onOpen(doc.id)}
                  compact
                />
              ))}
            </ul>
          </SidebarSection>
        )}
        {tagTree.length > 0 && (
          <SidebarSection
            id={SECTION_TAGS}
            label="Tags"
            collapsed={collapsedSectionSet.has(SECTION_TAGS)}
            onToggle={() => toggleSection(SECTION_TAGS)}
          >
            {tagTree.map((node) => (
              <SidebarTagBranch
                key={node.path}
                node={node}
                depth={0}
                docsById={docsById}
                currentId={currentId}
                editingKey={editingKey}
                draft={draft}
                setDraft={setDraft}
                setEditingKey={setEditingKey}
                onOpen={onOpen}
                expanded={expanded}
                toggleExpanded={toggleExpanded}
              />
            ))}
          </SidebarSection>
        )}
        {restDocs.length > 0 && (
          <SidebarSection
            id={SECTION_OTHER}
            label={tagTree.length > 0 || groups.length > 0 ? 'Other' : 'All'}
            count={restDocs.length}
            collapsed={collapsedSectionSet.has(SECTION_OTHER)}
            onToggle={() => toggleSection(SECTION_OTHER)}
          >
            <ul>
              {restDocs.map((doc) => (
                <SidebarDocRow
                  key={doc.id}
                  doc={doc}
                  rowKey={`all:${doc.id}`}
                  active={doc.id === currentId}
                  isEditing={editingKey === `all:${doc.id}`}
                  draft={draft}
                  setDraft={setDraft}
                  setEditingKey={setEditingKey}
                  onOpen={() => onOpen(doc.id)}
                />
              ))}
            </ul>
          </SidebarSection>
        )}
      </div>
    </aside>
  );

  if (isNarrow) {
    return (
      <div className="fixed inset-0 z-40 flex">
        <button
          type="button"
          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          aria-label="Close documents sidebar"
          onClick={() => setSidebarCollapsed(true)}
        />
        <div
          ref={containerRef}
          className="relative z-10 h-full w-[min(100%,20rem)] max-w-[85vw] shadow-ape-paper-lift dark:shadow-2xl pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
          role="dialog"
          aria-modal="true"
          aria-label="Documents"
        >
          {aside}
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative shrink-0" style={{ width }}>
      {aside}
      <ResizeHandle handle="right" onPointerDown={(e) => start('right', e)} />
    </div>
  );
}

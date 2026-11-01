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
import { buildTagTree, normalizeTagPath, type TagNode } from '@/utils/tags';
import type { DocumentRecord } from '@/types';

const RECENT_LIMIT = 10;

const useSidebarWidth = () => {
  const raw = useStore((s) => s.layout.sidebarWidth);
  return clamp(raw, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
};

function matchesQuery(doc: DocumentRecord, q: string): boolean {
  if (!q) return true;
  const hay = `${doc.title} ${(doc.tags ?? []).join(' ')}`.toLowerCase();
  return hay.includes(q);
}

function SidebarDocRow({
  doc,
  active,
  isEditing,
  draft,
  setDraft,
  setEditingId,
  onOpen,
  compact,
}: {
  doc: DocumentRecord;
  active: boolean;
  isEditing: boolean;
  draft: string;
  setDraft: (v: string) => void;
  setEditingId: (id: string | null) => void;
  onOpen: () => void;
  compact?: boolean;
}) {
  const renameDocument = useStore((s) => s.renameDocument);
  const deleteDocument = useStore((s) => s.deleteDocument);
  const toggleDocumentStarred = useStore((s) => s.toggleDocumentStarred);
  const addDocumentTag = useStore((s) => s.addDocumentTag);
  const removeDocumentTag = useStore((s) => s.removeDocumentTag);
  const [tagDraft, setTagDraft] = useState<string | null>(null);

  const commitRename = () => {
    renameDocument(doc.id, draft || doc.title);
    setEditingId(null);
  };

  return (
    <li
      className={`group flex flex-col mx-1 my-0.5 rounded cursor-pointer border-l-2 transition-colors ${
        active
          ? 'bg-paper-elevated text-cyber-clay dark:bg-ape-elevated dark:text-cyber-cyan border-cyber-clay dark:border-cyber-cyan'
          : 'border-transparent text-paper-ink dark:text-cyber-primary hover:bg-paper-elevated dark:hover:bg-ape-elevated hover:border-paper-hairline dark:hover:border-cyber-border'
      }`}
      onClick={() => {
        if (!isEditing) onOpen();
      }}
    >
      <div className="flex items-center gap-1 px-2 py-1">
        <button
          type="button"
          className={`text-xs px-0.5 ${
            doc.starred
              ? 'text-cyber-clay dark:text-cyber-cyan'
              : 'text-paper-inkSoft dark:text-cyber-muted opacity-100 sm:opacity-0 sm:group-hover:opacity-100'
          }`}
          title={doc.starred ? 'Unpin' : 'Pin / star'}
          onClick={(e) => {
            e.stopPropagation();
            toggleDocumentStarred(doc.id);
          }}
        >
          {doc.starred ? '★' : '☆'}
        </button>
        {isEditing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              else if (e.key === 'Escape') setEditingId(null);
            }}
            className="flex-1 bg-white dark:bg-ape-base border border-cyber-clay dark:border-cyber-cyan text-paper-ink dark:text-cyber-primary rounded px-1 text-sm outline-none focus:border-cyber-clay dark:focus:shadow-ape-glow-soft"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="flex-1 truncate text-sm"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditingId(doc.id);
              setDraft(doc.title);
            }}
          >
            {doc.title || 'Untitled'}
          </span>
        )}
        <div className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 flex items-center gap-0.5">
          <button
            className="text-paper-inkSoft dark:text-cyber-muted hover:text-cyber-clay dark:hover:text-cyber-cyan text-xs px-1"
            title="Add tag"
            onClick={(e) => {
              e.stopPropagation();
              setTagDraft('');
            }}
          >
            #
          </button>
          <button
            className="text-paper-inkSoft dark:text-cyber-muted hover:text-cyber-clay dark:hover:text-cyber-cyan text-xs px-1"
            title="Rename"
            onClick={(e) => {
              e.stopPropagation();
              setEditingId(doc.id);
              setDraft(doc.title);
            }}
          >
            ✎
          </button>
          <button
            className="text-paper-inkSoft dark:text-cyber-muted hover:text-cyber-danger text-xs px-1"
            title="Delete"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Delete "${doc.title}"?`)) {
                deleteDocument(doc.id);
              }
            }}
          >
            ×
          </button>
        </div>
      </div>
      {!compact && (doc.tags?.length > 0 || tagDraft !== null) && (
        <div
          className="flex flex-wrap gap-1 px-2 pb-1.5 pl-7"
          onClick={(e) => e.stopPropagation()}
        >
          {(doc.tags ?? []).map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-0.5 max-w-full text-[10px] px-1 py-0 rounded bg-paper-elevated dark:bg-ape-elevated text-paper-inkSoft dark:text-cyber-muted"
              title={`#${tag}`}
            >
              <span className="truncate">#{tag}</span>
              <button
                type="button"
                className="hover:text-cyber-danger"
                aria-label={`Remove tag ${tag}`}
                onClick={() => removeDocumentTag(doc.id, tag)}
              >
                ×
              </button>
            </span>
          ))}
          {tagDraft !== null && (
            <input
              autoFocus
              value={tagDraft}
              placeholder="drafts/essays"
              className="w-28 bg-white dark:bg-ape-base border border-paper-hairline dark:border-cyber-border rounded px-1 text-[10px] outline-none"
              onChange={(e) => setTagDraft(e.target.value)}
              onBlur={() => {
                const n = normalizeTagPath(tagDraft);
                if (n) addDocumentTag(doc.id, n);
                setTagDraft(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const n = normalizeTagPath(tagDraft);
                  if (n) addDocumentTag(doc.id, n);
                  setTagDraft(null);
                } else if (e.key === 'Escape') {
                  setTagDraft(null);
                }
              }}
            />
          )}
        </div>
      )}
    </li>
  );
}

function TagBranch({
  node,
  depth,
  docsById,
  currentId,
  editingId,
  draft,
  setDraft,
  setEditingId,
  onOpen,
  expanded,
  toggleExpanded,
}: {
  node: TagNode;
  depth: number;
  docsById: Map<string, DocumentRecord>;
  currentId: string | null;
  editingId: string | null;
  draft: string;
  setDraft: (v: string) => void;
  setEditingId: (id: string | null) => void;
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
              active={doc.id === currentId}
              isEditing={editingId === doc.id}
              draft={draft}
              setDraft={setDraft}
              setEditingId={setEditingId}
              onOpen={() => onOpen(doc.id)}
            />
          ))}
          {node.children.map((child) => (
            <li key={child.path} className="list-none">
              <TagBranch
                node={child}
                depth={depth + 1}
                docsById={docsById}
                currentId={currentId}
                editingId={editingId}
                draft={draft}
                setDraft={setDraft}
                setEditingId={setEditingId}
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
  const isNarrow = useIsNarrow();
  const containerRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
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

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => documents.filter((d) => matchesQuery(d, q)),
    [documents, q]
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
  const untagged = filtered.filter((d) => !taggedIds.has(d.id));
  const expanded = useMemo(() => new Set(expandedTags), [expandedTags]);

  const toggleExpanded = (path: string) => {
    const next = new Set(expandedTags);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setLayout({ sidebarExpandedTags: [...next] });
  };

  const onOpen = (id: string) => {
    setCurrentDocument(id);
    if (isNarrow) setSidebarCollapsed(true);
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
          placeholder="Search title or #tag"
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
        {pinned.length > 0 && (
          <section className="mb-2">
            <h3 className="px-3 py-1 text-[11px] uppercase tracking-wide text-paper-inkSoft dark:text-cyber-muted">
              Pinned
            </h3>
            <ul>
              {pinned.map((doc) => (
                <SidebarDocRow
                  key={`pin-${doc.id}`}
                  doc={doc}
                  active={doc.id === currentId}
                  isEditing={editingId === doc.id}
                  draft={draft}
                  setDraft={setDraft}
                  setEditingId={setEditingId}
                  onOpen={() => onOpen(doc.id)}
                  compact
                />
              ))}
            </ul>
          </section>
        )}
        {recent.length > 0 && (
          <section className="mb-2">
            <h3 className="px-3 py-1 text-[11px] uppercase tracking-wide text-paper-inkSoft dark:text-cyber-muted">
              Recent
            </h3>
            <ul>
              {recent.map((doc) => (
                <SidebarDocRow
                  key={`recent-${doc.id}`}
                  doc={doc}
                  active={doc.id === currentId}
                  isEditing={editingId === doc.id}
                  draft={draft}
                  setDraft={setDraft}
                  setEditingId={setEditingId}
                  onOpen={() => onOpen(doc.id)}
                  compact
                />
              ))}
            </ul>
          </section>
        )}
        {tagTree.length > 0 && (
          <section className="mb-2">
            <h3 className="px-3 py-1 text-[11px] uppercase tracking-wide text-paper-inkSoft dark:text-cyber-muted">
              Tags
            </h3>
            {tagTree.map((node) => (
              <TagBranch
                key={node.path}
                node={node}
                depth={0}
                docsById={docsById}
                currentId={currentId}
                editingId={editingId}
                draft={draft}
                setDraft={setDraft}
                setEditingId={setEditingId}
                onOpen={onOpen}
                expanded={expanded}
                toggleExpanded={toggleExpanded}
              />
            ))}
          </section>
        )}
        {untagged.length > 0 && (
          <section className="mb-2">
            <h3 className="px-3 py-1 text-[11px] uppercase tracking-wide text-paper-inkSoft dark:text-cyber-muted">
              {tagTree.length > 0 ? 'Untagged' : 'All'}
            </h3>
            <ul>
              {untagged.map((doc) => (
                <SidebarDocRow
                  key={doc.id}
                  doc={doc}
                  active={doc.id === currentId}
                  isEditing={editingId === doc.id}
                  draft={draft}
                  setDraft={setDraft}
                  setEditingId={setEditingId}
                  onOpen={() => onOpen(doc.id)}
                />
              ))}
            </ul>
          </section>
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

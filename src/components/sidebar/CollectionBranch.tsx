import { useRef } from 'react';
import { useStore } from '@/store/useStore';
import type { DocumentGroup, DocumentRecord } from '@/types';
import { SidebarDocRow } from '@/components/sidebar/SidebarDocRow';

/**
 * One collection (folder) in the Documents sidebar.
 *
 * The header toggles the collection open / closed and carries the
 * rename + delete actions. The documents inside are rendered with the
 * shared `SidebarDocRow`, so a document can appear in several
 * collections at once — each one lists it independently.
 */
export function CollectionBranch({
  group,
  docs,
  collapsed,
  onToggle,
  currentId,
  editingKey,
  draft,
  setDraft,
  setEditingKey,
  onOpen,
}: {
  group: DocumentGroup;
  docs: DocumentRecord[];
  collapsed: boolean;
  onToggle: () => void;
  currentId: string | null;
  editingKey: string | null;
  draft: string;
  setDraft: (v: string) => void;
  setEditingKey: (key: string | null) => void;
  onOpen: (id: string) => void;
}) {
  const renameDocumentGroup = useStore((s) => s.renameDocumentGroup);
  const deleteDocumentGroup = useStore((s) => s.deleteDocumentGroup);
  const skipBlurCommit = useRef(false);
  const rowKey = `group:${group.id}`;
  const isEditing = editingKey === rowKey;

  const startRename = () => {
    skipBlurCommit.current = false;
    setDraft(group.name);
    setEditingKey(rowKey);
  };

  const commitRename = (value: string) => {
    renameDocumentGroup(group.id, value || group.name);
    setEditingKey(null);
  };

  const onDelete = () => {
    if (!confirm(`Delete the collection "${group.name}"?`)) return;
    deleteDocumentGroup(group.id);
  };

  return (
    <div className="mb-0.5" data-collection={group.id}>
      <div
        className={`group flex items-center gap-1 mx-1 rounded px-1 py-0.5 transition-colors hover:bg-paper-elevated dark:hover:bg-ape-elevated ${
          collapsed ? '' : 'bg-paper-elevated/40 dark:bg-ape-elevated/40'
        }`}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand ${group.name}` : `Collapse ${group.name}`}
          title={collapsed ? 'Expand collection' : 'Collapse collection'}
          className="shrink-0 w-3 text-left text-paper-inkSoft dark:text-cyber-muted hover:text-cyber-clay dark:hover:text-cyber-cyan"
        >
          {collapsed ? '▸' : '▾'}
        </button>
        <span aria-hidden className="shrink-0">
          📁
        </span>
        {isEditing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => {
              // Strict Mode remounts the input; that blur must not save/exit.
              if (!e.currentTarget.isConnected) return;
              if (skipBlurCommit.current) {
                skipBlurCommit.current = false;
                return;
              }
              commitRename(e.currentTarget.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                // Commit directly — waiting for the blur would lose the
                // rename in browsers that swallow the focus change.
                commitRename(e.currentTarget.value);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                skipBlurCommit.current = true;
                setEditingKey(null);
              }
            }}
            className="flex-1 min-w-0 bg-white dark:bg-ape-base border border-cyber-clay dark:border-cyber-cyan text-paper-ink dark:text-cyber-primary rounded px-1 text-[12px] outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={onToggle}
            title={group.name}
            className="flex-1 min-w-0 truncate text-left text-[12px] text-paper-ink dark:text-cyber-primary hover:text-cyber-clay dark:hover:text-cyber-cyan"
          >
            {group.name}
          </button>
        )}
        <span className="text-[10px] text-paper-inkSoft dark:text-cyber-muted shrink-0">
          ({docs.length})
        </span>
        {!isEditing && (
          <div
            className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 flex items-center gap-0.5 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="text-paper-inkSoft dark:text-cyber-muted hover:text-cyber-clay dark:hover:text-cyber-cyan text-xs px-1"
              title="Rename collection"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                startRename();
              }}
            >
              ✎
            </button>
            <button
              type="button"
              className="text-paper-inkSoft dark:text-cyber-muted hover:text-cyber-danger text-xs px-1"
              title="Delete collection"
              onClick={onDelete}
            >
              ×
            </button>
          </div>
        )}
      </div>
      {!collapsed && docs.length > 0 && (
        <ul>
          {docs.map((doc) => (
            <SidebarDocRow
              key={`group-${group.id}-${doc.id}`}
              doc={doc}
              rowKey={`group:${group.id}:${doc.id}`}
              active={doc.id === currentId}
              isEditing={editingKey === `group:${group.id}:${doc.id}`}
              draft={draft}
              setDraft={setDraft}
              setEditingKey={setEditingKey}
              onOpen={() => onOpen(doc.id)}
            />
          ))}
        </ul>
      )}
      {!collapsed && docs.length === 0 && (
        <p className="mx-1 mb-0.5 pl-6 text-[11px] text-paper-inkSoft dark:text-cyber-muted italic">
          Empty
        </p>
      )}
    </div>
  );
}

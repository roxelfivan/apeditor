import { useRef, useState } from 'react';
import { useStore } from '@/store/useStore';
import { normalizeTagPath } from '@/utils/tags';
import { CollectionPicker } from '@/components/sidebar/CollectionPicker';
import type { DocumentRecord } from '@/types';

/**
 * One document row in the Documents sidebar.
 *
 * The same row renders in every section (Collections, Pinned, Recent,
 * Tags, Ungrouped), so the caller must pass a `rowKey` that is unique
 * across all of them — it keys the rename input, which only one row may
 * own at a time.
 */
export function SidebarDocRow({
  doc,
  rowKey,
  active,
  isEditing,
  draft,
  setDraft,
  setEditingKey,
  onOpen,
  compact,
}: {
  doc: DocumentRecord;
  /** Unique among every row that can render this document (Pinned + Recent + All). */
  rowKey: string;
  active: boolean;
  isEditing: boolean;
  draft: string;
  setDraft: (v: string) => void;
  setEditingKey: (key: string | null) => void;
  onOpen: () => void;
  compact?: boolean;
}) {
  const renameDocument = useStore((s) => s.renameDocument);
  const deleteDocument = useStore((s) => s.deleteDocument);
  const toggleDocumentStarred = useStore((s) => s.toggleDocumentStarred);
  const addDocumentTag = useStore((s) => s.addDocumentTag);
  const removeDocumentTag = useStore((s) => s.removeDocumentTag);
  const [tagDraft, setTagDraft] = useState<string | null>(null);
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);
  const skipBlurCommit = useRef(false);

  const startRename = () => {
    skipBlurCommit.current = false;
    setDraft(doc.title);
    setEditingKey(rowKey);
  };

  const commitRename = (value: string) => {
    if (skipBlurCommit.current) {
      skipBlurCommit.current = false;
      return;
    }
    renameDocument(doc.id, value || doc.title);
    setEditingKey(null);
  };

  const stopRowActivate = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
  };

  return (
    <li
      className={`group flex flex-col mx-1 my-0.5 rounded cursor-pointer border-l-2 transition-colors ${
        active
          ? 'bg-paper-elevated text-cyber-clay dark:bg-ape-elevated dark:text-cyber-cyan border-cyber-clay dark:border-cyber-cyan'
          : 'border-transparent text-paper-ink dark:text-cyber-primary hover:bg-paper-elevated dark:hover:bg-ape-elevated hover:border-paper-hairline dark:hover:border-cyber-border'
      }`}
      onClick={(e) => {
        if (isEditing) return;
        const target = e.target as HTMLElement | null;
        if (target?.closest('button, input, [data-row-action]')) return;
        onOpen();
      }}
    >
      <div className="flex items-center gap-1 px-2 py-1">
        <button
          type="button"
          data-row-action
          className={`text-xs px-0.5 ${
            doc.starred
              ? 'text-cyber-clay dark:text-cyber-cyan'
              : 'text-paper-inkSoft dark:text-cyber-muted opacity-100 sm:opacity-0 sm:group-hover:opacity-100'
          }`}
          title={doc.starred ? 'Unpin' : 'Pin / star'}
          onPointerDown={stopRowActivate}
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
            onBlur={(e) => {
              // Strict Mode remounts the input; that blur must not save/exit.
              if (!e.currentTarget.isConnected) return;
              commitRename(e.currentTarget.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                skipBlurCommit.current = true;
                setEditingKey(null);
              }
            }}
            className="flex-1 bg-white dark:bg-ape-base border border-cyber-clay dark:border-cyber-cyan text-paper-ink dark:text-cyber-primary rounded px-1 text-sm outline-none focus:border-cyber-clay dark:focus:shadow-ape-glow-soft"
            onPointerDown={stopRowActivate}
            onClick={stopRowActivate}
          />
        ) : (
          <span
            className="flex-1 truncate text-sm"
            onDoubleClick={(e) => {
              e.stopPropagation();
              startRename();
            }}
          >
            {doc.title || 'Untitled'}
          </span>
        )}
        <div
          data-row-action
          className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 flex items-center gap-0.5"
          onPointerDown={stopRowActivate}
          onClick={stopRowActivate}
        >
          <button
            type="button"
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
            type="button"
            data-collection-toggle
            className={`text-xs px-1 ${
              (doc.groupIds ?? []).length > 0
                ? 'text-cyber-clay dark:text-cyber-cyan'
                : 'text-paper-inkSoft dark:text-cyber-muted hover:text-cyber-clay dark:hover:text-cyber-cyan'
            }`}
            title="Collections"
            onClick={(e) => {
              e.stopPropagation();
              setPickerAnchor((a) => (a ? null : e.currentTarget));
            }}
          >
            📁
          </button>
          <button
            type="button"
            className="text-paper-inkSoft dark:text-cyber-muted hover:text-cyber-clay dark:hover:text-cyber-cyan text-xs px-1"
            title="Rename"
            onPointerDown={(e) => {
              // pointerdown so the row's click-to-open never runs, and so
              // a single click is enough (no double-click needed).
              e.preventDefault();
              e.stopPropagation();
              startRename();
            }}
            onClick={stopRowActivate}
          >
            ✎
          </button>
          <button
            type="button"
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
      {pickerAnchor && (
        <CollectionPicker
          docId={doc.id}
          anchor={pickerAnchor}
          onClose={() => setPickerAnchor(null)}
        />
      )}
    </li>
  );
}

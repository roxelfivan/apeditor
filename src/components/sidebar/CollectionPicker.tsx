import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@/store/useStore';
import { normalizeGroupName } from '@/utils/collections';

const PANEL_WIDTH = 208;
const VIEWPORT_PAD = 8;
const PANEL_MAX_HEIGHT = 260;

/**
 * Popover that assigns a document to one or more collections.
 *
 * Rendered through a portal in `document.body` and positioned with
 * `position: fixed`, so it is never clipped by the sidebar's scroll
 * container. Membership is multi-valued: every checkbox is independent
 * and the change is applied immediately.
 */
export function CollectionPicker({
  docId,
  anchor,
  onClose,
}: {
  /** Document whose membership is being edited. */
  docId: string;
  /** Element the popover is anchored to (the row's collection button). */
  anchor: HTMLElement | null;
  onClose: () => void;
}) {
  const documentGroups = useStore((s) => s.documentGroups);
  const documents = useStore((s) => s.documents);
  const setDocumentGroups = useStore((s) => s.setDocumentGroups);
  const createDocumentGroup = useStore((s) => s.createDocumentGroup);
  const panelRef = useRef<HTMLDivElement>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const doc = useMemo(
    () => documents.find((d) => d.id === docId) ?? null,
    [documents, docId]
  );
  const memberIds = useMemo(() => new Set(doc?.groupIds ?? []), [doc]);

  // Position the panel next to the anchor. Prefer the right side
  // (the sidebar sits on the far left), fall back to the left, then
  // clamp so the panel never spills off-screen.
  useEffect(() => {
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(PANEL_WIDTH, Math.max(0, vw - VIEWPORT_PAD * 2));
    let left = rect.right + 4;
    if (left + width > vw - VIEWPORT_PAD) {
      left = rect.left - width - 4;
    }
    left = Math.max(VIEWPORT_PAD, Math.min(left, vw - VIEWPORT_PAD - width));
    let top = rect.top;
    if (top + PANEL_MAX_HEIGHT > vh - VIEWPORT_PAD) {
      top = Math.max(VIEWPORT_PAD, vh - VIEWPORT_PAD - PANEL_MAX_HEIGHT);
    }
    setPos({ left, top });
  }, [anchor]);

  // Close on an outside click. Clicks inside the panel (or on the
  // anchor itself) are ignored.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (anchor?.contains(target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [anchor, onClose]);

  const toggle = (groupId: string) => {
    if (!doc) return;
    const next = memberIds.has(groupId)
      ? (doc.groupIds ?? []).filter((id) => id !== groupId)
      : [...(doc.groupIds ?? []), groupId];
    setDocumentGroups(doc.id, next);
  };

  const createAndAssign = () => {
    const clean = normalizeGroupName(newName);
    if (!clean || !doc) return;
    const id = createDocumentGroup(clean);
    if (!id) return;
    setDocumentGroups(doc.id, [...(doc.groupIds ?? []), id]);
    setNewName(null);
  };
  const panel = (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Collections"
      style={{
        position: 'fixed',
        left: pos?.left ?? VIEWPORT_PAD,
        top: pos?.top ?? VIEWPORT_PAD,
        width: PANEL_WIDTH,
      }}
      className="z-50 rounded border border-paper-hairline dark:border-cyber-border bg-paper-surface dark:bg-ape-panel shadow-ape-paper-lift dark:shadow-lg p-1.5 text-xs box-border"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-1 py-0.5 text-[11px] uppercase tracking-wide text-paper-inkSoft dark:text-cyber-muted">
        Collections
      </div>
      <div className="max-h-52 overflow-y-auto">
        {documentGroups.length === 0 && (
          <p className="px-1 py-1.5 text-[11px] text-paper-inkSoft dark:text-cyber-muted">
            No collections yet. Create one below.
          </p>
        )}
        {documentGroups.map((group) => (
          <label
            key={group.id}
            className="flex items-center gap-2 px-1 py-1 cursor-pointer select-none rounded hover:bg-paper-elevated dark:hover:bg-ape-elevated text-paper-ink dark:text-cyber-primary"
          >
            <input
              type="checkbox"
              checked={memberIds.has(group.id)}
              onChange={() => toggle(group.id)}
              className="accent-cyber-clay dark:accent-cyber-cyan"
            />
            <span className="truncate">{group.name}</span>
          </label>
        ))}
      </div>
      <div className="mt-1 border-t border-paper-hairline dark:border-cyber-border pt-1">
        {newName === null ? (
          <button
            type="button"
            className="w-full text-left px-1 py-1 rounded hover:bg-paper-elevated dark:hover:bg-ape-elevated text-cyber-clay dark:hover:text-cyber-cyan"
            onClick={() => setNewName('')}
          >
            + New collection
          </button>
        ) : (
          <input
            autoFocus
            value={newName}
            placeholder="Collection name"
            onChange={(e) => setNewName(e.target.value)}
            onBlur={() => {
              createAndAssign();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                createAndAssign();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setNewName(null);
              }
            }}            className="w-full bg-white dark:bg-ape-base border border-paper-hairline dark:border-cyber-border rounded px-1 py-0.5 text-paper-ink dark:text-cyber-primary outline-none focus:border-cyber-clay dark:focus:border-cyber-cyan"
          />
        )}
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}

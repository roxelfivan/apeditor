import { useMemo, useState } from 'react';
import { useStore, useCurrentDocument } from '@/store/useStore';
import { ProposedEditCard } from '@/components/ProposedEditCard';
import { applyAllEdits } from '@/utils/proposedEdit';

/**
 * Session overlay for document compare. Lists proposed edits produced
 * from a two-file redline so the author can Apply / Skip / Apply all
 * using the same waterfall as chat cards.
 */
export function CompareReviewPanel() {
  const session = useStore((s) => s.compareSession);
  const setCompareSession = useStore((s) => s.setCompareSession);
  const doc = useCurrentDocument();
  const saveRevision = useStore((s) => s.saveRevision);
  const updateContent = useStore((s) => s.updateDocumentContent);
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set());

  const remaining = useMemo(() => {
    if (!session) return [];
    return session.edits.filter((e) => !skipped.has(e.id));
  }, [session, skipped]);

  if (!session || !doc) return null;

  const applyAll = () => {
    if (remaining.length === 0) return;
    if (!doc.content && remaining.length === 1 && remaining[0].original === '') {
      saveRevision(doc.id, 'Before compare');
      updateContent(doc.id, remaining[0].replacement);
      setCompareSession(null);
      return;
    }
    const { next, appliedIds } = applyAllEdits(doc.content, remaining);
    if (appliedIds.length === 0) return;
    saveRevision(doc.id, 'Before compare');
    updateContent(doc.id, next);
    const applied = new Set(appliedIds);
    const leftover = remaining.filter((e) => !applied.has(e.id));
    if (leftover.length === 0) setCompareSession(null);
    else {
      setSkipped((prev) => {
        const nextSet = new Set(prev);
        for (const id of appliedIds) nextSet.add(id);
        return nextSet;
      });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Document compare"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        aria-label="Close compare"
        onClick={() => setCompareSession(null)}
      />
      <div className="relative z-10 h-full w-full max-w-md bg-paper-panel dark:bg-ape-panel border-l border-paper-hairline dark:border-cyber-border shadow-ape-paper-lift dark:shadow-2xl flex flex-col">
        <div className="px-3 py-2 border-b border-paper-hairline dark:border-cyber-border flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-medium text-paper-ink dark:text-cyber-primary">
              Compare
            </div>
            <p className="text-[12px] text-paper-inkSoft dark:text-cyber-muted leading-snug">
              Suggested edits to bring this document in line with{' '}
              <span className="text-paper-ink dark:text-cyber-primary">
                {session.sourceLabel}
              </span>
              . Apply each like a chat proposal.
            </p>
            {session.skippedHunks > 0 && (
              <p className="text-[11px] text-cyber-warn mt-1">
                {session.skippedHunks} hunk
                {session.skippedHunks === 1 ? '' : 's'} could not be
                turned into a unique original span.
              </p>
            )}
          </div>
          <button
            type="button"
            className="btn-ghost-sm shrink-0"
            onClick={() => setCompareSession(null)}
          >
            Close
          </button>
        </div>
        <div className="px-3 py-2 border-b border-paper-hairline dark:border-cyber-border flex items-center gap-2">
          <button
            type="button"
            className="btn-fire-sm"
            disabled={remaining.length === 0}
            onClick={applyAll}
          >
            Apply all ({remaining.length})
          </button>
          <span className="text-[11px] text-paper-inkSoft dark:text-cyber-muted">
            {session.edits.length} change
            {session.edits.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {remaining.length === 0 ? (
            <p className="text-sm text-paper-inkSoft dark:text-cyber-muted">
              {session.edits.length === 0
                ? 'The two documents are identical.'
                : 'Every remaining change was skipped or applied.'}
            </p>
          ) : (
            remaining.map((edit) => (
              <ProposedEditCard
                key={edit.id}
                edit={edit}
                docId={doc.id}
                messageId="compare"
                dismissOnly
                onDismiss={(id) =>
                  setSkipped((prev) => new Set(prev).add(id))
                }
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

import type { ReactNode } from 'react';

/**
 * A collapsible section in the Documents sidebar.
 *
 * Every section header toggles open / closed; the parent owns the
 * collapsed state (persisted in `layout.sidebarCollapsedSections`).
 */
export function SidebarSection({
  id,
  label,
  count,
  collapsed,
  onToggle,
  action,
  children,
}: {
  /** Stable section id — also the key used in the collapsed list. */
  id: string;
  label: string;
  /** Optional count badge (documents in the section). */
  count?: number;
  collapsed: boolean;
  onToggle: () => void;
  /** Trailing action rendered on the right of the header (e.g. "+"). */
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="mb-2" data-section={id}>
      <div className="flex items-center gap-1 px-2 py-1">
        <button
          type="button"
          data-section-toggle={id}
          onClick={onToggle}
          aria-expanded={!collapsed}
          title={collapsed ? `Expand ${label}` : `Collapse ${label}`}
          className="flex-1 min-w-0 flex items-center gap-1 text-left text-[11px] uppercase tracking-wide text-paper-inkSoft dark:text-cyber-muted hover:text-cyber-clay dark:hover:text-cyber-cyan"
        >
          <span className="w-3 inline-block shrink-0">
            {collapsed ? '▸' : '▾'}
          </span>
          <span className="truncate">{label}</span>
          {typeof count === 'number' && (
            <span className="text-[10px] opacity-70">({count})</span>
          )}
        </button>
        {action}
      </div>
      {!collapsed && children}
    </section>
  );
}

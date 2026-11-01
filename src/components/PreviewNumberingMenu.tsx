import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '@/store/useStore';
import type { OutlineScheme } from '@/utils/outlineNumbering';

const MENU_ITEM =
  'w-full text-left px-3 py-1.5 text-[13px] text-paper-ink dark:text-cyber-primary hover:bg-paper-elevated dark:hover:bg-ape-elevated hover:text-cyber-clay dark:hover:text-cyber-cyan transition-colors';

/**
 * Compact Preview toolbar control: one icon opens line-number and
 * heading-outline options. `fixed` menu so the toolbar scroller cannot
 * clip it (same reason as the Format dropdown).
 */
export function PreviewNumberingMenu() {
  const previewLineNumbers = useStore((s) => s.layout.previewLineNumbers) === true;
  const outlineNumbering =
    (useStore((s) => s.layout.outlineNumbering) as OutlineScheme | undefined) ??
    'off';
  const setLayout = useStore((s) => s.setLayout);
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const active = previewLineNumbers || outlineNumbering !== 'off';

  useEffect(() => {
    if (!open) return;
    const handler = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-preview-numbering-menu]')) return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', handler);
    return () => window.removeEventListener('pointerdown', handler);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const anchor = btnRef.current;
    if (!panel || !anchor) return;
    const apply = () => {
      const pad = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const ar = anchor.getBoundingClientRect();
      const w = panel.offsetWidth;
      const h = panel.offsetHeight;
      let left = ar.left;
      if (left + w > vw - pad) left = vw - pad - w;
      if (left < pad) left = pad;
      let top = ar.bottom + 4;
      if (top + h > vh - pad) {
        const above = ar.top - 4 - h;
        top = above >= pad ? above : Math.max(pad, vh - pad - h);
      }
      panel.style.position = 'fixed';
      panel.style.left = `${Math.round(left)}px`;
      panel.style.top = `${Math.round(top)}px`;
    };
    apply();
    window.addEventListener('resize', apply);
    window.addEventListener('scroll', apply, true);
    return () => {
      window.removeEventListener('resize', apply);
      window.removeEventListener('scroll', apply, true);
    };
  }, [open]);

  const setOutline = (scheme: OutlineScheme) => {
    setLayout({ outlineNumbering: scheme });
  };

  return (
    <div data-preview-numbering-menu className="relative inline-flex shrink-0">
      <button
        type="button"
        ref={btnRef}
        className={`btn-icon-square ${
          active ? 'border-cyber-clay dark:border-cyber-cyan' : ''
        }`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Preview numbering"
        title="Line numbers and heading outline"
        onClick={() => setOpen((v) => !v)}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6.5 3.5 H13.5" />
          <path d="M6.5 8 H13.5" />
          <path d="M6.5 12.5 H13.5" />
          <path d="M3 3.5 H4" />
          <path d="M3 8 H4" />
          <path d="M3 12.5 H4" />
        </svg>
      </button>
      {open && (
        <div
          ref={panelRef}
          role="menu"
          aria-label="Preview numbering"
          className="fixed z-50 min-w-[200px] rounded border border-paper-hairline dark:border-cyber-border bg-paper-surface dark:bg-ape-panel shadow-lg py-1"
        >
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={previewLineNumbers}
            className={MENU_ITEM}
            onClick={() => setLayout({ previewLineNumbers: !previewLineNumbers })}
          >
            {previewLineNumbers ? '✓ ' : ''}Line numbers
          </button>
          <div
            className="my-1 border-t border-paper-hairline dark:border-cyber-border"
            aria-hidden
          />
          <div className="px-3 pt-1 pb-0.5 text-[11px] uppercase tracking-wide text-paper-inkSoft dark:text-cyber-muted">
            Outline
          </div>
          {(
            [
              ['off', 'Off'],
              ['decimal', '1 / 1.1 / 1.1.1'],
              ['legal', 'Article / Section'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              aria-checked={outlineNumbering === value}
              className={MENU_ITEM}
              onClick={() => setOutline(value)}
            >
              {outlineNumbering === value ? '✓ ' : ''}
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

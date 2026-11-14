import type { ReactNode } from 'react';
import { useStore } from '@/store/useStore';

type Pane = 'docs' | 'editor' | 'chat';

/**
 * Phone / landscape-phone workspace switcher. Replaces the slim
 * left/right edge chevrons (easy to miss, easy to miss-tap) with a
 * labeled 44 px tab bar that stays above the home indicator.
 *
 * Documents and Chat still open as overlays; Editor is the default
 * pane with both overlays closed. Only one overlay is open at a time
 * (same rule as the edge-anchor handlers in App.tsx).
 */
export function MobileBottomNav() {
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useStore((s) => s.setSidebarCollapsed);
  const chatCollapsed = useStore((s) => s.chatCollapsed);
  const setChatCollapsed = useStore((s) => s.setChatCollapsed);
  const setChatOpen = useStore((s) => s.setChatOpen);

  const pane: Pane = !sidebarCollapsed
    ? 'docs'
    : !chatCollapsed
      ? 'chat'
      : 'editor';

  const go = (next: Pane) => {
    if (next === 'docs') {
      setChatCollapsed(true);
      setChatOpen(false);
      setSidebarCollapsed(false);
      return;
    }
    if (next === 'chat') {
      setSidebarCollapsed(true);
      setChatOpen(true);
      setChatCollapsed(false);
      return;
    }
    setSidebarCollapsed(true);
    setChatCollapsed(true);
    setChatOpen(false);
  };

  const tabs: Array<{
    id: Pane;
    label: string;
    icon: ReactNode;
  }> = [
    {
      id: 'docs',
      label: 'Documents',
      icon: (
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3.5 5.5 H8 L9.5 7.5 H16.5 V15.5 H3.5 Z" />
        </svg>
      ),
    },
    {
      id: 'editor',
      label: 'Editor',
      icon: (
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 3.5 H12 L15.5 7 V16.5 H5 Z" />
          <path d="M12 3.5 V7 H15.5" />
          <path d="M7.5 10.5 H12.5 M7.5 13.5 H11" />
        </svg>
      ),
    },
    {
      id: 'chat',
      label: 'Chat',
      icon: (
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 4.5 H16 A1.5 1.5 0 0 1 17.5 6 V12 A1.5 1.5 0 0 1 16 13.5 H9 L5.5 16.5 V13.5 H4 A1.5 1.5 0 0 1 2.5 12 V6 A1.5 1.5 0 0 1 4 4.5 Z" />
        </svg>
      ),
    },
  ];

  return (
    <nav
      data-print-hide
      data-mobile-bottom-nav
      className="app-bottom-nav"
      aria-label="Workspace"
    >
      {tabs.map((tab) => {
        const active = pane === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => go(tab.id)}
            aria-current={active ? 'page' : undefined}
            aria-label={tab.label}
            className={`app-bottom-nav__tab ${
              active ? 'app-bottom-nav__tab--active' : ''
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

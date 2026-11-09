import type { Theme } from '@/types';

/** Matches `paper.base` / `ape.base` so the PWA status bar tracks the topbar. */
const THEME_COLORS: Record<Theme, string> = {
  light: '#F4F1EA',
  dark: '#11171B',
};

/**
 * Apply the `.dark` class to `<html>` so the CSS variable theme tokens
 * resolve to the dark palette. Safe to run on the server (no-op when
 * `document` is undefined) and idempotent — repeatedly calling with the
 * same value is a no-op. Single source of truth for theme switching,
 * shared by `main.tsx` (pre-paint) and `useStore` (toggle / rehydrate).
 *
 * Also keeps `<meta name="theme-color">` in sync so Android / iOS
 * chrome around the status bar matches Light / Dark.
 */
export function applyThemeClass(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
  const color = THEME_COLORS[theme];
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', color);
}

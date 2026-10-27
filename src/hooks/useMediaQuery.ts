import { useEffect, useState } from 'react';

/**
 * Subscribe to a CSS media query. Returns the current match state and
 * updates on `change`. Safe to call during SSR / first paint: when
 * `window` is unavailable the hook returns `false`.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/**
 * Phone / small-tablet layout: stacked overlays instead of three
 * peer columns. Width covers portrait phones; height covers
 * landscape phones (e.g. 844×390) that would otherwise keep the
 * desktop tri-column shell.
 */
export const NARROW_QUERY =
  '(max-width: 767px), (max-height: 540px)';

/**
 * Comment composer / popover as a bottom sheet, and the write-pane
 * margin as a horizontal chip lane. Same query as `NARROW_QUERY` so
 * landscape phones do not keep a 36 px side column or a 320 px
 * floating popover.
 */
export const COMMENT_SHEET_QUERY = NARROW_QUERY;

export function useIsNarrow(): boolean {
  return useMediaQuery(NARROW_QUERY);
}

export function useIsCommentSheet(): boolean {
  return useMediaQuery(COMMENT_SHEET_QUERY);
}

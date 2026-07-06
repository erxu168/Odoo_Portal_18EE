import { useEffect, useRef } from 'react';

/**
 * Live-refresh helper for shift screens (mirrors PresenceCard's polling).
 * Runs `fn` every `ms` while the tab is visible AND `enabled` is true, and also
 * re-runs it whenever the tab regains focus. Pass enabled=false (e.g. while a
 * sheet/detail is open) to pause so nothing jumps under the user mid-action.
 */
export function usePoll(fn: () => void, ms: number, enabled = true): void {
  const saved = useRef(fn);
  useEffect(() => {
    saved.current = fn;
  });
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') saved.current();
    }, ms);
    const onVis = () => {
      if (document.visibilityState === 'visible') saved.current();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [ms, enabled]);
}

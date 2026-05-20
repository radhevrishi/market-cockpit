// AUDIT_100 #7 — Shared interval hook that auto-pauses when the browser
// tab is hidden. 14 of 17 polling pages were burning Vercel quota +
// rate-limiting NSE/Yahoo even when the user wasn't looking.
//
// Usage:
//   useVisibilityInterval(() => fetchData(), 60_000);
//   // ↑ replaces setInterval(() => fetchData(), 60_000) inside a useEffect
//
// Behaviour:
// - fires the callback immediately on mount (matches existing useEffect+fetch pattern)
// - schedules subsequent ticks at `ms` interval
// - when `document.visibilityState !== 'visible'`, the next scheduled fire
//   is skipped. When the user returns to the tab, a fresh fire happens
//   immediately + the interval resumes.
// - cleans up on unmount.
//
// Pass `enabled = false` to temporarily disable (e.g. while paused / no data).

import { useEffect, useRef } from 'react';

type Callback = () => void | Promise<void>;

export function useVisibilityInterval(
  callback: Callback,
  ms: number,
  enabled: boolean = true,
): void {
  const savedCallback = useRef<Callback>(callback);
  // Keep the latest callback in a ref so the interval doesn't capture stale state
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled || ms <= 0) return;
    if (typeof window === 'undefined') return; // SSR safety

    let timer: ReturnType<typeof setInterval> | null = null;
    let lastFireAt = 0;

    const isVisible = (): boolean =>
      typeof document === 'undefined' || document.visibilityState === 'visible';

    const fire = () => {
      lastFireAt = Date.now();
      try {
        const r = savedCallback.current();
        if (r && typeof (r as Promise<unknown>).catch === 'function') {
          (r as Promise<unknown>).catch(() => {});
        }
      } catch {
        // Swallow — user-side errors shouldn't kill the interval
      }
    };

    // Initial fire on mount (matches existing patterns)
    if (isVisible()) fire();

    timer = setInterval(() => {
      if (isVisible()) fire();
    }, ms);

    // When the tab becomes visible AFTER being hidden long enough that
    // we missed at least one tick, fire immediately. Otherwise wait for
    // the next scheduled fire.
    const onVisibility = () => {
      if (!isVisible()) return;
      if (Date.now() - lastFireAt >= ms) fire();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ms, enabled]);
}

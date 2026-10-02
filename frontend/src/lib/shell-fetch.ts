// zzz855 — tiny helpers for the dashboard shell (sidebar / header / PWA).
// Everything here is about WHEN the shell asks for data, never WHAT it shows:
//   - shellFetchJson: identical GETs share one request (and a short memo), so
//     two chips asking for the same list do not fetch it twice.
//   - whenIdle: run non-urgent shell work after the page has painted, so the
//     page's own data requests go first.
//   - visibleInterval: a timer that does nothing while the tab is hidden and
//     catches up once when the tab comes back.
//   - swUpdateDue: the service worker update check runs at most once per gap.
// No storage is written here (the origin's localStorage is often full).

type Json = unknown;

const inflight = new Map<string, Promise<Json | null>>();
const memo = new Map<string, { at: number; value: Json | null }>();

/**
 * GET a JSON url once. Concurrent callers share the request; a successful
 * answer is reused for `ttlMs`. A failed or non-OK answer returns null and is
 * NOT remembered, so the next caller tries again (unknown is never cached as
 * an empty answer).
 */
export function shellFetchJson<T = Json>(url: string, opts: { ttlMs?: number; init?: RequestInit } = {}): Promise<T | null> {
  const ttl = opts.ttlMs ?? 60_000;
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.value as T | null);
  const running = inflight.get(url);
  if (running) return running as Promise<T | null>;
  const p = (async () => {
    try {
      const r = await fetch(url, { cache: 'no-store', ...(opts.init || {}) });
      if (!r.ok) return null;
      const j = (await r.json()) as Json;
      memo.set(url, { at: Date.now(), value: j });
      return j;
    } catch {
      return null;
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, p);
  return p as Promise<T | null>;
}

/** Test helper: forget all shared requests and memos. */
export function _resetShellFetch(): void { inflight.clear(); memo.clear(); }

/** Run `fn` when the browser is idle (or after `timeoutMs` at the latest). Returns a cancel function. */
export function whenIdle(fn: () => void, timeoutMs = 2000): () => void {
  if (typeof window === 'undefined') return () => {};
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  if (typeof w.requestIdleCallback === 'function') {
    const id = w.requestIdleCallback(fn, { timeout: timeoutMs });
    return () => { try { w.cancelIdleCallback?.(id); } catch { /* ignore */ } };
  }
  const t = setTimeout(fn, Math.min(timeoutMs, 300));
  return () => clearTimeout(t);
}

interface DocLike { hidden?: boolean; addEventListener: (t: string, f: () => void) => void; removeEventListener: (t: string, f: () => void) => void }

/**
 * setInterval that skips ticks while the tab is hidden. When the tab becomes
 * visible again and at least one tick was skipped, `fn` runs once right away.
 * Returns a cleanup function.
 */
export function visibleInterval(fn: () => void, ms: number, doc?: DocLike): () => void {
  const d: DocLike | undefined = doc || (typeof document !== 'undefined' ? (document as unknown as DocLike) : undefined);
  let missed = false;
  const tick = () => {
    if (d?.hidden) { missed = true; return; }
    fn();
  };
  const id = setInterval(tick, ms);
  const onVis = () => {
    if (d && !d.hidden && missed) { missed = false; fn(); }
  };
  d?.addEventListener('visibilitychange', onVis);
  return () => { clearInterval(id); d?.removeEventListener('visibilitychange', onVis); };
}

/** Minimum gap between service-worker update checks (each check downloads /sw.js). */
export const SW_UPDATE_GAP_MS = 60 * 60_000;

/** True when an update check is due: never checked, or the last one was at least `gapMs` ago. */
export function swUpdateDue(lastCheckAt: number | null, now: number, gapMs = SW_UPDATE_GAP_MS): boolean {
  return lastCheckAt == null || now - lastCheckAt >= gapMs;
}

/**
 * Sidebar prefetch policy. Next.js prefetches every <Link> that scrolls into
 * view (one server request each). The rail and the phone menu hold ~75 links,
 * so only Home and the first few favourites keep prefetching.
 */
export const PREFETCH_FAVOURITES = 3;
export function navPrefetch(href: string, favouriteIndex: number | null): false | undefined {
  if (href === '/') return undefined;
  if (favouriteIndex != null && favouriteIndex >= 0 && favouriteIndex < PREFETCH_FAVOURITES) return undefined;
  return false;
}

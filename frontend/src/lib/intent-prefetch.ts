// zzz1052 — prefetch a page when the owner shows intent (hover, keyboard focus, pointer down), never because a link
// scrolled into view.
//
// Why: Next.js prefetches every <Link> that enters the viewport. With Next 16's segment cache each prefetch is two
// server renders (the route tree `/_tree` and the page segment — the "two waves with different _rsc hashes"). The home
// page shows ~100 links, so opening it fired ~160 server renders, and a real click queued behind them ("click 4 times").
// NavLink (components/NavLink.tsx) turns viewport prefetch off and calls the helpers below instead.
//
// Pure module: no React, no Next. The browser pieces (timers, clock, current path) are injectable for tests.

/** Wait this long on mouse-over before prefetching, so a pointer sweeping across a list does not prefetch every item. */
export const HOVER_PREFETCH_DELAY_MS = 70;
/** A page prefetched within this window is not asked for again (Next keeps its own cache; this just saves the call). */
export const INTENT_PREFETCH_TTL_MS = 5 * 60_000;

/**
 * The URL to prefetch for `href`, or null when there is nothing worth prefetching:
 * external / protocol-relative links, mailto: etc., a bare "#anchor", or the page already open.
 * The #hash is dropped (it never reaches the server). `currentUrl` is pathname + search of the open page.
 */
export function prefetchTarget(href: string | null | undefined, currentUrl?: string | null): string | null {
  if (typeof href !== 'string') return null;
  const h = href.trim();
  if (!h.startsWith('/') || h.startsWith('//')) return null;
  const noHash = h.split('#')[0];
  if (!noHash) return null;
  if (currentUrl != null && noHash === currentUrl) return null;
  return noHash;
}

const _warmed = new Map<string, number>();

/** True (and remembered) when `target` was not prefetched in the last `ttlMs`. */
export function claimPrefetch(target: string, now: number, ttlMs = INTENT_PREFETCH_TTL_MS): boolean {
  const last = _warmed.get(target);
  if (last != null && now - last < ttlMs) return false;
  _warmed.set(target, now);
  if (_warmed.size > 300) {
    for (const [k, at] of _warmed) if (now - at >= ttlMs) _warmed.delete(k);
  }
  return true;
}

/** Test helper. */
export function _resetIntentPrefetch(): void { _warmed.clear(); }

type TimerHandle = unknown;
export interface IntentDeps {
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (h: TimerHandle) => void;
  now?: () => number;
  /** pathname + search of the open page */
  currentUrl?: () => string | null;
  delayMs?: number;
}

export interface IntentPrefetcher {
  /** mouse entered: prefetch after a short delay unless the mouse leaves first */
  hoverStart: () => void;
  /** mouse left: cancel a pending hover prefetch */
  hoverEnd: () => void;
  /** focus / pointer down / touch start: prefetch now */
  now: () => void;
}

function browserUrl(): string | null {
  try { return typeof window === 'undefined' ? null : window.location.pathname + window.location.search; } catch { return null; }
}

/** One prefetcher per link. `getHref` / `prefetch` are read at fire time, so the latest props are used. */
export function makeIntentPrefetcher(getHref: () => string | null | undefined, prefetch: (url: string) => void, deps: IntentDeps = {}): IntentPrefetcher {
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h: TimerHandle) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const clock = deps.now ?? (() => Date.now());
  const current = deps.currentUrl ?? browserUrl;
  const delay = deps.delayMs ?? HOVER_PREFETCH_DELAY_MS;
  let timer: TimerHandle | null = null;
  const cancel = () => { if (timer != null) { clearTimer(timer); timer = null; } };
  const fire = () => {
    timer = null;
    const target = prefetchTarget(getHref(), current());
    if (!target || !claimPrefetch(target, clock())) return;
    try { prefetch(target); } catch { /* a failed prefetch only means the click does the work */ }
  };
  return {
    hoverStart: () => { if (timer == null) timer = setTimer(fire, delay); },
    hoverEnd: cancel,
    now: () => { cancel(); fire(); },
  };
}

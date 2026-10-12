// zzz969 — one quote request for all open tabs. Charts, Watchlists, Movers and the Heatmap each poll prices; with several
// tabs open the same URL was fetched once per tab. Tabs now tell each other over a BroadcastChannel (nothing is written to
// storage): a tab that fetches announces it, the others wait for its answer (up to 6 s) instead of asking the server too,
// and every tab reuses another tab's answer for `maxAgeMs`.
type Entry = { at: number; data: unknown; remote: boolean };
const cache = new Map<string, Entry>();
const busyUntil = new Map<string, number>();
const waiters = new Map<string, Array<(d: unknown) => void>>();
let chan: BroadcastChannel | null = null;
function channel(): BroadcastChannel | null {
  if (chan || typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return chan;
  try {
    chan = new BroadcastChannel('mc-shared-fetch');
    (chan as any).unref?.();   // never keep a process alive (tests, server)
    chan.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (!m || typeof m.url !== 'string') return;
      if (m.type === 'busy') busyUntil.set(m.url, Date.now() + 6000);
      if (m.type === 'data') { cache.set(m.url, { at: Number(m.at) || Date.now(), data: m.data, remote: true }); busyUntil.delete(m.url); for (const w of waiters.get(m.url) || []) w(m.data); waiters.delete(m.url); }
      if (m.type === 'fail') { busyUntil.delete(m.url); for (const w of waiters.get(m.url) || []) w(undefined); waiters.delete(m.url); }
    };
  } catch { chan = null; }
  return chan;
}

/** GET `url` as JSON, shared across tabs. Returns null on failure. */
export async function sharedFetchJson<T = unknown>(url: string, maxAgeMs: number, signal?: AbortSignal): Promise<T | null> {
  const ch = channel();
  const hit = cache.get(url);
  // only an answer ANOTHER tab fetched is reused — this tab's own poll means it wants a fresh read
  if (hit && hit.remote && Date.now() - hit.at < maxAgeMs) return hit.data as T;
  if (ch && (busyUntil.get(url) || 0) > Date.now()) {
    const got = await new Promise<unknown>((res) => {
      const list = waiters.get(url) || []; list.push(res); waiters.set(url, list);
      setTimeout(() => res(undefined), Math.max(0, (busyUntil.get(url) || 0) - Date.now()));
    });
    if (got !== undefined) return got as T;
  }
  try { ch?.postMessage({ type: 'busy', url }); } catch { /* channel closed */ }
  try {
    const r = await fetch(url, { cache: 'no-store', signal });
    if (!r.ok) throw new Error(String(r.status));
    const data = await r.json();
    const at = Date.now();
    cache.set(url, { at, data, remote: false });
    try { ch?.postMessage({ type: 'data', url, at, data }); } catch { /* too large to post, or closed */ }
    return data as T;
  } catch {
    try { ch?.postMessage({ type: 'fail', url }); } catch { /* closed */ }
    return null;
  }
}
export function _resetSharedFetch(): void { cache.clear(); busyUntil.clear(); waiters.clear(); }

// zzz1052 — remember the result of an async load for the life of the page session (until a full reload), keyed by a
// string. Parallel callers share one load; a success is reused for `ttlMs`; a failure (rejection or null) is NOT
// remembered, so the next caller tries again. Used for work whose result is the same for every visit within a few
// minutes — e.g. the home page's Technicals tiers, which downloaded and parsed ~6 CSV files (1–6 s, a ~200 ms main-thread
// task) on every return to the home page.

interface Entry<T> { at: number; value: T }
const _done = new Map<string, Entry<unknown>>();
const _running = new Map<string, Promise<unknown>>();

export function sessionMemo<T>(key: string, load: () => Promise<T | null>, ttlMs = 10 * 60_000, now: () => number = Date.now): Promise<T | null> {
  const hit = _done.get(key);
  if (hit && now() - hit.at < ttlMs) return Promise.resolve(hit.value as T);
  const running = _running.get(key);
  if (running) return running as Promise<T | null>;
  const p = (async () => {
    try {
      const v = await load();
      if (v != null) _done.set(key, { at: now(), value: v });
      return v;
    } catch {
      return null;
    } finally {
      _running.delete(key);
    }
  })();
  _running.set(key, p);
  return p;
}

/** The remembered value (no load), or undefined when absent / expired. */
export function peekSessionMemo<T>(key: string, ttlMs = 10 * 60_000, now: () => number = Date.now): T | undefined {
  const hit = _done.get(key);
  return hit && now() - hit.at < ttlMs ? (hit.value as T) : undefined;
}

/** Test helper. */
export function _resetSessionMemo(): void { _done.clear(); _running.clear(); }

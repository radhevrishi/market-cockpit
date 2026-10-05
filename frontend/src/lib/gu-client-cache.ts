// zzz863 — stale-while-revalidate for the Guidance Upgrades page. The last answer is kept in memory (survives moving between pages) and in localStorage (survives closing the tab),
// so coming back shows the page at once and fetches fresh data in the background. Public company data only (never holdings). Every storage call is guarded: no storage = no cache, never an error.
const PREFIX = 'mc:gu:v1:';
const MAX_CHARS = 2_500_000;
const mem = new Map<string, { at: number; data: unknown }>();
export interface CacheHit<T> { at: number; data: T; ageMs: number }
export function readCache<T>(key: string, now = Date.now()): CacheHit<T> | null {
  const m = mem.get(key);
  if (m) return { at: m.at, data: m.data as T, ageMs: now - m.at };
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(PREFIX + key); if (!raw) return null;
    const j = JSON.parse(raw) as { at?: number; data?: unknown };
    if (!j || typeof j.at !== 'number' || j.data == null) return null;
    mem.set(key, { at: j.at, data: j.data });
    return { at: j.at, data: j.data as T, ageMs: now - j.at };
  } catch { return null; }
}
export function writeCache(key: string, data: unknown, now = Date.now()): void {
  mem.set(key, { at: now, data });
  try {
    if (typeof localStorage === 'undefined') return;
    const s = JSON.stringify({ at: now, data });
    if (s.length > MAX_CHARS) {
      // too big: keep a shorter copy (the first events and queue rows; counts stay exact) rather than nothing, so a refresh still shows data
      const d = data as { events?: unknown[]; reviewQueue?: unknown[] };
      if (d && Array.isArray(d.events)) {
        const slim = JSON.stringify({ at: now, data: { ...d, events: d.events.slice(0, 120), reviewQueue: (d.reviewQueue || []).slice(0, 60) } });
        if (slim.length <= MAX_CHARS) { localStorage.setItem(PREFIX + key, slim); return; }
      }
      localStorage.removeItem(PREFIX + key); return;
    }
    localStorage.setItem(PREFIX + key, s);
  } catch { /* storage full or blocked: the memory copy still works */ }
}
/** 'saved 3 minutes ago' for the small refreshing note. */
export function ageText(ageMs: number): string {
  const m = Math.floor(Math.max(0, ageMs) / 60_000);
  return m < 1 ? 'a moment ago' : m < 60 ? `${m} minute${m === 1 ? '' : 's'} ago` : `${Math.floor(m / 60)} hour${Math.floor(m / 60) === 1 ? '' : 's'} ago`;
}
/** Fresh enough to skip the background fetch (the data changes hourly at most). */
export const FRESH_MS = 90_000;

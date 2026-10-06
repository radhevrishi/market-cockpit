// zzz863 — stale-while-revalidate for the Guidance Upgrades page. The last answer is kept in memory (survives moving between pages) and in localStorage (survives closing the tab),
// so coming back shows the page at once and fetches fresh data in the background. Public company data only (never holdings). Every storage call is guarded: no storage = no cache, never an error.
// zzz882: v2 — a copy saved by an older version of the checks (wrong India raises before zzz881) is never shown again
const PREFIX = 'mc:gu:v2:';
const OLD_PREFIXES = ['mc:gu:v1:'];
let _swept = false;
function sweepOld(): void {
  if (_swept) return; _swept = true;
  try {
    if (typeof localStorage === 'undefined') return;
    const kill: string[] = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && OLD_PREFIXES.some((p) => k.startsWith(p))) kill.push(k); }
    for (const k of kill) localStorage.removeItem(k);
  } catch { /* no storage */ }
}
const MAX_CHARS = 2_500_000;
const mem = new Map<string, { at: number; data: unknown }>();
export interface CacheHit<T> { at: number; data: T; ageMs: number }
export function readCache<T>(key: string, now = Date.now()): CacheHit<T> | null {
  const m = mem.get(key);
  if (m) return { at: m.at, data: m.data as T, ageMs: now - m.at };
  try {
    if (typeof localStorage === 'undefined') return null;
    sweepOld();
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
      // zzz886: a large answer goes to IndexedDB (no 5 MB browser limit) so the next visit still opens at once
      if (idbAvailable()) { localStorage.removeItem(PREFIX + key); void idbPut(PREFIX + key, { at: now, data }); return; }
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
// ── zzz886: IndexedDB for answers too big for localStorage ──
const IDB_NAME = 'mc-gu-cache'; const IDB_STORE = 'kv';
function idbAvailable(): boolean { try { return typeof indexedDB !== 'undefined' && indexedDB != null; } catch { return false; } }
let _db: Promise<IDBDatabase | null> | null = null;
function idbOpen(): Promise<IDBDatabase | null> {
  if (_db) return _db;
  _db = new Promise((res) => {
    try {
      const rq = indexedDB.open(IDB_NAME, 1);
      rq.onupgradeneeded = () => { try { rq.result.createObjectStore(IDB_STORE); } catch { /* exists */ } };
      rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null); rq.onblocked = () => res(null);
    } catch { res(null); }
  });
  return _db;
}
async function idbPut(k: string, v: unknown): Promise<void> {
  const db = await idbOpen(); if (!db) return;
  await new Promise<void>((res) => { try { const tx = db.transaction(IDB_STORE, 'readwrite'); tx.objectStore(IDB_STORE).put(v, k); tx.oncomplete = () => res(); tx.onerror = () => res(); tx.onabort = () => res(); } catch { res(); } });
}
async function idbGet<T>(k: string): Promise<T | null> {
  const db = await idbOpen(); if (!db) return null;
  return new Promise((res) => { try { const rq = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(k); rq.onsuccess = () => res((rq.result as T) ?? null); rq.onerror = () => res(null); } catch { res(null); } });
}
/** Memory → localStorage → IndexedDB. Use where the caller can wait a moment (the first paint of a large answer). */
export async function readCacheAsync<T>(key: string, now = Date.now()): Promise<CacheHit<T> | null> {
  const s = readCache<T>(key, now); if (s) return s;
  if (!idbAvailable()) return null;
  const j = await idbGet<{ at?: number; data?: unknown }>(PREFIX + key).catch(() => null);
  if (!j || typeof j.at !== 'number' || j.data == null) return null;
  mem.set(key, { at: j.at, data: j.data });
  return { at: j.at, data: j.data as T, ageMs: now - j.at };
}

/** 'saved 3 minutes ago' for the small refreshing note. */
export function ageText(ageMs: number): string {
  const m = Math.floor(Math.max(0, ageMs) / 60_000);
  return m < 1 ? 'a moment ago' : m < 60 ? `${m} minute${m === 1 ? '' : 's'} ago` : `${Math.floor(m / 60)} hour${Math.floor(m / 60) === 1 ? '' : 's'} ago`;
}
/** Fresh enough to skip the background fetch (the data changes hourly at most). */
export const FRESH_MS = 90_000;

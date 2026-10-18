// zzz944 — the /charts data that two devices can both change (drawings per ticker, chart layouts) is MERGED when it is
// synced, never overwritten as one whole value.
//
// Why: the vault sync (user-vault-client) is "last writer wins" for the whole key, and on a device's first contact the server
// copy wins. Drawings for every ticker live in ONE key, so another device (or a visit that only opened a drawing tool) that
// saved an empty copy `{}` first would replace every drawing on this device when it synced — the drawings "did not save".
// Now each ticker carries its own save time; per ticker the newer save wins, a cleared ticker is remembered as a tombstone.
import { sanitizeDrawings, type SavedDrawing } from './chart-math';
import { CHART_LAYOUTS_KEY, mergeLayoutStores } from './chart-layouts';
import { CHART_WATCHLISTS_KEY } from './chart-watchlist';
import { mergeWatchlistStores } from './chart-watchlist-merge';

export const CHART_DRAWINGS_KEY = 'mc:chart-drawings:v1';

export interface DrawingEntry { at: number; d: SavedDrawing[] }
export interface DrawingStoreV2 { v: 2; items: Record<string, DrawingEntry> }

// zzz969 — an optional '#<set-id>' names a second drawing set for the same chart (lib/chart-drawing-sets.ts)
const KEY_RE = /^(IN|US):(?:BSE:)?[A-Z0-9][A-Z0-9&.\-]{0,19}(?:#[a-z0-9-]{1,24})?$/;

/** Read either shape: the old `{ "US:QQQ": [...] }` (time 0 — older than anything saved since) or v2. */
export function readDrawingStore(raw: unknown): DrawingStoreV2 {
  const out: DrawingStoreV2 = { v: 2, items: {} };
  if (!raw || typeof raw !== 'object') return out;
  const r: any = raw;
  if (r.v === 2 && r.items && typeof r.items === 'object') {
    for (const [k, e] of Object.entries<any>(r.items)) {
      if (!KEY_RE.test(k) || !e || typeof e !== 'object') continue;
      out.items[k] = { at: Number.isFinite(Number(e.at)) ? Number(e.at) : 0, d: sanitizeDrawings(e.d) };
    }
    return out;
  }
  for (const [k, list] of Object.entries<any>(r)) {
    if (!KEY_RE.test(k)) continue;
    const d = sanitizeDrawings(list);
    if (d.length) out.items[k] = { at: 0, d };
  }
  return out;
}

export const drawingsFor = (s: DrawingStoreV2, key: string): SavedDrawing[] => s.items[key]?.d || [];

/** Set one ticker's drawings. Returns the same object when nothing changed (so nothing is written or synced). An emptied
 *  ticker that had drawings becomes a tombstone (empty list + time) so the clear also reaches other devices. */
export function setDrawings(s: DrawingStoreV2, key: string, list: SavedDrawing[], now = Date.now()): DrawingStoreV2 {
  const clean = sanitizeDrawings(list);
  const cur = s.items[key];
  if (!cur && !clean.length) return s;
  if (cur && JSON.stringify(cur.d) === JSON.stringify(clean)) return s;
  return { v: 2, items: { ...s.items, [key]: { at: Math.max(now, (cur?.at ?? 0) + 1), d: clean } } };
}

/** Per ticker the newer save wins (ties: the one with drawings). */
export function mergeDrawingStores(aRaw: unknown, bRaw: unknown): DrawingStoreV2 {
  const a = readDrawingStore(aRaw), b = readDrawingStore(bRaw);
  const items: Record<string, DrawingEntry> = { ...b.items };
  for (const [k, e] of Object.entries(a.items)) {
    const o = items[k];
    if (!o || e.at > o.at || (e.at === o.at && e.d.length >= o.d.length)) items[k] = e;
  }
  return { v: 2, items };
}

/** Rescue drawings that an older sync replaced: the vault keeps the replaced copy in a backup key. Tickers the current store
 *  does not know are brought back (as old saves, so anything newer still wins). */
export function rescueFromBackup(s: DrawingStoreV2, backupRaw: unknown): DrawingStoreV2 {
  const b: any = backupRaw && typeof backupRaw === 'object' ? backupRaw : null;
  const val = b?.value?.parsed ?? (typeof b?.value?.__raw === 'string' ? safeParse(b.value.__raw) : null);
  if (!val) return s;
  const old = readDrawingStore(val);
  let out = s;
  for (const [k, e] of Object.entries(old.items)) {
    if (out.items[k] || !e.d.length) continue;
    out = { v: 2, items: { ...out.items, [k]: { at: 0, d: e.d } } };
  }
  return out;
}
function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }

/** Keys whose two copies are merged instead of one replacing the other (used by the vault sync). Both values are the parsed
 *  JSON; the result is the merged value to keep on both sides. */
export const VAULT_MERGERS: Record<string, (local: unknown, server: unknown, base?: unknown) => unknown> = {
  [CHART_DRAWINGS_KEY]: (l, s) => mergeDrawingStores(l, s),
  [CHART_LAYOUTS_KEY]: (l, s) => mergeLayoutStores(l, s),
  // zzz1074 — three-way: needs the copy this device last synced (VAULT_BASE_KEYS), so a deletion is not undone by the merge
  [CHART_WATCHLISTS_KEY]: (l, s, b) => mergeWatchlistStores(l, s, b),
};
/** zzz1074 — merged keys whose merge needs the last synced copy ("base"); the vault keeps it in mc:vault:base:<key>. */
export const VAULT_BASE_KEYS: ReadonlySet<string> = new Set([CHART_WATCHLISTS_KEY]);

// zzz846 — Growth Guidance ledger (KV). Server-only. Public company data only, never holdings.
// key `growth-guidance-ledger:v1:<market>:<TICKER>`, 400-day TTL. APPEND-ONLY: an existing entry is never changed or removed
// (only the oldest are trimmed when the bounded size is exceeded). Idempotent by entry key (document id | metric | period).
import { kvSet, kvGet, kvMGet } from '@/lib/kv';
import type { GgStoredEntry } from './growth-guidance';

export const GG_LEDGER_TTL_S = 400 * 24 * 3600;
export const GG_MAX_ENTRIES = 200;
export const GG_MAX_INDEX = 800;
export type GgLedgerMarket = 'IN' | 'US';
export const ggLedgerKey = (ticker: string, market: GgLedgerMarket) => `growth-guidance-ledger:v1:${market}:${ticker.toUpperCase()}`;
export const ggIndexKey = (market: GgLedgerMarket) => `growth-guidance-ledger:v1:${market}:__index`;

export interface GgTickerLedger { entries: GgStoredEntry[] }

/** Pure: what the ledger looks like after appending `fresh`. Returns null when nothing is new. Existing entries are carried over untouched. */
export function appendEntries(existing: GgTickerLedger | null | undefined, fresh: GgStoredEntry[]): GgTickerLedger | null {
  const cur = existing?.entries ? existing.entries : [];
  const keys = new Set(cur.map((e) => e.key));
  const add: GgStoredEntry[] = [];
  for (const e of fresh) { if (keys.has(e.key)) continue; keys.add(e.key); add.push(e); }
  if (!add.length) return null;
  return { entries: [...cur, ...add].slice(-GG_MAX_ENTRIES) };
}

export async function readGgLedgers(tickers: string[], market: GgLedgerMarket): Promise<Map<string, GgStoredEntry[]>> {
  const out = new Map<string, GgStoredEntry[]>();
  const list = Array.from(new Set(tickers.map((t) => t.toUpperCase()).filter(Boolean))).slice(0, 300);
  if (!list.length) return out;
  try {
    const vals = await kvMGet<GgTickerLedger>(list.map((t) => ggLedgerKey(t, market)));
    list.forEach((t, i) => { const v = vals[i]; if (v && Array.isArray(v.entries)) out.set(t, v.entries); });
  } catch { /* cold store: history starts empty */ }
  return out;
}
export async function readGgIndex(market: GgLedgerMarket): Promise<string[]> {
  try { const v = await kvGet<string[]>(ggIndexKey(market)); return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, GG_MAX_INDEX) : []; } catch { return []; }
}

/** Appends new entries per ticker (read-modify-write of the append-only object) and adds the tickers to the index. Returns tickers written. */
export async function writeGgLedgers(byTicker: Map<string, GgStoredEntry[]>, existing: Map<string, GgStoredEntry[]>, market: GgLedgerMarket): Promise<number> {
  let n = 0; const touched: string[] = [];
  for (const [t, fresh] of Array.from(byTicker.entries())) {
    const next = appendEntries({ entries: existing.get(t) || [] }, fresh);
    if (!next) continue;
    try { await kvSet(ggLedgerKey(t, market), next, GG_LEDGER_TTL_S); n++; touched.push(t); } catch { /* the page still works without history */ }
  }
  if (touched.length) {
    try {
      const idx = await readGgIndex(market);
      const merged = Array.from(new Set([...idx, ...touched])).slice(-GG_MAX_INDEX);
      if (merged.length !== idx.length) await kvSet(ggIndexKey(market), merged, GG_LEDGER_TTL_S);
    } catch { /* index is an optimisation */ }
  }
  return n;
}

// ── zzz848 Guidance Universe persistence ─────────────────────────────────────────────────────
// key `guidance-universe:v1:<IN|US>`, 400-day TTL, bounded (GU_MAX_STORED rows), idempotent (skipped when the stored key-hash is unchanged).
// The researched data file is never frozen here; only live/ledger-derived points are kept so a scan that briefly misses a company does not erase it.
import { mergeStored, type GuStoredDoc, type GuStoredPoint } from './guidance-universe';
export const GU_TTL_S = 400 * 24 * 3600;
export const guUniverseKey = (market: GgLedgerMarket) => `guidance-universe:v1:${market}`;
export async function readGuStored(market: GgLedgerMarket): Promise<GuStoredDoc | null> {
  try { const v = await kvGet<GuStoredDoc>(guUniverseKey(market)); return v && v.v === 1 && Array.isArray(v.rows) ? v : null; } catch { return null; }
}
/** Merges `fresh` into the stored universe and writes only when something changed. Returns true when a write happened. */
export async function writeGuStored(market: GgLedgerMarket, fresh: GuStoredPoint[], now: Date, existing?: GuStoredDoc | null): Promise<boolean> {
  try {
    const cur = existing === undefined ? await readGuStored(market) : existing;
    const { doc, changed } = mergeStored(cur, fresh.filter((r) => r.market === market), now);
    if (!changed) return false;
    await kvSet(guUniverseKey(market), doc, GU_TTL_S); return true;
  } catch { return false; }
}

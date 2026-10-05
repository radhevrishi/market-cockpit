// zzz877 — a day's BLOCKBUSTER / STRONG cards go onto the server Conviction bench (KV bench:server:v1) THE MOMENT the day is graded.
// Before, only the daily refresh-bench job (08:30 IST, and GitHub drops scheduled runs) added names, so a STRONG result filed on a
// Saturday evening (HIIL, 3 Oct 2026) or graded after a late re-read stayed off the bench for a day or more.
// Same rules as refresh-bench: one entry per ticker, the newest filing wins, the full graded card is stored. Never removes anything
// (removal stays with the user's ×, and the daily rebuild remains the full reconciliation). Never throws.
export const BENCH_KEY = 'bench:server:v1';
export const BENCH_TTL_S = 60 * 60 * 24 * 7;

type Row = { ticker?: string; filing_date?: string; tier?: string; [k: string]: any };
export interface BenchDoc { updatedAt: string; count: number; entries: Row[] }

/** Pure merge: rows of one graded day into the bench. Returns the new doc and how many entries were added / replaced. */
export function mergeIntoBench(prev: BenchDoc | null, rows: Row[], dateStr: string, now = new Date()): { doc: BenchDoc; added: number; replaced: number } {
  const entries = Array.isArray(prev?.entries) ? prev!.entries.slice() : [];
  const idx = new Map<string, number>();
  entries.forEach((e, i) => { if (e?.ticker) idx.set(String(e.ticker), i); });
  let added = 0, replaced = 0;
  for (const r of rows) {
    if (!r || !r.ticker || (r.tier !== 'BLOCKBUSTER' && r.tier !== 'STRONG')) continue;
    const t = String(r.ticker); const card = { ...r, seen_date: dateStr };
    const i = idx.get(t);
    if (i == null) { idx.set(t, entries.length); entries.push(card); added++; continue; }
    const old = entries[i];
    const newer = String(r.filing_date || dateStr) > String(old?.filing_date || '');
    const sameDayUpgrade = String(r.filing_date || dateStr) === String(old?.filing_date || '') && (old?.tier !== 'BLOCKBUSTER' || r.tier === 'BLOCKBUSTER');
    if (newer || sameDayUpgrade) { entries[i] = card; replaced++; }
  }
  return { doc: { updatedAt: now.toISOString(), count: entries.length, entries }, added, replaced };
}

/** Upsert the BLOCKBUSTER / STRONG rows of a graded payload. Best effort. */
export async function upsertServerBench(payload: any, dateStr: string): Promise<{ added: number; replaced: number } | null> {
  try {
    const bt = payload?.by_tier || {};
    const rows: Row[] = [...(Array.isArray(bt.BLOCKBUSTER) ? bt.BLOCKBUSTER : []), ...(Array.isArray(bt.STRONG) ? bt.STRONG : [])];
    if (!rows.length) return { added: 0, replaced: 0 };
    const { kvGet, kvSet } = await import('./kv');
    const prev = await kvGet<BenchDoc>(BENCH_KEY).catch(() => null);
    const { doc, added, replaced } = mergeIntoBench(prev && Array.isArray(prev.entries) ? prev : null, rows, dateStr);
    if (added || replaced) await kvSet(BENCH_KEY, doc, BENCH_TTL_S);
    return { added, replaced };
  } catch { return null; }
}

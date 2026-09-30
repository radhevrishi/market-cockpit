// zzz843 — small persistent ledger of past guidance per ticker (KV). Server-only. Public company data only.
// key 'guidance-ledger:v1:<ticker>', 400-day TTL, bounded rows, idempotent by guidance_event_id.
import { kvSet, kvMGet } from '@/lib/kv';
import type { GuGuidancePoint, GuLedgerRow, GuidanceEvent } from './guidance-upgrades-types';
import { fmtPoint } from './guidance-upgrades-format';

export const LEDGER_TTL_S = 400 * 24 * 3600;
const MAX_ROWS = 60;
const MAX_IDS = 120;
/** India (and legacy) keys are unchanged. US keys carry a market prefix so a US and an India ticker with the same letters never share history. */
export type LedgerMarket = 'IN' | 'US';
export const ledgerKey = (ticker: string, market: LedgerMarket = 'IN') =>
  market === 'US' ? `guidance-ledger:v1:us:${ticker.toUpperCase()}` : `guidance-ledger:v1:${ticker.toUpperCase()}`;

export interface TickerLedger { rows: GuLedgerRow[]; points: GuGuidancePoint[]; ids: string[] }

export async function readLedgers(tickers: string[], market: LedgerMarket = 'IN'): Promise<Map<string, TickerLedger>> {
  const out = new Map<string, TickerLedger>();
  const list = Array.from(new Set(tickers.map((t) => t.toUpperCase()).filter(Boolean))).slice(0, 200);
  if (!list.length) return out;
  try {
    const vals = await kvMGet<TickerLedger>(list.map((t) => ledgerKey(t, market)));
    list.forEach((t, i) => { const v = vals[i]; if (v && Array.isArray(v.rows)) out.set(t, { rows: v.rows, points: Array.isArray(v.points) ? v.points : [], ids: Array.isArray(v.ids) ? v.ids : [] }); });
  } catch { /* cold store: history simply starts empty */ }
  return out;
}

export function ledgerRowsOf(e: GuidanceEvent): GuLedgerRow[] {
  return e.changes.map((c) => ({
    date: e.announcement_date, metric: c.after.metric, period: c.after.period, text: fmtPoint(c.after),
    change: c.direction === 'UP' ? 'RAISED' : c.direction === 'DOWN' ? 'CUT' : c.direction === 'FLAT' ? 'REITERATED' : 'INITIAL',
    result: 'PENDING',
  }));
}

/** Verified events only. Skips an event already stored. Returns how many tickers were written. */
export async function writeEvents(events: GuidanceEvent[], existing: Map<string, TickerLedger>, market: LedgerMarket = 'IN'): Promise<number> {
  let n = 0;
  const byTicker = new Map<string, GuidanceEvent[]>();
  for (const e of events) if (e.verification === 'VERIFIED' && e.ticker) byTicker.set(e.ticker.toUpperCase(), [...(byTicker.get(e.ticker.toUpperCase()) || []), e]);
  for (const [t, evs] of Array.from(byTicker.entries())) {
    const cur = existing.get(t) || { rows: [], points: [], ids: [] };
    const fresh = evs.filter((e) => !cur.ids.includes(e.guidance_event_id));
    if (!fresh.length) continue;
    const next: TickerLedger = {
      rows: [...cur.rows, ...fresh.flatMap(ledgerRowsOf)].slice(-MAX_ROWS),
      points: [...cur.points, ...fresh.flatMap((e) => e.changes.map((c) => c.after))].slice(-MAX_ROWS),
      ids: [...cur.ids, ...fresh.map((e) => e.guidance_event_id)].slice(-MAX_IDS),
    };
    try { await kvSet(ledgerKey(t, market), next, LEDGER_TTL_S); n++; } catch { /* the page still works without history */ }
  }
  return n;
}

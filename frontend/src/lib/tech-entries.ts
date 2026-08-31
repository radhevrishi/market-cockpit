// ─────────────────────────────────────────────────────────────────────────────
// tech-entries (zzz514) — read the Technicals tab's stored rows and flag names
// that are in a valid technical BUY ZONE right now, so the Action Cockpit can
// surface "a name you hold/bench just set up for an entry".
//
// The Technicals tab persists the parsed TradingView rows to localStorage
// (mb_tech_rows_usa_v1 / mb_tech_rows_ind_v1) with raw fields: symbol, price,
// ema21, sma50, sma200. We recompute a lightweight Qullamaggie/stage-2 buy-zone
// from those (uptrend above the 200-SMA, sitting just above the 21-EMA or
// 50-SMA and not extended). Best-effort and SSR-guarded.
// ─────────────────────────────────────────────────────────────────────────────

export interface TechEntry { market: 'USA' | 'IND'; note: string; pctAbove50: number | null; }

const norm = (s: string) => (s || '').toUpperCase().replace(/\.(NS|BO|NSE|BSE)$/i, '').trim();
const KEYS: { key: string; market: 'USA' | 'IND' }[] = [
  { key: 'mb_tech_rows_usa_v1', market: 'USA' },
  { key: 'mb_tech_rows_ind_v1', market: 'IND' },
];

function num(v: any): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/** Map of symbol → buy-zone info for every held/bench-agnostic tech row in a valid entry. */
export function getTechBuyZone(): Map<string, TechEntry> {
  const out = new Map<string, TechEntry>();
  if (typeof window === 'undefined') return out;
  for (const { key, market } of KEYS) {
    let rows: any[] = [];
    try {
      const raw = localStorage.getItem(key);
      rows = raw ? JSON.parse(raw) : [];
    } catch { rows = []; }
    if (!Array.isArray(rows)) continue;
    for (const r of rows) {
      const sym = norm(r?.symbol || r?.ticker || '');
      const price = num(r?.price);
      if (!sym || price == null || price <= 0 || out.has(sym)) continue;
      const ema21 = num(r?.ema21);
      const sma50 = num(r?.sma50);
      const sma200 = num(r?.sma200);
      // Stage-2 filter: in an uptrend (above the 200-SMA when known).
      if (sma200 != null && sma200 > 0 && price < sma200) continue;
      const pctAbove50 = sma50 != null && sma50 > 0 ? ((price - sma50) / sma50) * 100 : null;
      const pctAbove21 = ema21 != null && ema21 > 0 ? ((price - ema21) / ema21) * 100 : null;
      // "Buyable": sitting just above the 21-EMA (Qulla) or the 50-SMA, not extended.
      const at21 = pctAbove21 != null && pctAbove21 >= -1.5 && pctAbove21 <= 5;
      const at50 = pctAbove50 != null && pctAbove50 >= -1 && pctAbove50 <= 8;
      if (!at21 && !at50) continue;
      const note = at21
        ? `at the 21-EMA (${pctAbove21! >= 0 ? '+' : ''}${pctAbove21!.toFixed(1)}%) — Qulla entry`
        : `just above the 50-SMA (${pctAbove50! >= 0 ? '+' : ''}${pctAbove50!.toFixed(1)}%)`;
      out.set(sym, { market, note, pctAbove50 });
    }
  }
  return out;
}

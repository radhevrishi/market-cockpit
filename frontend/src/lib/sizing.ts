// ════════════════════════════════════════════════════════════════════════════
// sizing.ts (zzz524) — position sizing as a service. Any surface that shows a
// BUY-ish verdict can render "size: X% (₹Y) · stop ₹Z" inline. Risk model per
// the Bounce Playbook §11: size% = riskPerTrade% / stopDistance%.
// Equity: derived from the book's current value when available, else a user
// setting (mc:sizing:equity), else a neutral default. SSR-safe.
// ════════════════════════════════════════════════════════════════════════════

import { getPortfolioMap } from './portfolio-overlay';

const EQUITY_KEY = 'mc:sizing:equity';
const RISK_KEY = 'mc:sizing:riskPct';

export function getEquity(): { value: number; source: 'book' | 'setting' | 'default' } {
  if (typeof window !== 'undefined') {
    try {
      const set = parseFloat(localStorage.getItem(EQUITY_KEY) || '');
      if (Number.isFinite(set) && set > 0) return { value: set, source: 'setting' };
    } catch { /* ignore */ }
    try {
      let total = 0;
      for (const [, h] of getPortfolioMap()) if (typeof h.currentValue === 'number') total += h.currentValue;
      if (total > 0) return { value: total, source: 'book' };
    } catch { /* ignore */ }
  }
  return { value: 1_000_000, source: 'default' };
}

export function getRiskPct(): number {
  if (typeof window !== 'undefined') {
    try { const r = parseFloat(localStorage.getItem(RISK_KEY) || ''); if (Number.isFinite(r) && r > 0 && r <= 3) return r; } catch { /* ignore */ }
  }
  return 0.5; // balanced default
}

export interface SizeSuggestion {
  pctOfPortfolio: number;   // suggested position, % of equity
  value: number;            // in currency units
  stopPrice: number;        // suggested disaster stop
  stopPct: number;          // % below entry
  riskPct: number;          // risk per trade used
  equity: number; equitySource: string;
}

/** Suggest a size. Provide stopPct directly, or atrPct (stop = 3×ATR, capped 25%). */
export function suggestSize(opts: { price: number; stopPct?: number | null; atrPct?: number | null }): SizeSuggestion | null {
  const { price } = opts;
  if (!Number.isFinite(price) || price <= 0) return null;
  let stopPct = typeof opts.stopPct === 'number' && opts.stopPct > 0 ? opts.stopPct : null;
  if (stopPct == null && typeof opts.atrPct === 'number' && opts.atrPct > 0) stopPct = Math.min(25, 3 * opts.atrPct);
  if (stopPct == null) stopPct = 8; // conservative fallback
  stopPct = Math.max(2, Math.min(25, stopPct));
  const riskPct = getRiskPct();
  const eq = getEquity();
  const pct = Math.min(15, (riskPct / stopPct) * 100); // cap any single position at 15%
  return {
    pctOfPortfolio: pct,
    value: eq.value * pct / 100,
    stopPrice: price * (1 - stopPct / 100),
    stopPct, riskPct,
    equity: eq.value, equitySource: eq.source,
  };
}

export function fmtMoney(v: number, market: 'IND' | 'USA' | null | undefined): string {
  const isUS = market === 'USA';
  const sym = isUS ? '$' : '₹';
  if (!isUS && v >= 1e7) return `${sym}${(v / 1e7).toFixed(2)} Cr`;
  if (!isUS && v >= 1e5) return `${sym}${(v / 1e5).toFixed(1)} L`;
  if (v >= 1e6) return `${sym}${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${sym}${(v / 1e3).toFixed(1)}k`;
  return `${sym}${v.toFixed(0)}`;
}

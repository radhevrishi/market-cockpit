// ════════════════════════════════════════════════════════════════════════════
// engines.ts (zzz524) — the cross-engine reader. One call returns everything
// every engine in the portal knows about a symbol, from data that already
// lives in the browser. This is the connective tissue behind the Stock
// Passport, the Cockpit Verdict, Next Best Actions and the Bounce Desk.
// SSR-safe: every reader guards on window; all failures degrade to nulls.
// ════════════════════════════════════════════════════════════════════════════

import { getConvictionList } from './conviction-beats';
import type { ConvictionEntry } from './conviction-beats';
import { assessDecay } from './cb-decay';
import type { DecayAssessment } from './cb-decay';
import { getPortfolioMap } from './portfolio-overlay';
import type { PortfolioHoldingLite } from './portfolio-overlay';

export type Market = 'IND' | 'USA';

export interface EngineView {
  symbol: string;
  market: Market | null;
  company: string;
  sector: string;
  // Multibagger fundamental engine
  fundo: { score: number | null; grade: string | null } | null;
  // Technicals universe (MAs as of last sync)
  tech: { price: number | null; ema21: number | null; sma50: number | null; sma200: number | null; rs: number | null } | null;
  // Conviction Beats bench
  bench: { tier: string; score: number | null; filingDate: string | null } | null;
  // Decay watch (quality rolling over) — only for bench names
  decay: DecayAssessment | null;
  // Your book
  holding: PortfolioHoldingLite | null;
  // Saved valuation (manual valuation-calc save), if any
  valuation: { fairValue: number | null; savedAt: string | null } | null;
}

const norm = (s: any) => String(s || '').toUpperCase().replace(/\.(NS|BO|NSE|BSE)$/i, '').trim();
const num = (v: any): number | null => { const n = typeof v === 'number' ? v : parseFloat(String(v)); return Number.isFinite(n) ? n : null; };
const readJSON = (k: string): any => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };

/** Build the full per-symbol map across every engine. Cheap (~ms) — pure
 *  localStorage reads; call inside effects, memoize per render. */
export function getEngineViews(): Map<string, EngineView> {
  const out = new Map<string, EngineView>();
  if (typeof window === 'undefined') return out;

  const ensure = (symRaw: any): EngineView | null => {
    const s = norm(symRaw); if (!s) return null;
    let v = out.get(s);
    if (!v) { v = { symbol: s, market: null, company: '', sector: '', fundo: null, tech: null, bench: null, decay: null, holding: null, valuation: null }; out.set(s, v); }
    return v;
  };

  // 1 · Technicals rows (both markets) — MAs, RS, sector
  for (const [key, market] of [['mb_tech_rows_ind_v1', 'IND'], ['mb_tech_rows_usa_v1', 'USA']] as [string, Market][]) {
    const rows = readJSON(key);
    if (Array.isArray(rows)) for (const r of rows) {
      const v = ensure(r?.symbol || r?.ticker); if (!v || v.tech) continue;
      v.market = v.market || market;
      v.tech = { price: num(r?.price), ema21: num(r?.ema21), sma50: num(r?.sma50), sma200: num(r?.sma200), rs: num(r?.rsRating ?? r?.rs_rating ?? r?.rs) };
      v.sector = v.sector || String(r?.sector || r?.industry || '');
      v.company = v.company || String(r?.description || r?.company || r?.name || '');
    }
  }

  // 2 · Multibagger fundamental scores (both markets)
  for (const [key, market] of [['mb_excel_scored_v2', 'IND'], ['mb_usa_scored_v2', 'USA']] as [string, Market][]) {
    const rows = readJSON(key);
    if (Array.isArray(rows)) for (const r of rows) {
      const v = ensure(r?.symbol); if (!v) continue;
      v.market = v.market || market;
      if (!v.fundo) v.fundo = { score: num(r?.score), grade: r?.grade ? String(r.grade) : null };
      v.sector = v.sector || String(r?.sector || r?.industry || '');
      v.company = v.company || String(r?.company || r?.name || '');
    }
  }

  // 3 · Conviction bench + decay
  try {
    for (const e of getConvictionList() as ConvictionEntry[]) {
      const v = ensure(e?.ticker); if (!v) continue;
      v.market = v.market || 'IND';
      v.company = v.company || e.company || '';
      v.sector = v.sector || String((e as any).sector || '');
      if (!v.bench) v.bench = { tier: String(e.tier || ''), score: num(e.composite_score), filingDate: e.filing_date || null };
      if (!v.decay) { try { v.decay = assessDecay(e as any); } catch { /* keep null */ } }
    }
  } catch { /* bench unreadable */ }

  // 4 · Holdings
  try {
    for (const [s, h] of getPortfolioMap()) {
      const v = ensure(s); if (!v) continue;
      v.holding = h;
      if (!v.market && h.market) v.market = h.market === 'US' ? 'USA' : 'IND';
    }
  } catch { /* no book */ }

  // 5 · Saved valuations (best-effort — shape varies across saves)
  try {
    const saved = readJSON('mc_saved_valuations_v1') || readJSON('mc:valuations:v1');
    if (Array.isArray(saved)) for (const sv of saved) {
      const v = ensure(sv?.ticker); if (!v || v.valuation) continue;
      const base = sv?.result?.cases?.find?.((c: any) => c?.label === 'BASE');
      v.valuation = { fairValue: num(base?.fairValue ?? base?.value ?? sv?.fairValue), savedAt: sv?.savedAt || sv?.created_at || null };
    }
  } catch { /* optional */ }

  return out;
}

/** Single-symbol convenience. */
export function getEngineView(symbol: string): EngineView | null {
  return getEngineViews().get(norm(symbol)) || null;
}

/** How many engines have an opinion on this symbol. */
export function engineCount(v: EngineView): number {
  return (v.fundo ? 1 : 0) + (v.tech ? 1 : 0) + (v.bench ? 1 : 0) + (v.holding ? 1 : 0) + (v.valuation?.fairValue ? 1 : 0);
}

// ── Global passport bus ──────────────────────────────────────────────────────
// Any component can open the Stock Passport for a symbol without imports
// crossing page boundaries: dispatch + listen on a window CustomEvent.
export const PASSPORT_EVENT = 'mc:passport:open';
export function openPassport(symbol: string) {
  if (typeof window === 'undefined') return;
  const s = norm(symbol); if (!s) return;
  window.dispatchEvent(new CustomEvent(PASSPORT_EVENT, { detail: { symbol: s } }));
}

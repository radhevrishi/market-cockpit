'use client';
// zzz999 — the owner's holdings for the Pine Screener's "My portfolio" company list and chart check. Read from the stores the app
// already uses — never a copy, never hard-coded:
//   India = the Portfolio page's saved holdings (server /api/portfolio + this browser's mc_portfolio_holdings, BSE codes matched to
//           NSE symbols) — the same book resolveIndiaBook gives Portfolio Catalysts / Exit Radar;
//   USA   = the US portfolio book (/api/v1/us-book?view=universe), positions only (bench names are candidates, not holdings).
import { loadIndiaBookInput, readLocalBookInput } from '../thesis/book-sources';
import { resolveIndiaBook } from '../thesis/book-membership';
import { normTicker } from './pine-view';
import type { ScreenMarket } from './types';

export interface Holdings { market: ScreenMarket; tickers: string[]; error: string | null; source: string }

/** This browser's India holdings, instantly (the first paint; the server copy follows). */
export function localIndiaHoldings(): string[] {
  try { return resolveIndiaBook({ server: null, ...readLocalBookInput() }).names.map((n) => normTicker(n.symbol)).filter(Boolean); } catch { return []; }
}

export async function loadHoldings(market: ScreenMarket, signal?: AbortSignal): Promise<Holdings> {
  if (market === 'IN') {
    try {
      const book = resolveIndiaBook(await loadIndiaBookInput());
      const tickers = Array.from(new Set(book.names.map((n) => normTicker(n.symbol)).filter(Boolean)));
      return { market, tickers, error: book.serverError || null, source: 'Portfolio page (saved holdings)' };
    } catch (e: any) {
      return { market, tickers: localIndiaHoldings(), error: String(e?.message || e), source: 'this browser only' };
    }
  }
  try {
    const r = await fetch('/api/v1/us-book?view=universe', { cache: 'no-store', signal });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) return { market, tickers: [], error: `The US book could not be read (HTTP ${r.status})`, source: 'US portfolio book' };
    const u: any[] = Array.isArray(j.universe) ? j.universe : [];
    const tickers = Array.from(new Set(u.filter((x) => x && x.origin !== 'bench' && x.listing !== 'NON_US').map((x) => normTicker(x.ticker)).filter(Boolean)));
    return { market, tickers, error: j.ok === false ? (j.error || 'The US book could not be read') : null, source: 'US portfolio book' };
  } catch (e: any) {
    return { market, tickers: [], error: String(e?.message || e), source: 'US portfolio book' };
  }
}

// zzz999 — "Open in Pine Screener": the Stock Screener hands the companies its actions apply to over to the Pine Screener, which
// uses them as its company list ("From the Stock Screener: <screen>"). Kept in this tab only (sessionStorage). Pure helpers.
import type { ScreenMarket } from './types';

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** Upper case, no exchange prefix or .NS / .BO suffix, no NSE series suffix — never merges two different companies. */
export function normTicker(s: unknown): string {
  return String(s ?? '').trim().toUpperCase().replace(/^(NSE|BSE|BOM|NASDAQ|NYSE|AMEX):/, '').replace(/\.(NS|BO|BSE|NSE)$/, '').replace(/-(EQ|BE|SM|ST|BZ)$/, '');
}
export const PINE_HANDOFF_KEY = 'mc:pine-handoff:v1';
export interface PineHandoff { market: ScreenMarket; label: string; tickers: string[]; at: number }
export function cleanHandoff(raw: unknown): PineHandoff | null {
  const x = (raw && typeof raw === 'object' ? raw : null) as any;
  if (!x || (x.market !== 'US' && x.market !== 'IN') || !Array.isArray(x.tickers)) return null;
  const tickers = Array.from(new Set<string>(x.tickers.map(normTicker).filter((t: string) => /^[A-Z0-9&.\-]{1,24}$/.test(t)))).slice(0, 5000);
  if (!tickers.length) return null;
  return { market: x.market, label: typeof x.label === 'string' && x.label.trim() ? x.label.trim().slice(0, 80) : 'Stock Screener result', tickers, at: fin(x.at) ? x.at : 0 };
}
export function makeHandoff(market: ScreenMarket, label: string, tickers: readonly string[], now = Date.now()): PineHandoff | null {
  return cleanHandoff({ market, label, tickers, at: now });
}


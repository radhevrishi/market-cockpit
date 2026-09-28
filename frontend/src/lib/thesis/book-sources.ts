// zzz823 — reads every place an India "book" has ever lived, for
// resolveIndiaBook (lib/thesis/book-membership) to decide from. Only the
// Portfolio page's saved holdings (server /api/portfolio + this browser's
// mc_portfolio_holdings) are members; the old keys and the synced snapshot
// are read so the Book check can say what was ignored. Client only.

import { CHAT_ID } from '@/lib/config';
import { symbolsFromStoredValue } from './universe';
import type { IndiaBookInput, ReadList } from './book-membership';

export const SAVED_HOLDINGS_KEY = 'mc_portfolio_holdings';
export const OLD_HOLDING_KEYS = ['portfolioHoldings', 'mc_portfolio_tickers', 'mc_portfolio_holdings_v1'] as const;

function ls(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage.getItem(key); } catch { return null; }
}

/** This browser's saved holdings and old lists — instant, no network. */
export function readLocalBookInput(): Pick<IndiaBookInput, 'browser' | 'legacy'> {
  const legacy: Record<string, string[]> = {};
  for (const k of OLD_HOLDING_KEYS) legacy[k] = symbolsFromStoredValue(ls(k));
  return { browser: symbolsFromStoredValue(ls(SAVED_HOLDINGS_KEY)), legacy };
}

/** The Portfolio page's server copy. A failure is reported, never "empty". */
export async function fetchSavedHoldings(): Promise<ReadList> {
  try {
    const r = await fetch(`/api/portfolio?chatId=${encodeURIComponent(CHAT_ID)}&_=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return { ok: false, symbols: [], error: `/api/portfolio answered HTTP ${r.status}` };
    const j = await r.json();
    const hs: any[] = Array.isArray(j?.holdings) ? j.holdings : [];
    return { ok: true, symbols: hs.map((h) => String(h?.symbol || '')).filter(Boolean), updatedAt: j?.source === 'default' ? null : (j?.updatedAt || null) };
  } catch (e: any) {
    return { ok: false, symbols: [], error: String(e?.message || e) };
  }
}

/** The synced book snapshot's held flags — reported only. */
export async function fetchSyncedHeld(): Promise<ReadList> {
  try {
    const r = await fetch('/api/v1/book/state?feed=0', { cache: 'no-store' });
    if (!r.ok) return { ok: false, symbols: [], error: `book/state answered HTTP ${r.status}` };
    const j = await r.json();
    const t: any[] = Array.isArray(j?.book?.tickers) ? j.book.tickers : [];
    return { ok: true, symbols: t.filter((x) => x?.held).map((x) => String(x.ticker || '')).filter(Boolean), updatedAt: j?.updatedAt || null };
  } catch (e: any) {
    return { ok: false, symbols: [], error: String(e?.message || e) };
  }
}

/** Everything, for one resolveIndiaBook call. */
export async function loadIndiaBookInput(): Promise<IndiaBookInput> {
  const [server, synced] = await Promise.all([fetchSavedHoldings(), fetchSyncedHeld()]);
  return { ...readLocalBookInput(), server, synced };
}

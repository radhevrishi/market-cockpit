// zzz397 — Book Watch: client → server sync.
//
// Assembles "the book" from the browser's localStorage (holdings + conviction
// bench + watchlist + decision snapshots) and POSTs it to /api/v1/book/sync so
// it survives a closed tab and the book-watch cron can evaluate it even when no
// tab is open. Fire-and-forget, debounced, never throws into the caller.
//
// Client-only module (touches window/localStorage). Import from client
// components and gate calls on mount / relevant cross-tab events.

import { CHAT_ID } from '@/lib/config';
import { readDecisions } from '@/lib/decisions';
import { readConvictionBeats } from '@/lib/conviction-beats';

const PORTFOLIO_KEY = 'mc_portfolio_holdings';
const WATCHLIST_KEY = 'mc_watchlist_tickers';

interface BookTickerPayload {
  ticker: string;
  company?: string;
  held?: boolean;
  benched?: boolean;
  watchlisted?: boolean;
  market?: 'IN' | 'US';
  decisionStatus?: string;
  scoreAtDecision?: number;
  gradeAtDecision?: string;
  priceAtDecision?: number;
  benchTier?: 'BLOCKBUSTER' | 'STRONG';
  entryPrice?: number;
  quantity?: number;
}

function canon(t: any): string {
  return String(t || '').toUpperCase().trim();
}

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Build the book payload from localStorage. Returns null when the book is empty. */
export function buildBookPayload(): { chatId: string; tickers: BookTickerPayload[] } | null {
  if (typeof window === 'undefined') return null;
  const map = new Map<string, BookTickerPayload>();
  const upsert = (ticker: string): BookTickerPayload => {
    const key = canon(ticker);
    let e = map.get(key);
    if (!e) { e = { ticker: key }; map.set(key, e); }
    return e;
  };

  // holdings
  try {
    const holdings = readJSON<any[]>(PORTFOLIO_KEY, []);
    for (const h of holdings || []) {
      const sym = canon(h?.symbol);
      if (!sym) continue;
      const e = upsert(sym);
      e.held = true;
      if (typeof h?.entryPrice === 'number') e.entryPrice = h.entryPrice;
      if (typeof h?.quantity === 'number') e.quantity = h.quantity;
      if (h?.notes && !e.company) e.company = String(h.notes).slice(0, 120);
    }
  } catch { /* ignore */ }

  // conviction bench
  try {
    const bench = readConvictionBeats() as Record<string, any>;
    for (const key of Object.keys(bench || {})) {
      const entry = bench[key];
      const sym = canon(entry?.ticker || key.split('@')[0]);
      if (!sym) continue;
      const e = upsert(sym);
      e.benched = true;
      if (entry?.company && !e.company) e.company = String(entry.company).slice(0, 120);
      if (entry?.tier === 'BLOCKBUSTER' || entry?.tier === 'STRONG') e.benchTier = entry.tier;
    }
  } catch { /* ignore */ }

  // watchlist (plain string[])
  try {
    const watch = readJSON<string[]>(WATCHLIST_KEY, []);
    for (const w of watch || []) {
      const sym = canon(w);
      if (!sym) continue;
      upsert(sym).watchlisted = true;
    }
  } catch { /* ignore */ }

  // decision snapshots
  try {
    const decisions = readDecisions() as Record<string, any>;
    for (const sym of Object.keys(decisions || {})) {
      const d = decisions[sym];
      const key = canon(sym);
      if (!key) continue;
      const e = upsert(key);
      if (d?.company && !e.company) e.company = String(d.company).slice(0, 120);
      if (['BUY', 'WATCH', 'NEUTRAL', 'REJECTED'].includes(d?.status)) e.decisionStatus = d.status;
      if (typeof d?.scoreAtDecision === 'number') e.scoreAtDecision = d.scoreAtDecision;
      if (d?.gradeAtDecision) e.gradeAtDecision = String(d.gradeAtDecision).slice(0, 8);
      if (typeof d?.priceAtDecision === 'number') e.priceAtDecision = d.priceAtDecision;
      if (d?.market === 'US') e.market = 'US';
      else if (d?.market === 'IN') e.market = 'IN';
    }
  } catch { /* ignore */ }

  const tickers = Array.from(map.values());
  if (!tickers.length) return null;
  return { chatId: CHAT_ID, tickers };
}

let _timer: ReturnType<typeof setTimeout> | null = null;
let _lastHash = '';

/** POST the current book to the server. Fire-and-forget; never throws. */
export async function syncBookNow(): Promise<void> {
  try {
    const payload = buildBookPayload();
    if (!payload) return;
    // skip a no-op resend if nothing changed since last sync
    const hash = JSON.stringify(payload.tickers);
    if (hash === _lastHash) return;
    _lastHash = hash;
    await fetch('/api/v1/book/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
      keepalive: true,
    });
  } catch { /* fire-and-forget */ }
}

/** Debounced sync — safe to call on every relevant event. */
export function scheduleBookSync(delayMs = 2500): void {
  if (typeof window === 'undefined') return;
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(() => { void syncBookNow(); }, delayMs);
}

'use client';
// zzz1042 — runs the My Book → watchlist sync (lib/watchlist-book-sync.ts) while the /charts watchlist panel is open:
// once shortly after load (after the first cross-device sync has had a chance to bring the newest lists), every 3 minutes
// while the page is visible, when the India book changes (this tab, another tab, or another device), and on "Sync now".
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BookMarket, WlStore } from '@/lib/chart-watchlist';
import { CHART_WATCHLISTS_KEY } from '@/lib/chart-watchlist';
import { pollWhenVisible } from '@/lib/client-fetch';
import {
  BOOK_POLL_MS, BOOK_SYNC_TIMES_KEY, autoLinkSections, indiaBookHoldings, linkedSection, readSyncTimes, syncBookSection, syncSummary,
  usBookHoldings, type BookRead,
} from '@/lib/watchlist-book-sync';

const INDIA_BOOK_KEY = 'mc_portfolio_holdings';
const FIRST_RUN_MS = 8_000;

function readIndia(): BookRead {
  let raw: string | null = null;
  try { raw = localStorage.getItem(INDIA_BOOK_KEY); } catch { return { ok: false, reason: 'India book could not be read (storage blocked)' }; }
  if (raw == null) return indiaBookHoldings(null);
  try { return indiaBookHoldings(JSON.parse(raw)); } catch { return { ok: false, reason: 'India book could not be read' }; }
}
async function readUs(): Promise<BookRead> {
  try {
    const r = await fetch('/api/v1/us-book?view=universe', { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return { ok: false, reason: r.status === 401 || r.status === 403 ? 'US book needs you to be signed in' : `US book could not be read (HTTP ${r.status})` };
    return usBookHoldings(await r.json());
  } catch { return { ok: false, reason: 'US book could not be read (network)' }; }
}
/** Read every linked book once (the US book only when a section is linked to it). Exported for the manual link preview. */
export async function readBooks(s: WlStore | null): Promise<Partial<Record<BookMarket, BookRead>>> {
  const out: Partial<Record<BookMarket, BookRead>> = {};
  if (!s) return out;
  if (linkedSection(s, 'IN')) out.IN = readIndia();
  if (linkedSection(s, 'US')) out.US = await readUs();
  return out;
}
export async function readBook(book: BookMarket): Promise<BookRead> { return book === 'IN' ? readIndia() : readUs(); }

export interface BookSyncState {
  lastAt: Partial<Record<BookMarket, number>>;
  /** why the last run of a book changed nothing (book not readable) */
  note: Partial<Record<BookMarket, string>>;
  busy: boolean;
}

export function useBookWatchlistSync(store: WlStore | null, update: (fn: (s: WlStore) => WlStore) => void, say: (m: string) => void) {
  const storeRef = useRef(store);
  const sayRef = useRef(say);
  useEffect(() => { storeRef.current = store; sayRef.current = say; });
  const running = useRef(false);
  const [state, setState] = useState<BookSyncState>(() => {
    let raw: unknown = null;
    try { raw = JSON.parse(localStorage.getItem(BOOK_SYNC_TIMES_KEY) || 'null'); } catch { /* display only */ }
    return { lastAt: readSyncTimes(raw), note: {}, busy: false };
  });

  const run = useCallback(async (manual: boolean, only?: BookMarket) => {
    if (running.current) return;
    const start = storeRef.current;
    if (!start) return;
    running.current = true;
    setState((st) => ({ ...st, busy: true }));
    try {
      // first run: link "India Portfolio" / "USA Portfolio" once
      const auto = autoLinkSections(start);
      if (auto.store !== start) update((s) => autoLinkSections(s).store);
      const books = await readBooks(auto.store);
      const now = Date.now();
      const lastAt: Partial<Record<BookMarket, number>> = {}; const note: Partial<Record<BookMarket, string>> = {};
      const lines: string[] = [];
      for (const book of ['IN', 'US'] as const) {
        const read = books[book];
        if (!read || (only && only !== book)) continue;
        // measured on the latest lists the panel has, then applied to whatever the lists are when React runs the update
        const base = autoLinkSections(storeRef.current || auto.store).store;
        const res = syncBookSection(base, book, read, { auto: !manual });
        if (res.store !== base) update((s) => syncBookSection(autoLinkSections(s).store, book, read, { auto: !manual }).store);
        if (read.ok) lastAt[book] = now; else note[book] = read.reason;
        const line = syncSummary(book, res, manual);
        if (line) lines.push(line);
      }
      if (manual && !books.IN && !books.US) lines.push('No section is linked to My Book yet. Right-click a section header → Keep in sync with My Book.');
      setState((st) => {
        const next = { ...st.lastAt, ...lastAt };
        try { localStorage.setItem(BOOK_SYNC_TIMES_KEY, JSON.stringify(next)); } catch { /* display only */ }
        const n = { ...st.note }; for (const b of ['IN', 'US'] as const) if (lastAt[b]) delete n[b];
        return { lastAt: next, note: { ...n, ...note }, busy: false };
      });
      if (lines.length) sayRef.current(lines.join(' '));
    } finally {
      running.current = false;
      setState((st) => (st.busy ? { ...st, busy: false } : st));
    }
  }, [update]);

  useEffect(() => {
    const first = setTimeout(() => { void run(false); }, FIRST_RUN_MS);
    const stop = pollWhenVisible(() => { void run(false); }, BOOK_POLL_MS);
    const onStorage = (e: StorageEvent) => { if (e.key === INDIA_BOOK_KEY) void run(false, 'IN'); };
    const onRestored = (e: Event) => {
      const keys = (e as CustomEvent).detail?.keys;
      if (Array.isArray(keys) && (keys.includes(INDIA_BOOK_KEY) || keys.includes(CHART_WATCHLISTS_KEY))) setTimeout(() => { void run(false); }, 500);
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('mc:vault:restored', onRestored);
    return () => { clearTimeout(first); stop(); window.removeEventListener('storage', onStorage); window.removeEventListener('mc:vault:restored', onRestored); };
  }, [run]);

  return { ...state, syncNow: (only?: BookMarket) => run(true, only) };
}

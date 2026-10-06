// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { normalizeTicker } from '@/lib/tickers';
import { type ConvictionEntry } from '@/lib/conviction-beats';
import { type EarningsScanCard } from '@/components/EarningsScanCard';
import { COL_PREFS_KEY, DEFAULT_TICKERS, STORAGE_KEY, RICH_LS_KEY, RICH_TTL_MS } from './constants';
import { type OptionalCol, type StockQuote, type RichCache, type HubFilters } from './types';

export function loadColPrefs(): Set<OptionalCol> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(COL_PREFS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr as OptionalCol[] : []);
  } catch { return new Set(); }
}

export function saveColPrefs(cols: Set<OptionalCol>): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(COL_PREFS_KEY, JSON.stringify(Array.from(cols))); } catch {}
}

// ── Utilities ──────────────────────────────────────────────────────────────────

export const getStoredTickers = (): string[] => {
  if (typeof window === 'undefined') return DEFAULT_TICKERS;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : DEFAULT_TICKERS;
  } catch {
    return DEFAULT_TICKERS;
  }
};

export const setStoredTickers = (tickers: string[]) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tickers));
  } catch {
    // Storage error silently handled
  }
};

// PATCH 0445 BUG-020/037 — Always include the 6 optional columns when
// fetching quotes. Previously the response mapper dropped marketCap /
// volume / 52w / avgVolume / peRatio, so toggling the column chooser
// surfaced '—' in every row. Now they ride along on every map call.
export const fetchStockQuotes = async (market: string = 'india'): Promise<StockQuote[]> => {
  // PATCH 0464 — bounded fetch. Previously this could hang the watchlist
  // refresh loop if /api/market/quotes was slow; AbortController fires at
  // 12s so the page never stalls indefinitely.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25_000); // PATCH 1037
  try {
    const res = await fetch(`/api/market/quotes?market=${market}`, { signal: ctl.signal });
    if (!res.ok) throw new Error('Failed to fetch quotes');
    const data = await res.json();
    return (data.stocks || []).map((stock: any) => ({
      ticker: stock.ticker,
      company: stock.company || stock.ticker,
      sector: stock.sector || '—',
      industry: stock.industry || '—',
      price: stock.price || 0,
      change: stock.change || 0,
      changePercent: stock.changePercent || 0,
      dayHigh: stock.dayHigh || stock.price || 0,
      dayLow: stock.dayLow || stock.price || 0,
      // PATCH 0445 — optional columns
      volume: stock.volume ?? null,
      marketCap: stock.marketCap ?? stock.mcap ?? null,
      previousClose: stock.previousClose ?? null,
      week52High: stock.week52High ?? stock.fiftyTwoWeekHigh ?? null,
      week52Low: stock.week52Low ?? stock.fiftyTwoWeekLow ?? null,
      peRatio: stock.peRatio ?? stock.pe ?? null,
      avgVolume: stock.avgVolume ?? stock.averageDailyVolume3Month ?? null,
    }));
  } catch (error) {
    console.error('Error fetching quotes:', error);
    return [];
  } finally {
    clearTimeout(timer);
  }
};

// Fetch individual quotes for tickers not in any index (small/micro-cap)
export const fetchIndividualQuotes = async (symbols: string[]): Promise<StockQuote[]> => {
  if (symbols.length === 0) return [];
  try {
    // Batch in groups of 20 (API cap)
    const results: StockQuote[] = [];
    for (let i = 0; i < symbols.length; i += 20) {
      const batch = symbols.slice(i, i + 20);
      // Normalize tickers and URL-encode them to handle special chars like &
      const normalizedBatch = batch.map(s => encodeURIComponent(normalizeTicker(s)));
      // PATCH 0464 — per-batch 10s timeout. Without this, a single hung
      // batch could block the whole watchlist refresh.
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 25_000); // PATCH 1037
      let res: Response;
      try {
        res = await fetch(`/api/market/quote?symbols=${normalizedBatch.join(',')}`, { signal: ctl.signal });
      } catch {
        clearTimeout(timer);
        continue;
      }
      clearTimeout(timer);
      if (!res.ok) continue;
      const data = await res.json();
      results.push(...(data.stocks || []).map((stock: any) => ({
        ticker: stock.ticker,
        company: stock.company || stock.ticker,
        sector: stock.sector || '—',
        industry: stock.industry || '—',
        price: stock.price || 0,
        change: stock.change || 0,
        changePercent: stock.changePercent || 0,
        dayHigh: stock.dayHigh || stock.price || 0,
        dayLow: stock.dayLow || stock.price || 0,
        // PATCH 0445 — optional columns
        volume: stock.volume ?? null,
        marketCap: stock.marketCap ?? stock.mcap ?? null,
        previousClose: stock.previousClose ?? null,
        week52High: stock.week52High ?? stock.fiftyTwoWeekHigh ?? null,
        week52Low: stock.week52Low ?? stock.fiftyTwoWeekLow ?? null,
        peRatio: stock.peRatio ?? stock.pe ?? null,
        avgVolume: stock.avgVolume ?? stock.averageDailyVolume3Month ?? null,
      })));
    }
    return results;
  } catch (error) {
    console.error('Error fetching individual quotes:', error);
    return [];
  }
};

export function readRichCache(): RichCache {
  if (typeof window === 'undefined') return { cards: {} };
  try {
    const raw = localStorage.getItem(RICH_LS_KEY);
    if (!raw) return { cards: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.cards) return { cards: {} };
    return parsed as RichCache;
  } catch { return { cards: {} }; }
}

export function writeRichCache(c: RichCache) {
  if (typeof window === 'undefined') return;
  // PATCH 0541 — prune TTL-expired entries on write so the cache doesn't
  // grow unbounded over time as users add/remove conviction entries.
  // 24h TTL on cards, but allow a 7-day grace (older entries removed).
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const pruned: RichCache = { cards: {} };
  for (const [k, v] of Object.entries(c.cards)) {
    if (v?.ts && v.ts > cutoff) pruned.cards[k] = v;
  }
  try { localStorage.setItem(RICH_LS_KEY, JSON.stringify(pruned)); } catch {
    // Quota exceeded — wipe entirely rather than half-write.
    try { localStorage.removeItem(RICH_LS_KEY); } catch {}
  }
}

/** Returns the cached card for a ticker if it's fresh, else null. */
export function getCachedCard(ticker: string, cache: RichCache): EarningsScanCard | null {
  const key = ticker.toUpperCase();
  const entry = cache.cards[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > RICH_TTL_MS) return null;
  return entry.card;
}

export function audienceFromCard(c: EarningsScanCard, watchlistTickers: Set<string>, portfolioTickers: Set<string>): 'PORTFOLIO' | 'WATCHLIST' | 'BOTH' | 'BANK' {
  const sym = c.symbol.toUpperCase();
  if (c.isBanking) return 'BANK';
  const inP = portfolioTickers.has(sym);
  const inW = watchlistTickers.has(sym);
  if (inP && inW) return 'BOTH';
  if (inP) return 'PORTFOLIO';
  return 'WATCHLIST';
}

export function passesHubFilter(c: EarningsScanCard, f: HubFilters, watchlist: Set<string>, portfolio: Set<string>): boolean {
  if (f.grades.size > 0 && !f.grades.has(c.grade)) return false;
  if (f.scoreMin != null && c.totalScore < f.scoreMin) return false;
  if (f.divergenceOnly && (!c.divergence || c.divergence === 'None')) return false;
  if (f.dataQuality.size > 0 && !f.dataQuality.has(c.dataQuality)) return false;
  if (f.audience.size > 0) {
    const a = audienceFromCard(c, watchlist, portfolio);
    if (!f.audience.has(a)) return false;
  }
  return true;
}

// DRIFT — always-visible thesis-break tell. A BLOCKBUSTER/STRONG bench name
// whose post-print cumulative move (move_pct, already on the entry — no fetch
// needed) has faded materially (<= -12%) is the market flagging a low-quality
// beat: the earliest sell signal. Computed the same way for the row chip, the
// tab-header summary, and the Book Watch arming effect so they never disagree.
// move_pct is the primary field; it is server-computed from the filing anchor
// to the most-recent close, so no live-price fetch or reference is required.
export function cbDriftState(e: ConvictionEntry): { drifting: boolean; movePct: number | null } {
  const tier = String(e?.tier || '').toUpperCase();
  const tierMatch = tier === 'BLOCKBUSTER' || tier === 'STRONG';
  const m = typeof e?.move_pct === 'number' && Number.isFinite(e.move_pct) ? (e.move_pct as number) : null;
  return { drifting: tierMatch && m != null && m <= -12, movePct: m };
}

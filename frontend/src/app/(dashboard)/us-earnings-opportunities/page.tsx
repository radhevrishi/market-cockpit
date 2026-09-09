'use client';

// ═══════════════════════════════════════════════════════════════════════════
// US EARNINGS OPPORTUNITIES — the US sibling of /earnings-opportunities.
//
// Same tier vocabulary, same card grammar, same accent colours as the India
// page, so the two read identically. Everything India-specific is replaced:
// ₹Cr → $M, IST → ET, Screener → SEC EDGAR.
//
// THE ONE UX DIFFERENCE FROM INDIA, AND WHY
// ──────────────────────────────────────────
// India's page is date-pinned because NSE/BSE publish the numbers with the
// announcement. In the US the 8-K announces and the 10-Q carries the XBRL, and
// they can be days or weeks apart — so a strict single-day view would show a
// near-empty page most days. This page therefore defaults to a ROLLING WINDOW
// (5 sessions) and states plainly how many filers are still waiting on their
// XBRL, rather than pretending they don't exist.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getCachedDay, putCachedDay, clearDayCache, scrubLegacyDayCaches } from '@/lib/us-day-cache';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Star, ExternalLink, RefreshCw, ChevronDown, ChevronRight, Award, AlertTriangle } from 'lucide-react';
import { syncUsConviction } from '@/lib/conviction-beats-us';
import {
  fmtUsd, fmtPct, US_TIER_ORDER,
  type UsGradedRow, type EarningsTier,
} from '@/lib/us-earnings-core';
import { debouncedSetItem, getItemSync } from '@/lib/debounced-storage';
import { mergeDayPayloads, windowSessions, chunkRange, type DayPayload } from '@/lib/us-merge';
// The card itself — shared with /us-conviction-beats so the two tabs can never
// drift apart again. See src/components/us-earnings-card.tsx.
import { UsEarningsCard, TIER_META, QUADRANT_META, rowKey, panelId, num } from '@/components/us-earnings-card';

interface PendingFiler {
  ticker: string; company: string; form: string; filed: string;
  filing_url: string; reason: 'xbrl-not-posted' | 'quarter-stale' | 'no-price' | 'reported-earlier';
}

interface UsPayload {
  filing_date: string | null;
  window_days: number;
  window_start: string | null;
  candidates_total: number;
  raw_items_total: number;
  pending_xbrl_total: number;
  no_price_total: number;
  by_tier: Record<EarningsTier, UsGradedRow[]>;
  pending?: PendingFiler[];
  scheduled?: Expected[];
  generated_at: string;
  truncated: boolean;
  notes: string[];
}

interface CalendarTicker { ticker: string; company: string; form: '8-K' | '10-Q' | '10-K'; filing_url: string; }
interface Expected {
  ticker: string; company: string; time: 'pre-market' | 'after-hours' | 'unknown';
  market_cap_musd: number | null; fiscal_quarter: string | null;
  eps_estimate: number | null; estimates_n: number | null; eps_last_year: number | null;
}
interface CalendarDay {
  date: string; weekend: boolean; future?: boolean; count: number;
  tickers: string[]; entries?: CalendarTicker[]; expected?: Expected[]; eightK: number; periodic: number;
  reported_elsewhere?: number;
}
interface CalendarPayload {
  from: string; to: string; total: number; days: CalendarDay[]; generated_at: string;
}


// v2 — the v1 namespace could hold a scan that returned 0 of N filers (a
// transient price-source failure) and then serve it back for a quarter of an
// hour, which looked exactly like a broken engine. Bumping the prefix orphans
// every such entry instantly; the scrub below reclaims their space.
// v3 — one entry per SESSION rather than per window, so widening 5d → 10d
// re-uses the five days already on disk and fetches only the new ones.
const LS_PREFIX = 'mc:graded-us:v3:';
const LS_CAL_PREFIX = 'mc:cal-us:v1:';
/** How many day-scans may be in flight at once. Three keeps the first rows on
 *  screen quickly without asking the server to sweep the whole window at once. */
const DAY_CONCURRENCY = 3;
/** Selectable windows, in TRADING SESSIONS (weekends are skipped), so 60d is
 *  roughly three calendar months. Every session is fetched and cached on its
 *  own, so widening the window only costs the days that are actually missing —
 *  which is what makes the long ones practical at all. */
const WINDOWS = [1, 3, 5, 10, 30, 60, 80];
/** Past this, say plainly that the first sweep takes minutes. */
const LONG_WINDOW_DAYS = 30;
/** How many day payloads to keep in localStorage. A day now carries 16 quarters
 *  of history and a balance sheet for every filer on it, so an 80-session sweep
 *  would blow the ~5MB quota several times over. Writes fail silently when it
 *  does — the page still renders, it just stops caching, and every revisit
 *  re-scans from scratch. So the oldest days are evicted instead. */
const MAX_CACHED_DAYS = 90;
/** How many CALENDAR chunks may be in flight. Two, not eight: the calendar
 *  route serialises its EDGAR calls behind one ~6 req/s gate, so running more
 *  chunks at once does not make the sweep faster — it only makes each chunk's
 *  own 300s ceiling arrive before its data does. */
const CAL_CONCURRENCY = 2;
/** Give a chunk the whole of the route's budget, then give up on it. */
const CAL_TIMEOUT_MS = 290_000;
const LS_DATE = 'mc:us-eo:v1:date';
const LS_DAYS = 'mc:us-eo:v1:days';
const LS_SCRUB = 'mc:graded-us:scrub:v3';

/**
 * Keep the day cache under `MAX_CACHED_DAYS`, oldest first.
 *
 * The key carries the session date, so "oldest" needs no bookkeeping: the day
 * furthest in the past is the one least likely to be asked for again.
 */
function evictOldestDays(keep = MAX_CACHED_DAYS): number {
  try {
    const days: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_PREFIX)) days.push(k);
    }
    if (days.length <= keep) return 0;
    days.sort();                                   // ISO dates sort chronologically
    const kill = days.slice(0, days.length - keep);
    for (const k of kill) localStorage.removeItem(k);
    return kill.length;
  } catch { return 0; }
}

/** Cache one day, making room for it if the quota is already full. */
function cacheDay(day: string, payload: unknown): void {
  const body = JSON.stringify({ ...(payload as object), _cachedAt: new Date().toISOString() });
  try {
    localStorage.setItem(LS_PREFIX + day, body);
  } catch {
    // Quota. Drop the oldest quarter of the cache and try once more; if it
    // still will not fit, the page renders fine uncached.
    evictOldestDays(Math.floor(MAX_CACHED_DAYS * 0.75));
    try { localStorage.setItem(LS_PREFIX + day, body); } catch { /* uncached */ }
  }
}

function scrubOldCaches() {
  try {
    if (localStorage.getItem(LS_SCRUB) === '1') return;
    const kill: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('mc:graded-us:v1:') || k.startsWith('mc:graded-us:v2:'))) kill.push(k);
    }
    for (const k of kill) localStorage.removeItem(k);
    localStorage.setItem(LS_SCRUB, '1');
  } catch { /* storage unavailable */ }
}

/** ET-anchored today. US markets close at 16:00 ET; anchoring at UTC-4 keeps
 *  "today" correct for anyone loading the page from Europe after the close. */
function etToday(): string {
  return new Date(Date.now() - 4 * 3600_000).toISOString().slice(0, 10);
}

/** One cached SESSION. A completed session is immutable on EDGAR, so it is held
 *  for a day; today's keeps moving as 8-Ks land, so it expires in 10 minutes. */
function readCache(key: string, isToday: boolean): UsPayload | null {
  try {
    const raw = getItemSync(LS_PREFIX + key);
    if (!raw) return null;
    const o = JSON.parse(raw);
    const age = Date.now() - Date.parse(o?._cachedAt || '');
    const maxAge = isToday ? 10 * 60_000 : 30 * 24 * 3600_000;
    if (!Number.isFinite(age) || age > maxAge) return null;
    if (!o?.by_tier) return null;
    // A scan that found filers but graded NONE of them is a failed scan, not a
    // result. Never serve it from cache — refetch.
    if ((o.raw_items_total ?? 0) > 0 && (o.candidates_total ?? 0) === 0) return null;
    return o as UsPayload;
  } catch { return null; }
}

/** Only cache a payload worth keeping — see readCache. */
function cacheable(p: UsPayload): boolean {
  if (!p?.by_tier) return false;
  if ((p.raw_items_total ?? 0) > 0 && (p.candidates_total ?? 0) === 0) return false;
  return true;
}

export default function UsEarningsOpportunitiesPage() {
  const today = etToday();
  const [date, setDate] = useState<string>(() => {
    try { return getItemSync(LS_DATE) || today; } catch { return today; }
  });
  const [days, setDays] = useState<number>(() => {
    try { return parseInt(getItemSync(LS_DAYS) || '5', 10) || 5; } catch { return 5; }
  });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    BLOCKBUSTER: true, STRONG: true, MIXED: false, AVOID: false,
  });
  const [minCap, setMinCap] = useState<number | null>(null);
  const [capBucket, setCapBucket] = useState<string>('all');
  const [forceKey, setForceKey] = useState(0);
  const [viewMode, setViewMode] = useState<'GRADED' | 'CALENDAR'>('GRADED');
  const [calDays, setCalDays] = useState(30);
  const [quality, setQuality] = useState<{
    elite: boolean; pead70: boolean; multibagger: boolean; beatCheap: boolean;
    rule40: boolean; roce20: boolean; turnaround: boolean; compounder: boolean;
  }>({
    elite: false, pead70: false, multibagger: false, beatCheap: false,
    rule40: false, roce20: false, turnaround: false, compounder: false,
  });
  const [showPending, setShowPending] = useState(false);
  const [openDays, setOpenDays] = useState<Record<string, boolean>>({});
  const [calSearch, setCalSearch] = useState('');
  // Which cards have their detail panel open.
  //
  // Held HERE rather than inside the card, and keyed by ticker + period end
  // rather than by list position, because the list is rebuilt constantly: each
  // session's payload merges in as it lands, the rows re-sort, and a PRELIM row
  // moves from one tier section to another the moment its 10-Q posts (which
  // unmounts the card and would drop any state it owned). Ticker + period end
  // is the only identity that survives all three; filing_date stands in for the
  // handful of rows whose period end is not tagged yet.
  const [openCards, setOpenCards] = useState<Set<string>>(() => new Set());
  const toggleCard = useCallback((k: string) => {
    setOpenCards((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });
  }, []);

  // The day cache lives in IndexedDB now (see src/lib/us-day-cache.ts for why).
  // This drops the localStorage generations it replaces, once.
  useEffect(() => { scrubOldCaches(); scrubLegacyDayCaches(); }, []);
  useEffect(() => { try { debouncedSetItem(LS_DATE, date); } catch {} }, [date]);
  useEffect(() => { try { debouncedSetItem(LS_DAYS, String(days)); } catch {} }, [days]);

  const isToday = date >= today;
  // One request per session in the window, newest first. Each lands and paints
  // on its own; a day already in localStorage is never re-fetched (a completed
  // session cannot change), so only the gaps cost anything.
  const sessions = useMemo(() => windowSessions(date, days), [date, days]);
  // How many of those days are allowed to be in flight. Starts at the
  // concurrency limit and walks forward as days settle (a state value, so the
  // gate cannot depend on the query results it controls).
  const [readyUpto, setReadyUpto] = useState(DAY_CONCURRENCY);
  useEffect(() => { setReadyUpto(DAY_CONCURRENCY); }, [date, days, forceKey]);

  const dayQueries = useQueries({
    queries: sessions.map((d, i) => ({
      queryKey: ['graded-us-day', d, forceKey],
      queryFn: async (): Promise<DayPayload> => {
        if (forceKey === 0) {
          const cached = await getCachedDay(d, d >= today);
          if (cached) return cached as unknown as DayPayload;
        }
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 240_000);
        try {
          const res = await fetch(
            `/api/v1/earnings/graded-us?date=${d}&days=1${forceKey > 0 ? '&force=1' : ''}`,
            { cache: 'no-store', signal: ctrl.signal },
          );
          if (!res.ok) throw new Error(`Grading failed for ${d} (HTTP ${res.status})`);
          const payload = await res.json();
          void putCachedDay(d, payload);
          return payload;
        } finally { clearTimeout(timer); }
      },
      // Stagger: only the first few days start immediately; the rest queue up as
      // earlier ones settle, so the server is never asked to sweep the whole
      // window at once.
      enabled: i < readyUpto,
      staleTime: d >= today ? 3 * 60_000 : 24 * 3600_000,
      refetchOnWindowFocus: false,
      retry: 1,
    })),
  });
  const settledCount = dayQueries.filter((q: any) => q.isSuccess || q.isError).length;
  const loadedCount = dayQueries.filter((q: any) => q.isSuccess).length;
  const failedDays = sessions.filter((_, i) => (dayQueries[i] as any)?.isError);
  useEffect(() => { setReadyUpto((v) => Math.max(v, settledCount + DAY_CONCURRENCY)); }, [settledCount]);

  const data: UsPayload | undefined = useMemo(() => {
    const parts = dayQueries.map((q: any) => q.data as DayPayload | undefined).filter(Boolean) as DayPayload[];
    if (!parts.length) return undefined;
    return mergeDayPayloads(parts, date, sessions[sessions.length - 1] || date, days) as unknown as UsPayload;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayQueries.map((q: any) => (q.data ? (q.data as any).generated_at : '')).join('|'), date, days]);

  const isLoading = loadedCount === 0 && dayQueries.some((q: any) => q.isFetching);
  const isFetching = dayQueries.some((q: any) => q.isFetching);
  const error = loadedCount === 0 ? ((dayQueries.find((q: any) => q.isError) as any)?.error ?? null) : null;
  // THE ONLY THING THAT SHOULD EVER RE-SWEEP A WHOLE WINDOW. Ordinary visits
  // read every completed session out of the cache; this button is the user
  // saying "throw it away and rebuild", so it empties the store first.
  const refetch = () => { void clearDayCache(); setForceKey((k) => k + 1); };

  // Push BLOCKBUSTER / STRONG (and demotions) onto the US bench.
  //
  // THE WHOLE ROW GOES, NOT A HAND-PICKED SUBSET — this is the fix for
  // "the cards are not the same".
  //
  // This block used to copy about forty named fields onto the bench entry. The
  // OTHER write path — /us-conviction-beats' own sweep — spreads the entire
  // graded row (`{ ...c, source_url: c.filing_url }`). Both call the same
  // `usBenchFields()` mapper, but a mapper can only map what it is handed: every
  // field the mapper reads and this list did not name came out `null` on the ADD
  // path and populated on the REFRESH path. Twenty-two fields behaved that way —
  // series, context, vs_guide, guide_change, guidance_figures, key_metrics,
  // eps_gaap_yoy_pct, eps_adj_curr/_prev/_yoy_pct/_swing, eps_swing,
  // net_income_swing, fcf_swing, fcf_curr/_prev_musd, fcf_yoy_pct,
  // net_income_prev_musd, reaction_date, prelim_matched, release_url — which is
  // exactly why a name that arrived here read one way and the same name after a
  // sweep read another. Spreading the row makes the two paths byte-identical,
  // and keeps them identical for any field added to the payload later.
  useEffect(() => {
    if (!data?.by_tier) return;
    const entries: any[] = [];
    for (const tier of US_TIER_ORDER) {
      for (const c of (data.by_tier[tier] || [])) entries.push({ ...c, source_url: c.filing_url });
    }
    if (entries.length) syncUsConviction(entries);
  }, [data]);

  // Calendar sweep — EDGAR index for the past, Nasdaq schedule for today and
  // ahead. Cheap (no XBRL, no prices) and only fetched when the tab is open.
  // The range runs `calDays` back from the selected date and up to 14 days
  // forward so upcoming reporters are always in view.
  const calFrom = useMemo(
    () => new Date(Date.parse(date + 'T00:00:00Z') - (calDays - 1) * 86400000).toISOString().slice(0, 10),
    [date, calDays]);
  const calTo = useMemo(() => {
    const ahead = calDays === 1 ? 0 : 14;
    const t = new Date(Date.parse(date + 'T00:00:00Z') + ahead * 86400000).toISOString().slice(0, 10);
    const cap = new Date(Date.parse(today + 'T00:00:00Z') + 45 * 86400000).toISOString().slice(0, 10);
    return t > cap ? cap : t;
  }, [date, calDays, today]);
  // The calendar sweeps a range that can be 90 days long. Fetch it in 10-day
  // chunks so the grid fills in as they land, and cache each chunk: moving the
  // range by a week then re-fetches one chunk, not ninety days.
  //
  // ORDER AND CONCURRENCY — why this is gated the same way the day scans are
  // ──────────────────────────────────────────────────────────────────────────
  // Every chunk used to be `enabled` at once. That looks like parallelism and
  // is not: the calendar route funnels every EDGAR call through one process-wide
  // ~6 req/s gate, so eight simultaneous chunks do not divide the work, they
  // queue behind each other while each one's own clock keeps running. Measured
  // against the live route, the 2026-07-29 → 2026-08-07 chunk (peak earnings
  // season, 2,367 filings) returns in 100s on its own and DIED at 301s — past
  // the route's 300s ceiling — when it was one of eight in flight. The result
  // on screen was exactly what was reported: "1/8 chunks loaded…" that never
  // moved, one day of names, and every other day rendered empty because its
  // chunk had never landed.
  //
  // So the chunks are run a couple at a time, newest first (the selected date
  // sits at the far end of the range, and that is the part a reader looks at),
  // with the same `readyUpto` state-plus-effect the day loader uses — a state
  // value, so the gate never depends on the query results it controls.
  const calChunks = useMemo(
    // newest chunk first: `calFrom` is ~two months back, `calTo` two weeks ahead,
    // so descending order paints the days around the selected date immediately.
    () => chunkRange(calFrom, calTo, 10).slice().reverse(),
    [calFrom, calTo]);
  const [calReadyUpto, setCalReadyUpto] = useState(CAL_CONCURRENCY);
  useEffect(() => { setCalReadyUpto(CAL_CONCURRENCY); }, [calFrom, calTo, forceKey, viewMode]);
  const calQueries = useQueries({
    queries: calChunks.map(([a, b], i) => ({
      queryKey: ['calendar-us', a, b, forceKey],
      queryFn: async (): Promise<CalendarPayload> => {
        const key = `${LS_CAL_PREFIX}${a}|${b}`;
        const chunkHasToday = b >= today;
        if (forceKey === 0) {
          try {
            const raw = getItemSync(key);
            if (raw) {
              const o = JSON.parse(raw);
              const age = Date.now() - Date.parse(o?._cachedAt || '');
              const maxAge = chunkHasToday ? 10 * 60_000 : 30 * 24 * 3600_000;
              if (Number.isFinite(age) && age < maxAge && Array.isArray(o?.days)) return o as CalendarPayload;
            }
          } catch { /* storage unavailable */ }
        }
        // A chunk that has not answered inside the route's own ceiling is not
        // going to; aborting turns it into a named failure the strip can report
        // and retry, instead of a pending query that pins the counter forever.
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), CAL_TIMEOUT_MS);
        try {
          const res = await fetch(
            `/api/v1/earnings/calendar-us?from=${a}&to=${b}${forceKey > 0 ? '&force=1' : ''}`,
            { cache: 'no-store', signal: ctrl.signal },
          );
          if (!res.ok) throw new Error(`Calendar failed for ${a} → ${b} (HTTP ${res.status})`);
          const payload = await res.json();
          try { debouncedSetItem(key, JSON.stringify({ ...payload, _cachedAt: new Date().toISOString() })); } catch {}
          return payload;
        } finally { clearTimeout(timer); }
      },
      enabled: viewMode === 'CALENDAR' && i < calReadyUpto,
      staleTime: b >= today ? 10 * 60_000 : 24 * 3600_000,
      refetchOnWindowFocus: false,
      // One retry for a transient EDGAR 403 — but never for a timeout, which
      // would simply spend another four minutes holding the gate shut.
      retry: (n: number, err: any) => n < 1 && err?.name !== 'AbortError',
    })),
  });
  const calFetching = calQueries.some((q: any) => q.isFetching);
  const calLoaded = calQueries.filter((q: any) => q.isSuccess).length;
  const calSettled = calQueries.filter((q: any) => q.isSuccess || q.isError).length;
  const calFailed = calChunks
    .filter((_, i) => (calQueries[i] as any)?.isError)
    .map(([a, b]) => `${a} → ${b}`);
  useEffect(() => {
    if (viewMode !== 'CALENDAR') return;
    setCalReadyUpto((v) => Math.max(v, calSettled + CAL_CONCURRENCY));
  }, [calSettled, viewMode]);
  const cal: CalendarPayload | undefined = useMemo(() => {
    const parts = calQueries.map((q: any) => q.data as CalendarPayload | undefined).filter(Boolean) as CalendarPayload[];
    if (!parts.length) return undefined;
    const days = parts.flatMap((p) => p.days || []);
    days.sort((a, b) => a.date.localeCompare(b.date));
    const seen = new Set<string>();
    const uniq = days.filter((d) => (seen.has(d.date) ? false : (seen.add(d.date), true)));
    return {
      from: calFrom, to: calTo, days: uniq,
      total: uniq.reduce((n, d) => n + (d.count || 0), 0),
      generated_at: parts.map((p) => p.generated_at).sort().pop() || new Date().toISOString(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calQueries.map((q: any) => (q.data ? (q.data as any).generated_at + ':' + (q.data as any).from : '')).join('|'), calFrom, calTo]);

  const allRows = useMemo(() => {
    if (!data?.by_tier) return [] as UsGradedRow[];
    return US_TIER_ORDER.flatMap((t) => data.by_tier[t] || []);
  }, [data]);

  const passes = (r: UsGradedRow) => {
    if (minCap != null && (r.market_cap_musd == null || r.market_cap_musd < minCap)) return false;
    if (capBucket !== 'all') {
      const b = r.market_cap_bucket;
      if (capBucket === 'smid') { if (b !== 'small' && b !== 'mid') return false; }
      else if (b !== capBucket) return false;
    }
    if (quality.elite && !r.is_elite) return false;
    // Rule of 40 and ROCE filters. A row whose score could not be computed is
    // excluded rather than assumed to pass — the filter is a claim about the
    // company, and we cannot make it without the numbers.
    if (quality.rule40 && !((r as any).rule40?.passes === true)) return false;
    if (quality.roce20 && !(num((r as any).roce?.pct) != null && (r as any).roce.pct >= 20)) return false;
    // The quadrant filters. A row with no quadrant on it (an older cached day,
    // graded before the second axis existed) is cut rather than assumed — the
    // same rule the Rule-of-40 and ROCE chips above follow.
    if (quality.turnaround && (r as any).quadrant !== 'TURNAROUND ACCELERATOR') return false;
    if (quality.compounder && (r as any).quadrant !== 'COMPOUNDER') return false;
    if (quality.pead70 && (r.pead_score ?? 0) < 70) return false;
    if (quality.multibagger && !r.multibagger_setup) return false;
    // "Beat + Cheap" — real growth that the market has not yet re-rated.
    if (quality.beatCheap) {
      if ((r.sales_yoy_pct ?? -1) < 15) return false;
      if (r.pe == null || r.pe <= 0 || r.pe > 30) return false;
    }
    return true;
  };

  const view = useMemo(() => {
    const out: Record<EarningsTier, UsGradedRow[]> = { BLOCKBUSTER: [], STRONG: [], MIXED: [], AVOID: [] };
    if (!data?.by_tier) return out;
    for (const t of US_TIER_ORDER) out[t] = (data.by_tier[t] || []).filter(passes);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, minCap, capBucket, quality]);

  const shownTotal = US_TIER_ORDER.reduce((n, t) => n + view[t].length, 0);

  // Expand-all works on every row that passes the filters, whether or not its
  // tier section happens to be collapsed — the toggle is about the cards, not
  // about the sections.
  const visibleKeys = useMemo(
    () => US_TIER_ORDER.flatMap((t) => view[t].map(rowKey)),
    [view],
  );
  const allCardsOpen = visibleKeys.length > 0 && visibleKeys.every((k) => openCards.has(k));
  const toggleAllCards = () => {
    setOpenCards((s) => {
      if (allCardsOpen) {
        const n = new Set(s);
        for (const k of visibleKeys) n.delete(k);
        return n;
      }
      const n = new Set(s);
      for (const k of visibleKeys) n.add(k);
      return n;
    });
  };

  const counts = useMemo(() => {
    const c = {
      BLOCKBUSTER: 0, STRONG: 0, MIXED: 0, AVOID: 0,
      elite: 0, pead70: 0, multibagger: 0, beatCheap: 0, rule40: 0, roce20: 0,
      turnaround: 0, compounder: 0,
      mega: 0, large: 0, mid: 0, small: 0, micro: 0,
    } as Record<string, number>;
    for (const r of allRows) {
      c[r.tier]++;
      if (r.is_elite) c.elite++;
      if ((r.pead_score ?? 0) >= 70) c.pead70++;
      if (r.multibagger_setup) c.multibagger++;
      if ((r.sales_yoy_pct ?? -1) >= 15 && r.pe != null && r.pe > 0 && r.pe <= 30) c.beatCheap++;
      if ((r as any).rule40?.passes === true) c.rule40++;
      if (num((r as any).roce?.pct) != null && (r as any).roce.pct >= 20) c.roce20++;
      if ((r as any).quadrant === 'TURNAROUND ACCELERATOR') c.turnaround++;
      if ((r as any).quadrant === 'COMPOUNDER') c.compounder++;
      if (r.market_cap_bucket) c[r.market_cap_bucket]++;
    }
    return c;
  }, [allRows]);

  const download = (name: string, text: string, mime = 'text/csv') => {
    try {
      const blob = new Blob([text], { type: `${mime};charset=utf-8;` });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    } catch { /* download blocked — nothing else to do */ }
  };

  const exportCsv = () => {
    const rows = US_TIER_ORDER.flatMap((t) => view[t]);
    const head = ['Ticker', 'Company', 'Tier', 'Quadrant', 'Quality', 'Inflection', 'Score', 'Quarter', 'Filed', 'Rev YoY %', 'EPS YoY %',
      'OPM %', 'OPM prev %', 'CFO/NI', 'PEAD', 'RS', 'Stage', 'Mkt cap $M', 'Price', 'P/E', 'D1 %', 'Sector', 'Filing'];
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const body = rows.map((r) => [r.ticker, r.company, r.tier,
      (r as any).quadrant ?? '', (r as any).quality_score ?? '', (r as any).inflection_score ?? '',
      r.composite_score, r.quarter, r.filing_date,
      r.sales_yoy_pct?.toFixed(1) ?? '', r.eps_yoy_pct?.toFixed(1) ?? '',
      r.opm_pct?.toFixed(2) ?? '', r.opm_prev_pct?.toFixed(2) ?? '',
      r.cfo_to_pat_ratio?.toFixed(2) ?? '', r.pead_score, r.rs_rating ?? '', r.stage ?? '',
      r.market_cap_musd?.toFixed(0) ?? '', r.price?.toFixed(2) ?? '', r.pe ?? '',
      r.d1_pct?.toFixed(2) ?? '', r.sector ?? '', r.filing_url ?? ''].map(esc).join(','));
    download(`us-earnings-${date}-${days}d.csv`, [head.map(esc).join(','), ...body].join('\n'));
  };

  const exportTradingView = () => {
    const rows = US_TIER_ORDER.flatMap((t) => view[t]);
    download(`us-earnings-${date}-tradingview.txt`, rows.map((r) => r.ticker).join(','), 'text/plain');
  };

  const shiftDate = (n: number) => {
    const d = new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000);
    const iso = d.toISOString().slice(0, 10);
    // The calendar may look ahead (Nasdaq schedule); grading never goes past today.
    const cap = viewMode === 'CALENDAR'
      ? new Date(Date.parse(today + 'T00:00:00Z') + 45 * 86400000).toISOString().slice(0, 10)
      : today;
    setDate(iso > cap ? cap : iso);
  };

  return (
    <div style={{ padding: '20px', maxWidth: 1500, margin: '0 auto' }}>
      {/* ── header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <Star className="w-5 h-5" style={{ color: '#F59E0B' }} />
        <h1 style={{ fontSize: 'var(--mc-text-h3)', fontWeight: 800, color: 'var(--mc-text-0)', margin: 0 }}>
          US Earnings Opportunities
        </h1>
        <span style={{
          fontSize: 'var(--mc-text-xs)', fontWeight: 700, padding: '3px 8px', borderRadius: 999,
          border: '1px solid var(--mc-cyan)', color: 'var(--mc-cyan)',
        }}>NYSE · NASDAQ</span>
        <a href="/us-conviction-beats" style={{
          fontSize: 'var(--mc-text-xs)', fontWeight: 700, padding: '3px 10px', borderRadius: 999,
          border: '1px solid var(--mc-warn)', color: 'var(--mc-warn)', textDecoration: 'none',
          display: 'inline-flex', alignItems: 'center', gap: 5,
        }}><Award className="w-3 h-3" /> US Conviction Beats →</a>
      </div>
      <p style={{ color: 'var(--mc-text-3)', fontSize: 'var(--mc-text-sm)', margin: '0 0 16px' }}>
        Every US company that filed results in the window, graded on the same scale as the India engine.
        Numbers come straight from the SEC EDGAR XBRL filings — not an aggregator — with prices and the
        post-earnings reaction from daily bars. Educational, not investment advice.
      </p>

      {/* ── controls ── */}
      <div style={{
        display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
        padding: 12, borderRadius: 'var(--mc-radius)', backgroundColor: 'var(--mc-bg-1)',
        border: '1px solid var(--mc-bg-4)', marginBottom: 16,
      }}>
        <button onClick={() => shiftDate(-1)} style={btn()}>←</button>
        <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)}
          style={{ ...btn(), padding: '6px 10px', colorScheme: 'light dark' }} />
        <button onClick={() => shiftDate(1)} style={btn()}>→</button>
        <button onClick={() => setDate(today)} style={btn(date === today)}>Today</button>

        <span style={{ color: 'var(--mc-text-3)', fontSize: 'var(--mc-text-xs)', marginLeft: 8 }}>Window</span>
        {WINDOWS.map((d) => (
          <button key={d} onClick={() => setDays(d)} style={btn(days === d)}
            title={d >= LONG_WINDOW_DAYS
              ? `${d} trading sessions. The first sweep of a window this long takes several minutes — days paint as they land and are then cached, so it is only slow once.`
              : `${d} trading session${d === 1 ? '' : 's'}`}>
            {d}d
          </button>
        ))}

        <span style={{ width: 1, height: 22, backgroundColor: 'var(--mc-bg-4)', margin: '0 4px' }} />
        {[null, 300, 1000, 5000].map((c) => (
          <button key={String(c)} onClick={() => setMinCap(c)} style={btn(minCap === c)}>
            {c == null ? 'Any cap' : `≥ $${c >= 1000 ? `${c / 1000}B` : `${c}M`}`}
          </button>
        ))}

        <span style={{ flex: 1 }} />
        {viewMode === 'GRADED' && shownTotal > 0 && (
          <button onClick={toggleAllCards} style={btn(allCardsOpen)} aria-expanded={allCardsOpen}
            title="Open the full write-up on every card that passes the filters">
            {allCardsOpen ? '⊟ Collapse all' : `⊞ Expand all ${shownTotal}`}
          </button>
        )}
        <button onClick={exportCsv} style={btn()}>📊 CSV</button>
        <button onClick={exportTradingView} style={btn()}>📈 TradingView</button>
        <button onClick={() => { void clearDayCache(); setForceKey((k) => k + 1); }}
          disabled={isFetching} style={{ ...btn(), opacity: isFetching ? 0.5 : 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <RefreshCw className="w-3 h-3" style={{ animation: isFetching ? 'spin 1s linear infinite' : undefined }} />
          {isFetching ? `Scanning ${loadedCount}/${sessions.length}…` : 'Force re-scan'}
        </button>
      </div>

      {/* ── tier + quality + cap chips (counts are pre-filter, like India) ── */}
      {data && allRows.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          {US_TIER_ORDER.map((t) => (
            <span key={t} style={{
              fontSize: 'var(--mc-text-xs)', fontWeight: 800, padding: '5px 10px', borderRadius: 999,
              border: `1px solid ${TIER_META[t].color}`, color: TIER_META[t].color,
              backgroundColor: `color-mix(in srgb, ${TIER_META[t].color} 10%, transparent)`,
            }}>{TIER_META[t].icon} {t} {counts[t]}</span>
          ))}
          <span style={{ width: 1, height: 20, backgroundColor: 'var(--mc-bg-4)', margin: '0 2px' }} />
          <button onClick={() => setQuality((q) => ({ ...q, elite: !q.elite }))} style={btn(quality.elite, '#F59E0B')}>⭐ ELITE {counts.elite}</button>
          <button onClick={() => setQuality((q) => ({ ...q, pead70: !q.pead70 }))} style={btn(quality.pead70, '#EF4444')}>🔥 PEAD≥70 {counts.pead70}</button>
          <button onClick={() => setQuality((q) => ({ ...q, multibagger: !q.multibagger }))} style={btn(quality.multibagger, '#8B5CF6')}>💎 MULTIBAGGER {counts.multibagger}</button>
          <button onClick={() => setQuality((q) => ({ ...q, beatCheap: !q.beatCheap }))} style={btn(quality.beatCheap, '#10B981')}
            title="Revenue growth ≥15% YoY on a trailing P/E of 30 or less — growth the market has not re-rated yet.">
            💰 Beat + Cheap {counts.beatCheap}
          </button>
          <button onClick={() => setQuality((q) => ({ ...q, rule40: !q.rule40 }))} style={btn(quality.rule40, '#10B981')}
            title="Revenue growth % + free-cash-flow margin %, both trailing twelve months, at or above 40">
            ⚡ RULE OF 40 {counts.rule40}</button>
          <button onClick={() => setQuality((q) => ({ ...q, roce20: !q.roce20 }))} style={btn(quality.roce20, '#10B981')}
            title="Trailing-twelve-month operating income ÷ (total assets − current liabilities), at or above 20%">
            🏭 ROCE ≥20% {counts.roce20}</button>
          {/* THE SECOND AXIS, as two chips and not four.
              QUALITY and REJECT are not chips anyone reaches for: REJECT is a
              thing you filter OUT rather than in, and QUALITY overlaps almost
              exactly with the ROCE ≥20% and RULE OF 40 chips already on this
              row — a third way of asking the same question is clutter, and this
              row is already eight chips long. The two that earn their space are
              the two that cannot be expressed any other way here. */}
          <button onClick={() => setQuality((q) => ({ ...q, turnaround: !q.turnaround }))} style={btn(quality.turnaround, QUADRANT_META['TURNAROUND ACCELERATOR'].color)}
            title={QUADRANT_META['TURNAROUND ACCELERATOR'].tagline}>
            {QUADRANT_META['TURNAROUND ACCELERATOR'].icon} TURNAROUND ACCELERATOR {counts.turnaround}</button>
          <button onClick={() => setQuality((q) => ({ ...q, compounder: !q.compounder }))} style={btn(quality.compounder, QUADRANT_META.COMPOUNDER.color)}
            title={QUADRANT_META.COMPOUNDER.tagline}>
            {QUADRANT_META.COMPOUNDER.icon} COMPOUNDER {counts.compounder}</button>
          <span style={{ width: 1, height: 20, backgroundColor: 'var(--mc-bg-4)', margin: '0 2px' }} />
          {[['all', 'All caps', 0], ['smid', 'Small+Mid', counts.small + counts.mid],
            ['mega', 'MEGA ≥$200B', counts.mega], ['large', 'LARGE $10–200B', counts.large],
            ['mid', 'MID $2–10B', counts.mid], ['small', 'SMALL $300M–2B', counts.small],
            ['micro', 'MICRO <$300M', counts.micro]].map(([v, l, n]) => (
            <button key={String(v)} onClick={() => setCapBucket(String(v))} style={btn(capBucket === v)}>
              {l}{v === 'all' ? '' : ` ${n}`}
            </button>
          ))}
        </div>
      )}

      {/* ── coverage strip ── */}
      {data && (
        <div style={{
          display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16,
          padding: '10px 14px', borderRadius: 'var(--mc-radius)',
          backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)',
          fontSize: 'var(--mc-text-xs)', color: 'var(--mc-text-2)',
        }}>
          <span><b style={{ color: 'var(--mc-text-0)' }}>{data.raw_items_total}</b> filers {data.window_start ? `${data.window_start} → ${data.filing_date}` : ''}</span>
          <span><b style={{ color: 'var(--mc-text-0)' }}>{data.candidates_total}</b> graded</span>
          <span><b style={{ color: 'var(--mc-text-0)' }}>{shownTotal}</b> shown after filters</span>
          {data.pending_xbrl_total > 0 && (
            <span style={{ color: 'var(--mc-text-3)' }}>
              <AlertTriangle className="w-3 h-3" style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }} />
              {data.pending_xbrl_total} announced, XBRL not posted yet
            </span>
          )}
          {data.no_price_total > 0 && <span style={{ color: 'var(--mc-text-3)' }}>{data.no_price_total} without price history</span>}
          <span style={{ marginLeft: 'auto', color: 'var(--mc-text-4)' }}>
            SEC EDGAR · updated {new Date(data.generated_at).toLocaleTimeString()}
          </span>
        </div>
      )}

      {/* ── view toggle ── */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--mc-border-2)', marginBottom: 16 }}>
        {(['GRADED', 'CALENDAR'] as const).map((v) => (
          <button key={v} onClick={() => setViewMode(v)} style={{
            padding: '8px 14px', background: 'transparent', cursor: 'pointer',
            border: 'none', borderBottom: `2px solid ${viewMode === v ? 'var(--mc-cyan)' : 'transparent'}`,
            color: viewMode === v ? 'var(--mc-cyan)' : 'var(--mc-text-3)',
            fontWeight: 800, fontSize: 'var(--mc-text-sm)',
          }}>
            {v === 'GRADED' ? `Graded Tiers${data ? ` · ${shownTotal}` : ''}` : `Calendar${cal ? ` · ${cal.total} filings` : ''}`}
          </button>
        ))}
      </div>

      {isLoading && viewMode === 'GRADED' && (
        <div style={panel()}>
          <div style={{ color: 'var(--mc-text-2)' }}>
            Pulling {sessions[0]} from EDGAR, then the XBRL for each filer. Each session lands on its own —
            the first names appear in a few seconds, the rest fill in behind them.
          </div>
        </div>
      )}
      {viewMode === 'GRADED' && loadedCount > 0 && loadedCount < sessions.length && (
        <div style={{
          marginBottom: 12, borderRadius: 'var(--mc-radius)', padding: '8px 12px',
          backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderLeft: '3px solid var(--mc-cyan)',
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }}>
          <RefreshCw className="w-3 h-3" style={{ color: 'var(--mc-cyan)', animation: 'spin 1s linear infinite' }} />
          <span style={{ fontSize: 'var(--mc-text-xs)', color: 'var(--mc-text-2)' }}>
            <b style={{ color: 'var(--mc-text-0)' }}>{loadedCount} of {sessions.length} sessions</b> loaded —
            showing {allRows.length} graded so far; the remaining {sessions.filter((d) => !dayQueries[sessions.indexOf(d)]?.isSuccess).slice(0, 4).join(', ')}
            {sessions.length - loadedCount > 4 ? ' …' : ''} are still coming in. Days already scanned are read from cache and never re-fetched.
          </span>
          {days >= LONG_WINDOW_DAYS && (
            // A long window is worth waiting for, but only if the wait is
            // stated. Each session is a separate EDGAR sweep behind a ~6 req/s
            // gate, so 80 sessions is minutes, not seconds — and only ever
            // once, because every day is cached the moment it lands.
            <span style={{ fontSize: 10, color: 'var(--mc-text-4)', width: '100%', lineHeight: 1.5 }}>
              A {days}-session window is roughly {Math.round(days * 1.4)} calendar days and sweeps EDGAR once per
              session, so the first pass takes several minutes. Results appear as each day lands, filters and sorting
              work on what is already here, and nothing is scanned twice — reopening this window later is instant.
            </span>
          )}
        </div>
      )}
      {viewMode === 'GRADED' && failedDays.length > 0 && loadedCount > 0 && (
        <div style={{
          marginBottom: 12, borderRadius: 'var(--mc-radius)', padding: '8px 12px',
          backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderLeft: '3px solid #F59E0B',
          fontSize: 'var(--mc-text-xs)', color: 'var(--mc-text-2)',
        }}>
          ⚠ {failedDays.join(', ')} could not be scanned (EDGAR or the price source timed out). Everything else is shown.
          <button onClick={() => setForceKey((k) => k + 1)} style={{ ...btn(), marginLeft: 8 }}>retry those days</button>
        </div>
      )}
      {!!error && (
        <div style={{ ...panel(), borderLeft: '4px solid #EF4444' }}>
          <div style={{ color: '#EF4444', fontWeight: 700 }}>Could not grade this window</div>
          <div style={{ color: 'var(--mc-text-2)', fontSize: 'var(--mc-text-sm)', marginTop: 4 }}>
            {String((error as any)?.message || error)}
          </div>
        </div>
      )}

      {/* ── scheduled today, not yet filed (India's "results pending" flow) ── */}
      {viewMode === 'GRADED' && data && (data.scheduled?.length ?? 0) > 0 && (
        <div style={{
          marginBottom: 16, borderRadius: 'var(--mc-radius)', padding: '12px 14px',
          backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderLeft: '4px solid #8B5CF6',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ fontWeight: 800, color: 'var(--mc-text-0)' }}>🗓 SCHEDULED {date === today ? 'TODAY' : date} · RESULTS PENDING</span>
            <span style={{ fontWeight: 800, fontSize: 'var(--mc-text-xs)', padding: '2px 8px', borderRadius: 999, backgroundColor: 'color-mix(in srgb, #8B5CF6 14%, transparent)', color: '#8B5CF6' }}>{data.scheduled!.length}</span>
            <span style={{ color: 'var(--mc-text-3)', fontSize: 'var(--mc-text-xs)' }}>
              expected to report (Nasdaq schedule) but no 8-K on EDGAR yet — each moves into a tier as it files.
              Names marked <b style={{ color: '#F59E0B' }}>6-K</b> are foreign private issuers: they never file an 8-K, so they stay here.
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {data.scheduled!.slice(0, 80).map((e) => (
              <span key={e.ticker}
                title={`${e.company}${e.market_cap_musd ? ` · ${fmtUsd(e.market_cap_musd)}` : ''}${e.eps_estimate != null ? ` · consensus EPS $${e.eps_estimate.toFixed(2)}${e.estimates_n ? ` (${e.estimates_n} est.)` : ''}` : ''}${e.eps_last_year != null ? ` · last year $${e.eps_last_year.toFixed(2)}` : ''}`}
                style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6, border: '1px dashed #8B5CF6', color: 'var(--mc-text-2)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                {e.ticker}
                <span style={{ fontSize: 9, color: '#8B5CF6' }}>{e.time === 'pre-market' ? '☀ pre' : e.time === 'after-hours' ? '🌙 post' : ''}</span>
                {e.market_cap_musd != null && <span style={{ fontSize: 9, color: 'var(--mc-text-4)' }}>{fmtUsd(e.market_cap_musd)}</span>}
                {(e as any).foreign_filer && <span style={{ fontSize: 9, color: '#F59E0B' }} title="Foreign private issuer — reports on a 6-K, not an 8-K, so it is never graded here">6-K</span>}
              </span>
            ))}
            {data.scheduled!.length > 80 && <span style={{ fontSize: 10, color: 'var(--mc-text-4)', alignSelf: 'center' }}>+{data.scheduled!.length - 80} more — see Calendar</span>}
          </div>
        </div>
      )}

      {/* ── announced but not yet gradeable ── */}
      {viewMode === 'GRADED' && data && (data.pending?.length ?? 0) > 0 && (
        <div style={{
          marginBottom: 16, borderRadius: 'var(--mc-radius)', overflow: 'hidden',
          backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)',
          borderLeft: '4px solid var(--mc-info, #60A5FA)',
        }}>
          <button onClick={() => setShowPending((v) => !v)} style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
            background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
          }}>
            {showPending ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            <span style={{ fontWeight: 800, color: 'var(--mc-text-0)' }}>📋 IN THE WINDOW BUT NOT GRADED</span>
            <span style={{
              fontWeight: 800, fontSize: 'var(--mc-text-xs)', padding: '2px 8px', borderRadius: 999,
              backgroundColor: 'var(--mc-bg-3)', color: 'var(--mc-text-1)',
            }}>{data.pending!.length}</span>
            <span style={{ color: 'var(--mc-text-3)', fontSize: 'var(--mc-text-xs)' }}>
              numbers not posted yet, or already announced before the window — nothing was dropped silently
            </span>
          </button>
          {showPending && (
            <div style={{ padding: '0 14px 14px' }}>
              <div style={{ color: 'var(--mc-text-3)', fontSize: 'var(--mc-text-xs)', marginBottom: 10, lineHeight: 1.6 }}>
                A US company announces results in an <b>8-K (Item 2.02)</b>, but the tagged financials only reach
                EDGAR with the <b>10-Q/10-K</b> — sometimes the same day, often days or weeks later. These names
                move into a grade tier automatically as soon as their numbers post. Widening the window to 10d
                usually picks up most of them.
              </div>
              {([
                ['xbrl', 'Numbers not on EDGAR yet', (p: PendingFiler) => p.reason === 'xbrl-not-posted' || p.reason === 'quarter-stale'],
                ['earlier', 'Announced before this window — only the 10-Q or a follow-up 8-K landed here', (p: PendingFiler) => p.reason === 'reported-earlier'],
                ['price', 'No usable price history', (p: PendingFiler) => p.reason === 'no-price'],
              ] as Array<[string, string, (p: PendingFiler) => boolean]>).map(([k, label, pred]) => {
                const list = data.pending!.filter(pred);
                if (!list.length) return null;
                return (
                  <div key={k} style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--mc-text-3)', letterSpacing: 0.3, marginBottom: 5 }}>
                      {label.toUpperCase()} · {list.length}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {list.map((p) => (
                        <a key={`${p.ticker}-${p.filed}`} href={p.filing_url} target="_blank" rel="noreferrer"
                          title={`${p.company} · ${p.form} filed ${p.filed} · ${
                            p.reason === 'no-price' ? 'no price history (OTC / newly listed)'
                              : p.reason === 'quarter-stale' ? 'only the previous quarter is on file'
                              : p.reason === 'reported-earlier' ? `announced ${p.filed} — before this window`
                              : 'XBRL not posted yet'}`}
                          style={{
                            fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                            border: '1px solid var(--mc-bg-4)', color: k === 'earlier' ? 'var(--mc-text-3)' : 'var(--mc-text-2)',
                            textDecoration: 'none', backgroundColor: 'var(--mc-bg-2)',
                          }}>{p.ticker}{k === 'earlier' ? <span style={{ fontWeight: 500, color: 'var(--mc-text-4)' }}> {p.filed.slice(5)}</span> : null}</a>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── calendar ── */}
      {viewMode === 'CALENDAR' && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <button onClick={() => shiftDate(-calDays)} style={btn()} title={`Back ${calDays} days`}>⇤ {calDays}d</button>
            <button onClick={() => shiftDate(-1)} style={btn()} title="Back one day">←</button>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              style={{ ...btn(), padding: '6px 10px', colorScheme: 'light dark' }} />
            <button onClick={() => shiftDate(1)} style={btn()} title="Forward one day">→</button>
            <button onClick={() => shiftDate(calDays)} style={btn()} title={`Forward ${calDays} days`}>{calDays}d ⇥</button>
            <button onClick={() => setDate(today)} style={btn(date === today)}>Today</button>
            <span style={{ width: 1, height: 22, backgroundColor: 'var(--mc-bg-4)', margin: '0 4px' }} />
            <span style={{ color: 'var(--mc-text-3)', fontSize: 'var(--mc-text-xs)' }}>Show</span>
            {[1, 7, 14, 30, 60, 90].map((d) => (
              <button key={d} onClick={() => setCalDays(d)} style={btn(calDays === d)}>{d === 1 ? 'Day' : `${d}d`}</button>
            ))}
            <input value={calSearch} onChange={(e) => setCalSearch(e.target.value.toUpperCase())}
              placeholder="Find ticker…"
              style={{ ...btn(), padding: '6px 10px', minWidth: 120, fontWeight: 600 }} />
            <span style={{ flex: 1 }} />
            <span style={{ color: 'var(--mc-text-3)', fontSize: 'var(--mc-text-xs)' }}>
              {calFrom} → {calTo}{cal ? ` · ${cal.total} companies` : ''}
              {calLoaded < calChunks.length ? ` · ${calLoaded}/${calChunks.length} chunks loaded${calFetching ? '…' : ''}` : ''}
            </span>
            {cal && (
              <>
                <button style={btn()} onClick={() => {
                  const lines = ['Date,Ticker,Company,Form,Filing'];
                  for (const d of cal.days) for (const e of (d.entries || [])) lines.push(`${d.date},${e.ticker},"${e.company.replace(/"/g, '""')}",${e.form},${e.filing_url}`);
                  download(`us-earnings-calendar-${cal.from}_${cal.to}.csv`, lines.join('\n'));
                }}>📋 CSV</button>
                <button style={btn()} onClick={() => {
                  const all = Array.from(new Set(cal.days.flatMap((d) => d.tickers)));
                  download(`us-earnings-calendar-${cal.from}_${cal.to}-tradingview.txt`, all.join(','), 'text/plain');
                }}>📈 TradingView</button>
              </>
            )}
          </div>
          <div style={{ color: 'var(--mc-text-4)', fontSize: 'var(--mc-text-xs)', marginBottom: 12 }}>
            A company is listed on the day it <b>announced</b> (its 8-K press release). A 10-Q that follows is the
            same result, not a new event, so it is folded into the announcement day; the few names tagged{' '}
            <span style={{ padding: '0 4px', border: '1px solid var(--mc-bg-4)', borderRadius: 4 }}>10-Q</span> filed
            no press release — the 10-Q was their first disclosure. Click a day to grade it; click a ticker to open
            the SEC filing.
          </div>

          {calFailed.length > 0 && (
            <div style={{
              marginBottom: 10, borderRadius: 'var(--mc-radius)', padding: '8px 12px',
              backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderLeft: '3px solid #F59E0B',
              fontSize: 'var(--mc-text-xs)', color: 'var(--mc-text-2)',
            }}>
              ⚠ {calFailed.join(', ')} could not be swept — EDGAR timed out on{' '}
              {calFailed.length === 1 ? 'that range' : 'those ranges'}. Those days are simply not listed below;
              nothing was quietly shown as a quiet day. A narrower window (7d or 14d) almost always lands.
              <button onClick={() => setForceKey((k) => k + 1)} style={{ ...btn(), marginLeft: 8 }}>retry</button>
            </div>
          )}
          {!cal && calFetching && <div style={panel()}><span style={{ color: 'var(--mc-text-2)' }}>Sweeping EDGAR for {calFrom} → {calTo} in {calChunks.length} chunks, {CAL_CONCURRENCY} at a time — each fills in as it lands, and each is cached afterwards. A chunk in peak earnings season can take a minute or two on a cold cache.</span></div>}
          {!cal && !calFetching && calFailed.length === 0 && <div style={panel()}><span style={{ color: 'var(--mc-text-2)' }}>Loading the filing calendar…</span></div>}
          {!cal && !calFetching && calFailed.length > 0 && (
            <div style={{ ...panel(), borderLeft: '4px solid #EF4444' }}>
              <div style={{ color: '#EF4444', fontWeight: 700 }}>The calendar sweep failed</div>
              <div style={{ color: 'var(--mc-text-2)', fontSize: 'var(--mc-text-sm)', marginTop: 4 }}>
                No chunk of {calFrom} → {calTo} came back. Narrow the range (7d or 14d) and retry — a shorter sweep
                asks EDGAR for far fewer days and almost always lands.
              </div>
            </div>
          )}

          {cal && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {cal.days.slice().reverse().filter((d) => !calSearch || d.tickers.some((t) => t.includes(calSearch))).map((d) => {
                const dt = new Date(d.date + 'T00:00:00Z');
                const label = dt.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
                const isSel = d.date === date;
                const entries: CalendarTicker[] = d.entries
                  || d.tickers.map((t) => ({ ticker: t, company: t, form: '8-K' as const, filing_url: '' }));
                const expected: Expected[] = d.expected || [];
                const shown = calSearch ? entries.filter((e) => e.ticker.includes(calSearch)) : entries;
                const shownExp = calSearch ? expected.filter((e) => e.ticker.includes(calSearch)) : expected;
                const open = !!openDays[d.date] || !!calSearch || calDays === 1;
                const LIMIT = 30;
                const visible = open ? shown : shown.slice(0, LIMIT);
                const hidden = shown.length - visible.length;
                const visibleExp = open ? shownExp : shownExp.slice(0, LIMIT);
                const hiddenExp = shownExp.length - visibleExp.length;
                const isFuture = !!d.future;
                const isToday = d.date === today;
                const accent = isFuture ? '#8B5CF6' : 'var(--mc-cyan)';
                return (
                  <div key={d.date} style={{
                    padding: '10px 12px', borderRadius: 'var(--mc-radius)', backgroundColor: 'var(--mc-bg-1)',
                    border: `1px solid ${isSel ? 'var(--mc-cyan)' : 'var(--mc-bg-4)'}`,
                    borderLeft: `4px solid ${d.count ? accent : 'var(--mc-bg-4)'}`,
                    opacity: isFuture ? 0.95 : 1,
                  }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: (shown.length || shownExp.length) ? 8 : 0 }}>
                      <span style={{ minWidth: 110, color: isSel ? 'var(--mc-cyan)' : 'var(--mc-text-0)', fontWeight: 800, fontSize: 'var(--mc-text-sm)' }}>
                        {label}{isToday ? ' · today' : ''}
                      </span>
                      {shown.length > 0 && (
                        <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap', backgroundColor: 'color-mix(in srgb, var(--mc-cyan) 12%, transparent)', color: 'var(--mc-cyan)' }}>
                          📋 {shown.length} reported
                        </span>
                      )}
                      {shownExp.length > 0 && (
                        <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap', backgroundColor: 'color-mix(in srgb, #8B5CF6 12%, transparent)', color: '#8B5CF6' }}>
                          🗓 {shownExp.length} {isFuture ? 'scheduled' : (isToday ? 'still to report' : 'reported without an 8-K')}
                        </span>
                      )}
                      {!shown.length && !shownExp.length && (
                        <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 999, backgroundColor: 'var(--mc-bg-3)', color: 'var(--mc-text-4)' }}>
                          {d.weekend ? 'weekend' : isFuture ? 'nothing scheduled yet' : 'no filings'}
                        </span>
                      )}
                      {shown.length > 0 && (
                        <span style={{ fontSize: 10, color: 'var(--mc-text-4)', whiteSpace: 'nowrap' }}>
                          {d.eightK} press release{d.eightK === 1 ? '' : 's'}{d.periodic ? ` · ${d.periodic} 10-Q only` : ''}
                        </span>
                      )}
                      <span style={{ flex: 1 }} />
                      {shown.length > 0 && (
                        <button onClick={() => { setDate(d.date); setDays(1); setViewMode('GRADED'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                          style={btn(false, '#F59E0B')} title="Grade every company that reported this day">
                          ⭐ Grade this day →
                        </button>
                      )}
                      {(shown.length > LIMIT || shownExp.length > LIMIT) && (
                        <button onClick={() => setOpenDays((o) => ({ ...o, [d.date]: !o[d.date] }))} style={btn(open)}>
                          {open ? '▴ Collapse' : `▾ Show all ${shown.length + shownExp.length}`}
                        </button>
                      )}
                    </div>
                    {shown.length > 0 && (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: shownExp.length ? 6 : 0 }}>
                        {visible.map((e) => (
                          <a key={e.ticker} href={e.filing_url || undefined} target="_blank" rel="noreferrer"
                            title={`${e.company} · ${e.form}${e.filing_url ? ' · open SEC filing' : ''}`}
                            style={{
                              fontSize: 11, fontWeight: 700, padding: '3px 7px', borderRadius: 5, textDecoration: 'none',
                              border: '1px solid var(--mc-bg-4)',
                              color: e.form === '8-K' ? 'var(--mc-text-1)' : 'var(--mc-text-3)',
                              backgroundColor: e.form === '8-K' ? 'var(--mc-bg-2)' : 'transparent',
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                            }}>
                            {e.ticker}
                            {e.form !== '8-K' && <span style={{ fontSize: 9, color: 'var(--mc-text-4)', border: '1px solid var(--mc-bg-4)', borderRadius: 3, padding: '0 3px' }}>{e.form}</span>}
                          </a>
                        ))}
                        {hidden > 0 && (
                          <button onClick={() => setOpenDays((o) => ({ ...o, [d.date]: true }))} style={{ ...btn(), fontSize: 11, padding: '3px 8px' }}>
                            +{hidden} more ▾
                          </button>
                        )}
                      </div>
                    )}
                    {shownExp.length > 0 && (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {visibleExp.map((e) => (
                          <span key={e.ticker}
                            title={`${e.company}${e.market_cap_musd ? ` · ${fmtUsd(e.market_cap_musd)}` : ''}${e.fiscal_quarter ? ` · quarter ending ${e.fiscal_quarter}` : ''}${e.eps_estimate != null ? ` · consensus EPS $${e.eps_estimate.toFixed(2)}${e.estimates_n ? ` (${e.estimates_n} est.)` : ''}` : ''}${e.eps_last_year != null ? ` · last year $${e.eps_last_year.toFixed(2)}` : ''}`}
                            style={{
                              fontSize: 11, fontWeight: 700, padding: '3px 7px', borderRadius: 5,
                              border: '1px dashed #8B5CF6', color: 'var(--mc-text-2)', backgroundColor: 'transparent',
                              display: 'inline-flex', alignItems: 'center', gap: 5,
                            }}>
                            {e.ticker}
                            <span style={{ fontSize: 9, color: '#8B5CF6' }}>{e.time === 'pre-market' ? '☀ pre' : e.time === 'after-hours' ? '🌙 post' : ''}</span>
                            {e.eps_estimate != null && <span style={{ fontSize: 9, color: 'var(--mc-text-4)' }}>est ${e.eps_estimate.toFixed(2)}</span>}
                          </span>
                        ))}
                        {hiddenExp > 0 && (
                          <button onClick={() => setOpenDays((o) => ({ ...o, [d.date]: true }))} style={{ ...btn(), fontSize: 11, padding: '3px 8px' }}>
                            +{hiddenExp} more ▾
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {viewMode === 'GRADED' && data && shownTotal === 0 && !isLoading && (
        <div style={panel()}>
          <div style={{ fontWeight: 700, color: 'var(--mc-text-0)', marginBottom: 6 }}>Nothing graded in this window</div>
          <div style={{ color: 'var(--mc-text-2)', fontSize: 'var(--mc-text-sm)' }}>
            {data.raw_items_total > 0
              ? `${data.raw_items_total} companies filed, but none cleared the filters (or their XBRL has not posted yet). Try widening the window to 10d, or clearing the market-cap filter.`
              : 'No US earnings filings in this window — try a weekday during earnings season (the fortnight after each quarter end is the dense stretch).'}
          </div>
        </div>
      )}

      {/* ── tier sections ── */}
      {viewMode === 'GRADED' && US_TIER_ORDER.map((tier) => {
        const rows = view[tier];
        if (!rows.length) return null;
        const meta = TIER_META[tier];
        const open = expanded[tier];
        return (
          <div key={tier} style={{
            marginBottom: 18, borderRadius: 'var(--mc-radius)', overflow: 'hidden',
            backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)',
            borderLeft: `4px solid ${meta.color}`,
          }}>
            <button onClick={() => setExpanded((e) => ({ ...e, [tier]: !e[tier] }))}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
                background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
              }}>
              {open ? <ChevronDown className="w-4 h-4" style={{ color: meta.color }} /> : <ChevronRight className="w-4 h-4" style={{ color: meta.color }} />}
              <span style={{ fontSize: 16 }}>{meta.icon}</span>
              <span style={{ fontWeight: 800, color: meta.color, letterSpacing: 0.4 }}>{meta.label}</span>
              <span style={{
                fontWeight: 800, fontSize: 'var(--mc-text-xs)', padding: '2px 8px', borderRadius: 999,
                backgroundColor: `color-mix(in srgb, ${meta.color} 15%, transparent)`, color: meta.color,
              }}>{rows.length}</span>
              <span style={{ color: 'var(--mc-text-3)', fontSize: 'var(--mc-text-xs)' }}>{meta.tagline}</span>
            </button>
            {open && (
              <div style={{
                // `min(380px, 100%)` rather than a bare 380px: identical at any
                // width the card grid actually uses, but on a 360px phone the
                // track collapses to the viewport instead of overflowing it,
                // which is what keeps an open panel from scrolling the page
                // sideways.
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(380px, 100%), 1fr))',
                gap: 12, padding: '0 14px 14px',
              }}>
                {rows.map((r) => {
                  const k = rowKey(r);
                  return (
                    <UsEarningsCard key={`${r.ticker}:${r.filing_date}`} r={r}
                      open={openCards.has(k)} onToggle={() => toggleCard(k)} panelId={panelId(k)} />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      <div style={{ color: 'var(--mc-text-4)', fontSize: 'var(--mc-text-xs)', marginTop: 20, lineHeight: 1.6 }}>
        <b>How a US grade is built.</b> An earnings release is an 8-K carrying Item 2.02; the numbers come
        from the company&apos;s own XBRL tags in its 10-Q/10-K. Quarterly cash flow is de-cumulated from the
        year-to-date figure, a missing Q4 is derived as the full year minus its three quarters, and the
        year-ago quarter is matched by nearest period end so 52/53-week and non-calendar fiscal years line
        up. Operating margin uses GAAP <code>OperatingIncomeLoss</code>, which is why it can differ from a
        screener&apos;s &quot;normalized&quot; operating income. Market cap is SEC cover-page shares × last
        price. RS is a cohort percentile blended with performance versus SPY — it is our construction, not
        an IBD rating. The <b>quarter label</b> is the company&apos;s own — read from the release headline, so Dell&apos;s
        July quarter is Q2 FY27 and Zscaler&apos;s is Q4 FY26, exactly as the street names them.
        <b> Consensus</b> is the street (adjusted) estimate and the adjusted actual, both on the same basis, shown
        on their own line so they are never mixed with the GAAP tiles above them; when the estimate is within a
        dime of zero the beat is stated in cents, because a percentage off $0.00 is meaningless. A name that has
        reported but whose 10-Q hasn&apos;t reached EDGAR yet gets a <b>PRELIM</b> grade: revenue, operating income,
        net income and GAAP EPS are read from the earnings release itself and accepted only when the release&apos;s
        prior-year column reproduces last year&apos;s XBRL figure — otherwise the field stays blank. The full grade
        replaces it automatically when the 10-Q posts. Upcoming dates in the calendar are Nasdaq&apos;s schedule and
        update as companies confirm; foreign private issuers (marked 6-K) report without an 8-K and are never graded.
      </div>
      <style>{'@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}'}</style>
    </div>
  );
}

function btn(active = false, color = 'var(--mc-cyan)'): React.CSSProperties {
  return {
    fontSize: 'var(--mc-text-xs)', fontWeight: 700, padding: '6px 10px',
    borderRadius: 999, cursor: 'pointer',
    border: `1px solid ${active ? color : 'var(--mc-bg-4)'}`,
    color: active ? color : 'var(--mc-text-2)',
    backgroundColor: active ? `color-mix(in srgb, ${color} 12%, transparent)` : 'var(--mc-bg-2)',
  };
}
function panel(): React.CSSProperties {
  return {
    padding: 16, borderRadius: 'var(--mc-radius)', backgroundColor: 'var(--mc-bg-1)',
    border: '1px solid var(--mc-bg-4)', marginBottom: 16,
  };
}

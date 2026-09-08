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
import { useQueries, useQuery } from '@tanstack/react-query';
import { Star, ExternalLink, RefreshCw, ChevronDown, ChevronRight, ChevronUp, Award, AlertTriangle } from 'lucide-react';
import { syncUsConviction } from '@/lib/conviction-beats-us';
import {
  fmtUsd, fmtPx, fmtPct, US_TIER_ORDER, SWING_LABEL, SWING_GOOD,
  type UsGradedRow, type EarningsTier, type SwingKind,
} from '@/lib/us-earnings-core';
import { fmtGuideRange, GUIDE_METRIC_LABEL, type GuidanceFigure } from '@/lib/us-guidance-figures';
import { fmtKeyMetric, KEY_METRIC_LABEL, type KeyMetric, type KeyMetricId } from '@/lib/us-key-metrics';
import { debouncedSetItem, getItemSync } from '@/lib/debounced-storage';
import { mergeDayPayloads, windowSessions, chunkRange, type DayPayload } from '@/lib/us-merge';

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

const TIER_META: Record<EarningsTier, { label: string; color: string; icon: string; tagline: string }> = {
  BLOCKBUSTER: { label: 'BLOCKBUSTER', color: '#F59E0B', icon: '🔥', tagline: 'Explosive growth, clean quality, market confirming' },
  STRONG: { label: 'STRONG', color: '#10B981', icon: '✅', tagline: 'Solid beat with at least one methodology passing' },
  MIXED: { label: 'MIXED', color: '#FACC15', icon: '⚠️', tagline: 'Growth present but with caveats — needs a second look' },
  AVOID: { label: 'AVOID', color: '#EF4444', icon: '⛔', tagline: 'Fails the bar on growth, quality or trend' },
};

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
const LS_DATE = 'mc:us-eo:v1:date';
const LS_DAYS = 'mc:us-eo:v1:days';
const LS_SCRUB = 'mc:graded-us:scrub:v3';

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
  const [quality, setQuality] = useState<{ elite: boolean; pead70: boolean; multibagger: boolean; beatCheap: boolean }>({
    elite: false, pead70: false, multibagger: false, beatCheap: false,
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

  useEffect(() => { scrubOldCaches(); }, []);
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
          const cached = readCache(d, d >= today);
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
          if (cacheable(payload)) {
            try {
              debouncedSetItem(LS_PREFIX + d, JSON.stringify({ ...payload, _cachedAt: new Date().toISOString() }));
            } catch { /* quota — it still renders, it just isn't cached */ }
          }
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
  const refetch = () => setForceKey((k) => k + 1);

  // Push BLOCKBUSTER / STRONG (and demotions) onto the US bench.
  useEffect(() => {
    if (!data?.by_tier) return;
    const entries: any[] = [];
    for (const tier of US_TIER_ORDER) {
      for (const c of (data.by_tier[tier] || [])) {
        entries.push({
          ticker: c.ticker, company: c.company, tier: c.tier,
          composite_score: c.composite_score,
          sales_yoy_pct: c.sales_yoy_pct, net_profit_yoy_pct: c.net_profit_yoy_pct, eps_yoy_pct: c.eps_yoy_pct,
          filing_date: c.filing_date, period_end: c.period_end,
          quarter: c.quarter, fiscal_year: c.fiscal_year, sector: c.sector, form: c.form,
          market_cap_musd: c.market_cap_musd, market_cap_bucket: c.market_cap_bucket,
          price: c.price, pe: c.pe,
          revenue_curr_musd: c.revenue_curr_musd, revenue_prev_musd: c.revenue_prev_musd,
          net_income_curr_musd: c.net_income_curr_musd,
          eps_curr: c.eps_curr, eps_prev: c.eps_prev, cfo_curr_musd: c.cfo_curr_musd,
          opm_pct: c.opm_pct, opm_prev_pct: c.opm_prev_pct, cfo_to_pat_ratio: c.cfo_to_pat_ratio,
          d1_pct: c.d1_pct, gap_pct: c.gap_pct, move_pct: c.move_pct,
          rs_rating: c.rs_rating, stage: c.stage, pct_from_52w_high: c.pct_from_52w_high,
          addv_musd: c.addv_musd, vol_ratio_20d: c.vol_ratio_20d,
          quarters_revenue: c.quarters_revenue, quarters_eps: c.quarters_eps, quarters_opm: c.quarters_opm,
          close_30d: (c as any).close_30d,
          is_elite: c.is_elite, pead_score: c.pead_score, multibagger_setup: c.multibagger_setup,
          is_financial: (c as any).is_financial,
          caveat_tags: c.caveat_tags, methodology_tags: c.methodology_tags, narrative: c.narrative,
          prelim: !!(c as any).prelim, eps_estimate: (c as any).eps_estimate ?? null,
          eps_adj: (c as any).eps_adj ?? null,
          guidance: (c as any).guidance ?? null, guidance_score: (c as any).guidance_score ?? null,
          guidance_snippets: (c as any).guidance_snippets ?? null, guidance_url: (c as any).guidance_url ?? null,
          eps_surprise_pct: (c as any).eps_surprise_pct ?? null, eps_basis: (c as any).eps_basis ?? null,
          source_url: c.filing_url,
        });
      }
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
  const calChunks = useMemo(() => chunkRange(calFrom, calTo, 10), [calFrom, calTo]);
  const calQueries = useQueries({
    queries: calChunks.map(([a, b]) => ({
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
        const res = await fetch(`/api/v1/earnings/calendar-us?from=${a}&to=${b}${forceKey > 0 ? '&force=1' : ''}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`Calendar failed (HTTP ${res.status})`);
        const payload = await res.json();
        try { debouncedSetItem(key, JSON.stringify({ ...payload, _cachedAt: new Date().toISOString() })); } catch {}
        return payload;
      },
      enabled: viewMode === 'CALENDAR',
      staleTime: b >= today ? 10 * 60_000 : 24 * 3600_000,
      refetchOnWindowFocus: false,
      retry: 1,
    })),
  });
  const calFetching = calQueries.some((q: any) => q.isFetching);
  const calLoaded = calQueries.filter((q: any) => q.isSuccess).length;
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
      elite: 0, pead70: 0, multibagger: 0, beatCheap: 0,
      mega: 0, large: 0, mid: 0, small: 0, micro: 0,
    } as Record<string, number>;
    for (const r of allRows) {
      c[r.tier]++;
      if (r.is_elite) c.elite++;
      if ((r.pead_score ?? 0) >= 70) c.pead70++;
      if (r.multibagger_setup) c.multibagger++;
      if ((r.sales_yoy_pct ?? -1) >= 15 && r.pe != null && r.pe > 0 && r.pe <= 30) c.beatCheap++;
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
    const head = ['Ticker', 'Company', 'Tier', 'Score', 'Quarter', 'Filed', 'Rev YoY %', 'EPS YoY %',
      'OPM %', 'OPM prev %', 'CFO/NI', 'PEAD', 'RS', 'Stage', 'Mkt cap $M', 'Price', 'P/E', 'D1 %', 'Sector', 'Filing'];
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const body = rows.map((r) => [r.ticker, r.company, r.tier, r.composite_score, r.quarter, r.filing_date,
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
        {[1, 3, 5, 10].map((d) => (
          <button key={d} onClick={() => setDays(d)} style={btn(days === d)}>{d}d</button>
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
        <button onClick={() => { setForceKey((k) => k + 1); setTimeout(() => refetch(), 0); }}
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
              {calFrom} → {calTo}{cal ? ` · ${cal.total} companies` : ''}{calFetching ? ` · ${calLoaded}/${calChunks.length} chunks loaded…` : ''}
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

          {!cal && !calFetching && <div style={panel()}><span style={{ color: 'var(--mc-text-2)' }}>Loading the filing calendar…</span></div>}
          {!cal && calFetching && <div style={panel()}><span style={{ color: 'var(--mc-text-2)' }}>Sweeping EDGAR for {calFrom} → {calTo} in {calChunks.length} chunks — each fills in as it lands, and each is cached afterwards.</span></div>}

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

function Tile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{
      backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: 6,
      padding: '7px 9px', minWidth: 0,
    }}>
      <div style={{ fontSize: 10, color: 'var(--mc-text-3)', fontWeight: 700, letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: color || 'var(--mc-text-0)', lineHeight: 1.25 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--mc-text-4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
    </div>
  );
}

/** A percentage surprise off a near-zero estimate is noise dressed as signal —
 *  Domo beat a $0.00 consensus by two cents and the arithmetic reads +5,888%.
 *  Below a dime of estimate, state the beat in cents instead. */
function surpriseText(r: any): string {
  const est = r.eps_estimate as number | null;
  const act = (r.eps_adj ?? r.eps_curr) as number | null;
  const pct = r.eps_surprise_pct as number | null;
  if (est != null && act != null && Math.abs(est) < 0.1) {
    const d = act - est;
    return `${d >= 0 ? 'beat by' : 'missed by'} $${Math.abs(d).toFixed(2)}`;
  }
  if (pct == null) return '';
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`;
}
function surpriseChip(r: any): string {
  const t = surpriseText(r);
  return /%$/.test(t) ? `vs est ${t}` : t;
}

const growthColor = (v: number | null | undefined) =>
  v == null ? 'var(--mc-text-3)' : v >= 25 ? 'var(--mc-bullish)' : v >= 0 ? 'var(--mc-text-0)' : 'var(--mc-bearish)';

/**
 * The value+colour for a growth tile, in one place.
 *
 * A percentage is refused when the prior-year base was zero or negative — a
 * loss of $0.31 turning into $1.59 of profit is not "+613%". That refusal used
 * to leave a bare dash on the card, which threw away the most important fact
 * about the quarter (Semtech's Q2 FY27 read "—" on exactly this). So when the
 * engine names a swing, the swing is printed instead of the percentage: they
 * are mutually exclusive by construction and neither is ever invented.
 *
 * `fallback` is the value shown when there is neither a percentage nor a swing
 * but the level itself is worth showing (the adjusted-EPS tile in a company's
 * first year of coverage prints "$0.71" rather than a dash).
 */
function swingTile(pct: number | null | undefined, swing: SwingKind, fallback?: string):
  { value: string; color?: string } {
  const p = num(pct);
  if (p != null) return { value: fmtPct(p), color: growthColor(p) };
  if (swing) return { value: SWING_LABEL[swing], color: SWING_GOOD[swing] ? 'var(--mc-bullish)' : 'var(--mc-bearish)' };
  if (fallback) return { value: fallback, color: 'var(--mc-text-0)' };
  return { value: '—', color: 'var(--mc-text-3)' };
}

function UsEarningsCard({ r, open, onToggle, panelId: pid }: {
  r: UsGradedRow; open: boolean; onToggle: () => void; panelId: string;
}) {
  const meta = TIER_META[r.tier];
  const opmD = (r.opm_pct != null && r.opm_prev_pct != null) ? r.opm_pct - r.opm_prev_pct : null;
  // GAAP EPS growth only — never the grading axis, which may be the adjusted
  // basis (see `eps_gaap_yoy_pct` in us-earnings-core).
  const gaapEpsY = (r as any).eps_gaap_yoy_pct !== undefined
    ? ((r as any).eps_gaap_yoy_pct as number | null)
    : (r.eps_prev != null && r.eps_prev > 0 && r.eps_curr != null
        ? ((r.eps_curr - r.eps_prev) / r.eps_prev) * 100 : null);
  const adjEpsCur = num((r as any).eps_adj_curr ?? (r as any).eps_adj);
  const adjEpsPrev = num((r as any).eps_adj_prev);
  const epsEst = num((r as any).eps_estimate);
  const surp = num((r as any).eps_surprise_pct);
  const hasAdjEps = adjEpsCur != null;
  return (
    <div style={{
      backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)',
      borderRadius: 'var(--mc-radius)', padding: 12, borderTop: `3px solid ${meta.color}`,
      // A grid item defaults to min-width:auto, which lets a wide child (the
      // panel's tables) push the whole column out. Zero here is what makes the
      // tables scroll inside themselves instead of scrolling the page.
      minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 800, fontSize: 15, color: 'var(--mc-text-0)' }}>{r.ticker}</span>
        <span style={{ fontSize: 'var(--mc-text-xs)', color: 'var(--mc-text-2)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {r.company}
        </span>
        <span style={{ fontWeight: 800, fontSize: 13, color: meta.color }}>{r.composite_score}</span>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '6px 0 9px' }}>
        {(r as any).prelim && <Chip text="PRELIM · GAAP pending" color="#8B5CF6" />}
        <Chip text={r.quarter} />
        {r.sector && <Chip text={r.sector} />}
        {r.market_cap_musd != null && <Chip text={fmtUsd(r.market_cap_musd)} />}
        {(r as any).eps_surprise_pct != null && (
          <Chip text={surpriseChip(r)}
            color={(r as any).eps_surprise_pct >= 5 ? '#10B981' : (r as any).eps_surprise_pct <= -5 ? '#EF4444' : undefined} />
        )}
        {(r as any).guidance && (
          <Chip text={`📣 Guidance ${String((r as any).guidance).toLowerCase()}`}
            color={(r as any).guidance === 'RAISED' ? '#10B981' : (r as any).guidance === 'LOWERED' || (r as any).guidance === 'WITHDRAWN' ? '#EF4444' : (r as any).guidance === 'MAINTAINED' ? '#FACC15' : undefined} />
        )}
        {r.is_elite && <Chip text="⭐ ELITE" color="#F59E0B" />}
        {r.multibagger_setup && <Chip text="💎 MULTIBAGGER" color="#8B5CF6" />}
        {(r.pead_score ?? 0) >= 70 && <Chip text={`🔥 PEAD ${r.pead_score}`} color="#EF4444" />}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${hasAdjEps ? 5 : 4}, minmax(0, 1fr))`, gap: 6 }}>
        <Tile label="REVENUE" {...swingTile(r.sales_yoy_pct, null)}
          sub={`${fmtUsd(r.revenue_prev_musd)} → ${fmtUsd(r.revenue_curr_musd)}`} />
        {/* GAAP EPS growth ONLY — `eps_yoy_pct` is the grading axis and falls
            back to the adjusted basis when the GAAP base was a loss; printing
            that here would label an adjusted number "GAAP". When the base was
            a loss there is no percentage, so the swing is named instead. */}
        <Tile label="EPS · GAAP" {...swingTile(gaapEpsY, r.eps_swing)}
          sub={r.eps_prev != null && r.eps_curr != null
            ? `$${r.eps_prev.toFixed(2)} → ${r.eps_derived ? '≈' : ''}$${r.eps_curr.toFixed(2)}`
            : r.eps_curr != null ? `${r.eps_derived ? '≈' : ''}$${r.eps_curr.toFixed(2)} · no prior base`
            : 'EPS not tagged'} />
        {/* The basis the market actually trades. Shown as its own tile so a
            company whose GAAP line swung out of a loss still has a growth
            number on the card, and so the two are never confused. */}
        {hasAdjEps && (
          <Tile label="EPS · ADJ." {...swingTile(r.eps_adj_yoy_pct ?? null, r.eps_adj_swing ?? null,
            adjEpsCur != null ? `$${adjEpsCur.toFixed(2)}` : '—')}
            sub={adjEpsPrev != null && adjEpsCur != null
              ? `$${adjEpsPrev.toFixed(2)} → $${adjEpsCur.toFixed(2)}`
              : epsEst != null && adjEpsCur != null
              ? `vs est $${epsEst.toFixed(2)}${surp != null ? ` · ${surp >= 0 ? '+' : ''}${surp.toFixed(0)}%` : ''}`
              : 'no prior base'} />
        )}
        <Tile label="OPM" value={r.opm_pct != null ? `${r.opm_pct.toFixed(1)}%` : '—'}
          color={opmD == null ? undefined : opmD >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)'}
          sub={opmD != null ? `${opmD >= 0 ? '+' : ''}${opmD.toFixed(1)}pp YoY` : 'no prior margin'} />
        <Tile label="CFO/NI" value={r.cfo_to_pat_ratio != null ? r.cfo_to_pat_ratio.toFixed(2) : '—'}
          color={r.cfo_to_pat_ratio == null ? undefined : r.cfo_to_pat_ratio >= 1 ? 'var(--mc-bullish)' : r.cfo_to_pat_ratio >= 0.5 ? undefined : 'var(--mc-bearish)'}
          sub={r.cfo_curr_musd != null ? `CFO ${fmtUsd(r.cfo_curr_musd)}` : 'cash flow pending'} />
      </div>

      <SecondaryTiles r={r} />

      {(r as any).eps_adj != null && (
        <div style={{
          marginTop: 7, padding: '5px 8px', borderRadius: 6, backgroundColor: 'var(--mc-bg-1)',
          border: '1px solid var(--mc-bg-4)', fontSize: 11, color: 'var(--mc-text-2)',
          display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline',
        }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--mc-text-3)', letterSpacing: 0.3 }}>STREET BASIS</span>
          <span>adj. EPS <b style={{ color: 'var(--mc-text-0)' }}>${Number((r as any).eps_adj).toFixed(2)}</b></span>
          {(r as any).eps_estimate != null && <span>vs est ${Number((r as any).eps_estimate).toFixed(2)}</span>}
          {(r as any).eps_surprise_pct != null && (
            <b style={{ color: (r as any).eps_surprise_pct >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>
              {surpriseText(r)}
            </b>
          )}
          <span style={{ color: 'var(--mc-text-4)' }}>· adjusted figures exclude one-offs, so they differ from the GAAP tile</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '9px 0 0', fontSize: 'var(--mc-text-xs)', color: 'var(--mc-text-2)' }}>
        <span>Reaction <b style={{ color: r.d1_pct == null ? 'var(--mc-text-3)' : r.d1_pct >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtPct(r.d1_pct, 1)}</b></span>
        <span>Since <b style={{ color: r.move_pct == null ? 'var(--mc-text-3)' : r.move_pct >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtPct(r.move_pct, 1)}</b></span>
        <span>PEAD <b style={{ color: 'var(--mc-text-0)' }}>{r.pead_score}</b></span>
        <span>RS <b style={{ color: 'var(--mc-text-0)' }}>{r.rs_rating ?? '—'}</b></span>
        <span>Stage <b style={{ color: r.stage === 4 ? 'var(--mc-bearish)' : r.stage === 2 ? 'var(--mc-bullish)' : 'var(--mc-text-0)' }}>{r.stage ?? '—'}</b></span>
        <span>{fmtPx(r.price)}{r.pe ? ` · P/E ${r.pe}` : ''}</span>
      </div>

      <div style={{ fontSize: 'var(--mc-text-xs)', color: 'var(--mc-text-2)', marginTop: 9, lineHeight: 1.5 }}>
        {r.narrative}
      </div>
      {Array.isArray((r as any).guidance_figures) && (r as any).guidance_figures.length > 0 && (
        <GuideBlock figs={(r as any).guidance_figures} label={(r as any).guidance} />
      )}

      {Array.isArray((r as any).guidance_snippets) && (r as any).guidance_snippets.length > 0 && (
        <details style={{ marginTop: 7 }}>
          <summary style={{ cursor: 'pointer', fontSize: 10, fontWeight: 800, color: 'var(--mc-text-3)', letterSpacing: 0.3 }}>
            📣 GUIDANCE · from the press release{(r as any).guidance_url ? '' : ''}
          </summary>
          <div style={{ marginTop: 5, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(r as any).guidance_snippets.map((q: string, i: number) => (
              <div key={i} style={{ fontSize: 11, color: 'var(--mc-text-2)', lineHeight: 1.45, borderLeft: '2px solid var(--mc-bg-4)', paddingLeft: 8 }}>“{q}”</div>
            ))}
            {(r as any).guidance_url && (
              <a href={(r as any).guidance_url} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: 'var(--mc-cyan)', textDecoration: 'none' }}>read the release ↗</a>
            )}
          </div>
        </details>
      )}

      {(r.methodology_tags.length > 0 || r.caveat_tags.length > 0) && (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 8 }}>
          {r.methodology_tags.map((t) => <Chip key={t} text={t} color="#10B981" />)}
          {r.caveat_tags.map((t) => <Chip key={t} text={t} color="#EF4444" />)}
        </div>
      )}

      {(r as any).prelim && (
        <div style={{ fontSize: 10, color: 'var(--mc-text-4)', marginTop: 7, lineHeight: 1.5 }}>
          {Array.isArray((r as any).prelim_matched) && (r as any).prelim_matched.length > 0
            ? <>Figures read from the earnings release ({(r as any).prelim_matched.map((m: string) => m.replace(/_/g, ' ')).join(', ')}) and checked against last year&apos;s XBRL before display. Cash flow and the full tag set arrive with the 10-Q.</>
            : <>Consensus and the price reaction only — the release&apos;s statement of operations could not be verified against last year&apos;s filing, so no revenue or margin is shown.</>}
          {(r as any).release_url && (
            <> <a href={(r as any).release_url} target="_blank" rel="noreferrer" style={{ color: 'var(--mc-cyan)', textDecoration: 'none' }}>read the release ↗</a></>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 9, alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: 'var(--mc-text-4)' }}>{r.form} · filed {r.filing_date}</span>
        {r.filing_url && (
          <a href={r.filing_url} target="_blank" rel="noreferrer"
            style={{ fontSize: 10, color: 'var(--mc-cyan)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            SEC filing <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      {/* ── the expand strip · every card gets one, however sparse the row ── */}
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={pid} style={moreStrip(open)}>
        {open
          ? <><ChevronUp className="w-3 h-3" /> LESS</>
          : <><ChevronDown className="w-3 h-3" /> MORE · guidance, trend, context</>}
      </button>
      {open && (
        <div id={pid}>
          <DetailPanel r={r as UsRowX} />
          <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={pid} style={moreStrip(true)}>
            <ChevronUp className="w-3 h-3" /> LESS
          </button>
        </div>
      )}
    </div>
  );
}

function moreStrip(open: boolean): React.CSSProperties {
  return {
    width: '100%', marginTop: 9, padding: '6px 8px', borderRadius: 6,
    border: `1px solid ${open ? 'var(--mc-cyan)' : 'var(--mc-bg-4)'}`,
    backgroundColor: open ? 'color-mix(in srgb, var(--mc-cyan) 10%, transparent)' : 'var(--mc-bg-1)',
    color: 'var(--mc-cyan)', fontSize: 'var(--mc-text-xs)', fontWeight: 800, letterSpacing: 0.3,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  };
}

/**
 * The second row of tiles: the numbers that decide a print for the kind of
 * company being graded, in the same grammar as revenue/EPS/OPM/CFO above.
 *
 * Free cash flow is computed from the filing itself (CFO − capex, both from the
 * cash-flow statement). The rest — ARR, RPO/cRPO, net revenue retention,
 * backlog, adjusted EBITDA — exist only in the press release, so they appear
 * for the companies that report them and are simply absent for the rest; a tile
 * is never invented. At most four are shown, most decision-relevant first.
 */
function SecondaryTiles({ r }: { r: UsGradedRow }) {
  const metrics: KeyMetric[] = ((r as any).key_metrics || []) as KeyMetric[];
  const by = new Map<KeyMetricId, KeyMetric>();
  // A metric whose value is not a finite number is not a metric. Without this
  // guard `fmtKeyMetric` renders the literal string "NaN" into a tile, which
  // reads as a figure rather than as the absence of one.
  for (const m of metrics) if (m && Number.isFinite(m.value) && !by.has(m.id)) by.set(m.id, m);

  const tiles: React.ReactNode[] = [];
  const fcf = (r as any).fcf_curr_musd as number | null | undefined;
  const fcfPrev = (r as any).fcf_prev_musd as number | null | undefined;
  const fcfY = (r as any).fcf_yoy_pct as number | null | undefined;
  // The COMPANY's own free-cash-flow figure wins when it published one: many
  // filers deduct capitalised software or finance-lease payments as well as
  // property capex, so our CFO − capex can differ from the number the market
  // saw. Ours is the fallback, and it says which one is on screen.
  const relFcf = by.get('free_cash_flow');
  if (relFcf) {
    tiles.push(
      <Tile key="fcf" label="FREE CASH FLOW" value={fmtKeyMetric(relFcf)}
        color={relFcf.value >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)'}
        sub={relFcf.yoy_pct != null ? `${fmtPct(relFcf.yoy_pct)} YoY · as reported` : 'as reported'} />,
    );
  } else if (fcf != null) {
    tiles.push(
      <Tile key="fcf" label="FREE CASH FLOW" value={fmtUsd(fcf)}
        color={fcf >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)'}
        sub={fcfY != null ? `${fmtPct(fcfY)} YoY · CFO − capex` : fcfPrev != null ? `was ${fmtUsd(fcfPrev)}` : 'CFO − capex'} />,
    );
  }

  const order: Array<[KeyMetricId, string]> = [
    ['arr', 'ARR'], ['rpo', 'RPO'], ['crpo', 'cRPO'], ['nrr', 'NET RETENTION'],
    ['backlog', 'BACKLOG'], ['adj_ebitda', 'ADJ. EBITDA'], ['comparable_sales', 'COMP SALES'],
    ['net_new_arr', 'NET NEW ARR'], ['subscription_revenue', 'SUBSCRIPTION REV'],
    ['operating_margin_adj', 'ADJ. OPM'], ['gross_margin_adj', 'ADJ. GROSS MARGIN'],
    ['customers_100k', 'CUSTOMERS >$100K'],
  ];
  for (const [id, label] of order) {
    if (tiles.length >= 4) break;
    const m = by.get(id);
    if (!m) continue;
    tiles.push(
      <Tile key={id} label={label} value={fmtKeyMetric(m)}
        color={m.yoy_pct == null ? undefined : m.yoy_pct >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)'}
        sub={m.yoy_pct != null ? `${fmtPct(m.yoy_pct)} YoY` : 'reported'} />,
    );
  }
  if (!tiles.length) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(4, tiles.length)}, 1fr)`, gap: 6, marginTop: 6 }}>
      {tiles}
    </div>
  );
}

/**
 * The guided numbers, grouped by period the way an earnings feed prints them:
 *
 *   Raises FY26 guide   Revenue $5.63B–$5.71B (Est. $5.54B) ▲   from $5.40B–$5.48B
 *                       Adj. EPS $9.83–$10.31 (Est. $9.25) ▲    from $8.65–$9.05
 *
 * Everything except "(Est. …)" is read from the company's own press release;
 * the estimate is the street's consensus for that period.
 */
function GuideBlock({ figs, label, showSource }: {
  figs: Array<GuidanceFigure & { est?: number | null }>;
  label?: string | null;
  /** Panel-only: print the sentence each figure was parsed out of, so the
   *  number can be checked against the release without leaving the card. */
  showSource?: boolean;
}) {
  const groups = new Map<string, Array<GuidanceFigure & { est?: number | null }>>();
  for (const f of figs) {
    if (!groups.has(f.period_label)) groups.set(f.period_label, []);
    groups.get(f.period_label)!.push(f);
  }
  const verb = label === 'RAISED' ? 'Raises' : label === 'LOWERED' ? 'Cuts' : label === 'MAINTAINED' ? 'Reaffirms' : 'Guides to';
  return (
    <div style={{
      marginTop: 8, borderRadius: 6, border: '1px solid var(--mc-bg-4)',
      backgroundColor: 'var(--mc-bg-1)', padding: '7px 9px',
    }}>
      {Array.from(groups.entries()).map(([period, list]) => (
        <div key={period} style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.3, color: 'var(--mc-text-3)', marginBottom: 3 }}>
            {verb.toUpperCase()} {period.toUpperCase()}{verb === 'Guides to' ? '' : ' GUIDE'}
          </div>
          {list.map((f, i) => {
            const beat = (f.est != null && f.low != null && f.high != null) ? ((f.low + f.high) / 2) - f.est : null;
            const good = beat != null ? beat > 0 : (f.raised === true ? true : null);
            return (
              <div key={i} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'baseline', fontSize: 11, lineHeight: 1.6 }}>
                <span style={{ color: 'var(--mc-text-3)', minWidth: 96 }}>
                  {f.basis === 'adjusted' ? 'Adj. ' : ''}{GUIDE_METRIC_LABEL[f.metric]}
                </span>
                <b style={{ color: 'var(--mc-text-0)' }}>{fmtGuideRange(f)}</b>
                {f.est != null && (
                  <span style={{ color: 'var(--mc-text-4)' }}>
                    (Est. {fmtGuideRange({ low: f.est, high: f.est, unit: f.unit })})
                  </span>
                )}
                {good != null && (
                  <span style={{ color: good ? 'var(--mc-bullish)' : 'var(--mc-bearish)', fontWeight: 800 }}>{good ? '▲' : '▼'}</span>
                )}
                {f.prior_low != null && (
                  <span style={{ color: 'var(--mc-text-4)' }}>
                    from {fmtGuideRange({ low: f.prior_low, high: f.prior_high, unit: f.unit })}
                  </span>
                )}
                {showSource && f.source && (
                  <span style={{ flexBasis: '100%', fontSize: 10, color: 'var(--mc-text-4)', lineHeight: 1.4 }}>
                    “{f.source}”
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Chip({ text, color }: { text: string; color?: string }) {
  const c = color || 'var(--mc-text-3)';
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
      border: `1px solid ${color ? c : 'var(--mc-bg-4)'}`, color: c,
      backgroundColor: color ? `color-mix(in srgb, ${c} 10%, transparent)` : 'transparent',
      whiteSpace: 'nowrap',
    }}>{text}</span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// THE DETAIL PANEL
//
// One card's full earnings write-up, in the order a reader actually wants it:
// what the quarter did against the two things it was measured on (the street
// and the company's own guide), where the guide moved to, then the numbers
// themselves — four periods side by side with growth and margin deltas — then
// the balance-sheet and capital-return context, then every raw input the
// collapsed card hides.
//
// THE ONE RULE THE WHOLE FILE OBEYS
// ─────────────────────────────────
// Nothing here is interpolated, carried forward or back-filled. A quarter the
// filer did not tag is an em-dash. A growth rate whose base is zero or negative
// is `n/m`, never a number — a swing from −$40m to +$10m is not "+125% growth",
// and printing it as one is the single most common way a screen lies. Every
// section renders only if it has something real to say; a section with nothing
// says so in a sentence rather than showing a grid of dashes.
// ═══════════════════════════════════════════════════════════════════════════

// ── the payload contract (src/lib/us-expand-contract.md) ───────────────────
// Every field is optional and may be null or absent on any row, which is the
// steady state for a PRELIM print, a first-year filer or a company that gives
// no outlook — not an error condition.
interface UsSeries {
  ends: string[];
  revenue: (number | null)[];
  gross_profit: (number | null)[];
  operating_income: (number | null)[];
  net_income: (number | null)[];
  eps: (number | null)[];
  cfo: (number | null)[];
  fcf: (number | null)[];
}
interface UsContext {
  cash_musd: number | null;
  cash_incl_st_inv: boolean;
  debt_musd: number | null;
  sbc_musd: number | null;
  buyback_musd: number | null;
  dividends_musd: number | null;
  diluted_shares_m: number | null;
  diluted_shares_yoy_pct: number | null;
  as_of: string | null;
}
interface GuidedItem {
  metric: string;
  basis: 'gaap' | 'adjusted' | null;
  period: 'quarter' | 'year';
  guide_low: number | null;
  guide_high: number | null;
  guide_mid: number | null;
  unit: string;
  actual: number | null;
  guided_on: string;
  guided_for_label: string | null;
  source_url: string | null;
  compare: {
    verdict: 'beat' | 'missed' | 'in-line' | null;
    delta_pct: number | null;
    delta_abs: number | null;
    text: string | null;
  } | null;
}
interface VsGuide {
  prior_filing_date: string | null;
  prior_filing_url: string | null;
  for_quarter: GuidedItem[];
  for_year: GuidedItem[];
}
interface GuideChange {
  metric: string;
  basis: 'gaap' | 'adjusted' | null;
  period_label: string | null;
  prev_low: number | null; prev_high: number | null;
  new_low: number | null; new_high: number | null;
  direction: 'raised' | 'lowered' | 'reiterated' | 'narrowed' | 'widened';
  delta_pct: number | null;
  unit: string;
}

type UsRowX = UsGradedRow & {
  series?: UsSeries | null;
  context?: UsContext | null;
  vs_guide?: VsGuide | null;
  guide_change?: GuideChange[] | null;
  guidance?: string | null;
  guidance_figures?: Array<GuidanceFigure & { est?: number | null }> | null;
  guidance_snippets?: string[] | null;
  guidance_url?: string | null;
  key_metrics?: KeyMetric[] | null;
  eps_adj?: number | null;
  eps_estimate?: number | null;
  eps_surprise_pct?: number | null;
  eps_basis?: string | null;
  prelim?: boolean;
  prelim_matched?: string[] | null;
  release_url?: string | null;
  is_financial?: boolean;
};

/** Identity that survives the list re-sorting, the per-session merges and a row
 *  moving between tiers when its 10-Q lands. */
function rowKey(r: UsGradedRow): string {
  return `${r.ticker}|${r.period_end || r.filing_date}`;
}
function panelId(key: string): string {
  return `us-eo-panel-${key.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

// ── tiny numeric guards ────────────────────────────────────────────────────
const num = (v: unknown): number | null =>
  (typeof v === 'number' && Number.isFinite(v)) ? v : null;

/** Read index `i` of one of the series arrays, tolerating a short or absent
 *  array — the arrays are index-aligned by contract but nothing is guaranteed
 *  to be there. */
const at = (arr: unknown, i: number | null | undefined): number | null =>
  (Array.isArray(arr) && i != null && i >= 0 && i < arr.length) ? num(arr[i]) : null;

const DAY_MS = 86_400_000;
const iso10 = (v: unknown): string => String(v ?? '').slice(0, 10);
function dayGap(laterIso: string, earlierIso: string): number | null {
  const a = Date.parse(laterIso + 'T00:00:00Z');
  const b = Date.parse(earlierIso + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a - b) / DAY_MS);
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortEnd(isoDate: string): string {
  const t = Date.parse(iso10(isoDate) + 'T00:00:00Z');
  if (!Number.isFinite(t)) return iso10(isoDate) || '—';
  const d = new Date(t);
  return `${MON[d.getUTCMonth()]} ’${String(d.getUTCFullYear()).slice(2)}`;
}

/** Only accept a series that is actually usable: a non-empty array of dates. */
function normSeries(s: unknown): (UsSeries & { ends: string[] }) | null {
  const o = s as UsSeries | null | undefined;
  if (!o || !Array.isArray(o.ends) || o.ends.length === 0) return null;
  const ends = o.ends.map(iso10);
  if (!ends.every((e) => Number.isFinite(Date.parse(e + 'T00:00:00Z')))) return null;
  return { ...o, ends };
}

/**
 * Find the quarter that sits ~`targetDays` before `refIdx`, BY DATE.
 *
 * Index arithmetic alone is wrong here: filers skip periods (a transition
 * quarter, a restatement, a year where the 10-K's Q4 could not be derived), so
 * "twelve back in the array" is only sometimes three years back in time. We
 * take the closest end date to the target and then refuse it unless the gap is
 * genuinely within tolerance — which is what stops a two-year-ago quarter being
 * labelled and compounded as if it were three.
 */
function backFrom(ends: string[], refIdx: number, targetDays: number, tolDays: number): number | null {
  let best = -1, bestErr = Infinity;
  for (let i = 0; i < refIdx; i++) {
    const g = dayGap(ends[refIdx], ends[i]);
    if (g == null || g <= 0) continue;
    const err = Math.abs(g - targetDays);
    if (err < bestErr) { bestErr = err; best = i; }
  }
  return (best >= 0 && bestErr <= tolDays) ? best : null;
}

interface PanelCol { idx: number; label: string; sub: string; }

/**
 * The four period columns: the reported quarter, the one before it, the
 * year-ago quarter and the quarter three years back.
 *
 * Only the reported quarter has a fiscal label we can trust — it is the one the
 * filer itself used, read off the release. Nothing lets us name the others
 * (decrementing "Q2 FY27" guesses at a fiscal calendar we have not been told),
 * so they are headed by their period-end date instead.
 */
function buildCols(s: UsSeries & { ends: string[] }, quarterLabel: string | null | undefined) {
  const ends = s.ends;
  const last = ends.length - 1;
  const mk = (i: number | null): PanelCol | null =>
    i == null ? null : { idx: i, label: shortEnd(ends[i]), sub: ends[i] };
  const cur: PanelCol = { idx: last, label: quarterLabel || shortEnd(ends[last]), sub: ends[last] };
  const prevIdx = backFrom(ends, last, 91, 30);
  const yrIdx = backFrom(ends, last, 365, 45);
  const yr3Idx = backFrom(ends, last, 1095, 60);
  return {
    cur, prev: mk(prevIdx), yr: mk(yrIdx), yr3: mk(yr3Idx),
    yr3GapDays: yr3Idx == null ? null : dayGap(ends[last], ends[yr3Idx]),
  };
}

// ── the arithmetic discipline ──────────────────────────────────────────────
type Cell = { text: string; color?: string };
const DASH: Cell = { text: '—' };
const NM: Cell = { text: 'n/m', color: 'var(--mc-text-4)' };

/** Inside the tables every sign is a real minus (U+2212), not a hyphen: the
 *  columns are read as a block and `−3720` beside `+950` has to line up. */
const signedPct = (p: number, d = 1) => `${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(d)}%`;
const levelPct = (p: number, d = 1) => `${p < 0 ? '−' : ''}${Math.abs(p).toFixed(d)}%`;

/**
 * Money in a comparison column, one significant step finer than the card's
 * `fmtUsd`: rounding $1.66B to "$1.7B" hides exactly the 6% sequential move the
 * next column claims to report.
 */
function fmtUsdCell(musd: number | null): string {
  if (musd == null || !Number.isFinite(musd)) return '—';
  const a = Math.abs(musd), sign = musd < 0 ? '−' : '';
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(2)}T`;
  if (a >= 1_000) return `${sign}$${(a / 1_000).toFixed(2)}B`;
  if (a >= 1) return `${sign}$${a.toFixed(a >= 100 ? 1 : 2)}M`;
  return `${sign}$${(a * 1000).toFixed(0)}K`;
}

/** A growth rate is only meaningful off a positive base. Missing is `—`;
 *  present-but-unusable (zero or negative base) is `n/m`. They are different
 *  facts and the panel never collapses one into the other. */
function growthCell(cur: number | null, prev: number | null): Cell {
  if (cur == null || prev == null) return DASH;
  if (prev <= 0) return NM;
  const pct = ((cur - prev) / prev) * 100;
  if (!Number.isFinite(pct)) return DASH;
  return { text: signedPct(pct), color: pct >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' };
}

/**
 * 3-year CAGR = (latest / oldest)^(1/3) − 1, and only when
 *   • both ends exist and are strictly positive, and
 *   • the gap really is about three years (±60 days).
 * A company that swung from a loss to a profit has no compound growth rate;
 * neither does one whose oldest comparable is two years old.
 */
function cagrCell(latest: number | null, oldest: number | null, gapDays: number | null): Cell {
  if (gapDays == null || Math.abs(gapDays - 1095) > 60) return DASH;
  if (latest == null || oldest == null) return DASH;
  if (latest <= 0 || oldest <= 0) return NM;
  const pct = (Math.pow(latest / oldest, 1 / 3) - 1) * 100;
  if (!Number.isFinite(pct)) return DASH;
  return { text: signedPct(pct), color: pct >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' };
}

/** A margin needs a positive revenue base; a negative margin is fine to show,
 *  a margin off a zero or negative top line is not a number. */
function marginPct(v: number | null, rev: number | null): number | null {
  if (v == null || rev == null || rev <= 0) return null;
  const p = (v / rev) * 100;
  return Number.isFinite(p) ? p : null;
}

/** Margin moves are stated in basis points, never in "%" — a margin going from
 *  14% to 20% moved 600 bps, not 6% and not 43%. */
function bpsCell(now: number | null, then: number | null): Cell {
  if (now == null || then == null) return DASH;
  const n = Math.round((now - then) * 100);
  if (!Number.isFinite(n)) return DASH;
  if (n === 0) return { text: '0', color: 'var(--mc-text-2)' };
  return { text: `${n > 0 ? '+' : '−'}${Math.abs(n)}`, color: n > 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' };
}

const pctCell = (p: number | null): Cell =>
  p == null ? DASH : { text: levelPct(p), color: p >= 0 ? undefined : 'var(--mc-bearish)' };
const usdCell = (v: number | null): Cell =>
  v == null ? DASH : { text: fmtUsdCell(v), color: v < 0 ? 'var(--mc-bearish)' : undefined };

// ── panel chrome ───────────────────────────────────────────────────────────
function PanelH({ children, note }: { children: React.ReactNode; note?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap', margin: '12px 0 5px' }}>
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.4, color: 'var(--mc-text-3)' }}>{children}</span>
      {note && <span style={{ fontSize: 10, color: 'var(--mc-text-4)' }}>{note}</span>}
    </div>
  );
}
function Bul({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 6, fontSize: 11, lineHeight: 1.55, color: 'var(--mc-text-2)', marginBottom: 3 }}>
      <span style={{ color: 'var(--mc-text-4)', flex: '0 0 auto' }}>•</span>
      <span style={{ minWidth: 0 }}>{children}</span>
    </div>
  );
}
/** The inline highlighted verdict token — one word, coloured, inside the
 *  sentence, exactly the way the write-ups we are competing with do it. */
function V({ verdict }: { verdict: 'beat' | 'missed' | 'in-line' | null }) {
  if (!verdict) return null;
  const c = verdict === 'beat' ? 'var(--mc-bullish)' : verdict === 'missed' ? 'var(--mc-bearish)' : 'var(--mc-text-1)';
  const t = verdict === 'beat' ? 'Beat' : verdict === 'missed' ? 'Missed' : 'In line';
  return <b style={{ color: c }}>{t}</b>;
}
function Quiet({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, color: 'var(--mc-text-4)', lineHeight: 1.5 }}>{children}</div>;
}

/** Every table lives in its own horizontal scroller, so a 7-column grid can be
 *  read on a 360px phone without the card — or the page — moving sideways. */
function Scroller({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      overflowX: 'auto', maxWidth: '100%', WebkitOverflowScrolling: 'touch',
      borderRadius: 6, border: '1px solid var(--mc-bg-4)', backgroundColor: 'var(--mc-bg-1)',
    }}>
      {children}
    </div>
  );
}

interface TableRow { label: string; note?: string; cells: Cell[] }
function MiniTable({ head, rows }: { head: Array<{ label: string; sub?: string }>; rows: TableRow[] }) {
  const th: React.CSSProperties = {
    padding: '5px 8px', textAlign: 'right', fontSize: 9, fontWeight: 800, letterSpacing: 0.3,
    color: 'var(--mc-text-3)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--mc-bg-4)',
  };
  const stick: React.CSSProperties = {
    position: 'sticky', left: 0, zIndex: 1, textAlign: 'left',
    backgroundColor: 'var(--mc-bg-1)', boxShadow: '1px 0 0 var(--mc-bg-4)',
  };
  const td: React.CSSProperties = {
    padding: '4px 8px', textAlign: 'right', fontSize: 11, whiteSpace: 'nowrap',
    color: 'var(--mc-text-1)', fontVariantNumeric: 'tabular-nums',
  };
  return (
    <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 'max-content' }}>
      <thead>
        <tr>
          <th style={{ ...th, ...stick }} />
          {head.map((h, i) => (
            <th key={i} style={th}>
              {h.label}
              {h.sub && <div style={{ fontSize: 8, fontWeight: 600, color: 'var(--mc-text-4)' }}>{h.sub}</div>}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <th style={{ ...td, ...stick, fontWeight: 700, color: 'var(--mc-text-2)' }}>
              {r.label}
              {r.note && <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--mc-text-4)' }}> {r.note}</span>}
            </th>
            {r.cells.map((c, j) => (
              <td key={j} style={{ ...td, color: c.color || 'var(--mc-text-1)' }}>{c.text}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── section 1 · results vs expectations ────────────────────────────────────
/**
 * The street bullet. Built only when there is a consensus AND something to pair
 * it with on a stated basis — the estimate is the street's ADJUSTED number, so
 * silently measuring a GAAP actual against it would be exactly the basis-mixing
 * the rest of this card refuses to do. When the engine has already computed a
 * surprise we use its pairing; otherwise we need `eps_adj`.
 */
function streetBullet(r: UsRowX): React.ReactNode | null {
  const est = num(r.eps_estimate);
  const act = num(r.eps_adj);
  const pct = num(r.eps_surprise_pct);
  if (est == null || (act == null && pct == null)) return null;
  const d = act != null ? act - est : null;
  const verdict: 'beat' | 'missed' | 'in-line' =
    d != null
      ? (Math.abs(d) <= 0.005 ? 'in-line' : d > 0 ? 'beat' : 'missed')
      : (pct == null || Math.abs(pct) < 0.5 ? 'in-line' : pct > 0 ? 'beat' : 'missed');
  const basis = r.eps_basis ? String(r.eps_basis) : (act != null ? 'adjusted' : 'street');
  // Below a dime of estimate a percentage surprise is noise dressed as signal
  // (a two-cent beat on a $0.00 consensus reads as +5,888%), so it is stated in
  // cents only — the same rule the collapsed card's chip uses.
  const nearZero = Math.abs(est) < 0.1;
  const tail = d != null
    ? `$${Math.abs(d).toFixed(2)}${(!nearZero && pct != null) ? ` (${Math.abs(pct).toFixed(0)}%)` : ''}`
    : `${Math.abs(pct as number).toFixed(0)}%`;
  return (
    <Bul>
      <V verdict={verdict} />
      {verdict === 'in-line' ? ' with' : ''} the ${est.toFixed(2)} street EPS estimate
      <span style={{ color: 'var(--mc-text-4)' }}> ({basis} basis)</span>
      {verdict === 'in-line' ? '.' : <> by <b style={{ color: 'var(--mc-text-0)' }}>{tail}</b>.</>}
      {act != null && <span style={{ color: 'var(--mc-text-4)' }}> Reported ${act.toFixed(2)}.</span>}
    </Bul>
  );
}

/**
 * The engine's own sentence about a guide ("beat the midpoint of its own guide
 * by 3.3%"), printed verbatim with its first word — which is always the verdict
 * — lifted into colour. Highlighting the token inside the sentence is what the
 * write-ups we are competing with do, and it avoids the "Beat … beat" stutter
 * that a separate verdict chip in front of the same sentence produces.
 */
function HiText({ text, verdict }: { text: string; verdict: 'beat' | 'missed' | 'in-line' | null }) {
  const i = text.indexOf(' ');
  const head = i > 0 ? text.slice(0, i) : text;
  const rest = i > 0 ? text.slice(i) : '';
  const c = verdict === 'beat' ? 'var(--mc-bullish)'
    : verdict === 'missed' ? 'var(--mc-bearish)' : 'var(--mc-text-1)';
  return <><b style={{ color: c }}>{head}</b>{rest}</>;
}

const GUIDE_LABEL = (metric: string): string =>
  (GUIDE_METRIC_LABEL as Record<string, string>)[metric] || String(metric).replace(/_/g, ' ');
/** Lower-case a metric label for mid-sentence use, but never an acronym:
 *  "Revenue" → "revenue", "EPS" stays "EPS", "EBITDA" stays "EBITDA". */
const midSentence = (s: string): string => /^[A-Z][a-z]+(?: [a-z]+)*$/.test(s) ? s.toLowerCase() : s;

/** One "vs its own guide" bullet. `compare.text` is written by the engine
 *  ("beat the midpoint of its own guide by 3.3%") and is used verbatim — its
 *  first word is the verdict, so it is the token we highlight. */
function guideBullets(items: GuidedItem[] | undefined | null, scope: string): React.ReactNode[] {
  if (!Array.isArray(items)) return [];
  const out: React.ReactNode[] = [];
  for (const g of items) {
    const txt = g?.compare?.text;
    if (!txt) continue;
    const basis = g.basis === 'adjusted' ? 'adj.' : g.basis === 'gaap' ? 'GAAP' : null;
    out.push(
      <Bul key={`${scope}-${g.metric}-${g.guided_on}`}>
        <b style={{ color: 'var(--mc-text-0)' }}>{GUIDE_LABEL(g.metric)}</b>
        {basis && <span style={{ color: 'var(--mc-text-4)' }}> ({basis})</span>}
        {g.guided_for_label ? <span style={{ color: 'var(--mc-text-4)' }}> · {g.guided_for_label}</span> : null}
        {' — '}<HiText text={txt} verdict={g.compare?.verdict ?? null} />
        {g.guide_low != null && g.guide_high != null && (
          <span style={{ color: 'var(--mc-text-4)' }}>
            {' '}(guided {fmtGuideRange({ low: g.guide_low, high: g.guide_high, unit: guideUnit(g.unit) })}
            {g.actual != null ? `, came in ${fmtGuideRange({ low: g.actual, high: g.actual, unit: guideUnit(g.unit) })}` : ''})
          </span>
        )}
      </Bul>,
    );
  }
  return out;
}

const guideUnit = (u: string | null | undefined): GuidanceFigure['unit'] =>
  u === 'pct' ? 'pct' : u === 'usd_share' ? 'usd_share' : 'usd';

// ── section 2 · guide vs expectations ──────────────────────────────────────
const DIRECTION_VERB: Record<GuideChange['direction'], string> = {
  raised: 'Raised', lowered: 'Lowered', reiterated: 'Reiterated',
  narrowed: 'Narrowed', widened: 'Widened',
};

function guideChangeBullet(g: GuideChange, est: number | null): React.ReactNode {
  const verb = DIRECTION_VERB[g.direction] || 'Changed';
  const good = g.direction === 'raised' ? true : g.direction === 'lowered' ? false : null;
  const unit = guideUnit(g.unit);
  const period = g.period_label || 'the next period';
  const basis = g.basis === 'adjusted' ? 'adj. ' : g.basis === 'gaap' ? 'GAAP ' : '';
  const dp = num(g.delta_pct);
  const showDelta = dp != null && g.direction !== 'reiterated' && Math.abs(dp) >= 0.05;
  const mid = (num(g.new_low) != null && num(g.new_high) != null)
    ? ((g.new_low as number) + (g.new_high as number)) / 2 : null;
  // Only compare against the street off a positive consensus. A guide measured
  // against a zero or negative estimate is stated as a difference, never a %.
  const vsStreet: React.ReactNode = est == null || mid == null ? null
    : est > 0
      ? (() => {
        const diff = ((mid - est) / est) * 100;
        return (
          <span style={{ color: 'var(--mc-text-4)' }}>
            {' '}Street had {fmtGuideRange({ low: est, high: est, unit })} — midpoint{' '}
            <b style={{ color: diff >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>
              {diff >= 0 ? '+' : '−'}{Math.abs(diff).toFixed(1)}%
            </b>{' '}{diff >= 0 ? 'above' : 'below'} it.
          </span>
        )
      })()
      : (
        <span style={{ color: 'var(--mc-text-4)' }}>
          {' '}Street had {fmtGuideRange({ low: est, high: est, unit })} — a percentage gap off a
          non-positive estimate would be meaningless, so the two are shown side by side only.
        </span>
      );
  return (
    <Bul key={`${g.metric}-${g.period_label}-${g.direction}`}>
      <b style={{ color: good == null ? 'var(--mc-text-1)' : good ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{verb}</b>
      {' '}the <b style={{ color: 'var(--mc-text-0)' }}>{period} {basis}{midSentence(GUIDE_LABEL(g.metric))}</b> guide
      {showDelta ? <> by <b style={{ color: 'var(--mc-text-0)' }}>{Math.abs(dp as number).toFixed(1)}%</b></> : null}
      {num(g.new_low) != null && num(g.new_high) != null && (
        <> to <b style={{ color: 'var(--mc-text-0)' }}>{fmtGuideRange({ low: g.new_low, high: g.new_high, unit })}</b></>
      )}
      {/* "…to $21%–22% from $21%–22%" is noise on a reiteration; the prior
          range only earns its space when it actually differs. */}
      {num(g.prev_low) != null && num(g.prev_high) != null
        && !(g.prev_low === g.new_low && g.prev_high === g.new_high) && (
        <span style={{ color: 'var(--mc-text-4)' }}> from {fmtGuideRange({ low: g.prev_low, high: g.prev_high, unit })}</span>
      )}
      .{vsStreet}
    </Bul>
  );
}

/** The street's number for the period/metric a guide change refers to, taken
 *  from the guidance-figure list the engine already matched. Basis must agree
 *  when both sides state one — an adjusted guide is not measured against a GAAP
 *  consensus. */
function estFor(figs: Array<GuidanceFigure & { est?: number | null }> | null | undefined, g: GuideChange): number | null {
  if (!Array.isArray(figs)) return null;
  const hit = figs.find((f) =>
    f && f.metric === g.metric && f.period_label === g.period_label
    && (g.basis == null || f.basis == null || f.basis === g.basis));
  return hit ? num(hit.est) : null;
}

// ═══════════════════════════════════════════════════════════════════════════
function DetailPanel({ r }: { r: UsRowX }) {
  const s = normSeries(r.series);
  const cols = s ? buildCols(s, r.quarter) : null;
  const ctx = (r.context || null) as UsContext | null;
  const vg = (r.vs_guide || null) as VsGuide | null;
  const changes: GuideChange[] = Array.isArray(r.guide_change) ? r.guide_change : [];
  const figs = Array.isArray(r.guidance_figures) ? r.guidance_figures : [];
  const metrics: KeyMetric[] = (Array.isArray(r.key_metrics) ? r.key_metrics : [])
    .filter((m) => m && Number.isFinite(m.value));
  const snippets: string[] = Array.isArray(r.guidance_snippets) ? r.guidance_snippets : [];
  const tags = (r.tags_used || null) as Record<string, string | null> | null;

  // ── the display columns. A period we could not match by date is not shown at
  // all, rather than shown as a column of dashes.
  const displayCols = cols ? [cols.cur, cols.prev, cols.yr, cols.yr3].filter(Boolean) as PanelCol[] : [];
  const head = displayCols.map((c) => ({ label: c.label, sub: c.sub }));
  const growthHead: Array<{ label: string; sub?: string }> = [];
  if (cols?.prev) growthHead.push({ label: 'QoQ' });
  if (cols?.yr) growthHead.push({ label: 'YoY' });
  if (cols?.yr3) growthHead.push({ label: '3-YR CAGR' });

  const seriesRow = (label: string, arr: unknown, note?: string): TableRow | null => {
    if (!s || !cols) return null;
    const vals = displayCols.map((c) => at(arr, c.idx));
    if (vals.every((v) => v == null)) return null;         // no row of dashes
    const cur = at(arr, cols.cur.idx);
    const cells: Cell[] = vals.map(usdCell);
    if (cols.prev) cells.push(growthCell(cur, at(arr, cols.prev.idx)));
    if (cols.yr) cells.push(growthCell(cur, at(arr, cols.yr.idx)));
    if (cols.yr3) cells.push(cagrCell(cur, at(arr, cols.yr3.idx), cols.yr3GapDays));
    return { label, note, cells };
  };

  const resultRows: TableRow[] = [];
  if (s && cols) {
    for (const [label, arr] of [
      ['Revenue', s.revenue], ['Gross profit', s.gross_profit],
      ['Operating income', s.operating_income], ['Net income', s.net_income],
      ['Free cash flow', s.fcf],
    ] as Array<[string, unknown]>) {
      const row = seriesRow(label, arr, 'GAAP');
      if (row) resultRows.push(row);
    }
    // Press-release operating metrics that carry a genuinely comparable figure
    // — a dollar value AND the YoY the company itself stated. There is no
    // quarterly history behind them (they exist only in the release), so the
    // periods we cannot fill stay empty and the row says where it came from.
    for (const m of metrics) {
      if (resultRows.length >= 9) break;
      if (!m || m.unit !== 'usd' || num(m.yoy_pct) == null || !Number.isFinite(m.value)) continue;
      if (m.id === 'free_cash_flow' && resultRows.some((x) => x.label === 'Free cash flow')) continue;
      const cells: Cell[] = displayCols.map((c, i) => i === 0 ? { text: fmtKeyMetric(m) } : DASH);
      if (cols.prev) cells.push(DASH);
      if (cols.yr) {
        const y = num(m.yoy_pct) as number;
        cells.push({ text: signedPct(y), color: y >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' });
      }
      if (cols.yr3) cells.push(DASH);
      resultRows.push({ label: m.label || KEY_METRIC_LABEL[m.id] || m.id, note: 'rel.', cells });
    }
  }

  // ── margins. Each is a % of the same period's revenue; the deltas are basis
  // points, because a margin move is a percentage-POINT move and calling it "%"
  // is a different (and wrong) number.
  const marginRows: TableRow[] = [];
  if (s && cols) {
    const revAt = (i: number) => at(s.revenue, i);
    const mk = (label: string, arr: unknown): TableRow | null => {
      const vals = displayCols.map((c) => marginPct(at(arr, c.idx), revAt(c.idx)));
      if (vals.every((v) => v == null)) return null;
      const cur = marginPct(at(arr, cols.cur.idx), revAt(cols.cur.idx));
      const cells: Cell[] = vals.map(pctCell);
      if (cols.prev) cells.push(bpsCell(cur, marginPct(at(arr, cols.prev.idx), revAt(cols.prev.idx))));
      if (cols.yr) cells.push(bpsCell(cur, marginPct(at(arr, cols.yr.idx), revAt(cols.yr.idx))));
      if (cols.yr3) cells.push(bpsCell(cur, marginPct(at(arr, cols.yr3.idx), revAt(cols.yr3.idx))));
      return { label, cells };
    };
    for (const [label, arr] of [
      ['Gross margin', s.gross_profit], ['Operating margin', s.operating_income],
      ['Net margin', s.net_income], ['FCF margin', s.fcf],
    ] as Array<[string, unknown]>) {
      const row = mk(label, arr);
      if (row) marginRows.push(row);
    }
  }

  // ── 3-yr revenue CAGR, and the same figure one and two quarters ago. The
  // trend in the CAGR is the thing worth reading; a single CAGR is not.
  const cagrTrend = (() => {
    if (!s || !cols) return null;
    const val = (idx: number): number | null => {
      const j = backFrom(s.ends, idx, 1095, 60);
      if (j == null) return null;
      const a = at(s.revenue, idx), b = at(s.revenue, j);
      if (a == null || b == null || a <= 0 || b <= 0) return null;
      const p = (Math.pow(a / b, 1 / 3) - 1) * 100;
      return Number.isFinite(p) ? p : null;
    };
    const now = val(cols.cur.idx);
    if (now == null) return null;
    const pIdx = cols.prev?.idx ?? null;
    const p1 = pIdx != null ? val(pIdx) : null;
    const p2Idx = pIdx != null ? backFrom(s.ends, pIdx, 91, 30) : null;
    const p2 = p2Idx != null ? val(p2Idx) : null;
    return { now, p1, p2 };
  })();

  // ── stock comp as a share of revenue and of free cash flow. Both only off a
  // positive base: SBC "as 210% of a negative FCF" is not a quality signal, it
  // is a sign error.
  const sbc = ctx ? num(ctx.sbc_musd) : null;
  const revNow = num(r.revenue_curr_musd) ?? (s && cols ? at(s.revenue, cols.cur.idx) : null);
  const fcfNow = (s && cols ? at(s.fcf, cols.cur.idx) : null) ?? num(r.fcf_curr_musd);
  const sbcOfRev = (sbc != null && revNow != null && revNow > 0) ? (sbc / revNow) * 100 : null;
  const sbcOfFcf = (sbc != null && fcfNow != null && fcfNow > 0) ? (sbc / fcfNow) * 100 : null;

  const quarterGuideBullets = guideBullets(vg?.for_quarter, 'quarter');
  const yearGuideBullets = guideBullets(vg?.for_year, 'year');
  const street = streetBullet(r);
  const hasResultsVs = !!street || quarterGuideBullets.length > 0 || yearGuideBullets.length > 0;

  const ctxBullets: React.ReactNode[] = [];
  // A PRELIM print's balance sheet is not on EDGAR yet, so what we hold is the
  // PREVIOUS quarter's. Saying so once, at the top, is the difference between
  // a stale number and a dated one.
  const ctxStale = (() => {
    if (!ctx?.as_of || !r.period_end) return false;
    const a = Date.parse(ctx.as_of + 'T00:00:00Z'), b = Date.parse(r.period_end + 'T00:00:00Z');
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) > 20 * 86_400_000;
  })();
  if (ctx) {
    if (ctxStale) ctxBullets.push(
      <Bul key="stale"><span style={{ color: 'var(--mc-text-3)' }}>
        Balance sheet and capital returns below are the <b>previous</b> quarter&apos;s, at {ctx.as_of} — this
        quarter&apos;s reach EDGAR with the 10-Q.
      </span></Bul>,
    );
    const cash = num(ctx.cash_musd), debt = num(ctx.debt_musd);
    if (cash != null) {
      ctxBullets.push(
        <Bul key="cash">
          <b style={{ color: 'var(--mc-text-0)' }}>{fmtUsd(cash)}</b> in cash
          {ctx.cash_incl_st_inv ? ' & equivalents, incl. short-term investments' : ' & equivalents'}
          {debt != null && <> against <b style={{ color: 'var(--mc-text-0)' }}>{fmtUsd(debt)}</b> of total debt —{' '}
            <b style={{ color: cash - debt >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>
              {fmtUsd(Math.abs(cash - debt))} net {cash - debt >= 0 ? 'cash' : 'debt'}
            </b></>}
          .{ctx.as_of && <span style={{ color: 'var(--mc-text-4)' }}> Balance sheet at {ctx.as_of}.</span>}
        </Bul>,
      );
    } else if (debt != null) {
      ctxBullets.push(<Bul key="debt"><b style={{ color: 'var(--mc-text-0)' }}>{fmtUsd(debt)}</b> of total debt; no cash line tagged.</Bul>);
    }
    const bb = num(ctx.buyback_musd), dv = num(ctx.dividends_musd);
    if (bb != null || dv != null) {
      ctxBullets.push(
        <Bul key="return">
          {bb != null && <>Bought back <b style={{ color: 'var(--mc-text-0)' }}>{fmtUsd(bb)}</b> of stock</>}
          {bb != null && dv != null ? ' and ' : ''}
          {dv != null && <>{bb == null ? 'Paid ' : 'paid '}<b style={{ color: 'var(--mc-text-0)' }}>{fmtUsd(dv)}</b> in dividends</>}
          {' '}this quarter.
        </Bul>,
      );
    }
    if (sbc != null) {
      ctxBullets.push(
        <Bul key="sbc">
          Paid out <b style={{ color: 'var(--mc-text-0)' }}>{fmtUsd(sbc)}</b> in stock comp
          {sbcOfRev != null && <> — <b style={{ color: 'var(--mc-text-0)' }}>{sbcOfRev.toFixed(1)}%</b> of revenue</>}
          {sbcOfFcf != null
            ? <> and <b style={{ color: sbcOfFcf > 100 ? 'var(--mc-bearish)' : 'var(--mc-text-0)' }}>{sbcOfFcf.toFixed(0)}%</b> of free cash flow</>
            : (sbc != null && fcfNow != null && fcfNow <= 0
              ? <span style={{ color: 'var(--mc-text-4)' }}> (share of free cash flow n/m — FCF was not positive)</span>
              : null)}
          .
        </Bul>,
      );
    }
    const sh = num(ctx.diluted_shares_m), shY = num(ctx.diluted_shares_yoy_pct);
    if (sh != null || shY != null) {
      ctxBullets.push(
        <Bul key="shares">
          {sh != null && <>Diluted share count <b style={{ color: 'var(--mc-text-0)' }}>{sh.toFixed(1)}M</b></>}
          {shY != null && <>{sh != null ? ', ' : 'Diluted share count '}
            <b style={{ color: shY <= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtPct(shY, 1)}</b> YoY
            {shY < 0 ? ' (shrinking)' : shY > 0 ? ' (dilution)' : ''}</>}
          .
        </Bul>,
      );
    }
  }
  if (cagrTrend) {
    ctxBullets.push(
      <Bul key="cagr">
        <b style={{ color: 'var(--mc-text-0)' }}>{cagrTrend.now.toFixed(1)}%</b> 3-yr revenue CAGR
        {cagrTrend.p1 != null && <> vs. <b style={{ color: 'var(--mc-text-0)' }}>{cagrTrend.p1.toFixed(1)}%</b> last Q</>}
        {cagrTrend.p2 != null && <> &amp; <b style={{ color: 'var(--mc-text-0)' }}>{cagrTrend.p2.toFixed(1)}%</b> 2 Qs ago</>}
        .
      </Bul>,
    );
  }

  const box: React.CSSProperties = {
    marginTop: 9, padding: '9px 10px', borderRadius: 6,
    backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)',
    borderLeft: '3px solid var(--mc-cyan)', minWidth: 0, overflow: 'hidden',
  };

  return (
    <div style={box}>
      {/* ── 1 · results vs expectations ── */}
      <PanelH note="the street, and the company's own guide from last quarter">RESULTS VS. EXPECTATIONS</PanelH>
      {hasResultsVs ? (
        <>
          {street}
          {quarterGuideBullets}
          {yearGuideBullets}
          {vg?.prior_filing_date && (
            <Quiet>
              Guide read from the {vg.prior_filing_date} release
              {vg.prior_filing_url && <> · <a href={vg.prior_filing_url} target="_blank" rel="noreferrer" style={{ color: 'var(--mc-cyan)', textDecoration: 'none' }}>open it ↗</a></>}
            </Quiet>
          )}
        </>
      ) : (
        <Quiet>
          No street estimate and no prior guide on file for this quarter, so there is nothing to measure the
          print against. The tiles above are the filing&apos;s own numbers versus the year-ago quarter.
        </Quiet>
      )}
      {(r.d1_pct != null || r.move_pct != null) && (
        <Quiet>
          Market&apos;s verdict:{' '}
          <b style={{ color: (r.d1_pct ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtPct(r.d1_pct, 1)}</b> on the day,{' '}
          <b style={{ color: (r.move_pct ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtPct(r.move_pct, 1)}</b> since the print.
        </Quiet>
      )}

      {/* ── 2 · guide vs expectations ── */}
      {(changes.length > 0 || figs.length > 0) && (
        <>
          <PanelH note="where the outlook moved, and what the street was carrying">GUIDE VS. EXPECTATIONS</PanelH>
          {changes.length > 0
            ? changes.map((g) => guideChangeBullet(g, estFor(figs, g)))
            : <Quiet>No prior guide to compare against — the figures below are this release&apos;s outlook as given.</Quiet>}
          {figs.length > 0 && <GuideBlock figs={figs} label={r.guidance} showSource />}
        </>
      )}

      {/* ── 3 · results table ── */}
      {resultRows.length > 0 && displayCols.length > 0 && (
        <>
          <PanelH note={`${displayCols.length} period${displayCols.length === 1 ? '' : 's'} matched by period-end date`}>
            RESULTS
          </PanelH>
          <Scroller><MiniTable head={[...head, ...growthHead]} rows={resultRows} /></Scroller>
          <div style={{ fontSize: 9, color: 'var(--mc-text-4)', marginTop: 4, lineHeight: 1.5 }}>
            GAAP, from the filer&apos;s own XBRL. Rows marked <b>rel.</b> are press-release operating metrics with no
            quarterly history behind them — the YoY is the company&apos;s own. A period the filer did not tag is
            left empty; <b>n/m</b> is a growth rate whose base was zero or negative, which has no meaning.
          </div>
        </>
      )}

      {/* ── 4 · margins ── */}
      {marginRows.length > 0 && displayCols.length > 0 && (
        <>
          <PanelH note="% of revenue · deltas in basis points, not %">MARGINS</PanelH>
          <Scroller>
            <MiniTable
              head={[...head, ...([
                cols?.prev ? { label: 'QoQ BPS Δ' } : null,
                cols?.yr ? { label: 'YoY BPS Δ' } : null,
                cols?.yr3 ? { label: '3-YR BPS Δ' } : null,
              ].filter(Boolean) as Array<{ label: string }>)]}
              rows={marginRows} />
          </Scroller>
          <div style={{ fontSize: 9, color: 'var(--mc-text-4)', marginTop: 4, lineHeight: 1.5 }}>
            100 bps = 1 percentage point. A margin is only shown where that period&apos;s revenue was positive.
          </div>
        </>
      )}

      {/* ── 5 · key context ── */}
      {ctxBullets.length > 0 && (
        <>
          <PanelH note="balance sheet, capital returned, dilution">KEY CONTEXT</PanelH>
          {ctxBullets}
        </>
      )}

      {/* ── 6 · everything the collapsed card hides ── */}
      {metrics.length > 0 && (
        <>
          <PanelH note="every figure the release stated, not just the four on the card">REPORTED OPERATING METRICS</PanelH>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {metrics.map((m, i) => (
              <div key={`${m.id}-${i}`} style={{ fontSize: 11, color: 'var(--mc-text-2)', lineHeight: 1.5, minWidth: 0 }}>
                <span style={{ color: 'var(--mc-text-3)' }}>{m.label || KEY_METRIC_LABEL[m.id] || m.id}</span>{' '}
                <b style={{ color: 'var(--mc-text-0)' }}>{fmtKeyMetric(m)}</b>
                {num(m.yoy_pct) != null && (
                  <b style={{ color: (m.yoy_pct as number) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>
                    {' '}{fmtPct(m.yoy_pct, 1)} YoY
                  </b>
                )}
                {m.source && <div style={{ fontSize: 9, color: 'var(--mc-text-4)', lineHeight: 1.4 }}>“{m.source}”</div>}
              </div>
            ))}
          </div>
        </>
      )}

      {snippets.length > 0 && (
        <>
          <PanelH note="verbatim, from the press release">GUIDANCE LANGUAGE</PanelH>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {snippets.map((q, i) => (
              <div key={i} style={{ fontSize: 11, color: 'var(--mc-text-2)', lineHeight: 1.45, borderLeft: '2px solid var(--mc-bg-4)', paddingLeft: 8 }}>“{q}”</div>
            ))}
          </div>
        </>
      )}

      {tags && Object.keys(tags).length > 0 && (
        <>
          <PanelH note="which XBRL concept each number was read from">TAGS USED</PanelH>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', fontSize: 9, color: 'var(--mc-text-4)', lineHeight: 1.6 }}>
            {Object.entries(tags).filter(([, v]) => !!v).map(([k, v]) => (
              <span key={k} style={{ whiteSpace: 'nowrap' }}>
                {k.replace(/_/g, ' ')} ← <code style={{ color: 'var(--mc-text-3)' }}>{v}</code>
              </span>
            ))}
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10, fontSize: 10 }}>
        {r.filing_url && (
          <a href={r.filing_url} target="_blank" rel="noreferrer" style={{ color: 'var(--mc-cyan)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            {r.form} on SEC EDGAR <ExternalLink className="w-3 h-3" />
          </a>
        )}
        {r.release_url && (
          <a href={r.release_url} target="_blank" rel="noreferrer" style={{ color: 'var(--mc-cyan)', textDecoration: 'none' }}>earnings release ↗</a>
        )}
        {r.guidance_url && r.guidance_url !== r.release_url && (
          <a href={r.guidance_url} target="_blank" rel="noreferrer" style={{ color: 'var(--mc-cyan)', textDecoration: 'none' }}>guidance release ↗</a>
        )}
        <span style={{ color: 'var(--mc-text-4)' }}>
          {r.period_end ? `Quarter ended ${r.period_end} · ` : ''}filed {r.filing_date}
          {r.prelim ? ' · PRELIM, the 10-Q has not posted yet' : ''}
        </span>
      </div>
    </div>
  );
}

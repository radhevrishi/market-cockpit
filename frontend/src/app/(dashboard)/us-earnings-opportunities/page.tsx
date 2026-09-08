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

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Star, ExternalLink, RefreshCw, ChevronDown, ChevronRight, Award, AlertTriangle } from 'lucide-react';
import { syncUsConviction } from '@/lib/conviction-beats-us';
import {
  fmtUsd, fmtPx, fmtPct, US_TIER_ORDER,
  type UsGradedRow, type EarningsTier,
} from '@/lib/us-earnings-core';
import { debouncedSetItem, getItemSync } from '@/lib/debounced-storage';

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
const LS_PREFIX = 'mc:graded-us:v2:';
const LS_DATE = 'mc:us-eo:v1:date';
const LS_DAYS = 'mc:us-eo:v1:days';
const LS_SCRUB = 'mc:graded-us:scrub:v2';

function scrubOldCaches() {
  try {
    if (localStorage.getItem(LS_SCRUB) === '1') return;
    const kill: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('mc:graded-us:v1:')) kill.push(k);
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

function readCache(key: string, isToday: boolean): UsPayload | null {
  try {
    const raw = getItemSync(LS_PREFIX + key);
    if (!raw) return null;
    const o = JSON.parse(raw);
    const age = Date.now() - Date.parse(o?._cachedAt || '');
    const maxAge = isToday ? 15 * 60_000 : 7 * 24 * 3600_000;
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

  useEffect(() => { scrubOldCaches(); }, []);
  useEffect(() => { try { debouncedSetItem(LS_DATE, date); } catch {} }, [date]);
  useEffect(() => { try { debouncedSetItem(LS_DAYS, String(days)); } catch {} }, [days]);

  const cacheKey = `${date}|${days}`;
  const isToday = date >= today;

  const { data, isLoading, isFetching, error, refetch } = useQuery<UsPayload>({
    queryKey: ['graded-us', cacheKey, forceKey],
    queryFn: async () => {
      if (forceKey === 0) {
        const cached = readCache(cacheKey, isToday);
        if (cached) return cached;
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 280_000);
      try {
        const res = await fetch(
          `/api/v1/earnings/graded-us?date=${date}&days=${days}${forceKey > 0 ? '&force=1' : ''}`,
          { cache: 'no-store', signal: ctrl.signal },
        );
        if (!res.ok) throw new Error(`Grading failed (HTTP ${res.status})`);
        const payload = await res.json();
        if (cacheable(payload)) {
          try {
            debouncedSetItem(LS_PREFIX + cacheKey, JSON.stringify({ ...payload, _cachedAt: new Date().toISOString() }));
          } catch { /* quota — the payload still renders, it just isn't cached */ }
        }
        return payload;
      } finally { clearTimeout(timer); }
    },
    staleTime: isToday ? 3 * 60_000 : 60 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

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
  const { data: cal, isFetching: calFetching } = useQuery<CalendarPayload>({
    queryKey: ['calendar-us', calFrom, calTo],
    queryFn: async () => {
      const res = await fetch(`/api/v1/earnings/calendar-us?from=${calFrom}&to=${calTo}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Calendar failed (HTTP ${res.status})`);
      return res.json();
    },
    enabled: viewMode === 'CALENDAR',
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });

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
        <button onClick={exportCsv} style={btn()}>📊 CSV</button>
        <button onClick={exportTradingView} style={btn()}>📈 TradingView</button>
        <button onClick={() => { setForceKey((k) => k + 1); setTimeout(() => refetch(), 0); }}
          disabled={isFetching} style={{ ...btn(), opacity: isFetching ? 0.5 : 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <RefreshCw className="w-3 h-3" style={{ animation: isFetching ? 'spin 1s linear infinite' : undefined }} />
          {isFetching ? 'Scanning…' : 'Force re-scan'}
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
            Pulling the filing list from EDGAR, then the XBRL for each filer. A busy window takes 20–60 seconds.
          </div>
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
              {calFrom} → {calTo}{cal ? ` · ${cal.total} companies` : ''}{calFetching ? ' · loading…' : ''}
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
          {!cal && calFetching && <div style={panel()}><span style={{ color: 'var(--mc-text-2)' }}>Sweeping EDGAR for {calFrom} → {calTo}… (first load of a range takes 10–40s; it is cached after that)</span></div>}

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
                          🗓 {shownExp.length} {isFuture ? 'scheduled' : 'still to report'}
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
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))',
                gap: 12, padding: '0 14px 14px',
              }}>
                {rows.map((r) => <UsEarningsCard key={`${r.ticker}:${r.filing_date}`} r={r} />)}
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

function UsEarningsCard({ r }: { r: UsGradedRow }) {
  const meta = TIER_META[r.tier];
  const opmD = (r.opm_pct != null && r.opm_prev_pct != null) ? r.opm_pct - r.opm_prev_pct : null;
  return (
    <div style={{
      backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)',
      borderRadius: 'var(--mc-radius)', padding: 12, borderTop: `3px solid ${meta.color}`,
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        <Tile label="REVENUE" value={fmtPct(r.sales_yoy_pct)} color={growthColor(r.sales_yoy_pct)}
          sub={`${fmtUsd(r.revenue_prev_musd)} → ${fmtUsd(r.revenue_curr_musd)}`} />
        <Tile label="EPS · GAAP" value={fmtPct(r.eps_yoy_pct)} color={growthColor(r.eps_yoy_pct)}
          sub={r.eps_prev != null && r.eps_curr != null
            ? `$${r.eps_prev.toFixed(2)} → ${r.eps_derived ? '≈' : ''}$${r.eps_curr.toFixed(2)}`
            : r.eps_curr != null ? `${r.eps_derived ? '≈' : ''}$${r.eps_curr.toFixed(2)} · no prior base`
            : 'EPS not tagged'} />
        <Tile label="OPM" value={r.opm_pct != null ? `${r.opm_pct.toFixed(1)}%` : '—'}
          color={opmD == null ? undefined : opmD >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)'}
          sub={opmD != null ? `${opmD >= 0 ? '+' : ''}${opmD.toFixed(1)}pp YoY` : 'no prior margin'} />
        <Tile label="CFO/NI" value={r.cfo_to_pat_ratio != null ? r.cfo_to_pat_ratio.toFixed(2) : '—'}
          color={r.cfo_to_pat_ratio == null ? undefined : r.cfo_to_pat_ratio >= 1 ? 'var(--mc-bullish)' : r.cfo_to_pat_ratio >= 0.5 ? undefined : 'var(--mc-bearish)'}
          sub={r.cfo_curr_musd != null ? `CFO ${fmtUsd(r.cfo_curr_musd)}` : 'cash flow pending'} />
      </div>

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

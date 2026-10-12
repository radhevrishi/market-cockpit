// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { debouncedSetItem, getItemSync } from '@/lib/debounced-storage';
import { istToday as _istToday } from '@/lib/market-hours';
import { gradeIndiaRow as gradeRow } from '@/lib/india-grade';
import type { CalendarItem, CalendarPayload, MarketEarningsResult, MarketEarningsResponse, EarningsTier, ParsedEarning, OpportunitiesPayload } from './types';
import { ISO_DATE_RE, TIER_ORDER } from './constants';

// Hub source — single month or two months stitched
// PATCH 0187 — localStorage cache for hub data (per month set). Repeat
// visits load INSTANTLY from disk. Server still revalidates in background
// only when stale beyond 15 min for "today's month", 6h for past months.
export function useMarketEarnings(months: string[]) {
  // PATCH 0402 — bump v2 → v3 to invalidate stale browser caches that were
  // written during periods when /api/market/earnings returned empty or sparse
  // hub data (calendar showing "No filings" for most dates even though
  // server has recovered). Older versions are wiped on first load below.
  // PATCH 1029 — bump v3 → v4 to discard every browser's stale-EMPTY hub cache
  // written while April was blank (NSE had rolled it out of its live window).
  // An empty results[] array passed the old `parsed.results` truthiness check
  // and was served as fresh initialData for 15 min, so the calendar kept
  // showing "No filings" even after the server recovered the month.
  const HUB_LS_PREFIX = 'mc:hub:v7:';  // zzz183 — bumped v6→v7 because months-to-fetch key now includes next+1 month (4 months total)
  const key = months.join(',');
  // PATCH 0453 P1-12 — Audit found this hub-scrub ran on every render
  // (50-200ms cost iterating localStorage). Now runs once per app session
  // via useEffect with a sessionStorage flag, not on every parent render.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const SCRUB_HUB = 'mc:hub-scrub:v7';  // zzz183 — bumped v6→v7 for 4-month fetch key
      if (!localStorage.getItem(SCRUB_HUB)) {
        for (const k of Object.keys(localStorage)) {
          if (k.startsWith('mc:hub:v1:') || k.startsWith('mc:hub:v2:') || k.startsWith('mc:hub:v3:') || k.startsWith('mc:hub:v4:') || k.startsWith('mc:hub:v5:') || k.startsWith('mc:hub:v6:')) localStorage.removeItem(k);
        }
        localStorage.setItem(SCRUB_HUB, '1');
      }
    } catch {}
  }, []);
  return useQuery<MarketEarningsResponse>({
    queryKey: ['market-earnings-hub', key],
    queryFn: async () => {
      const responses = await Promise.all(
        months.map((m) => fetch(`/api/market/earnings?market=india&month=${m}`).then((r) => r.ok ? r.json() : { results: [] }))
      );
      const all: MarketEarningsResult[] = [];
      const seen = new Set<string>();
      const ingestedSet = new Set<string>();
      for (const r of responses) {
        for (const dd of ((r?.ingested_dates || []) as string[])) ingestedSet.add(dd);
        for (const e of (r?.results || []) as MarketEarningsResult[]) {
          // Dedup by ticker+company+date, NOT ticker+date alone. Two DIFFERENT
          // companies reporting the same day can share a blank/colliding ticker
          // (BSE-only filers, source rows without an NSE symbol); keying only on
          // ticker|date silently collapsed them so a 4-company day showed 1.
          // Including company keeps genuinely-identical rows deduped while never
          // dropping a distinct company. Date-agnostic — works every year.
          const k = `${e.ticker || ''}|${(e.company || '').toUpperCase()}|${e.resultDate}`;
          if (seen.has(k)) continue;
          seen.add(k);
          all.push(e);
        }
      }
      const payload = { results: all, source: responses[0]?.source || 'NSE + BSE', updatedAt: new Date().toISOString(), ingested_dates: [...ingestedSet] } as MarketEarningsResponse;
      // PATCH 0545 — debounced LS write (same rationale as writeLsCache below).
      // PATCH 1029 — only cache NON-EMPTY hub payloads. Caching an empty result
      // (e.g. during a transient server-empty window) poisons the calendar for
      // 15 min on the next visit. If empty, leave any prior good cache in place.
      try {
        if (typeof window !== 'undefined' && all.length > 0) {
          debouncedSetItem(HUB_LS_PREFIX + key, JSON.stringify({ ...payload, _cachedAt: Date.now() }));
        }
      } catch {}
      return payload;
    },
    // Aggressive caching: hub data is mostly stable. Refetch only every 15 min for current month, 6h for past.
    staleTime: 15 * 60_000,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    initialData: () => {
      if (typeof window === 'undefined') return undefined;
      try {
        // PATCH 0545 — race-aware read (see writeLsCache notes above).
        const raw = getItemSync(HUB_LS_PREFIX + key);
        if (!raw) return undefined;
        const parsed = JSON.parse(raw);
        // PATCH 0253 — Hub data for PAST months is immutable; for the current
        // month it still gets a background refetch via staleTime (15 min).
        // Previously we rejected cached data >6h old → 'Loading calendar from
        // KV…' spinner on every visit. Now we always return cached data on
        // mount; React Query handles freshness in background. User sees the
        // calendar instantly + the freshness chip on the page shows the age.
        // PATCH 1029 — only serve cached hub data when it actually has rows.
        // An empty results[] is never worth showing as "instant" data; return
        // undefined so React Query fetches fresh from the (recovered) server.
        if (parsed && Array.isArray(parsed.results) && parsed.results.length > 0) return parsed;
      } catch {}
      return undefined;
    },
    initialDataUpdatedAt: () => {
      // AUDIT_100 #6 — must always pair with initialData. Returning a number
      // when initialData returned undefined makes React Query treat fresh
      // fetches as already-stale; returning undefined when initialData has
      // a value makes the data "fresh" forever and skips refetch. Force a
      // safe pairing: if cache shape is invalid, treat as 0 (force refetch).
      if (typeof window === 'undefined') return undefined;
      try {
        const raw = getItemSync(HUB_LS_PREFIX + key);
        if (!raw) return undefined;
        const p = JSON.parse(raw);
        // PATCH 1029 — pair with initialData: empty cache → undefined (refetch).
        if (!p || !Array.isArray(p.results) || p.results.length === 0) return undefined;
        return typeof p._cachedAt === 'number' ? p._cachedAt : 0;
      } catch { return undefined; }
    },
  });
}

// PATCH 0155 / 0157 — Live enrichment via /api/v1/earnings/enrich.
// Fetches NSE structured + Screener + Yahoo data directly from Vercel,
// caching per-symbol+filed-date in KV (6h TTL). Cache key includes the
// filing date so a fresh filing naturally busts the old cache.
export function useLiveEnrichmentMap(symbols: string[], filed?: string) {
  // Stable key from sorted symbol list so the cache hits across renders
  const key = useMemo(() => `${[...symbols].sort().join(',')}|${filed || ''}`, [symbols, filed]);
  return useQuery<Record<string, any>>({
    queryKey: ['live-enrichment', key],
    enabled: symbols.length > 0,
    queryFn: async () => {
      const chunks: string[][] = [];
      for (let i = 0; i < symbols.length; i += 40) chunks.push(symbols.slice(i, i + 40));
      const filedParam = filed ? `&filed=${encodeURIComponent(filed)}` : '';
      const responses = await Promise.all(chunks.map((chunk) =>
        // zzz800 — encode each symbol: a raw '&' (M&M, S&SPOWER, GMRP&UI) ended
        // the query string and silently dropped it and every symbol after it.
        fetch(`/api/v1/earnings/enrich?symbols=${chunk.map(encodeURIComponent).join(',')}${filedParam}`)
          .then((r) => r.ok ? r.json() : { data: {} })
          .catch(() => ({ data: {} }))
      ));
      const merged: Record<string, any> = {};
      for (const r of responses) Object.assign(merged, r.data || {});
      return merged;
    },
    staleTime: 30 * 60_000,        // 30 min client-side (KV is 6h)
    refetchInterval: false,
  });
}

// Build the same { by_date, total } shape the Calendar view expects.
export function buildCalendarFromHub(hub: MarketEarningsResponse | undefined, fromIso: string, toIso: string): CalendarPayload {
  const by_date: Record<string, CalendarItem[]> = {};
  let total = 0;
  if (hub?.results) {
    for (const e of hub.results) {
      if (!e.resultDate || !ISO_DATE_RE.test(e.resultDate)) continue;
      // PATCH zzz91 (revert zzz90 EO1) — keep 'Upcoming' rows so users still see
      // scheduled board meetings in the calendar as a heads-up. The SCHEDULED
      // TODAY panel below ALREADY surfaces them with clear "results not yet
      // filed" copy. Hiding them removed visibility users relied on.
      if (e.resultDate < fromIso || e.resultDate > toIso) continue;
      if (!by_date[e.resultDate]) by_date[e.resultDate] = [];
      by_date[e.resultDate].push({
        symbol: e.ticker,
        company: e.company,
        filing_date: e.resultDate,
        filing_dt_iso: null,
        quarter: e.quarter || '',
        source_url: `https://www.nseindia.com/companies-listing/corporate-filings-financial-results?symbol=${encodeURIComponent(e.ticker)}`,
        exchange: 'NSE',
      });
      total++;
    }
  }
  for (const k of Object.keys(by_date)) {
    by_date[k].sort((a, b) => a.symbol.localeCompare(b.symbol));
  }
  return { total, by_date, ingested_dates: hub?.ingested_dates || [] };
}

// PATCH 0555 — Client-side dedup for cross-exchange duplicates that slipped
// past the server merge (e.g. same company entering once with NSE ticker
// "DJML" and once with BSE scrip "543193").  The server-side fix in
// /api/market/earnings/route.ts now skips these by normalized company name,
// but cached graded:v8 payloads written before the fix still contain the
// duplicate. This defensive client pass guarantees the UI never renders the
// same company twice. Numeric-only symbols (pure BSE scrip codes) lose to
// alphabetic NSE tickers; otherwise the higher-score / earlier-tier entry
// wins. Scoped per-tier to preserve `by_tier` shape.
export function dedupePayloadByCompany<T extends { by_tier?: Record<string, any[]> }>(p: T | undefined | null): T {
  if (!p || !p.by_tier) return p as T;
  const norm = (raw: string): string => {
    if (!raw) return '';
    return String(raw)
      .toLowerCase()
      .replace(/&amp;/g, '&')
      .replace(/[.,()]/g, ' ')
      .replace(/\b(ltd|limited|pvt|private|corp|corporation|inc|company|co|the)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  };
  const isNumericTicker = (t: string) => /^\d+$/.test(String(t || '').trim());
  // Collect best-card-per-company across tiers (BLOCKBUSTER > STRONG > MIXED > AVOID).
  const TIER_RANK: Record<string, number> = { BLOCKBUSTER: 0, STRONG: 1, MIXED: 2, AVOID: 3 };
  const winners = new Map<string, { card: any; tier: string }>();
  for (const t of (TIER_ORDER as string[])) {
    const list = p.by_tier?.[t] || [];
    for (const c of list) {
      const key = norm(c?.company || '') || String(c?.ticker || '').toUpperCase();
      if (!key) continue;
      const existing = winners.get(key);
      if (!existing) { winners.set(key, { card: c, tier: t }); continue; }
      // Prefer non-numeric NSE-style ticker over pure BSE scrip code.
      const exNum = isNumericTicker(existing.card?.ticker);
      const cuNum = isNumericTicker(c?.ticker);
      if (exNum && !cuNum) { winners.set(key, { card: c, tier: t }); continue; }
      if (!exNum && cuNum) continue;
      // Both alphabetic or both numeric → prefer better tier, then higher composite.
      if (TIER_RANK[t] < TIER_RANK[existing.tier]) { winners.set(key, { card: c, tier: t }); continue; }
      if (TIER_RANK[t] === TIER_RANK[existing.tier]) {
        const cs = Number(c?.composite_score ?? 0);
        const es = Number(existing.card?.composite_score ?? 0);
        if (cs > es) winners.set(key, { card: c, tier: t });
      }
    }
  }
  // Rebuild by_tier with only the winning cards.
  const out_by_tier: Record<string, any[]> = { BLOCKBUSTER: [], STRONG: [], MIXED: [], AVOID: [] };
  for (const { card, tier } of winners.values()) {
    if (out_by_tier[tier]) out_by_tier[tier].push(card);
  }
  // Preserve original sort within each tier (descending composite).
  for (const t of TIER_ORDER as string[]) {
    out_by_tier[t].sort((a, b) => Number(b?.composite_score ?? 0) - Number(a?.composite_score ?? 0));
  }
  return { ...p, by_tier: out_by_tier } as T;
}

// zzz800 — IST calendar arithmetic. `new Date(); setDate(-1); toISOString()`
// mixes the browser's LOCAL day with the UTC date: in India between 00:00 and
// 05:30 it returns the day BEFORE yesterday, so "yesterday" was off by one for
// the first five and a half hours of every day. Everything below derives from
// the IST date string and moves in whole UTC days, which cannot drift.
export function istDaysAgoISO(n: number): string {
  const [y, m, d] = _istToday().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}

/** Yesterday in IST (the name predates the fix; kept for its call sites). */
export function todayISO(): string {
  return istDaysAgoISO(1);
}

// PATCH 0560 — BUG-AUDIT-5: return today's date in IST (Asia/Kolkata, UTC+5:30).
// PATCH 0715 — body delegated to centralized lib/market-hours.
export function todayIstISO(): string {
  return _istToday();
}

// PATCH 0145: parse Trendlyne's period_ended (e.g. "31-Mar-2026") → YYYY-MM-DD
export function parseTrendlynePeriodEnd(s: string): string | null {
  if (!s) return null;
  const m = s.match(/(\d{1,2})[- /]([A-Za-z]{3,9})[- /](\d{4})/);
  if (!m) return null;
  const months: Record<string, number> = {
    JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
    JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
  };
  const mm = months[m[2].toUpperCase().slice(0, 3)];
  if (mm === undefined) return null;
  const day = parseInt(m[1], 10);
  const yr = parseInt(m[3], 10);
  return new Date(Date.UTC(yr, mm, day)).toISOString().slice(0, 10);
}

// PATCH 0137: derive opportunities from the worker-enriched calendar.
// Replaces the old news-regex grader with calendar-driven grading.
// PATCH 0145: additionally skip rows whose company hasn't actually filed yet
//  — either filing_date is in the future, OR Screener's latest quarter
//  doesn't match the period Trendlyne promised.
// zzz379 — derive the RESULT quarter from a filing date instead of hard-coded 'Q4'
// (August/Q1-FY27 filings were rendering "Q4 results"). Matches the server helper.
export function deriveQuarterLabel(filingDate?: string | null): 'Q1'|'Q2'|'Q3'|'Q4' {
  try {
    const iso = filingDate && filingDate.length === 10 ? filingDate + 'T00:00:00Z' : (filingDate || '');
    const d = iso ? new Date(iso) : new Date();
    const m = (Number.isFinite(d.getTime()) ? d.getUTCMonth() : new Date().getUTCMonth()) + 1;
    if (m >= 1 && m <= 3) return 'Q3';
    if (m >= 4 && m <= 6) return 'Q4';
    if (m >= 7 && m <= 9) return 'Q1';
    return 'Q2';
  } catch { return 'Q4'; }
}

// zzz669 — THE CLIENT'S OWN COPY OF THE GRADER IS GONE.
//
// It was 421 lines against the server's 721 — three hundred lines of drift
// between two implementations that were required to agree. The shared module
// records three over-grading bugs caused by exactly that gap, and the last one
// was the client's BLOCKBUSTER gate silently missing Paths D and E.
//
// There is now one grader, in lib/india-grade.ts, and this page calls it. The
// server route calls the same function on the same input, so the two can no
// longer disagree about anything.

// PATCH 0152 — Opportunities now JOIN /api/market/earnings (canonical filed
// list, same as Earnings Hub Calendar) with /api/v1/earnings/calendar
// (Screener+Yahoo enrichment) by ticker. The hub tells us WHO filed when;
// the worker tells us the financials. If no enrichment available, the
// market data still provides quality+sector+marketCap.
export function useEarningsOpportunitiesJoined(
  date: string,
  hub: MarketEarningsResponse | undefined,
  enrichmentMap: Record<string, any> | undefined,
): OpportunitiesPayload {
  // PATCH 0560 — IST date attribution.
  const todayIso = todayIstISO();
  const hubResults = hub?.results || [];
  const enrich = enrichmentMap || {};

  // Step 1: scope to the date the user wants.
  // When date='' (Latest), auto-pick the most recent past date with ≥1 filing.
  let resolvedDate: string | null = date || null;
  let dayList: MarketEarningsResult[] = [];
  if (date) {
    dayList = hubResults.filter((r) => r.resultDate === date && r.quality !== 'Upcoming');
  } else {
    // Group by date, find most recent past date with at least one filed (non-Upcoming)
    const byDate: Record<string, MarketEarningsResult[]> = {};
    for (const r of hubResults) {
      if (!r.resultDate || r.resultDate > todayIso) continue;
      if (r.quality === 'Upcoming') continue;
      (byDate[r.resultDate] = byDate[r.resultDate] || []).push(r);
    }
    const pastDates = Object.keys(byDate).sort().reverse();
    for (const d of pastDates) {
      if ((byDate[d] || []).length >= 1) {
        resolvedDate = d;
        dayList = byDate[d];
        break;
      }
    }
  }

  // Step 2: join each filed company with worker enrichment
  const joined = dayList.map((m) => {
    const e = enrich[m.ticker] || {};
    return {
      // PATCH 0153: pass hub quality so gradeRow can produce preview cards
      // even when worker hasn't enriched this ticker yet
      hub_quality: m.quality,
      // Identity (from market source — authoritative)
      symbol: m.ticker,
      company: m.company,
      filing_date: m.resultDate,
      quarter: m.quarter || e.quarter || deriveQuarterLabel((m as any).resultDate || (m as any).filing_date),
      sector: m.sector || e.sector,
      market_cap_bucket: e.market_cap_bucket
        || (m.marketCap === 'L' ? 'LARGE' : m.marketCap === 'M' ? 'MID' : m.marketCap === 'S' ? 'SMALL' : m.marketCap === 'Micro' ? 'MICRO' : null),
      market_cap_cr: e.market_cap_cr ?? null,
      source_url: e.source_url || `https://www.nseindia.com/companies-listing/corporate-filings-financial-results?symbol=${encodeURIComponent(m.ticker)}`,
      // Financials (from Screener via worker)
      sales_curr_cr: e.sales_curr_cr ?? null,
      sales_prev_cr: e.sales_prev_cr ?? null,
      sales_yoy_pct: e.sales_yoy_pct ?? null,
      pat_curr_cr: e.pat_curr_cr ?? null,
      pat_prev_cr: e.pat_prev_cr ?? null,
      pat_yoy_pct: e.pat_yoy_pct ?? null,
      eps_curr: e.eps_curr ?? null,
      eps_prev: e.eps_prev ?? null,
      eps_yoy_pct: e.eps_yoy_pct ?? null,
      op_profit_yoy_pct: e.op_profit_yoy_pct ?? null,
      opm_pct: e.opm_pct ?? null,
      opm_prev_pct: e.opm_prev_pct ?? null,
      pe: e.pe ?? null,
      // Yahoo overlay
      current_price: e.current_price ?? m.cmp ?? null,
      gap_pct: e.gap_pct ?? null,
      d1_pct: e.d1_pct ?? null,
      move_pct: e.move_pct ?? m.priceMove ?? null,
      pct_from_52w_high: e.pct_from_52w_high ?? null,
      rs_rating: e.rs_rating ?? null,
      stage: e.stage ?? null,
      trend_template_passes: e.trend_template_passes ?? false,
      // OCF (annual)
      ocf_annual_cr: e.ocf_annual_cr ?? null,
      pat_annual_cr: e.pat_annual_cr ?? null,
      ocf_to_pat_ratio: e.ocf_to_pat_ratio ?? null,
      cash_fy: e.cash_fy ?? null, cash_basis: e.cash_basis ?? null,   // zzz965
      // Period match
      period_ended: e.period_ended,
      latest_quarter_end_iso: e.latest_quarter_end_iso,
      announce_date_iso: e.announce_date_iso,
      financials_source: e.financials_source,
    };
  });

  const graded: ParsedEarning[] = [];
  for (const row of joined) {
    const g = gradeRow(row);
    if (g) graded.push(g);
  }
  const by_tier: Record<EarningsTier, ParsedEarning[]> = {
    BLOCKBUSTER: [], STRONG: [], MIXED: [], AVOID: [],
  };
  for (const g of graded) by_tier[g.tier].push(g);
  for (const t of TIER_ORDER) by_tier[t].sort((a, b) => b.composite_score - a.composite_score);

  return {
    filing_date: resolvedDate,
    candidates_total: graded.length,
    raw_items_total: dayList.length,
    by_tier,
    generated_at: hub?.updatedAt || new Date().toISOString(),
    sources_polled: 2,
  };
}

// PATCH 0144 — Pro card matching EarningsPulse layout:
// COMPANY  ·  PE · Q4 · CAP-BUCKET · SECTOR · ☀️/🌙 · ₹PRICE
// [Move %] [Gap %] [D1 %]   (intraday placeholders until price feed wired)
// [Sales YoY %  curr Cr vs prev Cr]   [Net Profit YoY % curr vs prev]   [EPS YoY % curr vs prev]   [Score]
// Brief narrative  ·  methodology pills (✓)  ·  caveat pills (⚠)  ·  Filing link
// ─────────────────────────────────────────────────────────────────────────────
// Format helpers — match EarningsPulse Cr convention ("₹181.1K Cr" / "₹3184 Cr" / "₹4.2 Cr")
export function fmtCr(v: number | null | undefined): string | null {
  if (v == null) return null;
  const abs = Math.abs(v);
  if (abs >= 10_000)  return `₹${(v / 1_000).toFixed(1)}K Cr`;  // 181.1K
  if (abs >= 100)     return `₹${Math.round(v)} Cr`;             // 3184
  if (abs >= 10)      return `₹${v.toFixed(1)} Cr`;              // 47.4
  return                     `₹${v.toFixed(2)} Cr`;              // 4.20
}

export function fmtPx(v: number | null | undefined): string | null {
  if (v == null) return null;
  return Math.abs(v) >= 100 ? `₹${Math.round(v)}` : `₹${v.toFixed(2)}`;
}

export function fmtPct(p: number | null | undefined, digits = 0): string {
  if (p == null || !Number.isFinite(p)) return '—';
  // PATCH 1023 — a sub-1% move rounds to 0 and used to render as the
  // confusing "-0%" / "+0%" (looked like a data bug). Show "flat" instead so
  // a genuine ~0% reaction is visually distinct from missing data ("—").
  const r = Number(p.toFixed(digits));
  if (r === 0) return 'flat';
  return `${r > 0 ? '+' : ''}${r.toFixed(digits)}%`;
}

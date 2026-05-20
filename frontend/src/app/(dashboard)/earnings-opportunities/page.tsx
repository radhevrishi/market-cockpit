'use client';

// ═══════════════════════════════════════════════════════════════════════════
// EARNINGS OPPORTUNITIES PRO — page (patch 0132)
//
// Pure presentation layer.  Reads from /api/v1/earnings/opportunities which
// fetches BSE/NSE results announcements + Indian results RSS feeds live and
// grades each filing into BLOCKBUSTER / STRONG / MIXED / AVOID.
//
// NO localStorage, NO Multibagger dependency, NO hardcoded data.
// All financials parsed server-side from result-announcement text.
// User: 'first calendar should be perfect with all these companies then
// getting correct data'.
// ═══════════════════════════════════════════════════════════════════════════

import { useMemo, useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Calendar as CalendarIcon, ExternalLink, RefreshCw, ChevronDown, ChevronRight, Grid3X3, FileText } from 'lucide-react';
import api from '@/lib/api';
// PATCH 0186 — Auto-sync BLOCKBUSTER/STRONG cards into Conviction Beats pipeline
import { syncFromEarningsOps, type ConvictionTier } from '@/lib/conviction-beats';

// ─── Calendar payload types ────────────────────────────────────────────────
interface CalendarItem {
  symbol: string;
  company: string;
  filing_date: string;
  filing_dt_iso?: string | null;
  quarter?: string;
  period_ended?: string;
  audited?: boolean;
  consolidated?: boolean;
  attachment?: string | null;
  source_url?: string;
  exchange?: string;
}
interface CalendarPayload {
  scraped_at?: string;
  total: number;
  by_date: Record<string, CalendarItem[]>;
  empty_reason?: string;
}

// PATCH 0152 — switch to the Earnings Hub canonical source.
// /api/market/earnings is the SAME endpoint Earnings Hub Calendar uses (NSE
// Financial Results API + BSE proxy with quality rating). Each result has
// ticker + resultDate + quality. We join this with the worker's v1 calendar
// (which holds Screener+Yahoo enrichment) by ticker → enriched grading.
type MarketEarningsResult = {
  ticker: string;
  company: string;
  resultDate: string;
  quarter: string;
  quality: 'Excellent' | 'Great' | 'Good' | 'OK' | 'Weak' | 'Upcoming' | 'Preview';
  sector?: string;
  industry?: string;
  marketCap?: string;
  edp?: number | null;
  cmp?: number | null;
  priceMove?: number | null;
  timing?: string;
  source?: string;
};
type MarketEarningsResponse = {
  results: MarketEarningsResult[];
  summary?: { total: number; excellent?: number; great?: number; good?: number; ok?: number; weak?: number; upcoming?: number };
  quarter?: string;
  source?: string;
  updatedAt?: string;
};

// Hub source — single month or two months stitched
// PATCH 0187 — localStorage cache for hub data (per month set). Repeat
// visits load INSTANTLY from disk. Server still revalidates in background
// only when stale beyond 15 min for "today's month", 6h for past months.
function useMarketEarnings(months: string[]) {
  // PATCH 0402 — bump v2 → v3 to invalidate stale browser caches that were
  // written during periods when /api/market/earnings returned empty or sparse
  // hub data (calendar showing "No filings" for most dates even though
  // server has recovered). Older versions are wiped on first load below.
  const HUB_LS_PREFIX = 'mc:hub:v3:';
  const key = months.join(',');
  // PATCH 0453 P1-12 — Audit found this hub-scrub ran on every render
  // (50-200ms cost iterating localStorage). Now runs once per app session
  // via useEffect with a sessionStorage flag, not on every parent render.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const SCRUB_HUB = 'mc:hub-scrub:v3';
      if (!localStorage.getItem(SCRUB_HUB)) {
        for (const k of Object.keys(localStorage)) {
          if (k.startsWith('mc:hub:v1:') || k.startsWith('mc:hub:v2:')) localStorage.removeItem(k);
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
      for (const r of responses) {
        for (const e of (r?.results || []) as MarketEarningsResult[]) {
          const k = `${e.ticker}|${e.resultDate}`;
          if (seen.has(k)) continue;
          seen.add(k);
          all.push(e);
        }
      }
      const payload = { results: all, source: responses[0]?.source || 'NSE + BSE', updatedAt: new Date().toISOString() } as MarketEarningsResponse;
      try { if (typeof window !== 'undefined') localStorage.setItem(HUB_LS_PREFIX + key, JSON.stringify({ ...payload, _cachedAt: Date.now() })); } catch {}
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
        const raw = localStorage.getItem(HUB_LS_PREFIX + key);
        if (!raw) return undefined;
        const parsed = JSON.parse(raw);
        // PATCH 0253 — Hub data for PAST months is immutable; for the current
        // month it still gets a background refetch via staleTime (15 min).
        // Previously we rejected cached data >6h old → 'Loading calendar from
        // KV…' spinner on every visit. Now we always return cached data on
        // mount; React Query handles freshness in background. User sees the
        // calendar instantly + the freshness chip on the page shows the age.
        if (parsed && parsed.results) return parsed;
      } catch {}
      return undefined;
    },
    initialDataUpdatedAt: () => {
      if (typeof window === 'undefined') return undefined;
      try {
        const raw = localStorage.getItem(HUB_LS_PREFIX + key);
        if (!raw) return undefined;
        const p = JSON.parse(raw);
        return p?._cachedAt;
      } catch { return undefined; }
    },
  });
}

// PATCH 0155 / 0157 — Live enrichment via /api/v1/earnings/enrich.
// Fetches NSE structured + Screener + Yahoo data directly from Vercel,
// caching per-symbol+filed-date in KV (6h TTL). Cache key includes the
// filing date so a fresh filing naturally busts the old cache.
function useLiveEnrichmentMap(symbols: string[], filed?: string) {
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
        fetch(`/api/v1/earnings/enrich?symbols=${chunk.join(',')}${filedParam}`)
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
function buildCalendarFromHub(hub: MarketEarningsResponse | undefined, fromIso: string, toIso: string): CalendarPayload {
  const by_date: Record<string, CalendarItem[]> = {};
  let total = 0;
  if (hub?.results) {
    for (const e of hub.results) {
      if (!e.resultDate || e.resultDate < fromIso || e.resultDate > toIso) continue;
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
  return { total, by_date };
}

type EarningsTier = 'BLOCKBUSTER' | 'STRONG' | 'MIXED' | 'AVOID';

interface ParsedEarning {
  ticker: string;
  company: string;
  sector?: string;
  filing_date: string;
  quarter: string;
  market_cap_bucket?: string;
  pe?: number | null;
  price?: number | null;
  sales_yoy_pct: number | null;
  net_profit_yoy_pct: number | null;
  eps_yoy_pct: number | null;
  sales_curr_cr: number | null;
  sales_prev_cr: number | null;
  pat_curr_cr: number | null;
  pat_prev_cr: number | null;
  eps_curr: number | null;
  eps_prev: number | null;
  // PATCH 0150 — price / RS / stage overlay
  gap_pct: number | null;
  d1_pct: number | null;
  move_pct: number | null;
  rs_rating: number | null;
  stage: 1 | 2 | 3 | 4 | null;
  pct_from_52w_high: number | null;
  composite_score: number;
  tier: EarningsTier;
  methodology_tags: string[];
  caveat_tags: string[];
  narrative: string;
  filing_url?: string;
  source: string;
}

interface OpportunitiesPayload {
  filing_date: string | null;
  candidates_total: number;
  raw_items_total: number;
  by_tier: Record<EarningsTier, ParsedEarning[]>;
  generated_at: string;
  sources_polled: number;
}

const TIER_META: Record<EarningsTier, { label: string; color: string; icon: string; tagline: string }> = {
  BLOCKBUSTER: { label: 'BLOCKBUSTER', color: '#F59E0B', icon: '⭐', tagline: 'Growth + quality aligned across Sales, EBITDA, Net Profit and EPS' },
  STRONG:      { label: 'STRONG',      color: '#10B981', icon: '🟢', tagline: 'Solid beat across most metrics — one or two caveats' },
  MIXED:       { label: 'MIXED',       color: '#FACC15', icon: '🟡', tagline: 'Optical beats — tax distortion, one-time items or methodology conflicts' },
  AVOID:       { label: 'AVOID',       color: '#EF4444', icon: '🔴', tagline: 'Fundamental or technical hard-fails — not long-trade candidates' },
};
const TIER_ORDER: EarningsTier[] = ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID'];

function todayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

// PATCH 0145: parse Trendlyne's period_ended (e.g. "31-Mar-2026") → YYYY-MM-DD
function parseTrendlynePeriodEnd(s: string): string | null {
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
function gradeRow(row: any): ParsedEarning | null {
  const salesY: number | null = row?.sales_yoy_pct ?? null;
  const patY:   number | null = row?.pat_yoy_pct ?? null;
  const epsY:   number | null = row?.eps_yoy_pct ?? null;
  const opmExp: number | null = row?.opm_pct != null && row?.opm_prev_pct != null ? row.opm_pct - row.opm_prev_pct : null;
  const hasFinancials = salesY != null || patY != null || epsY != null;

  // PATCH 0153: when worker enrichment is missing but hub already has a
  // quality rating from /api/market/earnings (computed from priceMove on
  // the filing day), produce a PREVIEW card from hub data alone.
  // Excellent → BLOCKBUSTER, Great → STRONG, Good/OK → MIXED, Weak → AVOID.
  const hubQuality: string | undefined = row?.hub_quality;
  if (!hasFinancials) {
    if (!hubQuality || hubQuality === 'Upcoming') return null;
    const tier: EarningsTier =
      hubQuality === 'Excellent' ? 'BLOCKBUSTER' :
      hubQuality === 'Great'     ? 'STRONG' :
      hubQuality === 'Good'      ? 'MIXED' :
      hubQuality === 'OK'        ? 'MIXED' :
                                   'AVOID';
    const score =
      hubQuality === 'Excellent' ? 88 :
      hubQuality === 'Great'     ? 76 :
      hubQuality === 'Good'      ? 58 :
      hubQuality === 'OK'        ? 42 :
                                   22;
    const move = row?.move_pct ?? null;
    const moveLabel = move != null ? ` (${move >= 0 ? '+' : ''}${move.toFixed(1)}% on the day)` : '';
    return {
      ticker: row.symbol,
      company: row.company || row.symbol,
      sector: row.sector,
      filing_date: row.filing_date,
      quarter: row.quarter || 'Q4',
      market_cap_bucket: row.market_cap_bucket,
      pe: null,
      price: row.current_price ?? null,
      sales_yoy_pct: null,
      net_profit_yoy_pct: null,
      eps_yoy_pct: null,
      sales_curr_cr: null, sales_prev_cr: null,
      pat_curr_cr: null, pat_prev_cr: null,
      eps_curr: null, eps_prev: null,
      gap_pct: row.gap_pct ?? null,
      d1_pct: row.d1_pct ?? null,
      move_pct: move,
      rs_rating: row.rs_rating ?? null,
      stage: row.stage ?? null,
      pct_from_52w_high: row.pct_from_52w_high ?? null,
      composite_score: score,
      tier,
      methodology_tags: [],
      caveat_tags: [],
      narrative: `${row.company || row.symbol} reported Q4 results${moveLabel}. Financial detail awaiting enrichment.`,
      filing_url: row.source_url,
      source: 'NSE+BSE',
    };
  }

  // PATCH 0145.1: filing_date must be ≤ today. Future-scheduled board meetings
  // are NOT actual filings — grading Screener's historic Q3 data would mislead.
  const todayIso = new Date().toISOString().slice(0, 10);
  if (row?.filing_date && row.filing_date > todayIso) return null;

  // PATCH 0182 — STRICT announce-date attribution guard.
  // /enrich (NSE source) returns announce_date_iso = re_broadcastDt = when the
  // company actually filed with the exchange. If that doesn't match the date
  // we're displaying (±3 days), drop the row to prevent attributing OLD
  // financials to a NEW date (JTLIND/GARUDA/SATIN bug).
  if (row?.announce_date_iso && row?.filing_date) {
    const announceD = new Date(row.announce_date_iso);
    const filingD = new Date(row.filing_date);
    if (!isNaN(announceD.getTime()) && !isNaN(filingD.getTime())) {
      const diffDays = Math.abs((announceD.getTime() - filingD.getTime()) / 86_400_000);
      if (diffDays > 3) return null;
    }
  }

  // PATCH 0178 — RELAXED quarter alignment.
  // OLD logic compared Trendlyne period_ended vs Screener latest_quarter_end_iso
  // and dropped the row if diff > 45 days. This silently dropped fresh filings
  // like SYRMA where Screener hadn't ingested Q4 yet (still showing Q3) — even
  // though NSE-structured XBRL had returned valid Sales/PAT/EPS YoY.
  //
  // New logic: if we have financials from a non-Screener source (NSE structured
  // or BSE direct), trust them. The data IS the proof of filing. Only apply
  // the strict mismatch check when financials_source === 'screener' AND the
  // mismatch is more than 95 days (3+ months — clearly wrong quarter).
  if (row?.period_ended && row?.latest_quarter_end_iso) {
    const promised = parseTrendlynePeriodEnd(row.period_ended);  // returns YYYY-MM-DD or null
    if (promised && promised !== row.latest_quarter_end_iso) {
      const pd = new Date(promised), ld = new Date(row.latest_quarter_end_iso);
      const diffDays = Math.abs((pd.getTime() - ld.getTime()) / (24 * 3600_000));
      const src = (row?.financials_source || '').toLowerCase();
      const isScreenerOnly = src === 'screener' || src === '';
      // Only drop if Screener-only source AND extreme mismatch (>95 days = > one quarter)
      if (isScreenerOnly && diffDays > 95) return null;
      // Otherwise: trust the financials (NSE/BSE structured = authoritative)
    }
  }

  // ── Methodology checks (PATCH 0158 — calibrated to EarningsPulse) ─────
  const methodology_tags: string[] = [];
  const caveat_tags: string[] = [];
  const rs: number | null = row?.rs_rating ?? null;
  const stage: 1 | 2 | 3 | 4 | null = row?.stage ?? null;
  const ttPass: boolean = !!row?.trend_template_passes;
  const pct52: number | null = row?.pct_from_52w_high ?? null;

  // trend template (Minervini) — Yahoo MA stack passes AND RS ≥ 70
  if (ttPass && rs != null && rs >= 70) methodology_tags.push('trend template');
  // sepa — Stage 2 + RS ≥ 80 + EPS ≥ 25% + within 15% of 52w high
  if (stage === 2 && rs != null && rs >= 80 && epsY != null && epsY >= 25 && pct52 != null && pct52 >= -15) {
    methodology_tags.push('sepa');
  }
  // canslim — EPS ≥ 25%, Sales ≥ 20%, RS ≥ 70 (loosened — EarningsPulse passes CANSLIM more freely)
  if (epsY != null && epsY >= 25 && (salesY ?? 0) >= 20 && rs != null && rs >= 70) {
    methodology_tags.push('canslim');
  }
  // bonde ep — EPS leadership (≥ 20% YoY) with revenue growth (≥ 5%)
  if (epsY != null && epsY >= 20 && (salesY == null || salesY >= 5)) methodology_tags.push('bonde ep');

  // ── Caveats (matches EarningsPulse's enumeration) ──────────────────────
  // optical eps — PAT > 3× sales growth (and absolute > 50%), or extreme YoY,
  // or near-zero prior-year EPS becoming meaningful
  if (epsY != null && salesY != null && salesY > 0 && epsY >= salesY * 3 && epsY >= 50) caveat_tags.push('optical eps');
  if (epsY != null && epsY >= 200) caveat_tags.push('optical eps');
  if (row?.eps_prev != null && row?.eps_curr != null && Math.abs(row.eps_prev) < 0.5 && Math.abs(row.eps_curr) > 2) {
    if (!caveat_tags.includes('optical eps')) caveat_tags.push('optical eps');
  }
  // tax distortion — PAT YoY > 100% but Op Profit YoY < 30% (tax line driving)
  if (patY != null && row?.op_profit_yoy_pct != null && patY >= 100 && row.op_profit_yoy_pct < 30) {
    caveat_tags.push('tax distortion');
  }
  // segment mix shift — OPM compressed > 1.5pp YoY
  if (opmExp != null && opmExp < -1.5) caveat_tags.push('segment mix shift');
  // ocf divergence — annual OCF < 60% of annual PAT (when PAT > 0), OR OCF < 0 while PAT > 0
  if (row?.ocf_to_pat_ratio != null) {
    if (row.ocf_to_pat_ratio < 0.6 && (row.pat_annual_cr ?? 0) > 0) caveat_tags.push('ocf divergence');
    if (row.ocf_annual_cr != null && row.ocf_annual_cr < 0 && (row.pat_annual_cr ?? 0) > 0) {
      if (!caveat_tags.includes('ocf divergence')) caveat_tags.push('ocf divergence');
    }
  }
  // low quality — Stage 4 chart OR > 25% off 52w high
  if (stage === 4) caveat_tags.push('low quality');
  else if (pct52 != null && pct52 < -25) caveat_tags.push('low quality');

  // ── Composite score (PATCH 0158 — calibrated to EarningsPulse scoring) ─
  // Score = Magnitude × 0.35 + Quality × 0.25 + Technical × 0.25 + Methodology × 0.15
  //
  // Verified against MCX (94), BSE (92), Atlanta/Vijaya/GNG/BHEL (~86), Apcotex (72),
  // Kalyan Jewellers (34 — AVOID despite great fundamentals because Stage 4 + RS 27).

  // Magnitude — YoY bucketed score, weighted Sales 35% + PAT 30% + EPS 35%
  const scoreYoy = (y: number) =>
    y >= 100 ? 100 :
    y >= 50  ? 90  :
    y >= 25  ? 75  :
    y >= 15  ? 60  :
    y >= 5   ? 40  :
    y >= 0   ? 25  :
    Math.max(0, 25 + y);   // negative growth scales linearly toward 0
  let magW = 0, magS = 0;
  if (salesY != null) { magS += scoreYoy(salesY) * 0.35; magW += 0.35; }
  if (patY   != null) { magS += scoreYoy(patY)   * 0.30; magW += 0.30; }
  if (epsY   != null) { magS += scoreYoy(epsY)   * 0.35; magW += 0.35; }
  const magnitude = magW > 0 ? magS / magW : 30;

  // Quality — 100 minus caveat-specific deductions
  const caveatPenalty: Record<string, number> = {
    'optical eps': 20, 'tax distortion': 15, 'ocf divergence': 25,
    'low quality': 25, 'segment mix shift': 10, 'exceptional item': 10,
    'forex gain': 8, 'forex loss': 8, 'accelerated depreciation': 10,
    'accounting change': 12, 'pooling of interests restate': 12, 'one time order': 10,
  };
  let quality = 100;
  for (const tag of caveat_tags) quality -= (caveatPenalty[tag] ?? 8);
  if (opmExp != null && opmExp >= 3) quality += 8;       // margin expansion bonus
  quality = Math.max(0, Math.min(100, quality));

  // Technical — Stage base + RS / 3 + 52w proximity + trend-template bonus
  const stageBase = stage === 2 ? 70 : stage === 1 ? 45 : stage === 3 ? 30 : stage === 4 ? 10 : 50;
  let technical = stageBase + (rs != null ? rs / 3 : 0);
  if (pct52 != null) technical += pct52 >= -5 ? 15 : pct52 >= -15 ? 8 : pct52 >= -25 ? 0 : -15;
  if (ttPass) technical += 10;
  technical = Math.max(0, Math.min(100, technical));

  // Methodology — count-based with SEPA bonus.
  // PATCH 0173: count Tier-1 methods (TT/SEPA/CANSLIM) separately from bonde ep
  // since bonde ep is auto-satisfied by magnitude. Composite shouldn't punish
  // cards for missing bonde ep alone.
  const mCount = methodology_tags.length;
  const _t1MethodCount =
    (methodology_tags.includes('trend template') ? 1 : 0) +
    (methodology_tags.includes('sepa') ? 1 : 0) +
    (methodology_tags.includes('canslim') ? 1 : 0);
  let methodology = mCount === 4 ? 100 : mCount === 3 ? 80 : mCount === 2 ? 60 : mCount === 1 ? 35 : 10;
  // Bonus: any Tier-1 method present → floor at 55 (don't sink composite for
  // cards that pass TT/SEPA/CANSLIM but happened to miss the others)
  if (_t1MethodCount >= 1) methodology = Math.max(methodology, 55);
  if (methodology_tags.includes('sepa')) methodology = Math.min(100, methodology + 5);
  // PATCH 0172 — magnitude-aware methodology floor (mega triple-beat).
  const _megaMagnitudeFloor =
    salesY != null && salesY >= 40 &&
    patY != null && patY >= 75 &&
    epsY != null && epsY >= 75;
  if (_megaMagnitudeFloor) methodology = Math.max(methodology, 75);
  // PATCH 0173 — exceptional magnitude (≥40/50/50) also gets a moderate floor
  const _exceptionalMagFloor =
    salesY != null && salesY >= 40 &&
    patY != null && patY >= 50 &&
    epsY != null && epsY >= 50;
  if (_exceptionalMagFloor) methodology = Math.max(methodology, 65);

  const composite = Math.max(0, Math.min(100,
    magnitude * 0.35 + quality * 0.25 + technical * 0.25 + methodology * 0.15,
  ));

  // ── Tier assignment (PATCH 0158) ───────────────────────────────────────
  // Hard rules in priority order:
  //   1. AVOID hard fail: Stage 4 + (RS < 40 OR pct52 < -25) — chart broken
  //   2. AVOID hard fail: negative EPS YoY AND PAT decline
  //   3. BLOCKBUSTER strict: score ≥ 84 AND ≥3 methodologies AND ≤1 caveat AND
  //      Sales ≥ 25% AND PAT ≥ 25% AND EPS ≥ 25% AND Stage 2 AND RS ≥ 70
  //   4. STRONG: score ≥ 68 AND ≥1 methodology AND ≤3 caveats AND not Stage 4
  //   5. MIXED: score ≥ 35
  //   6. else AVOID
  let tier: EarningsTier;

  // Hard AVOID fail conditions (override score)
  const broken = (stage === 4 && (rs == null || rs < 40)) ||
                 (epsY != null && epsY < 0 && patY != null && patY < -10);

  // PATCH 0173 — BLOCKBUSTER gate v3 (EarningsPulse-matched).
  // Per user spec: IGNORE bonde ep, RS, Stage 2 as hard gates. These are
  // worker-enriched fields that are frequently null on fresh prints, killing
  // the gate. EarningsPulse classifies on:
  //   1) Magnitude (Sales / PAT / EPS triple-beat)
  //   2) Quality (caveats)
  //   3) Methodology fit — TT / SEPA / CANSLIM (NOT bonde ep, which is auto-satisfied
  //      by magnitude itself)
  //   4) Guidance signal (capacity expansion, order book, margin expansion, etc.)
  //   5) Chart not broken (not Stage 4, not >25% off 52w high)
  //
  // Verified against EarningsPulse BLOCKBUSTER set:
  //   Syrma SGS (+58/+67/+43), MCX (+205/+291/+292), Atlanta (+82/+127/+115),
  //   BSE (+85/+61/+62), Vijaya Diag (+27/+38/+38), GNG Elec (+43/+181/+147),
  //   Antelopus (+65/+139/+157), BHEL (+37/+156/+164)
  // BLOCKBUSTER is RARE: typically 0-3 per day.
  //
  // Tier-1 methodology count = TT / SEPA / CANSLIM only (drop bonde ep — magnitude
  // implies bonde ep, so it's never the differentiator).
  const tier1MethodCount =
    (methodology_tags.includes('trend template') ? 1 : 0) +
    (methodology_tags.includes('sepa') ? 1 : 0) +
    (methodology_tags.includes('canslim') ? 1 : 0);

  const cleanMagnitude =
    salesY != null && salesY >= 25 &&
    patY != null && patY >= 25 &&
    epsY != null && epsY >= 25;
  const exceptionalMagnitude =
    salesY != null && salesY >= 40 &&
    patY != null && patY >= 50 &&
    epsY != null && epsY >= 50;
  const megaMagnitude =
    salesY != null && salesY >= 40 &&
    patY != null && patY >= 75 &&
    epsY != null && epsY >= 75;

  // Guidance signal — scan available text (narrative, announcement, attachment
  // title) for forward-looking positives. EarningsPulse weights this heavily for
  // Atlanta-style cases.
  const guidanceText = [
    row?.guidance_text, row?.narrative_text, row?.announcement_text,
    row?.attachment, row?.headline, row?.title,
  ].filter(Boolean).join(' ').toLowerCase();
  const guidancePatterns = [
    /capacity expansion/, /order book/, /record (?:quarter|order|revenue|book)/,
    /margin expansion/, /operating leverage/, /commission(?:ed|ing)?/,
    /capex/, /demand recovery/, /broad[- ]based/, /tailwind/, /confident/,
    /guidance rais/, /upgrade(?:d)? guidance/, /outlook strong/,
    /(?:vadod|new plant|new line|brownfield|greenfield)/,
  ];
  const guidanceMatches = guidancePatterns.filter((p) => p.test(guidanceText)).length;
  const positiveGuidance = guidanceMatches >= 2;

  // Chart not broken — independent of Stage 2 / RS 70 requirement
  const chartOk = stage !== 4 && (pct52 == null || pct52 >= -25);
  const chartHealthy = chartOk && stage !== 3;  // Bonus signal — actively in uptrend

  // ── Three paths to BLOCKBUSTER (RS / Stage / bonde NOT required):
  // Path A — CLEAN MAGNITUDE + STRUCTURE: clean triple-beat + ≤1 caveat +
  //   composite ≥ 78 + (Tier-1 method ≥ 1 OR positive guidance) + chart OK
  const blockbusterPathA =
    composite >= 78 &&
    cleanMagnitude &&
    caveat_tags.length <= 1 &&
    (tier1MethodCount >= 1 || positiveGuidance) &&
    chartOk;

  // Path B — EXCEPTIONAL MAGNITUDE: ≥40/50/50 triple-beat + ≤2 caveats +
  //   composite ≥ 72 + chart OK (no methodology requirement)
  const blockbusterPathB =
    composite >= 72 &&
    exceptionalMagnitude &&
    caveat_tags.length <= 2 &&
    chartOk;

  // Path C — MEGA MAGNITUDE: ≥40/75/75 triple-beat + ≤3 caveats + chart not Stage 4
  //   (the magnitude IS the signal — EarningsPulse Atlanta & Antelopus cases.
  //    Antelopus had 3 caveats — accelerated depreciation + pooling + exceptional
  //    item — but magnitude was still extreme +65/+139/+157 = BLOCKBUSTER.)
  const blockbusterPathC =
    megaMagnitude &&
    caveat_tags.length <= 3 &&
    stage !== 4;

  const blockbusterGate = blockbusterPathA || blockbusterPathB || blockbusterPathC;

  // (suppress unused variable warning for chartHealthy — reserved for future tier-bonus)
  void chartHealthy;

  if (broken && composite < 70) {
    tier = 'AVOID';
  } else if (blockbusterGate) {
    tier = 'BLOCKBUSTER';
  } else if (composite >= 68 && mCount >= 1 && caveat_tags.length <= 3 && stage !== 4) {
    tier = 'STRONG';
  } else if (composite >= 35) {
    tier = 'MIXED';
  } else {
    tier = 'AVOID';
  }

  // ── Narrative ──────────────────────────────────────────────────────────
  const co = row.company || row.symbol;
  const q = row.quarter || 'Q4';
  const fmtP = (lbl: string, v: number | null) => v == null ? '' : `${lbl} ${v >= 0 ? '+' : ''}${Math.round(v)}% YoY`;
  const head =
    tier === 'BLOCKBUSTER' ? `${co} prints a blockbuster ${q}` :
    tier === 'STRONG'      ? `${co} delivers strong ${q}` :
    tier === 'MIXED'       ? `${co} ${q} is a mixed print` :
                             `${co} ${q} fails the bar`;
  const metrics = [fmtP('revenue', salesY), fmtP('PAT', patY), fmtP('EPS', epsY)].filter(Boolean).join(', ');
  const flavor =
    caveat_tags.length > 0 ? ` with caveat${caveat_tags.length > 1 ? 's' : ''}: ${[...new Set(caveat_tags)].slice(0, 3).join(' + ')}.` :
    methodology_tags.length >= 2 ? ` and ${[...new Set(methodology_tags)].join('/')} all passing.` : '.';
  const narrative = `${head} (${metrics})${flavor}`;

  return {
    ticker: row.symbol,
    company: row.company || row.symbol,
    sector: row.sector,
    filing_date: row.filing_date,
    quarter: row.quarter || 'Q4',
    market_cap_bucket: row.market_cap_bucket,
    pe: row.pe ?? null,
    price: row.current_price ?? null,
    sales_yoy_pct: salesY,
    net_profit_yoy_pct: patY,
    eps_yoy_pct: epsY,
    sales_curr_cr: row.sales_curr_cr ?? null,
    sales_prev_cr: row.sales_prev_cr ?? null,
    pat_curr_cr: row.pat_curr_cr ?? null,
    pat_prev_cr: row.pat_prev_cr ?? null,
    eps_curr: row.eps_curr ?? null,
    eps_prev: row.eps_prev ?? null,
    gap_pct: row.gap_pct ?? null,
    d1_pct: row.d1_pct ?? null,
    move_pct: row.move_pct ?? null,
    rs_rating: rs,
    stage,
    pct_from_52w_high: pct52,
    composite_score: Math.round(composite),
    tier,
    methodology_tags: [...new Set(methodology_tags)],
    caveat_tags: [...new Set(caveat_tags)],
    narrative,
    filing_url: row.source_url || row.attachment,
    source: row.financials_source || 'worker',
  };
}

// PATCH 0152 — Opportunities now JOIN /api/market/earnings (canonical filed
// list, same as Earnings Hub Calendar) with /api/v1/earnings/calendar
// (Screener+Yahoo enrichment) by ticker. The hub tells us WHO filed when;
// the worker tells us the financials. If no enrichment available, the
// market data still provides quality+sector+marketCap.
function useEarningsOpportunitiesJoined(
  date: string,
  hub: MarketEarningsResponse | undefined,
  enrichmentMap: Record<string, any> | undefined,
): OpportunitiesPayload {
  const todayIso = new Date().toISOString().slice(0, 10);
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
      quarter: m.quarter || e.quarter || 'Q4',
      sector: m.sector || e.sector,
      market_cap_bucket: e.market_cap_bucket
        || (m.marketCap === 'L' ? 'LARGE' : m.marketCap === 'M' ? 'MID' : m.marketCap === 'S' ? 'SMALL' : m.marketCap === 'Micro' ? 'MICRO' : null),
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

type ViewMode = 'CALENDAR' | 'GRADED';

export default function EarningsOpportunitiesPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('CALENDAR');
  // PATCH 0498 — Initialize to '' (Latest mode) so auto-walk-back fires
  // from today and lands on the most-recently-populated date. Previously
  // initialized to todayISO() which short-circuited the walk-back.
  const [filterDate, setFilterDate] = useState<string>('');
  const [showAbout, setShowAbout] = useState(false);
  const [expanded, setExpanded] = useState<Record<EarningsTier, boolean>>({
    BLOCKBUSTER: true, STRONG: true, MIXED: false, AVOID: false,
  });

  // PATCH 0152 — drive everything from the hub source-of-truth.
  // Months to fetch: cover the current filterDate's month + the previous
  // month (so the calendar grid view can show ~6 weeks of history).
  const monthsToFetch = useMemo(() => {
    const baseDate = filterDate || todayISO();
    const cur = new Date(baseDate);
    const prev = new Date(baseDate); prev.setDate(1); prev.setMonth(prev.getMonth() - 1);
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return Array.from(new Set([fmt(prev), fmt(cur)]));
  }, [filterDate]);
  const { data: hub, isLoading: hubLoading, error: hubError, refetch: refetchHub } = useMarketEarnings(monthsToFetch);

  // PATCH 0159 / PATCH 0497 — resolve which date to grade.
  //
  // Old behaviour: when filterDate is empty (Latest), find the most-recent
  // past date in hub.results that has ≥1 filed (non-Upcoming) entry. The
  // problem: the hub aggregator routinely misses recent Fri/Sat/Sun/Mon
  // filings, so "Latest" could land on a 3-week-old Apr 30 stub while
  // EarningsPulse showed 47-100 filings per day for the intervening week.
  //
  // New behaviour: anchor "Latest" on TODAY. The graded endpoint now has a
  // live-NSE augmentation that fires for any date in the last 14 days
  // (server-side fix in /api/v1/earnings/graded). If today is empty, the
  // auto-walk-back effect below probes yesterday, day-before, etc., via
  // the SAME graded endpoint (which has the live-NSE fallback) instead of
  // relying on hub.results. This means Sat/Sun/Mon filings always surface.
  const todayIso = new Date().toISOString().slice(0, 10);
  const resolvedDateForGrading = useMemo(() => {
    if (filterDate) return filterDate;
    // Default to today. The auto-walk-back effect (below) will step back
    // if today is empty.
    return todayIso;
  }, [filterDate, todayIso]);

  // PATCH 0187 — localStorage cache (v9). Past dates: 7 days fresh, today: 15 min.
  // User: "I always open link all loads even when data is there before."
  // Aggressive caching so repeat visits to past dates are zero-network.
  //
  // PATCH 0402 — bumped v8 → v9. Symptom: a past-date snapshot was cached
  // when the server still had preview-shape rows (all 10 cards as AVOID/score 22
  // "Financial detail awaiting enrichment"). Because past dates get a 7-day
  // staleTime, React Query never refetched even after the server backfilled
  // the real graded payload. Bumping the prefix invalidates every stale
  // snapshot in one shot. The scrub below removes orphan v8/v7 keys.
  const LS_PREFIX = 'mc:graded:v9:';
  if (typeof window !== 'undefined') {
    try {
      const SCRUB_GRADED = 'mc:graded-scrub:v9';
      if (!localStorage.getItem(SCRUB_GRADED)) {
        for (const k of Object.keys(localStorage)) {
          if (k.startsWith('mc:graded:v7:') || k.startsWith('mc:graded:v8:')) localStorage.removeItem(k);
        }
        localStorage.setItem(SCRUB_GRADED, '1');
      }
    } catch {}
  }
  const readLsCache = (date: string): OpportunitiesPayload | undefined => {
    if (!date || typeof window === 'undefined') return undefined;
    try {
      const raw = localStorage.getItem(LS_PREFIX + date);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw);
      const cachedAt = parsed?._cachedAt || 0;
      const ageMs = Date.now() - cachedAt;
      // Today: 15 min freshness (since today's filings can change intraday)
      if (date === todayIso) {
        if (ageMs > 15 * 60_000) return undefined;
      } else {
        // Past dates: 7 days fresh. They're immutable on the server side anyway.
        if (ageMs > 7 * 24 * 3600_000) return undefined;
      }
      return parsed;
    } catch { return undefined; }
  };
  const writeLsCache = (date: string, data: OpportunitiesPayload) => {
    if (!date || typeof window === 'undefined') return;
    try { localStorage.setItem(LS_PREFIX + date, JSON.stringify({ ...data, _cachedAt: Date.now() })); } catch {}
  };

  // PATCH 0161/0165/0185 — graded query reads from localStorage initialData
  // so navigation is INSTANT for previously-visited dates, then revalidates
  // from server in background. Past dates are immutable so revalidation is
  // basically a no-op (KV hit). No more 30s waits per click.
  const { data: gradedData, refetch: refetchGraded, isFetching: gradedFetching } = useQuery<OpportunitiesPayload>({
    queryKey: ['graded-by-date', resolvedDateForGrading],
    enabled: !!resolvedDateForGrading,
    queryFn: async () => {
      // PATCH 0192 — `cache: 'no-store'` so the browser doesn't serve a stale
      // HTTP cache when refetchGraded() runs after refreshMissing has updated
      // the server-side KV. Without this, the client could keep seeing the
      // pre-refresh response even after server data has changed.
      // PATCH 0447 REGRESSION FIX — For past dates (>= 2 days old), if a
      // valid LS snapshot exists, return it directly. Never hit the network.
      // User wants 'whatever is loaded already saved → render immediately'.
      const yIso = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })();
      const isPastDate = resolvedDateForGrading < yIso;
      if (isPastDate) {
        const cached = readLsCache(resolvedDateForGrading);
        if (cached) return cached as OpportunitiesPayload;
      }
      const res = await fetch(`/api/v1/earnings/graded?date=${resolvedDateForGrading}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('graded fetch failed');
      const payload = await res.json();
      writeLsCache(resolvedDateForGrading, payload);
      return payload;
    },
    // PATCH 0362 — Past dates: 7-day stale (immutable). Today: 3 min so
    // any small action (click Refresh, tab focus) gets a fresh fetch.
    // PATCH 0447 — Bumped past-date staleTime to 30 days (effectively
    // permanent for the session). Past dates are immutable; revalidation
    // is pure noise.
    staleTime: resolvedDateForGrading < todayIso ? 30 * 24 * 60 * 60_000 : 3 * 60_000,
    refetchOnWindowFocus: resolvedDateForGrading >= todayIso,
    refetchOnReconnect: resolvedDateForGrading >= todayIso,
    refetchOnMount: resolvedDateForGrading >= todayIso,
    // PATCH 0362 — Auto-poll every 4 minutes when viewing today's date,
    // ONLY during Indian market hours (9 AM - 4 PM IST). This is the
    // key fix for 'always late' — user no longer has to manually refresh
    // to catch freshly-filed results. Past dates never poll.
    refetchInterval: () => {
      if (resolvedDateForGrading !== todayIso) return false;
      // Indian market hours check (IST UTC+5:30)
      const now = new Date();
      const istHours = (now.getUTCHours() + 5.5) % 24;
      const inMarketHours = istHours >= 9 && istHours <= 17;  // 9 AM - 5 PM IST
      return inMarketHours ? 4 * 60_000 : false;
    },
    placeholderData: (prev) => prev,  // keep showing previous date while next loads
    // Hydrate from localStorage so the screen never goes blank on navigation
    initialData: () => readLsCache(resolvedDateForGrading),
    initialDataUpdatedAt: () => {
      const cached = readLsCache(resolvedDateForGrading);
      return cached ? (cached as any)._cachedAt : undefined;
    },
  });

  // PATCH 0362 — Reset baseline on date change so we don't flag every card
  // as "new" the moment user navigates to a different date.
  // PATCH 0453 P1-13 — Audit found this raced with the gradedData effect on
  // rapid date arrow clicks — sometimes every card got marked NEW because
  // the baseline-reset and the gradedData write fired in the wrong order.
  // Track the last date we baselined so the gradedData effect can detect
  // "this is a fresh date, baseline silently" vs "real new arrivals".
  const lastBaselinedDateRef = useRef<string>('');
  useEffect(() => {
    seenTickersRef.current = new Set();
    setFreshTickers(new Set());
    lastBaselinedDateRef.current = '';
  }, [resolvedDateForGrading]);

  // PATCH 0482 / PATCH 0493 / PATCH 0497 — AUTO-WALK-BACK TO POPULATED DATE.
  // User feedback: "earnings are there on saturday sunday everyday instead of
  // showing data you say no earnings reported". Indian companies file Sat/Sun.
  //
  // 0497 rewrite: probe graded endpoint directly (1 → 7 days back) rather
  // than only consulting hub.results, which routinely lags by weeks. The
  // graded endpoint now has live-NSE augmentation so each probe surfaces
  // any filings NSE knows about, even when the hub aggregator missed them.
  // Stops the moment we find a populated date.
  const autoJumpedRef = useRef(false);
  const autoWalkProbingRef = useRef(false);
  // PATCH 0498 — Reset autoJumpedRef when filterDate clears (user clicked
  // Latest button) so the walk-back fires again from today.
  useEffect(() => {
    if (!filterDate) {
      autoJumpedRef.current = false;
      autoWalkProbingRef.current = false;
    }
  }, [filterDate]);
  useEffect(() => {
    if (filterDate) return;  // user explicitly picked a date — don't override
    if (autoJumpedRef.current) return;
    if (autoWalkProbingRef.current) return;
    if (!gradedData?.by_tier || !resolvedDateForGrading) return;
    const allCards = (TIER_ORDER as EarningsTier[])
      .flatMap((t) => gradedData.by_tier?.[t] || []);
    if (allCards.length >= 1) {
      autoJumpedRef.current = true;
      return;
    }
    // Current resolved date returned 0 cards → walk back day-by-day via
    // the graded endpoint until we find one with filings, up to 7 days.
    autoWalkProbingRef.current = true;
    (async () => {
      const start = new Date(resolvedDateForGrading);
      for (let i = 1; i <= 7; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() - i);
        const iso = d.toISOString().slice(0, 10);
        try {
          const res = await fetch(`/api/v1/earnings/graded?date=${iso}`, { cache: 'no-store' });
          if (!res.ok) continue;
          const payload = await res.json();
          const total = Object.values(payload?.by_tier || {}).flat().length;
          if (total >= 1) {
            autoJumpedRef.current = true;
            autoWalkProbingRef.current = false;
            setFilterDate(iso);
            return;
          }
        } catch {}
      }
      autoWalkProbingRef.current = false;
    })();
  }, [filterDate, gradedData, resolvedDateForGrading]);

  // PATCH 0497 — Probe graded endpoint for past 14 days to discover
  // populated dates the hub aggregator missed. Fires once per resolved date
  // when current date returned 0 cards. Result feeds:
  //   • BUSIEST RECENT DATES pills in empty-state
  //   • sparse-day hint banner
  const [recentPopulatedDates, setRecentPopulatedDates] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!resolvedDateForGrading || !gradedData?.by_tier) return;
    const allCards = (TIER_ORDER as EarningsTier[])
      .flatMap((t) => gradedData.by_tier?.[t] || []);
    if (allCards.length >= 5) return;
    // Probe last 14 days serially so we don't hammer the API.
    let cancelled = false;
    (async () => {
      const todayIsoLocal = new Date().toISOString().slice(0, 10);
      const collected: Record<string, number> = {};
      const start = new Date(todayIsoLocal);
      for (let i = 0; i <= 14; i++) {
        if (cancelled) return;
        const dd = new Date(start);
        dd.setDate(dd.getDate() - i);
        const iso = dd.toISOString().slice(0, 10);
        try {
          const res = await fetch(`/api/v1/earnings/graded?date=${iso}`, { cache: 'no-store' });
          if (!res.ok) continue;
          const payload = await res.json();
          const total = Object.values(payload?.by_tier || {}).flat().length;
          if (total >= 1) {
            collected[iso] = total;
            // Push a partial update each time we find a populated date so the
            // UI surfaces results as they come in (better UX vs waiting 14 probes)
            if (!cancelled) setRecentPopulatedDates({ ...collected });
          }
        } catch {}
      }
    })();
    return () => { cancelled = true; };
  }, [resolvedDateForGrading, gradedData]);

  // PATCH 0493 / PATCH 0497 — Sparse-day hint. When the user IS on a date
  // with few filings, show a tappable hint to the most-recently-populated
  // previous date.
  //
  // 0497 rewrite: probe graded endpoint for the 7 previous calendar days
  // instead of trusting hub.results (which routinely lags by 2-3 weeks).
  // Result lives in state so it can be async without breaking memo rules.
  const [sparseDayHint, setSparseDayHint] = useState<{ date: string; count: number; label: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setSparseDayHint(null);
    if (!resolvedDateForGrading || !gradedData?.by_tier) return;
    const allCards = (TIER_ORDER as EarningsTier[])
      .flatMap((t) => gradedData.by_tier?.[t] || []);
    if (allCards.length >= 5) return;
    (async () => {
      const start = new Date(resolvedDateForGrading);
      for (let i = 1; i <= 7; i++) {
        const dd = new Date(start);
        dd.setDate(dd.getDate() - i);
        const iso = dd.toISOString().slice(0, 10);
        try {
          const res = await fetch(`/api/v1/earnings/graded?date=${iso}`, { cache: 'no-store' });
          if (!res.ok) continue;
          const payload = await res.json();
          const total = Object.values(payload?.by_tier || {}).flat().length;
          if (total >= 1) {
            if (cancelled) return;
            const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dd.getUTCDay()];
            const label = `${dow} ${dd.getUTCDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][dd.getUTCMonth()]}`;
            setSparseDayHint({ date: iso, count: total, label });
            return;
          }
        } catch {}
      }
    })();
    return () => { cancelled = true; };
  }, [resolvedDateForGrading, gradedData]);

  // PATCH 0402 — CLIENT-SIDE AUTO-HEAL.
  // PATCH 0447 REGRESSION FIX — User reported EO was "best" before; now
  // re-fetching everything every time they open it. The auto-heal was
  // wiping LS cache for past dates and re-fetching even though past
  // dates are immutable. Now restrict auto-heal to TODAY + YESTERDAY
  // only — past dates ALWAYS serve the cached snapshot, no exception.
  // If a snapshot is preview-shape on a past date, that's because the
  // server didn't enrich it at the time and a refetch won't fix it.
  const autoHealFiredRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!gradedData?.by_tier || !resolvedDateForGrading) return;
    if (autoHealFiredRef.current.has(resolvedDateForGrading)) return;
    // Only auto-heal today + yesterday. Past dates trust the cache.
    const yIso = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })();
    if (resolvedDateForGrading !== todayIso && resolvedDateForGrading !== yIso) return;
    const allCards = (TIER_ORDER as EarningsTier[])
      .flatMap((t) => gradedData.by_tier?.[t] || []) as ParsedEarning[];
    if (allCards.length < 3) return;
    const previewCount = allCards.filter((c) =>
      c.sales_yoy_pct == null && c.net_profit_yoy_pct == null && c.eps_yoy_pct == null
    ).length;
    const previewRatio = previewCount / allCards.length;
    if (previewRatio < 0.7) return;
    // Pin so we don't loop
    autoHealFiredRef.current.add(resolvedDateForGrading);
    // Wipe the stale snapshot + force a fresh server fetch (today/yesterday only)
    try {
      localStorage.removeItem('mc:graded:v9:' + resolvedDateForGrading);
      localStorage.removeItem('mc:graded:v8:' + resolvedDateForGrading);
    } catch {}
    fetch(`/api/v1/earnings/graded?date=${resolvedDateForGrading}&force=1`, { cache: 'no-store' })
      .then(() => refetchGraded())
      .catch(() => {});
  }, [gradedData, resolvedDateForGrading, refetchGraded, todayIso]);

  // PATCH 0362 — Track ticker set across renders to highlight new arrivals.
  // Fires whenever the gradedData payload changes. The first time the page
  // loads we just record the baseline set (no badges). On subsequent updates
  // (auto-refresh, manual refresh) any ticker not in the previous set gets
  // the "NEW" badge for 10 minutes.
  useEffect(() => {
    if (!gradedData?.by_tier) return;
    const currentTickers = new Set<string>();
    for (const tier of ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID'] as const) {
      for (const c of (gradedData.by_tier[tier] || []) as any[]) {
        if (c.ticker) currentTickers.add(c.ticker);
      }
    }
    // PATCH 0453 P1-13 — First load OR date just changed (lastBaseline !==
    // current date) → silently baseline, no NEW badges. Fixes the race
    // where a rapid date click would mark every card NEW.
    if (seenTickersRef.current.size === 0 || lastBaselinedDateRef.current !== resolvedDateForGrading) {
      seenTickersRef.current = currentTickers;
      lastBaselinedDateRef.current = resolvedDateForGrading;
      return;
    }
    // Subsequent loads: anything new since last render gets the badge
    const newOnes = new Set<string>();
    for (const t of currentTickers) {
      if (!seenTickersRef.current.has(t)) newOnes.add(t);
    }
    if (newOnes.size > 0) {
      setFreshTickers((prev) => {
        const merged = new Set(prev);
        for (const t of newOnes) merged.add(t);
        return merged;
      });
      // Auto-expire fresh markers after 10 minutes
      setTimeout(() => {
        setFreshTickers((prev) => {
          const cleaned = new Set(prev);
          for (const t of newOnes) cleaned.delete(t);
          return cleaned;
        });
      }, 10 * 60_000);
    }
    seenTickersRef.current = currentTickers;
    lastBaselinedDateRef.current = resolvedDateForGrading;
    setLastAutoRefreshMs(Date.now());
  }, [gradedData, resolvedDateForGrading]);

  // PATCH 0165 — prefetch the date before and after when user lands on a date
  // PATCH 0402 — widen the warm-up to the trailing 7 trading days. User's
  // complaint was that not just yesterday but the whole prior week was stale
  // (cached when filings hadn't propagated yet). On first mount per session
  // we fire force=1 against each of the past 7 weekdays so the server's KV
  // cache + the user's localStorage both refresh in one sweep.
  // Subsequent date changes within the same session only warm prev/next.
  const sessionWarmedRef = useRef(false);
  useEffect(() => {
    if (!resolvedDateForGrading) return;
    const d = new Date(resolvedDateForGrading);
    const prev = new Date(d); prev.setDate(d.getDate() - 1);
    const next = new Date(d); next.setDate(d.getDate() + 1);
    const prevIso = prev.toISOString().slice(0, 10);
    const nextIso = next.toISOString().slice(0, 10);

    // PATCH 0482 — INVERTED from the weekday-only warming. Indian companies
    // file results on weekends (especially Saturdays). We now warm the past
    // 7 calendar days regardless of weekday so Sat/Sun filings get cached
    // proactively.
    const past7: string[] = [];
    if (!sessionWarmedRef.current) {
      const cursor = new Date(todayIso);
      while (past7.length < 7) {
        past7.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() - 1);
        if (cursor < new Date('2026-01-01')) break;  // safety
      }
      sessionWarmedRef.current = true;
    }

    const timer = setTimeout(() => {
      // Always warm immediate neighbours (lightweight cache touch, no force)
      fetch(`/api/v1/earnings/graded?date=${prevIso}`).catch(() => {});
      if (nextIso <= todayIso) fetch(`/api/v1/earnings/graded?date=${nextIso}`).catch(() => {});

      // First-mount sweep: hit each past trading day with force=1 so any
      // stale "all-AVOID-score-22 preview" cache snapshot gets rebuilt
      // server-side. Stagger by 350ms each so we don't slam Vercel.
      past7.forEach((iso, i) => {
        setTimeout(() => {
          fetch(`/api/v1/earnings/graded?date=${iso}&force=1`, { cache: 'no-store' })
            .catch(() => {});
          // Also wipe the matching localStorage entry so the next visit
          // hydrates from the freshly-rebuilt server payload, not the
          // stale snapshot.
          try {
            localStorage.removeItem('mc:graded:v9:' + iso);
            localStorage.removeItem('mc:graded:v8:' + iso);
          } catch {}
        }, 1500 + i * 350);
      });
    }, 800);  // delay so current date renders first
    return () => clearTimeout(timer);
  }, [resolvedDateForGrading, todayIso]);

  const data: OpportunitiesPayload = gradedData || {
    filing_date: resolvedDateForGrading || null,
    candidates_total: 0,
    raw_items_total: 0,
    by_tier: { BLOCKBUSTER: [], STRONG: [], MIXED: [], AVOID: [] },
    generated_at: '',
    sources_polled: 0,
  };
  const isLoading = hubLoading || gradedFetching;
  const error = hubError;
  // PATCH 0175 — Hard refresh: force=1 busts BOTH the KV cache for the graded
  // payload AND the in-memory cache on /api/market/earnings. This is what
  // actually pulls in newly-filed companies. Soft refetch only invalidates
  // React Query, which then hits the same cached server response.
  const [hardRefreshing, setHardRefreshing] = useState(false);
  const refetch = async () => {
    if (!resolvedDateForGrading || hardRefreshing) {
      // Soft refetch when no date resolved yet
      await Promise.all([refetchHub(), refetchGraded()]);
      return;
    }
    // PATCH 0450 BUG-056 / PATCH 0498 — Previously blocked Hard Refresh on
    // past dates, but user feedback (May 2026): "fix bugs, india companies
    // file Sat/Sun every weekend during earnings season". The block prevented
    // users from forcing a re-scan of weekend filings when the live-NSE
    // augmentation needed to fire. Now: always allow Hard Refresh. The
    // server-side rate limit (autoheal lockout 30 min in graded route)
    // protects upstream sources.
    setHardRefreshing(true);
    try {
      // PATCH 0190 — Hard Refresh wipes localStorage for this date + month
      // hub key so user gets a guaranteed fresh view (no stale interference).
      // PATCH 0402 — wipe both old (v8/v2) and current (v9/v3) keys so users
      // who installed this patch mid-loop don't get stuck on the old version.
      try {
        const monthKeys = monthsToFetch.join(',');
        localStorage.removeItem('mc:graded:v9:' + resolvedDateForGrading);
        localStorage.removeItem('mc:graded:v8:' + resolvedDateForGrading);
        localStorage.removeItem('mc:hub:v3:' + monthKeys);
        localStorage.removeItem('mc:hub:v2:' + monthKeys);
      } catch {}
      // Hit force=1 server-side to rebuild graded payload from a fresh hub fetch
      const res = await fetch(`/api/v1/earnings/graded?date=${resolvedDateForGrading}&force=1`, { cache: 'no-store' });
      let payload: any = null;
      try { payload = await res.json(); } catch {}
      // Then refetch via React Query so the UI picks up the new data
      await Promise.all([refetchHub(), refetchGraded()]);
      // PATCH 0193 — if the current date is genuinely empty (weekend / no
      // filings), auto-jump to the most recent past date that DOES have
      // filings, so the user isn't stuck on a blank screen after refresh.
      const stillEmpty = !payload || !payload.by_tier ||
        (payload.candidates_total ?? 0) === 0;
      if (stillEmpty && hub?.results) {
        const todayIso2 = new Date().toISOString().slice(0, 10);
        const byDate: Record<string, number> = {};
        for (const r of hub.results) {
          if (!r.resultDate || r.resultDate > todayIso2 || r.quality === 'Upcoming') continue;
          byDate[r.resultDate] = (byDate[r.resultDate] || 0) + 1;
        }
        const recentDate = Object.keys(byDate).sort().reverse()[0];
        if (recentDate && recentDate !== resolvedDateForGrading) {
          setFilterDate(recentDate);
        }
      }
    } finally {
      setHardRefreshing(false);
    }
  };
  // Local UI state for partial-refresh button
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFeedback, setRefreshFeedback] = useState<string | null>(null);
  // PATCH 0360 — 90-day backfill state. Runs in batches via the
  // /api/v1/earnings/backfill endpoint, chaining cursor_next until done.
  const [backfilling, setBackfilling] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<string | null>(null);
  // PATCH 0362 — Track tickers seen across renders so we can highlight
  // newly-arrived cards as "NEW since last refresh". Persists across the
  // session via window in-memory ref (not localStorage — we want it to
  // reset when user closes tab so refresh-on-reopen is clean).
  const seenTickersRef = useRef<Set<string>>(new Set());
  const [freshTickers, setFreshTickers] = useState<Set<string>>(new Set());
  const [lastAutoRefreshMs, setLastAutoRefreshMs] = useState<number>(Date.now());
  // PATCH 0180 — Audit state (validation against EarningsPulse Week Ahead seed)
  const [auditing, setAuditing] = useState(false);
  const [auditResult, setAuditResult] = useState<any>(null);
  const runAudit = async () => {
    if (!resolvedDateForGrading || auditing) return;
    setAuditing(true);
    setAuditResult(null);
    try {
      const res = await fetch(`/api/v1/earnings/audit?date=${resolvedDateForGrading}`, { cache: 'no-store' });
      const j = await res.json();
      setAuditResult(j);
    } catch (e: any) {
      setAuditResult({ error: e?.message || 'audit failed' });
    } finally {
      setAuditing(false);
    }
  };

  // PATCH 0174 — Coverage probe state
  const [probeTicker, setProbeTicker] = useState('');
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<any>(null);
  const runCoverageProbe = async () => {
    if (!probeTicker.trim() || !resolvedDateForGrading) return;
    setProbing(true);
    setProbeResult(null);
    try {
      const res = await fetch(
        `/api/v1/earnings/coverage?ticker=${encodeURIComponent(probeTicker.trim())}&date=${resolvedDateForGrading}`,
        { cache: 'no-store' }
      );
      const j = await res.json();
      setProbeResult(j);
    } catch (e: any) {
      setProbeResult({ error: e?.message || 'probe failed' });
    } finally {
      setProbing(false);
    }
  };

  // PATCH 0186 — Guidance logic removed. Guidance now lives in /watchlists
  // → Conviction Beats tab + /earnings-hub → Scan filter, both fed from
  // the BLOCKBUSTER/STRONG cards graded here. See lib/conviction-beats.ts.

  // Auto-sync BLOCKBUSTER + STRONG cards into the Conviction Beats pipeline
  // every time the graded payload changes. Fires whenever a fresh date is
  // viewed — the storage layer dedupes by ticker + filing_date so this is
  // safe to call repeatedly.
  useEffect(() => {
    if (!data?.by_tier) return;
    const entries: Array<{
      ticker: string; company: string; tier: ConvictionTier;
      composite_score: number;
      sales_yoy_pct: number | null; net_profit_yoy_pct: number | null; eps_yoy_pct: number | null;
      filing_date: string; sector?: string; market_cap_bucket?: string; source_url?: string;
    }> = [];
    for (const tier of ['BLOCKBUSTER', 'STRONG'] as const) {
      for (const c of (data.by_tier[tier] || [])) {
        entries.push({
          ticker: c.ticker, company: c.company, tier,
          composite_score: c.composite_score,
          sales_yoy_pct: c.sales_yoy_pct, net_profit_yoy_pct: c.net_profit_yoy_pct, eps_yoy_pct: c.eps_yoy_pct,
          filing_date: c.filing_date, sector: c.sector, market_cap_bucket: c.market_cap_bucket,
          source_url: c.filing_url,
        });
      }
    }
    if (entries.length > 0) syncFromEarningsOps(entries);
  }, [data]);

  // PATCH 0188 — Auto-fill REMOVED entirely (was 0177, disabled in 0179).
  // It had no way to verify a ticker actually filed on the target date —
  // produced HINDZINC/ETERNAL-style wrong-date attribution bugs. Use the
  // manual force-include via Coverage Probe or the auto-cron calendar
  // (lib/conviction-beats + /api/v1/cron/refresh-earnings-calendar) instead.
  const autoFillTickers: string[] = [];

  // PATCH 0176 — Force-include: list of tickers manually added by user.
  // Persists in localStorage per-date. These tickers get injected into the
  // page even if /api/market/earnings doesn't surface them (NSE feed gap).
  const FORCE_INCLUDE_KEY = 'mc:earnings:force-include:v1';
  // PATCH 0179 — one-shot scrub key. If user has stale force-includes from the
  // buggy 0177 auto-fill (HINDZINC/ETERNAL on wrong dates), wipe them once.
  const SCRUB_KEY = 'mc:earnings:force-include:scrub:2026-05-12';
  const [forceIncludeMap, setForceIncludeMap] = useState<Record<string, string[]>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      // One-time scrub: clear stale buggy auto-fill data
      if (!localStorage.getItem(SCRUB_KEY)) {
        localStorage.removeItem(FORCE_INCLUDE_KEY);
        localStorage.setItem(SCRUB_KEY, '1');
        return {};
      }
      const raw = localStorage.getItem(FORCE_INCLUDE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  const persistForceInclude = (next: Record<string, string[]>) => {
    setForceIncludeMap(next);
    try { localStorage.setItem(FORCE_INCLUDE_KEY, JSON.stringify(next)); } catch {}
  };
  const userForceIncludeForDate = useMemo(
    () => (resolvedDateForGrading ? (forceIncludeMap[resolvedDateForGrading] || []) : []),
    [forceIncludeMap, resolvedDateForGrading],
  );
  // Merge user's manual list with auto-discovered list — dedupe
  const forceIncludeForDate = useMemo(() => {
    const set = new Set<string>([...userForceIncludeForDate, ...autoFillTickers]);
    return [...set];
  }, [userForceIncludeForDate, autoFillTickers]);

  // Fetch enrichment for force-included tickers and grade them client-side
  const { data: forcedCards } = useQuery<ParsedEarning[]>({
    queryKey: ['force-included', resolvedDateForGrading, forceIncludeForDate.join(',')],
    enabled: forceIncludeForDate.length > 0 && !!resolvedDateForGrading,
    queryFn: async () => {
      const symbolsCsv = forceIncludeForDate.join(',');
      const res = await fetch(
        `/api/v1/earnings/enrich?symbols=${symbolsCsv}&filed=${resolvedDateForGrading}&nocache=1`,
        { cache: 'no-store' }
      );
      if (!res.ok) return [];
      const j = await res.json();
      const enrich = j?.data || {};
      const out: ParsedEarning[] = [];
      for (const ticker of forceIncludeForDate) {
        const e = enrich[ticker] || {};
        if (e.sales_curr_cr == null && e.pat_curr_cr == null) {
          // No financials available even via direct fetch — still inject preview
          out.push({
            ticker, company: e.company || ticker, sector: e.sector,
            filing_date: resolvedDateForGrading, quarter: e.quarter || 'Q4',
            market_cap_bucket: e.market_cap_bucket || null,
            pe: null, price: e.current_price ?? null,
            sales_yoy_pct: null, net_profit_yoy_pct: null, eps_yoy_pct: null,
            sales_curr_cr: null, sales_prev_cr: null,
            pat_curr_cr: null, pat_prev_cr: null,
            eps_curr: null, eps_prev: null,
            gap_pct: null, d1_pct: null, move_pct: null,
            rs_rating: null, stage: null, pct_from_52w_high: null,
            composite_score: 0, tier: 'MIXED',
            methodology_tags: [], caveat_tags: [],
            narrative: `${ticker} added manually — Screener has no Q4 data yet, will populate next worker pass.`,
            filing_url: `https://www.nseindia.com/companies-listing/corporate-filings-financial-results?symbol=${encodeURIComponent(ticker)}`,
            source: 'force-included',
          });
          continue;
        }
        // Grade via gradeRow with synthetic row
        const row = {
          symbol: ticker, company: e.company || ticker,
          filing_date: resolvedDateForGrading,
          quarter: e.quarter || 'Q4', sector: e.sector,
          market_cap_bucket: e.market_cap_bucket,
          source_url: e.source_url || `https://www.nseindia.com/companies-listing/corporate-filings-financial-results?symbol=${encodeURIComponent(ticker)}`,
          sales_curr_cr: e.sales_curr_cr ?? null, sales_prev_cr: e.sales_prev_cr ?? null,
          sales_yoy_pct: e.sales_yoy_pct ?? null,
          pat_curr_cr: e.pat_curr_cr ?? null, pat_prev_cr: e.pat_prev_cr ?? null,
          pat_yoy_pct: e.pat_yoy_pct ?? null,
          eps_curr: e.eps_curr ?? null, eps_prev: e.eps_prev ?? null,
          eps_yoy_pct: e.eps_yoy_pct ?? null,
          op_profit_yoy_pct: e.op_profit_yoy_pct ?? null,
          opm_pct: e.opm_pct ?? null, opm_prev_pct: e.opm_prev_pct ?? null,
          pe: e.pe ?? null, current_price: e.current_price ?? null,
          gap_pct: e.gap_pct ?? null, d1_pct: e.d1_pct ?? null, move_pct: e.move_pct ?? null,
          pct_from_52w_high: e.pct_from_52w_high ?? null,
          rs_rating: e.rs_rating ?? null, stage: e.stage ?? null,
          trend_template_passes: e.trend_template_passes ?? false,
          ocf_annual_cr: e.ocf_annual_cr ?? null,
          pat_annual_cr: e.pat_annual_cr ?? null,
          ocf_to_pat_ratio: e.ocf_to_pat_ratio ?? null,
          period_ended: e.period_ended,
          latest_quarter_end_iso: e.latest_quarter_end_iso,
          financials_source: e.financials_source,
        };
        const g = gradeRow(row);
        if (g) {
          g.source = `force-included · ${g.source}`;
          out.push(g);
        }
      }
      return out;
    },
    staleTime: 5 * 60_000,
    refetchInterval: false,
  });

  const addForceInclude = (ticker: string) => {
    if (!resolvedDateForGrading) return;
    const cur = forceIncludeMap[resolvedDateForGrading] || [];
    const t = ticker.trim().toUpperCase();
    if (!t || cur.includes(t)) return;
    persistForceInclude({ ...forceIncludeMap, [resolvedDateForGrading]: [...cur, t] });
  };
  const removeForceInclude = (ticker: string) => {
    if (!resolvedDateForGrading) return;
    const cur = forceIncludeMap[resolvedDateForGrading] || [];
    persistForceInclude({ ...forceIncludeMap, [resolvedDateForGrading]: cur.filter((x) => x !== ticker) });
  };

  // PATCH 0360 — Bulk backfill last 90 days. One-shot operation: chains
  // /api/v1/earnings/backfill batches (6 dates per call) until done. Each
  // batch calls graded?refreshMissing=1 internally for each date, so any
  // preview-shape cached payloads get healed permanently. Subsequent visits
  // to those dates are instant cache hits — no Refresh button needed.
  //
  // Skips weekends and today. Stops as soon as the server reports done=true.
  const runBackfill = async () => {
    if (backfilling) return;
    setBackfilling(true);
    setBackfillProgress('Starting…');
    const today = new Date();
    // PATCH 0361 — 60-day window (was 90). User said 60 is enough.
    const from = new Date(today); from.setDate(today.getDate() - 60);
    const to = new Date(today); to.setDate(today.getDate() - 1);
    const fromIso = from.toISOString().slice(0, 10);
    const toIso = to.toISOString().slice(0, 10);
    let cursor = fromIso;
    let processedTotal = 0;
    let enrichedTotal = 0;
    let previewOnlyTotal = 0;
    let errorDates: string[] = [];
    let consecutiveErrors = 0;
    // PATCH 0361 — helper: advance cursor by N days when a batch fails so
    // we don't get stuck on the same problematic date forever.
    const advanceCursor = (iso: string, days: number) => {
      const d = new Date(iso); d.setDate(d.getDate() + days);
      return d.toISOString().slice(0, 10);
    };
    try {
      // Safety: cap at 40 batches (60 days / 2 dates per batch = 30 calls,
      // +10 retries headroom).
      for (let iter = 0; iter < 40; iter++) {
        setBackfillProgress(`Backfilling ${cursor}… (${processedTotal} dates done${errorDates.length ? ` · ${errorDates.length} timed out` : ''})`);
        let res: Response | null = null;
        let lastErr: string | null = null;
        // PATCH 0361 — retry once on 5xx/timeout before skipping the batch.
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            res = await fetch(`/api/v1/earnings/backfill?from=${cursor}&to=${toIso}`, {
              cache: 'no-store',
              signal: AbortSignal.timeout(50_000),
            });
            if (res.ok) break;
            lastErr = `HTTP ${res.status}`;
            // 504/timeout: wait a beat and try again. Other errors: skip immediately.
            if (res.status >= 500 && attempt === 0) {
              await new Promise(r => setTimeout(r, 1500));
              continue;
            }
            break;
          } catch (e: any) {
            lastErr = e?.message || 'fetch error';
            if (attempt === 0) {
              await new Promise(r => setTimeout(r, 1500));
              continue;
            }
            break;
          }
        }
        if (!res || !res.ok) {
          errorDates.push(cursor);
          consecutiveErrors++;
          // Skip past this batch's dates (2 weekdays) and try the next chunk
          cursor = advanceCursor(cursor, 4);  // 4 calendar days = ~2 weekdays
          if (cursor > toIso) break;
          if (consecutiveErrors >= 5) {
            setBackfillProgress(`⚠ Backfill aborted after ${consecutiveErrors} consecutive failures · last err: ${lastErr} · ${enrichedTotal} dates enriched before failure · ${errorDates.length} dates skipped`);
            break;
          }
          continue;
        }
        consecutiveErrors = 0;
        const j = await res.json();
        processedTotal += j.processed || 0;
        for (const r of (j.results || [])) {
          if (r.status === 'enriched') enrichedTotal++;
          if (r.status === 'preview-only') previewOnlyTotal++;
          if (r.status === 'error') errorDates.push(r.date);
        }
        if (j.done) {
          const errorTail = errorDates.length
            ? ` · ${errorDates.length} dates timed out (re-click Backfill to retry just those)`
            : '';
          setBackfillProgress(`✓ Backfill complete · ${enrichedTotal} dates enriched · ${previewOnlyTotal} had no Screener data · scanned ${processedTotal} weekdays in ${fromIso}–${toIso}${errorTail}`);
          // Invalidate all client caches so the user's next navigation hits fresh data
          // PATCH 0452 P1-9 — Audit found this scrubbed v8 only; current key
          // is v9 (Patch 0402). Make version-agnostic so the backfill
          // success ACTUALLY busts the snapshot the user is sitting on.
          try {
            const keys: string[] = [];
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              if (k && /^mc:graded:v\d+:/.test(k)) keys.push(k);
            }
            for (const k of keys) localStorage.removeItem(k);
          } catch {}
          await refetchGraded();
          break;
        }
        cursor = j.cursor_next;
        if (!cursor) break;
      }
    } catch (e: any) {
      setBackfillProgress(`⚠ Backfill threw: ${e?.message || 'unknown error'}`);
    } finally {
      setBackfilling(false);
      // Leave the success message up for 30s
      setTimeout(() => setBackfillProgress((s) => (s && s.startsWith('✓')) ? null : s), 30_000);
    }
  };

  const refreshMissingMutate = async () => {
    if (!resolvedDateForGrading || refreshing) return;
    // PATCH 0450 BUG-056 / PATCH 0498 — Removed past-date block. User
    // explicitly needs to re-scan weekend filings when our pipeline missed
    // them on the initial poll. Live-NSE augmentation (server-side) is
    // protected by a 30-min KV lockout to prevent hammering NSE.
    setRefreshing(true);
    setRefreshFeedback(null);
    try {
      // PATCH 0255 — Be more aggressive. refreshMissing=1 sometimes returns
      // a 'no-op' because the cached payload looks complete from the
      // server's perspective even if the user can see missing tickers.
      // Adding force=1 alongside busts the KV cache and rebuilds from
      // scratch, which actually pulls in newly-filed companies + re-runs
      // enrichment for tickers that previously returned null.
      const res = await fetch(`/api/v1/earnings/graded?date=${resolvedDateForGrading}&refreshMissing=1&force=1`, { cache: 'no-store' });
      if (!res.ok) {
        setRefreshFeedback(`⚠ Refresh failed (HTTP ${res.status})`);
        console.warn('refreshMissing failed', res.status);
      } else {
        const j = await res.json();
        const msg: string = j?._refresh || 'completed';
        const m = msg.match(/^(\d+)\/(\d+)\s+updated/);
        const updated = m ? parseInt(m[1], 10) : 0;
        const total = m ? parseInt(m[2], 10) : 0;
        const failedTickers: string[] = Array.isArray(j?._failed_tickers) ? j._failed_tickers : [];
        const tickerListFromServer = (n = 8) => {
          if (failedTickers.length === 0) return 'these tickers';
          const shown = failedTickers.slice(0, n).join(', ');
          const more = failedTickers.length > n ? ` +${failedTickers.length - n} more` : '';
          return `${shown}${more}`;
        };
        // PATCH 0190/0192 — wipe localStorage so the fresh server payload is
        // the source of truth.
        // PATCH 0452 P1-9 — version-agnostic scrub (also covers v9).
        try {
          for (const v of ['v7','v8','v9','v10']) {
            localStorage.removeItem(`mc:graded:${v}:${resolvedDateForGrading}`);
          }
        } catch {}
        // PATCH 0286 — Clearer messaging when upstream genuinely has no data.
        // User feedback: the previous "0/N updated · Worker re-checks in 60s + 5min"
        // message looked like a bug because it never changed on retry. The real
        // cause is usually that NSE/BSE/Screener simply haven't published yet
        // for the requested filing date — no amount of client retries fixes that.
        const stamp = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        if (msg.includes('no-op')) {
          setRefreshFeedback(`✓ ${stamp} · All cards already have financials. If you expected new tickers they aren't in NSE/BSE filings for this date yet.`);
        } else if (updated > 0 && failedTickers.length === 0) {
          setRefreshFeedback(`✓ ${stamp} · Updated ${updated}/${total} cards with fresh financials.`);
        } else if (updated > 0) {
          setRefreshFeedback(`✓ ${stamp} · Updated ${updated}/${total} cards. Background worker still chasing: ${tickerListFromServer()}.`);
        } else {
          // Distinguish "old past date" (sources unlikely to ever fill) from
          // "today or near-today" (worker may resolve over the next few minutes).
          const ageDays = (() => {
            try {
              const d = new Date(resolvedDateForGrading);
              const today = new Date();
              return Math.round((today.getTime() - d.getTime()) / 86_400_000);
            } catch { return 0; }
          })();
          if (ageDays > 14) {
            setRefreshFeedback(`⚠ ${stamp} · 0/${total} updated — sources have no Q-data for ${resolvedDateForGrading} (${ageDays}d ago). Filings for older dates rarely backfill. Use Coverage Probe ↓ to add manually or move on to a fresher date.`);
          } else if (ageDays >= 0) {
            setRefreshFeedback(`⚠ ${stamp} · 0/${total} updated — NSE/BSE/Screener haven't published Q-data yet for ${tickerListFromServer()}. Re-checking automatically at 60s and 5min; press Refresh again later if still missing.`);
          } else {
            // ageDays < 0 — future date
            setRefreshFeedback(`⚠ ${stamp} · 0/${total} updated — ${resolvedDateForGrading} is in the future; companies haven't reported yet. Wait for actual filings or move to a past date.`);
          }
        }
        // PATCH 0255 — Don't auto-hide if there are still pending tickers; the
        // user needs to see this message until something actually completes.
        if (failedTickers.length === 0) {
          setTimeout(() => setRefreshFeedback(null), 20000);
        }
      }
      // Force a fresh fetch — bypass any client-side caches
      await refetchGraded();

      // PATCH 0255 — Delayed follow-up refetches to catch async worker
      // completions. The worker re-tries upstream sources (NSE/BSE/Screener
      // /Yahoo) which can take 30s-5min on cold-cache misses.
      // PATCH 0450 BUG-056 — Only schedule these follow-ups for today.
      // Yesterday is allowed one immediate refresh (handled by main path)
      // but doesn't need the 60s + 5min polling cycle.
      const todayIsoLocal = new Date().toISOString().slice(0, 10);
      if (resolvedDateForGrading === todayIsoLocal) {
        setTimeout(() => { refetchGraded(); }, 60_000);
        setTimeout(() => { refetchGraded(); }, 5 * 60_000);
      }
    } finally {
      setRefreshing(false);
    }
  };

  // Calendar view: last 28 days back, next 14 forward — built from hub data
  const calRange = useMemo(() => {
    const d = new Date(filterDate || todayISO());
    const from = new Date(d); from.setDate(from.getDate() - 28);
    const to   = new Date(d); to.setDate(to.getDate() + 14);
    const fmt = (x: Date) => x.toISOString().slice(0, 10);
    return { from: fmt(from), to: fmt(to) };
  }, [filterDate]);
  const calData: CalendarPayload | undefined = useMemo(
    () => hub ? buildCalendarFromHub(hub, calRange.from, calRange.to) : undefined,
    [hub, calRange.from, calRange.to],
  );
  const calLoading = hubLoading;

  const baseView: OpportunitiesPayload = data || {
    filing_date: filterDate || null,
    candidates_total: 0,
    raw_items_total: 0,
    by_tier: { BLOCKBUSTER: [], STRONG: [], MIXED: [], AVOID: [] },
    generated_at: '',
    sources_polled: 0,
  };

  // PATCH 0176 — Merge force-included tickers into the view. Dedupe by ticker
  // so a force-included one doesn't appear twice if the server also picks it up.
  const view: OpportunitiesPayload = useMemo(() => {
    if (!forcedCards || forcedCards.length === 0) return baseView;
    const seenTickers = new Set<string>();
    const merged: Record<EarningsTier, ParsedEarning[]> = { BLOCKBUSTER: [], STRONG: [], MIXED: [], AVOID: [] };
    for (const t of TIER_ORDER) {
      for (const c of (baseView.by_tier[t] || [])) {
        seenTickers.add(c.ticker.toUpperCase());
        merged[t].push(c);
      }
    }
    let injected = 0;
    for (const f of forcedCards) {
      if (seenTickers.has(f.ticker.toUpperCase())) continue;
      merged[f.tier].push(f);
      seenTickers.add(f.ticker.toUpperCase());
      injected++;
    }
    if (injected > 0) {
      for (const t of TIER_ORDER) merged[t].sort((a, b) => b.composite_score - a.composite_score);
    }
    return {
      ...baseView,
      by_tier: merged,
      candidates_total: baseView.candidates_total + injected,
    };
  }, [baseView, forcedCards]);

  // PATCH 0183: header date label now uses resolvedDateForGrading FIRST so the
  // navigation header updates INSTANTLY when user clicks ←/→. Previous logic
  // used view.filing_date which lagged behind by the entire fetch duration —
  // user saw stale "future date" while waiting 30+ seconds for new data.
  const effectiveDate = resolvedDateForGrading || filterDate || view.filing_date || '';
  const filingDateLabel = (() => {
    if (!effectiveDate) return 'Latest available';
    try {
      const d = new Date(effectiveDate);
      const formatted = d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      return !filterDate ? `${formatted} · auto-picked` : formatted;
    } catch { return effectiveDate; }
  })();
  // Detect "stale view": showing data from a previous date while new date loads.
  // True when graded query is fetching AND view.filing_date doesn't match the
  // date the user just navigated to.
  // PATCH 0194 — isStaleView ONLY when DATE changed mid-fetch. Refresh/HardRefresh
  // on the SAME date shouldn't dim the view (the data is being refined in place).
  // Previous code dimmed forever whenever gradedFetching was true after a refresh
  // because view.filing_date never matched resolvedDateForGrading exactly.
  const isStaleView = gradedFetching &&
    !!view.filing_date &&
    !!resolvedDateForGrading &&
    view.filing_date !== resolvedDateForGrading;

  const counts = TIER_ORDER.map((t) => ({ tier: t, n: view.by_tier[t]?.length || 0 }));

  // PATCH 0482 — INVERTED from 0193. Indian companies routinely file
  // quarterly results on Saturdays (board meetings often run weekends)
  // and even Sundays. EarningsPulse and Trendlyne both surface them on
  // their actual filing date. Skipping Sat/Sun made users miss entire
  // batches — for 17 May 2026 (Sunday) EarningsPulse had 99 candidates,
  // we had zero because ← jumped from Mon to Fri.
  function shiftDate(delta: number) {
    const base = filterDate || todayISO();
    const d = new Date(base);
    d.setDate(d.getDate() + delta);
    setFilterDate(d.toISOString().slice(0, 10));
  }

  // PATCH 0450 BUG-056 — Past-date detection used to dim refresh buttons.
  const isPastDate = !!resolvedDateForGrading && (() => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    const yIsoLocal3 = d.toISOString().slice(0, 10);
    return resolvedDateForGrading < yIsoLocal3;
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#0A0E1A' }}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ padding: '20px 24px 14px', borderBottom: '1px solid #1A2540', backgroundColor: '#0D1623' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: '#E6EDF3', margin: 0 }}>Earnings Opportunities</h1>
          <button onClick={() => refetch()} disabled={hardRefreshing}
            title="Hard refresh — busts cache, re-fetches NSE/BSE feeds, pulls in newly-filed tickers (works for any date including weekends)"
            style={{
              padding: '4px 10px', borderRadius: 6,
              border: '1px solid #22D3EE60',
              background: hardRefreshing ? '#22D3EE30' : '#22D3EE15',
              color: '#22D3EE',
              fontSize: 11, fontWeight: 700,
              cursor: hardRefreshing ? 'not-allowed' : 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 4,
              opacity: hardRefreshing ? 0.8 : 1,
            }}>
            <RefreshCw style={{ width: 11, height: 11, animation: hardRefreshing ? 'spin 0.8s linear infinite' : 'none' }} />
            {hardRefreshing ? 'Refetching…' : 'Hard Refresh'}
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </button>
          {/* PATCH 0360 / 0361 — One-shot backfill of the last 60 weekdays.
              Heals all preview-shape cached payloads so every past date
              becomes instant cache-hit going forward. */}
          <button
            onClick={runBackfill}
            disabled={backfilling}
            title="One-time fill of the last 60 weekdays. Chains 2-date batches with retry. Once done, past-date pages serve from cache instantly with no Refresh needed."
            style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #A78BFA60', background: backfilling ? '#A78BFA30' : '#A78BFA15', color: '#A78BFA', fontSize: 11, fontWeight: 700, cursor: backfilling ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, opacity: backfilling ? 0.8 : 1 }}>
            <RefreshCw style={{ width: 11, height: 11, animation: backfilling ? 'spin 0.8s linear infinite' : 'none' }} />
            {backfilling ? 'Backfilling…' : 'Backfill 60d'}
          </button>
          {backfillProgress && (
            <span style={{
              fontSize: 10.5, fontWeight: 700,
              padding: '3px 8px', borderRadius: 4,
              backgroundColor: backfillProgress.startsWith('✓') ? '#10B98118' : backfillProgress.startsWith('⚠') ? '#EF444418' : '#A78BFA18',
              border: `1px solid ${backfillProgress.startsWith('✓') ? '#10B98140' : backfillProgress.startsWith('⚠') ? '#EF444440' : '#A78BFA40'}`,
              color: backfillProgress.startsWith('✓') ? '#10B981' : backfillProgress.startsWith('⚠') ? '#EF4444' : '#A78BFA',
              maxWidth: 480, lineHeight: 1.3,
            }}>
              {backfillProgress}
            </span>
          )}
          {/* PATCH 0362 — Live indicator. Only renders when viewing today's
              date during market hours. Tells the user the page is auto-
              refreshing every 4 min, with the last refresh timestamp so
              they can see freshness at a glance. */}
          {resolvedDateForGrading === todayIso && (() => {
            const now = new Date();
            const istHours = (now.getUTCHours() + 5.5) % 24;
            const inMarketHours = istHours >= 9 && istHours <= 17;
            const minutesAgo = Math.floor((Date.now() - lastAutoRefreshMs) / 60_000);
            return (
              <span title={inMarketHours
                ? 'Auto-refreshing every 4 min during Indian market hours (9 AM - 5 PM IST). New filings light up with NEW badges.'
                : 'Market closed — manual refresh only. Re-opens 9 AM IST.'}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  fontSize: 10.5, fontWeight: 700,
                  padding: '3px 9px', borderRadius: 4,
                  backgroundColor: inMarketHours ? '#10B98118' : '#94A3B815',
                  border: `1px solid ${inMarketHours ? '#10B98160' : '#94A3B840'}`,
                  color: inMarketHours ? '#10B981' : '#94A3B8',
                  fontFamily: 'ui-monospace, monospace',
                }}>
                {inMarketHours
                  ? <><span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 3, backgroundColor: '#10B981', animation: 'pulse 1.5s ease-in-out infinite' }} /> LIVE · auto-refresh 4m · last {minutesAgo}m ago</>
                  : <>● MARKET CLOSED · manual refresh only</>
                }
                <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }`}</style>
              </span>
            );
          })()}
          {/* PATCH 0189 — Partial refresh button with INLINE feedback */}
          {resolvedDateForGrading && (() => {
            const missing = ((view.by_tier?.BLOCKBUSTER ?? []) as ParsedEarning[])
              .concat(view.by_tier?.STRONG ?? [])
              .concat(view.by_tier?.MIXED ?? [])
              .concat(view.by_tier?.AVOID ?? [])
              .filter((c) => c.sales_curr_cr == null && c.pat_curr_cr == null).length;
            // Show button if missing > 0 OR a feedback message is currently displayed.
            // Don't hide button just because data isn't there to fetch.
            if (missing === 0 && !refreshFeedback) return null;
            return (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {missing > 0 && (
                  <button
                    onClick={refreshMissingMutate}
                    disabled={refreshing}
                    title={`Fetch financials for ${missing} cards that don't have data yet — works on past dates too (weekend filings, etc.)`}
                    style={{
                      padding: '4px 10px', borderRadius: 6,
                      border: '1px solid #F59E0B60',
                      background: refreshing ? '#F59E0B30' : '#F59E0B15',
                      color: '#F59E0B',
                      fontSize: 11,
                      cursor: refreshing ? 'not-allowed' : 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 700,
                      opacity: refreshing ? 0.8 : 1,
                    }}>
                    <RefreshCw style={{ width: 11, height: 11, animation: refreshing ? 'spin 0.8s linear infinite' : 'none' }} />
                    {refreshing ? `Refreshing ${missing}…` : `Refresh ${missing} missing`}
                  </button>
                )}
                {/* Inline feedback right next to the button — impossible to miss */}
                {refreshFeedback && (
                  <span style={{
                    fontSize: 10.5, fontWeight: 700,
                    padding: '3px 8px', borderRadius: 4,
                    backgroundColor: refreshFeedback.startsWith('✓') ? '#10B98118' : '#EF444418',
                    border: `1px solid ${refreshFeedback.startsWith('✓') ? '#10B98140' : '#EF444440'}`,
                    color: refreshFeedback.startsWith('✓') ? '#10B981' : '#EF4444',
                    maxWidth: 480, lineHeight: 1.3,
                  }}>
                    {refreshFeedback}
                  </span>
                )}
              </div>
            );
          })()}
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6B7A8D' }}>
            Live BSE/NSE results pipeline · {view.sources_polled} sources polled
          </span>
        </div>

        <div style={{ backgroundColor: '#0A1422', border: '1px solid #1A2840', borderRadius: 8, padding: '10px 14px', marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 12, color: '#94A3B8', lineHeight: 1.55 }}>
              Yesterday's earnings, scored overnight — find the exceptional setups before the market opens.<br/>
              Every Indian filing graded into one of four conviction tiers — from <strong style={{ color: '#F59E0B' }}>BLOCKBUSTER</strong> through <strong style={{ color: '#10B981' }}>STRONG</strong>, <strong style={{ color: '#FACC15' }}>MIXED</strong>, and <strong style={{ color: '#EF4444' }}>AVOID</strong>.
            </div>
            <button onClick={() => setShowAbout((s) => !s)}
              style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #22D3EE60', background: '#22D3EE15', color: '#22D3EE', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              How it works {showAbout ? '▴' : '▾'}
            </button>
          </div>
          {showAbout && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #1A2840', fontSize: 11.5, color: '#94A3B8', lineHeight: 1.7 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                <div><strong style={{ color: '#F59E0B' }}>⭐ BLOCKBUSTER</strong><br/>Exceptional fit on multiple lenses, clean earnings quality, technically primed. Rare — typically 0–3 names per day.</div>
                <div><strong style={{ color: '#10B981' }}>🟢 STRONG</strong><br/>High-conviction with clear pass on the strongest lenses; no material quality concerns.</div>
                <div><strong style={{ color: '#FACC15' }}>🟡 MIXED</strong><br/>Some lenses pass, some fail; or optically strong results shadowed by quality flags.</div>
                <div><strong style={{ color: '#EF4444' }}>🔴 AVOID</strong><br/>Multiple weakness signals or material quality flags dominate.</div>
              </div>
              <div style={{ marginTop: 10, fontSize: 10.5, color: '#6B7A8D', fontStyle: 'italic' }}>
                Educational only. Not investment advice. Server pipeline fetches BSE/NSE results announcements + Indian results RSS feeds. Parser accuracy depends on RSS title richness.
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: `1px solid ${isStaleView ? '#F59E0B60' : '#1A2840'}`, borderRadius: 8, padding: '2px 2px 2px 12px', backgroundColor: '#0A1422' }}>
            <span style={{ fontSize: 11, color: '#6B7A8D', fontWeight: 700, letterSpacing: '0.4px' }}>FILING DATE</span>
            <span style={{ fontSize: 12, color: '#22D3EE', fontWeight: 700 }}>· {filingDateLabel}</span>
            {isStaleView && (
              <span style={{
                fontSize: 9.5, fontWeight: 800, color: '#F59E0B',
                padding: '1px 6px', borderRadius: 3,
                backgroundColor: '#F59E0B22', border: '1px solid #F59E0B60',
                display: 'inline-flex', alignItems: 'center', gap: 3,
                marginLeft: 6,
              }}>
                <span style={{
                  display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
                  backgroundColor: '#F59E0B', animation: 'pulse 1s infinite',
                }} />
                LOADING
                <style>{`@keyframes pulse { 0%,100%{opacity:1}50%{opacity:.3} }`}</style>
              </span>
            )}
            <button onClick={() => shiftDate(-1)} style={{ padding: '6px 10px', background: 'none', border: 'none', color: '#94A3B8', fontSize: 14, cursor: 'pointer' }}>←</button>
            <button onClick={() => shiftDate(1)}  style={{ padding: '6px 10px', background: 'none', border: 'none', color: '#94A3B8', fontSize: 14, cursor: 'pointer' }}>→</button>
          </div>
          {/* PATCH 0493 — Sparse-day hint banner */}
          {sparseDayHint && (
            <button
              onClick={() => setFilterDate(sparseDayHint.date)}
              style={{
                padding: '6px 12px', borderRadius: 8,
                border: '1px solid #F59E0B60', backgroundColor: '#F59E0B15',
                color: '#F59E0B', fontSize: 11, fontWeight: 700,
                cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
              title="The previous date with filings — click to view"
            >
              ← {sparseDayHint.label} had {sparseDayHint.count} filings
            </button>
          )}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', border: '1px solid #1A2840', borderRadius: 8, backgroundColor: '#0A1422', cursor: 'pointer' }}>
            <CalendarIcon style={{ width: 12, height: 12, color: '#94A3B8' }} />
            <span style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600 }}>Jump to</span>
            <input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)}
              style={{ background: 'transparent', border: 'none', color: '#22D3EE', fontSize: 12, fontWeight: 700, outline: 'none', cursor: 'pointer' }} />
          </label>
          {filterDate && (
            <button onClick={() => setFilterDate('')} title="Show latest available"
              style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #1A2840', backgroundColor: 'transparent', color: '#8A95A3', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
              ↩ Latest
            </button>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6B7A8D' }}>
            {view.candidates_total} graded · {view.raw_items_total} earnings articles found
          </span>
          {counts.map((c) => (
            <span key={c.tier} style={{
              fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
              border: `1px solid ${TIER_META[c.tier].color}50`, backgroundColor: `${TIER_META[c.tier].color}15`, color: TIER_META[c.tier].color,
            }}>
              {TIER_META[c.tier].icon} {TIER_META[c.tier].label} {c.n}
            </span>
          ))}
        </div>

        {/* ── Coverage Probe (PATCH 0174) ─────────────────────────────────── */}
        <div style={{
          marginTop: 10, padding: '10px 14px',
          backgroundColor: '#0A1422', border: '1px solid #1A2840', borderRadius: 8,
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, color: '#6B7A8D', fontWeight: 700, letterSpacing: '0.6px' }}>
              🔍 COVERAGE PROBE
            </span>
            <span style={{ fontSize: 10.5, color: '#8A95A3' }}>
              Missing a ticker that's on EarningsPulse for this date? Probe our pipeline to see which layer dropped it.
            </span>
            <input
              type="text"
              value={probeTicker}
              onChange={(e) => setProbeTicker(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === 'Enter') runCoverageProbe(); }}
              placeholder="e.g. SYRMA, ATLANTAELE, MCX"
              style={{
                flex: 1, minWidth: 180,
                padding: '5px 10px', backgroundColor: '#0D1623',
                border: '1px solid #1A2840', borderRadius: 6, color: '#E6EDF3',
                fontSize: 11.5, fontWeight: 700, fontFamily: 'ui-monospace, monospace',
                letterSpacing: '0.5px', outline: 'none',
              }}
            />
            <button
              onClick={runCoverageProbe}
              disabled={!probeTicker.trim() || probing || !resolvedDateForGrading}
              style={{
                padding: '5px 14px', borderRadius: 6, border: '1px solid #22D3EE60',
                backgroundColor: probing ? '#22D3EE30' : '#22D3EE15',
                color: '#22D3EE', fontSize: 11, fontWeight: 700,
                cursor: probing ? 'wait' : (probeTicker.trim() ? 'pointer' : 'not-allowed'),
                opacity: probeTicker.trim() ? 1 : 0.5,
              }}
            >
              {probing ? 'Probing…' : 'Probe'}
            </button>
            <button
              onClick={() => { if (probeTicker.trim()) { addForceInclude(probeTicker.trim()); setProbeTicker(''); setProbeResult(null); } }}
              disabled={!probeTicker.trim() || !resolvedDateForGrading}
              title="Bypass NSE/BSE universe entirely — fetch financials direct from Screener via /enrich and inject this ticker into the page. Persists in localStorage."
              style={{
                padding: '5px 14px', borderRadius: 6, border: '1px solid #10B98160',
                backgroundColor: '#10B98115',
                color: '#10B981', fontSize: 11, fontWeight: 700,
                cursor: probeTicker.trim() ? 'pointer' : 'not-allowed',
                opacity: probeTicker.trim() ? 1 : 0.5,
              }}
            >
              + Add to page
            </button>
            <button
              onClick={runAudit}
              disabled={auditing || !resolvedDateForGrading}
              title="Validate this date's coverage against the EarningsPulse Week Ahead reference list (May 12–18 seeded). Shows missing tickers — diagnostic only, does NOT auto-inject."
              style={{
                padding: '5px 14px', borderRadius: 6, border: '1px solid #F59E0B60',
                backgroundColor: auditing ? '#F59E0B30' : '#F59E0B15',
                color: '#F59E0B', fontSize: 11, fontWeight: 700,
                cursor: auditing ? 'wait' : 'pointer',
              }}
            >
              {auditing ? 'Auditing…' : '✓ Validate Coverage'}
            </button>
          </div>

          {/* Audit Result */}
          {auditResult && (
            <div style={{
              marginTop: 4, padding: '8px 12px',
              backgroundColor: '#0D1623', border: '1px solid #1A2840', borderRadius: 6,
              fontSize: 11, color: '#C9D4E0', lineHeight: 1.5,
            }}>
              {auditResult.error ? (
                <span style={{ color: '#EF4444' }}>⚠ {auditResult.error}</span>
              ) : auditResult.expected_total === 0 ? (
                <span style={{ color: '#6B7A8D', fontSize: 10.5 }}>{auditResult.note}</span>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: 11, fontWeight: 800,
                      color: auditResult.gap === 0 ? '#10B981' : '#F59E0B',
                    }}>
                      {auditResult.gap === 0 ? '✓' : '⚠'} Coverage: {auditResult.matched}/{auditResult.expected_total} ({auditResult.coverage_pct}%)
                    </span>
                    <span style={{ fontSize: 10, color: '#6B7A8D' }}>{auditResult.note}</span>
                  </div>
                  {auditResult.missing && auditResult.missing.length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      <div style={{ fontSize: 10, color: '#6B7A8D', fontWeight: 700, letterSpacing: '0.4px', marginBottom: 4 }}>
                        MISSING ({auditResult.missing.length}):
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {auditResult.missing.map((t: string) => (
                          <button
                            key={t}
                            onClick={() => { setProbeTicker(t); setAuditResult(null); }}
                            title="Click to load into probe for diagnosis"
                            style={{
                              padding: '2px 8px', fontSize: 10, fontWeight: 700,
                              borderRadius: 4, backgroundColor: '#EF444418',
                              border: '1px solid #EF444440', color: '#EF4444',
                              fontFamily: 'ui-monospace, monospace', cursor: 'pointer',
                            }}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {auditResult.we_have && auditResult.we_have.length > 0 && auditResult.we_have.length <= 30 && (
                    <details style={{ marginTop: 6 }}>
                      <summary style={{ fontSize: 10, color: '#6B7A8D', cursor: 'pointer' }}>
                        ✓ {auditResult.we_have.length} matched
                      </summary>
                      <div style={{ marginTop: 4, fontSize: 9.5, color: '#10B981', fontFamily: 'ui-monospace, monospace' }}>
                        {auditResult.we_have.join(', ')}
                      </div>
                    </details>
                  )}
                </>
              )}
            </div>
          )}

          {/* Auto-fill status + Force-included chips */}
          {(autoFillTickers.length > 0 || userForceIncludeForDate.length > 0) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
              {autoFillTickers.length > 0 && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '2px 8px', fontSize: 10, fontWeight: 800,
                  borderRadius: 4, backgroundColor: '#22D3EE15',
                  border: '1px solid #22D3EE40', color: '#22D3EE',
                  letterSpacing: '0.4px',
                }}>
                  🤖 AUTO-DISCOVERED: {autoFillTickers.length}
                </span>
              )}
              {userForceIncludeForDate.length > 0 && (
                <>
                  <span style={{ fontSize: 9.5, color: '#6B7A8D', fontWeight: 700, letterSpacing: '0.4px' }}>
                    MANUALLY ADDED:
                  </span>
                  {userForceIncludeForDate.map((t) => (
                    <span key={t} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '2px 4px 2px 8px', fontSize: 10, fontWeight: 700,
                      borderRadius: 4, backgroundColor: '#10B98118',
                      border: '1px solid #10B98140', color: '#10B981',
                      fontFamily: 'ui-monospace, monospace',
                    }}>
                      {t}
                      <button onClick={() => removeForceInclude(t)} title="Remove"
                        style={{
                          background: 'none', border: 'none', color: '#10B981',
                          cursor: 'pointer', padding: '0 4px', fontSize: 12, lineHeight: 1,
                        }}>×</button>
                    </span>
                  ))}
                </>
              )}
            </div>
          )}

          {/* Refresh feedback now rendered inline next to the Refresh button (0189) */}

          {probeResult && (
            <div style={{
              marginTop: 4, padding: '10px 12px',
              backgroundColor: '#0D1623', border: '1px solid #1A2840', borderRadius: 6,
              fontSize: 11, color: '#C9D4E0', lineHeight: 1.5,
            }}>
              {probeResult.error ? (
                <span style={{ color: '#EF4444' }}>⚠ {probeResult.error}</span>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                    <div style={{
                      flex: 1,
                      fontSize: 11.5, fontWeight: 800,
                      color: probeResult.diagnosis?.startsWith('✓') ? '#10B981' :
                             probeResult.diagnosis?.startsWith('⚠') ? '#F59E0B' : '#EF4444',
                    }}>
                      {probeResult.diagnosis}
                    </div>
                    {/* One-click force-include when Layer 1 dropped it but enrichment has data */}
                    {!probeResult.layers?.graded?.found && probeResult.ticker && (
                      <button
                        onClick={() => {
                          addForceInclude(probeResult.ticker);
                          setProbeResult(null);
                          setProbeTicker('');
                        }}
                        style={{
                          padding: '4px 10px', borderRadius: 6,
                          border: '1px solid #10B98160',
                          backgroundColor: '#10B98115',
                          color: '#10B981', fontSize: 10.5, fontWeight: 800,
                          cursor: 'pointer', whiteSpace: 'nowrap',
                        }}
                      >
                        + Force-include {probeResult.ticker}
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                    <div style={{ padding: '6px 8px', backgroundColor: '#0A1422', borderRadius: 4, borderLeft: `3px solid ${probeResult.layers?.universe?.found ? '#10B981' : '#EF4444'}` }}>
                      <div style={{ fontSize: 9.5, color: '#6B7A8D', fontWeight: 700, letterSpacing: '0.4px' }}>L1 · UNIVERSE</div>
                      <div style={{ fontSize: 10.5, marginTop: 2 }}>
                        {probeResult.layers?.universe?.found ? (
                          <span style={{ color: '#10B981' }}>
                            ✓ Found{probeResult.layers.universe.exact === false ? ` (date ${probeResult.layers.universe.resultDate})` : ''}
                          </span>
                        ) : (
                          <span style={{ color: '#EF4444' }}>
                            ✗ Not in /api/market/earnings (NSE/BSE feeds for {probeResult.date?.slice(0, 7)} have {probeResult.layers?.universe?.totalInMonth ?? '?'} companies)
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ padding: '6px 8px', backgroundColor: '#0A1422', borderRadius: 4, borderLeft: `3px solid ${probeResult.layers?.enrichment?.found && probeResult.layers?.enrichment?.sales_yoy_pct != null ? '#10B981' : '#F59E0B'}` }}>
                      <div style={{ fontSize: 9.5, color: '#6B7A8D', fontWeight: 700, letterSpacing: '0.4px' }}>L2 · ENRICHMENT</div>
                      <div style={{ fontSize: 10.5, marginTop: 2 }}>
                        {probeResult.layers?.enrichment?.found && probeResult.layers?.enrichment?.sales_yoy_pct != null ? (
                          <span style={{ color: '#10B981' }}>
                            ✓ Rev {probeResult.layers.enrichment.sales_yoy_pct >= 0 ? '+' : ''}{Math.round(probeResult.layers.enrichment.sales_yoy_pct)}% · PAT {probeResult.layers.enrichment.pat_yoy_pct >= 0 ? '+' : ''}{Math.round(probeResult.layers.enrichment.pat_yoy_pct)}% · EPS {probeResult.layers.enrichment.eps_yoy_pct >= 0 ? '+' : ''}{Math.round(probeResult.layers.enrichment.eps_yoy_pct)}%
                          </span>
                        ) : (
                          <span style={{ color: '#F59E0B' }}>
                            ⚠ Screener/NSE financials missing
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ padding: '6px 8px', backgroundColor: '#0A1422', borderRadius: 4, borderLeft: `3px solid ${probeResult.layers?.graded?.found ? '#10B981' : '#EF4444'}` }}>
                      <div style={{ fontSize: 9.5, color: '#6B7A8D', fontWeight: 700, letterSpacing: '0.4px' }}>L3 · GRADED</div>
                      <div style={{ fontSize: 10.5, marginTop: 2 }}>
                        {probeResult.layers?.graded?.found ? (
                          <span style={{ color: '#10B981' }}>
                            ✓ {probeResult.layers.graded.tier} · score {probeResult.layers.graded.score}
                          </span>
                        ) : (
                          <span style={{ color: '#EF4444' }}>
                            ✗ Not in graded payload ({probeResult.layers?.graded?.total ?? 0} cards on this date)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Tab toggle ──────────────────────────────────────────────────── */}
      <div style={{ padding: '10px 24px', borderBottom: '1px solid #1A2540', backgroundColor: '#0A1422', display: 'flex', gap: 6 }}>
        <button onClick={() => setViewMode('CALENDAR')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 6, border: `1px solid ${viewMode === 'CALENDAR' ? '#22D3EE60' : '#1E2D45'}`, backgroundColor: viewMode === 'CALENDAR' ? '#22D3EE15' : 'transparent', color: viewMode === 'CALENDAR' ? '#22D3EE' : '#8A95A3', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          <Grid3X3 style={{ width: 12, height: 12 }} /> Calendar
        </button>
        <button onClick={() => setViewMode('GRADED')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 6, border: `1px solid ${viewMode === 'GRADED' ? '#22D3EE60' : '#1E2D45'}`, backgroundColor: viewMode === 'GRADED' ? '#22D3EE15' : 'transparent', color: viewMode === 'GRADED' ? '#22D3EE' : '#8A95A3', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          <FileText style={{ width: 12, height: 12 }} /> Graded Tiers
        </button>
        <span style={{ marginLeft: 'auto', fontSize: 10.5, color: '#6B7A8D', alignSelf: 'center' }}>
          {viewMode === 'CALENDAR' ? `${calRange.from} → ${calRange.to} · ${calData?.total ?? 0} filings` : `${view.candidates_total} graded`}
        </span>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '18px 24px',
        display: 'flex', flexDirection: 'column', gap: 14,
        opacity: isStaleView ? 0.5 : 1,
        transition: 'opacity 0.2s',
        pointerEvents: isStaleView ? 'none' : 'auto',
      }}>
        {viewMode === 'CALENDAR' && (
          <CalendarView data={calData} loading={calLoading} from={calRange.from} to={calRange.to} onPickDate={(d) => { setFilterDate(d); setViewMode('GRADED'); }} />
        )}
        {viewMode === 'GRADED' && isLoading && view.candidates_total === 0 && (
          <div style={{ color: '#6B7A8D', fontSize: 13, padding: 40, textAlign: 'center' }}>Fetching live results from BSE/NSE + 12 Indian results feeds…</div>
        )}
        {viewMode === 'GRADED' && error && (
          <div style={{ color: '#EF4444', fontSize: 13, padding: 40, textAlign: 'center', backgroundColor: '#0D1623', border: '1px solid #EF444440', borderRadius: 10 }}>
            Error fetching earnings pipeline. Retry in a moment.
          </div>
        )}
        {viewMode === 'GRADED' && !isLoading && view.candidates_total === 0 && !error && (() => {
          // PATCH 0152.2 / PATCH 0495 / PATCH 0497 — when picked date has
          // nothing, surface the busiest of the past 14 days as one-click jumps.
          //
          // 0497: hub.results was stale (Apr 30 cutoff when EarningsPulse had
          // 47-100 daily filings May 15-18). Now probe the graded endpoint
          // directly via the recentPopulatedDates state which is populated by
          // the effect below. That state reflects live-NSE-augmented graded
          // data, not the stale hub.
          const todayIso = new Date().toISOString().slice(0, 10);
          // Fallback: merge hub-results count (for older dates) with the
          // live-probed graded counts (for recent dates).
          const cutoffDate = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
          const byDate: Record<string, number> = {};
          for (const r of (hub?.results || [])) {
            if (!r.resultDate || r.resultDate > todayIso || r.quality === 'Upcoming') continue;
            if (r.resultDate < cutoffDate) continue;
            byDate[r.resultDate] = (byDate[r.resultDate] || 0) + 1;
          }
          // Layer the recently-probed graded counts on top (these are
          // authoritative — they actually counted graded cards).
          for (const [d, count] of Object.entries(recentPopulatedDates || {})) {
            if (count > (byDate[d] || 0)) byDate[d] = count;
          }
          // Rank: filings count desc, then date desc (more recent first as tie-breaker)
          const rankedDates = Object.entries(byDate)
            .sort(([dA, cA], [dB, cB]) => cB - cA || (dB > dA ? 1 : -1))
            .slice(0, 3);
          const lastScraped = (hub as any)?.scraped_at ? new Date((hub as any).scraped_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : null;
          const fmtDate = (d: string) => {
            const dt = new Date(d);
            const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getUTCDay()];
            return `${dow} ${dt.getUTCDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][dt.getUTCMonth()]}`;
          };
          return (
            <div style={{ color: '#94A3B8', fontSize: 13, padding: '36px 28px', textAlign: 'center', backgroundColor: '#0D1623', border: '1px solid #1A2840', borderRadius: 10 }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>📭</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#E6EDF3', marginBottom: 4 }}>
                No earnings filings for {filingDateLabel}
              </div>
              <div style={{ fontSize: 12, color: '#6B7A8D', marginBottom: 14, lineHeight: 1.5 }}>
                NSE + BSE corporate-actions pipeline polled. No Q4 results announced for this date.
                {lastScraped && <><br/><span style={{ fontSize: 10.5, color: '#4A5B6C' }}>📡 Calendar last refreshed: <strong style={{ color: '#94A3B8' }}>{lastScraped}</strong></span></>}
              </div>
              {rankedDates.length > 0 && (
                <>
                  <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 8, fontWeight: 700, letterSpacing: '0.3px' }}>
                    📅 BUSIEST RECENT DATES
                  </div>
                  <div style={{ marginTop: 4, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
                    {rankedDates.map(([d, count], i) => (
                      <button key={d} onClick={() => setFilterDate(d)} style={{
                        padding: '8px 14px', borderRadius: 6,
                        border: `1px solid ${i === 0 ? '#10B98180' : '#22D3EE40'}`,
                        backgroundColor: i === 0 ? '#10B98115' : '#22D3EE08',
                        color: i === 0 ? '#10B981' : '#22D3EE',
                        fontSize: 12, fontWeight: 700, cursor: 'pointer',
                      }}>
                        → {fmtDate(d)} <span style={{ color: i === 0 ? '#10B98199' : '#22D3EE99', fontWeight: 500 }}>({count} filings)</span>
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                    {/* PATCH 0496 — Force NSE/BSE re-scan for this specific date.
                        User feedback: 'companies DO file weekends in earnings season'.
                        Hub may not have polled this date yet. This bypasses all caches
                        and hits the upstream pipelines directly. */}
                    {resolvedDateForGrading && (
                      <button
                        onClick={async () => {
                          try {
                            const d = resolvedDateForGrading;
                            // Bypass KV graded cache + force refresh from upstream
                            await fetch(`/api/v1/earnings/graded?date=${d}&force=1&refreshMissing=1`, { cache: 'no-store' });
                            // Force NSE today-live scan
                            await fetch(`/api/v1/earnings/today-live?date=${d}&force=1`, { cache: 'no-store' });
                            // Force NSE corp-announcements re-pull
                            await fetch(`/api/v1/earnings/nse-announcements?date=${d}&force=1`, { cache: 'no-store' });
                            // Wipe local cache + refetch
                            try { localStorage.removeItem('mc:graded:v9:' + d); localStorage.removeItem('mc:graded:v8:' + d); } catch {}
                            refetch();
                            refetchHub();
                          } catch {}
                        }}
                        style={{
                          padding: '8px 16px', borderRadius: 6,
                          border: '1px solid #10B981', backgroundColor: '#10B98115',
                          color: '#10B981', fontSize: 12, fontWeight: 800, cursor: 'pointer',
                          letterSpacing: '0.3px',
                        }}
                      >
                        🔄 FORCE NSE/BSE RE-SCAN THIS DATE
                      </button>
                    )}
                    <button onClick={() => setFilterDate('')} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #1A2840', backgroundColor: 'transparent', color: '#8A95A3', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                      Auto-pick latest
                    </button>
                    <a href="https://www.nseindia.com/companies-listing/corporate-filings-financial-results" target="_blank" rel="noopener noreferrer" style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #F59E0B40', backgroundColor: '#F59E0B10', color: '#F59E0B', fontSize: 11, fontWeight: 700, textDecoration: 'none', cursor: 'pointer' }}>
                      NSE Filings →
                    </a>
                  </div>
                  <div style={{ marginTop: 10, fontSize: 10.5, color: '#F59E0B', fontStyle: 'italic' }}>
                    💡 Companies DO file on weekends during peak earnings season. Hit ‘Force re-scan’ if you believe this date should have filings — bypasses all caches and re-polls NSE+BSE directly.
                  </div>
                </>
              )}
            </div>
          );
        })()}
        {viewMode === 'GRADED' && TIER_ORDER.map((tier) => {
          const stocks = view.by_tier[tier] || [];
          if (stocks.length === 0) return null;
          const meta = TIER_META[tier];
          const isOpen = expanded[tier];
          return (
            <div key={tier} style={{ backgroundColor: '#0D1623', border: '1px solid #1A2540', borderLeft: `4px solid ${meta.color}`, borderRadius: 12 }}>
              <button onClick={() => setExpanded((s) => ({ ...s, [tier]: !s[tier] }))}
                style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', color: 'inherit' }}>
                {isOpen ? <ChevronDown style={{ width: 16, height: 16, color: '#6B7A8D' }} /> : <ChevronRight style={{ width: 16, height: 16, color: '#6B7A8D' }} />}
                <span style={{ fontSize: 16, fontWeight: 800, color: meta.color }}>{meta.icon} {meta.label}</span>
                <span style={{ fontSize: 12, color: '#94A3B8' }}>{stocks.length} {stocks.length === 1 ? 'company' : 'companies'}</span>
                <span style={{ fontSize: 11, color: '#6B7A8D' }}>· {meta.tagline}</span>
              </button>
              {isOpen && (
                <div style={{ padding: '0 18px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 12 }}>
                  {stocks.map((s) => <EarningsCard key={s.ticker + ':' + s.company} stock={s} isFresh={freshTickers.has(s.ticker)} />)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// PATCH 0144 — Pro card matching EarningsPulse layout:
// COMPANY  ·  PE · Q4 · CAP-BUCKET · SECTOR · ☀️/🌙 · ₹PRICE
// [Move %] [Gap %] [D1 %]   (intraday placeholders until price feed wired)
// [Sales YoY %  curr Cr vs prev Cr]   [Net Profit YoY % curr vs prev]   [EPS YoY % curr vs prev]   [Score]
// Brief narrative  ·  methodology pills (✓)  ·  caveat pills (⚠)  ·  Filing link
// ─────────────────────────────────────────────────────────────────────────────
// Format helpers — match EarningsPulse Cr convention ("₹181.1K Cr" / "₹3184 Cr" / "₹4.2 Cr")
function fmtCr(v: number | null | undefined): string | null {
  if (v == null) return null;
  const abs = Math.abs(v);
  if (abs >= 10_000)  return `₹${(v / 1_000).toFixed(1)}K Cr`;  // 181.1K
  if (abs >= 100)     return `₹${Math.round(v)} Cr`;             // 3184
  if (abs >= 10)      return `₹${v.toFixed(1)} Cr`;              // 47.4
  return                     `₹${v.toFixed(2)} Cr`;              // 4.20
}
function fmtPx(v: number | null | undefined): string | null {
  if (v == null) return null;
  return Math.abs(v) >= 100 ? `₹${Math.round(v)}` : `₹${v.toFixed(2)}`;
}
function fmtPct(p: number | null | undefined, digits = 0): string {
  if (p == null) return '—';
  return `${p >= 0 ? '+' : ''}${p.toFixed(digits)}%`;
}

function EarningsCard({ stock, isFresh }: { stock: ParsedEarning; isFresh?: boolean }) {
  const tierColor = TIER_META[stock.tier].color;
  // ☀️ daytime filing (09:15–15:30 IST) vs 🌙 outside-hours
  const timing: '☀️' | '🌙' | null = (() => {
    if (!stock.filing_url) return null;
    // We don't have filing_dt_iso here directly — could be added. Default 🌙 (most filings are AMC).
    return '🌙';
  })();

  return (
    <div style={{
      backgroundColor: '#0A1422',
      border: '1px solid #1A2840',
      borderLeft: `3px solid ${tierColor}`,
      borderRadius: 10,
      padding: '12px 14px',
    }}>
      {/* ── Header: COMPANY + pill row ────────────────────────────────────── */}
      <div style={{ fontSize: 14, fontWeight: 800, color: '#E6EDF3', lineHeight: 1.2, marginBottom: 4 }}>
        {stock.company}
        <span style={{ fontSize: 10, color: '#6B7A8D', fontWeight: 600, marginLeft: 6, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
          {stock.ticker}
        </span>
        {/* PATCH 0362 — NEW badge: card arrived since last auto-refresh */}
        {isFresh && (
          <span title="Filed since your last auto-refresh — under 10 minutes ago"
            style={{
              marginLeft: 8, padding: '1px 7px', borderRadius: 4,
              fontSize: 9, fontWeight: 900, letterSpacing: '0.5px',
              backgroundColor: '#10B981', color: '#0A0E1A',
              animation: 'pulse 1.5s ease-in-out infinite',
            }}>
            ⚡ NEW
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', fontSize: 10.5, marginBottom: 8 }}>
        {stock.pe != null && (
          <span style={{ padding: '1px 6px', borderRadius: 3, backgroundColor: '#0D1623', border: '1px solid #1A2840', color: '#C9D4E0', fontWeight: 700 }}>
            PE {stock.pe.toFixed(1)}
          </span>
        )}
        {stock.quarter && (
          <span style={{ padding: '1px 6px', borderRadius: 3, backgroundColor: '#0D1623', border: '1px solid #1A2840', color: '#94A3B8', fontWeight: 700 }}>
            {stock.quarter}
          </span>
        )}
        {stock.market_cap_bucket && stock.market_cap_bucket !== 'UNKNOWN' && (
          <span style={{ padding: '1px 6px', borderRadius: 3, backgroundColor: '#1E293B', border: '1px solid #334155', color: '#94A3B8', fontWeight: 800, letterSpacing: '0.3px' }}>
            {stock.market_cap_bucket}
          </span>
        )}
        {stock.sector && (
          <span style={{ padding: '1px 6px', borderRadius: 3, backgroundColor: '#0D1623', border: '1px solid #1A2840', color: '#94A3B8' }}>
            {stock.sector}
          </span>
        )}
        {timing && (
          <span style={{ fontSize: 12 }}>{timing}</span>
        )}
        {stock.price != null && (
          <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 800, color: '#E6EDF3' }}>
            {fmtPx(stock.price)}
          </span>
        )}
      </div>

      {/* ── Intraday move + RS + Stage row ────────────────────────────────── */}
      {(stock.gap_pct != null || stock.d1_pct != null || stock.move_pct != null || stock.rs_rating != null || stock.stage != null) && (
        <div style={{ display: 'flex', gap: 10, fontSize: 10, color: '#94A3B8', marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {stock.move_pct != null && (
            <span>Move <strong style={{ color: stock.move_pct >= 0 ? '#10B981' : '#EF4444' }}>{fmtPct(stock.move_pct)}</strong></span>
          )}
          {stock.gap_pct != null && (
            <span>Gap <strong style={{ color: stock.gap_pct >= 0 ? '#10B981' : '#EF4444' }}>{fmtPct(stock.gap_pct)}</strong></span>
          )}
          {stock.d1_pct != null && (
            <span>D1 <strong style={{ color: stock.d1_pct >= 0 ? '#10B981' : '#EF4444' }}>{fmtPct(stock.d1_pct)}</strong></span>
          )}
          {stock.rs_rating != null && (
            <span style={{
              padding: '1px 6px', borderRadius: 3,
              backgroundColor: stock.rs_rating >= 80 ? '#10B98115' : stock.rs_rating >= 50 ? '#F59E0B15' : '#EF444415',
              color:           stock.rs_rating >= 80 ? '#10B981'    : stock.rs_rating >= 50 ? '#F59E0B'    : '#EF4444',
              border: '1px solid currentColor', fontWeight: 700,
            }}>RS {stock.rs_rating}</span>
          )}
          {stock.stage != null && (
            <span style={{
              padding: '1px 6px', borderRadius: 3,
              backgroundColor: stock.stage === 2 ? '#10B98115' : stock.stage === 4 ? '#EF444415' : '#6B7A8D15',
              color:           stock.stage === 2 ? '#10B981'    : stock.stage === 4 ? '#EF4444'    : '#94A3B8',
              border: '1px solid currentColor', fontWeight: 700,
            }}>Stage {stock.stage}</span>
          )}
        </div>
      )}

      {/* ── Three metric tiles + score ────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <MetricTile label="SALES YOY"  pct={stock.sales_yoy_pct}      curr={fmtCr(stock.sales_curr_cr)} prev={fmtCr(stock.sales_prev_cr)} />
        <MetricTile label="NET PROFIT" pct={stock.net_profit_yoy_pct} curr={fmtCr(stock.pat_curr_cr)}   prev={fmtCr(stock.pat_prev_cr)} />
        <MetricTile label="EPS YOY"    pct={stock.eps_yoy_pct}        curr={fmtPx(stock.eps_curr)}     prev={fmtPx(stock.eps_prev)} />
        <div style={{ padding: '6px 10px', backgroundColor: '#0D1623', borderRadius: 6, border: `1px solid ${tierColor}40`, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: 9, color: '#6B7A8D', fontWeight: 700, letterSpacing: '0.6px' }}>SCORE</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: tierColor, lineHeight: 1, marginTop: 2 }}>{stock.composite_score}</div>
        </div>
      </div>

      {/* ── Brief narrative ───────────────────────────────────────────────── */}
      <div style={{ marginTop: 8, fontSize: 11, color: '#C9D4E0', lineHeight: 1.5, fontStyle: 'italic', backgroundColor: '#0D1623', border: '1px solid #1A2840', borderRadius: 6, padding: '6px 9px' }}>
        📝 {stock.narrative}
      </div>

      {/* ── Methodology + caveat pills ────────────────────────────────────── */}
      {(stock.methodology_tags.length > 0 || stock.caveat_tags.length > 0) && (
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {stock.methodology_tags.map((t) => (
            <span key={t} style={{ fontSize: 9.5, padding: '1px 7px', borderRadius: 3, backgroundColor: '#10B98115', color: '#10B981', border: '1px solid #10B98140', fontWeight: 700 }}>✓ {t}</span>
          ))}
          {stock.caveat_tags.map((t) => (
            <span key={t} style={{ fontSize: 9.5, padding: '1px 7px', borderRadius: 3, backgroundColor: '#F59E0B15', color: '#F59E0B', border: '1px solid #F59E0B40', fontWeight: 700 }}>⚠ {t}</span>
          ))}
        </div>
      )}

      {/* ── Filing link ───────────────────────────────────────────────────── */}
      {/* PATCH 0359 — Always render NSE filing URL fresh from ticker. Old
          cached payloads (generated pre-Patch 0358) baked the old
          /get-quotes/equity URL into stock.filing_url which redirects to
          a generic quote page, not the financial-results filings page.
          Generating at render time means stale caches don't poison the link. */}
      <div style={{ marginTop: 8, paddingTop: 7, borderTop: '1px solid #1A2840' }}>
        <a
          href={`https://www.nseindia.com/companies-listing/corporate-filings-financial-results?symbol=${encodeURIComponent(stock.ticker)}`}
          target="_blank" rel="noopener noreferrer"
          title="Open NSE financial-results filings filter for this ticker"
          style={{ fontSize: 10, color: '#22D3EE', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <ExternalLink style={{ width: 10, height: 10 }} /> 📄 NSE Filings · {stock.ticker}
        </a>
        {' '}
        <a
          href={`https://www.bseindia.com/corporates/ann.html?scrip=${encodeURIComponent(stock.ticker)}`}
          target="_blank" rel="noopener noreferrer"
          title="Open BSE corporate announcements filter for this ticker"
          style={{ fontSize: 10, color: '#94A3B8', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 10 }}>
          <ExternalLink style={{ width: 10, height: 10 }} /> 📄 BSE
        </a>
      </div>
    </div>
  );
}

// ─── CalendarView ───────────────────────────────────────────────────────────
function CalendarView({ data, loading, from, to, onPickDate }: { data: CalendarPayload | undefined; loading: boolean; from: string; to: string; onPickDate: (d: string) => void }) {
  // PATCH 0154 — per-date expand-all toggle
  const [expandedDates, setExpandedDates] = useState<Record<string, boolean>>({});

  // Build all dates in [from, to] range (inclusive)
  const dates = useMemo(() => {
    const out: string[] = [];
    const start = new Date(from);
    const end = new Date(to);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }, [from, to]);

  if (loading && !data) {
    // PATCH 0253 — Calendar loads from localStorage instantly when cached
    // (which is the typical case after first visit). Reaching this state
    // means no cache exists yet; show a more honest message + skeleton.
    return (
      <div style={{ color: '#6B7A8D', fontSize: 13, padding: 40, textAlign: 'center' }}>
        <div style={{ marginBottom: 8 }}>Fetching the earnings calendar for the first time…</div>
        <div style={{ fontSize: 11, color: '#4A5B6C' }}>
          This is a one-time fetch per month. Subsequent visits hit cache instantly.
        </div>
      </div>
    );
  }
  if (data?.empty_reason === 'scraper_has_not_run_yet') {
    return (
      <div style={{ color: '#94A3B8', fontSize: 13, padding: 30, backgroundColor: '#0D1623', border: '1px solid #F59E0B40', borderRadius: 10 }}>
        <div style={{ fontSize: 24, marginBottom: 10 }}>⏳</div>
        <strong style={{ color: '#F59E0B' }}>Scraper has not run yet.</strong>
        <p style={{ marginTop: 8, lineHeight: 1.6 }}>
          The NSE Earnings Calendar GitHub Action needs to run at least once to populate the KV cache. Either:
        </p>
        <ol style={{ marginTop: 6, paddingLeft: 22, lineHeight: 1.7, fontSize: 12 }}>
          <li>Wait for the next 30-minute cron tick (runs 03:00–13:00 UTC on weekdays)</li>
          <li>Trigger manually: GitHub repo → Actions → "NSE Earnings Calendar Scrape" → Run workflow</li>
        </ol>
        <p style={{ marginTop: 8, fontSize: 11, color: '#6B7A8D' }}>
          Make sure these GitHub repo secrets are set: <code>UPSTASH_REDIS_REST_URL</code>, <code>UPSTASH_REDIS_REST_TOKEN</code>.
        </p>
      </div>
    );
  }

  const byDate = data?.by_date || {};
  return (
    <div style={{ backgroundColor: '#0D1623', border: '1px solid #1A2540', borderRadius: 10, padding: '14px 18px' }}>
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#E6EDF3', letterSpacing: '0.4px' }}>📅 NSE EARNINGS CALENDAR</h2>
        <span style={{ fontSize: 11, color: '#6B7A8D' }}>{from} → {to} · {Object.values(byDate).reduce((a, b) => a + b.length, 0)} filings</span>
        {data?.scraped_at && (
          <span style={{ marginLeft: 'auto', fontSize: 10, color: '#6B7A8D' }}>scraped {new Date(data.scraped_at).toLocaleString('en-IN')}</span>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
        {dates.map((d) => {
          const items = byDate[d] || [];
          const dt = new Date(d);
          const weekday = dt.toLocaleDateString('en-IN', { weekday: 'short' });
          const dayLabel = dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
          const isToday = d === new Date().toISOString().slice(0, 10);
          return (
            <div key={d} onClick={() => items.length > 0 && onPickDate(d)}
              style={{
                padding: '10px 12px',
                backgroundColor: '#0A1422',
                border: `1px solid ${isToday ? '#22D3EE40' : '#1A2840'}`,
                borderRadius: 8,
                cursor: items.length > 0 ? 'pointer' : 'default',
                opacity: items.length === 0 ? 0.5 : 1,
              }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: isToday ? '#22D3EE' : '#94A3B8' }}>
                  {weekday} {dayLabel}
                </span>
                {items.length > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#F59E0B' }}>{items.length}</span>
                )}
              </div>
              <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {items.length === 0 ? (
                  <span style={{ fontSize: 10.5, color: '#6B7A8D' }}>No filings</span>
                ) : (expandedDates[d] ? items : items.slice(0, 12)).map((it) => (
                  <a key={it.symbol} href={it.source_url} target="_blank" rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    title={`${it.company} · ${it.quarter || ''}`}
                    style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, backgroundColor: '#0F7ABF15', color: '#38A9E8', border: '1px solid #0F7ABF40', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', textDecoration: 'none', fontWeight: 700 }}>
                    {it.symbol}
                  </a>
                ))}
                {items.length > 12 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedDates((s) => ({ ...s, [d]: !s[d] }));
                    }}
                    style={{ fontSize: 10, color: '#22D3EE', background: 'transparent', border: '1px solid #22D3EE40', padding: '1px 6px', borderRadius: 3, cursor: 'pointer', fontWeight: 700 }}>
                    {expandedDates[d] ? '− show less' : `+${items.length - 12} more`}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MetricTile({ label, pct, curr, prev }: { label: string; pct: number | null; curr: string | null; prev: string | null }) {
  const color = pct == null ? '#6B7A8D' : pct >= 0 ? '#10B981' : '#EF4444';
  const pctLabel = pct == null ? '—' : `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`;
  return (
    <div style={{ padding: '8px 10px', backgroundColor: '#0D1623', borderRadius: 6, border: '1px solid #1A2840' }}>
      <div style={{ fontSize: 9.5, color: '#6B7A8D', fontWeight: 700, letterSpacing: '0.6px' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 900, color, marginTop: 2, lineHeight: 1 }}>{pctLabel}</div>
      {(curr || prev) && (
        <div style={{ fontSize: 10, color: '#6B7A8D', marginTop: 2, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
          {curr || '—'}{prev && ` vs ${prev}`}
        </div>
      )}
    </div>
  );
}

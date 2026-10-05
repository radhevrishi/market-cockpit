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

import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Calendar as CalendarIcon, ExternalLink, RefreshCw, ChevronDown, ChevronRight, Grid3X3, FileText } from 'lucide-react';
import api from '@/lib/api';
// PATCH 0186 — Auto-sync BLOCKBUSTER/STRONG cards into Conviction Beats pipeline
import { syncFromEarningsOps, type ConvictionTier } from '@/lib/conviction-beats';
// zzz276 — Institutional-style typeahead search (Asian → Asian Paints / Asian Energy / …)
import EarningsSearch, { type EarningsSearchResult } from './EarningsSearch';
import { hiddenNote } from '@/lib/earnings-search';
// PATCH 0545 — AUDIT #95 debounced LS writes for the hot graded payload writer.
// getItemSync is race-aware: if a write is still queued within the 250ms idle
// window, the read returns the pending value instead of the stale LS string.
import { debouncedSetItem, getItemSync } from '@/lib/debounced-storage';
import { CAVEAT_PENALTY, CAVEAT_PENALTY_DEFAULT, marginQualityDelta, decideTier, marketReactionDelta, thinFloatGate, quadrantForIndiaRow, QUADRANT_META, profitTrajectory, MARKET_REACTION_CAVEATS, type EarningsQuadrant } from '@/lib/earnings-grade-shared';
// PATCH 0557 — BUG-AUDIT-2: backend-degraded banner.
import DegradedBanner from '@/components/DegradedBanner';
import { useCardBadges, CardBadgesToggle } from '@/components/card-badges';
import { SummaryView, CommentaryScoreBlock } from '@/components/us-earnings-card';
import { scoreReleaseCommentary } from '@/lib/earnings/commentary-score';
import { classifyGradedRow, ABFG_META, type AbfgPattern } from '@/lib/earnings/pattern-abfg';
// PATCH 0715 — centralized IST helpers.
import { istToday as _istToday, isIndianMarketOpen as isIndianMarketOpenLocal } from '@/lib/market-hours';
import { gradeIndiaRow as gradeRow } from '@/lib/india-grade';
// zzz814 — multi-day window (1d … 60d), as on the US page.
import {
  IN_WINDOWS, parseWindowParam, parseWindowViewParam, withWindowParams, rowsByTier,
  sortByDate, sortByTier, windowCsv, tradingViewList, fmtShortDate, freshestFirst,
  type WindowView, type WindowRow,
} from '@/lib/india-earnings-window';
// zzz817 — tier chips as filters, per-day MIXED/AVOID expanders, filter-aware
// dedupe, and the count of everything that could not be shown.
import {
  dedupeWindowEntries, parseTierParam, withTierParam, toggleTier, passesTier, countByTier,
  dayGroups, windowIssues, windowTotals, shownElsewhereByDate, hasNoFinancialData,
  dropReasonWithCheck,
  type WindowTier,
} from '@/lib/india-earnings-window';
// zzz818 — the one-click BLOCKBUSTER + STRONG chip and the empty-state line.
import { isTopTiersSel, toggleTopTiers, topTiersCount, tierEmptyMessage } from '@/lib/india-earnings-window';
import { useIndiaEarningsWindow } from './useIndiaEarningsWindow';
// zzz820 — what a card may honestly show (quarter label, year-ago base, margin
// for lenders / "0.0%" unknowns, words instead of 0–100 numbers).
import {
  checkQuarterLabel, growthView, marginView, axisWord, driftWord, partWord, notRecordedNote, narrativeForDisplay,
  prepareDisplayPayload, yearAgoUnverified, stripGradeInputForStorage, UNCONFIRMED_LABEL,
  // zzz822 — round 2: entities, liquidity, one size-band table, cash tile, cap reason once.
  capReasonOf, caveatTagsForDisplay, liquidityView, decodeEntities, capBucket, capInBand, CAP_BUCKETS, cashTileView,
  type CashTileView,
  type MarginView,
} from '@/lib/india-eo-card-data';
import { GRADED_CACHE_VERSION } from '@/lib/graded-cache-key';

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
  ingested_dates?: string[];
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
  ingested_dates?: string[];
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

// AUDIT_100 #10 — strict YYYY-MM-DD shape before lexical compare.
// Lexical `<` is only safe for canonical zero-padded ISO. Any source that
// emits `2026-5-9` (single-digit month/day) sorts wrong and silently drops
// or misplaces filings. Reject malformed dates instead of letting them slip.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Build the same { by_date, total } shape the Calendar view expects.
function buildCalendarFromHub(hub: MarketEarningsResponse | undefined, fromIso: string, toIso: string): CalendarPayload {
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

type EarningsTier = 'BLOCKBUSTER' | 'STRONG' | 'MIXED' | 'AVOID';

interface ParsedEarning {
  ticker: string;
  company: string;
  sector?: string;
  filing_date: string;
  quarter: string;
  market_cap_bucket?: string;
  market_cap_cr?: number | null;
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
  adtv_cr?: number | null;  // PATCH 1034 — liquidity (median ₹Cr/day)
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
  // ── QUALITY × INFLECTION — the second axis (see @/lib/earnings-grade-shared).
  // Absolute quality and rate of change are different questions and one tier
  // cannot answer both, so every row carries BOTH scores plus the quadrant they
  // define. All optional: a preview-shape card (a filing with no financials yet)
  // has no basis for either score and carries none — the card then renders
  // nothing, never a zero or a placeholder.
  quality_score?: number | null;
  inflection_score?: number | null;
  quadrant?: EarningsQuadrant | null;
  quadrant_parts?: {
    quality: Array<{ label: string; points: number; of: number }>;
    inflection: Array<{ label: string; points: number; of: number }>;
  } | null;
  /** Screener's ROCE % — the strongest quality input, shown on the card. */
  roce?: number | null;
  // zzz694 — the operating margin and the cash ratio were both being read off
  // the row with `as any` because neither was declared here, which is how the
  // cash figure ended up decided the tier while appearing nowhere on the card.
  // The payload has always carried them; only the type was silent.
  opm_pct?: number | null;
  opm_prev_pct?: number | null;
  /** Operating cash flow over reported profit, annual. Below 0.6 raises 'ocf
   *  divergence'; below zero caps the tier at MIXED unconditionally. */
  ocf_to_pat_ratio?: number | null;
  cfo_to_pat_ratio?: number | null;
}

interface OpportunitiesPayload {
  filing_date: string | null;
  candidates_total: number;
  raw_items_total: number;
  by_tier: Record<EarningsTier, ParsedEarning[]>;
  generated_at: string;
  sources_polled: number;
}

// PATCH 1022 — market-cap range matcher (value in ₹ Cr).
// zzz822 — the bands now live in ONE table (CAP_BUCKETS in
// lib/india-eo-card-data), read by this filter AND every card's size label,
// so a card's label always matches the filter that finds it.
function capInRange(cr: number | null | undefined, f: 'all' | 'sweet' | 'mega' | 'large' | 'mid' | 'small' | 'micro'): boolean {
  return capInBand(cr, f);
}

const TIER_META: Record<EarningsTier, { label: string; color: string; icon: string; tagline: string }> = {
  BLOCKBUSTER: { label: 'BLOCKBUSTER', color: '#F59E0B', icon: '⭐', tagline: 'Growth + quality aligned across Sales, EBITDA, Net Profit and EPS' },
  STRONG:      { label: 'STRONG',      color: '#10B981', icon: '🟢', tagline: 'Solid beat across most metrics — one or two caveats' },
  MIXED:       { label: 'MIXED',       color: '#FACC15', icon: '🟡', tagline: 'Optical beats — tax distortion, one-time items or methodology conflicts' },
  AVOID:       { label: 'AVOID',       color: '#EF4444', icon: '🔴', tagline: 'Fundamental or technical hard-fails — not long-trade candidates' },
};
const TIER_ORDER: EarningsTier[] = ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID'];

// PATCH 0555 — Client-side dedup for cross-exchange duplicates that slipped
// past the server merge (e.g. same company entering once with NSE ticker
// "DJML" and once with BSE scrip "543193").  The server-side fix in
// /api/market/earnings/route.ts now skips these by normalized company name,
// but cached graded:v8 payloads written before the fix still contain the
// duplicate. This defensive client pass guarantees the UI never renders the
// same company twice. Numeric-only symbols (pure BSE scrip codes) lose to
// alphabetic NSE tickers; otherwise the higher-score / earlier-tier entry
// wins. Scoped per-tier to preserve `by_tier` shape.
function dedupePayloadByCompany<T extends { by_tier?: Record<string, any[]> }>(p: T | undefined | null): T {
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
function istDaysAgoISO(n: number): string {
  const [y, m, d] = _istToday().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}

/** Yesterday in IST (the name predates the fix; kept for its call sites). */
function todayISO(): string {
  return istDaysAgoISO(1);
}

// PATCH 0560 — BUG-AUDIT-5: return today's date in IST (Asia/Kolkata, UTC+5:30).
// PATCH 0715 — body delegated to centralized lib/market-hours.
function todayIstISO(): string {
  return _istToday();
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
// zzz379 — derive the RESULT quarter from a filing date instead of hard-coded 'Q4'
// (August/Q1-FY27 filings were rendering "Q4 results"). Matches the server helper.
function deriveQuarterLabel(filingDate?: string | null): 'Q1'|'Q2'|'Q3'|'Q4' {
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
function useEarningsOpportunitiesJoined(
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
  // PATCH 1017 — ELITE-only / PEAD / MULTIBAGGER filters
  const [eliteOnly, setEliteOnly] = useState(false);
  const [peadOnly, setPeadOnly] = useState(false);
  const [multibaggerOnly, setMultibaggerOnly] = useState(false);
  // zzz703 — A/B/F/G pattern filter. Independent of the tier filters above:
  // the tier says how good the quarter was, the pattern says what KIND it was,
  // and combining them ("show me the A-pattern MIXED prints") is the point.
  const [patternOnly, setPatternOnly] = useState<AbfgPattern | null>(null);
  // QUALITY × INFLECTION — isolate the highest-variance quadrant. These are the
  // rows a single tier label buries: low proven quality, exceptional rate of
  // change. Filtering across ALL tiers (not just the top two) is the point —
  // most of them sit in MIXED, which is exactly why they were invisible.
  const [turnaroundOnly, setTurnaroundOnly] = useState(false);
  // Transformation-radar overlay (concall-intel screener) — badge + filter, and
  // "Beat + Cheap" valuation filter (good grade AND trailing PE not expensive).
  type RadarEntry = { symbol: string; transformation_score: number; stage_sweet_spot?: any; velocity?: any };
  const [radarMap, setRadarMap] = useState<Map<string, RadarEntry>>(new Map());
  const [radarOnly, setRadarOnly] = useState(false);
  const [beatCheapOnly, setBeatCheapOnly] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/v1/concall-intel/transformation-screener?days=60&limit=24', { cache: 'no-store' });
        if (!res.ok) return;
        const json = await res.json();
        const entries: RadarEntry[] = Array.isArray(json?.entries) ? json.entries : [];
        const m = new Map<string, RadarEntry>();
        for (const e of entries) {
          if (e && typeof e.symbol === 'string' && e.symbol) m.set(e.symbol.toUpperCase(), e);
        }
        if (alive) setRadarMap(m);
      } catch { /* radar overlay is best-effort */ }
    })();
    return () => { alive = false; };
  }, []);
  // PATCH 1022 — market-cap range filter (uses market_cap_cr in ₹ Cr)
  const [capFilter, setCapFilter] = useState<'all' | 'sweet' | 'mega' | 'large' | 'mid' | 'small' | 'micro'>('all');
  // PATCH zzz75 — Always default to ONE day before today (previous weekday,
  // skipping Sat/Sun backward to Fri). User explicitly wants the page to
  // start on yesterday, NOT auto-jump to a dense-earnings calendar date.
  // The walk-back behavior is still available via the "↩ Latest" button
  // which sets filterDate to '' and triggers the original probe.
  // PATCH 0498 (previous): initialized to '' so walk-back fired on load — reverted.
  const [filterDate, setFilterDate] = useState<string>(() => {
    if (typeof window === 'undefined') return '';  // SSR safety
    // PATCH zzz98 — persist filterDate to LS so Hard Refresh keeps the selected date
    // Prefer the user's last-picked date over the yesterday-weekday default,
    // but only when it's a valid YYYY-MM-DD within the last 30 days (so a
    // stale month-old value can't pin the page on an empty calendar).
    try {
      const saved = localStorage.getItem('mc:eo:v12:filterDate');
      if (saved && /^\d{4}-\d{2}-\d{2}$/.test(saved)) {
        const savedMs = new Date(saved + 'T00:00:00Z').getTime();
        const nowMs = Date.now();
        const ageDays = (nowMs - savedMs) / (1000 * 60 * 60 * 24);
        if (Number.isFinite(savedMs) && ageDays >= -1 && ageDays <= 30) {
          return saved;
        }
      }
    } catch {}
    // zzz800 — yesterday in IST, weekend → Friday (UTC day-of-week of an IST
    // calendar date is that date's weekday).
    const y1 = istDaysAgoISO(1);
    const dow = new Date(y1 + 'T00:00:00Z').getUTCDay();
    if (dow === 0) return istDaysAgoISO(3);   // Sun → Fri
    if (dow === 6) return istDaysAgoISO(2);   // Sat → Fri
    return y1;
  });
  // PATCH zzz98 — persist filterDate to LS so Hard Refresh keeps the selected date
  // Mirrors every filterDate change (including the "↩ Latest" clear) so the
  // next mount of this component reads the user's most recent intent.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (filterDate && /^\d{4}-\d{2}-\d{2}$/.test(filterDate)) {
        localStorage.setItem('mc:eo:v12:filterDate', filterDate);
      } else {
        // User clicked "↩ Latest" — clear the saved value so the
        // yesterday-weekday default takes over on the next mount.
        localStorage.removeItem('mc:eo:v12:filterDate');
      }
    } catch {}
  }, [filterDate]);
  // zzz276 — Hash-scroll: when URL has `#eo-card-TICKER` (from the search
  // typeahead), poll for the card element to mount then scroll+pulse-ring.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash;
    if (!hash || !hash.startsWith('#eo-card-')) return;
    const id = hash.slice(1);
    let attempts = 0;
    const maxAttempts = 25;
    const tryScroll = () => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const prev = el.style.boxShadow;
        el.style.boxShadow = '0 0 0 3px var(--mc-cyan), 0 0 24px color-mix(in srgb, var(--mc-cyan) 40%, transparent)';
        el.style.transition = 'box-shadow 0.3s';
        setTimeout(() => { el.style.boxShadow = prev; }, 3000);
        try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch {}
        return;
      }
      if (++attempts < maxAttempts) setTimeout(tryScroll, 200);
    };
    const t = setTimeout(tryScroll, 400);
    return () => clearTimeout(t);
  }, [filterDate]);
  const [showAbout, setShowAbout] = useState(false);
  const [expanded, setExpanded] = useState<Record<EarningsTier, boolean>>({
    BLOCKBUSTER: true, STRONG: true, MIXED: false, AVOID: false,
  });
  // PATCH 0502 — Force re-scan progress state for the always-visible button.
  const [forceRescanning, setForceRescanning] = useState(false);
  // PATCH 0503 — Source coverage telemetry (NSE/BSE/merged counts).
  const [coverageStats, setCoverageStats] = useState<{
    nse: number;
    bse: number;
    total: number;
    source: string;
  } | null>(null);

  // PATCH 0152 — drive everything from the hub source-of-truth.
  // Months to fetch: cover the current filterDate's month + the previous
  // month (so the calendar grid view can show ~6 weeks of history).
  // zzz176 — Also fetch the NEXT month, because the calendar strip
  // (`calRange`) extends +14 days forward from filterDate. When
  // filterDate is late in a month (e.g. Jun 26), the strip crosses into
  // the next month (Jul 1-10). Without the next-month fetch, those
  // forward dates rendered "Data unavailable" because they weren't in
  // any month payload's `ingested_dates`. Fix: also fetch next month
  // so ingested_dates covers the full strip window.
  const monthsToFetch = useMemo(() => {
    const baseDate = filterDate || todayISO();
    const cur = new Date(baseDate);
    const prev = new Date(baseDate); prev.setDate(1); prev.setMonth(prev.getMonth() - 1);
    const next = new Date(baseDate); next.setDate(1); next.setMonth(next.getMonth() + 1);
    // zzz183: also fetch next+1 month so calRange +45 days forward is fully covered
    const next2 = new Date(baseDate); next2.setDate(1); next2.setMonth(next2.getMonth() + 2);
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return Array.from(new Set([fmt(prev), fmt(cur), fmt(next), fmt(next2)]));
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
  // PATCH 0560 — BUG-AUDIT-5: use IST date. The server-side graded endpoint
  // already attributes filings to IST dates, so a UTC-derived "today" string
  // produced 0 cards after ~6:30 PM IST every evening.
  const todayIso = todayIstISO();
  const resolvedDateForGrading = useMemo(() => {
    if (filterDate) return filterDate;
    // PATCH 0763 — weekend-aware default. When today is Sat/Sun IST, auto-
    // walk back to Friday so we don't spin on an empty date. Previously the
    // page defaulted to today, fetched 0, then the calendar walk-back effect
    // kicked in — but Graded Tiers UI was already 'Fetching live results…'
    // on the empty Saturday by the time walk-back fired. Better: walk back
    // here, synchronously.
    const dt = new Date(todayIso + 'T00:00:00Z');
    const dow = dt.getUTCDay();
    if (dow === 0) dt.setUTCDate(dt.getUTCDate() - 2); // Sun → Fri
    else if (dow === 6) dt.setUTCDate(dt.getUTCDate() - 1); // Sat → Fri
    return dt.toISOString().slice(0, 10);
  }, [filterDate, todayIso]);

  // ═══ MULTI-DAY WINDOW  (zzz814) ═════════════════════════════════════════
  // 1d is the page as it always was (one date). 3d…60d = that many IST
  // trading sessions back from the selected date, weekends in between
  // included (Indian companies file on them) — see lib/india-earnings-window.
  // ?w= and ?wv= live in the URL alongside ?q=; read after mount so SSR and
  // the first client render agree.
  const [windowDays, setWindowDays] = useState<number>(1);
  const [windowView, setWindowView] = useState<WindowView>('date');
  const [windowUrlReady, setWindowUrlReady] = useState(false);
  // zzz817 — the tier chips are filters now: multi-select, empty = all tiers,
  // kept in the URL as ?tier=BLOCKBUSTER,STRONG (1d and every window).
  const [tierSel, setTierSel] = useState<WindowTier[]>([]);
  // zzz817 — the By-date days whose MIXED / AVOID are unfolded (each day has
  // its own expander instead of one page-wide collapse).
  const [openWindowDays, setOpenWindowDays] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      setWindowDays(parseWindowParam(sp.get('w')));
      setWindowView(parseWindowViewParam(sp.get('wv')));
      setTierSel(parseTierParam(sp.get('tier')));
    } catch { /* no window */ }
    setWindowUrlReady(true);
  }, []);
  useEffect(() => {
    if (!windowUrlReady) return;
    try {
      const cur = window.location.pathname + window.location.search + window.location.hash;
      const next = withTierParam(withWindowParams(cur, windowDays, windowView), tierSel);
      if (next !== cur) window.history.replaceState(window.history.state, '', next);
    } catch { /* ignore */ }
  }, [windowUrlReady, windowDays, windowView, tierSel]);
  const windowOn = windowDays > 1;
  const win = useIndiaEarningsWindow<ParsedEarning>({
    anchor: resolvedDateForGrading, sessions: windowDays, today: todayIso, enabled: windowOn,
  });
  const windowPayload: OpportunitiesPayload | null = useMemo(() => (windowOn ? {
    filing_date: resolvedDateForGrading || null,
    candidates_total: win.rows.length,
    raw_items_total: win.rows.length,
    by_tier: rowsByTier(win.rows) as unknown as Record<EarningsTier, ParsedEarning[]>,
    generated_at: '',
    sources_polled: 0,
  } : null), [windowOn, win.rows, resolvedDateForGrading]);
  const [windowRenderLimit, setWindowRenderLimit] = useState(120);
  const [tvCopyNote, setTvCopyNote] = useState<string | null>(null);
  useEffect(() => { setWindowRenderLimit(120); }, [windowDays, windowView, resolvedDateForGrading, tierSel]);

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
  const LS_PREFIX = 'mc:graded:v19:';  // zzz800 — v18→v19: loss-base PAT/EPS no longer a growth %, reaction floor, turnaround tier.  // zzz507b derived PAT add quarters_pat; zzz505 — v15->v16 to surface OPM + QoQ trend on newly-listed cards  // zzz503 — v14→v15 to flush snapshots holding the old "prior-year missing" narrative; zzz417 — v13→v14; zzz189 — v12→v13
  if (typeof window !== 'undefined') {
    try {
      // zzz800 — the scrub flag is tied to the CURRENT prefix. The old flag
      // was set once ('v9') and never re-armed, so every later prefix bump left
      // its predecessor's snapshots orphaned in localStorage for ever.
      const SCRUB_GRADED = 'mc:graded-scrub:' + LS_PREFIX;
      if (!localStorage.getItem(SCRUB_GRADED)) {
        for (const k of Object.keys(localStorage)) {
          if (/^mc:graded:v\d+:/.test(k) && !k.startsWith(LS_PREFIX)) localStorage.removeItem(k);
        }
        localStorage.setItem(SCRUB_GRADED, '1');
      }
    } catch {}
  }
  // PATCH 0992 — one-time cleanup: purge all stale v9 entries left from
  // the Railway migration window. Safe to run repeatedly (idempotent flag in LS).
  useEffect(() => {  // PATCH 0995 — fixed from React.useEffect (no default React import in this file)
    if (typeof window === 'undefined') return;
    try {
      const FLAG = 'mc:graded:v9-purged';
      if (localStorage.getItem(FLAG)) return;
      const toDelete: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('mc:graded:v9:') || k.startsWith('mc:graded:v8:'))) {
          toDelete.push(k);
        }
      }
      toDelete.forEach((k) => localStorage.removeItem(k));
      localStorage.setItem(FLAG, String(Date.now()));
      if (toDelete.length > 0) {
        console.log(`[graded] PATCH 0992: purged ${toDelete.length} stale v8/v9 LS entries`);
      }
    } catch {}
  }, []);

  const readLsCache = (date: string): OpportunitiesPayload | undefined => {
    if (!date || typeof window === 'undefined') return undefined;
    try {
      // PATCH 0545 — getItemSync prefers any in-flight pending write so a
      // rapid arrow-click within the 250ms idle window sees the just-written
      // payload, not the stale LS one.
      const raw = getItemSync(LS_PREFIX + date);
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
      // PATCH 0992 — content validation. A cached payload with ZERO entries
      // in every tier AND zero candidates_total is treated as stale because
      // during the Railway migration window the graded endpoint briefly
      // returned empty payloads for dates that genuinely had data. We can't
      // distinguish a "real empty day" (e.g. April 28 holiday) from a
      // "broken cache" reliably from the client, so we err on the side of
      // refetching — server cost is tiny for empty days (KV hit).
      const totalGraded = (parsed?.by_tier?.BLOCKBUSTER?.length || 0)
        + (parsed?.by_tier?.STRONG?.length || 0)
        + (parsed?.by_tier?.MIXED?.length || 0)
        + (parsed?.by_tier?.AVOID?.length || 0);
      const candTotal = parsed?.candidates_total || 0;
      const hadHubFail = !!parsed?._hub_fail;
      if (hadHubFail || (totalGraded === 0 && candTotal === 0)) {
        return undefined;  // force refetch from server
      }
      // zzz417 — reject UNDERCOUNTED snapshots. A payload saved before the
      // day's filings propagated holds far fewer graded cards than the day
      // actually filed (the 1-of-89 bug). Refetch so the now-healed server
      // payload (self-healed by the graded route + prewarm cron) replaces it.
      const rawItems = parsed?.raw_items_total || 0;
      const bestCount = Math.max(totalGraded, candTotal);
      if (rawItems >= 8 && bestCount < 0.6 * rawItems) {
        return undefined;  // undercounted cache — force refetch
      }
      return parsed;
    } catch { return undefined; }
  };
  const writeLsCache = (date: string, data: OpportunitiesPayload) => {
    if (!date || typeof window === 'undefined') return;
    // PATCH 0545 — coalesced via 250ms idle window. Avoids stringify+writeIO
    // on every React Query revalidate when the user is rapid-clicking the
    // date arrows (each click can fire a setData + writeLsCache pair).
    // zzz820b — the grader's stored input (grade_input) is never kept in the browser.
    try { debouncedSetItem(LS_PREFIX + date, JSON.stringify({ ...stripGradeInputForStorage(data), _cachedAt: Date.now() })); } catch {}
  };

  // PATCH 0161/0165/0185 — graded query reads from localStorage initialData
  // so navigation is INSTANT for previously-visited dates, then revalidates
  // from server in background. Past dates are immutable so revalidation is
  // basically a no-op (KV hit). No more 30s waits per click.
  const { data: gradedData, refetch: refetchGraded, isFetching: gradedFetching, error: gradedError } = useQuery<OpportunitiesPayload>({
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
      const yIso = istDaysAgoISO(1);  // zzz800 — IST, was local-day/UTC-date mix
      const isPastDate = resolvedDateForGrading < yIso;
      if (isPastDate) {
        const cached = readLsCache(resolvedDateForGrading);
        if (cached) return dedupePayloadByCompany(cached as OpportunitiesPayload);
      }
      // PATCH 0741 + 0842 + 0968 BUG-D — Client-side timeout.
      // User reported (May 27 2026 evening): 20s timeout firing on TODAY
      // with "Server couldn't build data for 2026-05-27: client_timeout_20s".
      // Today's pipeline is sometimes cold during off-hours (CF Worker idle,
      // NSE archives endpoint slow). 20s is too aggressive; backend warming
      // can take 25-30s. Bumping today/yesterday 20s → 40s. Past dates
      // unchanged at 45s. Total session budget = 45s upstream + 5s slack
      // = stays well under any sane upper bound.
      const ctrl = new AbortController();
      const timeoutMs = isPastDate ? 45_000 : 40_000;
      const clientTimeout = setTimeout(() => ctrl.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetch(`/api/v1/earnings/graded?date=${resolvedDateForGrading}`, {
          cache: 'no-store',
          signal: ctrl.signal,
        });
      } catch (e: any) {
        clearTimeout(clientTimeout);
        if (e?.name === 'AbortError') {
          const err: any = new Error(`Pipeline taking longer than ${timeoutMs / 1000}s. NSE/BSE upstream may be degraded — retry in a moment.`);
          err.status = 0;
          err.detail = `client_timeout_${timeoutMs / 1000}s`;
          err.dateAttempted = resolvedDateForGrading;
          throw err;
        }
        throw e;
      }
      clearTimeout(clientTimeout);
      // PATCH 0736 — surface server timeout/error explicitly so the UI can
      // show a banner instead of silently falling back to placeholderData
      // (the previous query's payload — which appears on screen as "same
      // data as yesterday/4 days ago"). Includes the upstream status code
      // and body excerpt so the banner can be specific.
      if (!res.ok) {
        let detail = '';
        try { const j = await res.json(); detail = j?.error || j?.message || ''; } catch {}
        const err: any = new Error(detail || `graded fetch failed (HTTP ${res.status})`);
        err.status = res.status;
        err.detail = detail;
        err.dateAttempted = resolvedDateForGrading;
        throw err;
      }
      const payload = dedupePayloadByCompany(await res.json());
      // PATCH 0736 — tag payload with the date it was actually built for, so
      // the UI can detect mismatches between displayed-data-date and
      // currently-selected-date (the "same data on every date" symptom).
      (payload as any)._builtForDate = resolvedDateForGrading;
      writeLsCache(resolvedDateForGrading, payload);
      return payload;
    },
    // PATCH 0362 — Past dates: 7-day stale (immutable). Today: 3 min so
    // any small action (click Refresh, tab focus) gets a fresh fetch.
    // PATCH 0447 — Bumped past-date staleTime to 30 days (effectively
    // permanent for the session). Past dates are immutable; revalidation
    // is pure noise.
    // PATCH 0646 — REVERSE 0447. Past dates are NOT truly immutable — the
    // Vercel cron backfills missing filings hours later. User opening
    // yesterday's earnings was seeing the localStorage-cached payload
    // forever, never picking up backfills. Fix:
    //   * past-date staleTime 30d -> 60 min (still cached for fast hover,
    //     but background-refetches once per hour)
    //   * refetchOnMount: ALWAYS true (navigating to the page always
    //     triggers a background re-fetch; localStorage initialData
    //     keeps the UI populated during the refetch)
    //   * refetchOnWindowFocus: ALWAYS true (tab returning to focus
    //     re-checks for backfill)
    staleTime: resolvedDateForGrading < todayIso ? 60 * 60_000 : 3 * 60_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: true,
    // PATCH 0362 — Auto-poll every 4 minutes when viewing today's date,
    // ONLY during Indian market hours (9 AM - 4 PM IST). This is the
    // key fix for 'always late' — user no longer has to manually refresh
    // to catch freshly-filed results.
    // PATCH 0646 — also poll past dates within last 3 trading days every
    // 10 min (backfill catch-up). Older than that, no poll (truly cold).
    refetchInterval: () => {
      const now = new Date();
      const istHours = (now.getUTCHours() + 5.5) % 24;
      const inMarketHours = istHours >= 9 && istHours <= 17;
      if (resolvedDateForGrading === todayIso) {
        return inMarketHours ? 4 * 60_000 : false;
      }
      // Past date — check if it's within last 3 days
      const daysOld = (Date.parse(todayIso) - Date.parse(resolvedDateForGrading)) / (1000 * 60 * 60 * 24);
      if (daysOld > 0 && daysOld <= 3) return 10 * 60_000;
      return false;
    },
    placeholderData: (prev: any, prevQuery: any) => prevQuery?.queryKey?.[1] === resolvedDateForGrading ? prev : undefined, // PATCH zzz86 — same-date scope only  // keep showing previous date while next loads
    // Hydrate from localStorage so the screen never goes blank on navigation
    initialData: () => readLsCache(resolvedDateForGrading),
    // AUDIT_100 #6 / PATCH 0550 — when initialData returns a value, the
    // paired initialDataUpdatedAt MUST also return a number. Returning
    // undefined here while initialData returned an object makes React Query
    // treat the cache as "fresh forever" and skip the refetch loop. Default
    // to 0 (force-stale) when `_cachedAt` is missing so the freshness path
    // re-runs as expected.
    initialDataUpdatedAt: () => {
      const cached = readLsCache(resolvedDateForGrading);
      if (!cached) return undefined;
      const t = (cached as any)._cachedAt;
      return typeof t === 'number' ? t : 0;
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
    // zzz66 — Off-season smart-default: instead of walking 7 days (which
    // misses dense filing dates 2-4 weeks back during off-season — May 21-Jun 23
    // gap), first probe the calendar for "most recent date with ≥10 filings"
    // by fetching the current month + previous month. If that finds a dense
    // date, jump there immediately. Falls back to the day-by-day graded walk.
    autoWalkProbingRef.current = true;
    (async () => {
      // STEP A — calendar-based jump to most recent dense date (zzz66)
      try {
        const start = new Date(resolvedDateForGrading);
        const fmtMonth = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const months: string[] = [fmtMonth(start)];
        const prev = new Date(start); prev.setDate(1); prev.setMonth(prev.getMonth() - 1);
        months.push(fmtMonth(prev));
        const prev2 = new Date(start); prev2.setDate(1); prev2.setMonth(prev2.getMonth() - 2);
        months.push(fmtMonth(prev2));
        for (const m of months) {
          const res = await fetch(`/api/v1/earnings/calendar?month=${m}`, { cache: 'no-store' });
          if (!res.ok) continue;
          const payload = await res.json();
          const byDate: Record<string, unknown[]> = payload?.by_date || {};
          // Sort dates descending, pick first with ≥10 items
          const denseDates = Object.entries(byDate)
            .filter(([_, items]) => Array.isArray(items) && items.length >= 10)
            .map(([d]) => d)
            .sort()
            .reverse();
          if (denseDates.length > 0) {
            const targetDate = denseDates[0];
            // Don't jump FORWARD past today's resolved date — defensive guard
            if (targetDate <= resolvedDateForGrading) {
              autoJumpedRef.current = true;
              autoWalkProbingRef.current = false;
              setFilterDate(targetDate);
              return;
            }
          }
        }
      } catch {}

      // STEP B — fallback: original 7-day graded probe (kept for in-season
      // when calendar walk-back is overkill; finds even sparse filings).
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

  // PATCH 0503 — Populate source coverage stats by probing /today-live.
  // Fires every time the resolved date changes. Probe is cached server-side
  // (3min TTL) so this is cheap.
  useEffect(() => {
    if (!resolvedDateForGrading) {
      setCoverageStats(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/v1/earnings/today-live?date=${resolvedDateForGrading}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setCoverageStats({
          nse: typeof data?.nse_count === 'number' ? data.nse_count : 0,
          bse: typeof data?.bse_count === 'number' ? data.bse_count : 0,
          total: typeof data?.count === 'number' ? data.count : 0,
          source: data?.source || 'UNKNOWN',
        });
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [resolvedDateForGrading, forceRescanning]);

  // PATCH 0505 — Auto-fire Force Re-scan when a recent date loads empty.
  // User mandate: "no error in future in this tab". If we see 0 cards on
  // a date within last 14 days AND the today-live source telemetry shows
  // 0 from both NSE and BSE, fire a force=1 round-trip once. This catches
  // the case where the KV cache poisoned (e.g. NSE returned BLOCKED at
  // first probe; we want to retry through BSE this time). One-shot per
  // date — won't loop.
  const autoForceFiredRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!resolvedDateForGrading || !gradedData?.by_tier || !coverageStats) return;
    if (autoForceFiredRef.current.has(resolvedDateForGrading)) return;
    const allCards = (TIER_ORDER as EarningsTier[])
      .flatMap((t) => gradedData.by_tier?.[t] || []);
    if (allCards.length > 0) return;
    const ageDays = Math.max(0, Math.floor(
      (new Date(todayIso).getTime() - new Date(resolvedDateForGrading).getTime()) / 86_400_000
    ));
    if (ageDays > 14) return;
    // Only fire when coverage telemetry shows we genuinely have no data —
    // not when sources returned filings but graded dropped them all (which
    // would mean a parser/grading problem, not a coverage one).
    if (coverageStats.total > 0) return;
    autoForceFiredRef.current.add(resolvedDateForGrading);
    (async () => {
      try {
        await Promise.allSettled([
          fetch(`/api/v1/earnings/today-live?date=${resolvedDateForGrading}&force=1`, { cache: 'no-store' }),
          fetch(`/api/v1/earnings/graded?date=${resolvedDateForGrading}&force=1`, { cache: 'no-store' }),
        ]);
        await Promise.all([refetchHub(), refetchGraded()]);
      } catch {}
    })();
  }, [resolvedDateForGrading, gradedData, coverageStats, todayIso, refetchHub, refetchGraded]);

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
      const todayIsoLocal = _istToday();  // zzz800 — was the UTC date (yesterday before 05:30 IST)
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
    const yIso = istDaysAgoISO(1);  // zzz800 — IST, was local-day/UTC-date mix
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

  // PATCH 1027 — HEAVY-DAY AUTO-CONVERGE.
  // A peak earnings day can have 140-260 filings, but a single enrich pass
  // only fills ~half (Screener/NSE are rate-limited, so the synchronous graded
  // build can't fetch them all in one window). Previously the user had to keep
  // clicking "Refresh N missing" by hand. This loop chips away automatically:
  // every 45s it re-enriches just the still-missing cards, bounded to 8 rounds,
  // and STOPS the moment a round adds nothing (those tickers genuinely have no
  // upstream data) — so it converges a busy day to full coverage on its own
  // without hammering. Scoped to today + yesterday (the actively-filing dates);
  // older dates stay on the manual "Refresh N missing" / Slow Backfill path.
  const convergeRef = useRef<{ date: string; rounds: number; lastMissing: number }>({ date: '', rounds: 0, lastMissing: -1 });
  useEffect(() => {
    if (!gradedData?.by_tier || !resolvedDateForGrading) return;
    const yIso = istDaysAgoISO(1);  // zzz800 — IST, was local-day/UTC-date mix
    if (resolvedDateForGrading !== todayIso && resolvedDateForGrading !== yIso) return;
    const allCards = (TIER_ORDER as EarningsTier[])
      .flatMap((t) => gradedData.by_tier?.[t] || []) as ParsedEarning[];
    if (allCards.length < 20) return;  // only worth it on heavy days
    // zzz415 — same convergent criterion as the Refresh button (see below):
    // absolute-only cards (YoY impossible — no year-ago quarter) must not be
    // counted as forever-missing, or this auto-converge loop reads "no
    // progress" every round and bails while real gaps remain.
    const missing = allCards.filter((c) => {
      const noYoY = c.sales_yoy_pct == null && c.net_profit_yoy_pct == null && c.eps_yoy_pct == null;
      const noAbs = c.sales_curr_cr == null && c.pat_curr_cr == null && (c as any).eps_curr == null;
      const opmCur = (c as any).opm_pct, opmPrev = (c as any).opm_prev_pct, salesCur = (c as any).sales_curr_cr;
      const opmStaleZero = (opmCur === 0 || opmPrev === 0) && salesCur != null && Number(salesCur) >= 100;
      const noMargin = (opmCur == null && opmPrev == null) || opmStaleZero;
      return (noYoY && noAbs) || noMargin;
    }).length;

    // Reset per-date counters when the viewed date changes.
    if (convergeRef.current.date !== resolvedDateForGrading) {
      convergeRef.current = { date: resolvedDateForGrading, rounds: 0, lastMissing: -1 };
    }
    const s = convergeRef.current;

    if (missing === 0) return;                                   // fully enriched
    if (s.rounds >= 8) return;                                   // safety cap
    if (s.lastMissing !== -1 && missing >= s.lastMissing) return; // last round made no progress → upstream blocked

    const id = setTimeout(async () => {
      s.rounds += 1;
      s.lastMissing = missing;  // snapshot pre-round count for the next progress check
      try {
        await fetch(`/api/v1/earnings/graded?date=${resolvedDateForGrading}&refreshMissing=1&force=1`, { cache: 'no-store' });
        await refetchGraded();
      } catch {}
    }, 45_000);
    return () => clearTimeout(id);
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
            localStorage.removeItem('mc:graded:v10:' + iso);  // PATCH 0992
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
        localStorage.removeItem('mc:graded:v10:' + resolvedDateForGrading);  // PATCH 0992
        localStorage.removeItem('mc:graded:v9:' + resolvedDateForGrading);
        localStorage.removeItem('mc:graded:v8:' + resolvedDateForGrading);
        localStorage.removeItem('mc:hub:v3:' + monthKeys);
        localStorage.removeItem('mc:hub:v2:' + monthKeys);
      } catch {}
      // Hit force=1 server-side to rebuild graded payload from a fresh hub fetch
      const res = await fetch(`/api/v1/earnings/graded?date=${resolvedDateForGrading}&force=1`, { cache: 'no-store' });
      let payload: any = null;
      try { payload = await res.json(); } catch {}
      // zzz236 — chase with refreshMissing=1 so zzz235's stale-OPM refill runs
      // on cards whose OPM was previously stuck at 0 (Worker pre-zzz234 NBFC/
      // bank quirk). force=1 alone rebuilds from KV but the hub-cached rows
      // still carry opm=0; only refreshMissing=1 re-enriches per ticker and
      // merges the fresh margin. Same date as force call so both operate on
      // the same KV entry.
      try {
        await fetch(`/api/v1/earnings/graded?date=${resolvedDateForGrading}&refreshMissing=1`, { cache: 'no-store' });
      } catch {}
      // Then refetch via React Query so the UI picks up the new data
      await Promise.all([refetchHub(), refetchGraded()]);
      // zzz190: removed the "auto-jump to latest with filings" fallback.
      // If the user explicitly clicked Hard Refresh on a specific date, respect
      // that choice — don't yank them to another date. If the date is genuinely
      // empty they'll see the empty state and can navigate manually.
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
  // PATCH 0999 — Slow Backfill: client-side queue, 80 days × 90s pacing.
  type SlowBfState = {
    queue: string[];        // remaining dates (newest-first since Patch 1025)
    done: string[];         // completed dates
    failed: string[];       // dates that errored out (we keep going)
    startedAt: number;      // ms epoch when we kicked off
    intervalMs: number;     // pace between requests (90_000 default)
    running: boolean;
  };
  const SLOW_BF_KEY = 'mc:slow-backfill:v1';
  const [slowBf, setSlowBf] = useState<SlowBfState | null>(() => {
    if (typeof window === 'undefined') return null;
    try { return JSON.parse(localStorage.getItem(SLOW_BF_KEY) || 'null'); } catch { return null; }
  });
  const slowBfPersist = (s: SlowBfState | null) => {
    setSlowBf(s);
    if (typeof window === 'undefined') return;
    try {
      if (s) localStorage.setItem(SLOW_BF_KEY, JSON.stringify(s));
      else localStorage.removeItem(SLOW_BF_KEY);
    } catch {}
  };
  // Worker loop. Runs every intervalMs while running=true.
  useEffect(() => {
    if (!slowBf?.running || slowBf.queue.length === 0) {
      if (slowBf?.running && slowBf.queue.length === 0) {
        // All done — log + clear after a beat so progress chip shows ✓
        const t = setTimeout(() => slowBfPersist(null), 8_000);
        return () => clearTimeout(t);
      }
      return;
    }
    const tick = async () => {
      if (!slowBf?.running) return;
      const next = slowBf.queue[0];
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 75_000);
        const res = await fetch(`/api/v1/earnings/graded?date=${next}&force=1&refreshMissing=1`, {
          cache: 'no-store',
          signal: ctrl.signal,
        });
        clearTimeout(to);
        const ok = res.ok;
        slowBfPersist({
          ...slowBf,
          queue: slowBf.queue.slice(1),
          done: ok ? [...slowBf.done, next] : slowBf.done,
          failed: ok ? slowBf.failed : [...slowBf.failed, next],
        });
      } catch {
        slowBfPersist({
          ...slowBf,
          queue: slowBf.queue.slice(1),
          failed: [...slowBf.failed, next],
        });
      }
    };
    const id = setTimeout(tick, slowBf.intervalMs);
    return () => clearTimeout(id);
  }, [slowBf]);  // eslint-disable-line react-hooks/exhaustive-deps

  const startSlowBackfill = (days = 80) => {
    // PATCH 1025 — NEWEST-FIRST ordering. Build weekdays walking back from
    // yesterday and DO NOT reverse, so the queue is [yesterday, day-before, …].
    // Previously this reversed to oldest-first, so a 60-80 day backfill spent
    // its first ~45 min on pre-earnings-season dates (Feb/Mar) that have ZERO
    // filings — the user saw "backfilling 2026-03-23", navigated there, found
    // nothing, and reasonably concluded it was broken. Newest-first warms the
    // recent, data-rich dates the user actually opens FIRST; any empty old
    // dates fall to the tail where they're harmless (and skippable via Stop).
    const dates: string[] = [];
    const cursor = new Date();
    cursor.setUTCDate(cursor.getUTCDate() - 1);  // start at yesterday
    while (dates.length < days) {
      const dow = cursor.getUTCDay();
      if (dow !== 0 && dow !== 6) {
        dates.push(cursor.toISOString().slice(0, 10));
      }
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    // (no reverse — queue stays newest-first)
    slowBfPersist({
      queue: dates,
      done: [],
      failed: [],
      startedAt: Date.now(),
      intervalMs: 90_000,
      running: true,
    });
  };
  const stopSlowBackfill = () => {
    if (slowBf) slowBfPersist({ ...slowBf, running: false });
    setTimeout(() => slowBfPersist(null), 4_000);
  };
  const slowBfProgressLabel = (() => {
    if (!slowBf) return null;
    const total = slowBf.queue.length + slowBf.done.length + slowBf.failed.length;
    const completed = slowBf.done.length + slowBf.failed.length;
    if (slowBf.queue.length === 0) {
      return `✓ Slow backfill done — ${slowBf.done.length} succeeded, ${slowBf.failed.length} failed`;
    }
    const remainingMs = slowBf.queue.length * slowBf.intervalMs;
    const h = Math.floor(remainingMs / 3600_000);
    const m = Math.round((remainingMs % 3600_000) / 60_000);
    const eta = h > 0 ? `${h}h ${m}m` : `${m}m`;
    return `🌙 ${completed}/${total} · next ${slowBf.queue[0]} · ETA ${eta}`;
  })();

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
      // PATCH 0515 — Auto-force-include when L1 (universe) missing but L2
      // (enrichment) has real data. This is the Kwality Pharma pattern:
      // NSE/BSE feeds dropped the ticker but Screener has full Q-data.
      // Save the user a click — auto-inject the ticker into the page.
      const ticker = probeTicker.trim().toUpperCase();
      const l1Missing = j?.l1_universe?.found === false;
      const l2HasData = !!(j?.l2_enrichment?.found && j?.l2_enrichment?.data && (
        j.l2_enrichment.data.sales_yoy_pct != null ||
        j.l2_enrichment.data.pat_yoy_pct != null ||
        j.l2_enrichment.data.eps_yoy_pct != null
      ));
      if (l1Missing && l2HasData && ticker && resolvedDateForGrading) {
        const cur = forceIncludeMap[resolvedDateForGrading] || [];
        if (!cur.map((t) => t.toUpperCase()).includes(ticker)) {
          addForceInclude(ticker);
        }
      }
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
    // zzz814 — in a window, the bench is fed from the window's merged rows
    // (one per company, its LATEST result), so every BLOCKBUSTER/STRONG in the
    // window reaches Conviction Beats, and an older STRONG a company has since
    // replaced with a weaker print is not re-added.
    const syncSource = windowPayload || data;
    if (!syncSource?.by_tier) return;
    // USER-REQ — Guidance in Conviction tab. Derive a Positive/Neutral/Negative
    // label + signed score per card using the same lexicon the Earnings Hub
    // Scan tab uses. Server `guidance` field is preferred when present (it
    // currently isn't, but kept for forward compatibility). Otherwise we scan
    // whatever text fields the card carries (narrative_text / guidance_text /
    // announcement_text / narrative) for positive vs negative cues.
    const POS = [
      /capacity expansion/i, /order book/i, /record (?:quarter|order|revenue|book)/i,
      /margin expansion/i, /operating leverage/i, /commission(?:ed|ing)?/i,
      /capex/i, /demand recovery/i, /broad[- ]based/i, /tailwind/i, /confident/i,
      /guidance rais/i, /upgrade(?:d)? guidance/i, /outlook strong/i,
      /demand strong/i, /strong demand/i, /raised guidance/i,
      /(?:vadod|new plant|new line|brownfield|greenfield)/i,
    ];
    const NEG = [
      /margin pressure/i, /demand weak/i, /weak demand/i, /soft demand/i,
      /slowdown/i, /headwind/i, /guidance cut/i, /lowered guidance/i,
      /cut guidance/i, /downgrade(?:d)?/i, /miss(?:ed)?/i, /shortfall/i,
      /below expectation/i, /below estimate/i, /outlook (?:weak|cautious|soft)/i,
    ];
    // PATCH 0925 — YoY-metric fallback for guidance derivation.
    // User report: every BLOCKBUSTER row on the bench showed "➖ Neutral"
    // even with Sales +300% PAT +1000% EPS +500%. Cause: the previous
    // implementation only scanned narrative text for positive/negative
    // keywords. Recent filings publish without narrative_text populated,
    // so text scan returned (0,0) → defaulted to Neutral.
    // Fix order:
    //   1. Trust explicit server guidance field (current/future).
    //   2. If text yields a clear positive/negative signal, use it.
    //   3. Else derive from Sales/PAT/EPS YoY using institutional gates.
    const deriveGuidance = (card: any): { label: 'Positive' | 'Neutral' | 'Negative'; score: number } => {
      if (card?.guidance === 'Positive' || card?.guidance === 'Neutral' || card?.guidance === 'Negative') {
        const s = typeof card.guidance_score === 'number' ? card.guidance_score
                : typeof card.sentimentScore === 'number' ? card.sentimentScore
                : (card.guidance === 'Positive' ? 0.5 : card.guidance === 'Negative' ? -0.5 : 0);
        return { label: card.guidance, score: s };
      }
      const text = [
        card?.narrative_text, card?.guidance_text, card?.announcement_text,
        card?.attachment, card?.headline, card?.title, card?.narrative,
      ].filter(Boolean).join(' ');
      if (text) {
        const pos = POS.filter((p) => p.test(text)).length;
        const neg = NEG.filter((p) => p.test(text)).length;
        const total = pos + neg;
        if (total > 0) {
          const score = (pos - neg) / total;
          const label: 'Positive' | 'Neutral' | 'Negative' =
            score >= 0.3 ? 'Positive' : score <= -0.3 ? 'Negative' : 'Neutral';
          return { label, score };
        }
      }
      // PATCH 0925 — fall back to YoY metric gates.
      const sales = card?.sales_yoy_pct ?? 0;
      const pat = card?.pat_yoy_pct ?? card?.net_profit_yoy_pct ?? 0;
      const eps = card?.eps_yoy_pct ?? 0;
      // Negative gates first (in priority order)
      if (pat < 0) return { label: 'Negative', score: -0.5 };
      if (sales > 30 && pat < sales * 0.6) return { label: 'Negative', score: -0.4 };  // margin compression
      // PATCH 0925 — dilution gate only fires when EPS is genuinely weak.
      // Suppress when EPS already grew ≥ 50% (no real dilution concern even
      // if PAT grew faster — e.g. EYANTRA Sales+224 PAT+1404 EPS+398).
      if (pat > 0 && eps < pat * 0.4 && eps < 50) return { label: 'Negative', score: -0.3 };
      // Positive gates — op-leverage AND quality
      if (pat >= 40 && pat > sales * 1.2 && eps >= 25) return { label: 'Positive', score: 0.5 };
      // Secondary Positive — strong growth across all 3 metrics even without
      // sharp op-leverage. PATCH 0925 — institutional threshold relaxation
      // so a 30/20/20 print still reads Positive rather than getting buried.
      if (pat >= 30 && sales >= 20 && eps >= 20) return { label: 'Positive', score: 0.4 };
      return { label: 'Neutral', score: 0 };
    };
    const entries: Array<{
      ticker: string; company: string; tier: ConvictionTier;
      composite_score: number;
      sales_yoy_pct: number | null; net_profit_yoy_pct: number | null; eps_yoy_pct: number | null;
      filing_date: string; sector?: string; market_cap_bucket?: string; market_cap_cr?: number | null; source_url?: string;
      guidance?: 'Positive' | 'Neutral' | 'Negative'; guidance_score?: number;
      // PATCH 0945/0947 — fields required by ConvictionEntry; populate at sync.
      quarter?: 'Q1' | 'Q2' | 'Q3' | 'Q4';
      fiscal_year?: number;
      d1_pct?: number | null;
      gap_pct?: number | null;
      // zzz223 — OPM margin fields for the CB tab
      opm_pct?: number | null;
      opm_prev_pct?: number | null;
      // PATCH 1018 — institutional quality flags carried to the CB bench
      is_elite?: boolean;
      pead_score?: number | null;
      multibagger_setup?: boolean;
      // QUALITY × INFLECTION — carried onto the bench so a benched row keeps its
      // second axis across a refresh instead of silently losing it (the same
      // omission class as the OPM / CFO-ratio fields above).
      quality_score?: number | null;
      inflection_score?: number | null;
      quadrant?: string | null;
      // Pre-existing gap: both were already being SENT (zzz242 / zzz314) but
      // never declared here, so the object literal failed its excess-property
      // check. Declared now that neighbouring fields are being added.
      pe?: number | null;
      cfo_to_pat_ratio?: number | null;
    }> = [];
    for (const tier of ['BLOCKBUSTER', 'STRONG'] as const) {
      for (const c of (syncSource.by_tier[tier] || [])) {
        // zzz820b — never bench a top tier built on unverified growth.
        if ((c as any)._tier_unconfirmed || yearAgoUnverified(c)) continue;
        const g = deriveGuidance(c);
        // PATCH 0911 — Parse the graded payload's "quarter" string (e.g.
        // "Q4 FY26" or "Q1 FY27" or just "Q4") into explicit fields so the
        // bench filter doesn't have to GUESS from filing_date later. Works
        // for the next 10 years regardless of calendar rollover.
        let qParsed: 'Q1' | 'Q2' | 'Q3' | 'Q4' | undefined;
        let fyParsed: number | undefined;
        if (typeof c.quarter === 'string') {
          const qm = c.quarter.match(/Q([1-4])/i);
          if (qm) qParsed = ('Q' + qm[1]) as 'Q1' | 'Q2' | 'Q3' | 'Q4';
          const fm = c.quarter.match(/FY\s?(\d{2})(?:\d{2})?/i);
          if (fm) {
            // Expand 2-digit to 4-digit (FY26 → 2026); assume 21st century
            // through 2099. After 2099 the heuristic switches centuries.
            const yy = parseInt(fm[1], 10);
            fyParsed = yy < 50 ? 2000 + yy : 1900 + yy;
          }
        }
        entries.push({
          ticker: c.ticker, company: c.company, tier,
          composite_score: c.composite_score,
          sales_yoy_pct: c.sales_yoy_pct, net_profit_yoy_pct: c.net_profit_yoy_pct, eps_yoy_pct: c.eps_yoy_pct,
          filing_date: c.filing_date, sector: c.sector, market_cap_bucket: c.market_cap_bucket,
          market_cap_cr: (c as any).market_cap_cr ?? null,
          source_url: c.filing_url,
          // USER-REQ — Guidance in Conviction tab
          guidance: g.label, guidance_score: g.score,
          // PATCH 0911 — explicit quarter + fy from graded payload
          ...(qParsed ? { quarter: qParsed } : {}),
          ...(fyParsed ? { fiscal_year: fyParsed } : {}),
          // PATCH 0945 — D1 close + gap so CB tab can render and filter
          d1_pct: typeof (c as any).d1_pct === 'number' ? (c as any).d1_pct : null,
          gap_pct: typeof (c as any).gap_pct === 'number' ? (c as any).gap_pct : null,
          // PATCH 1018 — carry institutional quality flags so CB tab can filter
          is_elite: (c as any).is_elite === true,
          pead_score: typeof (c as any).pead_score === 'number' ? (c as any).pead_score : null,
          multibagger_setup: (c as any).multibagger_setup === true,
          // QUALITY × INFLECTION — null when the grader could not score the row.
          quality_score: typeof (c as any).quality_score === 'number' ? (c as any).quality_score : null,
          inflection_score: typeof (c as any).inflection_score === 'number' ? (c as any).inflection_score : null,
          quadrant: typeof (c as any).quadrant === 'string' ? (c as any).quadrant : null,
          // zzz223 — OPM margin for the CB tab (latest + prior-year %)
          opm_pct: typeof (c as any).opm_pct === 'number' ? (c as any).opm_pct : null,
          opm_prev_pct: typeof (c as any).opm_prev_pct === 'number' ? (c as any).opm_prev_pct : null,
          // zzz242 — carry trailing P/E for valuation chip on CB card
          pe: typeof (c as any).pe === 'number' ? (c as any).pe : (typeof (c as any).stockPE === 'number' ? (c as any).stockPE : null),
          // zzz314 — carry CFO/PAT ratio (earnings quality) so the chip surfaces
          // on CB cards. Accept both aliases returned by the graded route.
          cfo_to_pat_ratio: typeof (c as any).cfo_to_pat_ratio === 'number' ? (c as any).cfo_to_pat_ratio : (typeof (c as any).ocf_to_pat_ratio === 'number' ? (c as any).ocf_to_pat_ratio : null),
        });
      }
    }
    if (entries.length > 0) syncFromEarningsOps(entries);
  }, [data, windowPayload]);

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
      const symbolsCsv = forceIncludeForDate.map(encodeURIComponent).join(',');  // zzz800 — '&' in tickers
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
            filing_date: resolvedDateForGrading, quarter: e.quarter || deriveQuarterLabel(resolvedDateForGrading),
            market_cap_bucket: e.market_cap_bucket || null,
            market_cap_cr: e.market_cap_cr ?? null,
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
          quarter: e.quarter || deriveQuarterLabel(resolvedDateForGrading), sector: e.sector,
          market_cap_bucket: e.market_cap_bucket,
          market_cap_cr: e.market_cap_cr ?? null,
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
          } else if (ageDays === 0) {
            // PATCH 0506 — honest messaging. The 60s/5min auto-retry ONLY
            // fires for today's date (see below). Past dates were getting
            // the same misleading "Re-checking automatically..." copy even
            // though no auto-retry was happening.
            setRefreshFeedback(`⚠ ${stamp} · 0/${total} updated — NSE/BSE/Screener haven't published Q-data yet for ${tickerListFromServer()}. Auto-rechecking at 60s + 5min.`);
          } else if (ageDays >= 1 && ageDays <= 7) {
            setRefreshFeedback(`⚠ ${stamp} · 0/${total} updated for ${tickerListFromServer()}. Screener.in's Cloudflare temporarily blocked these tickers from our server. NSE/BSE filings are in our KV — they'll enrich next time Screener accepts our request. Move on for now.`);
          } else if (ageDays >= 8) {
            setRefreshFeedback(`⚠ ${stamp} · 0/${total} updated — past-date sources rarely backfill. Use Coverage Probe ↓ for individual tickers, or move to a fresher date.`);
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

  // zzz183: extend forward window from +14 to +45 days so users see further-out filings
  // Calendar view: last 28 days back, next 45 forward — built from hub data
  const calRange = useMemo(() => {
    const d = new Date(filterDate || todayISO());
    const from = new Date(d); from.setDate(from.getDate() - 28);
    const to   = new Date(d); to.setDate(to.getDate() + 45);
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
  // zzz820b — top-tier rows built on unverified growth are held out of
  // BLOCKBUSTER / STRONG for every count, chip, export and the bench.
  const viewMerged: OpportunitiesPayload = useMemo(() => {
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
  const view: OpportunitiesPayload = useMemo(() => prepareDisplayPayload(viewMerged), [viewMerged]);

  // zzz814 — what the counts, filter chips, search and exports read: the
  // single date as before, or the merged window (one row per company).
  const activeView: OpportunitiesPayload = windowPayload || view;

  // The page's filters as ONE function, used by the single-date tiers and the
  // window alike. Only one quality filter applies at a time (the chips are
  // mutually exclusive), then market cap, then the A/B/F/G pattern — the same
  // order as before, so a single date renders exactly as it did.
  const applyRowFilters = <T extends ParsedEarning>(input: T[]): T[] => {
    let stocks = input;
    if (eliteOnly) stocks = stocks.filter((s: any) => s.is_elite);
    else if (peadOnly) stocks = stocks.filter((s: any) => (s.pead_score ?? 0) >= 70);
    else if (multibaggerOnly) stocks = stocks.filter((s: any) => s.multibagger_setup);
    // QUALITY × INFLECTION — sort the survivors by inflection so the fastest
    // rate of change leads; within this quadrant that IS the ranking.
    else if (turnaroundOnly) stocks = stocks
      .filter((s: any) => s.quadrant === 'TURNAROUND ACCELERATOR')
      .slice()
      .sort((a: any, b: any) => (b.inflection_score ?? 0) - (a.inflection_score ?? 0));
    else if (radarOnly) stocks = stocks.filter((s: any) => radarMap.has(String(s.ticker || '').toUpperCase()));
    else if (beatCheapOnly) {
      stocks = stocks
        .filter((s: any) => typeof s.pe === 'number' && s.pe > 0 && s.pe <= 35)
        .slice()
        .sort((a: any, b: any) => (a.pe ?? 0) - (b.pe ?? 0));
    }
    // PATCH 1022 — market-cap range filter (₹ Cr)
    if (capFilter !== 'all') stocks = stocks.filter((s: any) => capInRange(s.market_cap_cr, capFilter));
    // zzz703 — pattern filter, applied last so it composes with the rest.
    if (patternOnly) stocks = stocks.filter((s: any) => classifyGradedRow(s)?.pattern === patternOnly);
    return stocks;
  };
  const anyRowFilter = eliteOnly || peadOnly || multibaggerOnly || turnaroundOnly || radarOnly || beatCheapOnly || capFilter !== 'all' || !!patternOnly;
  /** Within one tier, the order the active filter implies — else FRESHEST
   *  FIRST (zzz815, the owner's default): latest filing time on top, a card
   *  with only a date goes last within that date. */
  const withinTierOrder = (a: any, b: any): number =>
    turnaroundOnly ? (b.inflection_score ?? 0) - (a.inflection_score ?? 0)
      : beatCheapOnly ? (a.pe ?? 0) - (b.pe ?? 0)
      : freshestFirst(a, b);
  // zzz817 — the window: the filters run on EVERY result in the window, then
  // one row per company among what passed. (Before, the latest result was
  // picked first and filtered after, so a company whose newest entry failed a
  // filter vanished even when an older result in the window passed.)
  const windowFiltered: WindowRow<ParsedEarning>[] = useMemo(() => {
    if (!windowOn) return [];
    if (!anyRowFilter) return win.rows;
    const passSet = new Set<any>(applyRowFilters(win.entries as unknown as ParsedEarning[]));
    return dedupeWindowEntries(win.entries, (e) => passSet.has(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowOn, win.entries, win.rows, anyRowFilter, eliteOnly, peadOnly, multibaggerOnly, turnaroundOnly, radarOnly, beatCheapOnly, capFilter, patternOnly, radarMap]);
  /** zzz817 — the tier chips' counts, with every OTHER filter applied, so a
   *  chip always says how many cards clicking it shows. */
  const tierChipCounts: Record<EarningsTier, number> = windowOn
    ? countByTier(windowFiltered)
    : (Object.fromEntries(TIER_ORDER.map((t) => [t, applyRowFilters(view.by_tier[t] || []).length])) as Record<EarningsTier, number>);
  const tierFilterOn = tierSel.length > 0;
  /** Every row that passes the filters (tier chips included), tier order — what the exports hand out. */
  const exportRows = (): any[] => {
    if (windowOn) return sortByDate(windowFiltered.filter((r) => passesTier(r, tierSel)), withinTierOrder).flatMap((g) => g.rows);
    return TIER_ORDER.filter((t) => passesTier({ tier: t }, tierSel))
      .flatMap((t) => applyRowFilters((activeView.by_tier[t] || []) as ParsedEarning[]).slice().sort(withinTierOrder));
  };

  // ═══ SEARCH  (zzz812) ═══════════════════════════════════════════════════
  // Every graded row on the loaded date, filters ignored — the search looks
  // here first. A match the filters hide is reported with the reason and can
  // be PINNED: shown in its tier despite the filters, with a note saying so.
  // zzz814 — in a window, every company in the window (its latest result).
  const searchWindowRows = useMemo(
    () => TIER_ORDER.flatMap((t) => activeView.by_tier[t] || []),
    [activeView],
  );
  const searchHiddenReasons = useCallback((s: any): string[] => {
    const out: string[] = [];
    // Mirrors the else-if chain in the tier render below — only ONE of these
    // quality filters is ever applied at a time.
    if (eliteOnly) { if (!s.is_elite) out.push('ELITE only'); }
    else if (peadOnly) { if ((s.pead_score ?? 0) < 70) out.push('PEAD ≥ 70'); }
    else if (multibaggerOnly) { if (!s.multibagger_setup) out.push('multibagger setup'); }
    else if (turnaroundOnly) { if (s.quadrant !== 'TURNAROUND ACCELERATOR') out.push('turnaround quadrant'); }
    else if (radarOnly) { if (!radarMap.has(String(s.ticker || '').toUpperCase())) out.push('transformation radar'); }
    else if (beatCheapOnly) { if (!(typeof s.pe === 'number' && s.pe > 0 && s.pe <= 35)) out.push('Beat + Cheap (PE ≤ 35)'); }
    if (capFilter !== 'all' && !capInRange(s.market_cap_cr, capFilter)) out.push(`cap filter: ${capFilter}`);
    if (patternOnly && classifyGradedRow(s)?.pattern !== patternOnly) out.push(`pattern ${patternOnly}`);
    // zzz817 — the tier chips filter too.
    if (tierSel.length > 0 && !passesTier(s, tierSel)) out.push(`tier filter: ${tierSel.join(' + ')}`);
    const anyFilter = eliteOnly || peadOnly || multibaggerOnly || turnaroundOnly || radarOnly || beatCheapOnly || capFilter !== 'all' || !!patternOnly || tierSel.length > 0;
    if (!anyFilter && s.tier && !expanded[s.tier as EarningsTier]) out.push(`tier ${s.tier} collapsed`);
    if (viewMode !== 'GRADED') out.push('Calendar view open');
    return out;
  }, [eliteOnly, peadOnly, multibaggerOnly, turnaroundOnly, radarOnly, beatCheapOnly, capFilter, patternOnly, radarMap, expanded, viewMode, tierSel]);
  const [searchPin, setSearchPin] = useState<{ ticker: string; nonce: number } | null>(null);
  const pinTicker = useCallback((ticker: string) => {
    setViewMode('GRADED');
    setSearchPin({ ticker: String(ticker).toUpperCase(), nonce: Date.now() });
  }, []);
  // Scroll to the pinned card once it mounts (a date jump may take a while to
  // load, so keep looking for ~12 s), then pulse it.
  useEffect(() => {
    if (!searchPin) return;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tryScroll = () => {
      const el = document.getElementById('eo-card-' + searchPin.ticker);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const prev = el.style.boxShadow;
        el.style.transition = 'box-shadow 0.3s';
        el.style.boxShadow = '0 0 0 3px var(--mc-cyan), 0 0 24px color-mix(in srgb, var(--mc-cyan) 40%, transparent)';
        setTimeout(() => { el.style.boxShadow = prev; }, 3000);
        return;
      }
      if (++attempts < 60) timer = setTimeout(tryScroll, 200);
    };
    timer = setTimeout(tryScroll, 150);
    return () => clearTimeout(timer);
  }, [searchPin]);

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
  // PATCH 0506 — Cap the LOADING badge at 12 seconds. Past dates with cold KV
  // miss can take 20-30s to rebuild on the server side. The user perception
  // was "loading forever". Now: badge dismisses after 12s even if fetch still
  // running. The cards remain visible (from initialData), and a fresh payload
  // arrives whenever the server is done.
  const dateNavTimestampRef = useRef<number>(0);
  useEffect(() => {
    dateNavTimestampRef.current = Date.now();
  }, [resolvedDateForGrading]);
  const [loadingBadgeForceHide, setLoadingBadgeForceHide] = useState(false);
  useEffect(() => {
    setLoadingBadgeForceHide(false);
    const tm = setTimeout(() => setLoadingBadgeForceHide(true), 12_000);
    return () => clearTimeout(tm);
  }, [resolvedDateForGrading]);
  const isStaleView = !windowOn && !loadingBadgeForceHide && gradedFetching &&
    !!view.filing_date &&
    !!resolvedDateForGrading &&
    view.filing_date !== resolvedDateForGrading;

  const counts = TIER_ORDER.map((t) => ({ tier: t, n: tierChipCounts[t] || 0 }));

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
    <div className="mc-flow-mobile" style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--mc-bg-0)' }}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ padding: '20px 24px 14px', borderBottom: '1px solid var(--mc-bg-4)', backgroundColor: 'var(--mc-bg-1)' }}>
        {/* PATCH 0557 — backend-degraded banner. */}
        <DegradedBanner />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--mc-text-1)', margin: 0 }}>Earnings Opportunities</h1>
          {/* PATCH 0915 — Direct link to NSE's official calendar so user can
              verify the universe vs our aggregator. User feedback: hub
              shows 93 filings for the date but NSE's calendar shows 118+. */}
          <a
            href="https://www.nseindia.com/companies-listing/corporate-filings-financial-results"
            target="_blank" rel="noopener noreferrer"
            title="Open NSE's official corporate-filings page in a new tab to verify the full universe of filings for any date"
            style={{ fontSize: 10, padding: '4px 10px', borderRadius: 6, border: '1px solid color-mix(in srgb, var(--mc-text-3) 38%, transparent)', background: 'transparent', color: 'var(--mc-text-3)', fontWeight: 700, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >🔗 NSE official ↗</a>
          <button onClick={async () => {
            // PATCH zzz90 (EO4) — show feedback toast after refresh completes
            const r = await refetch();
            const total = (r?.data as any)?.candidates_total ?? 0;
            const d = resolvedDateForGrading || 'today';
            setRefreshFeedback(total > 0 ? `✓ Refreshed — ${total} filings for ${d}` : `✓ Refreshed — no NSE/BSE filings for ${d}`);
            setTimeout(() => setRefreshFeedback(null), 8000);
          }} disabled={hardRefreshing}
            title="Hard refresh — busts cache, re-fetches NSE/BSE feeds, pulls in newly-filed tickers (works for any date including weekends)"
            style={{
              padding: '4px 10px', borderRadius: 6,
              border: '1px solid color-mix(in srgb, var(--mc-cyan) 38%, transparent)',
              background: hardRefreshing ? 'color-mix(in srgb, var(--mc-cyan) 19%, transparent)' : 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)',
              color: 'var(--mc-cyan)',
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
            style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid color-mix(in srgb, var(--mc-state-persistent) 38%, transparent)', background: backfilling ? 'color-mix(in srgb, var(--mc-state-persistent) 19%, transparent)' : 'color-mix(in srgb, var(--mc-state-persistent) 8%, transparent)', color: 'var(--mc-state-persistent)', fontSize: 11, fontWeight: 700, cursor: backfilling ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, opacity: backfilling ? 0.8 : 1 }}>
            <RefreshCw style={{ width: 11, height: 11, animation: backfilling ? 'spin 0.8s linear infinite' : 'none' }} />
            {backfilling ? 'Backfilling…' : 'Backfill 60d'}
          </button>
          {/* PATCH 0999 — Slow Backfill (80d, ~2h, resumable) */}
          {!slowBf?.running && (
            <button
              onClick={() => startSlowBackfill(80)}
              title="Politely backfills 80 weekdays over ~2 hours. One request every 90s — never trips Screener rate limits. Resumes if you reload."
              style={{
                padding: '4px 10px', borderRadius: 6,
                border: '1px solid #6366F160', background: '#6366F115',
                color: '#A5B4FC', fontSize: 11, fontWeight: 700,
                cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
              }}>
              🌙 Slow Backfill (80d · 2h)
            </button>
          )}
          {/* PATCH 1003 — 60d variant of Slow Backfill */}
          {!slowBf?.running && (
            <button
              onClick={() => startSlowBackfill(60)}
              title="Politely backfills 60 weekdays over ~90 minutes. One request every 90s — never trips Screener rate limits."
              style={{
                padding: '4px 10px', borderRadius: 6,
                border: '1px solid #6366F140', background: '#6366F108',
                color: '#A5B4FC', fontSize: 11, fontWeight: 700,
                cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
              }}>
              🌙 Slow Backfill (60d · 1.5h)
            </button>
          )}{/* PATCH 1004 — restored missing </button> closing tag */}
          {slowBf?.running && (
            <button
              onClick={stopSlowBackfill}
              title="Stop the slow backfill. Already-done dates stay cached."
              style={{
                padding: '4px 10px', borderRadius: 6,
                border: '1px solid color-mix(in srgb, var(--mc-bearish) 38%, transparent)', background: 'color-mix(in srgb, var(--mc-bearish) 8%, transparent)',
                color: '#FCA5A5', fontSize: 11, fontWeight: 700, cursor: 'pointer',
              }}>
              ⏹ Stop Slow Backfill
            </button>
          )}
          {slowBfProgressLabel && (
            <span style={{
              fontSize: 10.5, fontWeight: 700,
              padding: '3px 8px', borderRadius: 4,
              backgroundColor: slowBfProgressLabel.startsWith('✓') ? 'color-mix(in srgb, var(--mc-bullish) 9%, transparent)' : '#6366F118',
              border: `1px solid ${slowBfProgressLabel.startsWith('✓') ? 'color-mix(in srgb, var(--mc-bullish) 25%, transparent)' : '#6366F140'}`,
              color: slowBfProgressLabel.startsWith('✓') ? 'var(--mc-bullish)' : '#A5B4FC',
              maxWidth: 420, lineHeight: 1.3,
            }}>
              {slowBfProgressLabel}
            </span>
          )}
          {backfillProgress && (
            <span style={{
              fontSize: 10.5, fontWeight: 700,
              padding: '3px 8px', borderRadius: 4,
              backgroundColor: backfillProgress.startsWith('✓') ? 'color-mix(in srgb, var(--mc-bullish) 9%, transparent)' : backfillProgress.startsWith('⚠') ? 'color-mix(in srgb, var(--mc-bearish) 9%, transparent)' : 'color-mix(in srgb, var(--mc-state-persistent) 9%, transparent)',
              border: `1px solid ${backfillProgress.startsWith('✓') ? 'color-mix(in srgb, var(--mc-bullish) 25%, transparent)' : backfillProgress.startsWith('⚠') ? 'color-mix(in srgb, var(--mc-bearish) 25%, transparent)' : 'color-mix(in srgb, var(--mc-state-persistent) 25%, transparent)'}`,
              color: backfillProgress.startsWith('✓') ? 'var(--mc-bullish)' : backfillProgress.startsWith('⚠') ? 'var(--mc-bearish)' : 'var(--mc-state-persistent)',
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
                  backgroundColor: inMarketHours ? 'color-mix(in srgb, var(--mc-bullish) 9%, transparent)' : 'color-mix(in srgb, var(--mc-text-3) 8%, transparent)',
                  border: `1px solid ${inMarketHours ? 'color-mix(in srgb, var(--mc-bullish) 38%, transparent)' : 'color-mix(in srgb, var(--mc-text-3) 25%, transparent)'}`,
                  color: inMarketHours ? 'var(--mc-bullish)' : 'var(--mc-text-3)',
                  fontFamily: 'ui-monospace, monospace',
                }}>
                {inMarketHours
                  ? <><span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 3, backgroundColor: 'var(--mc-bullish)', animation: 'pulse 1.5s ease-in-out infinite' }} /> LIVE · auto-refresh 4m · last {minutesAgo}m ago</>
                  : <>● MARKET CLOSED · manual refresh only</>
                }
                <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }`}</style>
              </span>
            );
          })()}
          {/* AUDIT_100 #26 — confidence band: show "X of Y enriched · M missing" chip
              next to the refresh button so users see coverage at a glance. */}
          {resolvedDateForGrading && !windowOn && (() => {
            // zzz822 — single-date coverage chip; the window has its own counts.
            const allCards = ((view.by_tier?.BLOCKBUSTER ?? []) as ParsedEarning[])
              .concat(view.by_tier?.STRONG ?? [])
              .concat(view.by_tier?.MIXED ?? [])
              .concat(view.by_tier?.AVOID ?? []);
            const total = allCards.length;
            const missing = allCards.filter((c) => c.sales_curr_cr == null && c.pat_curr_cr == null).length;
            const enriched = total - missing;
            if (total === 0) return null;
            const ratio = enriched / total;
            const tone = ratio >= 0.95 ? '#10B981' : ratio >= 0.75 ? '#22D3EE' : ratio >= 0.5 ? '#F59E0B' : '#EF4444';
            const glyph = ratio >= 0.95 ? '✓' : ratio >= 0.5 ? '⚠' : '✗';
            return (
              <span title={`${enriched} of ${total} cards have Screener/Yahoo financials enriched. ${missing} missing.`}
                style={{
                  fontSize: 10.5, fontWeight: 700, color: tone,
                  border: `1px solid ${tone}50`, backgroundColor: `${tone}12`,
                  padding: '3px 8px', borderRadius: 4, letterSpacing: 0.3,
                  fontFamily: 'ui-monospace, monospace',
                }}>
                {glyph} {enriched}/{total} enriched{missing > 0 ? ` · ${missing} missing` : ''}
              </span>
            );
          })()}
          {/* PATCH 0189 — Partial refresh button with INLINE feedback */}
          {resolvedDateForGrading && (() => {
            // zzz415 — count with the SAME criterion the server's refreshMissing
            // uses, so the button label matches what a refresh will attempt.
            // Old rule (no absolutes at all) under-counted: a card with raw
            // Rev/PAT but no OPM (VIKRAN-class) was invisible here ("Refresh 1
            // missing" while 2 cards showed screener-gap) yet the server
            // attempted it. New rule: missing = (no YoY AND no absolutes) OR
            // margin missing/stale-zero. Absolute-only names (recent IPOs with
            // no year-ago quarter) clear once their OPM lands, so the counter
            // converges instead of sticking forever.
            const missing = ((view.by_tier?.BLOCKBUSTER ?? []) as ParsedEarning[])
              .concat(view.by_tier?.STRONG ?? [])
              .concat(view.by_tier?.MIXED ?? [])
              .concat(view.by_tier?.AVOID ?? [])
              .filter((c) => {
                const noYoY = c.sales_yoy_pct == null && c.net_profit_yoy_pct == null && c.eps_yoy_pct == null;
                const noAbs = c.sales_curr_cr == null && c.pat_curr_cr == null && (c as any).eps_curr == null;
                const opmCur = (c as any).opm_pct, opmPrev = (c as any).opm_prev_pct, salesCur = (c as any).sales_curr_cr;
                const opmStaleZero = (opmCur === 0 || opmPrev === 0) && salesCur != null && Number(salesCur) >= 100;
                const noMargin = (opmCur == null && opmPrev == null) || opmStaleZero;
                return (noYoY && noAbs) || noMargin;
              }).length;
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
                      border: '1px solid color-mix(in srgb, var(--mc-warn) 38%, transparent)',
                      background: refreshing ? 'color-mix(in srgb, var(--mc-warn) 19%, transparent)' : 'color-mix(in srgb, var(--mc-warn) 8%, transparent)',
                      color: 'var(--mc-warn)',
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
                    backgroundColor: refreshFeedback.startsWith('✓') ? 'color-mix(in srgb, var(--mc-bullish) 9%, transparent)' : 'color-mix(in srgb, var(--mc-bearish) 9%, transparent)',
                    border: `1px solid ${refreshFeedback.startsWith('✓') ? 'color-mix(in srgb, var(--mc-bullish) 25%, transparent)' : 'color-mix(in srgb, var(--mc-bearish) 25%, transparent)'}`,
                    color: refreshFeedback.startsWith('✓') ? 'var(--mc-bullish)' : 'var(--mc-bearish)',
                    maxWidth: 480, lineHeight: 1.3,
                  }}>
                    {refreshFeedback}
                  </span>
                )}
              </div>
            );
          })()}
          {/* PATCH 0698 — IST market-hours-aware label. During 09:15-15:30 IST
              (Mon-Fri) the pipeline is actively polling; outside those hours
              honestly say 'Market closed · historical data only' rather than
              implying live activity. */}
          {(() => {
            // PATCH 0715 — centralized via isIndianMarketOpen (lib/market-hours).
            const isMarketOpen = isIndianMarketOpenLocal();
            return (
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--mc-text-4)' }}>
                {windowOn
                  // zzz822 — the sources-polled count belongs to one date, not the window.
                  ? (isMarketOpen ? 'Market open · window shows stored grades' : 'Market closed · window shows stored grades')
                  : isMarketOpen
                    ? `Live · ${view.sources_polled} sources polling`
                    : `Market closed · historical data only · ${view.sources_polled} sources polled`}
              </span>
            );
          })()}
        </div>

        <div style={{ backgroundColor: 'var(--mc-bg-0)', border: '1px solid var(--mc-bg-4)', borderRadius: 8, padding: '10px 14px', marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--mc-text-3)', lineHeight: 1.55 }}>
              Yesterday's earnings, scored overnight — find the exceptional setups before the market opens.<br/>
              Every Indian filing graded into one of four conviction tiers — from <strong style={{ color: 'var(--mc-warn)' }}>BLOCKBUSTER</strong> through <strong style={{ color: 'var(--mc-bullish)' }}>STRONG</strong>, <strong style={{ color: '#FACC15' }}>MIXED</strong>, and <strong style={{ color: 'var(--mc-bearish)' }}>AVOID</strong>.
            </div>
            <button onClick={() => setShowAbout((s) => !s)}
              style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid color-mix(in srgb, var(--mc-cyan) 38%, transparent)', background: 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)', color: 'var(--mc-cyan)', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              How it works {showAbout ? '▴' : '▾'}
            </button>
          </div>
          {showAbout && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--mc-bg-4)', fontSize: 11.5, color: 'var(--mc-text-3)', lineHeight: 1.7 }}>
              {/* zzz227 — exact grading rules, mirrored from the grader code so the
                  doc can never drift from behaviour without a code change here too. */}
              {/* zzz820b — the India tier is PRICE-FREE since engine v24 (zzz819):
                  only the reported numbers decide it; the chart, the Day-1
                  reaction, the 52-week position and thin trading are shown
                  beside the grade as grey "Price context" chips. */}
              <div style={{ marginBottom: 12, padding: '8px 12px', background: 'color-mix(in srgb, var(--mc-cyan) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-cyan) 25%, transparent)', borderRadius: 8 }}>
                <strong style={{ color: 'var(--mc-cyan)' }}>📐 HOW THE TIER IS DECIDED — from the company&apos;s numbers only</strong><br/>
                The tier looks only at what the company reported: how much sales, profit and earnings per share (EPS) grew against the same quarter last year, the operating margin and whether it widened, whether cash backs the profit, and any warning flags found in the filing.<br/>
                <strong>Price is not part of the grade.</strong> The chart (stage and relative strength), the share-price move on the day after results (Day-1 reaction), how far the price is from its 52-week high, and thin trading are shown on each card as small grey <em>&ldquo;Price context — not part of the grade&rdquo;</em> chips. A falling share price never lowers a tier, and a rising one never lifts it.<br/>
                <strong>Very small company / Barely trades.</strong> A company worth under ₹100 Cr gets an orange <em>&ldquo;Very small company&rdquo;</em> chip; one under ₹500 Cr whose shares trade less than ₹10 lakh a day on average gets <em>&ldquo;Barely trades&rdquo;</em>. These come from the share price (market cap and trading value), so they sit beside the tier and never change it. To hide small companies, use the <em>Mkt Cap</em> filter.<br/>
                <strong>Trading value (💧).</strong> Shown only as a real average of recent trading days, e.g. &ldquo;₹2.4 Cr/d avg (20d)&rdquo;. When only one day&apos;s figure is known (usually results day, the busiest day), the chip shows &ldquo;—&rdquo;: one day is not an average. Unknown trading never counts as &ldquo;thin&rdquo; or &ldquo;barely trades&rdquo;.<br/>
                <strong>Cash (CFO/PAT).</strong> Operating cash flow ÷ net profit for the same full year. Example: cash ₹60 Cr, profit ₹50 Cr → 1.2x, the profit is backed by cash. A very high ratio (8x or more) means profit was small next to cash flow, and the card says &ldquo;profit small vs cash&rdquo;.<br/>
                <strong>Guidance.</strong> If we have no guidance for a company, it is shown as unknown — never as &ldquo;not raised&rdquo;. Unknown guidance can stop a top-tier result that needs it; it never lowers a grade.<br/>
                An internal number is used behind the scenes only to order cards within a tier; it is not shown.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                <div style={{ padding: '8px 12px', background: 'color-mix(in srgb, #FCD34D 6%, transparent)', border: '1px solid color-mix(in srgb, #FCD34D 30%, transparent)', borderRadius: 8 }}>
                  <strong style={{ color: '#FCD34D' }}>⭐ ELITE badge</strong> — strictest gate; ALL required, missing data fails:<br/>
                  · Sales YoY ≥ 25% · PAT YoY ≥ 30% · OPM expanding ≥ +1pp<br/>
                  · PAT &amp; EPS positive this quarter AND same quarter last year (no loss, no turnaround base)<br/>
                  · Day-1 close ≥ +2% · gap-up ≥ 0% (market must confirm)<br/>
                  · ZERO critical caveats (optical EPS / OCF divergence / low quality)<br/>
                  · Not Stage 4 · RS ≥ 60 (if known) · ADTV ≥ ₹1 Cr/day (no thin float)
                </div>
                <div style={{ padding: '8px 12px', background: 'color-mix(in srgb, var(--mc-warn) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 30%, transparent)', borderRadius: 8 }}>
                  <strong style={{ color: 'var(--mc-warn)' }}>⭐ BLOCKBUSTER</strong> — rare. First the growth must be exceptional (very large sales, profit and EPS growth, or a big margin jump). Then it must pass <strong>every one</strong> of five checks:<br/>
                  1 · <strong>Real sales growth</strong> — sales up at least 15% on last year.<br/>
                  2 · <strong>Not small-base maths</strong> — if last year&apos;s profit was a loss or tiny, a huge % means little; it then needs sales up 25%+ and the margin up 3 points+.<br/>
                  3 · <strong>A healthy margin</strong> — operating margin 12%+ (or a big jump: up 5 points and by half again). For banks and lenders: net profit at least 10% of income.<br/>
                  4 · <strong>Cash backs the profit</strong> — when cash-flow figures exist, operating cash must be at least 0.6× profit (lenders exempt). No cash data does not count against it.<br/>
                  5 · <strong>No open warning flag</strong> — e.g. cash not matching profit, a one-off gain, tax-driven profit.<br/>
                  <em>Miss any check and the card is held at STRONG (or MIXED if sales barely grew), with one plain line under the tier saying why — e.g. &ldquo;Capped at STRONG: revenue grew only 9%&rdquo;.</em>
                </div>
                <div style={{ padding: '8px 12px', background: 'color-mix(in srgb, var(--mc-bullish) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 30%, transparent)', borderRadius: 8 }}>
                  <strong style={{ color: 'var(--mc-bullish)' }}>🟢 STRONG</strong> — good, clean growth in the numbers with few warning flags, or a BLOCKBUSTER-sized quarter that missed one of the five checks. A loss that is shrinking fast on strongly rising sales can reach STRONG, never higher.
                </div>
                <div style={{ padding: '8px 12px', background: 'color-mix(in srgb, #FACC15 6%, transparent)', border: '1px solid color-mix(in srgb, #FACC15 30%, transparent)', borderRadius: 8 }}>
                  <strong style={{ color: '#FACC15' }}>🟡 MIXED</strong> — some good numbers but not enough, too many warning flags, still loss-making, or margins shrinking sharply.
                </div>
                <div style={{ padding: '8px 12px', background: 'color-mix(in srgb, var(--mc-bearish) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bearish) 30%, transparent)', borderRadius: 8 }}>
                  <strong style={{ color: 'var(--mc-bearish)' }}>🔴 AVOID</strong> — the numbers went the wrong way (e.g. EPS down and profit down more than 10%) or were weak overall.
                </div>
                <div style={{ padding: '8px 12px', background: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: 8 }}>
                  <strong style={{ color: 'var(--mc-text-2)' }}>⚪ UNCONFIRMED</strong> — the stored growth figures may have been measured against the wrong quarter last year (Screener&apos;s table had a gap). The old tier is shown small and grey, the card is not counted as BLOCKBUSTER or STRONG, and the date is re-checked automatically until it is regraded with correct figures.
                </div>
                <div style={{ padding: '8px 12px', background: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: 8 }}>
                  <strong style={{ color: 'var(--mc-text-2)' }}>🚩 CAVEAT FLAGS</strong> — warning flags found in the filing; each counts against the grade (the internal point cost is in brackets):<br/>
                  · <strong>optical eps</strong> (−20) — EPS growth ≥ 3× sales growth (&amp; ≥ 50%), or ≥ 200% YoY, or prior-year EPS was near zero: the beat is likely arithmetic, not operational<br/>
                  · <strong>tax distortion</strong> (−15) — PAT YoY &gt; 100% while Op Profit YoY &lt; 30%: the tax line, not the business, is driving PAT<br/>
                  · <strong>segment mix shift</strong> (−10) — OPM contracted &gt; 1.5pp YoY: growth came from lower-margin mix<br/>
                  · <strong>ocf divergence</strong> (−25) — annual operating cash flow &lt; 60% of PAT, or negative OCF while PAT positive: profits not converting to cash<br/>
                  · <strong>low quality</strong> (−25) — still loss-making with the loss NOT narrowing (widened, flat, or a profit that swung to a loss)<br/>
                  · <strong>still loss-making</strong> (−10) — a loss that narrowed YoY. No growth % is computed off a loss; the card says &ldquo;loss narrowed ₹X → ₹Y&rdquo;. Loss at least halved + revenue ≥ +25% + OPM ≥ +5pp and now positive = an operating turnaround, graded STRONG at most<br/>
                  · <strong>market reaction</strong> (sold off / market rejected print) and <strong>thin float</strong> — price context only, shown as grey chips; they do not change the tier<br/>
                  · <strong>exceptional item / one-time order</strong> (−10) — filing text flags non-recurring income<br/>
                  · <strong>accelerated depreciation</strong> (−10) · <strong>accounting change / pooling restate</strong> (−12) — comparability of YoY numbers is compromised<br/>
                  · <strong>forex gain / loss</strong> (−8) — currency moves flatter or hurt the print
                </div>
              </div>
              <div style={{ marginTop: 10, fontSize: 10.5, color: 'var(--mc-text-4)', fontStyle: 'italic' }}>
                Educational only. Not investment advice. Server pipeline fetches BSE/NSE results announcements + Indian results RSS feeds; worker enriches with Stage / RS / OPM / ADTV. Parser accuracy depends on RSS title richness — missing fields are treated conservatively (never punished for AVOID, but ELITE requires them).
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* zzz276 — Search across the last 120 business days of graded filings.
              Institutional pattern: debounced typeahead, keyboard nav, recent picks.
              Click a result → jump to that filing date + scroll to the card. */}
          <EarningsSearch
            windowRows={searchWindowRows}
            windowLabel={windowOn ? `this ${windowDays}-session window (${win.dates.length} dates to ${effectiveDate})` : effectiveDate ? `the ${effectiveDate} results` : 'the loaded results'}
            hiddenReasons={searchHiddenReasons}
            onRevealInWindow={(row: any) => pinTicker(row.ticker)}
            onGradeNow={(t: string) => { addForceInclude(t); pinTicker(t); }}
            onJumpToDate={async (r: EarningsSearchResult) => {
              // zzz282/zzz812 — confirm the graded day really holds this ticker
              // before jumping (bench entries can carry a stale date). Cache
              // only: this must never start a grading sweep on its own.
              if (r.filing_date && /^\d{4}-\d{2}-\d{2}$/.test(r.filing_date)) {
                try {
                  const vr = await fetch(`/api/v1/earnings/graded?date=${r.filing_date}&cache_only=1`, { cache: 'no-store' });
                  if (vr.ok) {
                    const vj = await vr.json();
                    const bt = vj?.by_tier;
                    const has = !bt || ['BLOCKBUSTER','STRONG','MIXED','AVOID'].some((t) =>
                      Array.isArray(bt[t]) && bt[t].some((e: any) => e && String(e.ticker || '').toUpperCase() === r.ticker.toUpperCase()));
                    if (bt && !has) { addForceInclude(r.ticker); pinTicker(r.ticker); return; }
                  }
                } catch {}
                setFilterDate(r.filing_date);
                pinTicker(r.ticker);
                return;
              }
              addForceInclude(r.ticker);
              pinTicker(r.ticker);
            }}
          />
          {/* PATCH 0916 — FILING DATE box now includes an inline native
              date picker so user can jump to ANY date with one click + one
              calendar pick. Plus quick-jump chips for Today / Yesterday /
              7 days ago. User feedback: "now only posible to go one day
              back liek that make it eay edtion or selecting directyl
              needed date by calendar option". */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: `1px solid ${isStaleView ? 'color-mix(in srgb, var(--mc-warn) 38%, transparent)' : 'var(--mc-bg-4)'}`, borderRadius: 8, padding: '2px 4px 2px 12px', backgroundColor: 'var(--mc-bg-0)', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.4px' }}>FILING DATE</span>
            <span style={{ fontSize: 12, color: 'var(--mc-cyan)', fontWeight: 700 }}>· {filingDateLabel}</span>
            {isStaleView && (
              <span style={{
                fontSize: 9.5, fontWeight: 800, color: 'var(--mc-warn)',
                padding: '1px 6px', borderRadius: 3,
                backgroundColor: 'color-mix(in srgb, var(--mc-warn) 13%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 38%, transparent)',
                display: 'inline-flex', alignItems: 'center', gap: 3,
                marginLeft: 6,
              }}>
                <span style={{
                  display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
                  backgroundColor: 'var(--mc-warn)', animation: 'pulse 1s infinite',
                }} />
                LOADING
                <style>{`@keyframes pulse { 0%,100%{opacity:1}50%{opacity:.3} }`}</style>
              </span>
            )}
            <button onClick={() => shiftDate(-1)} title="Previous trading day"
              style={{ padding: '6px 10px', background: 'none', border: 'none', color: 'var(--mc-text-3)', fontSize: 14, cursor: 'pointer' }}>←</button>
            <button onClick={() => shiftDate(1)} title="Next trading day"
              style={{ padding: '6px 10px', background: 'none', border: 'none', color: 'var(--mc-text-3)', fontSize: 14, cursor: 'pointer' }}>→</button>
            {/* PATCH 0916 — Inline calendar picker inside the FILING DATE box */}
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', border: '1px solid color-mix(in srgb, var(--mc-cyan) 25%, transparent)', borderRadius: 5, backgroundColor: 'color-mix(in srgb, var(--mc-cyan) 6%, transparent)', cursor: 'pointer', marginLeft: 4 }}
              title="Click to open a calendar — jump to any date (past or future)">
              <CalendarIcon style={{ width: 12, height: 12, color: 'var(--mc-cyan)' }} />
              <span style={{ fontSize: 10, color: 'var(--mc-cyan)', fontWeight: 800, letterSpacing: '0.3px' }}>PICK DATE</span>
              <input
                type="date"
                value={effectiveDate}
                onChange={(e) => { if (e.target.value) setFilterDate(e.target.value); }}
                style={{ background: 'transparent', border: 'none', color: 'var(--mc-cyan)', fontSize: 11, fontWeight: 700, outline: 'none', cursor: 'pointer', width: 110, padding: 0 }}
              />
            </label>
            {/* PATCH 0916 — Quick-jump shortcuts */}
            <button
              onClick={() => {
                const today = new Date();
                setFilterDate(todayIstISO());  // PATCH zzz90 (EO3) — IST-anchored Today
              }}
              title="Jump to today"
              style={{ padding: '4px 8px', background: 'transparent', border: '1px solid var(--mc-bg-4)', color: 'var(--mc-text-3)', fontSize: 10, fontWeight: 700, borderRadius: 4, cursor: 'pointer' }}
            >Today</button>
            <button
              onClick={() => {
                const d = new Date(); d.setDate(d.getDate() - 1);
                // Skip Sun/Sat backwards
                while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
                setFilterDate(d.toISOString().slice(0, 10));
              }}
              title="Jump to most recent trading day before today"
              style={{ padding: '4px 8px', background: 'transparent', border: '1px solid var(--mc-bg-4)', color: 'var(--mc-text-3)', fontSize: 10, fontWeight: 700, borderRadius: 4, cursor: 'pointer' }}
            >Yesterday</button>
            <button
              onClick={() => {
                const d = new Date(); d.setDate(d.getDate() - 7);
                setFilterDate(d.toISOString().slice(0, 10));
              }}
              title="Jump to 7 days ago"
              style={{ padding: '4px 8px', background: 'transparent', border: '1px solid var(--mc-bg-4)', color: 'var(--mc-text-3)', fontSize: 10, fontWeight: 700, borderRadius: 4, cursor: 'pointer' }}
            >−7d</button>
            {/* zzz814 — multi-day window, as on the US page. Counted in IST
                trading sessions (Mon–Fri) back from the date above; the
                weekends in between are read too, because Indian companies
                file on them. 1d is the single-date view. */}
            <span className="mc-no-print" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.4px', marginRight: 2 }}>WINDOW</span>
              {IN_WINDOWS.map((d) => {
                const on = windowDays === d;
                return (
                  <button key={d}
                    onClick={() => { setWindowDays(d); if (d > 1) setViewMode('GRADED'); }}
                    title={d === 1
                      ? 'One date — the date above'
                      : `${d} trading sessions (Mon–Fri, IST) back from the date above, plus the weekends in between — Indian companies file on Saturdays and Sundays too. Days already graded load from the server store at once; days never graded are graded one at a time, newest first.`}
                    style={{
                      padding: '3px 7px', borderRadius: 4, fontSize: 10.5, fontWeight: 800, cursor: 'pointer',
                      border: `1px solid ${on ? 'var(--mc-cyan)' : 'var(--mc-bg-4)'}`,
                      background: on ? 'color-mix(in srgb, var(--mc-cyan) 16%, transparent)' : 'transparent',
                      color: on ? 'var(--mc-cyan)' : 'var(--mc-text-3)',
                    }}>{d}d</button>
                );
              })}
            </span>
          </div>
          {/* PATCH 0736 — surface server timeout / date mismatch so user
              doesn't see the same data on multiple consecutive dates and
              think the app is broken. Three states:
                1. fetch error AND we're showing stale data → red banner
                2. data._builtForDate != resolvedDate → amber banner
                3. fetch error but no stale data → red banner with retry */}
          {(() => {
            const builtFor = (gradedData as any)?._builtForDate as string | undefined;
            const mismatch = builtFor && builtFor !== resolvedDateForGrading;
            const errStatus = (gradedError as any)?.status as number | undefined;
            const errDetail = (gradedError as any)?.detail as string | undefined;
            if (!gradedError && !mismatch) return null;
            const bg = gradedError ? '#7F1D1D33' : '#92400E33';
            const border = gradedError ? '#EF4444' : '#F59E0B';
            const color = gradedError ? '#FCA5A5' : '#FDE68A';
            const msg = gradedError
              ? `Server couldn't build data for ${resolvedDateForGrading}${errStatus ? ` (HTTP ${errStatus}` : ''}${errDetail ? `: ${errDetail})` : errStatus ? ')' : ''}.${mismatch ? ` Showing cached ${builtFor} instead.` : ''}`
              : `Showing cached ${builtFor} data — server hasn't built ${resolvedDateForGrading} yet.`;
            return (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                border: `1px solid ${border}80`, borderRadius: 6, background: bg,
                color, fontSize: 11.5, fontWeight: 500,
              }}>
                <span style={{ fontSize: 14 }}>{gradedError ? '🚨' : '⚠'}</span>
                <span style={{ flex: 1 }}>{msg}</span>
                <button
                  onClick={() => refetchGraded()}
                  disabled={gradedFetching}
                  style={{
                    padding: '4px 10px', fontSize: 11, fontWeight: 700,
                    background: border, color: 'var(--mc-bg-0)', border: 'none',
                    borderRadius: 4, cursor: gradedFetching ? 'wait' : 'pointer',
                    opacity: gradedFetching ? 0.5 : 1,
                  }}
                >
                  {gradedFetching ? 'Retrying…' : '↻ Retry'}
                </button>
              </div>
            );
          })()}
          {/* PATCH 0493 — Sparse-day hint banner */}
          {sparseDayHint && (
            <button
              onClick={() => setFilterDate(sparseDayHint.date)}
              style={{
                padding: '6px 12px', borderRadius: 8,
                border: '1px solid color-mix(in srgb, var(--mc-warn) 38%, transparent)', backgroundColor: 'color-mix(in srgb, var(--mc-warn) 8%, transparent)',
                color: 'var(--mc-warn)', fontSize: 11, fontWeight: 700,
                cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
              title="The previous date with filings — click to view"
            >
              ← {sparseDayHint.label} had {sparseDayHint.count} filings
            </button>
          )}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', border: '1px solid var(--mc-bg-4)', borderRadius: 8, backgroundColor: 'var(--mc-bg-0)', cursor: 'pointer' }}>
            <CalendarIcon style={{ width: 12, height: 12, color: 'var(--mc-text-3)' }} />
            <span style={{ fontSize: 11, color: 'var(--mc-text-3)', fontWeight: 600 }}>Jump to</span>
            <input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)}
              style={{ background: 'transparent', border: 'none', color: 'var(--mc-cyan)', fontSize: 12, fontWeight: 700, outline: 'none', cursor: 'pointer' }} />
          </label>
          {filterDate && (
            <button onClick={() => setFilterDate('')} title="Show latest available"
              style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--mc-bg-4)', backgroundColor: 'transparent', color: 'var(--mc-text-3)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
              ↩ Latest
            </button>
          )}
          {/* PATCH 0502 — Always-visible Force Re-scan button. Previously
              this was buried in the empty-state pill cluster, so users with
              partial coverage (a few stale cards) couldn't trigger a fresh
              pull. Now visible on every render. */}
          {resolvedDateForGrading && (
            <button
              onClick={async () => {
                if (forceRescanning) return;
                setForceRescanning(true);
                try {
                  const d = resolvedDateForGrading;
                  try { localStorage.removeItem('mc:graded:v10:' + d); localStorage.removeItem('mc:graded:v9:' + d); localStorage.removeItem('mc:graded:v8:' + d); } catch {}  // PATCH 0992
                  await Promise.allSettled([
                    fetch(`/api/v1/earnings/today-live?date=${d}&force=1`, { cache: 'no-store' }),
                    fetch(`/api/v1/earnings/graded?date=${d}&force=1&refreshMissing=1`, { cache: 'no-store' }),
                  ]);
                  await Promise.all([refetchHub(), refetchGraded()]);
                } finally {
                  setForceRescanning(false);
                }
              }}
              disabled={forceRescanning}
              title="Force re-scan NSE + BSE for this date. Bypasses all caches. Works on any date including weekends."
              style={{
                padding: '6px 14px', borderRadius: 8,
                border: '1px solid color-mix(in srgb, var(--mc-bullish) 50%, transparent)',
                backgroundColor: forceRescanning ? 'color-mix(in srgb, var(--mc-bullish) 19%, transparent)' : 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)',
                color: 'var(--mc-bullish)', fontSize: 11, fontWeight: 800, cursor: forceRescanning ? 'wait' : 'pointer',
                letterSpacing: '0.3px', display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              {forceRescanning ? '⏳ Scanning…' : '🔄 Force NSE+BSE'}
            </button>
          )}
          {/* AUDIT_100 #57 — Export the graded tiers to CSV. zzz814 — one builder
              for a single date and a window (lib/india-earnings-window): the
              rows that pass the active filters, all four tiers, with the date
              each was graded on, the quadrant scores, "also reported" dates in
              a window and which engine graded it. The old column mapping read
              fields the payload never carried (company_name, score, sales_yoy)
              and wrote blank Company / Score / YoY cells. */}
          {resolvedDateForGrading && activeView.by_tier && (
            TIER_ORDER.reduce((n, t) => n + (activeView.by_tier[t]?.length || 0), 0) > 0
          ) && (
            <span className="mc-no-print" style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
              <button
                onClick={() => {
                  const csv = windowCsv(exportRows(), (r: any) => r._window_date || r.filing_date || resolvedDateForGrading || '');
                  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = windowOn
                    ? `earnings-opportunities-${win.dates[win.dates.length - 1] || ''}_to_${resolvedDateForGrading}-${windowDays}d.csv`
                    : `earnings-opportunities-${resolvedDateForGrading}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                title={windowOn
                  ? `Download every company in this ${windowDays}-session window that passes the current filters (latest result per company) as CSV`
                  : 'Download all 4 tiers (BLOCKBUSTER/STRONG/MIXED/AVOID) for this date as CSV — the current filters apply'}
                style={{
                  padding: '6px 12px', borderRadius: 8,
                  border: '1px solid color-mix(in srgb, var(--mc-warn) 50%, transparent)',
                  backgroundColor: 'color-mix(in srgb, var(--mc-warn) 8%, transparent)',
                  color: 'var(--mc-warn)', fontSize: 11, fontWeight: 800, cursor: 'pointer',
                  letterSpacing: '0.3px', display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                📊 Export CSV{windowOn ? ` · ${windowDays}d` : ''}
              </button>
              <button
                onClick={async () => {
                  const txt = tradingViewList(exportRows());
                  try { await navigator.clipboard.writeText(txt); } catch {
                    try {
                      const ta = document.createElement('textarea');
                      ta.value = txt; ta.style.position = 'fixed'; ta.style.top = '-1000px';
                      document.body.appendChild(ta); ta.select(); document.execCommand('copy');
                      document.body.removeChild(ta);
                    } catch {}
                  }
                  setTvCopyNote(`✓ Copied ${txt ? txt.split(',').length : 0}`);
                  setTimeout(() => setTvCopyNote(null), 4000);
                }}
                title="Copy the companies that pass the current filters as NSE:TICKER,NSE:TICKER (TradingView watchlist import), in the order shown"
                style={{
                  padding: '6px 12px', borderRadius: 8,
                  border: '1px solid color-mix(in srgb, var(--mc-cyan) 50%, transparent)',
                  backgroundColor: 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)',
                  color: 'var(--mc-cyan)', fontSize: 11, fontWeight: 800, cursor: 'pointer',
                  letterSpacing: '0.3px', display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                {tvCopyNote || '📈 TradingView'}
              </button>
            </span>
          )}
          {/* PATCH 0503 — Source coverage telemetry chip. Surfaces which
              exchange provided how many filings + the merged total so the
              user can spot coverage gaps at a glance.
              PATCH zzz58 part 1/3 — Hide the chip entirely when all three
              counts are zero. The `today-live` route returns 0/0/0
              whenever NSE rate-limits Railway egress (which is most of
              the time), producing a misleading red "NSE 0 · BSE 0 ·
              merged 0" chip even when the calendar is healthy and being
              served from KV cache. Suppressing the chip in the all-zero
              case removes the false alarm without hiding genuine
              coverage info when at least one source returns data. */}
          {!windowOn && coverageStats && (coverageStats.nse > 0 || coverageStats.bse > 0 || coverageStats.total > 0) && (
            <span
              title={`NSE corp-announcements: ${coverageStats.nse} filings
BSE corp-announcements: ${coverageStats.bse} filings
Total after dedup: ${coverageStats.total}
Source label: ${coverageStats.source}`}
              style={{
                padding: '4px 10px', borderRadius: 6,
                border: `1px solid ${coverageStats.total >= 10 ? 'color-mix(in srgb, var(--mc-bullish) 25%, transparent)' : coverageStats.total > 0 ? 'color-mix(in srgb, var(--mc-warn) 25%, transparent)' : 'color-mix(in srgb, var(--mc-bearish) 25%, transparent)'}`,
                backgroundColor: coverageStats.total >= 10 ? 'color-mix(in srgb, var(--mc-bullish) 6%, transparent)' : coverageStats.total > 0 ? 'color-mix(in srgb, var(--mc-warn) 6%, transparent)' : 'color-mix(in srgb, var(--mc-bearish) 6%, transparent)',
                color: coverageStats.total >= 10 ? 'var(--mc-bullish)' : coverageStats.total > 0 ? 'var(--mc-warn)' : 'var(--mc-bearish)',
                fontSize: 10.5, fontWeight: 700, fontFamily: 'monospace',
                cursor: 'help',
              }}
            >
              NSE {coverageStats.nse} · BSE {coverageStats.bse} · merged {coverageStats.total}
            </span>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--mc-text-4)' }}
            title={windowOn ? `Whole ${windowDays}-session window: one line per company (latest result shown), the graded results read across every loaded day, and how many of the window's dates have loaded. The single-date counts appear when the window is 1d.` : "A company can only be GRADED once it has actually FILED its results and our parser has read them. Companies that have only ANNOUNCED a board meeting for this date (results not filed yet) can't be graded — they show in the '📅 SCHEDULED TODAY' block below and move into a grade tier the moment their results are filed. So 'filed & graded' + 'results pending' = the full cohort for the day. A mismatch near filing day is expected, not a bug."}>
            {windowOn ? (() => {
              // zzz820 — with a window selected this line used to show the
              // single anchor date's numbers ("1 filed & graded · 1 scanned")
              // beside a window of 2,000 companies. It now describes the window.
              return `Window: ${win.rows.length.toLocaleString('en-IN')} companies · ${win.entries.length.toLocaleString('en-IN')} graded results · ${win.progress.ready}/${win.progress.total} days loaded`;
            })() : (() => {
              // Durable, date-agnostic cohort line. The day's TRUE total =
              // filed-&-graded + still-pending (board-meeting announced but not
              // yet filed/parsed). Pending is computed from the SAME source the
              // "SCHEDULED TODAY" block uses (calData hub minus graded tickers)
              // so the two counts can never disagree.
              const filed = view.candidates_total || 0;
              const gset = new Set<string>(
                TIER_ORDER.flatMap((t) => (view.by_tier?.[t] || []).map((s: any) => String(s.ticker || '').toUpperCase()))
              );
              const dayKey = (view.filing_date || filterDate) as string;
              const sched = (dayKey && calData?.by_date?.[dayKey]) ? calData.by_date[dayKey] : [];
              const pending = sched.filter((it: any) => !gset.has(String(it.symbol || '').toUpperCase())).length;
              const total = filed + pending;
              if (pending > 0) {
                return `${total} ${total === 1 ? 'company' : 'companies'} today · ${filed} filed & graded · ${pending} results pending ↓`;
              }
              return `${filed} filed & graded · ${view.raw_items_total} scanned`;
            })()}
          </span>
          {/* PATCH 0909 — Upstream hub-fail banner. When the graded API
              fell back to live-NSE only (or stale KV), let the user know
              why the list might look short. */}
          {!windowOn && (view as any)?._hub_fail && (
            <span
              title={`Earnings hub was unreachable (${(view as any)._hub_fail}). Showing live NSE filings only. Retry in a moment to get the full list.`}
              style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, background: 'color-mix(in srgb, var(--mc-warn) 13%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 38%, transparent)', color: 'var(--mc-warn)', fontWeight: 800 }}
            >⚠ upstream degraded · partial list</span>
          )}
          {/* zzz817 — the tier chips ARE filters: click one to show only that
              tier, click more to add them, "All" clears. Counts respect every
              other filter. Kept in the URL (?tier=BLOCKBUSTER,STRONG). */}
          <span className="eo-tier-chips" style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={() => setTierSel([])}
              title="Show every tier"
              aria-pressed={!tierFilterOn}
              style={{
                fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20, cursor: 'pointer',
                border: `1px solid ${!tierFilterOn ? 'var(--mc-cyan)' : 'var(--mc-bg-4)'}`,
                backgroundColor: !tierFilterOn ? 'color-mix(in srgb, var(--mc-cyan) 14%, transparent)' : 'transparent',
                color: !tierFilterOn ? 'var(--mc-cyan)' : 'var(--mc-text-3)',
              }}>All {counts.reduce((n, c) => n + c.n, 0)}</button>
            {/* zzz818 — one click = exactly BLOCKBUSTER + STRONG (the same
                multi-select as picking both); click again to clear. */}
            {(() => {
              const on = isTopTiersSel(tierSel);
              const n = topTiersCount(tierChipCounts);
              return (
                <button className="eo-top-tiers-chip" onClick={() => setTierSel((sel) => toggleTopTiers(sel))}
                  aria-pressed={on}
                  title={on ? 'Showing BLOCKBUSTER + STRONG — click to show every tier' : `Show only BLOCKBUSTER and STRONG — ${n} with the current filters`}
                  style={{
                    fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20, cursor: 'pointer',
                    border: `${on ? 2 : 1}px solid ${on ? '#10B981' : 'color-mix(in srgb, #10B981 50%, #F59E0B)'}`,
                    background: on ? 'color-mix(in srgb, #10B981 26%, transparent)' : 'linear-gradient(90deg, #F59E0B15, #10B98115)',
                    color: 'color-mix(in srgb, #10B981 55%, var(--mc-text-1))',
                  }}>
                  {on ? '✓ ' : ''}⭐+🟢 BLOCKBUSTER + STRONG ({n})
                </button>
              );
            })()}
            {counts.map((c) => {
              const on = tierSel.includes(c.tier);
              const m = TIER_META[c.tier];
              return (
                <button key={c.tier} onClick={() => setTierSel((sel) => toggleTier(sel, c.tier))}
                  aria-pressed={on}
                  title={on ? `Showing ${m.label} — click to remove it from the filter` : `Show only ${m.label}${tierFilterOn ? ' (added to the tiers already picked)' : ''} — ${c.n} ${c.n === 1 ? 'company' : 'companies'} with the current filters`}
                  style={{
                    fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20, cursor: 'pointer',
                    border: `${on ? 2 : 1}px solid ${m.color}${on ? '' : '50'}`,
                    backgroundColor: on ? `color-mix(in srgb, ${m.color} 28%, transparent)` : `${m.color}15`,
                    color: `color-mix(in srgb, ${m.color} 60%, var(--mc-text-1))`,
                    boxShadow: on ? `0 0 0 1px ${m.color}` : 'none',
                  }}>
                  {on ? '✓ ' : ''}{m.icon} {m.label} {c.n}
                </button>
              );
            })}
          </span>
          {/* PATCH 1017 — ELITE / PEAD / MULTIBAGGER filter chips (clickable toggles) */}
          {(() => {
            const allC = TIER_ORDER.flatMap((t) => (activeView.by_tier[t] || []) as any[]);
            const eliteN = allC.filter((s) => s.is_elite).length;
            const peadN = allC.filter((s) => (s.pead_score ?? 0) >= 70).length;
            const mbN = allC.filter((s) => s.multibagger_setup).length;
            const radarN = allC.filter((s) => radarMap.has(String(s.ticker || '').toUpperCase())).length;
            const beatCheapN = allC.filter((s) => typeof s.pe === 'number' && s.pe > 0 && s.pe <= 35).length;
            // Live count across ALL tiers — these rows mostly live in MIXED.
            const turnaroundN = allC.filter((s) => s.quadrant === 'TURNAROUND ACCELERATOR').length;
            const chip = (active: boolean, color: string, label: string, n: number, onClick: () => void) => (
              <button onClick={onClick} style={{
                fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20, cursor: 'pointer',
                border: `1px solid ${color}${active ? '' : '50'}`,
                backgroundColor: active ? color : `${color}15`,
                color: active ? 'var(--mc-bg-0)' : color,
              }}>{label} {n}</button>
            );
            return (
              <>
                <span style={{ width: 1, height: 14, background: 'var(--mc-bg-4)', margin: '0 2px' }} />
                {/* zzz696 — the badge switch sits with the filters because it is
                    the same kind of decision: what the card shows you. */}
                <CardBadgesToggle compact />
                <span style={{ width: 1, height: 14, background: 'var(--mc-bg-4)', margin: '0 2px' }} />
                {/* zzz703 — A/B/F/G. Ordered by the spec's own ranking, not
                    alphabetically: A is the highest-expectancy setup and G the
                    best base rate, so they lead. */}
                {(['A', 'G', 'B', 'F'] as AbfgPattern[]).map((k) => {
                  const m = ABFG_META[k];
                  const on = patternOnly === k;
                  return (
                    <button key={k} onClick={() => setPatternOnly(on ? null : k)}
                      title={`${m.name} — ${m.bet}`}
                      style={{
                        fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20, cursor: 'pointer',
                        border: `1px solid ${m.color}${on ? '' : '50'}`,
                        backgroundColor: on ? m.color : `${m.color}15`,
                        color: on ? 'var(--mc-bg-0)' : m.color,
                      }}>{m.icon} {k}</button>
                  );
                })}
                <span style={{ width: 1, height: 14, background: 'var(--mc-bg-4)', margin: '0 2px' }} />
                {chip(eliteOnly, '#FCD34D', '⭐ ELITE', eliteN, () => { setEliteOnly(v => !v); setPeadOnly(false); setMultibaggerOnly(false); setRadarOnly(false); setBeatCheapOnly(false); setTurnaroundOnly(false); })}
                {chip(peadOnly, '#F87171', '🔥 PEAD≥70', peadN, () => { setPeadOnly(v => !v); setEliteOnly(false); setMultibaggerOnly(false); setRadarOnly(false); setBeatCheapOnly(false); setTurnaroundOnly(false); })}
                {chip(multibaggerOnly, '#67E8F9', '💎 MULTIBAGGER', mbN, () => { setMultibaggerOnly(v => !v); setEliteOnly(false); setPeadOnly(false); setRadarOnly(false); setBeatCheapOnly(false); setTurnaroundOnly(false); })}
                {/* QUALITY × INFLECTION — the quadrant a single tier cannot express. */}
                {chip(turnaroundOnly, QUADRANT_META['TURNAROUND ACCELERATOR'].color, `${QUADRANT_META['TURNAROUND ACCELERATOR'].icon} TURNAROUND ACCELERATOR`, turnaroundN, () => { setTurnaroundOnly(v => !v); setEliteOnly(false); setPeadOnly(false); setMultibaggerOnly(false); setRadarOnly(false); setBeatCheapOnly(false); })}
                {chip(radarOnly, '#34D399', '🚀 On Radar', radarN, () => { setRadarOnly(v => !v); setEliteOnly(false); setPeadOnly(false); setMultibaggerOnly(false); setBeatCheapOnly(false); setTurnaroundOnly(false); })}
                {chip(beatCheapOnly, '#A3E635', '💰 Beat + Cheap', beatCheapN, () => { setBeatCheapOnly(v => !v); setEliteOnly(false); setPeadOnly(false); setMultibaggerOnly(false); setRadarOnly(false); setTurnaroundOnly(false); })}
                {/* PATCH 1022 — market-cap range selector */}
                <span style={{ width: 1, height: 14, background: 'var(--mc-bg-4)', margin: '0 2px' }} />
                <select
                  value={capFilter}
                  onChange={(e) => setCapFilter(e.target.value as any)}
                  title="Filter by market cap (₹ Cr)"
                  style={{
                    fontSize: 11, fontWeight: 800, padding: '3px 8px', borderRadius: 20, cursor: 'pointer',
                    border: `1px solid ${capFilter !== 'all' ? '#34D399' : '#34D39950'}`,
                    backgroundColor: capFilter !== 'all' ? '#34D399' : '#34D39915',
                    color: capFilter !== 'all' ? 'var(--mc-bg-0)' : '#34D399',
                  }}>
                  <option value="all">🏦 Mkt Cap · All</option>
                  <option value="sweet">🎯 Multibagger ₹5k–50k Cr</option>
                  {CAP_BUCKETS.map((b) => (
                    <option key={b.key} value={b.key.toLowerCase()}>{b.key} {b.label}</option>
                  ))}
                </select>
              </>
            );
          })()}
        </div>

        {/* ── Coverage Probe (PATCH 0174) ─────────────────────────────────── */}
        <div style={{
          marginTop: 10, padding: '10px 14px',
          backgroundColor: 'var(--mc-bg-0)', border: '1px solid var(--mc-bg-4)', borderRadius: 8,
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.6px' }}>
              🔍 COVERAGE PROBE
            </span>
            <span style={{ fontSize: 10.5, color: 'var(--mc-text-3)' }}>
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
                padding: '5px 10px', backgroundColor: 'var(--mc-bg-1)',
                border: '1px solid var(--mc-bg-4)', borderRadius: 6, color: 'var(--mc-text-1)',
                fontSize: 11.5, fontWeight: 700, fontFamily: 'ui-monospace, monospace',
                letterSpacing: '0.5px', outline: 'none',
              }}
            />
            <button
              onClick={runCoverageProbe}
              disabled={!probeTicker.trim() || probing || !resolvedDateForGrading}
              style={{
                padding: '5px 14px', borderRadius: 6, border: '1px solid color-mix(in srgb, var(--mc-cyan) 38%, transparent)',
                backgroundColor: probing ? 'color-mix(in srgb, var(--mc-cyan) 19%, transparent)' : 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)',
                color: 'var(--mc-cyan)', fontSize: 11, fontWeight: 700,
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
                padding: '5px 14px', borderRadius: 6, border: '1px solid color-mix(in srgb, var(--mc-bullish) 38%, transparent)',
                backgroundColor: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)',
                color: 'var(--mc-bullish)', fontSize: 11, fontWeight: 700,
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
                padding: '5px 14px', borderRadius: 6, border: '1px solid color-mix(in srgb, var(--mc-warn) 38%, transparent)',
                backgroundColor: auditing ? 'color-mix(in srgb, var(--mc-warn) 19%, transparent)' : 'color-mix(in srgb, var(--mc-warn) 8%, transparent)',
                color: 'var(--mc-warn)', fontSize: 11, fontWeight: 700,
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
              backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: 6,
              fontSize: 11, color: 'var(--mc-text-2)', lineHeight: 1.5,
            }}>
              {auditResult.error ? (
                <span style={{ color: 'var(--mc-bearish)' }}>⚠ {auditResult.error}</span>
              ) : auditResult.expected_total === 0 ? (
                <span style={{ color: 'var(--mc-text-4)', fontSize: 10.5 }}>{auditResult.note}</span>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: 11, fontWeight: 800,
                      color: auditResult.gap === 0 ? 'var(--mc-bullish)' : 'var(--mc-warn)',
                    }}>
                      {auditResult.gap === 0 ? '✓' : '⚠'} Coverage: {auditResult.matched}/{auditResult.expected_total} ({auditResult.coverage_pct}%)
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--mc-text-4)' }}>{auditResult.note}</span>
                  </div>
                  {auditResult.missing && auditResult.missing.length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      <div style={{ fontSize: 10, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.4px', marginBottom: 4 }}>
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
                              borderRadius: 4, backgroundColor: 'color-mix(in srgb, var(--mc-bearish) 9%, transparent)',
                              border: '1px solid color-mix(in srgb, var(--mc-bearish) 25%, transparent)', color: 'var(--mc-bearish)',
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
                      <summary style={{ fontSize: 10, color: 'var(--mc-text-4)', cursor: 'pointer' }}>
                        ✓ {auditResult.we_have.length} matched
                      </summary>
                      <div style={{ marginTop: 4, fontSize: 9.5, color: 'var(--mc-bullish)', fontFamily: 'ui-monospace, monospace' }}>
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
                  borderRadius: 4, backgroundColor: 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--mc-cyan) 25%, transparent)', color: 'var(--mc-cyan)',
                  letterSpacing: '0.4px',
                }}>
                  🤖 AUTO-DISCOVERED: {autoFillTickers.length}
                </span>
              )}
              {userForceIncludeForDate.length > 0 && (
                <>
                  <span style={{ fontSize: 9.5, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.4px' }}>
                    MANUALLY ADDED:
                  </span>
                  {userForceIncludeForDate.map((t) => (
                    <span key={t} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '2px 4px 2px 8px', fontSize: 10, fontWeight: 700,
                      borderRadius: 4, backgroundColor: 'color-mix(in srgb, var(--mc-bullish) 9%, transparent)',
                      border: '1px solid color-mix(in srgb, var(--mc-bullish) 25%, transparent)', color: 'var(--mc-bullish)',
                      fontFamily: 'ui-monospace, monospace',
                    }}>
                      {t}
                      <button onClick={() => removeForceInclude(t)} title="Remove"
                        style={{
                          background: 'none', border: 'none', color: 'var(--mc-bullish)',
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
              backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: 6,
              fontSize: 11, color: 'var(--mc-text-2)', lineHeight: 1.5,
            }}>
              {probeResult.error ? (
                <span style={{ color: 'var(--mc-bearish)' }}>⚠ {probeResult.error}</span>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                    <div style={{
                      flex: 1,
                      fontSize: 11.5, fontWeight: 800,
                      color: probeResult.diagnosis?.startsWith('✓') ? 'var(--mc-bullish)' :
                             probeResult.diagnosis?.startsWith('⚠') ? 'var(--mc-warn)' : 'var(--mc-bearish)',
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
                          border: '1px solid color-mix(in srgb, var(--mc-bullish) 38%, transparent)',
                          backgroundColor: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)',
                          color: 'var(--mc-bullish)', fontSize: 10.5, fontWeight: 800,
                          cursor: 'pointer', whiteSpace: 'nowrap',
                        }}
                      >
                        + Force-include {probeResult.ticker}
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                    <div style={{ padding: '6px 8px', backgroundColor: 'var(--mc-bg-0)', borderRadius: 4, borderLeft: `3px solid ${probeResult.layers?.universe?.found ? 'var(--mc-bullish)' : 'var(--mc-bearish)'}` }}>
                      <div style={{ fontSize: 9.5, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.4px' }}>L1 · UNIVERSE</div>
                      <div style={{ fontSize: 10.5, marginTop: 2 }}>
                        {probeResult.layers?.universe?.found ? (
                          <span style={{ color: 'var(--mc-bullish)' }}>
                            ✓ Found{probeResult.layers.universe.exact === false ? ` (date ${probeResult.layers.universe.resultDate})` : ''}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--mc-bearish)' }}>
                            ✗ Not in /api/market/earnings (NSE/BSE feeds for {probeResult.date?.slice(0, 7)} have {probeResult.layers?.universe?.totalInMonth ?? '?'} companies)
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ padding: '6px 8px', backgroundColor: 'var(--mc-bg-0)', borderRadius: 4, borderLeft: `3px solid ${probeResult.layers?.enrichment?.found && probeResult.layers?.enrichment?.sales_yoy_pct != null ? 'var(--mc-bullish)' : 'var(--mc-warn)'}` }}>
                      <div style={{ fontSize: 9.5, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.4px' }}>L2 · ENRICHMENT</div>
                      <div style={{ fontSize: 10.5, marginTop: 2 }}>
                        {probeResult.layers?.enrichment?.found && probeResult.layers?.enrichment?.sales_yoy_pct != null ? (
                          <span style={{ color: 'var(--mc-bullish)' }}>
                            ✓ Rev {probeResult.layers.enrichment.sales_yoy_pct >= 0 ? '+' : ''}{Math.round(probeResult.layers.enrichment.sales_yoy_pct)}% · PAT {probeResult.layers.enrichment.pat_yoy_pct >= 0 ? '+' : ''}{Math.round(probeResult.layers.enrichment.pat_yoy_pct)}% · EPS {probeResult.layers.enrichment.eps_yoy_pct >= 0 ? '+' : ''}{Math.round(probeResult.layers.enrichment.eps_yoy_pct)}%
                          </span>
                        ) : (
                          <span style={{ color: 'var(--mc-warn)' }}>
                            ⚠ Screener/NSE financials missing
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ padding: '6px 8px', backgroundColor: 'var(--mc-bg-0)', borderRadius: 4, borderLeft: `3px solid ${probeResult.layers?.graded?.found ? 'var(--mc-bullish)' : 'var(--mc-bearish)'}` }}>
                      <div style={{ fontSize: 9.5, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.4px' }}>L3 · GRADED</div>
                      <div style={{ fontSize: 10.5, marginTop: 2 }}>
                        {probeResult.layers?.graded?.found ? (
                          <span style={{ color: 'var(--mc-bullish)' }}>
                            ✓ {probeResult.layers.graded.tier}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--mc-bearish)' }}>
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
      <div style={{ padding: '10px 24px', borderBottom: '1px solid var(--mc-bg-4)', backgroundColor: 'var(--mc-bg-0)', display: 'flex', gap: 6 }}>
        <button onClick={() => setViewMode('CALENDAR')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 6, border: `1px solid ${viewMode === 'CALENDAR' ? 'color-mix(in srgb, var(--mc-cyan) 38%, transparent)' : 'var(--mc-border-1)'}`, backgroundColor: viewMode === 'CALENDAR' ? 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)' : 'transparent', color: viewMode === 'CALENDAR' ? 'var(--mc-cyan)' : 'var(--mc-text-3)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          <Grid3X3 style={{ width: 12, height: 12 }} /> Calendar
        </button>
        <button onClick={() => setViewMode('GRADED')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 6, border: `1px solid ${viewMode === 'GRADED' ? 'color-mix(in srgb, var(--mc-cyan) 38%, transparent)' : 'var(--mc-border-1)'}`, backgroundColor: viewMode === 'GRADED' ? 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)' : 'transparent', color: viewMode === 'GRADED' ? 'var(--mc-cyan)' : 'var(--mc-text-3)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          <FileText style={{ width: 12, height: 12 }} /> Graded Tiers
        </button>
        <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--mc-text-4)', alignSelf: 'center' }}>
          {viewMode === 'CALENDAR' ? `${calRange.from} → ${calRange.to} · ${calData?.total ?? 0} filings` : (windowOn ? `${win.rows.length} companies (${win.entries.length} results) · ${win.progress.ready}/${win.progress.total} days` : `${view.candidates_total} graded`)}
        </span>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <div className="mc-flow-mobile" style={{
        flex: 1, overflowY: 'auto', padding: '18px 24px',
        display: 'flex', flexDirection: 'column', gap: 14,
        opacity: isStaleView ? 0.5 : 1,
        transition: 'opacity 0.2s',
        pointerEvents: isStaleView ? 'none' : 'auto',
      }}>
        {viewMode === 'CALENDAR' && (
          <CalendarView data={calData} loading={calLoading} from={calRange.from} to={calRange.to} onPickDate={(d) => { setFilterDate(d); setViewMode('GRADED'); }} />
        )}
        {viewMode === 'GRADED' && !windowOn && isLoading && view.candidates_total === 0 && (
          <div style={{ color: 'var(--mc-text-4)', fontSize: 13, padding: 40, textAlign: 'center' }}>Fetching live results from BSE/NSE + 12 Indian results feeds…</div>
        )}
        {viewMode === 'GRADED' && error && (
          <div style={{ color: 'var(--mc-bearish)', fontSize: 13, padding: 40, textAlign: 'center', backgroundColor: 'var(--mc-bg-1)', border: '1px solid color-mix(in srgb, var(--mc-bearish) 25%, transparent)', borderRadius: 10 }}>
            Error fetching earnings pipeline. Retry in a moment.
          </div>
        )}
        {viewMode === 'GRADED' && !windowOn && !isLoading && view.candidates_total === 0 && !error && (() => {
          // PATCH 0152.2 / PATCH 0495 / PATCH 0497 — when picked date has
          // nothing, surface the busiest of the past 14 days as one-click jumps.
          //
          // 0497: hub.results was stale (Apr 30 cutoff when EarningsPulse had
          // 47-100 daily filings May 15-18). Now probe the graded endpoint
          // directly via the recentPopulatedDates state which is populated by
          // the effect below. That state reflects live-NSE-augmented graded
          // data, not the stale hub.
          // PATCH 0560 — use IST date for "today" boundary.
          const todayIso = todayIstISO();
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
            <div style={{ color: 'var(--mc-text-3)', fontSize: 13, padding: '36px 28px', textAlign: 'center', backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: 10 }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>📭</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--mc-text-1)', marginBottom: 4 }}>
                No earnings filings for {filingDateLabel}
              </div>
              <div style={{ fontSize: 12, color: 'var(--mc-text-4)', marginBottom: 14, lineHeight: 1.5 }}>
                NSE + BSE corporate-actions pipeline polled. No Q4 results announced for this date.
                {lastScraped && <><br/><span style={{ fontSize: 10.5, color: 'var(--mc-text-4)' }}>📡 Calendar last refreshed: <strong style={{ color: 'var(--mc-text-3)' }}>{lastScraped}</strong></span></>}
              </div>
              {rankedDates.length > 0 && (
                <>
                  <div style={{ fontSize: 11, color: 'var(--mc-text-3)', marginBottom: 8, fontWeight: 700, letterSpacing: '0.3px' }}>
                    📅 BUSIEST RECENT DATES
                  </div>
                  <div style={{ marginTop: 4, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
                    {rankedDates.map(([d, count], i) => (
                      <button key={d} onClick={() => setFilterDate(d)} style={{
                        padding: '8px 14px', borderRadius: 6,
                        border: `1px solid ${i === 0 ? 'color-mix(in srgb, var(--mc-bullish) 50%, transparent)' : 'color-mix(in srgb, var(--mc-cyan) 25%, transparent)'}`,
                        backgroundColor: i === 0 ? 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)' : 'color-mix(in srgb, var(--mc-cyan) 3%, transparent)',
                        color: i === 0 ? 'var(--mc-bullish)' : 'var(--mc-cyan)',
                        fontSize: 12, fontWeight: 700, cursor: 'pointer',
                      }}>
                        → {fmtDate(d)} <span style={{ color: i === 0 ? 'color-mix(in srgb, var(--mc-bullish) 60%, transparent)' : 'color-mix(in srgb, var(--mc-cyan) 60%, transparent)', fontWeight: 500 }}>({count} filings)</span>
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
                            try { localStorage.removeItem('mc:graded:v10:' + d); localStorage.removeItem('mc:graded:v9:' + d); localStorage.removeItem('mc:graded:v8:' + d); } catch {}  // PATCH 0992
                            refetch();
                            refetchHub();
                          } catch {}
                        }}
                        style={{
                          padding: '8px 16px', borderRadius: 6,
                          border: '1px solid var(--mc-bullish)', backgroundColor: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)',
                          color: 'var(--mc-bullish)', fontSize: 12, fontWeight: 800, cursor: 'pointer',
                          letterSpacing: '0.3px',
                        }}
                      >
                        🔄 FORCE NSE/BSE RE-SCAN THIS DATE
                      </button>
                    )}
                    <button onClick={() => setFilterDate('')} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--mc-bg-4)', backgroundColor: 'transparent', color: 'var(--mc-text-3)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                      Auto-pick latest
                    </button>
                    <a href="https://www.nseindia.com/companies-listing/corporate-filings-financial-results" target="_blank" rel="noopener noreferrer" style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)', backgroundColor: 'color-mix(in srgb, var(--mc-warn) 6%, transparent)', color: 'var(--mc-warn)', fontSize: 11, fontWeight: 700, textDecoration: 'none', cursor: 'pointer' }}>
                      NSE Filings →
                    </a>
                  </div>
                  <div style={{ marginTop: 10, fontSize: 10.5, color: 'var(--mc-warn)', fontStyle: 'italic' }}>
                    💡 Companies DO file on weekends during peak earnings season. Hit ‘Force re-scan’ if you believe this date should have filings — bypasses all caches and re-polls NSE+BSE directly.
                  </div>
                </>
              )}
            </div>
          );
        })()}
        {/* PATCH 0912 — SCHEDULED TODAY panel.
            User complaint: "see lot of companies in one week reported but
            you show only few companeis in graded tiers". Root cause: NSE
            calendar shows ALL scheduled board meetings (118-208/day this
            week), but graded tiers only include companies that have
            ACTUALLY FILED + had financials parsed. We surface the gap
            here so the user sees what's pending vs filed.

            Logic: take calData.by_date[filterDate] (scheduled tickers
            from hub for the selected date), subtract any ticker already
            present in any of the 4 graded tiers, render the remainder as
            clickable NSE filing-page chips. */}
        {viewMode === 'GRADED' && filterDate && calData?.by_date?.[filterDate] && (() => {
          const scheduled = calData.by_date[filterDate] || [];
          const gradedTickers = new Set<string>(
            TIER_ORDER.flatMap((t) => (view.by_tier[t] || []).map((s) => (s.ticker || '').toUpperCase()))
          );
          // zzz878 — a name already graded on an earlier day for the same quarter is not "pending" here
          const shownElsewhere = new Set<string>(((view as any)?._dropped || []).filter((d: any) => /^already shown on /.test(String(d?.reason || ''))).map((d: any) => String(d.ticker || '').toUpperCase()));
          const pending = scheduled.filter((it) => !gradedTickers.has((it.symbol || '').toUpperCase()) && !shownElsewhere.has((it.symbol || '').toUpperCase()));
          if (pending.length === 0) return null;
          const copyPending = async (txt: string) => {
            try { await navigator.clipboard.writeText(txt); } catch {
              try {
                const ta = document.createElement('textarea');
                ta.value = txt; ta.style.position = 'fixed'; ta.style.top = '-1000px';
                document.body.appendChild(ta); ta.select(); document.execCommand('copy');
                document.body.removeChild(ta);
              } catch {}
            }
          };
          return (
            <div style={{ backgroundColor: 'color-mix(in srgb, var(--mc-warn) 6%, var(--mc-bg-1))', border: '1px solid color-mix(in srgb, var(--mc-warn) 30%, transparent)', borderLeft: '4px solid var(--mc-warn)', borderRadius: 12, padding: '14px 18px' }}>
              {/* Cohort reconciliation banner: makes the day's TRUE total
                  unmistakable so a "1 graded" header never looks like a bug.
                  filed = graded tiers count; pending = this block. */}
              <div style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--mc-warn)', marginBottom: 8, letterSpacing: '0.2px' }}>
                {(() => {
                  const filed = view.candidates_total || 0;
                  const total = filed + pending.length;
                  return `📊 ${total} ${total === 1 ? 'company' : 'companies'} on the calendar for ${filterDate} — ${filed} filed & graded below · ${pending.length} results still pending (shown here).`;
                })()}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--mc-warn)' }}>📅 SCHEDULED TODAY · RESULTS PENDING</span>
                <span style={{ fontSize: 12, color: 'var(--mc-warn)', fontWeight: 800 }}>{pending.length} {pending.length === 1 ? 'company' : 'companies'}</span>
                <span style={{ fontSize: 10, color: 'var(--mc-text-4)' }}>
                  · board meeting announced — financials not filed/parsed YET (nothing dropped)
                </span>
                <span style={{ display: 'inline-flex', gap: 4, marginLeft: 'auto' }}>
                  <button
                    onClick={() => copyPending(pending.map((p) => (p.symbol || '').toUpperCase()).join(','))}
                    title="Copy pending tickers (CSV)"
                    style={{ fontSize: 10, padding: '3px 8px', background: 'transparent', border: '1px solid color-mix(in srgb, var(--mc-cyan) 38%, transparent)', color: 'var(--mc-cyan)', borderRadius: 4, cursor: 'pointer', fontWeight: 700 }}
                  >📋 CSV</button>
                  <button
                    onClick={() => copyPending(pending.map((p) => `NSE:${(p.symbol || '').toUpperCase()}`).join(','))}
                    title="Copy as NSE:TICKER for TradingView"
                    style={{ fontSize: 10, padding: '3px 8px', background: 'transparent', border: '1px solid color-mix(in srgb, var(--mc-cyan) 38%, transparent)', color: 'var(--mc-cyan)', borderRadius: 4, cursor: 'pointer', fontWeight: 700 }}
                  >📊 TradingView</button>
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--mc-text-3)', marginBottom: 8, lineHeight: 1.5 }}>
                These companies announced a board meeting for {filterDate} but their results aren&apos;t in the parser yet.
                Graded tiers below show only filings that have actually been published + parsed. As each company files
                throughout the day, they&apos;ll move out of this list and into the appropriate grade tier.{' '}
                <button onClick={() => refetch()} style={{ background: 'transparent', border: 'none', color: 'var(--mc-cyan)', cursor: 'pointer', fontSize: 11, fontWeight: 700, padding: 0, textDecoration: 'underline' }}>
                  ↻ Refresh to pull latest filings
                </button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {pending.slice(0, 60).map((it, i) => (
                  <a key={`${filterDate}::${it.symbol || 'nosym'}::${it.company || ''}::${i}`} href={it.source_url} target="_blank" rel="noopener noreferrer"
                    title={`${it.company || it.symbol} · click to open NSE filing page`}
                    style={{ fontSize: 10.5, padding: '2px 6px', borderRadius: 3, backgroundColor: 'var(--mc-bg-3)', color: 'var(--mc-text-3)', border: '1px solid #2A3550', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', textDecoration: 'none', fontWeight: 700 }}>
                    {it.symbol}
                  </a>
                ))}
                {pending.length > 60 && (
                  <span style={{ fontSize: 10.5, color: 'var(--mc-text-4)', padding: '2px 6px' }}>
                    +{pending.length - 60} more · use 📋 CSV to copy all
                  </span>
                )}
              </div>
            </div>
          );
        })()}
        {/* zzz818 — a tier chip that leaves nothing on this date says so. */}
        {viewMode === 'GRADED' && !windowOn && tierFilterOn && view.candidates_total > 0
          && TIER_ORDER.every((t) => !passesTier({ tier: t }, tierSel) || applyRowFilters(view.by_tier[t] || []).length === 0) && (
          <div className="eo-tier-empty" style={{ color: 'var(--mc-text-2)', fontSize: 13, padding: '24px', textAlign: 'center', backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: 10 }}>
            {tierEmptyMessage(tierSel, 'date')}.{' '}
            <button onClick={() => setTierSel([])} style={{ background: 'none', border: 'none', color: 'var(--mc-cyan)', fontWeight: 800, cursor: 'pointer', fontSize: 13 }}>Show all tiers</button>
          </div>
        )}
        {viewMode === 'GRADED' && !windowOn && TIER_ORDER.map((tier) => {
          // PATCH 1017 / 1022 / zzz703 — ELITE · PEAD · MULTIBAGGER · turnaround ·
          // radar · beat+cheap, then market cap, then pattern (applyRowFilters).
          // zzz815 — freshest filing first within the tier by default.
          let stocks = applyRowFilters(view.by_tier[tier] || []).slice().sort(withinTierOrder);
          // zzz817 — the tier chips filter: an unpicked tier shows nothing
          // (except a searched-for card, below).
          if (!passesTier({ tier }, tierSel)) stocks = [];
          // zzz812 — a searched-for card is shown even when the filters hide
          // it, with a note naming the filters. Never a silent miss.
          const pinnedRow = searchPin ? (view.by_tier[tier] || []).find((x) => x.ticker.toUpperCase() === searchPin.ticker) : undefined;
          const pinnedReasons = pinnedRow ? searchHiddenReasons(pinnedRow).filter((r) => !/collapsed|Calendar view/.test(r)) : [];
          if (pinnedRow && !stocks.some((x) => x.ticker === pinnedRow.ticker)) stocks = [pinnedRow, ...stocks];
          if (stocks.length === 0) return null;
          const meta = TIER_META[tier];
          // PATCH 1017 — force-expand tiers when a filter is active so matches show immediately
          // zzz817 — a picked tier chip opens its tier too.
          const _filterActive = anyRowFilter || tierFilterOn;
          const isOpen = _filterActive || !!pinnedRow ? true : expanded[tier];
          return (
            <div key={tier} style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderLeft: `4px solid ${meta.color}`, borderRadius: 12 }}>
              <button onClick={() => setExpanded((s) => ({ ...s, [tier]: !s[tier] }))}
                style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', color: 'inherit' }}>
                {isOpen ? <ChevronDown style={{ width: 16, height: 16, color: 'var(--mc-text-4)' }} /> : <ChevronRight style={{ width: 16, height: 16, color: 'var(--mc-text-4)' }} />}
                <span style={{ fontSize: 16, fontWeight: 800, color: meta.color }}>{meta.icon} {meta.label}</span>
                <span style={{ fontSize: 12, color: 'var(--mc-text-3)' }}>{stocks.length} {stocks.length === 1 ? 'company' : 'companies'}</span>
                <span style={{ fontSize: 11, color: 'var(--mc-text-4)' }}>· {meta.tagline}</span>
              </button>
              {isOpen && (
                <div style={{ padding: '0 18px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(360px, 100%), 1fr))', gap: 12 }}>
                  {stocks.map((s) => (pinnedRow && s.ticker === pinnedRow.ticker && pinnedReasons.length > 0) ? (
                    <div key={s.ticker + ':' + s.company} style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--mc-warn, #F59E0B)' }}>
                        🔍 {s.ticker} {hiddenNote(pinnedReasons)} ·{' '}
                        <button onClick={() => setSearchPin(null)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--mc-cyan)', cursor: 'pointer', fontSize: 10.5, fontWeight: 800 }}>hide</button>
                      </div>
                      <EarningsCard stock={s} isFresh={freshTickers.has(s.ticker)} radar={radarMap.get(String(s.ticker || '').toUpperCase())} />
                    </div>
                  ) : <EarningsCard key={s.ticker + ':' + s.company} stock={s} isFresh={freshTickers.has(s.ticker)} radar={radarMap.get(String(s.ticker || '').toUpperCase())} />)}
                </div>
              )}
            </div>
          );
        })}
        {/* ═══ MULTI-DAY WINDOW  (zzz814) ═══════════════════════════════════
            One row per company (its latest result in the window). By date:
            newest date first, BLOCKBUSTER → STRONG → MIXED → AVOID inside a
            day. By tier: every BLOCKBUSTER first, newest first inside a tier.
            The same filters as a single date; collapsed tiers stay collapsed
            (MIXED and AVOID by default) and say how many they hold. */}
        {viewMode === 'GRADED' && windowOn && (() => {
          const p = win.progress;
          const failedDates = win.dates.filter((d) => win.states[d] === 'failed');
          const staleDates = win.dates.filter((d) => win.states[d] === 'stale');
          const oldest = win.dates[win.dates.length - 1] || resolvedDateForGrading;
          const weekendDates = win.dates.filter((d) => { const w = new Date(d + 'T00:00:00Z').getUTCDay(); return w === 0 || w === 6; }).length;
          const fmtLong = (iso: string) => {
            const dt = new Date(iso + 'T00:00:00Z');
            return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getUTCDay()]} ${fmtShortDate(iso)} ${dt.getUTCFullYear()}`;
          };
          type WRow = WindowRow<ParsedEarning>;
          // zzz817 — filters ran on every result, then one row per company
          // (windowFiltered); the tier chips pick from that.
          let rows = windowFiltered.filter((r) => passesTier(r, tierSel)) as WRow[];
          const pinnedRow = searchPin ? win.rows.find((r) => r.ticker.toUpperCase() === searchPin.ticker) : undefined;
          const pinnedReasons = pinnedRow ? searchHiddenReasons(pinnedRow).filter((r) => !/collapsed|Calendar view/.test(r)) : [];
          if (pinnedRow && !rows.some((r) => r.ticker === pinnedRow.ticker)) rows = [pinnedRow, ...rows];
          const isPinnedRow = (r: WRow) => !!pinnedRow && r.ticker === pinnedRow.ticker;
          // A tier chip or any other filter shows everything it selects; with
          // no filter each day folds its own MIXED / AVOID.
          const showAllInDay = tierFilterOn || anyRowFilter;
          const totals = windowTotals(win.days, win.entries, win.rows);
          const issues = windowIssues(win.days, win.entries, win.bad, win.rows);
          const laterByDate = shownElsewhereByDate(rows);
          // zzz820 — a board meeting with no confirmed results filing is not a
          // company that "filed but couldn't be graded": counted apart. Every
          // reason says when the day was last checked.
          const filedNotGraded = issues.notGraded.filter((x) => !x.unconfirmed);
          const unconfirmedDrops = issues.notGraded.filter((x) => x.unconfirmed);
          const notGradedByDate: Record<string, string[]> = {};
          for (const x of filedNotGraded) (notGradedByDate[x.date] ||= []).push(`${x.ticker} — ${dropReasonWithCheck(x.reason, x.checked)}`);
          for (const x of issues.badRows) (notGradedByDate[x.date] ||= []).push(`${x.ticker} — ${x.reason}`);
          const unconfirmedByDate: Record<string, string[]> = {};
          for (const x of unconfirmedDrops) (unconfirmedByDate[x.date] ||= []).push(`${x.ticker} — ${dropReasonWithCheck(x.reason, x.checked)}`);
          const notGradedN = filedNotGraded.length + issues.badRows.length;
          const notGradedReasons: Record<string, number> = {};
          const lastCheckedByReason: Record<string, string> = {};
          for (const x of filedNotGraded) {
            notGradedReasons[x.reason] = (notGradedReasons[x.reason] || 0) + 1;
            const c = String(x.checked || '').slice(0, 10);
            if (c && (!lastCheckedByReason[x.reason] || c < lastCheckedByReason[x.reason])) lastCheckedByReason[x.reason] = c;
          }
          for (const x of issues.badRows) { const k = x.reason.startsWith('unrecognised') ? 'unrecognised tier' : x.reason; notGradedReasons[k] = (notGradedReasons[k] || 0) + 1; }
          const openDate = (d: string) => { setWindowDays(1); setFilterDate(d); };
          let budget = windowRenderLimit;
          const cardFor = (s: WRow, showDate: boolean) => {
            const notes: string[] = [];
            if (showDate) notes.push(`📅 ${fmtLong(s._window_date)}`);
            const newer = s._newer || [];
            if (s._earlier && s._earlier.length) {
              notes.push(`also reported ${s._earlier.map((e) => `${fmtShortDate(e.date)} (${TIER_META[e.tier as EarningsTier]?.icon || ''} ${e.tier})`).join(', ')}${newer.length ? '' : ' — showing the latest'}`);
            } else if (s._also_reported.length) {
              notes.push(`also reported ${s._also_reported.map(fmtShortDate).join(', ')}${newer.length ? '' : ' — showing the latest'}`);
            }
            for (const n of newer) {
              notes.push(n.why === 'filtered'
                ? `newer result ${fmtShortDate(n.date)} (${n.tier}) is hidden by your filters — showing ${fmtShortDate(s._window_date)}`
                : `newer filing ${fmtShortDate(n.date)} has no financial numbers yet — showing the graded ${fmtShortDate(s._window_date)} result`);
            }
            if (hasNoFinancialData(s)) notes.push('filed, but no financial numbers yet — open the date to retry');
            if (s._engine_stale) notes.push(`graded under the previous rules (${s._engine || 'older engine'})`);
            // zzz820 — older payloads never recorded RS / Stage: say so.
            const nr = notRecordedNote(s);
            if (nr) notes.push(nr);
            const isPinned = isPinnedRow(s) && pinnedReasons.length > 0;
            return (
              <div key={s._window_date + ':' + s.ticker + ':' + s.company} style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                {isPinned && (
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--mc-warn, #F59E0B)' }}>
                    🔍 {s.ticker} {hiddenNote(pinnedReasons)} ·{' '}
                    <button onClick={() => setSearchPin(null)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--mc-cyan)', cursor: 'pointer', fontSize: 10.5, fontWeight: 800 }}>hide</button>
                  </div>
                )}
                {notes.length > 0 && (
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: s._engine_stale || newer.length ? 'var(--mc-warn)' : 'var(--mc-text-3)' }}>{notes.join(' · ')}</div>
                )}
                <EarningsCard stock={s} isFresh={freshTickers.has(s.ticker)} radar={radarMap.get(String(s.ticker || '').toUpperCase())} />
              </div>
            );
          };
          const takeCards = (list: WRow[], showDate: boolean) => {
            const out = list.slice(0, Math.max(0, budget)).map((s) => cardFor(s, showDate));
            budget -= out.length;
            return out;
          };
          const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(360px, 100%), 1fr))', gap: 12 } as const;
          const toggleBtn = (v: WindowView, label: string) => (
            <button key={v} onClick={() => setWindowView(v)}
              style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 800, cursor: 'pointer',
                border: `1px solid ${windowView === v ? 'var(--mc-cyan)' : 'var(--mc-bg-4)'}`,
                background: windowView === v ? 'color-mix(in srgb, var(--mc-cyan) 14%, transparent)' : 'transparent',
                color: windowView === v ? 'var(--mc-cyan)' : 'var(--mc-text-3)',
              }}>{label}</button>
          );
          const tierCountChips = (c: Record<WindowTier, number>) => TIER_ORDER.map((t) => (c[t] > 0
            ? <span key={t} style={{ color: `color-mix(in srgb, ${TIER_META[t].color} 60%, var(--mc-text-1))`, fontWeight: 800 }}>{TIER_META[t].icon} {c[t]}</span>
            : null));
          // What is on screen, per view — the render limit counts only these.
          const dGroups = windowView === 'date'
            ? dayGroups(rows, { openDays: openWindowDays, showAll: showAllInDay, within: withinTierOrder, keep: isPinnedRow })
            : [];
          const tGroups = windowView === 'tier'
            ? sortByTier(rows, withinTierOrder).map((g) => {
              const open = showAllInDay || !!expanded[g.tier as EarningsTier];
              return { ...g, open, list: open ? g.rows : g.rows.filter(isPinnedRow) };
            })
            : [];
          const visibleTotal = windowView === 'date'
            ? dGroups.reduce((n, g) => n + g.visible.length, 0)
            : tGroups.reduce((n, g) => n + g.list.length, 0);
          const foldedTotal = dGroups.reduce((n, g) => n + g.folded.MIXED + g.folded.AVOID, 0);
          return (
            <>
              <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderLeft: '4px solid var(--mc-cyan)', borderRadius: 12, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--mc-text-1)' }}>
                    🗓 {windowDays}-session window · {fmtShortDate(oldest)} → {fmtShortDate(resolvedDateForGrading)}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--mc-text-4)' }}>
                    {win.dates.length} dates{weekendDates > 0 ? ` (${weekendDates} weekend days included — Indian companies file on them)` : ''}
                  </span>
                  <span className="mc-no-print" style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
                    {toggleBtn('date', '📅 By date')}
                    {toggleBtn('tier', '🏆 By tier')}
                  </span>
                </div>
                {/* zzz817 — the header numbers, stated plainly: results read,
                    minus the companies that reported more than once, equals
                    the companies listed. */}
                <div className="eo-window-totals" style={{ fontSize: 12.5, color: 'var(--mc-text-1)', fontWeight: 700 }}>
                  {totals.line}
                  {(tierFilterOn || anyRowFilter) && (
                    <span style={{ color: 'var(--mc-text-3)', fontWeight: 600 }}> · {rows.length.toLocaleString('en-IN')} match your filters</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: p.done ? 'var(--mc-bullish)' : 'var(--mc-text-2)', fontWeight: 700 }}>
                  {p.done && p.failed === 0 ? '✓ ' : ''}{p.line}
                </div>
                {!p.done && (
                  <div className="mc-no-print" style={{ height: 4, borderRadius: 2, background: 'var(--mc-bg-3)', overflow: 'hidden' }}>
                    <div style={{ width: `${p.total ? Math.round((p.ready / p.total) * 100) : 0}%`, height: '100%', background: 'var(--mc-cyan)', transition: 'width 0.3s' }} />
                  </div>
                )}
                {(p.queued > 0 || p.grading) && (
                  <div style={{ fontSize: 11, color: 'var(--mc-text-4)', lineHeight: 1.5 }}>
                    Days already graded appear at once. Days never graded are graded here one at a time, newest first, through the same India path as a single date (NSE/BSE list + Screener enrichment, rate-limited) — typically 20–60 seconds each. Results show as each day lands; nothing is graded twice.
                  </div>
                )}
                {staleDates.length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--mc-warn)', lineHeight: 1.5 }}>
                    {staleDates.length} {staleDates.length === 1 ? 'date was' : 'dates were'} graded under the previous rules ({Array.from(new Set(staleDates.map((d) => win.days.find((x) => x.date === d)?.engine).filter(Boolean))).join(', ')}; current {GRADED_ENGINE_LABEL}) and {staleDates.length === 1 ? 'is' : 'are'} shown as stored — every company on them is listed. {staleDates.length === 1 ? 'It is' : 'They are'} being rebuilt automatically under the current rules, oldest rules first, a few dates per run (several runs a day), so the older grades catch up over a few days. Open a single date to rebuild it now.
                  </div>
                )}
                {failedDates.length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--mc-bearish)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span>⚠ Not loaded: {failedDates.map((d) => (
                      <span key={d} title={win.errors[d] || ''} style={{ textDecoration: 'underline dotted', marginRight: 4 }}>{fmtShortDate(d)}</span>
                    ))}</span>
                    <button className="mc-no-print" onClick={win.retryFailed}
                      style={{ padding: '3px 10px', borderRadius: 5, border: '1px solid var(--mc-bearish)', background: 'transparent', color: 'var(--mc-bearish)', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
                      ↻ Retry {failedDates.length}
                    </button>
                  </div>
                )}
                {/* zzz817 — nothing is dropped silently: companies that filed but
                    could not be graded, cards without numbers or a price, and
                    days read while the results feed was down are all counted. */}
                {notGradedN > 0 && (
                  <div className="eo-window-issues" style={{ fontSize: 11, color: 'var(--mc-warn)', lineHeight: 1.6 }}>
                    ⚠ <strong>{notGradedN.toLocaleString('en-IN')} {notGradedN === 1 ? 'company' : 'companies'} filed but couldn&apos;t be graded</strong>
                    {' '}({Object.entries(notGradedReasons).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}: ${n}${lastCheckedByReason[k] ? ` (oldest check ${fmtShortDate(lastCheckedByReason[k])})` : ''}`).join(' · ')}) — each date is re-checked automatically about once a day while data is still missing; open a date to retry now:{' '}
                    {Object.keys(notGradedByDate).sort().reverse().slice(0, 14).map((d) => (
                      <button key={d} onClick={() => openDate(d)} title={notGradedByDate[d].join('\n')}
                        style={{ background: 'none', border: 'none', padding: '0 6px 0 0', color: 'var(--mc-cyan)', fontSize: 11, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline dotted' }}>
                        {fmtShortDate(d)} ({notGradedByDate[d].length})
                      </button>
                    ))}
                    {Object.keys(notGradedByDate).length > 14 && <span>+{Object.keys(notGradedByDate).length - 14} more dates</span>}
                  </div>
                )}
                {unconfirmedDrops.length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--mc-text-3)', lineHeight: 1.5 }}
                    title={Object.keys(unconfirmedByDate).sort().reverse().map((d) => `${fmtShortDate(d)}: ${unconfirmedByDate[d].join(', ')}`).join('\n')}>
                    ⓘ {unconfirmedDrops.length.toLocaleString('en-IN')} {unconfirmedDrops.length === 1 ? 'company had' : 'companies had'} a results board meeting in the window but no confirmed results filing yet — not graded, not counted as a failure (hover for the list).
                  </div>
                )}
                {(issues.noData.length > 0 || issues.noPrice > 0) && (
                  <div style={{ fontSize: 11, color: 'var(--mc-text-3)', lineHeight: 1.5 }}>
                    {issues.noData.length > 0 && <>ⓘ {issues.noData.length.toLocaleString('en-IN')} {issues.noData.length === 1 ? 'company is' : 'companies are'} listed without financial numbers yet (the card says so — open its date to retry). </>}
                    {issues.noPrice > 0 && <>ⓘ {issues.noPrice.toLocaleString('en-IN')} {issues.noPrice === 1 ? 'card has' : 'cards have'} no share price yet.</>}
                  </div>
                )}
                {issues.partialDays.length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--mc-warn)', lineHeight: 1.5 }}>
                    ⚠ {issues.partialDays.length} {issues.partialDays.length === 1 ? 'day was' : 'days were'} read while the results feed was down — the list for {issues.partialDays.length === 1 ? 'it' : 'them'} may be partial:{' '}
                    {issues.partialDays.map((d) => (
                      <button key={d} onClick={() => openDate(d)} style={{ background: 'none', border: 'none', padding: '0 6px 0 0', color: 'var(--mc-cyan)', fontSize: 11, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline dotted' }}>{fmtShortDate(d)}</button>
                    ))}
                  </div>
                )}
                {windowView === 'date' && !showAllInDay && foldedTotal > 0 && (
                  <div className="mc-no-print" style={{ fontSize: 11, color: 'var(--mc-text-3)', lineHeight: 1.5 }}>
                    Each day shows ⭐ BLOCKBUSTER and 🟢 STRONG first; its 🟡 MIXED and 🔴 AVOID are one click away under that day. To list only one tier across the whole window, click its chip above (⭐ 🟢 🟡 🔴).
                  </div>
                )}
              </div>

              {win.rows.length === 0 && p.done && (
                <div style={{ color: 'var(--mc-text-3)', fontSize: 13, padding: '28px', textAlign: 'center', backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: 10 }}>
                  {p.failed > 0 ? 'Nothing could be loaded for this window yet — retry the dates above.' : 'No graded results in this window.'}
                </div>
              )}
              {win.rows.length > 0 && rows.length === 0 && (
                <div style={{ color: 'var(--mc-text-3)', fontSize: 13, padding: '28px', textAlign: 'center', backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: 10 }}>
                  {tierFilterOn ? tierEmptyMessage(tierSel, 'window') + '.' : `${win.rows.length} companies in the window — none pass the current filters.`}
                  {tierFilterOn && <> <button onClick={() => setTierSel([])} style={{ background: 'none', border: 'none', color: 'var(--mc-cyan)', fontWeight: 800, cursor: 'pointer', fontSize: 13 }}>Show all tiers</button></>}
                </div>
              )}

              {windowView === 'date' && dGroups.map((g) => {
                if (budget <= 0) return null;
                const stale = win.states[g.date] === 'stale';
                const foldedN = g.folded.MIXED + g.folded.AVOID;
                const dayOpen = openWindowDays.has(g.date);
                const later = laterByDate[g.date] || 0;
                const ng = (notGradedByDate[g.date] || []).length;
                const hasMixedAvoid = g.counts.MIXED + g.counts.AVOID > 0;
                return (
                  <div key={g.date} data-window-date={g.date} style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: 12, padding: '12px 16px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                      <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--mc-text-1)' }}>📅 {fmtLong(g.date)}</span>
                      <span style={{ fontSize: 11.5, color: 'var(--mc-text-3)' }}>{g.rows.length} {g.rows.length === 1 ? 'company' : 'companies'}</span>
                      <span style={{ fontSize: 11.5, display: 'inline-flex', gap: 8 }}>{tierCountChips(g.counts)}</span>
                      {later > 0 && (
                        <span style={{ fontSize: 10.5, color: 'var(--mc-text-4)' }} title="These companies also filed on this date, but are listed under another date in the window — normally their latest result.">
                          · +{later} listed under another date
                        </span>
                      )}
                      {ng > 0 && (
                        <span style={{ fontSize: 10.5, color: 'var(--mc-warn)', fontWeight: 700 }} title={(notGradedByDate[g.date] || []).join('\n')}>
                          · ⚠ {ng} couldn&apos;t be graded
                        </span>
                      )}
                      {stale && <span style={{ fontSize: 10.5, color: 'var(--mc-warn)', fontWeight: 700 }}>· graded under the previous rules</span>}
                      <button className="mc-no-print" onClick={() => openDate(g.date)}
                        title="Open this date on its own (single-date view, where it can be refreshed or re-graded)"
                        style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--mc-cyan)', fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: 0 }}>open date →</button>
                    </div>
                    {g.visible.length > 0 && <div style={gridStyle}>{takeCards(g.visible, false)}</div>}
                    {/* zzz817 — this day's own MIXED / AVOID expander. */}
                    {!showAllInDay && (foldedN > 0 || (dayOpen && hasMixedAvoid)) && (
                      <button className="mc-no-print eo-day-expander"
                        onClick={() => setOpenWindowDays((s) => { const n = new Set(s); if (n.has(g.date)) n.delete(g.date); else n.add(g.date); return n; })}
                        style={{ marginTop: g.visible.length ? 10 : 0, padding: '5px 12px', borderRadius: 8, border: '1px dashed var(--mc-bg-4)', background: 'transparent', color: 'var(--mc-text-2)', fontSize: 11.5, fontWeight: 800, cursor: 'pointer' }}>
                        {dayOpen
                          ? `▴ hide ${[g.counts.MIXED ? `${g.counts.MIXED} MIXED` : '', g.counts.AVOID ? `${g.counts.AVOID} AVOID` : ''].filter(Boolean).join(' · ')}`
                          : `▾ show ${[g.folded.MIXED ? `🟡 ${g.folded.MIXED} MIXED` : '', g.folded.AVOID ? `🔴 ${g.folded.AVOID} AVOID` : ''].filter(Boolean).join(' · ')}`}
                      </button>
                    )}
                  </div>
                );
              })}

              {windowView === 'tier' && tGroups.map((g) => {
                const meta = TIER_META[g.tier];
                const cards = budget > 0 ? takeCards(g.list, true) : [];
                return (
                  <div key={g.tier} style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderLeft: `4px solid ${meta.color}`, borderRadius: 12 }}>
                    <button onClick={() => setExpanded((s) => ({ ...s, [g.tier]: !s[g.tier] }))}
                      style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', color: 'inherit' }}>
                      {g.open ? <ChevronDown style={{ width: 16, height: 16, color: 'var(--mc-text-4)' }} /> : <ChevronRight style={{ width: 16, height: 16, color: 'var(--mc-text-4)' }} />}
                      <span style={{ fontSize: 16, fontWeight: 800, color: `color-mix(in srgb, ${meta.color} 60%, var(--mc-text-1))` }}>{meta.icon} {meta.label}</span>
                      <span style={{ fontSize: 12, color: 'var(--mc-text-3)' }}>{g.rows.length} {g.rows.length === 1 ? 'company' : 'companies'} across the window</span>
                      <span style={{ fontSize: 11, color: 'var(--mc-text-4)' }}>· {g.open ? 'newest first' : 'click to show'}</span>
                    </button>
                    {cards.length > 0 && <div style={{ ...gridStyle, padding: '0 18px 16px' }}>{cards}</div>}
                  </div>
                );
              })}

              {visibleTotal > windowRenderLimit && (
                <button className="mc-no-print" onClick={() => setWindowRenderLimit((n) => n + 120)}
                  style={{ alignSelf: 'center', padding: '8px 18px', borderRadius: 8, border: '1px solid var(--mc-cyan)', background: 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)', color: 'var(--mc-cyan)', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                  Show more — {windowRenderLimit} of {visibleTotal} cards shown
                </button>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}

// zzz814 — engine label for the "previous rules" note (the current namespace).
const GRADED_ENGINE_LABEL = GRADED_CACHE_VERSION;

/**
 * zzz817 — the tier, as a badge next to the company name on every card.
 * Word + icon + colour, so it reads in black-and-white print too. The text
 * colour is the tier colour mixed with the theme's main text colour: darker
 * on the light theme (a yellow MIXED stays readable on white), lighter on
 * the dark one.
 */
function TierBadge({ tier }: { tier: string }) {
  const m = TIER_META[tier as EarningsTier];
  if (!m) return null;
  return (
    <span className="eo-tier-badge" data-tier={tier} title={`${m.label} — ${m.tagline}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3, marginRight: 8, padding: '1px 7px',
        borderRadius: 4, fontSize: 10, fontWeight: 900, letterSpacing: '0.4px', verticalAlign: 'middle', whiteSpace: 'nowrap',
        border: `1.5px solid ${m.color}`,
        backgroundColor: `color-mix(in srgb, ${m.color} 16%, transparent)`,
        color: `color-mix(in srgb, ${m.color} 55%, var(--mc-text-1))`,
        WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
      } as CSSProperties}>
      {m.icon} {m.label}
    </span>
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
  if (p == null || !Number.isFinite(p)) return '—';
  // PATCH 1023 — a sub-1% move rounds to 0 and used to render as the
  // confusing "-0%" / "+0%" (looked like a data bug). Show "flat" instead so
  // a genuine ~0% reaction is visually distinct from missing data ("—").
  const r = Number(p.toFixed(digits));
  if (r === 0) return 'flat';
  return `${r > 0 ? '+' : ''}${r.toFixed(digits)}%`;
}

/**
 * QUALITY × INFLECTION badge — the second axis, rendered beside the tier.
 *
 * The badge shows the quadrant plus BOTH raw scores, because the quadrant alone
 * hides how close a row is to its boundary: Q48/I72 and Q12/I95 are both
 * TURNAROUND ACCELERATORs and are not the same bet. The title attribute lists
 * the components that actually contributed, so the card can show its work
 * rather than asking to be trusted — and components India could not assess are
 * simply absent from that list, never listed as zero.
 */
function QuadrantBadge({ stock }: { stock: ParsedEarning }) {
  const q = stock.quadrant;
  const qual = stock.quality_score;
  const infl = stock.inflection_score;
  // Null renders as nothing. A row we could not score gets no badge at all.
  if (!q || typeof qual !== 'number' || typeof infl !== 'number') return null;
  const meta = QUADRANT_META[q];
  if (!meta) return null;
  const parts = stock.quadrant_parts;
  // zzz820 — words, not the 0–100 numbers (owner rule: no visible scores).
  const fmtParts = (ps?: Array<{ label: string; points: number; of: number }>) =>
    (ps && ps.length) ? ps.map(partWord).join(', ') : 'not assessable from this filing';
  const qualW = axisWord(qual, 'quality');
  const inflW = axisWord(infl, 'inflection');
  const title =
    `${meta.label} — ${meta.tagline}.\n` +
    `QUALITY — ${qualW} (what the business IS): ${fmtParts(parts?.quality)}\n` +
    `INFLECTION — ${inflW} (what it is BECOMING): ${fmtParts(parts?.inflection)}\n` +
    `Independent of the tier — the quadrant never promotes a row.`;
  return (
    <span title={title} style={{
      padding: '1px 6px', borderRadius: 3,
      border: `1px solid ${meta.color}`,
      backgroundColor: `${meta.color}1F`,
      color: meta.color, fontWeight: 800, letterSpacing: '0.3px', whiteSpace: 'nowrap',
    }}>
      {meta.icon} {meta.label}
      <span style={{ fontWeight: 700, opacity: 0.85, marginLeft: 5 }}>· {qualW} · {inflW}</span>
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// THE INDIA AI SUMMARY BLOCK.                                       (zzz700)
//
// The 📝 line above this is template text — tier plus three growth rates,
// assembled in `lib/earnings/grader.ts`. This is the written reading: the
// same tool schema, the same figure verification and the same renderer the US
// card uses, against the results PDF filed with the exchange.
//
// It is opt-in per card because each open costs a model call against a PDF
// that must first be fetched and parsed, and most cards are scrolled past.
// ═══════════════════════════════════════════════════════════════════════════
function IndiaAiSummary({ stock }: { stock: ParsedEarning }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [struct, setStruct] = useState<any>(null);
  // zzz726 — WHICH document was read now travels with the summary. The reader
  // falls back from the exchange results filing to the company's concall
  // transcript, and a transcript read as though it were this quarter's results
  // would be a quietly wrong answer.
  const [prov, setProv] = useState<{
    source_url: string | null; model: string | null;
    kind: string | null; period: string | null; note: string | null;
  }>({ source_url: null, model: null, kind: null, period: null, note: null });
  const [err, setErr] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfErr, setPdfErr] = useState('');

  const commentary = useMemo(() => (struct ? scoreReleaseCommentary(struct) : null), [struct]);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const q = new URLSearchParams({ ticker: stock.ticker });
      if (stock.quarter) q.set('quarter', stock.quarter);
      if (stock.filing_date) q.set('filing_date', String(stock.filing_date).slice(0, 10));
      const res = await fetch(`/api/v1/india/ai-summary?${q}`, { cache: 'no-store' });
      const j = await res.json();
      if (j?.ok && j.structured) {
        setStruct(j.structured);
        setProv({
          source_url: j.source_url || null, model: j.model || null,
          kind: j.document_kind || null, period: j.document_period || null, note: j.document_note || null,
        });
        setState('done');
      } else {
        setErr(j?.error || 'No summary is available for this filing.');
        setState('error');
      }
    } catch (e: any) {
      setErr(`The summary could not be fetched (${String(e?.message || e)}).`);
      setState('error');
    }
  }, [stock.ticker, stock.quarter, stock.filing_date]);

  const downloadPdf = useCallback(async () => {
    if (!struct) return;
    setPdfBusy(true); setPdfErr('');
    try {
      const { exportUsSummaryPdf } = await import('@/lib/earnings/us-summary-pdf');
      await exportUsSummaryPdf({
        ticker: stock.ticker, company: stock.company, quarter: stock.quarter,
        tier: stock.tier, filingDate: stock.filing_date,
        sourceUrl: prov.source_url, model: prov.model, d: struct, commentary,
      });
    } catch (e: any) {
      setPdfErr(`The PDF could not be written (${String(e?.message || e)}).`);
    } finally { setPdfBusy(false); }
  }, [struct, stock, prov, commentary]);

  const chip = (active: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer',
    fontSize: 10.5, fontWeight: 700, padding: '3px 10px', borderRadius: 999,
    border: `1px solid ${active ? 'color-mix(in srgb, var(--mc-cyan) 45%, transparent)' : 'var(--mc-bg-4)'}`,
    backgroundColor: active ? 'color-mix(in srgb, var(--mc-cyan) 14%, transparent)' : 'var(--mc-bg-1)',
    color: active ? 'var(--mc-cyan)' : 'var(--mc-text-2)',
  });

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          onClick={() => { const n = !open; setOpen(n); if (n && state === 'idle') void load(); }}
          aria-expanded={open}
          title="A written reading of the results PDF filed with the exchange — why the margin moved, the catalysts, capex, utilisation, order book and what will not repeat. Every figure is checked against the filing."
          style={chip(open)}
        >
          ✨ {state === 'loading' ? 'Reading the filing…' : 'AI Summary'}
        </button>
        {state === 'done' && struct && (
          <button onClick={downloadPdf} disabled={pdfBusy} style={{ ...chip(false), cursor: pdfBusy ? 'progress' : 'pointer', opacity: pdfBusy ? 0.6 : 1 }}
            title="Download this summary as a one-page A4 PDF on white.">
            ⬇ {pdfBusy ? 'Writing PDF…' : 'PDF'}
          </button>
        )}
        {prov.source_url && (
          <a href={prov.source_url} target="_blank" rel="noreferrer" title={prov.note || undefined}
            style={{ ...chip(false), textDecoration: 'none' }}>
            📄 {prov.kind === 'transcript' ? 'Concall transcript'
              : prov.kind === 'ppt' ? 'Investor presentation'
                : prov.kind === 'annual_report' ? 'Annual report' : 'Filing'}
            {prov.period ? ` · ${prov.period}` : ''}
          </a>
        )}
      </div>
      {pdfErr && <div style={{ marginTop: 5, fontSize: 10, color: '#F59E0B' }}>{pdfErr}</div>}
      {open && (
        <div style={{
          marginTop: 7, padding: '10px 12px', borderRadius: 8,
          backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)',
          borderLeft: '3px solid var(--mc-cyan)',
        }}>
          {state === 'loading' && (
            <div style={{ fontSize: 11, color: 'var(--mc-text-3)' }}>
              Fetching and reading the latest document for {stock.ticker} — the filed results if the exchange feed still
              carries them, otherwise the concall transcript from its screener.in document list. A few seconds the first time.
            </div>
          )}
          {state === 'error' && <div style={{ fontSize: 11, color: '#F59E0B' }}>{err}</div>}
          {state === 'done' && prov.note && (
            <div style={{ marginBottom: 8, fontSize: 10, color: 'var(--mc-text-4)', lineHeight: 1.5 }}>
              ℹ {prov.note}
            </div>
          )}
          {state === 'done' && commentary && (
            <CommentaryScoreBlock c={commentary} hasTranscript={prov.kind === 'transcript'} />
          )}
          {state === 'done' && struct && <SummaryView d={struct} />}
          {state === 'done' && (
            <div style={{ marginTop: 8, fontSize: 9.5, color: 'var(--mc-text-4)', lineHeight: 1.5 }}>
              Written from the company&rsquo;s own filed results only — no news, no estimates, no market reaction. Every
              figure is checked against the filing before it is shown, and any line carrying a figure the filing does
              not print is dropped. Empty sections mean the filing is silent on them. Educational, not investment advice.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EarningsCard({ stock, isFresh, radar }: { stock: ParsedEarning; isFresh?: boolean; radar?: { transformation_score: number } | null }) {
  const tierColor = ((stock as any)._tier_unconfirmed || yearAgoUnverified(stock)) ? '#94A3B8' : TIER_META[stock.tier].color;
  // zzz696 — badge chips are opt-in, shared with the US tab through one key.
  const [showBadges] = useCardBadges();
  // zzz505 — newly-listed companies have no year-ago quarter, so the YoY tiles
  // render "—". But we now carry their short sequential history, so switch the
  // Sales/EPS tiles to QUARTER-ON-QUARTER (QoQ) — the correct comparison for an
  // IPO — and fill them with real momentum instead of a blank.
  const _isNewCard = (stock.caveat_tags || []).includes('newly listed');
  // zzz822 — caveat chips without the cap reason (shown once, under the badge).
  const _cavs = caveatTagsForDisplay(stock);
  const _qs: number[] = Array.isArray((stock as any).quarters_sales) ? (stock as any).quarters_sales.filter((x: any) => typeof x === 'number') : [];
  const _qe: number[] = Array.isArray((stock as any).quarters_eps) ? (stock as any).quarters_eps.filter((x: any) => typeof x === 'number') : [];
  const _salesQoQ = (_qs.length >= 2 && _qs[_qs.length - 2] > 0) ? (_qs[_qs.length - 1] / _qs[_qs.length - 2] - 1) * 100 : null;
  const _salesPrevQ = _qs.length >= 2 ? _qs[_qs.length - 2] : null;
  const _epsQoQ = (_qe.length >= 2 && _qe[_qe.length - 2] > 0) ? (_qe[_qe.length - 1] / _qe[_qe.length - 2] - 1) * 100 : null;
  const _epsPrevQ = _qe.length >= 2 ? _qe[_qe.length - 2] : null;
  const _qp: number[] = Array.isArray((stock as any).quarters_pat) ? (stock as any).quarters_pat.filter((x: any) => typeof x === 'number') : [];
  const _patQoQ = (_qp.length >= 2 && _qp[_qp.length - 2] > 0) ? (_qp[_qp.length - 1] / _qp[_qp.length - 2] - 1) * 100 : null;
  const _patPrevQ = _qp.length >= 2 ? _qp[_qp.length - 2] : null;
  const _useSalesQoQ = _isNewCard && stock.sales_yoy_pct == null && _salesQoQ != null;
  const _useEpsQoQ = _isNewCard && stock.eps_yoy_pct == null && _epsQoQ != null;
  const _usePatQoQ = _isNewCard && stock.net_profit_yoy_pct == null && _patQoQ != null;
  // zzz800 — when either quarter is a loss there is no honest growth %; the
  // tile says what happened ("LOSS NARROWED") and the ₹ line below shows both
  // figures. Computed from the absolutes so payloads cached before the grader
  // stopped emitting "+77%" on a loss base read correctly too.
  const _patTraj = profitTrajectory(stock.pat_curr_cr, stock.pat_prev_cr, 'cr');
  const _epsTraj = profitTrajectory(stock.eps_curr, stock.eps_prev, 'eps');
  // zzz820 — what the card may honestly show. growthView withholds Sales/EPS
  // growth measured against an unverified year-ago quarter (gappy Screener
  // table); marginView hides OPM for banks/NBFCs/insurers and treats a stored
  // 0.0% as unknown; checkQuarterLabel replaces an impossible quarter label.
  const _g = growthView(stock);
  const _margin = marginView(stock, { newlyListed: _isNewCard });
  const _q = checkQuarterLabel(stock.quarter, (stock as any)._window_date || stock.filing_date);
  // zzz820b — a stored top tier built on unverified growth is held, not shown
  // as if it stood (holdUnconfirmed has already moved it out of the top tiers).
  const _unconf: string | null = (stock as any)._tier_unconfirmed || (yearAgoUnverified(stock) ? String(stock.tier) : null);
  const _ctx: string[] = Array.isArray((stock as any).market_context)
    ? Array.from(new Set(((stock as any).market_context as any[]).filter((t) => typeof t === 'string' && t.trim()).map((t) => String(t))))
    : [];
  // ☀️ daytime filing (09:15–15:30 IST) vs 🌙 outside-hours
  const timing: '☀️' | '🌙' | null = (() => {
    if (!stock.filing_url) return null;
    // We don't have filing_dt_iso here directly — could be added. Default 🌙 (most filings are AMC).
    return '🌙';
  })();

  return (
    <div
      id={`eo-card-${stock.ticker}`}
      data-ticker={stock.ticker}
      style={{
      backgroundColor: 'var(--mc-bg-0)',
      border: '1px solid var(--mc-bg-4)',
      borderLeft: `3px solid ${tierColor}`,
      borderRadius: 10,
      padding: '12px 14px',
    }}>
      {/* ── Header: COMPANY + pill row ────────────────────────────────────── */}
      <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--mc-text-1)', lineHeight: 1.2, marginBottom: 4 }}>
        {/* zzz817 — the card says its tier, next to the name, in every view
            (a window day mixes all four tiers). */}
        {_unconf
          ? <span className="eo-tier-badge" data-tier="UNCONFIRMED"
              title="The stored growth figures may compare against the wrong quarter last year (Screener's table has a gap). Not counted as BLOCKBUSTER or STRONG until the date is regraded with correct figures."
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 8, padding: '1px 7px', borderRadius: 4, fontSize: 10, fontWeight: 900, letterSpacing: '0.3px', verticalAlign: 'middle', whiteSpace: 'nowrap', border: '1.5px solid var(--mc-text-4)', color: 'var(--mc-text-2)' }}>
              ⚪ {UNCONFIRMED_LABEL}
              <span style={{ fontWeight: 600, color: 'var(--mc-text-4)', letterSpacing: 0 }}>(was {_unconf})</span>
            </span>
          : <TierBadge tier={stock.tier} />}
        {decodeEntities(String(stock.company || ''))}
        <span style={{ fontSize: 10, color: 'var(--mc-text-4)', fontWeight: 600, marginLeft: 6, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
          {stock.ticker}
        </span>
        {/* PATCH 0362 — NEW badge: card arrived since last auto-refresh */}
        {isFresh && (
          <span title="Filed since your last auto-refresh — under 10 minutes ago"
            style={{
              marginLeft: 8, padding: '1px 7px', borderRadius: 4,
              fontSize: 9, fontWeight: 900, letterSpacing: '0.5px',
              backgroundColor: 'var(--mc-bullish)', color: 'var(--mc-bg-0)',
              animation: 'pulse 1.5s ease-in-out infinite',
            }}>
            ⚡ NEW
          </span>
        )}
      </div>
      {/* zzz820b — why a top-tier quarter was held at a lower tier (engine v24). */}
      {capReasonOf(stock) && (
        <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--mc-text-2)', marginBottom: 4, lineHeight: 1.35 }}>
          {capReasonOf(stock)}
        </div>
      )}
      {/* zzz826 — guidance we do not have is said to be unknown, never "not raised". */}
      {typeof (stock as any).guidance_note === 'string' && (stock as any).guidance_note && (
        <div style={{ fontSize: 10, color: 'var(--mc-text-3)', marginBottom: 4, lineHeight: 1.35 }}
          title="Guidance status: unknown. Unknown guidance can hold back a top-tier result that needs it; it never lowers a grade.">
          Guidance: unknown{String((stock as any).guidance_note).startsWith('so ') ? ', ' : ' — '}{(stock as any).guidance_note}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', fontSize: 10.5, marginBottom: 8 }}>
        {/* zzz696 — everything from the quadrant badge to the sector chip is
            opt-in. The PRICE below is not: it shares this row but it is a
            number, not a label, and the card should never lose it. */}
        {/* zzz703 — pattern verdict, visible whatever the badge switch says. */}
        {(() => {
          const ab = classifyGradedRow(stock);
          if (!ab) return null;
          const m = ABFG_META[ab.pattern];
          return (
            <span title={`${ab.because}\n\nThe bet: ${m.bet}\n\nWhat ends it: ${ab.exitCondition}`}
              style={{ padding: '1px 7px', borderRadius: 3, border: `1px solid ${m.color}`,
                backgroundColor: `${m.color}18`, color: m.color, fontWeight: 800, letterSpacing: '0.3px' }}>
              {m.icon} {ab.pattern} · {m.name}
            </span>
          );
        })()}
        {showBadges && <>
        {/* QUALITY × INFLECTION badge. Sits BESIDE the tier, never replacing it:
            a ⚡ TURNAROUND ACCELERATOR is still whatever tier the grader gave it.
            Rendered only when the grader actually scored the row — a preview
            card with no financials has no basis for either number, and showing
            a 0 or a "—" there would invent a verdict we do not have. */}
        <QuadrantBadge stock={stock} />
        {radar && typeof radar.transformation_score === 'number' && (
          <span title="On the concall-intel transformation radar — turnaround/re-rating candidate from the transformation screener" style={{
            padding: '1px 6px', borderRadius: 3,
            border: '1px solid #34D399', background: '#064E3B', color: '#6EE7B7', fontWeight: 800, letterSpacing: '0.3px',
          }}>🚀 On transformation radar</span>
        )}
        {stock.pe != null && (
          <span style={{ padding: '1px 6px', borderRadius: 3, backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', color: 'var(--mc-text-2)', fontWeight: 700 }}>
            PE {stock.pe.toFixed(1)}
          </span>
        )}
        {/* ROCE — the single largest QUALITY input (30 of the axis's points), so
            the number behind the badge is visible rather than only implied.
            Mirrors the US card's chip. Absent when the source has no ROCE. */}
        {typeof stock.roce === 'number' && (
          <span title="Return on capital employed (Screener, annual) — the largest single input to the QUALITY score"
            style={{
              padding: '1px 6px', borderRadius: 3, backgroundColor: 'var(--mc-bg-1)',
              border: '1px solid var(--mc-bg-4)', fontWeight: 700,
              color: stock.roce >= 20 ? 'var(--mc-bullish)' : stock.roce < 8 ? 'var(--mc-bearish)' : 'var(--mc-text-2)',
            }}>
            ROCE {stock.roce.toFixed(0)}%
          </span>
        )}
        {_q.label && (
          <span title={(_q.corrected || (stock as any)._quarter_note) ? `Quarter corrected from the filing date (${_q.reason || (stock as any)._quarter_note}). Indian FY runs April–March.` : 'Results quarter (Indian FY runs April–March)'}
            style={{ padding: '1px 6px', borderRadius: 3, backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', color: 'var(--mc-text-3)', fontWeight: 700 }}>
            {_q.label}
          </span>
        )}
        {/* zzz822 — 💧 only a believable DAILY AVERAGE; a results-day spike
            (or anything above 5% of market cap a day) shows '—'. */}
        {/* zzz826 — only a real multi-day average ("avg (20d)"); else '—'. A
            single day's turnover is named in the tooltip, never shown as an average. */}
        {(() => {
          const lv = liquidityView(stock);
          const thin = lv.cr != null && lv.cr < 1;
          return (
            <span title={lv.title} style={{ padding: '1px 6px', borderRadius: 3, backgroundColor: 'var(--mc-bg-1)', border: `1px solid ${thin ? '#7F1D1D' : 'var(--mc-bg-4)'}`, color: thin ? '#F87171' : 'var(--mc-text-3)', fontWeight: 700 }}>
              💧 {lv.cr == null ? '—' : `${lv.cr >= 1 ? `₹${lv.cr.toFixed(1)} Cr/d` : `₹${Math.round(lv.cr * 100)} L/d`} ${lv.label ?? 'avg'}`}{thin ? ' · thin' : ''}
            </span>
          );
        })()}
        {stock.sector && (
          <span style={{ padding: '1px 6px', borderRadius: 3, backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', color: 'var(--mc-text-3)' }}>
            {stock.sector}
          </span>
        )}
        {timing && (
          <span style={{ fontSize: 12 }}>{timing}</span>
        )}
        </>}
        {/* zzz822 — size label on EVERY card with a market cap, from the one
            band table the Mkt Cap filter uses (stored labels were set by
            other thresholds, or missing). */}
        {stock.market_cap_cr != null && Number.isFinite(stock.market_cap_cr) && stock.market_cap_cr > 0 && (
          <span title={`Market cap band: ${CAP_BUCKETS.find((b) => b.key === capBucket(stock.market_cap_cr))?.label ?? ''} (same bands as the Mkt Cap filter)`}
            style={{ padding: '1px 6px', borderRadius: 3, backgroundColor: 'var(--mc-bg-3)', border: '1px solid var(--mc-bg-4)', color: 'var(--mc-text-3)', fontWeight: 800, letterSpacing: '0.3px' }}>
            {capBucket(stock.market_cap_cr)}
            <span style={{ fontWeight: 700, color: 'var(--mc-text-2)', marginLeft: 5 }}>
              ₹{Math.round(stock.market_cap_cr).toLocaleString('en-IN')} Cr
            </span>
          </span>
        )}
        {stock.price != null && (
          <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 800, color: 'var(--mc-text-1)' }}>
            {fmtPx(stock.price)}
          </span>
        )}
      </div>

      {/* ── Intraday move + RS + Stage row ────────────────────────────────── */}
      {(stock.gap_pct != null || stock.d1_pct != null || stock.move_pct != null || stock.rs_rating != null || stock.stage != null) && (
        <div style={{ display: 'flex', gap: 10, fontSize: 10, color: 'var(--mc-text-3)', marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {stock.move_pct != null && (
            <span>Move <strong style={{ color: stock.move_pct >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtPct(stock.move_pct)}</strong></span>
          )}
          {stock.gap_pct != null && (
            <span>Gap <strong style={{ color: stock.gap_pct >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtPct(stock.gap_pct)}</strong></span>
          )}
          {stock.d1_pct != null && (
            <span>D1 <strong style={{ color: stock.d1_pct >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtPct(stock.d1_pct)}</strong></span>
          )}
          {stock.rs_rating != null && (
            <span style={{
              padding: '1px 6px', borderRadius: 3,
              backgroundColor: stock.rs_rating >= 80 ? 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)' : stock.rs_rating >= 50 ? 'color-mix(in srgb, var(--mc-warn) 8%, transparent)' : 'color-mix(in srgb, var(--mc-bearish) 8%, transparent)',
              color:           stock.rs_rating >= 80 ? 'var(--mc-bullish)'    : stock.rs_rating >= 50 ? 'var(--mc-warn)'    : 'var(--mc-bearish)',
              border: '1px solid currentColor', fontWeight: 700,
            }}>RS {stock.rs_rating}</span>
          )}
          {stock.stage != null && (
            <span style={{
              padding: '1px 6px', borderRadius: 3,
              backgroundColor: stock.stage === 2 ? 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)' : stock.stage === 4 ? 'color-mix(in srgb, var(--mc-bearish) 8%, transparent)' : 'color-mix(in srgb, var(--mc-text-4) 8%, transparent)',
              color:           stock.stage === 2 ? 'var(--mc-bullish)'    : stock.stage === 4 ? 'var(--mc-bearish)'    : 'var(--mc-text-3)',
              border: '1px solid currentColor', fontWeight: 700,
            }}>Stage {stock.stage}</span>
          )}
        </div>
      )}

      {/* zzz820b — price facts beside the grade, never inside it (engine v24). */}
      {_ctx.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center', marginBottom: 6 }}
          title="Share-price facts shown for context. The tier is decided from the reported numbers only.">
          <span style={{ fontSize: 9.5, color: 'var(--mc-text-4)', fontWeight: 700 }}>Price context — not part of the grade:</span>
          {_ctx.map((t) => (
            <span key={t} style={{ fontSize: 9.5, padding: '1px 7px', borderRadius: 3, border: '1px solid var(--mc-bg-4)', color: 'var(--mc-text-3)', fontWeight: 600 }}>{t}</span>
          ))}
        </div>
      )}

      {/* zzz826 — shell-company flags: market cap / trading based, so context
          like the price chips, never the tier. The Mkt Cap filter hides them. */}
      {Array.isArray((stock as any).size_flags) && (stock as any).size_flags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center', marginBottom: 6 }}
          title="Size flags: from market cap and trading value (share-price figures), so they do not change the tier. Use the Mkt Cap filter to hide small companies.">
          <span style={{ fontSize: 9.5, color: 'var(--mc-text-4)', fontWeight: 700 }}>Size — not part of the grade:</span>
          {((stock as any).size_flags as string[]).map((t) => (
            <span key={t} style={{ fontSize: 9.5, padding: '1px 7px', borderRadius: 3, border: '1px solid var(--mc-warn)', color: 'var(--mc-warn)', fontWeight: 700 }}>
              {t === 'very small company' ? 'Very small company' : t === 'barely trades' ? 'Barely trades' : t}
            </span>
          ))}
        </div>
      )}

      {/* PATCH 1006 — Institutional badges row.  zzz696 — opt-in. */}
      {showBadges && ((stock as any).is_elite || typeof (stock as any).pead_score === 'number' || (stock as any).multibagger_setup) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {(stock as any).is_elite && (
            <span title="ELITE — an independent institutional gate, not a tier. Every criterion required; a missing figure fails it." style={{
              fontSize: 10, fontWeight: 900, letterSpacing: '0.3px',
              padding: '2px 8px', borderRadius: 4,
              border: '1px solid #FCD34D', background: '#78350F',
              color: '#FCD34D',
            }}>⭐ ELITE</span>
          )}
          {typeof (stock as any).pead_score === 'number' && (() => {
            const p = (stock as any).pead_score as number;
            // zzz278 — show PEAD on every card. Color by tier: red ≥70 (fire),
            // amber 50-69 (warm), grey <50 (cool). Threshold notation kept in title.
            const style = p >= 70
              ? { border: '1px solid #F87171', background: '#7F1D1D', color: '#FCA5A5', icon: '🔥' }
              : p >= 50
                ? { border: '1px solid #F59E0B', background: '#78350F', color: '#FCD34D', icon: '⚡' }
                : { border: '1px solid #6B7280', background: '#1F2937', color: '#9CA3AF', icon: '📊' };
            return (
              <span title="Post-earnings drift (PEAD): how strongly prices have tended to keep moving after results like this one — strong, moderate or weak" style={{
                fontSize: 10, fontWeight: 800, letterSpacing: '0.3px',
                padding: '2px 8px', borderRadius: 4,
                border: style.border, background: style.background, color: style.color,
              }}>{style.icon} {driftWord(p)}</span>
            );
          })()}
          {(stock as any).multibagger_setup && (
            <span title="MULTIBAGGER SETUP — at least 2 of 4 quality signals (ROCE ≥ 25% · OPM ≥ 18% · OPM expanding ≥ +1pp · pledge ≤ 5%) and not loss-making" style={{
              fontSize: 10, fontWeight: 800, letterSpacing: '0.3px',
              padding: '2px 8px', borderRadius: 4,
              border: '1px solid #67E8F9', background: '#164E63',
              color: '#A5F3FC',
            }}>💎 MULTIBAGGER</span>
          )}
        </div>
      )}

      {/* ── Three metric tiles + score ────────────────────────────────────── */}
      {/* PATCH 1003 — 2x3 grid: 4 metrics + score (was 2x2 = 3 metrics + score) */}
      <div className="mc-grid-2-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <MetricTile label={_useSalesQoQ ? 'SALES QoQ' : 'SALES YOY'}  pct={_useSalesQoQ ? _salesQoQ : _g.sales}      curr={fmtCr(stock.sales_curr_cr)} prev={_useSalesQoQ ? fmtCr(_salesPrevQ) : fmtCr(_g.salesPrev)} note={!_useSalesQoQ && _g.withheld ? 'year-ago not matched' : undefined} noteTitle={_g.withheld || undefined} />
        <MetricTile label={_usePatQoQ ? 'NET PROFIT QoQ' : 'NET PROFIT YOY'} pct={_usePatQoQ ? _patQoQ : (_patTraj && !_g.withheld ? null : _g.pat)} word={!_usePatQoQ && _patTraj && !_g.withheld ? { text: _patTraj.short, good: _patTraj.improving, title: _patTraj.label } : undefined} curr={fmtCr(stock.pat_curr_cr)}   prev={_usePatQoQ ? fmtCr(_patPrevQ) : fmtCr(_g.patPrev)} note={_usePatQoQ ? undefined : (_g.withheld ? 'year-ago not matched' : (_g.patNote || undefined))} noteTitle={_g.withheld || (_g.patNote ? 'This quarter\'s profit is known; the same quarter last year is not in the source, so no growth figure is shown (it is not worked out from EPS).' : undefined)} />
        <MetricTile label={_useEpsQoQ ? 'EPS QoQ' : 'EPS YOY'}    pct={_useEpsQoQ ? _epsQoQ : (_epsTraj && !_g.withheld ? null : _g.eps)}        word={!_useEpsQoQ && _epsTraj && !_g.withheld ? { text: _epsTraj.short, good: _epsTraj.improving, title: _epsTraj.label } : undefined} curr={fmtPx(stock.eps_curr)}     prev={_useEpsQoQ ? fmtPx(_epsPrevQ) : fmtPx(_g.epsPrev)} note={!_useEpsQoQ && _g.withheld ? 'year-ago not matched' : undefined} noteTitle={_g.withheld || undefined} />
        <MarginTile m={_margin} />
        {/* zzz694 — cash sits beside the score, so the figure that decides the
            tier is on the card rather than only in the caveat pills. The score
            gives up its full-width row for it; a 94 that is capped by cash is
            better read next to the cash than alone. */}
        <CashTile v={cashTileView(stock)} />
        {/* zzz820 — the 0–100 composite is no longer printed (owner rule: no
            visible scores). The tile says the grade in words instead. */}
        <div title={TIER_META[stock.tier].tagline} style={{ padding: '6px 10px', backgroundColor: 'var(--mc-bg-1)', borderRadius: 6, border: `1px solid ${tierColor}40`, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: 9, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.6px' }}>GRADE</div>
          <div style={{ fontSize: 14, fontWeight: 900, color: tierColor, lineHeight: 1.1, marginTop: 2 }}>{_unconf ? 'UNCONFIRMED' : TIER_META[stock.tier].label}</div>
        </div>
      </div>

      {/* zzz820 — the tier was set from the stored growth figures; when those
          may be measured against the wrong year-ago quarter, say so. */}
      {_g.withheld && (
        <div title={_g.withheld} style={{ marginTop: 6, fontSize: 10.5, color: 'var(--mc-warn)', fontWeight: 700, lineHeight: 1.4 }}>
          ⚠ Growth not shown: last year&apos;s same quarter is missing from the Screener table, so the stored growth (and the grade built on it) may compare against the wrong quarter. Check the filing before relying on it.
        </div>
      )}

      {/* ── Brief narrative ───────────────────────────────────────────────── */}
      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--mc-text-2)', lineHeight: 1.5, fontStyle: 'italic', backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: 6, padding: '6px 9px' }}>
        📝 {narrativeForDisplay(stock)}
      </div>

      <IndiaAiSummary stock={stock} />

      {/* ── Methodology + caveat pills ────────────────────────────────────── */}
      {(stock.methodology_tags.length > 0 || _cavs.length > 0) && (
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {stock.methodology_tags.map((t) => (
            <span key={t} style={{ fontSize: 9.5, padding: '1px 7px', borderRadius: 3, backgroundColor: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)', color: 'var(--mc-bullish)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 25%, transparent)', fontWeight: 700 }}>✓ {t}</span>
          ))}
          {_cavs.map((t) => {
            // zzz503 — "newly listed" / "no YoY yet" are CONTEXT, not risk
            // flags. Render them as neutral/informational cyan pills (ℹ) so a
            // recent IPO's card reads as "just listed" rather than a scary
            // warning. All genuine caveats keep the amber ⚠ styling.
            const _info = t === 'newly listed' || t === 'no YoY yet';
            // zzz800 — a Day-1 price reaction is not a fault in the filing:
            // rendered as a neutral, explicitly labelled market-reaction pill.
            const _reaction = MARKET_REACTION_CAVEATS.has(t);
            const _c = _info ? 'var(--mc-cyan)' : _reaction ? 'var(--mc-text-3)' : 'var(--mc-warn)';
            return (
              <span key={t} title={_reaction ? 'Price reaction after the print, not a judgement on the reported numbers' : undefined} style={{ fontSize: 9.5, padding: '1px 7px', borderRadius: 3, backgroundColor: `color-mix(in srgb, ${_c} 8%, transparent)`, color: _c, border: `1px solid color-mix(in srgb, ${_c} 25%, transparent)`, fontWeight: 700 }}>{_info ? 'ℹ' : _reaction ? '📉 market reaction:' : '⚠'} {t === 'newly listed' ? 'new listing — no YoY history' : t}</span>
            );
          })}
        </div>
      )}

      {/* ── Filing link ───────────────────────────────────────────────────── */}
      {/* PATCH 0359 — Always render NSE filing URL fresh from ticker. Old
          cached payloads (generated pre-Patch 0358) baked the old
          /get-quotes/equity URL into stock.filing_url which redirects to
          a generic quote page, not the financial-results filings page.
          Generating at render time means stale caches don't poison the link. */}
      <div style={{ marginTop: 8, paddingTop: 7, borderTop: '1px solid var(--mc-bg-4)' }}>
        <a
          href={`https://www.nseindia.com/companies-listing/corporate-filings-financial-results?symbol=${encodeURIComponent(stock.ticker)}`}
          target="_blank" rel="noopener noreferrer"
          title="Open NSE financial-results filings filter for this ticker"
          style={{ fontSize: 10, color: 'var(--mc-cyan)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <ExternalLink style={{ width: 10, height: 10 }} /> 📄 NSE Filings · {stock.ticker}
        </a>
        {' '}
        <a
          href={`https://www.bseindia.com/corporates/ann.html?scrip=${encodeURIComponent(stock.ticker)}`}
          target="_blank" rel="noopener noreferrer"
          title="Open BSE corporate announcements filter for this ticker"
          style={{ fontSize: 10, color: 'var(--mc-text-3)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 10 }}>
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
      <div style={{ color: 'var(--mc-text-4)', fontSize: 13, padding: 40, textAlign: 'center' }}>
        <div style={{ marginBottom: 8 }}>Fetching the earnings calendar for the first time…</div>
        <div style={{ fontSize: 11, color: 'var(--mc-text-4)' }}>
          This is a one-time fetch per month. Subsequent visits hit cache instantly.
        </div>
      </div>
    );
  }
  if (data?.empty_reason === 'scraper_has_not_run_yet') {
    return (
      <div style={{ color: 'var(--mc-text-3)', fontSize: 13, padding: 30, backgroundColor: 'var(--mc-bg-1)', border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)', borderRadius: 10 }}>
        <div style={{ fontSize: 24, marginBottom: 10 }}>⏳</div>
        <strong style={{ color: 'var(--mc-warn)' }}>Scraper has not run yet.</strong>
        <p style={{ marginTop: 8, lineHeight: 1.6 }}>
          The NSE Earnings Calendar GitHub Action needs to run at least once to populate the KV cache. Either:
        </p>
        <ol style={{ marginTop: 6, paddingLeft: 22, lineHeight: 1.7, fontSize: 12 }}>
          <li>Wait for the next 30-minute cron tick (runs 03:00–13:00 UTC on weekdays)</li>
          <li>Trigger manually: GitHub repo → Actions → "NSE Earnings Calendar Scrape" → Run workflow</li>
        </ol>
        <p style={{ marginTop: 8, fontSize: 11, color: 'var(--mc-text-4)' }}>
          Make sure these GitHub repo secrets are set: <code>UPSTASH_REDIS_REST_URL</code>, <code>UPSTASH_REDIS_REST_TOKEN</code>.
        </p>
      </div>
    );
  }

  const byDate = data?.by_date || {};
  // 3-state: dates NOT in ingested_dates were never captured (source window) => UNKNOWN, not zero.
  const ingestedSet = new Set<string>(data?.ingested_dates || []);
  // PATCH 0909 — Build a flat de-duped list of all tickers in the visible
  // calendar window so the user can copy them as a single comma-separated
  // string (TradingView-ready) or as NSE: prefixed string (Investing.com / Zerodha).
  // User report: "i am trying to copy tickers in the earninsg calendar in
  // earning opportunities its not posible".
  const allTickers: string[] = (() => {
    const set = new Set<string>();
    for (const items of Object.values(byDate)) {
      for (const it of items) {
        if (it?.symbol) set.add(String(it.symbol).toUpperCase().replace(/\.(NS|BO)$/i, ''));
      }
    }
    return Array.from(set).sort();
  })();
  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      // Lightweight toast — uses native alert as fallback if no toast lib.
      console.log(`[calendar] copied ${label}: ${text.slice(0, 80)}...`);
    } catch {
      // navigator.clipboard fails in non-https contexts; fall back to textarea + execCommand
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.top = '-1000px';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {}
    }
  };
  return (
    <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: 10, padding: '14px 18px' }}>
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--mc-text-1)', letterSpacing: '0.4px' }}>📅 NSE EARNINGS CALENDAR</h2>
        <span style={{ fontSize: 11, color: 'var(--mc-text-4)' }}>{from} → {to} · {Object.values(byDate).reduce((a, b) => a + b.length, 0)} filings</span>
        {/* PATCH 0909 — Copy-all-tickers controls */}
        {allTickers.length > 0 && (
          <span style={{ display: 'inline-flex', gap: 4, marginLeft: 4 }}>
            <button
              onClick={() => copyToClipboard(allTickers.join(','), 'plain CSV')}
              title="Copy all tickers (CSV — Excel-friendly)"
              style={{ fontSize: 10, padding: '3px 8px', background: 'transparent', border: '1px solid color-mix(in srgb, var(--mc-cyan) 38%, transparent)', color: 'var(--mc-cyan)', borderRadius: 4, cursor: 'pointer', fontWeight: 700 }}
            >📋 CSV ({allTickers.length})</button>
            <button
              onClick={() => copyToClipboard(allTickers.map(t => `NSE:${t}`).join(','), 'TradingView')}
              title="Copy as NSE:TICKER,NSE:TICKER (TradingView watchlist import format)"
              style={{ fontSize: 10, padding: '3px 8px', background: 'transparent', border: '1px solid color-mix(in srgb, var(--mc-cyan) 38%, transparent)', color: 'var(--mc-cyan)', borderRadius: 4, cursor: 'pointer', fontWeight: 700 }}
            >📊 TradingView</button>
            <button
              onClick={() => copyToClipboard(allTickers.join('\n'), 'one per line')}
              title="Copy one ticker per line"
              style={{ fontSize: 10, padding: '3px 8px', background: 'transparent', border: '1px solid color-mix(in srgb, var(--mc-cyan) 38%, transparent)', color: 'var(--mc-cyan)', borderRadius: 4, cursor: 'pointer', fontWeight: 700 }}
            >↓ Lines</button>
          </span>
        )}
        {data?.scraped_at && (
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--mc-text-4)' }}>scraped {new Date(data.scraped_at).toLocaleString('en-IN')}</span>
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
                backgroundColor: 'var(--mc-bg-0)',
                border: `1px solid ${isToday ? 'color-mix(in srgb, var(--mc-cyan) 25%, transparent)' : 'var(--mc-bg-4)'}`,
                borderRadius: 8,
                cursor: items.length > 0 ? 'pointer' : 'default',
                opacity: items.length === 0 ? 0.5 : 1,
              }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: isToday ? 'var(--mc-cyan)' : 'var(--mc-text-3)' }}>
                  {weekday} {dayLabel}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {items.length > 0 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const day = items.map(it => String(it.symbol || '').toUpperCase().replace(/\.(NS|BO)$/i, '')).filter(Boolean).join(',');
                        copyToClipboard(day, `${weekday} ${dayLabel}`);
                      }}
                      title={`Copy ${items.length} tickers filing ${weekday} ${dayLabel}`}
                      style={{ fontSize: 9, padding: '1px 5px', background: 'transparent', border: '1px solid color-mix(in srgb, var(--mc-cyan) 25%, transparent)', color: 'var(--mc-cyan)', borderRadius: 3, cursor: 'pointer', fontWeight: 700 }}
                    >📋</button>
                  )}
                  {items.length > 0 && (
                    <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--mc-warn)' }}>{items.length}</span>
                  )}
                </span>
              </div>
              <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {items.length === 0 ? (
                  ingestedSet.has(d) ? (
                    <span title="Ingested for this date - no results filed (confirmed zero)" style={{ fontSize: 10.5, color: 'var(--mc-text-4)' }}>No filings</span>
                  ) : (
                    <span title="Data unavailable - this date was never ingested (outside NSE source window). Not zero." style={{ fontSize: 10.5, fontWeight: 700, color: '#B45309' }}>Data unavailable</span>
                  )
                ) : (expandedDates[d] ? items : items.slice(0, 12)).map((it, i) => (
                  // Stable UNIQUE key per company-in-day. Keying on it.symbol
                  // alone made React collapse siblings whenever two rows shared
                  // a symbol (or a blank symbol), silently dropping companies.
                  // date+symbol+company+index is guaranteed unique and durable.
                  <a key={`${d}::${it.symbol || 'nosym'}::${it.company || ''}::${i}`} href={it.source_url} target="_blank" rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    title={`${decodeEntities(String(it.company || ''))} · ${it.quarter || ''}`}
                    style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, backgroundColor: 'color-mix(in srgb, var(--mc-accent) 8%, transparent)', color: '#38A9E8', border: '1px solid color-mix(in srgb, var(--mc-accent) 25%, transparent)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', textDecoration: 'none', fontWeight: 700 }}>
                    {it.symbol}
                  </a>
                ))}
                {items.length > 12 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedDates((s) => ({ ...s, [d]: !s[d] }));
                    }}
                    style={{ fontSize: 10, color: 'var(--mc-cyan)', background: 'transparent', border: '1px solid color-mix(in srgb, var(--mc-cyan) 25%, transparent)', padding: '1px 6px', borderRadius: 3, cursor: 'pointer', fontWeight: 700 }}>
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

// PATCH 1003 — OPM (Operating Profit Margin) tile.
// Displays current OPM % and YoY change in percentage points, color-coded
// so user can see margin direction at a glance — feeds the margin-gate
// rule introduced in Patch 1000.
// zzz820 — now driven by marginView(): a stored 0.0% is shown as unknown, and
// banks / NBFCs / insurers get NET MARGIN (net profit ÷ total income) instead
// of an operating margin that means nothing for a lender.
function MarginTile({ m }: { m: MarginView }) {
  const hasV = m.value != null;
  const delta = m.value != null && m.prev != null ? m.value - m.prev : null;
  const deltaColor = delta == null ? '#6B7A8D'
                    : delta >= 1 ? '#10B981'
                    : delta >= -0.5 ? '#94A3B8'
                    : '#EF4444';
  const deltaLabel = delta == null ? '—'
                    : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} pp`;
  return (
    <div title={m.title} style={{ padding: '6px 10px', backgroundColor: 'var(--mc-bg-1)', borderRadius: 6, border: '1px solid var(--mc-bg-4)', display: 'flex', flexDirection: 'column', gap: 1 }}>
      <div style={{ fontSize: 9, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.6px' }}>{m.label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: hasV ? 'var(--mc-text-1)' : 'var(--mc-text-4)', lineHeight: 1 }}>
          {hasV ? `${(m.value as number).toFixed(1)}%` : '—'}
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, color: deltaColor }}>
          {deltaLabel}
        </div>
      </div>
      <div style={{ fontSize: 9, color: 'var(--mc-text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {m.note}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// THE CASH TILE. THE CARD ACCUSED AND NEVER SHOWED THE EVIDENCE.    (zzz694)
//
// KRN Heat Exchanger prints revenue +119%, PAT +175%, EPS +152%, OPM +4pp and
// a composite of 94 - and comes back MIXED. The reason is entirely cash:
// annual operating cash flow is NEGATIVE and 3.45x annual PAT in magnitude,
// which trips the hard ceiling. The narrative said "ocf divergence + profit
// without operating cash" and two warning pills appeared underneath.
//
// THE NUMBER ITSELF WAS NOWHERE ON THE CARD. Four tiles for sales, profit,
// EPS and margin - the things that looked good - and not one for the single
// figure that decided the tier. The owner could read that a cash problem
// existed but not how big it was, which is the difference between "explain
// this before you size it" and "avoid". -3.45 and 0.85 are both "ocf
// divergence" and they are not remotely the same quarter.
//
// So cash gets a tile next to the score, coloured on the same thresholds the
// grader uses: >= 1.0 the earnings are cash-backed, >= 0.6 a working-capital
// quarter, below that the divergence caveat fires, and below zero operations
// consumed cash and the MIXED ceiling is unconditional.
// zzz822 — driven by cashTileView(): 0.00x is missing data ('—'), lenders
// and insurers read 'not meaningful for lenders', and the engine's cash basis
// (e.g. 'FY26 full year') is shown under the ratio when it sends one.
function CashTile({ v }: { v: CashTileView }) {
  const color = v.color === 'good' ? '#10B981' : v.color === 'warn' ? '#F59E0B' : v.color === 'bad' ? '#EF4444' : '#6B7A8D';
  return (
    <div title="Operating cash flow ÷ net profit for the year: does cash back the reported profit?" style={{ padding: '6px 10px', backgroundColor: 'var(--mc-bg-1)', borderRadius: 6, border: '1px solid var(--mc-bg-4)', display: 'flex', flexDirection: 'column', gap: 1 }}>
      <div style={{ fontSize: 9, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.6px' }}>CASH  CFO/PAT</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color, lineHeight: 1 }}>{v.text}</div>
      </div>
      <div style={{ fontSize: 9, color: 'var(--mc-text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {v.note}
      </div>
      {v.basis && (
        <div style={{ fontSize: 9, color: 'var(--mc-text-4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {v.basis}
        </div>
      )}
    </div>
  );
}

function MetricTile({ label, pct, curr, prev, word, note, noteTitle }: { label: string; pct: number | null; curr: string | null; prev: string | null; word?: { text: string; good: boolean; title?: string }; note?: string; noteTitle?: string }) {
  const color = word ? (word.good ? '#10B981' : '#EF4444') : pct == null ? '#6B7A8D' : pct >= 0 ? '#10B981' : '#EF4444';
  // zzz385 — clamp base-effect blow-ups on the card tile (mirror the narrative fmtP
  // clamp): a near-zero prior base makes YoY % explode (e.g. ₹0.5 Cr → ₹50 Cr PAT =
  // +5000%). Exact precision is meaningless there and reads as fabricated, so show
  // '>500%' above the threshold. The curr-vs-prev ₹Cr line below still shows the real
  // magnitude so the low base is obvious.
  const pctLabel = pct == null || !Number.isFinite(pct)
    ? '—'
    : pct >= 500 ? '>500%'
    : `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`;
  return (
    <div style={{ padding: '8px 10px', backgroundColor: 'var(--mc-bg-1)', borderRadius: 6, border: '1px solid var(--mc-bg-4)' }}>
      <div style={{ fontSize: 9.5, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.6px' }}>{label}</div>
      {word
        ? <div title={word.title} style={{ fontSize: 12, fontWeight: 900, color, marginTop: 4, lineHeight: 1.1 }}>{word.text}</div>
        : <div style={{ fontSize: 18, fontWeight: 900, color, marginTop: 2, lineHeight: 1 }}>{pctLabel}</div>}
      {(curr || prev) && (
        <div style={{ fontSize: 10, color: 'var(--mc-text-4)', marginTop: 2, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
          {curr || '—'}{prev && ` vs ${prev}`}
        </div>
      )}
      {/* zzz820 — why a figure is '—' (never a guess in its place). */}
      {note && (
        <div title={noteTitle} style={{ fontSize: 9, color: 'var(--mc-text-3)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: noteTitle ? 'help' : undefined }}>
          ⓘ {note}
        </div>
      )}
    </div>
  );
}

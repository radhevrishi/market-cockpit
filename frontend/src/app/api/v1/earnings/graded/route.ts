// ═══════════════════════════════════════════════════════════════════════════
// SERVER-SIDE GRADED ENDPOINT (PATCH 0159)
//
// GET /api/v1/earnings/graded?date=YYYY-MM-DD
//
// Replaces the client-side join (hub + enrichment) with a single server call
// that returns the FULLY GRADED payload — cards already include Sales/PAT/EPS
// YoY + abs Cr pairs + price + Stage + RS + methodology pills + caveat pills
// + score + tier + narrative.
//
// CACHING strategy (key insight: past filings are immutable):
//   • Past dates (< today_IST): cache 90 days. Once a Q4 is filed, the
//     numbers don't change — re-fetching is pure waste. KV key
//     'graded:v7:<YYYY-MM-DD>' is hit on every subsequent visit (<100ms).
//   • Today's date: cache 15 min. New filings come throughout the day,
//     so we accept brief staleness for freshness.
//   • Future dates: not cached (Upcoming only).
//
// Server fetches in parallel:
//   1. /api/market/earnings?month=YYYY-MM (hub — authoritative filed list)
//   2. /api/v1/earnings/enrich?symbols=A,B,C (NSE+Screener+Yahoo)
//   3. Applies gradeRow logic, sorts into tiers, returns OpportunitiesPayload
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// ─── Types (mirror frontend) ───────────────────────────────────────────────
type EarningsTier = 'BLOCKBUSTER' | 'STRONG' | 'MIXED' | 'AVOID';
const TIER_ORDER: EarningsTier[] = ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID'];

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

// ─── gradeRow (server-side, mirrors page.tsx PATCH 0158) ───────────────────
function parseTrendlynePeriodEnd(s: string): string | null {
  if (!s) return null;
  const m = s.match(/(\d{1,2})[- /]([A-Za-z]{3,9})[- /](\d{4})/);
  if (!m) return null;
  const months: Record<string, number> = { JAN:0, FEB:1, MAR:2, APR:3, MAY:4, JUN:5, JUL:6, AUG:7, SEP:8, OCT:9, NOV:10, DEC:11 };
  const mm = months[m[2].toUpperCase().slice(0, 3)];
  if (mm === undefined) return null;
  return new Date(Date.UTC(+m[3], mm, +m[1])).toISOString().slice(0, 10);
}

function gradeRow(row: any): ParsedEarning | null {
  const salesY = row?.sales_yoy_pct ?? null;
  const patY = row?.pat_yoy_pct ?? null;
  const epsY = row?.eps_yoy_pct ?? null;
  const opmExp = row?.opm_pct != null && row?.opm_prev_pct != null ? row.opm_pct - row.opm_prev_pct : null;
  const hasFin = salesY != null || patY != null || epsY != null;
  const hubQuality = row?.hub_quality;

  // No-financials preview path
  if (!hasFin) {
    if (!hubQuality || hubQuality === 'Upcoming') return null;
    const tier: EarningsTier =
      hubQuality === 'Excellent' ? 'BLOCKBUSTER' :
      hubQuality === 'Great'     ? 'STRONG' :
      hubQuality === 'Good'      ? 'MIXED' :
      hubQuality === 'OK'        ? 'MIXED' :
                                   'AVOID';
    const score = hubQuality === 'Excellent' ? 88 : hubQuality === 'Great' ? 76 : hubQuality === 'Good' ? 58 : hubQuality === 'OK' ? 42 : 22;
    const move = row?.move_pct ?? null;
    const moveLabel = move != null ? ` (${move >= 0 ? '+' : ''}${move.toFixed(1)}% on the day)` : '';
    return {
      ticker: row.symbol, company: row.company || row.symbol, sector: row.sector, filing_date: row.filing_date,
      quarter: row.quarter || 'Q4', market_cap_bucket: row.market_cap_bucket, pe: null, price: row.current_price ?? null,
      sales_yoy_pct: null, net_profit_yoy_pct: null, eps_yoy_pct: null,
      sales_curr_cr: null, sales_prev_cr: null, pat_curr_cr: null, pat_prev_cr: null, eps_curr: null, eps_prev: null,
      gap_pct: row.gap_pct ?? null, d1_pct: row.d1_pct ?? null, move_pct: move,
      rs_rating: row.rs_rating ?? null, stage: row.stage ?? null, pct_from_52w_high: row.pct_from_52w_high ?? null,
      composite_score: score, tier, methodology_tags: [], caveat_tags: [],
      narrative: `${row.company || row.symbol} reported Q4 results${moveLabel}. Financial detail awaiting enrichment.`,
      filing_url: row.source_url, source: 'NSE+BSE',
    };
  }

  // Future date guard
  const todayIso = new Date().toISOString().slice(0, 10);
  if (row?.filing_date && row.filing_date > todayIso) return null;

  // PATCH 0182 — STRICT announce-date attribution guard.
  // The previous data flow attributed Screener's LATEST Q4 financials to whatever
  // date /api/market/earnings reported as the resultDate. This produced wrong
  // dates when a company's actual filing was weeks earlier (JTLIND/GARUDA/SATIN
  // appearing on May 12 when they filed in April).
  // Now: if /enrich returned an announce_date_iso (NSE re_broadcastDt — the
  // authoritative filing timestamp), it MUST match the page's filing_date
  // within ±3 days. Outside that window = wrong attribution, drop the row.
  if (row?.announce_date_iso && row?.filing_date) {
    const announceD = new Date(row.announce_date_iso);
    const filingD = new Date(row.filing_date);
    if (!isNaN(announceD.getTime()) && !isNaN(filingD.getTime())) {
      const diffDays = Math.abs((announceD.getTime() - filingD.getTime()) / 86_400_000);
      if (diffDays > 3) return null;
    }
  }

  // PATCH 0178 — RELAXED quarter alignment.
  // Only drop on screener-only source with extreme mismatch (>95 days).
  // NSE/BSE-structured financials are authoritative — trust them even when
  // Screener latest_quarter_end_iso still shows the prior quarter.
  if (row?.period_ended && row?.latest_quarter_end_iso) {
    const promised = parseTrendlynePeriodEnd(row.period_ended);
    if (promised && promised !== row.latest_quarter_end_iso) {
      const diffDays = Math.abs((new Date(promised).getTime() - new Date(row.latest_quarter_end_iso).getTime()) / 86_400_000);
      const src = (row?.financials_source || '').toLowerCase();
      const isScreenerOnly = src === 'screener' || src === '';
      if (isScreenerOnly && diffDays > 95) return null;
    }
  }

  const methodology_tags: string[] = [];
  const caveat_tags: string[] = [];
  const rs = row?.rs_rating ?? null;
  const stage = row?.stage ?? null;
  const ttPass = !!row?.trend_template_passes;
  const pct52 = row?.pct_from_52w_high ?? null;

  if (ttPass && rs != null && rs >= 70) methodology_tags.push('trend template');
  if (stage === 2 && rs != null && rs >= 80 && epsY != null && epsY >= 25 && pct52 != null && pct52 >= -15) methodology_tags.push('sepa');
  if (epsY != null && epsY >= 25 && (salesY ?? 0) >= 20 && rs != null && rs >= 70) methodology_tags.push('canslim');
  if (epsY != null && epsY >= 20 && (salesY == null || salesY >= 5)) methodology_tags.push('bonde ep');

  if (epsY != null && salesY != null && salesY > 0 && epsY >= salesY * 3 && epsY >= 50) caveat_tags.push('optical eps');
  if (epsY != null && epsY >= 200) caveat_tags.push('optical eps');
  if (row?.eps_prev != null && row?.eps_curr != null && Math.abs(row.eps_prev) < 0.5 && Math.abs(row.eps_curr) > 2) {
    if (!caveat_tags.includes('optical eps')) caveat_tags.push('optical eps');
  }
  if (patY != null && row?.op_profit_yoy_pct != null && patY >= 100 && row.op_profit_yoy_pct < 30) caveat_tags.push('tax distortion');
  if (opmExp != null && opmExp < -1.5) caveat_tags.push('segment mix shift');
  if (row?.ocf_to_pat_ratio != null) {
    if (row.ocf_to_pat_ratio < 0.6 && (row.pat_annual_cr ?? 0) > 0) caveat_tags.push('ocf divergence');
    if (row.ocf_annual_cr != null && row.ocf_annual_cr < 0 && (row.pat_annual_cr ?? 0) > 0 && !caveat_tags.includes('ocf divergence')) caveat_tags.push('ocf divergence');
  }
  if (stage === 4) caveat_tags.push('low quality');
  else if (pct52 != null && pct52 < -25) caveat_tags.push('low quality');

  const scoreYoy = (y: number) =>
    y >= 100 ? 100 : y >= 50 ? 90 : y >= 25 ? 75 : y >= 15 ? 60 : y >= 5 ? 40 : y >= 0 ? 25 : Math.max(0, 25 + y);
  let magW = 0, magS = 0;
  if (salesY != null) { magS += scoreYoy(salesY) * 0.35; magW += 0.35; }
  if (patY   != null) { magS += scoreYoy(patY)   * 0.30; magW += 0.30; }
  if (epsY   != null) { magS += scoreYoy(epsY)   * 0.35; magW += 0.35; }
  const magnitude = magW > 0 ? magS / magW : 30;

  const caveatPenalty: Record<string, number> = {
    'optical eps': 20, 'tax distortion': 15, 'ocf divergence': 25, 'low quality': 25,
    'segment mix shift': 10, 'exceptional item': 10, 'forex gain': 8, 'forex loss': 8,
    'accelerated depreciation': 10, 'accounting change': 12, 'pooling of interests restate': 12, 'one time order': 10,
  };
  let quality = 100;
  for (const tag of caveat_tags) quality -= (caveatPenalty[tag] ?? 8);
  if (opmExp != null && opmExp >= 3) quality += 8;
  quality = Math.max(0, Math.min(100, quality));

  const stageBase = stage === 2 ? 70 : stage === 1 ? 45 : stage === 3 ? 30 : stage === 4 ? 10 : 50;
  let technical = stageBase + (rs != null ? rs / 3 : 0);
  if (pct52 != null) technical += pct52 >= -5 ? 15 : pct52 >= -15 ? 8 : pct52 >= -25 ? 0 : -15;
  if (ttPass) technical += 10;
  technical = Math.max(0, Math.min(100, technical));

  const mCount = methodology_tags.length;
  const _t1MethodCount =
    (methodology_tags.includes('trend template') ? 1 : 0) +
    (methodology_tags.includes('sepa') ? 1 : 0) +
    (methodology_tags.includes('canslim') ? 1 : 0);
  let methodology = mCount === 4 ? 100 : mCount === 3 ? 80 : mCount === 2 ? 60 : mCount === 1 ? 35 : 10;
  if (_t1MethodCount >= 1) methodology = Math.max(methodology, 55);
  if (methodology_tags.includes('sepa')) methodology = Math.min(100, methodology + 5);
  // PATCH 0172/0173 — magnitude-aware methodology floors
  const _megaMagFloor = salesY != null && salesY >= 40 && patY != null && patY >= 75 && epsY != null && epsY >= 75;
  if (_megaMagFloor) methodology = Math.max(methodology, 75);
  const _exceptMagFloor = salesY != null && salesY >= 40 && patY != null && patY >= 50 && epsY != null && epsY >= 50;
  if (_exceptMagFloor) methodology = Math.max(methodology, 65);

  const composite = Math.max(0, Math.min(100, magnitude * 0.35 + quality * 0.25 + technical * 0.25 + methodology * 0.15));

  // Tier rules — PATCH 0173 BLOCKBUSTER v3 (EarningsPulse-matched).
  // Ignore RS, Stage 2, bonde ep as hard gates. Use Magnitude + Quality +
  // Tier-1 method count + Guidance + chart-not-broken.
  let tier: EarningsTier;
  const broken = (stage === 4 && (rs == null || rs < 40)) || (epsY != null && epsY < 0 && patY != null && patY < -10);
  const cleanMag = salesY != null && salesY >= 25 && patY != null && patY >= 25 && epsY != null && epsY >= 25;
  const exceptMag = salesY != null && salesY >= 40 && patY != null && patY >= 50 && epsY != null && epsY >= 50;
  const megaMag = salesY != null && salesY >= 40 && patY != null && patY >= 75 && epsY != null && epsY >= 75;

  // Guidance signal — scan available text
  const guidanceText = [
    (row as any)?.guidance_text, (row as any)?.narrative_text, (row as any)?.announcement_text,
    (row as any)?.attachment, (row as any)?.headline, (row as any)?.title,
  ].filter(Boolean).join(' ').toLowerCase();
  const _guidancePatterns = [
    /capacity expansion/, /order book/, /record (?:quarter|order|revenue|book)/,
    /margin expansion/, /operating leverage/, /commission(?:ed|ing)?/,
    /capex/, /demand recovery/, /broad[- ]based/, /tailwind/, /confident/,
    /guidance rais/, /upgrade(?:d)? guidance/, /outlook strong/,
    /(?:vadod|new plant|new line|brownfield|greenfield)/,
  ];
  const _guidanceMatches = _guidancePatterns.filter((p) => p.test(guidanceText)).length;
  const positiveGuidance = _guidanceMatches >= 2;

  const chartOk = stage !== 4 && (pct52 == null || pct52 >= -25);
  const bbPathA = composite >= 78 && cleanMag && caveat_tags.length <= 1 && (_t1MethodCount >= 1 || positiveGuidance) && chartOk;
  const bbPathB = composite >= 72 && exceptMag && caveat_tags.length <= 2 && chartOk;
  const bbPathC = megaMag && caveat_tags.length <= 3 && stage !== 4;
  const blockbusterGate = bbPathA || bbPathB || bbPathC;
  if (broken && composite < 70) tier = 'AVOID';
  else if (blockbusterGate) tier = 'BLOCKBUSTER';
  else if (composite >= 68 && mCount >= 1 && caveat_tags.length <= 3 && stage !== 4) tier = 'STRONG';
  else if (composite >= 35) tier = 'MIXED';
  else tier = 'AVOID';

  // Narrative
  const co = row.company || row.symbol;
  const q = row.quarter || 'Q4';
  const fmtP = (lbl: string, v: number | null) => v == null ? '' : `${lbl} ${v >= 0 ? '+' : ''}${Math.round(v)}% YoY`;
  const head = tier === 'BLOCKBUSTER' ? `${co} prints a blockbuster ${q}` :
               tier === 'STRONG' ? `${co} delivers strong ${q}` :
               tier === 'MIXED' ? `${co} ${q} is a mixed print` : `${co} ${q} fails the bar`;
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
    sales_yoy_pct: salesY, net_profit_yoy_pct: patY, eps_yoy_pct: epsY,
    sales_curr_cr: row.sales_curr_cr ?? null, sales_prev_cr: row.sales_prev_cr ?? null,
    pat_curr_cr: row.pat_curr_cr ?? null, pat_prev_cr: row.pat_prev_cr ?? null,
    eps_curr: row.eps_curr ?? null, eps_prev: row.eps_prev ?? null,
    gap_pct: row.gap_pct ?? null, d1_pct: row.d1_pct ?? null, move_pct: row.move_pct ?? null,
    rs_rating: rs, stage, pct_from_52w_high: pct52,
    composite_score: Math.round(composite), tier,
    methodology_tags: [...new Set(methodology_tags)], caveat_tags: [...new Set(caveat_tags)],
    narrative, filing_url: row.source_url, source: row.financials_source || 'NSE+BSE',
  };
}

// ─── Main handler ──────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date') || '';
  // PATCH 0160 — refreshMissing=1 means: load existing payload, find cards
  // with no financials (sales_curr_cr null AND pat_curr_cr null), re-enrich
  // ONLY those tickers with cache bypass, merge back. Leaves populated cards
  // 100% untouched.
  const refreshMissing = searchParams.get('refreshMissing') === '1';
  // PATCH 0175 — force=1 BUSTS the KV cache and rebuilds from scratch (with
  // a fresh hub fetch). Used by the top "Refresh" button so the user can
  // pull in newly-discovered tickers that the previous cached pass missed.
  const force = searchParams.get('force') === '1';
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date param required (YYYY-MM-DD)' }, { status: 400 });
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const isPast = date < todayIso;
  const cacheKey = `graded:v7:${date}`;

  // Try cache first (past dates are immutable, 90-day TTL — practically forever for our use)
  // ── BUT bypass cache when refreshMissing or force is set ────────────────
  if (isRedisAvailable() && !refreshMissing && !force) {
    try {
      const cached = await kvGet(cacheKey);
      if (cached) {
        // PATCH 0165 — edge cache: past dates immutable for an hour, today fresh-on-demand
        const swr = isPast ? 's-maxage=3600, stale-while-revalidate=86400' : 's-maxage=60, stale-while-revalidate=300';
        return NextResponse.json({ ...cached, _cache: 'hit' }, { headers: { 'Cache-Control': swr } });
      }
    } catch {}
  }
  // PATCH 0175 — on force=1, also delete the existing KV entry so the
  // post-rebuild kvSet writes a clean payload (avoids stale shape merge).
  if (force && isRedisAvailable()) {
    try { await kvSet(cacheKey, null, 1); } catch {}  // null + 1s TTL = effective delete
  }

  // ── PARTIAL REFRESH PATH ──────────────────────────────────────────────
  // Read cached payload, identify cards needing enrichment, refetch only those.
  if (refreshMissing && isRedisAvailable()) {
    try {
      const existing: any = await kvGet(cacheKey);
      if (existing?.by_tier) {
        const allCards: any[] = (TIER_ORDER as EarningsTier[]).flatMap((t) => existing.by_tier[t] || []);
        const needTickers = allCards.filter((c) => c.sales_curr_cr == null && c.pat_curr_cr == null).map((c) => c.ticker);
        if (needTickers.length === 0) {
          return NextResponse.json({ ...existing, _cache: 'hit', _refresh: 'no-op (all populated)' });
        }
        const base = new URL(req.url);
        const chunks: string[][] = [];
        for (let i = 0; i < needTickers.length; i += 40) chunks.push(needTickers.slice(i, i + 40));
        const responses = await Promise.all(chunks.map((ch) =>
          fetch(`${base.protocol}//${base.host}/api/v1/earnings/enrich?symbols=${ch.join(',')}&filed=${date}&nocache=1`, { cache: 'no-store' })
            .then((r) => r.ok ? r.json() : { data: {} })
            .catch(() => ({ data: {} }))
        ));
        const enrich: Record<string, any> = {};
        for (const r of responses) Object.assign(enrich, r.data || {});

        // Re-grade ONLY the missing-data cards
        const replacedTickers = new Set<string>();
        const updatedCards: ParsedEarning[] = [];
        for (const c of allCards) {
          if (c.sales_curr_cr != null || c.pat_curr_cr != null) {
            updatedCards.push(c);  // keep populated card as-is (untouched)
            continue;
          }
          const e = enrich[c.ticker];
          if (!e || (e.sales_curr_cr == null && e.pat_curr_cr == null)) {
            updatedCards.push(c);  // still no data → keep preview
            continue;
          }
          // Re-grade with new enrichment data
          const row = {
            hub_quality: undefined,                    // we have financials now, no preview path
            symbol: c.ticker, company: c.company, filing_date: c.filing_date,
            quarter: c.quarter, sector: e.sector || c.sector,
            market_cap_bucket: e.market_cap_bucket || c.market_cap_bucket,
            source_url: c.filing_url,
            sales_curr_cr: e.sales_curr_cr, sales_prev_cr: e.sales_prev_cr, sales_yoy_pct: e.sales_yoy_pct,
            pat_curr_cr: e.pat_curr_cr, pat_prev_cr: e.pat_prev_cr, pat_yoy_pct: e.pat_yoy_pct,
            eps_curr: e.eps_curr, eps_prev: e.eps_prev, eps_yoy_pct: e.eps_yoy_pct,
            op_profit_yoy_pct: e.op_profit_yoy_pct, opm_pct: e.opm_pct, opm_prev_pct: e.opm_prev_pct,
            pe: e.pe, current_price: e.current_price ?? c.price,
            gap_pct: e.gap_pct ?? c.gap_pct, d1_pct: e.d1_pct ?? c.d1_pct, move_pct: e.move_pct ?? c.move_pct,
            pct_from_52w_high: e.pct_from_52w_high ?? c.pct_from_52w_high,
            rs_rating: e.rs_rating ?? c.rs_rating, stage: e.stage ?? c.stage,
            trend_template_passes: e.trend_template_passes,
            ocf_annual_cr: e.ocf_annual_cr, pat_annual_cr: e.pat_annual_cr, ocf_to_pat_ratio: e.ocf_to_pat_ratio,
            period_ended: e.period_ended, latest_quarter_end_iso: e.latest_quarter_end_iso,
            announce_date_iso: e.announce_date_iso,
            financials_source: e.financials_source,
          };
          const g = gradeRow(row);
          if (g) {
            updatedCards.push(g);
            replacedTickers.add(c.ticker);
          } else {
            updatedCards.push(c);
          }
        }

        // Rebuild by_tier and re-sort
        const by_tier: Record<EarningsTier, ParsedEarning[]> = { BLOCKBUSTER: [], STRONG: [], MIXED: [], AVOID: [] };
        for (const g of updatedCards) by_tier[g.tier].push(g);
        for (const t of TIER_ORDER) by_tier[t].sort((a, b) => b.composite_score - a.composite_score);

        const payload = {
          ...existing,
          by_tier,
          candidates_total: updatedCards.length,
          generated_at: new Date().toISOString(),
          _cache: 'partial-refresh',
          _refresh: `${replacedTickers.size}/${needTickers.length} updated`,
        };
        // Write back with same TTL strategy
        const ttl = isPast ? 90 * 24 * 3600 : 15 * 60;
        try { await kvSet(cacheKey, payload, ttl); } catch {}
        return NextResponse.json(payload);
      }
    } catch (e) {
      // Fall through to full-rebuild path
    }
  }

  // Fetch hub for the month
  const base = new URL(req.url);
  const month = date.slice(0, 7);
  // PATCH 0175 — when force=1, propagate to the hub so its in-memory cache also gets bypassed
  const hubUrl = `${base.protocol}//${base.host}/api/market/earnings?market=india&month=${month}${force ? '&force=1' : ''}`;
  const hubRes = await fetch(hubUrl, { cache: 'no-store' });
  if (!hubRes.ok) {
    return NextResponse.json({ error: 'hub fetch failed', status: hubRes.status }, { status: 502 });
  }
  const hub = await hubRes.json();
  const dayList = (hub?.results || []).filter((r: any) => r.resultDate === date && r.quality !== 'Upcoming');

  if (dayList.length === 0) {
    const empty = {
      filing_date: date,
      candidates_total: 0,
      raw_items_total: 0,
      by_tier: { BLOCKBUSTER: [], STRONG: [], MIXED: [], AVOID: [] },
      generated_at: new Date().toISOString(),
      sources_polled: 1,
    };
    if (isPast && isRedisAvailable()) {
      try { await kvSet(cacheKey, empty, 90 * 24 * 3600); } catch {}
    }
    return NextResponse.json(empty);
  }

  // Fetch enrichment for all tickers (chunk to 40 per request)
  const symbols: string[] = dayList.map((r: any) => r.ticker);
  const chunks: string[][] = [];
  for (let i = 0; i < symbols.length; i += 40) chunks.push(symbols.slice(i, i + 40));

  const enrichResponses = await Promise.all(chunks.map((chunk) =>
    fetch(`${base.protocol}//${base.host}/api/v1/earnings/enrich?symbols=${chunk.join(',')}&filed=${date}`, { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : { data: {} })
      .catch(() => ({ data: {} }))
  ));
  const enrich: Record<string, any> = {};
  for (const r of enrichResponses) Object.assign(enrich, r.data || {});

  // Join + grade
  const graded: ParsedEarning[] = [];
  for (const m of dayList) {
    const e = enrich[m.ticker] || {};
    const row = {
      hub_quality: m.quality,
      symbol: m.ticker, company: m.company, filing_date: m.resultDate,
      quarter: m.quarter || e.quarter || 'Q4',
      sector: e.sector || m.sector,
      market_cap_bucket: e.market_cap_bucket ||
        (m.marketCap === 'L' ? 'LARGE' : m.marketCap === 'M' ? 'MID' : m.marketCap === 'S' ? 'SMALL' : m.marketCap === 'Micro' ? 'MICRO' : null),
      source_url: e.source_url || `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(m.ticker)}`,
      sales_curr_cr: e.sales_curr_cr ?? null, sales_prev_cr: e.sales_prev_cr ?? null,
      sales_yoy_pct: e.sales_yoy_pct ?? null,
      pat_curr_cr: e.pat_curr_cr ?? null, pat_prev_cr: e.pat_prev_cr ?? null,
      pat_yoy_pct: e.pat_yoy_pct ?? null,
      eps_curr: e.eps_curr ?? null, eps_prev: e.eps_prev ?? null, eps_yoy_pct: e.eps_yoy_pct ?? null,
      op_profit_yoy_pct: e.op_profit_yoy_pct ?? null, opm_pct: e.opm_pct ?? null, opm_prev_pct: e.opm_prev_pct ?? null,
      pe: e.pe ?? null,
      current_price: e.current_price ?? m.cmp ?? null,
      gap_pct: e.gap_pct ?? null, d1_pct: e.d1_pct ?? null,
      move_pct: e.move_pct ?? m.priceMove ?? null,
      pct_from_52w_high: e.pct_from_52w_high ?? null,
      rs_rating: e.rs_rating ?? null, stage: e.stage ?? null,
      trend_template_passes: e.trend_template_passes ?? false,
      ocf_annual_cr: e.ocf_annual_cr ?? null, pat_annual_cr: e.pat_annual_cr ?? null, ocf_to_pat_ratio: e.ocf_to_pat_ratio ?? null,
      period_ended: e.period_ended, latest_quarter_end_iso: e.latest_quarter_end_iso,
            announce_date_iso: e.announce_date_iso,
      financials_source: e.financials_source,
    };
    const g = gradeRow(row);
    if (g) graded.push(g);
  }

  const by_tier: Record<EarningsTier, ParsedEarning[]> = { BLOCKBUSTER: [], STRONG: [], MIXED: [], AVOID: [] };
  for (const g of graded) by_tier[g.tier].push(g);
  for (const t of TIER_ORDER) by_tier[t].sort((a, b) => b.composite_score - a.composite_score);

  const payload = {
    filing_date: date,
    candidates_total: graded.length,
    raw_items_total: dayList.length,
    by_tier,
    generated_at: new Date().toISOString(),
    sources_polled: 2,
    _cache: 'miss',
  };

  // Cache: past dates 90 days (immutable), today 15 min
  if (isRedisAvailable()) {
    const ttl = isPast ? 90 * 24 * 3600 : 15 * 60;
    try { await kvSet(cacheKey, payload, ttl); } catch {}
  }

  return NextResponse.json(payload);
}

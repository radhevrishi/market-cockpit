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
//     'graded:v10:<YYYY-MM-DD>' is hit on every subsequent visit (<100ms). (zzz190: v9->v10 to purge stale historic dates that got dropped by the old 7-day rule)
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


// PATCH 0983 — Railway self-fetch loopback fallback (module-level).
// graded/route.ts makes TWO self-fetches to /api/v1/earnings/enrich
// using its own public URL. On Railway these fail like the hub fetch
// because the edge layer rejects self-loops. Retry via 127.0.0.1:$PORT.
async function _doEnrichSelfFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err: any) {
    const port = process.env.PORT;
    if (port && /^https?:\/\/[^/]+\//.test(url)) {
      const loop = url.replace(/^https?:\/\/[^/]+/, `http://127.0.0.1:${port}`);
      console.log(`[graded/enrich] public-URL fetch failed (${err?.message}), retrying via loopback`);
      return await fetch(loop, init);
    }
    throw err;
  }
}

export const runtime = 'nodejs';
export const maxDuration = 90;  // PATCH 0993 — was 30s; dense dates need ~60s enrichment // PATCH 0818
// PATCH 0819: removed force-dynamic so Cache-Control headers aren't overridden by Next.js. Query params still force dynamic at runtime.

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
    // zzz187: preserve absolute-quarter values + PE + market cap from enrichment.
    // Prior fix blanked everything just because YoY couldn't be computed. Show
    // whatever came in from /enrich so the card is informative even without YoY.
    const hasAnyAbsolute = row?.sales_curr_cr != null || row?.pat_curr_cr != null || row?.eps_curr != null || row?.pe != null || row?.marketCapCr != null;
    const absoluteBits: string[] = [];
    if (row?.sales_curr_cr != null) absoluteBits.push(`Rev \u20B9${row.sales_curr_cr}Cr`);
    if (row?.pat_curr_cr != null) absoluteBits.push(`PAT \u20B9${row.pat_curr_cr}Cr`);
    if (row?.eps_curr != null) absoluteBits.push(`EPS \u20B9${row.eps_curr}`);
    const absStr = absoluteBits.length ? ' \u00b7 ' + absoluteBits.join(' \u00b7 ') : '';
    const narrative = hasAnyAbsolute
      ? `${row.company || row.symbol} Q4 results${moveLabel}${absStr}. YoY comparison unavailable (prior-period data missing).`
      : `${row.company || row.symbol} reported Q4 results${moveLabel}. Financial detail awaiting enrichment.`;
    return {
      ticker: row.symbol, company: row.company || row.symbol, sector: row.sector, filing_date: row.filing_date,
      quarter: row.quarter || 'Q4', market_cap_bucket: row.market_cap_bucket,
      market_cap_cr: row.marketCapCr ?? row.market_cap_cr ?? null,
      pe: row.pe ?? row.stockPE ?? null,
      price: row.current_price ?? null,
      sales_yoy_pct: null, net_profit_yoy_pct: null, eps_yoy_pct: null,
      sales_curr_cr: row.sales_curr_cr ?? null, sales_prev_cr: null,
      pat_curr_cr: row.pat_curr_cr ?? null, pat_prev_cr: null,
      eps_curr: row.eps_curr ?? null, eps_prev: null,
      gap_pct: row.gap_pct ?? null, d1_pct: row.d1_pct ?? null, move_pct: move,
      rs_rating: row.rs_rating ?? null, stage: row.stage ?? null, pct_from_52w_high: row.pct_from_52w_high ?? null,
      composite_score: score, tier,
      methodology_tags: [],
      caveat_tags: hasAnyAbsolute ? ['prior-year missing'] : [],
      narrative,
      filing_url: row.source_url,
      source: hasAnyAbsolute ? (row.financials_source || 'screener-worker') : 'NSE+BSE',
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
  // zzz72 — require recent announce_date for past dates to prevent stale Screener data pollution.
  // PATCH 0182 only fires when announce_date_iso is present. On Screener-only rows it's null,
  // so the guard silently passes — Screener returns the LATEST quarter's financials, which
  // can be months old. Without announce_date_iso to verify the filing actually happened on
  // row.filing_date, we have no way to confirm this row is a real filing for that date.
  // Rule: if announce_date_iso is missing AND filing_date is in the past by more than 7 days
  // (i.e. user is querying a stale past date), skip — Screener's latest-quarter data is not a
  // safe substitute for an actual filing event on that historic date.
  // zzz190: the 7-day guard is meant to reject rows where Screener's latest-quarter
  // data cannot confirm the historic filing actually happened. But if hub_quality is
  // set to anything other than 'Upcoming' (Good/OK/Great/Excellent/Weak), the Earnings
  // Hub has already confirmed the filing. Keep those rows for historical browsing.
  if (!row?.announce_date_iso && row?.filing_date) {
    const filingD = new Date(row.filing_date);
    const todayD = new Date();
    if (!isNaN(filingD.getTime())) {
      const ageDays = (todayD.getTime() - filingD.getTime()) / 86_400_000;
      const hubConfirmed = row?.hub_quality && row.hub_quality !== 'Upcoming';
      if (ageDays > 7 && !hubConfirmed) return null;
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
  // PATCH 1001 — Still loss-making gate. Going from bigger loss to smaller
  // loss inflates YoY % by absolute-value math. The story may be valid
  // (turnaround) but the conviction label is not earned yet.
  const stillLossPat = row?.pat_curr_cr != null && row.pat_curr_cr <= 0;
  const stillLossEps = row?.eps_curr != null && row.eps_curr <= 0;
  const stillLossMaking = stillLossPat || stillLossEps;
  if (stillLossMaking) caveat_tags.push('low quality');
  // PATCH 1008 — Turnaround base: YoY% is mathematically meaningless when
  // prior was negative. Block BLOCKBUSTER for these even though they show
  // huge +X% growth (from abs-value division). Story may be valid but
  // conviction label is not yet earned.
  const turnaroundBase = (row?.pat_prev_cr != null && row.pat_prev_cr < 0)
                      || (row?.eps_prev   != null && row.eps_prev   < 0);
  if (turnaroundBase) caveat_tags.push('low quality');
  if (opmExp != null && opmExp < -1.5) caveat_tags.push('segment mix shift');
  // PATCH 1000 — Margin contraction caveat. Any drop below flat (≤ -0.5 pp)
  // for a stock the grader is otherwise about to call BLOCKBUSTER is a
  // yellow flag — true expansion stories show OPM widening, not narrowing.
  if (opmExp != null && opmExp <= -0.5 && !caveat_tags.includes('segment mix shift')) {
    caveat_tags.push('segment mix shift');
  }
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
  // PATCH 1000 — margin-expansion ladder (was: only +8 at ≥3 pp).
  if (opmExp != null) {
    if (opmExp >= 5) quality += 14;
    else if (opmExp >= 3) quality += 10;
    else if (opmExp >= 1) quality += 5;
    else if (opmExp <= -0.5) quality -= 8;   // explicit contraction penalty
    else if (opmExp <= -2) quality -= 14;
  }
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
  // PATCH 0837 + 0838 — Margin Inflection / Operating Leverage path.
  // Tier A (extreme): PAT >= 100 + EPS >= 100 + sales not collapsing.
  //   Catches GLOSTERLTD (PAT+454/EPS+454), SHIVAUM (PAT+8120/EPS+7450).
  // Tier B (strong, P0838): PAT >= 75 + EPS >= 75 + sales >= 0 + stage != 4.
  //   Catches near-mega stories like Investment & Precision Castings
  //   (PAT+98/EPS+98/sales+20/comp 68) that failed the Tier A 100% gate.
  const marginInflection = patY != null && patY >= 100 && epsY != null && epsY >= 100 && salesY != null && salesY >= -5;
  const marginInflectionLoose = patY != null && patY >= 75 && epsY != null && epsY >= 75 && salesY != null && salesY >= 0 && stage !== 4;

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
  // PATCH 0837 — Path D: pure margin inflection (PAT+EPS >= 100%). Ignores
  // sales growth requirement — the extreme PAT/EPS magnitude IS the signal.
  const bbPathD = marginInflection && caveat_tags.length <= 3 && stage !== 4;
  // PATCH 0838 — Path E: loose margin inflection (PAT+EPS >= 75% + sales >= 0).
  // Tighter caveat limit (<=2) and stage filter since the magnitude is less
  // extreme than Path D. Catches operating-leverage stories where PAT/EPS
  // double on modest sales growth — Investment & Precision Castings class.
  const bbPathE = marginInflectionLoose && caveat_tags.length <= 2;
  const blockbusterGate = bbPathA || bbPathB || bbPathC || bbPathD || bbPathE;
  // PATCH 1000 — Hard MARGIN GATE on BLOCKBUSTER. If OPM is KNOWN to be
  // contracting (opmExp <= -0.5 pp), cap tier at STRONG even if growth and
  // composite both pass. User-reported: 'many companies incorrectly marked
  // as blockbuster' due to revenue magnitude alone without margin support.
  // Unknown OPM (null) → no gate (don't penalize data gaps).
  // PATCH 1000 / 1020 — graduated margin gate.
  //   marginContracting (≤ -0.5 pp): mild contraction → blocks BLOCKBUSTER,
  //     demotes to STRONG. A growth print with a small margin dip is OK as STRONG.
  //   marginSevereContraction (≤ -1.5 pp): clear contraction → blocks STRONG
  //     too, caps at MIXED. User: 'if margins are bad it should not be in
  //     strong or blockbuster' — e.g. VARROC OPM -2pp + optical eps was wrongly STRONG.
  const marginContracting = opmExp != null && opmExp <= -0.5;
  const marginSevereContraction = opmExp != null && opmExp <= -1.5;
  if (broken && composite < 70) tier = 'AVOID';
  else if (stillLossMaking && blockbusterGate) tier = 'MIXED';  // PATCH 1001 — loss-makers cannot be BB
  else if (turnaroundBase && blockbusterGate) tier = 'MIXED';  // PATCH 1008 — turnaround base cannot be BB
  else if (blockbusterGate && marginSevereContraction) tier = 'MIXED';  // PATCH 1020 — severe contraction caps at MIXED
  else if (blockbusterGate && !marginContracting) tier = 'BLOCKBUSTER';
  else if (blockbusterGate && marginContracting) tier = 'STRONG';
  else if (composite >= 68 && mCount >= 1 && caveat_tags.length <= 3 && stage !== 4 && !stillLossMaking && !turnaroundBase && !marginSevereContraction) tier = 'STRONG';  // PATCH 1001/1008/1020 — STRONG excludes loss-makers, turnaround base, AND severe margin contraction
  // PATCH 1022 — QUALITY STRONG path. A print with solid double-digit sales
  // growth + strong PAT growth + ACTUALLY EXPANDING margins is STRONG even if
  // the composite lands a point or two below the 68 floor. User-reported:
  // ASTRAMICRO (sales +20% / PAT +45% / EPS +44% / OPM +4pp / D1 +10% /
  // composite 67) was wrongly MIXED purely because composite was 1 pt short.
  // Requires margins genuinely expanding (opmExp >= +0.5pp) so this never
  // rescues a contracting-margin name.
  else if (
    composite >= 60 &&
    salesY != null && salesY >= 10 &&
    patY != null && patY >= 25 &&
    epsY != null && epsY >= 15 &&
    opmExp != null && opmExp >= 0.5 &&
    !stillLossMaking && !turnaroundBase &&
    caveat_tags.length <= 3 && stage !== 4
  ) tier = 'STRONG';
  else if (composite >= 35) tier = 'MIXED';
  else tier = 'AVOID';

  // PATCH 0938 — Market-reaction gate (user-reported: POCL +78%/+124% scored
  // BLOCKBUSTER but stock sold off -6% D1; CARRARO same pattern at -5% D1).
  //
  // The grader was purely fundamental — it never looked at how the MARKET
  // priced the print. A "blockbuster" that gets sold off on D1 is signalling
  // one of: (a) numbers were already in the price, (b) tax/other-income
  // skew the market is discounting, (c) guidance disappointed even though
  // headline numbers beat, (d) margin compression the market noticed first.
  //
  // Downgrade ladder based on Day-1 close % (the cleanest signal of market
  // verdict — gap alone is noisy from pre-market liquidity).
  //   D1 <= -7%  → cap at MIXED, caveat 'sold off post-results'
  //   D1 <= -3%  → downgrade BLOCKBUSTER → STRONG, caveat 'market rejected print'
  //   Gap >= +3 BUT D1 close <= -2% → caveat 'intraday reversal · distribution'
  //
  // Logic is one-way (only downgrades). A negative D1 reaction never elevates a tier.
  const d1Reaction = typeof row?.d1_pct === 'number' ? row.d1_pct : null;
  const gapReaction = typeof row?.gap_pct === 'number' ? row.gap_pct : null;
  if (d1Reaction !== null) {
    if (d1Reaction <= -7) {
      // Severe rejection — even a true blockbuster gets capped at MIXED.
      if (tier === 'BLOCKBUSTER' || tier === 'STRONG') tier = 'MIXED';
      if (!caveat_tags.includes('sold off post-results')) caveat_tags.push('sold off post-results');
    } else if (d1Reaction <= -3) {
      // Moderate rejection — downgrade BLOCKBUSTER → STRONG.
      if (tier === 'BLOCKBUSTER') tier = 'STRONG';
      if (!caveat_tags.includes('market rejected print')) caveat_tags.push('market rejected print');
    }
    // Distribution-day pattern — opened up but closed down.
    if (gapReaction !== null && gapReaction >= 3 && d1Reaction <= -2) {
      if (!caveat_tags.includes('intraday reversal · distribution')) {
        caveat_tags.push('intraday reversal · distribution');
      }
    }
  }

  // PATCH 1034 — Liquidity / thin-float gate. A name that barely trades can't be
  // built or exited at size, so it doesn't belong in the top conviction tiers.
  // Demote (never delete) + tag. Missing ADTV is NOT punished (data gap ≠ illiquid).
  const _adtv = (typeof row?.adtv_cr === 'number' && Number.isFinite(row.adtv_cr)) ? row.adtv_cr : null;
  const THIN_ADTV_CR = 1;  // < ₹1 Cr/day median traded value = thin float / illiquid
  const _thinFloat = _adtv != null && _adtv < THIN_ADTV_CR;
  if (_thinFloat) {
    if (tier === 'BLOCKBUSTER' || tier === 'STRONG') tier = 'MIXED';
    if (!caveat_tags.includes('thin float')) caveat_tags.push('thin float');
  }

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

  // PATCH 1006 — compute ELITE / PEAD / MULTIBAGGER flags from available data
  const _stillLoss = (row?.pat_curr_cr != null && row.pat_curr_cr <= 0) || (row?.eps_curr != null && row.eps_curr <= 0);
  const _criticalsOrStruct = caveat_tags.filter((t: any) => t === 'low quality' || t === 'ocf divergence' || t === 'optical eps').length;
  // PATCH 1010 — STRICT ELITE gate. All criteria required; null fails.
  const _is_elite = !!(
    !_stillLoss && !turnaroundBase
    && row?.pat_curr_cr != null && row.pat_curr_cr > 0
    && row?.eps_curr != null && row.eps_curr > 0
    && salesY != null && salesY >= 25
    && patY != null && patY >= 30
    && opmExp != null && opmExp >= 1
    && row?.d1_pct != null && row.d1_pct >= 2
    && row?.gap_pct != null && row.gap_pct >= 0
    && _criticalsOrStruct === 0
    && stage !== 4
    && (rs == null || rs >= 60)
    && !(row?.pat_prev_cr != null && row.pat_prev_cr < 0)  // PATCH 1008 — no turnaround base in ELITE
    && !_thinFloat  // PATCH 1034 — thin float can't be ELITE
  );
  const _sc = (v: number | null | undefined, ranges: [number, number][]): number => {
    if (v == null || !Number.isFinite(v)) return 0;
    for (const [thr, pts] of ranges) if (v >= thr) return pts;
    return 0;
  };
  // PATCH 1009 — when d1/gap null, redistribute their weight to surprise.
  // The Bernard-Thomas drift model trusts the price signal most, but without
  // it we shouldn't tank to 0 — we should fall back to fundamentals (surprise).
  const _d1Known = row?.d1_pct != null;
  const _gapKnown = row?.gap_pct != null;
  const _d1S = _sc(row?.d1_pct, [[8,100],[5,85],[3,70],[1,50],[0,30],[-2,15]]);
  const _gapS = _sc(row?.gap_pct, [[3,100],[1,75],[0,55],[-1,30]]);
  const _surS = _sc(patY, [[100,100],[50,80],[25,60],[10,40],[0,25]]);
  const _salesS = _sc(salesY, [[50,100],[25,80],[15,60],[5,40],[0,25]]);
  const _volS = 50;
  // Available signal mix: when d1+gap known, use full PEAD formula.
  // When missing, fall back to fundamentals-weighted (sales 25% + pat 50% + vol 25%).
  const _pead = (_d1Known || _gapKnown)
    ? Math.round(_d1S * 0.35 + _gapS * 0.15 + _volS * 0.25 + _surS * 0.25)
    : Math.round(_salesS * 0.25 + _surS * 0.50 + _volS * 0.25);
  const _pead_score = Math.max(0, Math.min(100, _pead));
  const _roce = (row as any)?.roce;
  const _opm = row?.opm_pct;
  const _prom = (row as any)?.promoter;
  // PATCH 1009 — MULTIBAGGER: relaxed. Requires AT LEAST ONE quality signal
  // (roce or opm or opmExp positive) + not loss-making. Stricter than ELITE
  // but doesn't require ALL fields populated.
  const _mbSignals = ((typeof _roce === 'number' && _roce >= 25) ? 1 : 0)
                   + ((typeof _opm === 'number' && _opm >= 18) ? 1 : 0)
                   + ((opmExp != null && opmExp >= 1) ? 1 : 0)
                   + ((typeof _prom === 'number' && _prom >= 45) ? 1 : 0);
  const _multibagger = !!(_mbSignals >= 2 && !_stillLoss);
  return {
    ticker: row.symbol,
    company: row.company || row.symbol,
    sector: row.sector,
    filing_date: row.filing_date,
    quarter: row.quarter || 'Q4',
    market_cap_bucket: row.market_cap_bucket,
    market_cap_cr: row.market_cap_cr ?? null,
    adtv_cr: _adtv,  // PATCH 1034 — liquidity (median ₹Cr/day)
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
    // PATCH 1006
    is_elite: _is_elite,
    pead_score: _pead_score,
    multibagger_setup: _multibagger,
    // PATCH 1015 — the actual root cause: gradeRow built the return object
    // by listing fields explicitly and OMITTED opm_pct / opm_prev_pct. The
    // row going in HAD these populated from enrich; gradeRow stripped them.
    // Every previous OPM patch was correct in principle but invisible because
    // this final return shape never included the field. Fix: include them.
    opm_pct: row.opm_pct ?? null,
    opm_prev_pct: row.opm_prev_pct ?? null,
  } as any;
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
  const cacheKey = `graded:v10:${date}`;  // zzz190: bumped v9->v10 to invalidate cached empty payloads for historic dates under the old 7-day drop rule

  // Try cache first (past dates are immutable, 90-day TTL — practically forever for our use)
  // ── BUT bypass cache when refreshMissing or force is set ────────────────
  //
  // PATCH 0360 — Auto-heal preview-heavy past-date caches.
  //
  // Symptom we're fixing: user visits /earnings-opportunities for an old date.
  // The cached payload was written weeks ago when the day's filings hadn't
  // propagated to Screener yet. Most cards in cache are preview-shape (no
  // YoY data, narrative='Financial detail awaiting enrichment'). Cache-hit
  // serves them as-is, so user sees stale previews and must click Refresh.
  //
  // Fix: on cache hit for a past date, count how many cards lack YoY data.
  // If more than 30% are previews AND the date is past, internally promote
  // this request to a refreshMissing pass — which targets just those preview
  // tickers and returns enriched results. Subsequent visits hit the now-
  // fully-enriched cache.
  //
  // No automatic re-enrich for today's date — those are expected to be
  // preview-heavy until filings propagate (we still respect manual Refresh).
  let autoPromoteToRefreshMissing = false;
  if (isRedisAvailable() && !refreshMissing && !force) {
    try {
      const cached = await kvGet(cacheKey);
      if (cached) {
        const allCards: any[] = (TIER_ORDER as EarningsTier[])
          .flatMap((t) => (cached as any)?.by_tier?.[t] || []);
        const totalCards = allCards.length;
        const previewCards = allCards.filter((c) =>
          c.sales_yoy_pct == null && c.net_profit_yoy_pct == null && c.eps_yoy_pct == null
        ).length;
        const previewRatio = totalCards > 0 ? previewCards / totalCards : 0;
        // PATCH 0454 P1-26 — Audit found auto-heal could fire 12×/hour on
        // hot dates (47-ticker fan-out per fire = enormous load). Added a
        // KV-backed lockout so a date that just auto-healed can't trigger
        // again for 30 minutes regardless of how many users hit the route.
        const HEAL_LOCKOUT_S = 30 * 60;
        const lockoutKey = `graded:autoheal-lock:${cacheKey}`;
        let recentlyHealed = false;
        try {
          const lock = await kvGet<number>(lockoutKey);
          if (lock && Date.now() - lock < HEAL_LOCKOUT_S * 1000) recentlyHealed = true;
        } catch {}
        // Auto-heal threshold: past date, ≥3 cards in payload, ≥40% previews
        // (was 30% — too sensitive; raised so we don't re-heal cards that
        // are genuinely preview-only because sources never published).
        //
        // PATCH 0497 — Bypass empty-cache for recent past dates so the new
        // live-NSE augmentation actually runs. Indian companies file Fri/
        // Sat/Sun/Mon every week; an empty cache from an earlier crawl
        // shouldn't lock that out for 90 days.
        const dateAgeDaysForCache = Math.max(0, Math.floor(
          (new Date(todayIso).getTime() - new Date(date).getTime()) / 86_400_000
        ));
        const isRecentPast = isPast && dateAgeDaysForCache <= 14;
        const isEmptyCache = totalCards === 0;
        const bypassEmptyCache = isRecentPast && isEmptyCache && !recentlyHealed;
        if (isPast && totalCards >= 3 && previewRatio >= 0.40 && !recentlyHealed) {
          autoPromoteToRefreshMissing = true;
          // Set the lockout immediately so other concurrent requests skip.
          try { await kvSet(lockoutKey, Date.now(), HEAL_LOCKOUT_S); } catch {}
        } else if (bypassEmptyCache) {
          // Empty payload for a recent date — try a full rebuild so the
          // new live-NSE augmentation can fire. Set lockout to throttle.
          try { await kvSet(lockoutKey, Date.now(), HEAL_LOCKOUT_S); } catch {}
          // Fall through to rebuild path (don't return cached empty).
        } else {
          const swr = isPast ? 's-maxage=3600, stale-while-revalidate=86400' : 's-maxage=60, stale-while-revalidate=300';
          return NextResponse.json({ ...cached, _cache: 'hit' }, { headers: { 'Cache-Control': swr } });
        }
      }
    } catch {}
  }
  // Promote in-request when auto-heal fires. From this point on, treat
  // the request as refreshMissing=1 (but keep force=false so we don't
  // delete the cache before reading it).
  const effectiveRefreshMissing = refreshMissing || autoPromoteToRefreshMissing;
  // PATCH 0175 / 0358 — on force=1, delete the existing KV entry so the
  // post-rebuild kvSet writes a clean payload (avoids stale shape merge).
  // CRITICAL: only delete when force=1 WITHOUT refreshMissing=1. The
  // refreshMissing path needs the existing payload to identify which
  // tickers need re-enrichment; deleting it first makes that block fall
  // through to full rebuild, which returns no `_refresh` field and
  // produces a meaningless "0/0 updated" message on the client.
  if (force && !refreshMissing && isRedisAvailable()) {
    try { await kvSet(cacheKey, null, 1); } catch {}  // null + 1s TTL = effective delete
  }

  // ── PARTIAL REFRESH PATH ──────────────────────────────────────────────
  // Read cached payload, identify cards needing enrichment, refetch only those.
  // PATCH 0360 — also fires when auto-heal promoted the request.
  if (effectiveRefreshMissing && isRedisAvailable()) {
    try {
      const existing: any = await kvGet(cacheKey);
      if (existing?.by_tier) {
        const allCards: any[] = (TIER_ORDER as EarningsTier[]).flatMap((t) => existing.by_tier[t] || []);
        // PATCH 0360 — broadened "missing" criterion. A card with raw
        // sales_curr_cr but no YoY data renders identical to a preview
        // (all dashes), so it should be re-enriched too.
        // PATCH 1011 — also re-enrich when opm/d1/gap are missing.
        // Old cached payloads from before Patches 1003/1005 have sales/pat/eps
        // populated but lack opm_pct + d1_pct + gap_pct. Those cards show
        // 'screener gap' and prevent ELITE qualification. Detect and refresh.
        const needTickers = allCards
          .filter((c) => {
            const noFinancials = c.sales_yoy_pct == null
                               && c.net_profit_yoy_pct == null
                               && c.eps_yoy_pct == null;
            const noMargin = (c as any).opm_pct == null
                          && (c as any).opm_prev_pct == null;
            const noPriceAction = c.d1_pct == null && c.gap_pct == null;
            // Refresh if NO financials OR (has financials but no margin AND no price action)
            return noFinancials || (noMargin && noPriceAction);
          })
          .map((c) => c.ticker);
        if (needTickers.length === 0) {
          return NextResponse.json({ ...existing, _cache: 'hit', _refresh: 'no-op (all populated)' }, { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=900' } });  // PATCH 0818
        }
        const base = new URL(req.url);
        const chunks: string[][] = [];
        for (let i = 0; i < needTickers.length; i += 40) chunks.push(needTickers.slice(i, i + 40));
        const responses = await Promise.all(chunks.map((ch) =>
          _doEnrichSelfFetch(`${base.protocol}//${base.host}/api/v1/earnings/enrich?symbols=${ch.join(',')}&filed=${date}&nocache=1`, { cache: 'no-store' })
            .then((r) => r.ok ? r.json() : { data: {} })
            .catch(() => ({ data: {} }))
        ));
        const enrich: Record<string, any> = {};
        for (const r of responses) Object.assign(enrich, r.data || {});

        // Re-grade ONLY the missing-data cards
        const replacedTickers = new Set<string>();
        const updatedCards: ParsedEarning[] = [];
        for (const c of allCards) {
          // PATCH 0360 — keep card unchanged ONLY when it already has YoY
          // data (matches the new preview-detection criterion). A card with
          // sales_curr_cr=N but null YoY is preview-shape and should re-enrich.
          const cardAlreadyHasYoY =
            c.sales_yoy_pct != null ||
            c.net_profit_yoy_pct != null ||
            c.eps_yoy_pct != null;
          if (cardAlreadyHasYoY) {
            updatedCards.push(c);
            continue;
          }
          const e = enrich[c.ticker];
          // PATCH 0360 — enrich-success criterion also uses YoY presence.
          const enrichHasYoY = !!e && (
            e.sales_yoy_pct != null ||
            e.pat_yoy_pct != null ||
            e.eps_yoy_pct != null
          );
          if (!enrichHasYoY) {
            updatedCards.push(c);  // still no useful data → keep preview
            continue;
          }
          // Re-grade with new enrichment data
          const row = {
            hub_quality: undefined,                    // we have financials now, no preview path
            // PATCH 0369 — prefer enrich's resolved company name (it now
            // queries Screener.in search when NSE name was missing/junk).
            // Falls back to the cached card name if enrich didn't resolve.
            symbol: c.ticker,
            company: (e.company && e.company !== c.ticker && e.company.toUpperCase() !== String(c.ticker).toUpperCase())
              ? e.company
              : (c.company || e.company_name || c.ticker),
            filing_date: c.filing_date,
            quarter: c.quarter, sector: e.sector || c.sector,
            market_cap_bucket: e.market_cap_bucket || c.market_cap_bucket,
            market_cap_cr: e.market_cap_cr ?? (c as any).market_cap_cr ?? null,
            adtv_cr: e.adtv_cr ?? null,  // PATCH 1037 — carry liquidity into grader
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
          // PATCH 0359 — only count a card as "replaced" when enrich produced
          // a card with meaningful financial data (YoY %s present, not just
          // a raw sales_curr_cr). Previously gradeRow could return a card
          // with sales_curr_cr=N but YoY=null which counts as "updated" in
          // the message but renders identical to the preview card on screen.
          // The user sees "Updated 11/11" while staring at preview cards.
          const hasRealFinancials = !!g && (
            g.sales_yoy_pct != null || g.net_profit_yoy_pct != null || g.eps_yoy_pct != null
          );
          if (g && hasRealFinancials) {
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

        // PATCH 0192 — Return the exact tickers that were attempted but failed
        // (still missing financials after the refresh). Client uses this for
        // accurate error messages instead of relying on its potentially stale
        // local view.
        const failedTickers = needTickers.filter((t) => !replacedTickers.has(t));
        const payload = {
          ...existing,
          by_tier,
          candidates_total: updatedCards.length,
          generated_at: new Date().toISOString(),
          _cache: 'partial-refresh',
          _refresh: `${replacedTickers.size}/${needTickers.length} updated`,
          _attempted_tickers: needTickers,
          _failed_tickers: failedTickers,
          _updated_tickers: [...replacedTickers],
        };
        // Write back with same TTL strategy
        const ttl = isPast ? 365 * 24 * 3600 : 5 * 60;
        // PATCH 1002 — guard final cache write too. If the new payload graded
    // ZERO tickers but a cached version had entries, preserve the cache.
    try {
      const _t = (payload as any).by_tier;
      const _gradedCount = (_t?.BLOCKBUSTER?.length || 0)
                         + (_t?.STRONG?.length || 0)
                         + (_t?.MIXED?.length || 0)
                         + (_t?.AVOID?.length || 0);
      let _skipWrite = false;
      if (_gradedCount === 0) {
        const _prior: any = await kvGet(cacheKey);
        if (_prior?.by_tier) {
          const _priorN = (_prior.by_tier.BLOCKBUSTER?.length || 0)
                        + (_prior.by_tier.STRONG?.length || 0)
                        + (_prior.by_tier.MIXED?.length || 0)
                        + (_prior.by_tier.AVOID?.length || 0);
          if (_priorN > 0) {
            _skipWrite = true;
            console.log(`[graded] PATCH 1002: final write blocked — payload empty but cache has ${_priorN} entries`);
          }
        }
      }
      if (!_skipWrite) await kvSet(cacheKey, payload, ttl);
    } catch {}
        return NextResponse.json(payload, { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=900' } });  // PATCH 0818
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
  // PATCH 0461 — hard 25s timeout on the hub fetch. Previously this could
  // hang for the full Vercel function lifetime (60s) and return a 504,
  // poisoning the client's retry loop. AbortController fires at 25s so
  // we still have a few seconds of budget left for KV write + response.
  // PATCH 0909 — Resilient hub fetch. Instead of returning hard 504/502 on
  // upstream failure, fall back through a tiered chain:
  //   1. Stale KV payload for this date (even past TTL — better than nothing)
  //   2. Live-NSE today-live filings (skip hub entirely)
  //   3. 200 + empty payload with `_stale` reason flag (client renders empty
  //      state cleanly without a hard error toast)
  // User report: "/api/v1/earnings/graded returning 502" cascaded into "few
  // companies in graded tiers" because client retry loop saw the error and
  // didn't bother trying again.
  let hubRes: Response | null = null;
  let hubFailReason: string | null = null;
  // PATCH 0982 — Railway self-fetch loopback fallback.
  // On Railway, `fetch(<public-URL of self>)` from inside the container
  // fails immediately with `fetch failed` because the edge layer rejects
  // the self-loop. We retry the same path via 127.0.0.1:PORT loopback.
  // No-op on Vercel (different runtime, public self-fetch works there).
  const _doHubFetch = async (url: string): Promise<Response> => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 25_000);
    try {
      return await fetch(url, { cache: 'no-store', signal: ctl.signal });
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    hubRes = await _doHubFetch(hubUrl);
  } catch (e: any) {
    const firstFail = e?.name === 'AbortError' ? 'hub_timeout_25s' : `hub_throw_${e?.message || 'unknown'}`;
    const port = process.env.PORT;
    if (port && /^https?:\/\/[^/]+\//.test(hubUrl)) {
      const loopbackUrl = hubUrl.replace(/^https?:\/\/[^/]+/, `http://127.0.0.1:${port}`);
      try {
        hubRes = await _doHubFetch(loopbackUrl);
        console.log(`[graded] hub public-URL failed (${firstFail}), recovered via loopback`);
      } catch (e2: any) {
        hubFailReason = `${firstFail},loopback_also_failed_${e2?.message || 'unknown'}`;
        hubRes = null;
      }
    } else {
      hubFailReason = firstFail;
      hubRes = null;
    }
  }
  if (hubRes && !hubRes.ok) {
    hubFailReason = `hub_http_${hubRes.status}`;
  }
  const hubOk = hubRes && hubRes.ok;
  let hub: any = null;
  if (hubOk) {
    try {
      hub = await hubRes!.json();
    } catch (e: any) {
      hubFailReason = `hub_parse_${e?.message || 'unknown'}`;
      hub = null;
    }
  }
  if (!hub) {
    // Fallback chain — hub failed for some reason. Try not to hard-error.
    console.warn(`[graded] ${date}: hub fetch failed (${hubFailReason}), attempting fallback chain`);
    // Tier 1: stale KV payload (allow any cache hit even if force=1 came in)
    if (isRedisAvailable()) {
      try {
        const staleCached = await kvGet(cacheKey);
        if (staleCached) {
          console.log(`[graded] ${date}: served stale KV cache (hub down: ${hubFailReason})`);
          return NextResponse.json(
            { ...staleCached, _cache: 'stale-fallback', _hub_fail: hubFailReason },
            { headers: { 'Cache-Control': 'no-store' } }
          );
        }
      } catch {}
    }
    // Tier 2: live-NSE only path — skip hub entirely. We synthesize a tiny
    // hub stub so the rest of the pipeline can run on just live NSE filings.
    hub = { results: [] };
  }
  // PATCH zzz101 — DROP the quality !== 'Upcoming' filter so hub Upcoming
  // entries (like VIKASLIFE on 2026-06-24) flow through gradeRow.
  let dayList: any[] = (hub?.results || []).filter((r: any) => r.resultDate === date);

  // PATCH zzz102 — REMOVED manual override list. User confirmed those tickers
  // weren't actual Q4 filers — they were stale screener-data ghosts that
  // happened to share "Outcome of Board Meeting" subjects. The true real
  // Q4 filing on 2026-06-24 was ONLY VIKASLIFE, which is correctly listed
  // on the EarningsPulse hub. Hub-corroboration is the right signal.

  // PATCH zzz96 — Build set of tickers the hub knows about for the WHOLE month.
  // The hub is the authoritative aggregator of filings, including "Upcoming"
  // entries from EarningsPulse forecast. Used downstream in dropGhosts to
  // drop today-live items that have NO corroboration anywhere in the hub —
  // those are bare "Outcome of Board Meeting" filings about dividends, AGMs,
  // share allotments, etc. — NOT Q4 results.
  const _monthlyHubTickers = new Set<string>();
  for (const r of (hub?.results || [])) {
    if (r?.ticker) _monthlyHubTickers.add(String(r.ticker).toUpperCase());
  }

  // PATCH 0363 / PATCH 0497 — Augment with live NSE corp-announcements.
  //
  // Original (0363): only fired for today + yesterday, on the theory that
  // older dates already settled in the hub aggregator.
  //
  // 0497 rewrite: the hub aggregator routinely misses Fri/Sat/Sun/Mon filings
  // (Indian companies DO file on weekends — board meetings can be Sat or Sun).
  // User pasted EarningsPulse showing 47 candidates for Fri 15 May while we
  // showed 0 with stale Apr 30 as "latest". Root cause: hub never picked
  // those up, and the live-NSE fallback refused to fire for any date >1d old.
  //
  // New rule: fire live-NSE augmentation for ANY past date within last 14
  // calendar days. NSE corp-announcements is the authoritative filing feed,
  // and 14d covers the worst-case "I'm browsing last week's filings on
  // Tuesday" window. Also fire when dayList is sparse (<10 items) even if
  // the hub is populated — the hub often returns Confirmed entries from
  // board-meeting forecasts but misses the actual filings.
  const dateAgeDays = Math.max(0, Math.floor((new Date(todayIso).getTime() - new Date(date).getTime()) / 86_400_000));
  const isHubSparse = dayList.length < 10;
  const shouldLiveAugment = dateAgeDays <= 14 && (dateAgeDays <= 1 || isHubSparse);
  if (shouldLiveAugment) {
    try {
      const liveUrl = `${base.protocol}//${base.host}/api/v1/earnings/today-live?date=${date}${force ? '&force=1' : ''}`;
      // PATCH zzz94 — Railway edge blocks public self-loops; use loopback on failure
      const _doLiveFetch = async (u: string) => fetch(u, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      let liveRes: Response;
      try {
        liveRes = await _doLiveFetch(liveUrl);
      } catch (e: any) {
        const port = process.env.PORT;
        if (port) {
          const loopUrl = liveUrl.replace(/^https?:\/\/[^/]+/, `http://127.0.0.1:${port}`);
          console.log(`[graded] zzz94 today-live public fetch failed, retrying loopback: ${loopUrl}`);
          liveRes = await _doLiveFetch(loopUrl);
        } else { throw e; }
      }
      if (liveRes.ok) {
        const live: any = await liveRes.json();
        const liveFilings: any[] = Array.isArray(live?.filings) ? live.filings : [];
        const existingTickers = new Set<string>(dayList.map((r: any) => String(r.ticker || '').toUpperCase()));
        let addedFromLive = 0;
        for (const f of liveFilings) {
          const sym = String(f.symbol || '').toUpperCase();
          if (!sym || existingTickers.has(sym)) continue;
          dayList.push({
            ticker: sym,
            company: f.company || sym,
            resultDate: date,
            quarter: 'Q4',  // default; gradeRow can still process it
            sector: null,
            marketCap: null,
            quality: 'Confirmed',  // it's a real NSE filing, not a board-meeting forecast
            source_url: f.attachment_url || `https://www.nseindia.com/companies-listing/corporate-filings-financial-results?symbol=${encodeURIComponent(sym)}`,
            filing_iso: f.filing_iso,
            __source: 'nse-live',
          });
          existingTickers.add(sym);
          addedFromLive++;
        }
        console.log(`[graded] ${date} (age=${dateAgeDays}d, sparse=${isHubSparse}): augmented dayList with ${addedFromLive} live NSE filings (hub had ${dayList.length - addedFromLive}, live total ${liveFilings.length})`);
      }
    } catch (err) {
      console.warn(`[graded] today-live fetch failed for ${date}:`, (err as Error).message);
    }
  }

  // PATCH zzz64 — Calendar fallback seed. When the hub returns 0 candidates
  // for a date, the calendar endpoint may still know about real filings via
  // its cron+worker fallback chain (mc-scraper Worker, NSE auto-keys). Pull
  // from there and seed dayList. This bridges the gap where the hub aggregator
  // hasn't yet picked up filings the Worker already has.
  //
  // NB: Railway's edge layer rejects self-loops on the public URL, so we use
  // the same loopback-on-failure pattern as _doEnrichSelfFetch.
  if (dayList.length === 0) {
    try {
      const calUrlPublic = `${base.protocol}//${base.host}/api/v1/earnings/calendar?date=${date}`;
      const _calFetch = async (u: string) => fetch(u, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      let calRes: Response | null = null;
      try {
        calRes = await _calFetch(calUrlPublic);
      } catch (err: any) {
        const port = process.env.PORT;
        if (port) {
          const loop = calUrlPublic.replace(/^https?:\/\/[^/]+/, `http://127.0.0.1:${port}`);
          console.log(`[graded] calendar public fetch failed (${err?.message}), retrying via loopback`);
          calRes = await _calFetch(loop);
        } else {
          throw err;
        }
      }
      if (calRes && calRes.ok) {
        const cal: any = await calRes.json();
        const calItems: any[] = Array.isArray(cal?.items) ? cal.items : [];
        const existingTickers = new Set<string>(dayList.map((r: any) => String(r.ticker || '').toUpperCase()));
        let addedFromCal = 0;
        for (const it of calItems) {
          const sym = String(it.symbol || '').toUpperCase();
          if (!sym || existingTickers.has(sym)) continue;
          // zzz72 — defense-in-depth: never grade Clarification announcements
          if (it.period_type === 'Clarification') continue;
          dayList.push({
            ticker: sym,
            company: it.company || sym,
            resultDate: date,
            quarter: 'Q4',
            sector: null,
            marketCap: null,
            quality: 'Confirmed',
            source_url: it.source_url || it.attachment || `https://www.nseindia.com/companies-listing/corporate-filings-financial-results?symbol=${encodeURIComponent(sym)}`,
            filing_iso: it.filing_dt_iso || null,
            __source: 'calendar-fallback',
          });
          existingTickers.add(sym);
          addedFromCal++;
        }
        if (addedFromCal > 0) {
          console.log(`[graded] ${date}: PATCH zzz64 — seeded ${addedFromCal} candidates from calendar fallback (source=${cal?.source})`);
        }
      }
    } catch (err) {
      console.warn(`[graded] calendar fallback fetch failed for ${date}:`, (err as Error).message);
    }
  }

  // PATCH 0497 — 2nd-pass live-NSE attempt with force=1 if first pass
  // returned empty (NSE may have been transiently blocked). Only for recent
  // past dates where we expect filings to exist.
  if (dateAgeDays > 0 && dateAgeDays <= 14 && dayList.length === 0) {
    try {
      const retryUrl = `${base.protocol}//${base.host}/api/v1/earnings/today-live?date=${date}&force=1`;
      // PATCH zzz94 — Railway edge blocks public self-loops; use loopback on failure
      const _doRetryFetch = async (u: string) => fetch(u, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      let retryRes: Response;
      try {
        retryRes = await _doRetryFetch(retryUrl);
      } catch (e: any) {
        const port = process.env.PORT;
        if (port) {
          const loopUrl = retryUrl.replace(/^https?:\/\/[^/]+/, `http://127.0.0.1:${port}`);
          console.log(`[graded] zzz94 today-live retry public fetch failed, retrying loopback: ${loopUrl}`);
          retryRes = await _doRetryFetch(loopUrl);
        } else { throw e; }
      }
      if (retryRes.ok) {
        const retry: any = await retryRes.json();
        const filings: any[] = Array.isArray(retry?.filings) ? retry.filings : [];
        let addedFromRetry = 0;
        const existingTickers = new Set<string>(dayList.map((r: any) => String(r.ticker || '').toUpperCase()));
        for (const f of filings) {
          const sym = String(f.symbol || '').toUpperCase();
          if (!sym || existingTickers.has(sym)) continue;
          dayList.push({
            ticker: sym,
            company: f.company || sym,
            resultDate: date,
            quarter: 'Q4',
            sector: null,
            marketCap: null,
            quality: 'Confirmed',
            source_url: f.attachment_url || `https://www.nseindia.com/companies-listing/corporate-filings-financial-results?symbol=${encodeURIComponent(sym)}`,
            filing_iso: f.filing_iso,
            __source: 'nse-live-retry',
          });
          existingTickers.add(sym);
          addedFromRetry++;
        }
        console.log(`[graded] ${date}: 2nd-pass live-NSE retry added ${addedFromRetry} filings`);
      }
    } catch (err) {
      console.warn(`[graded] live-NSE retry failed for ${date}:`, (err as Error).message);
    }
  }

  if (dayList.length === 0) {
    const empty: any = {
      filing_date: date,
      candidates_total: 0,
      raw_items_total: 0,
      by_tier: { BLOCKBUSTER: [], STRONG: [], MIXED: [], AVOID: [] },
      generated_at: new Date().toISOString(),
      sources_polled: 1,
    };
    // PATCH 0909 — tag the empty payload with the hub failure reason so the
    // client can show "upstream degraded — retry shortly" instead of a silent
    // empty state. Only cache the empty when hub was actually OK (don't
    // poison KV with a false-negative).
    if (hubFailReason) {
      empty._hub_fail = hubFailReason;
    } else if (isPast && isRedisAvailable()) {
      // PATCH 1002 — don't blow away a good cached payload with empty.
      // Read existing; if it has entries, keep it (no kvSet).
      let existingHasData = false;
      try {
        const prior: any = await kvGet(cacheKey);
        if (prior && prior.by_tier) {
          const n = (prior.by_tier.BLOCKBUSTER?.length || 0)
                  + (prior.by_tier.STRONG?.length || 0)
                  + (prior.by_tier.MIXED?.length || 0)
                  + (prior.by_tier.AVOID?.length || 0);
          existingHasData = n > 0;
        }
      } catch {}
      // TTL slashed: 1 hour instead of 365 days. If today is legit empty,
      // we'll re-resolve quickly tomorrow. PATCH 1002.
      if (!existingHasData) {
        try { await kvSet(cacheKey, empty, 3600); } catch {}
      } else {
        console.log(`[graded] PATCH 1002: kept existing non-empty cache for ${date}, skipped empty overwrite`);
      }
    }
    return NextResponse.json(empty, { headers: { 'Cache-Control': hubFailReason ? 'no-store' : 's-maxage=300, stale-while-revalidate=900' } });
  }

  // Fetch enrichment for all tickers (chunk to 40 per request)
  const symbols: string[] = dayList.map((r: any) => r.ticker);
  const chunks: string[][] = [];
  for (let i = 0; i < symbols.length; i += 40) chunks.push(symbols.slice(i, i + 40));

  // PATCH 1021 — revert Patch 1014's blanket nocache=1 on the MAIN path.
  // 1014 forced an uncached full enrichment (worker+NSE+Screener+bhavcopy) for
  // EVERY ticker, so a 100-ticker date blew past the 45s client timeout.
  // The original 1014 problem (stale empty entries) is already handled by
  // Patch 1002 (enrich never caches empty/null payloads) + the v6 cache bump
  // (1013) + gradeRow now emitting opm (1015). So we can safely use the enrich
  // KV cache here for speed. The refreshMissing path (line ~601) keeps
  // nocache=1 for targeted, user-triggered re-fetches.
  const enrichResponses = await Promise.all(chunks.map((chunk) =>
    _doEnrichSelfFetch(`${base.protocol}//${base.host}/api/v1/earnings/enrich?symbols=${chunk.join(',')}&filed=${date}`, { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : { data: {} })
      .catch(() => ({ data: {} }))
  ));
  const enrich: Record<string, any> = {};
  for (const r of enrichResponses) Object.assign(enrich, r.data || {});

  // Join + grade
  // PATCH 0403 — Defensive guard against today-live ghost-filings.
  // If a ticker came from today-live ONLY (not hub) AND enrich can't
  // verify the quarter-end matches the filing_date within 75 days, drop
  // it. Symptom we're fixing: today-live's regex used to match
  // "Reply to Clarification- Financial results" subjects, dragging in
  // companies that hadn't actually filed Q4 — Screener served their
  // historic latest-quarter data, gradeRow happily produced a
  // BLOCKBUSTER card attributed to the wrong date. Even with the
  // today-live regex tightened in this patch, this guard provides
  // belt-and-suspenders so a future regex regression can't silently
  // resurrect the bug.
  const dropGhosts = (m: any, e: any): boolean => {
    if (m.__source !== 'nse-live' && m.__source !== 'nse-live-retry' && m.__source !== 'nse-announcements') return false;

    // PATCH zzz102 — STRICT hub-corroboration guard.
    // The user verified that bare "Outcome of Board Meeting" filings from
    // today-live are unreliable: routine BMs about dividends, AGMs, share
    // allotments share the same metadata as real Q4 filings. The only
    // reliable signal is the EarningsPulse hub. If the hub has NO record
    // of this ticker anywhere this month AND there's no announce_date
    // corroboration from enrich, drop.
    const tickerUpper = String(m.ticker || '').toUpperCase();
    const hubKnowsTicker = _monthlyHubTickers.has(tickerUpper);
    if (!hubKnowsTicker && !e.announce_date_iso) {
      return true;  // not on hub + no announce date = noise
    }

    // Has announce_date and matches → OK
    if (e.announce_date_iso) {
      const d = new Date(e.announce_date_iso).getTime();
      const f = new Date(m.resultDate).getTime();
      if (Math.abs(d - f) <= 3 * 86_400_000) return false;
    }
    // Quarter-end within 95 days of filing → OK
    // PATCH zzz95 — bumped from 75 to 95 days. Small caps routinely file
    // Q4 results late: VIKASLIFE filed Q4 Mar-2026 on 24-Jun-2026 = 85 days,
    // got dropped by the 75-day cap even though it's a legitimate filing.
    // SEBI deadline is 60 days but extensions push small caps to 90+ days.
    if (e.latest_quarter_end_iso) {
      const q = new Date(e.latest_quarter_end_iso).getTime();
      const f = new Date(m.resultDate).getTime();
      const daysSince = (f - q) / 86_400_000;
      if (daysSince >= 0 && daysSince <= 95) return false;
    }
    // PATCH 0511 — When BOTH announce_date AND quarter_end are missing
    // from enrich (Screener Cloudflare-blocked us, or Yahoo had no Q-data),
    // we have no signal to verify against. In that case TRUST the live
    // filing instead of dropping it. Previously this branch dropped any
    // weekend BSE filing whose enrich came back empty — which is exactly
    // the Sat/Sun pattern the user keeps reporting.
    //
    // The live-NSE/BSE source itself is a strong signal (we already
    // applied SUBJECT_BLOCKLIST + RESULT_PATTERNS + category metadata
    // in today-live before getting here). If both verification paths
    // are missing, accept the filing as-is — it'll render as a preview
    // card with the company name and source URL, which is far better
    // than disappearing entirely.
    if (!e.announce_date_iso && !e.latest_quarter_end_iso) return false;
    // We have SOME enrich data but it doesn't match — likely a real
    // ghost-filing or a wrong-period attribution. Drop.
    return true;
  };
  const graded: ParsedEarning[] = [];
  for (const m of dayList) {
    const e = enrich[m.ticker] || {};
    if (dropGhosts(m, e)) {
      console.log(`[graded] ${date}: dropping ghost-filing ${m.ticker} (no announce_date and quarter_end too far)`);
      continue;
    }
    // PATCH zzz102 — Freshness guard. If screener's latest_quarter_end_iso
    // is more than 100 days before the filing_date, the company hasn't yet
    // filed Q4 — screener is serving the prior quarter (Q3 Dec data).
    // Catches hub-confirmed Upcoming tickers like GENCON (2025-12-31 ÷
    // 2026-06-25 = 176 days) that haven't actually filed Q4 yet.
    if (e?.latest_quarter_end_iso) {
      const q = new Date(e.latest_quarter_end_iso).getTime();
      const f = new Date(m.resultDate).getTime();
      const daysSince = (f - q) / 86_400_000;
      if (daysSince > 100) {
        console.log(`[graded] ${date}: dropping ${m.ticker} — screener quarter ${e.latest_quarter_end_iso} is ${Math.round(daysSince)}d stale (Q4 not filed yet)`);
        continue;
      }
    }
    const row = {
      hub_quality: m.quality,
      // PATCH 0369 — Prefer enrich's resolved company name over the
      // hub's raw name when (a) hub returned blank/ticker, OR (b) enrich
      // has a real, non-ticker name from Screener search.
      symbol: m.ticker,
      company: (e.company && e.company !== m.ticker && e.company.toUpperCase() !== String(m.ticker).toUpperCase())
        ? e.company
        : (m.company && m.company.toUpperCase() !== String(m.ticker).toUpperCase() ? m.company : (e.company || m.company || m.ticker)),
      filing_date: m.resultDate,
      quarter: m.quarter || e.quarter || 'Q4',
      sector: e.sector || m.sector,
      market_cap_bucket: e.market_cap_bucket ||
        (m.marketCap === 'L' ? 'LARGE' : m.marketCap === 'M' ? 'MID' : m.marketCap === 'S' ? 'SMALL' : m.marketCap === 'Micro' ? 'MICRO' : null),
      market_cap_cr: e.market_cap_cr ?? null,
      adtv_cr: e.adtv_cr ?? null,  // PATCH 1037 — carry liquidity into grader
      source_url: e.source_url || `https://www.nseindia.com/companies-listing/corporate-filings-financial-results?symbol=${encodeURIComponent(m.ticker)}`,
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

  // PATCH 0358 + 0359 — compute how many tickers got REAL financials with
  // YoY data attached (not just preview-shape cards). Previously this only
  // checked sales_curr_cr/pat_curr_cr presence which let preview cards
  // (sales_curr_cr=null, but hub_quality stamped) leak into the "updated"
  // count, producing the lying "Updated 11/11" message while the UI showed
  // 11 preview cards. New criterion mirrors what the user sees on screen:
  // YoY data present = real financials = counted as populated.
  const populated = graded.filter(g =>
    g.sales_yoy_pct != null || g.net_profit_yoy_pct != null || g.eps_yoy_pct != null
  ).length;
  const failedTickers = dayList
    .filter((m: any) => {
      const e = enrich[m.ticker];
      return !e || (
        e.sales_yoy_pct == null && e.pat_yoy_pct == null && e.eps_yoy_pct == null
      );
    })
    .map((m: any) => m.ticker);

  const payload = {
    filing_date: date,
    candidates_total: graded.length,
    raw_items_total: dayList.length,
    by_tier,
    generated_at: new Date().toISOString(),
    sources_polled: 2,
    _cache: 'miss',
    _refresh: `${populated}/${dayList.length} updated`,
    _attempted_tickers: dayList.map((m: any) => m.ticker),
    _failed_tickers: failedTickers,
    // PATCH 0909 — propagate hub failure flag if applicable (live-NSE saved us)
    ...(hubFailReason ? { _hub_fail: hubFailReason } : {}),
  };

  // Cache: past dates 90 days (immutable), today 15 min
  // PATCH 0909 — Don't cache payloads built without the hub. Live-NSE is a
  // subset of what the hub knows, so caching this would lock out the
  // complete view once the hub recovers.
  if (isRedisAvailable() && !hubFailReason) {
    const ttl = isPast ? 365 * 24 * 3600 : 5 * 60;
    // PATCH 1002 — guard final cache write too. If the new payload graded
    // ZERO tickers but a cached version had entries, preserve the cache.
    try {
      const _t = (payload as any).by_tier;
      const _gradedCount = (_t?.BLOCKBUSTER?.length || 0)
                         + (_t?.STRONG?.length || 0)
                         + (_t?.MIXED?.length || 0)
                         + (_t?.AVOID?.length || 0);
      let _skipWrite = false;
      if (_gradedCount === 0) {
        const _prior: any = await kvGet(cacheKey);
        if (_prior?.by_tier) {
          const _priorN = (_prior.by_tier.BLOCKBUSTER?.length || 0)
                        + (_prior.by_tier.STRONG?.length || 0)
                        + (_prior.by_tier.MIXED?.length || 0)
                        + (_prior.by_tier.AVOID?.length || 0);
          if (_priorN > 0) {
            _skipWrite = true;
            console.log(`[graded] PATCH 1002: final write blocked — payload empty but cache has ${_priorN} entries`);
          }
        }
      }
      if (!_skipWrite) await kvSet(cacheKey, payload, ttl);
    } catch {}
  }

  return NextResponse.json(payload, { headers: { 'Cache-Control': hubFailReason ? 'no-store' : 's-maxage=300, stale-while-revalidate=900' } });
}

// ═══════════════════════════════════════════════════════════════════════════
// THE INDIA PER-QUARTER GRADER — ONE COPY.  (zzz669)
//
// WHY THIS FILE EXISTS.
//
// This function used to exist TWICE: once in the route handler that serves a
// graded session, and once again, pasted, inside the Earnings Opportunities
// page. The shared-constants module next door opens with the reason that was a
// problem — three separate drift bugs (zzz384 → zzz386 → zzz387), each one a
// real over-grading, each caused by a rule being changed in one copy and not
// the other. zzz395 moved the caveat table and the tier ladder here to stop it
// happening again, and the rest of the grader stayed duplicated.
//
// It kept happening. By the time this was extracted the two copies had drifted
// to 721 lines and 421 — three hundred lines apart. And the same disease had
// spread WITHIN the route: `close_30d` was added to one of that file's two row
// builders and not the other, so a volatility fix shipped, reported success,
// and never ran on the main path.
//
// So the grader now lives in exactly one place and both callers import it.
// This file is PURE — no fetch, no KV, no NextResponse, no process.env, no
// React — which is what made the extraction safe: the function only ever read
// its argument and returned an object. Keep it that way. Anything that needs
// I/O belongs in the caller, not here.
// ═══════════════════════════════════════════════════════════════════════════

import {
  CAVEAT_PENALTY, CAVEAT_PENALTY_DEFAULT, marginQualityDelta, decideTier,
  marketReactionDelta, typicalDailyMovePct, thinFloatGate, quadrantForIndiaRow,
  fundamentalComposite, setupGrade,
  type EarningsTier,
} from '@/lib/earnings-grade-shared';
import { peadScore } from '@/lib/pead-score';

/** The graded card this produces. Deliberately loose: the two callers have
 *  historically disagreed about optional fields, and narrowing it here would
 *  be a second source of truth about the same shape. */
export type IndiaGradedRow = any;

export function deriveQuarterLabel(filingDate?: string | null): string {
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

function parseTrendlynePeriodEnd(s: string): string | null {
  if (!s) return null;
  const m = s.match(/(\d{1,2})[- /]([A-Za-z]{3,9})[- /](\d{4})/);
  if (!m) return null;
  const months: Record<string, number> = { JAN:0, FEB:1, MAR:2, APR:3, MAY:4, JUN:5, JUL:6, AUG:7, SEP:8, OCT:9, NOV:10, DEC:11 };
  const mm = months[m[2].toUpperCase().slice(0, 3)];
  if (mm === undefined) return null;
  return new Date(Date.UTC(+m[3], mm, +m[1])).toISOString().slice(0, 10);
}

export function gradeIndiaRow(row: any): IndiaGradedRow | null {
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
    // zzz503 \u2014 honest labelling of the no-YoY case. The previous copy
    // ("YoY comparison unavailable (prior-period data missing)") read like a
    // pipeline bug. In practice a company reaches this branch \u2014 full current
    // absolutes but zero prior-period and zero YoY \u2014 almost only when it is
    // NEWLY LISTED (Screener has no year-ago column because it wasn't trading a
    // year ago). We now say so plainly, and enrich a richer one-liner (net
    // margin + price/PE) so the card is genuinely informative, not a stub.
    const _isNew = row?.newly_listed === true
      || (row?.num_quarters != null && row.num_quarters <= 5)
      || (hasAnyAbsolute && row?.sales_prev_cr == null && row?.pat_prev_cr == null && row?.eps_prev == null);
    const _netMargin = (row?.pat_curr_cr != null && row?.sales_curr_cr != null && row.sales_curr_cr > 0)
      ? Math.round((row.pat_curr_cr / row.sales_curr_cr) * 1000) / 10 : null;
    const _marginBit = _netMargin != null ? ` (${_netMargin}% net margin)` : '';
    const _priceBits: string[] = [];
    if (row?.current_price != null) _priceBits.push(`\u20b9${row.current_price}`);
    if ((row?.pe ?? row?.stockPE) != null) _priceBits.push(`P/E ${Math.round(row.pe ?? row.stockPE)}`);
    const _priceStr = _priceBits.length ? ` \u00b7 trades at ${_priceBits.join(', ')}` : '';
    // zzz505 \u2014 a newly-listed company HAS no year-ago quarter, but Screener
    // does carry its short sequential history (JNPR: sales 161\u2192213\u2192291,
    // EPS 0.44\u21920.44\u21920.68). YoY is impossible; the QoQ trend is the correct
    // comparison and we already have it in quarters_sales/quarters_eps. Surface
    // it so the card shows real momentum instead of three "\u2014" tiles.
    const _seqStr = (() => {
      const qs: number[] = Array.isArray(row?.quarters_sales) ? row.quarters_sales.filter((x: any) => typeof x === 'number') : [];
      const qe: number[] = Array.isArray(row?.quarters_eps) ? row.quarters_eps.filter((x: any) => typeof x === 'number') : [];
      const bits: string[] = [];
      if (qs.length >= 2) {
        const a = qs[qs.length - 2], b = qs[qs.length - 1];
        const g = a > 0 ? Math.round((b / a - 1) * 100) : null;
        bits.push(`revenue \u20b9${a}\u2192${b}Cr QoQ${g != null ? ` (${g >= 0 ? '+' : ''}${g}%)` : ''}`);
      }
      if (qe.length >= 2) {
        const a = qe[qe.length - 2], b = qe[qe.length - 1];
        bits.push(`EPS \u20b9${a}\u2192\u20b9${b}`);
      }
      return bits.length ? ` Sequential trend: ${bits.join(', ')}.` : '';
    })();
    const _opmBit = (row?.opm_pct != null) ? ` OPM ${Math.round(row.opm_pct)}%.` : '';
    // Re-word absStr to attach the net-margin note to PAT for the newly-listed line.
    const _absNew = (() => {
      const bits: string[] = [];
      if (row?.sales_curr_cr != null) bits.push(`Rev \u20b9${row.sales_curr_cr}Cr`);
      if (row?.pat_curr_cr != null) bits.push(`PAT \u20b9${row.pat_curr_cr}Cr${_marginBit}`);
      if (row?.eps_curr != null) bits.push(`EPS \u20b9${row.eps_curr}`);
      return bits.length ? ' \u00b7 ' + bits.join(' \u00b7 ') : '';
    })();
    const narrative = hasAnyAbsolute
      ? (_isNew
          ? `${row.company || row.symbol} ${deriveQuarterLabel(row.filing_date)} results${moveLabel}${_absNew}.${_opmBit}${_priceBits.length ? ' Trades at ' + _priceBits.join(', ') + '.' : ''} Newly listed \u2014 no year-ago comparable yet, so judge it on the sequential trend.${_seqStr}`
          : `${row.company || row.symbol} ${deriveQuarterLabel(row.filing_date)} results${moveLabel}${absStr}. Absolute figures shown; year-ago quarter not yet in source.${_seqStr}`)
      : `${row.company || row.symbol} reported ${deriveQuarterLabel(row.filing_date)} results${moveLabel}. Financial detail awaiting enrichment.`;
    return {
      ticker: row.symbol, company: row.company || row.symbol, sector: row.sector, filing_date: row.filing_date,
      quarter: row.quarter || deriveQuarterLabel(row.filing_date), market_cap_bucket: row.market_cap_bucket,
      market_cap_cr: row.marketCapCr ?? row.market_cap_cr ?? null,
      pe: row.pe ?? row.stockPE ?? null,
      price: row.current_price ?? null,
      sales_yoy_pct: null, net_profit_yoy_pct: null, eps_yoy_pct: null,
      sales_curr_cr: row.sales_curr_cr ?? null, sales_prev_cr: null,
      pat_curr_cr: row.pat_curr_cr ?? null, pat_prev_cr: null,
      eps_curr: row.eps_curr ?? null, eps_prev: null,
      gap_pct: row.gap_pct ?? null, d1_pct: row.d1_pct ?? null, move_pct: move,
      rs_rating: row.rs_rating ?? null, stage: row.stage ?? null, pct_from_52w_high: row.pct_from_52w_high ?? null,
      opm_pct: row.opm_pct ?? null, opm_prev_pct: null,  // zzz505 — surface OPM on newly-listed cards (we had it, were dropping it)
      quarters_sales: row.quarters_sales ?? null, quarters_eps: row.quarters_eps ?? null,
      // zzz507 — quarterly PAT. Screener's DIRECT path gives a real Net-Profit
      // row; the WORKER path (JNPR) only carries sales/EPS. Derive PAT from the
      // EPS series when the real row is absent: shares = latest PAT / latest EPS
      // (exact for the latest quarter), then PATᵢ ≈ EPSᵢ × shares. For a recent
      // IPO with post-listing dilution this is conservative (understates growth),
      // never overstated — a safe fill for the NET PROFIT QoQ tile.
      quarters_pat: (() => {
        if (Array.isArray(row.quarters_pat) && row.quarters_pat.length >= 2) return row.quarters_pat;
        const qe: number[] = Array.isArray(row.quarters_eps) ? row.quarters_eps.filter((x: any) => typeof x === 'number') : [];
        if (qe.length >= 2 && row.pat_curr_cr != null && row.eps_curr && row.eps_curr !== 0) {
          const shares = row.pat_curr_cr / row.eps_curr;
          return qe.map((e: number) => Math.round(e * shares * 10) / 10);
        }
        return null;
      })(),
      composite_score: score, tier,
      methodology_tags: [],
      caveat_tags: hasAnyAbsolute ? [_isNew ? 'newly listed' : 'no YoY yet'] : [],
      narrative,
      filing_url: row.source_url,
      source: hasAnyAbsolute ? (row.financials_source || 'screener-worker') : 'NSE+BSE',
      // ── zzz670 — A NEWLY-LISTED COMPANY IS NOT AN UNMEASURABLE ONE ───────
      //
      // This early return is the preview path for a filer with no year-ago
      // comparable, and it skipped the Quality × Inflection axes entirely — so
      // Shiprocket showed no Q and no I despite the feed carrying ROCE −2.7%,
      // operating margin −1.8% against −2.2% and a sequential revenue trend.
      // Those are exactly the inputs the quadrant is built from, and NONE of
      // them needs a year-ago quarter.
      //
      // `quadrantScore` already refuses to judge on too little evidence — it
      // returns a null quadrant below 25 assessable points — so letting it look
      // can only produce an honest answer or an honest absence. Hard-coding the
      // absence was the one option that could be wrong.
      //
      // PEAD is deliberately still omitted here: post-earnings drift is built
      // on a surprise and a reaction, and a first-ever print has neither. A
      // number computed from zeros would look like a reading.
      ...(() => {
        try {
          const _pq = quadrantForIndiaRow(row, {
            salesY: row?.sales_yoy_pct ?? null,
            opmExp: (row?.opm_pct != null && row?.opm_prev_pct != null)
              ? row.opm_pct - row.opm_prev_pct : null,
          });
          return {
            quality_score: _pq.quality,
            inflection_score: _pq.inflection,
            quadrant: _pq.quadrant,
            quadrant_parts: { quality: _pq.quality_parts, inflection: _pq.inflection_parts },
          };
        } catch { return {}; }
      })(),
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
      // zzz414 — quarter-corroborated escape for hub-'Upcoming' rows.
      // The hub scheduled a RESULTS board meeting for exactly this date
      // (that's what an 'Upcoming' row IS), and Screener's quarterly table
      // now shows a quarter-end 0–95 days before the filing date — i.e. the
      // company's expected new quarter has appeared, which Screener only
      // renders after the results are actually filed. Together those two
      // signals confirm the filing happened as scheduled (DIVGIITTS Aug-11:
      // Jun-2026 quarter, 42 days). The GARUDA-class ghosts this guard
      // exists for serve a months-old quarter and still fail the window.
      let quarterCorroborated = false;
      if (row?.hub_quality === 'Upcoming' && row?.latest_quarter_end_iso) {
        const qe = new Date(row.latest_quarter_end_iso).getTime();
        if (!isNaN(qe)) {
          const qDays = (filingD.getTime() - qe) / 86_400_000;
          quarterCorroborated = qDays >= 0 && qDays <= 95;
        }
      }
      if (ageDays > 7 && !hubConfirmed && !quarterCorroborated) return null;
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
  let caveat_tags: string[] = [];   // zzz665c — reassigned by the dedupe below
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
  // ═══════════════════════════════════════════════════════════════════════
  // A NEGATIVE YEAR-AGO BASE IS NOT A QUALITY PROBLEM ONCE THE COMPANY IS
  // MAKING MONEY.  (zzz668 — porting the US rule)
  //
  // `turnaroundBase` exists because a growth rate measured off a loss is
  // meaningless, and that remains true. But India was ALSO stamping "low
  // quality" on the print, which is the opposite of what a completed
  // turnaround is. With Path F now reaching India, the contradiction became
  // visible on the card: MOLBIO printed revenue +320%, net profit −₹13cr →
  // +₹53cr, operating margin −10% → +25%, Quality 87 and Inflection 100 — and
  // was published BLOCKBUSTER carrying a "low quality" flag.
  //
  // The percentage is still refused. The company is simply no longer slandered
  // for having recovered, and the recovery is recorded as what it is.
  // ═══════════════════════════════════════════════════════════════════════
  const _patCurCr = typeof row?.pat_curr_cr === 'number' ? row.pat_curr_cr : null;
  const _cfoRatio = typeof row?.ocf_to_pat_ratio === 'number' ? row.ocf_to_pat_ratio : null;
  const turnaroundCompleted = turnaroundBase
    && _patCurCr != null && _patCurCr > 0
    && (_cfoRatio == null || _cfoRatio > 0);
  if (turnaroundBase && !turnaroundCompleted) caveat_tags.push('low quality');
  else if (turnaroundCompleted && !methodology_tags.includes('returned to profit')) {
    methodology_tags.push('returned to profit');
  }
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
  // zzz668 — A PENALTY WITH NO EMITTER IS NOT A RULE.
  //
  // `exceptional item` has carried a 10-point penalty in the shared table since
  // it was written, is listed to you in the app's methodology panel as though
  // it were live, and NOTHING in the India grader has ever pushed it. Seven
  // tags were in that state; this is the one the data supports, because
  // enrichment already scrapes the exceptional line and its share of pre-tax
  // profit — and, until today, the row builder threw both away.
  //
  // A fifth of pre-tax profit arriving from something that will not repeat is
  // the difference between a quarter and an event.
  {
    const _excPct = typeof row?.exceptional_pct_pbt === 'number' ? Math.abs(row.exceptional_pct_pbt) : null;
    if (_excPct != null && _excPct >= 20) caveat_tags.push('exceptional item');
  }
  if (stage === 4) caveat_tags.push('low quality');
  else if (pct52 != null && pct52 < -25) caveat_tags.push('low quality');

  // ═══════════════════════════════════════════════════════════════════════
  // DEDUPE BEFORE ANYTHING COUNTS THEM.  (zzz665c)
  //
  // THREE separate conditions push the identical string 'low quality': still
  // loss-making, growth measured off a negative base, and a broken chart
  // (Stage 4, or more than 25% off the 52-week high). A company in all three
  // states carried the tag three times, and the array was only de-duplicated
  // at the very end, on its way to the card. Everything in between counted
  // the duplicates:
  //
  //   · `quality` subtracts a penalty PER ENTRY, so 'low quality' cost 75
  //     points instead of 25 — on a score that starts at 100, that alone is
  //     three quarters of the axis for one flag.
  //   · `caveatCount` feeds every `<= 1` / `<= 2` / `<= 3` gate in the tier
  //     ladder. One tag consumed the entire caveat budget, so a Blockbuster
  //     path that allows three caveats was closed by a single fact.
  //
  // The card showed the tag once, which is why this was invisible: the screen
  // and the arithmetic disagreed and only the screen was ever read.
  //
  // De-duplicating here, before quality and before the ladder, makes one fact
  // cost one penalty. The three conditions remain three conditions — a company
  // that is loss-making AND in a downtrend is still worse than one that is
  // only loss-making, because each pushes other tags and moves other inputs.
  // It is the double-charging for the SAME label that was never intended.
  // ═══════════════════════════════════════════════════════════════════════
  caveat_tags = [...new Set(caveat_tags)];

  const scoreYoy = (y: number) =>
    y >= 100 ? 100 : y >= 50 ? 90 : y >= 25 ? 75 : y >= 15 ? 60 : y >= 5 ? 40 : y >= 0 ? 25 : Math.max(0, 25 + y);
  let magW = 0, magS = 0;
  if (salesY != null) { magS += scoreYoy(salesY) * 0.35; magW += 0.35; }
  if (patY   != null) { magS += scoreYoy(patY)   * 0.30; magW += 0.30; }
  if (epsY   != null) { magS += scoreYoy(epsY)   * 0.35; magW += 0.35; }
  const magnitude = magW > 0 ? magS / magW : 30;

  // zzz390 — caveat-penalty table + margin ladder now live in the shared module
  // @/lib/earnings-grade-shared, imported by both this route and the client
  // gradeRow so the two copies can't drift (they repeatedly did: zzz384/386/387).
  let quality = 100;
  for (const tag of caveat_tags) quality -= (CAVEAT_PENALTY[tag] ?? CAVEAT_PENALTY_DEFAULT);
  quality += marginQualityDelta(opmExp);   // PATCH 1000 + zzz387 ordering
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

  // zzz673 — the same quarter scored with the chart taken out, and the chart
  // graded separately as an ENTRY. Both are COMPUTED AND RETURNED ONLY; nothing
  // below reads them, and `decideTier` still receives `composite`. See the long
  // note on `fundamentalComposite` in earnings-grade-shared for why the switch
  // is deliberately a second, separate change.
  const _fund_composite = fundamentalComposite(magnitude, quality, methodology);
  // "Has technical evidence" is stage OR relative strength actually arriving
  // from the scraper. Both null means a newly listed or uncovered symbol, whose
  // setup is UNKNOWN — never 'D'.
  const _setup_grade = setupGrade(technical, stage != null || rs != null);

  // Tier rules — PATCH 0173 BLOCKBUSTER v3 (EarningsPulse-matched).
  // Ignore RS, Stage 2, bonde ep as hard gates. Use Magnitude + Quality +
  // Tier-1 method count + Guidance + chart-not-broken.
  let tier: EarningsTier;
  // ═══════════════════════════════════════════════════════════════════════
  // WHAT "BROKEN" IS ALLOWED TO MEAN.  (zzz668 — matching the US engine)
  //
  // This flag routes a row straight to AVOID, the worst grade the engine
  // gives, and it used to fire on two unrelated things: a chart in a stage-4
  // downtrend, and earnings that actually fell. Those are not the same
  // evidence and must not carry the same power.
  //
  // The US removed the chart half after Synopsys — revenue +42%, a 6% beat, a
  // raised guide and a 13.7% rise on the day — was published AVOID purely
  // because its chart sat 35% off its high. The note left behind reads: "That
  // is the tape overruling the filing, which the owner has already ruled
  // against once." India never got the same fix, and until today India had no
  // stage at all, so the rule has been dormant rather than correct. Now that
  // stage is real, it would have started firing.
  //
  // A stage-4 downtrend is still a genuine risk and still costs the row: it
  // adds a `low quality` caveat, it vetoes every Blockbuster path, and the
  // reaction ladder can demote on top. It simply may no longer, by itself,
  // produce the worst grade available.
  // ═══════════════════════════════════════════════════════════════════════
  const broken = (epsY != null && epsY < 0 && patY != null && patY < -10);
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
  // ═══════════════════════════════════════════════════════════════════════
  // AN EXPLICIT SIGNAL BEATS A REGEX OVER PROSE.  (zzz669)
  //
  // The pattern list below it is the original, and it is the reason guidance
  // was dead: it reads six fields that nothing populated, so it always scored
  // zero. It also counts "confident" and "tailwind" — tone, not a commitment —
  // which is the wrong thing to measure even when there IS text.
  //
  // /api/v1/cron/refresh-guidance now writes a per-symbol overlay from the
  // concall-intelligence pipeline that was already running in this codebase
  // and had simply never been connected to the grader. When it has an opinion
  // about this company, that opinion is used. The text scan stays as the
  // fallback for a symbol the overlay has not seen — it costs nothing and, now
  // that `guidance_text` is actually populated, it can finally fire.
  //
  // A CUT IS NOT A NON-RAISE. If the overlay says the company guided DOWN,
  // `positiveGuidance` is false regardless of how many hopeful words the same
  // filing contains, which the pattern list on its own could never express.
  // ═══════════════════════════════════════════════════════════════════════
  const _gRaised = (row as any)?.guidance_raised;
  const _gCut = (row as any)?.guidance_lowered;
  const positiveGuidance = _gCut === true ? false
    : _gRaised === true ? true
    : _guidanceMatches >= 2;

  const chartOk = stage !== 4 && (pct52 == null || pct52 >= -25);
  // zzz395 — tier-decision chain (BLOCKBUSTER gate Paths A–E + graduated margin
  // gate + loss-maker/turnaround/quality-STRONG rules) now lives in the shared
  // module so this server copy and the client gradeRow can never re-drift.
  tier = decideTier({
    composite,
    broken,
    stillLossMaking,
    turnaroundBase,
    marginContracting: opmExp != null && opmExp <= -0.5,        // PATCH 1000
    marginSevereContraction: opmExp != null && opmExp <= -1.5,  // PATCH 1020
    caveatCount: caveat_tags.length,
    mCount,
    stage,
    salesY, patY, epsY, opmExp,
    cleanMag, exceptMag, megaMag,
    marginInflection, marginInflectionLoose,
    // zzz668 — PATH F ON THE INDIA SIDE TOO.
    //
    // Path F shipped for the US this morning: a company that recovered from a
    // loss could never clear any magnitude gate, because `yoyPct` correctly
    // refuses a percentage off a negative base and every gate requires both
    // patY and epsY. India's grader has exactly the same shape and exactly the
    // same hole — MIXED for ever, however complete the recovery.
    //
    // The evidence that survives a negative base is the same in both markets:
    // the company earns money now, the cash agrees, the top line grew and the
    // margin expanded. India's cash figure is ANNUAL rather than quarterly, so
    // it is treated as a veto when negative and ignored when absent, never as
    // a reason to promote on its own.
    //
    // The safety valve is the shared one: an UNFINISHED recovery still sets
    // `turnaroundBase` and is still capped at MIXED a line above.
    swingMag: (() => {
      const patC = typeof row?.pat_curr_cr === 'number' ? row.pat_curr_cr : null;
      const patP = typeof row?.pat_prev_cr === 'number' ? row.pat_prev_cr : null;
      const ocfA = typeof row?.ocf_annual_cr === 'number' ? row.ocf_annual_cr : null;
      return patP != null && patP < 0 && patC != null && patC > 0
        && (ocfA == null || ocfA > 0)
        && salesY != null && salesY >= 25
        && opmExp != null && opmExp >= 5;
    })(),
    tier1MethodCount: _t1MethodCount,
    positiveGuidance,
    chartOk,
  }).tier;

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
  {
    // zzz665c — SCALE THE THRESHOLDS BY THE STOCK'S OWN VOLATILITY.
    //
    // The 3-argument form falls back to a flat −7% "sold off" and −3% "market
    // rejected print" for every company on the exchange. The shared module's
    // own comment explains why that is wrong, using a US example: a stock whose
    // median daily move is over 3% did not reject anything by falling 3.2% —
    // that was an ordinary session. Indian smallcaps are more volatile than the
    // stock in that example, not less, so the flat threshold has been calling
    // ordinary sessions verdicts on exactly the names where it matters most,
    // and one-way demoting them for it.
    //
    // The 4th argument scales both thresholds by the stock's own median daily
    // move (2.5× and 1.5×, floored at the old constants and capped at 20%/10%
    // so a violently volatile microcap cannot become unfalsifiable). The US has
    // passed it since the fix; India dropped the input before it got here.
    const _mr = marketReactionDelta(
      tier, row?.d1_pct, row?.gap_pct,
      typicalDailyMovePct((row as any)?.close_30d ?? null),
    );
    tier = _mr.tier;
    for (const c of _mr.addCaveats) if (!caveat_tags.includes(c)) caveat_tags.push(c);
  }

  // PATCH 1034 — Liquidity / thin-float gate. A name that barely trades can't be
  // built or exited at size, so it doesn't belong in the top conviction tiers.
  // Demote (never delete) + tag. Missing ADTV is NOT punished (data gap ≠ illiquid).
  // _adtv / _thinFloat retained locally: _adtv feeds the return object, _thinFloat
  // gates the ELITE flag below. The tier demotion itself is the shared thinFloatGate.
  const _adtv = (typeof row?.adtv_cr === 'number' && Number.isFinite(row.adtv_cr)) ? row.adtv_cr : null;
  const _thinFloat = _adtv != null && _adtv < 1;  // < ₹1 Cr/day median traded value = thin float
  {
    const _tf = thinFloatGate(tier, _adtv);
    tier = _tf.tier;
    for (const c of _tf.addCaveats) if (!caveat_tags.includes(c)) caveat_tags.push(c);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // HARD CEILINGS — INDIA HAD NONE.  (zzz666)
  //
  // The US engine can REFUSE a quarter on fourteen separate grounds. India
  // could only ever subtract points, and a high composite absorbs a penalty:
  // an Indian company with negative operating cash flow against a reported
  // profit could still publish BLOCKBUSTER, because −25 off a quality score
  // that starts at 100 is survivable when magnitude and technical are strong.
  //
  // A ceiling is different from a penalty. It says "whatever else is true,
  // this is not a top-tier quarter" — and that is the engine's own stated
  // philosophy about cash, applied on the side of the world where it was
  // never implemented.
  //
  // ONLY THREE, AND ONLY WHERE INDIA'S DATA MEANS WHAT THE TEST NEEDS.
  // The US ceilings for guidance, one-off items and adjusted-EPS reconciliation
  // are deliberately NOT ported: India ingests no guidance and no adjusted
  // figures, so those tests would be reading fields that do not exist — which
  // is exactly the failure mode (`positiveGuidance`, `row.promoter`) this
  // codebase already has too much of.
  //
  // NOTE ON BASIS: India's cash-flow figures are ANNUAL, not quarterly —
  // Screener publishes no quarterly capex or CFO. An annual cash test against
  // a quarterly grade is a coarser instrument than the US equivalent, so the
  // thresholds below are the unambiguous ones only. Negative cash against a
  // positive profit is wrong at any frequency.
  // ═══════════════════════════════════════════════════════════════════════
  {
    const TIER_ORDER = ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID'];
    const capTier = (max: string, why: string) => {
      if (TIER_ORDER.indexOf(tier) < TIER_ORDER.indexOf(max)) {
        tier = max as typeof tier;
        if (!caveat_tags.includes(why)) caveat_tags.push(why);
      }
    };

    const _ocfAnnual = typeof row?.ocf_annual_cr === 'number' ? row.ocf_annual_cr : null;
    const _patAnnual = typeof row?.pat_annual_cr === 'number' ? row.pat_annual_cr : null;
    const _cfoPat = typeof row?.ocf_to_pat_ratio === 'number' ? row.ocf_to_pat_ratio : null;

    // 1. CASH WENT THE OTHER WAY. The company reports a profit for the year and
    //    its operations consumed cash. The US caps this at MIXED and calls it
    //    "profit without operating cash"; there is no reading of it that
    //    belongs in a top tier.
    if (_ocfAnnual != null && _ocfAnnual < 0 && _patAnnual != null && _patAnnual > 0) {
      capTier('MIXED', 'profit without operating cash');
    }

    // 2. EARNINGS OUTRAN BOTH THE REVENUE AND THE CASH. This is the rule that
    //    caught Optical Cable on the US side: EPS growing a multiple of the top
    //    line ('optical eps') while conversion is under 1. Either alone is
    //    survivable — real operating leverage converts cash, and a
    //    working-capital quarter still grows revenue. Both together is a
    //    quarter to look at twice, which is what MIXED means.
    if (_cfoPat != null && _cfoPat < 1 && caveat_tags.includes('optical eps')) {
      capTier('MIXED', 'earnings outrun both revenue and cash');
    }

    // 3. TWO OR MORE CRITICAL FLAGS. Any one of these is a caveat the tier
    //    ladder already prices. Two at once is a pattern, and the US caps it at
    //    STRONG rather than letting a strong composite carry it to the top.
    const _criticals = ['low quality', 'ocf divergence', 'optical eps', 'tax distortion']
      .filter((t) => caveat_tags.includes(t)).length;
    if (_criticals >= 2) capTier('STRONG', 'multiple quality flags');

    // 4. THE HEADLINE LEANS ON SOMETHING THAT WILL NOT REPEAT.  (zzz668)
    //    The US caps a quarter whose beat disappears without its one-off. India
    //    has no consensus to test a beat against, but it does have the size of
    //    the exceptional item relative to pre-tax profit — and half of PBT
    //    arriving from a one-off is not a quarter the business produced.
    const _excShare = typeof row?.exceptional_pct_pbt === 'number' ? Math.abs(row.exceptional_pct_pbt) : null;
    if (_excShare != null && _excShare >= 50) capTier('MIXED', 'headline leans on a one-off');
    else if (_excShare != null && _excShare >= 25) capTier('STRONG', 'headline leans on a one-off');

    // ═══════════════════════════════════════════════════════════════════════
    // 5. YOU CANNOT BUY IT.  (zzz674)
    //
    // This ceiling exists because of something the chart was doing by accident.
    //
    // Measuring the fundamentals-only composite against the live one across
    // 2026-08-14 (276 rows) turned up eleven names whose FILINGS clear the
    // BLOCKBUSTER threshold while the blended composite does not — the chart
    // holding a good quarter down, which is the defect zzz673 exists to fix.
    // Eight of those eleven were shells:
    //
    //   ICSA ₹0.96 Cr · BHARATIDIL ₹9.8 Cr · GLOBALE ₹11.1 Cr · RADAAN ₹15.2 Cr
    //   SUVIDHAA ₹47.6 Cr · EROSMEDIA ₹74.9 Cr — every one at ~zero daily value.
    //
    // A company that small has no stage and no relative strength, so it scores
    // near the floor on the technical axis, and THAT is what has been keeping
    // it out of the top tier. The chart term was moonlighting as a junk filter.
    // Take the chart out of the tier — which is the whole point of the V2 split
    // — and the junk walks straight in, promoted by the very change meant to
    // surface Bharat Dynamics.
    //
    // So the filter becomes explicit, and states its own reason: below this
    // size you cannot take a position worth taking, and the reported numbers
    // are the least scrutinised in the market. That is a statement about
    // TRADEABILITY, not about the quarter — which is why it caps the tier and
    // leaves every score and caveat untouched.
    //
    // MARKET CAP IS THE PRIMARY TEST, NOT LIQUIDITY. `adtv_cr` is missing or
    // zero for 17 of 276 rows, and three of those are large: Bharat Dynamics
    // (₹41,587 Cr), Indo Tech (₹4,150 Cr), MBECL (₹1,157 Cr). Gating on volume
    // alone would have thrown away the exact name this work set out to rescue.
    // So ADTV only ever speaks about a company ALREADY known to be small, and
    // a null ADTV never counts against anyone.
    //
    // Calibrated to demote NOTHING currently above MIXED (verified: 0 of 276 on
    // 2026-08-14) while blocking six of the eight shells. Puravankara ₹4,873 Cr,
    // Pakka ₹357 Cr and Aartech ₹162 Cr all pass — genuine microcaps are the
    // hunting ground, and this is not a smallcap filter.
    // ═══════════════════════════════════════════════════════════════════════
    const _mcap = typeof row?.market_cap_cr === 'number' ? row.market_cap_cr : null;
    const _adtv = typeof row?.adtv_cr === 'number' ? row.adtv_cr : null;
    if (_mcap != null && _mcap < 100) {
      capTier('MIXED', 'below investable size');
    } else if (_mcap != null && _mcap < 500 && _adtv != null && _adtv < 0.10) {
      capTier('MIXED', 'barely trades');
    }
  }

  // Narrative
  const co = row.company || row.symbol;
  const q = row.quarter || deriveQuarterLabel(row.filing_date);
  // zzz383 — clamp base-effect blow-ups: a near-zero/negative prior base makes YoY %
  // explode (e.g. +5000% on a ₹0.5 Cr → ₹50 Cr PAT). Exact precision is meaningless
  // and reads as fabricated, so show '>500% (low base)' above the threshold.
  const fmtP = (lbl: string, v: number | null) => v == null ? '' : (v >= 500 ? `${lbl} >500% YoY (low base)` : `${lbl} ${v >= 0 ? '+' : ''}${Math.round(v)}% YoY`);
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
  // zzz668 — THE REAL VOLUME RATIO, NOT THE CONSTANT.
  //
  // This was 50, with the US engine's comment naming it as a known India
  // limitation: "the India engine has to hardcode it to 50 because Screener
  // does not expose the series". Enrichment computes `vol_ratio_20d` and the
  // row builder was dropping it, so the limitation was in the plumbing, not
  // the data. A quarter of the PEAD score is now measured.
  //
  // Post-earnings drift needs CONVICTION behind the move: the same 5% rise on
  // triple normal volume and on half normal volume are not the same event. 50
  // remains the reading when the ratio is genuinely unknown, which is the only
  // honest value for "no opinion".
  const _vr = (typeof (row as any)?.vol_ratio_20d === 'number' && Number.isFinite((row as any).vol_ratio_20d))
    ? (row as any).vol_ratio_20d
    : ((typeof (row as any)?.rvol === 'number' && Number.isFinite((row as any).rvol)) ? (row as any).rvol : null);
  const _volS = _vr == null ? 50
    : _vr >= 3 ? 100 : _vr >= 2 ? 88 : _vr >= 1.5 ? 75 : _vr >= 1 ? 60 : _vr >= 0.7 ? 40 : 20;
  // ═══════════════════════════════════════════════════════════════════════
  // ONE PEAD SCORE, NOT TWO.  (zzz669)
  //
  // Two incompatible PEAD formulas have been shipping side by side: this one,
  // shown on the card, and a later one in lib/pead-score.ts that the Conviction
  // bench recomputes with. They disagree about the same company, which means at
  // least one of the two numbers you read is wrong, and nothing on either screen
  // says which.
  //
  // The bench formula is the better one and its own header explains why: the
  // earlier construction "measured the wrong quantity" — a weighted sum of YoY
  // growth answers how big the numbers were, not how much drift is left — and
  // "its scale made its own green band unreachable", a sales +25 / profit +40 /
  // EPS +38 quarter scoring about 49. It also carries the time decay that post-
  // earnings drift is defined by: reaction, drift, saturation, exhaustion.
  //
  // So the card adopts the bench's function rather than the bench adopting the
  // card's. Both screens now read the same number for the same company, and the
  // decay is computed from the filing date on both, so a card seen the morning
  // after the print and the same name on the bench six weeks later differ for
  // the reason they should.
  //
  // The measured volume ratio above is not wasted: it is the conviction filter
  // the reaction leg lacked, applied as a modest tilt rather than a quarter of
  // the score, because the bench formula already weights the reaction at 50%.
  const _peadBase = peadScore({
    ticker: row?.symbol || '',
    sales_yoy_pct: salesY,
    net_profit_yoy_pct: patY,
    eps_yoy_pct: epsY,
    composite_score: composite,
    fund_composite: Math.round(_fund_composite), setup_grade: _setup_grade,  // zzz673 — display only
    d1_pct: row?.d1_pct ?? null,
    gap_pct: row?.gap_pct ?? null,
    tier,
    filing_date: row?.filing_date,
  } as any).score;
  // Volume tilt: ±6 points at the extremes, nothing when the ratio is unknown.
  const _volTilt = _vr == null ? 0
    : _vr >= 3 ? 6 : _vr >= 2 ? 4 : _vr >= 1.5 ? 2 : _vr >= 1 ? 0 : _vr >= 0.7 ? -3 : -6;
  const _pead_score = Math.max(0, Math.min(100, Math.round(_peadBase + _volTilt)));
  const _roce = (row as any)?.roce;
  const _opm = row?.opm_pct;
  const _prom = (row as any)?.promoter;
  // MULTIBAGGER  (PATCH 1009, corrected zzz668)
  //
  // The fourth signal read `row.promoter` — promoter holding — and NOTHING in
  // the pipeline has ever set that field. Enrichment returns `pledged_pct`; it
  // does not return promoter holding, and a repo-wide search finds no producer.
  // So the badge has always been a THREE-signal test needing two, while its
  // tooltip described a "6-criterion SQGLP compounder filter".
  //
  // The dead leg is removed rather than left to look like a rule. Pledge is
  // used in its place, which is the governance figure that IS scraped: a
  // promoter who has pledged a quarter of the company is the risk the promoter
  // leg was gesturing at, and unlike the original it can actually fire.
  const _pledge = typeof (row as any)?.pledged_pct === 'number' ? (row as any).pledged_pct : null;
  const _mbSignals = ((typeof _roce === 'number' && _roce >= 25) ? 1 : 0)
                   + ((typeof _opm === 'number' && _opm >= 18) ? 1 : 0)
                   + ((opmExp != null && opmExp >= 1) ? 1 : 0)
                   + ((_pledge != null && _pledge <= 5) ? 1 : 0);
  const _multibagger = !!(_mbSignals >= 2 && !_stillLoss);

  // ── QUALITY × INFLECTION (the second axis) ────────────────────────────────
  // Purely ADDITIVE: computed AFTER `tier` is final and never fed back into it.
  // A company that has not yet proved it can earn a return does not become
  // BLOCKBUSTER because it is improving quickly, so the quadrant sits BESIDE
  // the tier rather than adjusting it. The input mapping lives in the shared
  // module so this server copy and the client gradeRow cannot disagree about
  // what quadrant a given row is in.
  const _q = quadrantForIndiaRow(row, { salesY, opmExp });
  return {
    ticker: row.symbol,
    company: row.company || row.symbol,
    sector: row.sector,
    filing_date: row.filing_date,
    quarter: row.quarter || deriveQuarterLabel(row.filing_date),
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
    fund_composite: Math.round(_fund_composite), setup_grade: _setup_grade,  // zzz673 — display only
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
    // zzz314 — SAME class of bug as PATCH 1015: enrichment provides
    // ocf_to_pat_ratio (used above for the 'ocf divergence' caveat), but
    // gradeRow was dropping it from the response so downstream CB cards
    // couldn't render a CFO/PAT chip. Expose it here under two aliases:
    // ocf_to_pat_ratio (matches the internal field name) and
    // cfo_to_pat_ratio (matches downstream sync + display code).
    ocf_to_pat_ratio: row.ocf_to_pat_ratio ?? null,
    cfo_to_pat_ratio: row.ocf_to_pat_ratio ?? null,
    // QUALITY × INFLECTION — second axis, alongside (never instead of) the tier.
    quality_score: _q.quality,
    inflection_score: _q.inflection,
    quadrant: _q.quadrant,
    quadrant_parts: { quality: _q.quality_parts, inflection: _q.inflection_parts },
    // ROCE is a quality input the card should be able to show its work on; the
    // grader already reads it (multibagger flag) but was dropping it from the
    // response — the same class of omission as PATCH 1015 / zzz314.
    roce: (typeof _roce === 'number' && Number.isFinite(_roce)) ? _roce : null,
  } as any;
}

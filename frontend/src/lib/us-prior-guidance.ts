// ═══════════════════════════════════════════════════════════════════════════
// PRIOR GUIDANCE (server-only) — what the company told us LAST quarter about
// the quarter it has just reported.
//
// A serious write-up never stops at "beat estimates":
//
//     Beat revenue estimates by 2.2% & beat the midpoint of its own guidance
//     by 3.3%; beat $.77 EPS estimates & its guide by $.28
//
// The second half is the half nobody stores. We already read every earnings
// release's guidance (lib/us-guidance → lib/us-guidance-figures); this module
// reaches back ONE release, takes the figures that release aimed at the quarter
// now being reported, and hands them to the caller to line up against the
// actual. It reads nothing new from the wire that the engine does not already
// know how to read: one `submissions` call (cached 6h) and one
// `guidanceFromFiling` on the prior 8-K (cached 7d, two SEC requests, both
// through the rate-limited EDGAR client).
//
// THE BINDING RULE — BY CALENDAR, NEVER BY MAGNITUDE
// ──────────────────────────────────────────────────
// This is the same discipline as `withEstimates` in the graded-us route, and
// for the same reason: the only safe way to know WHICH period a number belongs
// to is to compute it from the filer's own fiscal calendar. So a prior figure
// is kept only when the period IT NAMES resolves to the quarter (or the fiscal
// year) we have just graded:
//
//   • "Q2 FY27" / "FY27" — the label is self-sufficient. It is compared with
//     the reported quarter's own fiscal (q, fy) and must match exactly.
//   • "Q3" with no fiscal year — resolved to the NEXT occurrence of that
//     quarter after the prior release's own reported quarter, exactly as
//     `withEstimates` walks forward from the reported quarter.
//   • "full year" with no fiscal year — a release reporting Q1–Q3 that says
//     "full year" means the year in progress; a release reporting Q4 means the
//     year that has just begun. That is arithmetic, not a guess.
//   • anything else, or a figure whose stated `period` disagrees with the
//     period its label parses to — DROPPED.
//
// Nothing here is matched on how close two numbers look, and nothing is
// inferred from the size of a figure. Dropping is always correct; a mis-bound
// figure is a defect, because "beat its own guide by 3.3%" is a fact claim.
//
// WHAT THE CALLER MUST GET RIGHT
//   • `reportedFiscalQ` / `reportedFiscalFy` must be the FILER'S OWN naming —
//     `Guidance.fiscal_q` / `Guidance.fiscal_fy` off the current release's
//     headline. The labels we match against are the filer's words, and SEC's
//     fy/fp field disagrees with the filer often (NetApp's July quarter is
//     Q1 FY27 to NetApp and "fy 2026 Q1" to the API). Passing SEC's naming
//     does not produce a wrong answer — nothing binds and you get a `reason` —
//     but it produces an empty one.
//   • `actual` arrives in the SAME unit the guide states (`unit`). A $M guide
//     is carried here in absolute dollars because that is how the figures
//     parser emits it; a percentage guide is carried as 68.0, not 0.68. This
//     module converts nothing — see rule 5 of its brief.
//   • basis pairing is the caller's: a GAAP actual may only meet a GAAP guide.
//     `basis` is carried through untouched and never relabelled.
// ═══════════════════════════════════════════════════════════════════════════

import { submissions } from './us-edgar';
import { guidanceFromFiling } from './us-guidance';
import { fmtGuideRange, type GuidanceFigure } from './us-guidance-figures';

export interface GuideVsActual {
  /** Same vocabulary as `GuidanceFigure.metric` ('revenue', 'eps', 'ebitda', …). */
  metric: string;
  basis: 'gaap' | 'adjusted' | null;
  /** Was this a quarterly guide or the FY guide? */
  period: 'quarter' | 'year';
  guide_low: number | null;
  guide_high: number | null;
  /** Midpoint; equals the point value for a point guide. */
  guide_mid: number | null;
  /** 'usd' (absolute dollars), 'usd_share', or 'pct' — carried through unchanged. */
  unit: string;
  /** Filled in by the caller, not by us. */
  actual: number | null;
  /** Filing date of the prior 8-K the guide came from, YYYY-MM-DD. */
  guided_on: string;
  /** The period label as the filer wrote it ("Q2 FY27", "FY27", "full year"). */
  guided_for_label: string | null;
  /** The prior release itself (Exhibit 99.1), where the words are. */
  source_url: string | null;
}

export interface PriorGuidance {
  /** Guidance from the previous earnings release that applies to the quarter just reported. */
  for_quarter: GuideVsActual[];
  /** Guidance from the previous release for the fiscal year that contains the reported quarter —
   *  so the UI can say "raised FY guide" vs "reiterated". */
  for_year: GuideVsActual[];
  prior_filing_date: string | null;
  /** The prior 8-K's EDGAR index page. The press release itself is each
   *  figure's `source_url`. */
  prior_filing_url: string | null;
  /** The quarter the PRIOR release reported, in the filer's own words ("Q1 FY27"). */
  prior_fiscal_label?: string | null;
  /** Why nothing came back, when nothing did — shown in dev notes, never as a user-facing guess. */
  reason?: string;
}

// ─── window for "the previous quarter's release" ───────────────────────────
// One quarter back, with room for a 52/53-week calendar, a filer that slips a
// week, and the 13-week/14-week shuffle. Anything closer than the floor is not
// the previous quarter's earnings — it is a pre-announcement, a re-release or a
// second Item-2.02 8-K inside the same quarter, and it is stepped over rather
// than used. Anything past the ceiling means we never found the prior quarter.
const MIN_GAP_DAYS = 60;
const MAX_GAP_DAYS = 200;

const DAY_MS = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
function daysBetween(a: string, b: string): number | null {
  if (!ISO.test(a) || !ISO.test(b)) return null;
  const x = Date.parse(`${a}T00:00:00Z`), y = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return Math.round((x - y) / DAY_MS);
}
const normAcc = (a: string) => (a || '').replace(/[^0-9]/g, '');

// ─── period resolution ─────────────────────────────────────────────────────
interface Bound { kind: 'quarter' | 'year'; q: 1 | 2 | 3 | 4 | null; fy: number; explicit: boolean; }
interface PriorPos { q: 1 | 2 | 3 | 4 | null; fy: number | null; }

/**
 * The fiscal (quarter, year) a guidance figure's own label names, resolved
 * against the position of the release that carried it. Returns null whenever
 * the label cannot be pinned down — which is the correct outcome, not a
 * failure.
 */
function resolvePeriod(f: GuidanceFigure, prior: PriorPos): Bound | null {
  const label = (f.period_label || '').trim();
  if (!label) return null;

  // "Q2 FY27" — self-sufficient.
  const mq = /^Q([1-4])\s+FY(\d{2})$/i.exec(label);
  if (mq) return { kind: 'quarter', q: Number(mq[1]) as 1 | 2 | 3 | 4, fy: 2000 + Number(mq[2]), explicit: true };
  // "FY27" — self-sufficient.
  const my = /^FY(\d{2})$/i.exec(label);
  if (my) return { kind: 'year', q: null, fy: 2000 + Number(my[1]), explicit: true };

  // Everything below leans on where the PRIOR release itself sat in its own
  // fiscal year. Without that there is no chain to walk, so nothing is bound.
  if (prior.q == null || prior.fy == null) return null;

  // A bare "Q3": the next Q3 on or after the prior release's own quarter.
  const bq = /^Q([1-4])$/i.exec(label);
  if (bq) {
    const n = Number(bq[1]) as 1 | 2 | 3 | 4;
    return { kind: 'quarter', q: n, fy: n > prior.q ? prior.fy : prior.fy + 1, explicit: false };
  }
  // A bare "full year": the year in progress, or — from a Q4 release, which has
  // no year left to guide — the year that has just started.
  if (/^full[- ]year$/i.test(label)) {
    return { kind: 'year', q: null, fy: prior.q < 4 ? prior.fy : prior.fy + 1, explicit: false };
  }
  return null;
}

const METRIC_ORDER = ['revenue', 'product_revenue', 'subscription_revenue', 'eps', 'ebitda',
  'operating_income', 'operating_margin', 'net_income', 'comparable_sales', 'gross_margin', 'free_cash_flow'];

function toGuide(f: GuidanceFigure, filedOn: string, sourceUrl: string | null): GuideVsActual | null {
  const lo = f.low, hi = f.high;
  if (lo == null && hi == null) return null;
  const mid = lo != null && hi != null ? (lo + hi) / 2 : (lo ?? hi);
  return {
    metric: f.metric,
    basis: f.basis ?? null,
    period: f.period,
    guide_low: lo,
    guide_high: hi,
    guide_mid: mid,
    unit: f.unit,
    actual: null,
    guided_on: filedOn,
    guided_for_label: f.period_label || null,
    source_url: sourceUrl,
  };
}

/** One row per metric+basis. A range outranks a point, and a figure whose label
 *  named its fiscal year outranks one that had to be resolved forward. */
function dedupe(rows: Array<{ g: GuideVsActual; explicit: boolean }>): GuideVsActual[] {
  const kept = new Map<string, { g: GuideVsActual; explicit: boolean }>();
  for (const r of rows) {
    const k = `${r.g.metric}|${r.g.basis}`;
    const prev = kept.get(k);
    if (!prev) { kept.set(k, r); continue; }
    const prevRange = prev.g.guide_low !== prev.g.guide_high;
    const curRange = r.g.guide_low !== r.g.guide_high;
    if ((curRange && !prevRange) || (curRange === prevRange && r.explicit && !prev.explicit)) kept.set(k, r);
  }
  return Array.from(kept.values())
    .map((r) => r.g)
    .sort((a, b) => {
      const ia = METRIC_ORDER.indexOf(a.metric), ib = METRIC_ORDER.indexOf(b.metric);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
        || (a.basis === b.basis ? 0 : a.basis === 'adjusted' ? -1 : 1);
    });
}

// ─── cache ─────────────────────────────────────────────────────────────────
// A past quarter's guidance never changes, so an hour is generous; the two
// things this builds on (submissions, guidanceFromFiling) hold their own
// longer-lived caches, so a miss here is cheap anyway. Same shape and eviction
// style as lib/us-guidance.
const _pg = new Map<string, { at: number; data: PriorGuidance | null }>();
const PG_TTL_MS = 3600_000;
const PG_MAX = 800;

function remember(key: string, data: PriorGuidance | null): PriorGuidance | null {
  if (_pg.size > PG_MAX) {
    const oldest = Array.from(_pg.entries()).sort((a, b) => a[1].at - b[1].at).slice(0, Math.ceil(PG_MAX / 4));
    for (const [k] of oldest) _pg.delete(k);
  }
  _pg.set(key, { at: Date.now(), data });
  return data;
}

/**
 * The previous earnings release's guidance for the quarter just reported.
 *
 * Never throws: every network path is wrapped, and a failure comes back as a
 * `reason`, so a route can attach the result unconditionally.
 */
export async function priorGuidanceFor(args: {
  cikNum: number;
  /** The 8-K we are grading — excluded, along with anything filed on/after `currentFilingDate`. */
  currentAccession: string;
  currentFilingDate: string;       // YYYY-MM-DD
  reportedPeriodEnd: string;       // the quarter end we just graded, YYYY-MM-DD
  reportedFiscalQ: 1 | 2 | 3 | 4 | null;
  reportedFiscalFy: number | null;
}): Promise<PriorGuidance | null> {
  const { cikNum, currentAccession, currentFilingDate, reportedPeriodEnd, reportedFiscalQ, reportedFiscalFy } = args;
  if (!Number.isFinite(cikNum) || cikNum <= 0) return null;
  if (!ISO.test(currentFilingDate || '')) return null;

  const key = `${cikNum}:${normAcc(currentAccession) || currentFilingDate}:${reportedFiscalQ ?? '-'}${reportedFiscalFy ?? '-'}`;
  const hit = _pg.get(key);
  if (hit && Date.now() - hit.at < PG_TTL_MS) return hit.data;

  const empty = (reason: string, extra?: Partial<PriorGuidance>): PriorGuidance => ({
    for_quarter: [], for_year: [], prior_filing_date: null, prior_filing_url: null, reason, ...extra,
  });

  try {
    // ── 1. the previous earnings release ─────────────────────────────────
    const subs = await submissions(cikNum).catch(() => null);
    // NOT cached: a transient SEC failure must not become an hour of silence.
    if (!subs) return empty('EDGAR submissions unavailable');

    const cur = normAcc(currentAccession);
    const cands = subs.recent
      .filter((f) => f.form === '8-K'
        && f.items.includes('2.02')
        && ISO.test(f.filingDate || '')
        && f.filingDate < currentFilingDate
        && (!cur || normAcc(f.accession) !== cur)
        && !!f.accession)
      .sort((a, b) => (a.filingDate < b.filingDate ? 1 : a.filingDate > b.filingDate ? -1 : 0));

    let pick: { accession: string; filingDate: string } | null = null;
    let nearest: number | null = null;
    for (const c of cands) {
      const gap = daysBetween(currentFilingDate, c.filingDate);
      if (gap == null) continue;
      if (nearest == null) nearest = gap;
      // Walking newest-first, the gap only grows: skip anything inside the
      // current quarter, stop once we are past a quarter's reach.
      if (gap < MIN_GAP_DAYS) continue;
      if (gap > MAX_GAP_DAYS) break;
      pick = { accession: c.accession, filingDate: c.filingDate };
      break;
    }
    if (!pick) {
      return remember(key, empty(nearest == null
        ? 'no prior earnings release in range'
        : `no prior earnings release in range (nearest Item-2.02 8-K is ${nearest}d back)`));
    }

    // A release filed AFTER the quarter it guides had already ended is not a
    // forward guide, and "beat its own guide" would be a hollow claim. Only a
    // delinquent filer produces that shape.
    //
    // The test is applied only when `reportedPeriodEnd` is CONSISTENT with the
    // filing we are grading — a quarter end 0-100 days behind the release.
    // A caller whose XBRL has not posted yet hands us the PREVIOUS quarter's
    // end (≥ ~106 days behind), and testing against that would refuse every
    // fresh print, which is the one case this feature exists for. When the
    // input does not describe the quarter being reported, the test is skipped
    // rather than applied to the wrong date.
    const endGap = ISO.test(reportedPeriodEnd || '') ? daysBetween(currentFilingDate, reportedPeriodEnd) : null;
    if (endGap != null && endGap >= 0 && endGap <= 100 && pick.filingDate >= reportedPeriodEnd) {
      return remember(key, empty('prior release was filed after the reported quarter ended'));
    }

    const nod = pick.accession.replace(/-/g, '');
    const filingUrl = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${nod}/${pick.accession}-index.htm`;

    // ── 2. its guidance ──────────────────────────────────────────────────
    const g = await guidanceFromFiling(cikNum, pick.accession, filingUrl).catch(() => null);
    const base: Partial<PriorGuidance> = {
      prior_filing_date: pick.filingDate,
      prior_filing_url: filingUrl,
      prior_fiscal_label: g?.fiscal_label ?? null,
    };
    if (!g) return empty('prior release could not be read', base);        // transient — not cached
    if (!g.figures.length) return remember(key, empty('prior release carries no parseable guidance figures', base));

    // ── 3. bind each figure to a period, by calendar ─────────────────────
    if (!reportedFiscalQ || !reportedFiscalFy) {
      return remember(key, empty('reported quarter has no fiscal (q, fy) to bind against', base));
    }
    const priorPos: PriorPos = { q: g.fiscal_q, fy: g.fiscal_fy };
    // The prior release must sit BEHIND the reported quarter on the filer's own
    // calendar, and not more than a year behind. This is the same arithmetic
    // `withEstimates` uses, and unlike the date test above it does not depend on
    // an input the caller may not have yet. A release that names the quarter we
    // are grading, or one from a year ago, is not "last quarter's guide".
    if (priorPos.q != null && priorPos.fy != null) {
      const offset = (reportedFiscalFy - priorPos.fy) * 4 + (reportedFiscalQ - priorPos.q);
      if (offset < 1 || offset > 4) {
        return remember(key, empty(
          `prior release reports ${g.fiscal_label || `Q${priorPos.q} FY${String(priorPos.fy).slice(2)}`}`
          + `, which is ${offset} quarter(s) from the reported quarter`, base));
      }
    }
    const qRows: Array<{ g: GuideVsActual; explicit: boolean }> = [];
    const yRows: Array<{ g: GuideVsActual; explicit: boolean }> = [];
    let dropped = 0;

    for (const f of g.figures) {
      const b = resolvePeriod(f, priorPos);
      // A figure whose stated period disagrees with the period its own label
      // parses to is internally inconsistent; there is nothing to bind.
      if (!b || b.kind !== f.period) { dropped++; continue; }
      const isQuarter = b.kind === 'quarter' && b.q === reportedFiscalQ && b.fy === reportedFiscalFy;
      // A company reporting Q2 FY27 guided FY27 — the SAME fiscal year as the
      // reported quarter, which is what makes "raised" vs "reiterated" readable.
      const isYear = b.kind === 'year' && b.fy === reportedFiscalFy;
      if (!isQuarter && !isYear) { dropped++; continue; }
      const row = toGuide(f, pick.filingDate, g.source_url);
      if (!row) { dropped++; continue; }
      (isQuarter ? qRows : yRows).push({ g: row, explicit: b.explicit });
    }

    const out: PriorGuidance = {
      for_quarter: dedupe(qRows),
      for_year: dedupe(yRows),
      prior_filing_date: pick.filingDate,
      prior_filing_url: filingUrl,
      prior_fiscal_label: g.fiscal_label ?? null,
    };
    if (!out.for_quarter.length && !out.for_year.length) {
      out.reason = `no guidance figure in the prior release names ${`Q${reportedFiscalQ} FY${String(reportedFiscalFy).slice(2)}`}`
        + ` (${g.figures.length} figure${g.figures.length === 1 ? '' : 's'} read, ${dropped} could not be bound)`;
    }
    return remember(key, out);
  } catch {
    return empty('prior-guidance lookup failed');                          // transient — not cached
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GUIDE vs ACTUAL — the sentence.
// ═══════════════════════════════════════════════════════════════════════════

export interface GuideComparison {
  verdict: 'beat' | 'missed' | 'in-line' | null;
  /** % above/below the midpoint. */
  delta_pct: number | null;
  /** Absolute difference from the midpoint, in the guide's own unit
   *  (dollars for 'usd', dollars per share for 'usd_share', percentage
   *  POINTS for 'pct'). */
  delta_abs: number | null;
  /** "beat the midpoint of its own guide by 3.3%" / "beat its guide by $0.28" */
  text: string | null;
}

const pctText = (v: number) => `${Math.round(Math.abs(v) * 10) / 10}%`;
const shareText = (v: number) => `$${Math.abs(v).toFixed(2)}`;
const bpsText = (v: number) => `${Math.round(Math.abs(v) * 100)} bps`;

/**
 * Turn a bound guide plus the actual the caller has aligned to it into the
 * half-sentence a write-up wants.
 *
 * WORDING, by unit — the unit decides, never the ticker:
 *   • per-share ('usd_share', and `eps` however it is carried) reads as an
 *     absolute dollar difference:  "beat its guide by $0.28";
 *   • a metric that IS a percentage ('pct' — margins, comps, growth rates)
 *     reads in percentage POINTS: "beat the midpoint of its own guide by
 *     300 bps". A percentage OF a percentage is a different quantity and
 *     stating it as "3%" would be ambiguous where it matters most;
 *   • everything else reads as a percentage of the midpoint: "beat the
 *     midpoint of its own guide by 3.3%" — EXCEPT where that percentage would
 *     not mean what it says. A percentage of the midpoint is only a statement
 *     when the midpoint is positive and the actual is on the same side of
 *     zero: MongoDB guided a Q2 FY27 GAAP operating LOSS of $6-10M and
 *     delivered a $28.4m profit, which is "beat … by 455%" arithmetically and
 *     nonsense to a reader. Those cases read in absolute dollars instead:
 *     "beat the midpoint of its own guide by $36.4M".
 *
 * "in-line" is any actual that lands inside the guided range, or within 0.5%
 * of a point guide. `delta_pct` and `delta_abs` are still returned for an
 * in-line result, so a caller can say where in the range it landed.
 *
 * Anything missing — no actual, no midpoint — returns nulls rather than an
 * awkward sentence.
 */
export function compareToGuide(g: GuideVsActual, actual: number | null): GuideComparison {
  const none: GuideComparison = { verdict: null, delta_pct: null, delta_abs: null, text: null };
  if (!g || actual == null || !Number.isFinite(actual)) return none;
  const mid = g.guide_mid;
  if (mid == null || !Number.isFinite(mid)) return none;
  const lo = g.guide_low != null && Number.isFinite(g.guide_low) ? g.guide_low : mid;
  const hi = g.guide_high != null && Number.isFinite(g.guide_high) ? g.guide_high : mid;
  if (hi < lo) return none;

  // A scale mismatch is the one error this function can catch on its own, and
  // it is worth catching: "missed its guide by 99.9%" is what a $M actual
  // meeting an absolute-dollar guide looks like. This converts nothing — it
  // refuses to speak.
  if (g.unit === 'usd' && actual !== 0 && mid !== 0) {
    const r = Math.abs(actual / mid);
    if (r >= 100 || r <= 0.01) return none;
  }
  if (g.unit === 'pct' && Math.abs(actual) > 200) return none;   // not a percentage

  const deltaAbs = actual - mid;
  const deltaPct = mid !== 0 ? (deltaAbs / Math.abs(mid)) * 100 : null;

  // Inside the range is in-line. For a point guide, 0.5% either way is the
  // same statement rounded.
  const isPoint = lo === hi;
  const tol = isPoint ? Math.abs(mid) * 0.005 : 0;
  const inLine = isPoint ? Math.abs(deltaAbs) <= tol : actual >= lo && actual <= hi;
  const verdict: GuideComparison['verdict'] = inLine ? 'in-line' : deltaAbs > 0 ? 'beat' : 'missed';

  if (verdict === 'in-line') {
    return {
      verdict, delta_pct: deltaPct, delta_abs: deltaAbs,
      text: isPoint ? 'in line with its own guide' : 'landed inside its own guided range',
    };
  }

  const verb = verdict === 'beat' ? 'beat' : 'missed';
  const perShare = g.unit === 'usd_share' || g.metric === 'eps';
  let text: string | null;
  if (perShare) {
    // Below a cent there is no sentence worth printing: the guide and the
    // actual are quoted to the cent, and "$0.00" reads as nothing at all.
    text = Math.abs(deltaAbs) >= 0.005 ? `${verb} its guide by ${shareText(deltaAbs)}` : null;
  } else if (g.unit === 'pct') {
    text = Math.abs(deltaAbs) >= 0.005 ? `${verb} the midpoint of its own guide by ${bpsText(deltaAbs)}` : null;
  } else if (mid > 0 && actual > 0) {
    text = deltaPct != null && Math.abs(deltaPct) >= 0.05
      ? `${verb} the midpoint of its own guide by ${pctText(deltaPct)}` : null;
  } else {
    // A guided loss, or an actual that crossed zero: the difference itself is
    // the only honest way to say it.
    text = `${verb} the midpoint of its own guide by ${fmtGuideRange({ low: Math.abs(deltaAbs), high: Math.abs(deltaAbs), unit: 'usd' })}`;
  }
  return { verdict, delta_pct: deltaPct, delta_abs: deltaAbs, text };
}

// ═══════════════════════════════════════════════════════════════════════════
// THE PROCESS LAYER  (zzz630)
//
// The bench answers "was this a good quarter". Rishi's ten-step process asks
// four further questions the bench never did, and this file answers exactly
// those four and nothing else:
//
//   1. WHICH KIND of good quarter is it?          → buckets A-E
//   2. Does management do what it said it would?  → promise vs delivery
//   3. Is something physical holding the demand    → bottleneck linkage
//      up, or is it just a good quarter?
//   4. What survives each successive filter?      → the funnel, with counts
//
// THE RULE THIS FILE OBEYS, AS EVERYWHERE ELSE: nothing is invented. Every
// classification is derived from figures the engine already computed out of
// filings, every one carries the reasons that produced it, and where the
// evidence is thin the answer says so rather than guessing. A label with no
// reasons attached is an opinion wearing a badge.
// ═══════════════════════════════════════════════════════════════════════════

import type { UsConvictionEntry } from './conviction-beats-us';
import { growthEvidenceOf, ttmEpsOf } from './us-valuation';
import { THEMES as BOTTLENECK_THEMES } from './bottleneck-intel';

const fin = (v: any): number | null =>
  (typeof v === 'number' && Number.isFinite(v) ? v : null);

// ─────────────────────────────────────────────────────────────────────────
// 1. THE FIVE BUCKETS
//
// "Earnings strength ≠ future multibagger" is the whole point, and a single
// tier cannot carry it: BLOCKBUSTER is assigned to a structural compounder
// and to a commodity business at the top of its cycle alike. These five
// separate them.
//
// Evaluated in a FIXED ORDER, worst first, and the first match wins. That is
// deliberate: E and D are disqualifiers, and a company that is both "growing
// fast" and "not converting to cash" must be called a trap, not a compounder.
// Sorting the good cases first would let every trap qualify as an A.
// ─────────────────────────────────────────────────────────────────────────

// F and '?' are NOT the same answer, and collapsing them was the first
// version's worst fault: a name with sixteen filed quarters that simply does
// not qualify for anything is a CONCLUSION — "good quarter, no edge" — and it
// is the bulk of the field by design, which is the whole point of a funnel
// that goes 264 → 8-12. A name with two filed quarters is an absence of
// evidence. Reporting both as "not classifiable" made the classifier look
// broken and hid the single most common real verdict.
export type BucketId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | '?';

export const BUCKET_META: Record<BucketId, { label: string; short: string; color: string; hunting: boolean; blurb: string }> = {
  A: { label: 'Structural compounder', short: 'COMPOUNDER', color: '#22C55E', hunting: true,
       blurb: 'Revenue growing, margins expanding, earnings converting to cash, and the growth is durable across the filed series rather than one quarter.' },
  B: { label: 'Earnings inflection', short: 'INFLECTION', color: '#3B82F6', hunting: true,
       blurb: 'A previously mediocre business that has just turned — the margin or the loss line changed shape this year, not merely this quarter.' },
  C: { label: 'Re-rating candidate', short: 'RE-RATING', color: '#A78BFA', hunting: true,
       blurb: 'The business is improving and the multiple has not followed. The upside here comes from what the market pays, not only from what the company earns.' },
  D: { label: 'Cyclical peak', short: 'CYCLE PEAK', color: '#F59E0B', hunting: false,
       blurb: 'Excellent current numbers with margins at the top of their own range and growth decelerating — the quarter is real, its repeatability is the question.' },
  E: { label: 'Earnings trap', short: 'TRAP', color: '#EF4444', hunting: false,
       blurb: 'The headline is strong and the economics underneath are not: cash is not following the earnings, or one-offs are doing the work.' },
  F: { label: 'Good quarter, no edge', short: 'NO EDGE', color: '#94A3B8', hunting: false,
       blurb: 'The print is real and nothing is wrong with it — it simply does not argue for a multibagger. Most of the field lands here, and that is the funnel doing its job.' },
  '?': { label: 'Not enough filed history', short: '—', color: '#64748B', hunting: false,
       blurb: 'Too few filed quarters, or the key inputs are missing, to place this honestly. Shown as unknown rather than guessed at.' },
};

export interface BucketVerdict {
  bucket: BucketId;
  reasons: string[];
  /** Everything that argued against the bucket it landed in, kept rather than
   *  discarded — the reader should see the tension, not a clean label. */
  against: string[];
}

/** Where the latest operating margin sits inside its own filed range, 0-100. */
function opmPercentile(e: UsConvictionEntry): number | null {
  const s: any = e.series;
  if (!s || !Array.isArray(s.revenue)) return null;
  // zzz648 — operating income where it was filed, gross profit where it was
  // not. Without this the percentile was null for every company XBRL tags
  // with a gross-profit line and no operating-income line, which is a large
  // and entirely arbitrary slice of the field.
  const profitLine: any[] | null =
    Array.isArray(s.operating_income) && s.operating_income.filter((x: any) => x != null).length >= 6 ? s.operating_income
    : Array.isArray(s.gross_profit) && s.gross_profit.filter((x: any) => x != null).length >= 6 ? s.gross_profit
    : null;
  if (!profitLine) return null;
  const opm: number[] = [];
  for (let i = 0; i < s.revenue.length; i++) {
    const rev = fin(s.revenue[i]), oi = fin(profitLine[i]);
    if (rev != null && rev > 0 && oi != null) opm.push((oi / rev) * 100);
  }
  if (opm.length < 6) return null;
  const last = opm[opm.length - 1];
  const lo = Math.min(...opm), hi = Math.max(...opm);
  if (!(hi > lo)) return null;
  return Math.round(((last - lo) / (hi - lo)) * 100);
}

/** Is revenue growth slower than it was a year ago? */
function revenueDecelerating(e: UsConvictionEntry): boolean | null {
  const s: any = e.series;
  const rev: number[] = Array.isArray(s?.revenue) ? s.revenue.map(fin).filter((x: any) => x != null) : [];
  if (rev.length < 12) return null;
  const ttm = (end: number) => rev.slice(end - 4, end).reduce((a, b) => a + b, 0);
  const now = ttm(rev.length), prev = ttm(rev.length - 4), prev2 = ttm(rev.length - 8);
  if (!(prev > 0) || !(prev2 > 0)) return null;
  return (now / prev - 1) < (prev / prev2 - 1) - 0.02;
}

// ═══════════════════════════════════════════════════════════════════════════
// THE INPUTS, DERIVED FROM THE FILINGS WHEN THE ENGINE DID NOT CARRY THEM
// (zzz648)
//
// Seven of ninety-three bench entries came back "? — too few filed quarters".
// Four of them had SIXTEEN OR SEVENTEEN filed quarters of revenue, earnings and
// cash flow sitting on the entry. What was missing was never the history; it
// was the engine's pre-computed SCALARS — opm_pct, cfo_to_pat_ratio,
// fcf_curr_musd — which XBRL does not always tag in a shape the grader picks
// up. The classifier was refusing to judge companies whose numbers it was
// holding the whole time.
//
// So each gate input is taken from the engine when the engine has it, and
// otherwise computed from the filed series. Nothing is invented and nothing is
// estimated: these are the same figures, summed from the same filings, and
// every one records how it was obtained so a derived number can never be
// mistaken for a reported one.
//
// Everything is measured on TRAILING TWELVE MONTHS rather than on single
// quarters, for the reason the valuation engine already learned the hard way:
// a business whose December quarter is twice its September one reads as
// compounding furiously on raw quarters and as dying on the next step. Summing
// the year first removes the season and leaves the trend.
// ═══════════════════════════════════════════════════════════════════════════
interface DerivedInputs {
  salesY: number | null;
  cfoNi: number | null;
  opmDelta: number | null;
  opm: number | null;
  fcf: number | null;
  fcfPrev: number | null;
  /** Which of these did not come from the engine, and how they were obtained.
   *  Printed on the card — a derived margin is not a reported one. */
  derived: string[];
  /** True when the margin below is a GROSS margin because no operating-income
   *  line was filed. A different thing, said so rather than blended in. */
  marginIsGross: boolean;
  /** Cash conversion is UNDEFINED, not unknown: the company lost money over
   *  the trailing twelve months, so there is no net income to convert into.
   *  Treating that as a missing input made every loss-making company
   *  unclassifiable — which is the opposite of the truth, because a loss is
   *  one of the most informative things a filing can say. */
  cfoNiNotApplicable: boolean;
  /** Trailing-twelve-month net income and operating income, where filed. */
  ttmNetIncome: number | null;
  ttmOperatingIncome: number | null;
}

const seriesOf = (e: UsConvictionEntry, k: string): number[] => {
  const raw = (e.series as any)?.[k];
  return Array.isArray(raw) ? raw.map(fin).filter((x): x is number => x != null) : [];
};
/** Sum of the four periods ending `endExclusive`. */
const ttmAt = (v: number[], endExclusive: number): number | null =>
  endExclusive >= 4 && endExclusive <= v.length
    ? v.slice(endExclusive - 4, endExclusive).reduce((a, b) => a + b, 0)
    : null;

function derivedInputs(e: UsConvictionEntry): DerivedInputs {
  const out: DerivedInputs = {
    salesY: fin(e.sales_yoy_pct),
    cfoNi: fin(e.cfo_to_pat_ratio),
    opm: fin(e.opm_pct),
    opmDelta: null,
    fcf: fin(e.fcf_curr_musd),
    fcfPrev: fin(e.fcf_prev_musd),
    derived: [],
    marginIsGross: false,
    cfoNiNotApplicable: false,
    ttmNetIncome: null,
    ttmOperatingIncome: null,
  };
  const opmRep = fin(e.opm_pct), opmPrevRep = fin(e.opm_prev_pct);
  if (opmRep != null && opmPrevRep != null) out.opmDelta = opmRep - opmPrevRep;

  const rev = seriesOf(e, 'revenue');
  const ni = seriesOf(e, 'net_income');
  const cfo = seriesOf(e, 'cfo');
  const fcfS = seriesOf(e, 'fcf');
  const oi = seriesOf(e, 'operating_income');
  const gp = seriesOf(e, 'gross_profit');

  // ── revenue growth, year on year, on trailing years ──────────────────────
  if (out.salesY == null && rev.length >= 8) {
    const now = ttmAt(rev, rev.length), prev = ttmAt(rev, rev.length - 4);
    if (now != null && prev != null && prev > 0) {
      out.salesY = +(((now / prev) - 1) * 100).toFixed(1);
      out.derived.push(`Revenue growth ${out.salesY >= 0 ? '+' : ''}${out.salesY.toFixed(0)}% computed from the filed revenue series (trailing twelve months against the prior twelve), because the engine carried no year-over-year figure.`);
    }
  }

  // ── cash conversion ──────────────────────────────────────────────────────
  out.ttmNetIncome = ni.length >= 4 ? ttmAt(ni, ni.length) : null;
  out.ttmOperatingIncome = oi.length >= 4 ? ttmAt(oi, oi.length) : null;
  if (out.cfoNi == null && cfo.length >= 4 && ni.length >= 4) {
    const c = ttmAt(cfo, cfo.length), n = out.ttmNetIncome;
    if (c != null && n != null && n > 0) {
      out.cfoNi = +(c / n).toFixed(2);
      out.derived.push(`Cash conversion ${out.cfoNi.toFixed(2)}× computed from the filed cash-flow and net-income series over the trailing twelve months, because the engine carried no ratio.`);
    } else if (n != null && n <= 0) {
      // NOT MISSING — UNDEFINED, and the difference decides whether the
      // company can be judged at all. Dividing cash flow by a loss produces a
      // number with no meaning, so none is produced; but the loss itself is a
      // fact we hold, and the classifier is entitled to use it.
      out.cfoNiNotApplicable = true;
      out.derived.push(`Cash conversion cannot be stated: the company lost money over the trailing twelve months (${n.toFixed(0)}), and cash flow against a loss is not a ratio. This is a known fact about the business, not a gap in the data.`);
    }
  }

  // ── margin, and its change ───────────────────────────────────────────────
  // Operating income where it was filed; gross profit only when it was not,
  // and never silently — a gross margin moves for different reasons and the
  // card says which one it is looking at.
  if (out.opmDelta == null && rev.length >= 8) {
    const useOi = oi.length >= 8;
    const prof = useOi ? oi : gp;
    if (prof.length >= 8) {
      const n = Math.min(prof.length, rev.length);
      const pNow = ttmAt(prof, n), rNow = ttmAt(rev, n);
      const pPrev = ttmAt(prof, n - 4), rPrev = ttmAt(rev, n - 4);
      if (pNow != null && rNow != null && rNow > 0 && pPrev != null && rPrev != null && rPrev > 0) {
        const mNow = (pNow / rNow) * 100, mPrev = (pPrev / rPrev) * 100;
        out.opm = out.opm ?? +mNow.toFixed(1);
        out.opmDelta = +(mNow - mPrev).toFixed(1);
        out.marginIsGross = !useOi;
        out.derived.push(`${useOi ? 'Operating' : 'Gross'} margin ${mNow.toFixed(1)}% against ${mPrev.toFixed(1)}% a year ago, computed from the filed ${useOi ? 'operating-income' : 'gross-profit'} and revenue series, because the engine carried no margin${useOi ? '' : '. No operating-income line was filed, so this is a GROSS margin — it moves with mix and input costs, not with operating leverage'}.`);
      }
    }
  }

  // ── free cash flow ───────────────────────────────────────────────────────
  if (out.fcf == null && fcfS.length >= 4) {
    const f = ttmAt(fcfS, fcfS.length);
    if (f != null) {
      out.fcf = +f.toFixed(1);
      out.derived.push(`Free cash flow ${out.fcf.toFixed(0)} over the trailing twelve months, summed from the filed series, because the engine carried no quarterly figure.`);
    }
  }
  if (out.fcfPrev == null && fcfS.length >= 8) {
    const f = ttmAt(fcfS, fcfS.length - 4);
    if (f != null) out.fcfPrev = +f.toFixed(1);
  }
  return out;
}

export function bucketFor(e: UsConvictionEntry): BucketVerdict {
  const reasons: string[] = [];
  const against: string[] = [];

  // Engine scalars where they exist, the filed series where they do not.
  const D = derivedInputs(e);
  const salesY = D.salesY;
  const epsY = fin(e.eps_yoy_pct) ?? fin(e.eps_adj_yoy_pct);
  const cfoNi = D.cfoNi;
  const fcf = D.fcf;
  const fcfPrev = D.fcfPrev;
  const opmDelta = D.opmDelta;
  const opm = D.opm;
  const opmPrev = (D.opm != null && D.opmDelta != null) ? +(D.opm - D.opmDelta).toFixed(1) : null;
  // A gross margin is not an operating margin, and the sentences below say
  // "operating". Where the figure had to come from gross profit the noun is
  // corrected at the point of use rather than the reader being left to guess.
  const marginNoun = D.marginIsGross ? 'Gross margin' : 'Operating margin';
  // Every derived figure is disclosed on the card next to the verdict it
  // helped reach, so nobody reads a computed margin as a reported one.
  if (D.derived.length) against.push(...D.derived.map((d) => `Derived, not reported — ${d}`));
  const caveats = (e.caveat_tags || []).map((c) => String(c).toLowerCase());
  const has = (frag: string) => caveats.some((c) => c.includes(frag));
  const growth = growthEvidenceOf(e);
  const pctile = opmPercentile(e);
  const decel = revenueDecelerating(e);

  // ── E · EARNINGS TRAP ───────────────────────────────────────────────────
  // Checked first because it disqualifies. The test is not "did EPS grow" but
  // "did anything real grow with it".
  {
    const r: string[] = [];
    if (cfoNi != null && cfoNi < 0.7) r.push(`Cash conversion is ${cfoNi.toFixed(2)}× net income — the earnings are not turning into cash.`);
    if (has('optical eps')) r.push('The engine flagged the EPS as optical — the growth rate overstates what actually happened.');
    if (has('gaap above adjusted')) r.push('GAAP EPS sits above the adjusted figure, which usually means a one-off is inside the headline number.');
    if (salesY != null && salesY < 2 && epsY != null && epsY > 40) r.push(`Revenue is ${salesY.toFixed(0)}% while EPS is ${epsY.toFixed(0)}% — the profit came from something other than selling more.`);
    if (fcf != null && fcfPrev != null && fcf < 0 && fcfPrev >= 0) r.push('Free cash flow has turned negative against a positive year-ago quarter.');
    if (r.length >= 2) {
      if (salesY != null && salesY >= 15) against.push(`Revenue is still growing ${salesY.toFixed(0)}%.`);
      if (opmDelta != null && opmDelta > 0) against.push(`Operating margin still expanded ${opmDelta.toFixed(1)}pp.`);
      return { bucket: 'E', reasons: r, against };
    }
    // One flag on its own is a caution, not a verdict — carried forward.
    against.push(...r);
  }

  // ── D · CYCLICAL PEAK ───────────────────────────────────────────────────
  // Margins at the top of their own history, growth slowing, and often the
  // company's own guide already saying so.
  {
    const r: string[] = [];
    if (pctile != null && pctile >= 85) r.push(`Operating margin is at the ${pctile}th percentile of its own filed history — there is little room above it.`);
    if (decel === true) r.push('Revenue growth is slower than it was a year ago.');
    if (has('guidance cut') || e.guidance === 'LOWERED') r.push('Management has cut its own outlook.');
    if (has('peak') || has('commodity')) r.push('The engine flagged cycle or commodity exposure on this print.');
    if (r.length >= 2) {
      if (growth.seriesCagr != null && growth.seriesCagr >= 20) against.push(`Earnings have still compounded ${growth.seriesCagr.toFixed(0)}%/yr across the filed series.`);
      return { bucket: 'D', reasons: r, against };
    }
    against.push(...r);
  }

  // ── A · STRUCTURAL COMPOUNDER ───────────────────────────────────────────
  // The four legs of the CURRENT quarter decide it: revenue growing, margin
  // expanding, earnings converting to cash, free cash flow positive.
  //
  // DURABILITY IS A MODIFIER, NOT A FIFTH GATE. Requiring a 10%/yr compound
  // rate as a hard condition was brittle and wrong: NetApp and WisdomTree
  // passed all four legs — revenue +30% and +57%, margins +4pp and +10pp,
  // cash conversion 1.34× and 1.71× — and fell through to "not classifiable"
  // because their filed series does not yet compound at that rate. That is
  // something to SAY about an A, not a reason to refuse to call it one.
  {
    const legs: string[] = [];
    let ok = true;
    if (salesY != null && salesY >= 15) legs.push(`Revenue +${salesY.toFixed(0)}%.`); else ok = false;
    if (opmDelta != null && opmDelta >= 0) legs.push(`Operating margin ${opmDelta >= 0 ? '+' : ''}${opmDelta.toFixed(1)}pp.`); else ok = false;
    if (cfoNi != null && cfoNi >= 1) legs.push(`Cash conversion ${cfoNi.toFixed(2)}× net income.`); else ok = false;
    if (fcf != null && fcf > 0) legs.push('Free cash flow positive.'); else ok = false;
    if (ok) {
      if (growth.seriesCagr != null && growth.seriesCagr >= 10) {
        legs.push(`And it is durable: earnings compounding ${growth.seriesCagr.toFixed(0)}%/yr across the filed series, not just this quarter.`);
      } else if (growth.seriesCagr != null) {
        against.push(`The quarter is compounder-shaped, but the filed series only compounds at ${growth.seriesCagr.toFixed(0)}%/yr — the durability is not there yet.`);
      } else {
        against.push('Not enough filed history to say whether this compounds or simply had a good year.');
      }
      return { bucket: 'A', reasons: legs, against };
    }
    reasons.push(...legs);
  }

  // ── B · EARNINGS INFLECTION ─────────────────────────────────────────────
  // The shape changed. A loss became a profit, or a thin margin became a real
  // one — and it is the YEAR that changed, not one quarter inside it.
  {
    const r: string[] = [];
    if (opmDelta != null && opmDelta >= 4) r.push(`${marginNoun} expanded ${opmDelta.toFixed(1)}pp year over year — a step change, not a drift.`);
    if (opmPrev != null && opmPrev < 5 && opm != null && opm >= 8) r.push(`${marginNoun} went from ${opmPrev.toFixed(1)}% to ${opm.toFixed(1)}% — a different business at the ${D.marginIsGross ? 'gross' : 'operating'} line.`);
    if (String(e.eps_swing || '') === 'loss-to-profit' || String(e.net_income_swing || '') === 'loss-to-profit') r.push('Swung from a loss to a profit.');
    if (growth.trend === 'accelerating') r.push('The growth rate itself is accelerating, measured on rolling twelve-month periods.');
    // ONE STRONG SIGNAL IS ENOUGH HERE. Demanding two meant a company whose
    // operating margin stepped up ten points in a year — which is a different
    // business at the operating line, and unambiguous — was refused the
    // bucket because nothing else happened to coincide with it.
    const strong = (opmDelta != null && opmDelta >= 5)
      || (opmPrev != null && opmPrev < 5 && opm != null && opm >= 8)
      || String(e.eps_swing || '') === 'loss-to-profit'
      || String(e.net_income_swing || '') === 'loss-to-profit';
    if (r.length >= 2 || (strong && r.length >= 1)) {
      if (cfoNi != null && cfoNi < 1) against.push(`Cash conversion is only ${cfoNi.toFixed(2)}× — the inflection has not reached cash yet.`);
      if (growth.seriesCagr == null) against.push('Too little filed history to say whether this holds.');
      return { bucket: 'B', reasons: r, against };
    }
    reasons.push(...r);
  }

  // ── C · RE-RATING CANDIDATE ─────────────────────────────────────────────
  // Improving, and cheap relative to its own improvement. This is the only
  // bucket where the MULTIPLE is the argument, so it is stated as a multiple.
  {
    const val = ttmEpsOf(e);
    const price = fin(e.price);
    const mult = (val && val.value > 0 && price) ? price / val.value : null;
    const durable = growth.seriesCagr;
    const r: string[] = [];
    const improving = (salesY != null && salesY >= 8) || (opmDelta != null && opmDelta >= 1);
    if (improving && mult != null && durable != null && durable > 0 && mult < durable) {
      r.push(`Trading at ${mult.toFixed(1)}× trailing earnings against ${durable.toFixed(0)}%/yr compound earnings growth — the multiple is below the growth rate.`);
    }
    const offHigh = fin(e.pct_from_52w_high);
    // "IT HAS FALLEN A LONG WAY" IS NOT THE SAME AS "IT IS CHEAP". A name
    // twenty percent off its high can still be at forty times earnings on a
    // three-percent compound rate, and calling that a re-rating candidate is
    // how a reader buys an expensive stock because it used to be more
    // expensive. The drawdown route therefore requires that the multiple is
    // not plainly rich against what the business actually compounds at.
    const richAnyway = mult != null && mult > 35 && (durable == null || durable < mult / 2);
    if (improving && offHigh != null && offHigh <= -20 && !richAnyway) {
      r.push(`${Math.abs(offHigh).toFixed(0)}% below its 52-week high while the numbers are still improving.`);
    } else if (improving && offHigh != null && offHigh <= -20 && richAnyway) {
      against.push(`${Math.abs(offHigh).toFixed(0)}% off its high, but still ${mult!.toFixed(0)}× earnings${durable != null ? ` on ${durable.toFixed(0)}%/yr compound growth` : ''} — it has fallen, it is not cheap.`);
    }
    if (has('market rejected print') || has('sold off')) r.push('The market sold the print — an expectations gap the filing does not support.');
    if (r.length >= 1 && improving) {
      if (cfoNi != null && cfoNi < 0.8) against.push(`Cash conversion ${cfoNi.toFixed(2)}× — cheap for a reason is a real possibility here.`);
      return { bucket: 'C', reasons: r, against };
    }
  }

  // ── F vs ? · A CONCLUSION, OR AN ABSENCE OF ONE ─────────────────────────
  // If the inputs were there and nothing qualified, that IS the verdict: a
  // real quarter with nothing in it that compounds. If the inputs were not
  // there, say that instead — the two must never be reported as one thing.
  //
  // zzz648 — THE GATE COUNTS WHAT IS KNOWN, NOT WHAT IS POPULATED. It used to
  // demand three of four non-null scalars, which failed two different ways:
  // a company with sixteen filed quarters whose scalars XBRL never tagged, and
  // a LOSS-MAKING company, whose cash-conversion ratio is undefined by
  // definition and was therefore counted as an absence. A trailing-twelve-month
  // loss is one of the most informative things a filing can state; it should
  // never be the reason a company cannot be judged.
  const known = [salesY, cfoNi, opmDelta, fcf].filter((x) => x != null).length
    + (D.cfoNiNotApplicable ? 1 : 0);
  const enoughHistory = growth.seriesCagr != null || ((e.series as any)?.eps?.length ?? 0) >= 6;
  const haveInputs = known >= 3 && enoughHistory;
  if (haveInputs) {
    const lossMaking = (D.ttmNetIncome != null && D.ttmNetIncome <= 0)
      || (D.ttmOperatingIncome != null && D.ttmOperatingIncome <= 0);
    return {
      bucket: 'F',
      reasons: reasons.length ? reasons
        : lossMaking
          ? [`No multibagger case here yet, and the reason is specific: the company is still loss-making over the trailing twelve months${D.ttmOperatingIncome != null ? ` (operating income ${D.ttmOperatingIncome.toFixed(0)})` : ''}${opmDelta != null ? `, with the margin ${opmDelta >= 0 ? `improving ${opmDelta.toFixed(1)}pp` : `deteriorating ${Math.abs(opmDelta).toFixed(1)}pp`} year over year` : ''}. That is a turnaround to watch for, not a compounder to own — the inflection bucket above is where it would land once the shape actually changes.`]
          : ['The print holds up, but nothing here argues for a multibagger: growth, margin, cash conversion and valuation are all ordinary.'],
      against,
    };
  }
  return {
    bucket: '?',
    // SAY WHICH ONE IS MISSING. "Not enough data" is the least useful thing a
    // classifier can print; the reader wants to know whether to wait a quarter
    // or go and look at the filing themselves.
    reasons: [(() => {
      const q = ((e.series as any)?.eps ?? []).filter((x: any) => x != null).length;
      if (!enoughHistory) return `Only ${q} filed quarter${q === 1 ? '' : 's'} of earnings on this entry — fewer than the six needed to say anything about a trend. This is a timing gap, not a judgement: it becomes classifiable on its own as the filings accumulate.`;
      const missing = [
        salesY == null ? 'revenue growth' : null,
        (cfoNi == null && !D.cfoNiNotApplicable) ? 'cash conversion' : null,
        opmDelta == null ? 'margin change' : null,
        fcf == null ? 'free cash flow' : null,
      ].filter(Boolean);
      return `${q} filed quarters are on this entry, but ${missing.join(', ')} could not be obtained from them or from the engine — too little to place this honestly. The filing itself will have the figure; the grader did not capture it.`;
    })()],
    against,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 2. MANAGEMENT — PROMISE AGAINST DELIVERY
//
// "Good management" is not a score anybody can assign from a filing. What CAN
// be checked, exactly, is whether the company hit the numbers it published
// itself: the engine already stores each guided metric next to what was
// actually delivered. So this counts, and refuses to characterise.
//
// One quarter is not a record. It says so.
// ─────────────────────────────────────────────────────────────────────────

export interface MgmtRecord {
  quarters: number;
  beat: number;
  inLine: number;
  missed: number;
  raises: number;
  cuts: number;
  /** null when there is not enough to judge — never a made-up score. */
  hitRate: number | null;
  verdict: string;
  detail: string[];
  thin: boolean;
}

export function managementRecord(entries: UsConvictionEntry[]): MgmtRecord {
  let beat = 0, inLine = 0, missed = 0, raises = 0, cuts = 0;
  const detail: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const g = e.vs_guide;
    const items = [...(g?.for_quarter || []), ...(g?.for_year || [])];
    for (const it of items) {
      const v = it?.compare?.verdict;
      if (!v) continue;
      const key = `${e.filing_date}|${it.metric}|${it.period}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (v === 'beat') beat++; else if (v === 'missed') missed++; else inLine++;
      if (it.compare?.text) detail.push(`${e.filing_date} · ${it.metric}: ${it.compare.text}`);
    }
    for (const c of (e.guide_change || [])) {
      if (c.direction === 'raised') raises++;
      else if (c.direction === 'lowered') cuts++;
    }
  }
  const graded = beat + inLine + missed;
  const quarters = new Set(entries.map((e) => e.filing_date)).size;
  const thin = graded < 3;
  const hitRate = graded >= 3 ? Math.round(((beat + inLine) / graded) * 100) : null;
  let verdict: string;
  if (!graded) {
    verdict = 'No guided metric on file has come due yet — there is nothing to mark them against.';
  } else if (thin) {
    verdict = `Only ${graded} guided metric${graded > 1 ? 's' : ''} on file across ${quarters} quarter${quarters > 1 ? 's' : ''}. That is an observation, not a record — treat it as such.`;
  } else {
    verdict = `Hit or beat its own guidance on ${beat + inLine} of ${graded} guided metrics (${hitRate}%)${missed ? `, missed ${missed}` : ''}${raises || cuts ? ` · raised the outlook ${raises}×, cut it ${cuts}×` : ''}.`;
  }
  return { quarters, beat, inLine, missed, raises, cuts, hitRate, verdict, detail: detail.slice(0, 8), thin };
}

// ─────────────────────────────────────────────────────────────────────────
// 3. THE BOTTLENECK
//
// The difference between "this company had a good quarter" and "this company
// sits on a procurement basket somebody has no choice but to fill". The
// Bottleneck Intelligence tab already holds the quantified chains; it was
// simply never connected to the bench.
//
// Two strengths of link, and they are NOT presented as equivalent:
//   · NAMED — the ticker is on that chain's proxy list, curated by hand.
//   · VIA THEME — the name sits in a rotation theme this chain runs through.
//     Weaker, circumstantial, and labelled as such. A reader must be able to
//     tell an argument from a coincidence.
// ─────────────────────────────────────────────────────────────────────────

const CHAIN_THEMES: Record<string, string[]> = {
  POWER_GRID_TRANSFORMERS: ['us-datacenter', 'us-infra', 'us-utilities', 'in-power', 'in-capgoods'],
  AI_COMPUTE_HBM_COWOS: ['us-memory', 'us-semis', 'us-ai-hardware', 'us-photonics'],
  AI_DATA_CENTER_COOLING: ['us-datacenter'],
  NUCLEAR_SMR: ['us-nuclear'],
  DEFENSE_AEROSPACE: ['us-defense', 'us-drones', 'in-defence'],
  CRITICAL_MINERALS_RARE_EARTH: ['us-critminerals', 'us-copper', 'us-battery'],
  PHARMA_API_CHINA_PLUS_ONE: ['in-pharma', 'in-chemicals'],
  ELECTRONICS_MANUFACTURING_PLI: ['in-ems'],
};

export interface BottleneckLink {
  themeId: string;
  label: string;
  link: 'named' | 'theme';
  exposure: string | null;
  thesis: string | null;
  /** The quantified constraint — why supply cannot simply catch up. */
  metric: string | null;
  metricDetail: string | null;
  /** What would end it, so the reader knows what to watch. */
  counter: string | null;
}

const NAMED_INDEX: Map<string, { themeId: string; exposure: string; thesis: string }> = (() => {
  const m = new Map<string, { themeId: string; exposure: string; thesis: string }>();
  for (const t of (BOTTLENECK_THEMES as any[])) {
    for (const p of (t.inProxies || [])) {
      const k = String(p.ticker || '').toUpperCase();
      if (k && !m.has(k)) m.set(k, { themeId: t.themeId, exposure: String(p.exposure || ''), thesis: String(p.thesis || '') });
    }
    for (const p of (t.globalProxies || [])) {
      const k = String(p.ticker || '').toUpperCase();
      if (k && !m.has(k)) m.set(k, { themeId: t.themeId, exposure: 'GLOBAL', thesis: String(p.thesis || '') });
    }
  }
  return m;
})();

export function bottleneckFor(ticker: string, themeId?: string | null): BottleneckLink | null {
  const t = String(ticker || '').toUpperCase().replace(/\.(NS|BO)$/, '');
  const named = NAMED_INDEX.get(t);
  const chainId = named?.themeId
    ?? (themeId ? Object.keys(CHAIN_THEMES).find((k) => CHAIN_THEMES[k].includes(themeId)) : undefined);
  if (!chainId) return null;
  const chain = (BOTTLENECK_THEMES as any[]).find((x) => x.themeId === chainId);
  if (!chain) return null;
  const q = (chain.quant || [])[0];
  const c = (chain.counter || [])[0];
  return {
    themeId: chainId,
    label: chain.label,
    link: named ? 'named' : 'theme',
    exposure: named?.exposure ?? null,
    thesis: named?.thesis ?? null,
    metric: q ? `${q.metric}: ${q.current}${q.baseline ? ` (was ${q.baseline})` : ''}` : null,
    metricDetail: q?.derivedImpact ?? null,
    counter: c ? `${c.risk} — watch for: ${c.trigger}` : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 4. THE FUNNEL
//
// His process is a staircase, and the bench only ever showed the top step.
// Each stage is a filter with a stated test, and the count that survives it —
// so a reader can see WHERE the field collapsed, which is the information a
// ranked list cannot give.
// ─────────────────────────────────────────────────────────────────────────

export interface FunnelStage {
  key: string;
  label: string;
  test: string;
  survivors: string[];       // bench keys
  dropped: number;
}

export function buildFunnel(
  entries: UsConvictionEntry[],
  ctx: { themeOf?: (t: string) => string | null | undefined } = {},
): { stages: FunnelStage[]; bucketOf: Map<string, BucketVerdict> } {
  const keyOf = (e: UsConvictionEntry) => `${e.ticker}|${e.filing_date}`;
  const bucketOf = new Map<string, BucketVerdict>();
  for (const e of entries) bucketOf.set(keyOf(e), bucketFor(e));

  const stages: FunnelStage[] = [];
  const push = (key: string, label: string, test: string, keep: UsConvictionEntry[], prevCount: number) => {
    stages.push({ key, label, test, survivors: keep.map(keyOf), dropped: Math.max(0, prevCount - keep.length) });
  };

  const s0 = entries;
  push('all', 'On the bench', 'Everything the engine graded BLOCKBUSTER or STRONG in the window.', s0, s0.length);

  // 1 — clean earnings: nothing in the trap bucket, cash follows profit.
  const s1 = s0.filter((e) => {
    const b = bucketOf.get(keyOf(e))!.bucket;
    return b !== 'E';
  });
  push('clean', 'Clean earnings', 'Drops the earnings traps — cash not following profit, or one-offs doing the work.', s1, s0.length);

  // 2 — durable rather than peak.
  const s2 = s1.filter((e) => bucketOf.get(keyOf(e))!.bucket !== 'D');
  push('durable', 'Not a cycle peak', 'Drops names whose margins sit at the top of their own range with growth already slowing.', s2, s1.length);

  // 3 — in the hunting ground: A, B or C.
  const s3 = s2.filter((e) => BUCKET_META[bucketOf.get(keyOf(e))!.bucket].hunting);
  push('hunting', 'Structural, inflecting or re-rating', 'Keeps only buckets A, B and C — the three that can actually compound.', s3, s2.length);

  // 4 — sitting on a bottleneck.
  const s4 = s3.filter((e) => !!bottleneckFor(e.ticker, ctx.themeOf?.(e.ticker) ?? null));
  push('bottleneck', 'On a bottleneck chain', 'Keeps names sitting on a supply constraint somebody has to pay to relieve.', s4, s3.length);

  // 5 — management has done what it said.
  const byTicker = new Map<string, UsConvictionEntry[]>();
  for (const e of entries) {
    if (!byTicker.has(e.ticker)) byTicker.set(e.ticker, []);
    byTicker.get(e.ticker)!.push(e);
  }
  const s5 = s4.filter((e) => {
    const m = managementRecord(byTicker.get(e.ticker) || [e]);
    return m.hitRate == null ? true : m.hitRate >= 60;   // unproven is not disproven
  });
  push('management', 'Management delivers', 'Drops names that have missed their own published guidance more often than they hit it. Names with no record yet are kept, and flagged.', s5, s4.length);

  return { stages, bucketOf };
}

// ═══════════════════════════════════════════════════════════════════════════
// WHAT IT IS WORTH  (zzz628)
//
// The bench answers "is this a good business, and is it inflecting". It has
// never answered the question that follows and decides the trade: what would
// have to be true for the price to be much higher, and has this company ever
// done that?
//
// Three things were missing and they are one piece of arithmetic asked three
// ways — the re-rating identity, the three scenarios, and the 3× score:
//
//     price  =  EPS  ×  multiple
//
// Everything below is that identity, made explicit. A stock goes up because
// earnings grow, because the multiple expands, or both; separating the two is
// the difference between "it went up 40%" and "it went up 40% and 34 points of
// that was multiple, which is borrowed, not earned".
//
// THE RULES THIS FILE OBEYS
//
//   1. Nothing is invented. Every growth rate used is one the company has
//      ACTUALLY PRINTED, computed from the filed quarterly series on the
//      entry, and every scenario names the number it used. There is no
//      consensus estimate here, no analyst target, and no model opinion.
//   2. The multiple is the READER'S input. It is the one number arithmetic
//      cannot supply — it is a judgement about what the market will pay — so
//      it is defaulted from the company's own current multiple, clearly marked
//      as an assumption, and meant to be changed. Machines calculate, you
//      decide, and this is the line between the two.
//   3. Missing data returns null and says which input was missing. A valuation
//      built on a guessed denominator is worse than no valuation.
//
// Pure functions, no fetch, no storage — everything it needs is already on a
// bench entry, so this runs client-side with no new round-trip.
// ═══════════════════════════════════════════════════════════════════════════

import type { UsConvictionEntry } from './conviction-beats-us';

const fin = (v: any): number | null =>
  (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export interface TtmEps {
  value: number;
  quarters: number;
  /** The per-quarter figures summed, so the reader can check the arithmetic. */
  parts: number[];
  note: string;
}

/**
 * Trailing-twelve-month EPS from the filed quarterly series.
 *
 * Summed, never annualised from one quarter — annualising a single quarter is
 * how a seasonal business gets valued at four times its best three months.
 * Fewer than four quarters returns null rather than a partial year dressed up
 * as one.
 */
export function ttmEpsOf(e: UsConvictionEntry): TtmEps | null {
  const raw: Array<number | null> =
    (e.series && Array.isArray((e.series as any).eps) ? (e.series as any).eps : null)
    ?? (Array.isArray(e.quarters_eps) ? e.quarters_eps : null)
    ?? [];
  const vals = raw.map(fin).filter((v): v is number => v != null);
  if (vals.length < 4) return null;
  const parts = vals.slice(-4);
  const value = parts.reduce((a, b) => a + b, 0);
  return {
    value: +value.toFixed(4),
    quarters: 4,
    parts: parts.map((p) => +p.toFixed(2)),
    note: `Sum of the last four filed quarters (${parts.map((p) => p.toFixed(2)).join(' + ')}), not one quarter annualised.`,
  };
}

/** Compound annual growth between the first and last of a series of levels. */
function cagrOf(vals: number[], periodsPerYear: number): number | null {
  const v = vals.filter((x) => Number.isFinite(x));
  if (v.length < 3) return null;
  const first = v[0], last = v[v.length - 1];
  // A negative or zero base makes a growth rate meaningless, not infinite.
  if (!(first > 0) || !(last > 0)) return null;
  const years = (v.length - 1) / periodsPerYear;
  if (!(years > 0)) return null;
  return +(((last / first) ** (1 / years) - 1) * 100).toFixed(1);
}

export interface GrowthEvidence {
  /** Latest year-over-year EPS growth, as the engine graded it. */
  yoy: number | null;
  /** Compound growth across the whole filed EPS series — the durable rate. */
  seriesCagr: number | null;
  /** Revenue growth, which is the sturdier of the two and caps the optimism. */
  salesYoy: number | null;
  /** Is the growth itself getting faster, slower, or steady? */
  trend: 'accelerating' | 'decelerating' | 'steady' | null;
  note: string;
}

export function growthEvidenceOf(e: UsConvictionEntry): GrowthEvidence {
  const eps: number[] = (((e.series as any)?.eps ?? e.quarters_eps ?? []) as Array<number | null>)
    .map(fin).filter((v): v is number => v != null);
  // COMPOUND GROWTH IS MEASURED ON ROLLING YEARS, NOT ON RAW QUARTERS.
  // Chaining quarter-to-quarter puts seasonality straight into the growth
  // rate: a business whose December quarter is twice its September one reads
  // as compounding furiously, and one with the opposite shape reads as dying.
  // Summing trailing years first removes the season and leaves the trend.
  let seriesCagr: number | null = null;
  if (eps.length >= 8) {
    const ttms: number[] = [];
    for (let i = 3; i < eps.length; i++) ttms.push(eps.slice(i - 3, i + 1).reduce((a, b) => a + b, 0));
    seriesCagr = cagrOf(ttms, 4);
  }
  if (seriesCagr == null) seriesCagr = cagrOf(eps, 4);
  const yoy = fin(e.eps_yoy_pct) ?? fin(e.eps_adj_yoy_pct);
  const salesYoy = fin(e.sales_yoy_pct);

  // Acceleration, judged on the growth RATE rather than the level: the last
  // year-over-year step against the one before it.
  let trend: GrowthEvidence['trend'] = null;
  if (eps.length >= 8) {
    const ttmNow = eps.slice(-4).reduce((a, b) => a + b, 0);
    const ttmPrev = eps.slice(-8, -4).reduce((a, b) => a + b, 0);
    const ttmPrev2 = eps.length >= 12 ? eps.slice(-12, -8).reduce((a, b) => a + b, 0) : null;
    const g1 = ttmPrev > 0 ? ttmNow / ttmPrev - 1 : null;
    const g0 = (ttmPrev2 != null && ttmPrev2 > 0) ? ttmPrev / ttmPrev2 - 1 : null;
    if (g1 != null && g0 != null) {
      trend = g1 - g0 >= 0.05 ? 'accelerating' : g1 - g0 <= -0.05 ? 'decelerating' : 'steady';
    }
  }
  const bits: string[] = [];
  if (yoy != null) bits.push(`${yoy >= 0 ? '+' : ''}${yoy.toFixed(0)}% EPS YoY this quarter`);
  if (seriesCagr != null) bits.push(`${seriesCagr >= 0 ? '+' : ''}${seriesCagr.toFixed(0)}%/yr across the filed series`);
  if (salesYoy != null) bits.push(`revenue ${salesYoy >= 0 ? '+' : ''}${salesYoy.toFixed(0)}%`);
  if (trend) bits.push(`growth ${trend}`);
  return { yoy, seriesCagr, salesYoy, trend, note: bits.join(' · ') || 'no growth history on this entry' };
}

export interface Scenario {
  name: 'Bear' | 'Base' | 'Bull';
  /** Annual EPS growth assumed, and where the number came from. */
  growthPct: number;
  growthBasis: string;
  /** The multiple assumed, and where it came from. */
  multiple: number;
  multipleBasis: string;
  forwardEps: number;
  targetPrice: number;
  upsidePct: number | null;
  /** The split that matters: how much of the move is earnings, how much is the
   *  multiple. Multiple expansion is borrowed; earnings growth is earned. */
  fromEarningsPct: number | null;
  fromMultiplePct: number | null;
  color: string;
}

export interface Valuation {
  ttm: TtmEps;
  price: number;
  /** price ÷ TTM EPS, computed here rather than trusted from the feed. */
  currentMultiple: number;
  /** The multiple the feed carries, when it disagrees materially — a
   *  disagreement usually means the two are on different EPS bases. */
  feedMultiple: number | null;
  multipleDisagrees: boolean;
  growth: GrowthEvidence;
  horizonYears: number;
  scenarios: Scenario[];
  threeX: ThreeX;
}

export interface ThreeX {
  /** The EPS growth a 3× requires, given the multiple assumption below. */
  requiredGrowthPct: number;
  /** What the company has actually delivered, and on what basis. */
  deliveredGrowthPct: number | null;
  deliveredBasis: string;
  /** The multiple a 3× is priced at — the bull multiple, stated. */
  atMultiple: number;
  score: number;             // 0-100 plausibility
  verdict: string;
  /** The one sentence that is worth more than the score. */
  sentence: string;
  caveats: string[];
}

export interface ValuationOpts {
  horizonYears?: number;
  /** Reader overrides. Any left undefined fall back to the derived default. */
  bearMultiple?: number;
  baseMultiple?: number;
  bullMultiple?: number;
  bearGrowthPct?: number;
  baseGrowthPct?: number;
  bullGrowthPct?: number;
}

/**
 * The whole valuation for one bench entry, or null with a reason when the
 * inputs are not there.
 */
export function valuationFor(e: UsConvictionEntry, opts: ValuationOpts = {}):
  { ok: true; value: Valuation } | { ok: false; reason: string } {
  const price = fin(e.price);
  if (price == null || price <= 0) return { ok: false, reason: 'no price on this entry' };
  const ttm = ttmEpsOf(e);
  if (!ttm) return { ok: false, reason: 'fewer than four filed quarters of EPS — a trailing-twelve-month figure cannot be built without inventing one' };
  if (ttm.value <= 0) return { ok: false, reason: `trailing EPS is ${ttm.value.toFixed(2)} — a multiple on negative earnings is not a number, it is a shape` };

  const currentMultiple = +(price / ttm.value).toFixed(1);
  const feedMultiple = fin(e.pe);
  const multipleDisagrees = feedMultiple != null && feedMultiple > 0
    && Math.abs(feedMultiple - currentMultiple) / currentMultiple > 0.15;

  const growth = growthEvidenceOf(e);
  const horizonYears = clamp(opts.horizonYears ?? 3, 1, 10);

  // ── THE GROWTH ASSUMPTIONS, AND WHY EACH IS WHAT IT IS ─────────────────
  //
  // Bear is zero, always: the honest bear case for a grower is not a collapse,
  // it is that the growth simply stops — that is what actually happens to most
  // of them, and it is the scenario nobody models.
  //
  // Base takes the SLOWER of the two rates the company has printed (this
  // quarter's year-over-year, and the compound rate across its whole filed
  // series) and damps it, because a quarter is noise and a trend decays.
  // Revenue caps it: earnings cannot outgrow sales indefinitely, so a base case
  // above twice the revenue rate is pulled back to it.
  //
  // Bull is the faster of the two, damped less, and capped — no company
  // compounds at 80% for three years, and a model that lets it is a model that
  // will justify any price.
  // ── A SINGLE QUARTER MAY INFORM THE FORECAST. IT MAY NEVER SET IT. ────
  //
  // The first version of this took the FASTER of (this quarter's year-over-year,
  // the compound rate) as the bull case. Tested against live rows it produced
  // nonsense, and the same nonsense every time: HPE printed +405% EPS YoY off a
  // prior-year impairment, AVGO +215%, and both pinned at the 60% cap and
  // returned "+351% over three years" — as did every other name, because the cap
  // was doing all the work. A three-year compounding assumption taken from one
  // quarter's low base is exactly the fantasy this file exists not to produce.
  //
  // So the ANCHOR is the durable rate: compound growth measured across rolling
  // twelve-month periods. A lone quarter is used only when there is no series at
  // all, and is then capped at 25%/yr — hard — because three months cannot
  // support a three-year claim no matter how large the number is.
  //
  // Revenue caps both cases. Earnings can outgrow sales, but only by as much as
  // margins can expand, and margins cannot expand forever: ten points a year in
  // the base case, fifteen in the bull. Without that, a one-off margin quarter
  // compounds into a valuation.
  const durable = growth.seriesCagr;
  const oneQ = growth.yoy;
  const anchor = durable != null ? durable : (oneQ != null ? clamp(oneQ, -20, 25) : null);
  const anchorBasis = durable != null
    ? `compound EPS growth across rolling twelve-month periods (${durable.toFixed(0)}%/yr) — the durable rate, with seasonality removed`
    : oneQ != null
      ? `no multi-quarter history on this entry, so this quarter's ${oneQ.toFixed(0)}% year-over-year is all there is — capped hard at 25%/yr, because three months cannot support a three-year claim`
      : 'no printed growth rate on this entry';
  const salesFloorBase = growth.salesYoy != null ? Math.max(0, growth.salesYoy) + 10 : null;
  const salesFloorBull = growth.salesYoy != null ? Math.max(0, growth.salesYoy) + 15 : null;

  let baseG = anchor != null ? anchor * 0.6 : 0;
  let baseBasis = anchor != null
    ? `${anchorBasis}, damped 40% — trends decay`
    : 'no printed growth rate on this entry — base held flat';
  if (salesFloorBase != null && baseG > salesFloorBase) {
    baseG = salesFloorBase;
    baseBasis += `; capped at revenue growth (${growth.salesYoy!.toFixed(0)}%) plus 10pp of margin expansion a year`;
  }
  baseG = clamp(baseG, -20, 35);

  let bullG = anchor != null ? clamp(anchor, 0, 40) : 0;
  let bullBasis = anchor != null
    ? `${anchorBasis}, carried forward undamped and capped at 40%/yr`
    : 'no printed growth rate on this entry';
  if (salesFloorBull != null && bullG > salesFloorBull) {
    bullG = salesFloorBull;
    bullBasis += `; capped at revenue growth (${growth.salesYoy!.toFixed(0)}%) plus 15pp of margin expansion a year`;
  }
  if (bullG < baseG) bullG = baseG;

  // ── THE MULTIPLE ASSUMPTIONS ───────────────────────────────────────────
  // Anchored on what the market pays for this company TODAY, because that is
  // the only multiple we have evidence for. Bear de-rates it, bull re-rates it
  // — and the bull re-rating is only granted when the growth is actually
  // getting faster, which is the only thing that earns a higher multiple.
  const baseM = opts.baseMultiple ?? currentMultiple;
  const bearM = opts.bearMultiple ?? +Math.max(5, currentMultiple * 0.65).toFixed(1);
  const bullEarned = growth.trend === 'accelerating';
  const bullM = opts.bullMultiple ?? +(currentMultiple * (bullEarned ? 1.3 : 1.1)).toFixed(1);

  const mk = (
    name: Scenario['name'], g: number, gBasis: string, m: number, mBasis: string, color: string,
  ): Scenario => {
    const forwardEps = ttm.value * (1 + g / 100) ** horizonYears;
    const targetPrice = forwardEps * m;
    const upsidePct = +(((targetPrice - price) / price) * 100).toFixed(1);
    // Decomposition: hold the multiple flat to isolate the earnings half.
    const epsOnly = forwardEps * currentMultiple;
    const fromEarningsPct = +(((epsOnly - price) / price) * 100).toFixed(1);
    const fromMultiplePct = +(upsidePct - fromEarningsPct).toFixed(1);
    return {
      name, growthPct: +g.toFixed(1), growthBasis: gBasis,
      multiple: +m.toFixed(1), multipleBasis: mBasis,
      forwardEps: +forwardEps.toFixed(2), targetPrice: +targetPrice.toFixed(2),
      upsidePct, fromEarningsPct, fromMultiplePct, color,
    };
  };

  const scenarios: Scenario[] = [
    mk('Bear', opts.bearGrowthPct ?? 0,
      opts.bearGrowthPct != null ? 'your assumption' : 'growth stops — not a collapse, just the end of the run, which is what usually happens',
      bearM, opts.bearMultiple != null ? 'your assumption' : `today's ${currentMultiple.toFixed(1)}× de-rated 35%`,
      '#EF4444'),
    mk('Base', opts.baseGrowthPct ?? baseG,
      opts.baseGrowthPct != null ? 'your assumption' : baseBasis,
      baseM, opts.baseMultiple != null ? 'your assumption' : `today's multiple held — the market keeps paying what it pays now`,
      '#EAB308'),
    mk('Bull', opts.bullGrowthPct ?? bullG,
      opts.bullGrowthPct != null ? 'your assumption' : bullBasis,
      bullM, opts.bullMultiple != null ? 'your assumption'
        : bullEarned
          ? `today's ${currentMultiple.toFixed(1)}× re-rated 30% — granted because growth is ACCELERATING, which is the only thing that earns a higher multiple`
          : `today's ${currentMultiple.toFixed(1)}× re-rated 10% only — growth is not accelerating, so a big re-rating is not earned here`,
      '#22C55E'),
  ];

  // ── THE 3× SCORE ───────────────────────────────────────────────────────
  //
  // Not a rating. A feasibility test, and the sentence underneath it is worth
  // more than the number: to triple at a stated multiple, EPS must compound at
  // a stated rate, and either this company has done that or it has not.
  //
  //     3 × price = EPS·(1+g)^N × M_bull
  //  ⇒  (1+g)^N  = 3 · M_now / M_bull
  const requiredGrowthPct = +(((3 * currentMultiple / bullM) ** (1 / horizonYears) - 1) * 100).toFixed(1);
  // What it has delivered is the DURABLE rate where there is one, because a
  // single quarter cannot support a three-year claim.
  const deliveredGrowthPct = growth.seriesCagr ?? growth.yoy;
  const deliveredBasis = growth.seriesCagr != null
    ? 'compound EPS growth across every filed quarter on this entry'
    : growth.yoy != null ? 'this quarter\'s year-over-year growth (no longer series available)' : 'nothing on file';

  const caveats: string[] = [];
  if (growth.seriesCagr == null) caveats.push('Only one quarter of growth evidence — a three-year claim rests on a three-month number.');
  if (growth.trend === 'decelerating') caveats.push('Growth is decelerating. The required rate is compared against a rate that is already falling.');
  if (currentMultiple >= 60) caveats.push(`The multiple is already ${currentMultiple.toFixed(0)}×. Most of the re-rating has happened; from here the earnings have to do all the work.`);
  const fcf = fin(e.fcf_curr_musd);
  if (fcf != null && fcf < 0) caveats.push('Free cash flow is negative. Earnings that do not convert to cash rarely compound for three years.');
  if (multipleDisagrees) caveats.push(`The feed's P/E (${feedMultiple?.toFixed(1)}×) and the multiple computed here (${currentMultiple.toFixed(1)}×) differ — usually a GAAP-versus-adjusted EPS mismatch. Check which basis you want before leaning on either.`);

  let score = 50;
  if (deliveredGrowthPct != null) {
    // Every point of delivered growth above what is required is worth a point
    // and a half of plausibility, and the reverse.
    score = 50 + (deliveredGrowthPct - requiredGrowthPct) * 1.5;
  } else {
    score = 20;
  }
  if (growth.trend === 'accelerating') score += 8;
  if (growth.trend === 'decelerating') score -= 12;
  if (growth.seriesCagr == null) score -= 10;
  if (fcf != null && fcf < 0) score -= 10;
  if (currentMultiple >= 60) score -= 8;
  score = Math.round(clamp(score, 0, 100));

  const verdict = score >= 70 ? 'Plausible' : score >= 45 ? 'A stretch' : 'Not on this arithmetic';
  const sentence = deliveredGrowthPct != null
    ? `To 3× in ${horizonYears} years at ${bullM.toFixed(0)}× earnings, EPS must compound ${requiredGrowthPct.toFixed(0)}%/yr. It has compounded ${deliveredGrowthPct.toFixed(0)}%/yr — ${deliveredBasis}.`
    : `To 3× in ${horizonYears} years at ${bullM.toFixed(0)}× earnings, EPS must compound ${requiredGrowthPct.toFixed(0)}%/yr. There is no growth history on this entry to compare it against.`;

  return {
    ok: true,
    value: {
      ttm, price, currentMultiple, feedMultiple, multipleDisagrees,
      growth, horizonYears, scenarios,
      threeX: { requiredGrowthPct, deliveredGrowthPct, deliveredBasis, atMultiple: +bullM.toFixed(1), score, verdict, sentence, caveats },
    },
  };
}

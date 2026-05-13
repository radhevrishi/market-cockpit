// PATCH 0305 — Merger-arb spread math.
//
// Given an open-offer / tender / takeover event, compute the institutional
// arb metrics: gross spread, days-to-close, annualized IRR, and a tightness
// label. Pure function — no infra, no API calls. Consumers are the
// Special Situations cards and any other surface that shows OPEN_OFFER /
// TENDER / SCHEME_OF_ARRANGEMENT events.
//
// Inputs are the offer price (in INR or USD, the function doesn't care
// which as long as both prices share a currency), current spot price, and
// expected close date (ISO yyyy-mm-dd or a Date). Probability of deal
// completion is passed in separately so the caller can plug in their own
// estimate from deal-probability.ts (Patch 0306) — we DO NOT bake a
// probability assumption into the IRR math.
//
// Edge cases handled:
//  - offer below spot (negative spread / "bidder is underwater")
//  - past-due close date (zero days, annualization undefined)
//  - identical spot and offer (zero spread)
//  - invalid inputs return null so the caller can hide the chip.

export interface MergerArbInput {
  /** Per-share offer price from the bidder. */
  offerPrice: number;
  /** Current market spot price. */
  spotPrice: number;
  /** Expected close date — ISO string or Date. */
  expectedCloseDate: string | Date;
  /** Optional: probability of completion (0-1) to compute expected IRR. */
  probability?: number;
  /** Optional clock — for testing. Defaults to Date.now(). */
  nowMs?: number;
}

export interface MergerArbResult {
  /** Gross spread = offerPrice - spotPrice (in the same currency). */
  spreadAbs: number;
  /** Gross spread as % of spotPrice. */
  spreadPct: number;
  /** Days from now to expectedCloseDate. Negative if past-due. */
  daysToClose: number;
  /** Simple annualized return = spreadPct * (365 / daysToClose).
   *  null when daysToClose <= 0 (can't annualize a past-due deal). */
  annualizedIRR: number | null;
  /** Probability-weighted annualized return = annualizedIRR * probability.
   *  null when annualizedIRR is null OR probability is undefined. */
  expectedIRR: number | null;
  /** Tightness label — institutional shorthand. */
  tightness: 'NEGATIVE' | 'TIGHT' | 'NORMAL' | 'WIDE' | 'BLOWOUT';
  /** Color hint per tightness (semantic palette). */
  tightnessColor: string;
}

const TIGHTNESS_COLOR: Record<MergerArbResult['tightness'], string> = {
  NEGATIVE: '#EF4444', // bidder underwater — usually means deal at risk
  TIGHT:    '#10B981', // < 2% — market pricing high probability
  NORMAL:   '#22D3EE', // 2-5%
  WIDE:     '#F59E0B', // 5-10% — typical for regulatory uncertainty
  BLOWOUT:  '#A78BFA', // > 10% — market pricing real failure risk
};

function tightnessFor(spreadPct: number): MergerArbResult['tightness'] {
  if (spreadPct < 0) return 'NEGATIVE';
  if (spreadPct < 2) return 'TIGHT';
  if (spreadPct < 5) return 'NORMAL';
  if (spreadPct < 10) return 'WIDE';
  return 'BLOWOUT';
}

export function computeMergerArb(input: MergerArbInput): MergerArbResult | null {
  const { offerPrice, spotPrice, expectedCloseDate, probability, nowMs } = input;

  if (!Number.isFinite(offerPrice) || offerPrice <= 0) return null;
  if (!Number.isFinite(spotPrice) || spotPrice <= 0) return null;

  let closeMs: number;
  try {
    closeMs = expectedCloseDate instanceof Date
      ? expectedCloseDate.getTime()
      : new Date(expectedCloseDate).getTime();
  } catch { return null; }
  if (!Number.isFinite(closeMs)) return null;

  const now = nowMs ?? Date.now();
  const daysToClose = Math.round((closeMs - now) / 86_400_000);

  const spreadAbs = offerPrice - spotPrice;
  const spreadPct = (spreadAbs / spotPrice) * 100;

  let annualizedIRR: number | null = null;
  if (daysToClose > 0) {
    annualizedIRR = spreadPct * (365 / daysToClose);
  }

  let expectedIRR: number | null = null;
  if (annualizedIRR !== null && typeof probability === 'number' && Number.isFinite(probability)) {
    expectedIRR = annualizedIRR * Math.min(1, Math.max(0, probability));
  }

  const tightness = tightnessFor(spreadPct);

  return {
    spreadAbs,
    spreadPct,
    daysToClose,
    annualizedIRR,
    expectedIRR,
    tightness,
    tightnessColor: TIGHTNESS_COLOR[tightness],
  };
}

/** Format helper: spread / IRR with sign + 2 decimals. */
export function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

// zzz390 — Shared earnings-grade scoring constants.
//
// The per-quarter grader exists in TWO copies that must stay identical:
//   • server: src/app/api/v1/earnings/graded/route.ts  (authoritative)
//   • client: src/app/(dashboard)/earnings-opportunities/page.tsx  (gradeRow,
//             used by the force-include + client-join paths)
//
// Over this session those two copies repeatedly DRIFTED on exactly the pieces
// below — the caveat-penalty table and the OPM-expansion "margin ladder" — and
// each drift produced a real over-grading bug (zzz384 → zzz386 → zzz387). This
// module is the single source of truth for both, so the values can never
// diverge again. It is pure data + one pure function: no React, no server-only
// APIs, importable from both a route handler and a client page.
//
// IMPORTANT: keep this file free of any 'use client' / 'use server' directive
// and of any import that pulls in browser- or node-only globals.

/**
 * Quality-score penalty per caveat tag (points subtracted from a base of 100).
 * Unknown tags fall back to 8 at the call site (`CAVEAT_PENALTY[tag] ?? 8`).
 */
export const CAVEAT_PENALTY: Record<string, number> = {
  'optical eps': 20,
  'tax distortion': 15,
  'ocf divergence': 25,
  'low quality': 25,
  'segment mix shift': 10,
  'exceptional item': 10,
  'forex gain': 8,
  'forex loss': 8,
  'accelerated depreciation': 10,
  'accounting change': 12,
  'pooling of interests restate': 12,
  'one time order': 10,
  // NOT A QUALITY PROBLEM — a MEASUREMENT one, so it costs nothing. The US
  // engine raises this when a stock split (usually a reverse split) sits
  // between the two quarters and the filer's own record does not establish the
  // factor, so the per-share comparison is refused rather than published on two
  // share counts. The quarter itself may be excellent; we simply cannot say
  // what EPS did. Penalising it would turn "we don't know" into "this is bad".
  'per-share comparison unavailable': 0,
};

/** Fallback penalty for a caveat tag not present in CAVEAT_PENALTY. */
export const CAVEAT_PENALTY_DEFAULT = 8;

/**
 * OPM-expansion "margin ladder" (PATCH 1000 + zzz387 ordering fix).
 * Returns the quality-point delta for a given OPM-expansion in percentage
 * points (opmExp = opm_pct − opm_prev_pct). Positive = margins widening.
 *
 * Severe contraction (≤ -2pp) is checked BEFORE mild (≤ -0.5pp) so the -14
 * branch is reachable — the zzz387 bug was that -0.5 shadowed -2, capping every
 * contraction at -8. null / mid-band (between -0.5 and +1) returns 0.
 */
export function marginQualityDelta(opmExp: number | null | undefined): number {
  if (opmExp == null) return 0;
  if (opmExp >= 5) return 14;
  if (opmExp >= 3) return 10;
  if (opmExp >= 1) return 5;
  if (opmExp <= -2) return -14;   // severe contraction — check FIRST
  if (opmExp <= -0.5) return -8;  // mild contraction
  return 0;
}

// zzz395 — the per-quarter tier-decision chain, extracted so the two gradeRow
// copies (server graded/route.ts + client earnings-opportunities/page.tsx)
// share ONE authoritative implementation. Prior to zzz395 the client's
// BLOCKBUSTER gate was missing Paths D+E (margin inflection); Part 1 of zzz395
// brought the client to parity, Part 2 (this) removed the possibility of
// re-drift by making both call sites delegate here.
//
// Pure: no React, no server-only APIs, no browser/node globals.

export type EarningsTier = 'BLOCKBUSTER' | 'STRONG' | 'MIXED' | 'AVOID';

/**
 * Inputs for {@link decideTier}. These are the exact values both call sites
 * already compute inline; the caller derives the magnitude / margin-inflection
 * booleans and passes them in so this function stays a pure decision.
 */
export interface DecideTierInputs {
  composite: number;
  broken: boolean;
  stillLossMaking: boolean;
  turnaroundBase: boolean;
  marginContracting: boolean;        // opmExp <= -0.5 (PATCH 1000)
  marginSevereContraction: boolean;  // opmExp <= -1.5 (PATCH 1020)
  caveatCount: number;               // caveat_tags.length
  mCount: number;                    // methodology_tags.length
  stage: number | null;
  salesY: number | null;
  patY: number | null;
  epsY: number | null;
  opmExp: number | null;
  // BLOCKBUSTER-gate ingredients (Paths A–E)
  cleanMag: boolean;
  exceptMag: boolean;
  megaMag: boolean;
  marginInflection: boolean;         // PAT>=100 & EPS>=100 & sales>=-5
  marginInflectionLoose: boolean;    // PAT>=75 & EPS>=75 & sales>=0 & stage!=4
  tier1MethodCount: number;          // TT / SEPA / CANSLIM count
  positiveGuidance: boolean;
  chartOk: boolean;
  // ── BEAT-AND-RAISE ingredients (see the STRONG path below) ──
  /** Consensus surprise on the basis the street actually quotes, in %. Null
   *  whenever the estimate is under a dime, because a percentage off a base
   *  that small is arithmetic noise — `consensusBeatAbs` carries those. */
  consensusBeatPct?: number | null;
  /** The same surprise in dollars per share. The ONLY signal for a company the
   *  street expected to earn a few cents: Rubrik beat a $0.04 estimate with
   *  $0.20 — a fourfold beat that the percentage path refuses to express. */
  consensusBeatAbs?: number | null;
  /** Earnings are moving the right way. Separate from `patY > 0` because a
   *  company whose year-ago base was NEGATIVE has no growth percentage at all
   *  (`yoyPct` refuses a negative base, correctly), and requiring one excluded
   *  every turnaround from this path — which is exactly the population it was
   *  most needed for. */
  earningsImproving?: boolean;
  /** The filer RAISED its own outlook in this release (not merely gave one). */
  guidanceRaised?: boolean;
  /** Cash flow backs the profit: CFO ÷ net income, when both exist. */
  cfoToNi?: number | null;
}

/**
 * The core tier decision (BLOCKBUSTER gate v3 + graduated margin gate +
 * loss-maker / turnaround / quality-STRONG rules). Returns the base tier BEFORE
 * the one-way market-reaction and thin-float downgrades — apply those via
 * {@link marketReactionDelta} and {@link thinFloatGate} in that order.
 *
 * `addCaveats` is reserved (the base decision itself never pushes caveats); the
 * downgrade helpers are what emit caveats.
 */
export function decideTier(i: DecideTierInputs): { tier: EarningsTier; addCaveats?: string[] } {
  // BLOCKBUSTER gate — Paths A–E (any one qualifies).
  const bbPathA = i.composite >= 78 && i.cleanMag && i.caveatCount <= 1 && (i.tier1MethodCount >= 1 || i.positiveGuidance) && i.chartOk;
  const bbPathB = i.composite >= 72 && i.exceptMag && i.caveatCount <= 2 && i.chartOk;
  const bbPathC = i.megaMag && i.caveatCount <= 3 && i.stage !== 4;
  const bbPathD = i.marginInflection && i.caveatCount <= 3 && i.stage !== 4;        // PATCH 0837
  const bbPathE = i.marginInflectionLoose && i.caveatCount <= 2;                    // PATCH 0838
  const blockbusterGate = bbPathA || bbPathB || bbPathC || bbPathD || bbPathE;

  let tier: EarningsTier;
  if (i.broken && i.composite < 70) tier = 'AVOID';
  else if (i.stillLossMaking && blockbusterGate) tier = 'MIXED';                    // PATCH 1001
  else if (i.turnaroundBase && blockbusterGate) tier = 'MIXED';                     // PATCH 1008
  else if (blockbusterGate && i.marginSevereContraction) tier = 'MIXED';            // PATCH 1020
  else if (blockbusterGate && !i.marginContracting) tier = 'BLOCKBUSTER';
  else if (blockbusterGate && i.marginContracting) tier = 'STRONG';                 // PATCH 1000
  else if (i.composite >= 68 && i.mCount >= 1 && i.caveatCount <= 3 && i.stage !== 4 && !i.stillLossMaking && !i.turnaroundBase && !i.marginSevereContraction) tier = 'STRONG';
  // PATCH 1022 — QUALITY STRONG: double-digit sales + strong PAT + genuinely
  // EXPANDING margins can be STRONG a point or two under the 68 floor.
  else if (
    i.composite >= 60 &&
    i.salesY != null && i.salesY >= 10 &&
    i.patY != null && i.patY >= 25 &&
    i.epsY != null && i.epsY >= 15 &&
    i.opmExp != null && i.opmExp >= 0.5 &&
    !i.stillLossMaking && !i.turnaroundBase &&
    i.caveatCount <= 3 && i.stage !== 4
  ) tier = 'STRONG';
  // ═════════════════════════════════════════════════════════════════════════
  // BEAT AND RAISE — the evidence the ladder was throwing away.
  //
  // BJ's Wholesale reported revenue +16%, EPS +19%, a 17% beat on the street's
  // own number, RAISED its full-year guidance, and produced $401m of operating
  // cash against $175m of profit — with NOT ONE caveat on the card. It was
  // graded MIXED, the same label as a company whose margins are collapsing.
  //
  // The reason is that every path above is a MAGNITUDE test: it asks how fast
  // the company grew (25/25/25 for a clean tier), and a profitable compounder
  // growing in the teens can never clear it however well it executed. Two of
  // the strongest pieces of evidence in an earnings release — that the company
  // beat what the market expected of it, and that management then raised what
  // it expects of itself — carried no weight at all.
  //
  // Both are required, and so is the quality: a beat on its own is one quarter,
  // and a raise on its own is a forecast. Together, with cash behind the
  // profit, no critical caveat and a chart that is not broken, that is STRONG —
  // and never more than STRONG, because BLOCKBUSTER is reserved for magnitude
  // this path deliberately does not have.
  //
  // THE BEAT IS MEASURED THE SAME WAY THE CARD MEASURES IT. Rubrik beat a $0.04
  // consensus with $0.20 on +38% revenue, +13.7pp of margin, $65.7m of free
  // cash flow and a raised guide — and this path did not fire, because a
  // percentage off a four-cent base is refused everywhere in this engine as
  // noise. The cents figure is what the card already prints for exactly those
  // companies, so it is what the grade reads too.
  else if (
    ((i.consensusBeatPct != null && i.consensusBeatPct >= 3)
      || (i.consensusBeatPct == null && i.consensusBeatAbs != null && i.consensusBeatAbs >= 0.03)) &&
    i.guidanceRaised === true &&
    !i.stillLossMaking && !i.turnaroundBase &&
    !i.marginContracting &&
    // cash has to back the profit; absent cash-flow data (a PRELIM row) is not
    // held against the company, but negative cash flow disqualifies outright.
    (i.cfoToNi == null || i.cfoToNi >= 1) &&
    i.caveatCount <= 2 && i.stage !== 4 &&
    i.salesY != null && i.salesY > 0 &&
    (i.earningsImproving === true || (i.patY != null && i.patY > 0))
  ) tier = 'STRONG';
  else if (i.composite >= 35) tier = 'MIXED';
  else tier = 'AVOID';

  return { tier };
}

/**
 * How big a one-day move IS for this stock, in percent — the median absolute
 * daily return over the closes supplied. Returns null when there is not enough
 * history to say, which every caller must treat as "no opinion", never as zero.
 */
export function typicalDailyMovePct(closes: number[] | null | undefined): number | null {
  if (!closes || closes.length < 12) return null;
  const moves: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1], b = closes[i];
    if (!Number.isFinite(a) || !Number.isFinite(b) || !(a > 0)) continue;
    moves.push(Math.abs((b - a) / a) * 100);
  }
  if (moves.length < 10) return null;
  moves.sort((x, y) => x - y);
  const m = moves.length >> 1;
  const med = moves.length % 2 ? moves[m] : (moves[m - 1] + moves[m]) / 2;
  return Number.isFinite(med) && med > 0 ? med : null;
}

/**
 * PATCH 0938 — Day-1 market-reaction ladder. One-way (only downgrades). A print
 * the market sold off on Day-1 loses its top-tier label regardless of headline
 * beat. Returns the (possibly-demoted) tier plus caveats to merge into the
 * card's caveat list (caller dedups against existing tags).
 */
export function marketReactionDelta(
  tier: EarningsTier,
  d1Pct: number | null | undefined,
  gapPct: number | null | undefined,
  /**
   * The stock's own median absolute daily move, in % (see
   * {@link typicalDailyMovePct}). Optional: when absent the fixed thresholds
   * below apply exactly as they always have.
   */
  typicalMovePct?: number | null,
): { tier: EarningsTier; addCaveats: string[] } {
  const d1Reaction = typeof d1Pct === 'number' ? d1Pct : null;
  const gapReaction = typeof gapPct === 'number' ? gapPct : null;
  const addCaveats: string[] = [];
  let t = tier;

  // A FIXED PERCENTAGE IS NOT A REJECTION — IT DEPENDS ON THE STOCK.
  //
  // Rubrik fell 3.2% on results and the card said "market rejected print".
  // Rubrik's median daily move is well over 3%: that day was an ordinary
  // session, not a verdict. The same 3.2% on a consumer staple that normally
  // moves 0.8% genuinely is one. Scaling the thresholds by the stock's own
  // typical move makes the test say what it means for every name, instead of
  // being right for mid-volatility stocks and wrong at both ends.
  //
  // The floors keep the old behaviour as the minimum: a quiet stock can never
  // make a 1% dip count, and the ceilings stop a violently volatile microcap
  // from being unfalsifiable.
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const typ = (typeof typicalMovePct === 'number' && Number.isFinite(typicalMovePct) && typicalMovePct > 0)
    ? typicalMovePct : null;
  const soldOff = typ == null ? -7 : -clamp(typ * 2.5, 7, 20);
  const rejected = typ == null ? -3 : -clamp(typ * 1.5, 3, 10);

  if (d1Reaction !== null) {
    if (d1Reaction <= soldOff) {
      if (t === 'BLOCKBUSTER' || t === 'STRONG') t = 'MIXED';
      addCaveats.push('sold off post-results');
    } else if (d1Reaction <= rejected) {
      if (t === 'BLOCKBUSTER') t = 'STRONG';
      addCaveats.push('market rejected print');
    }
    if (gapReaction !== null && gapReaction >= 3 && d1Reaction <= -2) {
      addCaveats.push('intraday reversal · distribution');
    }
  }
  return { tier: t, addCaveats };
}

/**
 * PATCH 1034 — Liquidity / thin-float gate. A name that barely trades (median
 * traded value < ₹1 Cr/day) can't be built or exited at size, so it doesn't
 * belong in the top conviction tiers. Demote (never delete) + tag. Missing ADTV
 * is NOT punished (data gap ≠ illiquid).
 */
export function thinFloatGate(
  tier: EarningsTier,
  adtvCr: number | null | undefined,
): { tier: EarningsTier; addCaveats: string[] } {
  const THIN_ADTV_CR = 1;  // < ₹1 Cr/day median traded value = thin float / illiquid
  const adtv = (typeof adtvCr === 'number' && Number.isFinite(adtvCr)) ? adtvCr : null;
  const thinFloat = adtv != null && adtv < THIN_ADTV_CR;
  const addCaveats: string[] = [];
  let t = tier;
  if (thinFloat) {
    if (t === 'BLOCKBUSTER' || t === 'STRONG') t = 'MIXED';
    addCaveats.push('thin float');
  }
  return { tier: t, addCaveats };
}

// ═══════════════════════════════════════════════════════════════════════════
// QUALITY × INFLECTION — the second axis.
//
// A tier is one number, and one number cannot say two different things about a
// company. Velo3D grew revenue 52%, expanded operating margin by 31.9pp,
// doubled backlog and raised guidance — while burning $25m of free cash on a
// −28% ROCE. The tier said MIXED, which reads as "unremarkable", and buried
// it. Keysight and Velo3D are not the same kind of company and should not
// share a label.
//
// So every row carries two independent scores:
//
//   QUALITY    — what the business IS: returns on capital, cash conversion,
//                margin LEVEL, whether it makes money at all.
//   INFLECTION — what the business is BECOMING: growth, the CHANGE in margin,
//                the direction of the guide, the distance travelled toward
//                profitability.
//
// and the quadrant they define:
//
//                      high inflection        low inflection
//   high quality       COMPOUNDER             QUALITY
//   low quality        TURNAROUND ACCELERATOR REJECT
//
// TURNAROUND ACCELERATOR is the one this exists for: the highest-variance
// quadrant in the market, where both the biggest asymmetric wins and most of
// the permanent losses live. Naming it is the point — it is a warning and a
// watchlist at the same time, and it never promotes a row's tier. A company
// that has not yet proved it can earn a return does not become BLOCKBUSTER
// because it is improving quickly; "path to profitability" is not
// profitability, and the card must never let a management target sit at the
// same visual weight as a reported number.
// ═══════════════════════════════════════════════════════════════════════════

export type EarningsQuadrant = 'COMPOUNDER' | 'TURNAROUND ACCELERATOR' | 'QUALITY' | 'REJECT';

export interface QuadrantInputs {
  // — quality side —
  roce_pct?: number | null;          // return on capital employed, %
  fcf_margin_pct?: number | null;    // free cash flow ÷ revenue, %
  cfo_to_ni?: number | null;         // operating cash ÷ net income
  opm_pct?: number | null;           // operating margin LEVEL, %
  profitable?: boolean | null;       // net income > 0 this quarter
  // — inflection side —
  sales_yoy_pct?: number | null;
  opm_delta_pp?: number | null;      // operating-margin change YoY, in pp
  gross_margin_delta_pp?: number | null;
  eps_improving?: boolean | null;    // EPS up, or a loss narrowing / turning
  guidance_raised?: boolean | null;
  guidance_lowered?: boolean | null;
  backlog_growth_pct?: number | null; // backlog / ARR / RPO growth where given
  loss_narrowing?: boolean | null;    // still loss-making but the loss shrank
}

export interface QuadrantResult {
  quality: number;        // 0–100
  inflection: number;     // 0–100
  /** null when too little was assessable to place the row honestly — see the
   *  comment in `quadrantScore`. Every card renders nothing for a null. */
  quadrant: EarningsQuadrant | null;
  /** The components that actually contributed, for the card to show its work. */
  quality_parts: Array<{ label: string; points: number; of: number }>;
  inflection_parts: Array<{ label: string; points: number; of: number }>;
}

/**
 * Score a band: returns `full` above `good`, 0 below `bad`, and interpolates
 * between. Null in, null out — a missing input never scores as a bad one.
 */
function band(v: number | null | undefined, bad: number, good: number, full: number): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  if (v >= good) return full;
  if (v <= bad) return 0;
  return ((v - bad) / (good - bad)) * full;
}

/**
 * Compute both scores and the quadrant. Every component is optional; each score
 * is the points earned as a percentage of the points that were ASSESSABLE, so a
 * company missing cash-flow data is judged on what it did report rather than
 * penalised for a gap in the filing. When too little is known to judge an axis
 * at all, that axis scores 50 — neutral — and the quadrant leans on the other.
 */
export function quadrantScore(i: QuadrantInputs): QuadrantResult {
  const qParts: QuadrantResult['quality_parts'] = [];
  const push = (
    arr: QuadrantResult['quality_parts'], label: string, got: number | null, of: number,
  ) => { if (got != null) arr.push({ label, points: Math.round(got * 10) / 10, of }); };

  // ── QUALITY: returns, cash, margin level, profitability ──
  push(qParts, 'ROCE', band(i.roce_pct, 0, 20, 30), 30);
  push(qParts, 'FCF margin', band(i.fcf_margin_pct, -5, 15, 25), 25);
  push(qParts, 'cash conversion', band(i.cfo_to_ni, 0.3, 1.2, 20), 20);
  push(qParts, 'operating margin', band(i.opm_pct, 0, 20, 15), 15);
  if (i.profitable != null) qParts.push({ label: 'profitable', points: i.profitable ? 10 : 0, of: 10 });

  // ── INFLECTION: growth, the CHANGE in margin, the direction of the guide ──
  const iParts: QuadrantResult['inflection_parts'] = [];
  push(iParts, 'revenue growth', band(i.sales_yoy_pct, 0, 40, 30), 30);
  push(iParts, 'margin expansion', band(i.opm_delta_pp, 0, 5, 25), 25);
  push(iParts, 'gross-margin expansion', band(i.gross_margin_delta_pp, 0, 3, 10), 10);
  if (i.eps_improving != null) iParts.push({ label: 'earnings direction', points: i.eps_improving ? 15 : 0, of: 15 });
  if (i.guidance_raised || i.guidance_lowered) {
    iParts.push({ label: 'guidance revision', points: i.guidance_raised ? 15 : 0, of: 15 });
  }
  push(iParts, 'backlog / ARR growth', band(i.backlog_growth_pct, 0, 30, 5), 5);
  // A loss that is narrowing is inflection even when every level metric is
  // still negative — it is the whole reason this axis exists.
  if (i.loss_narrowing) iParts.push({ label: 'loss narrowing', points: 10, of: 10 });

  const pct = (parts: QuadrantResult['quality_parts']) => {
    const of = parts.reduce((s, p) => s + p.of, 0);
    if (of < 25) return null;                 // too little assessed to judge
    const got = parts.reduce((s, p) => s + p.points, 0);
    return Math.max(0, Math.min(100, Math.round((got / of) * 100)));
  };
  const qRaw = pct(qParts), iRaw = pct(iParts);
  const quality = qRaw ?? 50;
  const inflection = iRaw ?? 50;

  // A VERDICT INVENTED FROM NOTHING IS THE WORST OUTPUT THIS ENGINE CAN GIVE.
  //
  // When an axis has too little to assess, it falls back to a neutral 50 — but
  // 50 then reads as "passes the quality bar", so a filer that reported almost
  // nothing came out labelled QUALITY or COMPOUNDER on the strength of no
  // evidence whatever. Both engines hit this the day the feature landed (a bank
  // holding with no assessable inflection; an Indian microcap with neither axis
  // assessable), and both cards render nothing for a null quadrant — which is
  // the correct answer. Say nothing rather than say something unfounded.
  //
  // One axis missing is survivable: the other axis still discriminates, and the
  // neutral 50 keeps the row in the quadrant its known half implies. Both
  // missing is not, and neither is a quadrant decided by a single component.
  const assessed = (parts: QuadrantResult['quality_parts']) => parts.reduce((s, p) => s + p.of, 0);

  // A NEUTRAL FALLBACK MUST NEVER READ AS A PASS.
  //
  // An axis with too little to assess scores 50, and 50 cleared the quality
  // bar — so Citi Trends, whose quality axis had ZERO assessable points (a
  // PRELIM row with no balance sheet, no cash flow, and an operating loss),
  // came out labelled "QUALITY: a genuinely good business". Prospect Capital
  // did the same on 15 assessable points. The engine was reporting an absence
  // of evidence as evidence.
  //
  // So a fallback axis can no longer be "high". It keeps its 50 for display —
  // that is honest, it means "not judged" — but the quadrant is decided only
  // by axes that were actually measured, and where neither was, there is no
  // quadrant at all and the card shows none.
  const qMeasured = qRaw != null && assessed(qParts) >= 40;
  const iMeasured = iRaw != null && assessed(iParts) >= 40;
  const hiQ = qMeasured && quality >= 50;
  const hiI = iMeasured && inflection >= 55;
  const quadrant: EarningsQuadrant | null =
    (!qMeasured && !iMeasured) ? null
    : hiQ && hiI ? 'COMPOUNDER'
    : hiI ? 'TURNAROUND ACCELERATOR'
    // Only a MEASURED quality axis may award the QUALITY label; an unmeasured
    // one falls through to REJECT's "not enough here", which is what it is.
    : hiQ ? 'QUALITY'
    : qMeasured || iMeasured ? 'REJECT'
    : null;

  return { quality, inflection, quadrant, quality_parts: qParts, inflection_parts: iParts };
}

/**
 * ONE vocabulary for the quadrant badge, shared by every card that renders it
 * (US and India). Colour/icon/label live here rather than in each card so the
 * two engines cannot end up calling the same quadrant by two different names —
 * the same reason the scoring itself is in this file.
 */
export const QUADRANT_META: Record<EarningsQuadrant, { icon: string; label: string; color: string; tagline: string }> = {
  'COMPOUNDER': {
    icon: '🔥', label: 'COMPOUNDER', color: '#F59E0B',
    tagline: 'Earns a return on capital AND is still accelerating — the rare pair.',
  },
  'TURNAROUND ACCELERATOR': {
    icon: '⚡', label: 'TURNAROUND ACCELERATOR', color: '#8B5CF6',
    tagline: 'Changing fast from a weak base. The highest-variance quadrant there is: '
      + 'it is a watchlist and a warning at the same time, and it never promotes the tier — '
      + 'a path to profitability is not profitability.',
  },
  'QUALITY': {
    icon: '🛡', label: 'QUALITY', color: '#22D3EE',
    tagline: 'A genuinely good business that is not currently inflecting.',
  },
  'REJECT': {
    icon: '⊘', label: 'REJECT', color: 'var(--mc-text-3)',
    tagline: 'Neither earning a return nor changing quickly enough to matter yet.',
  },
};

// ── INDIA input mapping ────────────────────────────────────────────────────
//
// The India grader exists in the same two copies as everything else above
// (server graded/route.ts + client earnings-opportunities/page.tsx). Rather
// than write the field mapping twice — and re-create the exact drift class this
// file exists to prevent — the mapping itself lives here and both call sites
// delegate. Given the same enriched row, the two graders CANNOT produce
// different quadrants.
//
// WHAT INDIA GENUINELY HAS, and what it does not:
//   • roce            — Screener's ROCE % (annual/TTM). Real, so it is passed.
//   • ocf_to_pat_ratio— Screener's annual CFO ÷ PAT. This is the cash-conversion
//                       input; the US side passes the same ratio.
//   • opm_pct / opm_prev_pct — operating-margin LEVEL and the YoY CHANGE.
//   • sales_yoy_pct   — revenue growth.
//   • absolute PAT/EPS for this quarter and the year-ago quarter — which is how
//     "earnings direction" and "loss narrowing" are decided, NOT the YoY %:
//     when the prior base is negative the % is arithmetic noise (that is the
//     whole point of India's `turnaroundBase` caveat), while comparing the two
//     absolutes is always true.
//   • guidance prose  — India scans the filing text. See the note on the
//     raise/cut patterns below for why only an EXPLICIT revision counts.
//
// Deliberately passed as null, because India's pipeline does not have them and
// a guess would be a fabricated number:
//   • fcf_margin_pct        — Screener gives CFO but no quarterly capex, so free
//                             cash flow cannot be computed. CFO is not FCF.
//   • gross_margin_delta_pp — the Indian P&L we parse reports operating margin,
//                             not gross margin.
//   • backlog_growth_pct    — order-book commentary is prose ("record order
//                             book"), never a number we can stand behind.
// A missing input is never scored as a bad one: quadrantScore judges each axis
// on the points that were assessable, so India is simply scored on less.

/**
 * India's guidance prose → an EXPLICIT revision, or nothing.
 *
 * India's grader already scans filing text for forward-looking positives
 * ("capacity expansion", "order book", "tailwind" …) and calls two or more of
 * them `positiveGuidance`. That is a TONE signal, and it is NOT a raise: a
 * company describing its capex plans has not revised anything. The inflection
 * axis scores "guidance revision" as a 15-point YES/NO, so feeding it tone
 * would hand marketing language the same weight as a management commitment.
 * Only wording that states an actual change to a previously-issued outlook
 * counts here; everything else leaves BOTH flags null and the component is not
 * scored at all.
 */
const IN_GUIDANCE_RAISE = [
  /guidance\s+(?:was\s+)?rais/,
  /rais(?:ed|es|ing)\s+(?:its\s+|our\s+|the\s+)?(?:full[- ]year\s+|fy\s?\d{2,4}\s+|annual\s+)?(?:guidance|outlook|target|estimate)/,
  /upgrad(?:ed|es|ing)\s+(?:its\s+|our\s+|the\s+)?(?:full[- ]year\s+)?(?:guidance|outlook)/,
  /(?:guidance|outlook)\s+(?:revised|upgraded)\s+upward/,
  /revis(?:ed|es|ing)\s+(?:its\s+|our\s+|the\s+)?(?:guidance|outlook)\s+upward/,
  /increas(?:ed|es|ing)\s+(?:its\s+|our\s+|the\s+)?(?:full[- ]year\s+)?(?:guidance|outlook)/,
];
const IN_GUIDANCE_CUT = [
  /guidance\s+(?:was\s+)?(?:cut|lowered|reduced|withdrawn|trimmed)/,
  /(?:cut|lower(?:ed|s|ing)?|reduc(?:ed|es|ing)|trim(?:med|s|ming)?)\s+(?:its\s+|our\s+|the\s+)?(?:full[- ]year\s+|fy\s?\d{2,4}\s+|annual\s+)?(?:guidance|outlook|target)/,
  /withdraw(?:n|s|ing)?\s+(?:its\s+|our\s+|the\s+)?(?:full[- ]year\s+)?(?:guidance|outlook)/,
  /(?:guidance|outlook)\s+(?:lowered|reduced|downgraded|withdrawn)/,
];

/** The derived values both India call sites already compute inline. */
export interface IndiaQuadrantDerived {
  /** Revenue growth YoY, %. */
  salesY: number | null;
  /** OPM change YoY in percentage points (opm_pct − opm_prev_pct), or null. */
  opmExp: number | null;
}

/**
 * Map an enriched India row onto {@link quadrantScore}. Pure; safe on both the
 * server route and the client page. Every unknown is passed as null.
 */
export function quadrantForIndiaRow(row: any, d: IndiaQuadrantDerived): QuadrantResult {
  const num = (v: any): number | null =>
    (typeof v === 'number' && Number.isFinite(v)) ? v : null;

  const patCur = num(row?.pat_curr_cr);
  const patPrev = num(row?.pat_prev_cr);
  const epsCur = num(row?.eps_curr);
  const epsPrev = num(row?.eps_prev);

  // Profitability from the reported absolutes — PAT first because a company can
  // report positive PAT with an EPS the source failed to populate.
  const profitable = patCur != null ? patCur > 0 : (epsCur != null ? epsCur > 0 : null);

  // EARNINGS DIRECTION is decided on the two absolutes, never on the YoY %.
  // When the year-ago base is negative the percentage is produced by
  // absolute-value division and can read +8000% on a company that is still
  // losing money; the comparison `this quarter > year-ago quarter` is true in
  // every case, including a loss that halved.
  const epsImproving =
    (epsCur != null && epsPrev != null) ? epsCur > epsPrev
    : (patCur != null && patPrev != null) ? patCur > patPrev
    : null;

  // A loss that is shrinking is inflection even though every LEVEL metric is
  // still negative — the reason the second axis exists at all.
  const stillLoss = (patCur != null && patCur <= 0) || (epsCur != null && epsCur <= 0);
  const lossNarrowing = !stillLoss ? false
    : (patCur != null && patPrev != null) ? patCur > patPrev
    : (epsCur != null && epsPrev != null) ? epsCur > epsPrev
    : null;

  const guidanceText = [
    row?.guidance_text, row?.narrative_text, row?.announcement_text,
    row?.attachment, row?.headline, row?.title,
  ].filter(Boolean).join(' ').toLowerCase();
  const raised = guidanceText ? IN_GUIDANCE_RAISE.some((p) => p.test(guidanceText)) : false;
  const lowered = guidanceText ? IN_GUIDANCE_CUT.some((p) => p.test(guidanceText)) : false;

  return quadrantScore({
    // — quality —
    roce_pct: num(row?.roce),
    fcf_margin_pct: null,                        // no capex in the India feed → no FCF
    cfo_to_ni: num(row?.ocf_to_pat_ratio ?? row?.cfo_to_pat_ratio),
    opm_pct: num(row?.opm_pct),
    profitable,
    // — inflection —
    sales_yoy_pct: d.salesY,
    opm_delta_pp: d.opmExp,
    gross_margin_delta_pp: null,                 // Indian P&L parsed gives OPM, not GM
    eps_improving: epsImproving,
    // Both false = no explicit revision found = component not scored.
    guidance_raised: raised ? true : null,
    guidance_lowered: lowered ? true : null,
    backlog_growth_pct: null,                    // order book is prose, not a number
    loss_narrowing: lossNarrowing,
  });
}

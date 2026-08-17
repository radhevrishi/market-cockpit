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
  else if (i.composite >= 35) tier = 'MIXED';
  else tier = 'AVOID';

  return { tier };
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
): { tier: EarningsTier; addCaveats: string[] } {
  const d1Reaction = typeof d1Pct === 'number' ? d1Pct : null;
  const gapReaction = typeof gapPct === 'number' ? gapPct : null;
  const addCaveats: string[] = [];
  let t = tier;
  if (d1Reaction !== null) {
    if (d1Reaction <= -7) {
      if (t === 'BLOCKBUSTER' || t === 'STRONG') t = 'MIXED';
      addCaveats.push('sold off post-results');
    } else if (d1Reaction <= -3) {
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

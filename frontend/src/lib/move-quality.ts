// ═══════════════════════════════════════════════════════════════════════════
// /lib/move-quality.ts (PATCH 0805)
//
// Institutional Move Quality + Continuation engine.
//
// Layers on top of MoverAttribution to answer the question professional
// traders actually care about: not just "did it move?" but
//   - Is the move SUSTAINABLE?         → Move Quality Score (0-100)
//   - Is it likely to CONTINUE?        → Continuation Probability (HIGH/MED/LOW)
//   - What KIND of move is this?       → Refined bucket taxonomy
//   - Any SMART MONEY signals?         → Per-row bullets
//   - Where in its TECHNICAL range?    → 52W proximity / breakout tags
//
// All inputs are optional with graceful fallback — the engine works with
// just attribution + change%, gets richer as delivery / volume /
// fundamentals populate.
// ═══════════════════════════════════════════════════════════════════════════

import type { MoverAttribution, CatalystType } from './movers-attribution';

// ─── Public types ──────────────────────────────────────────────────────────

export type MoveBucket =
  | 'FUNDAMENTAL_RERATING'   // confirmed earnings/order/guidance — composite re-pricing
  | 'PRE_EVENT'              // board meeting / fundraise / demerger expectation
  | 'SHORT_COVERING'         // positioning unwind — fade risk high
  | 'OPERATOR'               // low-float circuit pump — institutional avoid
  | 'FLOW'                   // OFS / block deal / index rebalance
  | 'ROTATION'               // sector-wide move, RS-led
  | 'TECHNICAL'              // breakout without news, structure-led
  | 'SPECULATIVE'            // low-quality momentum, weak delivery
  | 'ILLIQUID';              // thin-float distortion — not tradable in size

export type ContinuationProbability = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

export interface MoveQualityInputs {
  // Mandatory
  changePercent: number;
  attribution: MoverAttribution;

  // From quotes route — graceful fallback when missing
  volMultiple?: number;       // today vol / 20d avg vol
  deliveryPct?: number;       // 0..100 — % of volume that took delivery
  turnoverLacs?: number;      // today turnover in lacs (= ₹0.1 Cr)
  pctOf52wHigh?: number;      // 0..1 — current price / 52w high
  mom1M?: number;             // % move over last 1 month
  vol20DAvg?: number;
  marketCap?: number;         // ₹ Cr
  indexGroup?: 'Large' | 'Mid' | 'Small' | 'Micro' | string;
}

export interface MoveQualityResult {
  quality: number;                     // 0..100
  qualityLabel: 'EXCELLENT' | 'GOOD' | 'WEAK' | 'POOR';
  continuation: ContinuationProbability;
  bucket: MoveBucket;
  bucketLabel: string;                 // human-friendly chip text
  technical?: string;                  // 1-line technical tag (52W high, etc)
  smartMoney: string[];                // 0-3 bullets, max 60 chars each
  liquidityRisk: 'OK' | 'MODERATE' | 'HIGH';
  components: {                        // for tooltip / audit
    relVol: number;
    delivery: number;
    structure: number;
    sector: number;
    trigger: number;
  };
}

// ─── Component scorers (each returns 0..100) ───────────────────────────────

function relVolScore(volMultiple?: number): number {
  if (!Number.isFinite(volMultiple)) return 40;     // unknown → neutral-ish
  const v = volMultiple!;
  // 1x = 0, 3x = 50, 8x+ = 100 — institutional flow needs ≥5x typically
  if (v <= 1) return 0;
  if (v >= 8) return 100;
  if (v <= 3) return ((v - 1) / 2) * 50;            // 1 → 0,  3 → 50
  return 50 + ((v - 3) / 5) * 50;                   // 3 → 50, 8 → 100
}

function deliveryScore(deliveryPct?: number): number {
  if (!Number.isFinite(deliveryPct)) return 40;
  const d = deliveryPct!;
  // <30% = retail/intraday churn (bad), 60+% = institutional (good)
  if (d < 25) return 10;
  if (d < 40) return 30;
  if (d < 55) return 55;
  if (d < 70) return 80;
  return 95;
}

function structureScore(pctOf52wHigh?: number, mom1M?: number, changePercent?: number): number {
  // Healthy structure: near 52W high + positive 1M momentum + closing near today's move (we proxy via abs(change))
  if (!Number.isFinite(pctOf52wHigh) && !Number.isFinite(mom1M)) return 45;
  let s = 40;
  if (Number.isFinite(pctOf52wHigh)) {
    const p = pctOf52wHigh!;
    if (p >= 0.97) s += 35;                         // at or breaking 52W high
    else if (p >= 0.90) s += 25;
    else if (p >= 0.75) s += 15;
    else if (p < 0.50) s -= 15;                     // far below 52W high = weak
  }
  if (Number.isFinite(mom1M)) {
    const m = mom1M!;
    if (m > 10) s += 15;
    else if (m > 0) s += 5;
    else if (m < -10) s -= 10;
  }
  // Direction agreement: today's positive move + healthy 1M = trend continuation
  if (Number.isFinite(changePercent) && Number.isFinite(mom1M) &&
      Math.sign(changePercent!) === Math.sign(mom1M!) && Math.abs(mom1M!) > 5) {
    s += 5;
  }
  return Math.max(0, Math.min(100, s));
}

function sectorScore(attribution: MoverAttribution): number {
  // Sector confirmation: sector moving in same direction as stock = quality
  const ev = attribution.evidence;
  if (!ev || !Number.isFinite(ev.sectorMovePct)) return 50;
  const sectorMove = ev.sectorMovePct!;
  const stockDir = Math.sign(attribution.changePercent);
  const sectorDir = Math.sign(sectorMove);
  if (stockDir === 0 || sectorDir === 0) return 50;
  if (stockDir === sectorDir) {
    // Same direction — quality boost scaled by how strong sector is
    return Math.min(100, 60 + Math.min(40, Math.abs(sectorMove) * 15));
  }
  // Opposite — stock fighting sector. Either real alpha or distortion.
  return 35;
}

function triggerScore(attribution: MoverAttribution): number {
  if (attribution.confidence === 'HIGH') return 95;
  if (attribution.confidence === 'MEDIUM') return 60;
  return 25;
}

// ─── Bucket classifier ─────────────────────────────────────────────────────

export function classifyBucket(i: MoveQualityInputs): { bucket: MoveBucket; label: string } {
  const { attribution, changePercent, deliveryPct, volMultiple, marketCap, indexGroup } = i;
  const ct = attribution.catalystType;
  const conf = attribution.confidence;
  const evSrc = attribution.evidenceSource;

  // HIGH-confidence fundamental catalysts → re-rating
  if (conf === 'HIGH' && (ct === 'EARNINGS' || ct === 'ORDER_WIN' || ct === 'RATING' || ct === 'MNA')) {
    return { bucket: 'FUNDAMENTAL_RERATING', label: 'fundamental re-rating' };
  }
  // Flow events
  if (ct === 'OFS' || ct === 'BLOCK_DEAL') {
    return { bucket: 'FLOW', label: 'flow / block deal' };
  }
  // Sector-wide rotation
  if (ct === 'SECTOR_ROTATION' || attribution.scope === 'SECTOR_WIDE') {
    return { bucket: 'ROTATION', label: 'sector rotation' };
  }

  // Below this point: catalystType is NONE / inferred — refine via microstructure
  const isMicrocap = (marketCap !== undefined && marketCap < 1000)
    || indexGroup === 'Micro'
    || indexGroup === 'Small';
  const lowDelivery = Number.isFinite(deliveryPct) && deliveryPct! < 30;
  const highDelivery = Number.isFinite(deliveryPct) && deliveryPct! >= 65;
  const veryHighVol = Number.isFinite(volMultiple) && volMultiple! >= 6;
  const thinTurnover = (i.turnoverLacs !== undefined && i.turnoverLacs < 200); // < ₹2 Cr/day = thin

  // Operator pump fingerprint: microcap + extreme move + high delivery + huge vol
  if (isMicrocap && Math.abs(changePercent) >= 8 && highDelivery && veryHighVol) {
    return { bucket: 'OPERATOR', label: 'low-float / operator pump risk' };
  }

  // Short covering: positive move + low delivery + extreme vol
  if (changePercent > 5 && lowDelivery && veryHighVol) {
    return { bucket: 'SHORT_COVERING', label: 'short-covering / positioning' };
  }

  // Illiquid — thin turnover, microcap
  if (thinTurnover && isMicrocap) {
    return { bucket: 'ILLIQUID', label: 'illiquid — not size-tradable' };
  }

  // Technical breakout — structure-led, near 52W high, no news
  if (Number.isFinite(i.pctOf52wHigh) && i.pctOf52wHigh! >= 0.95 && (!evSrc || evSrc === 'inferred')) {
    return { bucket: 'TECHNICAL', label: 'technical breakout' };
  }

  // Speculative — extreme move, no trigger, weak delivery
  if (Math.abs(changePercent) >= 7 && conf === 'LOW' && lowDelivery) {
    return { bucket: 'SPECULATIVE', label: 'speculative momentum' };
  }

  // Default fallback: low-confidence flow
  return { bucket: 'FLOW', label: 'flow-driven (no confirmed catalyst)' };
}

// ─── Continuation probability ──────────────────────────────────────────────

export function classifyContinuation(
  bucket: MoveBucket,
  i: MoveQualityInputs,
  quality: number
): ContinuationProbability {
  const { deliveryPct, pctOf52wHigh, changePercent } = i;
  const strongClose = Number.isFinite(pctOf52wHigh) && pctOf52wHigh! >= 0.95;

  switch (bucket) {
    case 'FUNDAMENTAL_RERATING': {
      // Earnings/order/rating + healthy delivery + strong close → multi-day continuation
      if ((deliveryPct ?? 0) >= 55 && quality >= 65) return 'HIGH';
      if (quality >= 50) return 'MEDIUM';
      return 'LOW';
    }
    case 'PRE_EVENT':
      // Board meeting / fundraise — higher than random momentum, but event-dependent
      return 'MEDIUM';
    case 'OPERATOR':
      return 'LOW';                                  // gap-and-fade risk
    case 'SHORT_COVERING':
      return 'LOW';                                  // 1-2 day exhaustion
    case 'ROTATION':
      // Sector-led — depends on sector breadth + close
      if (strongClose && quality >= 60) return 'MEDIUM';
      return 'LOW';
    case 'TECHNICAL':
      // Breakout — needs volume confirmation
      if ((i.volMultiple ?? 0) >= 3 && strongClose) return 'MEDIUM';
      return 'LOW';
    case 'FLOW':
      return 'LOW';
    case 'SPECULATIVE':
      return 'LOW';
    case 'ILLIQUID':
      return 'UNKNOWN';                              // no real "continuation" — price not real
    default:
      return 'UNKNOWN';
  }
}

// ─── Technical structure tag ───────────────────────────────────────────────

function technicalTag(i: MoveQualityInputs): string | undefined {
  const p = i.pctOf52wHigh;
  const m = i.mom1M;
  if (!Number.isFinite(p)) return undefined;
  if (p! >= 0.98 && i.changePercent > 0) return 'at 52W high';
  if (p! >= 0.95) return 'near 52W high';
  if (p! <= 0.40) return 'deep below 52W high';
  if (Number.isFinite(m) && m! > 25 && i.changePercent > 0) return 'multi-month trend';
  if (Number.isFinite(m) && m! < -25 && i.changePercent < 0) return 'extended downtrend';
  return undefined;
}

// ─── Smart-money bullets ───────────────────────────────────────────────────

function smartMoneyBullets(i: MoveQualityInputs, bucket: MoveBucket): string[] {
  const out: string[] = [];
  const d = i.deliveryPct;
  const v = i.volMultiple;

  if (Number.isFinite(d)) {
    if (d! >= 65) out.push(`✓ delivery ${Math.round(d!)}% (healthy)`);
    else if (d! >= 50) out.push(`delivery ${Math.round(d!)}%`);
    else if (d! < 30) out.push(`⚠ delivery ${Math.round(d!)}% — intraday churn`);
  }
  if (Number.isFinite(v)) {
    if (v! >= 5 && (d ?? 0) >= 55) out.push(`✓ vol ${v!.toFixed(1)}× — institutional flow suspected`);
    else if (v! >= 8) out.push(`⚠ vol ${v!.toFixed(1)}× — extreme participation`);
    else if (v! >= 3) out.push(`vol ${v!.toFixed(1)}× avg`);
  }
  if (bucket === 'FUNDAMENTAL_RERATING' && i.changePercent > 0 && (i.pctOf52wHigh ?? 0) >= 0.95) {
    out.push('✓ closing near high — strength confirms');
  }
  if (bucket === 'OPERATOR') {
    out.push('⚠ pump-pattern risk — low float / repeated circuits');
  }
  if (bucket === 'ILLIQUID') {
    out.push('⚠ thin turnover — not tradable in real size');
  }
  return out.slice(0, 3);
}

// ─── Liquidity risk ─────────────────────────────────────────────────────────

function liquidityRisk(i: MoveQualityInputs): 'OK' | 'MODERATE' | 'HIGH' {
  const turnover = i.turnoverLacs;
  if (!Number.isFinite(turnover)) return 'MODERATE';
  // turnoverLacs in lacs → divide by 100 to get crores
  const turnoverCr = turnover! / 100;
  if (turnoverCr >= 50) return 'OK';                 // ≥ ₹50 Cr daily
  if (turnoverCr >= 5) return 'MODERATE';            // ₹5-50 Cr
  return 'HIGH';
}

// ─── Main composer ─────────────────────────────────────────────────────────

const WEIGHTS = {
  relVol: 0.30,
  delivery: 0.25,
  structure: 0.15,
  sector: 0.15,
  trigger: 0.15,
};

export function computeMoveQuality(i: MoveQualityInputs): MoveQualityResult {
  const components = {
    relVol: relVolScore(i.volMultiple),
    delivery: deliveryScore(i.deliveryPct),
    structure: structureScore(i.pctOf52wHigh, i.mom1M, i.changePercent),
    sector: sectorScore(i.attribution),
    trigger: triggerScore(i.attribution),
  };
  const quality = Math.round(
    components.relVol * WEIGHTS.relVol +
    components.delivery * WEIGHTS.delivery +
    components.structure * WEIGHTS.structure +
    components.sector * WEIGHTS.sector +
    components.trigger * WEIGHTS.trigger
  );
  const qualityLabel: MoveQualityResult['qualityLabel'] =
    quality >= 75 ? 'EXCELLENT' :
    quality >= 55 ? 'GOOD' :
    quality >= 35 ? 'WEAK' : 'POOR';

  const { bucket, label: bucketLabel } = classifyBucket(i);
  const continuation = classifyContinuation(bucket, i, quality);

  return {
    quality,
    qualityLabel,
    continuation,
    bucket,
    bucketLabel,
    technical: technicalTag(i),
    smartMoney: smartMoneyBullets(i, bucket),
    liquidityRisk: liquidityRisk(i),
    components,
  };
}

// ─── Display helpers ───────────────────────────────────────────────────────

export const BUCKET_COLOR: Record<MoveBucket, string> = {
  FUNDAMENTAL_RERATING: '#10B981',   // green — best
  PRE_EVENT:            '#A78BFA',   // violet
  ROTATION:             '#22D3EE',   // cyan
  TECHNICAL:            '#60A5FA',   // blue
  FLOW:                 '#94A3B8',   // slate
  SHORT_COVERING:       '#F59E0B',   // amber — fade risk
  OPERATOR:             '#F97316',   // orange — caution
  SPECULATIVE:          '#FB7185',   // pink — caution
  ILLIQUID:             '#EF4444',   // red — danger
};

export const BUCKET_GLYPH: Record<MoveBucket, string> = {
  FUNDAMENTAL_RERATING: '★',
  PRE_EVENT:            '◆',
  ROTATION:             '↻',
  TECHNICAL:            '⤴',
  FLOW:                 '◯',
  SHORT_COVERING:       '⇋',
  OPERATOR:             '⚠',
  SPECULATIVE:          '?',
  ILLIQUID:             '⌀',
};

export const QUALITY_COLOR: Record<MoveQualityResult['qualityLabel'], string> = {
  EXCELLENT: '#10B981',
  GOOD:      '#22D3EE',
  WEAK:      '#F59E0B',
  POOR:      '#94A3B8',
};

export const CONTINUATION_COLOR: Record<ContinuationProbability, string> = {
  HIGH:    '#10B981',
  MEDIUM:  '#FBBF24',
  LOW:     '#94A3B8',
  UNKNOWN: '#64748B',
};

// ─── Historical outcome priors (PATCH 0821) ────────────────────────────────
// Approximate post-move follow-through stats by bucket type, based on
// commonly-cited equity-market priors. NOT backtested on this app's data —
// directional only. Surfaces in row tooltip so user knows roughly what to
// expect after seeing each bucket. Refine when we have a real backtest blob.

export interface HistoricalOutcome {
  followThroughPct: number;       // % of historical setups that continue 5d
  medianReturn5d: string;          // text label, e.g. '+7%' or '-2%'
  note: string;
}

export function getHistoricalOutcome(bucket: MoveBucket): HistoricalOutcome {
  switch (bucket) {
    case 'FUNDAMENTAL_RERATING':
      return { followThroughPct: 63, medianReturn5d: '+7%', note: 'PEAD anomaly — earnings beat + healthy delivery typically continues' };
    case 'PRE_EVENT':
      return { followThroughPct: 50, medianReturn5d: '+3%', note: 'Event-dependent: outcome reveals whether positioning was correct' };
    case 'SHORT_COVERING':
      return { followThroughPct: 28, medianReturn5d: '-2%', note: 'Squeeze exhaustion — typically fades within 1-2 sessions' };
    case 'OPERATOR':
      return { followThroughPct: 22, medianReturn5d: '-4%', note: 'Gap-and-fade risk — operator pumps rarely sustain' };
    case 'FLOW':
      return { followThroughPct: 40, medianReturn5d: '+1%', note: 'Block deals + OFS — flow-driven, mean-reverts to fundamentals' };
    case 'ROTATION':
      return { followThroughPct: 55, medianReturn5d: '+3%', note: 'Sector rotation — sustains while sector RS holds' };
    case 'TECHNICAL':
      return { followThroughPct: 50, medianReturn5d: '+4%', note: 'Technical breakout — needs vol confirmation + close near high' };
    case 'SPECULATIVE':
      return { followThroughPct: 30, medianReturn5d: '-1%', note: 'Low-conviction momentum — mean reversion risk elevated' };
    case 'ILLIQUID':
      return { followThroughPct: 0, medianReturn5d: 'n/a', note: 'Thin float — price not reliable, impact cost high' };
  }
}

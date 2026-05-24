// ═══════════════════════════════════════════════════════════════════════════
// CATALYST SCORING ENGINE (PATCH 0797)
//
// Multi-factor scoring layer that sits on top of lib/movers-attribution.ts
// to produce institutional-grade attribution narratives. Addresses user
// feedback that previous "no confirmed trigger / broad participation"
// labels were collapsing real catalysts (JSWCEMENT earnings, EXICOM
// turnaround, SPARC quality-of-earnings) into generic buckets.
//
// Inputs (all optional — engine degrades gracefully when data absent):
//   • base attribution from lib/movers-attribution.ts
//   • delivery percentage from BHAVCOPY
//   • volume multiple vs 20-day average (when rolling stats blob present)
//   • turnover (₹ lakhs) for liquidity classification
//   • market cap for cap-aware downgrade rules
//
// Outputs:
//   • compositeScore (0-100): higher = more genuine, evidence-backed move
//   • primaryDriver + secondaryDriver (weighted attribution)
//   • sustainability: 'high' | 'medium' | 'low' — 1-week trade-quality estimate
//   • bucket: 'high_conviction' | 'turnaround_narrative' | 'speculative' | 'random_noise'
//   • narrative: 1-line analyst-style explanation
//   • chips: structured evidence chips (vol, delivery, sector)
// ═══════════════════════════════════════════════════════════════════════════

import type { MoverAttribution } from './movers-attribution';

export interface ScoringContext {
  attribution?: MoverAttribution;
  changePercent: number;
  marketCap?: number;          // ₹ crores
  indexGroup?: string;
  // Microstructure (optional — present when BHAVCOPY parsed cleanly)
  volume?: number;             // shares
  deliveryPct?: number | null; // 0-100
  turnoverLacs?: number;       // ₹ lakhs
  // Rolling stats (optional — present once scrape-rolling-stats workflow runs)
  vol20DAvg?: number;
  volMultiple?: number;        // volume / vol20DAvg
  mom1M?: number;              // 1-month relative return %
  pctOf52wHigh?: number;       // current price / 52w high
}

export interface CatalystScoring {
  compositeScore: number;      // 0-100
  primaryDriver: string;       // e.g. 'Q4 earnings beat'
  secondaryDriver?: string;    // e.g. 'Volume 3.2× 20D avg'
  tertiaryDriver?: string;     // e.g. 'EV sector momentum'
  bucket: 'high_conviction' | 'turnaround' | 'speculative' | 'random_noise' | 'circuit_event';
  sustainability: 'high' | 'medium' | 'low';
  narrative: string;           // 1-line summary
  chips: Array<{ text: string; tone: 'positive' | 'neutral' | 'negative' | 'event' }>;
}

// ─── Helpers ───────────────────────────────────────────────────────────

function fmtPct(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '?';
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function isCircuit(pct: number): boolean {
  const abs = Math.abs(pct);
  for (const limit of [5, 10, 20]) {
    if (Math.abs(abs - limit) < 0.2) return true;
  }
  return false;
}

// ─── Main scoring function ─────────────────────────────────────────────

export function scoreCatalyst(ctx: ScoringContext): CatalystScoring {
  const { attribution: attr, changePercent: pct, deliveryPct, volMultiple, marketCap } = ctx;
  const absPct = Math.abs(pct);
  const isUp = pct > 0;
  const smallcap = (ctx.indexGroup || '').toLowerCase() === 'small' || (ctx.indexGroup || '').toLowerCase() === 'micro';
  const microcap = (ctx.indexGroup || '').toLowerCase() === 'micro' || (typeof marketCap === 'number' && marketCap > 0 && marketCap < 500);

  let score = 0;
  let primaryDriver = '';
  let secondaryDriver: string | undefined;
  let tertiaryDriver: string | undefined;
  const chips: CatalystScoring['chips'] = [];

  // ─── Tier 1: confirmed trigger from base attribution ────────────────
  const cat = attr?.catalystType;
  const evSrc = attr?.evidenceSource;

  if (cat === 'EARNINGS') {
    score += 45;
    // Try to extract the growth blurb if present
    const sales = (attr as any)?.evidence?.salesYoy;
    const pat = (attr as any)?.evidence?.patYoy;
    const tier = attr?.catalyst.match(/(BLOCKBUSTER|STRONG|MIXED|AVOID|POOR|WEAK)/i)?.[1] || '';
    primaryDriver = tier ? `${tier} earnings reaction` : 'Earnings reaction';
    chips.push({ text: 'EARNINGS', tone: 'positive' });
    if (tier === 'BLOCKBUSTER' || tier === 'STRONG') {
      score += 10;
      chips.push({ text: tier, tone: 'positive' });
    }
  } else if (cat === 'ORDER_WIN') {
    score += 40;
    primaryDriver = 'Order/contract win';
    chips.push({ text: 'ORDER WIN', tone: 'positive' });
  } else if (cat === 'RATING') {
    score += 30;
    primaryDriver = 'Credit rating action';
    chips.push({ text: 'RATING', tone: /upgrade|positive/i.test(attr?.catalyst || '') ? 'positive' : 'neutral' });
  } else if (cat === 'MNA') {
    score += 35;
    primaryDriver = 'M&A / corporate action';
    chips.push({ text: 'M&A', tone: 'event' });
  } else if (cat === 'OFS' || cat === 'BLOCK_DEAL') {
    score += 25;
    primaryDriver = cat === 'OFS' ? 'OFS supply pressure' : 'Block deal flow';
    chips.push({ text: cat, tone: 'event' });
  } else if (cat === 'REGULATORY') {
    score += 20;
    primaryDriver = 'Regulatory disclosure';
    chips.push({ text: 'REGULATORY', tone: 'neutral' });
  }

  // ─── Tier 2: microstructure signals ─────────────────────────────────
  if (typeof volMultiple === 'number' && volMultiple > 0) {
    if (volMultiple >= 5) {
      score += 20;
      const t = `Vol ${volMultiple.toFixed(1)}× 20D`;
      if (!secondaryDriver) secondaryDriver = t;
      chips.push({ text: `VOL ${volMultiple.toFixed(1)}×`, tone: 'positive' });
    } else if (volMultiple >= 2.5) {
      score += 12;
      const t = `Vol ${volMultiple.toFixed(1)}× 20D`;
      if (!secondaryDriver) secondaryDriver = t;
      chips.push({ text: `VOL ${volMultiple.toFixed(1)}×`, tone: 'positive' });
    } else if (volMultiple >= 1.5) {
      score += 6;
      chips.push({ text: `Vol ${volMultiple.toFixed(1)}×`, tone: 'neutral' });
    } else if (volMultiple < 0.7) {
      score -= 6;
      chips.push({ text: 'low vol', tone: 'negative' });
    }
  }

  if (typeof deliveryPct === 'number') {
    if (deliveryPct >= 60) {
      score += 12;
      const t = `Delivery ${deliveryPct.toFixed(0)}% — accumulation`;
      if (!secondaryDriver) secondaryDriver = t;
      else if (!tertiaryDriver) tertiaryDriver = t;
      chips.push({ text: `Deliv ${deliveryPct.toFixed(0)}%`, tone: 'positive' });
    } else if (deliveryPct <= 20 && absPct >= 5) {
      score -= 10;
      chips.push({ text: `Deliv ${deliveryPct.toFixed(0)}%`, tone: 'negative' });
      if (!tertiaryDriver) tertiaryDriver = 'Low delivery — speculative flow';
    } else if (deliveryPct >= 40) {
      chips.push({ text: `Deliv ${deliveryPct.toFixed(0)}%`, tone: 'neutral' });
    }
  }

  // ─── Tier 3: momentum / breakout ────────────────────────────────────
  if (typeof ctx.pctOf52wHigh === 'number') {
    if (ctx.pctOf52wHigh >= 0.95 && isUp) {
      score += 8;
      if (!tertiaryDriver) tertiaryDriver = 'Near 52w high';
      chips.push({ text: 'Near 52w hi', tone: 'positive' });
    } else if (ctx.pctOf52wHigh <= 0.55 && !isUp) {
      chips.push({ text: 'Near 52w lo', tone: 'negative' });
    }
  }

  if (typeof ctx.mom1M === 'number') {
    if (!isUp && ctx.mom1M >= 15) {
      // Position unwind: stock had strong 1M run, now correcting
      if (!primaryDriver) primaryDriver = 'Position unwind after run-up';
      else if (!tertiaryDriver) tertiaryDriver = `1M momentum was +${ctx.mom1M.toFixed(0)}%`;
      chips.push({ text: '1M unwind', tone: 'neutral' });
    } else if (isUp && ctx.mom1M >= 20 && absPct >= 5) {
      if (!tertiaryDriver) tertiaryDriver = `1M momentum +${ctx.mom1M.toFixed(0)}%`;
      chips.push({ text: '1M strong', tone: 'positive' });
    }
  }

  // ─── Tier 4: penalties (operator / quality-of-move red flags) ──────
  if (microcap && absPct >= 15 && !primaryDriver) {
    // Big move on microcap with no confirmed trigger = speculative
    score -= 15;
    chips.push({ text: 'Microcap spike', tone: 'negative' });
  }
  if (isCircuit(pct) && !primaryDriver) {
    chips.push({ text: 'Circuit', tone: 'event' });
  }
  if (typeof marketCap === 'number' && marketCap > 0 && marketCap < 300 && absPct >= 10) {
    score -= 5;
    if (!chips.find(c => c.text.startsWith('Microcap'))) chips.push({ text: '<₹300Cr', tone: 'negative' });
  }

  // ─── Fill primary driver if still empty ─────────────────────────────
  if (!primaryDriver) {
    // No trigger detected from attribution; build from microstructure if rich
    if (typeof volMultiple === 'number' && volMultiple >= 2.5) {
      primaryDriver = isUp ? 'Volume-led momentum (no news)' : 'Volume-led unwind (no news)';
    } else if (absPct >= 15) {
      primaryDriver = isUp ? 'Speculative spike' : 'Sharp drawdown';
    } else if (smallcap) {
      primaryDriver = isUp ? 'Smallcap momentum' : 'Smallcap unwind';
    } else {
      primaryDriver = isUp ? 'Move without confirmed trigger' : 'Drop without confirmed trigger';
    }
  }

  // ─── Sector context (only if it adds info) ──────────────────────────
  const sectorMove = (attr as any)?.evidence?.sectorMovePct;
  const indexMove = (attr as any)?.evidence?.indexMovePct;
  if (typeof sectorMove === 'number' && typeof indexMove === 'number') {
    const sectorDelta = sectorMove - indexMove;
    if (Math.abs(sectorDelta) >= 1.5) {
      score += isUp === (sectorDelta > 0) ? 8 : 0;
      chips.push({
        text: `Sector ${fmtPct(sectorMove)}`,
        tone: sectorDelta > 0 ? 'positive' : 'negative',
      });
      if (!tertiaryDriver) tertiaryDriver = `Sector ${fmtPct(sectorMove)} vs index ${fmtPct(indexMove)}`;
    }
  }

  // ─── Cap composite at 0-100 ─────────────────────────────────────────
  score = Math.max(0, Math.min(100, score));

  // ─── Determine bucket ───────────────────────────────────────────────
  let bucket: CatalystScoring['bucket'];
  if (cat === 'OFS' || cat === 'BLOCK_DEAL' || cat === 'MNA' || (isCircuit(pct) && absPct >= 18)) {
    bucket = 'circuit_event';
  } else if (score >= 60 && (cat === 'EARNINGS' || cat === 'ORDER_WIN' || cat === 'RATING')) {
    bucket = 'high_conviction';
  } else if (cat === 'EARNINGS' && (typeof ctx.mom1M === 'number' && ctx.mom1M < 5) && isUp) {
    bucket = 'turnaround';
  } else if (microcap && absPct >= 10 && score < 40) {
    bucket = 'speculative';
  } else if (score < 30) {
    bucket = 'random_noise';
  } else {
    bucket = 'speculative';
  }

  // ─── Sustainability heuristic ──────────────────────────────────────
  let sustainability: CatalystScoring['sustainability'] = 'low';
  if (bucket === 'high_conviction') sustainability = 'high';
  else if (bucket === 'turnaround') sustainability = 'medium';
  else if (score >= 50) sustainability = 'medium';

  // ─── Build narrative ────────────────────────────────────────────────
  const parts: string[] = [primaryDriver];
  if (secondaryDriver) parts.push(secondaryDriver);
  if (tertiaryDriver) parts.push(tertiaryDriver);
  const narrative = parts.join('; ') + '.';

  return {
    compositeScore: Math.round(score),
    primaryDriver,
    secondaryDriver,
    tertiaryDriver,
    bucket,
    sustainability,
    narrative,
    chips: chips.slice(0, 4), // max 4 chips per row
  };
}

// ─── Bucket badge ──────────────────────────────────────────────────────

export const BUCKET_LABEL: Record<CatalystScoring['bucket'], string> = {
  high_conviction: 'HIGH CONVICTION',
  turnaround: 'TURNAROUND',
  speculative: 'SPECULATIVE',
  random_noise: 'NOISE',
  circuit_event: 'EVENT',
};

export const BUCKET_COLOR: Record<CatalystScoring['bucket'], string> = {
  high_conviction: '#10B981',
  turnaround: '#22D3EE',
  speculative: '#F59E0B',
  random_noise: '#6B7A8D',
  circuit_event: '#A78BFA',
};

export const SUSTAINABILITY_COLOR: Record<CatalystScoring['sustainability'], string> = {
  high: '#10B981',
  medium: '#22D3EE',
  low: '#F59E0B',
};

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
  // PATCH 0800 — Screener fundamentals (optional, refreshed weekly)
  promoterPct?: number | null;
  opmLatestQ?: number | null;
  opMargin3yAvg?: number | null;
  salesQtrYoY?: number | null;
  patQtrYoY?: number | null;
  exceptionalItemsFlag?: boolean;
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

  // PATCH 0892 — Use the DETAILED catalyst label produced by
  // classifyNewsCatalyst / earnings interpreter as the primary driver,
  // not a generic category word. classifyNewsCatalyst already extracts
  // specifics like "acquires 43% stake in Bliss GVS Pharma" / "bagged
  // ₹250 Cr order from BHEL" / "ICRA upgrades long-term rating" — those
  // are the institutional labels the user wants, not "M&A / corporate
  // action" / "Order/contract win" / "Credit rating action".
  //
  // Helper: a catalyst label is "detailed" if it's long enough to carry
  // specifics. Anything shorter than 15 chars is likely a category fallback.
  const isDetailed = (s?: string) => typeof s === 'string' && s.trim().length >= 15;
  const detail = attr?.catalyst || '';

  if (cat === 'EARNINGS') {
    score += 45;
    const tier = detail.match(/(BLOCKBUSTER|STRONG|MIXED|AVOID|POOR|WEAK)/i)?.[1] || '';
    // Prefer the detailed regex-emitted label ("Q4 results net profit jumps 38%"
    // or the BLOCKBUSTER tier text from the earnings engine).
    primaryDriver = isDetailed(detail) ? detail : (tier ? `${tier} earnings reaction` : 'Earnings reaction');
    chips.push({ text: 'EARNINGS', tone: 'positive' });
    if (tier === 'BLOCKBUSTER' || tier === 'STRONG') {
      score += 10;
      chips.push({ text: tier, tone: 'positive' });
    }
  } else if (cat === 'ORDER_WIN') {
    score += 40;
    // Use "bagged ₹250 Cr order from BHEL" when available
    primaryDriver = isDetailed(detail) ? detail : 'Order / contract win';
    chips.push({ text: 'ORDER WIN', tone: 'positive' });
  } else if (cat === 'RATING') {
    score += 30;
    // Use "credit rating upgrade" / "credit rating downgrade" / "outlook revision"
    primaryDriver = isDetailed(detail) ? detail : 'Credit rating action';
    chips.push({ text: 'RATING', tone: /upgrade|positive/i.test(detail) ? 'positive' : 'neutral' });
  } else if (cat === 'MNA') {
    score += 35;
    // Use "acquires 43% stake in Bliss GVS Pharma" / "buyback announcement" /
    // "preferential allotment" / "demerger / spin-off plan" / etc.
    primaryDriver = isDetailed(detail) ? detail : 'M&A / corporate action';
    chips.push({ text: 'M&A', tone: 'event' });
  } else if (cat === 'OFS' || cat === 'BLOCK_DEAL') {
    score += 25;
    // Use "promoter buying" / "block-deal sell" / "OFS / offer for sale" / etc.
    primaryDriver = isDetailed(detail) ? detail : (cat === 'OFS' ? 'OFS supply pressure' : 'Block deal flow');
    chips.push({ text: cat, tone: 'event' });
  } else if (cat === 'REGULATORY') {
    score += 20;
    // Use "USFDA approval / EIR" / "USFDA observation / warning" / "CDSCO" etc.
    primaryDriver = isDetailed(detail) ? detail : 'Regulatory disclosure';
    chips.push({ text: 'REGULATORY', tone: 'neutral' });
  } else if (cat === 'SECTOR_ROTATION') {
    // Don't lose sector-rotation signal; treat as a soft-positive driver
    score += 15;
    primaryDriver = detail || 'Sector-led move';
    chips.push({ text: 'SECTOR', tone: 'neutral' });
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

  // ─── PATCH 0800: Quality-of-earnings detection from Screener data ──
  // The SPARC case: PAT spiked but Sales fell — exceptional gain
  // dominated. Downgrade confidence + add explicit flag chip.
  if (ctx.exceptionalItemsFlag === true) {
    score -= 18;  // strong downgrade — fake earnings beat
    chips.push({ text: 'Exceptional gain', tone: 'negative' });
    if (!tertiaryDriver) tertiaryDriver = 'PAT spike likely from one-time gain';
  }
  // Margin compression even with revenue growth = weak earnings quality
  if (typeof ctx.opmLatestQ === 'number' && typeof ctx.opMargin3yAvg === 'number'
      && ctx.opmLatestQ < ctx.opMargin3yAvg - 3
      && typeof ctx.salesQtrYoY === 'number' && ctx.salesQtrYoY > 10) {
    score -= 8;
    chips.push({ text: 'OPM compression', tone: 'negative' });
  }
  // Promoter holding very low + microcap + extreme move = governance risk
  if (typeof ctx.promoterPct === 'number' && ctx.promoterPct < 25
      && microcap && absPct >= 10) {
    score -= 10;
    chips.push({ text: `Promoter ${ctx.promoterPct.toFixed(0)}%`, tone: 'negative' });
    if (!tertiaryDriver) tertiaryDriver = `Low promoter holding (${ctx.promoterPct.toFixed(0)}%)`;
  }
  // High-quality earnings boost: strong revenue + margin expansion
  if (typeof ctx.salesQtrYoY === 'number' && ctx.salesQtrYoY >= 20
      && typeof ctx.opmLatestQ === 'number' && typeof ctx.opMargin3yAvg === 'number'
      && ctx.opmLatestQ > ctx.opMargin3yAvg + 2
      && !ctx.exceptionalItemsFlag) {
    score += 10;
    chips.push({ text: 'OPM expansion', tone: 'positive' });
    if (!secondaryDriver) secondaryDriver = `Sales +${ctx.salesQtrYoY.toFixed(0)}% with margin expansion`;
  }

  // ─── Fill primary driver if still empty ─────────────────────────────
  // PATCH 0885 — Per user audit: "Stop using category words as final
  // output. Final output must always be causal sentence + mechanism."
  // The old labels ('Speculative spike', 'Smallcap momentum', 'Move
  // without confirmed trigger') are category words. Replace with
  // mechanism-aware honest sentences that name the absence of a
  // catalyst AND the dominant microstructure mechanism.
  if (!primaryDriver) {
    const sectorBasket = smallcap ? 'smallcap basket' : 'name';
    if (typeof volMultiple === 'number' && volMultiple >= 2.5) {
      // Heavy volume + no news = either operator rotation or institutional
      // accumulation. Without delivery data we can't fully disambiguate,
      // but the volume itself is the news.
      primaryDriver = isUp
        ? `volume-led ${sectorBasket} expansion (vol ${volMultiple.toFixed(1)}× 20D), no confirmed catalyst — likely operator rotation or pre-event positioning`
        : `volume-led ${sectorBasket} contraction (vol ${volMultiple.toFixed(1)}× 20D), no confirmed catalyst — likely positioning unwind`;
    } else if (absPct >= 15) {
      // Extreme move with no news + no volume → almost always thin-float
      // liquidity vacuum. State this explicitly.
      primaryDriver = isUp
        ? `thin-float expansion (${absPct.toFixed(0)}% on muted volume) — liquidity-driven repricing, no confirmed catalyst`
        : `thin-float contraction (${absPct.toFixed(0)}% on muted volume) — liquidity-driven repricing, no confirmed catalyst`;
    } else if (smallcap) {
      primaryDriver = isUp
        ? 'smallcap liquidity expansion, no confirmed peer cluster — likely retail-driven repricing'
        : 'smallcap liquidity contraction, no confirmed catalyst';
    } else {
      primaryDriver = isUp
        ? 'no confirmed catalyst detected — likely positional flow / sector micro-rotation'
        : 'no confirmed catalyst detected — likely position unwind / sector micro-rotation';
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

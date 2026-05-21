// ═══════════════════════════════════════════════════════════════════════════
// VALUATION CALCULATORS (PATCH 0628)
//
// Pure-function institutional valuation helpers. Three calculator families:
//   1. P/S target           — best for growth / SaaS / capex-heavy
//   2. P/E target            — best for FMCG, quality compounders
//   3. EV/EBITDA target     — best for cyclicals, industrials, leveraged
//
// Each takes management guidance + a multiple range and returns market cap
// projection + implied upside annualized over the horizon. Bear / base /
// bull cases derive from a multiple band.
//
// All values in INR Crore unless noted. The /valuations page consumes these.
// ═══════════════════════════════════════════════════════════════════════════

export interface ValuationInput {
  ticker?: string;
  company?: string;
  currentMarketCapCr: number;
  horizonMonths: number; // typically 12, 18, 24
}

export interface PSInput extends ValuationInput {
  forwardRevenueCr: number;  // FY27 / FY28 guidance revenue
  bearPS: number;            // e.g. 8
  basePS: number;            // 5-year median, e.g. 11.4
  bullPS: number;            // e.g. 15
}

export interface PEInput extends ValuationInput {
  forwardPATCr: number;      // FY27 PAT
  bearPE: number;            // e.g. 20
  basePE: number;            // 3yr median, e.g. 25
  bullPE: number;            // e.g. 30
}

export interface EvEbitdaInput extends ValuationInput {
  forwardEBITDACr: number;
  bearMultiple: number;
  baseMultiple: number;
  bullMultiple: number;
  netDebtCr?: number;        // subtract from EV to get equity value
}

export interface CalculatorCase {
  label: 'BEAR' | 'BASE' | 'BULL';
  marketCapCr: number;
  upsidePct: number;
  annualizedPct: number;
  color: string;
}

export interface CalculatorResult {
  ticker?: string;
  company?: string;
  cases: CalculatorCase[];
  baseSummary: string;       // one-liner
  inputs: any;
}

const annualize = (totalPct: number, months: number) => {
  if (months <= 0) return totalPct;
  // simple CAGR-style annualization
  const years = months / 12;
  const factor = 1 + totalPct / 100;
  if (factor <= 0) return totalPct;
  return (Math.pow(factor, 1 / years) - 1) * 100;
};

const colorFor = (pct: number) =>
  pct >= 50 ? '#10B981' : pct >= 25 ? '#22D3EE' : pct >= 0 ? '#F59E0B' : '#EF4444';

const buildCases = (label: 'BEAR' | 'BASE' | 'BULL', marketCapCr: number, current: number, months: number): CalculatorCase => {
  const upsidePct = ((marketCapCr - current) / current) * 100;
  return {
    label,
    marketCapCr,
    upsidePct,
    annualizedPct: annualize(upsidePct, months),
    color: colorFor(upsidePct),
  };
};

// ─── 1. P/S Calculator ──────────────────────────────────────────────────
export function calculatePS(input: PSInput): CalculatorResult {
  const { forwardRevenueCr, bearPS, basePS, bullPS, currentMarketCapCr, horizonMonths } = input;
  const cases: CalculatorCase[] = [
    buildCases('BEAR', forwardRevenueCr * bearPS, currentMarketCapCr, horizonMonths),
    buildCases('BASE', forwardRevenueCr * basePS, currentMarketCapCr, horizonMonths),
    buildCases('BULL', forwardRevenueCr * bullPS, currentMarketCapCr, horizonMonths),
  ];
  const base = cases.find(c => c.label === 'BASE')!;
  const baseSummary = `At base ${basePS.toFixed(1)}x P/S on ₹${forwardRevenueCr} Cr forward revenue → ₹${Math.round(base.marketCapCr).toLocaleString()} Cr market cap = ${base.upsidePct >= 0 ? '+' : ''}${base.upsidePct.toFixed(0)}% upside over ${horizonMonths} months (${base.annualizedPct >= 0 ? '+' : ''}${base.annualizedPct.toFixed(0)}% CAGR).`;
  return { ticker: input.ticker, company: input.company, cases, baseSummary, inputs: input };
}

// ─── 2. P/E Calculator ──────────────────────────────────────────────────
export function calculatePE(input: PEInput): CalculatorResult {
  const { forwardPATCr, bearPE, basePE, bullPE, currentMarketCapCr, horizonMonths } = input;
  const cases: CalculatorCase[] = [
    buildCases('BEAR', forwardPATCr * bearPE, currentMarketCapCr, horizonMonths),
    buildCases('BASE', forwardPATCr * basePE, currentMarketCapCr, horizonMonths),
    buildCases('BULL', forwardPATCr * bullPE, currentMarketCapCr, horizonMonths),
  ];
  const base = cases.find(c => c.label === 'BASE')!;
  const baseSummary = `At base ${basePE}x P/E on ₹${forwardPATCr} Cr forward PAT → ₹${Math.round(base.marketCapCr).toLocaleString()} Cr market cap = ${base.upsidePct >= 0 ? '+' : ''}${base.upsidePct.toFixed(0)}% upside over ${horizonMonths} months (${base.annualizedPct >= 0 ? '+' : ''}${base.annualizedPct.toFixed(0)}% CAGR).`;
  return { ticker: input.ticker, company: input.company, cases, baseSummary, inputs: input };
}

// ─── 3. EV/EBITDA Calculator ─────────────────────────────────────────────
export function calculateEvEbitda(input: EvEbitdaInput): CalculatorResult {
  const { forwardEBITDACr, bearMultiple, baseMultiple, bullMultiple, currentMarketCapCr, horizonMonths } = input;
  const netDebt = input.netDebtCr || 0;
  const buildEv = (mult: number) => Math.max(0, forwardEBITDACr * mult - netDebt);
  const cases: CalculatorCase[] = [
    buildCases('BEAR', buildEv(bearMultiple), currentMarketCapCr, horizonMonths),
    buildCases('BASE', buildEv(baseMultiple), currentMarketCapCr, horizonMonths),
    buildCases('BULL', buildEv(bullMultiple), currentMarketCapCr, horizonMonths),
  ];
  const base = cases.find(c => c.label === 'BASE')!;
  const baseSummary = `At base ${baseMultiple}x EV/EBITDA on ₹${forwardEBITDACr} Cr EBITDA${netDebt ? ` (net debt ₹${netDebt} Cr)` : ''} → equity value ₹${Math.round(base.marketCapCr).toLocaleString()} Cr = ${base.upsidePct >= 0 ? '+' : ''}${base.upsidePct.toFixed(0)}% upside over ${horizonMonths} months.`;
  return { ticker: input.ticker, company: input.company, cases, baseSummary, inputs: input };
}

// ─── WORKED EXAMPLES (from user's case studies) ─────────────────────────
// Used as defaults / examples in the UI so the user can see realistic
// inputs and tweak from there.
export const WORKED_EXAMPLES = {
  rubicon: {
    label: 'Rubicon Research — P/S, 18m',
    type: 'PS' as const,
    input: {
      ticker: 'RUBICON', company: 'Rubicon Research',
      currentMarketCapCr: 21000,
      horizonMonths: 18,
      forwardRevenueCr: 2995,
      bearPS: 8, basePS: 11.4, bullPS: 15,
    },
  },
  bajajConsumer: {
    label: 'Bajaj Consumer — P/E, 12m (FMCG)',
    type: 'PE' as const,
    input: {
      ticker: 'BAJAJCON', company: 'Bajaj Consumer Care',
      currentMarketCapCr: 2700,
      horizonMonths: 12,
      forwardPATCr: 190,
      bearPE: 20, basePE: 24, bullPE: 30,
    },
  },
  tdPower: {
    label: 'TD Power — P/E on FY27, 18m',
    type: 'PE' as const,
    input: {
      ticker: 'TDPOWERSYS', company: 'TD Power Systems',
      currentMarketCapCr: 8000,
      horizonMonths: 18,
      forwardPATCr: 400,
      bearPE: 30, basePE: 44.4, bullPE: 55,
    },
  },
  sterlite: {
    label: 'Sterlite — P/E with AI re-rating, 18m',
    type: 'PE' as const,
    input: {
      ticker: 'STRTECH', company: 'Sterlite Technologies',
      currentMarketCapCr: 12000,
      horizonMonths: 18,
      forwardPATCr: 400,
      bearPE: 30, basePE: 48, bullPE: 60,
    },
  },
  aeroflex: {
    label: 'Aeroflex — P/E on FY27, 18m',
    type: 'PE' as const,
    input: {
      ticker: 'AEROFLEX', company: 'Aeroflex Industries',
      currentMarketCapCr: 5047,
      horizonMonths: 18,
      forwardPATCr: 95,
      bearPE: 45, basePE: 60, bullPE: 80,
    },
  },
  atlantaElectricals: {
    label: 'Atlanta Electricals — P/E on FY27, 18m',
    type: 'PE' as const,
    input: {
      ticker: 'ATLANTAELE', company: 'Atlanta Electricals',
      currentMarketCapCr: 12000,
      horizonMonths: 18,
      forwardPATCr: 335,
      bearPE: 28, basePE: 36, bullPE: 50,
    },
  },
  deeDev: {
    label: 'DEE Development — P/E on FY27 management guidance',
    type: 'PE' as const,
    input: {
      ticker: 'DEEDEV', company: 'DEE Development Engineers',
      currentMarketCapCr: 3136,
      horizonMonths: 18,
      forwardPATCr: 100,           // 18-19% EBITDA margin on ₹1500 Cr -> ₹270 Cr EBITDA -> ~₹100 Cr PAT
      bearPE: 25, basePE: 35, bullPE: 50,
    },
  },
};

// ─── Sector → recommended calculator ────────────────────────────────────
export const SECTOR_CALCULATOR_MAP: Record<string, { calc: 'PS' | 'PE' | 'EV_EBITDA'; multipleHint: string }> = {
  'Industrials / Capital Goods':  { calc: 'PE',         multipleHint: 'PE 25-45x · cycle peaks compress to 18-22x' },
  'Defence':                      { calc: 'PE',         multipleHint: 'PE 30-50x · order-book backed' },
  'Power / Transmission':         { calc: 'EV_EBITDA',  multipleHint: 'EV/EBITDA 18-28x · capex cycle' },
  'Pharmaceuticals':              { calc: 'PE',         multipleHint: 'PE 30-45x · USFDA premium' },
  'Specialty Chemicals':          { calc: 'EV_EBITDA',  multipleHint: 'EV/EBITDA 20-30x · CDMO premium' },
  'Consumer Durables / FMCG':     { calc: 'PE',         multipleHint: 'PE 40-70x · quality moat' },
  'Auto Components':              { calc: 'EV_EBITDA',  multipleHint: 'EV/EBITDA 12-18x · cycle-midpoint' },
  'Financial Services / NBFC':    { calc: 'PE',         multipleHint: 'PE 18-28x · ROE-linked' },
  'IT / Tech Services':           { calc: 'PE',         multipleHint: 'PE 20-35x · USD growth' },
  'SaaS / Software (US)':         { calc: 'PS',         multipleHint: 'P/S 8-25x · Rule of 40' },
  'Pre-revenue / Growth':         { calc: 'PS',         multipleHint: 'P/S only — earnings noisy or negative' },
};

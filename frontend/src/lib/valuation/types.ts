// ═══════════════════════════════════════════════════════════════════════════
// VALUATION ENGINE — types
//
// All currency values in INR Crores unless noted. Per-share values in INR.
// Growth rates and margins as percent points (e.g. 25 means 25%).
// ═══════════════════════════════════════════════════════════════════════════

export type Scenario = 'bear' | 'base' | 'bull';

/** Inputs extracted from an ExcelResult row (or manually filled). */
export interface ValuationInputs {
  // Identity
  symbol: string;
  company?: string;
  sector?: string;
  sectorBucket?: SectorBucket;  // derived from sector text

  // Market data
  cmp?: number;                 // ₹ current market price
  marketCapCr?: number;         // ₹ Cr
  sharesCr?: number;            // derived: marketCapCr / cmp × 1 (since MCap in Cr, CMP in ₹)
  enterpriseValueCr?: number;   // ₹ Cr
  netDebtCr?: number;           // = EV − MCap (derived if both present)

  // Profitability (annual)
  salesCr?: number;             // last 12m revenue
  ebitCr?: number;              // EBIT
  ebitdaCr?: number;            // = OPM × Sales / 100 (derived if not direct)
  patCr?: number;               // ≈ EPS × shares
  fcfCr?: number;               // free cash flow last year
  eps?: number;                 // ₹ per share
  bookValuePerShare?: number;   // ₹ per share

  // Multiples
  pe?: number;
  peg?: number;
  pb?: number;
  evEbitda?: number;
  industryPe?: number;          // sector P/E reference
  historicalPe5y?: number;      // own 5y median P/E

  // Margins
  opm?: number;                 // current TTM OPM %
  opm5y?: number;               // 5y avg OPM %
  opmPrev?: number;             // last year OPM %
  gpm?: number;                 // gross profit margin %

  // Growth (percent points)
  salesGrowth3y?: number;       // 3y revenue CAGR
  profitGrowth3y?: number;      // 3y profit CAGR
  yoySalesGrowth?: number;      // latest qtr YOY
  yoyProfitGrowth?: number;     // latest qtr YOY
  epsGrowth?: number;
  salesGrowthTtm?: number;      // sales growth (last year)

  // Quality / governance
  roe?: number;
  roce?: number;
  roic?: number;
  cfoToPat?: number;
  promoter?: number;
  pledge?: number;
  de?: number;                  // debt/equity
  icr?: number;                 // interest coverage
  effectiveTaxRate?: number;    // %

  // Manual guidance (from concall paste or user input)
  guidanceGrowth?: number;      // 5y expected growth %
  guidanceEbitdaMargin?: number;// target EBITDA margin %
  guidanceRevenueTarget?: number; // ₹ Cr target by year N
  guidanceFiscalYear?: string;  // 'FY26' / 'FY27' etc.
  guidanceConfidence?: 'HIGH' | 'MEDIUM' | 'LOW';
}

/** Output of a single valuation model. */
export interface ModelOutput {
  /** Model id — stable, used in UI labels */
  modelId: string;
  /** Display name */
  label: string;
  /** Whether this model is meaningfully applicable to this stock */
  applicable: boolean;
  /** Reason if not applicable (e.g. 'loss-making', 'pre-revenue', 'bank-only') */
  reason?: string;
  /** Per-share fair value — bear/base/bull */
  bear?: number;
  base?: number;
  bull?: number;
  /** % vs current market price — based on `base` scenario */
  marginOfSafety?: number;
  /** Extra free-form line (e.g. 'g_implied = 11%' for reverse DCF) */
  detail?: string;
  /** Assumptions used (for the row-expand panel transparency strip) */
  assumptionsUsed?: Record<string, number | string>;
}

/** Consensus across all applicable models. */
export interface ValuationConsensus {
  /** Median of `base` values from applicable models. */
  fairValueBase?: number;
  /** P25 / P75 across all bear+base+bull values from applicable models. */
  fairValueBear?: number;     // P25 across all scenarios
  fairValueBull?: number;     // P75 across all scenarios
  /** Margin of safety vs CMP, using fairValueBase. */
  marginOfSafety?: number;
  /** How many models marked the stock undervalued (base > CMP × 1.05) */
  modelsBuy: number;
  /** How many models gave a valid base */
  modelsApplicable: number;
  /** Verdict — one of UNDERVALUED / FAIR / OVERVALUED / INSUFFICIENT_DATA. */
  verdict: 'UNDERVALUED' | 'FAIR' | 'OVERVALUED' | 'INSUFFICIENT_DATA';
  /** Distance between bull and bear (as % of base) — wider = more uncertain. */
  spreadPct?: number;
}

/** Full valuation report for one stock. */
export interface ValuationReport {
  symbol: string;
  company?: string;
  cmp?: number;
  models: ModelOutput[];
  consensus: ValuationConsensus;
  /** When this was computed (epoch ms). */
  computedAt: number;
}

/** Sector buckets for default assumptions. */
export type SectorBucket =
  | 'BANKS_NBFC'
  | 'IT_SOFTWARE'
  | 'IT_SERVICES'
  | 'PHARMA_HEALTHCARE'
  | 'SPECIALTY_CHEM'
  | 'CONSUMER_STAPLE'
  | 'CONSUMER_DISCRETIONARY'
  | 'AUTO_AUTO_COMP'
  | 'CAPITAL_GOODS'
  | 'INDUSTRIAL'
  | 'INFRA_POWER'
  | 'CYCLICAL_METAL'
  | 'CEMENT'
  | 'REALTY'
  | 'TELECOM'
  | 'OIL_GAS'
  | 'FINANCIAL_OTHER'
  | 'DEFAULT';

export interface SectorAssumption {
  bucket: SectorBucket;
  /** WACC base case (decimal — 0.12 = 12%) */
  wacc: number;
  /** Terminal growth rate (decimal) */
  terminalGrowth: number;
  /** Cost of equity for justified-PE / P/B-ROE */
  costOfEquity: number;
  /** Exit P/E (base case) for forward-EPS valuations */
  exitPe: number;
  /** Exit EV/EBITDA (base case) */
  exitEvEbitda: number;
  /** Whether DCF is the right primary lens (false for banks) */
  dcfApplicable: boolean;
  /** Whether to add the P/B–ROE model (banks/NBFCs) */
  pbRoeApplicable: boolean;
}

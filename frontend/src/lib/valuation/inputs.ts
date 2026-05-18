// ═══════════════════════════════════════════════════════════════════════════
// VALUATION ENGINE — input extraction from ExcelResult rows
//
// Maps the Multibagger row shape (already-parsed Screener export) into a
// ValuationInputs object the models can consume. Also pulls auxiliary fields
// from the raw row (the Screener export has 60+ columns; only ~25 are
// promoted to ExcelRow today). We read the rest via the `_raw` attachment
// when present.
// ═══════════════════════════════════════════════════════════════════════════

import { classifySector } from './assumptions';
import type { ValuationInputs } from './types';

/** Any object with the basic Multibagger row fields. Untyped here to avoid
 *  a circular import on the page-component types. */
export type AnyRow = Record<string, any>;

/** Get a number from a row, accepting various optional keys. */
function num(row: AnyRow, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = row[k];
    if (v === null || v === undefined || v === '') continue;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[%,₹ ]/g, ''));
    if (!isNaN(n)) return n;
  }
  return undefined;
}

/** Extract ValuationInputs from an ExcelResult row (and any attached _raw). */
export function extractInputs(row: AnyRow): ValuationInputs {
  const raw: AnyRow = row._raw || row.raw || {};
  const cmp = num(row, 'price', 'cmp', 'currentPrice') ?? num(raw, 'Current Price');
  const mcap = num(row, 'marketCapCr', 'marketCap') ?? num(raw, 'Market Capitalization');
  const sharesCr = (cmp && mcap && cmp > 0) ? (mcap / cmp) : undefined; // ₹ Cr / ₹ = Cr shares
  const ev = num(raw, 'Enterprise Value', 'EV');
  const netDebt = ev !== undefined && mcap !== undefined ? (ev - mcap) : num(row, 'netDebt');

  const eps = num(row, 'eps') ?? num(raw, 'EPS');
  const bvps = num(raw, 'Book value', 'Book Value', 'Book Value per Share', 'BVPS');
  const pe = num(row, 'pe') ?? num(raw, 'Price to Earning');
  const peg = num(row, 'peg') ?? num(raw, 'PEG Ratio');
  const pb = num(row, 'pb') ?? num(raw, 'Price to book value');
  const evEbitda = num(row, 'evEbitda') ?? num(raw, 'EVEBITDA', 'EV/EBITDA', 'EV / EBITDA');
  const industryPe = num(raw, 'Industry PE', 'Industry P/E');
  const historicalPe5y = num(raw, 'Historical PE 5Years', 'Historical PE 5 Years');

  const sales = num(raw, 'Sales');
  // OPM: prefer 5y average for stability; fall back to current
  const opm = num(row, 'opm') ?? num(raw, 'OPM');
  const opm5y = num(raw, 'OPM 5Year', 'OPM 5 Year', 'OPM 5Y');
  const opmPrev = num(row, 'opmPrev') ?? num(raw, 'OPM last year', 'OPM preceding year');

  // EBITDA: prefer direct; derive from OPM × Sales otherwise
  let ebitda = num(row, 'ebitda') ?? num(raw, 'EBITDA');
  if (ebitda === undefined && sales !== undefined && opm !== undefined) {
    ebitda = sales * (opm / 100);
  }
  const ebit = num(raw, 'EBIT');

  const fcf = num(row, 'fcfAbsolute') ?? num(raw, 'Free cash flow last year', 'Free Cash Flow', 'FCF');
  const pat = (eps !== undefined && sharesCr !== undefined) ? eps * sharesCr : undefined;

  // Growth — prefer 3y CAGR for stability, fall back to TTM/YOY
  const salesGrowth3y = num(row, 'salesGrowth3y') ?? num(raw, 'Sales growth 3Years', 'Sales growth 3 Years');
  const profitGrowth3y = num(raw, 'Profit growth 3Years', 'Profit growth 3 Years');
  const yoySales = num(row, 'yoySalesGrowth') ?? num(raw, 'YOY Quarterly sales growth');
  const yoyProfit = num(row, 'yoyProfitGrowth') ?? num(raw, 'YOY Quarterly profit growth');
  const salesTtm = num(row, 'revCagr') ?? num(raw, 'Sales growth');

  const roe = num(row, 'roe') ?? num(raw, 'Return on equity');
  const roce = num(row, 'roce') ?? num(raw, 'Return on capital employed');
  const roic = num(row, 'roic') ?? num(raw, 'Return on invested capital');
  const taxRate = num(row, 'effectiveTaxRate') ?? num(raw, 'Tax rate %', 'Effective tax rate');

  return {
    symbol: row.symbol || raw['NSE Code'] || raw['BSE Code'] || '',
    company: row.company || raw['Name'],
    sector: row.sector || raw['Industry'] || raw['Industry Group'],
    sectorBucket: classifySector(row.sector || raw['Industry'] || raw['Industry Group']),

    cmp,
    marketCapCr: mcap,
    sharesCr,
    enterpriseValueCr: ev,
    netDebtCr: netDebt,

    salesCr: sales,
    ebitCr: ebit,
    ebitdaCr: ebitda,
    patCr: pat,
    fcfCr: fcf,
    eps,
    bookValuePerShare: bvps,

    pe,
    peg,
    pb,
    evEbitda,
    industryPe,
    historicalPe5y,

    opm,
    opm5y,
    opmPrev,
    gpm: num(row, 'gpm') ?? num(raw, 'GPM latest quarter', 'Gross profit margin'),

    salesGrowth3y,
    profitGrowth3y,
    yoySalesGrowth: yoySales,
    yoyProfitGrowth: yoyProfit,
    epsGrowth: num(row, 'epsGrowth') ?? num(raw, 'EPS growth'),
    salesGrowthTtm: salesTtm,

    roe,
    roce,
    roic,
    cfoToPat: num(row, 'cfoToPat') ?? num(raw, 'CFO to PAT'),
    promoter: num(row, 'promoter') ?? num(raw, 'Promoter holding'),
    pledge: num(row, 'pledge') ?? num(raw, 'Pledged percentage'),
    de: num(row, 'de') ?? num(raw, 'Debt to equity'),
    icr: num(row, 'interestCoverage') ?? num(raw, 'Interest Coverage Ratio'),
    effectiveTaxRate: taxRate,
  };
}

/** Build a Bull/Base/Bear distribution for a single numeric assumption.
 *  This is the institutional bit — every assumption gets 3 points so the
 *  three scenarios stay coherent across models. */
export function scenarioBand(base: number, opts: { bearMult?: number; bullMult?: number } = {}): {
  bear: number; base: number; bull: number;
} {
  return {
    bear: base * (opts.bearMult ?? 0.75),
    base,
    bull: base * (opts.bullMult ?? 1.25),
  };
}

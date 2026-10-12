// zzz966 — "growth vs valuation vs return" arithmetic for the Valuation Calculator's Learn tab.
// Pure functions; every number on the lesson cards and in the Return Lab comes from here.

export interface ReturnInputs {
  price: number;          // today's price (or market cap — same maths)
  eps0: number;           // last full-year EPS (or PAT)
  growthPct: number;      // yearly EPS growth, %
  years: number;          // holding period
  exitPe: number;         // P/E applied at the exit year to that year's EPS (trailing exit multiple)
  hurdlePct: number;      // the yearly return you want, %
  dilutionPct?: number;   // yearly increase in share count, % (cuts EPS growth)
  dividendYieldPct?: number; // yearly dividend yield on today's price, % (added to the price return, simple approximation)
}
export interface YearRow { year: number; eps: number; peOnToday: number }
export interface ReturnResult {
  path: YearRow[];
  entryPe: number;
  exitEps: number;
  exitPrice: number;
  priceMultiple: number;
  epsMultiple: number;
  peRatio: number;               // exit P/E ÷ entry P/E
  priceCagrPct: number;
  totalCagrPct: number;          // price CAGR + dividend yield
  hurdleEntryPrice: number;      // the price that earns the hurdle if the forecast and exit P/E come true
  requiredEpsCagrPct: number;    // EPS growth needed to earn the hurdle from TODAY's price at the same exit P/E
  verdict: 'ok' | 'thin' | 'insufficient';
}

export const cagr = (multiple: number, years: number) => (multiple > 0 && years > 0 ? (Math.pow(multiple, 1 / years) - 1) * 100 : NaN);

export function returnFromToday(i: ReturnInputs): ReturnResult {
  const g = i.growthPct / 100, d = (i.dilutionPct ?? 0) / 100;
  const perShare = (1 + g) / (1 + d);
  const path: YearRow[] = [];
  for (let y = 0; y <= i.years; y++) {
    const eps = i.eps0 * Math.pow(perShare, y);
    path.push({ year: y, eps, peOnToday: eps > 0 ? i.price / eps : NaN });
  }
  const exitEps = path[path.length - 1].eps;
  const exitPrice = exitEps * i.exitPe;
  const entryPe = i.eps0 > 0 ? i.price / i.eps0 : NaN;
  const priceMultiple = exitPrice / i.price;
  const epsMultiple = exitEps / i.eps0;
  const priceCagrPct = cagr(priceMultiple, i.years);
  const totalCagrPct = priceCagrPct + (i.dividendYieldPct ?? 0);
  const h = i.hurdlePct / 100;
  const hurdleEntryPrice = exitPrice / Math.pow(1 + h, i.years);
  // needed EPS multiple = (1+h)^N × entry P/E ÷ exit P/E ; per-share growth then grossed up for dilution
  const neededEpsMult = Math.pow(1 + h, i.years) * entryPe / i.exitPe;
  const requiredEpsCagrPct = (Math.pow(neededEpsMult, 1 / i.years) * (1 + d) - 1) * 100;
  const verdict = totalCagrPct >= i.hurdlePct ? 'ok' : totalCagrPct >= i.hurdlePct * 0.6 ? 'thin' : 'insufficient';
  return { path, entryPe, exitEps, exitPrice, priceMultiple, epsMultiple, peRatio: i.exitPe / entryPe, priceCagrPct, totalCagrPct, hurdleEntryPrice, requiredEpsCagrPct, verdict };
}

/** Revenue → PAT → diluted EPS: the multiplier on each, from revenue growth, a net-margin step and share dilution. */
export function guidanceToEps(revGrowthPct: number, marginFromPct: number, marginToPct: number, dilutionPct: number) {
  const pat = (1 + revGrowthPct / 100) * (marginToPct / marginFromPct);
  const eps = pat / (1 + dilutionPct / 100);
  return { revenueGrowthPct: revGrowthPct, patGrowthPct: (pat - 1) * 100, epsGrowthPct: (eps - 1) * 100 };
}

/** P/E implied by a P/S multiple at a given net margin (same period on both). */
export const impliedPe = (ps: number, netMarginPct: number) => ps / (netMarginPct / 100);

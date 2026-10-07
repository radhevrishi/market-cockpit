// zzz938 — USA company figures for the screener from SEC "frames" (one free file per figure per period, covering every filer).
// Pure: the server fetches the frame files (lib/screener/us-build.ts) and hands them here as plain maps.
//
// Facts worth knowing:
//   • a frame is a CALENDAR period (CY2026Q2 = the 3 months best matching Apr–Jun 2026); companies with other fiscal years are mapped in;
//   • almost nobody files a 3-month 4th quarter (it is inside the 10-K), so Q4 is worked out as FULL YEAR − Q1 − Q2 − Q3 when all four
//     are filed and their dates line up;
//   • revenue is filed under several names; for a growth figure the name that has BOTH periods and the larger value is used;
//   • EBITDA is never filed: operating profit + depreciation where depreciation is filed for that quarter, otherwise operating profit
//     alone (marked approximate).

export interface FrameEntry { v: number; s?: string; e?: string }
/** concept → period label (CY2026Q2 / CY2025 / CY2026Q2I) → cik → entry */
export type FrameData = Record<string, Record<string, Record<number, FrameEntry>>>;

// (banks: 'RevenuesNetOfInterestExpense' — zzz948)
export const REV = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet', 'RevenuesNetOfInterestExpense'];
export const COGS = ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization'];
export const GP = ['GrossProfit'];
export const OPI = ['OperatingIncomeLoss'];
export const DDA = ['DepreciationDepletionAndAmortization', 'DepreciationAndAmortization'];
// diluted EPS from continuing operations first (TradingView's figure — a sale of a business does not count as growth), else total
export const EPS = ['IncomeLossFromContinuingOperationsPerDilutedShare', 'EarningsPerShareDiluted'];
export const WSH = ['WeightedAverageNumberOfDilutedSharesOutstanding'];
export const EQ = ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'];
export const DEBT_TOTAL = ['LongTermDebt'];
export const DEBT_NONCUR = ['LongTermDebtNoncurrent'];
export const DEBT_CUR = ['LongTermDebtCurrent', 'DebtCurrent'];
export const STB = ['ShortTermBorrowings'];
// zzz948: TradingView's total debt also counts leases (checked on CON: 4.49 = (debt + capital leases + operating leases) ÷ equity)
export const DEBT_CL = ['LongTermDebtAndCapitalLeaseObligations'];
export const DEBT_CL_CUR = ['LongTermDebtAndCapitalLeaseObligationsCurrent'];
export const OPLEASE = ['OperatingLeaseLiability'];
export const OPLEASE_PARTS = ['OperatingLeaseLiabilityNoncurrent', 'OperatingLeaseLiabilityCurrent'];
export const FINLEASE = ['FinanceLeaseLiability'];
export const CASH = ['CashAndCashEquivalentsAtCarryingValue'];
/** zzz955 — used only when the line above is not filed: many filers (CSX, Copart, Biogen…) report cash only with restricted cash
 *  included, banks report "cash and due from banks", a few report plain "Cash". Without these their EV and cash filters were blank. */
export const CASH_ALT = ['CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'CashAndDueFromBanks', 'Cash'];
// zzz948 — more figures for the owner's full set of screens
// net income: the first one filed, in this order (Broadcom / Caterpillar file only the second or third)
export const NI = ['NetIncomeLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic', 'ProfitLoss'];
export const PRETAX = ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments'];
export const CFO = ['NetCashProvidedByUsedInOperatingActivities'];
export const CAPEX = ['PaymentsToAcquirePropertyPlantAndEquipment'];
export const ASSETS = ['Assets'];
export const LIAB = ['Liabilities'];
export const ASSETS_CUR = ['AssetsCurrent'];
export const LIAB_CUR = ['LiabilitiesCurrent'];
export const CASH_STI = ['CashCashEquivalentsAndShortTermInvestments'];
export const SHARES_OUT = ['CommonStockSharesOutstanding'];
export const STI = ['ShortTermInvestments', 'MarketableSecuritiesCurrent', 'AvailableForSaleSecuritiesDebtSecuritiesCurrent'];

/** Which frames to download: [concept, taxonomy, unit, kind]. kind q = quarterly + annual durations, a = annual only, i = instants. */
const fq = (c: string, unit = 'USD') => [c, 'us-gaap', unit, 'q'] as [string, 'us-gaap', string, 'q'];
const fa = (c: string, unit = 'USD') => [c, 'us-gaap', unit, 'a'] as [string, 'us-gaap', string, 'a'];
const fi = (c: string, unit = 'USD') => [c, 'us-gaap', unit, 'i'] as [string, 'us-gaap', string, 'i'];
export const FRAME_PLAN: ReadonlyArray<[string, 'us-gaap' | 'dei', string, 'q' | 'a' | 'i']> = [
  ...REV.map((c) => fq(c)), ...COGS.map((c) => fq(c)), fq('GrossProfit'), fq('OperatingIncomeLoss'), ...DDA.map((c) => fq(c)),
  ...EPS.map((c) => fq(c, 'USD-per-shares')), ...NI.map((c) => fq(c)), ...PRETAX.map((c) => fq(c)),
  fa('WeightedAverageNumberOfDilutedSharesOutstanding', 'shares'), ...CFO.map((c) => fa(c)), ...CAPEX.map((c) => fa(c)),
  ...[...EQ, ...DEBT_TOTAL, ...DEBT_NONCUR, ...DEBT_CUR, ...STB, ...DEBT_CL, ...DEBT_CL_CUR, ...OPLEASE, ...OPLEASE_PARTS, ...FINLEASE, ...CASH, ...CASH_ALT, ...CASH_STI, ...STI, ...ASSETS, ...LIAB, ...ASSETS_CUR, ...LIAB_CUR].map((c) => fi(c)),
  ...SHARES_OUT.map((c) => fi(c, 'shares')),
];

// ── periods ────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface Q { y: number; q: number }
export const qLabel = (x: Q) => `CY${x.y}Q${x.q}`;
export const qShift = (x: Q, k: number): Q => { const i = x.y * 4 + (x.q - 1) + k; return { y: Math.floor(i / 4), q: (i % 4) + 1 }; };
/** The quarter that ended most recently before `now` (on 7 Oct 2026 → Q3 2026). */
export function lastEndedQuarter(now: Date): Q {
  const m = now.getUTCMonth();   // 0..11
  const cur: Q = { y: now.getUTCFullYear(), q: Math.floor(m / 3) + 1 };
  return qShift(cur, -1);
}
/** Quarter labels to download, newest first (13 quarters: two TTM spans plus the quarters a worked-out 4th quarter needs), the annual years and the instants. */
export function framePeriods(now: Date, nq = 13): { quarters: string[]; years: string[]; instants: string[] } {
  const last = lastEndedQuarter(now);
  const quarters = Array.from({ length: nq }, (_, i) => qLabel(qShift(last, -i)));
  const y = last.y;
  const years = [y, y - 1, y - 2, y - 3].map((v) => `CY${v}`);
  // 9 quarter-ends: the latest, a year ago, and the last two fiscal year-ends (for the F-score) whatever the fiscal year
  const instants = Array.from({ length: 9 }, (_, i) => `${qLabel(qShift(last, -i))}I`);
  return { quarters, years, instants };
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const r1 = (v: number) => Math.round(v * 10) / 10;
/** Growth % as TradingView works it (checked on FSLY / CRWD / ROKU): (now − before) ÷ |before| — a loss shrinking from −0.26 to −0.10
 *  is +61.5%; none from a zero base, and none when a loss turns into a profit (TradingView leaves that empty). */
export const grow = (now: number, before: number): number | null => (fin(now) && fin(before) && before !== 0 && !(before < 0 && now > 0) ? r1(((now - before) / Math.abs(before)) * 100) : null);
const DAY = 86_400_000;
const days = (a?: string, b?: string) => (a && b ? (Date.parse(b) - Date.parse(a)) / DAY : NaN);

/** The calendar-quarter label SEC frames give a 3-month period ending on `end` (the quarter holding its midpoint). */
export function quarterLabelForEnd(end: string): string | null {
  const t = Date.parse(end);
  if (!Number.isFinite(t)) return null;
  const mid = new Date(t - 45 * DAY);
  return `CY${mid.getUTCFullYear()}Q${Math.floor(mid.getUTCMonth() / 3) + 1}`;
}

/** One concept's 3-month values for one company. The quarter a company does not file on its own (the last quarter of its fiscal
 *  year — inside the 10-K) is worked out as FULL YEAR − the other three quarters, when those three are filed and lie inside that year. */
export function quarterSeries(fd: FrameData, concept: string, cik: number, quarters: string[]): Map<string, { v: number; derived: boolean }> {
  const out = new Map<string, { v: number; derived: boolean }>();
  const c = fd[concept] || {};
  const filed: Array<{ p: string; v: number; s?: string; e?: string }> = [];
  for (const p of Object.keys(c)) {
    if (!/^CY\d{4}Q\d$/.test(p)) continue;
    const e = c[p]?.[cik];
    if (e && fin(e.v)) filed.push({ p, v: e.v, s: e.s, e: e.e });
  }
  for (const f of filed) if (quarters.includes(f.p)) out.set(f.p, { v: f.v, derived: false });
  for (const y of Object.keys(c)) {
    if (!/^CY\d{4}$/.test(y)) continue;
    const ann = c[y]?.[cik];
    if (!ann || !fin(ann.v) || !ann.s || !ann.e) continue;
    const span = days(ann.s, ann.e);
    if (!(span > 340 && span < 380)) continue;
    const inside = filed.filter((f) => f.s && f.e && days(ann.s, f.s) >= -20 && days(f.e, ann.e) >= -5 && days(f.s, f.e) < 120);
    if (inside.length !== 3) continue;
    const lastEnd = inside.map((f) => Date.parse(f.e as string)).sort((a, b) => b - a)[0];
    const gap = (Date.parse(ann.e) - lastEnd) / DAY;
    if (!(gap >= 70 && gap <= 110)) continue;   // the missing quarter must be the year's last one
    const label = quarterLabelForEnd(ann.e);
    if (!label || out.has(label) || !quarters.includes(label)) continue;
    out.set(label, { v: ann.v - inside.reduce((a, f) => a + f.v, 0), derived: true });
  }
  return out;
}

/** growth % between two periods of the first concept (of several) that has both; the largest current value wins. Base must be > 0. */
function growthOver(fd: FrameData, concepts: string[], cik: number, cur: string, prev: string, quarters: string[], annual = false): number | null {
  let best: { v: number; g: number } | null = null;
  for (const c of concepts) {
    let a: number | undefined, b: number | undefined;
    if (annual) { a = fd[c]?.[cur]?.[cik]?.v; b = fd[c]?.[prev]?.[cik]?.v; }
    else { const s = quarterSeries(fd, c, cik, quarters); a = s.get(cur)?.v; b = s.get(prev)?.v; }
    if (!fin(a) || !fin(b) || b === 0) continue;
    const g = grow(a, b) as number;
    if (!best || a > best.v) best = { v: a, g };
  }
  return best ? best.g : null;
}
function valueAt(fd: FrameData, concepts: string[], cik: number, period: string): number | null {
  let best: number | null = null;
  for (const c of concepts) { const v = fd[c]?.[period]?.[cik]?.v; if (fin(v) && (best == null || v > best)) best = v; }
  return best;
}
function sumLast4(fd: FrameData, concepts: string[], cik: number, from: string, quarters: string[], firstFiled = false): number | null {
  const i = quarters.indexOf(from);
  if (i < 0 || i + 4 > quarters.length) return null;
  let best: number | null = null;
  for (const c of concepts) {
    const s = quarterSeries(fd, c, cik, quarters);
    const vals = quarters.slice(i, i + 4).map((p) => s.get(p)?.v);
    if (!vals.every(fin)) continue;
    const sum = (vals as number[]).reduce((a, b) => a + b, 0);
    if (firstFiled) return sum;
    if (best == null || sum > best) best = sum;
  }
  return best;
}
function firstAt(fd: FrameData, concepts: string[], cik: number, period: string): number | null {
  for (const c of concepts) { const v = fd[c]?.[period]?.[cik]?.v; if (fin(v)) return v; }
  return null;
}


export interface UsFigures {
  q: string | null; revQYoY: number | null; revAYoY: number | null; gpQYoY: number | null; gmFY: number | null;
  ebitdaQoQ: number | null; ebitdaAYoY: number | null; epsQYoY: number | null; opmTTM: number | null;
  revTTM: number | null;   // $ million
  de: number | null; cash: number | null; debt: number | null;   // $ million
  bb: number | null; approx: string[];
  // zzz948
  revTTMYoY: number | null; epsTTMYoY: number | null; gpAYoY: number | null; ebitdaTTMYoY: number | null; ebitdaQYoY: number | null;
  nmTTM: number | null; ptmTTM: number | null; opmFY: number | null; niTTM: number | null; niFY: number | null;   // $ million
  roeTTM: number | null; roeFY: number | null; roceTTM: number | null; roceFY: number | null;
  deFY: number | null; netDebt: number | null; liabQ: number | null; liabA: number | null;   // $ million
  debtAssetsQ: number | null; debtAssetsA: number | null; debtCapQ: number | null; debtCapA: number | null;
  debtEbitdaQ: number | null; debtEbitdaA: number | null;
  fcfFY: number | null;    // $ (whole dollars, to divide by employees)
  fs: number | null;
}
const M = 1e6;
const r2 = (v: number) => Math.round(v * 100) / 100;
const mil = (v: number) => Math.round((v / M) * 10) / 10;

/** Debt at one balance-sheet date, as TradingView counts it: borrowings (long-term debt, else its current + non-current parts, or
 *  the "debt and capital leases" total) + short-term borrowings + lease liabilities (operating and finance). */
function debtAt(fd: FrameData, cik: number, I: string): { v: number; tagged: boolean } {
  const total = valueAt(fd, DEBT_TOTAL, cik, I);
  const nonCur = valueAt(fd, DEBT_NONCUR, cik, I), cur = valueAt(fd, DEBT_CUR, cik, I), st = valueAt(fd, STB, cik, I);
  const cl = valueAt(fd, DEBT_CL, cik, I), clCur = valueAt(fd, DEBT_CL_CUR, cik, I);
  const op = valueAt(fd, OPLEASE, cik, I) ?? (() => { const a = OPLEASE_PARTS.map((c) => fd[c]?.[I]?.[cik]?.v).filter(fin); return a.length ? a.reduce((x, y) => x + y, 0) : null; })();
  const fl = valueAt(fd, FINLEASE, cik, I);
  const tagged = [total, nonCur, cur, st, cl, clCur, op, fl].some((v) => v != null);
  let borrow: number;
  if (cl != null && (total == null || cl >= total)) borrow = cl + (clCur ?? 0);   // already holds the finance leases
  else borrow = (total != null ? total : (nonCur ?? 0) + (cur ?? 0)) + (fl ?? 0);
  return { v: borrow + (st ?? 0) + (op ?? 0), tagged };
}
/** Cash and short-term investments at one date (the combined tag, else cash + short-term investments). */
/** First filed of the fallback cash lines, in order (not the largest: restricted cash is only a stand-in). */
function altCash(fd: FrameData, cik: number, I: string): number | null {
  for (const c of CASH_ALT) { const v = fd[c]?.[I]?.[cik]?.v; if (fin(v)) return v; }
  return null;
}
function cashAt(fd: FrameData, cik: number, I: string): number | null {
  const both = valueAt(fd, CASH_STI, cik, I);
  const c = valueAt(fd, CASH, cik, I) ?? altCash(fd, cik, I), s = valueAt(fd, STI, cik, I);
  const sum = c != null ? c + (s ?? 0) : null;
  if (both != null && sum != null) return Math.max(both, sum);
  return both ?? sum;
}
const instantShift = (I: string, k: number): string => { const m = /^CY(\d{4})Q(\d)I$/.exec(I)!; return `${qLabel(qShift({ y: Number(m[1]), q: Number(m[2]) }, k))}I`; };

/** All screener figures for one SEC company. */
export function usFigures(fd: FrameData, cik: number, periods: { quarters: string[]; years: string[]; instants: string[] }): UsFigures {
  const { quarters, years, instants } = periods;
  const approx: string[] = [];
  // latest quarter = newest quarter with revenue (filed or worked out)
  let L: string | null = null;
  for (const p of quarters) {
    if (REV.some((c) => quarterSeries(fd, c, cik, quarters).has(p))) { L = p; break; }
  }
  const prevYear = (p: string) => { const m = /^CY(\d{4})Q(\d)$/.exec(p)!; return `CY${Number(m[1]) - 1}Q${m[2]}`; };
  const prevQ = (p: string) => { const m = /^CY(\d{4})Q(\d)$/.exec(p)!; return qLabel(qShift({ y: Number(m[1]), q: Number(m[2]) }, -1)); };
  // latest full year with revenue
  const A = years.find((y) => valueAt(fd, REV, cik, y) != null) || null;
  const Aprev = A ? `CY${Number(A.slice(2)) - 1}` : null;

  const out: UsFigures = {
    q: L ? `Q${L.slice(-1)} ${L.slice(2, 6)}` : null, revQYoY: null, revAYoY: null, gpQYoY: null, gmFY: null, ebitdaQoQ: null, ebitdaAYoY: null, epsQYoY: null, opmTTM: null, revTTM: null, de: null, cash: null, debt: null, bb: null, approx,
    revTTMYoY: null, epsTTMYoY: null, gpAYoY: null, ebitdaTTMYoY: null, ebitdaQYoY: null, nmTTM: null, ptmTTM: null, opmFY: null, niTTM: null, niFY: null,
    roeTTM: null, roeFY: null, roceTTM: null, roceFY: null, deFY: null, netDebt: null, liabQ: null, liabA: null,
    debtAssetsQ: null, debtAssetsA: null, debtCapQ: null, debtCapA: null, debtEbitdaQ: null, debtEbitdaA: null, fcfFY: null, fs: null,
  };
  // quarterly EBITDA: operating profit + depreciation where filed for that quarter, else operating profit alone
  const ebitda = (p: string): { v: number; approx: boolean } | null => {
    const op = quarterSeries(fd, 'OperatingIncomeLoss', cik, quarters).get(p)?.v;
    if (!fin(op)) return null;
    for (const c of DDA) { const d = quarterSeries(fd, c, cik, quarters).get(p)?.v; if (fin(d)) return { v: op + Math.abs(d), approx: false }; }
    return { v: op, approx: true };
  };
  const ebitdaTTM = (from: string): { v: number; approx: boolean } | null => {
    const k = quarters.indexOf(from);
    if (k < 0 || k + 4 > quarters.length) return null;
    let v = 0, ax = false;
    for (const p of quarters.slice(k, k + 4)) { const e = ebitda(p); if (!e) return null; v += e.v; ax = ax || e.approx; }
    return { v, approx: ax };
  };
  const shiftQ = (p: string, k: number) => { const i = quarters.indexOf(p) + k; return i >= 0 && i < quarters.length ? quarters[i] : null; };
  let ptTTMraw: number | null = null;
  let revTTMraw: number | null = null, opTTMraw: number | null = null, niTTMraw: number | null = null, ebTTM: { v: number; approx: boolean } | null = null;
  if (L) {
    out.revQYoY = growthOver(fd, REV, cik, L, prevYear(L), quarters);
    // gross profit: filed, else revenue − cost of revenue
    const gpSeries = (p: string): number | null => {
      for (const c of GP) { const v = quarterSeries(fd, c, cik, quarters).get(p)?.v; if (fin(v)) return v; }
      const rev = (() => { let b: number | null = null; for (const c of REV) { const v = quarterSeries(fd, c, cik, quarters).get(p)?.v; if (fin(v) && (b == null || v > b)) b = v; } return b; })();
      // worked out from cost of revenue: only when it gives a sensible gross profit (banks file interest cost there — SoFi read −3,300%)
      for (const c of COGS) { const v = quarterSeries(fd, c, cik, quarters).get(p)?.v; if (fin(v) && rev != null && rev > 0 && v >= 0 && v <= rev) return rev - v; }
      return null;
    };
    const g1 = gpSeries(L), g0 = gpSeries(prevYear(L));
    if (fin(g1) && fin(g0)) out.gpQYoY = grow(g1, g0);
    const e1 = ebitda(L), e0 = ebitda(prevQ(L)), eY = ebitda(prevYear(L));
    if (e1 && e0 && e0.v !== 0) { out.ebitdaQoQ = grow(e1.v, e0.v); if (e1.approx || e0.approx) approx.push('ebitdaQoQ'); }
    if (e1 && eY && eY.v !== 0) { out.ebitdaQYoY = grow(e1.v, eY.v); if (e1.approx || eY.approx) approx.push('ebitdaQYoY'); }
    // EPS: the first kind (continuing operations, else total) filed for both quarters
    for (const c of EPS) {
      const sq = quarterSeries(fd, c, cik, quarters);
      const eps1 = sq.get(L)?.v, eps0 = sq.get(prevYear(L))?.v;
      if (fin(eps1) && fin(eps0)) { out.epsQYoY = grow(eps1, eps0); break; }
    }
    revTTMraw = sumLast4(fd, REV, cik, L, quarters);
    opTTMraw = sumLast4(fd, OPI, cik, L, quarters);
    niTTMraw = sumLast4(fd, NI, cik, L, quarters, true);
    const ptTTM = sumLast4(fd, PRETAX, cik, L, quarters);
    ptTTMraw = ptTTM;
    if (revTTMraw != null && revTTMraw > 0) {
      out.revTTM = mil(revTTMraw);
      if (opTTMraw != null) out.opmTTM = r1((opTTMraw / revTTMraw) * 100);
      if (niTTMraw != null) out.nmTTM = r1((niTTMraw / revTTMraw) * 100);
      if (ptTTM != null) out.ptmTTM = r1((ptTTM / revTTMraw) * 100);
    }
    if (niTTMraw != null) out.niTTM = mil(niTTMraw);
    // a year earlier: the four quarters before these four
    const L4 = shiftQ(L, 4);
    ebTTM = ebitdaTTM(L);
    if (L4) {
      const revPrev = sumLast4(fd, REV, cik, L4, quarters);
      if (revTTMraw != null && revPrev != null) out.revTTMYoY = grow(revTTMraw, revPrev);
      for (const c of EPS) {
        const epsNow = sumLast4(fd, [c], cik, L, quarters), epsPrev = sumLast4(fd, [c], cik, L4, quarters);
        if (epsNow != null && epsPrev != null) { out.epsTTMYoY = grow(epsNow, epsPrev); break; }
      }
      const ebPrev = ebitdaTTM(L4);
      if (ebTTM && ebPrev && ebPrev.v !== 0) { out.ebitdaTTMYoY = grow(ebTTM.v, ebPrev.v); if (ebTTM.approx || ebPrev.approx) approx.push('ebitdaTTMYoY'); }
    }
  }
  // annual figures
  let revA: number | null = null, opA: number | null = null, niA: number | null = null, gpA: number | null = null, ebA: { v: number; approx: boolean } | null = null;
  let IA: string | null = null, IAprev: string | null = null;
  const gpYear = (y: string, rev: number | null) => valueAt(fd, GP, cik, y) ?? (() => { const c = valueAt(fd, COGS, cik, y); return rev != null && rev > 0 && c != null && c >= 0 && c <= rev ? rev - c : null; })();
  const eA = (y: string) => { const op = fd.OperatingIncomeLoss?.[y]?.[cik]?.v; if (!fin(op)) return null; const d = valueAt(fd, DDA, cik, y); return { v: op + (d != null ? Math.abs(d) : 0), approx: d == null }; };
  if (A && Aprev) {
    out.revAYoY = growthOver(fd, REV, cik, A, Aprev, quarters, true);
    revA = valueAt(fd, REV, cik, A);
    gpA = gpYear(A, revA);
    if (revA != null && revA > 0 && gpA != null) out.gmFY = r1((gpA / revA) * 100);
    const revP = valueAt(fd, REV, cik, Aprev), gpP = gpYear(Aprev, revP);
    if (gpA != null && gpP != null) out.gpAYoY = grow(gpA, gpP);
    ebA = eA(A);
    const a0 = eA(Aprev);
    if (ebA && a0 && a0.v !== 0) { out.ebitdaAYoY = grow(ebA.v, a0.v); if (ebA.approx || a0.approx) approx.push('ebitdaAYoY'); }
    const s1 = valueAt(fd, WSH, cik, A), s0 = valueAt(fd, WSH, cik, Aprev);
    if (s1 != null && s0 != null && s0 > 0) out.bb = r1(((s0 - s1) / s0) * 100);
    if (out.revTTM == null && revA != null && revA > 0) { out.revTTM = mil(revA); approx.push('ps'); }
    const op = fd.OperatingIncomeLoss?.[A]?.[cik]?.v;
    opA = fin(op) ? op : null;
    if (revA != null && revA > 0 && opA != null) out.opmFY = r1((opA / revA) * 100);
    niA = firstAt(fd, NI, cik, A);
    if (niA != null) out.niFY = mil(niA);
    const cfo = valueAt(fd, CFO, cik, A), cx = valueAt(fd, CAPEX, cik, A);
    if (cfo != null) out.fcfFY = Math.round(cfo - Math.abs(cx ?? 0));
    // the fiscal year-end balance sheets (this year's and last year's)
    const endOf = (y: string) => { for (const c of REV) { const e = fd[c]?.[y]?.[cik]?.e; if (e) return e; } return null; };
    const e1 = endOf(A);
    const lab = e1 ? quarterLabelForEnd(e1) : null;
    if (lab) { IA = `${lab}I`; IAprev = instantShift(IA, -4); }
  }
  // balance sheet: the newest instant with equity filed
  const I = instants.find((p) => valueAt(fd, EQ, cik, p) != null) || instants.find((p) => valueAt(fd, CASH, cik, p) != null || altCash(fd, cik, p) != null) || null;
  const pct = (x: number, y: number) => r1((x / y) * 100);
  if (I) {
    const eq = valueAt(fd, EQ, cik, I);
    const d = debtAt(fd, cik, I);
    out.debt = d.tagged ? mil(d.v) : null;
    if (!d.tagged) approx.push('de');
    if (eq != null) out.de = eq > 0 ? r2(d.v / eq) : 99;
    const cash = cashAt(fd, cik, I);
    if (cash != null) { out.cash = mil(cash); out.netDebt = mil(d.v - cash); }
    const liab = valueAt(fd, LIAB, cik, I), assets = valueAt(fd, ASSETS, cik, I), lc = valueAt(fd, LIAB_CUR, cik, I);
    if (liab != null) out.liabQ = mil(liab);
    if (assets != null && assets > 0) out.debtAssetsQ = r2(d.v / assets);
    if (eq != null && d.v + eq > 0) out.debtCapQ = r2(d.v / (d.v + eq));
    if (ebTTM && ebTTM.v !== 0) out.debtEbitdaQ = r2(d.v / ebTTM.v);
    // returns: last 4 quarters' profit on the average of this and last year's equity
    const eqY = valueAt(fd, EQ, cik, instantShift(I, -4));
    const eqAvg = eq != null && eqY != null ? (eq + eqY) / 2 : eq;
    if (niTTMraw != null && eqAvg != null && eqAvg > 0) out.roeTTM = pct(niTTMraw, eqAvg);
    const ebitTTM = opTTMraw ?? ptTTMraw;   // no operating line filed (insurers, some service firms): profit before tax
    if (ebitTTM != null && assets != null && lc != null && assets - lc > 0) out.roceTTM = pct(ebitTTM, assets - lc);
  }
  if (IA && IAprev) {
    const eq = valueAt(fd, EQ, cik, IA), eq0 = valueAt(fd, EQ, cik, IAprev);
    const d = debtAt(fd, cik, IA), d0 = debtAt(fd, cik, IAprev);
    const assets = valueAt(fd, ASSETS, cik, IA), assets0 = valueAt(fd, ASSETS, cik, IAprev);
    const lc = valueAt(fd, LIAB_CUR, cik, IA), lc0 = valueAt(fd, LIAB_CUR, cik, IAprev);
    const ac = valueAt(fd, ASSETS_CUR, cik, IA), ac0 = valueAt(fd, ASSETS_CUR, cik, IAprev);
    const liab = valueAt(fd, LIAB, cik, IA);
    // buyback ratio: shares outstanding at the two year-ends (a weighted average is distorted by an IPO or a merger mid-year)
    const so1 = valueAt(fd, SHARES_OUT, cik, IA), so0 = valueAt(fd, SHARES_OUT, cik, IAprev);
    if (so1 != null && so0 != null && so0 > 0) out.bb = r1(((so0 - so1) / so0) * 100);
    if (eq != null) out.deFY = eq > 0 ? r2(d.v / eq) : 99;
    if (liab != null) out.liabA = mil(liab);
    if (assets != null && assets > 0) out.debtAssetsA = r2(d.v / assets);
    if (eq != null && d.v + eq > 0) out.debtCapA = r2(d.v / (d.v + eq));
    if (ebA && ebA.v !== 0) out.debtEbitdaA = r2(d.v / ebA.v);
    const eqAvg = eq != null && eq0 != null ? (eq + eq0) / 2 : eq;
    if (niA != null && eqAvg != null && eqAvg > 0) out.roeFY = pct(niA, eqAvg);
    if (opA != null && assets != null && lc != null && assets - lc > 0) out.roceFY = pct(opA, assets - lc);
    // Piotroski F-score on the last two fiscal years (needs at least 8 of the 9 checks)
    if (A && Aprev && niA != null && assets != null && assets > 0 && assets0 != null && assets0 > 0) {
      const ni0 = firstAt(fd, NI, cik, Aprev), cfo = valueAt(fd, CFO, cik, A);
      const rev1 = revA, rev0 = valueAt(fd, REV, cik, Aprev);
      const gp1 = gpA, gp0 = gpYear(Aprev, rev0);
      const s1 = valueAt(fd, WSH, cik, A), s0 = valueAt(fd, WSH, cik, Aprev);
      let pts = 0, known = 0;
      const chk = (ok: boolean | null) => { if (ok == null) return; known++; if (ok) pts++; };
      chk(niA > 0);
      chk(cfo != null ? cfo > 0 : null);
      chk(ni0 != null ? niA / assets > ni0 / assets0 : null);
      chk(cfo != null ? cfo > niA : null);
      chk(d.tagged || d0.tagged ? d.v / assets <= d0.v / assets0 : null);
      chk(ac != null && ac0 != null && lc != null && lc0 != null && lc > 0 && lc0 > 0 ? ac / lc > ac0 / lc0 : null);
      chk(s1 != null && s0 != null ? s1 <= s0 : null);
      chk(gp1 != null && gp0 != null && rev1 != null && rev0 != null && rev1 > 0 && rev0 > 0 ? gp1 / rev1 > gp0 / rev0 : null);
      chk(rev1 != null && rev0 != null ? rev1 / assets > rev0 / assets0 : null);
      if (known >= 8) { out.fs = known === 9 ? pts : r1((pts * 9) / known); if (known < 9) approx.push('fs'); }
    }
  }
  return out;
}

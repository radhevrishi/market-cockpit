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

export const REV = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet'];
export const COGS = ['CostOfRevenue', 'CostOfGoodsAndServicesSold'];
export const GP = ['GrossProfit'];
export const OPI = ['OperatingIncomeLoss'];
export const DDA = ['DepreciationDepletionAndAmortization', 'DepreciationAndAmortization'];
export const EPS = ['EarningsPerShareDiluted'];
export const WSH = ['WeightedAverageNumberOfDilutedSharesOutstanding'];
export const EQ = ['StockholdersEquity'];
export const DEBT_TOTAL = ['LongTermDebt'];
export const DEBT_NONCUR = ['LongTermDebtNoncurrent'];
export const DEBT_CUR = ['LongTermDebtCurrent', 'DebtCurrent'];
export const STB = ['ShortTermBorrowings'];
export const CASH = ['CashAndCashEquivalentsAtCarryingValue'];

/** Which frames to download: [concept, taxonomy, unit, kind]. kind q = quarterly + annual durations, a = annual only, i = instants. */
export const FRAME_PLAN: ReadonlyArray<[string, 'us-gaap' | 'dei', string, 'q' | 'a' | 'i']> = [
  ...REV.map((c) => [c, 'us-gaap', 'USD', 'q'] as [string, 'us-gaap', string, 'q']),
  ...COGS.map((c) => [c, 'us-gaap', 'USD', 'q'] as [string, 'us-gaap', string, 'q']),
  ['GrossProfit', 'us-gaap', 'USD', 'q'],
  ['OperatingIncomeLoss', 'us-gaap', 'USD', 'q'],
  ...DDA.map((c) => [c, 'us-gaap', 'USD', 'q'] as [string, 'us-gaap', string, 'q']),
  ['EarningsPerShareDiluted', 'us-gaap', 'USD-per-shares', 'q'],
  ['WeightedAverageNumberOfDilutedSharesOutstanding', 'us-gaap', 'shares', 'a'],
  ['StockholdersEquity', 'us-gaap', 'USD', 'i'],
  ['LongTermDebt', 'us-gaap', 'USD', 'i'],
  ['LongTermDebtNoncurrent', 'us-gaap', 'USD', 'i'],
  ['LongTermDebtCurrent', 'us-gaap', 'USD', 'i'],
  ['DebtCurrent', 'us-gaap', 'USD', 'i'],
  ['ShortTermBorrowings', 'us-gaap', 'USD', 'i'],
  ['CashAndCashEquivalentsAtCarryingValue', 'us-gaap', 'USD', 'i'],
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
/** Quarter labels to download, newest first (n quarters), the annual years and the instants. */
export function framePeriods(now: Date, nq = 10): { quarters: string[]; years: string[]; instants: string[] } {
  const last = lastEndedQuarter(now);
  const quarters = Array.from({ length: nq }, (_, i) => qLabel(qShift(last, -i)));
  const y = last.y;
  const years = [y, y - 1, y - 2, y - 3].map((v) => `CY${v}`);
  const instants = Array.from({ length: 4 }, (_, i) => `${qLabel(qShift(last, -i))}I`);
  return { quarters, years, instants };
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const r1 = (v: number) => Math.round(v * 10) / 10;
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
    if (!fin(a) || !fin(b) || b <= 0) continue;
    const g = r1((a / b - 1) * 100);
    if (!best || a > best.v) best = { v: a, g };
  }
  return best ? best.g : null;
}
function valueAt(fd: FrameData, concepts: string[], cik: number, period: string): number | null {
  let best: number | null = null;
  for (const c of concepts) { const v = fd[c]?.[period]?.[cik]?.v; if (fin(v) && (best == null || v > best)) best = v; }
  return best;
}
function sumLast4(fd: FrameData, concepts: string[], cik: number, from: string, quarters: string[]): number | null {
  const i = quarters.indexOf(from);
  if (i < 0 || i + 4 > quarters.length) return null;
  let best: number | null = null;
  for (const c of concepts) {
    const s = quarterSeries(fd, c, cik, quarters);
    const vals = quarters.slice(i, i + 4).map((p) => s.get(p)?.v);
    if (!vals.every(fin)) continue;
    const sum = (vals as number[]).reduce((a, b) => a + b, 0);
    if (best == null || sum > best) best = sum;
  }
  return best;
}

export interface UsFigures {
  q: string | null; revQYoY: number | null; revAYoY: number | null; gpQYoY: number | null; gmFY: number | null;
  ebitdaQoQ: number | null; ebitdaAYoY: number | null; epsQYoY: number | null; opmTTM: number | null;
  revTTM: number | null;   // $ million
  de: number | null; cash: number | null; debt: number | null;   // $ million
  bb: number | null; approx: string[];
}
const M = 1e6;

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

  const out: UsFigures = { q: L ? `Q${L.slice(-1)} ${L.slice(2, 6)}` : null, revQYoY: null, revAYoY: null, gpQYoY: null, gmFY: null, ebitdaQoQ: null, ebitdaAYoY: null, epsQYoY: null, opmTTM: null, revTTM: null, de: null, cash: null, debt: null, bb: null, approx };
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
    if (fin(g1) && fin(g0) && g0 > 0) out.gpQYoY = r1((g1 / g0 - 1) * 100);
    // EBITDA quarter-on-quarter
    const ebitda = (p: string): { v: number; approx: boolean } | null => {
      const op = quarterSeries(fd, 'OperatingIncomeLoss', cik, quarters).get(p)?.v;
      if (!fin(op)) return null;
      for (const c of DDA) { const d = quarterSeries(fd, c, cik, quarters).get(p)?.v; if (fin(d)) return { v: op + Math.abs(d), approx: false }; }
      return { v: op, approx: true };
    };
    const e1 = ebitda(L), e0 = ebitda(prevQ(L));
    if (e1 && e0 && e0.v > 0) { out.ebitdaQoQ = r1((e1.v / e0.v - 1) * 100); if (e1.approx || e0.approx) approx.push('ebitdaQoQ'); }
    const eps1 = valueAt(fd, EPS, cik, L) ?? quarterSeries(fd, 'EarningsPerShareDiluted', cik, quarters).get(L)?.v ?? null;
    const eps0 = valueAt(fd, EPS, cik, prevYear(L)) ?? quarterSeries(fd, 'EarningsPerShareDiluted', cik, quarters).get(prevYear(L))?.v ?? null;
    if (fin(eps1) && fin(eps0) && eps0 > 0) out.epsQYoY = r1((eps1 / eps0 - 1) * 100);
    const revTTM = sumLast4(fd, REV, cik, L, quarters);
    const opTTM = sumLast4(fd, OPI, cik, L, quarters);
    if (revTTM != null && revTTM > 0) {
      out.revTTM = Math.round((revTTM / M) * 10) / 10;
      if (opTTM != null) out.opmTTM = r1((opTTM / revTTM) * 100);
    }
  }
  if (A && Aprev) {
    out.revAYoY = growthOver(fd, REV, cik, A, Aprev, quarters, true);
    const rev = valueAt(fd, REV, cik, A);
    const gp = valueAt(fd, GP, cik, A) ?? (() => { const c = valueAt(fd, COGS, cik, A); return rev != null && rev > 0 && c != null && c >= 0 && c <= rev ? rev - c : null; })();
    if (rev != null && rev > 0 && gp != null) out.gmFY = r1((gp / rev) * 100);
    const eA = (y: string) => { const op = fd.OperatingIncomeLoss?.[y]?.[cik]?.v; if (!fin(op)) return null; const d = valueAt(fd, DDA, cik, y); return { v: op + (d != null ? Math.abs(d) : 0), approx: d == null }; };
    const a1 = eA(A), a0 = eA(Aprev);
    if (a1 && a0 && a0.v > 0) { out.ebitdaAYoY = r1((a1.v / a0.v - 1) * 100); if (a1.approx || a0.approx) approx.push('ebitdaAYoY'); }
    const s1 = valueAt(fd, WSH, cik, A), s0 = valueAt(fd, WSH, cik, Aprev);
    if (s1 != null && s0 != null && s0 > 0) out.bb = r1(((s0 - s1) / s0) * 100);
    if (out.revTTM == null && rev != null && rev > 0) { out.revTTM = Math.round((rev / M) * 10) / 10; approx.push('ps'); }
  }
  // balance sheet: the newest instant with equity filed
  const I = instants.find((p) => valueAt(fd, EQ, cik, p) != null) || instants.find((p) => valueAt(fd, CASH, cik, p) != null) || null;
  if (I) {
    const eq = valueAt(fd, EQ, cik, I);
    const total = valueAt(fd, DEBT_TOTAL, cik, I);
    const nonCur = valueAt(fd, DEBT_NONCUR, cik, I), cur = valueAt(fd, DEBT_CUR, cik, I), st = valueAt(fd, STB, cik, I);
    const anyDebtTag = [total, nonCur, cur, st].some((v) => v != null);
    const debt = total != null ? total + (st ?? 0) : (nonCur ?? 0) + (cur ?? 0) + (st ?? 0);
    out.debt = Math.round((debt / M) * 10) / 10;
    if (!anyDebtTag) approx.push('de');
    if (eq != null) out.de = eq > 0 ? Math.round((debt / eq) * 100) / 100 : 99;
    const cash = valueAt(fd, CASH, cik, I);
    if (cash != null) out.cash = Math.round((cash / M) * 10) / 10;
  }
  return out;
}

// zzz1208 — COMPANY LAB: the owner's old Python scripts (FCF checklist, FCF / EPS / revenue growth against price, FCF per share,
// Stage 2 + Minervini trend template + breakout) done the new way, for one company or several, India and USA, from the data the
// portal already keeps: SEC company facts (USA), screener.in pages (India), the stock screener's snapshot (stage, RS, averages)
// and the daily price series. Every figure says its period and source; a figure that cannot be worked out is "not known",
// never a fail and never 0. Pure (no network) — server.ts gathers the inputs.
export type LabMarket = 'IN' | 'US';

export interface AnnualRow {
  end: string;            // fiscal year end (ISO date)
  label: string;          // 'FY2025' (US) / 'Mar 2026' (India)
  revenue: number | null; netIncome: number | null; eps: number | null;
  cfo: number | null; capex: number | null; fcf: number | null;
  debt: number | null; shares: number | null; sbc: number | null;
}
export interface Check { id: string; label: string; state: 'pass' | 'fail' | 'unknown'; value: string; why: string }
export interface FcfReport { checks: Check[]; passed: number; known: number; metrics: Array<{ label: string; value: string }>; fcfBasis: string }

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const r1 = (v: number) => Math.round(v * 10) / 10;
export const growthPct = (now: number | null, before: number | null): number | null =>
  fin(now) && fin(before) && before !== 0 && !(before < 0 && now > 0) ? r1(((now - before) / Math.abs(before)) * 100) : null;
/** Compound yearly growth between two POSITIVE values n years apart. */
export function cagr(first: number | null, last: number | null, years: number): number | null {
  if (!fin(first) || !fin(last) || first <= 0 || last <= 0 || years <= 0) return null;
  return r1((Math.pow(last / first, 1 / years) - 1) * 100);
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
function stdev(xs: number[]): number | null {
  if (xs.length < 3) return null;
  const m = mean(xs)!;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}
const pct = (v: number | null, d = 1) => (v == null ? 'not known' : `${v >= 0 ? '' : '−'}${Math.abs(v).toFixed(d)}%`);
const times = (v: number | null) => (v == null ? 'not known' : `${v.toFixed(1)}×`);

/** Per year, one value per fiscal year end (zzz1210: every series the owner's scripts plot). */
export interface YearPoint {
  label: string; end: string;
  revG: number | null; epsG: number | null; fcfG: number | null;          // growth vs the year before, %
  fcfM: number | null; fcfPs: number | null; fcf: number | null; revenue: number | null; eps: number | null; netIncome: number | null;
  fcfYield: number | null;      // FCF ÷ market value at that year end (price at the year end × shares), %
  capexToFcf: number | null;    // capex ÷ FCF, % (FCF positive only)
  debtToFcf: number | null;     // debt ÷ FCF, years (FCF positive only)
  sbcPct: number | null;        // share-based pay ÷ revenue, %
  priceAtEnd: number | null;
}
/**
 * `sharesNow` (millions US / crore India) stands in for a year with no share count; `priceAt(end)` gives the close on or
 * before a year end (for the yield then — the script's FCF yield, but at each year's own price, not today's).
 */
export function yearPoints(rows: AnnualRow[], sharesNow: number | null, priceAt?: (end: string) => number | null): YearPoint[] {
  return rows.map((r, i) => {
    const p = i > 0 ? rows[i - 1] : null;
    const sh = fin(r.shares) && r.shares > 0 ? r.shares : fin(sharesNow) && sharesNow > 0 ? sharesNow : null;
    const px = priceAt ? priceAt(r.end) : null;
    const mv = fin(px) && px > 0 && sh ? px * sh : null;
    const posF = fin(r.fcf) && r.fcf > 0;
    return {
      label: r.label, end: r.end, revenue: r.revenue, eps: r.eps, netIncome: r.netIncome, fcf: r.fcf,
      revG: p ? growthPct(r.revenue, p.revenue) : null,
      epsG: p ? growthPct(r.eps, p.eps) : null,
      fcfG: p && fin(p.fcf) && p.fcf > 0 ? growthPct(r.fcf, p.fcf) : null,   // zzz1256: growth from a zero or negative base is not a growth rate (−2 → −20 printed "−900%")
      fcfM: fin(r.fcf) && fin(r.revenue) && r.revenue > 0 ? r1((r.fcf / r.revenue) * 100) : null,
      fcfPs: fin(r.fcf) && sh ? Math.round((r.fcf / sh) * 100) / 100 : null,
      fcfYield: fin(r.fcf) && mv ? r1((r.fcf / mv) * 100) : null,
      capexToFcf: posF && fin(r.capex) ? r1((Math.abs(r.capex) / r.fcf!) * 100) : null,
      debtToFcf: posF && fin(r.debt) ? Math.round((r.debt / r.fcf!) * 10) / 10 : null,
      sbcPct: fin(r.sbc) && fin(r.revenue) && r.revenue > 0 ? r1((r.sbc / r.revenue) * 100) : null,
      priceAtEnd: fin(px) ? px : null,
    };
  });
}

/**
 * The FCF quality checklist (the owner's FCF_Checklist.py, with its arithmetic made safe): latest full year against the
 * five before it. `mcap` is today's market cap in the SAME unit as the figures ($ M / ₹ Cr). `fcfBasis` says how FCF was
 * worked out (US: operating cash − capex; India: operating + investing cash, an approximation — screener.in prints no capex).
 */
export function fcfReport(rowsIn: AnnualRow[], mcap: number | null, fcfBasis: string, pts: YearPoint[] = []): FcfReport {
  const rows = rowsIn.filter((r) => fin(r.revenue) || fin(r.fcf));
  const L = rows[rows.length - 1];
  const last6 = rows.slice(-6);
  const C: Check[] = [];
  const add = (id: string, label: string, ok: boolean | null, value: string, why: string) =>
    C.push({ id, label, state: ok == null ? 'unknown' : ok ? 'pass' : 'fail', value, why });
  // 1 FCF growing over five years
  const fcfs = last6.map((r) => r.fcf).filter(fin);
  let ups = 0, steps = 0;
  for (let i = 1; i < last6.length; i++) { const a = last6[i - 1].fcf, b = last6[i].fcf; if (fin(a) && fin(b)) { steps++; if (b > a) ups++; } }
  const f0 = last6[0]?.fcf ?? null, fN = L?.fcf ?? null;
  add('growth', 'Free cash flow growing over 5 years', steps >= 3 && fin(f0) && fin(fN) ? fN > f0 && ups >= Math.ceil(steps / 2) : null,
    steps >= 3 ? `up in ${ups} of ${steps} years; ${fin(f0) ? fmtShort(f0) : '—'} → ${fin(fN) ? fmtShort(fN) : '—'}` : 'needs 4+ years of FCF',
    'More free cash than five years ago, rising in at least half the years.');
  // 2 FCF margin > 10%
  const mg = L && fin(L.fcf) && fin(L.revenue) && L.revenue > 0 ? r1((L.fcf / L.revenue) * 100) : null;
  add('margin', 'FCF margin above 10%', mg == null ? null : mg > 10, `${pct(mg)} (${L?.label || '—'})`, 'Free cash flow ÷ revenue in the latest full year.');
  // 3 FCF yield > 5%
  const yld = L && fin(L.fcf) && fin(mcap) && mcap > 0 ? r1((L.fcf / mcap) * 100) : null;
  add('yield', 'FCF yield above 5% (buybacks would be at a fair price)', yld == null ? null : yld > 5, `${pct(yld)} at today's market cap`, 'Latest full-year free cash flow ÷ today\'s market value. Above 5% = buying back shares is not overpaying.');
  // 4 FCF > net income
  add('conv', 'Free cash flow above net income', L && fin(L.fcf) && fin(L.netIncome) ? L.fcf > L.netIncome : null,
    L && fin(L.fcf) && fin(L.netIncome) ? `FCF ${fmtShort(L.fcf)} vs profit ${fmtShort(L.netIncome)}` : 'not known', 'Profit backed by cash after investment.');
  // 5 capex vs FCF (the script's rule: CapEx-to-FCF below 50%)
  const cx = L && fin(L.capex) && fin(L.fcf) && L.fcf > 0 ? r1((Math.abs(L.capex) / L.fcf) * 100) : null;
  add('capex', 'Capex below half of free cash flow', cx == null ? (L && fin(L.capex) && fin(L.fcf) ? false : null) : cx < 50,
    cx == null ? (L && fin(L.fcf) && L.fcf <= 0 && fin(L.capex) ? 'FCF not positive' : 'capex not reported') : `capex = ${cx}% of FCF`,
    'Capital spending ÷ free cash flow. Below 50% = most of the cash is left over after investment.');
  // 6 debt vs FCF
  const dF = L && fin(L.debt) && fin(L.fcf) ? (L.fcf > 0 ? Math.round((L.debt / L.fcf) * 10) / 10 : null) : null;
  add('debt', 'Debt at most 3 years of FCF', L && fin(L.debt) && fin(L.fcf) ? (L.fcf > 0 ? dF! <= 3 : L.debt <= 0) : null,
    L && fin(L.debt) ? (L.fcf != null && L.fcf <= 0 ? `debt ${fmtShort(L.debt)}, FCF not positive` : times(dF)) : 'debt not stated', 'Years of free cash flow needed to repay all debt.');
  // 7 FCF growth faster than revenue growth (5-year CAGR)
  const n = last6.length - 1;
  const fcfC = n >= 3 ? cagr(last6[0].fcf, L?.fcf ?? null, n) : null, revC = n >= 3 ? cagr(last6[0].revenue, L?.revenue ?? null, n) : null;
  add('lever', 'FCF growing faster than revenue', fcfC != null && revC != null ? fcfC > revC : null,
    `FCF ${pct(fcfC)} a year vs revenue ${pct(revC)} a year (${n >= 3 ? `${n} years` : '—'})`, 'Cash rising faster than sales = operating leverage.');
  // 8 steady FCF margin
  const margins = last6.map((r) => (fin(r.fcf) && fin(r.revenue) && r.revenue > 0 ? (r.fcf / r.revenue) * 100 : null)).filter(fin);
  const sd = stdev(margins);
  add('steady', 'Steady FCF margin (not cyclical)', sd == null ? null : sd < 10, sd == null ? 'needs 3+ years' : `margin swings ±${sd.toFixed(1)} pts`, 'A small spread of the yearly FCF margin = a less cyclical business.');
  // 9 SBC < 10% of revenue (where reported)
  const sbcP = L && fin(L.sbc) && fin(L.revenue) && L.revenue > 0 ? r1((L.sbc / L.revenue) * 100) : null;
  if (sbcP != null) add('sbc', 'Share pay below 10% of revenue', sbcP < 10, pct(sbcP), 'Stock-based pay is a real cost the cash-flow statement adds back.');
  const known = C.filter((c) => c.state !== 'unknown').length, passed = C.filter((c) => c.state === 'pass').length;
  const avgM = mean(margins);
  // 5-year analysis (the script's block): averages over the last five years with a figure; yields at each year's own price
  const p5 = pts.slice(-5);
  const avg = (f: (y: YearPoint) => number | null) => { const xs = p5.map(f).filter(fin); return xs.length ? r1(mean(xs)!) : null; };
  const yAvg = avg((y) => y.fcfYield), cxAvg = avg((y) => y.capexToFcf), dAvg = avg((y) => y.debtToFcf);
  // zzz1256 — an average over the years that HAVE a figure says how many that is (debt ÷ FCF "2.1×" was one year of five)
  const nOf = (f: (y: YearPoint) => number | null) => p5.map(f).filter(fin).length;
  const ofYears = (k: number) => (k > 0 && k < p5.length ? ` (${k} of ${p5.length} yrs with positive FCF)` : '');
  const metrics = [
    { label: `FCF growth a year (${n >= 1 ? n : '—'} yrs)`, value: pct(fcfC) },
    { label: 'Revenue growth a year', value: pct(revC) },
    { label: 'FCF margin, average', value: pct(avgM == null ? null : r1(avgM)) },
    { label: 'FCF yield, average (each year\'s price)', value: pct(yAvg) },
    { label: `Capex ÷ FCF, average${ofYears(nOf((y) => y.capexToFcf))}`, value: pct(cxAvg) },
    { label: `Debt ÷ FCF, average${ofYears(nOf((y) => y.debtToFcf))}`, value: times(dAvg) },
  ];
  return { checks: C, passed, known, metrics, fcfBasis };
}
function fmtShort(v: number): string {
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  return a >= 100_000 ? `${s}${(a / 1000).toFixed(0)}k` : a >= 1000 ? `${s}${(a / 1000).toFixed(1)}k` : `${s}${a.toFixed(a >= 100 ? 0 : 1)}`;
}

// ── Stage 2 + trend template + breakout (Stage2.py done properly) ──────────────────────────────────────────────────────────
export interface DayBars { c: number[]; h: number[]; l: number[]; v: number[] }
const sma = (a: number[], n: number, end: number): number | null => { if (end + 1 < n) return null; let s = 0; for (let i = end - n + 1; i <= end; i++) s += a[i]; return s / n; };
export interface TrendRule { label: string; ok: boolean | null; value: string }
/** Minervini's trend template (the owner's own script: the same six rules as the Pine screener) with the values. */
export function trendRules(b: DayBars): TrendRule[] {
  const n = b.c.length, L = n - 1;
  if (n < 2) return [];
  const c = b.c[L], s50 = sma(b.c, 50, L), s150 = sma(b.c, 150, L), s200 = sma(b.c, 200, L);
  let rising: boolean | null = null;
  if (n >= 221) { rising = true; for (let k = 0; k < 20; k++) { const a = sma(b.c, 200, L - k), p = sma(b.c, 200, L - k - 1); if (!(a! > p!)) { rising = false; break; } } }
  let lo = Infinity, hi = -Infinity;
  if (n >= 250) for (let i = n - 250; i < n; i++) { lo = Math.min(lo, b.l[i]); hi = Math.max(hi, b.h[i]); }
  const fx = (v: number | null) => (v == null ? '—' : v >= 1000 ? v.toFixed(0) : v.toFixed(2));
  return [
    { label: 'Price above the 50-day average', ok: s50 == null ? null : c > s50, value: `${fx(c)} vs ${fx(s50)}` },
    { label: '50-day above 150-day average', ok: s50 == null || s150 == null ? null : s50 > s150, value: `${fx(s50)} vs ${fx(s150)}` },
    { label: '150-day above 200-day average', ok: s150 == null || s200 == null ? null : s150 > s200, value: `${fx(s150)} vs ${fx(s200)}` },
    { label: '200-day average rising for 20 sessions', ok: rising, value: rising == null ? 'needs 221 sessions' : rising ? 'rising' : 'not rising every session' },
    { label: 'At least 30% above the 52-week low', ok: n >= 250 && lo > 0 ? c / lo > 1.3 : null, value: n >= 250 ? `${pct(r1((c / lo - 1) * 100), 0)} above` : 'needs a year of prices' },
    { label: 'Within 25% of the 52-week high', ok: n >= 250 && hi > 0 ? c / hi > 0.75 : null, value: n >= 250 ? `${pct(r1((c / hi - 1) * 100), 0)} from the high` : 'needs a year of prices' },
  ];
}
/** Breakout today: close above the highest close of the 20 sessions before it, on volume ≥ 1.5× their average. */
export function breakout(b: DayBars): { ok: boolean | null; value: string } {
  const n = b.c.length;
  if (n < 22) return { ok: null, value: 'needs 22 sessions' };
  const L = n - 1;
  let hi = -Infinity, vs = 0;
  for (let i = L - 20; i < L; i++) { hi = Math.max(hi, b.c[i]); vs += b.v[i]; }
  const av = vs / 20, vr = av > 0 ? b.v[L] / av : null;
  const ok = b.c[L] > hi && vr != null && vr >= 1.5;
  return { ok, value: `close ${b.c[L] > hi ? 'above' : 'below'} the 20-session high; volume ${vr == null ? '—' : `${vr.toFixed(1)}×`} average` };
}

/**
 * Stage2.py's relative strength: the stock's cumulative return ÷ the index's over the same sessions (last `sessions`
 * trading days, matched by date; an index day missing takes the close before it). Above 1 = beating the index.
 * `line` = that ratio through the window, one point a week, for the chart.
 */
export interface RsCum { ratio: number | null; stockRet: number | null; idxRet: number | null; ok: boolean | null; from: string | null; line: Array<{ t: string; v: number }> }
export function rsCumulative(st: { t: string[]; c: number[] }, ix: { t: string[]; c: number[] }, sessions = 252): RsCum {
  const none: RsCum = { ratio: null, stockRet: null, idxRet: null, ok: null, from: null, line: [] };
  const n = st.t.length;
  if (n < 30 || ix.t.length < 30) return none;
  const start = Math.max(0, n - 1 - sessions);
  let j = 0;
  const idxAt = (d: string): number | null => {   // ix dates ascending; walk forward
    while (j + 1 < ix.t.length && ix.t[j + 1] <= d) j++;
    return ix.t[j] <= d && fin(ix.c[j]) && ix.c[j] > 0 ? ix.c[j] : null;
  };
  const i0 = idxAt(st.t[start]), s0 = st.c[start];
  if (i0 == null || !(s0 > 0)) return none;
  const line: Array<{ t: string; v: number }> = [];
  let last: number | null = null, lastI: number | null = null;
  for (let k = start; k < n; k++) {
    const iv = idxAt(st.t[k]);
    if (iv == null || !(st.c[k] > 0)) continue;
    last = st.c[k]; lastI = iv;
    const v = (st.c[k] / s0) / (iv / i0);
    if ((k - start) % 5 === 0 || k === n - 1) line.push({ t: st.t[k], v: Math.round(v * 1000) / 1000 });
  }
  if (last == null || lastI == null) return none;
  const ratio = Math.round(((last / s0) / (lastI / i0)) * 1000) / 1000;
  return { ratio, stockRet: r1((last / s0 - 1) * 100), idxRet: r1((lastI / i0 - 1) * 100), ok: ratio > 1, from: st.t[start], line };
}

/** The price with its 50 / 150 / 200-day averages, one point a week over the last `weeks` weeks (the Stage 2 chart). */
export function maSeries(t: string[], c: number[], weeks = 104): Array<{ t: string; c: number; m50: number | null; m150: number | null; m200: number | null }> {
  const out: Array<{ t: string; c: number; m50: number | null; m150: number | null; m200: number | null }> = [];
  const L = c.length - 1, from = Math.max(0, L - weeks * 5);
  const rd = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);
  for (let i = from; i <= L; i++) if ((L - i) % 5 === 0) out.push({ t: t[i], c: c[i], m50: rd(sma(c, 50, i)), m150: rd(sma(c, 150, i)), m200: rd(sma(c, 200, i)) });
  return out;
}

/** Stage2.py's last line: trend template (all six) AND RS above 1 AND a volume breakout today. */
export function stage2Verdict(rules: TrendRule[], rs: RsCum, bo: { ok: boolean | null }): { all: boolean | null; trendAndRs: boolean | null; text: string } {
  const tt = rules.length === 6 && rules.every((r) => r.ok != null) ? rules.every((r) => r.ok) : null;
  const trendAndRs = tt == null || rs.ok == null ? null : tt && rs.ok;
  const all = trendAndRs == null || bo.ok == null ? null : trendAndRs && bo.ok;
  const text = all == null ? 'Not enough price history to judge every criterion.'
    : all ? 'Meets all criteria: trend template, beating the index and a volume breakout today.'
    : trendAndRs ? 'Trend template and relative strength pass; no volume breakout today (watch for one).'
    : `Does not meet the criteria: ${[tt ? null : 'trend template', rs.ok ? null : 'relative strength vs the index'].filter(Boolean).join(' and ')} not passing.`;
  return { all, trendAndRs, text };
}

/** One company's lab verdict in plain words (no buy / sell): what the cash says and what the chart says. */
export function labSummary(f: FcfReport, rules: TrendRule[], stage: number | null, ttScreener: number | null = null): string {
  // the stock screener's own count (the Pine / stock screeners show it) wins over this page's recount, so the pages agree
  const tt = ttScreener ?? rules.filter((r) => r.ok).length, ttKnown = ttScreener != null ? 6 : rules.filter((r) => r.ok != null).length;
  const cash = f.known < 4 ? 'Not enough years of figures to judge the cash.' : f.passed >= Math.ceil(f.known * 0.75) ? 'Cash quality strong' : f.passed >= Math.ceil(f.known / 2) ? 'Cash quality mixed' : 'Cash quality weak';
  const chart = ttKnown < 4 ? 'price history too short for the trend template' : tt === 6 ? 'all six trend-template rules pass' : `${tt} of 6 trend-template rules pass`;
  return `${cash} (${f.passed}/${f.known} checks). Chart: ${stage != null ? `Stage ${stage}, ` : ''}${chart}.`;
}

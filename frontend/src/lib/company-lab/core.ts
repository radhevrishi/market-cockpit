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

/** Per year: revenue growth, EPS growth, FCF margin, FCF per share (for the charts and tables). */
export interface YearPoint { label: string; end: string; revG: number | null; epsG: number | null; fcfM: number | null; fcfPs: number | null; fcf: number | null; revenue: number | null; eps: number | null; netIncome: number | null }
export function yearPoints(rows: AnnualRow[], sharesNow: number | null): YearPoint[] {
  return rows.map((r, i) => {
    const p = i > 0 ? rows[i - 1] : null;
    const sh = fin(r.shares) && r.shares > 0 ? r.shares : fin(sharesNow) && sharesNow > 0 ? sharesNow : null;
    return {
      label: r.label, end: r.end, revenue: r.revenue, eps: r.eps, netIncome: r.netIncome, fcf: r.fcf,
      revG: p ? growthPct(r.revenue, p.revenue) : null,
      epsG: p ? growthPct(r.eps, p.eps) : null,
      fcfM: fin(r.fcf) && fin(r.revenue) && r.revenue > 0 ? r1((r.fcf / r.revenue) * 100) : null,
      fcfPs: fin(r.fcf) && sh ? Math.round((r.fcf / sh) * 100) / 100 : null,
    };
  });
}

/**
 * The FCF quality checklist (the owner's FCF_Checklist.py, with its arithmetic made safe): latest full year against the
 * five before it. `mcap` is today's market cap in the SAME unit as the figures ($ M / ₹ Cr). `fcfBasis` says how FCF was
 * worked out (US: operating cash − capex; India: operating + investing cash, an approximation — screener.in prints no capex).
 */
export function fcfReport(rowsIn: AnnualRow[], mcap: number | null, fcfBasis: string): FcfReport {
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
  add('yield', 'FCF yield above 5%', yld == null ? null : yld > 5, `${pct(yld)} at today's market cap`, 'Latest full-year free cash flow ÷ today\'s market value. Above 5% = the price is not stretched against the cash.');
  // 4 FCF > net income
  add('conv', 'Free cash flow above net income', L && fin(L.fcf) && fin(L.netIncome) ? L.fcf > L.netIncome : null,
    L && fin(L.fcf) && fin(L.netIncome) ? `FCF ${fmtShort(L.fcf)} vs profit ${fmtShort(L.netIncome)}` : 'not known', 'Profit backed by cash after investment.');
  // 5 capex share of operating cash
  const cx = L && fin(L.capex) && fin(L.cfo) && L.cfo > 0 ? r1((Math.abs(L.capex) / L.cfo) * 100) : null;
  add('capex', 'Capex at most half of operating cash', cx == null ? null : cx <= 50, cx == null ? (L && fin(L.cfo) && L.cfo <= 0 ? 'operating cash negative' : 'capex not stated') : `${cx}% of operating cash`, 'A business that needs most of its cash to stand still is capital-hungry.');
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
  const avgM = mean(margins), ff = mean(last6.map((r) => (fin(r.fcf) && fin(mcap) && mcap > 0 ? (r.fcf / mcap) * 100 : null)).filter(fin));
  const metrics = [
    { label: `FCF growth a year (${n >= 1 ? n : '—'} yrs)`, value: pct(fcfC) },
    { label: 'FCF margin, average', value: pct(avgM == null ? null : r1(avgM)) },
    { label: 'FCF yield, average (today\'s cap)', value: pct(ff == null ? null : r1(ff)) },
    { label: 'Revenue growth a year', value: pct(revC) },
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

/** One company's lab verdict in plain words (no buy / sell): what the cash says and what the chart says. */
export function labSummary(f: FcfReport, rules: TrendRule[], stage: number | null, ttScreener: number | null = null): string {
  // the stock screener's own count (the Pine / stock screeners show it) wins over this page's recount, so the pages agree
  const tt = ttScreener ?? rules.filter((r) => r.ok).length, ttKnown = ttScreener != null ? 6 : rules.filter((r) => r.ok != null).length;
  const cash = f.known < 4 ? 'Not enough years of figures to judge the cash.' : f.passed >= Math.ceil(f.known * 0.75) ? 'Cash quality strong' : f.passed >= Math.ceil(f.known / 2) ? 'Cash quality mixed' : 'Cash quality weak';
  const chart = ttKnown < 4 ? 'price history too short for the trend template' : tt === 6 ? 'all six trend-template rules pass' : `${tt} of 6 trend-template rules pass`;
  return `${cash} (${f.passed}/${f.known} checks). Chart: ${stage != null ? `Stage ${stage}, ` : ''}${chart}.`;
}

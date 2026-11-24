// Options Ideas — extra context the second study found useful (pure). zzz1301e.
//   • catalyst: a results-style gap up (open ≥ 5% above the previous close on ≥ 2× the 50-day average volume) in the last 60
//     sessions, or ≥ 1.3× normal volume on the signal day. Grade A calls with one: +0.60 R a trade before / +0.67 R after the
//     hold-out (without: +0.18 / +0.27).
//   • HV percentile: today's 20-day volatility against its own last year. Options bought with HV in the top 30% returned about a
//     quarter of the others — the option is expensive then.
//   • sector strength: the median 3-month return of the stock's sector (screener snapshot) against the index. Grade A calls in a
//     sector weaker than the index: +0.16 R before / −0.17 R after; in a stronger one +0.34 / +0.44.
import type { PBar } from '../chart-patterns';

export interface ExtraCtx { gap60: boolean; gapDaysAgo: number | null; rvol: number; hv20: number; hvPct: number }
const hvAt = (c: number[], end: number, n: number) => {
  if (end - n < 1) return NaN;
  const r: number[] = []; for (let i = end - n + 1; i <= end; i++) r.push(Math.log(c[i] / c[i - 1]));
  const mu = r.reduce((a, b) => a + b, 0) / r.length;
  return Math.sqrt((r.reduce((a, b) => a + (b - mu) ** 2, 0) / (r.length - 1)) * 252);
};
export function extraCtx(b: PBar[], t = b.length - 1): ExtraCtx {
  const c = b.map((q) => q.c);
  let av = 0, k = 0; for (let i = Math.max(0, t - 50); i < t; i++) if (b[i].v > 0) { av += b[i].v; k++; }
  av = k ? av / k : 0;
  const rvol = av > 0 && b[t].v > 0 ? b[t].v / av : 1;
  let gapDaysAgo: number | null = null;
  for (let i = t - 1; i >= Math.max(1, t - 60); i--) if (b[i].o / b[i - 1].c - 1 >= 0.05 && av > 0 && b[i].v >= 2 * av) { gapDaysAgo = t - i; break; }
  const hv20 = hvAt(c, t, 20);
  const hist: number[] = []; for (let i = t - 250; i <= t; i += 5) { const h = hvAt(c, i, 20); if (Number.isFinite(h)) hist.push(h); }
  const hvPct = hist.length >= 20 && Number.isFinite(hv20) ? Math.round((hist.filter((x) => x <= hv20).length / hist.length) * 100) : 50;
  return { gap60: gapDaysAgo != null, gapDaysAgo, rvol: Math.round(rvol * 100) / 100, hv20: Number.isFinite(hv20) ? Math.round(hv20 * 1000) / 10 : 0, hvPct };
}
export const CATALYST_RVOL = 1.3;
export const HV_EXPENSIVE_PCT = 70;

/** sector → median 3-month return, from screener rows ({ sec, perf3M }) — at least 4 companies a sector */
export function sectorMedians(rows: Array<{ sec?: string | null; perf3M?: number | null }>): Map<string, number> {
  const g = new Map<string, number[]>();
  for (const r of rows) if (r.sec && typeof r.perf3M === 'number' && Number.isFinite(r.perf3M)) { if (!g.has(r.sec)) g.set(r.sec, []); g.get(r.sec)!.push(r.perf3M); }
  const out = new Map<string, number>();
  for (const [s, v] of g) if (v.length >= 4) { v.sort((a, b) => a - b); out.set(s, v[Math.floor(v.length / 2)]); }
  return out;
}

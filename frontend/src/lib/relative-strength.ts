// zzz891 — RELATIVE STRENGTH AGAINST THE INDEX: a stock up 20% in a market up 25% is lagging. The Technicals tab showed
// only absolute returns; this subtracts the index return over the same window (NIFTY 50 for India from NSE's own published
// closes, the S&P 500 for the USA) and names the result: LEADING / LAGGING / MIXED. Pure, unit-tested.
export interface IndexReturns { index: string; asOf: string | null; r1m: number | null; r3m: number | null; r6m: number | null; r12m: number | null }
export interface RsVsIndex { rel1m: number | null; rel3m: number | null; rel6m: number | null; rel12m: number | null; verdict: 'LEADING' | 'LAGGING' | 'MIXED' | 'NO_DATA'; text: string }

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Return over n sessions from an ascending close series, %. */
export function retOver(close: number[], n: number): number | null {
  if (!Array.isArray(close) || close.length <= n) return null;
  const a = close[close.length - 1 - n], b = close[close.length - 1];
  return num(a) && num(b) && a > 0 ? r1((b / a - 1) * 100) : null;
}
export function indexReturnsFrom(name: string, ts: number[], close: number[]): IndexReturns {
  const last = ts?.length ? Number(ts[ts.length - 1]) : null;
  return { index: name, asOf: last ? new Date(last > 1e12 ? last : last * 1000).toISOString().slice(0, 10) : null,
    r1m: retOver(close, 21), r3m: retOver(close, 63), r6m: retOver(close, 126), r12m: retOver(close, 252) };
}

/** Stock returns (perf %, as TradingView exports them) minus the index over the same windows. */
export function rsVsIndex(row: { perf1m?: number | null; perf3m?: number | null; perf6m?: number | null; perf1y?: number | null }, idx: IndexReturns | null): RsVsIndex {
  if (!idx) return { rel1m: null, rel3m: null, rel6m: null, rel12m: null, verdict: 'NO_DATA', text: 'Index returns not loaded.' };
  const d = (a: unknown, b: number | null) => (num(a) && num(b) ? r1(a - b) : null);
  const rel1m = d(row.perf1m, idx.r1m), rel3m = d(row.perf3m, idx.r3m), rel6m = d(row.perf6m, idx.r6m), rel12m = d(row.perf1y, idx.r12m);
  const known = [rel1m, rel3m, rel6m, rel12m].filter(num);
  if (!known.length) return { rel1m, rel3m, rel6m, rel12m, verdict: 'NO_DATA', text: 'No return windows to compare.' };
  const up = known.filter((v) => v > 0).length, down = known.filter((v) => v < 0).length;
  // every window agrees → that; otherwise the 3-month window decides when it is clear (5+ pts), else MIXED
  const verdict = up === known.length ? 'LEADING' : down === known.length ? 'LAGGING' : num(rel3m) && Math.abs(rel3m) >= 5 ? (rel3m > 0 ? 'LEADING' : 'LAGGING') : 'MIXED';
  const part = (lbl: string, v: number | null) => (v == null ? null : `${lbl} ${v >= 0 ? '+' : ''}${v} pts`);
  const text = `${verdict === 'LEADING' ? 'Beating' : verdict === 'LAGGING' ? 'Trailing' : 'Mixed against'} ${idx.index}: ${[part('1M', rel1m), part('3M', rel3m), part('6M', rel6m), part('12M', rel12m)].filter(Boolean).join(', ')}${idx.asOf ? ` (index as of ${idx.asOf})` : ''}.`;
  return { rel1m, rel3m, rel6m, rel12m, verdict, text };
}

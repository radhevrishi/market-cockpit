// zzz1263 — RELATIVE-STRENGTH RANK (1–99) for every company in a screener snapshot.
// The "already rewarded" rule (lib/rewarded) has an RS leg — RS 90+ together with 25%+ in 3 months — that was never
// wired because rows carried no RS figure. This gives one, the usual way: a weighted return (the last 3 months count
// double), ranked against every other company of the SAME market snapshot; 99 = stronger than 99% of them.
// Pure; the ranks of one snapshot are worked out once and kept (WeakMap on the rows array).
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Weighted return: 3 months 40%, 6 months 30%, 1 year 30%; a missing window hands its weight to the others. Needs 3M + one more. */
export function rsScore(r: { perf3M?: number | null; perf6M?: number | null; perf1Y?: number | null } | null | undefined): number | null {
  if (!r || !num(r.perf3M)) return null;
  const parts: Array<[number, number]> = [[r.perf3M, 0.4]];
  if (num(r.perf6M)) parts.push([r.perf6M, 0.3]);
  if (num(r.perf1Y)) parts.push([r.perf1Y, 0.3]);
  if (parts.length < 2) return null;
  let w = 0, s = 0;
  for (const [v, k] of parts) { s += v * k; w += k; }
  return s / w;
}

const memo = new WeakMap<object, Map<string, number>>();

/** ticker (upper-case) → RS rank 1–99. Companies without a score have no rank (unknown, not zero). */
export function rsRanks(rows: ReadonlyArray<any> | null | undefined): Map<string, number> {
  if (!rows || !rows.length) return new Map();
  const hit = memo.get(rows as object);
  if (hit) return hit;
  const scored: Array<[string, number]> = [];
  for (const r of rows) { const s = rsScore(r); const t = String(r?.t || '').toUpperCase(); if (t && s != null) scored.push([t, s]); }
  scored.sort((a, b) => a[1] - b[1]);
  const out = new Map<string, number>();
  const n = scored.length;
  for (let i = 0; i < n; i++) {
    // equal scores share the rank of the first of them
    let j = i; while (j > 0 && scored[j - 1][1] === scored[i][1]) j--;
    out.set(scored[i][0], n < 20 ? 50 : Math.max(1, Math.min(99, Math.round((j / (n - 1)) * 98) + 1)));
  }
  memo.set(rows as object, out);
  return out;
}

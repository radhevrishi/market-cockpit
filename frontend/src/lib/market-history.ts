// zzz404 — Shared real annual-return history + statistics for the scenario
// simulators and the Historical Returns tab.
//
// Data provenance (calendar-year returns, price-return basis, rounded):
//   • Nasdaq-100 (QQQ underlying, index inception 1985): 1986–2025.
//     Source: slickcharts.com/nasdaq100/returns (cross-checked 1stock1.com).
//   • Nifty Smallcap 100 (NSE): 2007–2025. Anchored to the TheWrap deck's
//     verified figures (2009 +107, 2012 +36.8, 2014 +55, 2019 −9.5,
//     2020 +21.5, 2023 +55.6, 2024 +23.9, 2025 −5.6) + published NSE
//     calendar-year returns. Figures may differ ~1pp by vendor (TR vs PR).
//
// Pure module — no Date/Math.random at import (safe for SSR + workflows).

export interface YearReturn { year: number; ret: number; }

// ── Nasdaq-100 (QQQ) annual % returns, 1986–2025 (40 completed years) ──
export const NASDAQ100: YearReturn[] = [
  { year: 1986, ret: 6.89 }, { year: 1987, ret: 10.50 }, { year: 1988, ret: 13.54 },
  { year: 1989, ret: 26.17 }, { year: 1990, ret: -10.41 }, { year: 1991, ret: 64.99 },
  { year: 1992, ret: 8.87 }, { year: 1993, ret: 10.58 }, { year: 1994, ret: 1.50 },
  { year: 1995, ret: 42.54 }, { year: 1996, ret: 42.54 }, { year: 1997, ret: 20.63 },
  { year: 1998, ret: 85.31 }, { year: 1999, ret: 101.95 }, { year: 2000, ret: -36.84 },
  { year: 2001, ret: -32.65 }, { year: 2002, ret: -37.58 }, { year: 2003, ret: 49.12 },
  { year: 2004, ret: 10.44 }, { year: 2005, ret: 1.49 }, { year: 2006, ret: 6.79 },
  { year: 2007, ret: 18.67 }, { year: 2008, ret: -41.89 }, { year: 2009, ret: 53.54 },
  { year: 2010, ret: 19.22 }, { year: 2011, ret: 2.70 }, { year: 2012, ret: 16.82 },
  { year: 2013, ret: 34.99 }, { year: 2014, ret: 17.94 }, { year: 2015, ret: 8.43 },
  { year: 2016, ret: 5.89 }, { year: 2017, ret: 31.52 }, { year: 2018, ret: -1.04 },
  { year: 2019, ret: 37.96 }, { year: 2020, ret: 47.58 }, { year: 2021, ret: 26.63 },
  { year: 2022, ret: -32.97 }, { year: 2023, ret: 53.81 }, { year: 2024, ret: 24.88 },
  { year: 2025, ret: 20.17 },
];

// ── Nifty Smallcap 100 annual % returns, 2007–2025 (19 completed years) ──
export const SMALLCAP100: YearReturn[] = [
  { year: 2007, ret: 94.6 }, { year: 2008, ret: -72.0 }, { year: 2009, ret: 107.0 },
  { year: 2010, ret: 17.6 }, { year: 2011, ret: -36.0 }, { year: 2012, ret: 36.8 },
  { year: 2013, ret: -8.0 }, { year: 2014, ret: 55.0 }, { year: 2015, ret: 7.2 },
  { year: 2016, ret: 1.4 }, { year: 2017, ret: 57.3 }, { year: 2018, ret: -29.1 },
  { year: 2019, ret: -9.5 }, { year: 2020, ret: 21.5 }, { year: 2021, ret: 59.3 },
  { year: 2022, ret: -13.8 }, { year: 2023, ret: 55.6 }, { year: 2024, ret: 23.9 },
  { year: 2025, ret: -5.6 },
];

// ── statistics ──
export interface HistStats {
  n: number; avg: number; median: number; cagr: number; stdev: number;
  best: YearReturn; worst: YearReturn; posPct: number; negCount: number;
  longestUp: number; longestDown: number; maxDrawdown: number;
}

export function computeStats(series: YearReturn[]): HistStats {
  const n = series.length;
  const rets = series.map(s => s.ret);
  const avg = rets.reduce((a, b) => a + b, 0) / n;
  const sorted = rets.slice().sort((a, b) => a - b);
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const cagr = (Math.pow(series.reduce((p, s) => p * (1 + s.ret / 100), 1), 1 / n) - 1) * 100;
  const variance = rets.reduce((a, b) => a + (b - avg) ** 2, 0) / n;
  const stdev = Math.sqrt(variance);
  let best = series[0], worst = series[0];
  for (const s of series) { if (s.ret > best.ret) best = s; if (s.ret < worst.ret) worst = s; }
  const posPct = (rets.filter(r => r > 0).length / n) * 100;
  const negCount = rets.filter(r => r < 0).length;
  let longestUp = 0, longestDown = 0, curUp = 0, curDown = 0;
  for (const r of rets) {
    if (r > 0) { curUp++; curDown = 0; } else { curDown++; curUp = 0; }
    longestUp = Math.max(longestUp, curUp);
    longestDown = Math.max(longestDown, curDown);
  }
  // year-end drawdown from compounded wealth path
  let w = 1, peak = 1, maxDD = 0;
  for (const s of series) {
    w *= (1 + s.ret / 100);
    peak = Math.max(peak, w);
    maxDD = Math.max(maxDD, (peak - w) / peak);
  }
  return { n, avg, median, cagr, stdev, best, worst, posPct, negCount, longestUp, longestDown, maxDrawdown: maxDD * 100 };
}

/** Growth of `start` invested at the beginning; first point is (firstYear-1, start). */
export function growthOf(series: YearReturn[], start = 1): { year: number; value: number }[] {
  const out: { year: number; value: number }[] = [{ year: series[0].year - 1, value: start }];
  let w = start;
  for (const s of series) { w *= (1 + s.ret / 100); out.push({ year: s.year, value: w }); }
  return out;
}

/** Rolling window CAGR (window in years). */
export function rollingCagr(series: YearReturn[], window: number): { endYear: number; cagr: number }[] {
  const out: { endYear: number; cagr: number }[] = [];
  for (let i = window - 1; i < series.length; i++) {
    let p = 1;
    for (let j = i - window + 1; j <= i; j++) p *= (1 + series[j].ret / 100);
    out.push({ endYear: series[i].year, cagr: (Math.pow(p, 1 / window) - 1) * 100 });
  }
  return out;
}

// ── scenario buckets (data-driven midpoints/frequencies) ──
export interface BucketDef { id: string; label: string; range: string; min: number; max: number; color: string; }
export interface Bucket extends BucketDef {
  years: number[]; count: number; freq: number; midpoint: number; band: [number, number];
}

export function bucketize(series: YearReturn[], defs: BucketDef[]): Bucket[] {
  return defs.map(d => {
    const inb = series.filter(s => s.ret >= d.min && s.ret < d.max);
    const rets = inb.map(s => s.ret);
    const midpoint = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : (d.min + d.max) / 2;
    const lo = rets.length ? Math.min(...rets) : d.min;
    const hi = rets.length ? Math.max(...rets) : d.max;
    return {
      ...d, years: inb.map(s => s.year), count: inb.length,
      freq: (inb.length / series.length) * 100, midpoint,
      band: [lo, hi] as [number, number],
    };
  });
}

/** Integer probabilities (summing to 100) from bucket frequencies. */
export function freqProbs(buckets: Bucket[]): number[] {
  const raw = buckets.map(b => b.freq);
  const rounded = raw.map(r => Math.round(r));
  let diff = 100 - rounded.reduce((a, b) => a + b, 0);
  // distribute rounding error onto the largest buckets
  const order = raw.map((_, i) => i).sort((a, b) => raw[b] - raw[a]);
  let k = 0;
  while (diff !== 0 && order.length) {
    const idx = order[k % order.length];
    rounded[idx] += diff > 0 ? 1 : -1;
    diff += diff > 0 ? -1 : 1;
    k++;
  }
  return rounded.map(r => Math.max(0, r));
}

/**
 * Data-driven cascade: for each bucket, average the actual t+1..t+horizon
 * returns that historically followed years in that bucket.
 *
 * `priorK` applies James-Stein–style shrinkage toward the unconditional mean:
 *   shrunk = (count·sampleMean + priorK·globalMean) / (count + priorK)
 * This is essential because some buckets have very few forward observations
 * (e.g. a "bad year" bucket with a single member) — without shrinkage a lone
 * lucky follow-year (1990 → 1991 +65%) would dominate the whole projection.
 * With priorK≈4, thin buckets are pulled firmly toward the mean; well-sampled
 * buckets barely move. priorK=0 reproduces the raw historical average.
 */
export function conditionalPaths(series: YearReturn[], buckets: Bucket[], horizon = 4, priorK = 0): Record<string, number[]> {
  const byYear = new Map(series.map(s => [s.year, s.ret]));
  const globalMean = series.reduce((a, s) => a + s.ret, 0) / series.length;
  const out: Record<string, number[]> = {};
  for (const b of buckets) {
    const sums = new Array(horizon).fill(0);
    const counts = new Array(horizon).fill(0);
    for (const y of b.years) {
      for (let h = 1; h <= horizon; h++) {
        const r = byYear.get(y + h);
        if (r !== undefined) { sums[h - 1] += r; counts[h - 1]++; }
      }
    }
    out[b.id] = sums.map((s, i) => {
      const c = counts[i];
      const sampleMean = c ? s / c : globalMean;
      if (priorK <= 0) return sampleMean;
      return (c * sampleMean + priorK * globalMean) / (c + priorK);
    });
  }
  return out;
}

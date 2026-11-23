// ═══════════════════════════════════════════════════════════════════════════
// MARKET LEADERSHIP & RISK — pure engine (zzz1290)
//
// One page that answers: where is the market's risk, leadership, deterioration and emerging opportunity, per market
// (USA, India — evaluated independently). Inputs are what the site already has:
//   • benchmark daily bars (Yahoo, same source as lib/theme-cycle and /api/market/regime)
//   • the stock-screener snapshot (the Technicals engine: price, 21/50/200-day averages, 52-week high/low, returns,
//     weekly stage, volumes) for breadth, the leader universe and emerging names
//   • Theme Rotation (client) for themes — not recomputed here.
// Every number is shown with the rule that produced it. Not buy / sell signals.
//
// Methodology choices (documented here once, shown on the page):
//   Distribution day — the benchmark closes DOWN ≥ 0.2% on volume HIGHER than the session before. It counts for 25
//     sessions and drops out early once the benchmark closes 5% above that day's close (IBD convention). Zero-volume
//     sessions are skipped (India index volume is sometimes missing on Yahoo). Stalling days are NOT counted (too
//     subjective to code without false precision) — disclosed.
//   Rally attempt / follow-through day — after the benchmark has fallen ≥ 7% from its high, day 1 is the first up
//     close after the lowest close; the attempt fails if a later close undercuts that low. A follow-through day is an
//     up close of ≥ 1.25% on higher volume than the day before, on day 4 or later of a live attempt. A follow-through
//     is ONE piece of evidence; the page never calls a recovery on it alone.
//   Leaders — liquid companies with the strongest run-up INTO their 52-week high (price a year ago → 52-week high),
//     top 5% of the liquid universe (15–60 names), run-up ≥ 50%. Chosen by what they did before the high, so a
//     leader that has since broken is still counted (no survivorship). The count is whatever the data gives.
// ═══════════════════════════════════════════════════════════════════════════

export type Mkt = 'US' | 'IN';
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export interface Bars { d: string[]; c: number[]; v: number[] }

export const sma = (c: readonly number[], n: number, end = c.length): number | null => {
  if (end < n) return null;
  let s = 0; for (let i = end - n; i < end; i++) s += c[i];
  return s / n;
};

// ── distribution days ───────────────────────────────────────────────────────
export interface DistDay { d: string; chg: number; volUp: number; expired?: 'age' | 'rally' }
export const DIST = { down: -0.2, window: 25, rallyOut: 0.05 } as const;

/** Distribution days alive at session index `end` (exclusive end = through bar end-1). */
export function distributionDays(b: Bars, end = b.c.length): DistDay[] {
  const out: DistDay[] = [];
  const start = Math.max(1, end - DIST.window);
  for (let i = start; i < end; i++) {
    const prevV = b.v[i - 1], v = b.v[i];
    if (!(v > 0) || !(prevV > 0)) continue;
    const chg = (b.c[i] / b.c[i - 1] - 1) * 100;
    if (chg > DIST.down || v <= prevV) continue;
    // drops out once the index has closed 5% above this day's close afterwards
    let rallied = false;
    for (let k = i + 1; k < end; k++) if (b.c[k] >= b.c[i] * (1 + DIST.rallyOut)) { rallied = true; break; }
    if (rallied) continue;
    out.push({ d: b.d[i], chg: +chg.toFixed(2), volUp: +((v / prevV - 1) * 100).toFixed(1) });
  }
  return out;
}

export interface DistRead { count: number; days: DistDay[]; ago5: number | null; ago10: number | null; ago20: number | null; trend: 'rising' | 'falling' | 'steady' | 'unknown'; cluster10: number; level: 'low' | 'pressure' | 'heavy'; volumeOk: boolean }
export function distributionRead(b: Bars): DistRead {
  const n = b.c.length;
  const withVol = b.v.slice(-30).filter((x) => x > 0).length;
  const volumeOk = withVol >= 25;
  const at = (k: number) => (n - k > DIST.window + 1 ? distributionDays(b, n - k).length : null);
  const days = distributionDays(b, n);
  const count = days.length, ago5 = at(5), ago10 = at(10), ago20 = at(20);
  const ref = ago10 ?? ago5;
  const trend = ref == null ? 'unknown' : count > ref + 1 ? 'rising' : count < ref - 1 ? 'falling' : 'steady';
  const last10 = new Set(b.d.slice(-10));
  const cluster10 = days.filter((x) => last10.has(x.d)).length;
  const level = count >= 6 ? 'heavy' : count >= 4 ? 'pressure' : 'low';
  return { count, days: days.slice().reverse(), ago5, ago10, ago20, trend, cluster10, level, volumeOk };
}

// ── rally attempt / follow-through ──────────────────────────────────────────
export interface RallyRead { state: 'none' | 'no-correction' | 'attempt' | 'failed' | 'follow-through'; lowDay: string | null; low: number | null; day: number | null; ftdDay: string | null; ftdGain: number | null; fromLow: number | null }
export function rallyRead(b: Bars, lookback = 120): RallyRead {
  const n = b.c.length;
  const empty: RallyRead = { state: 'none', lowDay: null, low: null, day: null, ftdDay: null, ftdGain: null, fromLow: null };
  if (n < 30) return empty;
  const from = Math.max(0, n - lookback);
  // the high before the lowest close in the window, and the low itself
  let lo = from; for (let i = from; i < n; i++) if (b.c[i] < b.c[lo]) lo = i;
  let hi = from; for (let i = from; i <= lo; i++) if (b.c[i] > b.c[hi]) hi = i;
  // a high earlier than the window can matter: use the 52-week high up to the low
  let hiAll = hi; for (let i = Math.max(0, lo - 252); i <= lo; i++) if (b.c[i] > b.c[hiAll]) hiAll = i;
  const fall = 1 - b.c[lo] / b.c[hiAll];
  if (fall < 0.07) return { ...empty, state: 'no-correction' };
  const base = { lowDay: b.d[lo], low: b.c[lo], fromLow: +((b.c[n - 1] / b.c[lo] - 1) * 100).toFixed(1) };
  if (lo === n - 1) return { ...empty, ...base, state: 'none' };
  // day 1 = first up close after the low; any later close under the low resets → failed
  let d1 = -1; for (let i = lo + 1; i < n; i++) if (b.c[i] > b.c[i - 1]) { d1 = i; break; }
  if (d1 < 0) return { ...empty, ...base, state: 'none' };
  for (let i = d1; i < n; i++) if (b.c[i] < b.c[lo]) return { ...empty, ...base, state: 'failed', day: null };
  let ftd = -1, gain = 0;
  for (let i = d1 + 3; i < n; i++) {   // day 4 or later
    const g = (b.c[i] / b.c[i - 1] - 1) * 100;
    if (g >= 1.25 && b.v[i] > 0 && b.v[i - 1] > 0 && b.v[i] > b.v[i - 1]) { ftd = i; gain = g; break; }
  }
  const day = n - d1;
  if (ftd >= 0) return { ...base, state: 'follow-through', day, ftdDay: b.d[ftd], ftdGain: +gain.toFixed(2) };
  return { ...empty, ...base, state: 'attempt', day };
}

// ── benchmark structure ────────────────────────────────────────────────────
export interface BenchRead {
  name: string; last: string; close: number;
  vs20: number | null; vs50: number | null; vs200: number | null;   // % above (+) / below (−)
  slope50: 'rising' | 'falling' | 'flat' | null; slope200: 'rising' | 'falling' | 'flat' | null;
  dd: number; high: number; highDay: string;                           // % below the 52-week closing high
  vol20: number | null; volMedian: number | null;                      // annualised 20-day volatility, and its 1-year median
  ret: { d1: number | null; w1: number | null; m1: number | null; m3: number | null; m6: number | null; y1: number | null };
  dist: DistRead; rally: RallyRead;
}
const pctVs = (a: number | null, b: number | null) => (a != null && b != null && b > 0 ? +((a / b - 1) * 100).toFixed(2) : null);
function slope(c: number[], n: number, back: number): BenchRead['slope50'] {
  const now = sma(c, n), then = sma(c, n, c.length - back);
  if (now == null || then == null) return null;
  const ch = (now / then - 1) * 100;
  return ch > 0.25 ? 'rising' : ch < -0.25 ? 'falling' : 'flat';
}
function volAnn(c: number[], end: number, n = 20): number | null {
  if (end < n + 1) return null;
  const r: number[] = []; for (let i = end - n; i < end; i++) r.push(Math.log(c[i] / c[i - 1]));
  const m = r.reduce((a, b) => a + b, 0) / n;
  return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) * Math.sqrt(252) * 100;
}
export function benchRead(name: string, b: Bars): BenchRead | null {
  const n = b.c.length; if (n < 210) return null;
  const c = b.c, last = c[n - 1];
  let hi = Math.max(0, n - 252); for (let i = hi; i < n; i++) if (c[i] >= c[hi]) hi = i;
  const vols: number[] = []; for (let e = n - 252; e <= n; e += 5) { const v = volAnn(c, e); if (v != null) vols.push(v); }
  vols.sort((a, z) => a - z);
  const r = (k: number) => (n > k ? +((last / c[n - 1 - k] - 1) * 100).toFixed(2) : null);
  return {
    name, last: b.d[n - 1], close: last,
    vs20: pctVs(last, sma(c, 20)), vs50: pctVs(last, sma(c, 50)), vs200: pctVs(last, sma(c, 200)),
    slope50: slope(c, 50, 10), slope200: slope(c, 200, 20),
    dd: +((1 - last / c[hi]) * 100).toFixed(2), high: c[hi], highDay: b.d[hi],
    vol20: volAnn(c, n) != null ? +volAnn(c, n)!.toFixed(1) : null, volMedian: vols.length ? +vols[Math.floor(vols.length / 2)].toFixed(1) : null,
    ret: { d1: r(1), w1: r(5), m1: r(21), m3: r(63), m6: r(126), y1: r(252) },
    dist: distributionRead(b), rally: rallyRead(b),
  };
}

// ── breadth over the screener universe ──────────────────────────────────────
export interface Row { t: string; n?: string; px?: number; chg?: number; mc?: number; avgVol30?: number; sma21?: number; sma50?: number; sma200?: number; sma50P?: number; sma200P?: number; hi52?: number; lo52?: number; perf1W?: number; perf1M?: number; perf3M?: number; perf6M?: number; perf1Y?: number; twSt?: number; ind?: string; sec?: string; [k: string]: unknown }
export const LIQ = { US: { mc: 300, adv: 2e6 }, IN: { mc: 500, adv: 1e7 } } as const;   // US $M / $ a day; India ₹ Cr / ₹ a day
// Leaders are the institutional names that carried the last advance (O'Neil's sense): large and liquid, so one biotech spike
// cannot fill the list. Emerging names use a lower bar (EMERGE_LIQ) — new leadership often starts smaller.
export const LEADER_LIQ = { US: { mc: 10_000, adv: 100e6 }, IN: { mc: 10_000, adv: 25e7 } } as const;
export const EMERGE_LIQ = { US: { mc: 2000, adv: 20e6 }, IN: { mc: 2000, adv: 10e7 } } as const;
export const traded = (r: Row) => (num(r.px) && num(r.avgVol30) ? r.px * r.avgVol30 : null);
export function liquid(r: Row, m: Mkt, lim: { mc: number; adv: number } = LIQ[m]): boolean {
  return num(r.px) && num(r.mc) && r.mc >= lim.mc && (traded(r) ?? 0) >= lim.adv;
}

export interface Breadth {
  n: number; a20: number | null; a50: number | null; a200: number | null; n200: number;
  a50Prev: number | null;               // yesterday's share above the 50-day line (from yesterday's close + average)
  nh: number; nl: number; nlKnown: boolean; adv: number; dec: number; unch: number;
  stage2: number | null; stage4: number | null; nStage: number;
}
const share = (k: number, n: number) => (n ? +((k / n) * 100).toFixed(1) : null);
export function breadthOf(rows: Row[], m: Mkt): Breadth {
  const u = rows.filter((r) => liquid(r, m));
  let a20 = 0, n20 = 0, a50 = 0, n50 = 0, a200 = 0, n200 = 0, p50 = 0, np50 = 0, nh = 0, nl = 0, nlK = 0, adv = 0, dec = 0, unch = 0, s2 = 0, s4 = 0, ns = 0;
  for (const r of u) {
    const px = r.px!;
    if (num(r.sma21)) { n20++; if (px > r.sma21) a20++; }
    if (num(r.sma50)) { n50++; if (px > r.sma50) a50++; }
    if (num(r.sma200)) { n200++; if (px > r.sma200) a200++; }
    if (num(r.sma50P) && num(r.chg)) { const prev = px / (1 + r.chg / 100); np50++; if (prev > r.sma50P) p50++; }
    if (num(r.hi52) && px >= r.hi52 * 0.99) nh++;
    if (num(r.lo52)) { nlK++; if (px <= r.lo52 * 1.01) nl++; }
    if (num(r.chg)) { if (r.chg > 0.05) adv++; else if (r.chg < -0.05) dec++; else unch++; }
    if (num(r.twSt)) { ns++; if (r.twSt === 2) s2++; if (r.twSt === 4) s4++; }
  }
  return { n: u.length, a20: share(a20, n20), a50: share(a50, n50), a200: share(a200, n200), n200, a50Prev: np50 >= 50 ? share(p50, np50) : null,
    nh, nl, nlKnown: nlK >= u.length * 0.5, adv, dec, unch, stage2: share(s2, ns), stage4: share(s4, ns), nStage: ns };
}

// ── leaders ────────────────────────────────────────────────────────────────
export type LeaderState = 'HEALTHY' | 'UNDER_PRESSURE' | 'BROKEN' | 'RECOVERING';
export interface Leader {
  t: string; n: string; ind: string | null; runUp: number; dd: number | null;
  vs50: number | null; vs200: number | null; sma50Rising: boolean | null; newHigh: boolean; newLow: boolean | null;
  rs: number | null; relM1: number | null; state: LeaderState; why: string;
  /** zzz1291 — listed less than a year ago: months since listing (its run-up starts at the listing price) */
  listedMonths?: number;
}
/** Price a year ago → 52-week high: the run-up the company made INTO its high. */
export function runUpOf(r: Row): number | null {
  if (!num(r.px) || !num(r.hi52) || !num(r.perf1Y) || r.perf1Y <= -100) return null;
  const yearAgo = r.px / (1 + r.perf1Y / 100);
  if (!(yearAgo > 0)) return null;
  // zzz1291 — the price a year ago is the start of the 52-week window, so it must sit inside that window's range. A one-year
  // change that puts it far below the 52-week low (MRNA +1,025% — a stale or split-broken figure) is not used.
  if (num(r.lo52) && r.lo52 > 0 && (yearAgo < r.lo52 * 0.85 || yearAgo > r.hi52 * 1.15)) return null;
  if (r.hi52 < r.px * 0.98) return null;   // the high is older than today's price allows: a stale high
  return (r.hi52 / yearAgo - 1) * 100;
}
export function leaderState(r: Row): { state: LeaderState; why: string } {
  const px = r.px!, dd = num(r.hi52) ? (1 - px / r.hi52) * 100 : null;
  const a50 = num(r.sma50) ? px > r.sma50 : null, a200 = num(r.sma200) ? px > r.sma200 : null;
  const rising50 = num(r.sma50) && num(r.sma50P) ? r.sma50 > r.sma50P : null;
  if (a200 === false && a50 === true && rising50 !== false) return { state: 'RECOVERING', why: 'below its 200-day line but back above a 50-day line that is not falling' };
  // zzz1291 — "Broken" only below the 200-day line (or, with too little history for one, 35%+ off the high and below the 50-day).
  // A name 35%+ off its high but still above its 200-day line is under pressure, said with both facts (STLTECH).
  const short = a200 == null ? ' (fewer than 200 sessions of history — no 200-day line yet)' : '';
  if (a200 === false) return { state: 'BROKEN', why: `below its 200-day line${dd != null ? `, ${dd.toFixed(0)}% off its high` : ''}` };
  if (a200 == null && a50 === false && dd != null && dd >= 35) return { state: 'BROKEN', why: `${dd.toFixed(0)}% off its high and below its 50-day line${short}` };
  if (a50 === false || (dd != null && dd >= 15)) return { state: 'UNDER_PRESSURE', why: a50 === false ? `below its 50-day line${a200 ? ', still above its 200-day' : short}` : `${dd!.toFixed(0)}% off its high${a200 ? ', still above its 200-day line' : short}` };
  return { state: 'HEALTHY', why: `above its 50-day${a200 ? ' and 200-day lines' : ` line${short}`}${dd != null ? `, ${dd.toFixed(0)}% off its high` : ''}` };
}
/** zzz1291 — days since listing (screener `ipoD` = first trading day, days since 1970), null when unknown. */
export const listedDaysOf = (r: Row, nowMs = Date.now()): number | null => (num(r.ipoD) ? Math.floor(nowMs / 86_400_000) - (r.ipoD as number) : null);
export const LEADER_MIN_LISTED_DAYS = 180;
export function pickLeaders(rows: Row[], m: Mkt, rsMap: Map<string, number>, benchM1: number | null, nowMs = Date.now()): { leaders: Leader[]; universe: number; rule: string; recentLeft: number } {
  // a company listed under ~6 months has no year of trading behind its 'run-up' (often just the listing pop): left out, counted
  const young = (r: Row) => { const d = listedDaysOf(r, nowMs); return d != null && d < LEADER_MIN_LISTED_DAYS; };
  const recentLeft = rows.filter((r) => liquid(r, m, LEADER_LIQ[m]) && young(r)).length;
  const pool = rows.filter((r) => liquid(r, m, LEADER_LIQ[m]) && !young(r)).map((r) => ({ r, up: runUpOf(r) })).filter((x): x is { r: Row; up: number } => x.up != null && x.up >= 40);
  const universe = rows.filter((r) => liquid(r, m, LEADER_LIQ[m])).length;
  const k = Math.max(15, Math.min(40, Math.round(universe * 0.06)));
  pool.sort((a, b) => b.up - a.up);
  const leaders0 = pool.slice(0, k).map(({ r, up }) => {
    const s = leaderState(r);
    return {
      t: r.t, n: String(r.n || r.t), ind: (r.ind as string) || (r.sec as string) || null, runUp: +up.toFixed(0),
      dd: num(r.hi52) ? +((1 - r.px! / r.hi52) * 100).toFixed(1) : null,
      vs50: pctVs(r.px!, num(r.sma50) ? r.sma50 : null), vs200: pctVs(r.px!, num(r.sma200) ? r.sma200 : null),
      sma50Rising: num(r.sma50) && num(r.sma50P) ? r.sma50 > r.sma50P : null,
      newHigh: num(r.hi52) ? r.px! >= r.hi52 * 0.99 : false, newLow: num(r.lo52) ? r.px! <= r.lo52 * 1.01 : null,
      rs: rsMap.get(r.t.toUpperCase()) ?? null, relM1: num(r.perf1M) && benchM1 != null ? +(r.perf1M - benchM1).toFixed(1) : null,
      ...s,
      ...(() => { const d = listedDaysOf(r, nowMs); return d != null && d < 365 ? { listedMonths: Math.max(1, Math.round(d / 30.4)) } : {}; })(),
    };
  });
  // zzz1291 — shown healthy first, then recovering, under pressure, broken; inside a state the biggest run-up first
  const ORD: Record<LeaderState, number> = { HEALTHY: 0, RECOVERING: 1, UNDER_PRESSURE: 2, BROKEN: 3 };
  const leaders = leaders0.slice().sort((a, b) => ORD[a.state] - ORD[b.state] || b.runUp - a.runUp);
  const cap = m === 'US' ? '$10B and $100M traded a day' : '₹10,000 Cr and ₹25 Cr traded a day';
  return { leaders, universe, rule: `Top 6% (${k}) of ${universe} large, liquid companies (market cap ≥ ${cap}) by run-up into their 52-week high (price a year ago → high), run-up ≥ 40%. Chosen by the run-up, so leaders that have since broken stay counted. Companies listed under 6 months are left out${recentLeft ? ` (${recentLeft} now)` : ''}; one listed under a year is marked — its run-up starts at the listing price.`, recentLeft };
}
export interface LeaderHealth { n: number; healthy: number; pressure: number; broken: number; recovering: number; above50: number; above200: number; newHighs: number; newLows: number | null; rsUp: number; rsDown: number; healthyPct: number | null; deterioratingPct: number | null; concentration: 'broad' | 'narrow' | 'very narrow' | null }
export function leaderHealth(L: Leader[]): LeaderHealth {
  const c = (f: (l: Leader) => boolean) => L.filter(f).length;
  const n = L.length;
  const healthy = c((l) => l.state === 'HEALTHY'), broken = c((l) => l.state === 'BROKEN'), pressure = c((l) => l.state === 'UNDER_PRESSURE');
  const hp = n ? +((healthy / n) * 100).toFixed(0) : null;
  return {
    n, healthy, pressure, broken, recovering: c((l) => l.state === 'RECOVERING'),
    above50: c((l) => (l.vs50 ?? -1) > 0), above200: c((l) => (l.vs200 ?? -1) > 0),
    newHighs: c((l) => l.newHigh), newLows: L.some((l) => l.newLow != null) ? c((l) => l.newLow === true) : null,
    rsUp: c((l) => (l.relM1 ?? 0) > 0), rsDown: c((l) => (l.relM1 ?? 0) < 0),
    healthyPct: hp, deterioratingPct: n ? +(((pressure + broken) / n) * 100).toFixed(0) : null,
    concentration: hp == null ? null : hp >= 45 ? 'broad' : hp >= 20 ? 'narrow' : 'very narrow',
  };
}

// ── emerging names (not on the leader list) ─────────────────────────────────
export interface Emerging { t: string; n: string; ind: string | null; rs: number; dd: number; relM1: number | null; vs50: number | null; stage: number | null; why: string }
export function emergingNames(rows: Row[], m: Mkt, rsMap: Map<string, number>, leaderSet: Set<string>, benchM1: number | null, max = 15): Emerging[] {
  const out: Emerging[] = [];
  for (const r of rows) {
    if (!liquid(r, m, EMERGE_LIQ[m]) || leaderSet.has(r.t)) continue;
    const rs = rsMap.get(r.t.toUpperCase());
    if (rs == null || rs < 85 || !num(r.hi52) || !num(r.sma50) || !num(r.sma200)) continue;
    const dd = (1 - r.px! / r.hi52) * 100;
    if (dd > 12 || !(r.px! > r.sma50 && r.sma50 > r.sma200)) continue;
    const relM1 = num(r.perf1M) && benchM1 != null ? r.perf1M - benchM1 : null;
    if (relM1 != null && relM1 <= 0) continue;
    if (num(r.twSt) && r.twSt !== 2) continue;
    out.push({ t: r.t, n: String(r.n || r.t), ind: (r.ind as string) || null, rs, dd: +dd.toFixed(1), relM1: relM1 != null ? +relM1.toFixed(1) : null,
      vs50: pctVs(r.px!, r.sma50), stage: num(r.twSt) ? r.twSt : null,
      why: `RS ${rs}, ${dd.toFixed(0)}% off its high, above a rising trend (50 > 200-day)${relM1 != null ? `, ${relM1 >= 0 ? '+' : ''}${relM1.toFixed(1)} pts vs market in a month` : ''}${num(r.twSt) ? ', weekly Stage 2' : ''}` });
  }
  out.sort((a, b) => b.rs - a.rs || a.dd - b.dd);
  return out.slice(0, max);
}

// ── regime (multi-factor) ───────────────────────────────────────────────────
export type Regime = 'STRONG_UPTREND' | 'UPTREND_UNDER_PRESSURE' | 'MARKET_CORRECTION' | 'SEVERE_CORRECTION' | 'BEAR_MARKET' | 'EARLY_RECOVERY' | 'CONFIRMED_RECOVERY' | 'MIXED' | 'INSUFFICIENT_DATA';
export const REGIME_LABEL: Record<Regime, string> = {
  STRONG_UPTREND: 'Strong uptrend', UPTREND_UNDER_PRESSURE: 'Uptrend under pressure', MARKET_CORRECTION: 'Market correction',
  SEVERE_CORRECTION: 'Severe correction', BEAR_MARKET: 'Bear market', EARLY_RECOVERY: 'Early recovery', CONFIRMED_RECOVERY: 'Confirmed recovery',
  MIXED: 'Mixed / transition', INSUFFICIENT_DATA: 'Insufficient data',
};
export type Tone = 'good' | 'warn' | 'bad' | 'neutral' | 'unknown';
export interface Factor { key: string; label: string; value: string; tone: Tone; note: string }
export interface RegimeRead { regime: Regime; label: string; factors: Factor[]; reasons: string[]; complete: boolean; missing: string[] }

export function regimeOf(b: BenchRead | null, br: Breadth | null, lh: LeaderHealth | null, maxDD6m: number | null): RegimeRead {
  const missing: string[] = [];
  if (!b) missing.push('benchmark prices');
  if (!br || br.n < 100) missing.push('breadth (screener snapshot)');
  if (!lh || lh.n < 10) missing.push('leader universe');
  if (b && !b.dist.volumeOk) missing.push('benchmark volume (distribution days)');
  const f: Factor[] = [];
  if (!b) return { regime: 'INSUFFICIENT_DATA', label: REGIME_LABEL.INSUFFICIENT_DATA, factors: f, reasons: ['No benchmark history — the page does not guess the regime.'], complete: false, missing };
  const above50 = (b.vs50 ?? 0) > 0, above200 = (b.vs200 ?? 0) > 0;
  f.push({ key: 'trend', label: 'Trend', value: `${above50 ? 'above' : 'below'} 50-day (${fmtP(b.vs50)}) · ${above200 ? 'above' : 'below'} 200-day (${fmtP(b.vs200)})`,
    tone: above50 && above200 ? 'good' : above200 ? 'warn' : 'bad', note: `50-day line ${b.slope50 ?? 'n/a'}, 200-day line ${b.slope200 ?? 'n/a'}` });
  f.push({ key: 'dd', label: 'Drawdown', value: `${b.dd.toFixed(1)}% below the high (${b.highDay})`, tone: b.dd < 5 ? 'good' : b.dd < 10 ? 'warn' : 'bad', note: 'from the 52-week closing high' });
  f.push({ key: 'dist', label: 'Distribution', value: b.dist.volumeOk ? `${b.dist.count} days in 25 sessions (${b.dist.trend})` : 'volume not available',
    tone: !b.dist.volumeOk ? 'unknown' : b.dist.level === 'low' ? 'good' : b.dist.level === 'pressure' ? 'warn' : 'bad', note: '4–5 = pressure, 6+ = heavy; used with the other factors, never alone' });
  if (br && br.n >= 100) f.push({ key: 'breadth', label: 'Breadth', value: `${fmtN(br.a50)}% above 50-day · ${fmtN(br.a200)}% above 200-day`,
    tone: (br.a50 ?? 0) >= 55 && (br.a200 ?? 0) >= 50 ? 'good' : (br.a50 ?? 0) >= 40 ? 'warn' : 'bad', note: `${br.n} liquid companies; ${br.nh} at 52-week highs${br.nlKnown ? ` vs ${br.nl} at lows` : ''}` });
  if (lh && lh.n >= 10) f.push({ key: 'leaders', label: 'Leaders', value: `${lh.healthy} of ${lh.n} healthy · ${lh.broken} broken`, tone: (lh.healthyPct ?? 0) >= 45 ? 'good' : (lh.healthyPct ?? 0) >= 25 ? 'warn' : 'bad', note: `${lh.above200} of ${lh.n} above their 200-day line` });
  if (b.vol20 != null && b.volMedian != null) f.push({ key: 'vol', label: 'Volatility', value: `${b.vol20.toFixed(0)}% (1-yr median ${b.volMedian.toFixed(0)}%)`, tone: b.vol20 <= b.volMedian * 1.15 ? 'good' : b.vol20 <= b.volMedian * 1.6 ? 'warn' : 'bad', note: '20-day, annualised' });
  if (b.rally.state !== 'no-correction' && b.rally.state !== 'none') f.push({ key: 'rally', label: 'Rally attempt', value: b.rally.state === 'follow-through' ? `follow-through ${b.rally.ftdDay} (+${b.rally.ftdGain}%)` : b.rally.state === 'attempt' ? `day ${b.rally.day}, no follow-through yet` : 'failed — undercut the low', tone: b.rally.state === 'follow-through' ? 'good' : b.rally.state === 'attempt' ? 'neutral' : 'bad', note: `low ${b.rally.lowDay}, ${fmtP(b.rally.fromLow)} since` });

  const bp50 = br && br.n >= 100 ? br.a50 ?? null : null;
  const hp = lh && lh.n >= 10 ? lh.healthyPct : null;
  const dist = b.dist.volumeOk ? b.dist.count : null;
  const reasons: string[] = [];
  let regime: Regime;
  const hadCorrection = (maxDD6m ?? b.dd) >= 10;
  const lowBounce = b.rally.fromLow ?? 0;
  if (b.dd >= 20 && !above200 && b.slope200 === 'falling') { regime = 'BEAR_MARKET'; reasons.push(`${b.dd.toFixed(0)}% below the high, under a falling 200-day line`); }
  else if (hadCorrection && b.rally.state === 'follow-through' && above50 && (bp50 ?? 0) >= 50 && (hp ?? 0) >= 35) { regime = 'CONFIRMED_RECOVERY'; reasons.push(`follow-through on ${b.rally.ftdDay}, back above the 50-day line, ${bp50}% of stocks above theirs, ${hp}% of leaders healthy`); }
  else if (hadCorrection && lowBounce >= 5 && (b.rally.state === 'follow-through' || b.rally.state === 'attempt') && (b.vs20 ?? -1) > 0) { regime = 'EARLY_RECOVERY'; reasons.push(`${lowBounce}% off the low with a live rally attempt (day ${b.rally.day})${b.rally.state === 'follow-through' ? ' and a follow-through' : ''}; breadth / leaders not yet confirming`); }
  else if (b.dd >= 15) { regime = 'SEVERE_CORRECTION'; reasons.push(`${b.dd.toFixed(0)}% below the high`); }
  else if (b.dd >= 8 || !above200 || (dist != null && dist >= 6 && !above50)) { regime = 'MARKET_CORRECTION'; reasons.push(!above200 ? 'below the 200-day line' : b.dd >= 8 ? `${b.dd.toFixed(0)}% below the high` : `${dist} distribution days and below the 50-day line`); }
  else if (above50 && above200 && (dist == null || dist <= 4) && (bp50 == null || bp50 >= 55) && (hp == null || hp >= 45)) { regime = 'STRONG_UPTREND'; reasons.push('above both lines with light distribution, broad breadth and healthy leaders'); }
  else if (above200) {
    regime = 'UPTREND_UNDER_PRESSURE';
    if (!above50) reasons.push('below the 50-day line');
    if (dist != null && dist >= 5) reasons.push(`${dist} distribution days`);
    if (bp50 != null && bp50 < 45) reasons.push(`only ${bp50}% of stocks above their 50-day`);
    if (hp != null && hp < 40) reasons.push(`only ${hp}% of leaders healthy`);
    if (!reasons.length) reasons.push('trend intact but breadth / leaders not confirming');
  } else { regime = 'MIXED'; reasons.push('signals disagree'); }
  // supporting evidence for a weak regime — the label never rests on one line
  if (['MARKET_CORRECTION', 'SEVERE_CORRECTION', 'BEAR_MARKET'].includes(regime)) {
    if (dist != null && dist >= 4 && !reasons.some((x) => x.includes('distribution'))) reasons.push(`${dist} distribution days`);
    if (hp != null && hp < 35) reasons.push(`only ${hp}% of leaders healthy`);
    if (bp50 != null && bp50 < 45) reasons.push(`${bp50}% of stocks above their 50-day`);
  }
  return { regime, label: REGIME_LABEL[regime], factors: f, reasons, complete: missing.length === 0, missing };
}

// ── risk posture + discipline ───────────────────────────────────────────────
export type Posture = 'AGGRESSIVE' | 'NORMAL' | 'CAUTIOUS' | 'DEFENSIVE' | 'RECOVERY' | 'INSUFFICIENT';
export const POSTURE_LABEL: Record<Posture, string> = { AGGRESSIVE: 'Aggressive conditions', NORMAL: 'Normal conditions', CAUTIOUS: 'Cautious conditions', DEFENSIVE: 'Defensive conditions', RECOVERY: 'Recovery conditions', INSUFFICIENT: 'Insufficient evidence' };
export interface PostureRead { posture: Posture; label: string; level: 'Low' | 'Moderate' | 'Elevated' | 'High' | 'Unknown'; evidence: string[]; avoid: string[]; watch: string[]; improve: string[]; worsen: string[] }
export function postureOf(r: RegimeRead, b: BenchRead | null, br: Breadth | null, lh: LeaderHealth | null, healthyNames: string[], nearMiss: string[]): PostureRead {
  if (r.regime === 'INSUFFICIENT_DATA' || !b) return { posture: 'INSUFFICIENT', label: POSTURE_LABEL.INSUFFICIENT, level: 'Unknown', evidence: r.reasons, avoid: [], watch: [], improve: [], worsen: [] };
  const ev = [`Regime: ${r.label} — ${r.reasons.join('; ')}`];
  if (b.dist.volumeOk) ev.push(`${b.dist.count} distribution days in 25 sessions, ${b.dist.trend}${b.dist.cluster10 >= 3 ? ` (${b.dist.cluster10} in the last 10 — clustered)` : ''}`);
  if (br) ev.push(`${fmtN(br.a50)}% of ${br.n} liquid stocks above their 50-day${br.a50Prev != null ? ` (yesterday ${br.a50Prev}%)` : ''}`);
  if (lh) ev.push(`${lh.healthy} of ${lh.n} leaders healthy, ${lh.broken} broken — leadership ${lh.concentration ?? 'unknown'}`);
  const avoid: string[] = [], watch: string[] = [], improve: string[] = [], worsen: string[] = [];
  let posture: Posture; let level: PostureRead['level'];
  switch (r.regime) {
    case 'STRONG_UPTREND': posture = (b.dist.count <= 2 && (lh?.healthyPct ?? 0) >= 55) ? 'AGGRESSIVE' : 'NORMAL'; level = 'Low'; break;
    case 'UPTREND_UNDER_PRESSURE': posture = 'CAUTIOUS'; level = 'Moderate'; break;
    case 'MARKET_CORRECTION': posture = 'DEFENSIVE'; level = 'Elevated'; break;
    case 'SEVERE_CORRECTION': case 'BEAR_MARKET': posture = 'DEFENSIVE'; level = 'High'; break;
    case 'EARLY_RECOVERY': case 'CONFIRMED_RECOVERY': posture = 'RECOVERY'; level = r.regime === 'CONFIRMED_RECOVERY' ? 'Moderate' : 'Elevated'; break;
    default: posture = 'CAUTIOUS'; level = 'Moderate';
  }
  if (posture === 'DEFENSIVE') {
    avoid.push(`New aggressive buying while ${lh ? `${lh.broken} of ${lh.n} leaders are broken` : 'leadership is weak'}${b.dist.volumeOk ? ` and ${b.dist.count} distribution days are live` : ''}.`);
    avoid.push('Averaging down into names below their 200-day line.');
    watch.push(healthyNames.length ? `Leaders still holding: ${healthyNames.slice(0, 6).join(', ')} — the watchlist for the next uptrend, not a buy list.` : 'No leader is still healthy — wait for new leadership to form.');
    if (nearMiss.length) watch.push(`Just under the 200-day line: ${nearMiss.slice(0, 5).join(', ')}.`);
    improve.push(b.rally.state === 'attempt' ? `A follow-through day (rally is on day ${b.rally.day}; needs ≥ 1.25% up on higher volume from day 4).` : 'A rally attempt that holds above the low, then a follow-through day.');
    improve.push(`Share of stocks above their 50-day back above 50% (now ${fmtN(br?.a50 ?? null)}%).`);
    worsen.push(`A close below the correction low${b.rally.lowDay ? ` (${b.rally.lowDay})` : ''}, or the remaining healthy leaders breaking their 50-day lines.`);
  } else if (posture === 'CAUTIOUS') {
    avoid.push('Chasing extended names; adding size before distribution eases.');
    if (b.dist.volumeOk && b.dist.count >= 4) avoid.push(`Ignoring the ${b.dist.count} distribution days — they say large holders are selling into strength.`);
    watch.push(`Whether the ${lh?.healthy ?? 0} healthy leaders hold their 50-day lines.`);
    improve.push('Distribution count falling below 4 and breadth widening (more stocks above their 50-day).');
    worsen.push('Benchmark closing below its 50-day line with breadth below 40%, or 6+ distribution days.');
  } else if (posture === 'RECOVERY') {
    avoid.push('Buying the whole market on the first up days — wait for leaders, not laggards, to confirm.');
    avoid.push('Large size before the new leaders show they work: start small, add only if it works.');
    watch.push('Which leaders reclaim their 50-day lines first, and the emerging names below.');
    improve.push(`Breadth above 50% (now ${fmtN(br?.a50 ?? null)}%) and more healthy leaders (now ${lh?.healthy ?? '?'} of ${lh?.n ?? '?'}).`);
    worsen.push(`A close below the rally low (${b.rally.lowDay ?? 'n/a'}) — the attempt fails.`);
  } else {
    avoid.push('Complacency: tighten risk on names that break their 50-day lines.');
    watch.push('Distribution building (4+ days) or breadth narrowing while the index rises.');
    improve.push('—');
    worsen.push('4+ distribution days, a close below the 50-day line, or leaders breaking.');
  }
  return { posture, label: POSTURE_LABEL[posture], level, evidence: ev, avoid, watch, improve, worsen };
}

export interface Check { label: string; state: 'met' | 'not-met' | 'unknown'; detail: string }
/** Recovery confirmation — several independent checks; no single day or crossover decides. */
export function recoveryChecks(b: BenchRead | null, br: Breadth | null, lh: LeaderHealth | null, emerging: number): { stage: string; checks: Check[] } {
  const ch: Check[] = [];
  const add = (label: string, cond: boolean | null, detail: string) => ch.push({ label, state: cond == null ? 'unknown' : cond ? 'met' : 'not-met', detail });
  if (!b) return { stage: 'Insufficient data', checks: ch };
  add('Rally attempt holding above the low', b.rally.state === 'attempt' || b.rally.state === 'follow-through' ? true : b.rally.state === 'no-correction' ? null : false, b.rally.lowDay ? `low ${b.rally.lowDay}, ${fmtP(b.rally.fromLow)} since` : 'no correction low to measure from');
  add('Follow-through day (≥ 1.25% up, higher volume, day 4+)', b.rally.state === 'follow-through' ? true : b.rally.state === 'no-correction' ? null : false, b.rally.ftdDay ? `${b.rally.ftdDay} +${b.rally.ftdGain}%` : 'none yet');
  add('Benchmark above its 50-day line', b.vs50 != null ? b.vs50 > 0 : null, fmtP(b.vs50));
  add('Distribution pressure easing (≤ 3 days)', b.dist.volumeOk ? b.dist.count <= 3 : null, `${b.dist.count} live, ${b.dist.trend}`);
  add('Breadth: half of stocks above their 50-day', br ? (br.a50 ?? 0) >= 50 : null, br ? `${fmtN(br.a50)}%` : 'n/a');
  add('New highs outnumber new lows', br && br.nlKnown ? br.nh > br.nl : null, br ? `${br.nh} highs${br.nlKnown ? ` vs ${br.nl} lows` : ''}` : 'n/a');
  add('Leaders reclaiming: 35%+ healthy', lh ? (lh.healthyPct ?? 0) >= 35 : null, lh ? `${lh.healthy} of ${lh.n}` : 'n/a');
  add('New leadership forming (5+ emerging names)', emerging >= 5, `${emerging} found`);
  const met = ch.filter((c) => c.state === 'met').length, known = ch.filter((c) => c.state !== 'unknown').length;
  const stage = b.rally.state === 'no-correction' && (b.vs50 ?? 0) > 0 ? 'Not in a correction' : b.rally.state === 'failed' || (b.rally.state === 'none' && (b.vs50 ?? 0) < 0) ? 'Still deteriorating'
    : met >= known - 1 && known >= 6 ? 'Confirmed recovery' : met >= Math.ceil(known / 2) ? 'Improving — not confirmed' : b.rally.state === 'attempt' ? 'Early recovery attempt' : 'Stabilising';
  return { stage, checks: ch };
}

// ── cross-market theme pairs (only where a meaningful mapping exists) ───────
export const CROSS_PAIRS: Array<{ label: string; us: string; india: string }> = [
  { label: 'Software / IT services', us: 'us-software', india: 'in-it' },
  { label: 'Electronics supply chain', us: 'us-semis', india: 'in-ems' },
  { label: 'Data centres', us: 'us-datacenter', india: 'in-datacenter' },
  { label: 'Defence & aerospace', us: 'us-defense', india: 'in-defence' },
  { label: 'Power & utilities', us: 'us-utilities', india: 'in-power' },
  { label: 'Infrastructure / capex', us: 'us-infra', india: 'in-infra' },
  { label: 'Industrials / capital goods', us: 'us-industrials', india: 'in-capgoods' },
  { label: 'Energy', us: 'us-energy', india: 'in-energy' },
  { label: 'Clean energy', us: 'us-cleanenergy', india: 'in-renewables' },
  { label: 'Metals & materials', us: 'us-materials', india: 'in-metal' },
  { label: 'Healthcare / pharma', us: 'us-healthcare', india: 'in-pharma' },
  { label: 'Banks', us: 'us-regbanks', india: 'in-bank' },
  { label: 'Fintech / financial services', us: 'us-fintech', india: 'in-finserv' },
  { label: 'Autos / EV', us: 'us-ev', india: 'in-auto' },
  { label: 'Real estate', us: 'us-reit', india: 'in-realty' },
  { label: 'Consumer staples', us: 'us-staples', india: 'in-fmcg' },
  { label: 'Consumer discretionary / retail', us: 'us-condisc', india: 'in-retail' },
  { label: 'Internet platforms', us: 'us-internet', india: 'in-newage' },
  { label: 'Transport & shipping', us: 'us-transport', india: 'in-ports' },
  { label: 'Media', us: 'us-comm', india: 'in-media' },
];
export type CrossVerdict = 'Both improving' | 'Both deteriorating' | 'USA leading' | 'India leading' | 'Divergence' | 'Neutral' | 'No comparable data';
export function crossVerdict(us: { rel12w: number | null; improving: boolean; weakening: boolean } | null, ind: { rel12w: number | null; improving: boolean; weakening: boolean } | null): CrossVerdict {
  if (!us || !ind || us.rel12w == null || ind.rel12w == null) return 'No comparable data';
  if (us.improving && ind.improving) return 'Both improving';
  if (us.weakening && ind.weakening) return 'Both deteriorating';
  if ((us.improving && ind.weakening) || (ind.improving && us.weakening)) return 'Divergence';
  if (us.rel12w - ind.rel12w >= 5) return 'USA leading';
  if (ind.rel12w - us.rel12w >= 5) return 'India leading';
  return 'Neutral';
}

export function fmtP(v: number | null | undefined, dp = 1): string { return v == null || !Number.isFinite(v) ? 'n/a' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(dp)}%`; }
export function fmtN(v: number | null | undefined): string { return v == null ? 'n/a' : String(Math.round(v)); }

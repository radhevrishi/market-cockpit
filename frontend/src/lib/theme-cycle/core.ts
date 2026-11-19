// ═══════════════════════════════════════════════════════════════════════════
// THEME CYCLE — drawdowns, same-window resilience, recovery leadership (zzz1289)
//
// Pure: no network, no clock unless passed in. Every comparison between a
// sector / theme and the benchmark uses the SAME two dates — the benchmark's
// peak and its trough — never each series' own peak and trough.
//
// What history said (researched on Yahoo daily closes, 19 Nov 2026, 12 completed
// falls of 15%+): the sector that fell LEAST beat the market over the next 12
// months in only ~3 of 12; the next year's top sectors mostly came from the
// HARDEST-hit group. So "fell least" is shown as defence, never as the next leader.
// ═══════════════════════════════════════════════════════════════════════════

/** Daily closes, ascending, one value per ISO day (YYYY-MM-DD). */
export interface DaySeries { d: string[]; c: number[] }

export const DAY_MS = 86_400_000;
export const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => isoDay(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/** Yahoo timestamps (seconds, the session's open) + closes → a clean DaySeries. */
export function seriesFromTs(ts: number[], closes: Array<number | null | undefined>): DaySeries {
  const m = new Map<string, number>();
  for (let i = 0; i < ts.length; i++) {
    const v = closes[i];
    if (typeof v !== 'number' || !isFinite(v) || v <= 0) continue;
    m.set(isoDay(ts[i] * 1000), v);
  }
  const d = [...m.keys()].sort();
  return { d, c: d.map((k) => m.get(k)!) };
}

/** Index of the last close on or before `day`, or -1. */
export function idxOnOrBefore(s: DaySeries, day: string): number {
  let lo = 0, hi = s.d.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (s.d[mid] <= day) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}

/** The close on or before `day`, only if it is at most `maxGapDays` old (a hole in the data is not a price). */
export function closeOn(s: DaySeries, day: string, maxGapDays = 7): number | null {
  const i = idxOnOrBefore(s, day);
  if (i < 0) return null;
  return daysBetween(s.d[i], day) <= maxGapDays ? s.c[i] : null;
}

/** Return between two days (fraction), or null when either end is missing. */
export function windowReturn(s: DaySeries, from: string, to: string, maxGapDays = 7): number | null {
  const a = closeOn(s, from, maxGapDays), b = closeOn(s, to, maxGapDays);
  return a != null && b != null ? b / a - 1 : null;
}

export interface Episode {
  peak: string; peakClose: number;
  trough: string; troughClose: number;
  /** Peak-to-trough fall, positive fraction (0.25 = −25%). */
  depth: number;
  /** First day back at the peak close; null = not recovered yet (ongoing). */
  recovered: string | null;
}

/** Every fall of at least `minDepth` from a running high, ended when the high is regained. */
export function drawdownEpisodes(s: DaySeries, minDepth = 0.15): Episode[] {
  const out: Episode[] = [];
  if (!s.d.length) return out;
  let pkI = 0;
  let cur: Episode | null = null;
  for (let i = 1; i < s.d.length; i++) {
    const v = s.c[i];
    if (v >= s.c[pkI]) {
      if (cur && cur.depth >= minDepth) out.push({ ...cur, recovered: s.d[i] });
      cur = null; pkI = i; continue;
    }
    const dd = 1 - v / s.c[pkI];
    if (!cur) cur = { peak: s.d[pkI], peakClose: s.c[pkI], trough: s.d[i], troughClose: v, depth: dd, recovered: null };
    else if (dd > cur.depth) { cur.trough = s.d[i]; cur.troughClose = v; cur.depth = dd; }
  }
  if (cur && cur.depth >= minDepth) out.push(cur);
  return out;
}

// ── MARKET REGIME ──────────────────────────────────────────────────────────

/** Configurable thresholds (fractions of the high). Common desk conventions, not laws. */
export const REGIME = { pullback: 0.05, correction: 0.10, severe: 0.15, bear: 0.20, recoveredShare: 0.5 } as const;

export type RegimeKind = 'near-high' | 'pullback' | 'correction' | 'severe' | 'bear' | 'recovery';
export interface RegimeRead {
  kind: RegimeKind;
  label: string;
  /** The running high the fall is measured from. */
  peak: string; peakClose: number;
  /** Lowest close since that high. */
  trough: string; troughClose: number;
  last: string; lastClose: number;
  /** Fall from the high today, positive fraction. */
  ddNow: number;
  /** Deepest fall since the high, positive fraction. */
  ddMax: number;
  /** Share of the fall won back (0..1); null when there was no fall. */
  recovered: number | null;
  sessionsSincePeak: number;
}

export function regimeOf(s: DaySeries, t = REGIME): RegimeRead | null {
  const n = s.d.length;
  if (n < 30) return null;
  let pk = 0;
  for (let i = 1; i < n; i++) if (s.c[i] >= s.c[pk]) pk = i;
  let tr = pk;
  for (let i = pk; i < n; i++) if (s.c[i] < s.c[tr]) tr = i;
  const last = s.c[n - 1];
  const ddNow = 1 - last / s.c[pk];
  const ddMax = 1 - s.c[tr] / s.c[pk];
  const recovered = ddMax > 0 ? (last - s.c[tr]) / (s.c[pk] - s.c[tr]) : null;
  let kind: RegimeKind;
  if (ddMax >= t.correction && recovered != null && recovered >= t.recoveredShare && ddNow < t.correction) kind = 'recovery';
  else if (ddNow >= t.bear) kind = 'bear';
  else if (ddNow >= t.severe) kind = 'severe';
  else if (ddNow >= t.correction) kind = 'correction';
  else if (ddNow >= t.pullback) kind = 'pullback';
  else kind = 'near-high';
  const label = {
    'near-high': 'Near its high', pullback: 'Pullback', correction: 'Correction', severe: 'Severe correction',
    bear: 'Bear market', recovery: 'Recovery phase',
  }[kind];
  return {
    kind, label, peak: s.d[pk], peakClose: s.c[pk], trough: s.d[tr], troughClose: s.c[tr], last: s.d[n - 1], lastClose: last,
    ddNow, ddMax, recovered, sessionsSincePeak: n - 1 - pk,
  };
}

// ── HISTORICAL EPISODE ROWS (the red / grey / green chart) ─────────────────

/** One sector series for the history chart: an official index, or an equal-weight basket of its large members. */
export interface HistSector {
  name: string;
  /** Official index (preferred). */
  index?: DaySeries | null;
  /** Basket members, used only for episodes that START before `basketUntil` and only when the index has no data. */
  basket?: DaySeries[];
  basketUntil?: string;
}

export interface SectorInEpisode {
  name: string;
  kind: 'index' | 'basket';
  /** Return over the benchmark's peak → trough window (fraction). */
  fall: number;
  /** Return over the run-up before the peak (fraction), null when not covered. */
  runUp: number | null;
  /** Return over the 12 months after the benchmark trough; null if not covered / not yet 12 months. */
  next12: number | null;
}

export interface EpisodeRow {
  name: string;
  peak: string; trough: string; ongoing: boolean;
  runUpFrom: string;
  bench: { fall: number; next12: number | null; sinceTrough: number | null };
  sectors: SectorInEpisode[];
  /** Up to three sectors with the strongest run-up before the peak (the last boom's leaders). */
  leaders: string[];
  leadersFall: number | null;
  leadersNext12: number | null;
  least: SectorInEpisode | null;
  worst: SectorInEpisode | null;
  /** Rank of the fell-least sector by next-12-month return (1 = best), and how many were ranked. */
  leastNextRank: number | null;
  rankedNext: number;
  /** The three best sectors of the next 12 months, with their rank in the fall (1 = fell least). */
  nextTop: Array<{ name: string; next12: number; fallRank: number }>;
  /** 'ahead' / 'in line' / 'behind' the benchmark over the next 12 months (±5 points = in line). */
  leastVsBench: 'ahead' | 'in line' | 'behind' | null;
  basketsUsed: string[];
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function sectorReturn(sec: HistSector, from: string, to: string, episodeStart: string): { r: number; kind: 'index' | 'basket' } | null {
  if (sec.index) { const r = windowReturn(sec.index, from, to); if (r != null) return { r, kind: 'index' }; }
  if (sec.basket?.length && (!sec.basketUntil || episodeStart < sec.basketUntil)) {
    const rs = sec.basket.map((b) => windowReturn(b, from, to)).filter((x): x is number => x != null);
    if (rs.length >= 2) return { r: mean(rs), kind: 'basket' };
  }
  return null;
}

/** Plain name for a fall, from its dates. Editorial label only; the window itself is data-driven. */
export function episodeName(peak: string, trough: string, market: 'india' | 'us'): string {
  const y1 = peak.slice(0, 4), y2 = trough.slice(0, 4);
  const yrs = y1 === y2 ? y1 : `${y1}–${y2.slice(2)}`;
  const t = trough.slice(0, 7);
  if (t >= '2008-01' && t <= '2009-06') return `${yrs} · global financial crisis`;
  if (t >= '2002-01' && t <= '2002-12') return `${yrs} · dot-com bust`;
  if (t >= '2020-03' && t <= '2020-04') return `${yrs} · COVID crash`;
  if (market === 'us' && t >= '2022-06' && t <= '2022-12') return `${yrs} · rate shock`;
  if (market === 'us' && t >= '2025-03' && t <= '2025-05') return `${yrs} · tariff shock`;
  if (market === 'us' && t >= '2018-12' && t <= '2018-12') return `${yrs} · Q4 sell-off`;
  return `${yrs} · ${y1 === y2 ? 'correction' : 'fall'}`;
}

/**
 * Score every sector over the SAME benchmark peak → trough window.
 * Run-up = from the previous episode's trough (at most 3 years, at least 1 year) to the peak.
 */
export function episodeRow(market: 'india' | 'us', ep: Episode, prevTrough: string | null, bench: DaySeries, sectors: HistSector[], lastDay: string): EpisodeRow {
  const threeY = addDays(ep.peak, -3 * 365);
  let runUpFrom = prevTrough && prevTrough > threeY ? prevTrough : threeY;
  if (daysBetween(runUpFrom, ep.peak) < 180) runUpFrom = addDays(ep.peak, -365);
  const end12 = addDays(ep.trough, 365);
  const has12 = end12 <= lastDay;
  const ongoing = !ep.recovered;
  const rows: SectorInEpisode[] = [];
  const basketsUsed: string[] = [];
  for (const sec of sectors) {
    const f = sectorReturn(sec, ep.peak, ep.trough, ep.peak);
    if (!f) continue;
    const ru = sectorReturn(sec, runUpFrom, ep.peak, ep.peak);
    const nx = has12 && !ongoing ? sectorReturn(sec, ep.trough, end12, ep.peak) : null;
    rows.push({ name: sec.name, kind: f.kind, fall: f.r, runUp: ru ? ru.r : null, next12: nx ? nx.r : null });
    if (f.kind === 'basket') basketsUsed.push(sec.name);
  }
  const benchFall = windowReturn(bench, ep.peak, ep.trough) ?? -(ep.depth);
  const benchNext = has12 && !ongoing ? windowReturn(bench, ep.trough, end12) : null;
  const benchSince = windowReturn(bench, ep.trough, lastDay);
  const withRun = rows.filter((r) => r.runUp != null).sort((a, b) => b.runUp! - a.runUp!);
  const leaders = withRun.slice(0, 3);
  const least = rows.length ? rows.reduce((a, b) => (b.fall > a.fall ? b : a)) : null;
  const worst = rows.length ? rows.reduce((a, b) => (b.fall < a.fall ? b : a)) : null;
  const ranked = rows.filter((r) => r.next12 != null).sort((a, b) => b.next12! - a.next12!);
  const byFall = [...rows].sort((a, b) => b.fall - a.fall);
  const leastNextRank = least && least.next12 != null ? ranked.findIndex((r) => r.name === least.name) + 1 : null;
  let leastVsBench: EpisodeRow['leastVsBench'] = null;
  if (least?.next12 != null && benchNext != null) {
    const gap = least.next12 - benchNext;
    leastVsBench = gap > 0.05 ? 'ahead' : gap < -0.05 ? 'behind' : 'in line';
  }
  const ln = leaders.filter((l) => l.next12 != null);
  return {
    name: episodeName(ep.peak, ep.trough, market),
    peak: ep.peak, trough: ep.trough, ongoing, runUpFrom,
    bench: { fall: benchFall, next12: benchNext, sinceTrough: benchSince },
    sectors: rows,
    leaders: leaders.map((l) => l.name),
    leadersFall: leaders.length ? mean(leaders.map((l) => l.fall)) : null,
    leadersNext12: ln.length ? mean(ln.map((l) => l.next12!)) : null,
    least, worst, leastNextRank, rankedNext: ranked.length,
    nextTop: ranked.slice(0, 3).map((r) => ({ name: r.name, next12: r.next12!, fallRank: byFall.findIndex((x) => x.name === r.name) + 1 })),
    leastVsBench,
    basketsUsed,
  };
}

export interface HistoryLessons {
  completed: number;
  /** Completed falls where the fell-least sector beat the market over the next 12 months by > 5 points. */
  leastAhead: number;
  leastInLine: number;
  /** …ranked in the top 3 sectors of the next 12 months. */
  leastTop3: number;
  /** Of the next-12-month top-3 sectors across all falls, how many had been in the bottom half of the fall. */
  nextTopFromBottomHalf: number;
  nextTopTotal: number;
  /** Falls where the last boom's leaders beat the market over the next 12 months. */
  leadersAhead: number;
  leadersCounted: number;
}

/** What the completed episodes actually say — computed, not asserted. */
export function historyLessons(rows: EpisodeRow[]): HistoryLessons {
  const done = rows.filter((r) => !r.ongoing && r.bench.next12 != null);
  const L: HistoryLessons = { completed: done.length, leastAhead: 0, leastInLine: 0, leastTop3: 0, nextTopFromBottomHalf: 0, nextTopTotal: 0, leadersAhead: 0, leadersCounted: 0 };
  for (const r of done) {
    if (r.leastVsBench === 'ahead') L.leastAhead++;
    if (r.leastVsBench === 'in line') L.leastInLine++;
    if (r.leastNextRank != null && r.leastNextRank <= 3) L.leastTop3++;
    const half = r.sectors.length / 2;
    for (const t of r.nextTop) { L.nextTopTotal++; if (t.fallRank > half) L.nextTopFromBottomHalf++; }
    if (r.leadersNext12 != null && r.bench.next12 != null) { L.leadersCounted++; if (r.leadersNext12 > r.bench.next12 + 0.05) L.leadersAhead++; }
  }
  return L;
}

// ── CURRENT CORRECTION, PER THEME ──────────────────────────────────────────

/** The window every theme is measured over now: the benchmark's high → its low since (or today). */
export interface CycleRef {
  peak: string; trough: string; last: string;
  benchFall: number;        // peak → trough
  benchSincePeak: number;   // peak → last
  benchFromTrough: number;  // trough → last
  ddMax: number;            // positive fraction
  ongoing: boolean;
}

/**
 * Pick the reference window from a ~2-year benchmark series: the last fall of ≥ 10% if it is still running or ended
 * (recovered) within the last 270 days; otherwise the current pullback of ≥ 5%; otherwise none (no correction to measure).
 */
export function referenceWindow(bench: DaySeries): CycleRef | null {
  const n = bench.d.length;
  if (n < 60) return null;
  const last = bench.d[n - 1];
  const eps = drawdownEpisodes(bench, REGIME.correction);
  let peak: string | null = null, trough: string | null = null, ongoing = false;
  const e = eps[eps.length - 1];
  if (e && (!e.recovered || daysBetween(e.trough, last) <= 270)) { peak = e.peak; trough = e.trough; ongoing = !e.recovered; }
  else {
    const r = regimeOf(bench);
    if (r && r.ddMax >= REGIME.pullback && daysBetween(r.peak, last) <= 270) { peak = r.peak; trough = r.trough; ongoing = r.ddNow >= REGIME.pullback; }
  }
  if (!peak || !trough) return null;
  const f = windowReturn(bench, peak, trough), s = windowReturn(bench, peak, last), t = windowReturn(bench, trough, last);
  if (f == null || s == null || t == null) return null;
  return { peak, trough, last, benchFall: f, benchSincePeak: s, benchFromTrough: t, ddMax: -f, ongoing };
}

export interface ThemeCycle {
  /** Theme return over the benchmark's peak → trough (same window for every theme). */
  fall: number | null;
  sincePeak: number | null;
  fromTrough: number | null;
  /** Theme minus benchmark, in percentage points, over the same windows. */
  relFall: number | null;
  relSincePeak: number | null;
  /** Theme return over the 12 months before the benchmark peak (was it a leader going in?). */
  runUp: number | null;
  /** The theme's own deepest fall from its high since the benchmark peak (positive fraction) and its low's date. */
  ownDD: number | null;
  ownLow: string | null;
  /** Higher lows: the lowest close of the last 20 sessions is above the lowest of the 20 before. */
  higherLows: boolean | null;
  /** Realised volatility of the last 20 sessions ÷ the last 60 (below ~0.85 = calming). */
  volRatio: number | null;
  /** % above / below the 200-day average. */
  dist200: number | null;
  /** Within 3% of its one-year low. */
  nearLow: boolean | null;
}

function stdev(xs: number[]): number | null {
  if (xs.length < 5) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

export function themeCycle(s: DaySeries, ref: CycleRef | null): ThemeCycle {
  const n = s.d.length;
  const out: ThemeCycle = { fall: null, sincePeak: null, fromTrough: null, relFall: null, relSincePeak: null, runUp: null, ownDD: null, ownLow: null, higherLows: null, volRatio: null, dist200: null, nearLow: null };
  if (n < 20) return out;
  const c = s.c;
  if (n >= 40) {
    const a = Math.min(...c.slice(n - 20)), b = Math.min(...c.slice(n - 40, n - 20));
    out.higherLows = a > b;
  }
  const rets = (k: number) => { const r: number[] = []; for (let i = Math.max(1, n - k); i < n; i++) r.push(c[i] / c[i - 1] - 1); return r; };
  const v20 = stdev(rets(20)), v60 = stdev(rets(60));
  if (v20 != null && v60 != null && v60 > 0 && n >= 61) out.volRatio = +(v20 / v60).toFixed(2);
  if (n >= 200) { const m = mean(c.slice(n - 200)); out.dist200 = +(((c[n - 1] - m) / m) * 100).toFixed(1); }
  const yr = c.slice(Math.max(0, n - 252));
  out.nearLow = c[n - 1] <= Math.min(...yr) * 1.03;
  if (!ref) return out;
  out.fall = windowReturn(s, ref.peak, ref.trough);
  out.sincePeak = windowReturn(s, ref.peak, ref.last);
  out.fromTrough = windowReturn(s, ref.trough, ref.last);
  out.relFall = out.fall != null ? +((out.fall - ref.benchFall) * 100).toFixed(1) : null;
  out.relSincePeak = out.sincePeak != null ? +((out.sincePeak - ref.benchSincePeak) * 100).toFixed(1) : null;
  out.runUp = windowReturn(s, addDays(ref.peak, -365), ref.peak);
  const i0 = idxOnOrBefore(s, ref.peak);
  if (i0 >= 0 && daysBetween(s.d[i0], ref.peak) <= 7) {
    let hi = c[i0], dd = 0, low: string | null = null;
    for (let i = i0; i < n; i++) { if (c[i] > hi) hi = c[i]; const x = 1 - c[i] / hi; if (x > dd) { dd = x; low = s.d[i]; } }
    out.ownDD = +dd.toFixed(4); out.ownLow = low;
  }
  return out;
}

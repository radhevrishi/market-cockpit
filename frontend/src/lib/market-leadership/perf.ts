// ═══════════════════════════════════════════════════════════════════════════
// MARKET LEADERSHIP — performance tables and market cycles (zzz1291). Pure.
//   • periodReturns: 1D / 1W / 1M / 3M / 6M / YTD / 1Y from daily closes (sessions, not calendar guesses for the short ones).
//   • weeklyCloses: the last close of each week (the cycles chart is drawn weekly, like the SOIC chart).
//   • marketCycles: bull runs and busts on the benchmark — a bust is a fall of 20%+ from a peak; the bull run is the rise
//     from one bust's low to the next peak. "Led by" = the sectors that rose most over that bull run, from the sector
//     histories that existed then (USA sector funds from 1998–99; India NSE sector indices from 2010–11 — earlier India runs
//     say "sector data starts 2011" instead of guessing).
//   • themeBoard: theme members joined to the stock-screener snapshot; theme median returns; best companies in the theme.
// ═══════════════════════════════════════════════════════════════════════════
export interface DaySeries { d: string[]; c: number[] }
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const r1 = (v: number) => Math.round(v * 10) / 10;
export type PerfKey = 'd1' | 'w1' | 'm1' | 'm3' | 'm6' | 'ytd' | 'y1';
export const PERF_KEYS: PerfKey[] = ['d1', 'w1', 'm1', 'm3', 'm6', 'ytd', 'y1'];
export const PERF_LABEL: Record<PerfKey, string> = { d1: '1D', w1: '1W', m1: '1M', m3: '3M', m6: '6M', ytd: 'YTD', y1: '1Y' };

export function periodReturns(s: DaySeries | null): Record<PerfKey, number | null> & { last: number | null; at: string | null } {
  const out: any = { last: null, at: null }; for (const k of PERF_KEYS) out[k] = null;
  if (!s || s.c.length < 2) return out;
  const n = s.c.length, last = s.c[n - 1];
  out.last = last; out.at = s.d[n - 1];
  const back = (k: number) => (n - 1 - k >= 0 ? s.c[n - 1 - k] : null);
  const g = (p: number | null) => (fin(p) && p > 0 ? r1((last / p - 1) * 100) : null);
  out.d1 = g(back(1)); out.w1 = g(back(5)); out.m1 = g(back(21)); out.m3 = g(back(63)); out.m6 = g(back(126));
  // a year back by date (holidays differ by market), and YTD from the last close of the previous year
  const lastMs = Date.parse(s.d[n - 1]);
  const at = (ms: number) => { let k = -1; for (let i = n - 1; i >= 0; i--) if (Date.parse(s.d[i]) <= ms) { k = i; break; } return k >= 0 ? s.c[k] : null; };
  out.y1 = Date.parse(s.d[0]) <= lastMs - 360 * 86_400_000 ? g(at(lastMs - 365 * 86_400_000)) : null;
  const y = s.d[n - 1].slice(0, 4);
  const prevYearEnd = (() => { for (let i = n - 1; i >= 0; i--) if (s.d[i].slice(0, 4) < y) return s.c[i]; return null; })();
  out.ytd = g(prevYearEnd);
  return out;
}

export function weeklyCloses(s: DaySeries): DaySeries {
  const d: string[] = [], c: number[] = [];
  const wk = (iso: string) => { const t = Date.parse(iso); const day = new Date(t).getUTCDay(); return Math.floor((t - ((day + 6) % 7) * 86_400_000) / 86_400_000); };
  for (let i = 0; i < s.d.length; i++) {
    if (!fin(s.c[i]) || s.c[i] <= 0) continue;
    if (d.length && wk(d[d.length - 1]) === wk(s.d[i])) { d[d.length - 1] = s.d[i]; c[c.length - 1] = s.c[i]; }
    else { d.push(s.d[i]); c.push(s.c[i]); }
  }
  return { d, c };
}

export interface Swing { kind: 'peak' | 'trough'; i: number; d: string; c: number }
/** Zig-zag turning points: a move of `min` (0.2 = 20%) the other way confirms the last extreme. */
export function turningPoints(w: DaySeries, min = 0.2): Swing[] {
  const out: Swing[] = [];
  if (w.c.length < 3) return out;
  let dir: 'up' | 'down' | null = null, ext = 0, hiI = 0, loI = 0;
  for (let i = 1; i < w.c.length; i++) {
    const c = w.c[i];
    if (dir == null) {
      if (c > w.c[hiI]) hiI = i;
      if (c < w.c[loI]) loI = i;
      if (c >= w.c[loI] * (1 + min) && loI < i) { out.push({ kind: 'trough', i: loI, d: w.d[loI], c: w.c[loI] }); dir = 'up'; ext = i; }
      else if (c <= w.c[hiI] * (1 - min) && hiI < i) { out.push({ kind: 'peak', i: hiI, d: w.d[hiI], c: w.c[hiI] }); dir = 'down'; ext = i; }
      continue;
    }
    if (dir === 'up') {
      if (c > w.c[ext]) ext = i;
      else if (c <= w.c[ext] * (1 - min)) { out.push({ kind: 'peak', i: ext, d: w.d[ext], c: w.c[ext] }); dir = 'down'; ext = i; }
    } else {
      if (c < w.c[ext]) ext = i;
      else if (c >= w.c[ext] * (1 + min)) { out.push({ kind: 'trough', i: ext, d: w.d[ext], c: w.c[ext] }); dir = 'up'; ext = i; }
    }
  }
  return out;
}

/** Known causes of the big falls (context only, written by hand; matched by the fall's low). */
export const FALL_CAUSES: Array<{ from: string; to: string; m: 'us' | 'india' | 'both'; text: string }> = [
  { from: '2000-01-01', to: '2003-06-30', m: 'both', text: 'Dot-com bust' },
  { from: '2004-05-01', to: '2004-06-30', m: 'india', text: 'Election-result shock' },
  { from: '2006-05-01', to: '2006-07-31', m: 'india', text: 'Global emerging-market sell-off' },
  { from: '2007-10-01', to: '2009-06-30', m: 'both', text: 'Global financial crisis' },
  { from: '2010-11-01', to: '2011-12-31', m: 'both', text: 'Euro-zone debt crisis, inflation and rate hikes' },
  { from: '2013-05-01', to: '2013-09-30', m: 'india', text: '"Taper tantrum" — rupee crisis' },
  { from: '2015-03-01', to: '2016-03-31', m: 'both', text: 'China slowdown, oil collapse' },
  { from: '2018-01-01', to: '2019-01-31', m: 'both', text: 'Fed tightening; India: IL&FS / mid-cap crash' },
  { from: '2020-02-01', to: '2020-04-30', m: 'both', text: 'COVID-19 crash' },
  { from: '2022-01-01', to: '2022-12-31', m: 'both', text: 'Inflation and the fastest rate hikes in 40 years' },
  { from: '2024-09-01', to: '2025-06-30', m: 'india', text: 'Earnings downgrades, foreign selling' },
  { from: '2025-02-01', to: '2025-05-31', m: 'us', text: 'Tariff shock' },
];
export interface Cycle {
  start: string; startC: number; peak: string; peakC: number; gainPct: number; months: number;
  fall: { low: string; lowC: number; depthPct: number; months: number; cause: string | null } | null;   // null = the run is still going
  ledBy: Array<{ name: string; pct: number }>; ledNote: string | null; current: boolean;
}
export function marketCycles(w: DaySeries, sectors: Array<{ name: string; s: DaySeries | null }>, m: 'us' | 'india', min = 0.2): { cycles: Cycle[]; points: Swing[] } {
  const pts = turningPoints(w, min);
  const cycles: Cycle[] = [];
  const mo = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / (30.44 * 86_400_000)));
  const closeAt = (s: DaySeries, iso: string): number | null => { let k = -1; for (let i = 0; i < s.d.length; i++) { if (s.d[i] <= iso) k = i; else break; } return k >= 0 && Date.parse(iso) - Date.parse(s.d[k]) < 20 * 86_400_000 ? s.c[k] : null; };
  const lead = (a: string, b: string) => {
    const got: Array<{ name: string; pct: number }> = [];
    for (const x of sectors) {
      if (!x.s?.d.length || x.s.d[0] > a) continue;
      const p0 = closeAt(x.s, a), p1 = closeAt(x.s, b);
      if (fin(p0) && fin(p1) && p0 > 0) got.push({ name: x.name, pct: Math.round((p1 / p0 - 1) * 100) });
    }
    return got.sort((x, y) => y.pct - x.pct).slice(0, 3);
  };
  for (let k = 0; k < pts.length; k++) {
    if (pts[k].kind !== 'trough') continue;
    const t = pts[k], pk = pts[k + 1] ?? null;
    const peak = pk && pk.kind === 'peak' ? pk : null;
    const pkD = peak ? peak.d : w.d[w.d.length - 1], pkC = peak ? peak.c : w.c[w.c.length - 1];
    const low = peak ? pts[k + 2] ?? null : null;
    let fall: Cycle['fall'] = null;
    if (peak) {
      // the low after the peak: the next confirmed trough, else the lowest close since (a fall still under way)
      let li = low ? low.i : peak.i; if (!low) for (let i = peak.i; i < w.c.length; i++) if (w.c[i] < w.c[li]) li = i;
      const ld = w.d[li], lc = w.c[li];
      const cause = FALL_CAUSES.find((f) => (f.m === 'both' || f.m === m) && ld >= f.from && ld <= f.to)?.text ?? null;
      fall = { low: ld, lowC: lc, depthPct: Math.round((lc / pkC - 1) * 100), months: mo(peak.d, ld), cause };
    }
    const ledBy = lead(t.d, pkD);
    cycles.push({
      start: t.d, startC: t.c, peak: pkD, peakC: pkC, gainPct: Math.round((pkC / t.c - 1) * 100), months: mo(t.d, pkD), fall,
      ledBy, ledNote: ledBy.length ? null : m === 'india' ? 'sector index history starts 2010–11' : 'no sector history this far back', current: !peak,
    });
  }
  return { cycles, points: pts };
}

// ── themes ─────────────────────────────────────────────────────────────────
export interface MemberRow {
  t: string; n: string; mc: number | null; px: number | null; rs: number | null; st: number | null;
  d1: number | null; w1: number | null; m1: number | null; m3: number | null; m6: number | null; ytd: number | null; y1: number | null;
  revQ: number | null; r40: number | null; epsQ: number | null; dd: number | null; score: number; why: string[];
}
export interface ThemePerf { id: string; name: string; emoji: string; group: string; n: number; found: number; med: Record<PerfKey, number | null>; best: MemberRow[]; members: MemberRow[] }
const median = (xs: number[]) => { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b); const k = s.length >> 1; return r1(s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2); };
/**
 * "Best companies" inside a theme: weekly Stage 2 and relative strength first (the market already agrees), then growth that is
 * being reported now (revenue growth of the latest quarter, Rule of 40), and not stretched (within 25% of the 52-week high
 * counts in favour; more than 40% off counts against). A score to order names inside one theme — not a buy signal.
 */
export function memberScore(m: Omit<MemberRow, 'score' | 'why'>): { score: number; why: string[] } {
  let s = 0; const why: string[] = [];
  if (m.st === 2) { s += 25; why.push('Stage 2'); } else if (m.st === 4) { s -= 15; why.push('Stage 4'); }
  if (fin(m.rs)) { s += (m.rs - 50) * 0.5; if (m.rs >= 80) why.push(`RS ${Math.round(m.rs)}`); }
  if (fin(m.revQ)) { s += Math.max(-10, Math.min(20, m.revQ / 2)); if (m.revQ >= 20) why.push(`revenue +${Math.round(m.revQ)}%`); }
  if (fin(m.r40)) { if (m.r40 >= 40) { s += 10; why.push(`Rule of 40 ${Math.round(m.r40)}`); } else if (m.r40 < 10) s -= 5; }
  if (fin(m.dd)) { if (m.dd <= 25) s += 5; else if (m.dd > 40) { s -= 10; why.push(`${Math.round(m.dd)}% off high`); } }
  return { score: r1(s), why };
}
export function themeBoard(defs: Array<{ id: string; name: string; emoji: string; group: string; members: string[] }>, rows: any[], rsMap: Map<string, number>): ThemePerf[] {
  const by = new Map<string, any>(); for (const r of rows) if (r?.t) by.set(String(r.t).toUpperCase(), r);
  const n = (v: unknown) => (fin(v) ? v : null);
  return defs.map((d) => {
    const ms: MemberRow[] = [];
    for (const raw of d.members) {
      const t = String(raw).toUpperCase().replace(/\.(NS|BO)$/, '');
      const r = by.get(t); if (!r) continue;
      const base = {
        t, n: String(r.n || t), mc: n(r.mc), px: n(r.px), rs: rsMap.get(t) ?? null, st: n(r.twSt) ?? n(r.stage),
        d1: n(r.chg), w1: n(r.perf1W), m1: n(r.perf1M), m3: n(r.perf3M), m6: n(r.perf6M), ytd: n(r.perfYTD), y1: n(r.perf1Y),
        revQ: n(r.revQYoY), r40: n(r.r40), epsQ: n(r.epsQYoY), dd: fin(r.hi52) && fin(r.px) && r.hi52 > 0 ? r1((1 - r.px / r.hi52) * 100) : null,
      };
      ms.push({ ...base, ...memberScore(base) });
    }
    const med = Object.fromEntries(PERF_KEYS.map((k) => [k, median(ms.map((x) => x[k]).filter(fin) as number[])])) as Record<PerfKey, number | null>;
    const sorted = ms.slice().sort((a, b) => b.score - a.score);
    return { id: d.id, name: d.name, emoji: d.emoji, group: d.group, n: d.members.length, found: ms.length, med, best: sorted.slice(0, 5), members: sorted };
  });
}

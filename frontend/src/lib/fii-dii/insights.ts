// zzz1060 — FII / DII Flows: the extra insights (pure, unit-tested; no I/O, no AI).
//
//   • FII positioning in index futures (NSE participant-wise open interest): long %, long/short ratio, a plain verdict, where
//     today sits in the last year, and the index-options tilt (net calls vs net puts).
//   • DII absorption: how much of the foreign selling Indian institutions bought, over 5 / 20 / 60 sessions.
//   • Streak history: the longest FII selling / buying runs in the stored history and where today's run ranks.
//   • Sectors: a fortnight × sector grid (heatmap + sparklines), momentum, rotation call-outs (top in / out, flips).
//   • Monthly totals, FII flow vs Nifty 50, the FPI equity / debt / hybrid split per month.
//   • "What it means today": a short paragraph built from fixed rules over the figures above.
import type { DailyRow, SectorFortnightRow, SectorLine } from './compute';

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
const fmtCrPlain = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 100_000 ? `₹${(a / 100_000).toFixed(2)} lakh crore` : `₹${Math.round(a).toLocaleString('en-IN')} crore`;
  return s;
};
const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] || 'th';
  return `${n}${s}`;
};
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const niceDate = (iso: string) => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

// ── FII positioning in index futures / options ───────────────────────────────

export interface OiRow {
  date: string;
  fiiIdxLong: number; fiiIdxShort: number;
  fiiCallLong: number; fiiCallShort: number; fiiPutLong: number; fiiPutShort: number;
  clientIdxLong: number | null; clientIdxShort: number | null;
}
export type Tone = 'very-bearish' | 'bearish' | 'neutral' | 'bullish' | 'very-bullish';

/** Share of FII index-futures contracts that are long, in %. */
export function longPct(long: number, short: number): number | null {
  return long + short > 0 ? r1((long / (long + short)) * 100) : null;
}

/** Plain verdict for FII index-futures long %. Under 30% long = very bearish positioning; over 70% = bullish. Very low
 *  readings (≤ 15%) are also where short covering has often started — said as history, not a forecast. */
export function positioningVerdict(pct: number): { tone: Tone; label: string; text: string } {
  if (pct <= 15) return { tone: 'very-bearish', label: 'Extremely short', text: `Only ${pct}% of FII index-futures bets are long. Positioning this one-sided has often been near a washout — when it turns, short covering can lift the market fast.` };
  if (pct < 30) return { tone: 'very-bearish', label: 'Very bearish', text: `${pct}% long — foreign traders are heavily betting on a fall in the index.` };
  if (pct < 45) return { tone: 'bearish', label: 'Bearish lean', text: `${pct}% long — more bets on a fall than on a rise.` };
  if (pct <= 55) return { tone: 'neutral', label: 'Balanced', text: `${pct}% long — bets on a rise and a fall are about even.` };
  if (pct <= 70) return { tone: 'bullish', label: 'Bullish lean', text: `${pct}% long — more bets on a rise than on a fall.` };
  return { tone: 'very-bullish', label: 'Bullish', text: `${pct}% long — foreign traders are firmly betting on a rise.` };
}

export interface Positioning {
  latest: {
    date: string; longPct: number; ratio: number | null; long: number; short: number; net: number;
    callNet: number; putNet: number; clientLongPct: number | null;
  };
  verdict: { tone: Tone; label: string; text: string };
  change5: number | null;               // long % change vs 5 sessions earlier, in percentage points
  yearLow: number; yearHigh: number;    // long % range over the stored last year
  rankPct: number | null;               // % of last-year days with a LOWER long % (0 = lowest of the year)
  days: number;                         // days in the last-year window
  options: { tone: Tone; text: string };
  series: Array<{ date: string; longPct: number; ratio: number | null }>;
}

export function buildPositioning(rows: readonly OiRow[]): Positioning | null {
  const asc = [...rows].sort((a, b) => a.date.localeCompare(b.date)).filter((r) => r.fiiIdxLong + r.fiiIdxShort > 0);
  if (!asc.length) return null;
  const series = asc.map((r) => ({ date: r.date, longPct: longPct(r.fiiIdxLong, r.fiiIdxShort)!, ratio: r.fiiIdxShort > 0 ? r2(r.fiiIdxLong / r.fiiIdxShort) : null }));
  const L = asc[asc.length - 1], s = series[series.length - 1];
  const yearAgo = (() => { const d = new Date(`${L.date}T00:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() - 1); return d.toISOString().slice(0, 10); })();
  const yr = series.filter((p) => p.date > yearAgo);
  const vals = yr.map((p) => p.longPct);
  const lower = vals.filter((v) => v < s.longPct).length;
  const callNet = L.fiiCallLong - L.fiiCallShort, putNet = L.fiiPutLong - L.fiiPutShort;
  // Options tilt: long puts / short calls are bets on (or protection against) a fall; long calls / short puts are bets on a rise.
  const tilt = callNet - putNet;
  const sg = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('en-IN')}`;
  const legs = `net ${sg(callNet)} calls and ${sg(putNet)} puts (contracts bought minus sold)`;
  const options = tilt < 0
    ? { tone: 'bearish' as Tone, text: `In index options FIIs lean defensive: ${legs}. More puts than calls means protection against — or bets on — a fall.` }
    : { tone: 'bullish' as Tone, text: `In index options FIIs lean bullish: ${legs}.` };
  return {
    latest: {
      date: L.date, longPct: s.longPct, ratio: s.ratio, long: L.fiiIdxLong, short: L.fiiIdxShort, net: L.fiiIdxLong - L.fiiIdxShort,
      callNet, putNet, clientLongPct: L.clientIdxLong != null && L.clientIdxShort != null ? longPct(L.clientIdxLong, L.clientIdxShort) : null,
    },
    verdict: positioningVerdict(s.longPct),
    change5: series.length > 5 ? r1(s.longPct - series[series.length - 6].longPct) : null,
    yearLow: Math.min(...vals), yearHigh: Math.max(...vals),
    rankPct: vals.length >= 20 ? Math.round((lower / vals.length) * 100) : null,
    days: vals.length,
    options,
    series,
  };
}

// ── DII absorption ───────────────────────────────────────────────────────────

export interface Absorption { sessions: number; fii: number; dii: number; ratio: number | null; pct: number | null; tone: Tone; verdict: string }

/** DII net ÷ |FII net| over the last n sessions that have BOTH figures. Windows with fewer sessions than n are left out. */
export function absorption(rows: readonly DailyRow[], windows: readonly number[] = [5, 20, 60]): Absorption[] {
  const both = [...rows].filter((r) => r.fiiNet != null && r.diiNet != null).sort((a, b) => a.date.localeCompare(b.date));
  const out: Absorption[] = [];
  for (const n of windows) {
    if (both.length < n) continue;
    const w = both.slice(-n);
    const fii = r2(w.reduce((s, r) => s + r.fiiNet!, 0)), dii = r2(w.reduce((s, r) => s + r.diiNet!, 0));
    if (fii >= 0) {
      out.push({ sessions: n, fii, dii, ratio: null, pct: null, tone: dii >= 0 ? 'very-bullish' : 'bullish',
        verdict: dii >= 0 ? 'Both FIIs and DIIs were net buyers — nothing to absorb.' : 'FIIs were net buyers; DIIs took profits.' });
      continue;
    }
    const ratio = r2(dii / Math.abs(fii));
    const pct = Math.round(ratio * 100);
    let tone: Tone, verdict: string;
    if (dii < 0) { tone = 'very-bearish'; verdict = 'Both sold — no domestic support.'; }
    else if (ratio >= 1) { tone = 'bullish'; verdict = `DIIs bought more than FIIs sold (${pct}%) — the selling was fully absorbed.`; }
    else if (ratio >= 0.6) { tone = 'neutral'; verdict = `DIIs absorbed most of it (${pct}%).`; }
    else if (ratio >= 0.3) { tone = 'bearish'; verdict = `DIIs absorbed only part of it (${pct}%).`; }
    else { tone = 'very-bearish'; verdict = `Little domestic support (${pct}%).`; }
    out.push({ sessions: n, fii, dii, ratio, pct, tone, verdict });
  }
  return out;
}

// ── streak history ───────────────────────────────────────────────────────────

export interface StreakRun { dir: 'buy' | 'sell'; days: number; from: string; to: string; totalCr: number }
export interface StreakHistory {
  current: StreakRun | null;
  rank: number | null;              // 1 = the longest run of that direction in the stored history (ties share the better rank)
  ofRuns: number;                   // runs of that direction in the history
  longerLastSeen: string | null;    // last day a run at least this long ended before (null = never)
  topSell: StreakRun[]; topBuy: StreakRun[];
  firstDate: string | null;
}

/** Every buying / selling run in the history (a day without a figure or a net of 0 ends a run). */
export function allRuns(rows: readonly DailyRow[], pick: (r: DailyRow) => number | null = (r) => r.fiiNet): StreakRun[] {
  const asc = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const runs: StreakRun[] = [];
  let cur: StreakRun | null = null;
  for (const r of asc) {
    const v = pick(r);
    const dir = v == null || v === 0 ? null : v > 0 ? 'buy' : 'sell';
    if (cur && dir === cur.dir) { cur.days++; cur.to = r.date; cur.totalCr = r2(cur.totalCr + v!); continue; }
    if (cur) runs.push(cur);
    cur = dir ? { dir, days: 1, from: r.date, to: r.date, totalCr: r2(v!) } : null;
  }
  if (cur) runs.push(cur);
  return runs;
}

export function streakHistory(rows: readonly DailyRow[], pick: (r: DailyRow) => number | null = (r) => r.fiiNet): StreakHistory {
  const runs = allRuns(rows, pick);
  const withFig = [...rows].filter((r) => pick(r) != null).sort((a, b) => a.date.localeCompare(b.date));
  const lastDay = withFig[withFig.length - 1]?.date ?? null;
  const last = runs[runs.length - 1] ?? null;
  const current = last && last.to === lastDay ? last : null;
  const byLen = (a: StreakRun, b: StreakRun) => b.days - a.days || Math.abs(b.totalCr) - Math.abs(a.totalCr);
  const topSell = runs.filter((r) => r.dir === 'sell').sort(byLen).slice(0, 5);
  const topBuy = runs.filter((r) => r.dir === 'buy').sort(byLen).slice(0, 5);
  let rank: number | null = null, ofRuns = 0, longerLastSeen: string | null = null;
  if (current) {
    const same = runs.filter((r) => r.dir === current.dir);
    ofRuns = same.length;
    rank = 1 + same.filter((r) => r !== current && r.days > current.days).length;
    const prior = same.filter((r) => r !== current && r.days >= current.days);
    longerLastSeen = prior.length ? prior[prior.length - 1].to : null;
  }
  return { current, rank, ofRuns, longerLastSeen, topSell, topBuy, firstDate: withFig[0]?.date ?? null };
}

// ── sectors: grid, momentum, rotation ────────────────────────────────────────

export interface SectorGrid {
  dates: string[];                               // fortnight end dates, oldest → newest
  rows: Array<{ sector: string; aucCr: number; net: Array<number | null>; momentumCr: number; momentumPct: number | null }>;
  maxAbs: number;                                // largest |net| in the grid (₹ crore) — colour scale
  maxAbsPct: number;                             // largest |net| as % of the sector's holding
}

/** Sectors × the last `n` fortnight reports. Momentum = net flow of the last 3 fortnights (and as % of holding). */
export function sectorGrid(rows: readonly SectorFortnightRow[], n = 24): SectorGrid {
  const real = rows.filter((r) => r.sector !== 'Total');
  const dates = [...new Set(real.map((r) => r.reportDate))].sort().slice(-n);
  if (!dates.length) return { dates: [], rows: [], maxAbs: 0, maxAbsPct: 0 };
  const last = dates[dates.length - 1];
  const at = new Map(real.map((r) => [`${r.sector}|${r.reportDate}`, r]));
  const sectors = real.filter((r) => r.reportDate === last).sort((a, b) => b.aucCr - a.aucCr);
  let maxAbs = 0, maxAbsPct = 0;
  const out = sectors.map((s) => {
    const net = dates.map((d) => at.get(`${s.sector}|${d}`)?.netCr ?? null);
    for (const v of net) if (v != null) {
      maxAbs = Math.max(maxAbs, Math.abs(v));
      if (s.aucCr > 0) maxAbsPct = Math.max(maxAbsPct, (Math.abs(v) / s.aucCr) * 100);
    }
    const mom = r2(net.slice(-3).reduce<number>((a, v) => a + (v ?? 0), 0));
    return { sector: s.sector, aucCr: s.aucCr, net, momentumCr: mom, momentumPct: s.aucCr > 0 ? r2((mom / s.aucCr) * 100) : null };
  });
  return { dates, rows: out, maxAbs: r2(maxAbs), maxAbsPct: r2(maxAbsPct) };
}

/** Heatmap cell colour: green for buying, red for selling; stronger with size (square-root scale so mid values still show). */
export function heatColor(v: number | null, maxAbs: number): string {
  if (v == null) return '#f1f5f9';
  if (!maxAbs || v === 0) return '#ffffff';
  const t = Math.min(1, Math.sqrt(Math.abs(v) / maxAbs));
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  // white → green-700 (#047857) / red-700 (#b91c1c)
  const [r, g, b] = v > 0 ? [mix(255, 4), mix(255, 120), mix(255, 87)] : [mix(255, 185), mix(255, 28), mix(255, 28)];
  return `rgb(${r},${g},${b})`;
}

export interface RotationItem { sector: string; cr: number; pctOfAuc: number | null }
export interface Flip { sector: string; prevCr: number; nowCr: number; to: 'buy' | 'sell' }
export interface Rotation { fortnightIn: RotationItem[]; fortnightOut: RotationItem[]; yearIn: RotationItem[]; yearOut: RotationItem[]; flips: Flip[] }

/** Top 3 sectors FIIs bought / sold (last fortnight and 1 year), and sectors whose direction flipped this fortnight. A flip
 *  needs both fortnights to be at least `minFlipCr` in size (small wobbles around zero are not a flip). */
export function rotation(lines: readonly SectorLine[], grid: SectorGrid, minFlipCr = 250): Rotation {
  const item = (l: SectorLine, by: 'f' | 'y'): RotationItem => ({ sector: l.sector, cr: by === 'f' ? l.fortnightCr : l.oneYearCr, pctOfAuc: by === 'f' ? l.fortnightPctOfAuc : l.oneYearPctOfAuc });
  const top = (by: 'f' | 'y', dir: 1 | -1) => [...lines]
    .filter((l) => (by === 'f' ? l.fortnightCr : l.oneYearCr) * dir > 0)
    .sort((a, b) => dir * ((by === 'f' ? b.fortnightCr : b.oneYearCr) - (by === 'f' ? a.fortnightCr : a.oneYearCr)))
    .slice(0, 3).map((l) => item(l, by));
  const flips: Flip[] = [];
  const k = grid.dates.length;
  if (k >= 2) {
    for (const r of grid.rows) {
      const prev = r.net[k - 2], now = r.net[k - 1];
      if (prev == null || now == null) continue;
      if (Math.abs(prev) < minFlipCr || Math.abs(now) < minFlipCr || (prev > 0) === (now > 0)) continue;
      flips.push({ sector: r.sector, prevCr: prev, nowCr: now, to: now > 0 ? 'buy' : 'sell' });
    }
    flips.sort((a, b) => Math.abs(b.nowCr) - Math.abs(a.nowCr));
  }
  return { fortnightIn: top('f', 1), fortnightOut: top('f', -1), yearIn: top('y', 1), yearOut: top('y', -1), flips };
}

// ── monthly totals ───────────────────────────────────────────────────────────

export interface MonthTotal { month: string; fii: number; dii: number | null; days: number; diiDays: number }

/** FII and DII net per calendar month, the last `months` months that have a figure (oldest first). */
export function monthlyTotals(rows: readonly DailyRow[], months = 24): MonthTotal[] {
  const m = new Map<string, MonthTotal>();
  for (const r of rows) {
    if (r.fiiNet == null && r.diiNet == null) continue;
    const k = r.date.slice(0, 7);
    if (!m.has(k)) m.set(k, { month: k, fii: 0, dii: null, days: 0, diiDays: 0 });
    const t = m.get(k)!;
    if (r.fiiNet != null) { t.fii = r2(t.fii + r.fiiNet); t.days++; }
    if (r.diiNet != null) { t.dii = r2((t.dii ?? 0) + r.diiNet); t.diiDays++; }
  }
  return [...m.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-months);
}

// ── FII flow vs the market ───────────────────────────────────────────────────

export interface ClosePoint { date: string; close: number }
export interface FiiVsMarket { sessions: number; from: string; to: string; fiiCr: number; diiCr: number | null; niftyFrom: number; niftyTo: number; niftyPct: number; tone: Tone; verdict: string }

/** Market move over the last n sessions (Nifty close n sessions ago → latest close) against FII net over the same sessions. */
export function fiiVsMarket(rows: readonly DailyRow[], closes: readonly ClosePoint[], n = 20): FiiVsMarket | null {
  const cl = new Map(closes.map((c) => [c.date, c.close]));
  const days = [...rows].filter((r) => r.fiiNet != null && cl.has(r.date)).sort((a, b) => a.date.localeCompare(b.date));
  if (days.length < n + 1) return null;
  const base = days[days.length - n - 1], w = days.slice(-n);
  const niftyFrom = cl.get(base.date)!, niftyTo = cl.get(w[w.length - 1].date)!;
  const pct = r1(((niftyTo - niftyFrom) / niftyFrom) * 100);
  const fii = r2(w.reduce((s, r) => s + r.fiiNet!, 0));
  const diiDays = w.filter((r) => r.diiNet != null);
  const dii = diiDays.length === w.length ? r2(diiDays.reduce((s, r) => s + r.diiNet!, 0)) : null;
  const moved = pct > 0 ? `rose ${pct}%` : pct < 0 ? `fell ${Math.abs(pct)}%` : 'was flat';
  const fiiTxt = `${fii < 0 ? 'FIIs sold' : 'FIIs bought'} ${fmtCrPlain(fii)} in ${n} sessions`;
  let tone: Tone, verdict: string;
  if (fii < 0 && pct > 0) { tone = 'bullish'; verdict = `${fiiTxt}, yet Nifty ${moved} — domestic buying is more than absorbing it.`; }
  else if (fii < 0 && pct > -2) { tone = 'neutral'; verdict = `${fiiTxt} but Nifty ${pct === 0 ? 'was flat' : `fell only ${Math.abs(pct)}%`} — domestic buying is absorbing it.`; }
  else if (fii < 0) { tone = 'very-bearish'; verdict = `${fiiTxt} and Nifty ${moved} — the foreign selling is pulling the market down.`; }
  else if (pct >= 0) { tone = 'very-bullish'; verdict = `${fiiTxt} and Nifty ${moved} — foreign money and the market agree.`; }
  else { tone = 'bearish'; verdict = `${fiiTxt} but Nifty still ${moved} — the selling came from elsewhere.`; }
  return { sessions: n, from: w[0].date, to: w[w.length - 1].date, fiiCr: fii, diiCr: dii, niftyFrom, niftyTo, niftyPct: pct, tone, verdict };
}

// ── FPI equity vs debt (NSDL) ────────────────────────────────────────────────

export interface AssetMixDay { date: string; equity: number | null; debt: number | null; hybrid: number | null }
export interface AssetMixMonth { month: string; equity: number; debt: number; hybrid: number; days: number }

/** NSDL FPI net per month split by asset class (equity incl. primary market, debt, hybrid). Months without figures are left out. */
export function assetMixMonths(days: readonly AssetMixDay[], months = 6): AssetMixMonth[] {
  const m = new Map<string, AssetMixMonth>();
  for (const d of days) {
    if (d.equity == null && d.debt == null) continue;
    const k = d.date.slice(0, 7);
    if (!m.has(k)) m.set(k, { month: k, equity: 0, debt: 0, hybrid: 0, days: 0 });
    const t = m.get(k)!;
    t.equity = r2(t.equity + (d.equity ?? 0)); t.debt = r2(t.debt + (d.debt ?? 0)); t.hybrid = r2(t.hybrid + (d.hybrid ?? 0)); t.days++;
  }
  return [...m.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-months);
}

// ── "What it means today" ────────────────────────────────────────────────────

export interface SummaryInput {
  today: { date: string; fii: number | null; dii: number | null } | null;
  streak: StreakHistory | null;
  absorption: Absorption[];
  todayAbsorbPct: number | null;
  rotation: Rotation | null;
  positioning: Positioning | null;
  market: FiiVsMarket | null;
}

/** A few plain sentences, each only when its figures exist. */
export function summarize(x: SummaryInput): string[] {
  const out: string[] = [];
  const t = x.today;
  const cur = x.streak?.current ?? null;
  if (t && t.fii != null) {
    const did = t.fii < 0 ? 'sold' : 'bought';
    let s = `On ${niceDate(t.date)} FIIs net ${did} ${fmtCrPlain(t.fii)}`;
    if (cur && cur.to === t.date && cur.days >= 2) {
      s += ` — the ${ordinal(cur.days)} ${cur.dir === 'sell' ? 'selling' : 'buying'} day in a row (${fmtCrPlain(cur.totalCr)} in total)`;
      const h = x.streak!;
      if (h.rank === 1 && h.ofRuns > 3) s += `, the longest such run since ${niceDate(h.firstDate!)}`;
      else if (h.rank != null && h.rank <= 3 && h.ofRuns > 5) s += `, the ${ordinal(h.rank)} longest since ${niceDate(h.firstDate!)}`;
      else if (h.longerLastSeen && cur.days >= 5) s += `, the longest since ${niceDate(h.longerLastSeen)}`;
    }
    out.push(`${s}.`);
  }
  if (t && t.dii != null && t.fii != null) {
    if (t.fii < 0 && t.dii > 0) out.push(`DIIs bought ${fmtCrPlain(t.dii)}${x.todayAbsorbPct != null ? `, absorbing ${x.todayAbsorbPct}% of the foreign selling` : ''}.`);
    else if (t.fii < 0 && t.dii < 0) out.push(`DIIs sold too (${fmtCrPlain(t.dii)}) — no domestic cushion that day.`);
    else if (t.fii > 0 && t.dii < 0) out.push(`DIIs sold ${fmtCrPlain(t.dii)} into the foreign buying.`);
    else if (t.fii > 0 && t.dii > 0) out.push(`DIIs bought as well (${fmtCrPlain(t.dii)}).`);
  }
  const a20 = x.absorption.find((a) => a.sessions === 20);
  if (a20 && a20.ratio != null) out.push(`Over 20 sessions: ${a20.verdict}`);
  const rot = x.rotation;
  if (rot && (rot.fortnightOut.length || rot.fortnightIn.length)) {
    const names = (xs: RotationItem[]) => xs.slice(0, 2).map((i) => i.sector).join(' and ');
    const parts: string[] = [];
    if (rot.fortnightOut.length) parts.push(`selling was heaviest in ${names(rot.fortnightOut)}`);
    if (rot.fortnightIn.length) parts.push(`buying went mostly to ${names(rot.fortnightIn)}`);
    out.push(`In the last fortnight ${parts.join('; ')}.`);
  }
  if (x.positioning) {
    const p = x.positioning;
    const washout = p.latest.longPct <= 15 ? ' — historically near a washout' : p.latest.longPct < 30 ? ' — very bearish positioning' : p.latest.longPct > 70 ? ' — bullish positioning' : '';
    const rank = p.rankPct != null && p.rankPct <= 5 ? `, among the lowest readings of the last year` : p.rankPct != null && p.rankPct >= 95 ? ', among the highest readings of the last year' : '';
    out.push(`FII index-futures positioning is ${p.latest.longPct}% long${washout}${rank}.`);
  }
  if (x.market) out.push(x.market.verdict);
  return out;
}

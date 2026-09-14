// ═══════════════════════════════════════════════════════════════════════════
// THEME ROTATION ENGINE (zzz480)
//
// For every theme in theme-universe.ts, resolve a price series (a proxy ETF/index
// or a synthetic equal-weight basket), then score it against the market benchmark:
//   • multi-timeframe returns (1W / 1M / 3M / 6M / YTD / 1Y)
//   • JdK RS-Ratio / RS-Momentum  → Leading / Improving / Weakening / Lagging
//   • trend (price vs 50-DMA) + basket breadth (% of members above their 50-DMA)
//   • a "character change" flag (RS-momentum just crossed 100 AND price reclaimed
//     / lost the 50-DMA — the moment a lagging theme turns buyable, or a leader
//     rolls over)  → the clear WHAT-TO-BUY / WHAT-TO-AVOID call.
//
// Live Yahoo data only (self-contained — no dependency on the multibagger uploads).
// Cached in Redis for 30 min so the tab opens instantly and Yahoo isn't hammered.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { fetchChart } from '@/lib/yahoo';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';
import {
  themesForRegion, benchmarkForRegion, leadersFor, type ThemeRegion, type ThemeDef,
} from '@/lib/theme-universe';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// zzz485 — BUMP this version whenever the payload shape changes (e.g. adding the
// techno score to drill stocks), so the 6h cache doesn't keep serving old data
// missing the new fields. A new version orphans stale entries → recompute on deploy.
const CACHE_KEY = (r: ThemeRegion) => `theme-rotation:v11:${r}`;
// zzz483 — rotation is a slow (daily/weekly) signal, so a longer cache is safe and
// keeps the tab instant. The cron pre-warm below refreshes it well within this
// window, and the ↻ Refresh button always bypasses it for a live recompute.
const CACHE_TTL = 6 * 60 * 60;

// ── small math helpers (self-contained copies of the RRG engine's, so the
//    existing /api/market/rrg route is left completely untouched) ─────────────
function resampleToWeekly(timestamps: number[], closes: number[]): number[] {
  if (!timestamps.length || !closes.length) return [];
  const out: number[] = [];
  let curWeek = -1, last = 0, have = false;
  for (let i = 0; i < timestamps.length; i++) {
    const c = closes[i];
    if (c == null || isNaN(c)) continue;
    const d = new Date(timestamps[i] * 1000);
    const daysToFri = (5 - d.getDay() + 7) % 7;
    const fri = new Date(d); fri.setDate(fri.getDate() + daysToFri); fri.setHours(0, 0, 0, 0);
    const wk = fri.getTime();
    if (wk !== curWeek) { if (have) out.push(last); curWeek = wk; }
    last = c; have = true;
  }
  if (have) out.push(last);
  return out;
}

function getQuadrant(rsRatio: number, rsMomentum: number): string {
  if (rsRatio >= 100 && rsMomentum >= 100) return 'Leading';
  if (rsRatio >= 100 && rsMomentum < 100) return 'Weakening';
  if (rsRatio < 100 && rsMomentum < 100) return 'Lagging';
  return 'Improving';
}

// ═══ WHAT CHANGED — the half of a rotation tracker that was missing ═══════
//
// The board has always shown where every theme SITS. Rotation is where a theme
// is MOVING, and a snapshot cannot say that: "Leading" reads identically
// whether a theme has led for a year or crossed into it on Friday. The two
// mean opposite things for position sizing.
//
// No stored history is needed for this. The weekly RRG trail already carries
// the last eight (RS-Ratio, RS-Momentum) pairs, so the quadrant a week ago and
// a month ago can simply be re-derived from it. That makes the feature exact,
// free, and immune to a cache wipe or a redeploy losing its memory.
//
// Direction is judged on STRENGTH, not on the RRG's clockwise cycle: a reader
// wants to know whether a theme got better or worse, and Leading > Improving >
// Weakening > Lagging is the order they mean by that.
const QUAD_STRENGTH: Record<string, number> = { Leading: 3, Improving: 2, Weakening: 1, Lagging: 0 };
function quadrantMoveBetween(from: string | null, to: string):
  { from: string; to: string; dir: 'upgrade' | 'downgrade' } | null {
  if (!from || from === to) return null;
  const a = QUAD_STRENGTH[from] ?? 0, b = QUAD_STRENGTH[to] ?? 0;
  return { from, to, dir: b > a ? 'upgrade' : 'downgrade' };
}

// JdK RS-Ratio / RS-Momentum from two aligned weekly close series. Returns the
// current pair plus a short trail and the previous-momentum (for cross detection).
function jdk(themeWk: number[], benchWk: number[]): { rsRatio: number; rsMomentum: number; prevMomentum: number; trail: { x: number; y: number }[] } {
  const len = Math.min(themeWk.length, benchWk.length);
  if (len < 8) return { rsRatio: 100, rsMomentum: 100, prevMomentum: 100, trail: [] };
  const t = themeWk.slice(themeWk.length - len);
  const b = benchWk.slice(benchWk.length - len);
  // Relative-strength line = theme / benchmark (unitless).
  const rs: number[] = [];
  for (let i = 0; i < len; i++) rs.push(b[i] ? t[i] / b[i] : (rs[i - 1] ?? 1));
  // JdK RS-Ratio — CRITICAL: normalize RS against its OWN trailing mean (centered
  // at 100), NOT against the window's first bar. The first-bar version measured
  // cumulative outperformance-since-2y-ago, so a theme that 5×'d long ago stayed
  // pinned near the top of "Leading" forever (Memory RS 697, Photonics 698) even
  // while every constituent was rolling over below its 50-DMA. Own-mean
  // normalization is comparable across every theme (ETF-proxy and synthetic basket
  // alike) and self-correcting: when a past winner fades, its RS drops below its
  // own recent average → RS-Ratio < 100 → it leaves Leading automatically. This is
  // what makes the board honest for the long run.
  const N = Math.max(8, Math.min(18, Math.floor(len / 4)));
  const rollMean = (arr: number[], i: number, w: number) => {
    const s = Math.max(0, i - w + 1); const win = arr.slice(s, i + 1);
    return win.reduce((a, c) => a + c, 0) / win.length;
  };
  const rsRatioRaw = rs.map((v, i) => { const m = rollMean(rs, i, N); return m ? 100 * (v / m) : 100; });
  const alpha = 2 / (Math.max(3, Math.floor(N / 2)) + 1);
  const rsS: number[] = [rsRatioRaw[0]];
  for (let i = 1; i < rsRatioRaw.length; i++) rsS.push(rsS[i - 1] + alpha * (rsRatioRaw[i] - rsS[i - 1]));
  // RS-Momentum = RS-Ratio vs its own trailing mean, centered at 100.
  const M = Math.max(4, Math.floor(N / 2));
  const momRaw: number[] = rsS.map((v, i) => { const m = rollMean(rsS, i, M); return m ? 100 * (v / m) : 100; });
  const momS: number[] = [momRaw[0]];
  for (let i = 1; i < momRaw.length; i++) momS.push(momS[i - 1] + alpha * (momRaw[i] - momS[i - 1]));
  const trail: { x: number; y: number }[] = [];
  const n = Math.min(8, rsS.length);
  for (let i = rsS.length - n; i < rsS.length; i++) if (i >= 0) trail.push({ x: +rsS[i].toFixed(2), y: +(momS[i] || 100).toFixed(2) });
  return {
    rsRatio: +rsS[rsS.length - 1].toFixed(2),
    rsMomentum: +momS[momS.length - 1].toFixed(2),
    prevMomentum: +(momS[momS.length - 2] ?? momS[momS.length - 1]).toFixed(2),
    trail,
  };
}

// Multi-timeframe % returns from a DAILY close series (+ its timestamps for YTD).
function returns(ts: number[], closes: number[]): { w1: number; m1: number; m3: number; m6: number; ytd: number; y1: number } {
  const c = closes.filter((x) => x != null && !isNaN(x));
  const last = c[c.length - 1];
  const back = (n: number) => { const i = c.length - 1 - n; return i >= 0 ? c[i] : c[0]; };
  const pct = (from: number) => (from ? +(((last - from) / from) * 100).toFixed(2) : 0);
  // YTD: first close on/after Jan 1 of the current year.
  let ytdBase = c[0];
  const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime() / 1000;
  for (let i = 0; i < ts.length; i++) { if (ts[i] >= yearStart && closes[i] != null && !isNaN(closes[i])) { ytdBase = closes[i]; break; } }
  return { w1: pct(back(5)), m1: pct(back(21)), m3: pct(back(63)), m6: pct(back(126)), ytd: pct(ytdBase), y1: pct(back(252)) };
}

// ═══ THE NUMBERS A DESK WOULD ASK FOR NEXT  (zzz610) ═══════════════════════
//
// The board answered "which themes are working". It could not answer the
// questions that follow immediately from that, and which decide position size
// rather than direction:
//
//   · How much risk am I taking to earn this? A theme up 18% with 45%
//     volatility and one up 12% with 14% volatility are not the same trade,
//     and ranking them by return alone silently prefers the wilder one.
//   · How far into the move am I? "Above the 50-DMA" is a yes/no; 22% above it
//     is a different entry from 1% above it.
//   · How much has it already given back? A theme can lead on relative
//     strength while sitting 30% below its own high.
//   · And the one that matters most for a book: are my eight leading themes
//     eight bets, or one bet wearing eight names?
//
// All of it comes from the daily closes already fetched for the RRG. No extra
// requests, no new data source.

/** Annualised volatility from daily closes (default ~3 months of trading). */
function annVol(closes: number[], lookback = 63): number | null {
  const c = closes.filter((x) => x != null && !isNaN(x));
  if (c.length < 25) return null;
  const s = c.slice(Math.max(0, c.length - lookback - 1));
  const rets: number[] = [];
  for (let i = 1; i < s.length; i++) if (s[i - 1] > 0) rets.push(s[i] / s[i - 1] - 1);
  if (rets.length < 20) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varr = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return +(Math.sqrt(varr) * Math.sqrt(252) * 100).toFixed(1);
}

/** How far below the trailing-252-day high the theme now sits, in percent. */
function drawdownFromHigh(closes: number[], lookback = 252): number | null {
  const c = closes.filter((x) => x != null && !isNaN(x));
  if (c.length < 30) return null;
  const s = c.slice(Math.max(0, c.length - lookback));
  const hi = Math.max(...s);
  const last = s[s.length - 1];
  if (!(hi > 0)) return null;
  return +(((last - hi) / hi) * 100).toFixed(1);
}

/** Where the last close sits inside the trailing-252-day range, 0–100. */
function rangePosition(closes: number[], lookback = 252): number | null {
  const c = closes.filter((x) => x != null && !isNaN(x));
  if (c.length < 30) return null;
  const s = c.slice(Math.max(0, c.length - lookback));
  const hi = Math.max(...s), lo = Math.min(...s), last = s[s.length - 1];
  if (!(hi > lo)) return null;
  return Math.round(((last - lo) / (hi - lo)) * 100);
}

/** Daily returns sampled on a shared timestamp grid, so two themes with
 *  different histories can still be compared honestly. */
function returnsOnGrid(ts: number[], closes: number[], grid: number[]): (number | null)[] {
  const m = new Map<number, number>();
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (c != null && !isNaN(c)) m.set(ts[i], c);
  }
  const out: (number | null)[] = [];
  for (let i = 1; i < grid.length; i++) {
    const a = m.get(grid[i - 1]), b = m.get(grid[i]);
    out.push(a && b && a > 0 ? b / a - 1 : null);
  }
  return out;
}

/** Pearson correlation over the pairs where both series have a value. */
function correlation(a: (number | null)[], b: (number | null)[]): number | null {
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i], y = b[i];
    if (x != null && y != null) { xs.push(x); ys.push(y); }
  }
  if (xs.length < 30) return null;
  const mx = xs.reduce((p, c) => p + c, 0) / xs.length;
  const my = ys.reduce((p, c) => p + c, 0) / ys.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx <= 0 || syy <= 0) return null;
  return +(sxy / Math.sqrt(sxx * syy)).toFixed(3);
}

function sma(closes: number[], period: number): number | null {
  const c = closes.filter((x) => x != null && !isNaN(x));
  if (c.length < period) return null;
  const slice = c.slice(c.length - period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

// Build a synthetic equal-weight index from several basket members' daily closes.
// CRITICAL: chain the AVERAGE DAILY RETURN, do NOT average normalized price LEVELS.
// Averaging levels made a member entering/leaving the basket (different IPO dates,
// data gaps) shift the composite discretely — a stock joining at normalized 100
// while others sat at 300 injected a phantom −33% day, producing impossible moves
// like "+145% in a week" on the return columns and corrupting the quadrant. Chaining
// average returns means a member only ever contributes its own day-over-day move
// (and only on days it's present), so there are no level discontinuities and the
// 1W/1M/3M/YTD/1Y numbers are real. Robust to any mix of histories, forever.
function synthesize(series: { ts: number[]; closes: number[] }[]): { ts: number[]; closes: number[] } {
  const valid = series.filter((s) => s.closes.filter((x) => x != null && !isNaN(x)).length > 30);
  if (!valid.length) return { ts: [], closes: [] };
  const ref = valid.reduce((a, b) => (b.ts.length > a.ts.length ? b : a));
  const maps = valid.map((s) => {
    const m = new Map<number, number>();
    for (let i = 0; i < s.ts.length; i++) if (s.closes[i] != null && !isNaN(s.closes[i])) m.set(s.ts[i], s.closes[i]);
    return m;
  });
  const ts: number[] = []; const closes: number[] = [];
  let level = 100; let prevT: number | null = null;
  for (const t of ref.ts) {
    if (prevT === null) {
      if (!maps.some((m) => m.has(t))) continue;   // wait for the first day with any data
      ts.push(t); closes.push(level); prevT = t; continue;
    }
    let sum = 0, cnt = 0;
    for (const m of maps) {
      const c1 = m.get(prevT), c0 = m.get(t);
      if (c1 && c0 && c1 > 0) { sum += (c0 / c1) - 1; cnt++; }   // member's own daily return
    }
    if (cnt) level *= 1 + sum / cnt;   // equal-weight average return, chained
    ts.push(t); closes.push(level); prevT = t;
  }
  return { ts, closes };
}

// chunked parallel fetch so Yahoo isn't hit with 50 requests at once
async function fetchChunked(symbols: string[], range: string, interval: string) {
  const out = new Map<string, { ts: number[]; closes: number[]; price: number; dayChg: number }>();
  const size = 8;
  for (let i = 0; i < symbols.length; i += size) {
    const chunk = symbols.slice(i, i + size);
    const res = await Promise.all(chunk.map(async (sym) => {
      try {
        const ch = await fetchChart(sym, range, interval);
        if (!ch || !ch.closes || ch.closes.length < 10) return null;
        return { sym, ts: ch.timestamps as number[], closes: ch.closes as number[], price: ch.regularMarketPrice || 0, dayChg: ch.changePercent || 0 };
      } catch { return null; }
    }));
    for (const r of res) if (r) out.set(r.sym, { ts: r.ts, closes: r.closes, price: r.price, dayChg: r.dayChg });
  }
  return out;
}

// zzz494 — VERDICT now cross-checks ABSOLUTE trend (1M + 3M returns), not just the
// RRG quadrant + 50-DMA. The old version gave a green 'EARLY BUY' to any Improving
// theme above its 50-DMA — so a falling knife like Drones (−27% over 3M, a one-month
// dead-cat bounce) read as 'early buy', which is exactly what confused the read. Rule
// now: no green call while the 3-month trend is still a deep decline, and 'EARLY BUY'
// requires a REAL turn (above 50-DMA + last month up + 3M not deeply negative). This
// makes the words match the numbers a human sees.
function verdictFor(quadrant: string, aboveSMA50: boolean, m1?: number, m3?: number): { verdict: string; color: string; note: string } {
  const up1  = typeof m1 === 'number' ? m1 > 0 : false;      // turning up over the last month
  const pos3 = typeof m3 === 'number' ? m3 > 0 : false;      // 3-month trend actually positive
  const deep = typeof m3 === 'number' ? m3 <= -12 : false;   // still in a real 3-month downtrend

  // LEADING — strong relative strength. BUY only if PRICE confirms (above 50-DMA AND
  // 3M positive); leading on RS alone with a soft price = HOLD, don't chase.
  if (quadrant === 'Leading') {
    if (aboveSMA50 && pos3) return { verdict: 'BUY', color: '#16A34A', note: 'Leading + above 50-DMA + rising 3M — strongest theme, buy leaders on strength' };
    return { verdict: 'HOLD', color: '#F59E0B', note: 'Leading on relative strength but price/3M not confirming — hold, wait for the trend to catch up' };
  }

  // IMPROVING — the rotation-in zone, and the one that must NOT flatter a falling knife.
  if (quadrant === 'Improving') {
    if (aboveSMA50 && up1 && !deep) return { verdict: 'EARLY BUY', color: '#22C55E', note: 'Rotating IN — above 50-DMA, last month up, 3M no longer falling: a real early turn' };
    if (deep)                        return { verdict: 'WATCH', color: '#EAB308', note: 'Bouncing but still down hard over 3M — unconfirmed dead-cat, watch, do not chase' };
    return { verdict: 'WATCH', color: '#EAB308', note: 'Turning on momentum but price/trend not confirmed — watch for the 50-DMA reclaim' };
  }

  // ── WEAKENING — AND THE ASYMMETRY THAT MADE THIS WRONG  (zzz620) ───────
  //
  // Leading and Improving above both demand PRICE CONFIRMATION before they say
  // anything bullish. Weakening and Lagging demanded nothing at all: the
  // quadrant label alone produced TRIM or AVOID. That is not caution, it is an
  // inconsistency, and it produced a flatly wrong call.
  //
  // Cybersecurity sat at RS 108, +6.0% on the week, +17.5% over three months,
  // above its 50-DMA — and the board said TRIM, because RS-momentum (a
  // doubly-smoothed measure of relative strength against its OWN trailing
  // average) had dipped under 100. A theme can cool relative to its own recent
  // outperformance while still beating the market and still rising. Telling
  // someone to sell that is the single most expensive kind of error this page
  // can make, and it was being made on the strength of a lagging indicator
  // with no price check.
  //
  // So the bearish half now carries the same burden of proof as the bullish
  // half: a call to reduce must be confirmed by PRICE, not by a smoothed
  // relative measure alone.
  if (quadrant === 'Weakening') {
    // Price has actually rolled over — the RS signal and the tape agree.
    if (!aboveSMA50 || (typeof m3 === 'number' && m3 <= 0)) {
      return { verdict: 'TRIM', color: '#F97316', note: 'Relative momentum rolling over AND price below its 50-DMA or negative over 3M — the tape confirms it. Trim, tighten stops, do not add.' };
    }
    // Still above the 50-DMA and still rising: cooling, not breaking.
    return { verdict: 'HOLD', color: '#F59E0B', note: 'Relative momentum is cooling off its own highs, but price is above the 50-DMA and still rising over 3M — hold what you own, stop adding. Not a sell: the tape has not confirmed a roll-over.' };
  }

  // ── LAGGING — the same test, in reverse ───────────────────────────────
  // Weak relative strength and falling momentum is the avoid case, but a theme
  // that has reclaimed its 50-DMA and is rising is a theme in the process of
  // turning, whatever its trailing relative numbers still say. Calling that
  // AVOID is how a reader is kept out of every early recovery.
  if (aboveSMA50 && (up1 || pos3)) {
    return { verdict: 'WATCH', color: '#EAB308', note: 'Relative strength is still weak, but price has reclaimed its 50-DMA and is rising — a turn may be starting. Watch for relative strength to follow; do not buy on price alone.' };
  }
  return { verdict: 'AVOID', color: '#EF4444', note: 'Lagging — weak RS, falling momentum, and price below its 50-DMA. Avoid until it turns.' };
}

async function build(region: ThemeRegion) {
  const themes = themesForRegion(region);
  const bench = benchmarkForRegion(region);
  const range = '2y', interval = '1d';

  // Every symbol we need (benchmark + proxies + all basket members), fetched once.
  const symbols = new Set<string>([bench.symbol]);
  for (const t of themes) { if (t.proxy) symbols.add(t.proxy); (t.basket || []).forEach((s) => symbols.add(s)); }
  const data = await fetchChunked([...symbols], range, interval);

  const enough = (sym: string) => { const d = data.get(sym); return !!d && d.closes.filter((x) => x != null && !isNaN(x)).length >= 20; };

  // zzz483 — SELF-HEAL for the long term: a proxy ETF/index can be delisted or
  // renamed over the years. Any proxy theme whose series failed to fetch falls
  // back to a synthetic equal-weight basket of its leader stocks (fetched only in
  // that case, so normal runs stay lean). The theme keeps working with no manual
  // maintenance — the leaders can drift over a decade, but the tab never goes dark.
  const rescue = new Set<string>();
  for (const t of themes) {
    if (t.proxy && !enough(t.proxy)) leadersFor(t).forEach((s) => { if (!data.has(s)) rescue.add(s); });
  }
  if (rescue.size) {
    const more = await fetchChunked([...rescue], range, interval);
    more.forEach((v, k) => data.set(k, v));
  }

  const benchData = data.get(bench.symbol);
  const benchWk = benchData ? resampleToWeekly(benchData.ts, benchData.closes) : [];

  // Computed before the rows so each theme can be measured in EXCESS of it.
  const benchmarkRet = benchData ? returns(benchData.ts, benchData.closes) : null;
  const benchmarkRet3m = benchmarkRet?.m3 ?? null;

  const rows = themes.map((t: ThemeDef) => {
    // Resolve the theme's price series: the proxy if it's healthy, else a
    // synthetic equal-weight basket (basket themes always; proxy themes only when
    // their ETF/index failed — the self-heal above).
    let ts: number[] = [], closes: number[] = [], price = 0, dayChg = 0, breadthAbove50: number | null = null, members: string[] = [];
    let sourceKind: 'proxy' | 'basket' | 'proxy-fallback' = 'basket';
    if (t.proxy && enough(t.proxy)) {
      const d = data.get(t.proxy)!;
      ts = d.ts; closes = d.closes; price = d.price; dayChg = d.dayChg; sourceKind = 'proxy';
    } else {
      const memberSyms = (t.basket && t.basket.length) ? t.basket : leadersFor(t);
      members = memberSyms;
      sourceKind = t.proxy ? 'proxy-fallback' : 'basket';
      const memberSeries = memberSyms.map((s) => data.get(s)).filter(Boolean) as { ts: number[]; closes: number[]; price: number; dayChg: number }[];
      const synth = synthesize(memberSeries.map((m) => ({ ts: m.ts, closes: m.closes })));
      ts = synth.ts; closes = synth.closes;
      if (memberSeries.length) {
        dayChg = +(memberSeries.reduce((a, m) => a + (m.dayChg || 0), 0) / memberSeries.length).toFixed(2);
        const above = memberSeries.filter((m) => { const s = sma(m.closes, 50); const cc = m.closes.filter((x) => x != null && !isNaN(x)); const last = cc[cc.length - 1]; return s != null && last != null && last > s; }).length;   // zzz487 — use last VALID close (was reading a trailing null → always 0%)
        breadthAbove50 = Math.round((above / memberSeries.length) * 100);
      }
    }
    if (closes.filter((x) => x != null && !isNaN(x)).length < 20) {
      return { id: t.id, name: t.name, emoji: t.emoji, group: t.group, note: t.note, proxy: t.proxy || null, members, ok: false };
    }
    const ret = returns(ts, closes);
    const themeWk = resampleToWeekly(ts, closes);
    const { rsRatio, rsMomentum, prevMomentum, trail } = jdk(themeWk, benchWk);
    const quadrant = getQuadrant(rsRatio, rsMomentum);
    const s50 = sma(closes, 50);
    const cLast = closes.filter((x) => x != null && !isNaN(x)).pop() as number;
    const aboveSMA50 = s50 != null ? cLast > s50 : false;
    // character change: momentum crossed 100 on the latest bar AND price on the
    // right side of the 50-DMA (bullish turn = the theme just became buyable;
    // bearish turn = a leader just rolled over). A ±0.5 deadband around 100 keeps
    // the now-centered momentum from firing on every marginal wobble across the
    // line — only decisive crossings count, so the alert stays rare and meaningful.
    const DB = 0.5;
    let characterChange: 'bullish' | 'bearish' | null = null;
    if (prevMomentum < 100 - DB && rsMomentum >= 100 + DB && aboveSMA50) characterChange = 'bullish';
    else if (prevMomentum >= 100 + DB && rsMomentum < 100 - DB && !aboveSMA50) characterChange = 'bearish';
    const v = verdictFor(quadrant, aboveSMA50, ret.m1, ret.m3);
    // zzz497 — CONVICTION SCORE (0-100): rank themes by the STRENGTH of the signal,
    // not just the quadrant label. Blends relative strength vs the theme's own trend,
    // momentum, the 50-DMA trend confirmation, basket breadth, and the absolute 3M.
    let conv = 50;
    conv += (rsRatio - 100) * 1.6;
    conv += (rsMomentum - 100) * 1.2;
    conv += aboveSMA50 ? 8 : -8;
    if (typeof breadthAbove50 === 'number') conv += (breadthAbove50 - 50) * 0.22;
    conv += Math.max(-10, Math.min(10, (ret.m3 ?? 0) * 0.5));
    const conviction = Math.max(0, Math.min(100, Math.round(conv)));
    // zzz497 — ROTATION VELOCITY: total path length the theme travelled through
    // RS/momentum space over the recent weeks, per segment. Fast = high-beta rotator
    // (act quicker, size smaller); steady = slow compounder. Comes straight from the
    // weekly RRG trail — no stored history needed.
    let vel = 0;
    for (let i = 1; i < trail.length; i++) { const dx = trail[i].x - trail[i - 1].x; const dy = trail[i].y - trail[i - 1].y; vel += Math.sqrt(dx * dx + dy * dy); }
    const velPerWk = trail.length > 1 ? vel / (trail.length - 1) : 0;
    const rotation = velPerWk >= 2.4 ? 'fast' : velPerWk <= 1.0 ? 'steady' : 'normal';
    // zzz497 — ACTION signal tied to Your Book: a bullish character change (rotating
    // INTO strength — reclaimed 50-DMA + momentum crossed up) = ADD; a bearish one
    // (rolling over + lost the 50-DMA) = TRIM.
    const action = characterChange === 'bullish' ? 'ADD' : characterChange === 'bearish' ? 'TRIM' : null;

    // ── WHAT CHANGED: the quadrant a week and a month ago, re-derived from the
    //    trail rather than stored. trail[last] is this week.
    const backAt = (n: number) => (trail.length > n ? trail[trail.length - 1 - n] : null);
    const p1 = backAt(1), p4 = backAt(4);
    const quadrant1w = p1 ? getQuadrant(p1.x, p1.y) : null;
    const quadrant4w = p4 ? getQuadrant(p4.x, p4.y) : null;
    const quadrantMove = quadrantMoveBetween(quadrant1w, quadrant);
    const quadrantMove4w = quadrantMoveBetween(quadrant4w, quadrant);
    const rsDelta1w = p1 ? +(rsRatio - p1.x).toFixed(2) : null;
    const momDelta1w = p1 ? +(rsMomentum - p1.y).toFixed(2) : null;
    // ── RELATIVE STRENGTH IS NOT A RISING PRICE. Every number above this line
    //    is measured AGAINST the benchmark, so a theme can sit in Leading while
    //    its own price falls — it is merely falling less than the market. That
    //    is a defensive rotation, not a buy, and reading the board without this
    //    distinction is the single easiest way to buy a downtrend. Flagged
    //    explicitly rather than left for the reader to infer from the columns.
    const fallingLeader = (quadrant === 'Leading' || quadrant === 'Improving') && (ret.m3 ?? 0) <= 0;

    // ── RISK, EXTENSION AND DAMAGE ──────────────────────────────────────
    const vol = annVol(closes);
    const dd1y = drawdownFromHigh(closes);
    const rangePos = rangePosition(closes);
    // Percent above or below the 50-day line, which is the difference between
    // "just reclaimed it" and "extended and due a pullback".
    const dist50 = (s50 != null && s50 > 0) ? +(((cLast - s50) / s50) * 100).toFixed(1) : null;
    // RETURN PER UNIT OF RISK, measured in excess of the benchmark. This is how
    // a desk ranks a rotation: a theme that beat the market by 9 points with
    // 14% volatility is a better USE OF CAPITAL than one that beat it by 15
    // with 50% volatility, and the raw return columns say the opposite.
    const excess3m = benchmarkRet3m != null && ret.m3 != null ? ret.m3 - benchmarkRet3m : null;
    const riskAdj = (excess3m != null && vol != null && vol > 0)
      ? +((excess3m * 4) / vol).toFixed(2)      // ×4 annualises the quarter
      : null;
    // Slope of relative strength across the eight-week tail: the direction the
    // RS line itself is travelling, independent of where it currently sits.
    let rsSlope: number | null = null;
    if (trail.length >= 4) {
      const n = trail.length;
      const mx = (n - 1) / 2;
      const my = trail.reduce((a, p) => a + p.x, 0) / n;
      let num2 = 0, den = 0;
      trail.forEach((p, i) => { num2 += (i - mx) * (p.x - my); den += (i - mx) ** 2; });
      rsSlope = den ? +(num2 / den).toFixed(2) : null;
    }
    return {
      id: t.id, name: t.name, emoji: t.emoji, group: t.group, note: t.note,
      proxy: t.proxy || null, members, sourceKind,
      price: +price.toFixed(2), dayChangePct: +dayChg.toFixed(2),
      ret, rsRatio, rsMomentum, quadrant, trail,
      quadrant1w, quadrant4w, quadrantMove, quadrantMove4w, rsDelta1w, momDelta1w,
      fallingLeader,
      vol, dd1y, rangePos, dist50, excess3m, riskAdj, rsSlope,
      _ts: ts, _closes: closes,          // stripped before the payload is sent

      aboveSMA50, breadthAbove50,
      characterChange,
      conviction, rotationVelocity: +velPerWk.toFixed(2), rotation, action,
      verdict: v.verdict, verdictColor: v.color, verdictNote: v.note,
      ok: true,
    };
  });

  const okRows = rows.filter((r: any) => r.ok);

  // ═══ CROWDING: ARE THESE EIGHT BETS, OR ONE BET WEARING EIGHT NAMES? ═════
  //
  // The single most expensive mistake a thematic book makes is mistaking
  // variety of LABEL for variety of RISK. Software, Internet, Fintech and
  // Cloud can all read "Leading" while moving as one position — so a reader
  // who spreads across four of them has concentrated, not diversified, and
  // nothing on the board said so.
  //
  // Themes are therefore grouped by how they actually move: daily returns on a
  // shared grid, pairwise correlation, and a greedy pass that seeds each
  // cluster with the strongest unclaimed theme and absorbs everything moving
  // with it above the threshold. Greedy and deterministic on purpose — a
  // clustering the reader cannot predict is one they cannot trust.
  const grid = (benchData?.ts || []).slice(-126);
  const gridRets = new Map<string, (number | null)[]>();
  for (const r of okRows as any[]) {
    if (r._ts && r._closes) gridRets.set(r.id, returnsOnGrid(r._ts, r._closes, grid));
  }
  const CLUSTER_R = 0.8;
  const clusterOf = new Map<string, number>();
  const clusters: Array<{ id: number; members: string[]; label: string }> = [];
  const seedOrder = [...okRows].sort((a: any, b: any) => (b.conviction ?? 0) - (a.conviction ?? 0));
  for (const seed of seedOrder as any[]) {
    if (clusterOf.has(seed.id)) continue;
    const members = [seed.id];
    clusterOf.set(seed.id, clusters.length);
    const sr = gridRets.get(seed.id);
    if (sr) {
      for (const other of seedOrder as any[]) {
        if (clusterOf.has(other.id)) continue;
        const or = gridRets.get(other.id);
        if (!or) continue;
        const c = correlation(sr, or);
        if (c != null && c >= CLUSTER_R) { clusterOf.set(other.id, clusters.length); members.push(other.id); }
      }
    }
    // The cluster is NAMED after the theme that seeded it, because "the
    // Genomics complex" is something a reader can hold in their head and
    // "cluster 3" is not.
    clusters.push({ id: clusters.length, members, label: seed.name });
  }
  for (const r of okRows as any[]) {
    r.cluster = clusterOf.get(r.id) ?? null;
    r.clusterLabel = r.cluster != null ? clusters[r.cluster].label : null;
    r.clusterSize = r.cluster != null ? clusters[r.cluster].members.length : null;
    // Correlation to the theme that seeded this cluster — how much of this
    // theme's move is simply the cluster's move.
    const seedId = r.cluster != null ? clusters[r.cluster].members[0] : null;
    r.clusterCorr = (seedId && seedId !== r.id)
      ? correlation(gridRets.get(seedId) || [], gridRets.get(r.id) || [])
      : (seedId === r.id ? 1 : null);
  }
  // The raw series were carried on the row only so the clustering could run.
  // They are megabytes and never reach the browser.
  for (const r of rows as any[]) { delete r._ts; delete r._closes; }
  // rotation: momentum delta this bar (rsMomentum vs prev) proxies acceleration.
  const withDelta = okRows.map((r: any) => ({ id: r.id, name: r.name, emoji: r.emoji, quadrant: r.quadrant, momo: r.rsMomentum, rs: r.rsRatio }));
  // zzz494 — the 'rotating in — early' strip shows only themes whose verdict is a
  // genuine EARLY BUY (real turn), so deep-down bounces (Drones) and still-basing
  // themes (Defense, below 50-DMA) no longer masquerade as early buys.
  const rotatingIn = okRows.filter((r: any) => r.verdict === 'EARLY BUY')
    .sort((a: any, b: any) => (b.rsRatio + b.rsMomentum) - (a.rsRatio + a.rsMomentum)).slice(0, 5).map((r: any) => r.id);
  const rotatingOut = withDelta.filter((r) => r.quadrant === 'Lagging' || r.quadrant === 'Weakening')
    .sort((a, b) => a.momo - b.momo).slice(0, 5).map((r) => r.id);
  const topBuy = okRows.filter((r: any) => r.verdict === 'BUY')
    .sort((a: any, b: any) => (b.rsRatio + b.rsMomentum) - (a.rsRatio + a.rsMomentum)).slice(0, 5).map((r: any) => r.id);
  const topAvoid = okRows.filter((r: any) => r.verdict === 'AVOID')
    .sort((a: any, b: any) => (a.rsRatio + a.rsMomentum) - (b.rsRatio + b.rsMomentum)).slice(0, 5).map((r: any) => r.id);

  // THE BENCHMARK'S OWN TREND, stated. Every RS number on this page is measured
  // against it, so without it "Leading, +2% over 3M" is unreadable: is that a
  // strong theme in a flat market, or a weak one in a market up 9%? One line of
  // arithmetic that changes how the whole board is read.
  // WHAT CHANGED THIS WEEK — the themes that actually crossed a quadrant line
  // since last Friday, which is the only genuinely new information on the page.
  const movedUp = okRows.filter((r: any) => r.quadrantMove?.dir === 'upgrade')
    .sort((a: any, b: any) => (b.momDelta1w ?? 0) - (a.momDelta1w ?? 0)).map((r: any) => r.id);
  const movedDown = okRows.filter((r: any) => r.quadrantMove?.dir === 'downgrade')
    .sort((a: any, b: any) => (a.momDelta1w ?? 0) - (b.momDelta1w ?? 0)).map((r: any) => r.id);

  return {
    region,
    benchmark: { symbol: bench.symbol, name: bench.name, price: benchData?.price || 0, changePercent: benchData?.dayChg || 0 },
    benchmarkRet,
    themes: rows,
    movedUp, movedDown,
    clusters: clusters.map((c) => ({ id: c.id, label: c.label, members: c.members })),
    rotatingIn, rotatingOut, topBuy, topAvoid,
    asOf: new Date().toISOString(),
    source: 'Yahoo Finance · JdK RS-Ratio/Momentum',
  };
}

// zzz481 — DRILL-DOWN: the buyable stocks inside one theme, so the tab answers
// "buy Cybersecurity" with "PANW / CRWD / ZS are the strongest, above their
// 50-DMA". Lazy (only when a row is expanded) so the main call stays fast.
async function buildDrill(region: ThemeRegion, themeId: string) {
  const bench = benchmarkForRegion(region);
  const theme = themesForRegion(region).find((t) => t.id === themeId);
  if (!theme) return { themeId, stocks: [], error: 'unknown theme' };
  const syms = leadersFor(theme);
  if (!syms.length) return { themeId, stocks: [], note: 'constituents not mapped for this theme yet' };
  const data = await fetchChunked([bench.symbol, ...syms], '1y', '1d');
  const bench3m = (() => { const d = data.get(bench.symbol); return d ? returns(d.ts, d.closes).m3 : 0; })();
  const stocks = syms.map((sym) => {
    const d = data.get(sym);
    if (!d) return null;
    const r = returns(d.ts, d.closes);
    const s50 = sma(d.closes, 50);
    const cLast = d.closes.filter((x) => x != null && !isNaN(x)).pop() as number;
    const aboveSMA50 = s50 != null ? cLast > s50 : false;
    const rs3m = +(r.m3 - bench3m).toFixed(1);           // relative strength vs benchmark, 3M
    // zzz484 — universal TECHNO score (0-100) from live price: relative strength,
    // trend (vs 50-DMA), and momentum consistency. Works for every stock, forever,
    // with no dependency on uploads. (The FUNDO half is overlaid client-side from
    // the user's own Multibagger / Technicals lists, which the app actually has.)
    let techno = 38;                                     // zzz487 — more granularity in the weak zone (was flooring lots at 0)
    techno += Math.max(-34, Math.min(40, rs3m * 1.15));  // momentum vs benchmark
    if (aboveSMA50) techno += 14; else techno -= 6;      // trend
    if (r.m1 > 0 && r.m3 > 0 && r.m6 > 0) techno += 12;  // consistent uptrend
    else if (r.m1 < 0 && r.m3 < 0) techno -= 6;
    if (r.m1 > 0) techno += 4;
    techno = Math.max(0, Math.min(100, Math.round(techno)));
    return {
      sym: sym.replace(/\.NS$/, ''), price: +d.price.toFixed(2), dayChangePct: +d.dayChg.toFixed(2),
      m1: r.m1, m3: r.m3, m6: r.m6, aboveSMA50, rs3m, techno,
      buyReady: aboveSMA50 && rs3m > 0,
    };
  }).filter(Boolean) as any[];
  stocks.sort((a, b) => b.rs3m - a.rs3m);                 // strongest leaders first
  return { themeId, benchmark3m: bench3m, stocks };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const region = (searchParams.get('region') === 'us' ? 'us' : 'india') as ThemeRegion;
  const themeId = searchParams.get('theme');
  const force = searchParams.get('refresh') === '1' || searchParams.get('nocache') === '1';
  if (themeId) {   // drill-down: one theme's constituent stocks (cached 30 min)
    try {
      const key = `theme-rotation:v9:drill:${region}:${themeId}`;
      if (isRedisAvailable() && !force) { const c = await kvGet<any>(key); if (c) return NextResponse.json(c); }
      const payload = await buildDrill(region, themeId);
      try { await kvSet(key, payload, CACHE_TTL); } catch { /* best effort */ }
      return NextResponse.json(payload);
    } catch (e: any) {
      return NextResponse.json({ themeId, stocks: [], error: e?.message || 'drill failed' }, { status: 200 });
    }
  }
  try {
    if (isRedisAvailable() && !force) {
      const cached = await kvGet<any>(CACHE_KEY(region));
      if (cached) return NextResponse.json(cached, { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=1800' } });
    }
    const payload = await build(region);
    try { await kvSet(CACHE_KEY(region), payload, CACHE_TTL); } catch { /* best effort */ }
    return NextResponse.json(payload);
  } catch (e: any) {
    return NextResponse.json({ region, themes: [], error: e?.message || 'theme-rotation failed', asOf: new Date().toISOString() }, { status: 200 });
  }
}

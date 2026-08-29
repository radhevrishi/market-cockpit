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
const CACHE_KEY = (r: ThemeRegion) => `theme-rotation:v8:${r}`;
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

  // WEAKENING — was strong, now rolling over → TRIM (don't add, tighten stops).
  if (quadrant === 'Weakening') return { verdict: 'TRIM', color: '#F97316', note: 'Still strong but momentum rolling over — trim / tighten stops, do not add' };

  // LAGGING — weak & falling → AVOID.
  return { verdict: 'AVOID', color: '#EF4444', note: 'Lagging — weak RS and falling momentum, avoid until it turns' };
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
    return {
      id: t.id, name: t.name, emoji: t.emoji, group: t.group, note: t.note,
      proxy: t.proxy || null, members, sourceKind,
      price: +price.toFixed(2), dayChangePct: +dayChg.toFixed(2),
      ret, rsRatio, rsMomentum, quadrant, trail,
      aboveSMA50, breadthAbove50,
      characterChange,
      verdict: v.verdict, verdictColor: v.color, verdictNote: v.note,
      ok: true,
    };
  });

  const okRows = rows.filter((r: any) => r.ok);
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

  return {
    region,
    benchmark: { symbol: bench.symbol, name: bench.name, price: benchData?.price || 0, changePercent: benchData?.dayChg || 0 },
    themes: rows,
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
      const key = `theme-rotation:v8:drill:${region}:${themeId}`;
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

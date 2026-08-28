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

const CACHE_KEY = (r: ThemeRegion) => `theme-rotation:v1:${r}`;
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
  if (len < 4) return { rsRatio: 100, rsMomentum: 100, prevMomentum: 100, trail: [] };
  const t = themeWk.slice(themeWk.length - len);
  const b = benchWk.slice(benchWk.length - len);
  const rsRaw: number[] = [];
  for (let i = 0; i < len; i++) rsRaw.push(b[i] ? (t[i] / b[i]) * 100 : 100);
  const base = rsRaw[0] || 100;
  const rsNorm = rsRaw.map((v) => (v / base) * 100);
  const period = Math.max(4, Math.min(10, Math.floor(len / 3)));
  const alpha = 2 / (period + 1);
  const rsS: number[] = [rsNorm[0]];
  for (let i = 1; i < rsNorm.length; i++) rsS.push(rsS[i - 1] + alpha * (rsNorm[i] - rsS[i - 1]));
  const momRaw: number[] = rsS.map((v, i) => (i === 0 || !rsS[i - 1] ? 100 : (v / rsS[i - 1]) * 100));
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
// Each member is normalized to 100 at its first common point, then averaged.
function synthesize(series: { ts: number[]; closes: number[] }[]): { ts: number[]; closes: number[] } {
  const valid = series.filter((s) => s.closes.filter((x) => x != null && !isNaN(x)).length > 30);
  if (!valid.length) return { ts: [], closes: [] };
  // Align on the union of timestamps of the member with the most points.
  const ref = valid.reduce((a, b) => (b.ts.length > a.ts.length ? b : a));
  const norm = valid.map((s) => {
    const map = new Map<number, number>();
    for (let i = 0; i < s.ts.length; i++) if (s.closes[i] != null && !isNaN(s.closes[i])) map.set(s.ts[i], s.closes[i]);
    let firstVal = 0;
    for (const t of ref.ts) { const v = map.get(t); if (v) { firstVal = v; break; } }
    return { map, firstVal: firstVal || 1 };
  });
  const ts: number[] = []; const closes: number[] = [];
  for (const t of ref.ts) {
    let sum = 0, cnt = 0;
    for (const m of norm) { const v = m.map.get(t); if (v) { sum += (v / m.firstVal) * 100; cnt++; } }
    if (cnt) { ts.push(t); closes.push(sum / cnt); }
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

function verdictFor(quadrant: string, aboveSMA50: boolean): { verdict: string; color: string; note: string } {
  if (quadrant === 'Leading')   return aboveSMA50 ? { verdict: 'BUY', color: '#16A34A', note: 'Leading + above 50-DMA — strongest theme, buy leaders on strength' }
                                                   : { verdict: 'HOLD', color: '#F59E0B', note: 'Leading on RS but price under 50-DMA — wait for reclaim' };
  if (quadrant === 'Improving') return aboveSMA50 ? { verdict: 'EARLY BUY', color: '#22C55E', note: 'Rotating IN — RS momentum turning up and price back above 50-DMA' }
                                                   : { verdict: 'WATCH', color: '#EAB308', note: 'Rotating in on momentum but still below 50-DMA — watch for the reclaim' };
  if (quadrant === 'Weakening') return { verdict: 'TRIM', color: '#F97316', note: 'Still strong but momentum rolling over — trim / tighten stops, do not add' };
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
        const above = memberSeries.filter((m) => { const s = sma(m.closes, 50); return s != null && m.closes[m.closes.length - 1] > s; }).length;
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
    // bearish turn = a leader just rolled over).
    let characterChange: 'bullish' | 'bearish' | null = null;
    if (prevMomentum < 100 && rsMomentum >= 100 && aboveSMA50) characterChange = 'bullish';
    else if (prevMomentum >= 100 && rsMomentum < 100 && !aboveSMA50) characterChange = 'bearish';
    const v = verdictFor(quadrant, aboveSMA50);
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
  const rotatingIn = withDelta.filter((r) => r.quadrant === 'Improving' || (r.quadrant === 'Leading' && r.momo >= 100))
    .sort((a, b) => b.momo - a.momo).slice(0, 5).map((r) => r.id);
  const rotatingOut = withDelta.filter((r) => r.quadrant === 'Lagging' || r.quadrant === 'Weakening')
    .sort((a, b) => a.momo - b.momo).slice(0, 5).map((r) => r.id);
  const topBuy = okRows.filter((r: any) => r.verdict === 'BUY' || r.verdict === 'EARLY BUY')
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
    return {
      sym: sym.replace(/\.NS$/, ''), price: +d.price.toFixed(2), dayChangePct: +d.dayChg.toFixed(2),
      m1: r.m1, m3: r.m3, m6: r.m6, aboveSMA50, rs3m,
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
      const key = `theme-rotation:v1:drill:${region}:${themeId}`;
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

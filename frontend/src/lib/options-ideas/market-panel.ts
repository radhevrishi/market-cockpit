// Options Ideas — the market panel at the top of the page (zzz1301f): index trend, VIX / India VIX, breadth, a fear & greed
// gauge built from our own data, and what the replay says to do in this state (calls / puts / selling puts).
// CNN's Fear & Greed refuses servers (HTTP 418), so the gauge is our own, CNN-style: the average of four 0–100 readings —
// index momentum (vs its 125-day average, ranked against 2 years), breadth (% of stocks above their 50-day), volatility (VIX
// ranked against its year, inverted) and 20-day index return (ranked against 2 years).
import { getSnapshot } from '../screener/snapshot-cache';
import { FEAR_VIX } from './model';

type Mkt = 'US' | 'IN';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
export const PANEL_SYMBOLS: Record<Mkt, { index: string; indexName: string; vix: string; vixName: string }> = {
  US: { index: '^GSPC', indexName: 'S&P 500', vix: '^VIX', vixName: 'VIX' },
  IN: { index: '^NSEI', indexName: 'Nifty 50', vix: '^INDIAVIX', vixName: 'India VIX' },
};

/** daily closes, oldest first, with today's live price as the last value; `prev` = the previous session's close (the live
 *  price is dated by regularMarketTime, so a missing / partial bar for today never shifts the 1-day change by a session) */
export function closesWithLive(ts: number[], closes: Array<number | null>, live: number | null, liveTime: number | null): { c: number[]; prev: number | null } {
  const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
  const pts = ts.map((t, i) => ({ d: day(t), c: closes[i] })).filter((p): p is { d: string; c: number } => typeof p.c === 'number' && Number.isFinite(p.c));
  if (live != null && Number.isFinite(live) && liveTime) {
    const ld = day(liveTime);
    const before = pts.filter((p) => p.d < ld);
    const c = [...before.map((p) => p.c), live];
    return { c, prev: before.length ? before[before.length - 1].c : null };
  }
  return { c: pts.map((p) => p.c), prev: pts.length > 1 ? pts[pts.length - 2].c : null };
}
async function yahooCloses(symbol: string): Promise<{ c: number[]; prev: number | null } | null> {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1d`;
  const relay = (process.env.PROXY_URL || '').replace(/\/$/, ''), secret = process.env.PROXY_SECRET || '';
  const routes = [`https://query1.finance.yahoo.com${path}`, `https://query2.finance.yahoo.com${path}`];
  if (relay && secret) routes.push(`${relay}/proxy?url=${encodeURIComponent(`https://query1.finance.yahoo.com${path}`)}&secret=${encodeURIComponent(secret)}`);
  for (const u of routes) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': UA }, cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      if (!r.ok) continue;
      const res = (await r.json())?.chart?.result?.[0];
      const out = closesWithLive(res?.timestamp ?? [], res?.indicators?.quote?.[0]?.close ?? [], typeof res?.meta?.regularMarketPrice === 'number' ? res.meta.regularMarketPrice : null, typeof res?.meta?.regularMarketTime === 'number' ? res.meta.regularMarketTime : null);
      if (out.c.length > 60) return out;
    } catch { /* next route */ }
  }
  return null;
}

const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
/** mid-rank percentile (ties count half), 0–100 */
const pctRank = (hist: number[], x: number) => (hist.length ? Math.round(((hist.filter((h) => h < x).length + hist.filter((h) => h === x).length / 2) / hist.length) * 100) : 50);
const r1 = (x: number) => Math.round(x * 10) / 10;

export interface PanelMarket {
  market: Mkt;
  index: { name: string; last: number; chg1d: number; vs50: number; vs200: number; ret20: number; above200: boolean; rising200: boolean } | null;
  vix: { name: string; last: number; chg1d: number; pct1y: number; avg20: number; band: 'calm' | 'normal' | 'elevated' | 'fear'; fearLine: number } | null;
  breadth: { n: number; above50: number; above200: number; nearHigh: number; asOf: string | null } | null;
  /** when the index / VIX were read */
  readAt: string;
  mood: { score: number; label: string; parts: Array<{ k: string; v: number }> } | null;
  regime: 'up' | 'fear' | 'down' | 'mixed';
  verdict: { calls: { act: 'TAKE' | 'SELECTIVE' | 'AVOID'; why: string }; puts: { act: 'AVOID'; why: string }; sellPuts: { act: 'TAKE' | 'SELECTIVE'; why: string } };
}

/** pure: everything from closes + snapshot rows (exported for tests) */
export function buildPanel(m: Mkt, idx: number[] | null, vix: number[] | null, rows: any[], prev: { idx?: number | null; vix?: number | null } = {}): PanelMarket {
  const sym = PANEL_SYMBOLS[m];
  let index: PanelMarket['index'] = null, momP = 50, retP = 50;
  if (idx && idx.length > 210) {
    const L = idx.length - 1, c = idx[L];
    const s50 = avg(idx.slice(-50)), s200 = avg(idx.slice(-200)), s200p = avg(idx.slice(-220, -20));
    index = { name: sym.indexName, last: Math.round(c * 100) / 100, chg1d: r1((c / (prev.idx ?? idx[L - 1]) - 1) * 100), vs50: r1((c / s50 - 1) * 100), vs200: r1((c / s200 - 1) * 100), ret20: r1((c / idx[L - 20] - 1) * 100), above200: c > s200, rising200: s200 >= s200p };
    const mom: number[] = [], ret: number[] = [];
    for (let i = 145; i < idx.length; i++) { mom.push(idx[i] / avg(idx.slice(i - 124, i + 1)) - 1); ret.push(idx[i] / idx[i - 20] - 1); }
    momP = pctRank(mom, mom[mom.length - 1]); retP = pctRank(ret, ret[ret.length - 1]);
  }
  let vx: PanelMarket['vix'] = null, volP = 50;
  if (vix && vix.length > 30) {
    const L = vix.length - 1, v = vix[L];
    const year = vix.slice(-252);
    const pct = pctRank(year, v);
    const fearLine = FEAR_VIX[m];
    const band = v >= fearLine ? 'fear' : v < (m === 'US' ? 15 : 13) ? 'calm' : pct >= 70 || v >= (m === 'US' ? 20 : 16) ? 'elevated' : 'normal';
    vx = { name: sym.vixName, last: Math.round(v * 100) / 100, chg1d: r1((v / (prev.vix ?? vix[L - 1]) - 1) * 100), pct1y: pct, avg20: Math.round(avg(vix.slice(-20)) * 100) / 100, band, fearLine };
    volP = 100 - pct;
  }
  let breadth: PanelMarket['breadth'] = null, brP = 50;
  // only rows priced on the snapshot's latest session (a row without a fresh price can be weeks old)
  const dates = new Map<string, number>();
  for (const r of rows) if (r.pxAt) { const d = String(r.pxAt).slice(0, 10); dates.set(d, (dates.get(d) ?? 0) + 1); }
  const asOf = [...dates.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const fresh = asOf && (dates.get(asOf) ?? 0) >= rows.length * 0.4 ? rows.filter((r) => String(r.pxAt ?? '').slice(0, 10) === asOf) : rows;
  const live = fresh.filter((r) => typeof r.px === 'number' && r.px > 0 && typeof r.sma50 === 'number' && typeof r.sma200 === 'number' && (r.mc ?? 0) >= (m === 'US' ? 300 : 500));
  if (live.length >= 50) {
    const above50 = Math.round((live.filter((r) => r.px > r.sma50).length / live.length) * 100);
    const above200 = Math.round((live.filter((r) => r.px > r.sma200).length / live.length) * 100);
    const nearHigh = Math.round((live.filter((r) => typeof r.hi52 === 'number' && r.hi52 > 0 && r.px >= r.hi52 * 0.95).length / live.length) * 100);
    breadth = { n: live.length, above50, above200, nearHigh, asOf };
    brP = above50;
  }
  const parts = [{ k: 'Index momentum', v: momP }, { k: 'Breadth (above 50-day)', v: brP }, { k: 'Volatility (inverted)', v: volP }, { k: '20-day return', v: retP }];
  const score = Math.round(avg(parts.map((p) => p.v)));
  const label = score < 25 ? 'Extreme fear' : score < 45 ? 'Fear' : score <= 55 ? 'Neutral' : score <= 75 ? 'Greed' : 'Extreme greed';
  const mood = index || vx ? { score, label, parts } : null;
  const fear = vx?.band === 'fear';
  const up = !!(index && index.above200 && index.ret20 > 0);
  const regime: PanelMarket['regime'] = fear ? 'fear' : up ? 'up' : index && !index.above200 ? 'down' : 'mixed';
  const vn = sym.vixName;
  const verdict: PanelMarket['verdict'] = {
    calls: fear ? { act: 'TAKE', why: `${vn} ${vx!.last} is at fear level (≥ ${vx!.fearLine}). Over 10 years calls bought in fear made +0.49× the risk a trade, positive in 8 of 9 years — grade A ideas qualify now even with the market below its 200-day.` }
      : up ? { act: 'TAKE', why: `${sym.indexName} is above its 200-day average and up ${index!.ret20}% in 20 sessions — the condition grade A / A+ calls need. Stocks must also beat the index over 3 months (it is ${index!.ret20 >= 8 ? 'a fast rally, so few do — expect few grade A' : 'a normal pace'}).` }
      : { act: 'SELECTIVE', why: `${sym.indexName} is ${index && !index.above200 ? 'below its 200-day average' : 'not rising'} and fear is not high (${vn} ${vx?.last ?? '—'}, fear line ${FEAR_VIX[m]}). Calls in this state did not pay — wait for grade A (market back above its 200-day, or ${vn} ≥ ${FEAR_VIX[m]}).` },
    puts: { act: 'AVOID', why: fear ? `Buying puts in fear was the worst trade in the 10-year replay (−0.55× the risk at VIX ≥ 30): the drop has usually happened and rallies are sharp.` : `Buying puts on single stocks or the index lost money in every state over 10 years, including 2022 (falling markets bounce hard and stop puts out). To protect holdings, cut size or sell covered calls instead.` },
    sellPuts: fear ? { act: 'TAKE', why: `Selling puts on healthy stocks you want to own paid best in fear: +2.2% of the strike a month held to expiry, 67% profitable (premiums are rich). Keep the cash to buy the shares.` }
      : { act: 'SELECTIVE', why: `Selling puts on healthy stocks paid about +0.6–0.9% of the strike a month, ~60% profitable — fine for stocks you want to own; better when fear rises.` },
  };
  return { market: m, index, vix: vx, breadth, mood, regime, verdict, readAt: new Date().toISOString() };
}

let memo: { at: number; v: PanelMarket[] } | null = null;
export async function marketPanel(): Promise<PanelMarket[]> {
  if (memo && Date.now() - memo.at < 5 * 60_000) return memo.v;
  const out: PanelMarket[] = [];
  for (const m of ['US', 'IN'] as Mkt[]) {
    const [idx, vix, snap] = await Promise.all([yahooCloses(PANEL_SYMBOLS[m].index), yahooCloses(PANEL_SYMBOLS[m].vix), getSnapshot(m).catch(() => null)]);
    out.push(buildPanel(m, idx?.c ?? null, vix?.c ?? null, snap?.rows ?? [], { idx: idx?.prev ?? null, vix: vix?.prev ?? null }));
  }
  if (out.some((p) => p.index || p.vix)) memo = { at: Date.now(), v: out };
  return out;
}

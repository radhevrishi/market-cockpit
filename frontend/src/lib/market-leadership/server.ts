// zzz1290 — Market Leadership & Risk: server builder. Reads the benchmark daily bars (Yahoo, with the Cloudflare relay as the
// third route — the same pattern as lib/screener/tech-fetch) and the stock-screener snapshot (the Technicals engine). No new
// data provider, no new database table: one small daily breadth record per market in the KV store so the page can show how
// breadth moved over 5 / 10 / 20 sessions as the record grows.
import { getSnapshot } from '@/lib/screener/snapshot-cache';
import { liveSessionBar } from '@/lib/screener/tech';
import { rsRanks } from '@/lib/screener/rs-rank';
import { kvGet, kvSet } from '@/lib/kv';
import { benchRead, breadthOf, emergingNames, leaderHealth, pickLeaders, postureOf, recoveryChecks, regimeOf, type Bars, type BenchRead, type Breadth, type Emerging, type Leader, type LeaderHealth, type Mkt, type PostureRead, type RegimeRead, type Row, type Check } from './core';

export const LR_VERSION = 2;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

export const BENCHES: Record<Mkt, Array<{ symbol: string; name: string; primary?: boolean }>> = {
  US: [{ symbol: '^GSPC', name: 'S&P 500', primary: true }, { symbol: '^IXIC', name: 'Nasdaq Composite' }],
  IN: [{ symbol: '^NSEI', name: 'Nifty 50', primary: true }, { symbol: '^CRSLDX', name: 'Nifty 500' }],
};

/** Yahoo daily OHLCV for ~2 years: query1 → query2 → Cloudflare relay. range=2y keeps bars daily. */
export async function benchBars(symbol: string, m: Mkt): Promise<{ bars: Bars | null; why: string | null; live: string | null }> {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1d&includePrePost=false`;
  const relay = (process.env.PROXY_URL || '').replace(/\/$/, ''), secret = process.env.PROXY_SECRET || '';
  const routes: Array<[string, string]> = [['query1', `https://query1.finance.yahoo.com${path}`], ['query2', `https://query2.finance.yahoo.com${path}`]];
  if (relay && secret) routes.push(['relay', `${relay}/proxy?url=${encodeURIComponent(`https://query1.finance.yahoo.com${path}`)}&secret=${encodeURIComponent(secret)}`]);
  const why: string[] = [];
  for (const [name, url] of routes) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      if (!r.ok) { why.push(`${name} ${r.status}`); continue; }
      const j: any = await r.json();
      const res = j?.chart?.result?.[0];
      const q = res?.indicators?.quote?.[0];
      if (!res?.timestamp?.length || !q) { why.push(`${name} empty`); continue; }
      const d: string[] = [], c: number[] = [], v: number[] = [];
      for (let i = 0; i < res.timestamp.length; i++) {
        const cl = q.close?.[i];
        if (typeof cl !== 'number' || !Number.isFinite(cl)) continue;
        const day = new Date(res.timestamp[i] * 1000 + (symbol === '^NSEI' || symbol === '^CRSLDX' ? 5.5 * 3600_000 : -5 * 3600_000)).toISOString().slice(0, 10);
        if (d.length && d[d.length - 1] === day) { c[c.length - 1] = cl; v[v.length - 1] = Number(q.volume?.[i]) || 0; continue; }
        d.push(day); c.push(cl); v.push(Number(q.volume?.[i]) || 0);
      }
      // A session still trading is left out: its volume is partial, so a distribution day cannot be judged until the close.
      let live: string | null = null;
      if (d.length && liveSessionBar(d[d.length - 1], m)) { live = d.pop()!; c.pop(); v.pop(); }
      if (d.length >= 210) return { bars: { d, c, v }, why: null, live };
      why.push(`${name} ${d.length} bars`);
    } catch (e: any) { why.push(`${name} ${String(e?.name || e).slice(0, 24)}`); }
  }
  return { bars: null, why: why.join(', '), live: null };
}

export interface BreadthPoint { rg?: string; d: string; a20: number | null; a50: number | null; a200: number | null; nh: number; nl: number | null; adv: number; dec: number; lh: number | null }
export interface MarketPayload {
  v: number; market: Mkt; builtAt: string; snapshotAt: string | null;
  benches: BenchRead[]; bench: BenchRead | null; benchMissing: string[];
  breadth: Breadth | null; breadthHistory: BreadthPoint[];
  leaders: Leader[]; leaderRule: string; leaderUniverse: number; health: LeaderHealth | null;
  holding: Leader[]; nearMiss: Leader[]; emerging: Emerging[];
  regime: RegimeRead; posture: PostureRead; recovery: { stage: string; checks: Check[] };
  maxDD6m: number | null;
  /** Primary benchmark, last 160 completed sessions, for the chart. */
  chart: { d: string[]; c: number[]; v: number[]; ma50: Array<number | null>; ma200: Array<number | null> } | null;
  liveSession: string | null;
}

const HIST_KEY = (m: Mkt) => `mlr:breadth:v1:${m}`;

export async function buildMarket(m: Mkt): Promise<MarketPayload> {
  const [snap, ...bs] = await Promise.all([getSnapshot(m), ...BENCHES[m].map((b) => benchBars(b.symbol, m))]);
  const benches: BenchRead[] = [], benchMissing: string[] = [];
  BENCHES[m].forEach((b, i) => { const r = bs[i].bars ? benchRead(b.name, bs[i].bars!) : null; if (r) benches.push(r); else benchMissing.push(`${b.name} (${bs[i].why || 'too short'})`); });
  const primary = benches.find((x) => x.name === BENCHES[m].find((b) => b.primary)!.name) ?? null;
  const pBars = bs[0].bars;
  let maxDD6m: number | null = null;
  if (pBars) { const s = Math.max(0, pBars.c.length - 126); let hi = pBars.c[Math.max(0, s - 126)]; let mx = 0; for (let i = Math.max(0, s - 126); i < pBars.c.length; i++) { hi = Math.max(hi, pBars.c[i]); if (i >= s) mx = Math.max(mx, (1 - pBars.c[i] / hi) * 100); } maxDD6m = +mx.toFixed(1); }

  const rows = (snap?.rows || []) as unknown as Row[];
  const rsMap = rsRanks(rows);
  const breadth = rows.length ? breadthOf(rows, m) : null;
  const benchM1 = primary?.ret.m1 ?? null;
  const { leaders, rule, universe } = rows.length ? pickLeaders(rows, m, rsMap, benchM1) : { leaders: [], rule: 'No screener snapshot available.', universe: 0 };
  const health = leaders.length ? leaderHealth(leaders) : null;
  const holding = leaders.filter((l) => l.state === 'HEALTHY').sort((a, b) => (a.dd ?? 99) - (b.dd ?? 99));
  const nearMiss = leaders.filter((l) => l.vs200 != null && l.vs200 < 0 && l.vs200 > -3).sort((a, b) => (b.vs200 ?? 0) - (a.vs200 ?? 0));
  const emerging = rows.length ? emergingNames(rows, m, rsMap, new Set(leaders.map((l) => l.t)), benchM1) : [];
  const regime = regimeOf(primary, breadth, health, maxDD6m);
  const posture = postureOf(regime, primary, breadth, health, holding.map((l) => l.t), nearMiss.map((l) => `${l.t} (${l.vs200}% under)`));
  const recovery = recoveryChecks(primary, breadth, health, emerging.length);

  // daily breadth record (one point per snapshot day)
  let breadthHistory: BreadthPoint[] = [];
  try {
    const hist = ((await kvGet<BreadthPoint[]>(HIST_KEY(m))) || []).filter((p) => p && p.d);
    const day = (snap?.builtAt || '').slice(0, 10);
    if (breadth && day && breadth.n >= 100) {
      const pt: BreadthPoint = { rg: regime.regime, d: day, a20: breadth.a20, a50: breadth.a50, a200: breadth.a200, nh: breadth.nh, nl: breadth.nlKnown ? breadth.nl : null, adv: breadth.adv, dec: breadth.dec, lh: health?.healthyPct ?? null };
      const i = hist.findIndex((p) => p.d === day);
      if (i >= 0) hist[i] = pt; else hist.push(pt);
      hist.sort((a, b) => a.d.localeCompare(b.d));
      breadthHistory = hist.slice(-120);
      await kvSet(HIST_KEY(m), breadthHistory, 400 * 86_400);
    } else breadthHistory = hist.slice(-120);
  } catch { /* history is optional */ }

  let chart: MarketPayload['chart'] = null;
  if (pBars) {
    const n = pBars.c.length, k = Math.min(160, n);
    const ma = (w: number) => Array.from({ length: k }, (_, j) => { const end = n - k + j + 1; return end >= w ? +(pBars.c.slice(end - w, end).reduce((a, b) => a + b, 0) / w).toFixed(2) : null; });
    chart = { d: pBars.d.slice(-k), c: pBars.c.slice(-k).map((x) => +x.toFixed(2)), v: pBars.v.slice(-k), ma50: ma(50), ma200: ma(200) };
  }
  return {
    chart, liveSession: bs[0].live,
    v: LR_VERSION, market: m, builtAt: new Date().toISOString(), snapshotAt: snap?.builtAt ?? null,
    benches, bench: primary, benchMissing, breadth, breadthHistory,
    leaders, leaderRule: rule, leaderUniverse: universe, health, holding, nearMiss, emerging,
    regime, posture, recovery, maxDD6m,
  };
}

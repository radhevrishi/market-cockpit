// zzz1289 — builds the Theme Cycle history payload: long daily histories (Yahoo, explicit dates so bars stay DAILY —
// `range=max` silently returns monthly bars), benchmark falls of 15%+, every sector scored over the same window,
// the market regime from the full history, and the computed lessons. Server only.
import { seriesFromTs, drawdownEpisodes, episodeRow, historyLessons, regimeOf, type DaySeries, type EpisodeRow, type HistoryLessons, type RegimeRead, type HistSector } from './core';
import { HISTORY_SETS, HISTORY_MIN_DEPTH } from './universe';

export const CYCLE_VERSION = 1;

export interface CyclePayload {
  v: number;
  market: 'india' | 'us';
  benchName: string;
  builtAt: string;
  lastDay: string;
  firstDay: string;
  regime: RegimeRead | null;
  episodes: EpisodeRow[];
  lessons: HistoryLessons;
  minDepth: number;
  coverage: { sectors: number; missing: string[] };
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const FAILS = new Map<string, string>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function dailyHistory(symbol: string, fromUnix = 0): Promise<DaySeries | null> {
  const p2 = Math.floor(Date.now() / 1000) + 86_400;
  const why: string[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const host of ['query1', 'query2']) {
      try {
        // Same request shape as the charts page (lib/chart-data): period1/period2 keep the bars DAILY.
        const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${fromUnix}&period2=${p2}&interval=1d&includePrePost=false&events=div%2Csplit`,
          { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000), cache: 'no-store' });
        if (!r.ok) { why.push(`${host} ${r.status}`); continue; }
        const j: any = await r.json();
        const res = j?.chart?.result?.[0];
        if (!res?.timestamp?.length) { why.push(`${host} empty`); continue; }
        const s = seriesFromTs(res.timestamp, res.indicators?.quote?.[0]?.close || []);
        if (s.d.length >= 200) { FAILS.delete(symbol); return s; }
        why.push(`${host} ${s.d.length} bars`);
      } catch (e: any) { why.push(`${host} ${String(e?.name || e).slice(0, 30)}`); }
    }
    await sleep(1500 * (attempt + 1));
  }
  FAILS.set(symbol, why.slice(-3).join(', '));
  return null;
}

async function pool<T, R>(items: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await f(items[k]); } }));
  return out;
}

export async function buildCyclePayload(market: 'india' | 'us'): Promise<CyclePayload> {
  const set = HISTORY_SETS[market];
  const symbols = new Set<string>([set.bench]);
  for (const s of set.sectors) { if (s.index) symbols.add(s.index); (s.basket || []).forEach((b) => symbols.add(b)); }
  const list = [...symbols];
  const bench0 = await dailyHistory(set.bench);
  const rest = list.filter((x) => x !== set.bench);
  const got0 = await pool(rest, 3, (s) => dailyHistory(s));
  const got = list.map((x) => (x === set.bench ? bench0 : got0[rest.indexOf(x)]));
  const by = new Map<string, DaySeries>();
  list.forEach((s, i) => { if (got[i]) by.set(s, got[i]!); });
  const bench = by.get(set.bench);
  if (!bench) throw new Error(`benchmark ${set.bench} history unavailable (${FAILS.get(set.bench) || 'no answer'})`);
  const missing: string[] = [];
  const sectors: HistSector[] = set.sectors.map((s) => {
    const index = s.index ? by.get(s.index) || null : null;
    const basket = (s.basket || []).map((b) => by.get(b)).filter((x): x is DaySeries => !!x);
    if (!index && !basket.length) missing.push(s.name);
    return { name: s.name, index, basket, basketUntil: set.basketUntil };
  });
  const lastDay = bench.d[bench.d.length - 1];
  const eps = drawdownEpisodes(bench, HISTORY_MIN_DEPTH);
  const rows: EpisodeRow[] = [];
  let prev: string | null = null;
  for (const e of eps) { rows.push(episodeRow(market, e, prev, bench, sectors, lastDay)); prev = e.trough; }
  return {
    v: CYCLE_VERSION, market, benchName: set.benchName, builtAt: new Date().toISOString(),
    lastDay, firstDay: bench.d[0], regime: regimeOf(bench), episodes: rows, lessons: historyLessons(rows),
    minDepth: HISTORY_MIN_DEPTH, coverage: { sectors: sectors.length - missing.length, missing },
  };
}

// zzz1235 — Hidden Inflection Radar: industry news (Google News searches per industry + our own news archive), read for
// abnormal signals, scored, and laid against the Indian supply-chain map with each company's figures. Server only.
import { kvGet, kvSet } from '../kv';
import { fetchGoogleNewsRSS } from '../indian-news-rss';
import { loadNews } from '../news/archive';
import { getSnapshot } from '../screener/snapshot-cache';
import { INDUSTRIES, dedupeSignals, isCompanyResultsHeadline, industriesOf, industryScore, isSyntheticHeadline, neglectFromPrices, readSignal, recencyWeight, scoreBand, scoreSignal, type ScoredSignal } from './core';

const KEY = 'inflection-radar:v4';   // zzz1244 — one news pass, an India map and a USA map (…:IN / …:US)
export type RadarMarket = 'IN' | 'US';
const TTL_S = 3 * 3600;

export interface RadarIndustry {
  id: string; name: string; why: string;
  top: number; band: { label: string; action: string };
  confirmations: number;   // zzz1238 — other recent signals backing the best one
  signals: Array<ScoredSignal & { ageDays: number; rawScore: number; sources?: number }>;
  companies: Array<{ ticker: string; name: string; bucket: string; verify: string; large: boolean; mc: number | null; revQYoY: number | null; epsQYoY: number | null; opm: number | null; perf3M: number | null; perf1Y: number | null; pe: number | null; stage: number | null; inUniverse: boolean; salesCr?: number | null; sharesCr?: number | null }>;
  newsCount: number;
}
export interface RadarData { builtAt: string; market: RadarMarket; industries: RadarIndustry[]; notes: string[] }

export async function inflectionRadar(force = false, market: RadarMarket = 'IN'): Promise<RadarData> {
  if (!force) { const c = await kvGet<RadarData>(`${KEY}:${market}`).catch(() => null); if (c?.industries) return c; }
  const both = await buildBoth();
  return both[market];
}

let _building: Promise<Record<RadarMarket, RadarData>> | null = null;
function buildBoth(): Promise<Record<RadarMarket, RadarData>> {
  if (!_building) _building = buildBothNow().finally(() => { _building = null; });
  return _building;
}

async function buildBothNow(): Promise<Record<RadarMarket, RadarData>> {
  // 1. the archive (90 days) + 2. targeted industry searches
  const archive = await loadNews(90).catch(() => []);
  const searched: Array<{ title: string; url: string | null; source: string | null; at: string; industry: string }> = [];
  const queries = INDUSTRIES.flatMap((i) => [...i.queries, ...(i.usQueries || [])].map((q) => ({ q, id: i.id })));
  let qi = 0;
  const deadline = Date.now() + 60_000;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (qi < queries.length && Date.now() < deadline) {
      const { q, id } = queries[qi++];
      const items = await fetchGoogleNewsRSS(q).catch(() => []);
      for (const it of items.slice(0, 25)) searched.push({ title: it.title, url: it.url, source: (it as any).publisher || it.source || null, at: it.published_at, industry: id });
    }
  }));
  const since = Date.now() - 120 * 86_400_000;
  const pool = new Map<string, { title: string; url: string | null; source: string | null; at: string; ids: Set<string> }>();
  const add = (title: string, url: string | null, source: string | null, at: string, ids: string[]) => {
    if (!title || !ids.length || !(Date.parse(at) >= since) || isSyntheticHeadline(title) || isCompanyResultsHeadline(title)) return;
    const k = title.toLowerCase().replace(/\s*-\s*[^-]{2,40}$/, '').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 120);
    const x = pool.get(k);
    if (x) { ids.forEach((i) => x.ids.add(i)); return; }
    pool.set(k, { title, url, source, at, ids: new Set(ids) });
  };
  for (const a of archive) add(a.title, a.url, a.source, a.publishedAt, industriesOf(`${a.title} ${a.summary || ''}`));
  for (const s of searched) { const ids = industriesOf(s.title); add(s.title, s.url, s.source, s.at, ids.length ? ids : []); }

  const out = {} as Record<RadarMarket, RadarData>;
  for (const market of ['IN', 'US'] as RadarMarket[]) {
  const snap = await getSnapshot(market).catch(() => null);
  const byT = new Map<string, any>((snap?.rows || []).map((r: any) => [String(r.t).toUpperCase(), r]));
  const largeCap = market === 'IN' ? 30000 : 10000;   // ₹ crore / $ million
  const industries: RadarIndustry[] = INDUSTRIES.map((ind) => {
    const companies = (market === 'IN' ? ind.beneficiaries : ind.us || []).map((b) => {
      const r = byT.get(b.ticker);
      return {
        ticker: b.ticker, name: r?.n || b.name, bucket: b.bucket, verify: b.verify, large: !!b.large || (typeof r?.mc === 'number' && r.mc > largeCap),
        mc: r?.mc ?? null, revQYoY: r?.revQYoY ?? null, epsQYoY: r?.epsQYoY ?? null, opm: r?.opmTTM ?? null, perf3M: r?.perf3M ?? null, perf1Y: r?.perf1Y ?? null, pe: r?.pe ?? null,
        stage: r?.twSt ?? null, inUniverse: !!r,
        // zzz1241 — for the EPS sensitivity: TTM sales = market cap ÷ P/S, shares = market cap ÷ price (both ₹ crore / crore)
        salesCr: typeof r?.mc === 'number' && typeof r?.ps === 'number' && r.ps > 0 ? Math.round(r.mc / r.ps) : null,
        sharesCr: typeof r?.mc === 'number' && typeof r?.px === 'number' && r.px > 0 ? +(r.mc / r.px).toFixed(2) : null,
      };
    });
    const small = companies.filter((c) => !c.large);
    const neglect = neglectFromPrices(small.map((c) => c.perf3M));
    const news = Array.from(pool.values()).filter((p) => p.ids.has(ind.id));
    const signals: RadarIndustry['signals'] = [];
    const now = Date.now();
    for (const n of news) {
      const read = readSignal(n.title);
      const s = scoreSignal(read, { neglect, smallCount: small.length });
      if (!s) continue;
      const ageDays = Math.max(0, (now - Date.parse(n.at)) / 86_400_000);
      const w = recencyWeight(ageDays);
      const reasons = w < 1 ? [...s.reasons, `${Math.round(ageDays)} days old (counted at ${Math.round(w * 100)}%)`] : s.reasons;
      signals.push({ industry: ind.id, headline: n.title, url: n.url, source: n.source, at: n.at, read, ...s, reasons, score: Math.round(s.score * w), rawScore: s.score, ageDays: Math.round(ageDays) });
    }
    signals.sort((a, b) => b.score - a.score || b.at.localeCompare(a.at));
    const stories = dedupeSignals(signals);   // zzz1241 — one story reported twice is one signal, not a confirmation
    const { top, confirmations } = industryScore(stories);
    return { id: ind.id, name: ind.name, why: ind.why, top, confirmations, band: scoreBand(top), signals: stories.slice(0, 15), companies, newsCount: news.length };
  }).sort((a, b) => b.top - a.top);

  const data: RadarData = {
    builtAt: new Date().toISOString(), market, industries,
    notes: [
      `${searched.length} industry headlines searched today + ${archive.length} from our news archive (90 days).`,
      'The same story from several outlets is one signal (shown as ×N sources). Industry score = its best signal (older news counts less: full weight for 14 days, 60% after 60 days) + 3 points for each other recent signal that confirms it (up to 12). Our own alert lines are not counted as news; chip "packaging" is kept out of packaging.',
      'A score is research priority (framework weights: magnitude 20, acceleration 15, duration 15, EPS impact 20, market neglect 15, bottleneck 15) — not a buy.',
      market === 'IN' ? 'The company map is a research lead, not proof of revenue linkage: verify product fit, customer, utilisation and materiality.'
        : 'USA map: US-listed suppliers per industry (market caps in $ million; over $10 billion counts as large). The same industry news drives both tabs — a research lead, not proof of revenue linkage.',
      'Company results headlines (one company\'s quarter) are not counted as industry signals.',
    ],
  };
  await kvSet(`${KEY}:${market}`, data, TTL_S).catch(() => undefined);
  out[market] = data;
  }
  return out;
}

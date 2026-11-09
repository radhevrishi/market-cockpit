// zzz1235 — Hidden Inflection Radar: industry news (Google News searches per industry + our own news archive), read for
// abnormal signals, scored, and laid against the Indian supply-chain map with each company's figures. Server only.
import { kvGet, kvSet } from '../kv';
import { fetchGoogleNewsRSS } from '../indian-news-rss';
import { loadNews } from '../news/archive';
import { getSnapshot } from '../screener/snapshot-cache';
import { INDUSTRIES, industriesOf, neglectFromPrices, readSignal, scoreBand, scoreSignal, type ScoredSignal } from './core';

const KEY = 'inflection-radar:v1';
const TTL_S = 3 * 3600;

export interface RadarIndustry {
  id: string; name: string; why: string;
  top: number; band: { label: string; action: string };
  signals: ScoredSignal[];
  companies: Array<{ ticker: string; name: string; bucket: string; verify: string; large: boolean; mc: number | null; revQYoY: number | null; epsQYoY: number | null; opm: number | null; perf3M: number | null; perf1Y: number | null; pe: number | null; stage: number | null; inUniverse: boolean }>;
  newsCount: number;
}
export interface RadarData { builtAt: string; industries: RadarIndustry[]; notes: string[] }

export async function inflectionRadar(force = false): Promise<RadarData> {
  if (!force) { const c = await kvGet<RadarData>(KEY).catch(() => null); if (c?.industries) return c; }
  const snap = await getSnapshot('IN').catch(() => null);
  const byT = new Map<string, any>((snap?.rows || []).map((r: any) => [String(r.t).toUpperCase(), r]));
  // 1. the archive (90 days) + 2. targeted industry searches
  const archive = await loadNews(90).catch(() => []);
  const searched: Array<{ title: string; url: string | null; source: string | null; at: string; industry: string }> = [];
  const queries = INDUSTRIES.flatMap((i) => i.queries.map((q) => ({ q, id: i.id })));
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
    if (!title || !ids.length || !(Date.parse(at) >= since)) return;
    const k = title.toLowerCase().replace(/\s*-\s*[^-]{2,40}$/, '').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 120);
    const x = pool.get(k);
    if (x) { ids.forEach((i) => x.ids.add(i)); return; }
    pool.set(k, { title, url, source, at, ids: new Set(ids) });
  };
  for (const a of archive) add(a.title, a.url, a.source, a.publishedAt, industriesOf(`${a.title} ${a.summary || ''}`));
  for (const s of searched) { const ids = industriesOf(s.title); add(s.title, s.url, s.source, s.at, ids.length ? ids : []); }

  const industries: RadarIndustry[] = INDUSTRIES.map((ind) => {
    const companies = ind.beneficiaries.map((b) => {
      const r = byT.get(b.ticker);
      return {
        ticker: b.ticker, name: r?.n || b.name, bucket: b.bucket, verify: b.verify, large: !!b.large || (typeof r?.mc === 'number' && r.mc > 30000),
        mc: r?.mc ?? null, revQYoY: r?.revQYoY ?? null, epsQYoY: r?.epsQYoY ?? null, opm: r?.opmTTM ?? null, perf3M: r?.perf3M ?? null, perf1Y: r?.perf1Y ?? null, pe: r?.pe ?? null,
        stage: r?.twSt ?? null, inUniverse: !!r,
      };
    });
    const small = companies.filter((c) => !c.large);
    const neglect = neglectFromPrices(small.map((c) => c.perf3M));
    const news = Array.from(pool.values()).filter((p) => p.ids.has(ind.id));
    const signals: ScoredSignal[] = [];
    for (const n of news) {
      const read = readSignal(n.title);
      const s = scoreSignal(read, { neglect, smallCount: small.length });
      if (!s) continue;
      signals.push({ industry: ind.id, headline: n.title, url: n.url, source: n.source, at: n.at, read, ...s });
    }
    signals.sort((a, b) => b.score - a.score || b.at.localeCompare(a.at));
    const top = signals[0]?.score ?? 0;
    return { id: ind.id, name: ind.name, why: ind.why, top, band: scoreBand(top), signals: signals.slice(0, 15), companies, newsCount: news.length };
  }).sort((a, b) => b.top - a.top);

  const data: RadarData = {
    builtAt: new Date().toISOString(), industries,
    notes: [
      `${searched.length} industry headlines searched today + ${archive.length} from our news archive (90 days).`,
      'A score is research priority (framework weights: magnitude 20, acceleration 15, duration 15, EPS impact 20, market neglect 15, bottleneck 15) — not a buy.',
      'The company map is a research lead, not proof of revenue linkage: verify product fit, customer, utilisation and materiality.',
    ],
  };
  await kvSet(KEY, data, TTL_S).catch(() => undefined);
  return data;
}

// zzz1179 — gathers the inputs for every theme's pulse (news archive, stock screener, transformational events, key
// contracts) and scores them. No AI. Cached 10 minutes per server. Server-only.
import { themePulse, type PulseCo, type PulseEvent, type ThemePulse } from './pulse';
import type { ChokeRegion } from './core';

let cache: { key: string; at: number; data: Record<string, ThemePulse> } | null = null;
export const pulseKey = (region: ChokeRegion, name: string) => `${region}|${name}`;

export async function allPulses(): Promise<{ generatedAt: string | null; pulses: Record<string, ThemePulse>; newsItems: number } | null> {
  const { loadChoke } = await import('./run');
  const report = await loadChoke();
  if (!report) return null;
  if (cache && cache.key === report.generatedAt && Date.now() - cache.at < 10 * 60_000) return { generatedAt: report.generatedAt, pulses: cache.data, newsItems: -1 };

  const [{ loadNews }, { loadCands }] = await Promise.all([import('../news/archive'), import('../screener/ai-candidates-load')]);
  const [news, usC, inC, evs, contracts] = await Promise.all([
    loadNews(60),
    loadCands('US'), loadCands('IN'),
    import('../transformational/store').then((m) => m.loadItems(60)).catch(() => []),
    import('../news/transformational-ledger').then((m) => m.readTransformational({ window_days: 60, limit: 100, sort: 'recent' })).catch(() => null),
  ]);
  const cos: Record<ChokeRegion, Map<string, PulseCo>> = { US: new Map(), IN: new Map() };
  for (const c of usC) cos.US.set(c.t, { t: c.t, revQ: c.revQ, revA: c.revA, opm: c.opm, p1y: c.p1y, p5y: c.p5y });
  for (const c of inC) cos.IN.set(c.t, { t: c.t, revQ: c.revQ, revA: c.revA, opm: c.opm, p1y: c.p1y, p5y: c.p5y });
  const events: PulseEvent[] = [
    ...(evs as any[]).map((x) => ({ ticker: x.ticker, date: x.sessionDate, headline: x.headline, kind: x.kind, strength: x.strength })),
    ...((contracts?.items || []) as any[]).filter((c) => c.primary_ticker).map((c) => ({ ticker: String(c.primary_ticker).toUpperCase(), date: String(c.published_at || c.recorded_at || '').slice(0, 10), headline: c.title, kind: 'CONTRACT', strength: 'KEY CONTRACT' })),
  ].filter((e) => e.ticker && /^\d{4}-\d{2}-\d{2}$/.test(e.date));

  const out: Record<string, ThemePulse> = {};
  for (const g of report.regions) for (const t of g.themes) out[pulseKey(g.region, t.name)] = themePulse(t, g.region, news, cos[g.region], events);
  cache = { key: report.generatedAt, at: Date.now(), data: out };
  return { generatedAt: report.generatedAt, pulses: out, newsItems: news.length };
}

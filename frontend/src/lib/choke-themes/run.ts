// zzz1174 → zzz1183 — the on-click AI run for Choke-Point Themes (v2: company J-curves) and where the result lives. Server-only.
// One call to the stronger model, grounded in the last 14 days of news, the Transformational Gainers themes, industry revenue
// acceleration and a list of small / mid-cap companies whose OWN figures are turning (stock screener). The server then lays
// the screener's facts over every candidate, calculates the scenarios, ranks themes by their qualifying candidates and
// computes "what changed" against the previous stored run. Stored in KV (latest + previous); runs only on the owner's click.
import { CHOKE_SYSTEM, CHOKE_TOOL, DISCOVERY_CAP, cleanChoke, diffRuns, enrich, type CandFacts, type ChokeRegion, type ChokeReport } from './core';
import type { Cand } from '../screener/ai-candidates';

export const CHOKE_KEY = 'choke-themes:v1:latest';
export const CHOKE_PREV_KEY = 'choke-themes:v1:previous';
export const CHOKE_DAILY_MAX = 6;
const TTL = 400 * 86_400;

const toFacts = (c: Cand): CandFacts => ({ cap: c.mc, revQ: c.revQ, revA: c.revA, epsQ: c.epsQ, opm: c.opm, pe: c.pe, fcfm: c.fcfm, de: c.de, p1y: c.p1y, p5y: c.p5y });
async function screenerFacts(): Promise<{ facts: Record<ChokeRegion, Map<string, CandFacts>>; cands: Record<ChokeRegion, Cand[]> }> {
  const { loadCands } = await import('../screener/ai-candidates-load');
  const [us, ind] = await Promise.all([loadCands('US'), loadCands('IN')]);
  return { cands: { US: us, IN: ind }, facts: { US: new Map(us.map((c) => [c.t, toFacts(c)])), IN: new Map(ind.map((c) => [c.t, toFacts(c)])) } };
}

/** The last successful run with today's stock-screener facts laid over it (no AI). An older v1 run is returned as it is. */
export async function loadChoke(): Promise<ChokeReport | null> {
  const { kvGet } = await import('../kv');
  const r = (await kvGet<ChokeReport>(CHOKE_KEY).catch(() => null)) || null;
  if (!r) return null;
  if (r.version === 2) enrich(r, (await screenerFacts()).facts);
  return r;
}

/** The most important recent headlines (14 days), newest and highest-importance first, as short lines. */
async function newsLines(): Promise<{ lines: string[]; asOf: string | null }> {
  const { kvGet } = await import('../kv');
  const { NEWS_SHARED_LASTGOOD_KEY } = await import('../guidance-upgrades-cache');
  const v: any = await Promise.race([kvGet<any>(NEWS_SHARED_LASTGOOD_KEY).catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))]);
  const arts: any[] = Array.isArray(v) ? v : Array.isArray(v?.articles) ? v.articles : [];
  const since = Date.now() - 14 * 86_400_000;
  const seen = new Set<string>();
  const rows = arts
    .map((a) => ({ t: String(a?.title || a?.headline || '').replace(/\s+/g, ' ').trim(), at: Date.parse(a?.published_at || a?.publishedAt || a?.date || ''), imp: Number(a?.importance_score ?? a?.importance ?? 0) || 0, src: String(a?.source || a?.source_name || '').slice(0, 30), reg: String(a?.region || '') }))
    .filter((a) => a.t.length > 20 && (!Number.isFinite(a.at) || a.at >= since))
    .filter((a) => { const k = a.t.toLowerCase().slice(0, 80); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => b.imp - a.imp || (b.at || 0) - (a.at || 0))
    .slice(0, 120);
  return { lines: rows.map((a) => `- ${Number.isFinite(a.at) ? new Date(a.at).toISOString().slice(0, 10) : ''} ${a.reg ? `[${a.reg}] ` : ''}${a.t.slice(0, 200)}${a.src ? ` (${a.src})` : ''}`), asOf: typeof v?.savedAt === 'string' ? v.savedAt : null };
}

/** Which themes Transformational Gainers saw in the last 30 days (company counts), per market. */
async function gainerThemes(): Promise<string[]> {
  try {
    const { loadItems } = await import('../transformational/store');
    const items = await loadItems(30);
    const m = new Map<string, Set<string>>();
    for (const x of items) { const k = `${x.market}|${x.theme}`; m.set(k, (m.get(k) || new Set()).add(x.ticker)); }
    return [...m.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 30)
      .map(([k, s]) => { const [mk, th] = k.split('|'); return `- ${mk === 'IN' ? 'India' : 'US'}: ${th} — ${s.size} companies (${[...s].slice(0, 6).join(', ')})`; });
  } catch { return []; }
}

export async function runChoke(): Promise<{ ok: true; report: ChokeReport } | { ok: false; error: string }> {
  const m = await import('../anthropic-meter');
  if (!m.modelConfigured()) return { ok: false, error: 'AI is not configured on the server.' };
  const { kvGet, kvSet, kvIncrByFloat } = await import('../kv');
  const dayKey = `choke-themes:runs:${new Date().toISOString().slice(0, 10)}`;
  const used = Number(await kvGet<number>(dayKey).catch(() => 0)) || 0;
  if (used >= CHOKE_DAILY_MAX) return { ok: false, error: `Daily limit reached (${CHOKE_DAILY_MAX} AI runs) — the last run is still shown.` };
  await kvIncrByFloat(dayKey, 1, 2 * 86_400).catch(() => null);

  const { industryInflections, candLine } = await import('../screener/ai-candidates');
  const { kvGet: kg } = await import('../kv');
  const [news, themes, prevRaw, sf] = await Promise.all([newsLines(), gainerThemes(), kg<ChokeReport>(CHOKE_KEY).catch(() => null), screenerFacts()]);
  const prev = prevRaw || null;
  const infl = { US: industryInflections(sf.cands.US, 'US'), IN: industryInflections(sf.cands.IN, 'IN') };
  // zzz1183 — discovery beyond the familiar names: small / mid caps in the size band whose OWN figures are turning up
  const turning = (mk: ChokeRegion) => {
    const [lo, hi] = DISCOVERY_CAP[mk];
    return sf.cands[mk].filter((c) => c.mc >= lo && c.mc <= hi && c.revQ != null && (c.revQ >= 25 || (c.revA != null && c.revQ >= c.revA + 10)) && (c.opm == null || c.opm > 0))
      .sort((x, y) => ((y.revQ ?? 0) - (y.revA ?? 0)) - ((x.revQ ?? 0) - (x.revA ?? 0))).slice(0, 110).map((c) => candLine(c, mk));
  };
  const prevText = prev ? prev.regions.map((g) => `${g.region}: ${g.themes.map((t) => `${t.name} [${[...(t.candidates || []), ...(t.leaders || []), ...(t.smallMid || [])].map((l: any) => l.ticker).join(', ')}]`).join('; ')}`).join('\n') : 'none (first run)';
  const user = [
    `Today: ${new Date().toISOString().slice(0, 10)}. Stock-screener data as of the latest build.`,
    `Previous run (${prev?.generatedAt?.slice(0, 10) || 'none'}) — reference only; judge everything again from the evidence:\n${prevText}`,
    themes.length ? `Themes seen in the owner's daily gainers (last 30 days):\n${themes.join('\n')}` : null,
    infl.US.length ? `US industries by revenue acceleration (latest quarter vs year):\n${infl.US.join('\n')}` : null,
    infl.IN.length ? `India industries by revenue acceleration:\n${infl.IN.join('\n')}` : null,
    'Company data columns: ticker | name | industry | market cap | sales growth latest quarter and last year | EPS growth latest quarter | operating margin | ROCE | debt/equity | P/E | P/S | FCF margin | share move 1y and 5y (context only) | share-count change a year.',
    `US small / mid caps whose own figures are turning up (discovery leads, not conclusions):\n${turning('US').join('\n')}`,
    `India small / mid caps whose own figures are turning up:\n${turning('IN').join('\n')}`,
    news.lines.length ? `Recent news (most important first):\n${news.lines.join('\n')}` : 'No recent news available — say nothing about recent events.',
    'Write the US first, then India.',
  ].filter(Boolean).join('\n\n');

  const { strongModel } = await import('../ai-guidance-router');
  const prov = m.provider();
  const cheap = m.activeModel('claude-haiku-4-5-20251001');
  const strong = strongModel(prov, cheap);
  const body: any = {
    model: prov === 'anthropic' && strong ? strong : 'claude-haiku-4-5-20251001', max_tokens: 16000, system: CHOKE_SYSTEM,
    tools: [CHOKE_TOOL], tool_choice: { type: 'tool', name: CHOKE_TOOL.name },
    messages: [{ role: 'user', content: user }],
  };
  try {
    const resp = await m.anthropicMessages('choke-themes', body, { signal: AbortSignal.timeout(300_000), ...(prov === 'openai' && strong ? { openaiModel: strong, reasoningEffort: 'low' } : {}) } as any);
    const j: any = await resp.json().catch(() => null);
    if (!resp.ok) {
      const raw = String(j?.error?.message || `HTTP ${resp.status}`);
      console.warn('[choke-themes] AI call failed:', raw);
      return { ok: false, error: resp.status === 402 ? 'AI spend limit reached' : resp.status === 429 ? 'The AI provider is busy or out of credit' : `The AI provider refused the request (${resp.status})`, detail: raw.slice(0, 300) } as any;
    }
    const d = (j?.content || []).find((c: any) => c?.type === 'tool_use')?.input;
    const clean = cleanChoke(d);
    if (!clean) return { ok: false, error: 'The AI answer was incomplete — try again' };
    enrich(clean, sf.facts);
    const report: ChokeReport = {
      version: 2, ...clean, changes: diffRuns(prev, clean), generatedAt: new Date().toISOString(), model: j?.model ?? (strong || cheap),
      newsUsed: news.lines.length, asOfNews: news.asOf, marketDataAt: new Date().toISOString(), prevAt: prev?.generatedAt ?? null,
    };
    if (prev) await kvSet(CHOKE_PREV_KEY, prev, TTL).catch(() => undefined);
    await kvSet(CHOKE_KEY, report, TTL);
    return { ok: true, report };
  } catch (e: any) {
    return { ok: false, error: `AI call failed: ${String(e?.message || e).slice(0, 200)}` };
  }
}

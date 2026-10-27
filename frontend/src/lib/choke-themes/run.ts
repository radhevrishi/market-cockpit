// zzz1174 → zzz1183 — the on-click AI run for Choke-Point Themes (v2: company J-curves) and where the result lives. Server-only.
// One call to the stronger model, grounded in the last 14 days of news, the Transformational Gainers themes, industry revenue
// acceleration and a list of small / mid-cap companies whose OWN figures are turning (stock screener). The server then lays
// the screener's facts over every candidate, calculates the scenarios, ranks themes by their qualifying candidates and
// computes "what changed" against the previous stored run. Stored in KV (latest + previous); runs only on the owner's click.
import { CHOKE_CHECKLIST, CROSS_BORDER_CHECKLIST, CHOKE_SYSTEM, DISCOVERY_CAP, chokeToolFor, cleanChoke, diffRuns, enrich, type CandFacts, type ChokeRegion, type ChokeReport } from './core';
import type { Cand } from '../screener/ai-candidates';

export const CHOKE_KEY = 'choke-themes:v1:latest';
export const CHOKE_PREV_KEY = 'choke-themes:v1:previous';
export const CHOKE_DAILY_MAX = 6;
const TTL = 400 * 86_400;

const toFacts = (c: Cand): CandFacts => ({ cap: c.mc, revQ: c.revQ, revA: c.revA, epsQ: c.epsQ, opm: c.opm, opmFY: c.opmFY ?? null, pe: c.pe, fcfm: c.fcfm, de: c.de, p1y: c.p1y, p5y: c.p5y });
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
  if (r.version === 2) {
    enrich(r, (await screenerFacts()).facts);
    // zzz1185 — a "what changed" computed against an old-method run is not a comparison: shown only when the previous run is v2
    if (r.changes?.length) { const prev = await kvGet<ChokeReport>(CHOKE_PREV_KEY).catch(() => null); if (prev?.version !== 2) r.changes = []; }
  }
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
  const inBand = (c: Cand, mk: ChokeRegion) => { const [lo, hi] = DISCOVERY_CAP[mk]; return c.mc >= lo && c.mc <= hi; };
  const turningC = (mk: ChokeRegion) => sf.cands[mk].filter((c) => inBand(c, mk) && c.revQ != null && (c.revQ >= 25 || (c.revA != null && c.revQ >= c.revA + 10)) && (c.opm == null || c.opm > 0 || c.revQ >= 40))
    .sort((x, y) => ((y.revQ ?? 0) - (y.revA ?? 0)) - ((x.revQ ?? 0) - (x.revA ?? 0))).slice(0, 160);
  // zzz1186 — and every in-band company in the bottleneck-prone industries, even before its figures turn (J1 watch names)
  const SEED_IND: Record<ChokeRegion, RegExp> = {
    US: /semiconductor|electronic comp|optical|fiber|communications equip|telecommunications equip|electrical|power|generat|turbine|engine|battery|industrial machin|aerospace|defen|ordnance|uranium|nuclear|metal|mining|rare|copper|chemical|computer (storage|peripheral|hardware|communication)|data storage|instrument|laser|refrigerat|hvac|heating|cooling|engineering|construction|shipbuild|space|robot|automation/i,
    IN: /electrical|electronic|cable|transformer|switchgear|meter|power|defen|explosive|aerospace|forg|casting|engineering|capital goods|compressor|pump|chemical|pharma|api|cdmo|ship|railway|wagon|metal|copper|aluminium|alumin|mining|semiconductor|component|industrial|gas|heavy|machinery|construction/i,
  };
  const seedC = (mk: ChokeRegion, skip: Set<string>) => sf.cands[mk].filter((c) => inBand(c, mk) && c.ind && SEED_IND[mk].test(c.ind) && !skip.has(c.t) && (c.revA != null || c.revQ != null))
    .sort((x, y) => (y.revQ ?? -99) - (x.revQ ?? -99)).slice(0, 160);
  const prevFor = (mk: ChokeRegion) => (prev?.regions || []).filter((g) => g.region === mk).map((g) => g.themes.map((t) => `${t.name} [${[...(t.candidates || []), ...(t.leaders || []), ...(t.smallMid || [])].map((l: any) => l.ticker).join(', ')}]`).join('; ')).join('') || 'none';
  const newsFor = (mk: ChokeRegion) => news.lines.filter((l) => (mk === 'IN' ? !/\[(US|GLOBAL)\]/.test(l) || /india/i.test(l) : !/\[IN\]/.test(l)) ).slice(0, 90);
  const coverage: NonNullable<ChokeReport['coverage']> = {};
  const researchUsed: Partial<Record<ChokeRegion, boolean>> = {};
  const userFor = (mk: ChokeRegion) => {
    const tc = turningC(mk), skip = new Set(tc.map((c) => c.t)), sc = seedC(mk, skip);
    coverage[mk] = { universe: sf.cands[mk].length, inBand: sf.cands[mk].filter((c) => inBand(c, mk)).length, turning: tc.length, industry: sc.length, news: newsFor(mk).length };
    const country = mk === 'US' ? 'the UNITED STATES' : 'INDIA';
    return [
      `Today: ${new Date().toISOString().slice(0, 10)}. Research ${country} only. Stock-screener data as of the latest build.`,
      `Previous run for this country — reference only; judge everything again from the evidence: ${prevFor(mk)}`,
      themes.length ? `Themes seen in the owner's daily gainers (last 30 days):\n${themes.filter((l) => l.includes(mk === 'IN' ? 'India:' : 'US:')).join('\n')}` : null,
      infl[mk].length ? `Industries by revenue acceleration (latest quarter vs year):\n${infl[mk].join('\n')}` : null,
      `CHECKLIST — test each of these bottlenecks against the company lists before you decide (keep only those that qualify; add others you find):\n${CHOKE_CHECKLIST[mk]}`,
      `CROSS-BORDER CHECKLIST — test each sub-theme too (these are often the real J-curves in sectors that look mature at home):\n${CROSS_BORDER_CHECKLIST[mk]}`,
      'Company data columns: ticker | name | industry | market cap | sales growth: latest quarter vs a year earlier, and last fiscal year | EPS growth latest quarter vs a year earlier | operating margin, trailing 12 months (TTM) | ROCE | debt/equity | P/E | P/S | FCF margin | share move 1y and 5y (context only) | share-count change a year.',
      `Small / mid caps whose own figures are turning up (discovery leads, not conclusions):\n${tc.map((c) => candLine(c, mk)).join('\n')}`,
      `Other small / mid caps in bottleneck-prone industries (possible J1 / J2 names before the figures turn):\n${sc.map((c) => candLine(c, mk)).join('\n')}`,
      newsFor(mk).length ? `Recent news (most important first):\n${newsFor(mk).join('\n')}` : 'No recent news available — say nothing about recent events.',
      'Give 4–6 qualifying themes when the evidence allows (at least 2), each with up to 4 discovery candidates. A large reference leader alone is not a discovery.',
    ].filter(Boolean).join('\n\n');
  };

  const { strongModel } = await import('../ai-guidance-router');
  const prov = m.provider();
  const cheap = m.activeModel('claude-haiku-4-5-20251001');
  const strong = strongModel(prov, cheap);
  const modelId = prov === 'anthropic' && strong ? strong : 'claude-haiku-4-5-20251001';
  const aiOpts = (effort: string) => ({ signal: AbortSignal.timeout(300_000), ...(prov === 'openai' && strong ? { openaiModel: strong, reasoningEffort: effort } : {}) } as any);
  // zzz1187 — STEP 1, think before filling the form: a free-text research pass with full reasoning (tool calls to GPT-6 run
  // without reasoning) works through the checklist and both company lists, and names suppliers it knows beyond them.
  const research = async (mk: ChokeRegion, base: string): Promise<string> => {
    try {
      const resp = await m.anthropicMessages('choke-themes', {
        model: modelId, max_tokens: 12000, system: CHOKE_SYSTEM,
        messages: [{ role: 'user', content: `${base}

RESEARCH STEP (plain text, no form yet). Work like a sector analyst hunting the next Micron / SanDisk-type J-curve in ${mk === 'US' ? 'the US' : 'India'}:
1. Go through EVERY checklist bottleneck and EVERY cross-border sub-theme (Europe+1 a–i etc.). For each: is supply tight NOW (lead times, allocation, price rises, sold-out capacity, qualification queues)? Say what the evidence is and how recent — industry facts you know count, labelled Known: with the year — or "no evidence".
2. For each tight one, list the LISTED small / mid-cap suppliers in this country — from the company lists AND from your own knowledge (exact tickers) — with the product, exposure and the J-stage their own figures show (quarter vs year sales, margin swing).
3. Say which popular "themes" are NOT J-curves now (already ran, ample supply, mature, one-off order on a low base) and why.
4. Finish with the 5–7 strongest themes and their best 2–4 candidates each.
Be concrete and brief: short lines, tickers, figures with their period. No filler.` }],
      }, aiOpts('high'));
      const j: any = await resp.json().catch(() => null);
      if (!resp.ok) return '';
      return String((j?.content || []).filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('\n')).slice(0, 24_000);
    } catch { return ''; }
  };
  const callFor = async (mk: ChokeRegion) => {
    const tool = chokeToolFor(mk);
    const base = userFor(mk);
    const notes = await research(mk, base);
    researchUsed[mk] = !!notes;
    const content = notes ? `${base}\n\nYOUR RESEARCH NOTES (from the step before — verify each claim against the company data and keep only what holds; candidates not in the data are allowed with their exact ticker):\n${notes}` : base;
    const body: any = {
      model: modelId, max_tokens: 16000, system: CHOKE_SYSTEM,
      tools: [tool], tool_choice: { type: 'tool', name: tool.name }, messages: [{ role: 'user', content }],
    };
    const resp = await m.anthropicMessages('choke-themes', body, aiOpts('low'));
    const j: any = await resp.json().catch(() => null);
    if (!resp.ok) {
      const raw = String(j?.error?.message || `HTTP ${resp.status}`);
      console.warn('[choke-themes] AI call failed:', mk, raw);
      throw Object.assign(new Error(resp.status === 402 ? 'AI spend limit reached' : resp.status === 429 ? 'The AI provider is busy or out of credit' : `The AI provider refused the request (${resp.status})`), { detail: raw.slice(0, 300) });
    }
    const d = (j?.content || []).find((c: any) => c?.type === 'tool_use')?.input;
    const g = cleanChoke(d)?.regions.find((x) => x.region === mk);
    if (!g || !g.themes.length) throw new Error('The AI answer was incomplete — try again');
    return { g, model: j?.model as string | undefined };
  };
  try {
    const res = await Promise.allSettled([callFor('US'), callFor('IN')]);
    const ok = res.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    if (!ok.length) { const e: any = (res[0] as PromiseRejectedResult).reason; return { ok: false, error: String(e?.message || e).slice(0, 200), detail: e?.detail } as any; }
    // a country whose call failed keeps its previous research (said so in the panel through the run notes)
    const regions = (['US', 'IN'] as ChokeRegion[]).map((mk, i) => {
      const r = res[i];
      if (r.status === 'fulfilled') return r.value.g;
      return (prev?.version === 2 ? prev.regions.find((x) => x.region === mk) : null) || { region: mk, themes: [], playbook: { strongest: [], confirm: [], milestones: [], disconfirming: [], valuation: [] } };
    });
    const clean = { regions, changes: [] as any[] };
    enrich(clean as any, sf.facts);
    const failed = (['US', 'IN'] as ChokeRegion[]).filter((_, i) => res[i].status !== 'fulfilled');
    const report: ChokeReport = {
      version: 2, ...clean, changes: prev?.version === 2 ? diffRuns(prev, clean) : [], generatedAt: new Date().toISOString(), model: ok[0].model ?? (strong || cheap),
      newsUsed: news.lines.length, asOfNews: news.asOf, marketDataAt: new Date().toISOString(), prevAt: prev?.generatedAt ?? null,
      coverage, researchUsed, ...(failed.length ? { keptFromPrevious: failed } : {}),
    } as any;
    if (prev) await kvSet(CHOKE_PREV_KEY, prev, TTL).catch(() => undefined);
    await kvSet(CHOKE_KEY, report, TTL);
    return { ok: true, report };
  } catch (e: any) {
    return { ok: false, error: `AI call failed: ${String(e?.message || e).slice(0, 200)}` };
  }
}

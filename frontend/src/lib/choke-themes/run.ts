// zzz1174 — the on-click AI run for Choke-Point Themes and where the result lives. Server-only.
// One call to the stronger model (the guidance router's choice, priced and metered like every call), grounded in the
// last 14 days of the news feed and the Transformational Gainers themes, compared with the previous run. Stored in KV
// (latest + previous); nothing runs on a schedule — the News page shows the last run until the owner clicks again.
import { CHOKE_SYSTEM, CHOKE_TOOL, cleanChoke, withCaps, type ChokeRegion, type ChokeReport } from './core';

export const CHOKE_KEY = 'choke-themes:v1:latest';
export const CHOKE_PREV_KEY = 'choke-themes:v1:previous';
export const CHOKE_DAILY_MAX = 6;
const TTL = 400 * 86_400;

/** ticker → market cap ($ M US / ₹ Cr India) from the stock screener (memory-cached on the server). */
async function screenerCaps(): Promise<Record<ChokeRegion, Map<string, number>>> {
  const caps: Record<ChokeRegion, Map<string, number>> = { US: new Map(), IN: new Map() };
  try {
    const { getSnapshot } = await import('../screener/snapshot-cache');
    await Promise.all((['US', 'IN'] as ChokeRegion[]).map(async (mk) => {
      const snap: any = await Promise.race([getSnapshot(mk), new Promise((r) => setTimeout(() => r(null), 5000))]);
      for (const row of (snap?.rows || [])) if (row?.t && typeof row.mc === 'number') caps[mk].set(String(row.t).toUpperCase(), row.mc);
    }));
  } catch { /* caps unknown */ }
  return caps;
}

/** The last run, with today's market caps (and the same size / duplicate / unknown-ticker checks) laid over it. No AI. */
export async function loadChoke(): Promise<ChokeReport | null> {
  const { kvGet } = await import('../kv');
  const r = (await kvGet<ChokeReport>(CHOKE_KEY).catch(() => null)) || null;
  if (!r) return null;
  for (const g of r.regions) for (const t of g.themes) t.smallMid = t.smallMid || [];
  withCaps(r, await screenerCaps());
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

  const [news, themes, prev] = await Promise.all([newsLines(), gainerThemes(), loadChoke()]);
  const prevText = prev ? prev.regions.map((g) => `${g.region}: ${g.themes.map((t) => `${t.name} [${t.leaders.map((l) => l.ticker).join(', ')}]`).join('; ')}`).join('\n') : 'none (first run)';
  const user = [
    `Today: ${new Date().toISOString().slice(0, 10)}.`,
    `Previous run (${prev?.generatedAt?.slice(0, 10) || 'none'}):\n${prevText}`,
    themes.length ? `Themes seen in the owner's daily gainers (last 30 days):\n${themes.join('\n')}` : null,
    news.lines.length ? `Recent news (most important first):\n${news.lines.join('\n')}` : 'No recent news available — use your own knowledge and say nothing about recent events.',
    'Write the US themes first, then India.',
  ].filter(Boolean).join('\n\n');

  const { strongModel } = await import('../ai-guidance-router');
  const prov = m.provider();
  const cheap = m.activeModel('claude-haiku-4-5-20251001');
  const strong = strongModel(prov, cheap);
  const body: any = {
    model: prov === 'anthropic' && strong ? strong : 'claude-haiku-4-5-20251001', max_tokens: 14000, system: CHOKE_SYSTEM,
    tools: [CHOKE_TOOL], tool_choice: { type: 'tool', name: CHOKE_TOOL.name },
    messages: [{ role: 'user', content: user }],
  };
  try {
    const resp = await m.anthropicMessages('choke-themes', body, { signal: AbortSignal.timeout(170_000), ...(prov === 'openai' && strong ? { openaiModel: strong, reasoningEffort: 'low' } : {}) } as any);
    const j: any = await resp.json().catch(() => null);
    if (!resp.ok) return { ok: false, error: String(j?.error?.message || `AI call failed (HTTP ${resp.status})`).slice(0, 300) };
    const d = (j?.content || []).find((c: any) => c?.type === 'tool_use')?.input;
    const clean = cleanChoke(d);
    if (!clean) return { ok: false, error: 'The AI answer was incomplete — the previous run is still shown. Try again.' };
    // zzz1175 — real market caps from the stock screener; a "small & mid" pick that is really large is dropped
    const caps = await screenerCaps();
    withCaps(clean, caps);
    const report: ChokeReport = { ...clean, generatedAt: new Date().toISOString(), model: j?.model ?? (strong || cheap), newsUsed: news.lines.length, asOfNews: news.asOf };
    if (prev) await kvSet(CHOKE_PREV_KEY, prev, TTL).catch(() => undefined);
    await kvSet(CHOKE_KEY, report, TTL);
    return { ok: true, report };
  } catch (e: any) {
    return { ok: false, error: `AI call failed: ${String(e?.message || e).slice(0, 200)}` };
  }
}

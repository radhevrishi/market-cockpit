// zzz1178 — the on-click AI run for Future 100-baggers and where it is kept (KV, latest + previous). Server-only.
import { HB_SYSTEM, HB_TOOL, cleanHb, type HbReport } from './core';
import type { Cand, CandMarket } from '../screener/ai-candidates';

export const HB_KEY = 'hundred-baggers:v1:latest';
const HB_PREV = 'hundred-baggers:v1:previous';
export const HB_DAILY_MAX = 6;
const TTL = 400 * 86_400;

export async function loadHb(): Promise<HbReport | null> {
  const { kvGet } = await import('../kv');
  return (await kvGet<HbReport>(HB_KEY).catch(() => null)) || null;
}

export async function runHb(): Promise<{ ok: true; report: HbReport } | { ok: false; error: string }> {
  const m = await import('../anthropic-meter');
  if (!m.modelConfigured()) return { ok: false, error: 'AI is not configured on the server.' };
  const { kvGet, kvSet, kvIncrByFloat } = await import('../kv');
  const dayKey = `hundred-baggers:runs:${new Date().toISOString().slice(0, 10)}`;
  if ((Number(await kvGet<number>(dayKey).catch(() => 0)) || 0) >= HB_DAILY_MAX) return { ok: false, error: `Daily limit reached (${HB_DAILY_MAX} AI runs) — the last run is still shown.` };

  const { hundredBaggerShortlist, candLine } = await import('../screener/ai-candidates');
  const { loadCands } = await import('../screener/ai-candidates-load');
  const [usAll, inAll, prev] = await Promise.all([loadCands('US'), loadCands('IN'), loadHb()]);
  const shortlist: Record<CandMarket, Cand[]> = { US: hundredBaggerShortlist(usAll, 'US'), IN: hundredBaggerShortlist(inAll, 'IN') };
  if (shortlist.US.length < 15 || shortlist.IN.length < 15) return { ok: false, error: 'The stock screener data is not ready yet — try again in a few minutes.' };
  await kvIncrByFloat(dayKey, 1, 2 * 86_400).catch(() => null);

  const prevText = prev ? prev.markets.map((g) => `${g.market}: ${g.picks.map((p) => p.ticker).join(', ')}`).join('\n') : 'none (first run)';
  const user = [
    `Today: ${new Date().toISOString().slice(0, 10)}.`,
    `Previous picks (${prev?.generatedAt?.slice(0, 10) || 'none'}) — keep what still holds, replace what weakened:\n${prevText}`,
    'Columns: ticker | name | industry | market cap | sales growth latest quarter and last year | EPS growth latest quarter | operating margin | ROCE | debt/equity | P/E | P/S | FCF margin | share move 1y and 5y | share count change a year (up = dilution).',
    `USA shortlist (${shortlist.US.length}):\n${shortlist.US.map((c) => candLine(c, 'US')).join('\n')}`,
    `India shortlist (${shortlist.IN.length}):\n${shortlist.IN.map((c) => candLine(c, 'IN')).join('\n')}`,
  ].join('\n\n');

  const { strongModel } = await import('../ai-guidance-router');
  const prov = m.provider();
  const cheap = m.activeModel('claude-haiku-4-5-20251001');
  const strong = strongModel(prov, cheap);
  const body: any = {
    model: prov === 'anthropic' && strong ? strong : 'claude-haiku-4-5-20251001', max_tokens: 16000, system: HB_SYSTEM,
    tools: [HB_TOOL], tool_choice: { type: 'tool', name: HB_TOOL.name }, messages: [{ role: 'user', content: user }],
  };
  try {
    const resp = await m.anthropicMessages('hundred-baggers', body, { signal: AbortSignal.timeout(175_000), ...(prov === 'openai' && strong ? { openaiModel: strong, reasoningEffort: 'low' } : {}) } as any);
    const j: any = await resp.json().catch(() => null);
    if (!resp.ok) return { ok: false, error: String(j?.error?.message || `AI call failed (HTTP ${resp.status})`).slice(0, 300) };
    const d = (j?.content || []).find((c: any) => c?.type === 'tool_use')?.input;
    const markets = cleanHb(d, shortlist);
    if (!markets) return { ok: false, error: 'The AI answer was incomplete — the previous run is still shown. Try again.' };
    const report: HbReport = { markets, generatedAt: new Date().toISOString(), model: j?.model ?? (strong || cheap), shortlist: { US: shortlist.US.length, IN: shortlist.IN.length } };
    if (prev) await kvSet(HB_PREV, prev, TTL).catch(() => undefined);
    await kvSet(HB_KEY, report, TTL);
    return { ok: true, report };
  } catch (e: any) {
    return { ok: false, error: `AI call failed: ${String(e?.message || e).slice(0, 200)}` };
  }
}

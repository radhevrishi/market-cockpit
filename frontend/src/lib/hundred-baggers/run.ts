// zzz1178 — the on-click AI run for Future 100-baggers and where it is kept (KV, latest + previous). Server-only.
import { HB_SYSTEM, HB_TOOL, cleanHb, type HbReport } from './core';
import type { Cand, CandMarket } from '../screener/ai-candidates';

export const HB_KEY = 'hundred-baggers:v1:latest';
const HB_PREV = 'hundred-baggers:v1:previous';
export const HB_DAILY_MAX = 6;
const TTL = 400 * 86_400;

export async function loadHb(): Promise<HbReport | null> {
  const { kvGet } = await import('../kv');
  const r = (await kvGet<HbReport>(HB_KEY).catch(() => null)) || null;
  // zzz1184 — data flags are laid over every read (a run stored before them gets them too)
  if (r) {
    const { hbFlags, hbApplyCaps, hbHundredXMath } = await import('./core');
    for (const g of r.markets) {
      for (const p of g.picks) if (p.data) { p.flags = hbFlags(p.data); Object.assign(p, hbApplyCaps(p)); p.math100 = hbHundredXMath(p.data, g.market); }
      // zzz1186 — a pick that fails the hard gates (stored before they existed, or its figures changed) leaves the list, said so
      const { hbGateFails } = await import('../screener/ai-candidates');
      g.removed = g.picks.filter((p) => p.data && hbGateFails(p.data, g.market).length).map((p) => ({ ticker: p.ticker, why: hbGateFails(p.data!, g.market).join(', ') }));
      g.picks = g.picks.filter((p) => !p.data || !hbGateFails(p.data, g.market).length);
      g.picks.sort((a, b) => b.total - a.total);   // ranked on the figure-checked total
    }
  }
  return r;
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

  const { strongModel } = await import('../ai-guidance-router');
  const { HB_CAP } = await import('../screener/ai-candidates');
  const { hbToolFor } = await import('./core');
  const prov = m.provider();
  const cheap = m.activeModel('claude-haiku-4-5-20251001');
  const strong = strongModel(prov, cheap);
  const modelId = prov === 'anthropic' && strong ? strong : 'claude-haiku-4-5-20251001';
  const aiOpts = (effort: string) => ({ signal: AbortSignal.timeout(300_000), ...(prov === 'openai' && strong ? { openaiModel: strong, reasoningEffort: effort } : {}) } as any);
  const cols = 'Columns: ticker | name | industry | market cap | sales growth latest quarter vs a year earlier, and last fiscal year | EPS growth latest quarter | operating margin TTM | ROCE | debt/equity | P/E | P/S | FCF margin | share move 1y and 5y | share count change a year (up = dilution).';
  const baseFor = (mk: CandMarket) => [
    `Today: ${new Date().toISOString().slice(0, 10)}. ${mk === 'US' ? 'USA' : 'India'} only. Size band ${mk === 'US' ? `$${HB_CAP.US[0]}M–$${HB_CAP.US[1] / 1000}B` : `₹${HB_CAP.IN[0].toLocaleString('en-IN')}–${HB_CAP.IN[1].toLocaleString('en-IN')} Cr`}.`,
    `Previous picks — for reference only; judge every company again from scratch: ${prev?.markets.find((g) => g.market === mk)?.picks.map((p) => p.ticker).join(', ') || 'none'}`,
    cols,
    `Shortlist (${shortlist[mk].length} — already passed the hard gates: growing, not loss-making, no heavy cash burn, debt/equity ≤1, dilution ≤5% a year, not priced for perfection, not already up 5x in 5 years; lenders and insurers excluded):\n${shortlist[mk].map((c) => candLine(c, mk)).join('\n')}`,
  ].join('\n\n');
  // zzz1187 — STEP 1: a reasoning research pass (tool calls to GPT-6 run without reasoning), then STEP 2 fills the form
  const research = async (mk: CandMarket, base: string): Promise<string> => {
    try {
      const resp = await m.anthropicMessages('hundred-baggers', {
        model: modelId, max_tokens: 12000, system: HB_SYSTEM,
        messages: [{ role: 'user', content: `${base}\n\nRESEARCH STEP (plain text, no form yet). Go through the WHOLE shortlist like a long-term owner-investor:\n1. Drop at once: businesses that cannot plausibly be 100x bigger (small market, commodity, cyclical peak, one government scheme, one customer), weak governance you know of, and figures that look like an acquisition or one-off.\n2. For the survivors: what would have to be true for 100x in 15–20 years — market size, reinvestment runway, moat that widens with scale, founder / owner-operator, capital allocation record? Use your knowledge of the business, not only the figures.\n3. End with the 10 best, strongest first, each with the one fact that makes it a candidate and the one fact that most threatens it.\nShort lines, tickers, figures with their period. No filler.` }],
      }, aiOpts('high'));
      const j: any = await resp.json().catch(() => null);
      if (!resp.ok) return '';
      return String((j?.content || []).filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('\n')).slice(0, 24_000);
    } catch { return ''; }
  };
  const callFor = async (mk: CandMarket) => {
    const base = baseFor(mk);
    const notes = await research(mk, base);
    const tool = hbToolFor(mk);
    const content = notes ? `${base}\n\nYOUR RESEARCH NOTES (from the step before — check each against the shortlist figures; choose only shortlist companies):\n${notes}` : base;
    const resp = await m.anthropicMessages('hundred-baggers', {
      model: modelId, max_tokens: 16000, system: HB_SYSTEM,
      tools: [tool], tool_choice: { type: 'tool', name: tool.name }, messages: [{ role: 'user', content }],
    }, aiOpts('low'));
    const j: any = await resp.json().catch(() => null);
    if (!resp.ok) throw new Error(String(j?.error?.message || `AI call failed (HTTP ${resp.status})`).slice(0, 300));
    const d = (j?.content || []).find((c: any) => c?.type === 'tool_use')?.input;
    const g = cleanHb(d, shortlist, [mk])?.[0];
    if (!g) throw new Error('The AI answer was incomplete — try again.');
    return { g, model: j?.model as string | undefined, research: !!notes };
  };
  try {
    const res = await Promise.allSettled([callFor('US'), callFor('IN')]);
    const ok = res.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    if (!ok.length) return { ok: false, error: String((res[0] as PromiseRejectedResult).reason?.message || 'AI call failed').slice(0, 300) };
    const markets = (['US', 'IN'] as CandMarket[]).map((mk, i) => {
      const r = res[i];
      if (r.status === 'fulfilled') return r.value.g;
      return prev?.markets.find((g) => g.market === mk) || { market: mk, picks: [], note: 'The AI call for this market failed — click Update with AI again.' };
    });
    const report: HbReport = { markets, generatedAt: new Date().toISOString(), model: ok[0].model ?? (strong || cheap), shortlist: { US: shortlist.US.length, IN: shortlist.IN.length } };
    if (prev) await kvSet(HB_PREV, prev, TTL).catch(() => undefined);
    await kvSet(HB_KEY, report, TTL);
    return { ok: true, report };
  } catch (e: any) {
    return { ok: false, error: `AI call failed: ${String(e?.message || e).slice(0, 200)}` };
  }
}

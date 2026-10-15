// zzz1051 — DOCUMENT SEARCH reranker (optional, off by default). The cheap model scores the top ≤ 30 fused passages
// 0–3 for "does this passage answer the question?" with a forced, strict JSON tool answer. Passages are untrusted company
// text, so each one is wrapped with lib/ai-fence (the meter adds the untrusted-data rule to the system prompt).
// Its own small daily ceiling: SEARCH_RERANK_DAILY_USD (default $0.05; 0 switches it off).
import { fenceDoc, makeNonce } from '../ai-fence';
import { capAllows } from './rank';
import { addSpend, rerankDailyCapUsd, spentToday, type SearchHit } from './store';

const SYSTEM = `You rank passages from company documents (earnings-call transcripts, investor presentations, results releases) for an investor's question.
For each passage give a score:
3 = directly answers the question with specifics (the company says it, with numbers or a clear statement),
2 = clearly about the question but vague or partial,
1 = mentions the topic in passing,
0 = not about the question.
Judge only by the passage text. Return a score for every passage index you are given, through the file_scores tool.`;

const TOOL = {
  name: 'file_scores',
  description: 'File one relevance score per passage.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      scores: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          properties: { i: { type: 'integer', minimum: 0, maximum: 49 }, score: { type: 'integer', enum: [0, 1, 2, 3] } },
          required: ['i', 'score'],
        },
      },
    },
    required: ['scores'],
  },
};

/** Pure: apply model scores (index → 0..3) to hits; unscored hits count as 0. Order: score desc, then the fused order. */
export function applyScores<T extends { id: number }>(hits: readonly T[], raw: unknown): Array<T & { rerankScore: number }> | null {
  const arr = Array.isArray((raw as any)?.scores) ? (raw as any).scores : null;
  if (!arr) return null;
  const by = new Map<number, number>();
  for (const s of arr) {
    const i = Number(s?.i), sc = Number(s?.score);
    if (Number.isInteger(i) && i >= 0 && i < hits.length && [0, 1, 2, 3].includes(sc) && !by.has(i)) by.set(i, sc);
  }
  if (by.size < Math.ceil(hits.length / 2)) return null;   // a half-empty answer is not a ranking
  return hits.map((h, i) => ({ ...h, rerankScore: by.get(i) ?? 0, _i: i }))
    .sort((a, b) => b.rerankScore - a.rerankScore || a._i - b._i)
    .map(({ _i, ...h }) => h as T & { rerankScore: number });
}

export async function rerankHits(q: string, hits: SearchHit[]): Promise<{ used: boolean; hits: SearchHit[]; usd: number; why?: string }> {
  const passages = hits.slice(0, 30);
  const { modelConfigured, anthropicMessages, costOf, activeModel } = await import('../anthropic-meter');
  if (!modelConfigured()) return { used: false, hits, usd: 0, why: 'no AI key configured' };
  const chars = passages.reduce((n, h) => n + Math.min(1600, h.text.length), 0);
  const estimate = costOf(activeModel('claude-haiku-4-5'), { input_tokens: Math.ceil(chars / 4) + 600, output_tokens: 3000 });
  const gate = capAllows(await spentToday('rerank'), rerankDailyCapUsd(), estimate);
  if (!gate.allowed) return { used: false, hits, usd: 0, why: `reranker ${gate.reason}` };
  const nonce = makeNonce();
  const body = passages.map((h, i) => `Passage ${i} — ${h.company || h.ticker || ''}, ${h.kind || ''}, ${h.filedAt || ''}:\n${fenceDoc(h.text.slice(0, 1600), nonce)}`).join('\n\n');
  let resp: Response;
  try {
    resp = await anthropicMessages('doc-search-rerank', {
      model: 'claude-haiku-4-5',
      max_tokens: 900,
      system: SYSTEM,
      messages: [{ role: 'user', content: `Question: ${q.slice(0, 300)}\n\n${body}` }],
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'file_scores' },
    }, { signal: AbortSignal.timeout(60_000) });
  } catch (e: any) { return { used: false, hits, usd: 0, why: `model call failed (${String(e?.message || e).slice(0, 80)})` }; }
  const j: any = await resp.json().catch(() => null);
  const usd = resp.ok ? costOf(activeModel('claude-haiku-4-5'), j?.usage) : 0;
  if (usd > 0) await addSpend('rerank', usd, Number(j?.usage?.input_tokens || 0) + Number(j?.usage?.output_tokens || 0));
  if (!resp.ok) return { used: false, hits, usd, why: `model answered HTTP ${resp.status}${j?.error?.message ? `: ${String(j.error.message).slice(0, 120)}` : ''}` };
  const tool = (j?.content || []).find((b: any) => b?.type === 'tool_use' && b?.name === 'file_scores');
  const ranked = applyScores(passages, tool?.input);
  if (!ranked) return { used: false, hits, usd, why: 'the model did not score enough passages' };
  return { used: true, hits: [...ranked, ...hits.slice(30)], usd };
}

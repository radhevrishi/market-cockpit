// zzz1051 — runs the document-search evaluation against the live index (server only). Pure scoring lives in ./eval.
import labelsFile from './eval-labels.json';
import { evalQuery, summarise, validLabels, type EvalLabel, type EvalSummary, type ModeRun } from './eval';
import { searchDocs } from './store';
import type { SearchFilters } from './rank';

export const fileLabels = (): EvalLabel[] => validLabels(labelsFile);

/** keyword-only, hybrid, and (only when asked — it costs) hybrid + rerank, for each label; ≤ 20 queries. */
export async function runEval(opts: { labels?: EvalLabel[]; rerank?: boolean; filters?: SearchFilters } = {}): Promise<EvalSummary & { labelsFrom: string; modes: string[] }> {
  const labels = (opts.labels && opts.labels.length ? opts.labels : fileLabels()).slice(0, 20);
  const f = opts.filters || {};
  const per = [];
  const modes = ['keyword', 'hybrid', ...(opts.rerank ? ['hybrid+rerank'] : [])];
  for (const l of labels) {
    const runs: ModeRun[] = [];
    const kw = await searchDocs(l.q, f, { meaning: false, limit: 40 });
    runs.push({ mode: 'keyword', ranked: kw.results.map((h) => ({ id: h.id, ticker: h.ticker, text: h.text })) });
    const hy = await searchDocs(l.q, f, { limit: 40 });
    runs.push({ mode: 'hybrid', ranked: hy.results.map((h) => ({ id: h.id, ticker: h.ticker, text: h.text })) });
    if (opts.rerank) {
      const rr = await searchDocs(l.q, f, { limit: 40, rerank: true });
      runs.push({ mode: 'hybrid+rerank', ranked: rr.results.map((h) => ({ id: h.id, ticker: h.ticker, text: h.text })), usd: rr.rerank?.usd || 0 });
    }
    per.push(evalQuery(l, runs));
  }
  return { ...summarise(per), labelsFrom: opts.labels?.length ? 'request body' : 'lib/doc-search/eval-labels.json (draft, phrase-judged)', modes };
}

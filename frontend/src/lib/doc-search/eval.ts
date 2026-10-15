// zzz1051 — DOCUMENT SEARCH evaluation: does each mode find the right passages, and does the reranker earn its cost?
//
// Labels (doc-search/eval-labels.json, or a JSON body the owner posts) say what a relevant passage for a query looks like:
//   { "q": "…", "phrases": ["margin expansion", "expand (?:our )?margins"], "tickers": ["ABC"] }
// A passage is relevant when its text matches any phrase (case-insensitive regex) — or, when tickers are given, it belongs
// to one of them AND matches a phrase (tickers alone never make a passage relevant: every passage of a company is not an answer).
// Recall@k uses the POOLED relevant set: every relevant passage any mode returned in its top `poolDepth` (the standard way
// to judge several systems without labelling the whole index). MRR = 1 / rank of the first relevant passage.
// Pure: tested in zzz1051-doc-search.test.ts.

export interface EvalLabel { q: string; phrases: string[]; tickers?: string[]; note?: string }
export interface EvalPassage { id: number; ticker: string | null; text: string }

export function compileLabel(l: EvalLabel): (p: EvalPassage) => boolean {
  const res = (l.phrases || []).map((s) => { try { return new RegExp(s, 'i'); } catch { return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); } });
  const tk = new Set((l.tickers || []).map((t) => t.toUpperCase()));
  return (p) => {
    if (tk.size && !tk.has(String(p.ticker || '').toUpperCase())) return false;
    return res.some((r) => r.test(p.text));
  };
}

export function recallAtK(ranked: readonly number[], relevant: ReadonlySet<number>, k = 10): number {
  if (!relevant.size) return 0;
  let hit = 0;
  for (const id of ranked.slice(0, k)) if (relevant.has(id)) hit++;
  return hit / relevant.size;
}
export function reciprocalRank(ranked: readonly number[], relevant: ReadonlySet<number>): number {
  for (let i = 0; i < ranked.length; i++) if (relevant.has(ranked[i])) return 1 / (i + 1);
  return 0;
}
export function precisionAtK(ranked: readonly number[], relevant: ReadonlySet<number>, k = 10): number {
  const top = ranked.slice(0, k);
  if (!top.length) return 0;
  return top.filter((id) => relevant.has(id)).length / top.length;
}

export interface ModeRun { mode: string; ranked: EvalPassage[]; usd?: number }
export interface QueryEval { q: string; pooledRelevant: number; byMode: Record<string, { recall10: number; mrr: number; p10: number; usd: number }> }
export interface EvalSummary { queries: number; judged: number; byMode: Record<string, { recall10: number; mrr: number; p10: number; usd: number }>; perQuery: QueryEval[] }

/** Score one query's runs (one per mode) against its label, pooling relevance over every mode's top `poolDepth`. */
export function evalQuery(label: EvalLabel, runs: readonly ModeRun[], poolDepth = 30, k = 10): QueryEval {
  const isRel = compileLabel(label);
  const pool = new Set<number>();
  for (const r of runs) for (const p of r.ranked.slice(0, poolDepth)) if (isRel(p)) pool.add(p.id);
  const byMode: QueryEval['byMode'] = {};
  for (const r of runs) {
    const ids = r.ranked.map((p) => p.id);
    byMode[r.mode] = { recall10: recallAtK(ids, pool, k), mrr: reciprocalRank(ids, pool), p10: precisionAtK(ids, pool, k), usd: r.usd || 0 };
  }
  return { q: label.q, pooledRelevant: pool.size, byMode };
}

/** Average per mode over the queries that have at least one relevant passage in the pool (a query nobody can answer is not judged). */
export function summarise(per: readonly QueryEval[]): EvalSummary {
  const judged = per.filter((x) => x.pooledRelevant > 0);
  const modes = new Set<string>();
  for (const x of per) for (const m of Object.keys(x.byMode)) modes.add(m);
  const byMode: EvalSummary['byMode'] = {};
  for (const m of modes) {
    const xs = judged.map((x) => x.byMode[m]).filter(Boolean);
    const avg = (f: (v: { recall10: number; mrr: number; p10: number }) => number) => (xs.length ? xs.reduce((n, v) => n + f(v), 0) / xs.length : 0);
    byMode[m] = { recall10: round3(avg((v) => v.recall10)), mrr: round3(avg((v) => v.mrr)), p10: round3(avg((v) => v.p10)), usd: per.reduce((n, x) => n + (x.byMode[m]?.usd || 0), 0) };
  }
  return { queries: per.length, judged: judged.length, byMode, perQuery: per.slice() };
}
const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** Validates a label list (from the file or a posted body). Bad entries are dropped. */
export function validLabels(raw: unknown): EvalLabel[] {
  const arr = Array.isArray(raw) ? raw : Array.isArray((raw as any)?.labels) ? (raw as any).labels : [];
  const out: EvalLabel[] = [];
  for (const x of arr) {
    if (!x || typeof x.q !== 'string' || !x.q.trim() || x.q.length > 300) continue;
    const phrases = Array.isArray(x.phrases) ? x.phrases.filter((s: unknown) => typeof s === 'string' && s.length > 0 && s.length <= 200).slice(0, 12) : [];
    if (!phrases.length) continue;
    const tickers = Array.isArray(x.tickers) ? x.tickers.filter((s: unknown) => typeof s === 'string' && /^[A-Z0-9&.\-_]{1,24}$/i.test(s)).slice(0, 50) : undefined;
    out.push({ q: x.q.trim(), phrases, ...(tickers?.length ? { tickers } : {}), ...(typeof x.note === 'string' ? { note: x.note.slice(0, 200) } : {}) });
    if (out.length >= 50) break;
  }
  return out;
}

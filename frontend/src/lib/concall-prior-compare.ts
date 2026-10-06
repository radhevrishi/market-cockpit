// zzz904 — Concall "vs previous call", done honestly.
//
// The concall analyser keeps no server-side history; each analysis is stored in the browser corpus
// (localStorage 'mc:concall-corpus:v1', last 25 analyses, keyed by an input hash, each with its ticker and timestamp).
// When the same company has an EARLIER analysed call on file, this compares the two: overall tone score, the wording of
// the guidance sentences (scored with the wording ledger's fixed word list — no AI), guidance raises / cuts, numbers
// management mentioned in both calls, red flags and themes. When there is no earlier call, it says so plainly instead of
// implying a comparison. Pure, no I/O.
import { toneOf } from './thesis/wording-ledger';

export interface ConcallAnalysisLike {
  ticker?: string;
  length?: number;
  tone?: { score: number; pos?: number; neg?: number; defensive?: number; label?: string };
  guidance?: Array<{ kind: string; pct: string | null; snippet: string }>;
  numbers?: Array<{ metric: string; value: string; snippet?: string }>;
  themes?: Array<{ theme: string; mentions: number }>;
  red_flags?: string[];
  generated_at?: string;
}
export interface CorpusEntry { result: ConcallAnalysisLike; ticker: string; ts: number }
export type ConcallCorpus = Record<string, CorpusEntry>;

export const NO_PRIOR_MESSAGE = 'No earlier call on file — comparison starts with the next call';
export const NO_TICKER_MESSAGE = 'No ticker given — add the ticker so the next call can be compared with this one';

export type PriorComparison =
  | { status: 'NO_PRIOR' | 'NO_TICKER'; message: string }
  | { status: 'COMPARED'; priorDate: string; heading: string; lines: string[] };

const normTicker = (t: string | undefined | null) => String(t || '').trim().toUpperCase().replace(/^(NSE|BSE):/, '');
const entryTime = (e: CorpusEntry) => {
  const g = Date.parse(e.result?.generated_at || '');
  return isNaN(g) ? (e.ts || 0) : g;
};

/** Most recent analysis of the same ticker that is strictly earlier than the current one (and not the same call). */
export function findPriorCall(corpus: ConcallCorpus | null | undefined, current: ConcallAnalysisLike, currentKey?: string | null): CorpusEntry | null {
  const t = normTicker(current.ticker);
  if (!t || !corpus) return null;
  const curTime = Date.parse(current.generated_at || '');
  let best: CorpusEntry | null = null;
  for (const [k, e] of Object.entries(corpus)) {
    if (!e || !e.result || (currentKey && k === currentKey)) continue;
    if (normTicker(e.ticker || e.result.ticker) !== t) continue;
    if (!isNaN(curTime) && entryTime(e) >= curTime) continue;
    // the same transcript analysed twice (e.g. pasted once, PDF once) is not an earlier call
    if (e.result.length && current.length && e.result.length === current.length && e.result.tone?.score === current.tone?.score) continue;
    if (!best || entryTime(e) > entryTime(best)) best = e;
  }
  return best;
}

function avgTone(snips: string[]): { tone: number | null; hedges: string[] } {
  if (!snips.length) return { tone: null, hedges: [] };
  const r = snips.map((s) => toneOf(s));
  return { tone: Math.round((r.reduce((a, x) => a + x.tone, 0) / r.length) * 100) / 100, hedges: Array.from(new Set(r.flatMap((x) => x.hedges))) };
}

const firstNumberByMetric = (nums: ConcallAnalysisLike['numbers']) => {
  const m = new Map<string, string>();
  for (const n of nums || []) { const k = String(n.metric || '').toLowerCase(); if (k && !m.has(k)) m.set(k, String(n.value)); }
  return m;
};

const fmtDate = (ms: number) => (isNaN(ms) || !ms ? 'date unknown' : new Date(ms).toISOString().slice(0, 10));

/** Builds the "vs previous call" lines, or the honest no-prior message. */
export function comparePriorCall(current: ConcallAnalysisLike, corpus: ConcallCorpus | null | undefined, currentKey?: string | null): PriorComparison {
  if (!normTicker(current.ticker)) return { status: 'NO_TICKER', message: NO_TICKER_MESSAGE };
  const prior = findPriorCall(corpus, current, currentKey);
  if (!prior) return { status: 'NO_PRIOR', message: NO_PRIOR_MESSAGE };
  const p = prior.result;
  const priorDate = fmtDate(entryTime(prior));
  const lines: string[] = [];

  // 1. Overall tone score (lexicon). The analyser itself says ±5 is noise, ±15 is a real shift.
  if (current.tone && p.tone) {
    const d = current.tone.score - p.tone.score;
    const word = d >= 15 ? 'warmer' : d <= -15 ? 'cooler' : 'about the same (within ±15, treat as noise)';
    lines.push(`Tone score ${p.tone.score} → ${current.tone.score} (${d >= 0 ? '+' : ''}${d}) — ${word}`);
    if (typeof p.tone.defensive === 'number' && typeof current.tone.defensive === 'number' && current.tone.defensive !== p.tone.defensive) {
      lines.push(`Defensive phrases ${p.tone.defensive} → ${current.tone.defensive}`);
    }
  }

  // 2. Guidance wording, scored with the wording ledger's word list.
  const g0 = avgTone((p.guidance || []).map((g) => g.snippet));
  const g1 = avgTone((current.guidance || []).map((g) => g.snippet));
  if (g0.tone !== null && g1.tone !== null) {
    const d = g1.tone - g0.tone;
    const word = d >= 0.5 ? 'warmer' : d <= -0.5 ? 'cooler' : 'unchanged';
    lines.push(`Guidance wording ${word} (tone ${g0.tone.toFixed(2)} → ${g1.tone.toFixed(2)} on a −2…+2 scale)`);
    const newHedges = g1.hedges.filter((h) => !g0.hedges.includes(h));
    if (newHedges.length) lines.push(`New hedge words in guidance: "${newHedges.slice(0, 4).join('", "')}"`);
  } else if (g0.tone !== null && g1.tone === null) {
    lines.push(`Guidance: the earlier call had ${(p.guidance || []).length} guidance line(s); none found in this call`);
  } else if (g0.tone === null && g1.tone !== null) {
    lines.push(`Guidance: ${(current.guidance || []).length} guidance line(s) this call; none found in the earlier call`);
  }
  const count = (a: ConcallAnalysisLike, k: string) => (a.guidance || []).filter((g) => g.kind === k).length;
  for (const [k, lab] of [['raise', 'raised'], ['cut', 'cut'], ['withdraw', 'withdrawn']] as const) {
    const a = count(p, k), b = count(current, k);
    if (a !== b) lines.push(`Guidance ${lab}: ${a} → ${b} mention(s)`);
  }

  // 3. Numbers management mentioned in both calls (first mention per metric).
  const n0 = firstNumberByMetric(p.numbers), n1 = firstNumberByMetric(current.numbers);
  const shared: string[] = [];
  for (const [k, v1] of n1) { const v0 = n0.get(k); if (v0 !== undefined && v0 !== v1) shared.push(`${k} ${v0} → ${v1}`); }
  if (shared.length) lines.push(`Numbers mentioned in both calls: ${shared.slice(0, 5).join('; ')}`);

  // 4. Red flags and themes that appeared / dropped away.
  const f0 = new Set(p.red_flags || []), f1 = new Set(current.red_flags || []);
  const newFlags = [...f1].filter((x) => !f0.has(x)), goneFlags = [...f0].filter((x) => !f1.has(x));
  if (newFlags.length) lines.push(`New red flags: ${newFlags.join(', ')}`);
  if (goneFlags.length) lines.push(`Red flags no longer present: ${goneFlags.join(', ')}`);
  const t0 = new Set((p.themes || []).map((t) => t.theme)), t1 = new Set((current.themes || []).map((t) => t.theme));
  const newThemes = [...t1].filter((x) => !t0.has(x)), goneThemes = [...t0].filter((x) => !t1.has(x));
  if (newThemes.length) lines.push(`New themes: ${newThemes.join(', ')}`);
  if (goneThemes.length) lines.push(`Themes no longer discussed: ${goneThemes.join(', ')}`);

  if (!lines.length) lines.push('No measurable change from the earlier call');
  return { status: 'COMPARED', priorDate, heading: `vs previous call (analysed ${priorDate})`, lines };
}

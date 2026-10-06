// zzz883 — AI EVALUATION for the guidance extractor: a fixed, hand-checked golden set, scored with precision / recall /
// false positives / cost. Run on demand and weekly (.github/workflows/ai-eval.yml) — and always after a prompt or model change
// (the prompt version is part of the result, so a drop can be traced to the change that caused it).
//
// Each case is a short passage written from REAL company statements seen in Market Cockpit (Oct 2026), with what a correct
// extractor must file. Negative cases (industry figures, reported results, analyst questions, a segment) must file NOTHING
// for the company. The scoring is pure and unit-tested; only `runGuidanceEval` calls the model.
import type { ExtractedGuidance, GuidanceDoc } from './guidance-docs-types';

export type EvalFamily = 'REVENUE' | 'EBITDA' | 'PROFIT' | 'MARGIN';
export interface EvalExpect { family: EvalFamily; period: string; growth: boolean; low: number; high: number }
export interface EvalCase { id: string; company: string; market: 'IN' | 'US'; text: string; expect: EvalExpect[]; note: string }

// a neutral preamble so every passage clears the extractor's 200-character minimum (it carries no numbers)
const PRE = 'This is an extract from the company\'s quarterly results discussion, held with management, investors and analysts. Forward-looking statements are subject to risks and uncertainties.';
const T = (lines: string[]) => [PRE, ...lines].join('\n');
export const GUIDANCE_GOLDEN: readonly EvalCase[] = [
  { id: 'cpplus-growth', company: 'Aditya Infotech Limited', market: 'IN', note: 'explicit growth range',
    text: T(['Investor presentation, August 2026.', 'Estimated Revenue growth in FY27 — YoY growth: 40-50%.', 'Q1 FY27 revenue was ₹1,020 crore.']),
    expect: [{ family: 'REVENUE', period: 'FY27', growth: true, low: 40, high: 50 }] },
  { id: 'yasho-target', company: 'Yasho Industries Limited', market: 'IN', note: 'absolute revenue target, raised',
    text: T(['Management: We have revised our FY28 revenue target to ₹1,600 crore, from ₹1,500 crore earlier, on the back of the new Pakhajan plant.']),
    expect: [{ family: 'REVENUE', period: 'FY28', growth: false, low: 1600, high: 1600 }] },
  { id: 'mtar-growth', company: 'Mtar Technologies Limited', market: 'IN', note: 'reiterated growth + margin',
    text: T(['CEO: I would like to reiterate our confidence in achieving the guidance given earlier at 80% revenue growth for the current fiscal year FY27, with an EBITDA margin of 24% plus-minus 100 basis points.']),
    expect: [{ family: 'REVENUE', period: 'FY27', growth: true, low: 80, high: 80 }, { family: 'MARGIN', period: 'FY27', growth: false, low: 23, high: 25 }] },
  { id: 'srm-turnover', company: 'SRM Contractors Limited', market: 'IN', note: 'consolidated turnover range',
    text: T(['Management: Yes, this year our consolidated turnover should be between INR 1,500 crores to INR 1,750 crore for FY27.']),
    expect: [{ family: 'REVENUE', period: 'FY27', growth: false, low: 1500, high: 1750 }] },
  { id: 'pwl-two-metrics', company: 'Physicswallah Limited', market: 'IN', note: 'two metrics in one sentence',
    text: T(['CFO: To add on here, the annual guidance for FY27 was 30% revenue improvement and 100% EBITDA improvement, and that remains the same.']),
    expect: [{ family: 'REVENUE', period: 'FY27', growth: true, low: 30, high: 30 }, { family: 'EBITDA', period: 'FY27', growth: true, low: 100, high: 100 }] },
  { id: 'jana-pat', company: 'Jana Small Finance Bank Limited', market: 'IN', note: 'profit growth',
    text: T(['MD: We are committed and confident of delivering guidance of 20%+ growth in GLP and liabilities with 80% growth in PAT for FY27.']),
    expect: [{ family: 'PROFIT', period: 'FY27', growth: true, low: 80, high: 80 }] },
  { id: 'us-raise', company: 'Rubrik, Inc.', market: 'US', note: 'US release, revenue range raised',
    text: T(['For fiscal year 2027, Rubrik now expects revenue of $1.685 billion to $1.693 billion, up from the prior outlook of $1.638 billion to $1.648 billion.']),
    expect: [{ family: 'REVENUE', period: 'FY27', growth: false, low: 1685, high: 1693 }] },
  // ── negatives: nothing may be filed for the company ──
  { id: 'neg-industry', company: 'ACC Limited', market: 'IN', note: 'industry demand is not company guidance',
    text: T(['Cement demand in India is expected to remain soft at about 5% for FY27, according to industry estimates.']), expect: [] },
  { id: 'neg-reported', company: 'Kissht', market: 'IN', note: 'a reported quarter is not guidance',
    text: T(['Q1 FY27 highlights: AUM expanded 61% YoY and 13% QoQ to ₹8,001 Cr, driven by continued portfolio expansion. Profit after tax was ₹112 Cr.']), expect: [] },
  { id: 'neg-analyst', company: 'Example Tech Limited', market: 'IN', note: 'an analyst\'s number is not guidance',
    text: T(['Analyst: Can you do 40% revenue growth in FY27?', 'Management: We do not give guidance; we will let the numbers speak.']), expect: [] },
];

const familyOf = (r: ExtractedGuidance): EvalFamily | null => {
  const m = String(r.metric || '').toUpperCase();
  if (/MARGIN/.test(m)) return 'MARGIN';
  if (/EBITDA/.test(m)) return 'EBITDA';
  if (/PROFIT|PAT|NET_INCOME|EARNINGS/.test(m)) return 'PROFIT';
  if (/REVENUE|SALES|TURNOVER/.test(m)) return 'REVENUE';
  return null;
};
const isGrowth = (r: ExtractedGuidance) => /GROWTH/i.test(String(r.metric)) || (r.unit === '%' && !/MARGIN/i.test(String(r.metric))) || r.growthPctLow != null;
const close = (a: number | null | undefined, b: number) => a != null && Math.abs(a - b) <= Math.max(0.6, Math.abs(b) * 0.01);
/** Scale-free match: ₹1,600 crore may be filed as 1600 (crore) or 16000 (million); $1.685bn as 1.685 (billion) or 1685 (million). */
const closeScaled = (a: number | null | undefined, b: number) => a != null && [1, 1000, 0.001, 10, 0.1].some((k) => close(a * k, b));

export function matchRow(r: ExtractedGuidance, e: EvalExpect): boolean {
  if (familyOf(r) !== e.family || String(r.period || '').toUpperCase().replace(/\s/g, '') !== e.period) return false;
  if (e.growth) {
    const lo = r.growthPctLow ?? (isGrowth(r) ? r.low : null), hi = r.growthPctHigh ?? (isGrowth(r) ? r.high : null);
    return close(lo, e.low) && close(hi ?? lo, e.high);
  }
  if (e.family === 'MARGIN') return close(r.low, e.low) && close(r.high ?? r.low, e.high);
  return !isGrowth(r) && closeScaled(r.low, e.low) && closeScaled(r.high ?? r.low, e.high);
}

export interface CaseScore { id: string; expected: number; found: number; truePos: number; falsePos: number; falseNeg: number; rows: number; costUsd: number; ms: number; status: string }
export interface EvalScore { cases: CaseScore[]; precision: number | null; recall: number | null; falsePositiveRate: number | null; costUsd: number; avgMs: number; promptVersion: string | null; model: string | null; at: string }

/** Pure: score one case's filed rows. A filed row that matches nothing expected is a false positive. */
export function scoreCase(c: EvalCase, rows: ExtractedGuidance[]): Omit<CaseScore, 'costUsd' | 'ms' | 'status'> {
  const used = new Set<number>(); let tp = 0;
  for (const e of c.expect) {
    const i = rows.findIndex((r, k) => !used.has(k) && matchRow(r, e));
    if (i >= 0) { used.add(i); tp++; }
  }
  // extra rows about OTHER metrics the case does not test are not counted against precision (e.g. a GLP growth row for Jana)
  const fp = rows.filter((r, k) => !used.has(k) && (c.expect.length === 0 || c.expect.some((e) => e.family === familyOf(r)))).length;
  return { id: c.id, expected: c.expect.length, found: rows.length, truePos: tp, falsePos: fp, falseNeg: c.expect.length - tp, rows: rows.length };
}

export function summarise(cases: CaseScore[], meta: { promptVersion: string | null; model: string | null; at: string }): EvalScore {
  const tp = cases.reduce((a, c) => a + c.truePos, 0), fp = cases.reduce((a, c) => a + c.falsePos, 0), fn = cases.reduce((a, c) => a + c.falseNeg, 0);
  const negs = cases.filter((c) => c.expected === 0);
  return {
    cases, precision: tp + fp ? Math.round((tp / (tp + fp)) * 1000) / 1000 : null, recall: tp + fn ? Math.round((tp / (tp + fn)) * 1000) / 1000 : null,
    falsePositiveRate: negs.length ? Math.round((negs.filter((c) => c.falsePos > 0).length / negs.length) * 1000) / 1000 : null,
    costUsd: Math.round(cases.reduce((a, c) => a + c.costUsd, 0) * 10000) / 10000, avgMs: cases.length ? Math.round(cases.reduce((a, c) => a + c.ms, 0) / cases.length) : 0,
    ...meta,
  };
}

/** Runs the golden set through the REAL extractor (paid: about $0.003 per case). */
export async function runGuidanceEval(): Promise<EvalScore> {
  const x = await import('./ai-guidance-extract');
  const out: CaseScore[] = []; let model: string | null = null;
  const deps = { callModel: x.realCallModel, availability: x.realAvailability, now: () => new Date(), nonce: () => Math.random().toString(36).slice(2, 10), selectPassages: (t: string) => t } as any;
  for (const c of GUIDANCE_GOLDEN) {
    const doc: GuidanceDoc = { docId: `eval-${c.id}`, market: c.market, ticker: null, company: c.company, kind: 'TRANSCRIPT' as any, title: `${c.company} — evaluation passage`, url: 'https://eval.invalid/', sourceHost: 'eval', filedAt: '2026-08-15', collectedAt: '2026-08-15T00:00:00Z', collector: 'ai-eval', textChars: c.text.length, text: c.text };
    const t0 = Date.now();
    const r = await x.extractDoc(doc, deps, { timeoutMs: 45_000 }).catch((e: any) => ({ status: 'error', rows: [], costUsd: 0, note: String(e?.message || e) } as any));
    model = r.model || model;
    out.push({ ...scoreCase(c, r.rows || []), costUsd: Number(r.costUsd || 0), ms: Date.now() - t0, status: r.status });
    if (r.stop === 'cap' || r.stop === 'unavailable') break;
  }
  return summarise(out, { promptVersion: x.EXTRACT_PROMPT_VERSION, model, at: new Date().toISOString() });
}

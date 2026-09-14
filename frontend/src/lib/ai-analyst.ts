// ═══════════════════════════════════════════════════════════════════════════
// THE AI ANALYST  (zzz611)
//
// "Machines calculate. AI interprets. You decide."
//
// That sentence is the architecture, not a slogan, and this file is where the
// line is drawn and enforced.
//
// WHAT THE MODEL IS GIVEN
//   Only figures this portal has already computed from SEC filings — revenue,
//   EPS, margins, cash conversion, the last eight quarters of each, guidance,
//   the one-offs the engine found, the price reaction — plus the company's own
//   press-release text. Every number arrives PRE-COMPUTED and labelled.
//
// WHAT THE MODEL IS FORBIDDEN TO DO
//   Arithmetic. It may not derive a growth rate, annualise anything, or quote a
//   figure that is not in the material it was handed. It is not being asked what
//   the numbers ARE — the engine knows that, exactly, from XBRL. It is being
//   asked the things a spreadsheet cannot encode: is this change structural or
//   is it a comp, a one-off or a cycle; why would the market re-rate this NOW;
//   and what is the strongest argument that the whole thesis is wrong.
//
// WHY STRUCTURED OUTPUT
//   Prose cannot be ranked, stored, diffed across quarters or measured against
//   an outcome. Every answer is a fixed JSON schema, validated here, and an
//   answer that does not validate is DISCARDED rather than shown — a
//   half-parsed assessment is worse than none, because it looks like the real
//   thing. Note the limit honestly: a schema guarantees the SHAPE of an answer,
//   never its truth. That is why the bear case is mandatory and why every
//   assessment is written to the prediction ledger to be marked later.
//
// IMMUTABILITY
//   A filed quarter never changes, so an assessment is keyed to the accession
//   number and kept for a year. The same company re-read a hundred times costs
//   one call. That is also what makes the ledger honest: the assessment scored
//   six months from now is byte-for-byte the one that was made today.
// ═══════════════════════════════════════════════════════════════════════════

import { kvGet, kvSet } from './kv';

export const AI_ANALYST_VERSION = 'ai-analyst-v1';
const MODEL = 'claude-haiku-4-5-20251001';
const TTL_S = 365 * 24 * 3600;

// ─── the schema the model must fill ────────────────────────────────────────

/** His classification, kept verbatim: noise / cyclical / structural. */
export type ChangeType = 'NOISE' | 'CYCLICAL' | 'STRUCTURAL';

export interface AiAssessment {
  ticker: string;
  accession: string | null;
  /** 0 = nothing changed … 5 = possible business-model transformation. */
  change_level: 0 | 1 | 2 | 3 | 4 | 5;
  change_type: ChangeType;
  structural_score: number;          // 0-100
  /** What specifically changed in the economics — each item must be evidenced. */
  structural_drivers: string[];
  /** The reasons this print might be less than it looks. */
  temporary_factors: string[];
  why_now_score: number;             // 0-100
  why_now: string[];                 // ranked, most decisive first
  /** The strongest case AGAINST, and it must carry a number from the material. */
  bear_case: string;
  bear_severity: number;             // 0-100, higher = more damaging if right
  key_risks: string[];
  /** What would have to happen for this read to be wrong — stated as a test. */
  invalidation: string[];
  thesis: string;
  confidence: number;                // 0-100, the model's own
  /** Anything it was asked for and could not support from the material. */
  not_established: string[];
  _v: string;
  _at: string;
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const clamp100 = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
};
const strList = (v: unknown, max = 6): string[] =>
  Array.isArray(v) ? v.filter(isStr).map((s) => s.trim()).slice(0, max) : [];

/**
 * Validate one model answer into an assessment, or return null.
 *
 * Deliberately strict on the fields a RANKING depends on — the three scores and
 * the classification — because a missing score silently becomes a zero and a
 * zero silently re-orders the deck. Softer on the lists: an assessment with
 * four risks instead of five is still a usable assessment.
 */
export function validateAssessment(raw: any, ticker: string, accession: string | null): AiAssessment | null {
  if (!raw || typeof raw !== 'object') return null;
  const structural = clamp100(raw.structural_score);
  const whyNow = clamp100(raw.why_now_score);
  const bearSev = clamp100(raw.bear_severity);
  const conf = clamp100(raw.confidence);
  if (structural == null || whyNow == null || bearSev == null || conf == null) return null;

  const lvl = Number(raw.change_level);
  if (!Number.isInteger(lvl) || lvl < 0 || lvl > 5) return null;

  const ct = String(raw.change_type || '').toUpperCase();
  if (ct !== 'NOISE' && ct !== 'CYCLICAL' && ct !== 'STRUCTURAL') return null;

  // THE BEAR CASE IS NOT OPTIONAL. An assessment with no argument against it is
  // not an assessment, it is advocacy — and advocacy is precisely what this
  // layer exists to protect the reader from.
  if (!isStr(raw.bear_case) || raw.bear_case.trim().length < 40) return null;
  if (!isStr(raw.thesis)) return null;

  return {
    ticker: ticker.toUpperCase(),
    accession,
    change_level: lvl as AiAssessment['change_level'],
    change_type: ct as ChangeType,
    structural_score: structural,
    structural_drivers: strList(raw.structural_drivers),
    temporary_factors: strList(raw.temporary_factors),
    why_now_score: whyNow,
    why_now: strList(raw.why_now, 5),
    bear_case: raw.bear_case.trim(),
    bear_severity: bearSev,
    key_risks: strList(raw.key_risks, 5),
    invalidation: strList(raw.invalidation, 4),
    thesis: raw.thesis.trim(),
    confidence: conf,
    not_established: strList(raw.not_established, 5),
    _v: AI_ANALYST_VERSION,
    _at: new Date().toISOString(),
  };
}

// ─── the prompt ────────────────────────────────────────────────────────────

const SYSTEM = `You are the interpretation layer of a quantitative earnings engine used by one professional investor.

WHAT YOU ARE AND ARE NOT
The engine has ALREADY computed every financial figure directly from the company's SEC XBRL filings. Those figures are given to you. You are NOT being asked what the numbers are — that is settled and you cannot improve on it. You are being asked the four things arithmetic cannot settle:
  1. Is the change in this business structural, cyclical, or noise?
  2. Why would the market re-rate this company NOW rather than later?
  3. What is the strongest argument that this is a bad investment?
  4. What would have to happen for your read to be proven wrong?

ABSOLUTE RULES
- NEVER perform arithmetic. Do not compute, derive, annualise, extrapolate or infer any number. Quote only figures that appear in the material you were given, exactly as given, with the same units.
- NEVER use knowledge of this company from outside the material. No history, no competitors, no valuation multiples of peers, no market narrative, no recollection of past quarters beyond the quarterly series provided.
- If you cannot support a claim from the material, do not make it — list what you could not establish in "not_established" instead. An honest gap is worth more than a confident guess.
- Judge the CHANGE IN ECONOMICS, not the size of a percentage. Revenue +200% against a tiny base, a quarter helped by an acquisition, an easy comparison, a one-off gain, or a commodity swing is NOISE however large the number. Structural means the earning power of the business is different: capacity added, a new customer or product, share gained, pricing power, a mix shift that holds, a regulatory change, a cost base permanently reset.
- Guidance is what management SAYS WILL happen. Never treat it as achieved. A raised guide is evidence of confidence, not of results.
- The caveats supplied by the engine are findings from the filing, not opinions. Treat one-offs, weak cash conversion and adjusted-vs-GAAP gaps as material unless the release explains them away.
- The bear case must be the argument you would make if you were paid to be short, and it must cite at least one figure from the material. "Valuation is high" with no number is not a bear case.

SCORING DISCIPLINE
- structural_score: how much of this quarter's improvement should persist. Reserve above 80 for evidence of a permanently different business. A strong quarter with no structural evidence sits near 35, not 70.
- why_now_score: how much the market's expectations are likely to move in the near term — acceleration, guidance change, a catalyst with a date, price confirmation. A great company with nothing changing scores low. This is the score that separates a good business from a timely one.
- bear_severity: how much damage the bear case does IF IT IS RIGHT, independent of how likely you think it is.
- confidence: lower it when the material is thin, when cash flow is missing, when the release is preliminary, or when the quarterly series is short.

OUTPUT
Return ONE JSON object and nothing else — no prose, no markdown, no code fence. Keys exactly:
{"change_level":0-5,"change_type":"NOISE|CYCLICAL|STRUCTURAL","structural_score":0-100,"structural_drivers":["..."],"temporary_factors":["..."],"why_now_score":0-100,"why_now":["..."],"bear_case":"...","bear_severity":0-100,"key_risks":["..."],"invalidation":["..."],"thesis":"...","confidence":0-100,"not_established":["..."]}
Lists: 0-5 short, specific items each. thesis: 2 sentences maximum. bear_case: 2-3 sentences, with a figure.`;

/** Everything the model may see, all of it already computed by the engine. */
export interface AnalystInput {
  ticker: string;
  company: string;
  accession: string | null;
  quarter: string | null;
  sector: string | null;
  /** Pre-computed facts, rendered as labelled lines. Never raw JSON of the row:
   *  a labelled line is unambiguous about units and about what was measured. */
  facts: string[];
  /** The engine's own caveats — one-offs, cash divergence, optical EPS. */
  caveats: string[];
  /** Guidance text as the company stated it, if any. */
  guidance: string | null;
  /** The quarterly series, as text lines. */
  series: string[];
  /** Press-release text, clipped. */
  release: string | null;
}

function buildUserMessage(inp: AnalystInput): string {
  const block = (title: string, lines: string[]) =>
    lines.length ? `\n<${title}>\n${lines.join('\n')}\n</${title}>` : '';
  return [
    `Company: ${inp.company} (${inp.ticker})${inp.sector ? ` — ${inp.sector}` : ''}`,
    inp.quarter ? `Period: ${inp.quarter}` : '',
    block('engine_computed_figures', inp.facts),
    block('quarterly_series', inp.series),
    block('engine_caveats', inp.caveats),
    inp.guidance ? `\n<company_guidance>\n${inp.guidance}\n</company_guidance>` : '',
    inp.release ? `\n<press_release>\n${inp.release.slice(0, 60_000)}\n</press_release>` : '\n(No press release text was available for this filing.)',
    '\nReturn the JSON object only.',
  ].filter(Boolean).join('\n');
}

export const assessKey = (ticker: string, accession: string | null) =>
  `ai:assess:${AI_ANALYST_VERSION}:${ticker.toUpperCase()}:${accession || 'na'}`;

export async function readAssessment(ticker: string, accession: string | null): Promise<AiAssessment | null> {
  try {
    const v = await kvGet<AiAssessment>(assessKey(ticker, accession));
    return v && v._v === AI_ANALYST_VERSION ? v : null;
  } catch { return null; }
}

export interface AssessOutcome {
  assessment: AiAssessment | null;
  /** Why there is no assessment, in words a reader can act on. */
  error?: string;
  cached?: boolean;
}

/**
 * Assess one company. Cached per accession; a cache hit costs one Redis read.
 *
 * Returns a reason rather than throwing: a desk of thirty names must not lose
 * twenty-nine because one release was a scanned image.
 */
export async function assessCompany(inp: AnalystInput, opts: { force?: boolean } = {}): Promise<AssessOutcome> {
  const key = assessKey(inp.ticker, inp.accession);
  if (!opts.force) {
    const hit = await readAssessment(inp.ticker, inp.accession);
    if (hit) return { assessment: hit, cached: true };
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { assessment: null, error: 'No ANTHROPIC_API_KEY is configured, so nothing was interpreted. The deterministic grade above is unaffected.' };

  let text = '';
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1600,
        temperature: 0,          // a ranking must not move because the dice moved
        system: SYSTEM,
        messages: [{ role: 'user', content: buildUserMessage(inp) }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!resp.ok) return { assessment: null, error: `The analyst service returned HTTP ${resp.status}.` };
    const j: any = await resp.json();
    text = (j?.content || []).filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('').trim();
  } catch (e: any) {
    return { assessment: null, error: `The analyst service did not answer (${String(e?.message || e)}).` };
  }

  // The model was told to return bare JSON; a fenced or prefaced answer is
  // still recoverable, and refusing it would throw away a good assessment over
  // punctuation. Anything that is not an object after this is discarded.
  const m = text.match(/\{[\s\S]*\}/);
  let parsed: any = null;
  try { parsed = m ? JSON.parse(m[0]) : null; } catch { parsed = null; }
  const ok = validateAssessment(parsed, inp.ticker, inp.accession);
  if (!ok) return { assessment: null, error: 'The assessment came back in an unusable shape and was discarded rather than shown.' };

  void kvSet(key, ok, TTL_S).catch(() => {});
  return { assessment: ok, cached: false };
}

// ─── the composite ─────────────────────────────────────────────────────────

/**
 * One number that combines what the machine measured with what the AI judged.
 *
 * The deterministic score leads deliberately: it is computed from filings and
 * is reproducible, while every AI component is an opinion the ledger has not
 * yet marked. The bear case SUBTRACTS — a thesis with a severe, credible
 * argument against it is worth less than the same thesis without one, and a
 * ranking that ignores its own bear case is a ranking that has not read it.
 * Low confidence pulls the AI contribution back toward the machine's number
 * rather than toward zero, so a thin release degrades gracefully.
 */
export function compositeScore(deterministic: number, a: AiAssessment | null): {
  score: number; parts: Array<{ label: string; value: number; weight: number }>;
} {
  const det = Math.max(0, Math.min(100, deterministic || 0));
  if (!a) return { score: det, parts: [{ label: 'Engine grade', value: det, weight: 1 }] };
  const conf = a.confidence / 100;
  const aiRaw = a.structural_score * 0.45 + a.why_now_score * 0.55;
  // Confidence blends the AI's view toward the machine's, it does not erase it.
  const ai = aiRaw * conf + det * (1 - conf);
  const bearDrag = (a.bear_severity / 100) * 18;      // at most 18 points off
  const score = Math.max(0, Math.min(100, Math.round(det * 0.45 + ai * 0.55 - bearDrag)));
  return {
    score,
    parts: [
      { label: 'Engine grade', value: det, weight: 0.45 },
      { label: 'Structural', value: a.structural_score, weight: 0.45 * 0.55 },
      { label: 'Why now', value: a.why_now_score, weight: 0.55 * 0.55 },
      { label: 'Bear drag', value: -Math.round(bearDrag), weight: 1 },
    ],
  };
}

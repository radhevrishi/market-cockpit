// zzz1178 — FUTURE 100-BAGGERS (owner, 26 Oct 2026): 10 hidden small-to-mid caps ($500M–$5B) each in the USA and India with
// the early DNA of past 100-baggers (NVIDIA, Tesla, Amazon, Infosys, Asian Paints, Deepak Nitrite), scored on 15 factors
// (0–10 each, /150). The AI runs ONLY on the owner's click and chooses from a stock-screener shortlist of real companies,
// so every pick is real and its figures are the screener's. Pure types + helpers.
import type { Cand, CandMarket } from '../screener/ai-candidates';

export const HB_FACTORS = [
  ['tam', 'Future TAM expansion'], ['moat', 'Rising moat potential'], ['inflection', 'Financial inflection signs'], ['founder', 'Founder / promoter vision'],
  ['critical', 'Mission-critical role'], ['resilience', 'Cycle resilience'], ['stickiness', 'Customer stickiness'], ['opmoat', 'Operational moat'],
  ['capital', 'Capital allocation'], ['valuation', 'Valuation runway'], ['theme', 'Theme fit (2025–2040)'], ['network', 'Network effects / ecosystem lock-in'],
  ['global', 'Global scalability / exportability'], ['light', 'Capital-light model'], ['optionality', 'Optionality / second act'],
] as const;
export type HbFactor = typeof HB_FACTORS[number][0];
export type HbClass = 'SECULAR_COMPOUNDER' | 'CYCLE_PLAYER';

export interface HbPick {
  ticker: string; name: string; thesis: string; scores: Record<HbFactor, number>; total: number;
  forwardMetrics: string; moat: string; megatrend: string; valuation: string; risks: string; classification: HbClass; missing: string;
  data: Cand | null;
}
export interface HbMarketView { market: CandMarket; picks: HbPick[]; note: string }
export interface HbReport { markets: HbMarketView[]; generatedAt: string; model: string | null; shortlist: Record<CandMarket, number> }

const SCORES_SCHEMA = { type: 'object', additionalProperties: false, required: HB_FACTORS.map(([k]) => k), properties: Object.fromEntries(HB_FACTORS.map(([k, l]) => [k, { type: 'integer', minimum: 0, maximum: 10, description: l }])) };

export const HB_TOOL = {
  name: 'record_future_hundred_baggers',
  description: 'Record the 10 strongest future 100-bagger candidates for the USA and for India, scored on 15 factors.',
  input_schema: {
    type: 'object', additionalProperties: false, required: ['markets'],
    properties: {
      markets: {
        type: 'array', minItems: 2, maxItems: 2,
        items: {
          type: 'object', additionalProperties: false, required: ['market', 'picks', 'note'],
          properties: {
            market: { type: 'string', enum: ['US', 'IN'] },
            note: { type: 'string', maxLength: 400, description: 'One short paragraph on this list as a whole versus historic 100-baggers.' },
            picks: {
              type: 'array', minItems: 5, maxItems: 10,
              items: {
                type: 'object', additionalProperties: false,
                required: ['ticker', 'thesis', 'scores', 'forward_metrics', 'moat', 'megatrend', 'valuation', 'risks', 'classification', 'missing'],
                properties: {
                  ticker: { type: 'string', maxLength: 20, description: 'EXACTLY a ticker from the shortlist given.' },
                  thesis: { type: 'string', maxLength: 200, description: 'One-line thesis.' },
                  scores: SCORES_SCHEMA,
                  forward_metrics: { type: 'string', maxLength: 220, description: 'Key forward metrics: growth (CAGR), backlog / order book, ROCE — figures from the shortlist row or plainly marked as estimates.' },
                  moat: { type: 'string', maxLength: 220, description: 'Moat evidence.' },
                  megatrend: { type: 'string', maxLength: 160, description: 'Megatrend fit.' },
                  valuation: { type: 'string', maxLength: 180, description: 'Valuation snapshot from the shortlist row (P/E, P/S) and what it implies.' },
                  risks: { type: 'string', maxLength: 220, description: 'Main risks.' },
                  classification: { type: 'string', enum: ['SECULAR_COMPOUNDER', 'CYCLE_PLAYER'] },
                  missing: { type: 'string', maxLength: 220, description: 'What it lacks versus historic 100-baggers (e.g. Amazon / NVIDIA had network effects early).' },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

export const HB_SYSTEM = `You are an expert equity analyst hunting future 100-baggers. For the USA and for India separately, pick the 10 hidden small-to-mid-cap companies (market cap $500M–$5B; India about ₹4,250–42,500 crore) that most closely resemble the EARLY-stage DNA of past 100-baggers (NVIDIA, Tesla, Amazon, Infosys, Asian Paints, Deepak Nitrite).

Choose ONLY from the shortlist given (real companies with stock-screener figures); copy the ticker exactly. Never invent figures: use the shortlist numbers, and mark anything else as an estimate.
Prioritise: long future runway, bottleneck / mission-critical roles, structural positioning, early financial inflection.
Exclude: governance, pledge or audit issues; chronic dilution; promoter / board disputes; stocks already fully priced (very high P/S after a huge run). If unsure about governance, leave it out.
Score 15 factors 0–10 each, honestly — 8+ is rare. Classify: SECULAR_COMPOUNDER (50–100x, long-runway compounder) or CYCLE_PLAYER (5–10x, cyclical upside, limited durability).
For each pick say plainly what is missing versus historic 100-baggers. Rank strongest first. Plain, simple English. This is research, not advice.`;

/** Keeps only picks that name a shortlist company; the total is summed here, never taken from the model. Pure. */
export function cleanHb(d: any, shortlist: Record<CandMarket, Cand[]>): HbMarketView[] | null {
  const str = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const out: HbMarketView[] = [];
  for (const m of ['US', 'IN'] as CandMarket[]) {
    const g = (Array.isArray(d?.markets) ? d.markets : []).find((x: any) => x?.market === m);
    if (!g) return null;
    const byT = new Map(shortlist[m].map((c) => [c.t, c]));
    const seen = new Set<string>();
    const picks: HbPick[] = [];
    for (const p of (Array.isArray(g.picks) ? g.picks : [])) {
      const t = String(p?.ticker || '').toUpperCase().replace(/^(NSE|BSE|NYSE|NASDAQ):/, '').trim();
      const c = byT.get(t);
      if (!c || seen.has(t)) continue;
      seen.add(t);
      const scores = Object.fromEntries(HB_FACTORS.map(([k]) => [k, Math.max(0, Math.min(10, Math.round(Number(p?.scores?.[k]) || 0)))])) as Record<HbFactor, number>;
      picks.push({
        ticker: t, name: c.n, thesis: str(p.thesis, 200), scores, total: Object.values(scores).reduce((a, b) => a + b, 0),
        forwardMetrics: str(p.forward_metrics, 220), moat: str(p.moat, 220), megatrend: str(p.megatrend, 160), valuation: str(p.valuation, 180),
        risks: str(p.risks, 220), classification: p.classification === 'CYCLE_PLAYER' ? 'CYCLE_PLAYER' : 'SECULAR_COMPOUNDER', missing: str(p.missing, 220), data: c,
      });
    }
    if (picks.length < 3) return null;
    picks.sort((a, b) => b.total - a.total);
    out.push({ market: m, picks: picks.slice(0, 10), note: str(g.note, 400) });
  }
  return out;
}

export const HB_CLASS_WORD: Record<HbClass, string> = { SECULAR_COMPOUNDER: 'Secular Compounder (50–100×)', CYCLE_PLAYER: 'Cycle Player (5–10×)' };

export function hbAsText(r: HbReport): string {
  const out: string[] = ['🚀 Future 100-baggers', ''];
  for (const g of r.markets) {
    out.push(g.market === 'US' ? '🇺🇸 Top 10 USA' : '🇮🇳 Top 10 India', '');
    g.picks.forEach((p, i) => {
      out.push(`${i + 1}. ${p.name} (${p.ticker}) — ${p.total}/150 — ${HB_CLASS_WORD[p.classification]}`);
      out.push(`   Thesis: ${p.thesis}`);
      out.push(`   Scores: ${HB_FACTORS.map(([k, l]) => `${l.split(' ')[0]} ${p.scores[k]}`).join(' · ')}`);
      out.push(`   Forward: ${p.forwardMetrics}`, `   Moat: ${p.moat}`, `   Megatrend: ${p.megatrend}`, `   Valuation: ${p.valuation}`, `   Risks: ${p.risks}`, `   Missing vs 100-baggers: ${p.missing}`, '');
    });
    if (g.note) out.push(g.note, '');
  }
  return out.join('\n').trim();
}

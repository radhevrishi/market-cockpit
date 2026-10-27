// zzz1178 — FUTURE 100-BAGGERS (owner, 26 Oct 2026): 10 hidden small-to-mid caps ($500M–$5B) each in the USA and India with
// the early DNA of past 100-baggers (NVIDIA, Tesla, Amazon, Infosys, Asian Paints, Deepak Nitrite), scored on 15 factors
// (0–10 each, /150). The AI runs ONLY on the owner's click and chooses from a stock-screener shortlist of real companies,
// so every pick is real and its figures are the screener's. Pure types + helpers.
import type { Cand, CandMarket } from '../screener/ai-candidates';
import { scenarioMultiples, type ScenarioIn, type ScenarioOut } from '../choke-themes/core';

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
  /** zzz1184 — calculated scenario (from the model's EPS-growth / exit-P/E / dilution assumptions and today's P/E) and data flags */
  scenario?: ScenarioIn | null; multiples?: ScenarioOut | null; scenarioNote?: string | null; flags?: string[];
  /** zzz1186 — the AI's own scores before the figures capped them, why they were capped, and what 100x would take */
  aiScores?: Record<HbFactor, number>; aiTotal?: number; caps?: string[]; math100?: string | null;
}
export interface HbMarketView { market: CandMarket; picks: HbPick[]; note: string; /** zzz1186 — earlier picks that fail today's hard gates */ removed?: Array<{ ticker: string; why: string }> }
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
            note: { type: 'string', maxLength: 800, description: 'One short paragraph on this list as a whole versus historic 100-baggers.' },
            picks: {
              type: 'array', minItems: 10, maxItems: 10,
              items: {
                type: 'object', additionalProperties: false,
                required: ['ticker', 'thesis', 'scores', 'forward_metrics', 'moat', 'megatrend', 'valuation', 'risks', 'classification', 'missing', 'scenario'],
                properties: {
                  ticker: { type: 'string', maxLength: 20, description: 'EXACTLY a ticker from the shortlist given.' },
                  thesis: { type: 'string', maxLength: 200, description: 'One-line thesis.' },
                  scores: SCORES_SCHEMA,
                  forward_metrics: { type: 'string', maxLength: 220, description: 'FORWARD only — expected growth, order book / backlog, capacity coming, margin path — each marked "Guidance:" or "Estimate:". Do NOT repeat the shortlist figures (they are shown beside it).' },
                  moat: { type: 'string', maxLength: 220, description: 'Moat evidence.' },
                  megatrend: { type: 'string', maxLength: 160, description: 'Megatrend fit.' },
                  valuation: { type: 'string', maxLength: 180, description: 'Valuation snapshot from the shortlist row (P/E, P/S) and what it implies.' },
                  risks: { type: 'string', maxLength: 220, description: 'Main risks.' },
                  classification: { type: 'string', enum: ['SECULAR_COMPOUNDER', 'CYCLE_PLAYER'] },
                  missing: { type: 'string', maxLength: 220, description: 'What it lacks versus historic 100-baggers (e.g. Amazon / NVIDIA had network effects early).' },
                  scenario: {
                    type: ['object', 'null'], additionalProperties: false, required: ['years', 'eps_cagr', 'exit_pe', 'dilution_pct', 'basis'],
                    description: 'Only for a company with positive, representative earnings; null otherwise. The system calculates the price multiple.',
                    properties: {
                      years: { type: 'integer', minimum: 3, maximum: 10 },
                      eps_cagr: { type: 'object', additionalProperties: false, required: ['bear', 'base', 'bull'], properties: { bear: { type: 'number' }, base: { type: 'number' }, bull: { type: 'number' } }, description: 'Diluted EPS growth a year, %.' },
                      exit_pe: { type: 'object', additionalProperties: false, required: ['bear', 'base', 'bull'], properties: { bear: { type: 'number' }, base: { type: 'number' }, bull: { type: 'number' } } },
                      dilution_pct: { type: 'number' },
                      basis: { type: 'string', maxLength: 200, description: 'What the growth rests on.' },
                    },
                  },
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
Exclude companies with KNOWN governance, pledge or audit problems, promoter / board disputes or chronic dilution. Governance you cannot verify is not a reason to leave a company out — name it in the risks as a check to do. Always return 10 picks per market, ranked; the scores and the caps show which are strong and which are weak.
Think like the owner: a 100-bagger is RARE. It needs all of: a market far bigger than the company today (100x means the company must one day be worth 100 times its value now — say whether that is believable for this business); a durable, rising moat; earnings growth of 25%+ a year that it can sustain for 15–20 years mostly from internally generated cash; high and rising returns on capital reinvested at high rates; a founder / promoter owner-operator with skin in the game and a record of honest capital allocation; no reliance on one customer, one government scheme or one commodity cycle. A cyclical, government-tender-driven or commodity company can be a good stock but is rarely a 100-bagger — classify it CYCLE_PLAYER and score durability low. A well-known, widely-owned mid cap near the top of the band is not "hidden".
The system checks your scores against the figures and caps any that contradict them (negative free cash flow caps capital allocation, high P/E or a big past run caps valuation runway, low returns cap the moats, slow sales growth caps inflection) — so score from the figures.
Score 15 factors 0–10 each, honestly — 8+ is rare, and a score must match the figures (negative FCF margin cannot be "strong cash generation"; debt/equity near 1 is not a clean balance sheet).
Classify: SECULAR_COMPOUNDER (long-runway compounder) or CYCLE_PLAYER (cyclical upside, limited durability). The class is not a return promise — the scenario is.
Read the figures critically: a quarter's sales jump far above the yearly growth is often an acquisition or a low base — say so, do not call it organic growth. Negative FCF margin, rising share count or debt must appear in the risks.
Scenario: for a company with positive, representative earnings give EPS growth a year and exit P/E for bear / base / bull over 3–10 years plus expected dilution — the system calculates the multiple; otherwise null. Never assume 50–100x; if a 10x needs extreme growth, the numbers will show it.
For each pick say plainly what is missing versus historic 100-baggers. Rank strongest first. Plain, simple English. This is research, not advice.`;

/** zzz1187 — the tool for ONE market's call (each market researched on its own). */
export function hbToolFor(m: CandMarket) {
  const t: any = JSON.parse(JSON.stringify(HB_TOOL));
  const mk = t.input_schema.properties.markets;
  mk.minItems = 1; mk.maxItems = 1; mk.items.properties.market.enum = [m];
  t.description = `Record the 10 strongest future 100-bagger candidates for ${m === 'US' ? 'the USA' : 'India'}, scored on 15 factors.`;
  return t;
}

/** zzz1184 — what the figures say that a thesis must not paper over. Pure. */
export function hbFlags(c: Cand): string[] {
  const f: string[] = [];
  if (c.fcfm != null && c.fcfm < 0) f.push(`cash burn — FCF margin ${Math.round(c.fcfm)}%`);
  if (c.de != null && c.de >= 0.8) f.push(`debt — D/E ${c.de.toFixed(1)}`);
  if (c.bb != null && c.bb < -3) f.push(`dilution — share count up ${Math.abs(c.bb).toFixed(1)}% a year`);
  if (c.revQ != null && c.revQ >= 80 && (c.revA == null || c.revQ >= c.revA * 2)) f.push(`quarter +${Math.round(c.revQ)}% vs year ${c.revA == null ? '—' : `+${Math.round(c.revA)}%`} — likely an acquisition or a low base, not organic`);
  if (c.p5y != null && c.p5y >= 300) f.push(`already up ${Math.round(c.p5y / 100 + 1)}x in 5 years`);
  if (c.pe != null && c.pe > 60) f.push(`rich valuation — P/E ${Math.round(c.pe)}`);
  return f;
}

/** zzz1186 — a factor score must not contradict the figures: the AI's score is capped where the screener says otherwise.
 *  Returns the caps and the plain reasons. Pure. */
export function hbFactCaps(c: Cand): { caps: Partial<Record<HbFactor, number>>; reasons: string[] } {
  const caps: Partial<Record<HbFactor, number>> = {}, reasons: string[] = [];
  const cap = (k: HbFactor, v: number, why: string) => { if (caps[k] == null || v < caps[k]!) caps[k] = v; reasons.push(why); };
  if (c.fcfm != null && c.fcfm < 0) { cap('capital', 5, `capital allocation ≤5: free cash flow negative (${Math.round(c.fcfm)}%)`); cap('light', 4, 'capital-light ≤4: burns cash to grow'); }
  if (c.de != null && c.de >= 0.5) { cap('resilience', 5, `cycle resilience ≤5: debt/equity ${c.de.toFixed(1)}`); cap('capital', 6, 'capital allocation ≤6: uses debt'); }
  if (c.bb != null && c.bb < -2) cap('capital', 5, `capital allocation ≤5: share count up ${Math.abs(c.bb).toFixed(1)}% a year`);
  const roc = c.roce ?? c.roe;
  if (roc != null && roc < 15) { cap('opmoat', 6, `operational moat ≤6: return on capital ${Math.round(roc)}%`); cap('moat', 6, 'moat ≤6: returns do not show pricing power'); }
  if (c.opm != null && c.opm < 12) cap('opmoat', 5, `operational moat ≤5: operating margin ${Math.round(c.opm)}%`);
  if (c.revA != null && c.revA < 15 && (c.revQ == null || c.revQ < 20)) cap('inflection', 4, `financial inflection ≤4: sales growth ${Math.round(c.revA)}% a year`);
  if (c.revQ != null && c.revQ >= 80 && (c.revA == null || c.revQ >= c.revA * 2)) cap('inflection', 6, 'financial inflection ≤6: the quarter jump looks acquired or base-driven');
  if (c.pe != null && c.pe > 60) cap('valuation', 4, `valuation runway ≤4: P/E ${Math.round(c.pe)}`);
  else if (c.pe != null && c.pe > 40) cap('valuation', 6, `valuation runway ≤6: P/E ${Math.round(c.pe)}`);
  if (c.ps != null && c.ps > 10) cap('valuation', 5, `valuation runway ≤5: P/S ${c.ps.toFixed(1)}`);
  if (c.p5y != null && c.p5y >= 300) cap('valuation', 5, `valuation runway ≤5: already up ${Math.round(c.p5y / 100 + 1)}x in 5 years`);
  return { caps, reasons: [...new Set(reasons)] };
}

/** zzz1186 — the arithmetic of "100x": the market value it implies and the yearly compounding it needs. Pure. */
export function hbHundredXMath(c: Cand, m: CandMarket): string {
  const target = c.mc * 100;
  const cap = m === 'US' ? (target >= 1_000_000 ? `$${(target / 1_000_000).toFixed(1)} trillion` : `$${Math.round(target / 1000)} billion`) : `₹${(target / 100_000).toFixed(1)} lakh crore`;
  const sales = c.ps && c.ps > 0 ? c.mc / c.ps : null;
  const salesAt = sales == null ? '' : ` — at today's P/S that is sales of ${m === 'US' ? `$${Math.round(sales * 100 / 1000)} billion` : `₹${Math.round(sales * 100).toLocaleString('en-IN')} Cr`} (about ${Math.round(100)}× today)`;
  return `100x = ${cap} market value${salesAt}; it needs about 36% a year for 15 years or 26% a year for 20 years.`;
}

/** Applies the caps to the AI's scores and recomputes the total. Pure. */
export function hbApplyCaps(p: Pick<HbPick, 'scores' | 'data' | 'aiScores'>): { scores: Record<HbFactor, number>; total: number; caps: string[]; aiScores: Record<HbFactor, number>; aiTotal: number } {
  const ai = (p.aiScores || p.scores) as Record<HbFactor, number>;
  const { caps, reasons } = p.data ? hbFactCaps(p.data) : { caps: {}, reasons: [] };
  const scores = Object.fromEntries(HB_FACTORS.map(([k]) => [k, Math.min(ai[k] ?? 0, caps[k] ?? 10)])) as Record<HbFactor, number>;
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  return { scores, total: sum(scores), caps: reasons, aiScores: ai, aiTotal: sum(ai) };
}

/** Keeps only picks that name a shortlist company; the total is summed here, never taken from the model. Pure. */
export function cleanHb(d: any, shortlist: Record<CandMarket, Cand[]>, only: CandMarket[] = ['US', 'IN']): HbMarketView[] | null {
  const str = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const out: HbMarketView[] = [];
  for (const m of only) {
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
      const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
      const sc = p.scenario;
      const scenario: ScenarioIn | null = sc && sc.eps_cagr && sc.exit_pe ? {
        years: Math.max(3, Math.min(10, Math.round(num(sc.years, 5)))),
        epsCagr: { bear: num(sc.eps_cagr.bear, 0), base: num(sc.eps_cagr.base, 0), bull: num(sc.eps_cagr.bull, 0) },
        exitPe: { bear: num(sc.exit_pe.bear, 0), base: num(sc.exit_pe.base, 0), bull: num(sc.exit_pe.bull, 0) },
        dilutionPct: Math.max(0, Math.min(80, num(sc.dilution_pct, 0))), basis: str(sc.basis, 200),
      } : null;
      const sm = scenarioMultiples(scenario, c.pe);
      picks.push({
        ticker: t, name: c.n, thesis: str(p.thesis, 200), scores, total: Object.values(scores).reduce((a, b) => a + b, 0),
        forwardMetrics: str(p.forward_metrics, 220), moat: str(p.moat, 220), megatrend: str(p.megatrend, 160), valuation: str(p.valuation, 180),
        risks: str(p.risks, 220), classification: p.classification === 'CYCLE_PLAYER' ? 'CYCLE_PLAYER' : 'SECULAR_COMPOUNDER', missing: str(p.missing, 220), data: c,
        scenario, multiples: sm.out, scenarioNote: sm.note, flags: hbFlags(c), math100: hbHundredXMath(c, m),
      });
      Object.assign(picks[picks.length - 1], hbApplyCaps(picks[picks.length - 1]));
    }
    if (picks.length < 3) return null;
    picks.sort((a, b) => b.total - a.total);
    out.push({ market: m, picks: picks.slice(0, 10), note: str(g.note, 800) });
  }
  return out;
}

export const HB_CLASS_WORD: Record<HbClass, string> = { SECULAR_COMPOUNDER: 'Secular compounder', CYCLE_PLAYER: 'Cycle player' };   // zzz1184 — no promised multiple; the scenario is calculated

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

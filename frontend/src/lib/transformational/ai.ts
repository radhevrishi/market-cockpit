// zzz1166 — the AI "multibagger chance" read for a transformational event (owner: "I paste this into ChatGPT / Perplexity and
// ask which can be multibaggers — automate it"). One model call per company event, only for events already on the board,
// a daily ceiling, and the answer is stored so it is never paid for twice. The rules read (core.multibaggerOf) is always
// shown; this is a second opinion, labelled as AI.
import { AI_READ_VERSION, type AiMb, type MbLabel, type TgItem } from './core';

const MODEL = 'claude-haiku-4-5-20251001';   // mapped to the configured provider's model by the meter
export const AI_DAILY_MAX = 60;
export const AI_PER_CALL_MAX = 12;

export const MB_TOOL = {
  name: 'record_multibagger_view',
  description: 'Record a sober view of whether this event can make the company a multibagger over 2–4 years.',
  input_schema: {
    type: 'object', additionalProperties: false,
    required: ['label', 'probability_pct', 'why', 'risks', 'verify_next', 'better_theme'],
    properties: {
      label: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW', 'UNLIKELY'] },
      probability_pct: { type: 'integer', minimum: 0, maximum: 100, description: 'Chance the share can rise 3x or more in 2–4 years, from this evidence only.' },
      why: { type: 'array', maxItems: 4, items: { type: 'string', maxLength: 180 }, description: 'Plain reasons FOR, each tied to a stated fact.' },
      risks: { type: 'array', maxItems: 4, items: { type: 'string', maxLength: 180 }, description: 'Plain reasons AGAINST or what could go wrong.' },
      verify_next: { type: 'array', maxItems: 4, items: { type: 'string', maxLength: 160 }, description: 'What to check next (order value vs revenue, capacity utilisation, cash conversion, valuation…).' },
      better_theme: { type: ['string', 'null'], maxLength: 60, description: 'A better theme name when the given one is wrong, else null.' },
    },
  },
} as const;

// zzz1278 — v2 prompt. v1 asked whether ONE event alone could make a 3x and told the model it "often says LOW": it said LOW or
// UNLIKELY for 218 of 223 India rows (0 HIGH), so the blended ranking could never reach High. v2 judges the COMPANY, with the event
// as fresh evidence, against explicit anchors — still sober, but able to separate the best from the rest.
const SYSTEM = `You rank listed small and mid-size companies for an investor who hunts multibaggers (shares that can rise 3x or more in 2–4 years). You get ONE company that just had a notable event, with its latest figures. Judge the COMPANY's multibagger potential, using the event as fresh evidence — not whether this one event alone triples the share.

Labels (use the whole scale; most companies are MEDIUM or LOW, but the best really are HIGH):
- HIGH: small or mid size AND earnings are stepping up now with proof — e.g. revenue +35% or more with profit growing faster and margin expanding, OR an order / capacity / approval that is large against current revenue in a structural theme, with filed figures that already show growth. Few clear risks.
- MEDIUM: good growth or a material event, but some links are unproven (no filed figures yet, order size unknown, margin flat, one quarter only, valuation stretched, already ran a lot).
- LOW: ordinary growth, a small event against the company's size, large company, or weak cash backing.
- UNLIKELY: shrinking business, losses with no turn, a one-off, dilution-funded, or a very large company.

How to think (the investor's own method):
1. What changes FUTURE earnings? Orders large against revenue, capacity coming on stream, a new segment or first commercial sale, an approval that opens a market, operating leverage (margin rising with sales).
2. Follow the chain: demand → order → production → revenue → margin → EPS → cash. Say which links are proven by the figures given.
3. Bottleneck / qualified suppliers in a structural theme beat generic volume.
4. Size matters: a ₹500–8,000 Cr (or $100M–2B) company with a large event has the most room. Above ₹25,000 Cr / $8B a 3x is rare.
5. Against: profit not backed by cash, dilution, press-only claims, a share already up a lot, a cyclical peak, a one-off, high valuation.
Missing figures are UNKNOWN, not bad — say what to check instead of marking down.
probability_pct: your rough chance of 3x in 2–4 years. For reference, an average small cap is about 10%; HIGH usually means 30% or more, MEDIUM 15–30%, LOW 8–15%, UNLIKELY under 8%.
Rules: never invent figures; quote only facts given; plain simple English; short sentences.`;

function userText(x: TgItem): string {
  const f = x.facts;
  const cur = x.market === 'IN' ? '₹ crore' : '$ million';
  const lines = [
    `Company: ${x.company} (${x.ticker}, ${x.market === 'IN' ? 'India' : 'USA'})`,
    `Market cap: ${x.marketCap != null ? `${x.marketCap} ${cur}` : 'not known'}`,
    `Theme (our tag): ${x.theme}`,
    x.industry ? `Industry: ${x.industry}` : null,
    (x.pe != null || x.de != null) ? `Valuation: P/E ${x.pe ?? 'n/a'}, debt ÷ equity ${x.de ?? 'n/a'}` : null,
    `Event type: ${x.kind} · strength ${x.strength} · evidence ${x.evidence === 'official' ? "company's own filing" : 'press only'}`,
    `Headline: ${x.headline}`,
    x.whatChanged ? `What changed: ${x.whatChanged}` : null,
    x.quote ? `Sentence from the source: "${x.quote}"` : null,
    `Signals: ${x.signals.join('; ') || 'none'}`,
    `Figures${x.factsSource === 'screener' ? ` (latest quarter${x.factsPeriod ? ` ${x.factsPeriod}` : ''}, profit = EPS growth)` : ''}: revenue YoY ${f.revenueYoY ?? 'n/a'}%, profit YoY ${f.patYoY ?? 'n/a'}%, margin ${f.marginPrior ?? 'n/a'}% → ${f.marginNow ?? 'n/a'}%, cash ÷ profit ${f.cfoToPat ?? 'n/a'}, guidance ${f.guidance ?? 'not stated'}`,
    x.factsNote ? `Figures note: ${x.factsNote}` : null,
    x.orderToRevenuePct != null ? `Order size: about ${x.orderToRevenuePct}% of one year's revenue` : null,
    `Multi-year runway stated: ${x.durationYears ? 'yes' : 'no'} · materiality: ${x.materiality ?? 'unknown'} · dilution: ${x.dilution ? 'yes' : 'no'}`,
    `Share price: move ${x.movePct ?? 'n/a'}% (${x.moveWindow}), 1 month ${x.returns.m1 ?? 'n/a'}%, 3 months ${x.returns.m3 ?? 'n/a'}%`,
  ];
  return lines.filter(Boolean).join('\n');
}

const LABELS = new Set<MbLabel>(['HIGH', 'MEDIUM', 'LOW', 'UNLIKELY']);
const clip = (a: unknown, n: number) => (Array.isArray(a) ? a.map((s) => String(s || '').trim()).filter(Boolean).slice(0, n) : []);

/** One AI read. Null when the model is not configured, refused or answered badly (nothing is stored then). */
export async function aiMultibagger(x: TgItem): Promise<AiMb | null> {
  const { anthropicMessages, modelConfigured } = await import('../anthropic-meter');
  if (!modelConfigured()) return null;
  try {
    const resp = await anthropicMessages('transformational-mb', {
      model: MODEL, max_tokens: 900, system: SYSTEM,
      tools: [MB_TOOL as any], tool_choice: { type: 'tool', name: MB_TOOL.name },
      messages: [{ role: 'user', content: userText(x) }],
    } as any, { signal: AbortSignal.timeout(40_000) });
    if (!resp.ok) return null;
    const j: any = await resp.json();
    const d = (j?.content || []).find((c: any) => c?.type === 'tool_use')?.input;
    if (!d || !LABELS.has(d.label)) return null;
    const p = Number(d.probability_pct);
    return {
      label: d.label, probabilityPct: Number.isFinite(p) ? Math.max(0, Math.min(100, Math.round(p))) : 0,
      why: clip(d.why, 4), risks: clip(d.risks, 4), verifyNext: clip(d.verify_next, 4),
      theme: typeof d.better_theme === 'string' && d.better_theme.trim() ? d.better_theme.trim().slice(0, 60) : null,
      at: new Date().toISOString(), model: j?.model ?? null, v: AI_READ_VERSION,
    };
  } catch { return null; }
}

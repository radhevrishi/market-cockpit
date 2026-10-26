// zzz1166 — the AI "multibagger chance" read for a transformational event (owner: "I paste this into ChatGPT / Perplexity and
// ask which can be multibaggers — automate it"). One model call per company event, only for events already on the board,
// a daily ceiling, and the answer is stored so it is never paid for twice. The rules read (core.multibaggerOf) is always
// shown; this is a second opinion, labelled as AI.
import type { AiMb, MbLabel, TgItem } from './core';

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

const SYSTEM = `You judge whether ONE company event can turn a listed small or mid-size company into a multibagger (3x or more in 2–4 years). You see only the facts given. You are careful and often say LOW or UNLIKELY.

How to think (the investor's own method):
1. What changes FUTURE earnings? Orders or a backlog that is large against revenue, qualified capacity coming on stream, a new segment or first commercial sale, an approval that opens a market, a margin step-up from operating leverage. A one-quarter jump alone is not enough.
2. Follow the chain: demand → customer spending → project sanction → order → production → revenue → margin → EPS → cash. Say which links are proven and which are not.
3. Prefer bottleneck / qualified suppliers in a structural theme over generic volume.
4. Size matters: a small company with a large event has more room. A large company rarely becomes a multibagger.
5. Against: profit not backed by cash, dilution, press-only claims, a share that already ran a lot, a cyclical peak, a one-off.
Missing figures are UNKNOWN, not bad — do not mark a company down only because a figure is missing; say what to check instead.
Rules: never invent figures; quote only facts given; plain simple English; short sentences.`;

function userText(x: TgItem): string {
  const f = x.facts;
  const cur = x.market === 'IN' ? '₹ crore' : '$ million';
  const lines = [
    `Company: ${x.company} (${x.ticker}, ${x.market === 'IN' ? 'India' : 'USA'})`,
    `Market cap: ${x.marketCap != null ? `${x.marketCap} ${cur}` : 'not known'}`,
    `Theme (our tag): ${x.theme}`,
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
      at: new Date().toISOString(), model: j?.model ?? null,
    };
  } catch { return null; }
}

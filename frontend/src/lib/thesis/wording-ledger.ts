// zzz889 — THE WORDING LEDGER: how management's words change from one call to the next.
//
// Numbers lag; words move first. "Robust demand" becoming "demand is stable" becoming "some softness" is the earliest tell,
// and it is invisible when each call is read on its own. For every topic (demand, margin, pricing, orders, capacity,
// guidance) this lines up management's own sentences period by period, scores the tone of each with a fixed word list
// (no AI), and flags the shift: warmer, cooler, a hedge word that appeared, a confident word that disappeared.
//
// Only management's statements count (claims, guidance, targets) — a reported number is not "wording". Quotes are shown
// verbatim with their source, so every flag can be checked. Pure, unit-tested.
import type { CompanyLedger, EvidenceFact } from './evidence-ledger';
import { periodOrdinal } from './evidence-ledger';

export type WordingTopic = 'demand' | 'margin' | 'pricing' | 'orders' | 'capacity' | 'guidance';
export const TOPIC_LABEL: Record<WordingTopic, string> = { demand: 'Demand', margin: 'Margins', pricing: 'Pricing', orders: 'Orders', capacity: 'Capacity & utilisation', guidance: 'Outlook / guidance' };
const TOPIC_OF_METRIC: Record<string, WordingTopic> = {
  revenue_growth: 'demand', volume: 'demand', exports: 'demand', revenue_visibility: 'demand',
  margin: 'margin', margin_driver: 'margin', operating_leverage: 'margin', raw_materials: 'margin',
  price: 'pricing', mix: 'pricing',
  order_book: 'orders', order_intake: 'orders', book_to_bill: 'orders',
  capacity: 'capacity', capacity_addition: 'capacity', utilisation: 'capacity', commissioning: 'capacity', new_plant: 'capacity',
  guidance: 'guidance', management_target: 'guidance',
};

// Fixed tone words. Strong words count double. Negations ("not robust") flip.
const POS_STRONG = ['robust', 'strong', 'record', 'exceptional', 'accelerat', 'very healthy', 'buoyant', 'significant growth', 'all-time high', 'best ever', 'confident'];
const POS = ['healthy', 'good', 'improv', 'growth', 'expand', 'positive', 'upbeat', 'encouraging', 'momentum', 'pick up', 'pick-up', 'tailwind', 'visibility', 'on track'];
const HEDGE = ['stable', 'steady', 'in line', 'similar', 'flat', 'gradual', 'cautious', 'wait and watch', 'remains to be seen', 'uncertain', 'subject to', 'monitor', 'evaluate', 'some time', 'normaliz', 'normalis'];
const NEG = ['soft', 'slow', 'weak', 'pressure', 'subdued', 'headwind', 'challeng', 'decline', 'muted', 'delay', 'deferr', 'destock', 'sluggish', 'moderat', 'contraction'];
const NEG_STRONG = ['sharp decline', 'significant pressure', 'very challenging', 'severe', 'loss of', 'cancel'];

const has = (t: string, w: string) => t.includes(w);
const negated = (t: string, w: string) => new RegExp(`\\b(?:not|no|never|hardly|without)\\s+(?:\\w+\\s+)?${w.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}`).test(t);

/** Tone of one sentence: −2 (clearly negative) … +2 (clearly positive), with the words that decided it. */
export function toneOf(text: string): { tone: number; words: string[]; hedges: string[] } {
  const t = ` ${String(text || '').toLowerCase()} `;
  let s = 0; const words: string[] = []; const hedges: string[] = [];
  const add = (list: string[], v: number) => { for (const w of list) if (has(t, w)) { const n = negated(t, w); s += n ? -v * 0.5 : v; words.push(n ? `not ${w}` : w); } };
  add(POS_STRONG, 2); add(POS, 1); add(NEG, -1); add(NEG_STRONG, -2);
  for (const w of HEDGE) if (has(t, w)) hedges.push(w);
  s -= hedges.length * 0.5;
  return { tone: Math.max(-2, Math.min(2, Math.round(s * 2) / 4)), words, hedges };
}

export interface WordingPoint { period: string; tone: number; quote: string; source: string; date: string | null; words: string[]; hedges: string[] }
export type ShiftKind = 'WARMER' | 'COOLER' | 'HEDGE_ADDED' | 'CONFIDENCE_DROPPED' | 'UNCHANGED';
export interface WordingShift { topic: WordingTopic; from: WordingPoint; to: WordingPoint; kind: ShiftKind; text: string }
export interface WordingLedger { topics: Array<{ topic: WordingTopic; label: string; points: WordingPoint[] }>; shifts: WordingShift[]; summary: string; periods: number }

const isStatement = (f: EvidenceFact) => f.fact_or_management_statement !== 'FACT' && !!f.source_quote && f.source_quote.length >= 20;

/** Builds the ledger from every period on file, oldest → newest. */
export function wordingLedger(ledger: CompanyLedger | null | undefined): WordingLedger {
  const periods = Object.keys(ledger?.periods || {}).sort((a, b) => (periodOrdinal(a) ?? 0) - (periodOrdinal(b) ?? 0));
  const by = new Map<WordingTopic, WordingPoint[]>();
  for (const per of periods) {
    const facts = (ledger!.periods[per]?.facts || []).filter(isStatement);
    const perTopic = new Map<WordingTopic, EvidenceFact[]>();
    for (const f of facts) { const tp = TOPIC_OF_METRIC[f.metric_name]; if (tp) perTopic.set(tp, [...(perTopic.get(tp) || []), f]); }
    for (const [tp, fs] of perTopic) {
      // one point per topic per period: the average tone of its statements, quoting the strongest one
      const scored = fs.map((f) => ({ f, t: toneOf(f.source_quote) }));
      const avg = scored.reduce((a, x) => a + x.t.tone, 0) / scored.length;
      const lead = [...scored].sort((a, b) => Math.abs(b.t.tone) - Math.abs(a.t.tone))[0];
      const pt: WordingPoint = { period: per, tone: Math.round(avg * 4) / 4, quote: lead.f.source_quote.slice(0, 280), source: lead.f.source_name, date: lead.f.source_date,
        words: Array.from(new Set(scored.flatMap((x) => x.t.words))), hedges: Array.from(new Set(scored.flatMap((x) => x.t.hedges))) };
      by.set(tp, [...(by.get(tp) || []), pt]);
    }
  }
  const shifts: WordingShift[] = [];
  for (const [topic, pts] of by) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i]; const d = b.tone - a.tone;
      const newHedge = b.hedges.filter((h) => !a.hedges.includes(h));
      const lostStrong = a.words.filter((w) => POS_STRONG.includes(w) && !b.words.includes(w));
      let kind: ShiftKind = 'UNCHANGED'; let text = '';
      if (d <= -0.75) { kind = 'COOLER'; text = `${TOPIC_LABEL[topic]} wording cooled (${a.period} → ${b.period})`; }
      else if (d >= 0.75) { kind = 'WARMER'; text = `${TOPIC_LABEL[topic]} wording warmed (${a.period} → ${b.period})`; }
      else if (lostStrong.length) { kind = 'CONFIDENCE_DROPPED'; text = `"${lostStrong.join('", "')}" no longer used about ${TOPIC_LABEL[topic].toLowerCase()} (${b.period})`; }
      else if (newHedge.length) { kind = 'HEDGE_ADDED'; text = `new hedge "${newHedge.join('", "')}" about ${TOPIC_LABEL[topic].toLowerCase()} (${b.period})`; }
      if (kind !== 'UNCHANGED') shifts.push({ topic, from: a, to: b, kind, text });
    }
  }
  const latestP = periods[periods.length - 1];
  const latest = shifts.filter((s) => s.to.period === latestP);
  const cool = latest.filter((s) => s.kind === 'COOLER' || s.kind === 'CONFIDENCE_DROPPED' || s.kind === 'HEDGE_ADDED').length;
  const warm = latest.filter((s) => s.kind === 'WARMER').length;
  const summary = periods.length < 2 ? 'Only one call on file — the wording is recorded; a change can be seen from the next call.'
    : !latest.length ? `No change in management's wording in the latest call (${latestP}).`
    : `Latest call (${latestP}): ${warm ? `${warm} topic${warm === 1 ? '' : 's'} warmer` : ''}${warm && cool ? ', ' : ''}${cool ? `${cool} topic${cool === 1 ? '' : 's'} cooler or more hedged` : ''}.`;
  return { topics: Array.from(by.entries()).map(([topic, points]) => ({ topic, label: TOPIC_LABEL[topic], points })), shifts, summary, periods: periods.length };
}

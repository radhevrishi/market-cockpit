// ═══════════════════════════════════════════════════════════════════════════
// US CATALYST WORDING, READ DETERMINISTICALLY.                       (zzz793)
//
// The shared passage finder was written for Indian filings ("order book",
// "LOA"). A US 10-Q / earnings release / 8-K press release says the same
// things in other words — "remaining performance obligations", "backlog",
// "bookings", "book-to-bill", "awarded a $X million contract", "selected
// by", "new manufacturing facility", "raises full-year guidance". Those
// sentences are read here, with no model, into the shared StructuralEvent
// shape; every event quotes its own sentence verbatim and passes the same
// US figure test (lib/us-thesis/sanitize) as a model-read event. The model's
// events and these are merged (one per variable + value).
// Pure.
// ═══════════════════════════════════════════════════════════════════════════

import type { StructuralEvent } from '@/lib/thesis/evidence-extract';
import { sanitizeUsEvents } from './sanitize';

// Sentences, with bullet lists split into their items; table rows (cells
// joined by " | ") are not sentences and are skipped.
const sentences = (t: string) => String(t || '').replace(/\s+/g, ' ')
  .split(/(?<=[.!?])\s+(?=[A-Z"“$0-9•])|\s[•·▪]\s|\s\.\s(?=[A-Z•])/).map((s) => s.replace(/^[•·▪.\s]+/, '').trim())
  .filter((s) => s.length >= 30 && s.length <= 600 && (s.match(/\|/g) || []).length <= 2);
const LINK = String.raw`(?:[^$.]|\.(?=\d)){0,70}?\b(?:was|were|of|totaled|totalled|reached|stood at|at|to|amounted to|is|are)\s+(?:approximately |about |nearly |a record (?:high of )?)?(\$\s?\d[\d,]*(?:\.\d+)?\s*(?:million|billion|thousand))\b`;
/** A sentence about an EARLIER period only ("This compares to December 31,
 *  2025, when RPOs were $3.01 billion") is not this period's level. */
const HISTORIC_ONLY = /^(?:this|which) (?:compares|compared)\b|^(?:at|as of) (?:the end of )?(?:the )?(?:prior|previous) /i;
/** Not a filed backlog: unsigned awards, "combined" backlog, a pipeline. */
const NOT_BACKLOG = /unsigned|combined backlog|pipeline|opportunit|funnel|\bTAM\b/i;
/** A management remark, not a filed period-end figure. */
const REMARK = /\bas of today\b|\bto date\b|\bsince (?:our|the) (?:last|prior|previous)\b|\bcurrently\b|\bwe (?:believe|expect|anticipate)\b/i;
/** A period that is not the quarter. */
const NOT_QUARTER = /nine months|six months|first half|year[- ]to[- ]date|\bfull[- ]year\b|fiscal year|twelve months|trailing/i;
const num = (m: string) => {
  const x = Number((/[\d,]*\.?\d+/.exec(m.replace(/,/g, '')) || ['NaN'])[0]);
  return x * (/billion/i.test(m) ? 1e9 : /million/i.test(m) ? 1e6 : /thousand/i.test(m) ? 1e3 : 1);
};
const dir = (b: string | null, a: string): StructuralEvent['direction'] => {
  if (!b) return 'unknown';
  const x = num(b), y = num(a);
  return !Number.isFinite(x) || !Number.isFinite(y) ? 'unknown' : y > x * 1.001 ? 'up' : y < x * 0.999 ? 'down' : 'flat';
};

const RULES: Array<{ variable: StructuralEvent['variable']; re: RegExp }> = [
  { variable: 'order_book', re: new RegExp(String.raw`(?:remaining performance obligations?|\bRPOs?\b|\bbacklog\b)(?:\s*\(\d\))?` + LINK, 'i') },
  { variable: 'order_intake', re: new RegExp(String.raw`(?:\bbookings\b|\bnet orders\b|orders? received|order intake|new orders)(?:\s*\(\d\))?(?:,? net of [a-z ,]+)?` + LINK, 'i') },
  { variable: 'order_intake', re: /\bawarded (?:a |an )?(?:[a-z-]+ ){0,3}(\$\s?\d[\d,]*(?:\.\d+)?\s*(?:million|billion|thousand))\b[^.]{0,40}\b(?:contract|order|task order|award)/i },
];
const BTB = /book[- ]to[- ]bill(?: ratio)?(?: (?:of|was|at|came in at|reached))?\s*(?:approximately |about )?(\d+(?:\.\d+)?)\s*(?:x|times)?/i;
const CUSTOMER = /\b(?:selected by|awarded by|signed (?:a |an )?(?:multi-year |long-term |new )?(?:contract|agreement|supply agreement) with|entered into (?:a |an )?(?:multi-year |long-term |definitive )?(?:supply |purchase |master )?(?:agreement|contract) with|new customer)\b/i;
const FACILITY = /\bnew (?:manufacturing |production )?(?:facility|plant|factory|fab|campus|data cent(?:er|re))\b|\b(?:opened|commissioned|broke ground on|began (?:production|operations) at)\b[^.]{0,60}\b(?:facility|plant|factory)\b/i;
const GUIDE_UP = /\b(?:rais(?:es|ed|ing)|increas(?:es|ed|ing)|lift(?:s|ed))\b[^.]{0,40}\b(?:full[- ]year|fiscal(?: year)?(?: 20\d\d)?|annual|20\d\d)?\s*(?:revenue |sales |earnings |EPS )?(?:guidance|outlook)\b/i;
const GUIDE_DOWN = /\b(?:lower(?:s|ed|ing)|reduc(?:es|ed|ing)|cut(?:s)?)\b[^.]{0,40}\b(?:guidance|outlook)\b/i;

/** Deterministic catalyst events from US documents (no model). */
export function usCatalystEvents(docs: Array<{ label: string; text: string }>): StructuralEvent[] {
  const out: StructuralEvent[] = [];
  const seen = new Set<string>();
  const push = (e: StructuralEvent) => {
    const k = `${e.variable}|${e.after}|${e.before || ''}`;
    if (seen.has(k)) return;
    seen.add(k); out.push(e);
  };
  for (const d of docs) {
    // one order-book reading per document: a before → after wins over a level
    const perDoc: Record<string, StructuralEvent> = {};
    for (const s of sentences(d.text)) {
      if (HISTORIC_ONLY.test(s)) continue;
      for (const r of RULES) {
        const m = r.re.exec(s);
        if (!m) continue;
        if (r.variable === 'order_book' && NOT_BACKLOG.test(s.slice(Math.max(0, m.index - 40), m.index + m[0].length))) continue;
        if (r.variable === 'order_intake' && NOT_QUARTER.test(s)) continue;
        if (/\(\s*in (?:millions|thousands)\s*\)/i.test(s)) continue;           // a table, not a sentence
        // "Twelve-month backlog" is revenue expected within a year — revenue
        // visibility, not the total order book (MOG-A: $3.3B vs RPO $7.1B).
        const variable: StructuralEvent['variable'] = r.variable === 'order_book' && /twelve[- ]month|12[- ]month/i.test(s.slice(Math.max(0, m.index - 30), m.index + 20)) ? 'revenue_visibility' : r.variable;
        let after = m[1].replace(/\s+/g, ' ');
        let before: string | null = null;
        const tail = s.slice(m.index);
        const fromTo = /\bfrom (\$\s?\d[\d,]*(?:\.\d+)?\s*(?:million|billion|thousand))\b[^.]{0,40}?\bto (\$\s?\d[\d,]*(?:\.\d+)?\s*(?:million|billion|thousand))/i.exec(tail);
        if (fromTo) { before = fromTo[1]; after = fromTo[2]; }
        else {
          const cmp = new RegExp(String.raw`(?:compared (?:to|with)|versus|\bvs\.?)\s+(\$\s?\d[\d,]*(?:\.\d+)?\s*(?:million|billion|thousand))`, 'i').exec(tail.slice(tail.indexOf(m[1]) + m[1].length));
          if (cmp) before = cmp[1];
        }
        const e: StructuralEvent = { variable, value_type: REMARK.test(s) ? 'MANAGEMENT_CLAIM' : 'ACTUAL', before, after, unit: null, period: null,
          direction: dir(before, after), evidence_text: s, source: d.label, confidence: REMARK.test(s) ? 'MEDIUM' : 'HIGH' };
        const k = variable;
        if (!perDoc[k] || (!perDoc[k].before && before) || (perDoc[k].value_type !== 'ACTUAL' && e.value_type === 'ACTUAL')) perDoc[k] = e;
      }
      const b = BTB.exec(s);
      if (b && Number(b[1]) > 0 && Number(b[1]) < 5) push({ variable: 'book_to_bill', value_type: 'ACTUAL', before: null, after: `${b[1]}x`, unit: null, period: null, direction: Number(b[1]) >= 1 ? 'up' : 'down', evidence_text: s, source: d.label, confidence: 'HIGH' });
      if (CUSTOMER.test(s)) push({ variable: 'new_customer', value_type: 'ACTUAL', before: null, after: s.length > 180 ? `${s.slice(0, 177)}…` : s, unit: null, period: null, direction: 'up', evidence_text: s, source: d.label, confidence: 'MEDIUM' });
      if (FACILITY.test(s) && !/\b(?:plan|plans|expect|will|intend|may)\b/i.test(s)) push({ variable: 'new_plant', value_type: 'ACTUAL', before: null, after: s.length > 180 ? `${s.slice(0, 177)}…` : s, unit: null, period: null, direction: 'up', evidence_text: s, source: d.label, confidence: 'MEDIUM' });
      if (GUIDE_UP.test(s) || GUIDE_DOWN.test(s)) push({ variable: 'guidance', value_type: 'GUIDANCE', before: null, after: s.length > 180 ? `${s.slice(0, 177)}…` : s, unit: null, period: null, direction: GUIDE_UP.test(s) ? 'up' : 'down', evidence_text: s, source: d.label, confidence: 'MEDIUM' });
    }
    for (const e of Object.values(perDoc)) push(e);
  }
  return sanitizeUsEvents(out);
}

/** The model's events plus the deterministic ones, one per variable + value. */
export function mergeUsEvents(model: StructuralEvent[], det: StructuralEvent[]): StructuralEvent[] {
  const key = (e: StructuralEvent) => `${e.variable}|${String(e.after || '').replace(/\s+/g, ' ').toLowerCase()}`;
  const have = new Set(model.map(key));
  // A variable the model already read with a figure is not doubled by a
  // deterministic reading of a different sentence of the same kind.
  const modelVars = new Set(model.filter((e) => /\d/.test(String(e.after || ''))).map((e) => e.variable));
  return [...model, ...det.filter((e) => !have.has(key(e)) && !(modelVars.has(e.variable) && e.variable !== 'new_customer'))];
}

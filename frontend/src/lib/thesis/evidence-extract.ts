// ═══════════════════════════════════════════════════════════════════════════
// STRUCTURAL EVIDENCE EXTRACTION — SEARCH FIRST, THEN ASK.          (zzz738)
//
// THE FAILURE THIS FIXES, measured on EXICOM's August 2026 concall on 21
// September: the transcript mentions capacity 21 times, utilisation 17 times
// and the order book 22 times — "Hyderabad facility gives us 3x production
// capability", "between 90% and 100% utilization", "order book as of today
// stands at roughly INR1,000 crores" — and the reader returned capacity,
// utilisation and order book EMPTY. The document was retrieved, parsed and
// handed to the model in full. The model was told it was reading "an Indian
// listed company's quarterly result" and asked to fill a structural block
// "when the document gives them", in one generic call, alongside forty other
// fields. It did what a summariser does with a 78,000-character transcript:
// it summarised.
//
// So the structural variables get their own stage, built the way an analyst
// actually reads a transcript:
//
//   1. SEARCH THE BODY. Sentences that name a structural variable AND carry a
//      number are pulled out, per family — capacity, utilisation, capex, plant,
//      orders, customers, guidance, volume/price/mix, one-offs, working
//      capital. Everything else is left behind. (The owner's §26 and §38.)
//   2. ASK ONLY ABOUT THOSE. A forced tool call whose entire job is typed
//      events: variable, before, after, unit, period, and the VERBATIM
//      sentence the numbers came from. The schema's enums make an invented
//      variable name impossible; the evidence field makes an invented number
//      detectable.
//   3. VALIDATE EVERY NUMBER. An event survives only if its evidence sentence
//      is in the passages that were sent, and every figure in `before` and
//      `after` appears in that sentence. A number the model could not point
//      to in the text is a number it made up, and it is dropped and counted.
//
// EVERY EVENT CARRIES ITS SEMANTIC TYPE. "84% utilisation" reported for the
// quarter and "84% utilisation" as a target for FY28 are different facts, and
// a card that shows both as the same thing is wrong in the way that costs
// money. ACTUAL / GUIDANCE / TARGET / MANAGEMENT_CLAIM travel with the value
// and the downstream ledger treats only ACTUAL as a filed figure. (§28, §43)
//
// PURE where it matters: passage search and validation take text and return
// data, and are tested against EXICOM's real transcript rather than a
// browser. The model call is the only asynchronous step.
// ═══════════════════════════════════════════════════════════════════════════

import type { VarKey } from './taxonomy';
import { normaliseForQuoteMatch } from '@/lib/ai-gainers/announcement-reader';
import { anthropicMessages } from '@/lib/anthropic-meter';

export type ValueType = 'ACTUAL' | 'GUIDANCE' | 'TARGET' | 'MANAGEMENT_CLAIM';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';
export type Direction = 'up' | 'down' | 'flat' | 'unknown';

/** The families a passage can belong to. Each maps to the ledger's VarKeys. */
export type Family =
  | 'capacity' | 'utilisation' | 'capex' | 'plant' | 'orders' | 'customers'
  | 'guidance' | 'volume_price_mix' | 'one_offs' | 'working_capital' | 'execution';

export interface Passage {
  family: Family;
  text: string;
  doc: string;
}

export interface StructuralEvent {
  variable: VarKey;
  value_type: ValueType;
  before: string | null;
  after: string | null;
  unit: string | null;
  period: string | null;
  direction: Direction;
  /** Verbatim from the document. Validation checks it really is. */
  evidence_text: string;
  /** Which read document this came from, as labelled in the prompt. */
  source: string;
  confidence: Confidence;
  /** 'chart' when the evidence is a run of axis labels and figures from a
   *  slide rather than a sentence — the figures are real but nothing in the
   *  text says what they mean, so the pair is capped at LOW confidence. */
  evidence_quality?: 'sentence' | 'chart' | 'unit_mismatch';
}

export interface ExtractionPipeline {
  passages_by_family: Record<string, number>;
  passages_sent: number;
  events_returned: number;
  events_kept: number;
  events_by_family: Record<string, number>;
  dropped: Array<{ variable: string; reason: string; evidence_text: string }>;
  model_error: string | null;
}

// ── 1. SEARCH ──────────────────────────────────────────────────────────────

const FAMILY_RE: Record<Family, RegExp> = {
  capacity: /\b(installed|production|manufacturing|plant|annual|nameplate)\s+capacit|\bcapacit(y|ies)\b|\btonnes?\b|\bTPA\b|\bMW\b|\bMTPA\b|production (run[- ]?rate|capability)/i,
  utilisation: /utili[sz]ation|utili[sz]ed|operating at|running at|ramp[- ]?up|ramping|full capacity|near full/i,
  capex: /\bcapex\b|capital expenditure|capital outlay|expansion (plan|programme|program)|₹\s*[\d,]+\s*cr\w*\s+(investment|capex)|invest(ed|ment) of/i,
  plant: /new (plant|facility|unit|line|factory)|greenfield|brownfield|commission(ed|ing)|commercial production|production (commenced|started|began)|operational (from|since|in)/i,
  orders: /order\s*book|order\s*backlog|\bbacklog\b|order\s*intake|orders?\s+(received|won|win|booked|booking)|book[- ]to[- ]bill|letter of (award|intent)|\bLOA\b|\bLOI\b|revenue visibility|pipeline of/i,
  customers: /new customers?|customer (addition|win|added|onboard|loss|lost|churn|concentration)|design win|qualif(ied|ication)|nomination|\bOEMs?\b|programme (win|award)/i,
  guidance: /\bguidance\b|\bguided\b|\bexpect(s|ed|ing)?\b|\btarget(s|ed|ing)?\b|\boutlook\b|\bFY\s?'?\d{2}\b|by (Q[1-4]|the end of|fiscal)/i,
  volume_price_mix: /\bvolumes?\b|\brealisations?\b|\brealizations?\b|price (increase|hike|cut|realisation)|product mix|\bmix\b|\bASP\b/i,
  one_offs: /one[- ]?offs?|one[- ]time|exceptional item|non[- ]recurring|write[- ]?back|provision reversal|tax (reversal|benefit|credit)|forex (gain|loss)|impairment|other income/i,
  working_capital: /working capital|receivables?|debtors?|inventor(y|ies)|payables?|creditors?|customer advances|cash conversion|operating cash/i,
  execution: /delay(ed|s)?|deferred|postponed|slippage|behind schedule|ahead of schedule|on track|execution/i,
};

/** Split into sentences that are long enough to carry a fact. */
function sentencesOf(text: string): string[] {
  const t = text.replace(/\s+/g, ' ').trim();
  // Split on sentence enders followed by a capital, a quote or a digit; keep
  // page markers out of the middle of sentences.
  return t.split(/(?<=[.!?])\s+(?=[A-Z"“0-9₹])/).map((s) => s.trim()).filter((s) => s.length >= 40);
}

const HAS_NUMBER = /\d/;

/**
 * Pure: the sentences worth asking about.
 *
 * A sentence qualifies for a family when it matches that family's vocabulary
 * AND contains a number — a paragraph saying "capacity utilisation improved"
 * with no figure is management tone, not evidence, and is deliberately left
 * out. Neighbouring sentences are attached because a number frequently sits
 * one sentence away from the noun it belongs to ("...what is the current
 * utilization? / So the Hyderabad plant... 65%").
 */
export function findPassages(text: string, doc: string, opts?: { maxPerFamily?: number; context?: number }): Passage[] {
  const maxPer = opts?.maxPerFamily ?? 8;
  const ctx = opts?.context ?? 1;
  const sents = sentencesOf(text);
  const out: Passage[] = [];

  for (const fam of Object.keys(FAMILY_RE) as Family[]) {
    const re = FAMILY_RE[fam];
    const got = new Set<number>();
    let count = 0;
    for (let i = 0; i < sents.length && count < maxPer; i++) {
      if (!re.test(sents[i])) continue;
      // The number may be in this sentence or a neighbour.
      const lo = Math.max(0, i - ctx), hi = Math.min(sents.length - 1, i + ctx);
      const windowText = sents.slice(lo, hi + 1).join(' ');
      if (!HAS_NUMBER.test(windowText)) continue;
      // Skip windows that overlap one already taken for this family.
      let overlaps = false;
      for (let k = lo; k <= hi; k++) if (got.has(k)) { overlaps = true; break; }
      if (overlaps) continue;
      for (let k = lo; k <= hi; k++) got.add(k);
      count++;
      out.push({ family: fam, text: windowText.slice(0, 900), doc });
    }
  }
  return out;
}

// ── 2. ASK ─────────────────────────────────────────────────────────────────

/** The variables the extractor may name. Anything else is refused by the
 *  schema, not by a post-hoc filter. */
const EVENT_VARIABLES: VarKey[] = [
  'capacity', 'capacity_addition', 'utilisation', 'new_plant', 'commissioning', 'capacity_bottleneck',
  'order_intake', 'order_book', 'book_to_bill', 'revenue_visibility',
  'capex', 'capex_status', 'capex_earning',
  'new_customer', 'customer_loss', 'customer_concentration', 'new_product', 'qualification', 'approval',
  'volume', 'price', 'mix', 'exports',
  'guidance', 'management_target',
  'working_capital', 'one_offs', 'raw_materials', 'margin_driver',
  'supply_bottleneck', 'execution_delay', 'shutdown',
];

export const EVENT_TOOL = {
  name: 'record_structural_events',
  description: 'Record every structural fact the passages state, one event per fact. Numbers must be copied exactly as printed and the evidence_text must be the verbatim sentence they came from.',
  input_schema: {
    type: 'object',
    properties: {
      events: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            variable: { type: 'string', enum: EVENT_VARIABLES },
            value_type: { type: 'string', enum: ['ACTUAL', 'GUIDANCE', 'TARGET', 'MANAGEMENT_CLAIM'] },
            before: { type: ['string', 'null'], description: 'The earlier value exactly as printed, e.g. "72%", "Rs 1,200 crore". Null when the passage states no earlier value — NEVER derive one.' },
            after: { type: ['string', 'null'], description: 'The current or stated value exactly as printed.' },
            unit: { type: ['string', 'null'] },
            period: { type: ['string', 'null'], description: 'As stated: "Q1 FY27", "FY27", "August 2026".' },
            direction: { type: 'string', enum: ['up', 'down', 'flat', 'unknown'] },
            evidence_text: { type: 'string', description: 'The verbatim sentence(s) from the passage, unedited.' },
            source: { type: 'string', description: 'The SOURCE label of the passage this came from.' },
            confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
          },
          required: ['variable', 'value_type', 'before', 'after', 'unit', 'period', 'direction', 'evidence_text', 'source', 'confidence'],
        },
      },
    },
    required: ['events'],
  },
} as const;

const SYSTEM = `You are extracting structural business evidence from passages of a listed company's own documents — concall transcript, investor presentation, results filing, exchange announcement.

RULES THAT ARE NOT NEGOTIABLE
- Record only what a passage STATES. Copy every number exactly as printed, with its unit. Never convert crore to million, never round, never compute a change the passage does not itself state.
- "before" is filled ONLY when the passage states an earlier value. If only the current value is stated, before is null. Never infer a prior value from a growth rate.
- value_type: ACTUAL for a reported figure for a completed period. GUIDANCE for a number management guides to. TARGET for a level management aims for. MANAGEMENT_CLAIM for a qualitative assertion with a number attached ("3x capacity") that is not a reported metric.
- A management expectation is never ACTUAL. "We expect 80% utilisation by FY28" is TARGET with after="80%", period="FY28".
- Several product lines may each have their own figure ("90-100% on AC, 65% on DC"). Record each as its own event with the line named in evidence_text; do not average them.
- evidence_text must be the verbatim sentence. It will be checked against the document; an edited or paraphrased sentence causes the whole event to be discarded.
- If a family of passages contains no usable figure, record nothing for it. Silence is correct; invention is not.
- Revenue, profit and margin figures are NOT structural events and must not be recorded here — they come from the financial statements separately.`;

export interface ReadDoc { label: string; kind: string; text: string; }

/**
 * Extract typed structural events from the documents that were read.
 *
 * Returns the events that survived validation and a pipeline record that says
 * how many passages were found per family, how many events came back, and
 * every one that was dropped with the reason — so the debug panel can say
 * whether nothing was found, or something was found and thrown out.
 */
export async function extractStructuralEvents(
  docs: ReadDoc[],
  ticker: string,
  opts: { apiKey?: string; model: string; maxPassages?: number },
): Promise<{ events: StructuralEvent[]; pipeline: ExtractionPipeline; raw?: any[] }> {
  const passages: Passage[] = [];
  for (const d of docs) passages.push(...findPassages(d.text, d.label));

  const byFam: Record<string, number> = {};
  for (const p of passages) byFam[p.family] = (byFam[p.family] || 0) + 1;

  const capped = passages.slice(0, opts.maxPassages ?? 90);
  const pipeline: ExtractionPipeline = {
    passages_by_family: byFam,
    passages_sent: capped.length,
    events_returned: 0,
    events_kept: 0,
    events_by_family: {},
    dropped: [],
    model_error: null,
  };
  if (!capped.length) return { events: [], pipeline };

  const prompt = `${ticker}\n\n` + capped
    .map((p, i) => `[${i + 1}] FAMILY: ${p.family} | SOURCE: ${p.doc}\n${p.text}`)
    .join('\n\n');

  let raw: any[] = [];
  try {
    const resp = await anthropicMessages('catalysts-extract', {
      model: opts.model,
      max_tokens: 6000,
      system: SYSTEM,
      tools: [EVENT_TOOL],
      tool_choice: { type: 'tool', name: EVENT_TOOL.name },
      messages: [{ role: 'user', content: prompt }],
    }, { signal: AbortSignal.timeout(100_000) });
    if (!resp.ok) {
      let detail = '';
      try { const t = await resp.text(); const je = JSON.parse(t); detail = String(je?.error?.message || je?.message || t).slice(0, 300); } catch { /* status alone */ }
      pipeline.model_error = `HTTP ${resp.status}${detail ? `: ${detail}` : ''}`;
      return { events: [], pipeline };
    }
    const j = await resp.json();
    const call = (j?.content || []).find((c: any) => c?.type === 'tool_use' && c?.name === EVENT_TOOL.name);
    raw = Array.isArray(call?.input?.events) ? call.input.events : [];
  } catch (e: any) {
    pipeline.model_error = String(e?.message || e);
    return { events: [], pipeline };
  }

  pipeline.events_returned = raw.length;
  const { kept, dropped } = validateEvents(raw, capped);
  pipeline.events_kept = kept.length;
  pipeline.dropped = dropped;
  for (const ev of kept) pipeline.events_by_family[ev.variable] = (pipeline.events_by_family[ev.variable] || 0) + 1;
  return { events: kept, pipeline, raw };
}

// ── 3. VALIDATE ────────────────────────────────────────────────────────────

const numberTokens = (s: string | null): string[] =>
  s ? (s.match(/\d[\d,]*(?:\.\d+)?/g) || []).map((x) => x.replace(/,/g, '')) : [];

/**
 * Pure: keep only events whose numbers the text can vouch for.
 *
 * Two checks, both against the passages that were actually sent:
 *   - the evidence sentence must appear in them (normalised, so a curly
 *     quote or a line-break hyphen does not fail an honest quote);
 *   - every number in `before` and `after` must appear in the evidence
 *     sentence.
 * A failed check drops the event and records why. The count of dropped
 * events is itself a signal: a model that invents is a model to distrust.
 */
export function validateEvents(raw: any[], passages: Passage[]): { kept: StructuralEvent[]; dropped: ExtractionPipeline['dropped'] } {
  const corpus = normaliseForQuoteMatch(passages.map((p) => p.text).join(' '));
  const kept: StructuralEvent[] = [];
  const dropped: ExtractionPipeline['dropped'] = [];
  const seen = new Set<string>();

  for (const e of raw) {
    const variable = String(e?.variable || '') as VarKey;
    const ev = String(e?.evidence_text || '').trim();
    const drop = (reason: string) => dropped.push({ variable, reason, evidence_text: ev.slice(0, 160) });

    if (!EVENT_VARIABLES.includes(variable)) { drop('variable not in schema'); continue; }
    if (ev.length < 25) { drop('evidence too short to verify'); continue; }
    const q = normaliseForQuoteMatch(ev);
    // The first 60 normalised characters must be present verbatim. Long
    // quotes drift at the end (a trailing clause dropped) far more often than
    // at the start, and 60 characters is already too specific to fake.
    if (!corpus.includes(q.slice(0, 60))) { drop('evidence sentence not found in the document'); continue; }

    const before = e?.before == null ? null : String(e.before).trim() || null;
    const after = e?.after == null ? null : String(e.after).trim() || null;
    if (!before && !after) { drop('no value stated'); continue; }
    const evNums = numberTokens(ev);
    const missing = [...numberTokens(before), ...numberTokens(after)].filter((n) => !evNums.includes(n));
    if (missing.length) { drop(`figure ${missing[0]} does not appear in the evidence sentence`); continue; }

    const vt = String(e?.value_type || '');
    const value_type: ValueType = (['ACTUAL', 'GUIDANCE', 'TARGET', 'MANAGEMENT_CLAIM'] as const).includes(vt as any) ? vt as ValueType : 'MANAGEMENT_CLAIM';
    const dir = String(e?.direction || 'unknown');
    const direction: Direction = (['up', 'down', 'flat', 'unknown'] as const).includes(dir as any) ? dir as Direction : 'unknown';
    const conf = String(e?.confidence || 'LOW');
    let confidence: Confidence = (['HIGH', 'MEDIUM', 'LOW'] as const).includes(conf as any) ? conf as Confidence : 'LOW';

    // CHART AXES ARE NOT SENTENCES. E2E's presentation yielded
    // "61% 75% -10% 10% 30% 50% 70% 90% 0 200 400 …" as the evidence for a
    // utilisation move from 61% to 75%. The figures are on the slide, so
    // validation passed; but the text never says which figure is what, and a
    // model reading a bar chart's axis picks tick marks as readily as bars.
    // Such an event is kept — the numbers were not invented — but capped at
    // LOW and labelled, so the ledger shows it as weak and a reader knows to
    // open the slide.
    // VARIABLE ↔ VALUE SANITY. A utilisation is a percentage (or a shift
    // count, or "full"); a bare "160 → 374" against it is a headcount or a
    // rack count the model filed under the wrong variable. An execution
    // delay needs the passage to talk about delay. Both passed the verbatim
    // check — the numbers were in the text — and both were wrong facts on
    // the card (E2E "utilisation 160 → 374", TI "execution delay 90%").
    // Such events are kept as LOW-confidence claims and never as facts.
    const evidence_quality = judgeEventQuality({ variable, before, after, unit: e?.unit == null ? null : String(e.unit), evidence_text: ev });
    if (evidence_quality !== 'sentence') confidence = 'LOW';

    const key = `${variable}|${value_type}|${before}|${after}|${q.slice(0, 40)}`;
    if (seen.has(key)) continue;            // same fact from two passages
    seen.add(key);

    kept.push({
      variable, value_type, before, after,
      unit: e?.unit == null ? null : String(e.unit),
      period: e?.period == null ? null : String(e.period),
      direction: verifiedDirection({ before, after, direction, evidence_text: ev }),
      evidence_text: ev.slice(0, 600),
      source: String(e?.source || passages[0]?.doc || ''),
      confidence,
      evidence_quality,
    });
  }
  return { kept, dropped };
}

// ── 3b. QUALITY AND DIRECTION, RE-JUDGED AT READ TIME ─────────────────────
//
// These two checks are PURE and run both when an event is validated and
// again when a stored event is loaded. Ledgers written before a check
// existed carry no `evidence_quality`, and a stored event whose direction
// was never verified is still on the card; re-judging on load means a rule
// fix reaches every ledger already in KV without spending a model call to
// re-read the documents. (zzz754)

const PCT_VARS = new Set(['margin_driver', 'exports', 'mix', 'customer_concentration']);
const CAPACITY_VARS = new Set(['capacity', 'capacity_addition', 'new_plant']);
const CURRENCY_RE = /₹|\bINR|\bRs\.?|\bUSD|\$|\bEUR|€|crores?\b|\bcr\b|lakhs?\b|`\s*\d/i;
// Kept for reference of what a capacity DOES look like; the rule is simpler
// than a whitelist — money is never capacity.
export const CAPACITY_UNIT_RE = /\bMW\b|\bMWh\b|\bGW\b|\bTPA\b|\bMTPA\b|\bKTPA\b|tonnes?|\bMT\b|\bKL\b|\bKLD\b|\bKLPD\b|litres?|liters?|kilolit|units?\b|pieces|\bnos\b|plants?\b|lines?\b|beds?\b|racks?|GPUs?|servers?|cases\b|vehicles|\bx\b|\d\s*x\b|times|fold|monitors|pallets|sq\.?\s*ft|square|hectare|acre|kg\b|kilogram|barrels?|bpd|MMSCMD|MTPD|TPD|shifts?|machines?|looms?|spindles?|furnace|kilns?|cells?|modules?|wafers?|chips?/i;

/** Pure: whether the value fits the variable and the evidence is a sentence. */
export function judgeEventQuality(e: { variable: string; before: string | null; after: string | null; unit: string | null; evidence_text: string }): 'sentence' | 'chart' | 'unit_mismatch' {
  const ev = e.evidence_text || '';
  const valueText = `${e.before || ''} ${e.after || ''}`;
  const v = e.variable;
  // A run of axis labels is a CHART read first and foremost. It is judged
  // ahead of the unit rules because the figures did come off that
  // variable's slide — they are weak, not mis-filed, and the two states
  // have different consequences downstream. (zzz755)
  const words = (ev.match(/[A-Za-z]{3,}/g) || []).length;
  const figures = (ev.match(/\d[\d,.]*%?/g) || []).length;
  if (words < 5 || figures > words) return 'chart';
  const unitOk = (() => {
    // ── UTILISATION IS THE MOST-ABUSED VARIABLE ON THE PAGE.       (zzz755)
    //
    // Live on 22 Sept it carried: a duration (JINDRILL "4 to 6 months"), a
    // money figure (DIVGI "Rs. 5.7 crores"), a location list (VIJAYA "7 hub
    // centers in Kolkata"), a delivery date (UNIPARTS "first customer
    // deliveries ... in Q3"), a headcount (E2E "160 → 374") and a growth
    // rate (ETHOS "13.2%"). A percentage alone is not enough — half of
    // those are percentages. The SENTENCE has to be about utilisation.
    if (v === 'utilisation') {
      const saysUtilisation = /utilis|utiliz|operating at|running at|occupancy|load factor|\bCUF\b|\bPLF\b|capacity|full|maximum|peak|sold out/i.test(ev);
      if (!saysUtilisation) return false;
      const pctMatch = valueText.match(/-?\d+(?:\.\d+)?\s*%/);
      if (pctMatch) {
        const n = parseFloat(pctMatch[0]);
        // Below zero is impossible; above 130 is a growth figure, not a
        // fill rate. GIPCL's genuine 19.89% CUF survives.
        if (!(n >= 0 && n <= 130)) return false;
        return true;
      }
      return /full|maximum|peak|near|sold out|optimum|shift/i.test(valueText);
    }
    if (PCT_VARS.has(v)) return /%|per ?cent|pp\b|full|maximum|peak|near|shift|high|low|double|single/i.test(valueText) || /%/.test(String(e.unit || ''));
    // A capacity stated only in money is a capex figure filed under the
    // wrong name: EXICOM "installed capacity USD100 million", AZAD
    // "INR150 crores per plant". Money is not capacity — and neither is a
    // bare percentage (GESHIP "installed capacity About 25-26%").
    if (CAPACITY_VARS.has(v)) {
      if (CURRENCY_RE.test(valueText)) return false;
      if (/%/.test(valueText) && !CAPACITY_UNIT_RE.test(valueText)) return false;
      return true;
    }
    if (v === 'execution_delay') return /delay|postpone|behind schedule|slip|deferr|later than|pushed|rescheduled|extended timeline/i.test(ev);
    if (v === 'shutdown') return /shut ?down|closure|outage|maintenance|halt/i.test(ev);
    if (v === 'capacity_bottleneck' || v === 'supply_bottleneck') return /bottleneck|constrain|shortage|limited by|unable to|sold out|waiting/i.test(ev);
    return true;
  })();
  return unitOk ? 'sentence' : 'unit_mismatch';
}

const UP_RE = /\bincreas|\bimprov|\bgrew\b|\bgrow(n|th)?\b|\bhigher\b|\bup\b|\bexpan|\brose\b|\bris(e|ing)\b|\bramp|\badded\b|\baddition|\bdoubl|\btripl|\b\d+\s*x\b|\bfrom\b.*\bto\b|\bscal(e|ed|ing) up|\bcommission|\bnew\b|\bwon\b|\bwin\b|\bbagged|\breceived\b|\bmaximum|\bpeak\b|\bfull\b/i;
const DOWN_RE = /\bdeclin|\bfell\b|\bfall|\blower\b|\bdown\b|\bcontract(ed|ion)|\breduc|\bdrop|\bcut\b|\bslow|\bdeferr|\bdelay|\bcancel|\bloss|\blost\b|\bweak|\bshut|\bhalt|\bpostpon|\bslip/i;

/**
 * Pure: the direction the evidence sentence itself supports.
 *
 * A model reading "order book stands at INR1,310 crores" and answering
 * `direction: flat` has asserted a comparison the sentence does not make;
 * the same sentence with `up` is no better. A direction is kept only when
 * the passage states an earlier value (so the move is arithmetic) or names
 * the move in words. Otherwise the fact is a LEVEL, and the card says so
 * rather than drawing an arrow. (zzz754)
 */
export function verifiedDirection(e: { before: string | null; after: string | null; direction: Direction; evidence_text: string; unit?: string | null }): Direction {
  if (e.direction === 'unknown') return 'unknown';
  const b = e.before ? numberTokens(e.before)[0] : null;
  const a = e.after ? numberTokens(e.after)[0] : null;
  if (b != null && a != null) {
    const nb = parseFloat(b), na = parseFloat(a);
    if (Number.isFinite(nb) && Number.isFinite(na) && nb !== na) return na > nb ? 'up' : 'down';
    if (Number.isFinite(nb) && Number.isFinite(na)) return 'flat';
  }
  const ev = e.evidence_text || '';
  if (e.direction === 'up' && UP_RE.test(ev)) return 'up';
  if (e.direction === 'down' && DOWN_RE.test(ev)) return 'down';
  if (e.direction === 'flat' && /\bflat\b|\bstable\b|\bunchanged\b|\bmaintain|\bsame\b|\bsteady\b|\bin line\b/i.test(ev)) return 'flat';
  return 'unknown';
}

// ── 4. INTO THE LEDGER ─────────────────────────────────────────────────────

/**
 * Pure: the strongest event per variable, for the thesis ledger.
 *
 * ACTUAL beats everything, then GUIDANCE, then TARGET, then a claim; within a
 * type, one with a `before` beats one without (it can state a change), and
 * higher confidence wins ties. Targets and claims are returned too, under
 * their own key, so a card can show "84% actual · 90% target" and never mix
 * the two.
 */
export function bestEventPerVariable(events: StructuralEvent[]): Map<VarKey, { actual: StructuralEvent | null; forward: StructuralEvent | null }> {
  const rank: Record<ValueType, number> = { ACTUAL: 0, GUIDANCE: 1, TARGET: 2, MANAGEMENT_CLAIM: 3 };
  const conf: Record<Confidence, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  const better = (a: StructuralEvent, b: StructuralEvent) =>
    (rank[a.value_type] - rank[b.value_type])
    || ((a.before ? 0 : 1) - (b.before ? 0 : 1))
    || (conf[a.confidence] - conf[b.confidence]);
  const out = new Map<VarKey, { actual: StructuralEvent | null; forward: StructuralEvent | null }>();
  for (const e of events) {
    const slot = out.get(e.variable) || { actual: null, forward: null };
    const isForward = e.value_type === 'GUIDANCE' || e.value_type === 'TARGET';
    if (isForward) {
      if (!slot.forward || better(e, slot.forward) < 0) slot.forward = e;
    } else if (!slot.actual || better(e, slot.actual) < 0) {
      slot.actual = e;
    }
    out.set(e.variable, slot);
  }
  return out;
}

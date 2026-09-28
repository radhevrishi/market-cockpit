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
import { stripPeriodTokens } from './fact-normalize';
import { transcriptCommentary } from './transcript-evidence';

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
  /** zzz809: a qualitative management statement (price, margin driver,
   *  volume) read deterministically from a transcript — words, never a
   *  figure; shown as management commentary, never confirmed. */
  qualitative?: boolean;
  /** zzz809: one forward-guidance line (incremental revenue %, asset turn,
   *  ROCE, growth guidance, utilisation target) — shown under the guidance
   *  row, never as a filed result and never as the guidance verdict. */
  guidance_line?: boolean;
  /** zzz809: a figure derived from two figures the same sentence states
   *  ("total 18,000 − addition 6,000"), with the basis in words. */
  derived?: string | null;
  /** zzz809: the product a capacity figure belongs to, where named. */
  product?: string | null;
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
  // zzz809: what a transcript says in WORDS — price, margin mechanism, volume
  // tone — and its forward guidance lines are read deterministically, whatever
  // the model returns. Each carries its verbatim sentence; none is a figure
  // the text does not print.
  const spoken: StructuralEvent[] = [];
  for (const d of docs) {
    if (!/transcript|concall|con-?call|conference call|earnings call|business update/i.test(`${d.kind} ${d.label}`)) continue;
    try { spoken.push(...transcriptCommentary(d.text, d.label)); } catch { /* commentary is additive; never fails the read */ }
  }

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
  if (!capped.length) return { events: spoken, pipeline };

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
      return { events: spoken, pipeline };
    }
    const j = await resp.json();
    const call = (j?.content || []).find((c: any) => c?.type === 'tool_use' && c?.name === EVENT_TOOL.name);
    raw = Array.isArray(call?.input?.events) ? call.input.events : [];
  } catch (e: any) {
    pipeline.model_error = String(e?.message || e);
    return { events: spoken, pipeline };
  }

  pipeline.events_returned = raw.length;
  const { kept, dropped } = validateEvents(raw, capped);
  pipeline.events_kept = kept.length;
  pipeline.dropped = dropped;
  for (const ev of kept) pipeline.events_by_family[ev.variable] = (pipeline.events_by_family[ev.variable] || 0) + 1;
  return { events: [...kept, ...spoken], pipeline, raw };
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
/** A scale word with nothing being scaled. See the capacity rule below. */
const MAGNITUDE_ONLY_RE = /\b(mn|bn|millions?|billions?|trillions?|thousands?|k)\b/i;
export const CAPACITY_UNIT_RE =/\bMW\b|\bMWh\b|\bGW\b|\bTPA\b|\bMTPA\b|\bKTPA\b|tonnes?|\bMT\b|\bKL\b|\bKLD\b|\bKLPD\b|litres?|liters?|kilolit|units?\b|pieces|\bnos\b|plants?\b|lines?\b|beds?\b|racks?|GPUs?|servers?|cases\b|vehicles|\bx\b|\d\s*x\b|times|fold|monitors|pallets|sq\.?\s*ft|square|hectare|acre|kg\b|kilogram|barrels?|bpd|MMSCMD|MTPD|TPD|shifts?|machines?|looms?|spindles?|furnace|kilns?|cells?|modules?|wafers?|chips?/i;

/** Three or more bare figures separated only by spaces or slashes. (zzz769) */
export function isNumberRow(s: string | null | undefined): boolean {
  const t = String(s ?? '').trim();
  if (!t || /[A-Za-z]/.test(t)) return false;
  const toks = t.split(/[\s/]+/).filter(Boolean);
  return toks.length >= 3 && toks.every((x) => /^[+-]?[\d][\d,.]*%?$/.test(x));
}
const MONTH_RE = /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/gi;
/** A value that is only a date or a date range. (zzz769) */
export function isDateOnly(s: string | null | undefined): boolean {
  const t = String(s ?? '').trim();
  if (!/\d/.test(t)) return false;
  const hasDate = MONTH_RE.test(t) || /\b(FY|CY|Q[1-4]|H[12])\s*'?\d{2,4}\b/i.test(t) || /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/.test(t);
  MONTH_RE.lastIndex = 0;
  if (!hasDate) return false;
  const rest = t.replace(MONTH_RE, ' ')
    .replace(/\b(FY|CY|Q[1-4]|H[12])\s*'?\d{2,4}\b/gi, ' ')
    .replace(/\d+\s*(st|nd|rd|th)\b/gi, ' ')
    .replace(/\b(to|till|until|from|by|on|and|through|the|of|end|start|beginning|valid)\b/gi, ' ')
    .replace(/[\d\s,.\-–/()']+/g, ' ');
  MONTH_RE.lastIndex = 0;
  return !/[A-Za-z]/.test(rest);
}
const NUMBER_WORD_RE = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|fifty|hundred|thousand|double|doubl\w*|tripl\w*|twice)\b/i;
const CONCRETE_ASSET_RE = /\b(lines?|plants?|facilit(y|ies)|units?|blocks?|smelters?|kilns?|reactors?|furnaces?|mills?|vessels?|rigs?|stores?|boutiques?|sheds?|sites?)\b/i;
const FORWARD_WORD_RE = /\b(expect\w*|guid\w*|target\w*|will|would|aim\w*|plan\w*|outlook|project(ed|ion|ing)|anticipat\w*|going forward|forecast\w*|intend\w*|likely|next (year|quarter|fiscal)|coming (year|quarters?)|by (FY|CY|Q[1-4])\s*'?\d{2})/i;

// ── A UTILISATION IS A UTILISATION.                                (zzz772)
//
// The live page still carried AZAD "Civil construction at the Azad Centre of
// Excellence … is expected to be completed within this fiscal year",
// TATATECH "strong double-digit organic revenue growth for FY27", IRMENERGY
// "1587.17 million" (unutilised IPO money), SFL "30 days inventory in India"
// and WONDERLA "tracking similar to other larger parks" as capacity
// utilisation. A fill rate is a PERCENTAGE, or an explicit capacity-use
// word: full, maximum, optimum, near-full, "at capacity", "100% capacity".
// Days, money, a bare "million" / "units", and sentences about construction
// or growth are not. Exported so every path that fills a utilisation slot —
// the board, the summary block, the capex chain — asks the same question.
const UTIL_WORDS = /\b(full(?:y)?(?:\s+(?:utili[sz]ed|capacity|load|level))?|near[- ]full|nearly\s+full|maximum|max(?:imum)?\s+(?:level|capacity)|optimum|optimal|at\s+(?:full\s+)?capacity|peak\s+(?:capacity|utili[sz]ation|level)|sold\s+out|(?:one|two|three|single|double|triple|\d)\s+shifts?)\b/i;
const NOT_A_FILL_RATE = /\b(days?|months?|weeks?|years?|hours?|construct\w*|civil|build\w*|growth|grow\w*|revenue|margin|ebitda|profit|order|tracking|similar|inventory|proceeds|unutili[sz]ed|IPO)\b|₹|\bINR\b|\bRs\.?|\bUSD\b|\$|crores?\b|\bcr\b|lakhs?\b/i;
export function isUtilisationValue(value: string | null | undefined): boolean {
  const v = String(value ?? '').trim();
  if (!v) return false;
  const pct = /-?\d+(?:\.\d+)?(?:\s*-?\s*odd)?\s*(%|per\s?cent|percent)/i.exec(v);
  if (pct) {
    const n = parseFloat(pct[0]);
    // A share of revenue, a growth rate or a margin is a percentage too.
    if (/\b(growth|grew|revenue|margin|ebitda|profit|share of|contribution|saving|of planned)\b/i.test(v) && !/utili[sz]|capacity|\bCUF\b|\bPLF\b|occupancy/i.test(v)) return false;
    return n >= 0 && n <= 300;
  }
  // Without a percentage: only a capacity-use word, and nothing that makes it
  // a duration, an amount, a count or a sentence about something else.
  if (/\b(million|mn|billion|bn|units?|nos)\b/i.test(v) || NOT_A_FILL_RATE.test(v)) return false;
  return UTIL_WORDS.test(v) && !/doubl|tripl|compared|versus|\bvs\b/i.test(v);
}

// ── A RESULTS TABLE IS NOT GUIDANCE.                               (zzz772)
//
// TBZ printed "Guidance: Revenue from Operations 8,409.74; Gross Profit
// 1,251.35; Gross Margin % 14.9%; EBITDA 710.23; … EPS (₹) 4.92": the quarter's
// P&L read off the results table. A value that names three or more financial
// line items, each with a figure, is a results table whatever it was filed
// under, and it never stands as a forward statement.
const LINE_ITEMS: Array<[string, RegExp]> = [
  ['revenue', /\b(revenue(?:\s+from\s+operations)?|net\s+sales|sales|turnover|total\s+income|topline)\b/i],
  ['gross_profit', /\bgross\s+profit\b/i],
  ['ebitda', /\bebitda\b(?!\s+margin)/i],
  ['ebit', /\bebit\b/i],
  ['pbt', /\b(pbt|profit\s+before\s+tax)\b/i],
  ['pat', /\b(pat|profit\s+after\s+tax|net\s+profit)\b(?!\s+margin)/i],
  ['eps', /\beps\b/i],
  ['margin', /\bmargins?\b/i],
];
export function isResultsTable(value: string | null | undefined): boolean {
  const v = String(value ?? '');
  if (!v.trim()) return false;
  // Split into the value's own clauses; a line item counts when a figure
  // follows it inside its clause.
  const parts = v.split(/[;|\n]|,(?!\d)/);
  const seen = new Set<string>();
  for (const part of parts) {
    for (const [name, re] of LINE_ITEMS) {
      const m = re.exec(part);
      if (m && /\d/.test(part.slice(m.index + m[0].length, m.index + m[0].length + 30))) seen.add(name);
    }
  }
  return seen.size >= 3;
}

/** Pure: whether the value fits the variable and the evidence is a sentence. */
export function judgeEventQuality(e: { variable: string; before: string | null; after: string | null; unit: string | null; evidence_text: string }): 'sentence' | 'chart' | 'unit_mismatch' {
  const ev = e.evidence_text || '';
  // ── A MIS-FILED VALUE IS MIS-FILED WHATEVER IT WAS READ FROM.      (zzz763)
  //
  // zzz755 judged CHART before the unit rules, on the reasoning that a chart
  // figure is weak rather than wrong. But a chart axis is exactly where the
  // worst mis-filings come from, and "chart" was letting them through: the
  // REDINGTON row "utilisation 37 → 32" was a WORKING-CAPITAL-DAYS chart
  // ("Q1FY27 Working Capital Days 37 30 32"), and DEEPAKNTR's ">175% Phenol
  // and Acetone Production" was a three-word axis label that no sentence
  // about utilisation would have passed. The value test now runs first; a
  // chart is a chart only if its value could be this variable's at all.
  if (!valueFitsVariable(e)) return 'unit_mismatch';
  const words = (ev.match(/[A-Za-z]{3,}/g) || []).length;
  const figures = (ev.match(/\d[\d,.]*%?/g) || []).length;
  if (words < 5 || figures > words) return 'chart';
  return 'sentence';
}

// ── THE UNIT RULES APPLY TO EVERY ROW, NOT ONLY THE TYPED ONES.     (zzz762)
//
// `judgeEventQuality` guarded the events path and nothing else. The summary's
// loose blocks — `utilisation`, `order_book`, `capex_earning` — were pushed
// onto the board unchecked, and when an event WAS rejected here its key never
// entered `covered`, so the summary re-pushed the same value one step later.
// The live page carried REDINGTON "utilisation −14%", DEEPAKNTR ">175%", SFL
// "30 days inventory" and RATEGAIN "capex earning 78.8%" through exactly that
// gap. The value test is now its own function so both paths ask it.
/** Pure: whether the VALUE fits the variable it is filed under. */
export function valueFitsVariable(e: { variable: string; before: string | null; after: string | null; unit: string | null; evidence_text: string }): boolean {
  const ev = e.evidence_text || '';
  const valueText = `${e.before || ''} ${e.after || ''}`;
  const v = e.variable;
  // ── A ROW OF A TABLE IS NOT A VALUE.                              (zzz769)
  // ULTRAMAR order intake "584 86403 27.6 27.6 1", LCL installed capacity
  // "240/13,800/108,000": three or more bare figures with nothing naming any
  // of them. Whatever variable they were filed under, nobody can say which
  // figure is which.
  if (isNumberRow(e.before) || isNumberRow(e.after)) return false;
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
      // A chart has no sentence to name the variable (E2E's slide is a run
      // of tick marks), so the wording test applies to sentences only; the
      // VALUE rules below apply to both.
      const words = (ev.match(/[A-Za-z]{3,}/g) || []).length;
      const figures = (ev.match(/\d[\d,.]*%?/g) || []).length;
      const chartShaped = words < 5 || figures > words;
      const saysUtilisation = /utilis|utiliz|operating at|running at|occupancy|load factor|\bCUF\b|\bPLF\b|capacity|full|maximum|peak|sold out/i.test(ev);
      if (!chartShaped && !saysUtilisation) return false;
      // "We are already operating at 18% margins" matched "operating at" and
      // filed a MARGIN as LUMAXTECH's utilisation. A sentence about margin,
      // EBITDA, profit, growth or a share of sales is not about a fill rate
      // unless it also says so in as many words. (zzz763)
      if (!chartShaped && /margin|ebitda|profit|\bPAT\b|growth|share of|contribution|wallet|export/i.test(ev) && !/utilis|utiliz|\bCUF\b|\bPLF\b|occupancy|load factor/i.test(ev)) return false;
      // A duration is never a fill rate: "37 days", "4 to 6 months". The
      // unit field and the value text are both checked, because the model
      // fills one or the other. (zzz763)
      if (/\b(days?|months?|weeks?|years?|hours?)\b/i.test(`${e.unit || ''} ${valueText}`)) return false;
      // A number described as savings, margin, growth or a share of sales is
      // not a fill rate: TI's "60%-70% of planned Prag bottling savings".
      // Checked before the percentage test, which would otherwise pass it.
      if (/saving|margin|revenue|growth|share|contribution|ebitda|of planned|benefit/i.test(valueText) && !/utilis|utiliz/i.test(valueText)) return false;
      const pctMatch = valueText.match(/-?\d+(?:\.\d+)?(?:-odd)?\s*(%|per ?cent)/i);
      if (pctMatch) {
        const n = parseFloat(pctMatch[0]);
        // Below zero is impossible. Above 130 is a growth figure — unless the
        // SENTENCE says utilisation in as many words: DEEPAKNTR "operating at
        // about 170-odd percent utilization" is a de-bottlenecked plant, and
        // the row carries the above-nameplate note for it. (zzz763)
        // The sentence counts too, when it is a sentence (zzz770): an
        // above-100% figure then reaches the board as UNCLEAR — validation
        // required — instead of vanishing.
        const explicit = /utilis|utiliz/i.test(valueText) || (!chartShaped && /utilis|utiliz/i.test(ev));
        if (!(n >= 0 && n <= (explicit ? 300 : 130))) return false;
        return true;
      }
      // Words that state a fill level. "nearly doubling" is not one of them,
      // a period label ("Q4 FY26") is not a value at all, and neither is
      // money, a day count or a sentence about construction. (zzz772)
      return isUtilisationValue(String(e.after || e.before || '').trim() || valueText);
    }
    // ── EXPORTS ARE ABOUT EXPORTS.                                  (zzz772)
    // GOLDIAM "Exports 87.8% → 90.7%" came from "Lab-grown share rose to 90.7%
    // from 87.8%": a product-mix share. A sentence filed under exports has to
    // say export / overseas / international / geography; the summary's own
    // exports slot ("Exports / geography: …") is that slot by construction.
    if (v === 'exports' && !/^\s*Exports \/ geography:/i.test(ev)
      && !/export|overseas|international|geograph|foreign|abroad|outside india|domestic (?:and|vs\.?|versus)/i.test(`${valueText} ${ev}`)) return false;
    // A product's share OF export sales ("lab-grown exports contributed 90.7%
    // to the overall export sales mix") is a mix inside exports, not the
    // export share of the business. (zzz772)
    if (v === 'exports' && /\d\s*%\s*(?:to|of|in)\s+(?:the\s+)?(?:overall\s+|total\s+|our\s+)?export(?:s)?\s*(?:sales\s*)?(?:mix|sales|revenue|basket|portfolio)/i.test(ev)) return false;
    if (PCT_VARS.has(v)) return /%|per ?cent|pp\b|full|maximum|peak|near|shift|high|low|double|single/i.test(valueText) || /%/.test(String(e.unit || ''));
    // A capacity stated only in money is a capex figure filed under the
    // wrong name: EXICOM "installed capacity USD100 million", AZAD
    // "INR150 crores per plant". Money is not capacity — and neither is a
    // bare percentage (GESHIP "installed capacity About 25-26%").
    if (CAPACITY_VARS.has(v)) {
      if (CURRENCY_RE.test(valueText)) return false;
      // ── A ROOFTOP SOLAR PLANT IS NOT PRODUCTION CAPACITY.         (zzz769)
      // TATVA "155 kW rooftop solar", MENONBE "3,870 kWp", SOTL "2,061 kWp",
      // EMIL "187 kW": captive power in kilowatts, not what the company
      // makes. MW / GW stay — for a solar company that IS the capacity.
      if (/\d\s*kWp?\b|\bkWp?\b/i.test(valueText)) return false;
      if (/rooftop/i.test(valueText) && !/\b(MW|GW)p?\b/i.test(valueText)) return false;
      // "We continue to invest in talent, capacity, and inventory" (AVALON),
      // "Creation of Additional capacity to meet Anticipated demand"
      // (JAMNAAUTO), "meaningful incremental capacity" (SHILPAMED): an
      // addition with no figure and no asset is an intention, not a plant.
      if (v === 'capacity_addition' && !/\d/.test(valueText) && !NUMBER_WORD_RE.test(valueText) && !CONCRETE_ASSET_RE.test(valueText)) return false;
      if (/%/.test(valueText) && !CAPACITY_UNIT_RE.test(valueText)) return false;
      // ── A MAGNITUDE IS NOT A UNIT.                               (zzz759)
      //
      // HONASA carried "Installed capacity 24,785 Mn". Twenty-four thousand
      // million OF WHAT? "Mn" is a multiplier, not a thing you can hold a
      // capacity in, and a figure that names only a scale is almost always a
      // money or a count lifted out of a financial table. zzz755 deliberately
      // removed million/bn from the currency test so GESHIP's genuine "60
      // million sq. ft." would survive — and it still does, because it names
      // square feet. A bare count with no magnitude word ("42,000") also
      // survives: it is unlabelled, not mis-filed.
      if (MAGNITUDE_ONLY_RE.test(valueText) && !CAPACITY_UNIT_RE.test(valueText)) return false;
      return true;
    }
    // ── AN AMOUNT SPELLED OUT IN WORDS IS A LEGAL CLAUSE.          (zzz758)
    //
    // UNIVCABLES carried "Working capital ₹1,20,000/- (Rupees One Lakh Twenty
    // Thousand only)". That is a director's sitting fee out of a board
    // resolution, not a working-capital position — the "/-" and the amount in
    // words are the signature of a contractual instrument, and no listed
    // company's working capital is one lakh twenty thousand rupees.
    if (/\(\s*(rupees|rs\.?|inr|us dollars?|dollars?)\b[^)]*\bonly\s*\)/i.test(valueText + ' ' + ev)
      || /\d\s*\/-/.test(valueText)) return false;
    // ── CAPEX IS MONEY.                                            (zzz769)
    // MOREPENLAB "57012.81", LCL "5 to 6 months", ANTELOPUS "recovered in
    // under 12 months", SBCL "approval is valid until June 30, 2032", SFL
    // "about 42 stores are in operation", CLEANMAX "419 MWp", AVALON "10x":
    // a figure with no money in it is a duration, a count, a capacity or a
    // multiple — not a capital spend. A status may be stated in words
    // ("Phase 1 commissioned in Q3 FY26") and keeps that latitude.
    if (v === 'capex' || v === 'capex_status') {
      if (/\b(barrels?|casks?)\b/i.test(valueText)) return false;
      if (/\b(cash|bank) balances?\b/i.test(valueText)) return false;
      if (/\bexpenses?\b|\bopex\b/i.test(valueText) && !/capex|capital|invest|plant|project|expansion/i.test(valueText)) return false;
      const money = /₹|\bINR|\bRs\.?|\bUSD|\$|\bEUR|€|crores?|\bcrs?\b|\d\s*crs?\b|lakhs?|\bmn\b|\d\s*mn\b|millions?|\bbn\b|\d\s*bn\b|billions?|%|`\s*\d|!\s*\d/i.test(valueText);
      const statusWords = v === 'capex_status'
        && /commission|complet|progress|under construction|construct|ramp|trial|phase|on track|on schedule|delay|started|commenced|operational|awarded|ordered|installed|approved|tendered|mobili/i.test(valueText);
      // A period label is not a figure: "no significant capex during FY27"
      // is a statement, not a number without a unit.
      const figures = valueText.replace(/\b(FY|CY|H[12]|Q[1-4])\s*'?\d{2,4}\b/gi, ' ');
      if (/\d/.test(figures) && !money && !statusWords) return false;
      // ── CAPEX IS AN AMOUNT.                                      (zzz772)
      // EMCURE "(announced) remain at similar levels", ETHOSLTD "City of Time
      // Gurgaon": a capex value with no amount in it says nothing a capex
      // row can hold. The status variable keeps its words; capex does not.
      // A stated absence of capex ("we did not foresee any significant core
      // business capex during FY27") is an amount — zero — and stays.
      if (v === 'capex' && !money && !/\b(no|not|nil|zero|without|don'?t|do not|did not)\b[^.]{0,50}\b(capex|capital expenditure|investment)\b/i.test(valueText)) return false;
    }
    // A bottleneck is a constraint, not a sum: VIJAYA "close to INR 10
    // crores" names nothing that is constrained. (zzz769)
    if (v === 'capacity_bottleneck' && CURRENCY_RE.test(valueText)
      && !/[A-Za-z]{3,}/.test(valueText.replace(/₹|\bINR\b|\bRs\.?|\bUSD\b|crores?|\bcr\b|lakhs?|millions?|\bmn\b|billions?|\bbn\b|\b(close to|about|around|approx(imately)?|nearly|roughly|over|under|up to|of)\b/gi, ' '))) return false;
    if (v === 'execution_delay') return /delay|postpone|behind schedule|slip|deferr|later than|pushed|rescheduled|extended timeline|\bpaus(e|ed|ing)\b/i.test(ev);
    if (v === 'shutdown') return /shut ?down|closure|outage|maintenance|halt/i.test(ev);
    if (v === 'capacity_bottleneck' || v === 'supply_bottleneck') return /bottleneck|constrain|shortage|limited by|unable to|sold out|waiting/i.test(ev);
    // "Is the capex earning yet?" is answered in words — utilisation of the
    // new asset, revenue from it, "ramping", "below plan". RATEGAIN carried a
    // bare "78.8%" here: a figure with no noun is not an answer to that
    // question, whatever it was a percentage of. (zzz762)
    if (v === 'capex_earning') return /[A-Za-z]{3,}/.test(valueText);
    // ── VALUES THAT CANNOT BE THIS VARIABLE.                          (zzz764)
    // Counts of dealers or stores are not a volume sold (SFL "10,000
    // dealers"); a share of sales is not a volume (UNIPARTS "about 56%" was
    // the warehouse-sales proportion); a percentage is not a customer
    // (REDINGTON "New customer 52%"); a book or an intake has a number in it
    // ("far more" is not an order book); a one-off is money or an item
    // (ANTELOPUS "c.6,500 bopd").
    if (v === 'volume') {
      if (/dealers?|stores?|outlets?|boutiques?|customers?|users?|artistes?|employees?/i.test(valueText)) return false;
      // A bare percentage is a volume only when it is a GROWTH: "volumes
      // increased by 172%". "Warehousing sales was roughly at about 56%" is a
      // share of sales.
      const bareAfter = String(e.after || '').replace(/\b(roughly|about|approximately|around|at|nearly|~)\b/gi, '').trim();
      if (/^[+-]?[\d.]+\s*%$/.test(bareAfter)
        && (!/increas|grew|growth|grow|rose|up\b|declin|fell|down\b|yoy|year[- ]on[- ]year|y-o-y|qoq/i.test(ev)
          || /share|proportion|of (total )?(revenue|sales)|contribut/i.test(ev))) return false;
    }
    if (v === 'new_customer' && /^\s*[+-]?[\d.]+\s*%\s*$/.test(String(e.after || ''))) return false;
    // Working capital is days, money, a ratio or a cycle. Operating cash
    // flow is not working capital (IKS), and barrels are not either
    // (ANTELOPUS "c.6,500 boepd").
    if (v === 'working_capital') {
      if (/cash flow|\bOCF\b|\bFCF\b/i.test(valueText)) return false;
      if (/\d/.test(valueText) && !/days?|cycle|₹|\bINR|\bRs\.?|`|crores?|\bcr\b|lakhs?|million|\bmn\b|billion|\bbn\b|%|\d\s*x\b|\bx\b|times|turn/i.test(valueText)) return false;
    }
    if ((v === 'order_book' || v === 'order_intake') && !/\d/.test(valueText)) return false;
    // A value per share is a dividend or an EPS, not working capital
    // (CASTROLIND "INR6.25 per share"). (zzz769)
    if (v === 'working_capital' && /per share|\/\s*share\b/i.test(valueText)) return false;
    // A new customer is a name, not a contract window: MOREPENLAB "20 th
    // October 2026 to 19 th October 2029". (zzz769)
    if ((v === 'new_customer' || v === 'guidance') && isDateOnly(valueText)) return false;
    // A results table filed as guidance or a target (TBZ). (zzz772)
    // A forward line with three targets ("revenue ₹1,000 Cr, EBITDA ₹200 Cr
    // and PAT ₹100 Cr by FY28") is still guidance: it says so.
    if ((v === 'guidance' || v === 'management_target') && isResultsTable(valueText) && !FORWARD_WORD_RE.test(valueText)) return false;
    // ── A RESULT IS NOT GUIDANCE.                                    (zzz769)
    // SAREGAMA "Music Revenue at INR 2,306 Mn registered 39% YoY growth";
    // TBZ "Revenue from Operations at ₹ 8,409.74 million (up 34.8% YoY)" —
    // the quarter that was, filed as a forward statement, and TBZ's printed
    // "▲ Guidance confirmed". A guidance value must look forward.
    if (v === 'guidance'
      && (/\b(registered|reported|recorded|achieved|delivered|posted)\b/i.test(valueText) || /\(\s*(up|down)\s+[\d.]+\s*%\s*(yoy|y-o-y|year[- ]on[- ]year|qoq)\s*\)/i.test(valueText))
      && !FORWARD_WORD_RE.test(valueText)) return false;
    // A fund-raise utilisation table is not a P&L one-off (E2E "Total raised
    // 15,919.34 Mn and utilized till FY26"). (zzz769)
    if (v === 'one_offs' && /\braised\b|\butili[sz](ed|ation)\b|\bproceeds\b|\bIPO\b|\bQIP\b/i.test(valueText)
      && !/one[- ]?off|one[- ]time|exceptional|non[- ]recurring|write[- ]?back|impairment|gain on|loss on|profit on sale/i.test(valueText)) return false;
    if (v === 'one_offs' && /\d/.test(valueText)
      && !/₹|\bINR|\bRs\.?|\bUSD|\$|crores?|\bcr\b|lakhs?|million|mn\b|billion|bn\b|items?|`/i.test(valueText)) return false;
    // A one-off is an ITEM in the P&L. Revenue for the year (VADILALIND
    // "Revenue from Operations of ₹1,109.54 crore"), operating cash flow
    // (REDINGTON "Operating cash flows remained positive at ₹231 Crores")
    // and a planned investment (CUPID "Planned investment of ₹331.53 Cr")
    // are not one-offs, whatever the model filed them under. (zzz765)
    if (v === 'one_offs' && !/one[- ]?off|one[- ]time|exceptional|non[- ]recurring|write[- ]?back|reversal|impairment|forex|foreign exchange|tax (reversal|benefit|credit|refund)|insurance claim|gain on (sale|disposal)|loss on (sale|disposal)|profit on sale|earn[- ]?out|\bvrs\b|settlement|arbitration|refund|provision|fair value|mark[- ]to[- ]market|\bmtm\b|other income|extraordinary|discontinued/i.test(ev)) return false;
    // A headline figure named right before the value is that figure, not an
    // item: IKS "PAT … coming in at INR193 crores, which … adjusted for the
    // one-time costs" and "33% EBITDA at INR294 crores". (zzz767)
    if (v === 'one_offs') {
      const val = String(e.after || e.before || '').trim();
      const at = val ? ev.indexOf(val) : -1;
      if (at > 0) {
        const pre = ev.slice(Math.max(0, at - 80), at);
        if (/\b(PAT|net profit|profit after tax|EBITDA|revenue|sales|turnover|topline)\b/i.test(pre)
          && !/one[- ]?off|one[- ]time|exceptional|non[- ]recurring|write[- ]?back|reversal|impairment|refund|provision|gain on|loss on|other income|expenses? of|costs? of/i.test(pre)) return false;
      }
    }
    // Any one-off without one-off vocabulary is a line read off a table
    // ("INR 16,818.00" from a "Total income" chart row) — never an item. (zzz767)
    // "Reduced the debt by about 10 crores" is a repayment, not capex
    // (PICCADIL printed ▼ Capex). "Revenue reaching INR1,300 crore" is
    // revenue, not a volume (JUBLINGREA). (zzz768)
    if ((v === 'capex' || v === 'capex_status') && /(reduc\w*|repa(y|id)\w*|pa(id|y)[ -]?(down|off))[^.]{0,30}\bdebt|\bdebt\b[^.]{0,30}(reduc|repa|pa(id|y)[ -]?(down|off))/i.test(valueText)
      && !/capex|capital expenditure|invest(ed|ment)|spent|deploy/i.test(valueText)) return false;
    // A bank facility is financing, not capex and not working capital:
    // MOREPENLAB "unsecured term loan facilities aggregating ₹13,000 lakhs"
    // (filed as capex) and "repaid secured working capital facilities
    // aggregating ₹9,900 lakhs" (filed as working capital). (zzz770)
    if ((v === 'capex' || v === 'capex_status' || v === 'working_capital')
      && /\b(term loans?|loan facilit\w*|(?:working capital|credit|banking|secured|unsecured) facilit\w*|borrowings?|debentures?|\bWCDL\b|cash credit|demand loan)\b/i.test(`${valueText} ${String((e as any).evidence_text || '')}`)
      && !/capex|capital expenditure|spent|deployed|days|cycle|receivable|inventor|debtor|payable/i.test(`${valueText} ${String((e as any).evidence_text || '')}`)) return false;
    if (v === 'volume' && /₹|\bINR|\bRs\.?|crores?|\bcr\b|revenue|sales of/i.test(String(e.after || ''))
      && !/tonn?e|\bmt\b|units?|litre|liter|\bkl\b|pieces|pcs|sq ?ft|mw|volume/i.test(String(e.after || ''))) return false;
    // "15 megawatt hours of orders in hand" is an ORDER, not a volume sold.
    // EXICOM printed it as "Volume 15 MWh". (zzz763)
    if (v === 'volume' && /orders? (in hand|book|backlog|intake)|pipeline|backlog|order book/i.test(ev)
      && !/sold|dispatch|produc|sales volume|volumes? (grew|rose|increas|declin|fell)|deliver/i.test(ev)) return false;
    // An order book is a stock of money or units. A bare growth rate filed
    // as the book itself ("+22%") is the change wearing the level's label.
    if (v === 'order_book') {
      const after = String(e.after || '').trim();
      if (after && /^[+-]?\d+(?:\.\d+)?\s*(%|pp|bps)$/i.test(after)) return false;
      // An order book whose only figure is a share is a mix, not a book:
      // LUMAXIND "88% LED". (zzz769)
      const nums = valueText.match(/\d[\d,.]*\s*%?/g) || [];
      if (nums.length && nums.every((x) => /%/.test(x))) return false;
      return true;
    }
    return true;
  })();
  return unitOk;
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
  // The first FIGURE, not the "1" of a "Q1 FY26:" label. (zzz772)
  const b = e.before ? numberTokens(stripPeriodTokens(e.before) || e.before)[0] : null;
  const a = e.after ? numberTokens(stripPeriodTokens(e.after) || e.after)[0] : null;
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
// ── WHICH DOCUMENT WINS WHEN TWO DISAGREE.                         (zzz759)
//
// SPECTRUM's card read "3.0 MW" in WHAT CHANGED while the board showed
// "3.3 MW" — two documents from the same quarter stating the same capacity
// differently, and the tie was broken by which event happened to be parsed
// first. That is not a rule, it is an accident.
//
// The order below is about how a figure is PRODUCED, not about how much the
// document is worth overall. A results filing and an investor deck are
// written, checked and signed; a concall is a person speaking, and a person
// rounds — "about three megawatts" becomes 3.0 against a filed 3.3. So for a
// FIGURE the written document wins, even though the transcript is usually the
// richer read for causes and colour.
//
// AND THE TIE IS NEVER BROKEN SILENTLY. The losing value travels with the
// variable as a conflict, because two sources disagreeing about a number is
// itself something the owner should see.
export function sourceTier(source: string | null | undefined): number {
  const s = String(source || '').toLowerCase();
  if (/result|financial statement|outcome of board|regulation 33|annual report/.test(s)) return 0;
  if (/investor|presentation|deck|fact ?sheet/.test(s)) return 1;
  if (/press release|media release|intimation|announcement/.test(s)) return 2;
  if (/transcript|concall|con-?call|earnings call|audio/.test(s)) return 3;
  return 4;
}

export interface VariableSlot {
  actual: StructuralEvent | null;
  forward: StructuralEvent | null;
  /** Other ACTUAL readings of the same variable whose value differs from the
   *  one that won. Empty when the sources agree. */
  conflicts: StructuralEvent[];
}

const sameValue = (a: StructuralEvent, b: StructuralEvent) =>
  String(a.after ?? a.before ?? '').trim().toLowerCase()
  === String(b.after ?? b.before ?? '').trim().toLowerCase();

const VALUE_RANK: Record<ValueType, number> = { ACTUAL: 0, GUIDANCE: 1, TARGET: 2, MANAGEMENT_CLAIM: 3 };
const CONF_RANK: Record<Confidence, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/** The shape both selectors rank on. An EvidenceFact in the ledger maps onto
 *  it too, so the board and WHAT CHANGED can never pick different winners. */
export interface RankableReading {
  value_type: ValueType;
  before: string | null;
  source: string | null | undefined;
  confidence: Confidence;
  /** The later value. A `before` counts as a comparison only with an `after`
   *  beside it — TI's "it was around 21.5 million cases when we acquired the
   *  business" is a past level, and it beat "volumes increased by 172%". */
  after?: string | null;
  /** 'sentence' | 'chart' — a sentence beats a chart whatever the source tier.
   *  UNIMECH's annual-report chart ("52%") outranked the transcript's
   *  "approximately 58%" on tier alone while WHAT CHANGED, which skips
   *  charts, showed 58%. (zzz763) */
  quality?: 'sentence' | 'chart' | 'unit_mismatch';
}

// ── ONE RANKING, USED EVERYWHERE A WINNER IS PICKED.               (zzz762)
//
// The board picked its figure with this ordering; WHAT CHANGED picked its own
// with confidence alone and first-wins. Same quarter, same variable, two
// answers: UNIMECH showed 52% on the board and 58% in the change list,
// SONACOMS 237bn against 8bn. Exported so the ledger uses the same comparator.
//
// Source tier sits AFTER the before-presence test on purpose: an event that
// carries both sides of a move gives a comparison, and a comparison is worth
// more than a tier. Tier decides between readings of the same shape, which
// is exactly the SPECTRUM case — two bare levels.
const QUALITY_RANK = { sentence: 0, chart: 1, unit_mismatch: 2 } as const;
export function betterReading(a: RankableReading, b: RankableReading): number {
  return (VALUE_RANK[a.value_type] - VALUE_RANK[b.value_type])
    || (QUALITY_RANK[a.quality || 'sentence'] - QUALITY_RANK[b.quality || 'sentence'])
    || ((a.before && a.after !== null ? 0 : 1) - (b.before && b.after !== null ? 0 : 1))
    // A reading with a figure beats one without: E2E's "~5,100 GPUs live"
    // lost to "we deployed NVIDIA's newest generation of B200 clusters". (zzz765)
    || ((/(?<![A-Za-z\d])\d/.test(String(a.after ?? '')) ? 0 : 1) - (/(?<![A-Za-z\d])\d/.test(String(b.after ?? '')) ? 0 : 1))
    || (sourceTier(a.source) - sourceTier(b.source))
    || (CONF_RANK[a.confidence] - CONF_RANK[b.confidence]);
}

export function bestEventPerVariable(events: StructuralEvent[]): Map<VarKey, VariableSlot> {
  const better = (a: StructuralEvent, b: StructuralEvent) =>
    betterReading({ ...a, quality: judgeEventQuality(a) }, { ...b, quality: judgeEventQuality(b) });
  const out = new Map<VarKey, VariableSlot>();
  const actualsSeen = new Map<VarKey, StructuralEvent[]>();
  for (const e of events) {
    const slot = out.get(e.variable) || { actual: null, forward: null, conflicts: [] };
    const isForward = e.value_type === 'GUIDANCE' || e.value_type === 'TARGET';
    if (isForward) {
      if (!slot.forward || better(e, slot.forward) < 0) slot.forward = e;
    } else {
      const seen = actualsSeen.get(e.variable) || [];
      seen.push(e);
      actualsSeen.set(e.variable, seen);
      if (!slot.actual || better(e, slot.actual) < 0) slot.actual = e;
    }
    out.set(e.variable, slot);
  }
  for (const [k, slot] of out) {
    const winner = slot.actual;
    if (!winner) continue;
    slot.conflicts = (actualsSeen.get(k) || [])
      .filter((e) => e !== winner && e.value_type === 'ACTUAL' && winner.value_type === 'ACTUAL'
        && !sameValue(e, winner)
        // A different SHAPE is not a disagreement: a before→after move and a
        // bare level are two readings of one quarter, not two answers.
        && (!!e.before === !!winner.before));
  }
  return out;
}

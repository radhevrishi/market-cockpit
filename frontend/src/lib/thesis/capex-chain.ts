// ═══════════════════════════════════════════════════════════════════════════
// THE CAPEX CHAIN — DID THE MONEY ACTUALLY EARN?                    (zzz715)
//
// The owner's point, and it is the sharpest one in his specification: a
// company announces ₹1,000 Cr of capex and the market becomes excited that
// day. The excitement is about the ANNOUNCEMENT. Nobody goes back two years
// later and checks whether the plant produced the earnings that justified it.
//
// So capex is not an event here. It is a CHAIN with a state:
//
//   CAPEX → CAPACITY → COMMISSIONING → UTILISATION → REVENUE → MARGIN → ROCE
//
// and the state says which link the money has actually reached. The three
// states that matter are the ones he named:
//
//   COMMISSIONED, NOT YET EARNING   plant is built, utilisation is low,
//                                   revenue and margin have not moved
//   STARTING TO EARN                utilisation rising, revenue and margin
//                                   following it
//   DISAPPOINTMENT                  built, and utilisation has NOT moved
//                                   while revenue is weak — the money is in
//                                   the ground and the earnings never came
//
// WHY "ANNOUNCED" IS NOT A GOOD STATE. It is the state with the least
// information in the whole chain and the most excitement attached to it, and
// separating those two is most of what this module is for.
//
// THE HONEST LIMIT, stated on screen rather than hidden: this reads ONE
// filing. A real chain needs the same company across several quarters, which
// arrives as the guidance ledger accumulates. Until it has two points, the
// state is inferred from the single filing's own before/after figures — which
// the filings do give, because utilisation is usually disclosed as prior and
// current — and anything it cannot see is reported as not yet checkable
// rather than guessed.
// ═══════════════════════════════════════════════════════════════════════════

import { said, type StructuralVar, type VarKey } from './variables';
import type { CompanyLedger } from './evidence-ledger';
import { periodOrdinal } from './evidence-ledger';
import { normalizeEvent, hasQuantity, periodEnd } from './fact-normalize';
import { capacityMismatch, isCapacityFigure } from './fact-model';
import { capexFigureOk } from './figure-guards';

export type CapexState =
  | 'none'
  | 'announced'
  | 'under_construction'
  | 'commissioned_not_earning'
  | 'starting_to_earn'
  | 'earning'
  | 'disappointment'
  | 'unverifiable';

export const CAPEX_META: Record<CapexState, { label: string; color: string; dot: string; meaning: string }> = {
  none: { label: 'No capex on file', color: 'var(--mc-verdict-absent, #64748B)', dot: '○',
    meaning: 'The latest filing discloses no capital programme.' },
  announced: { label: 'CAPEX ANNOUNCED', color: 'var(--mc-verdict-flat, #94A3B8)', dot: '📋',
    meaning: 'Money committed against a promise. Nothing has been proven yet — this is the state with the most excitement and the least information.' },
  under_construction: { label: 'UNDER CONSTRUCTION', color: 'var(--tc-accent, #60A5FA)', dot: '🏗',
    meaning: 'Being built. The date to hold management to is the commissioning date.' },
  commissioned_not_earning: { label: 'COMMISSIONED — NOT YET EARNING', color: 'var(--mc-verdict-warn, #F59E0B)', dot: '🟡',
    meaning: 'The plant exists and utilisation is still low. This is normal early, and it is also what a disappointment looks like at the start. The next two quarters separate them.' },
  starting_to_earn: { label: 'STARTING TO EARN', color: 'var(--mc-verdict-up, #34D399)', dot: '🟢',
    meaning: 'Utilisation is rising and revenue is following. The capex is converting.' },
  earning: { label: 'EARNING', color: 'var(--mc-verdict-up, #10B981)', dot: '✅',
    meaning: 'Utilisation high, revenue and margin both moved. The money produced the earnings.' },
  disappointment: { label: 'CAPEX DISAPPOINTMENT', color: 'var(--mc-verdict-down, #EF4444)', dot: '🔴',
    meaning: 'Commissioned, and utilisation has not moved while revenue is weak. The money is in the ground and the earnings did not come.' },
  unverifiable: { label: 'CAPEX — CANNOT BE CHECKED', color: 'var(--mc-verdict-absent, #64748B)', dot: '◌',
    meaning: 'A capital programme is disclosed but the filing gives no utilisation or capacity figures, so whether it is earning cannot be established from this document.' },
};

export interface CapexChain {
  state: CapexState;
  /** The chain, link by link, with what is known at each. */
  links: Array<{ name: string; value: string | null; known: boolean }>;
  projects: Array<{ name: string; amount: string | null; capacity: string | null; completes: string | null; earnsFrom: string | null }>;
  because: string;
  /** What would settle the open question. Empty when the chain is complete. */
  nextCheck: string | null;
  /** ── THE LIFECYCLE ACROSS QUARTERS.                          (zzz765)
   *  One entry per reporting period on file, oldest first. A later quarter
   *  adds a layer; it never erases the earlier one. */
  lifecycle?: LifecycleEntry[];
  /** Furthest stage the evidence has reached, across every period. */
  stage?: CapexStage | null;
  /** "Capex earning yet?" as a STRUCTURED state, never a dash. (zzz771) */
  earning: CapexEarning;
  /** Project-by-project lifecycle, announced → … → ROCE / FCF. (zzz770) */
  lifecycleProjects?: CapexProject[];
  /** zzz784: ONE normalized construction / operational state across every
   *  project. The status narrative, the capex row and Special Focus all read
   *  this, so no card says "producing" in one line and "under construction"
   *  in another for the same programme. */
  build?: CapexBuild | null;
}

// ── CONSTRUCTION STATUS ≠ ECONOMIC STATUS.                            (zzz784)
// ETHOSLTD read "capex status: commercial production (producing)" in its
// summary and "Capex earning: NOT STARTED — UNDER CONSTRUCTION" in its capex
// row — one programme, two states. Two questions, answered separately and once:
//   BUILD    announced · under construction · commissioned · commercial production
//   ECONOMIC not yet earning · partially contributing · contributing
// With several projects the answer names each ("multiple projects: A —
// commercial production; B — under construction"), never one for all.
export type BuildState = 'announced' | 'under construction' | 'commissioned' | 'commercial production' | 'operating' | 'opened';
export interface CapexBuild {
  projects: Array<{ name: string; build: BuildState; note: string | null }>;
  anyOperating: boolean;
  mixed: boolean;
  /** "commercial production (City of Time Gurgaon)" or "multiple projects: …". */
  text: string;
}
const BUILD_RANK: Record<BuildState, number> = { announced: 0, 'under construction': 1, commissioned: 2, 'commercial production': 3, operating: 3, opened: 3 };
/** A store / boutique / showroom (or a floor area with no plant word) opens;
 *  it is never "commissioned" or in "commercial production". (zzz784) */
const NETWORK_ASSET = /\b(boutiques?|stores?|showrooms?|outlets?|clinics?|hospitals?|branch(?:es)?|malls?|restaurants?|flagship)\b/i;
const isNetworkAsset = (p: CapexProject) => NETWORK_ASSET.test(`${p.name} ${p.capacity_added || ''}`)
  || (/\b(sq\.? ?ft|square feet)\b/i.test(String(p.capacity_added || '')) && !/plant|factory|facility|line|unit|works|park|hangar|lab/i.test(p.name));
export const isOperatingBuild = (b: BuildState) => BUILD_RANK[b] >= 2;
export function capexBuild(projects: CapexProject[]): CapexBuild | null {
  const named = projects.filter((p) => p.name !== 'Capacity and capex not tied to a named project');
  const use = named.length ? named : projects;
  if (!use.length) return null;
  const st = (p: CapexProject, s: LifecycleStep) => p.steps.find((x) => x.step === s)?.state;
  const rows = use.map((p) => {
    const build: BuildState = st(p, 'COMMERCIAL_PRODUCTION') === 'actual' ? 'commercial production'
      : st(p, 'REVENUE_CONTRIBUTION') === 'actual' ? 'operating'
        : st(p, 'COMMISSIONED') === 'actual' || st(p, 'COMMISSIONED') === 'implied' ? 'commissioned'
          : p.underConstruction || st(p, 'SPENT') === 'actual' || st(p, 'COMMISSIONED') === 'target' || st(p, 'CAPACITY_CREATED') === 'target' ? 'under construction'
            // A utilisation line matched to the project by name, with no
            // construction step against it, says it is running.
            : st(p, 'UTILISATION') === 'actual' ? 'operating'
            // Capacity created with no stated construction step (a company-wide
            // "capacity added") is built: it exists.
            : st(p, 'CAPACITY_CREATED') === 'actual' ? 'commissioned'
              : 'announced';
    const net = isNetworkAsset(p) && isOperatingBuild(build);
    return { name: p.name, build: net ? 'opened' as BuildState : build, note: p.statusConflict || (net ? 'a store / network asset — opened, not production capacity' : null) };
  });
  const kinds = new Set(rows.map((r) => r.build));
  const mixed = rows.length > 1 && kinds.size > 1;
  const one = (r: { name: string; build: BuildState; note: string | null }) => `${r.name} — ${r.build}${r.note ? ` (${r.note})` : ''}`;
  const text = rows.length === 1 ? `${rows[0].build} (${rows[0].name}${rows[0].note ? `; ${rows[0].note}` : ''})`
    : mixed ? `multiple projects: ${rows.map(one).join('; ')}`
      : `${rows.length} projects, all ${rows[0].build}: ${rows.map((r) => `${r.name}${r.note ? ` (${r.note})` : ''}`).join('; ')}`;
  return { projects: rows, anyOperating: rows.some((r) => isOperatingBuild(r.build)), mixed, text };
}
/** The economic answer in words, separate from the build state. (zzz784) */
export const ECONOMIC_WORD: Record<CapexEarningState, string> = {
  NOT_STARTED: 'not yet earning (not built)',
  SPENT_NOT_EARNING: 'not yet earning — no revenue attributed to it',
  PARTIAL: 'partially contributing — revenue attributed, margin not yet',
  EARNING: 'contributing — revenue and margin attributed',
  UNKNOWN: 'cannot be established from the documents read',
};

// ── "CAPEX EARNING YET?" IS NOT A YES/NO QUESTION.                  (zzz771)
//
// The owner's verdict on the previous version: the card printed "— Capex
// earning" even where the filing said the plant was already contributing
// revenue. Binary was the problem — INNOVACAP's Jammu plant is contributing
// ₹107 crore of revenue at ~30% utilisation while management says the margin
// contribution comes later. That is neither "earning" nor "not earning"; it
// is PARTIAL, and the card has to say WHICH links of the chain the filing has
// evidenced and which it has not.
//
// Five states, each derived only from what the documents state:
//
//   NOT_STARTED         announced (or being built); nothing spent-and-running
//   SPENT_NOT_EARNING   spent / commissioned / producing, and the filing
//                       attributes NO revenue to it
//   PARTIAL             revenue attributed, but margin (or utilisation) is
//                       still pending — the money is earning, not yet fully
//   EARNING             revenue attributed AND margin / ROCE contribution stated
//   UNKNOWN             cannot be established from the documents read
//
// UNKNOWN is a sentence, never a dash: "Cannot be established from the
// documents read — no utilisation or revenue attribution disclosed."
export type CapexEarningState = 'NOT_STARTED' | 'SPENT_NOT_EARNING' | 'PARTIAL' | 'EARNING' | 'UNKNOWN';
export interface CapexEarning {
  state: CapexEarningState;
  /** Short, printable: "PARTIAL", "SPENT — NOT YET EARNING", … */
  label: string;
  /** Money out of the door, as stated. Null when the filing gives no spend. */
  spent: string | null;
  /** Revenue the filing ATTRIBUTES to the capex: "INR107 crores in Q1". */
  revenueContribution: string | null;
  /** from → to where two readings exist; `to` alone is a level. */
  utilisation: { from: string | null; to: string | null; note: string | null } | null;
  marginContribution: 'pending' | 'disclosed' | 'unknown';
  marginText: string | null;
  roceText: string | null;
  /** zzz784: the construction / operational status (all projects), and the
   *  economic status in words — two questions, never one label. */
  operational?: string | null;
  economic?: string;
  /** The printable lines, in chain order: Spent / Revenue contribution /
   *  Utilisation / Full margin contribution / ROCE. For UNKNOWN, one line
   *  saying why. Never empty. */
  lines: string[];
  source: string | null;
}
export const CAPEX_EARNING_LABEL: Record<CapexEarningState, string> = {
  NOT_STARTED: 'NOT STARTED',
  SPENT_NOT_EARNING: 'SPENT — NOT YET EARNING',
  PARTIAL: 'PARTIAL',
  EARNING: 'EARNING',
  UNKNOWN: 'UNKNOWN',
};
export const CAPEX_EARNING_UNKNOWN_LINE = 'Cannot be established from the documents read — no utilisation or revenue attribution disclosed';

export type CapexStage = 'ANNOUNCED' | 'SPENDING' | 'UNDER_CONSTRUCTION' | 'COMMISSIONED' | 'COMMERCIAL_PRODUCTION' | 'REVENUE_CONTRIBUTION';
export const CAPEX_STAGES: CapexStage[] = ['ANNOUNCED', 'SPENDING', 'UNDER_CONSTRUCTION', 'COMMISSIONED', 'COMMERCIAL_PRODUCTION', 'REVENUE_CONTRIBUTION'];
export const STAGE_LABEL: Record<CapexStage, string> = {
  ANNOUNCED: 'Announced', SPENDING: 'Spent', UNDER_CONSTRUCTION: 'Under construction',
  COMMISSIONED: 'Commissioned', COMMERCIAL_PRODUCTION: 'Commercial production', REVENUE_CONTRIBUTION: 'Revenue contribution',
};
export interface LifecycleEntry {
  period: string;
  stage: CapexStage;
  /** Each stage evidenced in that period, with the sentence that shows it. */
  steps: Array<{ stage: CapexStage; text: string; source: string }>;
}

const CAPEX_VARS = new Set(['capex', 'capex_status', 'commissioning', 'capex_earning', 'new_plant', 'capacity_addition']);
const ord = (x: CapexStage) => CAPEX_STAGES.indexOf(x);

/** The stage ONE reading evidences, or null. Forward statements only ever
 *  evidence ANNOUNCED: "to be commissioned in December" is a plan. */
/** A value or its period that speaks about the future: "upon full
 *  commissioning", "forthcoming year FY27", "planned investment". (zzz770) */
export const FORWARD_CUE = /\b(upon (?:full )?commissioning|to be (?:commissioned|completed)|will be|scheduled (?:for|to)|expected|planned|plans? to|proposed|forthcoming|going forward|in the coming|next (?:year|fiscal|quarter)|once (?:commissioned|complete))\b/i;
const SPENT_VERB = /\b(spent|incurred|deployed|invested|capitali[sz]ed|done|utili[sz]ed (?:towards|for))\b/i;
const ANNOUNCE_WORDS = /propos|approv|announc|estimated investment|outlay|planned|strategic investment|total capital investment|investment of/i;

export function stageOf(e: { variable: string; value_type: string; after: string | null; evidence_text: string; period?: string | null }): CapexStage | null {
  const t = `${e.after ?? ''} ${e.evidence_text}`;
  const own = `${e.after ?? ''} ${e.period ?? ''}`;
  // The value or its own period says "future": a plan, whatever its type
  // label says (CUPID's "adding 770 million … upon full commissioning" was
  // printed as ✓ Commissioned). (zzz770)
  const forward = e.value_type === 'GUIDANCE' || e.value_type === 'TARGET' || FORWARD_CUE.test(own);
  if (forward) return e.variable === 'capex' || e.variable === 'capex_status' || e.variable === 'new_plant' ? 'ANNOUNCED' : null;
  if (e.variable === 'capex_earning' || /revenue contribution|contribut\w* (?:revenue|to revenue|\S+ crores?)|already contributing/i.test(t)) {
    if (/not yet|will (?:start )?contribut|from FY\d{2}|expected to contribute/i.test(t)) return /commission|operational|online/i.test(t) ? 'COMMISSIONED' : null;
    return 'REVENUE_CONTRIBUTION';
  }
  // A capex FIGURE is judged on its own words, not on whatever else a long
  // sentence says about construction or schemes (INNOVACAP ₹480+ cr). (zzz770)
  // zzz802: a capex FIGURE must be money with a unit (or a percentage naming
  // its subject) — "2% to 3%", "Rs3,00,000/- … fees for cost audit" are not.
  if (e.variable === 'capex' && /\d/.test(String(e.after ?? '')) && !capexFigureOk(String(e.after ?? ''), e.evidence_text)
    && !/commission|commercial|construct|operational/i.test(own)) return null;
  if (e.variable === 'capex' && /\d/.test(String(e.after ?? '')) && !/commission|commercial|construct|operational/i.test(own)) {
    return ANNOUNCE_WORDS.test(t) && !SPENT_VERB.test(own) ? 'ANNOUNCED' : 'SPENDING';
  }
  if (/commercial[_ ]production|commerciali[sz]ed|commercial operations/i.test(t)) return 'COMMERCIAL_PRODUCTION';
  if (/\bcommissioned\b|\bcommissioning\b(?! of| date)|\boperational\b|\bonline\b|went live|\bdeployed\b|capacity ?expanded/i.test(t) && !/to be commissioned|will be commissioned|expected/i.test(t)) return 'COMMISSIONED';
  if (/under[_ ]construction|construction|installation|civil work|erection|trial/i.test(t)) return 'UNDER_CONSTRUCTION';
  // A capex FIGURE stated as an actual (not planned, not proposed) is money
  // spent; the forward case returned ANNOUNCED above.
  if (e.variable === 'capex' && /\d/.test(String(e.after ?? '')) && capexFigureOk(String(e.after ?? ''), e.evidence_text)) return ANNOUNCE_WORDS.test(t) && !SPENT_VERB.test(own) ? 'ANNOUNCED' : 'SPENDING';
  // "82.88 crore deployed in April 2026" is money out of the door. (zzz770)
  if (e.variable === 'capex_status' && SPENT_VERB.test(own) && /\d/.test(String(e.after ?? '')) && capexFigureOk(String(e.after ?? ''), e.evidence_text)) return 'SPENDING';
  if (/announc|approved|board approv/i.test(t)) return 'ANNOUNCED';
  return null;
}

/** Every period's capex readings, oldest first. Pure. */
export function capexLifecycle(ledger: CompanyLedger | null | undefined): LifecycleEntry[] {
  if (!ledger?.periods) return [];
  const out: LifecycleEntry[] = [];
  for (const period of Object.keys(ledger.periods).sort((a, b) => periodOrdinal(a) - periodOrdinal(b))) {
    const p = ledger.periods[period];
    const steps: LifecycleEntry['steps'] = [];
    for (const raw of p?.events || []) {
      if (!CAPEX_VARS.has(raw.variable)) continue;
      const e = normalizeEvent(raw, period);
      if (e.historical_as_of) continue;
      const st = stageOf({ ...e, period: e.period ?? null });
      if (!st) continue;
      if (steps.some((x) => x.stage === st)) continue;
      steps.push({ stage: st, text: String(e.after ?? e.evidence_text).slice(0, 160), source: e.source });
    }
    if (!steps.length) continue;
    steps.sort((a, b) => ord(a.stage) - ord(b.stage));
    out.push({ period, stage: steps[steps.length - 1].stage, steps });
  }
  return out;
}

// Words that say revenue has NOT yet arrived from the capex, or is a plan.
const NOT_YET_EARNING = /not yet|will (?:start )?contribut|expected to (?:start )?contribut|contribut\w* (?:revenue )?from (?:Q[1-4]|FY\d{2}|[A-Z][a-z]{2,8}\s?'?\d{2,4})|from FY\d{2}|yet to|once (?:commissioned|complete)|upon (?:full )?commissioning/i;
// Words that say revenue HAS been attributed to the capex.
const EARNING_WORDS = /already contributing|contributed revenue|contributing revenue|revenue contribution of|revenue of|contribut\w* (?:INR|Rs\.?|₹)|(?:INR|Rs\.?|₹)\s?[\d,.]+\s?crores? in Q/i;
// Margin contribution said to be still ahead.
const MARGIN_PENDING = /margin contribution (?:will|to) come|full margin|margin (?:contribution |benefit )?(?:will|to) (?:follow|come|accrue|kick in)|as utili[sz]ation (?:increases|improves|ramps)|margin[^.]{0,40}(?:pending|not yet|yet to)|break[- ]?even/i;
// Margin contribution said to have happened.
// A stated EBITDA / PAT of the capex-funded unit is a stated profit
// contribution (BHAGCHEM: "revenue Rs.81.34 crore and EBITDA Rs.7.86 crore").
const MARGIN_STATED = /margin (?:accretive|accretion|expansion|improve\w*|contribution)[^.]{0,60}(?:from|due to|driven by|on account of)[^.]{0,60}(?:plant|capex|capacity|facility|new line)|(?:plant|capex|capacity|facility|new line)[^.]{0,60}(?:margin accretive|contributed to (?:the )?margin|added to (?:the )?margin|improved (?:the )?margin|margin expansion)|(?:EBITDA|PAT|profit)\s?(?:of\s?)?(?:₹|INR|Rs\.?)\s?[\d,]+(?:\.\d+)?\s*(?:crores?|cr\b|mn|million)/i;

const nz = (s: unknown): string | null => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t && !/^not (?:stated|disclosed)$/i.test(t) ? t : null; };

// ── "HAS BEGUN CONTRIBUTING" IS A CONTRIBUTION; "WILL GENERATE" IS A TARGET. (zzz772)
//
// KEI's row read "Sanand Phase I has begun contributing; management estimates
// Sanand will generate INR1,500-2,000 crores in FY27 …" and the block printed
// "SPENT — NOT YET EARNING · Revenue contribution: not attributed": the word
// list knew "already contributing" but not "begun / started / is / now
// contributing", and the only money in the row was a FORECAST. The row is
// read clause by clause: a clause in the present or past tense attributes
// revenue; a clause about the future (will, expected, estimates, when fully
// ramped) is a target and is printed as one — never as revenue contribution.
const CONTRIB_NOW = /\b(?:has|have|had)?\s*(?:begun|started|commenced)\s+(?:to\s+)?contribut\w*|\b(?:is|are|was|were|now|already)\s+contributing\b|\bcontributing revenue\b/i;
const CONTRIB_PAST = /\bcontributed\b/i;
const CONTRIB_FUTURE = /\bwill\b|\bshall\b|\bwould\b|\bexpected\b|\bexpects?\b|\bestimat\w*|\bgoing to\b|\bpotential\b|\bwhen fully\b|\bonce fully\b|\bat (?:full|peak)\b|\btarget\w*|\bguid\w*|\bplan(?:s|ned)? to\b|\bshould\b/i;
const CONTRIB_NEGATED = /\bnot yet\b|\byet to\b|\bnot (?:been )?contribut|\bno (?:revenue )?contribution\b/i;
const MONEY_RANGE = /(?:₹|INR|Rs\.?)\s?[\d,]+(?:\.\d+)?(?:\s*(?:-|–|to)\s*(?:₹|INR|Rs\.?)?\s?[\d,]+(?:\.\d+)?)?\s*(?:crores?|cr\b|lakhs?|mn\b|million|bn\b|billion)(?:[^.;\d]{0,24}?\b(?:in|by|for|during)\s+(?:Q[1-4]\s?)?FY\s?'?\d{2,4})?/i;
// ── "UTILISATION:" PRINTS A UTILISATION, OR NOTHING.                (zzz772)
// SFL printed "Utilisation: 30 days inventory in India", IRMENERGY "1587.17
// million", AZAD a construction sentence, WONDERLA "tracking similar to other
// larger parks". A utilisation figure is a percentage or a capacity-use word;
// anything else is "not disclosed".
const UTIL_WORD = /%|\bper ?cent\b|\bpercent|\b(?:full|fully|maximum|max|optimum|optimal|near[- ]full|at capacity|full capacity|peak)\b/i;
const utOk = (x: unknown): string | null => { const t = nz(x); return t && UTIL_WORD.test(t) ? t : null; };
// ── "SPENT:" PRINTS THE AMOUNT, NOT THE SENTENCE.                   (zzz772)
// MTARTECH's whole capex sentence landed in the Spent slot. Past ~70 chars
// only the amount phrase (with its date, where stated) is kept.
export function spentPhrase(s: string | null): string | null {
  const t = nz(s);
  if (!t || t.length <= 70) return t;
  // Amount phrases as stated, a range kept as one ("INR30 crores -INR35
  // crores"), never summed.
  const U = '(?:crores?|cr\\b|lakhs?|mn\\b|million|bn\\b|billion)';
  const re = new RegExp(`(?:₹|INR|Rs\\.?)?\\s?[\\d,]+(?:\\.\\d+)?\\+?\\s*${U}(?:\\s*(?:-|–|to)\\s*(?:₹|INR|Rs\\.?)?\\s?[\\d,]+(?:\\.\\d+)?\\+?\\s*${U})?`, 'gi');
  const parts = Array.from(t.matchAll(re)).map((m) => m[0].replace(/\s+/g, ' ').trim()).filter((x) => /\d/.test(x));
  if (parts.length) return parts.slice(0, 3).join('; ');
  return money(t) || short(t, 70);
}
/** Per-clause reading of a capex-earning sentence. `actual` is what the
 *  document says the capex has contributed (an amount, or "begun — <who>"
 *  when no amount is given); `target` is a forecast amount. Pure. */
export function revenueAttribution(text: string): { actual: string | null; target: string | null } {
  let actual: string | null = null, target: string | null = null;
  for (const raw of String(text || '').split(/;\s*|\.\s+(?=[A-Z])/)) {
    const c = raw.trim();
    if (!c || CONTRIB_NEGATED.test(c)) {
      continue;
    }
    const future = CONTRIB_FUTURE.test(c);
    const m0 = CONTRIB_NOW.exec(c);
    // "expected to start contributing revenue" (MANINDS) is a plan: a
    // present-tense match counts in a clause that also speaks about the
    // future only when it is an explicit "has begun / is / already
    // contributing" and no "will / expected to" governs it.
    const governed = m0 ? /(?:will|shall|expect(?:s|ed)? to|going to|plan(?:s|ned)? to|set to|likely to)\s+(?:\w+\s+){0,2}$/i.test(c.slice(0, m0.index + m0[0].length - (/contribut\w*\s*(?:revenue)?$/i.exec(m0[0])?.[0].length || 0))) : false;
    const strong = !!m0 && /begun|started|commenced|\b(?:is|are|was|were|now|already)\s+contributing/i.test(m0[0]);
    const now = m0 && !governed && (!future || strong) ? m0 : null;
    // "contributed" counts only with an amount or a named project — a bare
    // "contributed" says nothing that can be checked next quarter.
    const past = !now && CONTRIB_PAST.test(c) && !future && (!!money(c) || /\b[A-Z][a-z]{2,}\b/.test(c.slice(1)));
    const legacy = !now && !past && !future && EARNING_WORDS.test(c);
    if (!actual && (now || past || legacy)) {
      // A clause that also speaks about the future may carry the FORECAST
      // amount ("has begun contributing and will add ₹500 cr"): no amount is
      // taken from it.
      const amt = future ? null : contributionAmount(c) || (past ? money(c) : null);
      const at = now ? now.index : past ? c.search(CONTRIB_PAST) : -1;
      const who = at > 0 ? c.slice(0, at)
        .replace(/^(?:the\s+)?(?:company|management|presentation|release)\s+(?:states?|said|says|notes?d?|mentions?e?d?|confirms?e?d?)\s+(?:that\s+)?/i, '')
        .replace(/\b(?:the|and|which|that|has|have|had)\s*$/i, '').trim() : '';
      actual = amt || `${past ? 'contributed' : 'begun'}${who ? ` — ${short(who, 50)}` : ''}, amount not stated`;
      continue;
    }
    // A forecast amount is a target only where it is revenue the capex is
    // to produce ("will generate INR1,500-2,000 crores") — not the capex
    // itself ("capex of INR150 crores is expected to enable …").
    if (!target && future) {
      const re = new RegExp(`(?:generat\\w*|revenue|sales|turnover|top[- ]?line|contribut\\w*|add\\w*)\\b[^.;]{0,40}?(${MONEY_RANGE.source})`, 'i');
      const m = re.exec(c);
      if (m) target = m[1].replace(/\s+/g, ' ').trim();
    }
  }
  return { actual, target };
}

/** "Capex earning yet?" as a structured state, from the capex rows, the
 *  utilisation row, the summary's utilisation block and the project
 *  lifecycle. Reads only what the filing states; never sums, never infers a
 *  number. Pure. (zzz771) */
export function capexEarning(
  vars: StructuralVar[],
  stage: CapexStage | null,
  projects: CapexProject[] = [],
  summary: any | null = null,
): CapexEarning {
  const get = (k: string) => vars.find((v) => v.key === (k as VarKey)) || null;
  const ceRow = get('capex_earning');
  const ceTxt = String(ceRow?.after || ceRow?.evidence || '');
  const src = (ceRow as any)?.sourceLabel || null;

  // The project that answers the question: the one with attributed revenue,
  // else the named one, else whatever is on file.
  const pj = projects.find((x) => x.steps.some((st) => st.step === 'REVENUE_CONTRIBUTION' && st.state === 'actual'))
    || projects.find((x) => x.name !== 'Capacity and capex not tied to a named project') || projects[0] || null;
  const step = (s: LifecycleStep) => pj?.steps.find((x) => x.step === s) || null;
  const actual = (s: LifecycleStep) => step(s)?.state === 'actual';

  // ── SPENT. Stated spend first; a stated investment on a commissioned plant
  // is printed as such (the spend is implied by the plant existing — said,
  // not claimed as a disclosed spend figure).
  let spent: string | null = pj && pj.spent.length ? pj.spent.join('; ') : null;
  if (!spent && pj?.announced && money(pj.announced) && (actual('COMMISSIONED') || actual('COMMERCIAL_PRODUCTION'))) {
    spent = `${pj.announced} (stated investment; spend implied by commissioning)`;
  }
  // A capex FIGURE the filing states as an actual (not a plan, not a
  // commitment) is money out of the door, even when it is not itemised to a
  // project (E2E "INR881.1 crores capex", VAML "6,068 crores"). (zzz771)
  const capexRow = get('capex');
  const capexRowStage = capexRow && nz(capexRow.after) && !/committed|commitment|outlay|planned|proposed|guidance|target/i.test(String(capexRow.after))
    ? stageOf({ variable: 'capex', value_type: capexRow.statement === 'GUIDANCE' || capexRow.statement === 'TARGET' ? capexRow.statement : 'ACTUAL',
      after: capexRow.after, evidence_text: String(capexRow.evidence || ''), period: capexRow.asOf ?? null })
    : null;
  // Spent only where the row SAYS so ("deployed", "incurred", "capital WIP")
  // or is a bare ACTUAL money figure. A list of project names with a planned
  // amount inside (SPECTRUM, MINDSPACE) or a management statement about a
  // programme under way (KMEW "close to INR1,000 crores") is not money out of
  // the door. (zzz771)
  const capexAfter = String(capexRow?.after ?? '');
  const bareFigure = capexAfter.length <= 40 && !/[·;]/.test(capexAfter) && capexRow?.statement === 'ACTUAL';
  const saysSpent = SPENT_VERB.test(capexAfter) || /capital (?:WIP|work[- ]in[- ]progress)|\bCWIP\b|already (?:deployed|spent|incurred)/i.test(capexAfter);
  const capexRowSpent = capexRowStage === 'SPENDING' && !!money(capexRow!.after) && (saysSpent || bareFigure);
  if (!spent) {
    const cs = get('capex_status');
    if (cs?.after && SPENT_VERB.test(String(cs.after)) && money(cs.after)) spent = spentPhrase(cs.after);
    else if (capexRowSpent) spent = `${spentPhrase(capexRow!.after)} (capex figure as stated; not itemised to a project)`;
  } else if (!/\(stated investment; spend implied by commissioning\)$/.test(spent)) spent = spentPhrase(spent);

  // ── REVENUE CONTRIBUTION. From the project step, else from the row's words.
  let revenue: string | null = actual('REVENUE_CONTRIBUTION') ? nz(pj!.revenue_contribution) : null;
  const attr = ceRow ? revenueAttribution(ceTxt) : { actual: null, target: null };
  const rowNotYet = !!ceRow && NOT_YET_EARNING.test(ceTxt) && !/already contributing|contributed/i.test(ceTxt) && !attr.actual;
  if (!revenue && ceRow && !rowNotYet && attr.actual) revenue = attr.actual;
  // A forecast amount is shown as a target beside the contribution, never as it. (zzz772)
  const revenueTarget = attr.target && !(revenue && revenue.includes(attr.target)) ? attr.target : null;

  // ── UTILISATION. The variable row (as the document worded it), else the
  // summary block. Two readings → from → to; one → a level with the reason
  // there is no prior. A target is never printed in the current slot.
  const ut = get('utilisation');
  const ub = summary?.utilisation || {};
  let utilisation: CapexEarning['utilisation'] = null;
  const utTarget = !!ut && (ut.statement === 'GUIDANCE' || ut.statement === 'TARGET' || /\((?:target|guidance)\)\s*$/i.test(String(ut.after ?? '')));
  const strip = (x: unknown) => nz(String(x ?? '').replace(/\s*\((?:target|guidance)\)\s*$/i, ''));
  if (ut && utOk(ut.after) && utTarget) {
    utilisation = { from: null, to: null, note: `current not disclosed · target ${strip(ut.after)}` };
  } else if (ut && utOk(ut.after) && !(utOk(ub.prior) && utOk(ub.current) && !utOk(ut.before))) {
    const target = ut.plan?.value && utOk(ut.plan.value) ? `target ${ut.plan.value}` : utOk(ub.expected) ? `target ${nz(ub.expected)}` : null;
    const unclear = ((ut as any).state === 'UNCLEAR' || (ut as any).validation?.state === 'UNCLEAR') ? 'unclear — validation required' : null;
    utilisation = { from: utOk(ut.before), to: utOk(ut.after),
      note: [utOk(ut.before) ? null : 'level only; prior not disclosed', unclear, target].filter(Boolean).join(' · ') || null };
  } else if (utOk(ub.current)) {
    utilisation = { from: utOk(ub.prior), to: utOk(ub.current),
      note: [utOk(ub.prior) ? null : 'level only; prior not disclosed', utOk(ub.expected) ? `target ${nz(ub.expected)}` : null].filter(Boolean).join(' · ') || null };
  } else if (utOk(pj?.utilisation)) {
    utilisation = { from: null, to: utOk(pj!.utilisation), note: 'level only; prior not disclosed' };
  }

  // ── MARGIN. The project step, then the row's words.
  const mStep = step('MARGIN_CONTRIBUTION');
  let marginContribution: CapexEarning['marginContribution'] = 'unknown';
  let marginText: string | null = null;
  if (mStep?.state === 'actual') { marginContribution = 'disclosed'; marginText = mStep.value; }
  else if (mStep?.state === 'target') { marginContribution = 'pending'; marginText = mStep.value; }
  else if (MARGIN_PENDING.test(ceTxt)) { marginContribution = 'pending'; marginText = short((/[^.;]*margin[^.;]*/i.exec(ceTxt) || [null])[0], 110); }
  else if (MARGIN_STATED.test(ceTxt)) {
    // The clause from the match to the end of its sentence ("Rs.7.86" has a
    // dot inside a number, so split only on ". " or ";").
    const m = MARGIN_STATED.exec(ceTxt)!;
    marginContribution = 'disclosed'; marginText = short(ceTxt.slice(m.index).split(/;|\.\s|\.$/)[0], 110);
  }

  // ── ROCE / FCF — only a return or payback ATTRIBUTED to the project.
  // Company free cash flow "after net capex of ₹33 crore" (MARKSANS) is not
  // the capex's ROCE and is never borrowed here.
  const rStep = step('ROCE_FCF');
  const roceText = rStep?.state === 'actual' && rStep.value && /\broce\b|return on capital|payback/i.test(rStep.value) ? rStep.value : null;

  // ── THE STATE. The project that answers the question decides whether the
  // plant is built; only where no project is on file does the company-wide
  // lifecycle stage stand in. Company-wide utilisation is never proof that
  // THIS capex is running.
  const built = pj
    ? actual('COMMISSIONED') || actual('COMMERCIAL_PRODUCTION') || actual('UTILISATION') || actual('REVENUE_CONTRIBUTION')
    : !!stage && ord(stage) >= ord('COMMISSIONED');
  const csRow = get('capex_status');
  const statedSpend = !!(csRow?.after && SPENT_VERB.test(String(csRow.after)) && money(csRow.after));
  const spentOrBuilt = built || (pj ? pj.spent.length > 0 || actual('SPENT') : stage === 'SPENDING' && statedSpend) || (!pj && statedSpend) || capexRowSpent;
  const announcedOnly = !spentOrBuilt && (!!pj?.announced || actual('ANNOUNCED') || step('ANNOUNCED')?.state === 'target'
    || stage === 'ANNOUNCED' || stage === 'UNDER_CONSTRUCTION' || stage === 'SPENDING' || step('COMMISSIONED')?.state === 'target' || rowNotYet
    || !!nz(get('capex')?.after));

  let state: CapexEarningState;
  if (revenue && (marginContribution === 'disclosed' || roceText)) state = 'EARNING';
  else if (revenue) state = 'PARTIAL';
  else if (spentOrBuilt) state = 'SPENT_NOT_EARNING';
  else if (announcedOnly) state = 'NOT_STARTED';
  else state = 'UNKNOWN';

  const lines: string[] = [];
  if (state === 'UNKNOWN') {
    { const onFile = pj?.announced || nz(get('capex')?.after);
      lines.push(CAPEX_EARNING_UNKNOWN_LINE + (onFile && capexFigureOk(onFile) ? ` (capex on file: ${onFile})` : '')); }
  } else {
    const announcedRaw0 = pj?.announced || (capexRow && !capexRowSpent ? nz(capexRow.after) : null);
    // zzz802: "announced 2% to 3%" / "announced 25%" — a subjectless percentage
    // is not an announced capex figure; unknown stays unknown.
    const announcedRaw = announcedRaw0 && capexFigureOk(announcedRaw0, (capexRow as any)?.quote || (capexRow as any)?.evidence || null) ? announcedRaw0 : null;
    // The same ~70-char rule for the announced amount beside "Spent: not
    // disclosed": the amount phrase, or nothing when the sentence has none. (zzz772)
    const announcedTxt = announcedRaw && announcedRaw.length > 70 ? (money(announcedRaw) ? spentPhrase(announcedRaw) : null) : announcedRaw;
    lines.push(`Spent: ${spent || (announcedTxt ? `not disclosed (announced ${announcedTxt})` : 'not disclosed')}`);
    lines.push(`Revenue contribution: ${revenue || (state === 'NOT_STARTED'
      ? (step('REVENUE_CONTRIBUTION')?.state === 'target' && step('REVENUE_CONTRIBUTION')?.value ? `expected ${step('REVENUE_CONTRIBUTION')!.value}` : 'none yet — not commissioned')
      : 'not attributed in the documents read')}${revenueTarget ? ` · target ${revenueTarget}` : ''}`);
    // A utilisation figure on a plant that is NOT yet built is the existing
    // capacity's, and says so — it is context for the capex, not its result.
    const utNote = [!built && utilisation?.to ? 'existing capacity' : null, utilisation?.note].filter(Boolean).join('; ');
    lines.push(`Utilisation: ${utilisation
      ? `${utilisation.from ? `${utilisation.from} → ` : ''}${utilisation.to || 'not disclosed'}${utNote ? ` (${utNote})` : ''}`
      : 'not disclosed'}`);
    lines.push(`Full margin contribution: ${marginContribution === 'disclosed' ? `disclosed${marginText ? ` — ${marginText}` : ''}`
      : marginContribution === 'pending' ? `pending${marginText ? ` — ${marginText}` : ''}` : 'not stated'}`);
    if (roceText) lines.push(`ROCE / FCF: ${roceText}`);
  }
  const under = state === 'NOT_STARTED' && (stage === 'UNDER_CONSTRUCTION' || step('COMMISSIONED')?.state === 'target');
  return {
    state, label: under ? 'NOT STARTED — UNDER CONSTRUCTION' : CAPEX_EARNING_LABEL[state],
    spent, revenueContribution: revenue, utilisation, marginContribution, marginText, roceText, lines,
    // "summary" is not a document; only a named document is worth printing.
    source: [src, step('REVENUE_CONTRIBUTION')?.source, pj?.steps.find((s) => s.source && s.source !== 'summary')?.source].find((x) => x && x !== 'summary') || null,
  };
}

const pctIn = (s: unknown): number | null => {
  // A percentage needs a "%": LLOYDSENGG's "~2x" is not 1% utilisation. (zzz770)
  if (!said(s) || !/%/.test(String(s))) return null;
  const m = String(s).match(/-?\d+(?:\.\d+)?/);
  const v = m ? Number(m[0]) : NaN;
  return Number.isFinite(v) ? v : null;
};

export function buildCapexChain(summary: any | null, vars: StructuralVar[], ledger?: CompanyLedger | null): CapexChain {
  const lifecycle = capexLifecycle(ledger);
  const reached = lifecycle.reduce<CapexStage | null>((m, e) => (!m || ord(e.stage) > ord(m) ? e.stage : m), null);
  const lifecycleProjects = capexProjects(summary, ledger, vars);
  const earning00 = capexEarning(vars, reached, lifecycleProjects, summary);
  const build = capexBuild(lifecycleProjects);
  // zzz790 — ONE PROGRAMME CANNOT BE "NOT STARTED" AND COMMISSIONED.
  // TI / HSCL / SANSERA read "Capex earning: NOT STARTED · Revenue
  // contribution: none yet — not commissioned" beside a project the build
  // state calls commissioned. A built project with no revenue attributed is
  // BUILT — NOT YET EARNING (commissioned ≠ earning); the per-project build
  // states say which one is built and which are not.
  const earning0: CapexEarning = earning00.state === 'NOT_STARTED' && build?.anyOperating
    ? { ...earning00, state: 'SPENT_NOT_EARNING', label: 'BUILT — NOT YET EARNING',
      lines: earning00.lines.map((l) => /^Revenue contribution: none yet — not commissioned/.test(l)
        ? l.replace('none yet — not commissioned', 'not attributed in the documents read (built project included)') : l) }
    : earning00;
  // The earning block carries the SAME build answer as the narrative: with
  // several projects in different states it names each, and its label says
  // "MIXED" rather than one project's state for all. (zzz784)
  const earning: CapexEarning = { ...earning0,
    operational: build ? build.text : null,
    economic: earning00.state === 'NOT_STARTED' && build?.anyOperating ? 'not yet earning — no revenue attributed to any project (the built one included)' : ECONOMIC_WORD[earning0.state],
    label: build?.mixed && (earning0.state === 'NOT_STARTED' || earning0.state === 'SPENT_NOT_EARNING')
      ? `MIXED — ${build.projects.filter((x) => isOperatingBuild(x.build)).length} built, ${build.projects.filter((x) => !isOperatingBuild(x.build)).length} not yet built · NOT YET EARNING`
      : earning0.state === 'SPENT_NOT_EARNING' && build && build.anyOperating && !earning0.spent ? 'BUILT — NOT YET EARNING'
        : earning0.label,
    lines: earning0.lines };
  const earns = earning.state === 'PARTIAL' || earning.state === 'EARNING';
  // A disclosed revenue contribution is itself proof the capacity was built.
  const stage: CapexStage | null = earns ? 'REVENUE_CONTRIBUTION' : reached;
  const base = buildCapexChainCore(summary, vars, stage);
  // A disclosed revenue contribution is the capex STARTING to earn — never
  // "cannot be checked" (INNOVACAP ₹107 cr in Q1). Margin contribution is a
  // separate, later step and is said to be open. (zzz770)
  if (earning.state === 'PARTIAL' && (base.state === 'unverifiable' || base.state === 'commissioned_not_earning')) {
    return { ...base, state: 'starting_to_earn', lifecycle, stage, earning, lifecycleProjects, build,
      because: `Revenue contribution is disclosed (${earning.revenueContribution}); margin contribution is a separate step and is ${earning.marginContribution === 'pending' ? 'stated as pending' : 'not yet established'}.`,
      nextCheck: 'Whether utilisation rises and the margin follows the revenue — revenue contribution is not margin contribution.' };
  }
  // Revenue AND margin / ROCE attributed: every link the filing can evidence
  // has been evidenced. (zzz771)
  if (earning.state === 'EARNING' && (base.state === 'unverifiable' || base.state === 'commissioned_not_earning' || base.state === 'starting_to_earn')) {
    return { ...base, state: 'earning', lifecycle, stage, earning, lifecycleProjects, build,
      because: `Revenue contribution ${earning.revenueContribution} and ${earning.roceText ? `ROCE / FCF ${earning.roceText}` : `margin contribution (${earning.marginText || 'stated'})`} are both attributed to the capex in the documents read.`,
      nextCheck: null };
  }
  // The chain headline follows the same build answer: a chain whose projects
  // are all operating is never "UNDER CONSTRUCTION", and a mixed one says so. (zzz784)
  if (build && (base.state === 'under_construction' || base.state === 'announced') && build.anyOperating) {
    return { ...base, state: build.mixed ? base.state : 'commissioned_not_earning', lifecycle, stage, earning, lifecycleProjects, build,
      because: build.mixed ? `Operational status: ${build.text}. ${base.because}` : `Operational status: ${build.text}; no utilisation or revenue attributed to it yet, so whether it is earning cannot be read.`,
      nextCheck: build.mixed ? base.nextCheck : 'The first utilisation or revenue figure attributed to the operating capacity.' };
  }
  return { ...base, lifecycle, stage, earning, lifecycleProjects, build,
    because: build?.mixed && !/^Operational status/.test(base.because) ? `Operational status: ${build.text}. ${base.because}` : base.because };
}

/** The chain without the earning block; `buildCapexChain` attaches it. */
const NO_EARNING: CapexEarning = { state: 'UNKNOWN', label: CAPEX_EARNING_LABEL.UNKNOWN, spent: null, revenueContribution: null, utilisation: null,
  marginContribution: 'unknown', marginText: null, roceText: null, lines: [CAPEX_EARNING_UNKNOWN_LINE], source: null };

function buildCapexChainCore(summary: any | null, vars: StructuralVar[], stage: CapexStage | null): CapexChain {
  const projects: any[] = Array.isArray(summary?.capex_projects) ? summary.capex_projects : [];
  const get = (k: VarKey) => vars.find((v) => v.key === k) || null;

  const mapped = projects.map((c) => ({
    name: String(c?.name || 'Capital programme'),
    amount: said(c?.amount) ? String(c.amount) : null,
    capacity: said(c?.capacity_added) ? String(c.capacity_added) : null,
    completes: said(c?.completion_period) ? String(c.completion_period) : null,
    earnsFrom: said(c?.revenue_from) ? String(c.revenue_from) : null,
  }));

  const ut = summary?.utilisation || {};
  const utPrior = pctIn(ut.prior), utNow = pctIn(ut.current), utExp = pctIn(ut.expected);
  const utDelta = utPrior != null && utNow != null ? utNow - utPrior : null;

  const rev = get('revenue_growth');
  const marg = get('margin');
  const revUp = rev?.verdict === 'improving';
  const revDown = rev?.verdict === 'deteriorating';
  const margUp = marg?.verdict === 'improving';

  const links: CapexChain['links'] = [
    { name: 'Capex', value: mapped.map((p) => p.amount).filter(Boolean).join(' · ') || null, known: mapped.some((p) => !!p.amount) },
    { name: 'Capacity', value: mapped.map((p) => p.capacity).filter(Boolean).join(' · ') || null, known: mapped.some((p) => !!p.capacity) },
    { name: 'Commissioning', value: mapped.map((p) => p.completes).filter(Boolean).join(' · ') || null, known: mapped.some((p) => !!p.completes) },
    { name: 'Utilisation', value: utNow != null ? `${utPrior != null ? `${utPrior}% → ` : ''}${utNow}%` : null, known: utNow != null },
    { name: 'Revenue', value: rev?.after ?? null, known: !!rev },
    { name: 'Margin', value: marg?.delta ?? marg?.after ?? null, known: !!marg },
    { name: 'ROCE', value: null, known: false },   // never invented; the filings rarely state it
  ];

  if (!mapped.length && !stage) {
    return { state: 'none', links, projects: mapped, earning: NO_EARNING,
      because: 'No capital programme disclosed in the latest filing.', nextCheck: null };
  }

  // Has it been built? A stated completion period in the past tense is not
  // reliably parseable across two markets' filing styles, so the honest proxy
  // is whether utilisation is being disclosed at all: companies report
  // utilisation when there is a plant running to report on.
  // The typed events now say it outright where the documents do. (zzz765)
  const commissioned = utNow != null || (!!stage && ord(stage) >= ord('COMMISSIONED'));

  if (!commissioned) {
    const anyDate = mapped.some((p) => p.completes);
    return {
      state: anyDate ? 'under_construction' : 'announced',
      links, projects: mapped, earning: NO_EARNING,
      because: anyDate
        ? `Capital programme disclosed with a commissioning date${mapped[0]?.completes ? ` (${mapped[0].completes})` : ''}, and no utilisation figure yet — it is being built.`
        : 'Capital programme announced with no commissioning date and no utilisation figure. This is a commitment, not yet a result.',
      nextCheck: 'Hold management to the commissioning date, then to the utilisation figure that follows it.',
    };
  }

  // Built. Now the only question that matters: is it earning?
  if (utDelta == null) {
    return {
      state: utNow == null ? 'commissioned_not_earning' : 'unverifiable', links, projects: mapped, earning: NO_EARNING,
      because: utNow == null
        ? `The documents state the capacity is ${stage ? STAGE_LABEL[stage].toLowerCase() : 'commissioned'}; no utilisation figure is disclosed, so how far it has filled cannot be read.`
        : `Utilisation is ${utNow}% but no prior figure was disclosed, so whether the new capacity is filling cannot be established from this filing alone.`,
      nextCheck: 'The next filing gives a second utilisation point, and the direction becomes readable.',
    };
  }

  if (utDelta <= 1 && revDown) {
    return {
      state: 'disappointment', links, projects: mapped, earning: NO_EARNING,
      because: `Capacity is commissioned, utilisation moved ${utDelta >= 0 ? '+' : ''}${utDelta.toFixed(0)}pp (${utPrior}% → ${utNow}%) and revenue is falling. `
        + 'The money is in the ground and the earnings have not appeared.',
      nextCheck: 'This is the condition that ends a capacity-led thesis. Check order intake and management\'s explanation before anything else.',
    };
  }

  if (utDelta <= 1) {
    return {
      state: 'commissioned_not_earning', links, projects: mapped, earning: NO_EARNING,
      because: `Capacity is commissioned and utilisation is flat at ${utNow}% (${utPrior}% before). Revenue and margin have not yet responded. `
        + 'Early in a ramp this is normal; it is also what a disappointment looks like in its first quarters.',
      nextCheck: utExp != null
        ? `Management expects ${utExp}%${said(ut.expected_by) ? ` by ${ut.expected_by}` : ''}. That figure is the promise to check next quarter.`
        : 'Two more quarters of utilisation separate a slow ramp from a disappointment.',
    };
  }

  if (utDelta > 1 && revUp && margUp) {
    return {
      state: 'earning', links, projects: mapped, earning: NO_EARNING,
      because: `Utilisation ${utPrior}% → ${utNow}% (${utDelta >= 0 ? '+' : ''}${utDelta.toFixed(0)}pp), revenue ${rev?.after}, margin ${marg?.delta || 'up'}. `
        + 'Every link in the chain moved — the capital produced the earnings.',
      nextCheck: null,
    };
  }

  return {
    state: 'starting_to_earn', links, projects: mapped, earning: NO_EARNING,
    because: `Utilisation ${utPrior}% → ${utNow}% (${utDelta >= 0 ? '+' : ''}${utDelta.toFixed(0)}pp) and the plant is filling. `
      + (margUp ? 'Margin is following.' : 'Margin has not yet followed — absorption usually lags utilisation by a quarter or two.'),
    nextCheck: margUp ? null : 'Margin is the link still open. If utilisation keeps rising and margin does not follow, the absorption assumption is wrong.',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// THE CAPEX LIFECYCLE, PROJECT BY PROJECT.                        (zzz770)
//
//   ANNOUNCED → SPENT → CAPACITY CREATED → COMMISSIONED → COMMERCIAL
//   PRODUCTION → UTILISATION → REVENUE CONTRIBUTION → MARGIN CONTRIBUTION →
//   ROCE / FCF
//
// Announced is not spent, spent is not earning, commissioned is not full
// margin contribution, and revenue contribution is not margin contribution.
// Each step is ACTUAL (the document says it happened), TARGET (the document
// says it will), IMPLIED (a later step shows it must have happened, but it was
// not itself disclosed) or PENDING (nothing on file). Nothing is summed,
// estimated or carried from one project to another. Persistence of these
// records is the evidence ledger's job; this derives them from its events.
// ═══════════════════════════════════════════════════════════════════════════
export type LifecycleStep =
  | 'ANNOUNCED' | 'SPENT' | 'CAPACITY_CREATED' | 'COMMISSIONED' | 'COMMERCIAL_PRODUCTION'
  | 'UTILISATION' | 'REVENUE_CONTRIBUTION' | 'MARGIN_CONTRIBUTION' | 'ROCE_FCF';
export const LIFECYCLE_STEPS: LifecycleStep[] = [
  'ANNOUNCED', 'SPENT', 'CAPACITY_CREATED', 'COMMISSIONED', 'COMMERCIAL_PRODUCTION',
  'UTILISATION', 'REVENUE_CONTRIBUTION', 'MARGIN_CONTRIBUTION', 'ROCE_FCF',
];
export const LIFECYCLE_LABEL: Record<LifecycleStep, string> = {
  ANNOUNCED: 'Announced', SPENT: 'Spent', CAPACITY_CREATED: 'Capacity created', COMMISSIONED: 'Commissioned',
  COMMERCIAL_PRODUCTION: 'Commercial production', UTILISATION: 'Utilisation',
  REVENUE_CONTRIBUTION: 'Revenue contribution', MARGIN_CONTRIBUTION: 'Margin contribution', ROCE_FCF: 'ROCE / FCF',
};
export interface ProjectStep {
  step: LifecycleStep;
  state: 'actual' | 'target' | 'implied' | 'pending';
  value: string | null;
  quote: string | null;
  source: string | null;
  sourceIds: string[];
}
export interface CapexProject {
  project_id: string;
  name: string;
  location: string | null;
  product: string | null;
  segment: string | null;
  purpose: string | null;
  announced: string | null;
  revised: string | null;
  spent: string[];
  completion: string | null;
  capacity_added: string | null;
  commissioning_date: string | null;
  commercial_production_date: string | null;
  utilisation: string | null;
  revenue_contribution: string | null;
  margin_contribution: string | null;
  roce_contribution: string | null;
  fcf_contribution: string | null;
  source_ids: string[];
  steps: ProjectStep[];
  /** One line, lifecycle order, only what is on file: "Capex ₹480+ Crore →
   *  commercial production January 2025 → … → margin contribution pending". */
  line: string;
  /** Two capacity figures in one chain that are not the same measure or
   *  scope: "UNCLEAR — unit/scope mismatch: 55 MT vs 150,000 MTPA, no delta
   *  calculated". The later step is not read as this capacity's. (zzz773) */
  mismatch?: string | null;
  /** zzz784: the summary row says it is being built. */
  underConstruction?: boolean;
  /** zzz784: a reported status that its own completion date contradicts
   *  (IMFA KNR-1 "commercial production" with completion Q3 FY27). */
  statusConflict?: string | null;
}

export { completionDate } from './fact-normalize';
import { completionDate } from './fact-normalize';

const STOP = new Set(['facility', 'facilities', 'plant', 'plants', 'capacity', 'expansion', 'programme', 'program', 'project',
  'projects', 'greenfield', 'brownfield', 'manufacturing', 'part', 'capex', 'unit', 'units', 'line', 'lines', 'phase', 'total',
  'investment', 'crore', 'crores', 'plot', 'power', 'based', 'with', 'from', 'into', 'this', 'that', 'components', 'capability',
  'additions', 'addition', 'stated', 'being', 'built', 'company', 'strategic', 'site', 'sites', 'centre', 'center']);
const tokensOf = (name: string): string[] => Array.from(new Set(
  name.toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/[\s-]+/).filter((w) => w.length >= 4 && !STOP.has(w))));
// zzz802: a currency amount needs its magnitude word — "Rs. 1,113.51" with no
// crore / lakh / mn / bn is a per-share or price-like figure, never capex money.
const MONEY = /(?:₹|INR|Rs\.?)\s?[\d,]+(?:\.\d+)?\s*\+?\s*(?:crores?|cr\b|lakhs?|mn\b|million|bn\b|billion)|[\d,]+(?:\.\d+)?\s*\+?\s*(?:crores?|cr\b)/i;
const short = (s: string | null | undefined, n = 70): string | null => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (!t || /^not (?:stated|disclosed)$/i.test(t)) return null;
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const money = (s: string | null | undefined): string | null => {
  const m = MONEY.exec(String(s ?? ''));
  if (!m) return null;
  const v = m[0].replace(/\s+/g, ' ').trim();
  return /^(?:₹|INR|Rs)/i.test(v) ? v : `₹${v}`;   // crore is an Indian-rupee unit
};
/** "82.88 crore deployed in April 2026 and 36.93 crore in May 2026" →
 *  ["82.88 crore (April 2026)", "36.93 crore (May 2026)"]; plain amounts
 *  otherwise. Stated figures only — never summed. */
const amountsWithDates = (t: string): string[] => {
  const out: string[] = [];
  const re = /((?:₹|INR|Rs\.?)\s?)?([\d,]+(?:\.\d+)?\+?)\s*(crores?|cr\b|lakhs?|mn\b|million|bn\b|billion)(?:[^.;\d]{0,28}?\b(?:in|during)\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}|Q[1-4]\s?FY\d{2}|FY\d{2}))?/gi;
  for (const m of t.matchAll(re)) out.push(`${m[1] ? m[1].trim() : '₹'}${/^[A-Z]/i.test(m[1] || '') ? ' ' : ''}${m[2]} ${m[3].toLowerCase().startsWith('cr') ? 'cr' : m[3]}${m[4] ? ` (${m[4]})` : ''}`);
  return out;
};
/** The amount a sentence says the capex CONTRIBUTED, not the capex itself:
 *  "Jammu capex (~INR480+ crore) is already contributing revenue (INR107
 *  crores in Q1)" → "INR107 crores in Q1". */
const contributionAmount = (t: string): string | null => {
  const q = /((?:₹|INR|Rs\.?)\s?[\d,]+(?:\.\d+)?\s*(?:crores?|cr)\b)\s*(?:in|during|for)\s*(Q[1-4](?:\s?FY\d{2})?)/i.exec(t);
  if (q) return `${q[1]} in ${q[2]}`;
  const c = /contribut\w*[^.]{0,40}?((?:₹|INR|Rs\.?)\s?[\d,]+(?:\.\d+)?\s*(?:crores?|cr)\b)/i.exec(t);
  if (c) return c[1];
  // "subsidiary recorded revenue Rs.81.34 crore … in FY26" (BHAGCHEM). (zzz771)
  const r = /revenue(?: of)?\s?((?:₹|INR|Rs\.?)\s?[\d,]+(?:\.\d+)?\s*(?:crores?|cr)\b)(?:[^.;]{0,60}?\b(?:in|for|during)\s+(FY\d{2}|Q[1-4](?:\s?FY\d{2})?))?/i.exec(t);
  return r ? `${r[1]}${r[2] ? ` in ${r[2]}` : ''}` : null;
};
/** When a plan says it completes: "by the end of the financial year", "FY28". */
const whenOf = (t: string): string | null => {
  const m = /\b(by (?:the )?end of (?:the )?(?:financial year|FY\d{2}|\d{4})|by (?:FY\d{2}|20\d{2}|[A-Z][a-z]+ 20\d{2})|(?:from|in|during) (?:Q[1-4]\s?)?FY\d{2}|\d{1,2} to \d{1,2} months|(?:January|February|March|April|May|June|July|August|September|October|November|December) 20\d{2})\b/i.exec(t);
  return m ? m[1] : null;
};
const INVEST_IN = /(?:investment|capex|stake)\s+of\s+(?:₹|Rs\.?|INR)?\s?[\d,.]+\s*(?:Cr|crores?)\b\.?\s+in\s+([A-Z][A-Za-z&.-]+(?:\s+[A-Z][A-Za-z&.-]+){0,3})/;
const CAPEX_EVENT_VARS = new Set(['capex', 'capex_status', 'commissioning', 'capex_earning', 'new_plant', 'capacity_addition']);

interface Ev { variable: string; value_type: string; after: string | null; before: string | null; period: string | null; evidence_text: string; source: string; id: string | null; forward: boolean }

/** Pure: every capital project the evidence names, with its lifecycle. */
export function capexProjects(summary: any | null, ledger: CompanyLedger | null | undefined, vars: StructuralVar[] = []): CapexProject[] {
  const named: Array<{ name: string; tokens: string[]; row: any | null }> = [];
  const addNamed = (name: string, row: any | null) => {
    const tk = tokensOf(name);
    if (!tk.length || named.some((p) => p.tokens.join() === tk.join())) return;
    named.push({ name, tokens: tk, row });
  };
  for (const c of Array.isArray(summary?.capex_projects) ? summary.capex_projects : []) if (c?.name) addNamed(String(c.name), c);

  // Every non-historical capex event across the periods on file, oldest first.
  const evs: Ev[] = [];
  const periods = ledger?.periods ? Object.keys(ledger.periods).sort((a, b) => periodOrdinal(a) - periodOrdinal(b)) : [];
  for (const per of periods) {
    for (const raw of ledger!.periods[per]?.events || []) {
      if (!CAPEX_EVENT_VARS.has(raw.variable) && raw.variable !== 'utilisation') continue;
      const e = normalizeEvent(raw, per);
      if (e.historical_as_of) continue;
      // A transcript from two years before the period is not this period's
      // plan (CUPID's Jan 2024 "300 million units by end of 2024"). (zzz770)
      const srcYear = Number((/\b(20\d{2})\b/.exec(String(e.source || '')) || [])[1]);
      const fy = Number((/FY(\d{2})/.exec(per) || [])[1]);
      if (srcYear && fy && srcYear < 2000 + fy - 1) continue;
      const own = `${e.after ?? ''} ${e.period ?? ''}`;
      // A loan is not capex (MOREPENLAB's ₹13,000 lakh term loan). (zzz770)
      if (/\b(loans?|borrow\w*|credit facilit\w*|debentures?|repaid|repayment)\b/i.test(String(e.evidence_text || ''))
        && !/\b(capex|capital expenditure|plant|capacity|invest\w*|facility at)\b/i.test(String(e.evidence_text || ''))) continue;
      evs.push({ variable: e.variable, value_type: e.value_type, after: e.after ?? null, before: e.before ?? null, period: e.period ?? null,
        evidence_text: String(e.evidence_text || ''), source: String(e.source || ''), id: (raw as any).id ?? null,
        forward: e.value_type === 'GUIDANCE' || e.value_type === 'TARGET' || FORWARD_CUE.test(own) });
      const m = INVEST_IN.exec(String(e.evidence_text || ''));
      if (m) addNamed(m[1], null);
    }
  }
  // The capex-earning row, where the summary answered it in words.
  const ce = vars.find((v) => v.key === ('capex_earning' as VarKey));
  // One sentence about several projects cannot be pinned to one of them.
  if (ce?.after && named.length <= 1) evs.push({ variable: 'capex_earning', value_type: /not yet|will|expected|from FY\d{2}/i.test(ce.after) ? 'GUIDANCE' : 'ACTUAL',
    after: ce.after, before: null, period: null, evidence_text: ce.after, source: (ce as any).sourceLabel || 'summary', id: null,
    forward: /not yet|will (?:start )?contribut|expected|from FY\d{2}/i.test(ce.after) });

  const OTHER = '__other__';
  const buckets = new Map<string, Ev[]>();
  for (const e of evs) {
    // A money figure belongs to the project named NEAR it, not to one named
    // somewhere else in a long transcript answer (INNOVACAP's ₹500 cr).
    const ev = e.evidence_text;
    const at = e.after && money(e.after) ? ev.indexOf(String(money(e.after)).split(/\s/)[0].replace(/^(?:₹|INR|Rs\.?)/, '').trim()) : -1;
    const text = (at >= 0 ? `${e.after ?? ''} ${ev.slice(Math.max(0, at - 80), at + 80)}` : `${e.after ?? ''} ${ev}`).toLowerCase();
    let best: string | null = null, score = 0, tie = false;
    for (const p of named) {
      // "ex-Jammu capex" is explicitly NOT the Jammu project.
      const sc = p.tokens.filter((t) => new RegExp(`(?<!ex-)\\b${t}\\b`).test(text)).length;
      if (sc > score) { score = sc; best = p.name; tie = false; } else if (sc && sc === score) tie = true;
    }
    if (tie) best = null;
    // Company-wide utilisation or capacity is not a project fact.
    const key = best ?? (CAPEX_EVENT_VARS.has(e.variable) && e.variable !== 'capex_earning' ? OTHER : null);
    if (!key) continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(e);
  }

  const out: CapexProject[] = [];
  const all = [...named.map((p) => ({ name: p.name, row: p.row })), ...(buckets.has(OTHER) ? [{ name: OTHER, row: null }] : [])];
  for (const { name, row } of all) {
    const es = buckets.get(name) || [];
    if (!es.length && !row) continue;
    const steps = new Map<LifecycleStep, ProjectStep>();
    let curUC = false; let curConflict: string | null = null;
    const set = (step: LifecycleStep, state: 'actual' | 'target', value: string | null, e: Ev | null) => {
      const cur = steps.get(step);
      if (cur && cur.state === 'actual' && state === 'target') return;
      if (cur && cur.state === state) {
        if (e?.id) cur.sourceIds.push(e.id);
        if (value && cur.value && !cur.value.includes(value) && step === 'SPENT') cur.value = `${cur.value}; ${value}`;
        return;
      }
      steps.set(step, { step, state, value, quote: e ? short(e.evidence_text, 220) : null, source: e?.source || (row ? 'summary' : null), sourceIds: e?.id ? [e.id] : [] });
    };
    const spent: string[] = [];
    let announced: string | null = null, revised: string | null = null;
    for (const e of es) {
      const txt = `${e.after ?? ''} ${e.evidence_text}`;
      const own = `${e.after ?? ''} ${e.period ?? ''}`;
      const val = short(e.after, 80);
      switch (e.variable) {
        case 'capex':
        case 'capex_status':
        case 'new_plant': {
          const st = stageOf(e);
          if ((st === 'SPENDING' || (e.variable === 'capex_status' && SPENT_VERB.test(own))) && money(e.after)) {
            const num = (x: string) => x.split(' ')[0].replace(/[^\d.]/g, '');
            for (const a of amountsWithDates(String(e.after))) {
              const i = spent.findIndex((x) => num(x) === num(a));
              if (i < 0) spent.push(a);
              else if (/\(/.test(a) && !/\(/.test(spent[i])) spent[i] = a;   // keep the dated statement
            }
            set('SPENT', 'actual', spent.join('; ') || null, e);
            const cur = steps.get('SPENT'); if (cur) cur.value = spent.join('; ');
          } else if (st === 'ANNOUNCED' || e.forward) {
            const m = money(e.after);
            if (m && announced && money(announced) !== m && /revis|increas|enhanc|raised/i.test(txt)) revised = m;
            else if (m && !announced) announced = m;
            if (e.variable === 'capex' || m) set('ANNOUNCED', e.forward && !ANNOUNCE_WORDS.test(txt) ? 'target' : 'actual', m || (capexFigureOk(val, e.evidence_text) ? val : null), e);
            else if (/complet|commission/i.test(own)) set('COMMISSIONED', 'target', whenOf(own) || val, e);
          } else if (st === 'COMMERCIAL_PRODUCTION') set('COMMERCIAL_PRODUCTION', 'actual', val, e);
          else if (st === 'COMMISSIONED') set('COMMISSIONED', 'actual', val, e);
          else if (st === 'UNDER_CONSTRUCTION' && /complet|commission|commercial/i.test(own)) set('COMMISSIONED', 'target', whenOf(own) || val, e);
          break;
        }
        case 'commissioning': {
          const st = stageOf(e);
          if (e.forward || !st) set('COMMISSIONED', 'target', whenOf(own) || val, e);
          else set(st === 'COMMERCIAL_PRODUCTION' ? 'COMMERCIAL_PRODUCTION' : 'COMMISSIONED', 'actual', val, e);
          break;
        }
        case 'capacity_addition':
          set('CAPACITY_CREATED', e.forward ? 'target' : 'actual', `${short(e.after, 60)}${!e.forward && e.value_type === 'MANAGEMENT_CLAIM' ? ' (management statement)' : ''}`, e);
          if (!e.forward && /commission/i.test(txt) && !/to be commissioned|will be commissioned/i.test(txt)) set('COMMISSIONED', 'actual', val, e);
          break;
        case 'utilisation':
          set('UTILISATION', e.forward ? 'target' : 'actual', val, e);
          break;
        case 'capex_earning': {
          if (e.forward) set('REVENUE_CONTRIBUTION', 'target', whenOf(String(e.after)) ? `${money(e.after) ? `${money(e.after)} ` : ''}from ${whenOf(String(e.after))!.replace(/^(?:from|in|during) /i, '')}` : short(e.after, 80), e);
          else if (/contribut|revenue/i.test(txt)) set('REVENUE_CONTRIBUTION', 'actual', contributionAmount(txt) || short(e.after, 80), e);
          break;
        }
      }
      if (/margin contribution|contribut\w* to (?:the )?margins?|margin (?:accretive|accretion|benefit)/i.test(txt)) {
        const pendingM = /will come|as utili[sz]ation (?:increases|improves|ramps)|pending|yet to|not yet/i.test(txt);
        const clause = (/(?:^|[.;,(]\s*(?:but\s+|and\s+)?)([^.;,()]*margin contribution[^.;,()]*)/i.exec(txt) || [])[1] || txt;
        set('MARGIN_CONTRIBUTION', pendingM ? 'target' : 'actual', short(clause, 110), e);
      }
      if (/\broce\b|return on capital|payback|free cash/i.test(txt)) set('ROCE_FCF', e.forward ? 'target' : 'actual', short((/[^.;]*(?:roce|return on capital|payback|free cash)[^.;]*/i.exec(txt) || [txt])[0], 110), e);
    }
    // The summary's own utilisation line, when it names this project.
    const ut = summary?.utilisation || {};
    const utText = `${ut.basis || ''} ${ut.current || ''}`.toLowerCase();
    const mine = name !== OTHER && tokensOf(name).some((t) => new RegExp(`(?<!ex-)\\b${t}\\b`).test(utText));
    if (mine && said(ut.current)) {
      const tgt = said(ut.expected) ? short(String(ut.expected).split(/[;(]/)[0], 60) : null;
      steps.set('UTILISATION', { step: 'UTILISATION', state: 'actual', value: `${short(ut.current, 50)}${tgt ? ` · target ${tgt}` : ''}`,
        quote: short(`${ut.current}${said(ut.expected) ? ` — expected: ${ut.expected}` : ''}`, 220), source: 'summary', sourceIds: [] });
    }
    // The summary's own project row: amount, completion, revenue-from.
    if (row) {
      const amt = said(row.amount) ? String(row.amount) : null;
      // zzz802: a capex amount is money with a unit (or a percentage that names
      // its subject) — "2% to 3%" / "25%" is never an announced capex figure.
      const amtOk = amt ? (money(amt) || (capexFigureOk(amt) ? short(amt, 60) : null)) : null;
      if (amtOk && !steps.has('ANNOUNCED')) { set('ANNOUNCED', 'actual', amtOk, null); announced = announced || amtOk; }
      if (said(row.capacity_added) && !steps.has('CAPACITY_CREATED')) set('CAPACITY_CREATED', row.status === 'commissioned' ? 'actual' : 'target', short(row.capacity_added, 70), null);
      const comp = said(row.completion_period) ? String(row.completion_period) : null;
      // ── THE ROW'S OWN STATUS, CHECKED AGAINST ITS OWN DATE.        (zzz784)
      // "commercial_production" with a completion date already past (ETHOSLTD
      // City of Time, May 2025) is running; with one still ahead (IMFA KNR-1,
      // Q3 FY27) it is a conflict and stays a plan. A past-tense completion
      // phrase ("steam commissioned", "commenced operations Aug 2026") says it.
      const status = String(row.status || '').toLowerCase();
      // "Future" is judged against the newest document read (a filing dated
      // after quarter-end can report an event that has already happened).
      const pe = periodEnd(ledger?.latest_period || null);
      const dd = ledger?.latest_document_date ? new Date(String(ledger.latest_document_date).slice(0, 10)) : null;
      const asOf0 = dd && !isNaN(dd.getTime()) && (!pe || dd.getTime() > pe.getTime()) ? dd : pe;
      // A month named in the text is not "future" within the month of the newest document.
      const asOf = asOf0 ? new Date(Date.UTC(asOf0.getUTCFullYear(), asOf0.getUTCMonth() + 1, 0)) : null;
      const cd = completionDate(comp);
      const compFuture = !!comp && ((!!cd && !!asOf && cd.getTime() > asOf.getTime()) || (FORWARD_CUE.test(comp) && !/\b(commissioned|commenced|operational)\b/i.test(comp)));
      // A clause in the past tense with no future word in it ("steam
      // commissioned; power expected in ~45 days" — the first clause).
      const compDone = !!comp && comp.split(/[;()]/).some((cl) => /\b(commissioned|commenced (?:commercial )?(?:operations|production)|(?:is|now|already) operational|commerciali[sz]ed)\b/i.test(cl)
        && !/\b(by|expected|planned|will|to be|shall|targeted)\b/i.test(cl));
      if (/under[_ ]construction/.test(status)) curUC = true;
      if (comp) {
        if (/commerciali[sz]ed|commercial production|commercial operations|commenced operations/i.test(comp) && !FORWARD_CUE.test(comp)) set('COMMERCIAL_PRODUCTION', 'actual', short(comp.replace(/^commerciali[sz]ed\s*(?:in\s*)?/i, ''), 50), null);
        else if (/commercial[_ ]production/.test(status) && (!compFuture || compDone)) set('COMMERCIAL_PRODUCTION', 'actual', short(comp, 50), null);
        else if ((status === 'commissioned' && !compFuture) || compDone) set('COMMISSIONED', 'actual', short(comp, 50), null);
        else {
          set('COMMISSIONED', 'target', short(comp, 60), null);
          if (/commercial[_ ]production|commissioned/.test(status)) curConflict = `reported status "${status.replace(/_/g, ' ')}" conflicts with its stated completion ${short(comp, 40)} — validation required`;
          if (/commercial[_ ]production|commissioned/.test(status)) curUC = true;
        }
      } else if (/commercial[_ ]production/.test(status)) set('COMMERCIAL_PRODUCTION', 'actual', 'as reported', null);
      else if (status === 'commissioned') set('COMMISSIONED', 'actual', 'as reported', null);
      const rf = said(row.revenue_from) ? String(row.revenue_from) : null;
      if (rf && !/^not stated$/i.test(rf)) {
        if (/already contributing|contributed|contributing/i.test(rf) && money(rf)) {
          const amt = contributionAmount(rf) || money(rf)!;
          const q = /Q[1-4]\s?FY\d{2}/i.exec(rf);
          set('REVENUE_CONTRIBUTION', 'actual', `${amt}${q && !/ in Q/i.test(amt) ? ` in ${q[0]}` : ''}`, null);
        }
        else set('REVENUE_CONTRIBUTION', 'target', whenOf(rf) ? `from ${whenOf(rf)!.replace(/^(?:from|in|during|by) /i, '')}` : short(rf, 70), null);
      }
    }
    // ── ONE CHAIN, ONE MEASURE.                                       (zzz773)
    // LLOYDSENT chained "capacity added 150,000 MTPA → commissioned 55Mnt":
    // two figures, two measures, two assets. A commissioning figure that is
    // not the same measure and scope as the capacity it follows is not that
    // capacity's commissioning: the step is not claimed, and the line says why.
    let mismatch: string | null = null;
    {
      const cap = steps.get('CAPACITY_CREATED'), com = steps.get('COMMISSIONED');
      const capV = cap?.value ? cap.value.replace(/\s*\(management statement\)$/, '') : null;
      if (capV && com?.value && hasQuantity(capV) && isCapacityFigure(capV) && isCapacityFigure(com.value)) {
        mismatch = capacityMismatch({ value: com.value, quote: com.quote }, { value: capV, quote: cap!.quote });
        if (mismatch) steps.delete('COMMISSIONED');
      }
    }
    // A plant in commercial production has its capacity: a "planned" capacity
    // on the same project row is the capacity that now exists. (zzz784)
    { const cc = steps.get('CAPACITY_CREATED');
      if (cc && cc.state === 'target' && (steps.get('COMMERCIAL_PRODUCTION')?.state === 'actual' || steps.get('COMMISSIONED')?.state === 'actual')) cc.state = 'actual'; }
    // IMPLIED: a later ACTUAL step proves an earlier one happened even when
    // the documents never said so — marked as such, never as disclosed.
    const lastActual = LIFECYCLE_STEPS.reduce((m, st, i) => (steps.get(st)?.state === 'actual' ? i : m), -1);
    const ordered: ProjectStep[] = LIFECYCLE_STEPS.map((st, i) => steps.get(st)
      || (i < lastActual && ['SPENT', 'COMMISSIONED'].includes(st)
        ? { step: st, state: 'implied' as const, value: null, quote: null, source: null, sourceIds: [] }
        : { step: st, state: 'pending' as const, value: null, quote: null, source: null, sourceIds: [] }));
    if (!ordered.some((x) => x.state === 'actual' || x.state === 'target')) continue;

    const get = (st: LifecycleStep) => ordered.find((x) => x.step === st)!;
    const ACT: Record<LifecycleStep, string> = { ANNOUNCED: 'capex', SPENT: 'spent', CAPACITY_CREATED: 'capacity added', COMMISSIONED: 'commissioned',
      COMMERCIAL_PRODUCTION: 'commercial production', UTILISATION: 'utilisation', REVENUE_CONTRIBUTION: 'revenue contribution',
      MARGIN_CONTRIBUTION: 'margin contribution', ROCE_FCF: 'ROCE / FCF' };
    const TGT: Record<LifecycleStep, (v: string) => string> = {
      ANNOUNCED: (v) => `capex ${v} planned`, SPENT: (v) => `spend ${v} planned`, CAPACITY_CREATED: (v) => `capacity ${v} planned`,
      COMMISSIONED: (v) => `commissioning expected ${v}`, COMMERCIAL_PRODUCTION: (v) => `commercial production expected ${v}`,
      UTILISATION: (v) => `utilisation target ${v}`, REVENUE_CONTRIBUTION: (v) => `revenue contribution expected ${v}`,
      MARGIN_CONTRIBUTION: (v) => `margin contribution pending — ${v}`, ROCE_FCF: (v) => `ROCE / FCF expected ${v}`,
    };
    const parts: string[] = [];
    for (const x of ordered) {
      if (x.state === 'actual' && x.value) parts.push(`${ACT[x.step]} ${x.value}`);
      else if (x.state === 'target' && x.value) parts.push(TGT[x.step](x.value));
    }
    const rev = get('REVENUE_CONTRIBUTION'), mar = get('MARGIN_CONTRIBUTION');
    if (rev.state === 'pending') parts.push('revenue contribution pending');
    else if (rev.state === 'target') parts.push('earning pending');
    else if (mar.state === 'pending') parts.push('margin contribution pending');
    const line0 = parts.join(' → ').replace(/^./, (c) => c.toUpperCase());
    const line = mismatch ? `${line0} · ${mismatch}` : line0;

    const locMatch = /\b(?:at|in)\s+([A-Z][a-z]+(?:,\s*[A-Z][a-z]+)?)\b/.exec(name === OTHER ? '' : name);
    out.push({
      project_id: `capex_${(name === OTHER ? 'other' : tokensOf(name).join('_')).slice(0, 40)}`,
      name: name === OTHER ? 'Capacity and capex not tied to a named project' : name,
      location: locMatch ? locMatch[1] : (/,/.test(name) ? name.split(/\s+(?:facility|plant)/i)[0] : null),
      product: null,
      segment: null,
      purpose: row?.type ? String(row.type) : null,
      announced, revised, spent,
      completion: said(row?.completion_period) ? String(row.completion_period) : (get('COMMISSIONED').state === 'target' ? get('COMMISSIONED').value : null),
      capacity_added: get('CAPACITY_CREATED').value,
      commissioning_date: get('COMMISSIONED').state === 'actual' ? get('COMMISSIONED').value : null,
      commercial_production_date: get('COMMERCIAL_PRODUCTION').state === 'actual' ? get('COMMERCIAL_PRODUCTION').value : null,
      utilisation: get('UTILISATION').value,
      revenue_contribution: get('REVENUE_CONTRIBUTION').value,
      margin_contribution: get('MARGIN_CONTRIBUTION').value,
      roce_contribution: get('ROCE_FCF').state === 'actual' ? get('ROCE_FCF').value : null,
      fcf_contribution: null,
      source_ids: Array.from(new Set(ordered.flatMap((x) => x.sourceIds))),
      steps: ordered,
      line: (() => { const l = curConflict ? `${line} · ${curConflict}` : line;
        // A store opens; it is not commissioned or in commercial production. (zzz784)
        return isNetworkAsset({ name: name === OTHER ? '' : name, capacity_added: get('CAPACITY_CREATED').value } as CapexProject)
          ? l.replace(/commercial production|commissioned|commissioning expected/gi, (m) => (/expected/i.test(m) ? 'opening expected' : 'opened')) : l; })(),
      mismatch,
      underConstruction: curUC,
      statusConflict: curConflict,
    });
  }
  return out;
}

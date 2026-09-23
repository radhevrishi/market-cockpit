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
import { normalizeEvent } from './fact-normalize';

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
  /** "Capex earning yet?" as a state with its evidence, never a dash. */
  earning?: { state: 'not_yet' | 'commissioned_no_disclosure' | 'revenue' | 'unknown'; line: string; source: string | null } | null;
  /** Project-by-project lifecycle, announced → … → ROCE / FCF. (zzz770) */
  lifecycleProjects?: CapexProject[];
}

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
  if (e.variable === 'capex' && /\d/.test(String(e.after ?? '')) && !/commission|commercial|construct|operational/i.test(own)) {
    return ANNOUNCE_WORDS.test(t) && !SPENT_VERB.test(own) ? 'ANNOUNCED' : 'SPENDING';
  }
  if (/commercial[_ ]production|commerciali[sz]ed|commercial operations/i.test(t)) return 'COMMERCIAL_PRODUCTION';
  if (/\bcommissioned\b|\bcommissioning\b(?! of| date)|\boperational\b|\bonline\b|went live|\bdeployed\b|capacity ?expanded/i.test(t) && !/to be commissioned|will be commissioned|expected/i.test(t)) return 'COMMISSIONED';
  if (/under[_ ]construction|construction|installation|civil work|erection|trial/i.test(t)) return 'UNDER_CONSTRUCTION';
  // A capex FIGURE stated as an actual (not planned, not proposed) is money
  // spent; the forward case returned ANNOUNCED above.
  if (e.variable === 'capex' && /\d/.test(String(e.after ?? ''))) return ANNOUNCE_WORDS.test(t) && !SPENT_VERB.test(own) ? 'ANNOUNCED' : 'SPENDING';
  // "82.88 crore deployed in April 2026" is money out of the door. (zzz770)
  if (e.variable === 'capex_status' && SPENT_VERB.test(own) && /\d/.test(String(e.after ?? ''))) return 'SPENDING';
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

/** "Capex earning yet?" from the evidence, in words the card can print. */
export function capexEarning(vars: StructuralVar[], stage: CapexStage | null): CapexChain['earning'] {
  const row = vars.find((v) => v.key === ('capex_earning' as VarKey));
  const txt = String(row?.after || row?.evidence || '');
  const src = (row as any)?.sourceLabel || null;
  if (row && /not yet|will (?:start )?contribut|from FY\d{2}|expected to contribute|yet to/i.test(txt)) {
    const when = (/from (FY\d{2}|Q[1-4]\s?FY\d{2})/i.exec(txt) || [])[1];
    return { state: 'not_yet', line: `Not yet earning${when ? ` — revenue expected from ${when}` : ''}. ${txt.slice(0, 180)}`, source: src };
  }
  if (row && /contribut|revenue of|INR\s?[\d,.]+\s?crores? in Q/i.test(txt)) {
    const amt = (/(?:INR|Rs\.?|₹)\s?[\d,.]+\s?(?:crores?|cr|mn|million)(?: in Q[1-4])?/i.exec(txt) || [])[0];
    return { state: 'revenue', line: `Revenue contribution${amt ? ` ${amt}` : ' disclosed'}. ${txt.slice(0, 180)}`, source: src };
  }
  if (stage && ord(stage) >= ord('COMMISSIONED')) {
    return { state: 'commissioned_no_disclosure', line: `${STAGE_LABEL[stage]} — financial contribution not yet disclosed.`, source: src };
  }
  if (stage) return { state: 'not_yet', line: `Not yet earning — ${STAGE_LABEL[stage].toLowerCase()}, commissioning pending.`, source: src };
  return null;
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
  const earning = capexEarning(vars, reached);
  // A disclosed revenue contribution is itself proof the capacity was built.
  const stage: CapexStage | null = earning?.state === 'revenue' ? 'REVENUE_CONTRIBUTION' : reached;
  const base = buildCapexChainCore(summary, vars, stage);
  const lifecycleProjects = capexProjects(summary, ledger, vars);
  // A disclosed revenue contribution is the capex STARTING to earn — never
  // "cannot be checked" (INNOVACAP ₹107 cr in Q1). Margin contribution is a
  // separate, later step and is said to be open. (zzz770)
  if (earning?.state === 'revenue' && (base.state === 'unverifiable' || base.state === 'commissioned_not_earning')) {
    return { ...base, state: 'starting_to_earn', lifecycle, stage, earning, lifecycleProjects,
      because: `${earning.line.split('. ')[0]}. Revenue contribution is disclosed; margin contribution is a separate step and is not yet established.`,
      nextCheck: 'Whether utilisation rises and the margin follows the revenue — revenue contribution is not margin contribution.' };
  }
  return { ...base, lifecycle, stage, earning, lifecycleProjects };
}

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
    return { state: 'none', links, projects: mapped,
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
      links, projects: mapped,
      because: anyDate
        ? `Capital programme disclosed with a commissioning date${mapped[0]?.completes ? ` (${mapped[0].completes})` : ''}, and no utilisation figure yet — it is being built.`
        : 'Capital programme announced with no commissioning date and no utilisation figure. This is a commitment, not yet a result.',
      nextCheck: 'Hold management to the commissioning date, then to the utilisation figure that follows it.',
    };
  }

  // Built. Now the only question that matters: is it earning?
  if (utDelta == null) {
    return {
      state: utNow == null ? 'commissioned_not_earning' : 'unverifiable', links, projects: mapped,
      because: utNow == null
        ? `The documents state the capacity is ${stage ? STAGE_LABEL[stage].toLowerCase() : 'commissioned'}; no utilisation figure is disclosed, so how far it has filled cannot be read.`
        : `Utilisation is ${utNow}% but no prior figure was disclosed, so whether the new capacity is filling cannot be established from this filing alone.`,
      nextCheck: 'The next filing gives a second utilisation point, and the direction becomes readable.',
    };
  }

  if (utDelta <= 1 && revDown) {
    return {
      state: 'disappointment', links, projects: mapped,
      because: `Capacity is commissioned, utilisation moved ${utDelta >= 0 ? '+' : ''}${utDelta.toFixed(0)}pp (${utPrior}% → ${utNow}%) and revenue is falling. `
        + 'The money is in the ground and the earnings have not appeared.',
      nextCheck: 'This is the condition that ends a capacity-led thesis. Check order intake and management\'s explanation before anything else.',
    };
  }

  if (utDelta <= 1) {
    return {
      state: 'commissioned_not_earning', links, projects: mapped,
      because: `Capacity is commissioned and utilisation is flat at ${utNow}% (${utPrior}% before). Revenue and margin have not yet responded. `
        + 'Early in a ramp this is normal; it is also what a disappointment looks like in its first quarters.',
      nextCheck: utExp != null
        ? `Management expects ${utExp}%${said(ut.expected_by) ? ` by ${ut.expected_by}` : ''}. That figure is the promise to check next quarter.`
        : 'Two more quarters of utilisation separate a slow ramp from a disappointment.',
    };
  }

  if (utDelta > 1 && revUp && margUp) {
    return {
      state: 'earning', links, projects: mapped,
      because: `Utilisation ${utPrior}% → ${utNow}% (${utDelta >= 0 ? '+' : ''}${utDelta.toFixed(0)}pp), revenue ${rev?.after}, margin ${marg?.delta || 'up'}. `
        + 'Every link in the chain moved — the capital produced the earnings.',
      nextCheck: null,
    };
  }

  return {
    state: 'starting_to_earn', links, projects: mapped,
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
}

const STOP = new Set(['facility', 'facilities', 'plant', 'plants', 'capacity', 'expansion', 'programme', 'program', 'project',
  'projects', 'greenfield', 'brownfield', 'manufacturing', 'part', 'capex', 'unit', 'units', 'line', 'lines', 'phase', 'total',
  'investment', 'crore', 'crores', 'plot', 'power', 'based', 'with', 'from', 'into', 'this', 'that', 'components', 'capability',
  'additions', 'addition', 'stated', 'being', 'built', 'company', 'strategic']);
const tokensOf = (name: string): string[] => Array.from(new Set(
  name.toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/[\s-]+/).filter((w) => w.length >= 4 && !STOP.has(w))));
const MONEY = /(?:₹|INR|Rs\.?)\s?[\d,]+(?:\.\d+)?\s*\+?\s*(?:crores?|cr\b|lakhs?|mn|million|bn|billion)?|[\d,]+(?:\.\d+)?\s*\+?\s*(?:crores?|cr\b)/i;
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
  return c ? c[1] : null;
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
            if (e.variable === 'capex' || m) set('ANNOUNCED', e.forward && !ANNOUNCE_WORDS.test(txt) ? 'target' : 'actual', m || val, e);
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
      if (amt && !steps.has('ANNOUNCED')) { set('ANNOUNCED', 'actual', money(amt) || short(amt, 60), null); announced = announced || money(amt) || short(amt, 60); }
      if (said(row.capacity_added) && !steps.has('CAPACITY_CREATED')) set('CAPACITY_CREATED', row.status === 'commissioned' ? 'actual' : 'target', short(row.capacity_added, 70), null);
      const comp = said(row.completion_period) ? String(row.completion_period) : null;
      if (comp) {
        if (/commerciali[sz]ed|commercial production|commercial operations/i.test(comp) && !FORWARD_CUE.test(comp)) set('COMMERCIAL_PRODUCTION', 'actual', short(comp.replace(/^commerciali[sz]ed\s*(?:in\s*)?/i, ''), 50), null);
        else if (row.status === 'commissioned') set('COMMISSIONED', 'actual', short(comp, 50), null);
        else set('COMMISSIONED', 'target', short(comp, 60), null);
      }
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
    const line = parts.join(' → ').replace(/^./, (c) => c.toUpperCase());

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
      line,
    });
  }
  return out;
}

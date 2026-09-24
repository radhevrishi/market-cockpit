// ═══════════════════════════════════════════════════════════════════════════
// PERSISTENCE TEST — one explicit, small, deterministic test.        (zzz785 C)
//
//   mechanism · runway · evidence · repeatability · duration (only when
//   disclosed) · milestone · invalidation  →  HIGH / MEDIUM / EARLY / TEMPORARY
//   plus ONE plain-English sentence saying why.
//
// Three things stay separate and visible (they are NOT one number):
//   1. potential persistence       — how long an event of this TYPE could last
//                                    (research-view persistenceOf: DAYS/QUARTER/YEARS)
//   2. evidence-supported           — what the filings prove (persistenceEvidenceOf)
//   3. expected duration            — ONLY what the company disclosed; else "Not disclosed"
//
// This file does not re-derive (1) or (2): research-view passes them in, so the
// POTENTIAL DURATION logic lives in one place. No price. No score machine —
// the grade is four readable rules.
// ═══════════════════════════════════════════════════════════════════════════

import type { EventKind, PersistenceGrade, PersistenceTest, StructuredFacts } from './structured-facts';
import type { CatalystView } from './catalyst-timeline';
import { NON_OPERATING_KINDS, isOfficial } from './catalyst-timeline';

export interface PersistenceTestView extends PersistenceTest {
  potential: string;            // (1)
  evidenceSupported: string;    // (2)
  expectedDuration: string;     // (3) disclosed or "Not disclosed"
}

export interface PersistenceTestInput {
  kind: EventKind | null;
  facts: StructuredFacts[];
  record: CatalystView | null;
  /** research-view persistenceOf(): the potential duration of this TYPE. */
  potential: 'DAYS' | 'QUARTER' | 'YEARS' | 'UNKNOWN';
  /** research-view persistenceEvidenceOf(). */
  evidenceLevel: 'NOT_PERSISTENT' | 'UNPROVEN' | 'EARLY' | 'EVIDENCE' | 'STRONG' | 'NONE';
  evidenceText: string;
  /** zzz787: the potential-economic-duration sentence research-view derived
   *  from the FACTS (contract term, programme words, stated capacity), with
   *  its basis. When given it replaces the by-type wording. Never evidence. */
  potentialText?: string | null;
  /** Headline + quote text of the finding (legacy path), for disclosed-period words. */
  hay: string;
  market: 'IN' | 'US';
  /** zzz789: the event's economics are QUANTIFIED in a read official document
   *  (a firm value / capex / consideration / target revenue — never a stated
   *  "potential"). Omitted → read from the record's official DOCUMENT_READ facts. */
  quantified?: boolean;
}

const POTENTIAL_WORD: Record<PersistenceTestInput['potential'], string> = {
  YEARS: 'Could last years (by type of event)', QUARTER: 'Could last about a quarter or one execution period (by type of event)',
  DAYS: 'Days — a one-time event by type', UNKNOWN: 'Unknown',
};

const money = (v: number, m: 'IN' | 'US', cur: string | null) => ((cur === 'USD_M' || (!cur && m === 'US')) ? `$${v >= 100 ? Math.round(v) : v}M` : `₹${v >= 100 ? Math.round(v).toLocaleString('en-IN') : v} Cr`);

function mechanismOf(kind: EventKind | null, f: StructuredFacts | null, m: 'IN' | 'US'): string | null {
  const e = f?.economics;
  const val = e?.valueNative != null ? money(e.valueNative, m, e.currency) : null;
  const who = f?.event.counterparty ? ` from ${f.event.counterparty}` : '';
  switch (kind) {
    case 'order': return `Order${who}${val ? ` of ${val}` : ' (value not disclosed)'} adds to the order book → revenue as it is executed.`;
    case 'capacity': return `More capacity${e?.capacityBefore && e?.capacityAfter ? ` (${e.capacityBefore} → ${e.capacityAfter})` : ''} → more volume, if demand fills it.`;
    case 'qualification': return `Approved supplier${who} → can win commercial orders; nothing booked until an order is filed.`;
    case 'acquisition': return `Adds the target's revenue and profit${e?.targetRevenueNative != null ? ` (target revenue ${money(e.targetRevenueNative, m, e.currency)})` : ' (target economics not disclosed)'} from completion.`;
    case 'new_product': return 'New product → new revenue only once customers order it.';
    case 'partnership': return 'Partnership → revenue only once a binding order or supply starts.';
    case 'stake_by_strategic': case 'strategic_investment': return 'A strategic investor taking a stake — signals interest; not by itself revenue.';
    case 'strategic_expansion': return 'A new subsidiary / geography → revenue only once it wins orders or starts selling.';
    case 'merger': return 'Combined business → the merged entity\'s revenue and profit, from the effective date.';
    case 'results': return 'Reported earnings change — persists only if next quarters repeat it.';
    case 'guidance': return 'Management target — a milestone, not evidence.';
    default: return null;   // financing, registrations, demands: no operating mechanism
  }
}

function disclosedDuration(facts: StructuredFacts[], hay: string): string | null {
  const t = facts.map((x) => x.time.executionPeriod).find(Boolean);
  if (t) return t;
  // Only an explicit period in the filing text counts ("over 24 months", "5-year contract").
  const m = /\b(over|within|for|of)\s+(a\s+)?(\d{1,2}(?:\.\d)?)\s*[- ]?(months?|years?|yrs?)\b|\b(\d{1,2})[- ](year|month)s?\s+(contract|agreement|order|programme|program|supply)\b/i.exec(hay);
  if (!m) return null;
  return m[3] ? `${m[3]} ${m[4].replace(/^yrs?$/i, 'years')}` : `${m[5]} ${m[6]}s`;
}

const RX_REPEAT = /\brepeat (order|customer)|\brecurring\b|\bannual(ly)?\b|per annum|\bprogramm?e?s?\b|framework|rate contract|multi-?year|follow-on|\bagain\b/i;

export function persistenceTestOf(inp: PersistenceTestInput): PersistenceTestView {
  const facts = inp.facts;
  const latest = facts[facts.length - 1] || null;
  const kind = inp.kind;
  const rec = inp.record;
  const mechanism = mechanismOf(kind, latest, inp.market);
  const duration = disclosedDuration(facts, inp.hay);
  const capRunway = latest?.economics.capacityAfter ? `Capacity after: ${latest.economics.capacityAfter}` : null;
  const runway = duration ? `Execution period ${duration} (as disclosed)` : capRunway;
  const official = !!rec && rec.sources.some(isOfficial);
  const followUps = rec ? new Set(rec.sources.filter(isOfficial).map((s) => s.date).filter(Boolean)).size : 0;
  const evidence = !rec ? (inp.evidenceLevel === 'NONE' ? null : inp.evidenceText)
    : rec.state === 'CONFIRMED' ? 'Completed / delivering — on file.'
      : rec.state === 'EXECUTING' ? `Follow-up official evidence on file (${followUps} dated filings).`
        : official ? 'One official filing on file — nothing delivered yet.' : 'Press only — not in an official filing yet.';
  const repeatability = followUps >= 2 && (kind === 'order' || kind === 'qualification') ? `${followUps} filings about the same customer / programme — repeat business.`
    : RX_REPEAT.test(`${inp.hay} ${facts.map((x) => x.quotes.join(' ')).join(' ')}`) ? 'Filing describes recurring / programme / annual business — confirm it is fixed, not an initial award.' : null;
  const milestone = rec?.nextMilestone || null;
  const invalidation = rec?.invalidation || null;

  // ── zzz789: explicit rules, in order ──
  // Event type alone never sets the grade. TEMPORARY needs EVIDENCE of a
  // one-off / finite effect; anything above EARLY needs QUANTIFIED economics
  // AND repeat / continuation evidence in official documents. A contract term,
  // a programme or an "annual" word is a claim about the future — shown as the
  // runway / repeatability line, never as persistence evidence by itself.
  let grade: PersistenceGrade; let why: string;
  const weak = rec?.state === 'WEAKENING' || rec?.state === 'DISPROVED';
  const allText = `${inp.hay} ${facts.map((x) => `${x.source.title} ${x.quotes.join(' ')}`).join(' ')}`;
  const statedOneOff = /\bone[- ](?:off|time)\b|\bnon[- ]recurring\b|\bexceptional item\b|\bsingle (?:payment|instalment)\b/i.test(allText);
  const finiteDemand = (kind === 'tax_litigation' || kind === 'regulatory_negative') && facts.some((x) => x.economics.valueNative != null || /\b(demand|penalt\w*|fine)\b[^.]{0,40}(₹|rs\.?|inr|\$)\s*[\d,]/i.test(`${x.source.title} ${x.quotes.join(' ')}`));
  const quantified = inp.quantified ?? facts.some((x) => isOfficial(x.source) && x.source.access === 'DOCUMENT_READ'
    && [x.economics.valueNative, x.economics.considerationNative, x.economics.capex, x.economics.targetRevenueNative, x.economics.targetProfitNative].some((v) => v != null));
  const continuation = followUps >= 2 || inp.evidenceLevel === 'STRONG';
  if (rec?.state === 'DISPROVED' || kind === 'resale_registration' || finiteDemand || (statedOneOff && !(mechanism && continuation))) {
    grade = 'TEMPORARY';
    why = rec?.state === 'DISPROVED' ? 'The catalyst was cancelled or denied in a later filing, so nothing persists.'
      : kind === 'resale_registration' ? 'A resale registration moves existing stock; it is not a business change, so nothing persists.'
        : finiteDemand ? 'A stated, finite demand or penalty — a one-off amount; it matters again only if similar demands recur.'
          : 'The filing itself calls it one-off / non-recurring.';
  } else if ((kind && NON_OPERATING_KINDS.has(kind)) || inp.evidenceLevel === 'NOT_PERSISTENT' || (!mechanism && inp.potential === 'DAYS')) {
    grade = 'EARLY';
    why = kind === 'debt' ? 'Debt redeemed / raised — whether it lastingly changes interest cost, cash flow or leverage is not established yet (not shown to be one-off either).'
      : kind === 'fundraising' ? 'Money raised persists only through what it is spent on — the use of proceeds and its returns are not established yet.'
        : kind === 'promoter_buying' || kind === 'capital_allocation' ? 'An ownership / capital-allocation change — no operating mechanism is established, and it is not shown to be one-off either.'
          : kind === 'tax_litigation' || kind === 'regulatory_negative' ? 'A regulatory / legal matter with no stated amount — its effect is not established.'
            : 'No operating mechanism is established yet — and nothing on file shows the effect is one-off. Early / unproven.';
  } else if (!weak && mechanism && official && quantified && continuation && (runway || duration) && (rec!.state === 'EXECUTING' || rec!.state === 'CONFIRMED' || inp.evidenceLevel === 'STRONG')) {
    grade = 'HIGH';
    why = 'Quantified economics in official filings, a stated runway and repeat / continuation evidence on file, so the effect can carry across several periods.';
  } else if (!weak && mechanism && official && quantified && continuation) {
    grade = 'MEDIUM';
    why = runway ? 'Quantified and repeated in official filings, but the runway is not yet executing.' : 'Quantified and repeated in official filings, but no execution period is disclosed.';
  } else {
    grade = 'EARLY';
    why = weak ? 'A later filing shows a delay or cut, so persistence is back to unproven.'
      : !official ? 'Only secondary sources so far — an official filing is needed before anything is proven.'
        : !mechanism ? 'The route from this event to revenue is not described in the filing.'
          : !quantified && runway ? `${runway} is a runway, not evidence — the value, billing and repeat business are not on file yet. Early / unproven.`
            : !quantified ? 'The economics (value, margin, revenue) are not quantified in an official document yet. Early / unproven.'
              : 'Quantified once — persistence needs repeat orders, renewals or billing in a later official filing. Early / unproven.';
  }
  return {
    mechanism, runway, evidence, repeatability, duration, milestone, invalidation, grade, why,
    potential: inp.potentialText || POTENTIAL_WORD[inp.potential],
    evidenceSupported: inp.evidenceText,
    expectedDuration: duration ? `${duration} (as disclosed)` : 'Not disclosed',
  };
}

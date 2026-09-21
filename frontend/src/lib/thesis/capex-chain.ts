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
  none: { label: 'No capex on file', color: '#64748B', dot: '○',
    meaning: 'The latest filing discloses no capital programme.' },
  announced: { label: 'CAPEX ANNOUNCED', color: '#94A3B8', dot: '📋',
    meaning: 'Money committed against a promise. Nothing has been proven yet — this is the state with the most excitement and the least information.' },
  under_construction: { label: 'UNDER CONSTRUCTION', color: '#60A5FA', dot: '🏗',
    meaning: 'Being built. The date to hold management to is the commissioning date.' },
  commissioned_not_earning: { label: 'COMMISSIONED — NOT YET EARNING', color: '#F59E0B', dot: '🟡',
    meaning: 'The plant exists and utilisation is still low. This is normal early, and it is also what a disappointment looks like at the start. The next two quarters separate them.' },
  starting_to_earn: { label: 'STARTING TO EARN', color: '#34D399', dot: '🟢',
    meaning: 'Utilisation is rising and revenue is following. The capex is converting.' },
  earning: { label: 'EARNING', color: '#10B981', dot: '✅',
    meaning: 'Utilisation high, revenue and margin both moved. The money produced the earnings.' },
  disappointment: { label: 'CAPEX DISAPPOINTMENT', color: '#EF4444', dot: '🔴',
    meaning: 'Commissioned, and utilisation has not moved while revenue is weak. The money is in the ground and the earnings did not come.' },
  unverifiable: { label: 'CAPEX — CANNOT BE CHECKED', color: '#64748B', dot: '◌',
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
}

const pctIn = (s: unknown): number | null => {
  if (!said(s)) return null;
  const m = String(s).match(/-?\d+(?:\.\d+)?/);
  const v = m ? Number(m[0]) : NaN;
  return Number.isFinite(v) ? v : null;
};

export function buildCapexChain(summary: any | null, vars: StructuralVar[]): CapexChain {
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

  if (!mapped.length) {
    return { state: 'none', links, projects: mapped,
      because: 'No capital programme disclosed in the latest filing.', nextCheck: null };
  }

  // Has it been built? A stated completion period in the past tense is not
  // reliably parseable across two markets' filing styles, so the honest proxy
  // is whether utilisation is being disclosed at all: companies report
  // utilisation when there is a plant running to report on.
  const commissioned = utNow != null;

  if (!commissioned) {
    const anyDate = mapped.some((p) => p.completes);
    return {
      state: anyDate ? 'under_construction' : 'announced',
      links, projects: mapped,
      because: anyDate
        ? `Capital programme disclosed with a commissioning date${mapped[0].completes ? ` (${mapped[0].completes})` : ''}, and no utilisation figure yet — it is being built.`
        : 'Capital programme announced with no commissioning date and no utilisation figure. This is a commitment, not yet a result.',
      nextCheck: 'Hold management to the commissioning date, then to the utilisation figure that follows it.',
    };
  }

  // Built. Now the only question that matters: is it earning?
  if (utDelta == null) {
    return {
      state: 'unverifiable', links, projects: mapped,
      because: `Utilisation is ${utNow}% but no prior figure was disclosed, so whether the new capacity is filling cannot be established from this filing alone.`,
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

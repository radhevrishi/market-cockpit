// ═══════════════════════════════════════════════════════════════════════════
// A PROVISIONAL THESIS TYPE FOR EVERY US HOLDING WITH SEC DATA.      (zzz793)
//
// The India book assigns a type in three steps (lib/earnings/pattern-abfg):
// the exact A / B / F / G test, then a NEAREST FIT from the same figures
// (fit 'nearest' — provisional, labelled, never affirmative), then nothing.
// On the US page that last step left 16 of 30 holdings at THESIS NOT SET,
// including companies with a full set of SEC figures (ITW, AKAM, OII …),
// because their quarter fitted none of the India nearest-fit bands.
//
// The owner holds each of them for a reason. So after India's own two steps
// the US page takes one more, deterministic and from the company's OWN SEC
// data only — the latest filed period and its SEC business classification
// (SIC). Rules, first match wins:
//
//   B  a filed backlog measure (remaining performance obligations) growing
//      faster than revenue — orders ahead of revenue
//   F  profit swung from a loss to a profit, or rose ≥ 30% and at least
//      twice as fast as revenue — a profit jump
//   A  operating margin up ≥ 1 point, or revenue up ≥ 15% — the operating
//      turn is the thing to watch
//   G  revenue not falling, a profit, earnings not down more than 10%, and
//      cash conversion not below 0.8× — quiet, cash-backed
//   —  no figure fits: the business classification decides (order-driven
//      industries → B, everything else → A), said as a WEAK fit
//
// Every result is fit 'nearest' → the shared engine never lets it read an
// affirmative (or a thesis-break) status: at most CONFIRMATION REQUIRED until
// the owner confirms the type with the picker. The owner's saved type
// (us-thesis:types:v1) always wins. THESIS NOT SET remains only where there
// is truly nothing: no SEC filer, or no figures and no business classification.
// ═══════════════════════════════════════════════════════════════════════════

import { ABFG_META, type AbfgPattern, type AbfgResult } from '@/lib/earnings/pattern-abfg';
import type { UsSecProfile } from './facts-row';

const EXIT: Record<AbfgPattern, string> = {
  A: 'Margin expansion stops AND revenue growth decelerates for two consecutive quarters. Not a drawdown, not a weak market, not one flat quarter.',
  B: 'Book-to-bill below 1.0 for two consecutive quarters, or incremental order margin below the existing book. Not one slow quarter of execution.',
  F: 'The next quarter fails to confirm, or forensics find a below-the-line explanation. Not the stock failing to move — that delay is the edge.',
  G: 'The named catalyst passes its date with no effect, or cash conversion breaks (CFO below PAT for two quarters). Not boredom.',
};

/** Order-driven industries by SIC: construction, machinery, electrical and
 *  electronic equipment, aerospace & defence, instruments, engineering. */
export function orderDrivenSic(sic: string | null | undefined): boolean {
  const n = Number(sic);
  if (!Number.isFinite(n)) return false;
  return (n >= 1500 && n <= 1799) || (n >= 3510 && n <= 3599) || (n >= 3610 && n <= 3629) || (n >= 3720 && n <= 3799)
    || (n >= 3810 && n <= 3829) || n === 3663 || n === 8711;
}

const f1 = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v * 10) / 10}`;

export interface UsTypeInputs {
  salesY: number | null; earnY: number | null;
  niCur: number | null; niPrev: number | null;
  opmChange: number | null; cfoToPat: number | null;
  rpoY: number | null; sic: string | null; sicDescription: string | null;
  periodWords: string;
}

/** The inputs, from the grader row when there is one, else the profile's period. */
export function usTypeInputs(graded: any | null, sec: UsSecProfile | null | undefined): UsTypeInputs | null {
  const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  if (graded) {
    return {
      salesY: n(graded.sales_yoy_pct), earnY: n(graded.net_profit_yoy_pct) ?? n(graded.eps_yoy_pct),
      niCur: n(graded.net_income_curr_musd), niPrev: n(graded.net_income_prev_musd),
      opmChange: n(graded.opm_change_pp), cfoToPat: n(graded.cfo_to_pat_ratio),
      rpoY: n(graded.rpo_growth_pct) ?? n(sec?.rpo_growth_pct), sic: graded.sic ?? sec?.sic ?? null, sicDescription: graded.industry ?? sec?.sic_description ?? null,
      periodWords: String(graded.period || 'the latest quarter'),
    };
  }
  if (!sec) return null;
  const p = sec.period;
  return {
    salesY: n(p?.sales_growth_pct), earnY: n(p?.earnings_growth_pct),
    niCur: n(p?.net_income), niPrev: n(p?.net_income_prev),
    opmChange: p && p.opm_pct != null && p.opm_prev_pct != null ? Math.round((p.opm_pct - p.opm_prev_pct) * 10) / 10 : null,
    cfoToPat: n(p?.cfo_to_pat), rpoY: n(sec.rpo_growth_pct), sic: sec.sic, sicDescription: sec.sic_description,
    periodWords: p?.label ? `${p.label}${p.basis !== 'quarterly' ? `, ${p.basis === 'annual' ? 'annual' : 'half-year'} figures` : ''}` : 'no SEC figures',
  };
}

/**
 * The US nearest fit, after India's exact and nearest tests found nothing.
 * Null only when there is nothing to fit from (no figures and no SIC).
 */
export function usNearestType(inp: UsTypeInputs | null): AbfgResult | null {
  if (!inp) return null;
  const { salesY, earnY, niCur, niPrev, opmChange, cfoToPat, rpoY, sic, sicDescription } = inp;
  const hasFigures = salesY != null || earnY != null || niCur != null || opmChange != null;
  if (!hasFigures && !sic) return null;
  const out = (pattern: AbfgPattern, why: string, weak = false): AbfgResult => ({
    pattern, ratio: null, fit: 'nearest', exitCondition: EXIT[pattern],
    because: `Nearest fit (auto, provisional) — ${pattern} · ${ABFG_META[pattern].name.toLowerCase()}: ${why} (${inp.periodWords}). `
      + `${weak ? 'A weak fit — nothing in the figures points clearly at one type. ' : ''}Worked out from the company's own SEC data, not confirmed by you — confirm or change it with the picker.`,
  });
  if (rpoY != null && salesY != null && rpoY > Math.max(salesY, 0) + 5) {
    return out('B', `filed backlog (remaining performance obligations) ${f1(rpoY)}% against revenue ${f1(salesY)}% — orders are growing ahead of revenue`);
  }
  if (niPrev != null && niCur != null && niPrev < 0 && niCur > 0) {
    return out('F', 'profit swung from a loss a year earlier to a profit now — a profit jump to be checked for durability');
  }
  if (earnY != null && earnY >= 30 && earnY >= 2 * Math.max(salesY ?? 0, 1)) {
    return out('F', `earnings ${f1(earnY)}% against revenue ${salesY != null ? `${f1(salesY)}%` : 'not stated'} — profit rising much faster than sales`);
  }
  if (opmChange != null && opmChange >= 1 && (salesY == null || salesY >= 0)) {
    return out('A', `operating margin ${f1(opmChange)} points year on year${salesY != null ? ` with revenue ${f1(salesY)}%` : ''} — an operating turn in progress`);
  }
  if (salesY != null && salesY >= 15) {
    return out('A', `revenue ${f1(salesY)}%${earnY != null ? `, earnings ${f1(earnY)}%` : ''} — volume growth; whether margins follow is the test`);
  }
  if (salesY != null && salesY >= 0 && niCur != null && niCur > 0 && (earnY == null || earnY >= -10) && (cfoToPat == null || cfoToPat >= 0.8)) {
    return out('G', `revenue ${f1(salesY)}%${earnY != null ? `, earnings ${f1(earnY)}%` : ''}${cfoToPat != null ? `, cash conversion ${cfoToPat.toFixed(2)}×` : ''} — steady and cash-backed`);
  }
  const words = sicDescription ? `its SEC business classification is "${sicDescription}"` : `its SEC industry code is ${sic}`;
  if (orderDrivenSic(sic)) return out('B', `${hasFigures ? 'the figures fit no type; ' : 'no SEC figures to fit; '}${words}, an order-driven business`, true);
  return out('A', `${hasFigures ? 'the figures fit no type; ' : 'no SEC figures to fit; '}${words} — the thesis to test is an operating turn`, true);
}

/** Why a US row has no type at all (THESIS NOT SET), in plain words. */
export function usNoTypeReason(sec: UsSecProfile | null | undefined, gradedWhy: string | null | undefined): string {
  if (!sec) return gradedWhy || 'no SEC filer found for this ticker, so there are no SEC figures to fit a thesis type from';
  return sec.note || gradedWhy || 'no SEC figures and no business classification to fit a thesis type from';
}

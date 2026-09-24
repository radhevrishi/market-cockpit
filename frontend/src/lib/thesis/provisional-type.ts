// ═══════════════════════════════════════════════════════════════════════════
// A PROVISIONAL THESIS TYPE FOR EVERY INDIA NAME WITH ANY FIGURES.  (zzz794)
//
// The book assigns a type in steps: the owner's own choice (the picker) →
// the exact A / B / F / G test (lib/earnings/pattern-abfg) → the filing's
// order-book re-test → the nearest fit from the same graded figures. The
// nearest-fit bands are narrow on purpose (they were tuned on the screening
// pages), so 29–30 of the ~115 names on Portfolio Catalysts fell through all
// of them and read THESIS NOT SET — although every one of them had a full
// quarter of figures on file (CLEANMAX and E2E swung from a loss to a
// profit; TDPOWERSYS's order intake grew 87% against revenue 72%; ACE's
// earnings grew 1.08× revenue, just under the 1.1× line …).
//
// So one more deterministic step runs AFTER those, from the company's own
// figures only — the graded / screener results row and the evidence ledger's
// latest read. Rules, first match wins:
//
//   B  order book / order intake growing faster than revenue (≥ 15% and at
//      least 5 points ahead), or book-to-bill ≥ 1.2
//   F  profit swung from a loss to a profit, or earnings ≥ +50% and at least
//      twice revenue growth — a profit jump
//   A  operating margin up ≥ 1 point with revenue not falling — operating
//      leverage
//   A  revenue ≥ +15% — volume growth; whether margins follow is the test
//   G  revenue not falling, a profit, earnings not down more than 10%, and
//      cash conversion ≥ 0.8× or ROCE ≥ 15% — quiet, cash-backed
//   A  capacity added / commissioned or utilisation stated — utilisation and
//      operating leverage are the test
//   —  nothing in the figures points at one type: the industry / business
//      words decide (order-driven → B, everything else → A), labelled a
//      WEAK FIT.
//
// Every result is fit 'nearest' — the status engine therefore never lets it
// read an affirmative verdict (or a thesis break): at most CONFIRMATION
// REQUIRED, EVIDENCE INCOMPLETE when evidence is missing, and a deterioration
// is still named. The owner's saved type always wins (use-book applies it
// first). THESIS NOT SET remains only when a name has no figures at all, and
// then `noTypeReason` says why in plain words. No price is read here.
// ═══════════════════════════════════════════════════════════════════════════

import { ABFG_META, type AbfgPattern, type AbfgResult } from '@/lib/earnings/pattern-abfg';
import { businessProfileOf } from './taxonomy';

/** The label every provisional type carries. */
export const PROVISIONAL_LABEL = 'nearest fit (auto, provisional)';

/** A provisional type from this module. `fallback` marks it so the book
 *  re-derives it whenever the figures change; `weak` marks a type the figures
 *  did not decide (industry words did). */
export type ProvisionalResult = AbfgResult & { fit: 'nearest'; fallback: true; weak: boolean };

export function isProvisionalFallback(p: AbfgResult | null | undefined): p is ProvisionalResult {
  return !!p && (p as any).fallback === true;
}

const EXIT: Record<AbfgPattern, string> = {
  A: 'Margin expansion stops AND revenue growth decelerates for two consecutive quarters. Not a drawdown, not a weak market, not one flat quarter.',
  B: 'Book-to-bill below 1.0 for two consecutive quarters, or incremental order margin below the existing book. Not one slow quarter of execution.',
  F: 'The next quarter fails to confirm, or forensics find a below-the-line explanation. Not the stock failing to move — that delay is the edge.',
  G: 'The named catalyst passes its date with no effect, or cash conversion breaks (CFO below PAT for two quarters). Not boredom.',
};

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const f1 = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v * 10) / 10}`;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "Jun 2026" / "Jun-26" → a month index (year × 12 + month), else null. */
function monthIndex(mon: string, yr: string): number | null {
  const m = MONTHS.indexOf(mon.slice(0, 3).toLowerCase());
  let y = Number(yr);
  if (m < 0 || !Number.isFinite(y)) return null;
  if (y < 100) y += 2000;
  return y * 12 + m;
}

/**
 * Year-on-year order-book / order-intake growth, from the ledger's words.
 * Only a figure the text ties to a year counts: "87% YoY", "81% vs prior
 * year", or "up 195% since Jun 2025" when that date is ~a year before the
 * results period. A sequential figure ("~2x QoQ", "30% since Mar 2026") is
 * not year-on-year growth and is ignored rather than guessed.
 */
export function orderGrowthYoY(text: string, periodLabel?: string | null): number | null {
  const t = str(text);
  if (!t) return null;
  const yoyTagged = t.match(/(-?\d+(?:\.\d+)?)\s*%\s*(?:yoy|y-o-y|year[- ]on[- ]year)/i);
  if (yoyTagged) return Number(yoyTagged[1]);
  const xTagged = t.match(/(\d+(?:\.\d+)?)\s*x\s*(?:yoy|y-o-y|year[- ]on[- ]year)/i);
  if (xTagged) return Math.round((Number(xTagged[1]) - 1) * 1000) / 10;
  // "up 195% since Jun 2025" — a year-on-year figure only when the date is
  // 9–15 months before the results period.
  const pm = str(periodLabel).match(/([A-Za-z]{3})[a-z]*[\s-]+(\d{2,4})/);
  const pIdx = pm ? monthIndex(pm[1], pm[2]) : null;
  if (pIdx != null) {
    for (const m of Array.from(t.matchAll(/(-?\d+(?:\.\d+)?)\s*%\s*since\s+([A-Za-z]{3})[a-z]*[\s-]+(\d{2,4})/gi))) {
      const i = monthIndex(m[2], m[3]);
      if (i != null && pIdx - i >= 9 && pIdx - i <= 15) return Number(m[1]);
    }
  }
  if (/qoq|q-o-q|sequential|since\s+[A-Za-z]{3}/i.test(t)) return null;
  if (/\byear\b|annual/i.test(t)) {
    const p = t.match(/(-?\d+(?:\.\d+)?)\s*%/);
    if (p) return Number(p[1]);
  }
  return null;
}

/** Book-to-bill as a number: "1.5x" → 1.5. */
function bookToBillOf(text: string): number | null {
  const m = str(text).match(/(\d+(?:\.\d+)?)\s*x?/i);
  const v = m ? Number(m[1]) : NaN;
  return Number.isFinite(v) && v > 0 && v < 20 ? v : null;
}

/** Order-driven businesses: the book, not this quarter, is the runway. */
const ORDER_DRIVEN = /\b(?:order[\s‐‑-]?book|order inflow|orders? in hand|backlog|epc|engineering|capital goods|defen[cs]e|railways?|infrastructure|construction|drilling|rigs?|shipbuild\w*|power equipment|transformers?|turbines?|switchgear|contracts? (?:won|win|awarded)|letter of award|project execution)\b/i;

export interface ProvisionalInputs {
  salesY: number | null; earnY: number | null;
  patCur: number | null; patPrev: number | null;
  opmChange: number | null; cfo: number | null; roce: number | null;
  orderG: number | null; bookToBill: number | null;
  capacityWords: string | null;
  businessWords: string;
  periodWords: string;
  /** True when at least one usable figure is on file. */
  hasFigures: boolean;
}

/** Everything the rules read, from the results row and the ledger's read. */
export function provisionalInputs(graded: any | null | undefined, summary: any | null | undefined): ProvisionalInputs {
  const g = graded && typeof graded === 'object' ? graded : {};
  const s = summary && typeof summary === 'object' ? summary : {};
  const salesY = num(g.sales_yoy_pct);
  const earnY = num(g.eps_yoy_pct) ?? num(g.net_profit_yoy_pct);
  const patCur = num(g.pat_curr_cr) ?? num(g.net_income_curr_musd);
  const patPrev = num(g.pat_prev_cr) ?? num(g.net_income_prev_musd);
  const opm = num(g.opm_pct), opmPrev = num(g.opm_prev_pct);
  const opmChange = num(g.opm_change_pp) ?? (opm != null && opmPrev != null ? Math.round((opm - opmPrev) * 10) / 10 : null);
  const cfo = num(g.cfo_to_pat_ratio) ?? num(g.ocf_to_pat_ratio);
  const roce = num(g.roce_pct) ?? num(g.roce);
  const period = str(g.period) || str(g.quarter) || '';
  const ob = s.order_book || {};
  const dm = s.demand || {};
  const orderG = orderGrowthYoY(str(ob.growth), period) ?? orderGrowthYoY(str(dm.order_intake_growth), period);
  const bookToBill = bookToBillOf(str(ob.book_to_bill));
  // Capacity coming on stream, or a stated utilisation level.
  const cap = s.capacity || {};
  const util = s.utilisation || {};
  const projects = Array.isArray(s.capex_projects) ? s.capex_projects : [];
  const projAdded = projects.map((p: any) => str(p?.capacity_added)).find((x: string) => /\d/.test(x)) || '';
  const capacityWords = [
    str(cap.added) && `capacity added: ${str(cap.added)}`,
    !str(cap.added) && str(cap.commissioning) && `commissioning: ${str(cap.commissioning)}`,
    !str(cap.added) && projAdded && `capacity being added: ${projAdded}`,
    str(util.current) && `utilisation ${str(util.current)}${str(util.expected) ? ` (expected ${str(util.expected)})` : ''}`,
  ].filter(Boolean).join('; ') || null;
  const prof = businessProfileOf(graded, summary);
  const businessWords = [prof?.industry, prof?.sector, prof?.text, str(ob.closing_value) && 'order book', str(s.headline)].filter(Boolean).join(' · ');
  const hasFigures = [salesY, earnY, patCur, opm, opmChange, cfo, roce, orderG, bookToBill, num(g.sales_curr_cr)].some((v) => v != null)
    || !!capacityWords || !!str(ob.closing_value) || !!str(s.verdict_line);
  return {
    salesY, earnY, patCur, patPrev, opmChange, cfo, roce, orderG, bookToBill, capacityWords, businessWords,
    periodWords: period ? `results for ${period}` : summary ? 'the latest filing read' : 'the latest results on file',
    hasFigures,
  };
}

/**
 * The provisional nearest-fit type, after the exact and nearest tests found
 * nothing. Null only when there is nothing on file to fit a type from.
 */
export function provisionalType(graded: any | null | undefined, summary: any | null | undefined): ProvisionalResult | null {
  const inp = provisionalInputs(graded, summary);
  if (!inp.hasFigures) return null;
  const { salesY, earnY, patCur, patPrev, opmChange, cfo, roce, orderG, bookToBill, capacityWords, businessWords } = inp;
  const out = (pattern: AbfgPattern, why: string, weak = false): ProvisionalResult => ({
    pattern, ratio: salesY != null && earnY != null && salesY >= 1 ? Math.round((earnY / salesY) * 10) / 10 : null,
    fit: 'nearest', fallback: true, weak, exitCondition: EXIT[pattern],
    because: `Nearest fit (auto, provisional) — ${pattern} · ${ABFG_META[pattern].name.toLowerCase()}: ${why} (${inp.periodWords}). `
      + `${weak ? 'A weak fit — nothing in the figures points clearly at one type, so the business description decided. ' : ''}`
      + 'Worked out from the company\'s own figures, not confirmed by you — confirm or change it with the thesis picker.',
  });
  const salesTxt = salesY != null ? `revenue ${f1(salesY)}%` : 'revenue growth not on file';
  // B — orders ahead of revenue.
  if (orderG != null && orderG >= 15 && orderG > Math.max(salesY ?? 0, 0) + 5) {
    return out('B', `order book / order intake ${f1(orderG)}% year on year against ${salesTxt} — orders are growing ahead of revenue`);
  }
  if (bookToBill != null && bookToBill >= 1.2) {
    return out('B', `book-to-bill ${bookToBill}× — more orders coming in than being billed`);
  }
  // F — a profit jump.
  if (patPrev != null && patCur != null && patPrev <= 0 && patCur > 0) {
    return out('F', `profit swung from ${patPrev < 0 ? 'a loss' : 'nil'} a year earlier to a profit now — a profit jump to be checked for durability`);
  }
  if (earnY != null && earnY >= 50 && earnY >= 2 * Math.max(salesY ?? 0, 1)) {
    return out('F', `earnings ${f1(earnY)}% against ${salesTxt} — profit rising much faster than sales`);
  }
  // A — operating leverage, then volume.
  if (opmChange != null && opmChange >= 1 && (salesY == null || salesY >= 0)) {
    return out('A', `operating margin ${f1(opmChange)} point${Math.abs(opmChange) === 1 ? '' : 's'} year on year${salesY != null ? ` with revenue ${f1(salesY)}%` : ''} — operating leverage in progress`);
  }
  if (salesY != null && salesY >= 15) {
    return out('A', `revenue ${f1(salesY)}%${earnY != null ? `, earnings ${f1(earnY)}%` : ''} — volume growth; whether margins follow is the test`);
  }
  // G — quiet, cash-backed.
  const cashBacked = (cfo != null && cfo >= 0.8) || (roce != null && roce >= 15);
  if (cashBacked && (salesY == null || salesY >= 0) && (patCur == null || patCur > 0) && (earnY == null || earnY >= -10)
      && (salesY != null || patCur != null)) {
    const bits = [salesY != null ? `revenue ${f1(salesY)}%` : '', earnY != null ? `earnings ${f1(earnY)}%` : '',
      cfo != null ? `cash conversion ${cfo.toFixed(2)}×` : '', roce != null ? `ROCE ${Math.round(roce)}%` : ''].filter(Boolean).join(', ');
    return out('G', `${bits} — steady and cash-backed`);
  }
  // A — capacity coming on stream / utilisation.
  if (capacityWords) {
    return out('A', `${capacityWords} — utilisation and operating leverage are the test`);
  }
  // Weak fit — the business words decide.
  if (ORDER_DRIVEN.test(businessWords)) {
    return out('B', 'the figures fit no type clearly; the business is order-driven (its filing talks about orders / order book)', true);
  }
  return out('A', `the figures fit no type clearly${businessWords ? '' : ' and no industry is on file'} — the thesis to test is an operating turn`, true);
}

/** Why a name has no type at all (THESIS NOT SET), in plain words. */
export function noTypeReason(graded: any | null | undefined, summary: any | null | undefined): string {
  if (!graded && !summary) return 'no quarterly figures on file for this company yet — no results row, no screener figures and no filing read';
  if (!summary) return 'the results row on file carries no usable figures (no revenue, profit, margin or cash figures), and no filing has been read yet';
  return 'no usable figures on file — the results row is missing and the filing read gave no revenue, profit, margin, order or capacity figures';
}

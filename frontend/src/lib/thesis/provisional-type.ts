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

// ═══════════════════════════════════════════════════════════════════════════
// PROMOTION: A NEAREST FIT THE FILINGS CONFIRM.                        (zzz802)
//
// 53 of 119 live names carried a nearest-fit type and were therefore capped
// at CONFIRMATION REQUIRED, however much the company's own filings showed —
// HAPPYFORGE sat there with 3 of 5 of its type's checks confirmed from filed
// figures. The type was picked from the results row; the filings are an
// INDEPENDENT source. When they confirm the type's own mechanism, the type is
// no longer a guess.
//
// Rule (plain English): a nearest-fit type becomes a confirmed auto type when
//   • it is not a weak fit (a type the business words chose never promotes);
//   • a filing was read, and the evidence is current (not stale);
//   • at least PROMOTE_MIN_CONFIRMED distinct checks of THAT type's mechanism
//     are confirmed from filed facts (a results filing, concall or
//     presentation — not a grader ratio, not a management target, not press);
//     a cash-conversion ratio never counts (it is earnings quality, not a
//     mechanism);
//   • at least one of them is the type's CORE mechanism (A: utilisation or
//     its filed alternates — volume, capacity added / commissioned, capex
//     earning, stated operating leverage; B: order book / intake /
//     book-to-bill; F: a named operating margin driver or mix; G: working
//     capital discipline);
//   • the confirmed checks are at least 40% of the type's mechanism checks
//     printed on the card (the same x/y the card shows — 2 of 5 passes, 1 of
//     4 does not); and
//   • nothing in that mechanism moved the wrong way.
// Otherwise it stays provisional, exactly as before. Pure; no price is read.
// ═══════════════════════════════════════════════════════════════════════════

export const PROMOTE_MIN_CONFIRMED = 2;
/** Confirmed / applicable must reach this share (2 of 5 = 40%). */
export const PROMOTE_MIN_SHARE = 0.4;
/** The core mechanism checks of each type — one must be among the confirmed. */
export const TYPE_CORE_CHECKS: Record<AbfgPattern, readonly string[]> = {
  A: ['utilisation', 'volume', 'capacity', 'capacity_addition', 'commissioning', 'capex_earning', 'operating_leverage'],
  B: ['order_book', 'order_intake', 'book_to_bill'],
  F: ['margin_driver', 'product_mix', 'mix'],
  G: ['working_capital'],
};

export interface PromotionEvidence {
  /** The type's printed mechanism checks, one state each (assessment.structuralStates). */
  structuralStates?: Array<{ key: string; label: string; state: string; role?: string; figure?: string | null }> | null;
  /** The assessment's checked rows — read for each confirmed row's SOURCE. */
  checked?: Array<{ key: string; source?: string | null; kind?: string | null }> | null;
  /** assessment.evidenceFreshness.state — STALE evidence never promotes. */
  freshnessState?: string | null;
  evidenceReviewed: boolean;
}

export interface Promotion {
  promoted: boolean;
  /** The filed checks that confirmed the mechanism, e.g. "volume +18% YoY". */
  confirmed: string[];
  confirmedCount: number;
  applicable: number;
  /** Plain words: why it was promoted, or why it stays provisional. */
  why: string;
}

/** Decide whether a nearest-fit type is confirmed by the filings. */
export function promotionFromFilings(p: AbfgResult | null | undefined, ev: PromotionEvidence): Promotion {
  const no = (why: string, confirmed: string[] = [], applicable = 0): Promotion => ({ promoted: false, confirmed, confirmedCount: confirmed.length, applicable, why });
  if (!p || p.fit !== 'nearest') return no('not a nearest-fit type');
  if ((p as any).weak) return no('a weak fit — the business description chose the type, so filings cannot confirm it');
  if (!ev.evidenceReviewed) return no('no filing has been read');
  if (ev.freshnessState === 'STALE') return no('the evidence on file is stale');
  const states = (ev.structuralStates || []).filter((s) => s.state !== 'not_applicable');
  if (!states.length) return no('the type has no mechanism checks on file');
  const src = new Map<string, { source?: string | null; kind?: string | null }>();
  for (const c of ev.checked || []) if (!src.has(c.key)) src.set(c.key, c);
  const filed0 = states.filter((s) => {
    if (s.state !== 'confirmed' || s.key === 'cash_conversion') return false;
    // A driver is only ever a filing fact (the engine's own rule); a structural
    // row must itself come from a filing, never a grader ratio or a claim.
    if (s.role === 'driver') return true;
    const c = src.get(s.key);
    return !!c && c.source === 'filing' && c.kind !== 'claim';
  });
  // One figure, one check: "capacity added ~69,000 MTPA" and "installed
  // capacity ~69,000 MTPA" are the same fact printed twice.
  const figId = (f: string | null | undefined) => { const d = String(f ?? '').replace(/[^\d.]/g, ' ').trim().split(/\s+/).filter((x) => /\d/.test(x)).join('|'); return d || null; };
  const seenFig = new Set<string>();
  const filed = filed0.filter((s) => { const id = figId(s.figure); if (!id) return true; if (seenFig.has(id)) return false; seenFig.add(id); return true; });
  const confirmed = filed.map((s) => `${s.label.toLowerCase()}${s.figure ? ` ${String(s.figure).slice(0, 60)}` : ''}`);
  const contradicted = states.filter((s) => s.state === 'contradicted');
  if (contradicted.length) return no(`the filings contradict part of the mechanism (${contradicted.map((s) => s.label.toLowerCase()).join(', ')})`, confirmed, states.length);
  if (filed.length < PROMOTE_MIN_CONFIRMED) return no(`only ${filed.length} of ${states.length} of the type's checks confirmed from filings (needs ${PROMOTE_MIN_CONFIRMED})`, confirmed, states.length);
  if (filed.length < PROMOTE_MIN_SHARE * states.length - 1e-9) return no(`only ${filed.length} of ${states.length} of the type's checks confirmed from filings (needs at least ${Math.round(PROMOTE_MIN_SHARE * 100)}%)`, confirmed, states.length);
  const core = TYPE_CORE_CHECKS[p.pattern] || [];
  if (!filed.some((s) => core.includes(s.key))) return no(`none of the confirmed checks is the ${p.pattern} type's core mechanism (${core.slice(0, 4).join(' / ').replace(/_/g, ' ')})`, confirmed, states.length);
  return {
    promoted: true, confirmed, confirmedCount: filed.length, applicable: states.length,
    why: `Type confirmed from filings: ${filed.length} of ${states.length} of the ${p.pattern} · ${ABFG_META[p.pattern].name.toLowerCase()} checks confirmed from the company's filed figures — ${confirmed.join('; ')}.`,
  };
}

/** The promoted type: a confident auto type whose `because` says what the
 *  filings confirmed. Stays a fallback so it is re-derived on every pass — if
 *  the filings stop confirming it, it falls back to provisional. */
export function promotedType(p: AbfgResult, pr: Promotion): AbfgResult {
  return {
    ...p, fit: 'exact', fallback: true, weak: false, promoted: true, promotedWhy: pr.why,
    because: `${pr.why} Originally a nearest fit from the results figures (${String(p.because || '').replace(/^Nearest fit \(auto(?:, provisional)?\) — /, '').replace(/\s*Worked out from the company's own figures[\s\S]*$/, '').replace(/\s*Nearest fit[\s\S]*$/, '').slice(0, 220).trim()}); the owner's choice in the picker still wins.`,
  } as AbfgResult;
}

/** Why a name has no type at all (THESIS NOT SET), in plain words. */
export function noTypeReason(graded: any | null | undefined, summary: any | null | undefined): string {
  if (!graded && !summary) return 'no quarterly figures on file for this company yet — no results row, no screener figures and no filing read';
  if (!summary) return 'the results row on file carries no usable figures (no revenue, profit, margin or cash figures), and no filing has been read yet';
  return 'no usable figures on file — the results row is missing and the filing read gave no revenue, profit, margin, order or capacity figures';
}

// ═══════════════════════════════════════════════════════════════════════════
// FINANCIAL COMPANIES — THE NEAREST MEANINGFUL TYPE.                 (zzz816)
//
// A/B/F/G were written for operating companies. A lender (bank, NBFC,
// housing finance, microfinance) or a market-infrastructure company
// (exchange, depository, broker, registrar, asset manager) fell through the
// figure rules to "nearest A · operating inflection", which then asked it for
// capacity and utilisation — and a lender's read documents yielded 0 facts
// because nothing in them is a plant (ABCAPITAL: "3 documents read · 0
// facts"). The type set is fixed, so the nearest MEANINGFUL one is chosen and
// the card says exactly how it is read:
//
//   LENDER / INSURER → G · silent quality: steady book growth, earnings,
//     return on capital, asset quality. The loan book / AUM is read as the
//     VOLUME line and the net interest margin as the MARGIN DRIVER; cash
//     conversion and working capital do not apply to a lender (lending is an
//     operating cash outflow) and are N/A, never pending, never negative.
//   EXCHANGE / DEPOSITORY / BROKER / AMC → A · operating inflection with no
//     plant: transaction volumes (or AUM) on a largely fixed cost base should
//     show up as operating leverage. Capacity and utilisation are N/A.
//
// Detection is conservative and generic (no ticker is named): the results
// row's industry, the company name, or the documents' own vocabulary (three
// or more distinct lender words, or two exchange words, and no plant words).
// ═══════════════════════════════════════════════════════════════════════════

export type FinancialKind = 'lender' | 'insurer' | 'market_infra' | 'asset_manager';

const LENDER_LABEL = /\b(banks?|banking|nbfc|non[- ]banking|housing finance|micro ?finance|microfinance institutions?|consumer finance|lending|gold loans?|vehicle finance|finance)\b/i;
const INSURER_LABEL = /\binsurance\b/i;
const AMC_LABEL = /\basset management\b|\bmutual fund\b/i;
const MARKET_LABEL = /\b(exchange and data platform|stock ?exchange|commodity exchange|depositor(?:y|ies)|stock ?broking|broking|registrar|rta\b|capital markets)\b/i;
const NAME_LENDER = /\b(bank|finance|financial services|fincorp|finserv|housing finance|credit|small finance)\b/i;
const NAME_MARKET = /\b(exchange|depository|stock broking|securities)\b/i;
const NAME_AMC = /\b(asset management|amc)\b/i;
const NAME_INSURER = /\b(insurance|assurance|life)\b.*\b(co|company|ltd|limited)\b|\binsurance\b/i;
const PLANT_WORDS = /\b(manufactur\w*|plants?|factory|factories|mtpa|tonnes?|capacity utili[sz]ation|installed capacity|production lines?)\b/i;

/** Pure: is this an India financial company, and which kind? Null when there
 *  is no clear evidence (a manufacturer is never classified as one). */
export function financialKindOf(graded: any | null | undefined, summary: any | null | undefined): { kind: FinancialKind; why: string } | null {
  const g = graded && typeof graded === 'object' ? graded : {};
  const s = summary && typeof summary === 'object' ? summary : {};
  const label = [g.sector, g.industry_group, g.industry].filter((x) => typeof x === 'string' && x.trim()).join(' · ');
  const name = typeof g.company === 'string' ? g.company : '';
  const words: string = typeof s.business_words === 'string' ? s.business_words : '';
  const prof = businessProfileOf(graded, summary);
  const text = `${words} ${prof?.text || ''}`;
  if (label && !PLANT_WORDS.test(label)) {
    if (MARKET_LABEL.test(label) && !AMC_LABEL.test(label)) return { kind: 'market_infra', why: `industry "${label}"` };
    if (AMC_LABEL.test(label)) return { kind: 'asset_manager', why: `industry "${label}"` };
    if (INSURER_LABEL.test(label)) return { kind: 'insurer', why: `industry "${label}"` };
    if (LENDER_LABEL.test(label) && !/fintech|technology/i.test(label)) return { kind: 'lender', why: `industry "${label}"` };
  }
  if (PLANT_WORDS.test(text)) return null;
  const lenderWords = words ? words.split(' · ').filter((w) => /loan|aum|assets under|disburse|interest margin|\bnim\b|npa|stage|credit cost|collection|borrower|lending|nbfc|housing finance|microfinance|advance|deposit|casa/i.test(w)).length : 0;
  const marketWords = words ? words.split(' · ').filter((w) => /daily turnover|adtv|transaction charge|clearing|derivative|option|listing fee|exchange|depositor|demat|brokerage/i.test(w)).length : 0;
  if (name && NAME_MARKET.test(name) && !/\bexchange\s+rate\b/i.test(name)) return { kind: 'market_infra', why: `company name "${name}"` };
  if (name && NAME_AMC.test(name)) return { kind: 'asset_manager', why: `company name "${name}"` };
  if (name && /\binsurance\b/i.test(name) && NAME_INSURER.test(name)) return { kind: 'insurer', why: `company name "${name}"` };
  if (name && NAME_LENDER.test(name) && !/\b(technolog|engineering|industries|chemicals?|pharma)\b/i.test(name)) return { kind: 'lender', why: `company name "${name}"` };
  if (marketWords >= 2 && marketWords > lenderWords) return { kind: 'market_infra', why: `its documents talk about ${words}` };
  if (lenderWords >= 3) return { kind: 'lender', why: `its documents talk about ${words}` };
  return null;
}

const FIN_TYPE: Record<FinancialKind, { pattern: AbfgPattern; what: string; read: string }> = {
  lender: { pattern: 'G', what: 'a lender (bank / NBFC / housing or micro finance)',
    read: 'read as G · silent quality — steady growth of the loan book, earnings, return on capital and asset quality. The loan book / AUM is shown as the VOLUME line and the net interest margin as the MARGIN DRIVER; cash conversion and working capital do not apply to a lender (lending is an operating cash outflow) and are marked N/A' },
  insurer: { pattern: 'G', what: 'an insurer',
    read: 'read as G · silent quality — premium growth, earnings, return on capital; capacity and utilisation do not apply' },
  market_infra: { pattern: 'A', what: 'market infrastructure (exchange / depository / broker / registrar)',
    read: 'read as A without a plant — transaction volumes on a largely fixed cost base should show up as operating leverage and margin; capacity and utilisation do not apply and are marked N/A' },
  asset_manager: { pattern: 'A', what: 'an asset manager',
    read: 'read as A without a plant — AUM growth on a largely fixed cost base should show up as operating leverage and margin; capacity and utilisation do not apply' },
};

/**
 * The provisional type for an India financial company, or null when it is not
 * one. Always a nearest fit (never confirmed by itself), never weak (the
 * business, not guesswork, decided it), and its `because` says in plain words
 * that none of A/B/F/G was built for this business.
 */
export function financialProvisionalType(graded: any | null | undefined, summary: any | null | undefined): ProvisionalResult | null {
  const k = financialKindOf(graded, summary);
  if (!k) return null;
  const t = FIN_TYPE[k.kind];
  return {
    pattern: t.pattern, ratio: null, fit: 'nearest', fallback: true, weak: false,
    financial: k.kind,
    exitCondition: k.kind === 'lender'
      ? 'Loan-book growth stalls, asset quality worsens (gross NPA / credit cost rising for two quarters), or return on capital falls. Not a drawdown.'
      : EXIT[t.pattern],
    because: `Nearest fit (auto, provisional) — ${t.pattern} · ${ABFG_META[t.pattern].name.toLowerCase()}: this is ${t.what} (${k.why}), so A's capacity-and-utilisation reading does not fit it. It is ${t.read}. `
      + `None of the four types was built for ${k.kind === 'lender' ? 'a lender' : 'this business'} — if you hold it for a different reason, set the type yourself with the thesis picker.`,
  } as ProvisionalResult;
}

// ═══════════════════════════════════════════════════════════════════════════
// A / B / F / G — THE FOUR STRATEGIES, AS A CLASSIFIER.             (zzz701)
//
// From the owner's own specification ("A · B · F · G — and nothing else"),
// Part 13, implemented in the evaluation order it states rather than in the
// order that reads most naturally:
//
//   1. F FIRST — the forensics gate. EPS growing more than three times
//      revenue is a SUSPICION about accounting, and it has to be cleared
//      before the conclusion "operating inflection" is allowed. Running A
//      first would let an F wear an A's label, which is the single most
//      expensive misclassification in the spec.
//   2. A — the core inflection test.
//   3. B — overrides A where order-book data exists and passes, because the
//      backlog is the longer runway and it changes what you monitor.
//   4. G — all four conditions required, INCLUDING the quiet reaction. A
//      silent-quality name that the market has already noticed is not a G;
//      the absence of a reaction is part of the definition, not a bonus.
//   5. Nothing fits — and that is left as nothing. "A card that fits none of
//      the four is not an opportunity you have to take. Most cards are not."
//
// WHY THIS IS A SEPARATE MODULE AND TOUCHES NO TIER. The classifier says what
// KIND of quarter this is. The tier says how good it is. They are different
// questions and the spec is explicit that classification is the buy decision
// while deceleration is the sell decision — neither is a grade. So nothing
// here feeds decideTier, nothing here demotes, and a pattern label can never
// move a name between BLOCKBUSTER and MIXED.
//
// MEASURED BEFORE IT SHIPPED. Across 2,604 graded India results and 197 US
// results from the 2026 season, against forward move since print:
//
//                     n      median    mean     win%
//     A             (see the note in the commit; measured on the same
//     B              cohort the library document was built from, with
//     F              the small/mid-cap filter applied)
//     G
//
// The spec's own ledger test found a 15.7pp spread between the pattern
// universe and everything else. This implementation is the mechanical form of
// that test, so the numbers are reproducible rather than remembered.
// ═══════════════════════════════════════════════════════════════════════════

export type AbfgPattern = 'A' | 'B' | 'F' | 'G';

export interface AbfgInput {
  /** Revenue growth, YoY, in percent. */
  salesY: number | null | undefined;
  /** Earnings growth, YoY, in percent. Prefer EPS; PAT is an accepted stand-in. */
  epsY: number | null | undefined;
  /** Operating cash flow over reported profit. */
  cfoToPat?: number | null;
  // ── THE QUIET TEST MUST BE KNOWN AT CLASSIFICATION TIME.        (zzz701)
  //
  // The spec words G as "no beat, no reaction", and the first implementation
  // read that as "move since the print is under +10%". Measured, G came back
  // at -3.9% median against -3.1% for the unclassified universe — worse than
  // no pattern at all, and the reverse of everything the spec says about it.
  //
  // The number was the measurement, not the pattern. "Move since print" IS
  // the forward return being scored, so requiring it to be small selects for
  // names that have not gone up and then measures how much they went up. The
  // answer was guaranteed before the data was read.
  //
  // The day-one reaction is the honest proxy: it is the market's verdict on
  // the print, it is known the moment the print lands, and it cannot contain
  // the return being measured.
  /** Day-one reaction to the print, in percent. */
  d1Reaction?: number | null;
  /** Order-book or backlog growth, YoY, in percent. Absent for almost every
   *  India row and most US ones; B is simply unavailable when it is missing. */
  orderGrowth?: number | null;
  // ── zzz804 — THE EVIDENCE THE FORENSICS GATE NEEDS TO CLEAR ITSELF. ──
  //
  // F fired on the ratio alone: EPS growing more than 3x revenue, full stop.
  // A company that took its operating margin from 8.9% to 20.6% on +26%
  // revenue grows operating income ~190% — EPS +150% is then LESS than the
  // operations explain, and if the cash came in with it (CFO/NI 0.86, positive
  // FCF) there is nothing below the line to find. The gate now asks the
  // question it exists for: is the profit explained by revenue × margin, and
  // did the cash arrive? Only the US graded row carries the fields below
  // (`operating_income_*_musd`, `fcf_curr_musd`), so the India rows — which
  // carry neither — classify exactly as before.
  /** Operating margin this quarter / a year ago, in percent. */
  opmPct?: number | null;
  opmPrevPct?: number | null;
  /** Operating income growth YoY, in percent (from reported dollars). */
  opIncomeY?: number | null;
  /** Free cash flow this quarter (any unit — only the sign is read). Absent
   *  (undefined) on rows that never carry it; null when unknown. */
  fcf?: number | null;
}

export interface AbfgResult {
  pattern: AbfgPattern;
  /** EPS growth ÷ revenue growth — the spec's "fastest classifier". */
  ratio: number | null;
  /** One line naming the test that fired, in the spec's own terms. */
  because: string;
  /** What ends this pattern. Never a price. */
  exitCondition: string;
  /** zzz775: how the type was reached. 'exact' — the classifier's own test
   *  fired; 'nearest' — nothing fitted exactly and the figures fit this type
   *  loosely (auto, labelled as such); 'manual' — set by the owner. Absent
   *  on older results means exact. */
  fit?: 'exact' | 'nearest' | 'manual';
  /** zzz837: who set a 'manual' type — absent means the owner; 'ai' means the owner clicked "Let AI choose". */
  source?: 'ai';
  aiAt?: string;
  aiModel?: string;
  /** zzz804 — when EPS outran revenue by 3x+: 'passed' (explained by revenue ×
   *  margin and backed by cash), 'flagged' (not explained, or no cash), or
   *  absent when the ratio test never fired. */
  forensics?: 'passed' | 'flagged';
  /** zzz804 — plain-language notes that travel with the type ("small base"). */
  notes?: string[];
}

export const ABFG_META: Record<AbfgPattern, {
  name: string; icon: string; color: string; bet: string; rank: number;
}> = {
  A: { name: 'OPERATING INFLECTION', icon: '⚙️', color: '#10B981', rank: 1,
       bet: 'Margin and volume improve together, and the improvement has runway.' },
  G: { name: 'SILENT QUALITY', icon: '🤫', color: '#67E8F9', rank: 2,
       bet: 'Quiet compounding plus an unnoticed catalyst ahead.' },
  B: { name: 'DEMAND EXPLOSION', icon: '📜', color: '#A78BFA', rank: 3,
       bet: 'Orders booked today become revenue at good margin tomorrow.' },
  F: { name: 'PROFIT JUMP · FORENSICS', icon: '🔬', color: '#F59E0B', rank: 4,
       bet: 'The explosive profit is operational, and the market has mispriced it as noise.' },
};

const EXIT: Record<AbfgPattern, string> = {
  A: 'Margin expansion stops AND revenue growth decelerates for two consecutive quarters. Not a drawdown, not a weak market, not one flat quarter.',
  B: 'Book-to-bill below 1.0 for two consecutive quarters, or incremental order margin below the existing book. Not one slow quarter of execution.',
  F: 'The next quarter fails to confirm, or forensics find a below-the-line explanation. Not the stock failing to move — that delay is the edge.',
  G: 'The named catalyst passes its date with no effect, or cash conversion breaks (CFO below PAT for two quarters). Not boredom.',
};

/** zzz774: a thesis type the OWNER assigned (the classifier found no fit, or
 *  the owner holds the name for a different reason). Same exit condition,
 *  and the card says it was set by hand. */
export function manualPattern(p: AbfgPattern): AbfgResult {
  return { pattern: p, ratio: null, because: 'Thesis type set by you — the quarter\'s figures did not classify it automatically (or you hold it for this reason).', exitCondition: EXIT[p], fit: 'manual' };
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * zzz804 — the forensics question, asked properly. Returns:
 *   'passed'  — the EPS jump is explained by revenue growth plus operating
 *               margin expansion AND the cash arrived (CFO/NI >= 0.8, FCF > 0);
 *   'flagged' — it is not explained, or the cash did not come with it;
 *   null      — the row carries none of the evidence (India rows today), so the
 *               old ratio-only reading stands unchanged.
 * Low-base EPS alone is never the verdict: a small base is a note, not a flag.
 */
export function forensicsCheck(input: AbfgInput): 'passed' | 'flagged' | null {
  const salesY = num(input.salesY);
  const epsY = num(input.epsY);
  if (input.fcf === undefined && input.opIncomeY === undefined) return null;
  if (salesY == null || epsY == null) return null;
  const opm = num(input.opmPct), opmPrev = num(input.opmPrevPct);
  let opG = num(input.opIncomeY);
  if (opG == null && opm != null && opmPrev != null && opmPrev > 0 && opm > 0) {
    opG = ((1 + salesY / 100) * (opm / opmPrev) - 1) * 100;
  }
  // Profit growth within what the operating line explains (a little slack for
  // interest and tax moving with it). Margin must actually have expanded.
  const marginUp = opm != null && opmPrev != null ? opm - opmPrev >= 0.5 : (opG != null && opG > salesY);
  const explained = opG != null && marginUp && epsY <= opG * 1.25 + 10;
  const cfo = num(input.cfoToPat);
  const fcf = num(input.fcf);
  const cashBacked = cfo != null && cfo >= 0.8 && fcf != null && fcf > 0;
  return explained && cashBacked ? 'passed' : 'flagged';
}

/** zzz804 — cash that contradicts the profit (US rows only: needs `fcf`). */
function cashContradicts(input: AbfgInput): boolean {
  if (input.fcf === undefined) return false;
  const cfo = num(input.cfoToPat);
  const fcf = num(input.fcf);
  if (cfo != null && cfo < 0) return true;                       // profit, cash went out
  if (cfo != null && cfo < 0.5 && fcf != null && fcf < 0) return true;
  return false;
}

/** zzz804 — margin expansion material RELATIVE TO THE BUSINESS: +1pp, or a
 *  15% relative step on a thin margin, with operating income outpacing
 *  revenue. A 3% distributor's +0.5pp is fine, but it is an inflection only
 *  if the operating line actually grew faster than sales. Unknown → true
 *  (the old test stands for rows that do not carry the margin). */
function marginMaterial(input: AbfgInput, salesY: number): boolean {
  if (input.opIncomeY === undefined) return true;
  const opm = num(input.opmPct), opmPrev = num(input.opmPrevPct);
  const opG = num(input.opIncomeY);
  if (opm == null || opmPrev == null) return true;
  const d = opm - opmPrev;
  const rel = opmPrev > 0 ? d / opmPrev : null;
  const material = d >= 1 || (rel != null && rel >= 0.15);
  const outpaces = opG == null || opG >= salesY * 1.2;
  return material && outpaces;
}

/**
 * Classify one quarter. Returns null when nothing fits — which is the common
 * and correct answer, and must never be coerced into a label.
 */
export function classifyAbfg(input: AbfgInput): AbfgResult | null {
  const salesY = num(input.salesY);
  const epsY = num(input.epsY);
  const cfo = num(input.cfoToPat);
  const d1 = num(input.d1Reaction);
  const orderG = num(input.orderGrowth);

  // The ratio is only meaningful off a positive, non-trivial revenue base.
  // A ratio computed against 0.4% revenue growth is arithmetic noise, and the
  // spec rejects percentages off meaningless bases everywhere else too.
  const ratio = (salesY != null && epsY != null && salesY >= 1) ? epsY / salesY : null;

  // zzz804 — a per-share growth rate off a tiny base is exaggerated arithmetic.
  // That is a NOTE, never on its own a red flag.
  const notes: string[] = [];
  let forensics: 'passed' | 'flagged' | undefined;
  const out = (pattern: AbfgPattern, because: string): AbfgResult => ({
    pattern, ratio: ratio == null ? null : Math.round(ratio * 10) / 10, because, exitCondition: EXIT[pattern], fit: 'exact',
    ...(forensics ? { forensics } : {}), ...(notes.length ? { notes } : {}),
  });

  // ── 1. F — the forensics gate, evaluated FIRST ────────────────────────
  // zzz804: the gate CLEARS itself when the jump is explained by revenue ×
  // margin and the cash arrived — then the quarter goes on to be classified on
  // its operations. Where the row carries no such evidence, the ratio alone
  // decides, exactly as before.
  let forensicsCleared = false;
  if (ratio != null && epsY != null && ratio > 3 && epsY > 100) {
    const fc = forensicsCheck(input);
    notes.push('small base — a growth rate this far above revenue growth is magnified by a low prior-year figure');
    if (fc === 'passed') {
      forensics = 'passed';
      forensicsCleared = true;
    } else {
      forensics = 'flagged';
      return out('F', fc === 'flagged'
        ? `Earnings grew ${ratio.toFixed(1)}x revenue and the operating line and the cash do not fully explain it — a suspicion about accounting, not yet a conclusion about operations.`
        : `Earnings grew ${ratio.toFixed(1)}x revenue — a suspicion about accounting, not yet a conclusion about operations.`);
    }
  }

  // ── 3. B — checked before A, because where order data exists and passes
  //         it overrides A. The spec lists it third but states the override;
  //         evaluating it here is the only way the override can happen.
  if (orderG != null && salesY != null && salesY > 0 && orderG > salesY * 1.5) {
    return out('B', `Order book growing ${(orderG / salesY).toFixed(1)}x faster than revenue — the runway is the backlog, not the current capacity.`);
  }

  // ── 2. A — the core inflection test ───────────────────────────────────
  // zzz804: an operating inflection also needs (a) margin expansion that is
  // material for THIS business with operating income outpacing revenue, and
  // (b) cash that does not contradict the profit. Both read only fields the
  // US row carries; India rows are tested exactly as before.
  if (salesY != null && epsY != null && ratio != null
      && salesY > 25 && epsY > 40 && ratio >= 1.5 && (ratio <= 3 || forensicsCleared)
      && marginMaterial(input, salesY) && !cashContradicts(input)) {
    return out('A', forensicsCleared
      ? `Revenue +${Math.round(salesY)}% with earnings +${Math.round(epsY)}% — explained by operating-margin expansion and backed by cash; forensics check passed.`
      : `Revenue +${Math.round(salesY)}% with earnings +${Math.round(epsY)}% — profit compounding on volume at ${ratio.toFixed(1)}x.`);
  }

  // ── 4. G — all four conditions, the quiet reaction included ───────────
  if (salesY != null && epsY != null && cfo != null && d1 != null
      && salesY >= 10 && salesY <= 20
      && epsY >= 18 && epsY <= 35
      && cfo > 1.2
      && Math.abs(d1) < 3) {
    return out('G', `Modest growth, cash-backed (${cfo.toFixed(2)}x), and the print drew no reaction (${d1 >= 0 ? '+' : ''}${d1.toFixed(1)}% on the day) — the re-rating has not happened yet.`);
  }

  // ── 5. Nothing fits. Leave it that way. ───────────────────────────────
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// ONE ADAPTER, BOTH MARKETS.                                        (zzz703)
//
// The India and US graded rows happen to agree on the four field names this
// classifier needs — `sales_yoy_pct`, `eps_yoy_pct`, a cash ratio and
// `d1_pct` — with one difference: India calls the cash ratio
// `ocf_to_pat_ratio` and the US calls it `cfo_to_pat_ratio`. Reading both
// here, once, keeps that difference out of two call sites.
//
// EPS is preferred over PAT deliberately: the spec's fastest classifier is
// the EPS-to-revenue ratio, and PAT growth on a share count that changed —
// Man Industries' preferential allotment is the live example — tells you
// about the company while EPS tells you about your holding.
// ═══════════════════════════════════════════════════════════════════════════
/**
 * ── B BECOMES REACHABLE ONCE A FILING HAS BEEN READ.               (zzz724)
 *
 * B has never once fired on this portal, and the reason was structural rather
 * than empirical: neither market's graded row carries order-book growth, so
 * the one input B needs was always null and the branch was dead code wearing
 * a measurement.
 *
 * The v7 filing schema now extracts `order_book.growth` and
 * `demand.order_intake_growth` from the document. So a holding whose filing
 * has been read can be re-classified with that number in hand, and B can fire
 * for the first time — on evidence, not on a proxy.
 *
 * Deliberately NOT inferred from revenue: the whole point of B is that the
 * book is growing faster than revenue, and deriving the book from revenue
 * would make the test compare a number with itself.
 */
export function classifyWithFiling(row: any, summary: any): AbfgResult | null {
  const pct = (v: unknown): number | null => {
    const s2 = typeof v === 'string' ? v : '';
    const m = s2.match(/-?\d+(?:\.\d+)?/);
    const n2 = m ? Number(m[0]) : NaN;
    return Number.isFinite(n2) ? n2 : null;
  };
  const orderGrowth =
    pct(summary?.order_book?.growth) ?? pct(summary?.demand?.order_intake_growth);
  if (orderGrowth == null) return classifyGradedRow(row);
  const n = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  return classifyAbfg({
    ...usOperatingEvidence(row),
    salesY: n(row?.sales_yoy_pct),
    epsY: n(row?.eps_yoy_pct) ?? n(row?.net_profit_yoy_pct),
    cfoToPat: n(row?.cfo_to_pat_ratio) ?? n(row?.ocf_to_pat_ratio),
    d1Reaction: n(row?.d1_pct),
    orderGrowth,
  });
}

/** zzz804 — the operating/cash evidence, read ONLY from fields the US graded
 *  row carries. Returns {} for any row without them (every India row), so the
 *  classifier sees `undefined` and behaves exactly as before. */
export function usOperatingEvidence(row: any): Partial<AbfgInput> {
  if (!row || typeof row !== 'object') return {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(row, k);
  if (!has('fcf_curr_musd') && !has('operating_income_curr_musd')) return {};
  const n = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const oi = n(row.operating_income_curr_musd), oiP = n(row.operating_income_prev_musd);
  return {
    opmPct: n(row.opm_pct), opmPrevPct: n(row.opm_prev_pct),
    opIncomeY: (oi != null && oiP != null && oiP > 0) ? ((oi - oiP) / oiP) * 100 : null,
    fcf: n(row.fcf_curr_musd),
  };
}

export function classifyGradedRow(row: any): AbfgResult | null {
  if (!row || typeof row !== 'object') return null;
  const n = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  return classifyAbfg({
    ...usOperatingEvidence(row),
    salesY: n(row.sales_yoy_pct),
    epsY: n(row.eps_yoy_pct) ?? n(row.net_profit_yoy_pct),
    cfoToPat: n(row.cfo_to_pat_ratio) ?? n(row.ocf_to_pat_ratio),
    d1Reaction: n(row.d1_pct),
    // Neither market's graded row carries order-book growth today, so B is
    // structurally unavailable and the classifier says so by never returning
    // it rather than by guessing from revenue.
    orderGrowth: n(row.order_book_growth_pct),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// NEAREST FIT — A LOOSE TYPE FOR A HOLDING NOTHING CLASSIFIED.       (zzz775)
//
// 56 of 115 held names had no thesis type, so no thesis variable could move
// their status and every one of them sat at CONFIRMATION REQUIRED. The owner
// holds each for a reason; the figures usually point at one of the four. When
// the exact classifier returns null, the nearest type is assigned from the
// SAME graded figures and labelled as such — never passed off as an exact
// fit — and the owner's own choice (the picker) always wins.
//
//   F  earnings ≥ 2.5× revenue growth AND earnings ≥ +60%   (a profit jump)
//   A  revenue ≥ +15%, earnings growing faster than revenue  (volume-led,
//      (earnings ÷ revenue growth ≥ 1.1 — clear of the 1.0×   with leverage)
//      line the A ledger's own leverage test reads as failing)
//   G  revenue +5% to +15% with cash conversion above 1×    (quiet, cash-backed)
//   else none — a holding with falling earnings on rising revenue, or with
//   no figures, fits nothing even loosely, and is left untyped.
//
// Refined on the live book: A requires earnings to keep pace with revenue
// (ratio ≥ 1). TI (revenue +156%, earnings −72%) and LLOYDSENT (+70% / −74%)
// are not an operating inflection by any reading, and fourteen names with
// revenue up 15%+ but earnings lagging (WONDERLA +45% / +38%, TATATECH +34% /
// +6%) were typed A only to read THESIS WEAKENING on the very test that
// defines A ("earnings grow slower than revenue") — a type that contradicts
// the figures it was fitted from is not a fit. They stay untyped.
// ═══════════════════════════════════════════════════════════════════════════
export const NEAREST_FIT_NOTE = 'set your own with the picker';
export function nearestFit(input: AbfgInput): AbfgResult | null {
  const salesY = num(input.salesY);
  const epsY = num(input.epsY);
  const cfo = num(input.cfoToPat);
  const ratio = (salesY != null && epsY != null && salesY >= 1) ? epsY / salesY : null;
  const fmt = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v * 10) / 10}%`;
  const out = (pattern: AbfgPattern, figures: string): AbfgResult => ({
    pattern, ratio: ratio == null ? null : Math.round(ratio * 10) / 10, fit: 'nearest', exitCondition: EXIT[pattern],
    because: `Nearest fit (auto) — the figures fit ${pattern} · ${ABFG_META[pattern].name.toLowerCase()} loosely (${figures}); no exact test fired. ${NEAREST_FIT_NOTE[0].toUpperCase()}${NEAREST_FIT_NOTE.slice(1)}.`,
  });
  // zzz804 — the same forensics question as the exact classifier: a jump the
  // operating line and the cash explain is not a profit-jump suspicion.
  const cleared = forensicsCheck(input) === 'passed';
  if (ratio != null && epsY != null && ratio >= 2.5 && epsY >= 60 && !cleared) return out('F', `earnings ${fmt(epsY)}, ${ratio.toFixed(1)}× revenue ${fmt(salesY!)}`);
  if (salesY != null && epsY != null && ratio != null && salesY >= 15 && ratio >= 1.1 && !cashContradicts(input)) return out('A', `revenue ${fmt(salesY)}, earnings ${fmt(epsY)} (${ratio.toFixed(1)}×)`);
  if (salesY != null && salesY >= 5 && salesY < 15 && cfo != null && cfo > 1 && (epsY == null || epsY >= 0)) return out('G', `revenue ${fmt(salesY)}, cash conversion ${cfo.toFixed(2)}×`);
  return null;
}
/** The exact classification of a graded row, else its nearest fit. For the
 *  thesis book only — the screening pages keep the exact classifier. */
export function classifyOrNearest(row: any): AbfgResult | null {
  const exact = classifyGradedRow(row);
  if (exact || !row || typeof row !== 'object') return exact;
  const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return nearestFit({
    ...usOperatingEvidence(row),
    salesY: n(row.sales_yoy_pct),
    epsY: n(row.eps_yoy_pct) ?? n(row.net_profit_yoy_pct),
    cfoToPat: n(row.cfo_to_pat_ratio) ?? n(row.ocf_to_pat_ratio),
  });
}

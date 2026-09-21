// ═══════════════════════════════════════════════════════════════════════════
// STRUCTURAL VARIABLES — WHAT ACTUALLY CHANGED.                     (zzz715)
//
// From the owner's specification. The instruction that shapes every line of
// this file: "Don't store news. Store events + evidence + implication." And
// the harder one underneath it: "Separate facts from interpretation."
//
// So a structural variable is a BEFORE, an AFTER, and a source — never a
// sentiment, never a score, and never a number this module computed from a
// number the filing did not state. Where the filing gives one side only, the
// other side stays null and the variable says `unknown`. An unknown variable
// is a real answer: it is the difference between "utilisation did not improve"
// and "the company did not disclose utilisation", and collapsing those two
// into one is how an exit engine ends up firing on silence.
//
// TWO EVIDENCE LEVELS, NEVER MIXED:
//
//   · GRADER   — the numbers the earnings engine computed from the filed
//                statements: revenue growth, earnings growth, OPM change,
//                cash conversion. Machine-read, no model involved.
//   · FILING   — the figure-verified `structured` object from the AI summary,
//                every number of which was checked against the document text
//                before it was allowed out of the route.
//
// Both are facts about a document. Nothing in this file is an inference about
// the future; that happens one layer up, in status.ts, and is labelled there.
// ═══════════════════════════════════════════════════════════════════════════

export type VarKey =
  | 'revenue_growth'
  | 'earnings_growth'
  | 'operating_leverage'
  | 'margin'
  | 'utilisation'
  | 'capacity'
  | 'capex'
  | 'order_book'
  | 'book_to_bill'
  | 'guidance'
  | 'cash_conversion'
  | 'one_offs';

export type VarVerdict = 'improving' | 'flat' | 'deteriorating' | 'unknown';
export type VarSource = 'grader' | 'filing';

export interface StructuralVar {
  key: VarKey;
  label: string;
  /** As the source stated it. Strings, not numbers: "68%", "₹500 Cr", "2.1x". */
  before: string | null;
  after: string | null;
  /** The change, where the source stated both sides or stated the delta. */
  delta: string | null;
  verdict: VarVerdict;
  /** One line naming what was read and from where. Never a paraphrase of a
   *  conclusion — the fact itself. */
  evidence: string;
  source: VarSource;
}

export const VAR_LABEL: Record<VarKey, string> = {
  revenue_growth: 'Revenue growth',
  earnings_growth: 'Earnings growth',
  operating_leverage: 'Operating leverage',
  margin: 'Operating margin',
  utilisation: 'Capacity utilisation',
  capacity: 'Capacity',
  capex: 'Capex',
  order_book: 'Order book',
  book_to_bill: 'Book-to-bill',
  guidance: 'Guidance',
  cash_conversion: 'Cash conversion',
  one_offs: 'One-offs',
};

const n = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** The AI-summary routes are instructed to write "not stated" rather than
 *  invent, so a placeholder is data — it means the document was silent. */
const PLACEHOLDER =
  /^(not\s+(stated|disclosed|quantified|available|applicable|given|provided)|n\/?a|none|unknown|—|-|nil)$/i;

export function said(v: unknown): boolean {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length > 0 && !PLACEHOLDER.test(s);
}

const pct = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v * 10) / 10}%`;

/** Percent out of a stated string like "68%", "68.5 per cent", "82". */
function pctIn(s: unknown): number | null {
  if (!said(s)) return null;
  const m = String(s).match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const v = Number(m[0]);
  return Number.isFinite(v) ? v : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Read every structural variable the two sources can support.
 *
 * `graded` is a row from the India or US earnings grader; `summary` is the
 * verified `structured` object from the AI summary route. Either may be null,
 * and the result is simply shorter — a holding with no filing read yet has a
 * thesis evaluated on grader numbers alone, and the UI says so rather than
 * pretending the evidence is complete.
 */
export function extractVariables(graded: any | null, summary: any | null): StructuralVar[] {
  const out: StructuralVar[] = [];
  const push = (v: StructuralVar) => { out.push(v); };

  // ── GRADER FACTS ────────────────────────────────────────────────────────
  const salesY = n(graded?.sales_yoy_pct);
  const epsY = n(graded?.eps_yoy_pct) ?? n(graded?.net_profit_yoy_pct);
  const opmChange = n(graded?.opm_change_pp) ?? n(graded?.opm_delta_pp);
  const opm = n(graded?.opm_pct);
  const cfoToPat = n(graded?.cfo_to_pat_ratio) ?? n(graded?.ocf_to_pat_ratio);

  if (salesY != null) {
    push({
      key: 'revenue_growth', label: VAR_LABEL.revenue_growth,
      before: null, after: pct(salesY), delta: pct(salesY),
      // A threshold is a judgement about the NUMBER, not about the future, so
      // it belongs here. The cut-offs are the ones the A test already uses, so
      // the page and the classifier can never disagree about the same quarter.
      verdict: salesY >= 15 ? 'improving' : salesY >= 0 ? 'flat' : 'deteriorating',
      evidence: `Revenue ${pct(salesY)} YoY, from the filed statements.`,
      source: 'grader',
    });
  }
  if (epsY != null) {
    push({
      key: 'earnings_growth', label: VAR_LABEL.earnings_growth,
      before: null, after: pct(epsY), delta: pct(epsY),
      verdict: epsY >= 20 ? 'improving' : epsY >= 0 ? 'flat' : 'deteriorating',
      evidence: `Earnings ${pct(epsY)} YoY, from the filed statements.`,
      source: 'grader',
    });
  }

  // OPERATING LEVERAGE is the one computed variable here, and it is computed
  // from two filed numbers with no assumption in between: profit growing
  // faster than revenue IS operating leverage, arithmetically. The guard is
  // the same one the classifier uses — a ratio off a trivial revenue base is
  // noise, so below 1% growth the variable stays unknown rather than large.
  if (salesY != null && epsY != null) {
    if (salesY >= 1) {
      const r = epsY / salesY;
      push({
        key: 'operating_leverage', label: VAR_LABEL.operating_leverage,
        before: `revenue ${pct(salesY)}`, after: `earnings ${pct(epsY)}`,
        delta: `${(Math.round(r * 10) / 10).toFixed(1)}×`,
        verdict: r >= 1.5 ? 'improving' : r >= 1 ? 'flat' : 'deteriorating',
        evidence: r >= 1.5
          ? `Earnings grew ${r.toFixed(1)}× revenue — fixed costs are being absorbed.`
          : r >= 1
            ? `Earnings grew ${r.toFixed(1)}× revenue — profit is keeping pace, not pulling ahead.`
            : `Earnings grew slower than revenue (${r.toFixed(1)}×) — leverage is working against the P&L.`,
        source: 'grader',
      });
    } else {
      push({
        key: 'operating_leverage', label: VAR_LABEL.operating_leverage,
        before: null, after: null, delta: null, verdict: 'unknown',
        evidence: `Revenue moved ${pct(salesY)} — too small a base for a leverage ratio to mean anything.`,
        source: 'grader',
      });
    }
  }

  // ── MARGIN. The AI summary's bridge is preferred because it carries the
  //    REASON, which is the part that decides whether the change is structural.
  const mb = summary?.margin_bridge;
  const mbDelta = said(mb?.opm_change_pp) ? String(mb.opm_change_pp) : null;
  const drivers: any[] = Array.isArray(mb?.drivers) ? mb.drivers : [];
  if (mbDelta || opmChange != null || opm != null) {
    const dv = opmChange != null ? opmChange : pctIn(mbDelta);
    const structural = drivers.filter((d) => d?.nature === 'structural').length;
    const cyclical = drivers.filter((d) => d?.nature === 'cyclical').length;
    const why = drivers.length
      ? ` Reason: ${drivers.map((d) => `${d?.detail} (${String(d?.nature || '').replace(/_/g, ' ')})`).join('; ')}.`
      : ' No reason disclosed — the change is a number without a mechanism.';
    push({
      key: 'margin', label: VAR_LABEL.margin,
      before: opm != null && dv != null ? `${(opm - dv).toFixed(1)}%` : null,
      after: opm != null ? `${opm.toFixed(1)}%` : null,
      delta: mbDelta || (opmChange != null ? `${opmChange >= 0 ? '+' : ''}${opmChange.toFixed(1)}pp` : null),
      verdict: dv == null ? 'unknown' : dv >= 1 ? 'improving' : dv > -1 ? 'flat' : 'deteriorating',
      evidence: `Operating margin ${dv == null ? 'change not quantified' : `${dv >= 0 ? '+' : ''}${dv.toFixed(1)}pp`}.${why}`
        + (structural || cyclical ? ` (${structural} structural, ${cyclical} cyclical.)` : ''),
      source: drivers.length ? 'filing' : 'grader',
    });
  }

  if (cfoToPat != null) {
    push({
      key: 'cash_conversion', label: VAR_LABEL.cash_conversion,
      before: null, after: `${cfoToPat.toFixed(2)}×`, delta: null,
      verdict: cfoToPat >= 1 ? 'improving' : cfoToPat >= 0.6 ? 'flat' : 'deteriorating',
      evidence: `Operating cash flow is ${cfoToPat.toFixed(2)}× reported profit.`,
      source: 'grader',
    });
  }

  // ── FILING FACTS ────────────────────────────────────────────────────────
  const ut = summary?.utilisation || {};
  const utPrior = pctIn(ut.prior), utNow = pctIn(ut.current), utExp = pctIn(ut.expected);
  if (said(ut.current) || said(ut.prior) || said(ut.expected)) {
    const d = utPrior != null && utNow != null ? utNow - utPrior : null;
    push({
      key: 'utilisation', label: VAR_LABEL.utilisation,
      before: said(ut.prior) ? String(ut.prior) : null,
      after: said(ut.current) ? String(ut.current) : null,
      delta: d != null ? `${d >= 0 ? '+' : ''}${d.toFixed(0)}pp` : null,
      verdict: d == null ? 'unknown' : d >= 2 ? 'improving' : d > -2 ? 'flat' : 'deteriorating',
      evidence: [
        said(ut.prior) && said(ut.current) ? `Utilisation ${ut.prior} → ${ut.current}.`
          : said(ut.current) ? `Utilisation ${ut.current}, no prior figure disclosed.` : '',
        said(ut.expected) ? `Management expects ${ut.expected}${said(ut.expected_by) ? ` by ${ut.expected_by}` : ''}.` : '',
      ].filter(Boolean).join(' '),
      source: 'filing',
    });
    void utExp;
  }

  const capex: any[] = Array.isArray(summary?.capex_projects) ? summary.capex_projects : [];
  if (capex.length) {
    const cap = capex.filter((c) => said(c?.capacity_added));
    push({
      key: 'capex', label: VAR_LABEL.capex,
      before: null,
      after: capex.map((c) => [c?.name, said(c?.amount) ? c.amount : null].filter(Boolean).join(' — ')).join(' · '),
      delta: null,
      // A capex ANNOUNCEMENT is not an improvement. It is money leaving the
      // business against a promise, and whether it improved anything is what
      // capex-chain.ts decides from utilisation and margin afterwards. Calling
      // it "improving" here is exactly the excitement the owner asked the
      // system to resist.
      verdict: 'unknown',
      evidence: capex.map((c) => [
        c?.name,
        said(c?.amount) ? c.amount : null,
        said(c?.capacity_added) ? `adds ${c.capacity_added}` : null,
        said(c?.completion_period) ? `completes ${c.completion_period}` : null,
        said(c?.revenue_from) ? `earns from ${c.revenue_from}` : null,
      ].filter(Boolean).join(', ')).join(' | '),
      source: 'filing',
    });
    if (cap.length) {
      push({
        key: 'capacity', label: VAR_LABEL.capacity,
        before: null, after: cap.map((c) => String(c.capacity_added)).join(' · '), delta: null,
        verdict: 'improving',
        evidence: `Capacity added: ${cap.map((c) => `${c.capacity_added}${said(c?.completion_period) ? ` (${c.completion_period})` : ''}`).join('; ')}.`,
        source: 'filing',
      });
    }
  }

  const ob = summary?.order_book || {};
  if (said(ob.closing_value) || said(ob.growth)) {
    const g = pctIn(ob.growth);
    push({
      key: 'order_book', label: VAR_LABEL.order_book,
      before: null,
      after: said(ob.closing_value) ? String(ob.closing_value) : null,
      delta: said(ob.growth) ? String(ob.growth) : null,
      verdict: g == null ? 'unknown' : g >= 15 ? 'improving' : g >= 0 ? 'flat' : 'deteriorating',
      evidence: [
        said(ob.closing_value) ? `Order book ${ob.closing_value}.` : '',
        said(ob.growth) ? `Growth ${ob.growth}.` : '',
      ].filter(Boolean).join(' '),
      source: 'filing',
    });
  }
  if (said(ob.book_to_bill)) {
    const b = Number(String(ob.book_to_bill).match(/-?\d+(?:\.\d+)?/)?.[0]);
    push({
      key: 'book_to_bill', label: VAR_LABEL.book_to_bill,
      before: null, after: String(ob.book_to_bill), delta: null,
      verdict: !Number.isFinite(b) ? 'unknown' : b >= 1.1 ? 'improving' : b >= 1 ? 'flat' : 'deteriorating',
      evidence: `Book-to-bill ${ob.book_to_bill} — ${Number.isFinite(b) && b >= 1
        ? 'orders are being taken faster than they are being billed.'
        : 'the book is being drawn down faster than it is being replaced.'}`,
      source: 'filing',
    });
  }

  const g = summary?.guidance;
  if (g?.action && g.action !== 'none') {
    const a = String(g.action);
    push({
      key: 'guidance', label: VAR_LABEL.guidance,
      before: null, after: a, delta: null,
      verdict: a === 'raised' ? 'improving' : a === 'lowered' ? 'deteriorating' : 'flat',
      evidence: `Guidance ${a}${said(g.detail) ? `: ${g.detail}` : ''}${said(g.period) ? ` (${g.period})` : ''}.`,
      source: 'filing',
    });
  }

  const oneOffs: any[] = Array.isArray(summary?.one_offs) ? summary.one_offs : [];
  if (oneOffs.length) {
    const gains = oneOffs.filter((o) => o?.direction === 'gain');
    push({
      key: 'one_offs', label: VAR_LABEL.one_offs,
      before: null, after: `${oneOffs.length} item${oneOffs.length > 1 ? 's' : ''}`, delta: null,
      // A one-off GAIN flatters this quarter and will not repeat, so it counts
      // against the durability of the result even while it lifts the number.
      verdict: gains.length ? 'deteriorating' : 'flat',
      evidence: oneOffs.map((o) =>
        `${o?.direction === 'gain' ? '+' : '−'} ${o?.item}${said(o?.amount) ? ` (${o.amount})` : ''}`).join('; ')
        + (gains.length ? ' — these will not repeat, so the base for next year is lower than it looks.' : ''),
      source: 'filing',
    });
  }

  return out;
}

/** Index by key, last write wins — the filing beats the grader where both
 *  spoke, because the filing carries the reason. */
export function byKey(vars: StructuralVar[]): Partial<Record<VarKey, StructuralVar>> {
  const m: Partial<Record<VarKey, StructuralVar>> = {};
  for (const v of vars) {
    const prev = m[v.key];
    if (!prev || (prev.source === 'grader' && v.source === 'filing')) m[v.key] = v;
  }
  return m;
}

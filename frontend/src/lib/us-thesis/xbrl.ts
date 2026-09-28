// ═══════════════════════════════════════════════════════════════════════════
// STRICT QUARTERLY FIGURES FROM SEC XBRL COMPANYFACTS.               (zzz793)
//
// The US thesis page compares a company's latest QUARTER with the SAME fiscal
// quarter one year earlier. XBRL companyfacts mixes durations freely — a 10-Q
// carries the 3-month figure AND the 6- or 9-month year-to-date one, a 10-K
// only the full year — so every figure here is classified by its own period
// length before it is used:
//
//   80–100 days    a quarter (the only thing ever called "quarterly")
//   170–195 days   six months (a half year, or a year-to-date)
//   260–285 days   nine months (year-to-date)
//   350–380 days   a full fiscal year
//
// Rules, each one a thing the owner saw go wrong:
//   · a quarter is compared only with a quarter ~one year earlier (±14 days),
//     never with a year-to-date, half-year or annual figure;
//   · the fourth quarter is never filed as a quarter; it is DERIVED as full
//     year − nine months, only when both come from the same fiscal year (same
//     start date) and the result is itself 80–100 days long — and labelled
//     "derived";
//   · cash flow is year-to-date in every 10-Q; a quarter is the difference of
//     two year-to-date figures with the same start, labelled "derived";
//   · values are stored by EDGAR in whole units (USD, not thousands), so the
//     only scaling is ÷ 1e6 for $M, and a non-USD filer is never shown as $;
//   · several revenue / profit tags are tried (companies rename them), and a
//     tag is only merged with another when they agree on a shared period;
//   · foreign private issuers (20-F / 40-F / 6-K) that tag ifrs-full get their
//     half-year or annual figures, labelled as such and never as quarterly.
//
// The company's OWN fiscal calendar (fiscal year end, and whether it names a
// year by its end or its start) comes from its own annual facts, so the page
// prints "Q2 FY2026 (quarter ended Jul 31, 2026)" and never an India key.
//
// Pure: no fetch, no model, no price.
// ═══════════════════════════════════════════════════════════════════════════

export type DurKind = 'Q' | 'H' | '9M' | 'FY';
export type Basis = 'quarterly' | 'semiannual' | 'annual';

interface Row { start: string; end: string; val: number; form: string; filed: string; fy: number | null; fp: string | null }
interface Point { start: string; end: string; val: number; derived: null | 'FY-9M' | 'YTD' }

const DAY = 86_400_000;
const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
const days = (a: string, b: string) => Math.round((t(b) - t(a)) / DAY);

export function durationKind(start: string | null | undefined, end: string): DurKind | null {
  if (!start) return null;
  const d = days(start, end);
  if (d >= 80 && d <= 100) return 'Q';
  if (d >= 170 && d <= 195) return 'H';
  if (d >= 260 && d <= 285) return '9M';
  if (d >= 350 && d <= 380) return 'FY';
  return null;
}

export const US_TAGS = {
  revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax',
    'SalesRevenueGoodsNet', 'SalesRevenueServicesNet', 'RevenuesNetOfInterestExpense', 'RevenueFromContractWithCustomerProductAndServiceExcludingAssessedTax'],
  net_income: ['NetIncomeLoss', 'ProfitLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic', 'NetIncomeLossAttributableToParent'],
  operating_income: ['OperatingIncomeLoss'],
  cfo: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'],
  eps: ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted'],
} as const;
export const IFRS_TAGS = {
  revenue: ['Revenue', 'RevenueFromContractsWithCustomers'],
  net_income: ['ProfitLoss', 'ProfitLossAttributableToOwnersOfParent'],
  operating_income: ['ProfitLossFromOperatingActivities'],
  cfo: ['CashFlowsFromUsedInOperatingActivities'],
  capex: ['PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities'],
  eps: ['DilutedEarningsLossPerShare'],
} as const;

type Kind = keyof typeof US_TAGS;

/** The rows of one concept, in one currency, one per (start, end) — the
 *  LATEST filing's value, so a restated comparative wins. */
function rowsOf(facts: any, ns: string, concept: string, perShare = false): { unit: string; rows: Row[] } | null {
  const c = facts?.facts?.[ns]?.[concept];
  if (!c?.units) return null;
  const units = Object.keys(c.units);
  // The currency the company reports in NOW: the unit with the newest figure
  // (XPeng tagged one year in USD convenience translation, every later year in
  // CNY). USD wins a tie.
  const ok = units.filter((u) => (perShare ? /\/shares$/i.test(u) : /^[A-Z]{3}$/.test(u)));
  const newestEnd = (u: string) => (c.units[u] as any[]).reduce((m, e) => (String(e?.end || '') > m ? String(e.end) : m), '');
  const pick = ok.sort((a, b) => newestEnd(b).localeCompare(newestEnd(a)) || (/^USD/.test(b) ? 1 : 0) - (/^USD/.test(a) ? 1 : 0))[0];
  if (!pick) return null;
  const by = new Map<string, Row>();
  for (const e of c.units[pick] as any[]) {
    if (!e || typeof e.val !== 'number' || !Number.isFinite(e.val) || !e.end || !e.start) continue;
    const form = String(e.form || '');
    if (!/^(10-Q|10-K|20-F|40-F|6-K|8-K|10-KT|10-QT)/.test(form)) continue;
    const k = `${e.start}|${e.end}`;
    const prev = by.get(k);
    const r: Row = { start: String(e.start), end: String(e.end), val: e.val, form, filed: String(e.filed || ''), fy: Number.isFinite(Number(e.fy)) ? Number(e.fy) : null, fp: e.fp ? String(e.fp) : null };
    if (!prev || r.filed > prev.filed) by.set(k, r);
  }
  return { unit: pick, rows: Array.from(by.values()) };
}

/**
 * Quarters of one concept, by quarter end. Direct 3-month facts first; then
 * quarters derived from two figures of the SAME fiscal year (same start):
 * FY − 9M for a P&L line, and consecutive year-to-date differences for a
 * cash-flow line. A derived value is kept only when its own span is 80–100
 * days and no direct figure exists for that end.
 */
export function quartersOf(rows: Row[], ytd: boolean): Map<string, Point> {
  const out = new Map<string, Point>();
  for (const r of rows) if (durationKind(r.start, r.end) === 'Q') out.set(r.end, { start: r.start, end: r.end, val: r.val, derived: null });
  const byStart = new Map<string, Row[]>();
  for (const r of rows) {
    const k = durationKind(r.start, r.end);
    if (!k || k === 'Q') continue;
    if (!byStart.has(r.start)) byStart.set(r.start, []);
    byStart.get(r.start)!.push(r);
  }
  const has = (end: string) => Array.from(out.keys()).some((e) => Math.abs(days(e, end)) <= 3);
  for (const [start, list] of Array.from(byStart.entries())) {
    // the year-to-date chain of one fiscal year: 3M (direct) → 6M → 9M → FY
    const q1 = rows.find((r) => r.start === start && durationKind(r.start, r.end) === 'Q');
    const chain = [...(q1 ? [q1] : []), ...list].sort((a, b) => a.end.localeCompare(b.end));
    for (let i = 1; i < chain.length; i++) {
      const cur = chain[i], prev = chain[i - 1];
      const kind = durationKind(cur.start, cur.end);
      // P&L: only the fourth quarter is derived (FY − 9M). Cash flow: every step.
      if (!ytd && !(kind === 'FY' && durationKind(prev.start, prev.end) === '9M')) continue;
      const qStart = new Date(t(prev.end) + DAY).toISOString().slice(0, 10);
      if (durationKind(qStart, cur.end) !== 'Q' || has(cur.end)) continue;
      out.set(cur.end, { start: qStart, end: cur.end, val: cur.val - prev.val, derived: kind === 'FY' && !ytd ? 'FY-9M' : 'YTD' });
    }
  }
  return out;
}

/** Figures of a longer duration (half year / full year), by end. */
function spansOf(rows: Row[], kind: DurKind): Map<string, Point> {
  const out = new Map<string, Point>();
  for (const r of rows) if (durationKind(r.start, r.end) === kind) out.set(r.end, { start: r.start, end: r.end, val: r.val, derived: null });
  return out;
}

/** The point ~one year before `end` (±14 days), in the same map. */
export function yearAgo(m: Map<string, Point>, end: string): Point | null {
  let best: Point | null = null, gap = Infinity;
  for (const p of Array.from(m.values())) {
    const g = Math.abs(days(p.end, end) - 364);
    if (p.end < end && g <= 14 && g < gap) { best = p; gap = g; }
  }
  return best;
}

// ── the company's own fiscal calendar ─────────────────────────────────────

export interface FiscalCalendar { fyeMonth: number; fyeDay: number; offset: number; source: string }

/** Fiscal year end and naming rule, from the company's own annual facts. */
export function fiscalCalendar(facts: any): FiscalCalendar | null {
  const annual: Row[] = [];
  for (const [ns, tags] of [['us-gaap', [...US_TAGS.revenue, ...US_TAGS.net_income]], ['ifrs-full', [...IFRS_TAGS.revenue, ...IFRS_TAGS.net_income]]] as Array<[string, readonly string[]]>) {
    for (const c of tags) {
      const s = rowsOf(facts, ns, c);
      if (s) annual.push(...s.rows.filter((r) => durationKind(r.start, r.end) === 'FY'));
    }
  }
  if (!annual.length) return null;
  annual.sort((a, b) => b.end.localeCompare(a.end));
  const latest = annual[0];
  const d = new Date(t(latest.end));
  // Naming: the fy the ANNUAL filing itself tagged for this year end. EDGAR's
  // fy on a fact is the filing's, so read it from the filing whose own year
  // ends here (the earliest 10-K / 20-F that carries this end as its FY).
  const facts0 = facts?.facts || {};
  let fy: number | null = null, filed = '';
  for (const ns of ['us-gaap', 'ifrs-full']) {
    for (const c of Object.values<any>(facts0[ns] || {})) {
      for (const arr of Object.values<any>(c?.units || {})) {
        if (!Array.isArray(arr)) continue;
        for (const e of arr) {
          if (e?.end !== latest.end || e?.fp !== 'FY' || !/^(10-K|20-F|40-F)/.test(String(e.form || ''))) continue;
          if (durationKind(e.start, e.end) !== 'FY') continue;
          if (fy == null || String(e.filed || '') < filed) { fy = Number(e.fy); filed = String(e.filed || ''); }
        }
      }
    }
  }
  const endYear = d.getUTCFullYear();
  const offset = fy != null && Number.isFinite(fy) && Math.abs(fy - endYear) <= 1 ? fy - endYear : 0;
  return { fyeMonth: d.getUTCMonth() + 1, fyeDay: d.getUTCDate(), offset, source: `fiscal year ends ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} (from the ${latest.form})` };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const niceDate = (iso: string | null | undefined): string => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return String(iso || '');
  const d = new Date(t(iso.slice(0, 10)));
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
};

/** "Q2 FY2026" / "H1 FY2026" / "FY2025" for a period ending `end`. */
export function fiscalPeriodName(end: string, kind: DurKind, cal: FiscalCalendar | null): string | null {
  if (!cal) return null;
  const e = new Date(t(end));
  let y = e.getUTCFullYear();
  let fye = Date.UTC(y, cal.fyeMonth - 1, cal.fyeDay);
  // 52/53-week years move the year end by up to a week.
  if (e.getTime() > fye + 10 * DAY) { y += 1; fye = Date.UTC(y, cal.fyeMonth - 1, cal.fyeDay); }
  const fyName = y + cal.offset;
  if (kind === 'FY') return `FY${fyName}`;
  const monthsLeft = (y * 12 + (cal.fyeMonth - 1)) - (e.getUTCFullYear() * 12 + e.getUTCMonth());
  const q = Math.min(4, Math.max(1, 4 - Math.round(monthsLeft / 3)));
  if (kind === 'H') return `${q <= 2 ? 'H1' : 'H2'} FY${fyName}`;
  if (kind === '9M') return `9M FY${fyName}`;
  return `Q${q} FY${fyName}`;
}

export function periodLabel(end: string, kind: DurKind, cal: FiscalCalendar | null): string {
  const name = fiscalPeriodName(end, kind, cal);
  const span = kind === 'Q' ? 'quarter ended' : kind === 'H' ? 'six months ended' : kind === '9M' ? 'nine months ended' : 'year ended';
  return name ? `${name} (${span} ${niceDate(end)})` : `${span} ${niceDate(end)}`;
}

// ── the figures ────────────────────────────────────────────────────────────

export interface StrictFigure { cur: number | null; prev: number | null; derived: string | null; tag: string | null }
export interface StrictFigures {
  taxonomy: 'us-gaap' | 'ifrs-full' | null;
  currency: string | null;
  basis: Basis | null;
  q_end: string | null; q_start: string | null; q_end_prev: string | null;
  q_filed: string | null;
  fiscal_name: string | null;
  period_label: string | null;
  revenue: StrictFigure; net_income: StrictFigure; operating_income: StrictFigure; cfo: StrictFigure; capex: StrictFigure; eps: StrictFigure;
  calendar: FiscalCalendar | null;
  /** Plain reason when no usable figure exists. */
  why: string | null;
}

const EMPTY: StrictFigure = { cur: null, prev: null, derived: null, tag: null };

/** One kind: every candidate tag's quarters (or spans), the chosen one first. */
function pickSeries(facts: any, ns: string, tags: readonly string[], kind: Kind, span: DurKind): Array<{ tag: string; unit: string; m: Map<string, Point> }> {
  const out: Array<{ tag: string; unit: string; m: Map<string, Point> }> = [];
  for (const tag of tags) {
    const s = rowsOf(facts, ns, tag, kind === 'eps');
    if (!s) continue;
    // Per-share figures are never derived by subtraction.
    const m = span === 'Q' ? (kind === 'eps' ? spansOf(s.rows, 'Q') : quartersOf(s.rows, kind === 'cfo' || kind === 'capex')) : spansOf(s.rows, span);
    if (m.size) out.push({ tag, unit: s.unit, m });
  }
  return out;
}

const near = (a: string, b: string) => Math.abs(days(a, b)) <= 4;
const atEnd = (m: Map<string, Point>, end: string): Point | null => {
  const hit = m.get(end);
  if (hit) return hit;
  for (const p of Array.from(m.values())) if (near(p.end, end)) return p;
  return null;
};

function figureAt(cands: Array<{ tag: string; unit: string; m: Map<string, Point> }>, end: string, kind: Kind): StrictFigure {
  const here = cands.filter((c) => atEnd(c.m, end));
  if (!here.length) return EMPTY;
  // Revenue: the largest figure among the tags covering the quarter is the
  // top line (a component is smaller), but the "including assessed tax"
  // spelling never displaces a net figure. Everything else: tag order.
  let chosen = here[0];
  if (kind === 'revenue') {
    const net = here.filter((c) => !/IncludingAssessedTax/.test(c.tag));
    const pool = net.length ? net : here;
    chosen = pool.reduce((a, b) => (atEnd(b.m, end)!.val > atEnd(a.m, end)!.val * 1.001 ? b : a));
  }
  const cur = atEnd(chosen.m, end)!;
  let prev = yearAgo(chosen.m, end);
  // A renamed tag: another tag that AGREES with the chosen one on a shared
  // period may supply the year-ago figure; a tag that disagrees never does.
  if (!prev) {
    for (const o of cands) {
      if (o === chosen) continue;
      const shared = Array.from(o.m.values()).filter((p) => { const q = atEnd(chosen.m, p.end); return q && Math.abs(q.val - p.val) <= Math.max(1, Math.abs(p.val) * 0.005); });
      if (!shared.length) continue;
      const p = yearAgo(o.m, end);
      if (p) { prev = p; break; }
    }
  }
  const derived = [cur.derived ? `this period derived (${cur.derived === 'FY-9M' ? 'full year − nine months' : 'year-to-date difference'})` : null,
    prev?.derived ? `year-ago period derived (${prev.derived === 'FY-9M' ? 'full year − nine months' : 'year-to-date difference'})` : null].filter(Boolean).join('; ') || null;
  return { cur: cur.val, prev: prev ? prev.val : null, derived, tag: chosen.tag };
}

/**
 * The strict figures for the newest period a company has reported. Quarterly
 * when the company files quarters (10-Q); otherwise its latest half year or
 * full year (20-F / 40-F / 6-K filers), labelled as such.
 */
export function strictFigures(facts: any): StrictFigures {
  const blank = (why: string, taxonomy: StrictFigures['taxonomy'] = null): StrictFigures => ({
    taxonomy, currency: null, basis: null, q_end: null, q_start: null, q_end_prev: null, q_filed: null, fiscal_name: null, period_label: null,
    revenue: EMPTY, net_income: EMPTY, operating_income: EMPTY, cfo: EMPTY, capex: EMPTY, eps: EMPTY, calendar: null, why,
  });
  const f = facts?.facts || {};
  const ns = f['us-gaap'] && US_TAGS.revenue.concat(US_TAGS.net_income as any).some((c) => f['us-gaap'][c]) ? 'us-gaap'
    : f['ifrs-full'] ? 'ifrs-full' : f['us-gaap'] ? 'us-gaap' : null;
  if (!ns) return blank('the SEC XBRL data for this company carries no financial statements (no us-gaap or ifrs-full facts)');
  const tags = ns === 'us-gaap' ? US_TAGS : IFRS_TAGS;
  const cal = fiscalCalendar(facts);

  const series = (kind: Kind, span: DurKind) => pickSeries(facts, ns, tags[kind], kind, span);
  const newest = (list: Array<{ m: Map<string, Point> }>) => list.reduce((m, c) => { const e = Array.from(c.m.keys()).sort().pop() || ''; return e > m ? e : m; }, '');

  // Which basis: the newest quarter, unless a longer period ends clearly later
  // and no quarter covers it (a company that stopped filing 10-Qs).
  const qRev = series('revenue', 'Q'), qNi = series('net_income', 'Q');
  const qEnd = [newest(qRev), newest(qNi)].sort().pop() || '';
  const longEnds = (['H', 'FY'] as DurKind[]).map((k) => ({ k, end: [newest(series('revenue', k)), newest(series('net_income', k))].sort().pop() || '' }));
  const longest = longEnds.filter((x) => x.end).sort((a, b) => b.end.localeCompare(a.end))[0] || null;
  let basis: Basis | null = null, span: DurKind = 'Q', end = '';
  if (qEnd && (!longest || longest.end <= qEnd || days(qEnd, longest.end) <= 20)) { basis = 'quarterly'; span = 'Q'; end = qEnd; }
  else if (longest) { basis = longest.k === 'H' ? 'semiannual' : 'annual'; span = longest.k; end = longest.end; }
  if (!basis) return { ...blank(ns === 'ifrs-full' ? 'no revenue or profit figures in the ifrs-full facts' : 'no quarterly revenue or net income in the SEC XBRL facts', ns as any), calendar: cal };

  const at = (kind: Kind) => figureAt(series(kind, span), end, kind);
  const revenue = at('revenue'), net_income = at('net_income'), operating_income = at('operating_income'), cfo = at('cfo'), capex = at('capex'), eps = at('eps');
  // the period's own dates and the year-ago end, from whichever line carried it
  const lead = [...series('revenue', span), ...series('net_income', span)].map((c) => atEnd(c.m, end)).find(Boolean) || null;
  const prevLead = [...series('revenue', span), ...series('net_income', span)].map((c) => yearAgo(c.m, end)).find(Boolean) || null;
  // the currency of the money lines (never assumed to be USD)
  const unitOf = (kind: Kind) => series(kind, span).find((c) => atEnd(c.m, end))?.unit || null;
  const currency = unitOf('revenue') || unitOf('net_income');
  // when these numbers first became public
  let filed: string | null = null;
  for (const kind of ['revenue', 'net_income'] as Kind[]) {
    for (const tag of tags[kind]) {
      const s = rowsOf(facts, ns, tag);
      for (const r of s?.rows || []) if (near(r.end, end) && durationKind(r.start, r.end) && (!filed || r.filed < filed)) filed = r.filed;
    }
  }
  const noCompare = revenue.cur != null && revenue.prev == null && net_income.prev == null;
  return {
    taxonomy: ns as any, currency, basis, q_end: end, q_start: lead?.start || null, q_end_prev: prevLead?.end || null, q_filed: filed,
    fiscal_name: fiscalPeriodName(end, span, cal), period_label: periodLabel(end, span, cal),
    revenue, net_income, operating_income, cfo, capex, eps, calendar: cal,
    why: noCompare ? `no figure for the same ${span === 'Q' ? 'quarter' : 'period'} a year earlier in the SEC XBRL facts` : null,
  };
}

/** ROCE, only where it is clean, for the SAME period the card reports:
 *  operating income over the four quarters ending `qEnd` (each a strict
 *  3-month figure, the fourth quarter derived only as full year − nine
 *  months) ÷ capital employed (total assets − current liabilities) at `qEnd`.
 *  Any piece missing → null (the card then omits ROCE; US filers report none). */
export function roceFromFacts(facts: any, qEnd?: string | null): { pct: number; fiscal: string | null; end: string } | null {
  const g = facts?.facts?.['us-gaap'];
  if (!g) return null;
  const oi = rowsOf(facts, 'us-gaap', 'OperatingIncomeLoss');
  if (!oi || oi.unit !== 'USD') return null;
  const qs = quartersOf(oi.rows, false);
  const ends = Array.from(qs.keys()).sort();
  const end = qEnd ? ends.find((e) => near(e, qEnd)) : ends[ends.length - 1];
  if (!end) return null;
  // the four consecutive quarters ending at `end`
  const four: Point[] = [qs.get(end)!];
  for (let i = 1; i < 4; i++) {
    const prevEnd = four[0].start;
    const p = Array.from(qs.values()).find((x) => Math.abs(days(x.end, prevEnd)) <= 4);
    if (!p) return null;
    four.unshift(p);
  }
  const ttm = four.reduce((a, p) => a + p.val, 0);
  const inst = (concept: string): number | null => {
    const c = g[concept]?.units?.USD as any[] | undefined;
    if (!c) return null;
    const hits = c.filter((e) => e?.end && near(String(e.end), end) && !e.start && typeof e.val === 'number').sort((a, b) => String(b.filed).localeCompare(String(a.filed)));
    return hits.length ? hits[0].val : null;
  };
  const assets = inst('Assets'), curLiab = inst('LiabilitiesCurrent');
  if (assets == null || curLiab == null) return null;
  const ce = assets - curLiab;
  if (!(ce > 0)) return null;
  return { pct: Math.round((ttm / ce) * 1000) / 10, fiscal: fiscalPeriodName(end, 'Q', fiscalCalendar(facts)), end };
}

/** One RPO reading: the value the company filed for a period end. */
export interface RpoReading { end: string; value: number; filed: string; form: string }
export interface UsRpo {
  /** us-gaap:RevenueRemainingPerformanceObligation — the filed order backlog
   *  (contracted revenue not yet recognised), USD, as of `cur.end`. */
  cur: RpoReading; prev: RpoReading | null; pct: number | null;
  /** Up to five readings ending at `cur`, oldest first. */
  series: RpoReading[];
}

/**
 * The filed order backlog (remaining performance obligations) from XBRL — an
 * INSTANT figure, one per period end, the latest filing's value for each end.
 * Current only: when `qEnd` (the latest quarter the company reported) is
 * given, a reading more than 100 days older than it is stale and ignored
 * (GNRC last tagged RPO in Sep 2025). No figure → null; never inferred.
 */
export function rpoReadings(facts: any, qEnd?: string | null): UsRpo | null {
  const c = facts?.facts?.['us-gaap']?.RevenueRemainingPerformanceObligation?.units?.USD as any[] | undefined;
  if (!Array.isArray(c)) return null;
  const by = new Map<string, RpoReading>();
  for (const e of c) {
    if (!e?.end || e.start || typeof e.val !== 'number' || !Number.isFinite(e.val) || e.val <= 0) continue;
    const r: RpoReading = { end: String(e.end), value: e.val, filed: String(e.filed || ''), form: String(e.form || '') };
    const prev = by.get(r.end);
    if (!prev || r.filed > prev.filed) by.set(r.end, r);
  }
  const all = Array.from(by.values()).sort((a, b) => a.end.localeCompare(b.end));
  if (!all.length) return null;
  let cur = all[all.length - 1];
  if (qEnd) {
    const at = all.filter((r) => r.end <= qEnd || near(r.end, qEnd)).pop();
    if (!at || days(at.end, qEnd) > 100) return null;
    cur = at;
  }
  const prev = all.filter((r) => r.end < cur.end && Math.abs(days(r.end, cur.end) - 364) <= 14).pop() || null;
  const series = all.filter((r) => r.end <= cur.end).slice(-5);
  return { cur, prev, pct: prev ? Math.round(((cur.value / prev.value) - 1) * 1000) / 10 : null, series };
}

/** zzz815: one balance-sheet (instant) figure at the latest quarter end and
 *  a year earlier — inventories, receivables. */
export interface UsInstantYoY { concept: string; cur: RpoReading; prev: RpoReading | null; pct: number | null }

/**
 * zzz815 — a balance-sheet figure the company FILED, at the latest quarter
 * end (`qEnd`, within 10 days) and at the same date a year earlier. Used for
 * the working-capital row (inventories) without any model. Null when the
 * company does not tag it for that quarter end — never inferred.
 */
export function instantYoY(facts: any, concepts: readonly string[], qEnd: string | null | undefined): UsInstantYoY | null {
  if (!qEnd) return null;
  for (const concept of concepts) {
    const c = facts?.facts?.['us-gaap']?.[concept]?.units?.USD as any[] | undefined;
    if (!Array.isArray(c)) continue;
    const by = new Map<string, RpoReading>();
    for (const e of c) {
      if (!e?.end || e.start || typeof e.val !== 'number' || !Number.isFinite(e.val) || e.val < 0) continue;
      const r: RpoReading = { end: String(e.end), value: e.val, filed: String(e.filed || ''), form: String(e.form || '') };
      const had = by.get(r.end);
      if (!had || r.filed > had.filed) by.set(r.end, r);
    }
    const all = Array.from(by.values()).sort((a, b) => a.end.localeCompare(b.end));
    const cur = all.filter((r) => Math.abs(days(r.end, qEnd)) <= 10).pop();
    if (!cur) continue;
    const prev = all.filter((r) => r.end < cur.end && Math.abs(days(r.end, cur.end) - 364) <= 14).pop() || null;
    return { concept, cur, prev, pct: prev && prev.value > 0 ? Math.round(((cur.value / prev.value) - 1) * 1000) / 10 : null };
  }
  return null;
}

/** Remaining performance obligations (a filed backlog measure), latest vs a
 *  year earlier, when both are tagged and current. */
export function rpoGrowth(facts: any, qEnd?: string | null): { cur: number; prev: number; pct: number; end: string } | null {
  const r = rpoReadings(facts, qEnd);
  if (!r || !r.prev || r.pct == null) return null;
  return { cur: r.cur.value, prev: r.prev.value, pct: r.pct, end: r.cur.end };
}

/** "$7.10 billion" / "$164.4 million" — the spelling the shared unit
 *  normaliser reads exactly (USD million), with no rounding beyond the
 *  filing's own precision that matters (3 significant figures kept). */
export function usdWords(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })} billion`;
  if (v >= 1e6) return `$${(v / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} million`;
  return `$${v.toLocaleString('en-US')}`;
}

/** Money as the owner reads it: $412.6M, $1.9B, $850K — in the filing's own
 *  currency when it is not USD ("CNY 1,234.5M"). */
export function moneyShort(v: number | null | undefined, currency: string | null = 'USD'): string | null {
  if (v == null || !Number.isFinite(v)) return null;
  const neg = v < 0 ? '−' : '';
  const a = Math.abs(v);
  const pre = !currency || currency === 'USD' ? '$' : `${currency} `;
  const fmt = (x: number, d: number) => x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 });
  if (a >= 1e9) return `${neg}${pre}${fmt(a / 1e9, 2)}B`;
  if (a >= 1e6) return `${neg}${pre}${fmt(a / 1e6, 1)}M`;
  if (a >= 1e3) return `${neg}${pre}${fmt(a / 1e3, 0)}K`;
  return `${neg}${pre}${fmt(a, 0)}`;
}

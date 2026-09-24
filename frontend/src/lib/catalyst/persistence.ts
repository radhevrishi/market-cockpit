// ═══════════════════════════════════════════════════════════════════════════
// PERSISTENT CATALYST LAYER                                          (zzz780)
//
// A separate dimension from the thesis status and from Research Priority.
// It answers one question per company:
//
//   Is there a business MECHANISM whose economic effect can continue across
//   several future periods, and is there evidence it is still active?
//
// Inputs are evidence the app already holds — never price, never a new model
// call:
//   · the evidence ledger (every period's extracted facts, with source, date
//     and quote) — this IS the multi-quarter memory;
//   · the thesis assessment's quality-filtered mechanism drivers (customers,
//     approvals, mix) for the current period;
//   · an AI Daily Gainers finding (the filing behind a move: category, stated
//     value and the reader's facts — execution period, capacity, customer).
//
// Rules (they are the feature):
//   · OUTPUT IS NOT MECHANISM — revenue / earnings / margin growth never
//     creates a persistent catalyst on its own.
//   · THEME IS CONTEXT — nothing here reads a sector or a theme.
//   · A TARGET IS NOT EVIDENCE — guidance and targets only supply the next
//     milestone and a stated horizon; they never raise confidence.
//   · UNKNOWN STAYS UNKNOWN — no duration is invented ("Duration: Unknown").
//   · ONE FIGURE, ONE ITEM — the same number in a concall, a presentation and
//     a filing is one piece of evidence with three sources.
//   · COMMISSIONED ≠ EARNING — the capex lifecycle is tracked stage by stage.
//   · A MANAGEMENT REMARK NEVER OUTWEIGHS A FILED FIGURE.
//   · NO PRICE, NO RECOMMENDATION — Special Focus allocates research time.
// ═══════════════════════════════════════════════════════════════════════════

import { scaledNumber } from '@/lib/thesis/evidence-ledger';

export type PersistKind = 'CAPACITY_RAMP' | 'ORDER_VISIBILITY' | 'CUSTOMER_RAMP' | 'GEOGRAPHY' | 'MIX_PRICING';
export type PersistState = 'IDENTIFIED' | 'VALIDATED' | 'RAMPING' | 'SCALING' | 'MATURE' | 'STALLING' | 'WEAKENING' | 'COMPLETED' | 'DISPROVED';
export type PersistConfidence = 'HIGH' | 'MEDIUM' | 'EARLY' | 'TEMPORARY_UNCERTAIN';
export type EvidenceClass = 'HARD' | 'REMARK' | 'FORWARD';

export const KIND_LABEL: Record<PersistKind, string> = {
  CAPACITY_RAMP: 'Capacity ramp',
  ORDER_VISIBILITY: 'Order book / multi-period demand',
  CUSTOMER_RAMP: 'Customer qualification → ramp',
  GEOGRAPHY: 'New geography / exports',
  MIX_PRICING: 'Pricing / mix',
};
export const CONFIDENCE_LABEL: Record<PersistConfidence, string> = {
  HIGH: 'High persistence evidence', MEDIUM: 'Medium persistence evidence',
  EARLY: 'Early / unproven', TEMPORARY_UNCERTAIN: 'Persistence uncertain',
};

export interface PersistItem {
  metric: string;                 // ledger metric / driver key / gainer category
  kind: PersistKind;
  cls: EvidenceClass;
  text: string;                   // what it says, human form
  before: string | null;
  after: string | null;
  numeric: number | null;         // scaled after-value
  numericBefore: number | null;
  period: string | null;
  date: string | null;            // source date (YYYY-MM-DD)
  sources: Array<{ name: string; url: string | null; date: string | null; quote: string | null }>;
  origin: 'ledger' | 'assessment' | 'gainer';
}

export interface BeforeAfterRow { variable: string; before: string; current: string; direction: '↑' | '↓' | '→' | '?'; source: string; date: string | null }

export interface PersistentCatalyst {
  id: string;                     // `${TICKER}:${KIND}` — stable across quarters and systems
  ticker: string;
  kind: PersistKind;
  label: string;
  mechanism: string;              // the causal chain, in words, from evidence only
  state: PersistState;
  confidence: PersistConfidence;
  runway: { ok: boolean; text: string };
  evidence: PersistItem[];        // hard first, then remarks
  forward: PersistItem[];         // targets / guidance — milestones only
  beforeAfter: BeforeAfterRow[];
  happened: string[];             // what has already happened
  notYet: string[];               // what has NOT happened yet
  nextMilestone: string | null;
  confirmWith: string;
  invalidateIf: string;
  duration: string;               // "Duration: Unknown" unless the company stated one
  firstEvidenceDate: string | null;
  latestEvidenceDate: string | null;
  freshness: 'CURRENT' | 'HISTORICAL';
  periods: string[];
  hardCount: number;
  distinctMetrics: number;
  temporarySignals: string[];
  origins: Array<'portfolio' | 'gainers'>;
  specialFocus: boolean;
  why: string[];                  // why it is (or is not) Special Focus — every line evidence-backed
}

// ── Metric → mechanism kind ────────────────────────────────────────────────
const KIND_OF: Record<string, PersistKind> = {
  capacity: 'CAPACITY_RAMP', capacity_addition: 'CAPACITY_RAMP', new_plant: 'CAPACITY_RAMP', commissioning: 'CAPACITY_RAMP',
  capex_status: 'CAPACITY_RAMP', capex_earning: 'CAPACITY_RAMP', utilisation: 'CAPACITY_RAMP', volume: 'CAPACITY_RAMP', capex: 'CAPACITY_RAMP',
  order_book: 'ORDER_VISIBILITY', order_intake: 'ORDER_VISIBILITY', book_to_bill: 'ORDER_VISIBILITY', revenue_visibility: 'ORDER_VISIBILITY',
  new_customer: 'CUSTOMER_RAMP', qualification: 'CUSTOMER_RAMP', approval: 'CUSTOMER_RAMP', customer_ramp: 'CUSTOMER_RAMP',
  exports: 'GEOGRAPHY', new_geography: 'GEOGRAPHY',
  product_mix: 'MIX_PRICING', margin_driver: 'MIX_PRICING', price: 'MIX_PRICING',
};
const TEMPORARY = /inventory (gain|benefit|valuation)|one[- ]off|one[- ]time|exceptional|base effect|raw material (price )?(fall|decline|softening|moderation)|commodity (price )?(fall|decline|softening)|moderation in [a-z]+ prices|forex gain|write[- ]?back|reversal/i;
const CAPACITY_UNIT = /\b(mtpa|ktpa|tpa|tpd|tpm|mtpd|tons?|tonnes?|mt\b|kl\b|kilo ?lit|klpd|kl\/?d|mw|gw|kw|units?|lines?|sq\.? ?ft|square feet|beds|boutiques|stores|looms|spindles|vessels|vlgcs?|reactors?|furnaces?|kg|litres?|pieces|pcs|sets|mva)\b/i;
const MONEY = /₹|\binr\b|\brs\.?\s?\d|\bcrores?\b|\bcr\b|\bmn\b|million|billion|\busd\b|\$/i;
const PCT = /(\d+(?:\.\d+)?)\s*%/;

const iso = (s: string | null | undefined): string | null => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);
const clip = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const pctOf = (s: string | null | undefined): number | null => { const m = PCT.exec(String(s || '')); return m ? Number(m[1]) : null; };
/** The capacity unit family of a value — two capacities compare only within one family. */
const unitKey = (s: string | null | undefined): string | null => {
  const m = CAPACITY_UNIT.exec(String(s || ''));
  if (!m) return MONEY.test(String(s || '')) ? 'money' : null;
  const u = m[0].toLowerCase().replace(/\s|\./g, '');
  if (/^(mtpa|ktpa|tpa|tpd|tpm|mtpd|tons?|tonnes?|mt|kg)$/.test(u)) return 'mass';
  if (/^(kl|kilolit|klpd|kl\/?d|litres?)/.test(u)) return 'volume';
  if (/^(mw|gw|kw|mva)$/.test(u)) return 'power';
  if (/sqft|squarefeet/.test(u)) return 'area';
  return u.replace(/s$/, '');
};

// ── 1. EVIDENCE ITEMS FROM THE LEDGER (all periods = the memory) ──────────
export function itemsFromLedger(ledger: any): PersistItem[] {
  const out: PersistItem[] = [];
  const periods: Record<string, any> = ledger?.periods || {};
  for (const [period, rec] of Object.entries(periods)) {
    for (const f of (rec?.facts || []) as any[]) {
      if (f?.record_status && f.record_status !== 'ACTIVE') continue;
      if (f?.evidence_quality === 'unit_mismatch') continue;
      let metric = String(f?.metric_name || '');
      const after = String(f?.after_value ?? f?.value ?? '').trim();
      const before = f?.before_value ? String(f.before_value).trim() : null;
      if (!after) continue;
      // "capacity 63.61%" is a utilisation reading, not a capacity.
      if ((metric === 'capacity' || metric === 'capacity_addition') && PCT.test(after) && !CAPACITY_UNIT.test(after)) metric = 'utilisation';
      const kind = KIND_OF[metric];
      if (!kind) continue;
      const stmt = String(f?.fact_or_management_statement || 'FACT');
      const hasFig = /\d/.test(after);
      // Plausibility per metric — a figure in the wrong unit is not evidence.
      if (metric === 'utilisation' && stmt === 'FACT' && !PCT.test(after)) continue;
      if ((metric === 'order_book' || metric === 'order_intake' || metric === 'revenue_visibility') && hasFig && !MONEY.test(after) && !/\d\s*x\b/i.test(after)) continue;
      if ((metric === 'capacity' || metric === 'capacity_addition') && hasFig && !CAPACITY_UNIT.test(`${after} ${f?.unit || ''}`) && !MONEY.test(after)) continue;
      if ((metric === 'capacity' || metric === 'capacity_addition') && /budget|allocation|industry|market size|country|india'?s/i.test(`${after} ${f?.source_quote || ''}`.slice(0, 300)) && !/\bour\b|\bwe\b|company/i.test(String(f?.source_quote || '').slice(0, 200))) continue;
      // A rupee figure filed as "capacity added" is a capex amount, not capacity.
      if ((metric === 'capacity_addition' || metric === 'capex_status') && MONEY.test(after) && !CAPACITY_UNIT.test(after)) metric = 'capex';
      // Ore reserves / resources are not capacity (HINDCOPPER "198.61 Million Tonne").
      if ((metric === 'capacity' || metric === 'capacity_addition') && /reserve|resource|\bore\b|mineable|deposit/i.test(`${after} ${String(f?.source_quote || '').slice(0, 300)}`)) continue;
      const cls: EvidenceClass = stmt === 'TARGET' || stmt === 'GUIDANCE' || f?.evidence_type === 'forward' ? 'FORWARD'
        // Capex SPENDING is the announced / spent stage — never a mechanism figure.
        : metric === 'capex' ? 'REMARK'
        : stmt === 'FACT' && hasFig ? 'HARD' : 'REMARK';
      out.push({
        metric, kind, cls,
        text: `${String(f?.metric_label || metric)}: ${before ? `${before} → ` : ''}${after}`,
        before, after, numeric: scaledNumber(after), numericBefore: before ? scaledNumber(before) : null,
        period, date: iso(f?.source_date) || iso(f?.effective_date),
        sources: [{ name: String(f?.source_name || 'filing'), url: f?.source_url || null, date: iso(f?.source_date), quote: f?.source_quote ? clip(String(f.source_quote), 260) : null }],
        origin: 'ledger',
      });
      // one-off facts are not items; they are read by temporarySignals()
    }
  }
  return out;
}

/** Temporary / non-structural signals in the ledger (inventory gain, one-offs). */
export function temporarySignalsFromLedger(ledger: any): string[] {
  const out: string[] = [];
  for (const rec of Object.values<any>(ledger?.periods || {})) {
    for (const f of (rec?.facts || []) as any[]) {
      const t = `${f?.after_value || f?.value || ''} ${f?.source_quote || ''}`;
      if ((f?.metric_name === 'one_offs' || f?.metric_name === 'margin_driver') && TEMPORARY.test(t)) out.push(clip(String(f?.after_value || f?.value || f?.source_quote), 120));
    }
    const summ = JSON.stringify(rec?.summary || '');
    const m = TEMPORARY.exec(summ);
    if (m) out.push(`summary mentions "${m[0]}"`);
  }
  return [...new Set(out)].slice(0, 4);
}

// ── 2. ITEMS FROM THE THESIS ASSESSMENT (current period, quality-filtered) ──
export function itemsFromAssessment(a: any, period: string | null, date: string | null): PersistItem[] {
  const out: PersistItem[] = [];
  for (const d of (a?.mechanismEvidence || []) as Array<{ key: string; text: string }>) {
    const kind = KIND_OF[d.key];
    // The ledger already carries capacity / order / volume figures with their
    // sources; the assessment adds what the ledger holds as prose.
    if (!kind || kind === 'ORDER_VISIBILITY') continue;
    if (kind === 'CAPACITY_RAMP' && !['volume', 'utilisation', 'capex_earning', 'commissioning', 'capex_status'].includes(d.key)) continue;
    const hasFig = /\d/.test(d.text) && (MONEY.test(d.text) || PCT.test(d.text) || CAPACITY_UNIT.test(d.text));
    out.push({ metric: d.key, kind, cls: hasFig ? 'HARD' : 'REMARK', text: d.text, before: null, after: d.text, numeric: null, numericBefore: null,
      period, date, sources: [{ name: 'documents read this period', url: null, date, quote: null }], origin: 'assessment' });
  }
  return out;
}

// ── 3. ITEMS FROM AN AI DAILY GAINERS FINDING (the move is only the trigger) ──
export function itemsFromFinding(f: any): PersistItem[] {
  if (!f || f.status !== 'catalyst') return [];
  const cat = String(f.category || '');
  const facts: Record<string, string> = f.facts || {};
  const said = (k: string) => (facts[k] && !/not stated/i.test(facts[k]) ? facts[k] : null);
  const date = iso(f.sourceDate);
  const src = [{ name: f.modelRead ? 'exchange filing (read)' : 'exchange filing (summary)', url: f.sourceUrl || null, date, quote: f.evidenceQuote ? clip(String(f.evidenceQuote), 260) : null }];
  const early = f.stage === 'enabling' || f.stage === 'scheduled';
  const out: PersistItem[] = [];
  const push = (metric: string, kind: PersistKind, text: string, hard: boolean, after: string | null = null) =>
    out.push({ metric, kind, cls: hard && !early ? 'HARD' : early ? 'FORWARD' : 'REMARK', text, before: null, after, numeric: scaledNumber(after), numericBefore: null, period: null, date, sources: src, origin: 'gainer' });
  const val = f.valueStated != null ? `₹${f.valueStated} Cr` : said('value');
  if (cat === 'order_win' || cat === 'backlog_increase') {
    push('order_intake', 'ORDER_VISIBILITY', `Order${said('counterparty') ? ` from ${said('counterparty')}` : ''}${val ? `: ${val}` : ''}${said('execution_period') ? ` · execution ${said('execution_period')}` : ''}`, !!val, val);
  } else if (cat === 'capacity_expansion' || cat === 'production_ramp' || cat === 'utilization_increase') {
    const cap = said('capacity');
    push(cap ? 'capacity_addition' : 'capex_status', 'CAPACITY_RAMP', `${f.stage === 'executed' ? 'Commissioned / operational' : 'Capacity plan'}: ${clip(String(f.headline || ''), 150)}`, !!(cap && /\d/.test(cap)) || f.valueStated != null, cap || val);
  } else if (cat === 'new_customer' || cat === 'customer_ramp' || cat === 'product_qualification' || cat === 'regulatory_approval' || cat === 'export_approval') {
    push(cat === 'product_qualification' || cat.endsWith('approval') ? 'qualification' : 'new_customer', 'CUSTOMER_RAMP', clip(String(f.headline || ''), 170), !!said('counterparty') && (!!val || /order|contract|supply/i.test(String(f.headline || ''))), val);
  } else if (cat === 'new_geography') {
    push('exports', 'GEOGRAPHY', clip(String(f.headline || ''), 170), !!val, val);
  }
  return out;
}

// ── 4. DEDUP — one figure, one item, many sources ──────────────────────────
function dedupe(items: PersistItem[]): PersistItem[] {
  const byKey = new Map<string, PersistItem>();
  const norm = (n: number | null) => (n == null ? null : Math.round(n / Math.pow(10, Math.max(0, Math.floor(Math.log10(Math.abs(n) || 1)) - 1))));
  for (const it of items) {
    const n = norm(it.numeric);
    const key = n != null ? `${it.metric}|${n}|${it.numericBefore != null ? norm(it.numericBefore) : ''}` : `${it.metric}|${it.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 60)}`;
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, { ...it, sources: [...it.sources] }); continue; }
    // Keep the strongest class, the earliest date, and every source.
    const rank = (c: EvidenceClass) => (c === 'HARD' ? 2 : c === 'REMARK' ? 1 : 0);
    if (rank(it.cls) > rank(prev.cls)) { prev.cls = it.cls; prev.text = it.text; }
    if (it.before && !prev.before) { prev.before = it.before; prev.numericBefore = it.numericBefore; prev.text = it.text; }
    for (const s of it.sources) if (!prev.sources.some((x) => x.name === s.name && x.date === s.date)) prev.sources.push(s);
    if (it.date && (!prev.date || it.date > prev.date)) prev.date = it.date;
  }
  return [...byKey.values()];
}

// ── 5. EVALUATE ONE MECHANISM ──────────────────────────────────────────────
interface Ctx { ticker: string; thesisStatus?: string | null; temporary: string[]; origins: Array<'portfolio' | 'gainers'>; today: string; quarterRevenueCr?: number | null }

function series(items: PersistItem[], metric: string): PersistItem[] {
  return items.filter((i) => i.metric === metric && i.cls === 'HARD' && i.numeric != null).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function evaluate(kind: PersistKind, all: PersistItem[], ctx: Ctx): PersistentCatalyst | null {
  const items = all.filter((i) => i.kind === kind);
  const hard = items.filter((i) => i.cls === 'HARD');
  // A MECHANISM figure: a filed number that shows the mechanism moving —
  // installed capacity that did not change, flat volume or a capex budget
  // are context, not evidence that anything is ramping.
  const volGrowth = (i: PersistItem) => /(grew|growth|\bup\b|increase|rose|higher|\+)/i.test(i.text) && !/flat|down|declin|lower|fell/i.test(i.text) && (pctOf(i.text) ?? 0) >= 5;
  const isMech = (i: PersistItem): boolean => {
    if (i.cls !== 'HARD') return false;
    if (i.metric === 'capacity') return i.numericBefore != null && i.numeric != null && i.numeric > i.numericBefore;
    if (i.metric === 'volume') return volGrowth(i) || (i.numericBefore != null && i.numeric != null && i.numeric > i.numericBefore * 1.05);
    if (i.metric === 'book_to_bill') return /\d\s*x\b/i.test(i.after || '');
    return true;
  };
  const mech = items.filter(isMech);
  const volFlat = items.some((i) => i.metric === 'volume' && i.cls === 'HARD' && /flat|down|declin|fell|lower/i.test(i.text));
  const remarks = items.filter((i) => i.cls === 'REMARK');
  const forward = items.filter((i) => i.cls === 'FORWARD');
  if (!hard.length && !remarks.length) return null;                 // targets alone are narrative
  const metrics = new Set(mech.map((i) => i.metric));
  const periods = [...new Set(items.map((i) => i.period).filter(Boolean) as string[])];
  const dates = [...new Set(mech.map((i) => i.date).filter(Boolean) as string[])].sort();
  const spanDays = dates.length > 1 ? (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 86_400_000 : 0;
  const multiPeriod = periods.length >= 2 || spanDays >= 60;
  const happened: string[] = [], notYet: string[] = [];
  const beforeAfter: BeforeAfterRow[] = [];
  const baRow = (variable: string, b: string, c: string, dir: BeforeAfterRow['direction'], it: PersistItem) =>
    beforeAfter.push({ variable, before: b, current: c, direction: dir, source: it.sources[0]?.name || 'filing', date: it.date });
  const dirOf = (a: number | null, b: number | null): BeforeAfterRow['direction'] => (a == null || b == null ? '?' : b > a * 1.01 ? '↑' : b < a * 0.99 ? '↓' : '→');
  // Rows from an item's own before → after, else from the same metric across dates.
  const rowFor = (metric: string, name: string) => {
    const withBA = items.find((i) => i.metric === metric && i.cls === 'HARD' && i.before && i.numeric != null);
    if (withBA) { baRow(name, withBA.before!, withBA.after!, dirOf(withBA.numericBefore, withBA.numeric), withBA); return; }
    const s = series(items, metric);
    if (s.length >= 2 && Math.abs((s[s.length - 1].numeric! - s[0].numeric!) / (s[0].numeric! || 1)) > 0.02) baRow(name, `${s[0].after} (${s[0].date || s[0].period})`, `${s[s.length - 1].after} (${s[s.length - 1].date || s[s.length - 1].period})`, dirOf(s[0].numeric, s[s.length - 1].numeric), s[s.length - 1]);
    else if (s.length) baRow(name, '— (first reading)', s[s.length - 1].after!, '?', s[s.length - 1]);
  };

  let state: PersistState = 'IDENTIFIED';
  let runway = { ok: false, text: 'No evidence-supported runway.' };
  let mechanism = '';
  let nextMilestone: string | null = null;
  let confirmWith = '', invalidateIf = '';
  const fwdText = (re: RegExp) => forward.find((i) => re.test(i.metric) || re.test(i.text));

  if (kind === 'CAPACITY_RAMP') {
    const util = series(items, 'utilisation');
    // "between 60% and 85%" — the upper bound, so runway is never overstated.
    const pctMax = (t: string | null | undefined) => { const all = Array.from(String(t || '').matchAll(/(\d+(?:\.\d+)?)\s*%/g)).map((m) => Number(m[1])); return all.length ? Math.max(...all) : null; };
    const utilNow = util.length ? pctMax(util[util.length - 1].after) : null;
    const utilThen = util.length >= 2 ? pctOf(util[0].after) : null;
    const add = items.find((i) => (i.metric === 'capacity' || i.metric === 'capacity_addition') && i.cls === 'HARD' && i.before && i.numeric != null && i.numericBefore != null && i.numeric > i.numericBefore);
    const addPct = add ? Math.round(((add.numeric! - add.numericBefore!) / add.numericBefore!) * 100) : null;
    const addOnly = items.find((i) => i.metric === 'capacity_addition' && i.cls === 'HARD');
    const capNow = series(items, 'capacity').pop();
    const addVsBase = !add && addOnly && capNow && addOnly.numeric != null && capNow.numeric && unitKey(addOnly.after) && unitKey(addOnly.after) === unitKey(capNow.after)
      ? Math.round((addOnly.numeric / capNow.numeric) * 100) : null;
    const lifecycleText = items.filter((i) => /capex_status|commissioning|new_plant|capex_earning/.test(i.metric)).map((i) => i.text).join(' ; ');
    const commissioned = /commission|commercial production|operational|started production|production (started|commenced)/i.test(lifecycleText) || (!!add && (utilNow != null || items.some((i) => i.metric === 'volume' && isMech(i))));
    const producing = /commercial production|production (started|commenced)|operational|running at/i.test(lifecycleText);
    const earning = items.some((i) => i.metric === 'capex_earning' && i.cls === 'HARD');
    const vol = series(items, 'volume');
    const volUp = items.some((i) => i.metric === 'volume' && isMech(i));
    mechanism = [add ? `capacity ${add.before} → ${add.after}` : addOnly ? `capacity added ${addOnly.after}` : capNow ? `installed capacity ${capNow.after}` : null,
      commissioned ? (producing ? 'production running' : 'commissioned') : null,
      utilNow != null ? `utilisation ${utilNow}%` : null, volUp ? 'volume rising' : null, earning ? 'revenue contribution disclosed' : null].filter(Boolean).join(' → ') || 'capacity evidence on file';
    // Lifecycle
    if (utilNow != null && utilThen != null && utilNow < utilThen - 3) state = 'STALLING';
    else if (utilNow != null && utilNow >= 90 && !add && (addVsBase == null || addVsBase < 15)) state = 'MATURE';
    else if (earning || (utilNow != null && utilThen != null && utilNow > utilThen + 3)) state = 'SCALING';
    else if (producing || volUp) state = 'RAMPING';
    else if (commissioned) state = 'VALIDATED';
    // Runway: unused capacity is the runway.
    if (add && (addPct ?? 0) >= 20 && (utilNow == null || utilNow < 85)) runway = { ok: true, text: `Capacity up ${addPct}% (${add.before} → ${add.after})${utilNow != null ? ` with utilisation at ${utilNow}%` : '; utilisation on the new base not yet disclosed'} — the added capacity can still contribute.` };
    else if (utilNow != null && utilNow < 80 && (volUp || addOnly)) runway = { ok: true, text: `Utilisation ${utilNow}% with volume growing — ${100 - utilNow} points of installed capacity still unused.` };
    else if (utilNow != null && utilNow < 80) runway = { ok: false, text: `Utilisation ${utilNow}%, but ${volFlat ? 'volume is flat' : 'no volume growth or capacity addition is evidenced'} — unused capacity without demand is not a catalyst.` };
    else if (addVsBase != null && addVsBase >= 15 && (utilNow == null || utilNow < 90)) runway = { ok: true, text: `Addition of ${addOnly!.after} ≈ ${addVsBase}% of installed capacity.` };
    else if (utilNow != null && utilNow >= 90) runway = { ok: false, text: `Utilisation ${utilNow}% — existing capacity is nearly full; the next leg needs new capacity${addOnly ? ` (addition on file: ${addOnly.after}${addVsBase != null ? `, ≈${addVsBase}% of the base` : ''})` : ''}.` };
    rowFor('capacity', 'Capacity'); rowFor('capacity_addition', 'Capacity added'); rowFor('utilisation', 'Utilisation'); rowFor('volume', 'Volume');
    (add || addOnly) ? happened.push(`Capacity added (${(add || addOnly)!.after})`) : notYet.push('Capacity addition quantified');
    commissioned ? happened.push(producing ? 'Commercial production running' : 'Commissioned') : notYet.push('Commissioning');
    utilNow != null ? happened.push(`Utilisation disclosed: ${utilNow}%`) : notYet.push('Utilisation on the new capacity disclosed');
    earning ? happened.push('Revenue contribution from the new capacity disclosed') : notYet.push('Revenue / EBITDA contribution from the new capacity disclosed');
    // A forward figure is a milestone only if it is ahead of where the company
    // already is (a 35% "target" under 65% actual utilisation is mislabelled).
    const f = forward.find((i) => /commission|phase|capacity|utili/i.test(`${i.metric} ${i.text}`)
      && !(i.metric === 'utilisation' && utilNow != null && (pctMax(i.after) ?? 101) <= utilNow)
      && !(i.metric === 'utilisation' && !PCT.test(i.after || '')));
    nextMilestone = f ? `${clip(f.text, 150)} (management ${/target/i.test(f.text) || f.metric === 'utilisation' ? 'target' : 'guidance'}, ${f.date || f.period || 'undated'} — not a result)`
      : !commissioned && (add || addOnly) ? 'Commissioning of the added capacity'
        : utilNow == null ? 'First disclosed utilisation figure for the new capacity'
          : utilNow < 90 ? `Next disclosed utilisation above ${utilNow}%` : 'A further capacity addition (current capacity nearly full)';
    confirmWith = 'utilisation rising on the new base, volume growth, and a disclosed revenue / EBITDA contribution';
    invalidateIf = 'utilisation falls, volume declines, or the new capacity stays idle / is delayed';
  } else if (kind === 'ORDER_VISIBILITY') {
    const ob = series(items, 'order_book').filter((i) => MONEY.test(i.after || ''));
    const btb = items.find((i) => i.metric === 'book_to_bill' && i.cls === 'HARD');
    const btbX = btb ? Number((/(\d+(?:\.\d+)?)\s*x/i.exec(btb.after || '') || [])[1]) : NaN;
    const sameMoney = (i: PersistItem) => MONEY.test(i.before || '') && MONEY.test(i.after || '');
    const obUp = items.find((i) => i.metric === 'order_book' && i.cls === 'HARD' && sameMoney(i) && i.numericBefore != null && i.numeric != null && i.numeric > i.numericBefore);
    const obDown = items.find((i) => i.metric === 'order_book' && i.cls === 'HARD' && sameMoney(i) && i.numericBefore != null && i.numeric != null && i.numeric < i.numericBefore * 0.97)
      || (ob.length >= 2 && ob[ob.length - 1].numeric! < ob[0].numeric! * 0.97 ? ob[ob.length - 1] : null);
    const obSeriesUp = ob.length >= 2 && ob[ob.length - 1].numeric! > ob[0].numeric! * 1.03;
    const intake = items.filter((i) => i.metric === 'order_intake' && i.cls === 'HARD');
    const multiYear = items.some((i) => /\b(\d+|two|three|four|five)[- ](year|yr)s?\b|multi[- ]year|over \d{2,} months|till (fy|20)\d{2}/i.test(i.text));
    const repeat = intake.length >= 2 || items.some((i) => /repeat|follow[- ]on|additional order/i.test(i.text));
    // Order book against FILED revenue (the latest quarter × 4) — visibility, not upside.
    const obLatest = ob.length ? ob[ob.length - 1] : null;
    const obCr = obLatest && obLatest.numeric != null && MONEY.test(obLatest.after || '') ? obLatest.numeric / 1e7 : null;
    const annualRev = ctx.quarterRevenueCr && ctx.quarterRevenueCr > 0 ? ctx.quarterRevenueCr * 4 : null;
    const coverage = obCr && annualRev ? Math.round((obCr / annualRev) * 10) / 10 : null;
    mechanism = [ob.length ? `order book ${ob[ob.length - 1].after}` : null, obUp ? `up from ${obUp.before}` : obSeriesUp ? `up from ${ob[0].after}` : null,
      coverage != null ? `≈${coverage}× annual revenue` : null, Number.isFinite(btbX) ? `book-to-bill ${btbX}x` : null, intake.length ? `order intake ${intake[intake.length - 1].after}` : null, multiYear ? 'multi-year execution' : null, repeat ? 'repeat orders' : null].filter(Boolean).join(' → ') || 'order evidence on file';
    if (obDown) state = 'WEAKENING';
    else if ((obUp || obSeriesUp) && (repeat || multiPeriod)) state = 'SCALING';
    else if (obUp || obSeriesUp || (Number.isFinite(btbX) && btbX >= 1.2) || (coverage != null && coverage >= 1.5)) state = 'VALIDATED';
    else if (ob.length && ob.length >= 2) state = 'MATURE';
    if ((Number.isFinite(btbX) && btbX >= 1.2) || obUp || obSeriesUp || multiYear || (coverage != null && coverage >= 1.5)) runway = { ok: true, text: [coverage != null && coverage >= 1.5 ? `order book ${obLatest!.after} ≈ ${coverage}× annual revenue (latest quarter × 4)` : null, Number.isFinite(btbX) ? `Book-to-bill ${btbX}x — orders arriving faster than revenue is billed` : null, obUp ? `order book ${obUp.before} → ${obUp.after}` : obSeriesUp ? `order book ${ob[0].after} → ${ob[ob.length - 1].after}` : null, multiYear ? 'execution spans more than one year' : null].filter(Boolean).join('; ') + '.' };
    else if (ob.length) runway = { ok: false, text: `Order book ${ob[ob.length - 1].after} on file, but no growth, book-to-bill or execution period that shows visibility beyond the current run-rate.` };
    rowFor('order_book', 'Order book'); rowFor('order_intake', 'Order intake'); rowFor('book_to_bill', 'Book-to-bill');
    ob.length ? happened.push(`Order book disclosed: ${ob[ob.length - 1].after}`) : notYet.push('Order book disclosed');
    (obUp || obSeriesUp) ? happened.push('Order book grew') : notYet.push('Order book growth shown over two readings');
    repeat ? happened.push('Repeat / continuing order intake') : notYet.push('Repeat orders');
    notYet.push('Conversion of the order book into revenue shown quarter by quarter');
    const f = fwdText(/order/i);
    nextMilestone = f ? `${clip(f.text, 150)} (management guidance, ${f.date || f.period || 'undated'} — not a result)` : ob.length ? `Next order book above ${ob[ob.length - 1].after}, with revenue growth showing conversion` : 'First disclosed order book figure';
    confirmWith = 'order book growing while revenue grows (conversion), book-to-bill ≥ 1, repeat orders';
    invalidateIf = 'order book declines, orders are cancelled or deferred, or execution slips';
  } else if (kind === 'CUSTOMER_RAMP') {
    const qual = items.some((i) => /qualif|approv|audit|certif|empanel|vendor/i.test(`${i.metric} ${i.text}`));
    const order = items.some((i) => /order|contract|supplies (started|commenced)|lta|long[- ]term agreement|onboarded/i.test(i.text) && i.cls !== 'FORWARD');
    const repeat = items.some((i) => /repeat|follow[- ]on|additional (order|product)|second (order|product)|expanded/i.test(i.text));
    const named = hard.length > 0;
    mechanism = [qual ? 'qualification / approval' : null, order ? 'commercial order or supplies' : null, repeat ? 'repeat / expansion' : null].filter(Boolean).join(' → ') || 'customer evidence on file';
    state = repeat ? 'RAMPING' : order ? 'VALIDATED' : 'IDENTIFIED';
    if (order && (repeat || named)) runway = { ok: true, text: `Customer chain has reached ${repeat ? 'repeat / expanded orders' : 'a commercial order'} — volume can build from here.` };
    qual ? happened.push('Qualification / approval') : notYet.push('Qualification');
    order ? happened.push('First commercial order / supplies') : notYet.push('First commercial order');
    repeat ? happened.push('Repeat or expanded orders') : notYet.push('Repeat order');
    nextMilestone = !order ? 'First commercial order from the qualified customer' : !repeat ? 'Repeat order or a second product / facility qualified' : 'Volume from the customer disclosed';
    confirmWith = 'a commercial order after the qualification, then a repeat order';
    invalidateIf = 'no order follows the qualification, or the customer is lost';
  } else if (kind === 'GEOGRAPHY') {
    const g = hard.find((i) => (pctOf(i.text) ?? 0) >= 20);
    mechanism = g ? g.text : items[0].text;
    state = g ? 'VALIDATED' : 'IDENTIFIED';
    if (g) runway = { ok: true, text: `${clip(g.text, 100)} — a new market still being penetrated.` };
    (g ? happened : notYet).push('Export / new-geography growth quantified');
    nextMilestone = 'Export share of revenue disclosed and rising';
    confirmWith = 'export share rising over two periods';
    invalidateIf = 'export growth reverses';
  } else {
    // MIX / PRICING — structural only when quantified and repeated.
    mechanism = items.map((i) => clip(i.text, 90)).slice(0, 2).join(' ; ');
    state = 'IDENTIFIED';
    runway = { ok: hard.length > 0 && multiPeriod, text: hard.length > 0 && multiPeriod ? 'Mix / pricing improvement quantified in more than one period.' : 'A single period of mix / pricing improvement — persistence not shown.' };
    notYet.push('The same mix / pricing gain shown again next period');
    nextMilestone = 'Value-added / premium share of revenue disclosed again next period';
    confirmWith = 'the mix share rising again, with margins holding when input costs change';
    invalidateIf = 'margin reverts when commodity or inventory effects unwind';
  }

  // ── Confidence — evidence only; output never counts. ─────────────────────
  const temporary = kind === 'MIX_PRICING' || kind === 'CAPACITY_RAMP' ? ctx.temporary : [];
  let confidence: PersistConfidence;
  const n = mech.length;
  if (kind === 'MIX_PRICING' && (temporary.length || !multiPeriod)) confidence = 'TEMPORARY_UNCERTAIN';
  else if (state === 'WEAKENING' || state === 'STALLING') confidence = n >= 2 ? 'MEDIUM' : 'EARLY';
  else if (n >= 3 && metrics.size >= 2 && runway.ok && (multiPeriod || metrics.size >= 3) && state !== 'IDENTIFIED') confidence = 'HIGH';
  else if (runway.ok && ((n >= 2 && (metrics.size >= 2 || multiPeriod)) || (n >= 1 && kind === 'ORDER_VISIBILITY' && /book-to-bill|→|annual revenue|execution spans/.test(runway.text)))) confidence = 'MEDIUM';
  else confidence = 'EARLY';
  if (temporary.length && confidence === 'HIGH') confidence = 'MEDIUM';                // inventory / one-off noise caps it

  const dated = items.map((i) => i.date).filter(Boolean).sort() as string[];
  const latest = dated[dated.length - 1] || null;
  const ageDays = latest ? (Date.parse(ctx.today) - Date.parse(latest)) / 86_400_000 : 999;
  const duration = (() => {
    const f = forward.find((i) => /\bby (fy|20)\d{2}|\b20[3-4]\d\b|over (the next )?\w+ years?|\d+ years?/i.test(i.text));
    if (!f) return 'Duration: Unknown';
    const m = /\bby (fy\s?\d{2,4}|20\d{2})|\b(20[3-4]\d)\b|over (the next )?\w+ years?|\d+[- ]years?/i.exec(f.text);
    return `Stated horizon: ${m ? m[0] : 'see source'} — management target, not a result (${f.sources[0]?.name || 'source'})`;
  })();

  const evidence = [...hard, ...remarks].sort((a, b) => (a.cls === b.cls ? String(b.date).localeCompare(String(a.date)) : a.cls === 'HARD' ? -1 : 1));
  const id = `${ctx.ticker.toUpperCase()}:${kind}`;
  const pc: PersistentCatalyst = {
    id, ticker: ctx.ticker.toUpperCase(), kind, label: KIND_LABEL[kind], mechanism, state, confidence, runway,
    evidence, forward, beforeAfter, happened, notYet, nextMilestone, confirmWith, invalidateIf, duration,
    firstEvidenceDate: dated[0] || null, latestEvidenceDate: latest, freshness: ageDays <= 200 ? 'CURRENT' : 'HISTORICAL',
    periods, hardCount: mech.length, distinctMetrics: metrics.size, temporarySignals: temporary,
    origins: [...new Set([...ctx.origins, ...(items.some((i) => i.origin === 'gainer') ? ['gainers' as const] : [])])],
    specialFocus: false, why: [],
  };
  const sf = specialFocusGate(pc, ctx.thesisStatus);
  pc.specialFocus = sf.ok; pc.why = sf.why;
  return pc;
}

// ── 6. SPECIAL FOCUS — a research allocation, never a recommendation ──────
export function specialFocusGate(pc: PersistentCatalyst, thesisStatus?: string | null): { ok: boolean; why: string[] } {
  const why: string[] = [];
  const no = (r: string) => ({ ok: false, why: [...why, `Not Special Focus: ${r}`] });
  why.push(`${CONFIDENCE_LABEL[pc.confidence]} — ${pc.hardCount} filed figure${pc.hardCount === 1 ? '' : 's'} across ${pc.distinctMetrics} independent metric${pc.distinctMetrics === 1 ? '' : 's'}${pc.periods.length > 1 ? `, ${pc.periods.length} periods` : ''}.`);
  if (thesisStatus === 'BROKEN') return no('the thesis is broken.');
  if (pc.hardCount < 1) return no('no hard (filed, quantified) evidence — remarks alone do not qualify.');
  if (pc.confidence === 'EARLY' || pc.confidence === 'TEMPORARY_UNCERTAIN') return no(`${CONFIDENCE_LABEL[pc.confidence].toLowerCase()}.`);
  if (pc.kind === 'MIX_PRICING' && pc.confidence !== 'HIGH') return no('mix / pricing needs repeated, quantified evidence.');
  if (!pc.runway.ok) return no(`no evidence-supported runway (${pc.runway.text})`);
  if (pc.state === 'DISPROVED' || pc.state === 'COMPLETED') return no(`catalyst ${pc.state.toLowerCase()}.`);
  if (pc.state === 'STALLING' || pc.state === 'WEAKENING') return no(`the mechanism is ${pc.state.toLowerCase()} (${pc.mechanism}).`);
  if (pc.state === 'IDENTIFIED') return no('identified but not yet validated — no commissioning, production, order growth or commercial order evidenced yet.');
  if (pc.freshness === 'HISTORICAL') return no('the evidence is historical — nothing current on file.');
  why.push(`Mechanism: ${pc.mechanism}.`);
  why.push(`Runway: ${pc.runway.text}`);
  if (pc.nextMilestone) why.push(`Next milestone: ${pc.nextMilestone}.`);
  return { ok: true, why };
}

// ── 7. PUBLIC ENTRY POINT ─────────────────────────────────────────────────
export interface DetectInput {
  ticker: string;
  ledger?: any | null;
  assessment?: any | null;       // ThesisAssessment
  finding?: any | null;          // AI Daily Gainers Finding
  /** Latest FILED quarterly revenue (₹ Cr) — scales an order book into
   *  years of revenue. Never price. */
  quarterRevenueCr?: number | null;
  origin: 'portfolio' | 'gainers';
  today?: string;
}

export function detectPersistentCatalysts(inp: DetectInput): PersistentCatalyst[] {
  const today = inp.today || new Date().toISOString().slice(0, 10);
  const latestPeriod = inp.ledger?.latest_period || null;
  const latestDate = iso(inp.ledger?.latest_document_date) || null;
  const items = dedupe([
    ...(inp.ledger ? itemsFromLedger(inp.ledger) : []),
    ...(inp.assessment ? itemsFromAssessment(inp.assessment, latestPeriod, latestDate) : []),
    ...(inp.finding ? itemsFromFinding(inp.finding) : []),
  ]);
  const temporary = [
    ...(inp.ledger ? temporarySignalsFromLedger(inp.ledger) : []),
    ...((inp.assessment?.mechanismEvidence || []) as Array<{ text: string }>).filter((d) => TEMPORARY.test(d.text)).map((d) => clip(d.text, 100)),
  ];
  const ctx: Ctx = { ticker: inp.ticker, quarterRevenueCr: inp.quarterRevenueCr ?? null, thesisStatus: inp.assessment?.status ?? null, temporary: [...new Set(temporary)], origins: [inp.origin, ...(inp.finding ? ['gainers' as const] : [])], today };
  const kinds: PersistKind[] = ['CAPACITY_RAMP', 'ORDER_VISIBILITY', 'CUSTOMER_RAMP', 'GEOGRAPHY', 'MIX_PRICING'];
  return kinds.map((k) => evaluate(k, items, ctx)).filter((x): x is PersistentCatalyst => !!x)
    .sort((a, b) => rankOf(b) - rankOf(a));
}

/** Research urgency / evidence richness — never return, never price. */
export function rankOf(pc: PersistentCatalyst): number {
  const c = { HIGH: 40, MEDIUM: 25, EARLY: 8, TEMPORARY_UNCERTAIN: 0 }[pc.confidence];
  const st = { SCALING: 12, RAMPING: 10, VALIDATED: 7, IDENTIFIED: 3, MATURE: 2, STALLING: 1, WEAKENING: 1, COMPLETED: 0, DISPROVED: 0 }[pc.state];
  return c + st + Math.min(pc.hardCount, 6) * 2 + pc.distinctMetrics * 2 + (pc.freshness === 'CURRENT' ? 5 : 0);
}

/** The strongest Special Focus catalyst for a company, if any. */
export function specialFocusOf(list: PersistentCatalyst[]): PersistentCatalyst | null {
  return list.find((p) => p.specialFocus) || null;
}

// ── 8. COMPACT SUMMARY — what a Daily Gainers finding carries ─────────────
export interface PersistSummary {
  id: string; kind: PersistKind; label: string; confidence: PersistConfidence; state: PersistState;
  specialFocus: boolean; mechanism: string; runway: string; nextMilestone: string | null;
  why: string[]; hardCount: number; ledgerBacked: boolean;
}
export function summarizePersistence(pc: PersistentCatalyst, ledgerBacked: boolean): PersistSummary {
  return { id: pc.id, kind: pc.kind, label: pc.label, confidence: pc.confidence, state: pc.state, specialFocus: pc.specialFocus,
    mechanism: pc.mechanism, runway: pc.runway.text, nextMilestone: pc.nextMilestone, why: pc.why.slice(0, 4), hardCount: pc.hardCount, ledgerBacked };
}
/** Categories where a Daily Gainers event can open a persistence test. */
export const PERSIST_CATEGORIES = new Set(['order_win', 'backlog_increase', 'capacity_expansion', 'production_ramp', 'utilization_increase',
  'new_customer', 'customer_ramp', 'product_qualification', 'regulatory_approval', 'export_approval', 'new_geography']);

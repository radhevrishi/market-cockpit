// ═══════════════════════════════════════════════════════════════════════════
// THE PROMISE LEDGER — WHAT THEY SAID, AND WHAT HAPPENED.           (zzz715)
//
// The owner's "promise vs reality" engine. Management says utilisation will
// go from 60% to 85% by FY27. Six months later nobody checks. The company
// says something new, the market listens to the new thing, and the old promise
// is never marked to market.
//
// So every forward statement this portal reads gets WRITTEN DOWN, with the
// date it was made and the filing it came from, and every subsequent quarter
// is checked against the promises still open.
//
// WHAT IS HONEST ABOUT THE FIRST RUN, and why it is said on screen: a ledger
// has nothing to compare against until it has two entries. The first time a
// holding is read, the only thing this module can do is RECORD the promise.
// It says exactly that rather than manufacturing a comparison, because an
// engine that produces a verdict on its first run has not checked anything —
// it has guessed, and the owner would have no way to tell the difference.
//
// STORED PER BROWSER. localStorage, same as the portfolio and the conviction
// bench, so the ledger lives where the book lives. The honest cost: it does
// not follow him to another machine, and it is stated in the UI rather than
// left to be discovered when a promise silently has no history.
// ═══════════════════════════════════════════════════════════════════════════

import type { CompanyLedger, EvidenceFact } from './evidence-ledger';
import { periodOrdinal } from './evidence-ledger';
import { judgeEventQuality, sourceTier, isDateOnly } from './evidence-extract';
import { VAR_LABEL, type VarKey } from './taxonomy';
import { normalizeEvent, guidanceMove, gapToTarget, rangeOf, periodEnd, type GuidanceMove } from './fact-normalize';
import { comparability, deltaText, lineageOf, normalizeValue, scopeOf, type Lineage, type FactScope } from './fact-model';

const KEY = 'mc.thesis.promises.v1';

export interface Promise_ {
  symbol: string;
  /** What was promised, in management's own terms. */
  metric: string;
  /** The stated target — a string, because filings say "85%", "₹1,500 Cr",
   *  "double digit". Never coerced to a number it did not state. */
  target: string;
  /** When management said it would happen. */
  by: string | null;
  /** When we recorded it, and from where. */
  recordedAt: string;
  sourceUrl: string | null;
  /** Closed out once a later quarter has been checked against it. */
  outcome?: { checkedAt: string; actual: string; verdict: 'met' | 'missed' | 'partial' | 'open' } | null;
}

type Store = Record<string, Promise_[]>;

function read(): Store {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    const o = raw ? JSON.parse(raw) : {};
    return o && typeof o === 'object' ? o as Store : {};
  } catch { return {}; }
}

function write(s: Store): void {
  try { window.localStorage.setItem(KEY, JSON.stringify(s)); }
  catch { /* the ledger is a record, never load-bearing for the page */ }
}

export function promisesFor(symbol: string): Promise_[] {
  return read()[symbol.toUpperCase()] || [];
}

/**
 * Record every forward statement in a summary that has a target attached.
 *
 * Deliberately narrow: only statements with BOTH a metric and a stated target
 * are recorded. "We are optimistic about demand" is not a promise anyone can
 * be held to, and filling the ledger with unfalsifiable sentences would make
 * it useless within two quarters.
 */
export function recordPromises(symbol: string, summary: any, sourceUrl: string | null): number {
  if (typeof window === 'undefined' || !summary) return 0;
  const sym = symbol.toUpperCase();
  const now = new Date().toISOString();
  const found: Promise_[] = [];

  const said = (v: unknown) => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s.length > 0 && !/^(not\s+\w+|n\/?a|none|unknown|—|-)$/i.test(s);
  };

  const ut = summary.utilisation || {};
  if (said(ut.expected)) {
    found.push({ symbol: sym, metric: 'Capacity utilisation', target: String(ut.expected),
      by: said(ut.expected_by) ? String(ut.expected_by) : null, recordedAt: now, sourceUrl, outcome: null });
  }
  const g = summary.guidance;
  if (g?.action && g.action !== 'none' && said(g.detail)) {
    found.push({ symbol: sym, metric: `Guidance (${g.action})`, target: String(g.detail),
      by: said(g.period) ? String(g.period) : null, recordedAt: now, sourceUrl, outcome: null });
  }
  for (const c of (Array.isArray(summary.capex_projects) ? summary.capex_projects : [])) {
    if (said(c?.completion_period)) {
      found.push({ symbol: sym, metric: `Capex commissioning — ${c?.name || 'programme'}`,
        target: said(c?.capacity_added) ? String(c.capacity_added) : 'commissioning',
        by: String(c.completion_period), recordedAt: now, sourceUrl, outcome: null });
    }
    if (said(c?.revenue_from)) {
      found.push({ symbol: sym, metric: `Revenue from capex — ${c?.name || 'programme'}`,
        target: 'revenue contribution begins', by: String(c.revenue_from),
        recordedAt: now, sourceUrl, outcome: null });
    }
  }
  if (!found.length) return 0;

  const store = read();
  const existing = store[sym] || [];
  // Same metric + same target = the same promise restated, not a new one. A
  // ledger that grows by one line every time the page is opened is a ledger
  // nobody reads.
  const seen = new Set(existing.map((p) => `${p.metric}|${p.target}|${p.by || ''}`));
  const fresh = found.filter((p) => !seen.has(`${p.metric}|${p.target}|${p.by || ''}`));
  if (!fresh.length) return 0;
  store[sym] = [...existing, ...fresh].slice(-40);
  write(store);
  return fresh.length;
}

export interface PromiseCheck {
  gap: boolean;
  detail: string;
  /** ── THE COMPARISON ITSELF, not a verdict about it.            (zzz727)
   *
   *  "Running behind plan" is only sayable when there is a plan and an actual
   *  to put beside it. These three fields are what the card prints, and
   *  assessThesis discards a gap that arrives without them — which stops the
   *  state from ever being reached on the strength of weak-looking growth. */
  plan?: string | null;
  actual?: string | null;
  variance?: string | null;
  direction?: 'behind' | 'ahead';
  open: Promise_[];
  /** True on the first read of a holding — nothing to compare against yet. */
  firstRun: boolean;
}

/**
 * Check the latest evidence against promises recorded EARLIER. Promises made
 * in the same reading are excluded: a statement cannot be evidence against
 * itself, and letting it be is how a system produces a confident verdict on
 * its first run.
 */
export function checkPromises(symbol: string, summary: any | null): PromiseCheck {
  const all = promisesFor(symbol);
  const cutoff = Date.now() - 60_000;       // anything recorded in this session's read
  const open = all.filter((p) => !p.outcome?.verdict || p.outcome.verdict === 'open')
    .filter((p) => Date.parse(p.recordedAt) < cutoff);

  if (!open.length) {
    return {
      gap: false, open: [], firstRun: true,
      detail: all.length
        ? 'Promises are on file but none is old enough to check against this quarter yet.'
        : 'No earlier promise on file for this holding — this reading records the first one. A promise can only be checked against a LATER quarter, so there is nothing to grade today.',
    };
  }

  const said = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
  const pctIn = (s: unknown): number | null => {
    const m = said(s) ? String(s).match(/-?\d+(?:\.\d+)?/) : null;
    const v = m ? Number(m[0]) : NaN;
    return Number.isFinite(v) ? v : null;
  };

  const utNow = pctIn(summary?.utilisation?.current);
  const misses: string[] = [];
  let plan: string | null = null, actual: string | null = null, variance: string | null = null;
  let direction: 'behind' | 'ahead' = 'behind';
  for (const p of open) {
    if (/utilisation/i.test(p.metric) && utNow != null) {
      const t = pctIn(p.target);
      // A 3pp tolerance both ways: filings round, and a ledger that fires on
      // rounding is a ledger that gets ignored. Symmetric because beating a
      // plan is as much a reason to re-underwrite as missing one.
      if (t == null) continue;
      if (utNow < t - 3 || utNow > t + 3) {
        direction = utNow < t ? 'behind' : 'ahead';
        plan = `${p.metric} ${p.target}${p.by ? ` by ${p.by}` : ''}`;
        actual = String(summary.utilisation.current);
        variance = `${utNow - t >= 0 ? '+' : ''}${(utNow - t).toFixed(0)}pp vs plan`;
        misses.push(`${p.metric}: stated ${p.target}${p.by ? ` by ${p.by}` : ''}, actual ${summary.utilisation.current}.`);
      }
    }
  }
  if (summary?.guidance?.action === 'lowered') {
    const prior = open.find((p) => /guidance/i.test(p.metric));
    if (prior) {
      direction = 'behind';
      plan = plan || `${prior.metric} ${prior.target}${prior.by ? ` by ${prior.by}` : ''}`;
      actual = actual || (said(summary.guidance.detail) ? String(summary.guidance.detail) : 'guidance lowered');
      variance = variance || 'guidance cut against the figure previously stated';
      misses.push(`${prior.metric}: previously ${prior.target}; this quarter guidance was lowered${said(summary.guidance.detail) ? ` — ${summary.guidance.detail}` : ''}.`);
    }
  }

  if (!misses.length) {
    return { gap: false, open, firstRun: false,
      detail: `${open.length} promise${open.length > 1 ? 's' : ''} on file, none of them materially missed or beaten by this quarter's evidence.` };
  }
  return {
    gap: true, open, firstRun: false, plan, actual, variance, direction,
    detail: `Measured against what management itself documented: ${misses.join(' ')}`,
  };
}

export function clearPromises(symbol?: string): void {
  if (typeof window === 'undefined') return;
  if (!symbol) { try { window.localStorage.removeItem(KEY); } catch { /* noop */ } return; }
  const s = read(); delete s[symbol.toUpperCase()]; write(s);
}

// ═══════════════════════════════════════════════════════════════════════════
// THE GUIDANCE HISTORY — DERIVED FROM THE EVIDENCE LEDGER.           (zzz770)
//
// The promise store above lives in one browser. The evidence ledger (persisted
// server-side, one PeriodRecord per quarter) already holds every forward
// statement ever read, so the history is DERIVED from it, never stored twice:
//
//   revenue growth  guidance 20% (Q2 FY26) → revised 25% (Q4 FY26) → actual 27%
//                   → +2pp vs revised
//   capex           ₹300 Cr → revised ₹350 Cr → spent ₹280 Cr → −20% vs revised
//   utilisation     target 80% by FY28 · actual 74% → −6pp (interim: FY28 not reached)
//
// Rules: a statement is grouped with another only when the comparability
// engine says they measure the same thing (metric, unit, scope); a revision is
// a MOVE (guidanceMove ≠ MAINTAINED), never a restatement; an actual is used
// only when it is in the same measure and dated at or after the original
// statement; the variance is pp for percentages, relative % otherwise, and
// always says what it is measured against. Nothing is invented: a missing
// actual is "no actual on file", not zero.
// ═══════════════════════════════════════════════════════════════════════════


export interface GuidanceStep {
  period: string;
  value: string;
  /** Against the previous step: RAISED / LOWERED / MAINTAINED / … ; null first. */
  move: GuidanceMove | null;
  source: Lineage;
}

export interface GuidanceLedgerEntry {
  metric: VarKey;
  label: string;
  guidance_type: 'MANAGEMENT_GUIDANCE' | 'MANAGEMENT_TARGET';
  /** Plant / project / segment the statement names, or null. */
  scope: string | null;
  /** The period the guidance is FOR ("FY28"), when the sentence says so. */
  target_period: string | null;
  original_value: string;
  original_period: string;
  revised_value: string | null;
  revised_period: string | null;
  revision: GuidanceMove | null;
  actual_value: string | null;
  actual_period: string | null;
  actual_source: Lineage | null;
  /** "+2pp", "−20%" — actual minus the guidance it is measured against. */
  variance: string | null;
  variance_basis: 'vs revised' | 'vs original' | null;
  /** Neutral, no judgement: where the actual sits against the guidance. */
  status: 'NO_ACTUAL' | 'INTERIM' | 'ABOVE' | 'IN_LINE' | 'BELOW' | 'NOT_COMPARABLE';
  /** The date the latest statement was published, when known. */
  date: string | null;
  source: Lineage;
  history: GuidanceStep[];
  /** One line: "Revenue growth guidance 20% (Q2 FY26) → revised 25% (Q4 FY26) → actual 27% (FY26) · +2pp vs revised". */
  line: string;
}

export type ActualOverride = { value: string; period: string | null; source?: string | null };

const BY_PERIOD = /\b(?:by|for|in|during|till|until|through|over)\s+(?:the\s+)?(?:end\s+of\s+)?((?:Q[1-4]\s?)?FY\s?'?\d{2,4}|CY\s?'?\d{2,4}|20\d{2})\b/i;
const fmtPeriod = (p: string) => p.replace(/\s+/g, ' ').replace(/FY\s?'?(\d{2,4})/i, (_, y) => `FY${String(y).slice(-2)}`).trim();

function forwardFacts(ledger: CompanyLedger): Array<{ f: EvidenceFact; period: string; type: 'GUIDANCE' | 'TARGET' }> {
  const out: Array<{ f: EvidenceFact; period: string; type: 'GUIDANCE' | 'TARGET' }> = [];
  for (const period of Object.keys(ledger.periods || {})) {
    for (const f of ledger.periods[period]?.facts || []) {
      if (!String(f.value || '').trim()) continue;
      let type: 'GUIDANCE' | 'TARGET' | null = f.fact_or_management_statement === 'GUIDANCE' || f.fact_or_management_statement === 'TARGET' ? f.fact_or_management_statement : null;
      if (!type && f.fact_or_management_statement === 'FACT') {
        const e = normalizeEvent({ variable: f.metric_name, value_type: 'ACTUAL', before: f.before_value, after: f.after_value ?? f.value, unit: f.unit, period: null,
          direction: f.direction, evidence_text: f.source_quote, source: f.source_name, confidence: f.confidence }, period);
        if (e.value_type === 'GUIDANCE') type = 'GUIDANCE';
      }
      // Only statements with a figure — one that fits the variable — can be
      // held to account ("50%" is not an installed capacity).
      if (!type || rangeOf(f.value) == null || isDateOnly(f.value)) continue;
      if (judgeEventQuality({ variable: f.metric_name, before: f.before_value, after: f.after_value ?? f.value, unit: f.unit, evidence_text: f.source_quote }) === 'unit_mismatch') continue;
      out.push({ f, period, type });
    }
  }
  return out.sort((a, b) => periodOrdinal(a.period) - periodOrdinal(b.period));
}

function actualFacts(ledger: CompanyLedger, key: VarKey): Array<{ f: EvidenceFact; period: string }> {
  const out: Array<{ f: EvidenceFact; period: string }> = [];
  for (const period of Object.keys(ledger.periods || {})) {
    for (const f of ledger.periods[period]?.facts || []) {
      if (f.metric_name !== key || f.fact_or_management_statement !== 'FACT' || !String(f.value || '').trim()) continue;
      const e = normalizeEvent({ variable: f.metric_name, value_type: 'ACTUAL', before: f.before_value, after: f.after_value ?? f.value, unit: f.unit, period: null,
        direction: f.direction, evidence_text: f.source_quote, source: f.source_name, confidence: f.confidence }, period);
      if (e.value_type !== 'ACTUAL' || e.historical_as_of) continue;
      if (judgeEventQuality({ variable: f.metric_name, before: f.before_value, after: f.after_value ?? f.value, unit: f.unit, evidence_text: f.source_quote }) !== 'sentence') continue;
      out.push({ f, period });
    }
  }
  return out.sort((a, b) => periodOrdinal(a.period) - periodOrdinal(b.period));
}

const scopeLabel = (s: FactScope): string | null => [...s.ids, ...s.segments].join(', ') || null;

/** Actual against the guidance it is measured against, in that guidance's terms. */
export function guidanceVariance(actual: string, reference: string): string | null {
  const a = rangeOf(actual), r = rangeOf(reference);
  if (!a || !r) return null;
  if (a.pct && r.pct) return gapToTarget(actual, reference);
  const na = normalizeValue(actual), nr = normalizeValue(reference);
  if (na.normalized_unit && nr.normalized_unit && na.normalized_unit === nr.normalized_unit) {
    const d = deltaText({ ...nr, normalized_value: nr.normalized_value }, na);
    return d.text === 'unchanged' ? '0%' : d.text;
  }
  return null;
}

/**
 * The guidance ledger for one company, derived from every period on file.
 * `actuals` lets the caller supply a figure the ledger does not hold as a
 * fact (the grader's revenue growth, say) — it is used only when it is in the
 * same measure as the guidance.
 */
export function deriveGuidanceLedger(ledger: CompanyLedger | null | undefined, actuals?: Partial<Record<VarKey, ActualOverride>> | null): GuidanceLedgerEntry[] {
  if (!ledger?.periods) return [];
  const docsOf = (p: string) => ledger.periods[p]?.documents;
  const groups: Array<{ key: VarKey; type: 'GUIDANCE' | 'TARGET'; items: Array<{ f: EvidenceFact; period: string }> }> = [];
  for (const x of forwardFacts(ledger)) {
    // Guidance and target for one measure are one promise line; the type
    // shown is the latest statement's.
    const g = groups.find((gr) => gr.key === x.f.metric_name && (() => {
      const last = gr.items[gr.items.length - 1];
      const c = comparability(
        { key: gr.key, value: String(last.f.value), unit: last.f.unit, quote: last.f.source_quote, period: null, fact_type: 'MANAGEMENT_GUIDANCE' },
        { key: gr.key, value: String(x.f.value), unit: x.f.unit, quote: x.f.source_quote, period: null, fact_type: 'MANAGEMENT_GUIDANCE' });
      return c.comparable;
    })());
    if (g) {
      // One statement per period: the same period twice is a duplicate.
      if (g.items.some((it) => it.period === x.period && String(it.f.value).trim().toLowerCase() === String(x.f.value).trim().toLowerCase())) continue;
      g.items.push(x);
      g.type = x.type;
    } else groups.push({ key: x.f.metric_name, type: x.type, items: [x] });
  }
  const out: GuidanceLedgerEntry[] = [];
  for (const g of groups) {
    const history: GuidanceStep[] = [];
    for (const it of g.items) {
      const prev = history[history.length - 1];
      // Two statements in ONE period are one statement read twice, never a
      // revision (GPPL "5 million" in a Q&A and "5.2 million MT" on a slide).
      // The written document is kept. (zzz770)
      if (prev && prev.period === it.period) {
        if (sourceTier(it.f.source_name) < sourceTier(prev.source.source_name)) {
          history[history.length - 1] = { ...prev, value: String(it.f.value), source: lineageOf({ ...it.f, period: it.period }, docsOf(it.period)) };
        }
        continue;
      }
      const move = prev ? guidanceMove(prev.value, String(it.f.value)) : null;
      history.push({ period: it.period, value: String(it.f.value), move, source: lineageOf({ ...it.f, period: it.period }, docsOf(it.period)) });
    }
    const first = history[0];
    const lastMove = [...history].reverse().find((h) => h.move && h.move !== 'MAINTAINED' && h.move !== 'NOT_COMPARABLE') || null;
    const revisedIdx = lastMove ? history.lastIndexOf(lastMove) : -1;
    const reference = revisedIdx > 0 ? history[revisedIdx] : first;
    const firstFact = g.items[0].f;
    const tp = BY_PERIOD.exec(String(firstFact.source_quote || '')) || BY_PERIOD.exec(String(firstFact.value || ''));
    const target_period = tp ? fmtPeriod(tp[1]) : null;
    // The actual: the caller's figure, else the latest ledger fact in the same
    // measure dated at or after the original statement.
    let actual: { value: string; period: string | null; source: Lineage | null } | null = null;
    const ov = actuals?.[g.key];
    const sameMeasure = (value: string, unit: string | null, quote: string | null) => comparability(
      { key: g.key, value: reference.value, unit: firstFact.unit, quote: firstFact.source_quote, period: null },
      { key: g.key, value, unit, quote, period: null }).comparable;
    if (ov && String(ov.value || '').trim() && sameMeasure(ov.value, null, null)) {
      actual = { value: ov.value, period: ov.period ?? null, source: ov.source ? { source_id: null, source_name: ov.source, source_url: null, source_type: null, publication_date: null, period: ov.period ?? null, page_section: null, quote: '' } : null };
    } else {
      // An actual read in the SAME period as the promise is not its outcome
      // (MOREPEN "600 KL planned" beside "314 kiloliters installed"). (zzz770)
      const acts = actualFacts(ledger, g.key).filter((a) => periodOrdinal(a.period) > periodOrdinal(first.period)
        && sameMeasure(String(a.f.value), a.f.unit, a.f.source_quote));
      const a = acts[acts.length - 1];
      if (a) actual = { value: String(a.f.value), period: a.period, source: lineageOf({ ...a.f, period: a.period }, docsOf(a.period)) };
    }
    const variance = actual ? guidanceVariance(actual.value, reference.value) : null;
    const vnum = variance ? parseFloat(variance.replace(/[^\d.+-]/g, '')) : NaN;
    const ae = actual?.period ? periodEnd(actual.period) : null, te = target_period ? periodEnd(target_period) : null;
    const interim = !!(ae && te && ae < te);
    const status: GuidanceLedgerEntry['status'] = !actual ? 'NO_ACTUAL'
      : variance == null ? 'NOT_COMPARABLE'
        : interim ? 'INTERIM'
          : Math.abs(vnum) < 1e-9 ? 'IN_LINE' : vnum > 0 ? 'ABOVE' : 'BELOW';
    const label = VAR_LABEL[g.key] || g.key;
    const latest = history[history.length - 1];
    const tag0 = g.type === 'TARGET' ? 'target' : 'guidance';
    const tag = new RegExp(`\\b${tag0}\\b`, 'i').test(label) ? '' : ` ${tag0}`;
    const line = `${label}${tag} ${first.value} (${first.period})`
      + (revisedIdx > 0 ? ` → revised ${history[revisedIdx].value} (${history[revisedIdx].period})` : '')
      + (target_period ? ` for ${target_period}` : '')
      + (actual ? ` → actual ${actual.value}${actual.period ? ` (${actual.period})` : ''}${variance ? ` · ${variance} ${revisedIdx > 0 ? 'vs revised' : 'vs original'}` : ' · not comparable'}${interim ? ` · interim — ${target_period} not reached` : ''}` : ' · no actual on file');
    out.push({
      metric: g.key, label,
      guidance_type: g.type === 'TARGET' ? 'MANAGEMENT_TARGET' : 'MANAGEMENT_GUIDANCE',
      scope: scopeLabel(scopeOf(firstFact.source_quote, firstFact.value)),
      target_period,
      original_value: first.value, original_period: first.period,
      revised_value: revisedIdx > 0 ? history[revisedIdx].value : null,
      revised_period: revisedIdx > 0 ? history[revisedIdx].period : null,
      revision: revisedIdx > 0 ? history[revisedIdx].move : null,
      actual_value: actual?.value ?? null, actual_period: actual?.period ?? null, actual_source: actual?.source ?? null,
      variance, variance_basis: variance ? (revisedIdx > 0 ? 'vs revised' : 'vs original') : null,
      status,
      date: latest.source.publication_date,
      source: latest.source,
      history,
      line,
    });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// ASSESS A US ROW WITH THE SHARED THESIS ENGINE.                     (zzz790)
//
// The same pipeline India's use-book runs per holding, in the same order —
// comparisons → extractVariables → capex chain → assessThesis → THESIS NOT
// SET guard — with three US differences, each a namespace, not a rule:
//   · the expected period comes from the US calendar (lib/us-thesis/calendar);
//   · the promise ledger is keyed "US:<ticker>" so a US and an India ticker
//     of the same spelling can never check each other's promises;
//   · thesis-type overrides come from the US store, passed in.
// Every status rule — silence is NOT DISCLOSED, level-only is not a trend,
// a target is not an achievement, a nearest fit is provisional — is the
// shared engine's, untouched. No price is an input: the row carries none.
// ═══════════════════════════════════════════════════════════════════════════

import { classifyOrNearest, classifyWithFiling, manualPattern, type AbfgResult, type AbfgPattern } from '@/lib/earnings/pattern-abfg';
import { extractVariables, rowChangeLines } from '@/lib/thesis/variables';
import { buildComparisons, historyDepth, type MetricComparison } from '@/lib/thesis/comparison';
import { businessProfileOf, type VarKey } from '@/lib/thesis/taxonomy';
import { assessThesis, type ThesisAssessment } from '@/lib/thesis/status';
import { buildCapexChain, type CapexChain } from '@/lib/thesis/capex-chain';
import { checkPromises } from '@/lib/thesis/guidance-ledger';
import {
  latestSummary, whatChanged, needsVariableSnapshots, withVariableSnapshots,
  type CompanyLedger, type FreshnessState, type ChangeLine, type CompanyEvidenceState,
} from '@/lib/thesis/evidence-ledger';
import { usExpectedPeriod, usFreshness } from './calendar';
import type { UsOrigin } from '@/lib/us-book/model';
import type { UsSecProfile } from './facts-row';
import { usNearestType, usTypeInputs, usNoTypeReason } from './us-type';
import { isolateUsLedger, sanitizeUsSummary } from './sanitize';
import { usdWords, niceDate, type UsRpo } from './xbrl';

/**
 * zzz793: a summary with the filed RPO as its order book, when the documents
 * read give none. The level and the year-on-year change are the filed XBRL
 * figures, dated; nothing is estimated. Null summary + no RPO → unchanged.
 */
export function withXbrlOrderBook(summary: any | null, rpo: UsRpo | null): any | null {
  if (!rpo) return summary;
  const has = summary?.order_book && (String(summary.order_book.closing_value || '').trim() || String(summary.order_book.growth || '').trim());
  if (has) return summary;
  const growth = rpo.pct != null && rpo.prev
    ? `${rpo.pct >= 0 ? '+' : ''}${rpo.pct}% year on year (${usdWords(rpo.prev.value)} at ${niceDate(rpo.prev.end)})` : '';
  return {
    ...(summary || {}),
    order_book: { ...(summary?.order_book || {}),
      closing_value: `${usdWords(rpo.cur.value)} (remaining performance obligations at ${niceDate(rpo.cur.end)}, SEC XBRL)`,
      growth },
  };
}

export interface UsRow {
  symbol: string;
  origin: UsOrigin;
  market: 'US';
  /** The listing venue from the book (NYSE / NASDAQ / AMEX …) — for export links only. */
  exchange?: string;
  /** The deterministic XBRL grader row (lib/us-thesis/adapter usGradedRow) — no price. */
  graded: any | null;
  /** Why there is no grader row, when there is none. */
  gradedWhy?: string | null;
  tier: string | null;
  pattern: AbfgResult | null;
  summary: any | null;
  sourceUrl: string | null;
  state: 'idle' | 'loading' | 'done' | 'error';
  error?: string;
  dataSource?: string | null;
  assessment: ThesisAssessment | null;
  comparisons?: Partial<Record<VarKey, MetricComparison>>;
  capex: CapexChain | null;
  promiseNote: string | null;
  documentsRead?: Array<{ label: string; kind: string; source: string; period: string | null; url: string }>;
  discoveryAttempts?: Array<{ source: string; outcome: string; detail: string; found: number }>;
  discoveryState?: string | null;
  documentOutcomes?: Array<{ label: string; kind: string; outcome: string; chars: number; pages: number; detail?: string; url?: string }>;
  ledger?: CompanyLedger | null;
  freshness?: { state: FreshnessState; detail: string; evidence_state?: CompanyEvidenceState; evidence_detail?: string } | null;
  reportingPeriod?: string | null;
  /** The company's own fiscal quarter for the latest period, when known. */
  fiscalLabel?: string | null;
  changed?: ChangeLine[];
  changedFrom?: string | null;
  persisted?: boolean | null;
  persistError?: string | null;
  readNote?: string | null;
  /** zzz793: what the company is and files, its fiscal calendar and (for a
   *  foreign filer) its latest half-year / annual SEC figures. */
  sec?: UsSecProfile | null;
  /** zzz793: where a bench name came from ("Conviction Beats (US)", "US bench"). */
  benchSource?: string | null;
}

export const usPromiseKey = (sym: string) => `US:${String(sym).toUpperCase()}`;

/**
 * zzz793: the automatic thesis type of a US row — India's exact test, then
 * India's nearest fit, then (only when the company's SEC profile is known)
 * the US nearest fit from its own SEC figures / business classification.
 * Every automatic type other than an exact fit is PROVISIONAL.
 */
export function autoPattern(graded: any | null, sec?: UsSecProfile | null): AbfgResult | null {
  const india = graded ? classifyOrNearest(graded) : null;
  if (india) return india;
  if (!sec && !graded?.sic) return null;
  return usNearestType(usTypeInputs(graded, sec || null));
}

/** THESIS NOT SET — the shared rule (India's use-book), verbatim in effect. */
export function withThesisSet(row: Pick<UsRow, 'pattern'> & Partial<Pick<UsRow, 'sec' | 'gradedWhy'>>, a: ThesisAssessment): ThesisAssessment {
  if (row.pattern) return a;
  const seen = a.status === 'BROKEN' || a.status === 'WEAKENING'
    ? ` ⚠ The figures show a deterioration worth a look: ${String(a.because).slice(0, 260)}`
    : '';
  // zzz793: a US holding is left untyped only when there is nothing to fit a
  // type from — and the card says what is missing, in plain words.
  const reason = row.sec !== undefined || row.gradedWhy ? ` Why no type could be fitted: ${usNoTypeReason(row.sec, row.gradedWhy)}` : '';
  const because = `THESIS NOT SET — no thesis type fits these figures and none is set, so no thesis variable can move a status: no intact, strengthening or weakening is implied.${reason} The evidence below is shown as read. Set why you hold it with the thesis picker (A operating inflection · B demand explosion · F profit jump · G silent quality); it is saved and applies from then on.${seen}`;
  return {
    ...a,
    actionLine: `THESIS NOT SET — ${because.replace(/^THESIS NOT SET — /, '')}`,
    status: 'THESIS_NOT_SET', action: 'THESIS NOT SET', because, catalystRank: null,
    verdict: a.verdict ? { ...a.verdict, direction: 'UNKNOWN', directionWhy: 'no thesis set — a direction is measured against a thesis' } : a.verdict,
  } as ThesisAssessment;
}

// ── CAPEX: A PROJECT STATUS NEEDS A NAMED PROJECT.                  (zzz793)
// A US filer reports "purchases of property and equipment" every quarter.
// That is routine spending, not a programme, and the shared chain read it as
// "NOT STARTED — not built". On the US page a build / earning status is kept
// only when a named project or facility is stated in a document; otherwise
// the capex state is UNKNOWN, said plainly.
const GENERIC_CAPEX = /^(?:capital expenditures?|capex|purchases? of property|property,? plant|pp&?e|maintenance|additions to property|capital spending|investments? in property)/i;
export function usCapexChain(chain: CapexChain | null, summary: any | null, graded: any | null): CapexChain | null {
  if (!chain) return chain;
  const named = (chain.lifecycleProjects || []).some((p: any) => p?.name && !GENERIC_CAPEX.test(String(p.name).trim()))
    || (chain.build?.projects || []).some((p) => p?.name && !GENERIC_CAPEX.test(String(p.name).trim()))
    || (chain.projects || []).some((p) => p?.name && !GENERIC_CAPEX.test(String(p.name).trim()));
  if (named) return chain;
  if (chain.state === 'none' && (!chain.earning || chain.earning.state === 'UNKNOWN')) return chain;
  const stated = typeof summary?.capital?.capex === 'string' && summary.capital.capex.trim() ? summary.capital.capex.trim().slice(0, 120) : null;
  const xbrl = typeof graded?.capex_curr_musd === 'number' ? `$${graded.capex_curr_musd.toLocaleString('en-US', { maximumFractionDigits: 1 })}M this quarter (SEC XBRL)` : null;
  const spend = stated || xbrl;
  const line = `Unknown — the filings report routine capital spending only${spend ? ` (${spend})` : ''}; no named project or facility is stated, so nothing can be tracked as built or earning.`;
  return {
    ...chain, state: 'unverifiable', stage: null, build: null, lifecycle: [], lifecycleProjects: [], projects: [],
    because: `Only routine capital spending is reported${spend ? ` (${spend})` : ''}. No named project or facility is stated in the documents read, so project status is UNKNOWN (routine spending says nothing about whether a project is built or earning).`,
    nextCheck: 'A named project or facility (its capacity, cost or start date) in a 10-Q, 10-K or earnings release.',
    earning: {
      ...chain.earning, state: 'UNKNOWN', label: 'UNKNOWN', spent: spend, revenueContribution: null, utilisation: null,
      marginContribution: 'unknown', marginText: null, roceText: null, operational: null,
      economic: 'unknown — routine capital spending only, no named project', lines: [line], source: chain.earning?.source ?? null,
    },
  };
}

export function assessUsRow(row0: UsRow, overrides: Record<string, AbfgPattern | null | undefined> = {}, now: Date | string = new Date()): UsRow {
  const ov = overrides[String(row0.symbol || '').toUpperCase()];
  // zzz793: one company's evidence only, and only real figures (lib/us-thesis/sanitize).
  const cleanLedger = row0.ledger ? isolateUsLedger(row0.ledger, row0.symbol) : row0.ledger;
  const cleanSummary = row0.summary ? sanitizeUsSummary(row0.summary).summary : row0.summary;
  const row1: UsRow = { ...row0, ledger: cleanLedger ?? null, summary: cleanSummary };
  const row: UsRow = ov ? { ...row1, pattern: manualPattern(ov) } : row1;
  const comparisons = buildComparisons(row.ledger || null);
  const hist = historyDepth(row.ledger || null);
  const period = row.reportingPeriod || row.ledger?.latest_period || null;
  // zzz793: the FILED order backlog (XBRL RPO) is the order-book variable for
  // every company that tags it, read or not — no model needed. A figure the
  // documents read already state wins.
  const vars = extractVariables(row.graded, withXbrlOrderBook(row.summary, (row.graded?.rpo || row.sec?.rpo || null) as UsRpo | null), comparisons, {
    period, documents: (period && row.ledger?.periods?.[period]?.documents) || null, ledger: row.ledger || null,
  });
  const check = row.summary ? checkPromises(usPromiseKey(row.symbol), row.summary) : null;
  const prevStatus = (() => {
    const l = row.ledger;
    if (!l || hist.periods.length < 2) return null;
    for (let i = hist.periods.length - 2; i >= 0; i--) {
      const p = l.periods[hist.periods[i]];
      if (p?.status) return { status: p.status, period: hist.periods[i] };
    }
    return null;
  })();
  const capex = usCapexChain(buildCapexChain(row.summary, vars, row.ledger || null), row.summary, row.graded);
  const assessment = withThesisSet(row, assessThesis({
    capexState: capex ? { build: capex.build || null, economic: capex.earning?.economic ?? null, earningState: capex.earning?.state ?? null } : null,
    pattern: row.pattern?.pattern ?? null,
    patternFit: (row.pattern as any)?.fit ?? null,
    variables: vars,
    comparisons,
    historyDepth: hist.depth,
    previousStatus: prevStatus,
    promiseGap: check ? { gap: check.gap, detail: check.detail, direction: check.direction || 'behind', plan: check.plan ?? null, actual: check.actual ?? null, variance: check.variance ?? null } : null,
    evidenceReviewed: !!row.summary,
    sourceUnavailable: row.ledger?.last_attempt?.outcome === 'SOURCE_UNAVAILABLE',
    retrievalFailed: row.discoveryState === 'RETRIEVAL_FAILED' || row.ledger?.last_attempt?.outcome === 'FAILED',
    business: businessProfileOf(row.graded, row.summary),
    hasGraderRow: !!row.graded,
    evidencePeriod: row.ledger?.latest_period || row.reportingPeriod || null,
    expectedPeriod: usExpectedPeriod(now).period,
    // zzz793: US filers report no ROCE. It is on the card only when it could
    // be computed cleanly from the annual SEC figures; otherwise it is left
    // off the ledger instead of listed as NOT DISCLOSED.
    omitVariables: row.graded?.roce_pct == null ? ['roce'] : null,
  }));
  return {
    ...row, comparisons, assessment, capex,
    promiseNote: check ? check.detail : null,
    changed: row.ledger ? rowChangeLines(vars, row.reportingPeriod || row.ledger.latest_period || null) : row.changed,
  };
}

/** Fold a stored US ledger into a row — the path a reload takes. */
export function applyUsLedger(row: UsRow, ledger00: CompanyLedger | null, overrides: Record<string, AbfgPattern | null | undefined> = {}, freshness?: UsRow['freshness'] | null): UsRow {
  // zzz793: a ledger that belongs to another company is never applied.
  const ledger0 = ledger00 ? isolateUsLedger(ledger00, row.symbol) : null;
  const ledger = ledger0 && needsVariableSnapshots(ledger0) ? withVariableSnapshots(ledger0) : ledger0;
  const fr = freshness || usFreshness(ledger);
  const stored = latestSummary(ledger);
  if (!stored) return assessUsRow({ ...row, ledger, freshness: fr, reportingPeriod: null, changed: [], changedFrom: null }, overrides);
  const p = stored.period;
  const ch = whatChanged(ledger!);
  const readDocs = p.documents.filter((d) => d.outcome === 'read');
  const summary = Array.isArray(p.events) && p.events.length ? { ...stored.summary, events: p.events } : stored.summary;
  return assessUsRow({
    ...row, summary, state: 'done', error: undefined,
    sourceUrl: readDocs[0]?.url || row.sourceUrl,
    documentsRead: readDocs.map((d) => ({ label: d.label, kind: d.kind, source: d.source, period: d.period, url: d.url })),
    discoveryAttempts: p.discovery_attempts || undefined,
    discoveryState: p.discovery_state || null,
    documentOutcomes: p.documents.filter((d) => d.outcome !== 'not_selected').map((d) => ({ label: d.label, kind: d.kind, outcome: d.outcome, chars: d.chars || 0, pages: d.pages || 0, detail: d.detail, url: d.url })),
    pattern: classifyWithFiling(row.graded, summary) || row.pattern || autoPattern(row.graded, row.sec),
    ledger, freshness: fr, reportingPeriod: p.reporting_period,
    fiscalLabel: stored.summary?.us_fiscal?.label || row.fiscalLabel || null,
    changed: ch.lines, changedFrom: ch.from,
    persisted: true, persistError: null,
  }, overrides);
}

/** A fresh row for a US-listed name (before any ledger or grader row). */
export function newUsRow(symbol: string, origin: UsOrigin, graded: any | null, gradedWhy?: string | null, exchange?: string, sec?: UsSecProfile | null): UsRow {
  return assessUsRow({
    symbol, origin, market: 'US', exchange: exchange || '', graded, gradedWhy: gradedWhy || null,
    ...(sec !== undefined ? { sec } : {}),
    tier: null, pattern: autoPattern(graded, sec),
    summary: null, sourceUrl: graded?.source_url || null, state: 'idle',
    dataSource: graded ? 'sec-xbrl' : null, assessment: null, capex: null, promiseNote: null,
  });
}

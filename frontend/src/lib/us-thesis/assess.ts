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
}

export const usPromiseKey = (sym: string) => `US:${String(sym).toUpperCase()}`;

/** THESIS NOT SET — the shared rule (India's use-book), verbatim in effect. */
export function withThesisSet(row: Pick<UsRow, 'pattern'>, a: ThesisAssessment): ThesisAssessment {
  if (row.pattern) return a;
  const seen = a.status === 'BROKEN' || a.status === 'WEAKENING'
    ? ` ⚠ The figures show a deterioration worth a look: ${String(a.because).slice(0, 260)}`
    : '';
  const because = `THESIS NOT SET — no thesis type fits these figures and none is set, so no thesis variable can move a status: no intact, strengthening or weakening is implied. The evidence below is shown as read. Set why you hold it with the thesis picker (A operating inflection · B demand explosion · F profit jump · G silent quality); it is saved and applies from then on.${seen}`;
  return {
    ...a,
    actionLine: `THESIS NOT SET — ${because.replace(/^THESIS NOT SET — /, '')}`,
    status: 'THESIS_NOT_SET', action: 'THESIS NOT SET', because, catalystRank: null,
    verdict: a.verdict ? { ...a.verdict, direction: 'UNKNOWN', directionWhy: 'no thesis set — a direction is measured against a thesis' } : a.verdict,
  } as ThesisAssessment;
}

export function assessUsRow(row0: UsRow, overrides: Record<string, AbfgPattern | null | undefined> = {}, now: Date | string = new Date()): UsRow {
  const ov = overrides[String(row0.symbol || '').toUpperCase()];
  const row: UsRow = ov ? { ...row0, pattern: manualPattern(ov) } : row0;
  const comparisons = buildComparisons(row.ledger || null);
  const hist = historyDepth(row.ledger || null);
  const period = row.reportingPeriod || row.ledger?.latest_period || null;
  const vars = extractVariables(row.graded, row.summary, comparisons, {
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
  const capex = buildCapexChain(row.summary, vars, row.ledger || null);
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
  }));
  return {
    ...row, comparisons, assessment, capex,
    promiseNote: check ? check.detail : null,
    changed: row.ledger ? rowChangeLines(vars, row.reportingPeriod || row.ledger.latest_period || null) : row.changed,
  };
}

/** Fold a stored US ledger into a row — the path a reload takes. */
export function applyUsLedger(row: UsRow, ledger0: CompanyLedger | null, overrides: Record<string, AbfgPattern | null | undefined> = {}, freshness?: UsRow['freshness'] | null): UsRow {
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
    pattern: classifyWithFiling(row.graded, summary) || row.pattern || classifyOrNearest(row.graded),
    ledger, freshness: fr, reportingPeriod: p.reporting_period,
    fiscalLabel: stored.summary?.us_fiscal?.label || row.fiscalLabel || null,
    changed: ch.lines, changedFrom: ch.from,
    persisted: true, persistError: null,
  }, overrides);
}

/** A fresh row for a US-listed name (before any ledger or grader row). */
export function newUsRow(symbol: string, origin: UsOrigin, graded: any | null, gradedWhy?: string | null, exchange?: string): UsRow {
  return assessUsRow({
    symbol, origin, market: 'US', exchange: exchange || '', graded, gradedWhy: gradedWhy || null,
    tier: null, pattern: graded ? classifyOrNearest(graded) : null,
    summary: null, sourceUrl: graded?.source_url || null, state: 'idle',
    dataSource: graded ? 'sec-xbrl' : null, assessment: null, capex: null, promiseNote: null,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// PRIOR-QUARTER BACKFILL — THE PREVIOUS VALUE WAS ALREADY ON FILE.  (zzz765)
//
// buildComparisons walks every period in a ledger to turn a level into a
// direction ("72% → 80% · +8pp"). In live data every company had exactly ONE
// period, so every comparison printed PREVIOUS: NOT DISCLOSED — and yet the
// previous quarter's transcript and presentation were sitting in that one
// period's `documents` list, discovered, dated, and marked `not_selected`.
//
// This module is the pure half of reading them: which period is the one
// before, which of the documents already listed belong to it, and which
// companies are worth a click. It never fetches and never calls a model; the
// India reader does that when asked with `?period=<prior>`, and only on click.
//
// PERIOD DERIVATION IS NOT RE-INVENTED HERE. A document belongs to the prior
// quarter exactly when `reportingPeriodFromDate(its date)` says so — the same
// rule `reportingPeriodForDocuments` uses when the period record is persisted,
// so the documents picked here cannot land in any other period.
// ═══════════════════════════════════════════════════════════════════════════

import { reportingPeriodFromDate, periodOrdinal, type CompanyLedger, type LedgerDocument } from './evidence-ledger';

/** The kinds worth a model call for a prior quarter, best first: the concall
 *  carries the cause and the figures management was asked about, the
 *  presentation the capacity / utilisation / order-book slides, the results
 *  filing the numbers. Announcements and annual reports are not read here. */
export const PRIOR_KINDS = ['transcript', 'investor_presentation', 'results'] as const;
const KIND_ORDER: Record<string, number> = { transcript: 0, investor_presentation: 1, results: 2 };

/** "Q1 FY27" → "Q4 FY26"; "Q3 FY27" → "Q2 FY27". Null for anything else. */
export function previousPeriod(period: string | null | undefined): string | null {
  const m = /^Q([1-4])\s+FY(\d{2})$/.exec(String(period || '').trim());
  if (!m) return null;
  const q = parseInt(m[1], 10), fy = parseInt(m[2], 10);
  if (q > 1) return `Q${q - 1} FY${String(fy).padStart(2, '0')}`;
  return fy > 0 ? `Q4 FY${String(fy - 1).padStart(2, '0')}` : null;
}

/** Is this string a reporting period the reader can target? */
export function isReportingPeriod(p: string | null | undefined): boolean {
  return /^Q[1-4]\s+FY\d{2}$/.test(String(p || '').trim());
}

/**
 * Pure: the documents that report on `target`, best first — transcript, then
 * presentation, then results, newest first within a kind — deduplicated by
 * url. Works on ledger documents (`date_iso`) and discovery candidates
 * (`dateIso`) alike.
 */
export function selectPriorPeriodDocuments<T extends { kind: string; url: string; date_iso?: string | null; dateIso?: string | null }>(docs: T[], target: string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const d of docs) {
    if (!(d.kind in KIND_ORDER)) continue;
    const date = d.date_iso ?? d.dateIso ?? null;
    if (reportingPeriodFromDate(date)?.period !== target) continue;
    const key = String(d.url || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out.sort((a, b) => {
    const k = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (k) return k;
    return String(b.date_iso ?? b.dateIso ?? '').localeCompare(String(a.date_iso ?? a.dateIso ?? ''));
  });
}

/** Every document any period of the ledger has listed, one per id. */
export function ledgerDocuments(ledger: CompanyLedger | null | undefined): LedgerDocument[] {
  const byId = new Map<string, LedgerDocument>();
  for (const p of Object.values(ledger?.periods || {})) {
    for (const d of p?.documents || []) if (d && d.id && !byId.has(d.id)) byId.set(d.id, d);
  }
  return Array.from(byId.values());
}

export interface PriorPlan {
  ticker: string;
  /** The period that will be read — immediately before the latest on file. */
  target: string;
  latest: string;
  candidates: LedgerDocument[];
}

/**
 * Pure: does this company need its prior quarter read, and from what?
 *
 * Null — and NOT counted in the button's N — when:
 *   · there is no latest period to go back from;
 *   · the immediately preceding period is already in the ledger;
 *   · no document on file reports on that quarter (a click would be a model
 *     call against nothing);
 *   · an earlier backfill already established that the prior quarter has no
 *     readable document (NO_DISCLOSURE for that period). A SOURCE_UNAVAILABLE
 *     attempt stays eligible: that was our outage, not the company's silence.
 */
export function priorBackfillPlan(ledger: CompanyLedger | null | undefined): PriorPlan | null {
  if (!ledger || !ledger.latest_period) return null;
  const target = previousPeriod(ledger.latest_period);
  if (!target) return null;
  if (ledger.periods?.[target]) return null;
  if ((ledger.runs || []).some((r) => r.reporting_period === target && r.outcome === 'NO_DISCLOSURE')) return null;
  const candidates = selectPriorPeriodDocuments(ledgerDocuments(ledger), target);
  if (!candidates.length) return null;
  return { ticker: ledger.ticker, target, latest: ledger.latest_period, candidates };
}

/** Pure: the tickers the button would read, from the ledgers in hand. */
export function priorBackfillTickers(ledgers: Record<string, CompanyLedger | null | undefined>): string[] {
  return Object.entries(ledgers).filter(([, l]) => !!priorBackfillPlan(l)).map(([t]) => t);
}

/** Guard for the reader: a prior-period read may only target a period OLDER
 *  than the newest on file, so it can never merge into the current one. */
export function isOlderPeriod(target: string, latest: string | null | undefined): boolean {
  if (!latest) return true;
  return periodOrdinal(target) > 0 && periodOrdinal(target) < periodOrdinal(latest);
}

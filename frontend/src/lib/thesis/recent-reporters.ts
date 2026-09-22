// ═══════════════════════════════════════════════════════════════════════════
// RECENT REPORTERS — who in the book filed results in the last N days, and
// which of those still need their evidence re-read.                  (zzz763)
//
// The owner's rule, verbatim in spirit: "re-update only companies which
// reported earnings in the last 10 days; if a company already got updated in
// the last 10 days it should not be re-updated; only when I click."
//
// Two facts decide it, and they come from two different places:
//
//   REPORTED   — the exchange feed. A results filing (financial results,
//                outcome of board meeting, investor presentation, press
//                release) dated inside the window. A scheduled board meeting
//                is not a filing (CLAUDE.md §6.2) and never counts.
//   UPDATED    — the company's own evidence ledger. The latest document on
//                file, or the last successful read, dated ON OR AFTER the
//                filing. Read before the results is not "updated": it read
//                the previous quarter.
//
// So the plan is DUE = reported ∧ ¬updated-since-filing. "Updated in the last
// 10 days" is implied by that — a read since the filing is by construction
// inside the window — and the stricter test also catches the case the loose
// one misses: a read on day 1, results on day 5, click on day 9.
//
// Everything here is pure. The route fetches the feed; the hook applies the
// plan to the rows it already holds; nothing is decided twice.
// ═══════════════════════════════════════════════════════════════════════════

import type { CompanyLedger } from './evidence-ledger';

export interface FeedFiling {
  symbol: string;
  subject: string;
  filing_date: string;      // ISO date or datetime
  attachment_url?: string;
}

/** Subjects that carry the numbers. Kept in step with the India reader. */
const RESULTS_SUBJECT = [
  /financial\s+results/i,
  /outcome\s+of\s+(the\s+)?board\s+meeting/i,
  /investor\s+(presentation|update)/i,
  /press\s+release/i,
  /earnings\s+(update|presentation)/i,
];
/** Subjects that are never the result, however close their date. A board
 *  meeting INTIMATION is the one that matters most here: it is dated before
 *  the results and would otherwise mark the company as having reported. */
const NOT_RESULTS = /(intimation|newspaper|trading window|compliance certificate|voting result|scrutini[sz]er|annual report|postal ballot|\bagm\b|\begm\b|analyst meet|investor meet|schedule of|certificate under regulation|share transfer|loss of share|duplicate share|credit rating|record date|dividend distribution|related party|corporate governance report|shareholding pattern|reconciliation of share capital|prior intimation|advance intimation)/i;

export function isResultsFiling(subject: string | null | undefined): boolean {
  const s = String(subject || '');
  if (!s || NOT_RESULTS.test(s)) return false;
  return RESULTS_SUBJECT.some((re) => re.test(s));
}

export interface ReportedFact {
  ticker: string;
  reported_at: string;      // YYYY-MM-DD of the newest results filing in the window
  subject: string;
  filings: number;          // how many results-shaped filings in the window
}

const day = (s: string | null | undefined): string | null => {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(s || '').trim());
  return m ? m[1] : null;
};

export function windowStart(days: number, now: Date = new Date()): string {
  const d = new Date(now.getTime() - Math.max(1, days) * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Pure: the newest results filing per ticker inside [from, now]. */
export function reportedInWindow(items: FeedFiling[], tickers: string[], from: string): ReportedFact[] {
  const want = new Set(tickers.map((t) => t.toUpperCase().trim()));
  const best = new Map<string, ReportedFact>();
  for (const f of items) {
    const sym = String(f?.symbol || '').toUpperCase().trim();
    if (!want.has(sym)) continue;
    const d = day(f?.filing_date);
    if (!d || d < from) continue;
    if (!isResultsFiling(f?.subject)) continue;
    const cur = best.get(sym);
    if (!cur) best.set(sym, { ticker: sym, reported_at: d, subject: String(f.subject), filings: 1 });
    else {
      cur.filings += 1;
      if (d > cur.reported_at) { cur.reported_at = d; cur.subject = String(f.subject); }
    }
  }
  return Array.from(best.values()).sort((a, b) => b.reported_at.localeCompare(a.reported_at) || a.ticker.localeCompare(b.ticker));
}

export type RecentAction = 'due' | 'current' | 'reading';

export interface RecentPlanItem extends ReportedFact {
  action: RecentAction;
  /** Why it is current — which ledger fact beat the filing date. */
  because: string;
  last_read_at: string | null;
  latest_document_date: string | null;
}

export interface RecentPlan {
  days: number;
  from: string;
  due: RecentPlanItem[];
  current: RecentPlanItem[];
  /** Tickers asked about that filed nothing results-shaped in the window. */
  not_reported: number;
}

/**
 * Pure: which reporters still need a read. A row is CURRENT when the ledger
 * already holds a document dated on or after the filing, or a successful
 * read finished on or after it. Anything else that reported is DUE — a
 * failed read, a read of the previous quarter, no read at all.
 */
export function planRecentReads(
  reported: ReportedFact[],
  ledgers: Record<string, CompanyLedger | null | undefined>,
  askedCount: number,
  days: number,
  from: string,
  loading: Set<string> = new Set(),
): RecentPlan {
  const due: RecentPlanItem[] = [];
  const current: RecentPlanItem[] = [];
  for (const r of reported) {
    const L = ledgers[r.ticker] || null;
    const lastRead = day(L?.last_evidence_read_at);
    const latestDoc = day(L?.latest_document_date);
    const base = { ...r, last_read_at: lastRead, latest_document_date: latestDoc };
    if (loading.has(r.ticker)) { current.push({ ...base, action: 'reading', because: 'a read is already running' }); continue; }
    if (latestDoc && latestDoc >= r.reported_at) {
      current.push({ ...base, action: 'current', because: `document dated ${latestDoc} already on file` });
    } else if (lastRead && lastRead >= r.reported_at) {
      current.push({ ...base, action: 'current', because: `evidence read ${lastRead}, after the filing` });
    } else {
      due.push({ ...base, action: 'due', because: lastRead
        ? `last read ${lastRead}, before the ${r.reported_at} filing`
        : 'never read' });
    }
  }
  return { days, from, due, current, not_reported: Math.max(0, askedCount - reported.length) };
}

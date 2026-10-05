// zzz879 — ONE SHORT REASON PER PENDING NAME on India Earnings Opportunities.
// "3 results still pending" gave no reason. The graded payload already says why
// each name is not a card (`_dropped[].reason`, `_failed_tickers`); this turns
// that into a few plain words for the chip, with the full reason on hover.
// Pure.
export interface PendingWhy { word: string; color: string; full: string }

const GREY = 'var(--mc-text-3)', AMBER = '#F59E0B', CYAN = 'var(--mc-cyan)', RED = '#EF4444';

export function pendingReasonWord(reason?: string | null, failed = false): PendingWhy {
  const r = String(reason || '').trim();
  if (failed || /fetch|timeout|timed out|rate.?limit|failed to load/i.test(r)) return { word: "numbers didn't load — retrying", color: RED, full: r || 'the numbers could not be fetched this time; the next refresh tries again' };
  if (!r) return { word: 'results not out yet', color: GREY, full: 'on the calendar; no results filing seen yet' };
  if (/^late filing/i.test(r)) return { word: 'late filing of an old quarter — not graded as new', color: AMBER, full: r };
  if (/scheduled \(Upcoming\)|scheduled for|not out yet/i.test(r)) return { word: 'board meeting only — results not out yet', color: GREY, full: r };
  if (/not on Screener yet|new quarter not on Screener/i.test(r)) return { word: 'filed — waiting for the numbers', color: CYAN, full: r };
  if (/no financials and no hub|ghost-filing/i.test(r)) return { word: 'no results filing seen yet', color: GREY, full: r };
  if (/wrong-date|quarter-mismatch|in the future|stale-data/i.test(r)) return { word: 'dates do not match — not graded', color: AMBER, full: r };
  return { word: 'not graded yet', color: GREY, full: r };
}

/** ticker → reason, from the day's payload. */
export function pendingReasonMap(payload: any): Map<string, PendingWhy> {
  const failed = new Set<string>((Array.isArray(payload?._failed_tickers) ? payload._failed_tickers : []).map((t: any) => String(t || '').toUpperCase()));
  const out = new Map<string, PendingWhy>();
  for (const d of (Array.isArray(payload?._dropped) ? payload._dropped : [])) {
    const t = String(d?.ticker || '').toUpperCase();
    if (t) out.set(t, pendingReasonWord(d?.reason, failed.has(t)));
  }
  for (const t of Array.from(failed)) if (!out.has(t)) out.set(t, pendingReasonWord(null, true));
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Merging DAY-SIZED scans into one window (client-side, pure).
//
// WHY THE PAGE FETCHES DAY BY DAY
// ───────────────────────────────
// A 5-session window used to be one request: EDGAR's filing index, then XBRL
// for every filer, then prices — 40–60 seconds during which the page showed
// "Scanning…" and nothing else, and any change of window (or a server restart)
// started the whole thing again, re-grading names that had been on screen a
// minute earlier.
//
// Splitting the window into one request per session fixes both halves of that:
//   • each day paints the moment it lands, so the page fills in rather than
//     waiting for the slowest filer in the window;
//   • each day is cached on its own, and a completed session never changes, so
//     re-opening the page (or widening 5d → 10d) only fetches the days that are
//     actually missing. Nothing already on screen is re-scanned.
//
// This mirrors how the India page behaves and is the reason the merge below has
// to be careful: the same company can appear on two days (the 8-K on Tuesday,
// the 10-Q on Thursday), and the better row must win.
// ═══════════════════════════════════════════════════════════════════════════

import { US_TIER_ORDER, type UsGradedRow, type EarningsTier } from './us-earnings-core';

export interface DayPayload {
  filing_date: string | null;
  window_days: number;
  window_start: string | null;
  candidates_total: number;
  raw_items_total: number;
  pending_xbrl_total: number;
  no_price_total: number;
  by_tier: Record<EarningsTier, UsGradedRow[]>;
  pending: any[];
  scheduled: any[];
  generated_at: string;
  sources_polled: number;
  truncated: boolean;
  notes: string[];
}

/** Which of two rows for the same ticker is the better one to show. */
function better(a: UsGradedRow, b: UsGradedRow): UsGradedRow {
  const aPre = !!(a as any).prelim, bPre = !!(b as any).prelim;
  // A full GAAP grade always beats a PRELIM one, whatever the dates say.
  if (aPre !== bPre) return aPre ? b : a;
  // Otherwise the later announcement is the newer quarter.
  if (a.filing_date !== b.filing_date) return a.filing_date > b.filing_date ? a : b;
  // Same day, same basis: keep the one with more of the picture filled in.
  const filled = (r: UsGradedRow) =>
    (r.revenue_curr_musd != null ? 1 : 0) + (r.eps_curr != null ? 1 : 0) +
    (r.cfo_curr_musd != null ? 1 : 0) + (r.opm_pct != null ? 1 : 0);
  return filled(b) > filled(a) ? b : a;
}

/**
 * Fold the day payloads (any order, gaps allowed) into one window payload.
 * `windowStart`/`filingDate` describe the window the user asked for, not the
 * days that happen to have arrived.
 */
export function mergeDayPayloads(
  parts: Array<DayPayload | null | undefined>,
  filingDate: string,
  windowStart: string,
  windowDays: number,
): DayPayload {
  const rows = new Map<string, UsGradedRow>();
  const pending = new Map<string, any>();
  const scheduled = new Map<string, any>();
  const notes = new Set<string>();
  let raw = 0, noPrice = 0, truncated = false, newest = '';

  const ordered = parts.filter(Boolean).slice().sort((a, b) =>
    String(a!.filing_date).localeCompare(String(b!.filing_date))) as DayPayload[];

  for (const p of ordered) {
    raw += p.raw_items_total || 0;
    noPrice += p.no_price_total || 0;
    truncated = truncated || !!p.truncated;
    if (p.generated_at > newest) newest = p.generated_at;
    for (const t of US_TIER_ORDER) {
      for (const r of (p.by_tier?.[t] || [])) {
        const cur = rows.get(r.ticker);
        rows.set(r.ticker, cur ? better(cur, r) : r);
      }
    }
    for (const q of (p.pending || [])) {
      const k = `${q.ticker}|${q.reason}`;
      if (!pending.has(k)) pending.set(k, q);
    }
    // The schedule belongs to the newest day in the window — that is the one
    // whose "expected today" list is still emptying out.
    if (p.filing_date === filingDate) {
      for (const s of (p.scheduled || [])) scheduled.set(s.ticker, s);
    }
    for (const n of (p.notes || [])) {
      // Per-day counts do not add up across a window; keep only the notes that
      // describe HOW something was graded, not how many.
      if (/^\d+\s/.test(n)) continue;
      notes.add(n);
    }
  }

  // A name that ended up graded is not pending, whichever day said so.
  for (const [k, q] of Array.from(pending.entries())) {
    if (rows.has(q.ticker) && q.reason !== 'reported-earlier') pending.delete(k);
  }
  // Nor is a name that has already filed still "scheduled".
  for (const t of Array.from(scheduled.keys())) if (rows.has(t)) scheduled.delete(t);

  const by_tier: Record<EarningsTier, UsGradedRow[]> = { BLOCKBUSTER: [], STRONG: [], MIXED: [], AVOID: [] };
  for (const r of rows.values()) by_tier[r.tier].push(r);
  for (const t of US_TIER_ORDER) {
    by_tier[t].sort((a, b) =>
      (b.composite_score - a.composite_score) ||
      ((b.pead_score ?? 0) - (a.pead_score ?? 0)) ||
      b.filing_date.localeCompare(a.filing_date));
  }

  const pendingList = Array.from(pending.values())
    .sort((a, b) => String(b.filed).localeCompare(String(a.filed)) || String(a.ticker).localeCompare(String(b.ticker)));
  const xbrlPending = pendingList.filter((p) => p.reason === 'xbrl-not-posted' || p.reason === 'quarter-stale').length;

  const counted: string[] = [];
  if (xbrlPending) counted.push(`${xbrlPending} filer${xbrlPending > 1 ? 's' : ''} announced but XBRL not yet posted (the 10-Q usually follows the 8-K by days to weeks)`);
  const earlier = pendingList.filter((p) => p.reason === 'reported-earlier').length;
  if (earlier) counted.push(`${earlier} filing(s) in the window were 10-Qs or follow-up 8-Ks for results already announced before the window — not re-graded as fresh`);
  if (noPrice) counted.push(`${noPrice} filer(s) had no usable price history`);

  return {
    filing_date: filingDate,
    window_days: windowDays,
    window_start: windowStart,
    candidates_total: rows.size,
    raw_items_total: raw,
    pending_xbrl_total: xbrlPending,
    no_price_total: noPrice,
    by_tier,
    pending: pendingList,
    scheduled: Array.from(scheduled.values()).sort((a, b) => (b.market_cap_musd ?? 0) - (a.market_cap_musd ?? 0)),
    generated_at: newest || new Date().toISOString(),
    sources_polled: 3,
    truncated,
    notes: [...counted, ...Array.from(notes)],
  };
}

/** The sessions in a window, newest first — EDGAR generates nothing on a weekend. */
export function windowSessions(endDate: string, days: number): string[] {
  const out: string[] = [];
  for (let i = 0; out.length < days && i < days * 3; i++) {
    const iso = new Date(Date.parse(endDate + 'T00:00:00Z') - i * 86400000).toISOString().slice(0, 10);
    const dow = new Date(iso + 'T00:00:00Z').getUTCDay();
    if (dow === 0 || dow === 6) continue;
    out.push(iso);
  }
  return out;
}

/** Calendar ranges, split into chunks so the grid paints as each one lands. */
export function chunkRange(from: string, to: string, size = 10): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let cur = from;
  let guard = 0;
  while (cur <= to && guard++ < 40) {
    const end = new Date(Date.parse(cur + 'T00:00:00Z') + (size - 1) * 86400000).toISOString().slice(0, 10);
    const stop = end > to ? to : end;
    out.push([cur, stop]);
    cur = new Date(Date.parse(stop + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  }
  return out;
}

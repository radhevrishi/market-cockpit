// ═══════════════════════════════════════════════════════════════════════════
// THE CONSENSUS, CAPTURED BEFORE THE PRINT
//
// THE PROBLEM THIS SOLVES
//
// A card shows "Revenue $3.00B · no street estimate published for this line".
// There IS a revenue consensus for that quarter — it simply stops existing the
// moment the quarter is reported. Yahoo's earnings-trend feed carries estimates
// only for periods that have NOT happened yet ("0q" = the current quarter,
// "+1q" = the next one); once a company reports, its quarter drops out of the
// feed and the number is gone. The EPS consensus survives in the
// earnings-HISTORY feed; revenue has no history feed at all.
//
// So the estimate has to be taken while it is still there. This module writes
// down the forward revenue and EPS consensus for every company that is
// SCHEDULED to report, keyed by the period it covers, and hands it back after
// the print.
//
// WHAT THIS IS NOT
//
// It is not a forecast, not an average of anything we computed, and not a
// number carried over from a different period. It is the vendor's own
// consensus for that exact fiscal period, read before the print and stored
// with the date it was read on, so a card can say "vs est $2.98B (consensus as
// at 21 Aug)" and mean it literally.
//
// COVERAGE IS HONEST AND STARTS FROM ZERO. A quarter that reported before this
// module existed has no snapshot and never will; those cards keep saying no
// estimate is published rather than borrowing one. Coverage builds as the
// calendar sweeps run.
//
// There is no equivalent for operating income or net income: no free source
// publishes a consensus for either, and the card says so on those lines rather
// than inventing one.
// ═══════════════════════════════════════════════════════════════════════════

import { kvGet, kvSet } from './kv';
import { yahooForwardEstimates, pooled } from './us-prices';

const KEY_V = 'us-est:v1';
/** A filed quarter is graded within days; six months is generous headroom. */
const TTL_S = 180 * 24 * 3600;
/** 52/53-week calendars move a period end by up to a week either way, and the
 *  vendor's end_date is its own estimate of the period end rather than the
 *  filer's. Twenty days is wide enough for both and far narrower than a
 *  quarter, so a snapshot can never be matched to the wrong period. */
const MATCH_DAYS = 20;

export interface EstimateSnapshot {
  ticker: string;
  period_end: string;        // the fiscal period this consensus covers
  eps: number | null;
  revenue: number | null;    // absolute dollars, as the vendor reports it
  captured_at: string;       // ISO date the consensus was read
}

const key = (ticker: string, periodEnd: string) => `${KEY_V}:${ticker.toUpperCase()}:${periodEnd}`;

function daysApart(a: string, b: string): number {
  const x = Date.parse(a + 'T00:00:00Z');
  const y = Date.parse(b + 'T00:00:00Z');
  if (!Number.isFinite(x) || !Number.isFinite(y)) return Infinity;
  return Math.abs(x - y) / 86_400_000;
}

/**
 * Read the forward consensus for every ticker given and store it against the
 * period it covers. Safe to call repeatedly: a later read of the same period
 * overwrites the earlier one, which is what you want — the consensus a day
 * before the print is the one the market actually traded against.
 *
 * Never throws and never blocks the caller's own work: a vendor failure simply
 * means no snapshot for that name this time.
 */
export async function snapshotEstimates(tickers: string[]): Promise<number> {
  const uniq = Array.from(new Set(tickers.map((t) => String(t || '').toUpperCase()).filter(Boolean)));
  if (!uniq.length) return 0;
  let written = 0;
  await pooled(uniq, 6, async (t) => {
    try {
      const fwd = await yahooForwardEstimates(t);
      for (const f of fwd) {
        // Only the two QUARTERLY entries: a fiscal-year estimate is not a
        // quarter's consensus and must never be stored as one.
        if (f.period !== '0q' && f.period !== '+1q') continue;
        if (!f.end_date || !/^\d{4}-\d{2}-\d{2}$/.test(f.end_date)) continue;
        if (f.eps == null && f.revenue == null) continue;
        const snap: EstimateSnapshot = {
          ticker: t,
          period_end: f.end_date,
          eps: f.eps,
          revenue: f.revenue,
          captured_at: new Date().toISOString().slice(0, 10),
        };
        await kvSet(key(t, f.end_date), snap, TTL_S);
        written++;
      }
    } catch { /* no snapshot for this name this time */ }
  });
  return written;
}

/**
 * The consensus for a reported quarter, if it was captured before the print.
 * Returns null when nothing was stored — which is the correct answer, not a
 * gap to paper over.
 */
export async function readEstimateSnapshot(
  ticker: string, periodEnd: string | null,
): Promise<EstimateSnapshot | null> {
  if (!ticker || !periodEnd || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) return null;
  const t = ticker.toUpperCase();
  // The exact period end first — the common case, and free.
  try {
    const hit = await kvGet<EstimateSnapshot>(key(t, periodEnd));
    if (hit && hit.period_end) return hit;
  } catch { /* fall through */ }
  // Then the neighbouring week, for a 52/53-week calendar whose period end the
  // vendor rounded to a month end. Bounded, and never beyond a fifth of a
  // quarter, so a match is always the same period rather than an adjacent one.
  const base = Date.parse(periodEnd + 'T00:00:00Z');
  if (!Number.isFinite(base)) return null;
  for (let d = 1; d <= MATCH_DAYS; d++) {
    for (const sign of [-1, 1]) {
      const iso = new Date(base + sign * d * 86_400_000).toISOString().slice(0, 10);
      try {
        const hit = await kvGet<EstimateSnapshot>(key(t, iso));
        if (hit && hit.period_end && daysApart(hit.period_end, periodEnd) <= MATCH_DAYS) return hit;
      } catch { /* keep looking */ }
    }
  }
  return null;
}

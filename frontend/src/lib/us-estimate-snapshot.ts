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

// ── ONE KEY PER TICKER, NOT ONE PER PERIOD ────────────────────────────────
//
// The first version stored a key per (ticker, period end) and, on a miss,
// walked forty neighbouring dates looking for one — forty-one sequential
// round-trips to Frankfurt for every filer graded, almost all of them misses,
// because coverage starts empty and fills only as the calendar sweeps.
//
// The cost was not the money, though it was plain enough in the console: 1.4
// MILLION reads in three hours against ~10,000 writes, at a hit rate of almost
// exactly zero. The cost was the WALL CLOCK. Twenty-five milliseconds per
// round-trip, forty-one of them, serially, per filer, is a second of doing
// nothing per company — a minute on a sixty-filer session and five minutes on
// the heaviest August days, on top of every SEC request those days already
// need. That is what was killing those sessions at 300 seconds, and no
// increase to any timeout could have fixed it.
//
// A ticker's snapshots now live in ONE small document keyed by period end, so
// a lookup is a single GET and the tolerance search happens in memory, where
// it costs nothing at all.
const KEY_V = 'us-est:v2';
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

/** One document per ticker: { [period_end]: EstimateSnapshot }. */
type SnapshotIndex = Record<string, EstimateSnapshot>;
const key = (ticker: string) => `${KEY_V}:${ticker.toUpperCase()}`;
/** A name reports four times a year, so a dozen entries is three years of
 *  history in a few hundred bytes. Oldest periods fall off the end. */
const MAX_PERIODS = 12;

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
      // ONE read and ONE write per ticker, whatever the vendor returns.
      const idx: SnapshotIndex = (await kvGet<SnapshotIndex>(key(t)).catch(() => null)) || {};
      let changed = false;
      for (const f of fwd) {
        // Only the two QUARTERLY entries: a fiscal-year estimate is not a
        // quarter's consensus and must never be stored as one.
        if (f.period !== '0q' && f.period !== '+1q') continue;
        if (!f.end_date || !/^\d{4}-\d{2}-\d{2}$/.test(f.end_date)) continue;
        if (f.eps == null && f.revenue == null) continue;
        idx[f.end_date] = {
          ticker: t,
          period_end: f.end_date,
          eps: f.eps,
          revenue: f.revenue,
          captured_at: new Date().toISOString().slice(0, 10),
        };
        changed = true;
        written++;
      }
      if (changed) {
        const ends = Object.keys(idx).sort().slice(-MAX_PERIODS);
        const trimmed: SnapshotIndex = {};
        for (const e of ends) trimmed[e] = idx[e];
        await kvSet(key(t), trimmed, TTL_S);
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
  // ONE round-trip. Everything below happens in memory.
  let idx: SnapshotIndex | null = null;
  try { idx = await kvGet<SnapshotIndex>(key(t)); } catch { return null; }
  if (!idx) return null;
  const exact = idx[periodEnd];
  if (exact && exact.period_end) return exact;
  // The 52/53-week tolerance, searched over what we already hold: the nearest
  // stored period within the window wins, and nothing outside it can match.
  let best: EstimateSnapshot | null = null;
  let bestD = Infinity;
  for (const [end, snap] of Object.entries(idx)) {
    if (!snap || !snap.period_end) continue;
    const d = daysApart(end, periodEnd);
    if (d <= MATCH_DAYS && d < bestD) { best = snap; bestD = d; }
  }
  return best;
}

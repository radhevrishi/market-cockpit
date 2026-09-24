// zzz786 — TODAY'S US gainers, read live from TradingView's public scanner.
//
// Why: the US board used to come from a committed CSV ("Weekly Gainer Stocks
// USA") refreshed by a GitHub workflow that runs on an IST schedule — every
// run lands BEFORE the US open. So during the US session the page always
// showed the previous session's list (and a 1-week column at that). The owner
// opened the page with the market open and saw last session's moves.
//
// Now the board is read at request time: US exchange-listed common stock,
// small/mid cap, sorted by today's % change. During the session that is
// today's move (intraday, changes until 16:00 ET); before the open it is the
// last completed session, and the label says so. The CSV stays as fallback.
//
// No key is needed; nothing secret is sent. Price is used here ONLY to pick
// the list of names (discovery), never as evidence of a catalyst.

import { etParts, etToday, usPhaseAt, lastCompletedNyseSession, isNyseTradingDay, type UsExportRow, type UsExportAsOf } from './us-gainers';

import { DEFAULT_US_SCAN_CRITERIA, scanFilters, type UsScanCriteria } from './us-scan-criteria';

// zzz797 — the filters are no longer hard-coded here: they come from the
// owner-editable criteria (us-scan-criteria.ts). US_LIVE_SCAN is kept as the
// read-only view of the DEFAULTS for older callers.
export const US_LIVE_SCAN = {
  url: 'https://scanner.tradingview.com/america/scan',
  minChangePct: DEFAULT_US_SCAN_CRITERIA.minChangePct,
  minMcapUsd: DEFAULT_US_SCAN_CRITERIA.minMcapUsd as number,
  maxMcapUsd: DEFAULT_US_SCAN_CRITERIA.maxMcapUsd as number,
  minAvgVol30d: DEFAULT_US_SCAN_CRITERIA.minAvgVol30d as number,
  limit: DEFAULT_US_SCAN_CRITERIA.limit,
} as const;

const COLS = ['name', 'exchange', 'description', 'change', 'market_cap_basic', 'close', 'volume',
  'relative_volume_10d_calc', 'gap', 'Perf.W', 'Perf.1M', 'Perf.3M', 'Perf.6M', 'Perf.Y', 'sector', 'type', 'subtype'] as const;

export function liveScanBody(criteria: UsScanCriteria = DEFAULT_US_SCAN_CRITERIA) {
  const { filter, filter2 } = scanFilters(criteria);
  return {
    filter,
    filter2,
    options: { lang: 'en' },
    columns: COLS,
    sort: { sortBy: 'change', sortOrder: 'desc' },
    range: [0, criteria.limit],
  };
}

const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** One scanner row → the same shape the CSV produced, with the move = today's % change. */
export function rowFromScan(d: unknown[]): UsExportRow | null {
  if (!Array.isArray(d)) return null;
  const get = (c: typeof COLS[number]) => d[COLS.indexOf(c)];
  const ticker = String(get('name') || '').trim().toUpperCase();
  if (!ticker) return null;
  const mcap = n(get('market_cap_basic'));
  return {
    ticker,
    company: String(get('description') || ''),
    exchange: String(get('exchange') || '').trim().toUpperCase(),
    movePct: n(get('change')),
    relVol: n(get('relative_volume_10d_calc')),
    gapPct: n(get('gap')),
    volume: n(get('volume')),
    price: n(get('close')),
    marketCap: mcap != null ? mcap / 1e6 : null,
    perf: { w1: n(get('Perf.W')), m1: n(get('Perf.1M')), m3: n(get('Perf.3M')), m6: n(get('Perf.6M')), y1: n(get('Perf.Y')) },
  };
}

/** Which session the scanner's "change" describes right now, in plain words. */
export function describeLiveScan(now: Date = new Date()): UsExportAsOf {
  const e = etParts(now);
  const phase = usPhaseAt(now);
  const today = etToday(now);
  const intraday = phase === 'regular';
  // After the close on a trading day the change is TODAY's completed session;
  // before the open (or on a non-trading day) it is the last completed one.
  const session = intraday || (phase === 'after_hours' && isNyseTradingDay(today)) ? today : lastCompletedNyseSession(now);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const synced_et = `${days[e.weekday] || ''} ${e.ymd} ${e.hhmm} ET`;
  const label = intraday
    ? `Live US scan at ${e.hhmm} ET — today's (${session}) move so far; it changes until the 16:00 ET close.`
    : session === today
      ? `Live US scan at ${e.hhmm} ET — today's (${session}) completed session.`
      : `Live US scan at ${e.hhmm} ET — the US market is not open yet, so these are the last completed session's (${session}) moves.`;
  return { synced_at: now.toISOString(), synced_et, phase, session, intraday, sessions_behind: 0, stale: false, label };
}

export interface UsLiveResult { rows: UsExportRow[]; totalCount: number; asOf: UsExportAsOf; error: string | null }

/** Read today's gainers. Two attempts with a short back-off; never throws. */
export async function fetchUsLiveGainers(now: Date = new Date(), fetchImpl: typeof fetch = fetch, criteria: UsScanCriteria = DEFAULT_US_SCAN_CRITERIA): Promise<UsLiveResult> {
  const asOf = describeLiveScan(now);
  let lastErr = 'unknown error';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetchImpl(US_LIVE_SCAN.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(liveScanBody(criteria)),
        signal: AbortSignal.timeout(12_000),
        cache: 'no-store',
      } as any);
      if (!r.ok) { lastErr = `HTTP ${r.status}`; }
      else {
        const j: any = await r.json();
        const rows = (Array.isArray(j?.data) ? j.data : []).map((x: any) => rowFromScan(x?.d)).filter(Boolean) as UsExportRow[];
        return { rows, totalCount: typeof j?.totalCount === 'number' ? j.totalCount : rows.length, asOf, error: null };
      }
    } catch (e: any) { lastErr = String(e?.message || e); }
    if (attempt === 0) await new Promise((res) => setTimeout(res, 800));
  }
  return { rows: [], totalCount: 0, asOf, error: `live US scan failed (${lastErr})` };
}

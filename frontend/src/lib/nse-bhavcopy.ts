// PATCH 1016 — NSE Bhavcopy integration for D1/Gap price data.
//
// Replaces Yahoo Finance (which blocks Railway IPs intermittently) with
// NSE's official end-of-day bhavcopy CSV — a static archive file that
// never rejects requests. URL format:
//   https://archives.nseindia.com/products/content/sec_bhavdata_full_DDMMYYYY.csv
//
// Each CSV contains every NSE-listed security's OHLCV for the day:
//   SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE,
//   LAST_PRICE, CLOSE_PRICE, AVG_PRICE, TTL_TRD_QNTY, TURNOVER_LACS, ...
//
// Per-symbol data is cached in KV indefinitely (historical bhavcopy data
// is immutable). A "loaded" flag prevents re-fetching the full CSV.

import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';

export interface BhavData {
  symbol: string;
  date: string;          // YYYY-MM-DD
  prev_close: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  delivery_pct: number | null;
}

export interface PriceReaction {
  gap_pct: number | null;        // (open - prev_close) / prev_close * 100
  d1_pct: number | null;         // (close - prev_close) / prev_close * 100
  // zzz231 — 2-trading-day cumulative reaction. Computed as (day2_close - prev_close) / prev_close.
  d2_pct: number | null;
  // zzz231 — cumulative % close move from reaction day to most recent bhavcopy day.
  move_pct: number | null;
  current_price: number | null;
  prev_close: number | null;
  volume: number | null;
  delivery_pct: number | null;
}

const BHAV_URL = (ddmmyyyy: string) =>
  `https://archives.nseindia.com/products/content/sec_bhavdata_full_${ddmmyyyy}.csv`;

function isoToDdmmyyyy(iso: string): string {
  // '2026-05-27' → '27052026'
  const [y, m, d] = iso.split('-');
  return `${d}${m}${y}`;
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isWeekend(iso: string): boolean {
  const dow = new Date(iso).getUTCDay();
  return dow === 0 || dow === 6;
}

/** Parse the bhavcopy CSV. Field names have leading whitespace. */
function parseBhavcopy(csv: string, isoDate: string): Map<string, BhavData> {
  const out = new Map<string, BhavData>();
  const lines = csv.split('\n');
  if (lines.length < 2) return out;
  // Header: SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, LAST_PRICE, CLOSE_PRICE, AVG_PRICE, TTL_TRD_QNTY, TURNOVER_LACS, NO_OF_TRADES, DELIV_QTY, DELIV_PER
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(',').map((c) => c.trim());
    if (cols.length < 15) continue;
    const series = cols[1];
    // Only EQ (equity) and SM (SME) series — skip GS/GB/Bonds etc.
    if (series !== 'EQ' && series !== 'SM' && series !== 'BE' && series !== 'BZ') continue;
    const symbol = cols[0];
    const prevClose = parseFloat(cols[3]);
    const open = parseFloat(cols[4]);
    const high = parseFloat(cols[5]);
    const low = parseFloat(cols[6]);
    const close = parseFloat(cols[8]);
    const volume = parseFloat(cols[10]);
    const delivPer = parseFloat(cols[14]);
    if (!Number.isFinite(prevClose) || !Number.isFinite(open) || !Number.isFinite(close)) continue;
    out.set(symbol.toUpperCase(), {
      symbol,
      date: isoDate,
      prev_close: prevClose,
      open,
      high: Number.isFinite(high) ? high : 0,
      low: Number.isFinite(low) ? low : 0,
      close,
      volume: Number.isFinite(volume) ? volume : 0,
      delivery_pct: Number.isFinite(delivPer) ? delivPer : null,
    });
  }
  return out;
}

const BHAV_TIMEOUT_MS = 12_000;

// PATCH 1016b — memory-safe module-level cache. The 2000-entry Promise.all
// KV bulk-write in the original Patch 1016 spiked memory and OOM'd Railway.
// Instead: parse the CSV once per warm container per date, hold the Map in
// process memory (~1-2 MB), and write ONLY individually-requested symbols to
// KV (lazy, small). The mem cache is bounded to the 5 most-recent dates.
const _memCache = new Map<string, Map<string, BhavData>>();
const _memOrder: string[] = [];
const MEM_MAX_DATES = 5;

function _memPut(isoDate: string, map: Map<string, BhavData>) {
  _memCache.set(isoDate, map);
  _memOrder.push(isoDate);
  while (_memOrder.length > MEM_MAX_DATES) {
    const evict = _memOrder.shift();
    if (evict && evict !== isoDate) _memCache.delete(evict);
  }
}

async function fetchBhavcopyMap(isoDate: string): Promise<Map<string, BhavData>> {
  // In-memory first
  const mem = _memCache.get(isoDate);
  if (mem) return mem;

  const ddmm = isoToDdmmyyyy(isoDate);
  const url = BHAV_URL(ddmm);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), BHAV_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/csv,text/plain,*/*' },
      signal: ctrl.signal,
    });
    if (!res.ok) { _memPut(isoDate, new Map()); return new Map(); }
    const csv = await res.text();
    const parsed = parseBhavcopy(csv, isoDate);
    _memPut(isoDate, parsed);  // hold in memory, NO bulk KV write
    // Mark date loaded so cross-container we know it was attempted
    if (isRedisAvailable() && parsed.size > 0) {
      kvSet(`bhav:loaded:${isoDate}`, true, 24 * 3600).catch(() => null);
    }
    return parsed;
  } catch {
    _memPut(isoDate, new Map());
    return new Map();
  } finally {
    clearTimeout(t);
  }
}

/** Get single-symbol bhavcopy data — per-symbol KV cache, then full-map fetch. */
export async function getBhavForSymbol(symbol: string, isoDate: string): Promise<BhavData | null> {
  const sym = symbol.toUpperCase();
  // 1. Per-symbol KV cache (only symbols actually looked up get written here)
  if (isRedisAvailable()) {
    try {
      const cached = await kvGet<BhavData>(`bhav:v1:${isoDate}:${sym}`);
      if (cached) return cached;
    } catch {}
  }
  // 2. Full-map fetch (in-memory cached per container)
  const map = await fetchBhavcopyMap(isoDate);
  const data = map.get(sym) || null;
  // 3. Lazily write JUST this symbol to KV for cross-container reuse
  if (data && isRedisAvailable()) {
    kvSet(`bhav:v1:${isoDate}:${sym}`, data, 90 * 24 * 3600).catch(() => null);
  }
  return data;
}

/**
 * Compute price reaction for a given filing date.
 * Tries: filing_date → +1 → +2 → +3 (in case filing day was weekend/holiday).
 * Returns gap_pct, d1_pct, current_price (close of reaction day), prev_close.
 */
export async function getPriceReaction(symbol: string, filingDateIso: string): Promise<PriceReaction> {
  const empty: PriceReaction = {
    gap_pct: null, d1_pct: null, d2_pct: null, move_pct: null,
    current_price: null, prev_close: null,
    volume: null, delivery_pct: null,
  };
  if (!symbol || !filingDateIso) return empty;
  // Try the filing date itself, then up to +3 days for weekends/holidays.
  let attempt = filingDateIso;
  for (let i = 0; i < 5; i++) {
    if (isWeekend(attempt)) {
      attempt = shiftDate(attempt, 1);
      continue;
    }
    const bhav = await getBhavForSymbol(symbol, attempt);
    if (bhav && bhav.prev_close > 0) {
      const gap = ((bhav.open - bhav.prev_close) / bhav.prev_close) * 100;
      const d1 = ((bhav.close - bhav.prev_close) / bhav.prev_close) * 100;
      const anchorPrev = bhav.prev_close;
      // zzz231 — walk forward for day-2 close (skip weekends)
      let d2Pct: number | null = null;
      let d2Close: number | null = null;
      let d2Date = attempt;
      for (let j = 0; j < 5; j++) {
        d2Date = shiftDate(d2Date, 1);
        if (isWeekend(d2Date)) continue;
        const bhav2 = await getBhavForSymbol(symbol, d2Date);
        if (bhav2 && bhav2.close > 0) {
          d2Pct = ((bhav2.close - anchorPrev) / anchorPrev) * 100;
          d2Close = bhav2.close;
          break;
        }
      }
      // zzz231 — walk forward further to compute cumulative move to most recent bhav
      let lastClose: number | null = d2Close ?? bhav.close;
      let walkDate = d2Date;
      for (let k = 0; k < 40; k++) {
        walkDate = shiftDate(walkDate, 1);
        if (isWeekend(walkDate)) continue;
        if (walkDate > new Date().toISOString().slice(0, 10)) break;
        const bhavK = await getBhavForSymbol(symbol, walkDate);
        if (bhavK && bhavK.close > 0) lastClose = bhavK.close;
      }
      const movePct = lastClose != null ? ((lastClose - anchorPrev) / anchorPrev) * 100 : null;
      return {
        gap_pct: gap,
        d1_pct: d1,
        d2_pct: d2Pct,
        move_pct: movePct,
        current_price: lastClose ?? bhav.close,
        prev_close: bhav.prev_close,
        volume: bhav.volume,
        delivery_pct: bhav.delivery_pct,
      };
    }
    attempt = shiftDate(attempt, 1);
  }
  return empty;
}

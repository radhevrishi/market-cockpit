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

async function fetchAndCacheBhavcopy(isoDate: string): Promise<Map<string, BhavData>> {
  const ddmm = isoToDdmmyyyy(isoDate);
  const url = BHAV_URL(ddmm);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), BHAV_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'text/csv,text/plain,*/*',
      },
      signal: ctrl.signal,
    });
    if (!res.ok) return new Map();
    const csv = await res.text();
    const parsed = parseBhavcopy(csv, isoDate);
    // Bulk-cache every symbol's data (immutable historical → long TTL)
    if (isRedisAvailable() && parsed.size > 0) {
      const writes: Promise<unknown>[] = [];
      for (const [sym, data] of parsed.entries()) {
        writes.push(
          kvSet(`bhav:v1:${isoDate}:${sym}`, data, 90 * 24 * 3600).catch(() => null),
        );
      }
      // Mark date as loaded so we don't re-fetch
      writes.push(kvSet(`bhav:loaded:${isoDate}`, true, 24 * 3600).catch(() => null));
      await Promise.all(writes);
    }
    return parsed;
  } catch {
    return new Map();
  } finally {
    clearTimeout(t);
  }
}

/** Get single-symbol bhavcopy data, fetching+caching if needed. */
export async function getBhavForSymbol(symbol: string, isoDate: string): Promise<BhavData | null> {
  const sym = symbol.toUpperCase();
  // Cache check
  if (isRedisAvailable()) {
    try {
      const cached = await kvGet<BhavData>(`bhav:v1:${isoDate}:${sym}`);
      if (cached) return cached;
      // Check if date was already loaded but symbol not in it (e.g. not NSE-listed)
      const loaded = await kvGet<boolean>(`bhav:loaded:${isoDate}`);
      if (loaded) return null;
    } catch {}
  }
  // Fetch full bhavcopy for this date
  const map = await fetchAndCacheBhavcopy(isoDate);
  return map.get(sym) || null;
}

/**
 * Compute price reaction for a given filing date.
 * Tries: filing_date → +1 → +2 → +3 (in case filing day was weekend/holiday).
 * Returns gap_pct, d1_pct, current_price (close of reaction day), prev_close.
 */
export async function getPriceReaction(symbol: string, filingDateIso: string): Promise<PriceReaction> {
  const empty: PriceReaction = {
    gap_pct: null, d1_pct: null, current_price: null, prev_close: null,
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
      return {
        gap_pct: gap,
        d1_pct: d1,
        current_price: bhav.close,
        prev_close: bhav.prev_close,
        volume: bhav.volume,
        delivery_pct: bhav.delivery_pct,
      };
    }
    attempt = shiftDate(attempt, 1);
  }
  return empty;
}

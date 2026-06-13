// ─── NSE Bhavcopy EOD price source ─────────────────────────────────────────
// 10y-ops Section 7.3: Yahoo Finance scrape has been flaky/banned multiple
// times. NSE publishes the canonical EOD bhavcopy CSV at a stable URL on
// every trading day. This module fetches and parses that CSV directly.
//
// Endpoint (post-Feb-2024 unified format):
//   https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_DDMMYYYY.csv
//
// CSV columns (15):
//   SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE,
//   LAST_PRICE, CLOSE_PRICE, AVG_PRICE, TTL_TRD_QNTY, TURNOVER_LACS,
//   NO_OF_TRADES, DELIV_QTY, DELIV_PER
//
// USAGE: this adapter is ADDITIVE — it does not replace yahoo-price.ts.
// Switch traffic by changing the import in scrape-runner.ts when ready:
//
//   // before
//   import { enrichWithYahoo } from './sources/yahoo-price.js';
//   // after
//   import { enrichWithBhavcopy as enrichWithYahoo } from './sources/nse-bhavcopy.js';
//
// CAVEAT: bhavcopy gives ONE day per fetch. To replicate Yahoo's 1y daily
// series we'd fetch ~252 days × 6KB ≈ 1.5 MB/symbol-batch. That's fine for
// CFW (no egress cap on outbound). Cache the parsed result in KV for 18h
// so re-runs in the same day don't re-fetch.

import { CanonicalEvent } from '../types.js';

const BHAVCOPY_BASE = 'https://nsearchives.nseindia.com/products/content';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 12000;
const ACCEPT = 'text/csv,text/plain,*/*';

export interface BhavcopyRow {
  symbol: string;
  series: string;
  date: string;        // YYYY-MM-DD
  prevClose: number;
  open: number;
  high: number;
  low: number;
  last: number;
  close: number;
  avg: number;
  volume: number;
  turnoverLacs: number;
  trades: number;
  delivQty: number | null;
  delivPct: number | null;
}

// ── URL builder ──────────────────────────────────────────────────────────────
// NSE filename pattern is DDMMYYYY in IST. We pad date components.
function bhavcopyUrl(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${BHAVCOPY_BASE}/sec_bhavdata_full_${dd}${mm}${yyyy}.csv`;
}

// ── Fetcher with timeout ─────────────────────────────────────────────────────
async function fetchBhavcopyCsv(d: Date): Promise<string | null> {
  const url = bhavcopyUrl(d);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': ACCEPT,
        // NSE requires a Referer or it sometimes 403s
        'Referer': 'https://www.nseindia.com/',
      },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.warn(`[bhavcopy] HTTP ${res.status} for ${url}`);
      return null;
    }
    return await res.text();
  } catch (e: any) {
    console.warn(`[bhavcopy] fetch failed for ${url}: ${e?.message || e}`);
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ── CSV parser ───────────────────────────────────────────────────────────────
// NSE's CSV is tolerant — header on row 1, fields are comma-separated with
// trailing spaces in some columns. The parser strips whitespace and skips
// blank/comment rows. We assume the post-Feb-2024 column layout.
function parseBhavcopyCsv(csv: string): BhavcopyRow[] {
  const rows: BhavcopyRow[] = [];
  const lines = csv.split(/\r?\n/);
  if (lines.length < 2) return rows;

  // Header sanity check — fail soft so a column reorder doesn't 5xx the worker
  const header = lines[0].split(',').map(s => s.trim().toUpperCase());
  const idx = (name: string) => header.indexOf(name);
  const I_SYM = idx('SYMBOL');
  const I_SER = idx('SERIES');
  const I_DATE = idx('DATE1');
  const I_PREV = idx('PREV_CLOSE');
  const I_OPEN = idx('OPEN_PRICE');
  const I_HIGH = idx('HIGH_PRICE');
  const I_LOW = idx('LOW_PRICE');
  const I_LAST = idx('LAST_PRICE');
  const I_CLOSE = idx('CLOSE_PRICE');
  const I_AVG = idx('AVG_PRICE');
  const I_VOL = idx('TTL_TRD_QNTY');
  const I_TURN = idx('TURNOVER_LACS');
  const I_TRADES = idx('NO_OF_TRADES');
  const I_DELIV_Q = idx('DELIV_QTY');
  const I_DELIV_P = idx('DELIV_PER');

  if (I_SYM < 0 || I_CLOSE < 0 || I_DATE < 0) {
    console.error(`[bhavcopy] CSV header missing critical columns. Got: ${header.join(',')}`);
    return rows;
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const f = line.split(',').map(s => s.trim());
    if (f.length < header.length - 1) continue;

    const series = (f[I_SER] || '').toUpperCase();
    // EQ = equity, BE = book-entry / T2T. Most retail uses EQ. Keep BE for completeness.
    if (series !== 'EQ' && series !== 'BE') continue;

    const num = (x: string): number => {
      const v = parseFloat(x);
      return Number.isFinite(v) ? v : NaN;
    };
    const numOrNull = (x: string): number | null => {
      if (x === '-' || x === '' || x == null) return null;
      const v = parseFloat(x);
      return Number.isFinite(v) ? v : null;
    };

    // DATE1 format is DD-MMM-YYYY, convert to ISO yyyy-mm-dd
    const dateRaw = f[I_DATE];
    const iso = dateDdMmmYyyyToIso(dateRaw);

    const row: BhavcopyRow = {
      symbol: f[I_SYM],
      series,
      date: iso,
      prevClose: num(f[I_PREV]),
      open: num(f[I_OPEN]),
      high: num(f[I_HIGH]),
      low: num(f[I_LOW]),
      last: num(f[I_LAST]),
      close: num(f[I_CLOSE]),
      avg: num(f[I_AVG]),
      volume: num(f[I_VOL]),
      turnoverLacs: num(f[I_TURN]),
      trades: num(f[I_TRADES]),
      delivQty: I_DELIV_Q >= 0 ? numOrNull(f[I_DELIV_Q]) : null,
      delivPct: I_DELIV_P >= 0 ? numOrNull(f[I_DELIV_P]) : null,
    };
    if (Number.isFinite(row.close)) rows.push(row);
  }

  return rows;
}

function dateDdMmmYyyyToIso(raw: string): string {
  if (!raw) return '';
  const m = raw.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return raw;
  const months: Record<string, string> = {
    JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
    JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
  };
  const mm = months[m[2].toUpperCase()];
  if (!mm) return raw;
  return `${m[3]}-${mm}-${String(parseInt(m[1], 10)).padStart(2, '0')}`;
}

// ── Public: fetch one day, return symbol -> row map ──────────────────────────
export async function fetchBhavcopy(date: Date): Promise<Map<string, BhavcopyRow> | null> {
  const csv = await fetchBhavcopyCsv(date);
  if (!csv) return null;
  const rows = parseBhavcopyCsv(csv);
  const map = new Map<string, BhavcopyRow>();
  for (const r of rows) map.set(r.symbol, r);
  console.log(`[bhavcopy] ${date.toISOString().slice(0, 10)} parsed ${rows.length} rows`);
  return map;
}

// ── Public: fetch the most recent trading-day bhavcopy (walks back up to 5d) ─
// Useful for "show me today's close" without caller having to know about
// weekends and Indian holidays.
export async function fetchLatestBhavcopy(today?: Date): Promise<Map<string, BhavcopyRow> | null> {
  const start = today ?? new Date();
  for (let back = 0; back < 6; back++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() - back);
    const m = await fetchBhavcopy(d);
    if (m && m.size > 0) return m;
  }
  console.warn('[bhavcopy] no bhavcopy found in last 6 days');
  return null;
}

// ── Public: enrich CanonicalEvents with today's close + prev_close ───────────
// Drop-in shape-compatible with the fields yahoo-price.ts emits for the
// "current_price + d1_pct" pair. Does NOT compute moving averages or
// RS-rating — those need 1y of history (fetchHistoricalBhavcopy below).
export async function enrichWithBhavcopy(
  events: CanonicalEvent[],
  today?: Date,
): Promise<CanonicalEvent[]> {
  if (!events?.length) return events;
  const map = await fetchLatestBhavcopy(today);
  if (!map) {
    console.warn('[bhavcopy] enrichment skipped — no bhavcopy available');
    return events;
  }

  let ok = 0, miss = 0;
  const out = events.map((ev) => {
    const sym = (ev.ticker || '').replace(/\.NS$/i, '').toUpperCase();
    const r = map.get(sym);
    if (!r) { miss++; return ev; }
    ok++;
    const gap = r.prevClose > 0 ? ((r.open - r.prevClose) / r.prevClose) * 100 : null;
    const d1 = r.prevClose > 0 ? ((r.close - r.prevClose) / r.prevClose) * 100 : null;
    return {
      ...ev,
      current_price: r.close,
      prev_close: r.prevClose,
      gap_pct: gap,
      d1_pct: d1,
      price_scraped_at: new Date().toISOString(),
    };
  });
  console.log(`[bhavcopy] enriched ok=${ok}, miss=${miss}/${events.length}`);
  return out;
}

// ── Public: historical N-day fetch (parallel-bounded) ────────────────────────
// Returns Map<symbol, BhavcopyRow[]> sorted oldest-first. Used by callers
// that need to compute moving averages from bhavcopy instead of Yahoo.
export async function fetchHistoricalBhavcopy(
  days: number,
  symbols: string[],
  today?: Date,
): Promise<Map<string, BhavcopyRow[]>> {
  const wanted = new Set(symbols.map(s => s.toUpperCase().replace(/\.NS$/i, '')));
  const out = new Map<string, BhavcopyRow[]>();
  for (const s of wanted) out.set(s, []);

  const start = today ?? new Date();
  // Bound concurrency to 4 — NSE rate-limits aggressively.
  const queue: Date[] = [];
  let walked = 0;
  while (walked < days * 1.4 && queue.length < days) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() - walked);
    queue.push(d);
    walked++;
  }

  const CONCURRENCY = 4;
  for (let i = 0; i < queue.length; i += CONCURRENCY) {
    const chunk = queue.slice(i, i + CONCURRENCY);
    const maps = await Promise.all(chunk.map((d) => fetchBhavcopy(d)));
    for (const m of maps) {
      if (!m) continue;
      for (const sym of wanted) {
        const r = m.get(sym);
        if (r) out.get(sym)!.push(r);
      }
    }
    // small pause to keep NSE happy
    await new Promise((r) => setTimeout(r, 250));
  }

  // sort each oldest-first
  for (const arr of out.values()) {
    arr.sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  return out;
}

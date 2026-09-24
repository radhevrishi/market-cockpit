// ═══════════════════════════════════════════════════════════════════════════
// US PORTFOLIO BOOK — IMPORT PARSING.                                (zzz790)
//
// Pure: text in, holdings + cash out. No network, no KV, no React, so every
// rule below is tested without a browser (src/lib/__tests__/zzz790-us-*).
//
// Three input shapes are accepted, auto-detected:
//   1. The book CSV       ticker,exchange,currency,quantity,avg_price
//                         with CASH rows (amount in `quantity`, or in
//                         `avg_price` when quantity is blank).
//   2. IBKR positions     any tab/comma/semicolon table whose header names a
//                         symbol ("Symbol" / "Financial Instrument"), a
//                         position ("Position" / "Quantity") and a cost
//                         ("Avg Price" / "Avg Cost" / "Cost Price").
//   3. IBKR activity      the statement CSV — "Open Positions,Data,…" rows
//      statement         and "Cash Report,Data,Ending Cash,<CUR>,<total>".
//
// TICKERS. Share classes arrive as "MOG A" (IBKR), "MOG.A" (brokers) or
// "MOG/A"; the SEC company list spells them "MOG-A". The book keeps the SEC
// spelling so a holding and its EDGAR filer are one key, and remembers what
// was typed.
//
// LISTINGS. A Frankfurt (FWB2) line is KEPT — it is money in the book — but
// marked NON_US: it has no SEC filer, so the catalyst engine excludes it and
// says why, never silently.
//
// CASH IS NEVER A HOLDING. It is returned in its own map, per currency
// (USD, EUR, BASE, …), and the page shows it apart from positions.
// ═══════════════════════════════════════════════════════════════════════════

export type UsListing = 'US' | 'NON_US';

export interface UsHoldingInput {
  /** Canonical: uppercase, share class joined with '-' (the SEC spelling). */
  ticker: string;
  /** As it appeared in the import, for the audit line. */
  rawTicker: string;
  /** Normalised upper-case venue code ("NASDAQ", "NYSE", "FWB2"), or '' when not stated. */
  exchange: string;
  currency: string;
  quantity: number;
  /** Average cost per share in `currency`. Null when the import did not carry one. */
  avgPrice: number | null;
  listing: UsListing;
  /** Why the listing is what it is — shown on the page. */
  listingNote: string;
}

export type UsCash = Record<string, number>;

export interface UsImportRejected { line: number; text: string; reason: string }

export interface UsImportResult {
  format: 'book-csv' | 'ibkr-positions' | 'ibkr-activity' | 'unknown';
  holdings: UsHoldingInput[];
  cash: UsCash;
  warnings: string[];
  rejected: UsImportRejected[];
}

// ── tickers ────────────────────────────────────────────────────────────────

const TICKER_OK = /^[A-Z0-9][A-Z0-9-]{0,11}$/;

/**
 * "MOG A" / "MOG.A" / "mog/a" / "MOG-A" → "MOG-A". "BRK B" → "BRK-B".
 * A bare ticker is upper-cased and trimmed. Returns '' for anything that is
 * not a ticker (so the caller rejects the line with a reason).
 */
export function normalizeUsTicker(raw: string | null | undefined): string {
  let t = String(raw ?? '').toUpperCase().trim().replace(/\s+/g, ' ');
  if (!t) return '';
  // A trailing class letter separated by space, dot, slash or dash.
  const m = /^([A-Z0-9]{1,8})[ ./-]([A-Z]{1,2})$/.exec(t);
  if (m) t = `${m[1]}-${m[2]}`;
  t = t.replace(/[./]/g, '-');
  return TICKER_OK.test(t) ? t : '';
}

// ── exchanges ──────────────────────────────────────────────────────────────

const US_VENUES = new Set([
  'NASDAQ', 'NMS', 'NASDAQ.NMS', 'NASDAQ.SCM', 'NASDAQGS', 'NASDAQGM', 'NASDAQCM', 'NGS', 'NGM', 'NCM', 'ISLAND',
  'NYSE', 'NEW YORK STOCK EXCHANGE', 'AMEX', 'NYSEAMERICAN', 'NYSE AMERICAN', 'NYSEMKT', 'NYSE MKT', 'ARCA', 'NYSEARCA',
  'NYSE ARCA', 'BATS', 'CBOE', 'CBOEBZX', 'BYX', 'IEX', 'SMART/NASDAQ', 'SMART/NYSE',
]);

/** Non-US venues this book is known to hold, with the words the page prints. */
const NON_US_VENUES: Record<string, string> = {
  FWB: 'Frankfurt Stock Exchange (FWB)', FWB2: 'Frankfurt Stock Exchange (FWB2)', FRA: 'Frankfurt Stock Exchange',
  IBIS: 'Xetra (IBIS)', IBIS2: 'Xetra (IBIS2)', XETRA: 'Xetra', GETTEX: 'gettex (Munich)', TGATE: 'Tradegate',
  SWB: 'Stuttgart', MUN: 'Munich', BER: 'Berlin', LSE: 'London Stock Exchange', LSEETF: 'London Stock Exchange (ETF)',
  SBF: 'Euronext Paris', AEB: 'Euronext Amsterdam', ENEXT: 'Euronext', EBS: 'SIX Swiss Exchange', BVME: 'Borsa Italiana',
  BM: 'Bolsa de Madrid', TSE: 'Toronto Stock Exchange', TSX: 'Toronto Stock Exchange', VENTURE: 'TSX Venture',
  ASX: 'Australian Securities Exchange', SEHK: 'Hong Kong Stock Exchange', TSEJ: 'Tokyo Stock Exchange',
};

export function normalizeExchange(raw: string | null | undefined): string {
  return String(raw ?? '').toUpperCase().trim().replace(/\s+/g, ' ');
}

/**
 * Which listing a line is. A US venue is US. A known foreign venue is NON_US
 * with its name. No venue stated: USD is taken as a US listing (said so),
 * any other currency as NON_US (said so) — never a silent guess.
 */
export function classifyListing(exchange: string, currency: string): { listing: UsListing; note: string } {
  const x = normalizeExchange(exchange);
  const cur = String(currency || '').toUpperCase().trim();
  if (x && US_VENUES.has(x)) return { listing: 'US', note: `US listing (${x})` };
  if (x && NON_US_VENUES[x]) {
    return { listing: 'NON_US', note: `${NON_US_VENUES[x]}, ${cur || 'currency not stated'} — not a US listing: no SEC filer, excluded from US catalyst evidence` };
  }
  if (x && /^(NASDAQ|NYSE)/.test(x)) return { listing: 'US', note: `US listing (${x})` };
  if (x) {
    return cur === 'USD'
      ? { listing: 'US', note: `venue ${x} not recognised; USD — treated as a US listing` }
      : { listing: 'NON_US', note: `venue ${x} (${cur || 'currency not stated'}) is not a US exchange — no SEC filer, excluded from US catalyst evidence` };
  }
  return cur === 'USD' || !cur
    ? { listing: 'US', note: 'exchange not stated; USD — treated as a US listing' }
    : { listing: 'NON_US', note: `exchange not stated; ${cur} — treated as a non-US listing (no SEC filer), excluded from US catalyst evidence` };
}

// ── numbers & rows ─────────────────────────────────────────────────────────

/** "1,343.50" / "$106.83" / "(12.5)" / "€26,06"? → number. European decimal
 *  commas are NOT guessed: "26,06" is read as 2606 only when it has 3 digits
 *  after the comma; otherwise the line is rejected rather than mis-read. */
export function parseNum(raw: string | null | undefined): number | null {
  let s = String(raw ?? '').trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s);
  s = s.replace(/[()$€£\s]/g, '').replace(/^[-+]/, '').replace(/^(USD|EUR|GBP)/i, '');
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else if (/,/.test(s)) return null;                         // ambiguous decimal comma
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

function splitLine(line: string, delim: string): string[] {
  if (delim === '\t') return line.split('\t').map((c) => c.trim());
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { out.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}

function detectDelim(line: string): string {
  const counts: Array<[string, number]> = [['\t', (line.match(/\t/g) || []).length], [',', (line.match(/,/g) || []).length], [';', (line.match(/;/g) || []).length]];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

const H = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
const SYMBOL_H = ['ticker', 'symbol', 'financialinstrument', 'instrument', 'contract', 'underlying'];
const EXCH_H = ['exchange', 'listingexchange', 'listingexch', 'primaryexchange', 'primaryexch', 'exch', 'market'];
const CUR_H = ['currency', 'ccy', 'curr'];
const QTY_H = ['quantity', 'qty', 'position', 'shares', 'pos', 'units'];
const AVG_H = ['avgprice', 'averageprice', 'avgcost', 'averagecost', 'costprice', 'avgcostprice', 'costbasisprice', 'averagecostprice', 'avgpx'];

function colOf(header: string[], names: string[]): number {
  const hs = header.map(H);
  for (const n of names) { const i = hs.indexOf(n); if (i >= 0) return i; }
  return -1;
}

/** "AKAM NASDAQ.NMS" / "MOG A" / "0ZQ FWB2" → symbol and venue. */
export function splitInstrument(s: string): { symbol: string; exchange: string } {
  const parts = String(s || '').trim().split(/\s+/);
  if (parts.length >= 2) {
    const last = normalizeExchange(parts[parts.length - 1]);
    if (US_VENUES.has(last) || NON_US_VENUES[last] || /^(NASDAQ|NYSE)/.test(last)) {
      return { symbol: parts.slice(0, -1).join(' '), exchange: last };
    }
  }
  return { symbol: String(s || '').trim(), exchange: '' };
}

const CASH_WORD = /^(CASH|USD\.CASH|EUR\.CASH|CASH\s*BALANCE|TOTAL\s*CASH)$/i;

function addCash(cash: UsCash, cur: string, amt: number) {
  const k = String(cur || 'USD').toUpperCase().trim() || 'USD';
  cash[k] = Math.round(((cash[k] || 0) + amt) * 100) / 100;
}

/** One holding line into the result (merging duplicates with a weighted average). */
function pushHolding(res: UsImportResult, raw: string, exchange: string, currency: string, qty: number | null, avg: number | null, lineNo: number, text: string) {
  const ticker = normalizeUsTicker(raw);
  if (!ticker) { res.rejected.push({ line: lineNo, text, reason: `"${raw}" is not a ticker` }); return; }
  if (qty == null || qty === 0) { res.rejected.push({ line: lineNo, text, reason: `${ticker}: quantity missing or zero` }); return; }
  const cur = String(currency || '').toUpperCase().trim() || (classifyListing(exchange, '').listing === 'US' ? 'USD' : '');
  const x = normalizeExchange(exchange);
  const { listing, note } = classifyListing(x, cur);
  const same = res.holdings.find((h) => h.ticker === ticker && h.exchange === x && h.currency === cur);
  if (same) {
    const q = same.quantity + qty;
    same.avgPrice = same.avgPrice != null && avg != null && q !== 0 ? Math.round(((same.avgPrice * same.quantity + avg * qty) / q) * 10000) / 10000 : (same.avgPrice ?? avg);
    same.quantity = q;
    res.warnings.push(`${ticker} appeared twice on ${x || 'an unstated venue'} — quantities summed, average cost weighted`);
    return;
  }
  res.holdings.push({ ticker, rawTicker: String(raw).trim(), exchange: x, currency: cur || 'USD', quantity: qty, avgPrice: avg, listing, listingNote: note });
  if (ticker !== String(raw).toUpperCase().trim()) res.warnings.push(`${String(raw).trim()} normalised to ${ticker} (the SEC spelling)`);
}

// ── format 3: IBKR activity statement ──────────────────────────────────────

function parseActivity(lines: string[], res: UsImportResult) {
  let posHead: string[] | null = null;
  let cashHead: string[] | null = null;
  lines.forEach((line, i) => {
    const c = splitLine(line, ',');
    if (c[0] === 'Open Positions' && c[1] === 'Header') { posHead = c; return; }
    if (c[0] === 'Cash Report' && c[1] === 'Header') { cashHead = c; return; }
    if (c[0] === 'Open Positions' && c[1] === 'Data' && posHead) {
      const h = posHead as string[];
      const disc = c[colOf(h, ['datadiscriminator'])] || 'Summary';
      if (disc && disc !== 'Summary') return;                 // lots repeat the summary line
      const cat = c[colOf(h, ['assetcategory'])] || '';
      if (cat && (!/stock|etf|equit/i.test(cat) || /option|future|bond|warrant|forex|cfd/i.test(cat))) { res.warnings.push(`line ${i + 1}: ${cat} position skipped (stocks only)`); return; }
      const sym = c[colOf(h, ['symbol'])];
      const cur = c[colOf(h, ['currency'])];
      const qty = parseNum(c[colOf(h, ['quantity'])]);
      const avg = parseNum(c[colOf(h, ['costprice', 'avgprice', 'averageprice'])]);
      const ex = colOf(h, ['listingexchange', 'exchange']);
      pushHolding(res, sym, ex >= 0 ? c[ex] : '', cur, qty, avg, i + 1, line);
      return;
    }
    if (c[0] === 'Cash Report' && c[1] === 'Data') {
      const h = (cashHead as string[] | null) || ['Cash Report', 'Header', 'Currency Summary', 'Currency', 'Total'];
      const what = c[2] || '';
      if (!/^ending (settled )?cash$/i.test(what)) return;
      const cur = c[colOf(h, ['currency'])] || c[3];
      const amt = parseNum(c[colOf(h, ['total'])] ?? c[4]);
      if (amt == null) { res.rejected.push({ line: i + 1, text: line, reason: 'cash amount not readable' }); return; }
      addCash(res.cash, /base/i.test(cur) ? 'BASE' : cur, amt);
    }
  });
}

// ── formats 1 & 2: a header + rows table ───────────────────────────────────

function parseTable(lines: string[], res: UsImportResult): boolean {
  const hi = lines.findIndex((l) => { const d = detectDelim(l); const h = splitLine(l, d); return colOf(h, SYMBOL_H) >= 0 && colOf(h, QTY_H) >= 0; });
  if (hi < 0) return false;
  const delim = detectDelim(lines[hi]);
  const head = splitLine(lines[hi], delim);
  const iSym = colOf(head, SYMBOL_H), iEx = colOf(head, EXCH_H), iCur = colOf(head, CUR_H), iQty = colOf(head, QTY_H), iAvg = colOf(head, AVG_H);
  const hs = head.map(H);
  res.format = hs.includes('ticker') && hs.includes('avgprice') ? 'book-csv' : 'ibkr-positions';
  if (iAvg < 0) res.warnings.push('no average-cost column found — P&L cannot be computed for these holdings');
  for (let i = hi + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const c = splitLine(line, delim);
    if (c.every((x) => !x)) continue;
    const symCell = c[iSym] || '';
    const cur = iCur >= 0 ? (c[iCur] || '') : '';
    // CASH rows: the amount is in `quantity`, else in the cost column.
    if (CASH_WORD.test(symCell.trim()) || (!symCell.trim() && /cash/i.test(line))) {
      const amt = parseNum(c[iQty]) ?? (iAvg >= 0 ? parseNum(c[iAvg]) : null);
      if (amt == null) { res.rejected.push({ line: i + 1, text: line, reason: 'CASH row without a readable amount' }); continue; }
      const k = /^USD\.CASH$/i.test(symCell) ? 'USD' : /^EUR\.CASH$/i.test(symCell) ? 'EUR' : (cur || 'USD');
      addCash(res.cash, /base/i.test(k) ? 'BASE' : k, amt);
      continue;
    }
    if (/^(total|totals|subtotal|summary)\b/i.test(symCell.trim())) continue;
    const inst = iEx >= 0 && c[iEx] ? { symbol: symCell, exchange: c[iEx] } : splitInstrument(symCell);
    const qty = parseNum(c[iQty]);
    const avg = iAvg >= 0 ? parseNum(c[iAvg]) : null;
    if (iAvg >= 0 && c[iAvg] && avg == null) res.warnings.push(`line ${i + 1}: average cost "${c[iAvg]}" not readable — kept without cost`);
    pushHolding(res, inst.symbol, inst.exchange, cur, qty, avg, i + 1, line);
  }
  return true;
}

/** Auto-detects the format and parses. Never throws. */
export function parseUsBookImport(text: string): UsImportResult {
  const res: UsImportResult = { format: 'unknown', holdings: [], cash: {}, warnings: [], rejected: [] };
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
  if (lines.some((l) => /^Open Positions,(Header|Data),/.test(l) || /^Cash Report,(Header|Data),/.test(l))) {
    res.format = 'ibkr-activity';
    parseActivity(lines, res);
    return res;
  }
  if (!parseTable(lines, res)) {
    res.warnings.push('No header row found. Expected ticker,exchange,currency,quantity,avg_price (or an IBKR positions table with Symbol / Position / Avg Price).');
  }
  return res;
}

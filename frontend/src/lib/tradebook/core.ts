// ═══════════════════════════════════════════════════════════════════════════
// zzz1231 — TRADEBOOK ENGINE (Zerodha equity tradebook). Pure: no fetch, no DB.
//
// The owner (7 Nov 2026): "if I upload the tradebook it should calculate my
// XIRR this year and overall, update my portfolio stocks and quantities
// automatically, performance vs Nifty Smallcap 100, trailing returns, returns
// by year, dividends by year, trades / P&L (STCG, LTCG, intraday, win rate,
// best / worst, profit factor, median hold). Duplicate files are ignored;
// uploads add up (November, then December)."
//
// HOW EACH NUMBER IS MADE
//   instrument     the ISIN (a symbol can change; NSE and BSE trades of one
//                  company are one position). Shown under its latest symbol.
//   splits/bonus   a tradebook has no corporate actions, so every trade is put
//                  into TODAY'S share units with the split / bonus ratios Yahoo
//                  reports (Yahoo's closes and dividends are in those units).
//                  Money (qty × price) is unchanged.
//   intraday       shares bought AND sold in the same instrument on the same
//                  day are matched first (speculative income in Indian tax);
//                  the rest is delivery.
//   lots / P&L     delivery sells are matched to the oldest buys (FIFO).
//                  Held more than 12 months = LTCG, else STCG. A sell with no
//                  earlier buy in the uploaded files is "unmatched" (bought
//                  before the first file, or received outside the market) —
//                  counted, never given a made-up cost.
//   cash flows     buy = money out, sell = money in, on the trade date.
//                  Brokerage, STT and other charges are NOT in a tradebook.
//   value on a day open shares × that day's close (last close on or before);
//                  when no price is known, the instrument's last trade price,
//                  and the result is marked estimated.
//   XIRR           the annual rate that makes all dated flows (and the value
//                  at the start / end of the window) net to zero.
//   benchmark      the same flows put into the index on the same days (PME):
//                  what the money would be worth in Nifty Smallcap 100.
//   dividends      shares held at the close before each ex-date × the dividend
//                  per share (Yahoo). An estimate — tax and record-date details
//                  are not in the data.
// ═══════════════════════════════════════════════════════════════════════════

export interface Trade {
  key: string;            // exchange|date|trade id|order id — what makes a trade unique across files
  isin: string; symbol: string; date: string;   // YYYY-MM-DD
  exchange: string; segment: string; side: 'buy' | 'sell';
  qty: number; price: number;
  orderId: string; tradeId: string; time: string | null;
}
export interface Split { t: number; ratio: number }
export type PnlKind = 'STCG' | 'LTCG' | 'INTRADAY';
export interface Realized {
  isin: string; symbol: string; buyDate: string; sellDate: string;
  qty: number; buyPx: number; sellPx: number; pnl: number; days: number; kind: PnlKind;
  demerged?: boolean;   // zzz1239 — shares received in a demerger: no cost of their own (it stays with the parent)
}
export interface Lot { date: string; qty: number; px: number }
export interface Position {
  isin: string; symbol: string; qty: number; avgCost: number; cost: number;
  lots: Lot[]; firstBuy: string | null;
  unmatchedSellQty: number;   // sold without an earlier buy in the files
}
export interface Flow { t: number; amt: number }

const DAY = 86_400_000;
export const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const r2 = (v: number) => Math.round(v * 100) / 100;

// ── parsing ────────────────────────────────────────────────────────────────

const cell = (v: unknown) => (v == null ? '' : String(v).trim());
function excelDate(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 20000 && v < 80000) return isoDay(Math.round((v - 25569) * DAY));
  const s = cell(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s);
  if (d) return `${d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`;
  return null;
}

/**
 * zzz1240 — what makes a trade the same trade in two downloads: exchange + date + trade ID + order ID. Not the ISIN (Zerodha
 * fills it on some downloads and not others) and not the price text. The owner re-downloads the current year's file as it
 * grows; every earlier trade must match itself so only the new ones are added. The SQL in db-migrate (migration 13) builds
 * the same string — keep the two in step.
 */
export function tradeIdentity(t: { exchange: string; date: string; tradeId: string; orderId: string; time: string | null; side: string; qty: number; price: number }): string {
  return t.tradeId ? `${t.exchange}|${t.date}|T${t.tradeId}|O${t.orderId}` : `${t.exchange}|${t.date}|O${t.orderId}|${t.time || ''}|${t.side}|${t.qty}|${t.price}`;
}

/** Sheet rows (arrays) → trades. Finds the header row ("Symbol", "Trade Date"…) wherever it sits. */
export function parseTradebookRows(rows: unknown[][]): { trades: Trade[]; skipped: number; from: string | null; to: string | null } {
  let h = -1;
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const r = (rows[i] || []).map((x) => cell(x).toLowerCase());
    if (r.includes('symbol') && r.includes('trade date') && r.includes('quantity')) { h = i; break; }
  }
  if (h < 0) return { trades: [], skipped: 0, from: null, to: null };
  const head = (rows[h] || []).map((x) => cell(x).toLowerCase());
  const col = (...names: string[]) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
  const C = {
    sym: col('symbol'), isin: col('isin'), date: col('trade date'), ex: col('exchange'), seg: col('segment'),
    type: col('trade type'), qty: col('quantity'), px: col('price'), tid: col('trade id'), oid: col('order id'), time: col('order execution time'),
  };
  const trades: Trade[] = [];
  let skipped = 0;
  for (const r of rows.slice(h + 1)) {
    if (!r || !r.length) continue;
    const symbol = cell(r[C.sym]).toUpperCase();
    const date = excelDate(r[C.date]);
    const side = cell(r[C.type]).toLowerCase();
    const qty = Number(r[C.qty]), price = Number(r[C.px]);
    if (!symbol || !date || (side !== 'buy' && side !== 'sell') || !(qty > 0) || !(price > 0)) { if (symbol || date) skipped++; continue; }
    const exchange = cell(r[C.ex]).toUpperCase() || 'NSE';
    const tradeId = cell(r[C.tid]), orderId = cell(r[C.oid]);
    const isin = cell(r[C.isin]).toUpperCase() || `SYM:${symbol}`;
    const t = {
      key: '', isin, symbol, date, exchange, segment: cell(r[C.seg]).toUpperCase() || 'EQ', side: side as 'buy' | 'sell',
      qty, price, orderId, tradeId, time: cell(r[C.time]) || null,
    };
    t.key = tradeIdentity(t);
    trades.push(t);
  }
  const ds = trades.map((t) => t.date).sort();
  return { trades, skipped, from: ds[0] ?? null, to: ds[ds.length - 1] ?? null };
}

// ── one company = one instrument (zzz1239) ──────────────────────────────────────
//
// Three things split one company into several "instruments" before:
//   1. Zerodha leaves the ISIN empty on many BSE trades (FY25 / FY26 files) — the BSE buys and the NSE sells were two
//      positions, so every NSE sell looked "sold without a buy" and the BSE buys stayed open for ever.
//   2. A face-value split gives the shares a NEW ISIN (INE262H01013 → INE262H01021): buys before the split and sells
//      after it did not meet. The issuer part of the ISIN (first 9 characters, "01" = equity shares) does not change.
//   3. Renames, mergers and demergers between two different ISINs (Mindtree → LTIMindtree, Suven → Cohance,
//      Tata Motors → TMCV …), listed below.

/** Company key: an Indian equity ISIN without its serial / check digits (a split keeps the company, changes the serial). */
export function companyKey(isin: string): string {
  return /^INE[A-Z0-9]{4}01[A-Z0-9]{3}$/.test(isin) ? isin.slice(0, 9) : isin;
}

/** Symbol renames where the exchange gave the new name no ISIN in the files (same company, same shares). */
export const SYMBOL_ALIASES: Record<string, string> = { COHANCE: 'SUVENPHAR' };

/** Mergers into another company's shares: each old share became `ratio` new shares on `date`. */
export const MERGERS: Array<{ from: string; to: string; date: string; ratio: number; note: string }> = [
  { from: 'MINDTREE', to: 'LTIM', date: '2022-11-24', ratio: 0.73, note: 'Mindtree merged into LTIMindtree, 73 shares for 100' },
];

/** Demergers: shares of `child` arrived for shares of `parent` (outside the market, no trade). Cost stays with the parent. */
export const DEMERGERS: Record<string, { parent: string; note: string }> = {
  JIOFIN: { parent: 'RELIANCE', note: 'Jio Financial demerged from Reliance (1 for 1, Jul 2023)' },
  ATL: { parent: 'ALLCARGO', note: 'Allcargo Terminals demerged from Allcargo' },
  TREL: { parent: 'ALLCARGO', note: 'Transindia Real Estate demerged from Allcargo' },
  TMCV: { parent: 'TATAMOTORS', note: 'Tata Motors commercial vehicles demerged (1 for 1, Oct 2025)' },
};

/**
 * Trades with one key per company: a missing ISIN is taken from the same symbol's trades nearest in time (or from the
 * NSE company list via `isinOfSymbol`), ISINs are cut to the company key, mergers are put into the new company's shares.
 */
export function normalizeTrades(tradesIn: Trade[], isinOfSymbol?: (symbol: string) => string | null): Trade[] {
  const bySym = new Map<string, Array<{ t: number; isin: string }>>();
  for (const t of tradesIn) if (t.isin && !t.isin.startsWith('SYM:')) {
    const a = bySym.get(t.symbol) || []; a.push({ t: dayMs(t.date), isin: t.isin }); bySym.set(t.symbol, a);
  }
  const isinFor = (sym: string, date: string): string | null => {
    const c = bySym.get(sym);
    if (c?.length) { const d = dayMs(date); return c.reduce((b, x) => (Math.abs(x.t - d) < Math.abs(b.t - d) ? x : b)).isin; }
    return isinOfSymbol?.(sym) ?? null;
  };
  const merged = new Map(MERGERS.map((m) => [m.from, m]));
  return tradesIn.map((t) => {
    let isin = t.isin, symbol = t.symbol, qty = t.qty, price = t.price;
    if (!isin || isin.startsWith('SYM:')) {
      const alias = SYMBOL_ALIASES[symbol];
      isin = isinFor(symbol, t.date) ?? (alias ? isinFor(alias, t.date) : null) ?? `SYM:${symbol}`;
    }
    const m = merged.get(symbol);
    if (m && t.date < m.date) {
      const to = isinFor(m.to, t.date) ?? `SYM:${m.to}`;
      isin = to; qty = t.qty * m.ratio; price = t.price / m.ratio;   // in the new company's shares; money unchanged
    }
    return { ...t, isin: companyKey(isin), symbol, qty, price };
  });
}

/**
 * zzz1239 — a face-value split read from the files themselves, for when the price source has no record of it: the
 * company's ISIN changes serial, and the last trade price before ÷ the first after is close to a split ratio (2, 2.5,
 * 4, 5, 10, 20 — within 12%, the two trades at most 120 days apart). Returned per company key, dated the first new-ISIN day.
 */
export function inferIsinSplits(raw: Trade[]): Map<string, Split[]> {
  const by = new Map<string, Trade[]>();
  for (const t of raw) {
    if (!/^INE[A-Z0-9]{4}01[A-Z0-9]{3}$/.test(t.isin)) continue;
    const k = companyKey(t.isin); const a = by.get(k) || []; a.push(t); by.set(k, a);
  }
  const out = new Map<string, Split[]>();
  const RATIOS = [2, 2.5, 4, 5, 10, 20];
  for (const [k, ts] of by) {
    const isins = Array.from(new Set(ts.map((t) => t.isin)));
    if (isins.length < 2) continue;
    const sorted = ts.slice().sort((a, b) => a.date.localeCompare(b.date));
    const splits: Split[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1], b = sorted[i];
      if (a.isin === b.isin || b.isin < a.isin) continue;   // serials go up at a split
      if (dayMs(b.date) - dayMs(a.date) > 120 * DAY) continue;
      const r = a.price / b.price;
      const hit = RATIOS.find((x) => Math.abs(r / x - 1) <= 0.12);
      if (hit && !splits.some((s) => s.t === dayMs(b.date))) splits.push({ t: dayMs(b.date), ratio: hit });
    }
    if (splits.length) out.set(k, splits);
  }
  return out;
}

// ── zzz1242 — splits checked against the price history ──────────────────────
//
// The book is valued with the price source's closes, which are already adjusted for every split and bonus. A trade's
// price ÷ that day's adjusted close is therefore the number of today's shares one traded share became — 1 after the
// last split, 2 before a 1:1 bonus, 4.5 before a 1:2 bonus followed by a 1:2 split … When the price source's split list
// does not explain that (a split missing, listed twice, on the wrong day or with the wrong ratio), quantity × price no
// longer equals the money paid and the book's value at a year end goes wrong while the totals still agree (the owner's
// FY25 showed +₹5.3 L, FY26 −₹4.6 L, against ≈ +₹2.1 L and −₹0.5 L in another tool). Then the units are read from
// the trades themselves.

/** Split / bonus ratios (and the usual pairs, e.g. 1:2 bonus then 1:2 split = 4.5). */
export const SPLIT_LEVELS = [1, 1.25, 4 / 3, 1.5, 2, 2.5, 3, 4, 4.5, 5, 6, 10, 20];
/** The split level a price ratio stands for, or null when it is not within 12% of one (an intraday move, a bad print). */
export function splitLevel(r: number, tol = 0.12): number | null {
  if (!(r > 0) || !Number.isFinite(r)) return null;
  let best: number | null = null, e = tol;
  for (const n of SPLIT_LEVELS) { const d = Math.abs(Math.log(r / n)); if (d <= e) { e = d; best = n; } }
  return best;
}

type TradeLite = Pick<Trade, 'date' | 'price' | 'qty' | 'side'>;

/**
 * zzz1243 — one reading per trading day: the day's quantity-weighted trade price ÷ that day's adjusted close ÷ the split
 * factor, as a split level (null when it is not near one). A single trade at the open of a day the stock fell 20%
 * (SHARDACROP: ₹1,080 at the open, close ₹958) is not a 1:4 bonus — the day's average (₹963) is ≈ 1.
 */
function dayLevels(trades: ReadonlyArray<TradeLite>, closeOn: (t: number) => number | null, splits?: Split[]): Array<{ t: number; lvl: number | null; inv: number | null }> {
  const by = new Map<string, { q: number; v: number }>();
  for (const t of trades) { if (!(t.price > 0) || !(t.qty > 0)) continue; const x = by.get(t.date) || { q: 0, v: 0 }; x.q += t.qty; x.v += t.qty * t.price; by.set(t.date, x); }
  const out: Array<{ t: number; lvl: number | null; inv: number | null }> = [];
  for (const d of Array.from(by.keys()).sort()) {
    const c = closeOn(dayMs(d));
    if (!c || !(c > 0)) continue;
    const r = by.get(d)!.v / by.get(d)!.q / c / splitFactor(d, splits);
    out.push({ t: dayMs(d), lvl: splitLevel(r), inv: splitLevel(1 / r) });
  }
  return out;
}

/**
 * Does `splits` fail to explain the priced trades? A trading day whose average price ÷ adjusted close ÷ split factor is
 * still ≥ 1.5× (or ≤ 1 / 1.5×) away from 1 is a unit mismatch — an intraday move does not do that. Smaller levels
 * (1.25, 1.33 — a 1:4 or 1:3 bonus) count only on at least two trading days and 10% of them.
 */
export function splitsMismatch(trades: ReadonlyArray<TradeLite>, closeOn: (t: number) => number | null, splits: Split[] | undefined): boolean | null {
  const days = dayLevels(trades, closeOn, splits);
  if (!days.length) return null;
  let small = 0;
  for (const d of days) {
    const lvl = Math.max(d.lvl ?? 1, d.inv ?? 1);
    if (lvl >= 1.5) return true;
    if (lvl > 1) small++;
  }
  return small >= 2 && small >= 0.1 * days.length;
}

/**
 * Splits of ONE instrument read from its trades and the adjusted closes (`closeOn(t)`, null before the history starts),
 * one reading per trading day. Levels can only fall over time (a split adds shares), so a reading above the current level
 * is noise. A fall is a split when it is ≥ 1.5×, or — for 1.25 / 1.33 — when the old level was seen on at least two days
 * and the new one holds on the next reading too. Dated the first day in the new units (or the price source's own date when
 * it lists one in between). A level still above 1 at the last reading is a split after it. Null when no trade has a close.
 */
export function splitsFromPrices(trades: ReadonlyArray<TradeLite>, closeOn: (t: number) => number | null, events?: Split[]): { splits: Split[]; firstPricedT: number } | null {
  const days = dayLevels(trades, closeOn).filter((d) => d.lvl != null) as Array<{ t: number; lvl: number }>;
  if (!days.length) return null;
  const evDate = (from: number, to: number, ratio: number) => (events || []).find((s) => s.t > from && s.t <= to && Math.abs(Math.log(s.ratio / ratio)) < 0.12)?.t;
  const out: Split[] = [];
  let cur = days[0].lvl, curT = days[0].t, seen = 1;
  for (let i = 1; i < days.length; i++) {
    const d = days[i];
    if (Math.abs(d.lvl - cur) < 1e-9) { curT = d.t; seen++; continue; }
    if (d.lvl > cur) continue;   // noise: units never go back up
    const r = splitLevel(cur / d.lvl, 0.02) ?? cur / d.lvl;
    const next = days[i + 1];
    const holds = !next || next.lvl <= d.lvl + 1e-9;
    if (r < 1.5 && (seen < 2 || !holds)) continue;
    if (r >= 1.5 && !holds && next && next.lvl >= cur - 1e-9) continue;   // one odd day between two normal ones
    out.push({ t: evDate(curT, d.t, r) ?? d.t, ratio: r });
    cur = d.lvl; curT = d.t; seen = 1;
  }
  if (cur > 1.2 && (cur >= 1.5 || seen >= 2)) out.push({ t: evDate(curT, Infinity, cur) ?? curT + DAY, ratio: cur });
  return { splits: out, firstPricedT: days[0].t };
}

/**
 * A split read from the trade prices alone, for days with no price history (a company listed on NSE only later): the
 * price falls to about 1 / ratio between two trades (≤ 60 days apart, ratio ≥ 1.5) while shares are held, AND without the
 * split the later sells would exceed what was bought. SIKA: 23 held at ₹2,505, then 115 sold at ₹520–536 (a 1:5 split).
 */
export function splitsFromTradeGaps(trades: ReadonlyArray<TradeLite>): Split[] {
  const days = new Map<string, { bq: number; sq: number; v: number; q: number }>();
  for (const t of trades) { const x = days.get(t.date) || { bq: 0, sq: 0, v: 0, q: 0 }; if (t.side === 'buy') x.bq += t.qty; else x.sq += t.qty; x.v += t.qty * t.price; x.q += t.qty; days.set(t.date, x); }
  const ds = Array.from(days.keys()).sort();
  const out: Split[] = [];
  let held = 0;
  for (let i = 0; i < ds.length; i++) {
    const d = days.get(ds[i])!;
    if (i > 0 && held > 1e-9 && d.q > 0) {
      const p = days.get(ds[i - 1])!;
      const pr = p.q > 0 ? (p.v / p.q) / (d.v / d.q) : 0;
      if (pr >= 1.35 && splitLevel(pr, 0.15) && dayMs(ds[i]) - dayMs(ds[i - 1]) <= 60 * DAY) {
        // the deepest the holding would go below zero without a split → the ratio the quantities need
        let run = held, low = held;
        for (let j = i; j < ds.length; j++) { const x = days.get(ds[j])!; run += x.bq - x.sq; low = Math.min(low, run); }
        if (low < -0.5) {
          const need = (held - low) / held;
          // the split level nearest to what the quantities need, among those the price fall allows
          const cands = SPLIT_LEVELS.filter((n) => n >= 1.5 && Math.abs(Math.log(pr / n)) <= 0.25);
          const r = cands.sort((a, b) => Math.abs(Math.log(need / a)) - Math.abs(Math.log(need / b)))[0];
          if (r) { out.push({ t: dayMs(ds[i]), ratio: r }); held *= r; }
        }
      }
    }
    held = Math.max(0, held + d.bq - d.sq);
  }
  return out;
}

/**
 * zzz1242 — the splits used for one instrument. The price source's list (plus splits read from an ISIN change) is kept
 * when it explains the priced trades (`splitsMismatch`). Otherwise, from the first priced trade on, the splits are read from the
 * prices; before it, the price source's list, ISIN changes and price gaps in the trades are used. `source` says which.
 */
export function splitsForInstrument(trades: ReadonlyArray<TradeLite>, closeOn: (t: number) => number | null, events: Split[] | undefined, isinSplits: Split[] | undefined): { splits: Split[] | undefined; source: 'price-source' | 'trades' } {
  const listed: Split[] = [...(events || [])];
  for (const s of isinSplits || []) if (!listed.some((x) => Math.abs(x.t - s.t) <= 45 * DAY)) listed.push(s);
  listed.sort((a, b) => a.t - b.t);
  const pr = splitsMismatch(trades, closeOn, listed) ? splitsFromPrices(trades, closeOn, events) : null;
  if (!pr) {
    // no price for any trade, or the list fits: keep it, plus gaps on the unpriced days
    const extra = splitsFromTradeGaps(trades.filter((t) => { const c = closeOn(dayMs(t.date)); return !c; })).filter((s) => !listed.some((x) => Math.abs(x.t - s.t) <= 45 * DAY));
    const all = [...listed, ...extra].sort((a, b) => a.t - b.t);
    return { splits: all.length ? all : undefined, source: 'price-source' };
  }
  const early = trades.filter((t) => dayMs(t.date) < pr.firstPricedT);
  const older = [...listed];
  for (const s of splitsFromTradeGaps(early)) if (!older.some((x) => Math.abs(x.t - s.t) <= 45 * DAY)) older.push(s);
  const all = [...older.filter((s) => s.t <= pr.firstPricedT), ...pr.splits].sort((a, b) => a.t - b.t);
  return { splits: all.length ? all : undefined, source: 'trades' };
}

/** Same trade in two files (or twice in one) → once. */
export function dedupeTrades(trades: Trade[]): Trade[] {
  const m = new Map<string, Trade>();
  for (const t of trades) { const k = tradeIdentity(t); if (!m.has(k)) m.set(k, t); }
  return Array.from(m.values());
}

// ── splits ───────────────────────────────────────────────────────────────────

/** Shares-after ÷ shares-before for every split / bonus AFTER the trade day (a trade on the ex-day is already in new units). */
export function splitFactor(date: string, splits: Split[] | undefined): number {
  if (!splits?.length) return 1;
  const t = dayMs(date);
  let f = 1;
  for (const s of splits) if (s.t > t && s.ratio > 0) f *= s.ratio;
  return f;
}

// ── the ledger ───────────────────────────────────────────────────────────────

const addYear = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return isoDay(Date.UTC(y + 1, m - 1, dd)); };
export function fyOf(d: string): string {   // 2026-11-07 → 'FY27' (Apr 2026 – Mar 2027)
  const [y, m] = d.split('-').map(Number);
  const end = m >= 4 ? y + 1 : y;
  return `FY${String(end).slice(2)}`;
}

export interface Ledger {
  positions: Position[];                          // open, qty > 0
  realized: Realized[];
  flows: Flow[];                                  // per trade day, summed
  qtyChanges: Map<string, Array<{ t: number; dq: number }>>;   // isin → dated changes in today's units
  lastPx: Map<string, Array<{ t: number; px: number }>>;       // isin → trade prices in today's units (fallback valuation)
  symbolOf: Map<string, string>;
  unmatched: Array<{ isin: string; symbol: string; date: string; qty: number }>;
  demerged: Array<{ symbol: string; parent: string; qty: number; date: string }>;
  costChanges: Array<{ t: number; d: number }>;   // zzz1242 — cost of the shares held: + on a buy, − the sold lots' cost
  firstDate: string | null; lastDate: string | null;
  tradeCount: number;
}

/**
 * `openPrice` — shares sold without an earlier buy in the files were already held when the first file starts. For RETURNS they
 * are counted as held from the first day at that day's price (money in at the start), so selling them is not free money.
 * They still get no P&L (their real cost is not in the files).
 */
export function buildLedger(tradesIn: Trade[], splitsOf: (isin: string) => Split[] | undefined = () => undefined, openPrice?: (isin: string, startT: number) => { t: number; px: number } | null): Ledger {
  const tradedSyms = new Set(tradesIn.map((t) => t.symbol));
  const demerged: Ledger['demerged'] = [];
  const trades = dedupeTrades(tradesIn).slice().sort((a, b) => a.date.localeCompare(b.date) || String(a.time || '').localeCompare(String(b.time || '')));
  const startT = trades.length ? dayMs(trades[0].date) : 0;
  const opening: Flow[] = [];
  const symbolOf = new Map<string, string>();
  for (const t of trades) {   // the latest symbol, NSE preferred on the same day
    const prev = symbolOf.get(t.isin);
    if (!prev || t.exchange === 'NSE' || !/^\d+$/.test(t.symbol)) symbolOf.set(t.isin, t.symbol);
  }
  // group by instrument and day
  const byIsin = new Map<string, Map<string, { bq: number; bv: number; sq: number; sv: number }>>();
  const flowsByDay = new Map<string, number>();
  for (const t of trades) {
    const f = splitFactor(t.date, splitsOf(t.isin));
    const q = t.qty * f, money = t.qty * t.price;
    let days = byIsin.get(t.isin); if (!days) byIsin.set(t.isin, (days = new Map()));
    let d = days.get(t.date); if (!d) days.set(t.date, (d = { bq: 0, bv: 0, sq: 0, sv: 0 }));
    if (t.side === 'buy') { d.bq += q; d.bv += money; } else { d.sq += q; d.sv += money; }
    flowsByDay.set(t.date, (flowsByDay.get(t.date) || 0) + (t.side === 'buy' ? -money : money));
  }
  const positions: Position[] = [];
  const realized: Realized[] = [];
  const qtyChanges = new Map<string, Array<{ t: number; dq: number }>>();
  const lastPx = new Map<string, Array<{ t: number; px: number }>>();
  const unmatched: Ledger['unmatched'] = [];
  const costCh: Array<{ t: number; d: number }> = [];
  for (const [isin, days] of byIsin) {
    const symbol = symbolOf.get(isin) || isin;
    const lots: Lot[] = [];
    let unmatchedQty = 0;
    const ch: Array<{ t: number; dq: number }> = [];
    const px: Array<{ t: number; px: number }> = [];
    let firstBuy: string | null = null;
    for (const date of Array.from(days.keys()).sort()) {
      const d = days.get(date)!;
      const bpx = d.bq > 0 ? d.bv / d.bq : 0, spx = d.sq > 0 ? d.sv / d.sq : 0;
      px.push({ t: dayMs(date), px: d.bq + d.sq > 0 ? (d.bv + d.sv) / (d.bq + d.sq) : 0 });
      if (d.bq > 0 && !firstBuy) firstBuy = date;
      // 1. same-day buy and sell = intraday
      const iq = Math.min(d.bq, d.sq);
      if (iq > 1e-9) realized.push({ isin, symbol, buyDate: date, sellDate: date, qty: r2(iq), buyPx: bpx, sellPx: spx, pnl: iq * (spx - bpx), days: 0, kind: 'INTRADAY' });
      const netBuy = d.bq - iq, netSell = d.sq - iq;
      if (netBuy > 1e-9) { lots.push({ date, qty: netBuy, px: bpx }); ch.push({ t: dayMs(date), dq: netBuy }); costCh.push({ t: dayMs(date), d: netBuy * bpx }); }
      if (netSell > 1e-9) {
        // 2. delivery sell — oldest lots first
        let left = netSell, sold = 0;
        while (left > 1e-9 && lots.length) {
          const lot = lots[0];
          const q = Math.min(lot.qty, left);
          const lt = date > addYear(lot.date);
          realized.push({
            isin, symbol, buyDate: lot.date, sellDate: date, qty: q, buyPx: lot.px, sellPx: spx, pnl: q * (spx - lot.px),
            days: Math.round((dayMs(date) - dayMs(lot.date)) / DAY), kind: lt ? 'LTCG' : 'STCG',
          });
          lot.qty -= q; left -= q; sold += q; costCh.push({ t: dayMs(date), d: -q * lot.px });
          if (lot.qty <= 1e-9) lots.shift();
        }
        if (sold > 0) ch.push({ t: dayMs(date), dq: -sold });
        // zzz1239 — shares received in a demerger (the parent was held): no money in, no cost of their own
        const dm = left > 1e-9 ? DEMERGERS[symbol] : undefined;
        if (left > 1e-9 && dm && tradedSyms.has(dm.parent)) {
          const op = openPrice?.(isin, startT) ?? null;
          const ot = op && op.t <= dayMs(date) ? op.t : dayMs(date);
          realized.push({ isin, symbol, buyDate: isoDay(ot), sellDate: date, qty: left, buyPx: 0, sellPx: spx, pnl: left * spx, days: Math.round((dayMs(date) - ot) / DAY), kind: 'STCG', demerged: true });
          ch.push({ t: ot, dq: left }, { t: dayMs(date), dq: -left });
          px.push({ t: ot, px: op?.px || spx });
          demerged.push({ symbol, parent: dm.parent, qty: r2(left), date });
          left = 0;
        }
        if (left > 1e-9) {
          unmatchedQty += left; unmatched.push({ isin, symbol, date, qty: r2(left) });
          // held since before the first file (or received later outside the market — a demerger, an IPO allotment): in the book
          // from the first day, or from its listing day when that is later, at that day's price (else the sell price)
          const op = openPrice?.(isin, startT) ?? null;
          const ot = op && op.t > startT && op.t <= dayMs(date) ? op.t : startT;
          const opx = op && op.px > 0 ? op.px : spx;
          ch.push({ t: ot, dq: left }, { t: dayMs(date), dq: -left });
          opening.push({ t: ot, amt: -left * opx });
          costCh.push({ t: ot, d: left * opx }, { t: dayMs(date), d: -left * opx });
          px.push({ t: ot, px: opx });   // a price for the days before its first trade in the files
        }
      }
    }
    ch.sort((a, b) => a.t - b.t);
    px.sort((a, b) => a.t - b.t);
    qtyChanges.set(isin, ch);
    lastPx.set(isin, px);
    // zzz1239 — a fraction of a share left by a split / bonus / merger ratio was paid out in cash, not held
    const whole = lots.reduce((s, l) => s + l.qty, 0);
    const dust = whole - Math.floor(whole + 1e-6);
    if (dust > 1e-6 && lots.length) {
      const lastT = Math.max(...Array.from(days.keys()).map(dayMs));
      ch.push({ t: lastT, dq: -dust });   // zzz1240 — and out of the book's value history, not only the holdings list
      ch.sort((a, b) => a.t - b.t);
      let d = dust; for (let i = lots.length - 1; i >= 0 && d > 1e-9; i--) { const q = Math.min(lots[i].qty, d); costCh.push({ t: lastT, d: -q * lots[i].px }); lots[i].qty -= q; d -= q; if (lots[i].qty <= 1e-9) lots.splice(i, 1); } }
    const qty = lots.reduce((s, l) => s + l.qty, 0);
    if (qty > 1e-6) {
      const cost = lots.reduce((s, l) => s + l.qty * l.px, 0);
      positions.push({ isin, symbol, qty: Math.round(qty * 1e4) / 1e4, avgCost: cost / qty, cost, lots: lots.map((l) => ({ ...l })), firstBuy, unmatchedSellQty: r2(unmatchedQty) });
    }
  }
  for (const o of opening) flowsByDay.set(isoDay(o.t), (flowsByDay.get(isoDay(o.t)) || 0) + o.amt);
  const flows = Array.from(flowsByDay.entries()).map(([d, amt]) => ({ t: dayMs(d), amt })).sort((a, b) => a.t - b.t);
  positions.sort((a, b) => b.cost - a.cost);
  return {
    positions, realized, flows, qtyChanges, lastPx, symbolOf, unmatched, demerged, costChanges: costCh.sort((a, b) => a.t - b.t),
    firstDate: trades[0]?.date ?? null, lastDate: trades[trades.length - 1]?.date ?? null, tradeCount: trades.length,
  };
}

/** Shares of one instrument held at the END of day t (today's units). */
export function qtyAt(l: Ledger, isin: string, t: number): number {
  let q = 0;
  for (const c of l.qtyChanges.get(isin) || []) { if (c.t > t) break; q += c.dq; }
  return q > 1e-9 ? q : 0;
}

// ── money maths ──────────────────────────────────────────────────────────────

/** Annual internal rate of return of dated flows (money out negative). Null when it does not exist. */
export function xirr(flowsIn: Flow[]): number | null {
  const flows = flowsIn.filter((f) => Number.isFinite(f.amt) && f.amt !== 0).sort((a, b) => a.t - b.t);
  if (flows.length < 2 || !flows.some((f) => f.amt > 0) || !flows.some((f) => f.amt < 0)) return null;
  const t0 = flows[0].t;
  const yrs = flows.map((f) => (f.t - t0) / (365 * DAY));
  const npv = (r: number) => flows.reduce((s, f, i) => s + f.amt / Math.pow(1 + r, yrs[i]), 0);
  let lo = -0.9999, hi = 10;
  let flo = npv(lo), fhi = npv(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi)) return null;
  if (flo * fhi > 0) { hi = 100; fhi = npv(hi); if (flo * fhi > 0) return null; }
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2, fm = npv(mid);
    if (Math.abs(fm) < 1e-7 || hi - lo < 1e-10) return mid;
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}

export type PriceAt = (isin: string, t: number) => number | null;

/** The book's value at the end of day t; `estimated` counts holdings valued at their last trade price. */
export function valueAt(l: Ledger, t: number, priceAt: PriceAt): { value: number; estimated: number; estimatedSymbols: string[] } {
  let value = 0, estimated = 0;
  const estimatedSymbols: string[] = [];
  for (const isin of l.qtyChanges.keys()) {
    const q = qtyAt(l, isin, t);
    if (!q) continue;
    let p = priceAt(isin, t);
    if (p == null || !(p > 0)) {
      const tp = (l.lastPx.get(isin) || []).filter((x) => x.t <= t && x.px > 0);
      p = tp.length ? tp[tp.length - 1].px : null;
      estimated++;
      estimatedSymbols.push(l.symbolOf.get(isin) || isin);
    }
    if (p) value += q * p;
  }
  return { value, estimated, estimatedSymbols };
}

/** zzz1242 — the largest holdings at the end of day t (what a period's end value is made of). */
export function holdingsAt(l: Ledger, t: number, priceAt: PriceAt, n = 8): WindowReturn['top'] {
  const out: WindowReturn['top'] = [];
  for (const isin of l.qtyChanges.keys()) {
    const q = qtyAt(l, isin, t);
    if (!q) continue;
    let p = priceAt(isin, t), estimated = false;
    if (p == null || !(p > 0)) { const tp = (l.lastPx.get(isin) || []).filter((x) => x.t <= t && x.px > 0); p = tp.length ? tp[tp.length - 1].px : null; estimated = true; }
    out.push({ symbol: l.symbolOf.get(isin) || isin, qty: Math.round(q * 100) / 100, price: p, value: p ? q * p : 0, estimated });
  }
  return out.sort((a, b) => b.value - a.value).slice(0, n);
}

/**
 * zzz1242 — the book day by day (weekdays): value, cost of the shares held, net money put in, and the same money in the
 * index. One pass, so ~1,200 days × the holdings of each day.
 */
export function dailySeries(l: Ledger, days: number[], priceAt: PriceAt, benchAt?: (t: number) => number | null): Array<{ d: string; value: number; cost: number; net: number; bench: number | null; ix: number | null }> {
  const isins = Array.from(l.qtyChanges.keys());
  const ptr = new Map<string, number>(), qty = new Map<string, number>();
  let ci = 0, cost = 0, fi = 0, net = 0, units = 0;
  const out: Array<{ d: string; value: number; cost: number; net: number; bench: number | null; ix: number | null }> = [];
  for (const t of days) {
    for (const isin of isins) {
      const ch = l.qtyChanges.get(isin)!;
      let i = ptr.get(isin) ?? 0, q = qty.get(isin) ?? 0;
      while (i < ch.length && ch[i].t <= t) { q += ch[i].dq; i++; }
      ptr.set(isin, i); qty.set(isin, q);
    }
    for (; ci < l.costChanges.length && l.costChanges[ci].t <= t; ci++) cost += l.costChanges[ci].d;
    for (; fi < l.flows.length && l.flows[fi].t <= t; fi++) { const f = l.flows[fi]; net -= f.amt; const ix = benchAt?.(f.t); if (ix) units += -f.amt / ix; }
    let value = 0;
    for (const [isin, q] of qty) {
      if (!(q > 1e-9)) continue;
      let p = priceAt(isin, t);
      if (p == null || !(p > 0)) { const tp = l.lastPx.get(isin) || []; let k = -1; for (let j = 0; j < tp.length && tp[j].t <= t; j++) if (tp[j].px > 0) k = j; p = k >= 0 ? tp[k].px : null; }
      if (p) value += q * p;
    }
    const ix = benchAt?.(t);
    out.push({ d: isoDay(t), value: Math.round(value), cost: Math.round(Math.max(0, cost)), net: Math.round(net), bench: ix ? Math.round(units * ix) : null, ix: ix ?? null });
  }
  return out;
}

export interface WindowReturn {
  label: string; from: string; to: string;
  startValue: number; endValue: number; invested: number; withdrawn: number;
  gain: number;                // end + withdrawn + dividends − start − invested
  dividends: number;           // zzz1242 — estimated cash dividends received inside the window (in the gain and the XIRR)
  top: Array<{ symbol: string; qty: number; price: number | null; value: number; estimated: boolean }>;   // zzz1242 — largest holdings at the end
  xirr: number | null;         // annual
  simple: number | null;       // Modified Dietz, for the window (not annualised)
  bench: { xirr: number | null; endValue: number; gain: number } | null;
  estimated: number;
  estimatedSymbols: string[];   // zzz1240 — held then, but valued at their last trade price (no price history)
  annualised: boolean;          // zzz1240 — false for a window under a year: xirr / bench.xirr are then the rate FOR the window
}

/** Returns over [from, to]: the book at the close before `from`, the trade flows inside, the book at `to`. */
export function windowReturn(l: Ledger, label: string, from: number, to: number, priceAt: PriceAt, benchAt?: (t: number) => number | null, divs?: Flow[]): WindowReturn {
  const start = valueAt(l, from - DAY, priceAt), end = valueAt(l, to, priceAt);
  const divIn = (divs || []).filter((f) => f.t >= from && f.t <= to && f.amt > 0);
  const dividends = divIn.reduce((s, f) => s + f.amt, 0);
  const inside = l.flows.filter((f) => f.t >= from && f.t <= to);
  const invested = -inside.filter((f) => f.amt < 0).reduce((s, f) => s + f.amt, 0);
  const withdrawn = inside.filter((f) => f.amt > 0).reduce((s, f) => s + f.amt, 0);
  const gain = end.value + withdrawn + dividends - start.value - invested;
  const flows: Flow[] = [...(start.value > 0 ? [{ t: from, amt: -start.value }] : []), ...inside, ...divIn, ...(end.value > 0 ? [{ t: to, amt: end.value }] : [])];
  const span = Math.max(1, to - from);
  // zzz1239 — an annual rate over a few days is meaningless (2 days of FY22 showed +1149% a year): under 60 days, none
  const shortWindow = to - from < 60 * DAY;
  // zzz1240 — under a year, an annual rate overstates (FY27 so far: +47% real, +88% "a year"); show the rate for the window itself
  const annualised = to - from >= 360 * DAY;
  const perWindow = (r: number | null) => (r == null || annualised ? r : Math.pow(1 + r, (to - from + DAY) / (365 * DAY)) - 1);
  const weighted = start.value + inside.reduce((s, f) => s + (-f.amt) * ((to - f.t) / span), 0);
  let bench: WindowReturn['bench'] = null;
  if (benchAt) {
    // the same money in the index on the same days (PME)
    const i0 = benchAt(from - DAY), i1 = benchAt(to);
    if (i0 && i1) {
      let units = start.value / i0;
      for (const f of inside) { const ix = benchAt(f.t); if (ix) units += -f.amt / ix; }
      const bEnd = units * i1;
      const bFlows: Flow[] = [...(start.value > 0 ? [{ t: from, amt: -start.value }] : []), ...inside, ...(bEnd > 0 ? [{ t: to, amt: bEnd }] : [{ t: to, amt: bEnd }])];
      bench = { xirr: shortWindow ? null : perWindow(xirr(bFlows)), endValue: bEnd, gain: bEnd + withdrawn - start.value - invested };
    }
  }
  return {
    label, from: isoDay(from), to: isoDay(to), startValue: start.value, endValue: end.value, invested, withdrawn, gain, dividends, top: holdingsAt(l, to, priceAt, 8),
    xirr: shortWindow ? null : perWindow(xirr(flows)), simple: weighted > 0 ? gain / weighted : null, bench, estimated: Math.max(start.estimated, end.estimated),
    estimatedSymbols: Array.from(new Set([...start.estimatedSymbols, ...end.estimatedSymbols])), annualised,
  };
}

// ── P&L analytics ───────────────────────────────────────────────────────────

export interface PnlStats {
  stcg: number; ltcg: number; intraday: number; total: number;
  trades: number; wins: number; losses: number; winRate: number | null;
  grossWin: number; grossLoss: number; profitFactor: number | null;
  avgWin: number | null; avgLoss: number | null; expectancy: number | null;
  medianHoldDays: number | null;
  best: Array<{ symbol: string; date: string; pnl: number; kind: PnlKind; pct: number | null }>;
  worst: Array<{ symbol: string; date: string; pnl: number; kind: PnlKind; pct: number | null }>;
}

/** One "trade" for win rate = one instrument's sell on one day (all lots it closed), intraday separate. */
export function closedTrades(realized: Realized[]): Array<{ isin: string; symbol: string; date: string; kind: PnlKind; pnl: number; cost: number; days: number }> {
  const m = new Map<string, { isin: string; symbol: string; date: string; kind: PnlKind; pnl: number; cost: number; qd: number; q: number }>();
  for (const r of realized) {
    const k = `${r.isin}|${r.sellDate}|${r.kind === 'INTRADAY' ? 'I' : 'D'}`;
    let x = m.get(k);
    if (!x) m.set(k, (x = { isin: r.isin, symbol: r.symbol, date: r.sellDate, kind: r.kind, pnl: 0, cost: 0, qd: 0, q: 0 }));
    x.pnl += r.pnl; x.cost += r.qty * r.buyPx; x.qd += r.qty * r.days; x.q += r.qty;
    if (r.kind === 'LTCG') x.kind = x.kind === 'STCG' ? 'STCG' : 'LTCG';
  }
  return Array.from(m.values()).map((x) => ({ isin: x.isin, symbol: x.symbol, date: x.date, kind: x.kind, pnl: x.pnl, cost: x.cost, days: x.q ? Math.round(x.qd / x.q) : 0 }));
}

export function pnlStats(realized: Realized[]): PnlStats {
  const sum = (k: PnlKind) => realized.filter((r) => r.kind === k).reduce((s, r) => s + r.pnl, 0);
  const ct = closedTrades(realized);
  const wins = ct.filter((c) => c.pnl > 0), losses = ct.filter((c) => c.pnl < 0);
  const grossWin = wins.reduce((s, c) => s + c.pnl, 0), grossLoss = -losses.reduce((s, c) => s + c.pnl, 0);
  const holds = ct.filter((c) => c.kind !== 'INTRADAY').map((c) => c.days).sort((a, b) => a - b);
  const median = holds.length ? (holds.length % 2 ? holds[(holds.length - 1) / 2] : (holds[holds.length / 2 - 1] + holds[holds.length / 2]) / 2) : null;
  const pick = (c: typeof ct[number]) => ({ symbol: c.symbol, date: c.date, pnl: c.pnl, kind: c.kind, pct: c.cost > 0 ? c.pnl / c.cost : null });
  const sorted = ct.slice().sort((a, b) => b.pnl - a.pnl);
  const stcg = sum('STCG'), ltcg = sum('LTCG'), intraday = sum('INTRADAY');
  return {
    stcg, ltcg, intraday, total: stcg + ltcg + intraday,
    trades: ct.length, wins: wins.length, losses: losses.length, winRate: ct.length ? wins.length / ct.length : null,
    grossWin, grossLoss, profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? null : null,
    avgWin: wins.length ? grossWin / wins.length : null, avgLoss: losses.length ? -grossLoss / losses.length : null,
    expectancy: ct.length ? (grossWin - grossLoss) / ct.length : null,
    medianHoldDays: median,
    best: sorted.slice(0, 5).filter((c) => c.pnl > 0).map(pick),
    worst: sorted.slice(-5).reverse().filter((c) => c.pnl < 0).map(pick),
  };
}

/** Realized P&L grouped by fiscal year (Indian, April–March). */
export function pnlByFy(realized: Realized[]): Array<{ fy: string } & PnlStats> {
  const fys = Array.from(new Set(realized.map((r) => fyOf(r.sellDate)))).sort();
  return fys.map((fy) => ({ fy, ...pnlStats(realized.filter((r) => fyOf(r.sellDate) === fy)) }));
}

/** Estimated dividends: shares held at the close before each ex-date × dividend per share. */
export function dividendsByFy(l: Ledger, divsOf: (isin: string) => Array<{ t: number; amount: number }> | undefined): {
  byFy: Array<{ fy: string; amount: number; payments: number }>;
  items: Array<{ symbol: string; exDate: string; qty: number; perShare: number; amount: number; fy: string }>;
} {
  const items: Array<{ symbol: string; exDate: string; qty: number; perShare: number; amount: number; fy: string }> = [];
  const start = l.firstDate ? dayMs(l.firstDate) : Infinity;
  for (const isin of l.qtyChanges.keys()) {
    const seenDay = new Set<string>();
    for (const d of divsOf(isin) || []) {
      if (d.t <= start) continue;
      // zzz1239 — the price source sometimes lists one dividend twice (same day, same amount)
      const dk = `${isoDay(d.t)}|${d.amount}`;
      if (seenDay.has(dk)) continue;
      seenDay.add(dk);
      const q = Math.floor(qtyAt(l, isin, d.t - DAY) + 1e-6);   // zzz1239 — whole shares (a split's fraction is paid in cash)
      if (!q) continue;
      const ex = isoDay(d.t);
      items.push({ symbol: l.symbolOf.get(isin) || isin, exDate: ex, qty: r2(q), perShare: d.amount, amount: q * d.amount, fy: fyOf(ex) });
    }
  }
  items.sort((a, b) => b.exDate.localeCompare(a.exDate));
  const m = new Map<string, { amount: number; payments: number }>();
  for (const i of items) { const x = m.get(i.fy) || { amount: 0, payments: 0 }; x.amount += i.amount; x.payments++; m.set(i.fy, x); }
  return { byFy: Array.from(m.entries()).map(([fy, v]) => ({ fy, ...v })).sort((a, b) => a.fy.localeCompare(b.fy)), items };
}

/** Lots that become long-term within `days` (tax planning: wait to sell). */
export function lotsTurningLongTerm(l: Ledger, now: number, days = 60): Array<{ symbol: string; qty: number; boughtOn: string; longTermOn: string; daysLeft: number; cost: number }> {
  const out: Array<{ symbol: string; qty: number; boughtOn: string; longTermOn: string; daysLeft: number; cost: number }> = [];
  for (const p of l.positions) for (const lot of p.lots) {
    const lt = addYear(lot.date);
    const left = Math.round((dayMs(lt) - now) / DAY) + 1;
    if (left > 0 && left <= days) out.push({ symbol: p.symbol, qty: r2(lot.qty), boughtOn: lot.date, longTermOn: isoDay(dayMs(lt) + DAY), daysLeft: left, cost: lot.qty * lot.px });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

// ── holdings for the portfolio page ─────────────────────────────────────────

/** zzz1243 — a portfolio symbol with an NSE series suffix (MTARTECH-BE, IFBAGRO-BE) is the same company as the tradebook's symbol. */
export const baseSym = (s: string) => String(s).toUpperCase().replace(/-(?:BE|BZ|EQ|SM|ST|XT|IT)$/, '');

export interface HoldingChange { symbol: string; action: 'add' | 'update' | 'remove' | 'keep'; quantity: number; entryPrice: number; before?: { quantity: number; entryPrice: number } | null; note?: string }

/**
 * What the portfolio should hold after the tradebook. Only instruments that appear in the tradebook are touched;
 * a holding the tradebook never mentions (another broker, a gift) is kept as it is. An instrument with sells the files
 * cannot explain (unmatched) is not changed — its true quantity is not known from the files.
 */
export interface DiffInput {
  positions: Array<{ symbol: string; qty: number; avgCost: number; isin: string }>;
  unmatchedIsins: string[];
  tradedSymbols: Array<{ symbol: string; isin: string }>;   // every symbol an instrument traded under in the files
}
export function holdingsDiff(l: DiffInput, current: Array<{ symbol: string; quantity: number; entryPrice: number }>): HoldingChange[] {
  const cur = new Map(current.map((h) => [String(h.symbol).toUpperCase(), h]));
  const isinOfSym = new Map(l.tradedSymbols.map((x) => [x.symbol.toUpperCase(), x.isin]));
  const unmatchedIsins = new Set(l.unmatchedIsins);
  const heldIsins = new Set(l.positions.map((p) => p.isin));
  const out: HoldingChange[] = [];
  const seen = new Set<string>();
  for (const p of l.positions) {
    const sym = p.symbol.toUpperCase();
    // the portfolio may hold it under an older symbol of the same ISIN
    const old = cur.has(sym) ? sym : Array.from(cur.keys()).find((k) => (isinOfSym.get(k) ?? isinOfSym.get(baseSym(k))) === p.isin || baseSym(k) === sym) || sym;
    seen.add(old); seen.add(sym);
    const before = cur.get(old) || null;
    const quantity = Math.round(p.qty), entryPrice = r2(p.avgCost);
    if (unmatchedIsins.has(p.isin)) { out.push({ symbol: old, action: 'keep', quantity: before?.quantity ?? quantity, entryPrice: before?.entryPrice ?? entryPrice, before, note: 'sells the files cannot explain — quantity not changed' }); continue; }
    if (!before) out.push({ symbol: sym, action: 'add', quantity, entryPrice, before: null });
    else if (Math.round(before.quantity) !== quantity || Math.abs(before.entryPrice - entryPrice) > 0.01) out.push({ symbol: old, action: 'update', quantity, entryPrice, before: { quantity: before.quantity, entryPrice: before.entryPrice } });
    else out.push({ symbol: old, action: 'keep', quantity, entryPrice, before });
  }
  for (const [sym, h] of cur) {
    if (seen.has(sym)) continue;
    const isin = isinOfSym.get(sym) ?? isinOfSym.get(baseSym(sym));
    if (!isin || heldIsins.has(isin)) continue;   // never traded in these files — not touched
    if (unmatchedIsins.has(isin)) { out.push({ symbol: sym, action: 'keep', quantity: h.quantity, entryPrice: h.entryPrice, before: { quantity: h.quantity, entryPrice: h.entryPrice }, note: 'sold with shares from before the first file — check by hand' }); continue; }
    out.push({ symbol: sym, action: 'remove', quantity: 0, entryPrice: h.entryPrice, before: { quantity: h.quantity, entryPrice: h.entryPrice } });
  }
  return out;
}

/** The portfolio list after applying a diff (holdings the tradebook never mentions are kept as they are). */
export function applyHoldingsDiff<H extends { symbol: string; quantity: number; entryPrice: number }>(current: H[], diff: HoldingChange[], make: (c: HoldingChange) => H): H[] {
  const bySym = new Map(diff.map((d) => [d.symbol.toUpperCase(), d]));
  const out: H[] = [];
  for (const h of current) {
    const d = bySym.get(String(h.symbol).toUpperCase());
    if (!d || d.action === 'keep') { out.push(h); continue; }
    if (d.action === 'remove') continue;
    out.push({ ...h, quantity: d.quantity, entryPrice: d.entryPrice });
  }
  for (const d of diff) if (d.action === 'add') out.push(make(d));
  return out;
}

// ── portfolio vs tradebook (zzz1240) ─────────────────────────────────────────

export interface ReconRow {
  symbol: string;
  kind: 'same' | 'only-portfolio' | 'only-tradebook' | 'quantity' | 'price';
  portfolioQty: number; portfolioCost: number; tradebookQty: number; tradebookCost: number;
  note: string;
}
/**
 * Why the portfolio's invested value differs from the tradebook's cost: one row per company, matched by symbol or by any symbol
 * the company traded under in the files. Pure.
 */
export function reconcilePortfolio(l: DiffInput, current: Array<{ symbol: string; quantity: number; entryPrice: number }>): { rows: ReconRow[]; portfolioCost: number; tradebookCost: number } {
  const isinOfSym = new Map(l.tradedSymbols.map((x) => [x.symbol.toUpperCase(), x.isin]));
  const posByIsin = new Map(l.positions.map((p) => [p.isin, p]));
  const used = new Set<string>();
  const rows: ReconRow[] = [];
  for (const h of current) {
    const sym = String(h.symbol).toUpperCase();
    const q = Number(h.quantity) || 0, cost = q * (Number(h.entryPrice) || 0);
    const isin = isinOfSym.get(sym) ?? isinOfSym.get(baseSym(sym)) ?? l.positions.find((p) => p.symbol.toUpperCase() === sym || p.symbol.toUpperCase() === baseSym(sym))?.isin;
    const p = isin ? posByIsin.get(isin) : undefined;
    if (!isin) { rows.push({ symbol: sym, kind: 'only-portfolio', portfolioQty: q, portfolioCost: cost, tradebookQty: 0, tradebookCost: 0, note: 'never traded in the uploaded files (another broker, a gift, an IPO allotment, or a name the files do not cover)' }); continue; }
    if (!p) { rows.push({ symbol: sym, kind: 'only-portfolio', portfolioQty: q, portfolioCost: cost, tradebookQty: 0, tradebookCost: 0, note: l.unmatchedIsins.includes(isin) ? 'sold with shares from before the first file — check by hand' : 'sold out in the tradebook — still in the portfolio' }); continue; }
    used.add(isin);
    const tq = Math.round(p.qty), tc = p.qty * p.avgCost;
    const kind: ReconRow['kind'] = Math.round(q) !== tq ? 'quantity' : Math.abs(cost - tc) > Math.max(1, tc * 0.001) ? 'price' : 'same';
    rows.push({ symbol: sym, kind, portfolioQty: q, portfolioCost: cost, tradebookQty: tq, tradebookCost: tc, note: kind === 'quantity' ? 'quantity differs' : kind === 'price' ? 'entry price differs (portfolio average vs tradebook FIFO cost of the shares still held)' : '' });
  }
  for (const p of l.positions) if (!used.has(p.isin)) rows.push({ symbol: p.symbol, kind: 'only-tradebook', portfolioQty: 0, portfolioCost: 0, tradebookQty: Math.round(p.qty), tradebookCost: p.qty * p.avgCost, note: 'held per the tradebook — not in the portfolio' });
  const order = { 'only-portfolio': 0, 'only-tradebook': 1, quantity: 2, price: 3, same: 4 } as const;
  rows.sort((a, b) => order[a.kind] - order[b.kind] || Math.abs(b.portfolioCost - b.tradebookCost) - Math.abs(a.portfolioCost - a.tradebookCost));
  return { rows, portfolioCost: rows.reduce((s, r) => s + r.portfolioCost, 0), tradebookCost: rows.reduce((s, r) => s + r.tradebookCost, 0) };
}

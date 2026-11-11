// zzz1231 — tradebook storage (Postgres) + the analytics run (prices from the chart data cache, Yahoo). Server only.
import { dbQuery } from '../db';
import { kvDel, kvGet, kvSet } from '../kv';
import { ensureSchema } from '../db-migrate';
import { getDailySeries, type DailySeries } from '../chart-data';
import { ensureIndexHistory, indexCloses } from '../index-history';
import { nseEquityIsins } from '../screener/in-build';
import {
  buildLedger, companyKey, dailySeries, inferIsinSplits, splitsForInstrument, normalizeTrades, MERGERS, dayMs, dividendsByFy, isoDay, lotsTurningLongTerm, pnlByFy, pnlStats, qtyAt, valueAt, windowReturn, xirr, fyOf,
  type Flow, type Ledger, type Split, type Trade, type WindowReturn,
  stockScorecard, holdBuckets, afterSale, type StockScore, type HoldBucket, type AfterSale,
} from './core';

const DAY = 86_400_000;
export const BENCH_NAME = 'NIFTY Smallcap 100';   // NSE's daily index file (Yahoo ^CNXSC has no history)

export async function tradebookFiles(): Promise<Array<{ hash: string; name: string | null; from: string | null; to: string | null; rows: number; added: number; at: string }>> {
  if (!(await ensureSchema())) return [];
  const r = await dbQuery<any>(`SELECT hash, name, to_char(from_date, 'YYYY-MM-DD') AS f, to_char(to_date, 'YYYY-MM-DD') AS t, rows, added, uploaded_at FROM tradebook_file ORDER BY uploaded_at DESC LIMIT 200`);
  return r.map((x) => ({ hash: x.hash, name: x.name, from: x.f, to: x.t, rows: Number(x.rows), added: Number(x.added), at: new Date(x.uploaded_at).toISOString() }));
}

/** Adds the trades not stored yet. A file already uploaded (same content hash) adds nothing. */
export async function saveTrades(file: { hash: string; name: string; from: string | null; to: string | null; rows: number }, trades: Trade[], last: boolean): Promise<{ added: number; duplicateFile: boolean }> {
  if (!(await ensureSchema())) throw new Error('database not available');
  const seen = await dbQuery<{ hash: string }>(`SELECT hash FROM tradebook_file WHERE hash = $1 AND rows > 0`, [file.hash]);
  if (seen.length) return { added: 0, duplicateFile: true };
  let added = 0;
  for (let i = 0; i < trades.length; i += 2000) {
    const c = trades.slice(i, i + 2000);
    const r = await dbQuery<{ n: number }>(
      `WITH ins AS (
         INSERT INTO tradebook_trade (key, isin, symbol, trade_date, exchange, segment, side, qty, price, order_id, trade_id, exec_time, file_hash)
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::date[], $5::text[], $6::text[], $7::text[], $8::float8[], $9::float8[], $10::text[], $11::text[], $12::text[], $13::text[])
         ON CONFLICT (key) DO NOTHING RETURNING 1)
       SELECT count(*)::int AS n FROM ins`,
      [c.map((t) => t.key), c.map((t) => t.isin), c.map((t) => t.symbol), c.map((t) => t.date), c.map((t) => t.exchange), c.map((t) => t.segment),
        c.map((t) => t.side), c.map((t) => t.qty), c.map((t) => t.price), c.map((t) => t.orderId || null), c.map((t) => t.tradeId || null), c.map((t) => t.time), c.map(() => file.hash)],
    );
    added += Number(r[0]?.n || 0);
  }
  await dbQuery(
    `INSERT INTO tradebook_file (hash, name, from_date, to_date, rows, added) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (hash) DO UPDATE SET added = tradebook_file.added + EXCLUDED.added, rows = GREATEST(tradebook_file.rows, EXCLUDED.rows)`,
    [file.hash, file.name.slice(0, 200), file.from, file.to, last ? file.rows : 0, added],
  );
  if (added) _cache = null;
  return { added, duplicateFile: false };
}

export async function loadTrades(): Promise<Trade[]> {
  if (!(await ensureSchema())) return [];
  const r = await dbQuery<any>(`SELECT key, isin, symbol, to_char(trade_date, 'YYYY-MM-DD') AS d, exchange, segment, side, qty, price, order_id, trade_id, exec_time FROM tradebook_trade`);
  return r.map((x) => ({ key: x.key, isin: x.isin, symbol: x.symbol, date: x.d, exchange: x.exchange, segment: x.segment, side: x.side, qty: Number(x.qty), price: Number(x.price), orderId: x.order_id || '', tradeId: x.trade_id || '', time: x.exec_time || null }));
}

export async function clearTradebook(): Promise<void> {
  if (!(await ensureSchema())) return;
  await dbQuery(`DELETE FROM tradebook_trade`);
  await dbQuery(`DELETE FROM tradebook_file`);
  _cache = null;
  await kvDel(STORE_KEY).catch(() => undefined);
}

// ── prices ─────────────────────────────────────────────────────────────────────

interface Px { t: Float64Array; c: Float64Array; splits?: Split[]; divs?: Array<{ t: number; amount: number }>; at: string | null }
function compact(s: DailySeries | null): Px | null {
  if (!s || !s.bars.length) return null;
  return { t: Float64Array.from(s.bars.map((b) => b.t)), c: Float64Array.from(s.bars.map((b) => b.c)), splits: s.splits, divs: s.divs, at: isoDay(s.bars[s.bars.length - 1].t) };
}
function closeAt(p: Px | null | undefined, t: number): number | null {
  if (!p || !p.t.length || t < p.t[0]) return null;
  let lo = 0, hi = p.t.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (p.t[m] <= t) lo = m; else hi = m - 1; }
  return p.c[lo];
}

/** zzz1239 — every instrument tries its symbols in turn (today's NSE symbol first, then the names it traded under). */
async function pricesFor(candidates: Map<string, string[]>, budgetMs: number): Promise<{ px: Map<string, Px>; missing: string[] }> {
  const px = new Map<string, Px>();
  const missing: string[] = [];
  const list = Array.from(candidates.entries());
  const deadline = Date.now() + budgetMs;
  let i = 0;
  const worker = async () => {
    while (i < list.length && Date.now() < deadline) {
      const [isin, syms] = list[i++];
      let c: Px | null = null;
      for (const sym of syms) {
        if (/^\d+$/.test(sym)) continue;   // a BSE scrip code is not a Yahoo symbol
        c = compact(await getDailySeries('IN', sym, '5y').catch(() => null));
        if (c) break;
      }
      if (c) px.set(isin, c); else missing.push(syms[0] || isin);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  for (; i < list.length; i++) missing.push(list[i][1][0] || list[i][0]);
  return { px, missing };
}

// ── analytics ──────────────────────────────────────────────────────────────────

export interface TradebookAnalytics {
  ok: true; builtAt: string; tradeCount: number; firstDate: string | null; lastDate: string | null; priceDate: string | null;
  files: Awaited<ReturnType<typeof tradebookFiles>>;
  summary: {
    invested: number; value: number; unrealized: number; realized: number; dividends: number;
    xirrAll: number | null; xirrYtd: number | null; xirrFytd: number | null; benchXirrAll: number | null;
    totalGain: number; netInvested: number;
  };
  trailing: WindowReturn[];
  byFy: WindowReturn[];
  byYear: WindowReturn[];
  growth: Array<{ d: string; value: number; cost: number; bench: number | null; net: number; ix: number | null }>;
  holdings: Array<{ isin: string; symbol: string; qty: number; avgCost: number; cost: number; price: number | null; value: number | null; pnl: number | null; pnlPct: number | null; weight: number | null; firstBuy: string | null; daysHeld: number | null; ltcgPct: number }>;
  pnl: ReturnType<typeof pnlStats>;
  pnlByFy: ReturnType<typeof pnlByFy>;
  bySymbol: Array<{ symbol: string; realized: number; trades: number }>;
  dividends: ReturnType<typeof dividendsByFy>;
  turningLongTerm: ReturnType<typeof lotsTurningLongTerm>;
  unmatched: { count: number; symbols: string[] };
  /** zzz1249 — per-company scorecard (realised + unrealised + dividends), holding-period buckets, what happened after selling */
  stocks?: StockScore[];
  holdBuckets?: HoldBucket[];
  afterSale?: AfterSale[];
  notes: string[];
  ledgerPositions: Array<{ symbol: string; qty: number; avgCost: number; isin: string }>;
  unmatchedIsins: string[];
  tradedSymbols: Array<{ symbol: string; isin: string }>;
}

// zzz1243 — the last result is STORED (key-value store, kept 2 years) and served as it is on every visit. Prices and returns
// are worked out again only when the owner asks (↻ Recompute → force) or uploads new trades (the upload asks with force).
// A stored result built from fewer trades or by an older version is still served, marked `stale` / `outdated`.
const STORE_KEY = 'tradebook:analytics:v1';
export const ANALYTICS_VERSION = 'zzz1250';
type Stored = { sig: string; version: string; data: TradebookAnalytics };
let _cache: Stored | null = null;
let _running: Promise<TradebookAnalytics> | null = null;

export async function tradebookAnalytics(force = false): Promise<TradebookAnalytics & { stale?: boolean; outdated?: boolean }> {
  const trades = await loadTrades();
  const sig = `${trades.length}|${trades.reduce((m, t) => (t.date > m ? t.date : m), '')}`;
  if (!force) {
    const hit = _cache ?? (await kvGet<Stored>(STORE_KEY).catch(() => null));
    if (hit?.data?.ok) {
      _cache = hit;
      const files = await tradebookFiles().catch(() => hit.data.files);
      return { ...hit.data, files, stale: hit.sig !== sig, outdated: hit.version !== ANALYTICS_VERSION };
    }
  }
  if (_running) return _running;
  _running = build(trades).then(async (data) => {
    _cache = { sig, version: ANALYTICS_VERSION, data };
    await kvSet(STORE_KEY, _cache, 730 * 86_400).catch(() => undefined);
    return data;
  }).finally(() => { _running = null; });
  return _running;
}

async function build(rawTrades: Trade[]): Promise<TradebookAnalytics> {
  const files = await tradebookFiles();
  // zzz1239 — one company = one instrument (missing BSE ISINs, split-changed ISINs, renames, mergers)
  const nseIsin = await nseEquityIsins().catch(() => ({} as Record<string, string>));
  const trades = normalizeTrades(rawTrades, (sym) => nseIsin[sym] ?? null);
  const nowSymbol = new Map<string, string>();   // company key → today's NSE symbol
  for (const [sym, isin] of Object.entries(nseIsin)) nowSymbol.set(companyKey(isin), sym);
  const notes: string[] = [
    'Brokerage, STT and other charges are not in a tradebook — gains here are before charges and tax.',
    'Splits and bonus issues are applied from Yahoo\'s records, checked against your own trade prices, so quantities are in today\'s share units.',
    'Gains and XIRR include estimated cash dividends (shares held before each ex-date × dividend per share). Nifty Smallcap 100 is a price index — its dividends are not in it, so the comparison slightly favours the book.',
  ];
  // first pass without splits, only to know the instruments and their latest symbols
  const pre = buildLedger(trades);
  const cands = new Map<string, string[]>();
  const symsOf = new Map<string, Trade[]>();
  for (const t of trades) { const a = symsOf.get(t.isin) || []; a.push(t); symsOf.set(t.isin, a); }
  for (const [isin, sym] of pre.symbolOf) {
    const seen = (symsOf.get(isin) || []).slice().sort((a, b) => b.date.localeCompare(a.date) || Number(b.exchange === 'NSE') - Number(a.exchange === 'NSE')).map((t) => t.symbol);
    cands.set(isin, Array.from(new Set([nowSymbol.get(isin), sym, ...seen].filter((x): x is string => !!x))));
  }
  const { px, missing } = await pricesFor(cands, 150_000);
  let bench: Px | null = null;
  let benchPending = 0;
  if (pre.firstDate) {
    const fill = await ensureIndexHistory(isoDay(dayMs(pre.firstDate) - 7 * DAY), isoDay(Date.now()), 100_000).catch(() => ({ fetched: 0, pending: -1 }));
    const ic = await indexCloses(BENCH_NAME).catch(() => []);
    if (ic.length) bench = { t: Float64Array.from(ic.map((x) => x.t)), c: Float64Array.from(ic.map((x) => x.c)), at: isoDay(ic[ic.length - 1].t) };
    benchPending = fill.pending;
    if (fill.pending > 0) notes.push(`Nifty Smallcap 100 history is still being read from NSE (${fill.pending} days to go) — press Recompute in a few minutes for an exact comparison.`);
  }
  if (!bench && pre.firstDate && benchPending <= 0) notes.push('Nifty Smallcap 100 closes could not be read from NSE — the comparison is left out.');
  if (!pre.firstDate) notes.push('No trades yet — upload your broker tradebook files (Excel or CSV) to see returns.');
  const priceAt = (isin: string, t: number) => closeAt(px.get(isin), t);
  const openAt = (isin: string, startT: number) => {
    const p = px.get(isin);
    if (!p || !p.t.length) return null;
    if (p.t[0] > startT) return { t: p.t[0], px: p.c[0] };   // listed (or first priced) after the first file
    const c = closeAt(p, startT - DAY);
    return c ? { t: startT, px: c } : null;
  };
  // zzz1239 — the price source's splits, plus splits read from an ISIN change in the files when it has none near that date
  // zzz1242 — and checked against the trades: price ÷ adjusted close must be the split factor. Where the price source's list
  // does not explain the trades, the units are read from the trades themselves (see splitsForInstrument).
  const inferred = inferIsinSplits(rawTrades);
  const splitMap = new Map<string, Split[] | undefined>();
  const fromTrades: string[] = [];
  for (const [isin, ts] of symsOf) {
    const r = splitsForInstrument(ts, (t) => closeAt(px.get(isin), t), px.get(isin)?.splits, inferred.get(isin));
    splitMap.set(isin, r.splits);
    if (r.source === 'trades') fromTrades.push(`${nowSymbol.get(isin) ?? pre.symbolOf.get(isin) ?? isin} (${(r.splits || []).map((x) => `${isoDay(x.t)} ×${+x.ratio.toFixed(2)}`).join(', ') || 'none'})`);
  }
  const splitsOf = (isin: string): Split[] | undefined => splitMap.get(isin);
  if (fromTrades.length) notes.push(`Split / bonus records that did not match your trade prices were read from the trades instead (price ÷ that day's adjusted close): ${fromTrades.slice(0, 20).join('; ')}${fromTrades.length > 20 ? ' …' : ''}.`);
  const l: Ledger = buildLedger(trades, splitsOf, openAt);
  const benchAt = bench ? (t: number) => closeAt(bench, t) : undefined;
  if (missing.length) notes.push(`No price history for ${missing.length} instrument${missing.length === 1 ? '' : 's'} (renamed, merged or delisted) — valued at their last trade price: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ' …' : ''}.`);

  const now = Date.now();
  const today = dayMs(isoDay(now));
  const first = l.firstDate ? dayMs(l.firstDate) : today;
  const lastPriceT = Math.max(...Array.from(px.values()).map((p) => p.t[p.t.length - 1] || 0), 0);
  const asOf = lastPriceT > 0 ? Math.min(today, lastPriceT) : today;

  // holdings
  const cur = valueAt(l, asOf, priceAt);
  const showSym = (isin: string, sym: string) => nowSymbol.get(isin) ?? sym;   // zzz1239 — today's NSE symbol for a renamed company
  const holdings = l.positions.map((p) => {
    const price = priceAt(p.isin, asOf);
    const value = price != null ? p.qty * price : null;
    const lt = p.lots.filter((lot) => dayMs(lot.date) < asOf - 365 * DAY).reduce((s, lot) => s + lot.qty, 0);
    return {
      isin: p.isin, symbol: showSym(p.isin, p.symbol), qty: p.qty, avgCost: p.avgCost, cost: p.cost, price, value,
      pnl: value != null ? value - p.cost : null, pnlPct: value != null && p.cost > 0 ? (value - p.cost) / p.cost : null,
      weight: value != null && cur.value > 0 ? value / cur.value : null,
      firstBuy: p.lots[0]?.date ?? p.firstBuy, daysHeld: p.lots[0] ? Math.round((asOf - dayMs(p.lots[0].date)) / DAY) : null,
      ltcgPct: p.qty > 0 ? lt / p.qty : 0,
    };
  }).sort((a, b) => (b.value ?? b.cost) - (a.value ?? a.cost));

  const invested = l.positions.reduce((s, p) => s + p.cost, 0);
  const pnlAll = pnlStats(l.realized);
  const netInvested = -l.flows.reduce((s, f) => s + f.amt, 0);
  const divs = dividendsByFy(l, (isin) => px.get(isin)?.divs);
  const divTotal = divs.byFy.reduce((s, x) => s + x.amount, 0);
  // zzz1242 — estimated dividends are cash received: in every period's gain and XIRR
  const divFlows: Flow[] = divs.items.map((d) => ({ t: dayMs(d.exDate), amt: d.amount }));
  const allFlows: Flow[] = [...l.flows, ...divFlows, { t: asOf, amt: cur.value }];

  // windows
  const yr = new Date(asOf).getUTCFullYear();
  const fyStartYear = new Date(asOf).getUTCMonth() >= 3 ? yr : yr - 1;
  const ytd = windowReturn(l, `${yr} so far`, Date.UTC(yr, 0, 1), asOf, priceAt, benchAt, divFlows);
  const fytd = windowReturn(l, `${fyOf(isoDay(asOf))} so far`, Date.UTC(fyStartYear, 3, 1), asOf, priceAt, benchAt, divFlows);
  const sinceStart = windowReturn(l, 'Since start', first, asOf, priceAt, benchAt, divFlows);
  const trailing: WindowReturn[] = [];
  for (const [label, yrs] of [['1 year', 1], ['3 years', 3]] as const) {
    const from = Date.UTC(new Date(asOf).getUTCFullYear() - yrs, new Date(asOf).getUTCMonth(), new Date(asOf).getUTCDate()) + DAY;
    if (from >= first) trailing.push(windowReturn(l, label, from, asOf, priceAt, benchAt, divFlows));
  }
  trailing.push(sinceStart);
  const byFy: WindowReturn[] = [];
  for (let y = new Date(first).getUTCMonth() >= 3 ? new Date(first).getUTCFullYear() : new Date(first).getUTCFullYear() - 1; y <= fyStartYear; y++) {
    const from = Math.max(first, Date.UTC(y, 3, 1)), to = Math.min(asOf, Date.UTC(y + 1, 2, 31));
    byFy.push(windowReturn(l, fyOf(isoDay(Date.UTC(y, 3, 1))) + (to === asOf ? ' (so far)' : ''), from, to, priceAt, benchAt, divFlows));
  }
  const byYear: WindowReturn[] = [];
  for (let y = new Date(first).getUTCFullYear(); y <= yr; y++) {
    const from = Math.max(first, Date.UTC(y, 0, 1)), to = Math.min(asOf, Date.UTC(y, 11, 31));
    byYear.push(windowReturn(l, String(y) + (to === asOf ? ' (so far)' : ''), from, to, priceAt, benchAt, divFlows));
  }

  // zzz1242 — growth day by day (weekdays): value, cost of the shares held, net money put in, and the same money in the index
  const days: number[] = [];
  for (let t = first; t <= asOf; t += DAY) { const wd = new Date(t).getUTCDay(); if (wd !== 0 && wd !== 6) days.push(t); }
  if (days[days.length - 1] !== asOf) days.push(asOf);
  const growth: TradebookAnalytics['growth'] = dailySeries(l, days, priceAt, benchAt);

  const bySym = new Map<string, { realized: number; trades: number }>();
  for (const r of l.realized) { const x = bySym.get(r.symbol) || { realized: 0, trades: 0 }; x.realized += r.pnl; x.trades++; bySym.set(r.symbol, x); }

  const benchAll = sinceStart.bench?.xirr ?? null;
  if (l.demerged.length) notes.push(`Shares received in demergers (no money paid; their cost stays with the parent): ${Array.from(new Set(l.demerged.map((d) => `${d.symbol} from ${d.parent}`))).join(', ')}.`);
  const mergedSeen = MERGERS.filter((m) => rawTrades.some((t) => t.symbol === m.from));
  if (mergedSeen.length) notes.push(`Mergers applied: ${mergedSeen.map((m) => m.note).join('; ')}.`);
  if (l.unmatched.length) notes.push(`${new Set(l.unmatched.map((u) => u.isin)).size} instruments were sold without an earlier buy in the uploaded files (bought before the first file, or received outside the market). For returns those shares count as held from the first day at that day's price; they get no P&L (their cost is not in the files) — upload older tradebooks to include them.`);
  void qtyAt;
  return {
    ok: true, builtAt: new Date().toISOString(), tradeCount: l.tradeCount, firstDate: l.firstDate, lastDate: l.lastDate, priceDate: isoDay(asOf), files,
    summary: {
      invested, value: cur.value, unrealized: cur.value - invested, realized: pnlAll.total, dividends: divTotal,
      xirrAll: xirr(allFlows), xirrYtd: ytd.xirr, xirrFytd: fytd.xirr, benchXirrAll: benchAll,
      totalGain: cur.value + divTotal - netInvested, netInvested,
    },
    trailing, byFy, byYear, growth, holdings,
    pnl: pnlAll, pnlByFy: pnlByFy(l.realized),
    bySymbol: Array.from(bySym.entries()).map(([symbol, v]) => ({ symbol, ...v })).sort((a, b) => b.realized - a.realized),
    dividends: { byFy: divs.byFy, items: divs.items.slice(0, 400) },
    turningLongTerm: lotsTurningLongTerm(l, asOf, 60),
    stocks: stockScorecard(trades, l.realized, holdings, divs.items, showSym, l.positions.flatMap((p) => p.lots.map((lot) => ({ isin: p.isin, date: lot.date, cost: lot.qty * lot.px })))),
    holdBuckets: holdBuckets(l.realized),
    afterSale: afterSale(l.realized, new Set(l.positions.map((p) => p.isin)), (isin) => priceAt(isin, asOf), showSym).sort((a, b) => b.amount - a.amount),
    unmatched: { count: l.unmatched.length, symbols: Array.from(new Set(l.unmatched.map((u) => u.symbol))).slice(0, 60) },
    notes,
    ledgerPositions: l.positions.map((p) => ({ symbol: showSym(p.isin, p.symbol), qty: p.qty, avgCost: p.avgCost, isin: p.isin })),
    unmatchedIsins: Array.from(new Set(l.unmatched.map((u) => u.isin))),
    tradedSymbols: Array.from(new Set([...trades.map((t) => `${t.symbol}|${t.isin}`), ...l.positions.map((p) => `${showSym(p.isin, p.symbol)}|${p.isin}`)])).map((x) => { const [symbol, isin] = x.split('|'); return { symbol, isin }; }),
  };
}

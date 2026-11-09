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
    trades.push({
      key: `${exchange}|${date}|${tradeId || '-'}|${orderId || '-'}|${isin}|${side}|${qty}|${price}`,
      isin, symbol, date, exchange, segment: cell(r[C.seg]).toUpperCase() || 'EQ', side: side as 'buy' | 'sell',
      qty, price, orderId, tradeId, time: cell(r[C.time]) || null,
    });
  }
  const ds = trades.map((t) => t.date).sort();
  return { trades, skipped, from: ds[0] ?? null, to: ds[ds.length - 1] ?? null };
}

/** Same trade in two files (or twice in one) → once. */
export function dedupeTrades(trades: Trade[]): Trade[] {
  const m = new Map<string, Trade>();
  for (const t of trades) if (!m.has(t.key)) m.set(t.key, t);
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
  firstDate: string | null; lastDate: string | null;
  tradeCount: number;
}

/**
 * `openPrice` — shares sold without an earlier buy in the files were already held when the first file starts. For RETURNS they
 * are counted as held from the first day at that day's price (money in at the start), so selling them is not free money.
 * They still get no P&L (their real cost is not in the files).
 */
export function buildLedger(tradesIn: Trade[], splitsOf: (isin: string) => Split[] | undefined = () => undefined, openPrice?: (isin: string, startT: number) => { t: number; px: number } | null): Ledger {
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
      if (netBuy > 1e-9) { lots.push({ date, qty: netBuy, px: bpx }); ch.push({ t: dayMs(date), dq: netBuy }); }
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
          lot.qty -= q; left -= q; sold += q;
          if (lot.qty <= 1e-9) lots.shift();
        }
        if (sold > 0) ch.push({ t: dayMs(date), dq: -sold });
        if (left > 1e-9) {
          unmatchedQty += left; unmatched.push({ isin, symbol, date, qty: r2(left) });
          // held since before the first file (or received later outside the market — a demerger, an IPO allotment): in the book
          // from the first day, or from its listing day when that is later, at that day's price (else the sell price)
          const op = openPrice?.(isin, startT) ?? null;
          const ot = op && op.t > startT && op.t <= dayMs(date) ? op.t : startT;
          const opx = op && op.px > 0 ? op.px : spx;
          ch.push({ t: ot, dq: left }, { t: dayMs(date), dq: -left });
          opening.push({ t: ot, amt: -left * opx });
          px.push({ t: ot, px: opx });   // a price for the days before its first trade in the files
        }
      }
    }
    ch.sort((a, b) => a.t - b.t);
    px.sort((a, b) => a.t - b.t);
    qtyChanges.set(isin, ch);
    lastPx.set(isin, px);
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
    positions, realized, flows, qtyChanges, lastPx, symbolOf, unmatched,
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
export function valueAt(l: Ledger, t: number, priceAt: PriceAt): { value: number; estimated: number } {
  let value = 0, estimated = 0;
  for (const isin of l.qtyChanges.keys()) {
    const q = qtyAt(l, isin, t);
    if (!q) continue;
    let p = priceAt(isin, t);
    if (p == null || !(p > 0)) {
      const tp = (l.lastPx.get(isin) || []).filter((x) => x.t <= t && x.px > 0);
      p = tp.length ? tp[tp.length - 1].px : null;
      estimated++;
    }
    if (p) value += q * p;
  }
  return { value, estimated };
}

export interface WindowReturn {
  label: string; from: string; to: string;
  startValue: number; endValue: number; invested: number; withdrawn: number;
  gain: number;                // end + withdrawn − start − invested
  xirr: number | null;         // annual
  simple: number | null;       // Modified Dietz, for the window (not annualised)
  bench: { xirr: number | null; endValue: number; gain: number } | null;
  estimated: number;
}

/** Returns over [from, to]: the book at the close before `from`, the trade flows inside, the book at `to`. */
export function windowReturn(l: Ledger, label: string, from: number, to: number, priceAt: PriceAt, benchAt?: (t: number) => number | null): WindowReturn {
  const start = valueAt(l, from - DAY, priceAt), end = valueAt(l, to, priceAt);
  const inside = l.flows.filter((f) => f.t >= from && f.t <= to);
  const invested = -inside.filter((f) => f.amt < 0).reduce((s, f) => s + f.amt, 0);
  const withdrawn = inside.filter((f) => f.amt > 0).reduce((s, f) => s + f.amt, 0);
  const gain = end.value + withdrawn - start.value - invested;
  const flows: Flow[] = [...(start.value > 0 ? [{ t: from, amt: -start.value }] : []), ...inside, ...(end.value > 0 ? [{ t: to, amt: end.value }] : [])];
  const span = Math.max(1, to - from);
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
      bench = { xirr: xirr(bFlows), endValue: bEnd, gain: bEnd + withdrawn - start.value - invested };
    }
  }
  return {
    label, from: isoDay(from), to: isoDay(to), startValue: start.value, endValue: end.value, invested, withdrawn, gain,
    xirr: xirr(flows), simple: weighted > 0 ? gain / weighted : null, bench, estimated: Math.max(start.estimated, end.estimated),
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
    for (const d of divsOf(isin) || []) {
      if (d.t <= start) continue;
      const q = qtyAt(l, isin, d.t - DAY);
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
    const old = cur.has(sym) ? sym : Array.from(cur.keys()).find((k) => isinOfSym.get(k) === p.isin) || sym;
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
    const isin = isinOfSym.get(sym);
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

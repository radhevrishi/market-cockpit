// ═══════════════════════════════════════════════════════════════════════════
// US PORTFOLIO BOOK — THE USD VIEW + ANALYTICS.                      (zzz793)
//
// BOOK PAGE ONLY (nothing under lib/us-thesis imports this). Pure: book +
// quotes + FX + profiles + "now" in, rows / totals / analytics out, so every
// reconciliation rule below is tested without a browser.
//
// RULES
//  • USD is the page's unit. A EUR line is converted at the live EUR/USD rate
//    from the same quote source (Yahoo EURUSD=X). No rate → that line is left
//    out of the USD totals and says "FX unavailable"; a rate is never assumed.
//  • A price must be real, in the position's currency, and recent: missing,
//    wrong-currency or older than STALE_PRICE_DAYS → shown as "—" with the
//    reason, never as 0, and left out of the totals.
//  • Day change only when Yahoo gave a previous close.
//  • Weights are shares of the TOTAL BOOK = valued holdings + valued cash, so
//    the weight column plus the cash weights add up to exactly 100 %.
//  • Every total is the sum of the rows it heads — nothing is computed twice
//    by a different route.
//  • BASE cash (the broker's own total in its base currency) restates the
//    other cash lines; it is shown for reference and never added.
// ═══════════════════════════════════════════════════════════════════════════

import type { UsBook, UsHolding } from './model';
import { quoteSymbolFor, type UsQuote } from './valuation';
import type { UsProfile } from './profile';

export const STALE_PRICE_DAYS = 5;
export const BROKER_BASE_CURRENCY = 'EUR';

export type PriceStatus = 'live' | 'stale' | 'missing' | 'currency-mismatch';

export interface FxDetail { rate: number | null; at: string | null; source: string; symbol?: string; error?: string | null }

export interface UsBookRow {
  key: string;
  ticker: string;
  rawTicker: string;
  name: string | null;
  exchange: string;
  listing: 'US' | 'NON_US';
  listingNote: string;
  currency: string;
  quantity: number;
  avgPrice: number | null;
  quoteSymbol: string;
  /** Native-currency price, only when usable. */
  price: number | null;
  priceTime: string | null;
  priceStatus: PriceStatus;
  /** Why price (or anything after it) is blank. */
  priceReason: string | null;
  prevClose: number | null;
  dayChangePct: number | null;
  dayChangeUsd: number | null;
  /** USD per 1 unit of the position's currency; 1 for USD. */
  fxToUsd: number | null;
  fxReason: string | null;
  marketValue: number | null;   // native
  costBasis: number | null;     // native
  mvUsd: number | null;
  costUsd: number | null;
  pnlUsd: number | null;
  pnlPct: number | null;
  /** Share of the total book (holdings + cash), %. */
  weightPct: number | null;
  sector: string;
  sectorSource: 'sec' | 'none';
  sicDescription: string | null;
}

export interface UsCashRow { currency: string; amount: number; fxToUsd: number | null; usd: number | null; weightPct: number | null; note: string | null }

export interface UsBookTotals {
  count: number;
  valued: number;
  unvalued: number;
  holdingsUsd: number;
  cashUsd: number;
  totalUsd: number;
  /** Cost of every row that has a cost and an FX rate. */
  costAllUsd: number;
  /** Cost of the rows that also have a market value — the base for P&L %. */
  costValuedUsd: number;
  pnlUsd: number;
  pnlPct: number | null;
  dayChangeUsd: number;
  dayChangePct: number | null;
  /** Rows that contributed to the day change (had a previous close). */
  dayCovered: number;
  weightsHoldingsPct: number;
  weightsCashPct: number;
}

export interface UsBookView {
  rows: UsBookRow[];
  cash: UsCashRow[];
  baseCash: number | null;
  totals: UsBookTotals;
  fx: Record<string, FxDetail>;
  /** Whole book in EUR (the broker's base currency), only with a live EUR/USD rate. */
  totalEur: number | null;
  eurUsd: number | null;
  /** Everything left out of a total, with the reason. */
  leftOut: Array<{ what: string; reason: string }>;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const fin = (v: any): v is number => typeof v === 'number' && Number.isFinite(v);

function fxFor(ccy: string, fx: Record<string, FxDetail>): { rate: number | null; reason: string | null } {
  if (ccy === 'USD') return { rate: 1, reason: null };
  const d = fx[ccy];
  if (d && fin(d.rate) && d.rate > 0) return { rate: d.rate, reason: null };
  return { rate: null, reason: `FX unavailable — no live ${ccy}/USD rate${d?.error ? ` (${d.error})` : ''}, so this line is not in the USD totals` };
}

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** Classify a quote for a holding. Pure. */
export function priceFor(h: Pick<UsHolding, 'currency'>, q: UsQuote | null | undefined, nowMs: number): { price: number | null; status: PriceStatus; reason: string | null; time: string | null; prevClose: number | null } {
  const raw = q && fin(q.price) && q.price > 0 ? q.price : null;
  const time = q?.marketTime || q?.asOf || null;
  if (raw == null) return { price: null, status: 'missing', reason: q?.error ? `no price — ${q.error}` : 'no price — the quote source returned nothing for this symbol', time: null, prevClose: null };
  const qc = q?.currency ? String(q.currency).toUpperCase() : null;
  if (qc && qc !== h.currency) return { price: null, status: 'currency-mismatch', reason: `quote is in ${qc} but the position is in ${h.currency} — not valued`, time, prevClose: null };
  if (time) {
    const ageDays = (nowMs - Date.parse(time)) / 86_400_000;
    if (ageDays > STALE_PRICE_DAYS) return { price: null, status: 'stale', reason: `last price is from ${fmtDay(time)} — too old to value (over ${STALE_PRICE_DAYS} days)`, time, prevClose: null };
  }
  const prev = q && fin(q.prevClose) && q.prevClose > 0 ? q.prevClose : null;
  return { price: raw, status: 'live', reason: time ? null : 'price time not given by the source', time, prevClose: prev };
}

export interface BuildViewInput {
  book: Pick<UsBook, 'holdings' | 'cash'>;
  quotes: Record<string, UsQuote | null | undefined>;
  fx: Record<string, FxDetail>;
  profiles?: Record<string, UsProfile | null | undefined>;
  now?: number;
}

export function buildUsBookView({ book, quotes, fx, profiles = {}, now = Date.now() }: BuildViewInput): UsBookView {
  const leftOut: UsBookView['leftOut'] = [];
  const rows: UsBookRow[] = book.holdings.map((h) => {
    const qs = quoteSymbolFor(h);
    const q = quotes[qs] || quotes[h.ticker];
    const p = priceFor(h, q, now);
    const { rate, reason: fxReason } = fxFor(h.currency, fx);
    const marketValue = p.price != null ? r2(p.price * h.quantity) : null;
    const costBasis = h.avgPrice != null ? r2(h.avgPrice * h.quantity) : null;
    const mvUsd = marketValue != null && rate != null ? r2(marketValue * rate) : null;
    const costUsd = costBasis != null && rate != null ? r2(costBasis * rate) : null;
    const pnlUsd = mvUsd != null && costUsd != null ? r2(mvUsd - costUsd) : null;
    const pnlPct = pnlUsd != null && costUsd ? (pnlUsd / Math.abs(costUsd)) * 100 : null;
    const dayChangePct = p.price != null && p.prevClose != null ? ((p.price - p.prevClose) / p.prevClose) * 100 : null;
    const dayChangeUsd = p.price != null && p.prevClose != null && rate != null ? r2((p.price - p.prevClose) * h.quantity * rate) : null;
    const prof = h.listing === 'US' ? profiles[h.ticker] : null;
    const sector = h.listing !== 'US' ? 'Unknown (no SEC filer)' : prof && prof.sector ? (prof.sector === 'Unknown' ? 'Unknown' : prof.sector) : 'Unknown';
    const reason = p.reason && p.status !== 'live' ? p.reason
      : fxReason ? fxReason
      : h.avgPrice == null ? 'no average cost on file — P&L not computed'
      : p.reason;
    if (mvUsd == null) leftOut.push({ what: `${h.ticker}${h.exchange ? ` (${h.exchange})` : ''}`, reason: (p.status !== 'live' ? p.reason : fxReason) || 'not valued' });
    return {
      key: `${h.ticker}|${h.exchange}`, ticker: h.ticker, rawTicker: h.rawTicker, name: prof?.name || q?.name || null,
      exchange: h.exchange, listing: h.listing, listingNote: h.listingNote, currency: h.currency, quantity: h.quantity, avgPrice: h.avgPrice,
      quoteSymbol: qs, price: p.price, priceTime: p.time, priceStatus: p.status, priceReason: reason,
      prevClose: p.prevClose, dayChangePct, dayChangeUsd, fxToUsd: rate, fxReason,
      marketValue, costBasis, mvUsd, costUsd, pnlUsd, pnlPct, weightPct: null,
      sector, sectorSource: prof?.status === 'sec' && prof.sic ? 'sec' : 'none', sicDescription: prof?.sicDescription || null,
    };
  });

  const baseCash = fin(book.cash.BASE) ? book.cash.BASE : null;
  const cash: UsCashRow[] = Object.entries(book.cash).filter(([c]) => c !== 'BASE').map(([currency, amount]) => {
    const { rate, reason } = fxFor(currency, fx);
    if (rate == null) leftOut.push({ what: `${currency} cash`, reason: reason || 'no FX' });
    return { currency, amount, fxToUsd: rate, usd: rate != null ? r2(amount * rate) : null, weightPct: null, note: reason };
  }).sort((a, b) => (a.currency === 'USD' ? -1 : b.currency === 'USD' ? 1 : a.currency.localeCompare(b.currency)));

  const holdingsUsd = r2(rows.reduce((s, r) => s + (r.mvUsd ?? 0), 0));
  const cashUsd = r2(cash.reduce((s, c) => s + (c.usd ?? 0), 0));
  const totalUsd = r2(holdingsUsd + cashUsd);
  // Weights from the SAME sums the totals come from, so they close to 100 %.
  const denom = rows.reduce((s, r) => s + (r.mvUsd ?? 0), 0) + cash.reduce((s, c) => s + (c.usd ?? 0), 0);
  for (const r of rows) r.weightPct = r.mvUsd != null && denom > 0 ? (r.mvUsd / denom) * 100 : null;
  for (const c of cash) c.weightPct = c.usd != null && denom > 0 ? (c.usd / denom) * 100 : null;

  const valuedRows = rows.filter((r) => r.mvUsd != null);
  const costValuedUsd = r2(rows.reduce((s, r) => s + (r.pnlUsd != null && r.costUsd != null ? r.costUsd : 0), 0));
  const pnlUsd = r2(rows.reduce((s, r) => s + (r.pnlUsd ?? 0), 0));
  const dayRows = rows.filter((r) => r.dayChangeUsd != null);
  const dayChangeUsd = r2(dayRows.reduce((s, r) => s + (r.dayChangeUsd as number), 0));
  const prevValue = dayRows.reduce((s, r) => s + ((r.mvUsd as number) - (r.dayChangeUsd as number)), 0);

  const eur = fx.EUR && fin(fx.EUR.rate) && fx.EUR.rate > 0 ? fx.EUR.rate : null;
  const totals: UsBookTotals = {
    count: rows.length, valued: valuedRows.length, unvalued: rows.length - valuedRows.length,
    holdingsUsd, cashUsd, totalUsd,
    costAllUsd: r2(rows.reduce((s, r) => s + (r.costUsd ?? 0), 0)),
    costValuedUsd, pnlUsd, pnlPct: costValuedUsd ? (pnlUsd / Math.abs(costValuedUsd)) * 100 : null,
    dayChangeUsd, dayChangePct: prevValue > 0 ? (dayChangeUsd / prevValue) * 100 : null, dayCovered: dayRows.length,
    weightsHoldingsPct: rows.reduce((s, r) => s + (r.weightPct ?? 0), 0),
    weightsCashPct: cash.reduce((s, c) => s + (c.weightPct ?? 0), 0),
  };
  return { rows, cash, baseCash, totals, fx, totalEur: eur ? r2(totalUsd / eur) : null, eurUsd: eur, leftOut };
}

// ── ANALYTICS ──────────────────────────────────────────────────────────────

/** How many names each "who moved" / "today's movers" list shows (zzz799: 10, was 5). */
export const MOVERS_TOP_N = 10;

/**
 * Short venue + currency tag for a line that is NOT a US listing, so a
 * Frankfurt euro line is never mistaken for a US name in a mixed list:
 * K3R on FWB2 in EUR → "FWB, EUR". US lines → null.
 */
export function nonUsTag(r: Pick<UsBookRow, 'listing' | 'exchange' | 'currency'>): string | null {
  if (r.listing === 'US') return null;
  const x = (r.exchange || '').toUpperCase();
  const venue = /^(FWB|FRA|XETRA|GER)/.test(x) ? 'FWB' : x || 'non-US';
  return `${venue}, ${r.currency}`;
}

export interface SectorStat { sector: string; count: number; valued: number; valueUsd: number; weightPct: number; shareOfHoldingsPct: number; costUsd: number; pnlUsd: number; pnlPct: number | null }
export interface BucketStat { label: string; count: number; valueUsd: number; weightPct: number }

export interface UsBookAnalytics {
  winners: number; losers: number; flat: number;
  best: UsBookRow | null; worst: UsBookRow | null;
  top5Pct: number | null;
  largest: UsBookRow | null;
  /** 1 / Σ w² over holdings — "like holding N equal positions". */
  effectivePositions: number | null;
  sectors: SectorStat[];
  listingSplit: BucketStat[];
  currencySplit: BucketStat[];
  sizeBuckets: BucketStat[];
  contributors: UsBookRow[];
  drags: UsBookRow[];
  winnerUsd: number; loserUsd: number;
  dayUp: UsBookRow[]; dayDown: UsBookRow[];
  /** Plain-English notes about concentration, no advice. */
  notes: string[];
  cashPct: number | null;
}

export function usBookAnalytics(v: UsBookView): UsBookAnalytics {
  const T = v.totals.totalUsd;
  const valued = v.rows.filter((r) => r.mvUsd != null);
  const withPnl = v.rows.filter((r) => r.pnlUsd != null);
  const winners = withPnl.filter((r) => (r.pnlUsd as number) > 0);
  const losers = withPnl.filter((r) => (r.pnlUsd as number) < 0);
  const byPct = [...withPnl].filter((r) => r.pnlPct != null).sort((a, b) => (b.pnlPct as number) - (a.pnlPct as number));
  const byVal = [...valued].sort((a, b) => (b.mvUsd as number) - (a.mvUsd as number));
  const H = v.totals.holdingsUsd;
  const top5Pct = T > 0 && byVal.length ? (byVal.slice(0, 5).reduce((s, r) => s + (r.mvUsd as number), 0) / T) * 100 : null;
  const effectivePositions = H > 0 && valued.length ? 1 / valued.reduce((s, r) => s + ((r.mvUsd as number) / H) ** 2, 0) : null;

  const secMap = new Map<string, SectorStat>();
  for (const r of v.rows) {
    const s = secMap.get(r.sector) || { sector: r.sector, count: 0, valued: 0, valueUsd: 0, weightPct: 0, shareOfHoldingsPct: 0, costUsd: 0, pnlUsd: 0, pnlPct: null };
    s.count++;
    if (r.mvUsd != null) { s.valued++; s.valueUsd = r2(s.valueUsd + r.mvUsd); s.weightPct += r.weightPct ?? 0; }
    if (r.pnlUsd != null && r.costUsd != null) { s.costUsd = r2(s.costUsd + r.costUsd); s.pnlUsd = r2(s.pnlUsd + r.pnlUsd); }
    secMap.set(r.sector, s);
  }
  const sectors = Array.from(secMap.values()).map((s) => ({ ...s, shareOfHoldingsPct: H > 0 ? (s.valueUsd / H) * 100 : 0, pnlPct: s.costUsd ? (s.pnlUsd / Math.abs(s.costUsd)) * 100 : null }))
    .sort((a, b) => b.valueUsd - a.valueUsd);

  const bucket = (label: string, rs: UsBookRow[], extraUsd = 0, extraW = 0): BucketStat => ({
    label, count: rs.length, valueUsd: r2(rs.reduce((s, r) => s + (r.mvUsd ?? 0), 0) + extraUsd), weightPct: rs.reduce((s, r) => s + (r.weightPct ?? 0), 0) + extraW,
  });
  const listingSplit = [
    bucket('US-listed shares', valued.filter((r) => r.listing === 'US')),
    bucket('Non-US listed shares', valued.filter((r) => r.listing !== 'US')),
    { label: 'Cash', count: v.cash.filter((c) => c.usd != null).length, valueUsd: v.totals.cashUsd, weightPct: v.totals.weightsCashPct },
  ];
  const ccys = Array.from(new Set([...valued.map((r) => r.currency), ...v.cash.filter((c) => c.usd != null).map((c) => c.currency)]));
  const currencySplit = ccys.map((c) => {
    const cr = v.cash.filter((x) => x.currency === c && x.usd != null);
    return bucket(`${c} (shares + cash)`, valued.filter((r) => r.currency === c), cr.reduce((s, x) => s + (x.usd as number), 0), cr.reduce((s, x) => s + (x.weightPct ?? 0), 0));
  }).sort((a, b) => b.valueUsd - a.valueUsd);
  const sizeDefs: Array<[string, number, number]> = [['under 1% of book', 0, 1], ['1% – 2%', 1, 2], ['2% – 4%', 2, 4], ['4% – 6%', 4, 6], ['6% and over', 6, Infinity]];
  const sizeBuckets = sizeDefs.map(([label, lo, hi]) => bucket(label, valued.filter((r) => (r.weightPct as number) >= lo && (r.weightPct as number) < hi)));

  const byPnl = [...withPnl].sort((a, b) => (b.pnlUsd as number) - (a.pnlUsd as number));
  const contributors = byPnl.filter((r) => (r.pnlUsd as number) > 0).slice(0, MOVERS_TOP_N);
  const drags = [...byPnl].reverse().filter((r) => (r.pnlUsd as number) < 0).slice(0, MOVERS_TOP_N);
  const dayRows = v.rows.filter((r) => r.dayChangePct != null).sort((a, b) => (b.dayChangePct as number) - (a.dayChangePct as number));

  const notes: string[] = [];
  for (const r of byVal) if ((r.weightPct ?? 0) >= 10) notes.push(`${r.ticker} is ${(r.weightPct as number).toFixed(1)}% of the whole book.`);
  for (const s of sectors) if (s.shareOfHoldingsPct >= 30 && !/^Unknown/.test(s.sector)) notes.push(`${s.sector} is ${s.shareOfHoldingsPct.toFixed(0)}% of the shares you hold.`);
  const unk = sectors.filter((s) => /^Unknown/.test(s.sector)).reduce((a, s) => a + s.shareOfHoldingsPct, 0);
  if (unk >= 5) notes.push(`${unk.toFixed(0)}% of the shares' value has no known sector (no SEC record or not looked up yet).`);
  if (v.totals.unvalued) notes.push(`${v.totals.unvalued} holding${v.totals.unvalued === 1 ? ' is' : 's are'} not valued right now, so every figure here leaves ${v.totals.unvalued === 1 ? 'it' : 'them'} out.`);

  return {
    winners: winners.length, losers: losers.length, flat: withPnl.length - winners.length - losers.length,
    best: byPct[0] || null, worst: byPct.length ? byPct[byPct.length - 1] : null,
    top5Pct, largest: byVal[0] || null, effectivePositions,
    sectors, listingSplit, currencySplit, sizeBuckets, contributors, drags,
    winnerUsd: r2(winners.reduce((s, r) => s + (r.pnlUsd as number), 0)), loserUsd: r2(losers.reduce((s, r) => s + Math.abs(r.pnlUsd as number), 0)),
    dayUp: dayRows.filter((r) => (r.dayChangePct as number) > 0).slice(0, MOVERS_TOP_N),
    dayDown: [...dayRows].reverse().filter((r) => (r.dayChangePct as number) < 0).slice(0, MOVERS_TOP_N),
    notes, cashPct: T > 0 ? v.totals.weightsCashPct : null,
  };
}

// ── SORTING ────────────────────────────────────────────────────────────────

export type SortDir = 'asc' | 'desc';
export type SortValue = number | string | null | undefined;

/**
 * Compare two cell values. Numbers numerically, text case-insensitively
 * (natural order, so "A10" after "A9"); null / undefined / NaN / '' / '—'
 * ALWAYS last, whichever way the column is sorted.
 */
export function compareSortValues(a: SortValue, b: SortValue, dir: SortDir): number {
  const blank = (x: SortValue) => x == null || (typeof x === 'number' && !Number.isFinite(x)) || (typeof x === 'string' && (x.trim() === '' || x.trim() === '—'));
  const ba = blank(a), bb = blank(b);
  if (ba && bb) return 0;
  if (ba) return 1;
  if (bb) return -1;
  let c: number;
  if (typeof a === 'number' && typeof b === 'number') c = a - b;
  else c = String(a).localeCompare(String(b), 'en', { sensitivity: 'base', numeric: true });
  return dir === 'asc' ? c : -c;
}

/** Stable sort by a getter. Pure — returns a new array. */
export function sortRows<T>(rows: T[], get: (r: T) => SortValue, dir: SortDir): T[] {
  return rows.map((r, i) => ({ r, i })).sort((x, y) => compareSortValues(get(x.r), get(y.r), dir) || x.i - y.i).map((x) => x.r);
}

// ── WORDS ──────────────────────────────────────────────────────────────────

export function ageInWords(iso: string | null | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  if (ms < 0) return 'just now';
  const min = Math.floor(ms / 60_000), h = Math.floor(ms / 3_600_000), d = Math.floor(ms / 86_400_000);
  if (min < 2) return 'just now';
  if (min < 60) return `${min} minutes ago`;
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

/** "$1.23M" / "$45.6K" / "$950" — for tiles and bars. */
export function fmtUsdShort(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${s}$${(a / 1e3).toFixed(1)}K`;
  return `${s}$${a.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

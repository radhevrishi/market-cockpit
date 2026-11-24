// Options Ideas — live option chains (server only). Every source is best-effort: when a chain cannot be read the plan falls
// back to model prices (Black–Scholes on historical volatility) and says so.
//   USA   Yahoo v7 options (cookie + crumb, the same handshake as lib/us-prices). One call lists the expiries; only the expiries
//         the plan needs are then fetched.
//   India NSE option chain (/api/option-chain-equities, then the v3 address) through nseApiFetch (no cookie → cookie → relay).
//         F&O lot sizes from NSE's fo_mktlots.csv (one read a day).
import type { Chain, ChainQuote } from './options';
import { yahooCrumb } from '../us-prices';
import { nseApiFetch } from '../nse';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const memo = new Map<string, { at: number; v: any }>();
/** why the last chain read failed (shown on the page so a model price is explained) */
export const chainError = new Map<string, string>();
const CHAIN_TTL = 15 * 60_000;
function getMemo<T>(k: string, ttl: number): T | undefined { const h = memo.get(k); return h && Date.now() - h.at < ttl ? (h.v as T) : undefined; }
function setMemo(k: string, v: any) { memo.set(k, { at: Date.now(), v }); if (memo.size > 400) { const first = memo.keys().next().value; if (first) memo.delete(first); } }

const num = (x: any): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x)) ? Number(x) : null);
const isoOfUnix = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);

function yq(o: any): ChainQuote {
  return { strike: num(o?.strike) ?? 0, bid: num(o?.bid), ask: num(o?.ask), last: num(o?.lastPrice), iv: num(o?.impliedVolatility), oi: num(o?.openInterest), volume: num(o?.volume) };
}

const MONTHS: Record<string, string> = { January: '01', February: '02', March: '03', April: '04', May: '05', June: '06', July: '07', August: '08', September: '09', October: '10', November: '11', December: '12' };
/** "December 24, 2026" → "2026-12-24" */
export function nasdaqDateIso(s: string): string | null {
  const m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(String(s || '').trim());
  return m && MONTHS[m[1]] ? `${m[3]}-${MONTHS[m[1]]}-${m[2].padStart(2, '0')}` : null;
}
const nn = (x: any): number | null => { const v = typeof x === 'string' ? Number(x.replace(/,/g, '')) : x; return typeof v === 'number' && Number.isFinite(v) ? v : null; };
/** Nasdaq option-chain table → Chain (pure; exported for tests). Nasdaq gives bid / ask / last / volume / OI but no IV. */
export function parseNasdaqChain(j: any): Chain | null {
  const rows: any[] = j?.data?.table?.rows ?? [];
  const byExpiry: Chain['byExpiry'] = {};
  let ex: string | null = null;
  for (const r of rows) {
    if (r?.expirygroup) { ex = nasdaqDateIso(r.expirygroup); continue; }
    const K = nn(r?.strike);
    if (!ex || K == null) continue;
    const slot = (byExpiry[ex] ||= { calls: [], puts: [] });
    slot.calls.push({ strike: K, bid: nn(r.c_Bid), ask: nn(r.c_Ask), last: nn(r.c_Last), iv: null, oi: nn(r.c_Openinterest), volume: nn(r.c_Volume) });
    slot.puts.push({ strike: K, bid: nn(r.p_Bid), ask: nn(r.p_Ask), last: nn(r.p_Last), iv: null, oi: nn(r.p_Openinterest), volume: nn(r.p_Volume) });
  }
  const expiries = Object.keys(byExpiry).sort();
  return expiries.length ? { expiries, byExpiry, source: 'Nasdaq option chain', asOf: null } : null;
}
async function nasdaqChain(ticker: string): Promise<Chain | null> {
  const from = new Date(), to = new Date(Date.now() + 160 * 86_400_000);
  const d = (x: Date) => x.toISOString().slice(0, 10);
  const u = `https://api.nasdaq.com/api/quote/${encodeURIComponent(ticker)}/option-chain?assetclass=stocks&limit=3000&fromdate=${d(from)}&todate=${d(to)}&excode=oprac&callput=callput&money=all&type=all`;
  const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`Nasdaq HTTP ${r.status}`);
  return parseNasdaqChain(await r.json());
}

/** US chain: Yahoo first (has implied volatility), Nasdaq when Yahoo refuses (bid / ask / OI, no IV). */
export async function usChain(ticker: string, pick: (expiries: string[]) => string[]): Promise<Chain | null> {
  const k = `us:${ticker}`;
  const hit = getMemo<Chain | null>(k, CHAIN_TTL);
  if (hit !== undefined) return hit;
  const y = await yahooChain(ticker, pick, k);
  if (y) return y;
  try {
    const n = await nasdaqChain(ticker);
    if (n) { chainError.delete(k); setMemo(k, n); return n; }
    chainError.set(k, `${chainError.get(k) ?? 'Yahoo failed'}; Nasdaq had no chain`);
  } catch (e: any) { chainError.set(k, `${chainError.get(k) ?? 'Yahoo failed'}; ${String(e?.message || e).slice(0, 60)}`); }
  setMemo(k, null);
  return null;
}
async function yahooChain(ticker: string, pick: (expiries: string[]) => string[], k: string): Promise<Chain | null> {
  const c = await yahooCrumb();
  if (!c) { chainError.set(k, 'Yahoo refused the options sign-in (crumb)'); return null; }
  const base = `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(ticker)}`;
  const get = async (date?: number) => {
    const u = `${base}?crumb=${encodeURIComponent(c.crumb)}${date ? `&date=${date}` : ''}`;
    const r = await fetch(u, { headers: { 'User-Agent': UA, Cookie: c.cookie }, cache: 'no-store', signal: AbortSignal.timeout(9000) });
    if (!r.ok) { chainError.set(k, `Yahoo options HTTP ${r.status}`); return null; }
    return (await r.json())?.optionChain?.result?.[0] ?? null;
  };
  try {
    const first = await get();
    if (!first) { if (!chainError.has(k)) chainError.set(k, 'Yahoo returned no option chain'); return null; }
    chainError.delete(k);
    const unix: number[] = (first.expirationDates ?? []).filter((x: any) => typeof x === 'number');
    const expiries = unix.map(isoOfUnix);
    const want = new Set(pick(expiries));
    const byExpiry: Chain['byExpiry'] = {};
    for (let i = 0; i < unix.length; i++) {
      if (!want.has(expiries[i])) continue;
      const res = first.options?.[0]?.expirationDate === unix[i] ? first : await get(unix[i]);
      const o = res?.options?.[0];
      if (!o) continue;
      byExpiry[expiries[i]] = { calls: (o.calls ?? []).map(yq).filter((q: ChainQuote) => q.strike > 0), puts: (o.puts ?? []).map(yq).filter((q: ChainQuote) => q.strike > 0) };
    }
    const chain: Chain = { expiries, byExpiry, source: 'Yahoo options', asOf: new Date().toISOString() };
    setMemo(k, chain);
    return chain;
  } catch (e: any) { chainError.set(k, `Yahoo options: ${String(e?.message || e).slice(0, 80)}`); return null; }
}

const MON: Record<string, string> = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
/** "25-Nov-2026" → "2026-11-25" */
export function nseDateIso(s: string): string | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(String(s || '').trim());
  if (!m) return null;
  const mo = MON[m[2].toUpperCase()]; if (!mo) return null;
  return `${m[3]}-${mo}-${m[1].padStart(2, '0')}`;
}
function nq(o: any, strike: number): ChainQuote {
  const iv = num(o?.impliedVolatility);
  return { strike, bid: num(o?.bidprice ?? o?.buyPrice1), ask: num(o?.askPrice ?? o?.sellPrice1), last: num(o?.lastPrice), iv: iv != null && iv > 0 ? iv / 100 : null, oi: num(o?.openInterest), volume: num(o?.totalTradedVolume) };
}
/** NSE equity option chain → Chain (pure; exported for tests) */
export function parseNseChain(j: any): Chain | null {
  const rec = j?.records ?? j;
  const data: any[] = Array.isArray(rec?.data) ? rec.data : [];
  if (!data.length) return null;
  const byExpiry: Chain['byExpiry'] = {};
  for (const row of data) {
    const ex = nseDateIso(row?.expiryDate ?? row?.expiryDates ?? row?.CE?.expiryDate ?? row?.PE?.expiryDate);
    const K = num(row?.strikePrice);
    if (!ex || K == null) continue;
    const slot = (byExpiry[ex] ||= { calls: [], puts: [] });
    if (row.CE) slot.calls.push(nq(row.CE, K));
    if (row.PE) slot.puts.push(nq(row.PE, K));
  }
  const expiries = Object.keys(byExpiry).sort();
  if (!expiries.length) return null;
  return { expiries, byExpiry, source: 'NSE option chain', asOf: typeof rec?.timestamp === 'string' ? rec.timestamp : null };
}
export async function inChain(symbol: string): Promise<Chain | null> {
  const k = `in:${symbol}`;
  const hit = getMemo<Chain | null>(k, CHAIN_TTL);
  if (hit !== undefined) return hit;
  let chain: Chain | null = null;
  try { chain = parseNseChain(await nseApiFetch(`/api/option-chain-equities?symbol=${encodeURIComponent(symbol)}`, CHAIN_TTL)); } catch { chain = null; }
  if (chain) chainError.delete(k); else chainError.set(k, 'NSE option chain could not be read from the server');
  setMemo(k, chain);
  return chain;
}

/** NSE F&O lot sizes (current month column). null when the file cannot be read. */
export function parseLots(csv: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const a = line.split(',').map((s) => s.trim());
    if (!a[1] || /NIFTY|SENSEX|BANKEX/.test(a[1]) || a[1].toUpperCase() === 'SYMBOL') continue;
    const v = Number(a[2]);
    if (v > 0) out[a[1].toUpperCase()] = v;
  }
  return out;
}
export async function nseLots(): Promise<Record<string, number> | null> {
  const hit = getMemo<Record<string, number> | null>('lots', 12 * 3600_000);
  if (hit !== undefined) return hit;
  try {
    const r = await fetch('https://nsearchives.nseindia.com/content/fo/fo_mktlots.csv', { headers: { 'User-Agent': UA }, cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    const lots = r.ok ? parseLots(await r.text()) : null;
    const v = lots && Object.keys(lots).length > 50 ? lots : null;
    setMemo('lots', v);
    return v;
  } catch { return null; }
}

// Options Ideas — choosing the expiry and strike for a setup (pure).
//
// Method
//  1. Volatility: 20-session and 60-session historical volatility of the stock (close to close, annualised). When a live
//     option chain is available its implied volatility is used for pricing instead, and the chain's real bid / ask mid.
//  2. Time: how long the move to target 1 is expected to take = the median sessions-to-target of this setup type in the
//     historical study (stats), else a structure-based guess. The expiry must leave at least 2.2× that time (so time decay
//     has not eaten the option when the target is hit) and never fewer than 21 calendar days; the nearest listed expiry at
//     or after that date is taken.
//  3. Strike: every strike from deep in-the-money to out-of-the-money is priced at three moments — now (premium), when
//     target 1 is hit (at the expected time) and when the stop is hit (at half that time) — and scored by expected value
//     per unit of premium, using the setup type's historical win rate. Strikes with delta outside 0.35–0.80 are skipped
//     (too much like stock / too much like a lottery ticket), as are illiquid strikes on a live chain.
//  4. The plan carries the premium, breakeven at expiry, option value and return at target 1 / target 2 / stop, the
//     maximum loss, and — for India — the lot size and the money per lot.

import { isTradingDay } from '../exchange-calendar';

export type Mkt = 'US' | 'IN';
export interface ChainQuote { strike: number; bid: number | null; ask: number | null; last: number | null; iv: number | null; oi: number | null; volume: number | null }
export interface Chain { expiries: string[]; byExpiry: Record<string, { calls: ChainQuote[]; puts: ChainQuote[] }>; source: string; asOf: string | null }

const SQ2 = Math.SQRT2;
function erf(x: number): number {
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const ncdf = (x: number) => 0.5 * (1 + erf(x / SQ2));

/** Black–Scholes price and delta. T in years; σ annual. */
export function bs(S: number, K: number, T: number, r: number, sigma: number, call: boolean): { price: number; delta: number } {
  if (T <= 1e-6 || sigma <= 0) {
    const intr = call ? Math.max(0, S - K) : Math.max(0, K - S);
    return { price: intr, delta: call ? (S > K ? 1 : 0) : (S < K ? -1 : 0) };
  }
  const v = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / v;
  const d2 = d1 - v;
  if (call) return { price: S * ncdf(d1) - K * Math.exp(-r * T) * ncdf(d2), delta: ncdf(d1) };
  return { price: K * Math.exp(-r * T) * ncdf(-d2) - S * ncdf(-d1), delta: ncdf(d1) - 1 };
}

/** annualised close-to-close volatility over the last n sessions */
export function histVol(closes: number[], n: number): number | null {
  if (closes.length < n + 1) return null;
  const r: number[] = [];
  for (let i = closes.length - n; i < closes.length; i++) if (closes[i - 1] > 0 && closes[i] > 0) r.push(Math.log(closes[i] / closes[i - 1]));
  if (r.length < n * 0.8) return null;
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const v = r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1);
  return Math.sqrt(v * 252);
}

/** volatility used for model prices when there is no chain: the higher of 20- and 60-session HV, × 1.1 (implied usually sits
 *  a little above realised), floored at 18 %. */
export function modelVol(closes: number[]): number {
  const a = histVol(closes, 20) ?? 0.35, b = histVol(closes, 60) ?? a;
  return Math.max(0.18, Math.max(a, b) * 1.1);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
function addDays(d: Date, n: number) { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }

/** Listed expiries when no chain is available: US = every Friday for 8 weeks, then the monthly (3rd Friday) for 9 months;
 *  India = the last Tuesday of the next 3 months (NSE stock options are monthly). Exchange holidays move an expiry a day
 *  earlier — the plan says to confirm the date in the broker. */
export function syntheticExpiries(m: Mkt, now: Date): string[] {
  const out: string[] = [];
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (m === 'US') {
    let d = addDays(start, 1);
    while (d.getUTCDay() !== 5) d = addDays(d, 1);
    for (let k = 0; k < 8; k++) out.push(iso(addDays(d, 7 * k)));
    for (let mo = 0; mo < 10; mo++) {
      const first = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + mo, 1));
      let f = first; while (f.getUTCDay() !== 5) f = addDays(f, 1);
      const third = addDays(f, 14);
      if (third > start && !out.includes(iso(third))) out.push(iso(third));
    }
  } else {
    for (let mo = 0; mo < 4; mo++) {
      const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + mo + 1, 0));
      let d = lastDay; while (d.getUTCDay() !== 2) d = addDays(d, -1);
      if (d > start) out.push(iso(d));
    }
  }
  // an exchange holiday moves the expiry to the trading day before (Christmas Friday → Thursday)
  const moved = out.map((d) => { let x = d; for (let k = 0; k < 5 && !isTradingDay(m, x); k++) x = iso(addDays(new Date(x + 'T12:00:00Z'), -1)); return x; });
  return Array.from(new Set(moved)).filter((d) => d > iso(start)).sort().slice(0, m === 'US' ? 16 : 3);
}

/** strike grid around the price when there is no chain */
export function syntheticStrikes(m: Mkt, S: number): number[] {
  const steps = [0.5, 1, 2.5, 5, 10, 20, 25, 50, 100, 250, 500];
  const raw = S * (m === 'US' ? (S < 25 ? 0.04 : 0.025) : 0.02);
  const step = steps.find((s) => s >= raw) ?? 500;
  const out: number[] = [];
  const lo = Math.max(step, Math.floor((S * 0.75) / step) * step), hi = Math.ceil((S * 1.25) / step) * step;
  for (let k = lo; k <= hi + 1e-9; k += step) out.push(Math.round(k * 100) / 100);
  return out;
}

export interface PlanInput {
  market: Mkt; call: boolean; spot: number; entry: number; stop: number; target1: number; target2: number;
  /** expected sessions to target 1 (the study's median for this group) */
  expSessions: number;
  closes: number[]; now: Date;
  chain?: Chain | null;
  lotSize?: number | null;
  /** estimated next results date (ISO): an expiry after it carries the results-day volatility drop */
  nextEarnings?: string | null;
  /** strike rule — target |delta| (study: 0.5 was the steadiest) and the minimum days to expiry (study: 30) */
  targetDelta?: number; minDte?: number;
}
export interface OptionPick {
  strike: number; expiry: string; dte: number; premium: number; premiumSource: 'chain' | 'model'; iv: number; delta: number; moneyness: string;
  breakeven: number;
  atTarget1: { value: number; retPct: number }; atTarget2: { value: number; retPct: number }; atStop: { value: number; retPct: number };
  maxLossPerContract: number;
  liquidity: { oi: number | null; spreadPct: number | null } | null;
}
export interface OptionPlan extends OptionPick {
  type: 'CALL' | 'PUT'; contractSize: number;
  /** a safer (deeper in the money) and a more aggressive (cheaper, out of the money) choice */
  safer: OptionPick | null; aggressive: OptionPick | null;
  notes: string[];
}

const daysBetween = (a: Date, b: string) => Math.round((Date.parse(b + 'T20:00:00Z') - a.getTime()) / 86_400_000);
const R2 = (x: number) => Math.round(x * 100) / 100;

/** pick the expiry: the first listed at or after max(minDte, 1.6 × the expected calendar days to target 1) */
export function pickExpiry(expiries: string[], now: Date, expSessions: number, minDte = 30): { expiry: string; need: number } | null {
  const calDays = Math.ceil(Math.max(3, Math.min(60, expSessions)) * 1.45);
  const need = Math.max(minDte, Math.ceil(calDays * 1.6));
  const ok = expiries.filter((e) => daysBetween(now, e) >= 7).sort();
  if (!ok.length) return null;
  return { expiry: ok.find((e) => daysBetween(now, e) >= need) ?? ok[ok.length - 1], need };
}

export function planOption(p: PlanInput): OptionPlan | null {
  const call = p.call;
  const contractSize = p.market === 'US' ? 100 : Math.max(1, p.lotSize ?? 1);
  const r = p.market === 'US' ? 0.04 : 0.065;
  const hv = modelVol(p.closes);
  const expiries = p.chain?.expiries?.length ? p.chain.expiries : syntheticExpiries(p.market, p.now);
  const pe = pickExpiry(expiries, p.now, p.expSessions, p.minDte ?? 30);
  if (!pe) return null;
  const ex = pe.expiry;
  const dte = daysBetween(p.now, ex), T = dte / 365;
  const calDays = Math.ceil(Math.max(3, Math.min(60, p.expSessions)) * 1.45);
  const tHit = Math.min(T * 0.9, calDays / 365), tStop = Math.min(T * 0.9, (calDays * 0.5) / 365);
  const chainSide0 = p.chain?.byExpiry?.[ex] ? (call ? p.chain.byExpiry[ex].calls : p.chain.byExpiry[ex].puts) : null;
  const strikes = chainSide0?.length ? chainSide0.map((q) => q.strike) : syntheticStrikes(p.market, p.spot);
  // outside market hours Yahoo sends bid = ask = 0, OI 0 and a placeholder IV: then the chain gives the real strikes and expiry only
  const quotesLive = !!chainSide0?.some((q) => (q.bid ?? 0) > 0 && (q.ask ?? 0) > 0);
  const chainSide = quotesLive ? chainSide0 : null;
  const crush = p.nextEarnings && p.nextEarnings <= ex ? 0.85 : 1;
  const priced: Array<OptionPick & { absDelta: number; liquid: boolean }> = [];
  for (const K of strikes) {
    if (K < p.spot * 0.7 || K > p.spot * 1.3) continue;
    const q = chainSide?.find((z) => z.strike === K) ?? null;
    const mid = q && q.bid != null && q.ask != null && q.ask > 0 && q.bid > 0 ? (q.bid + q.ask) / 2 : q?.last ?? null;
    const iv = q?.iv && q.iv > 0.03 && q.iv < 4 ? q.iv : hv;
    const now = bs(p.spot, K, T, r, iv, call);
    const prem = mid != null && mid > 0 ? mid : now.price;
    if (!(prem > 0)) continue;
    const spreadPct = q && q.bid != null && q.ask != null && q.ask > 0 && q.bid > 0 ? ((q.ask - q.bid) / ((q.ask + q.bid) / 2)) * 100 : null;
    const liquid = !chainSide?.length || !!q && ((q.oi ?? 0) >= (p.market === 'US' ? 100 : 50) || (q.volume ?? 0) >= 20) && (spreadPct == null || spreadPct <= 15);
    const v1 = bs(p.target1, K, Math.max(0, T - tHit), r, iv * crush, call).price;
    const v2 = bs(p.target2, K, Math.max(0, T - tHit * 1.6), r, iv * crush, call).price;
    const vS = bs(p.stop, K, Math.max(0, T - tStop), r, iv, call).price;
    const itm = call ? K < p.spot : K > p.spot;
    const pctAway = Math.abs(K / p.spot - 1) * 100;
    priced.push({
      strike: K, expiry: ex, dte, premium: R2(prem), premiumSource: mid != null && mid > 0 ? 'chain' : 'model', iv: Math.round(iv * 1000) / 10, delta: R2(now.delta),
      moneyness: pctAway < 1.5 ? 'at the money' : `${pctAway.toFixed(1)}% ${itm ? 'in' : 'out of'} the money`,
      breakeven: R2(call ? K + prem : K - prem),
      atTarget1: { value: R2(v1), retPct: Math.round(((v1 - prem) / prem) * 100) },
      atTarget2: { value: R2(v2), retPct: Math.round(((v2 - prem) / prem) * 100) },
      atStop: { value: R2(vS), retPct: Math.round(((vS - prem) / prem) * 100) },
      maxLossPerContract: R2(prem * contractSize),
      liquidity: q ? { oi: q.oi, spreadPct: spreadPct != null ? Math.round(spreadPct * 10) / 10 : null } : null,
      absDelta: Math.abs(now.delta), liquid,
    });
  }
  const liquidPool = priced.filter((x) => x.liquid);
  const thin = !liquidPool.length && priced.length > 0;
  const pool = thin ? priced : liquidPool;
  if (!pool.length) return null;
  const near = (d: number) => [...pool].sort((a, b) => Math.abs(a.absDelta - d) - Math.abs(b.absDelta - d))[0] ?? null;
  const td = p.targetDelta ?? 0.5;
  const best = near(td);
  if (!best) return null;
  const strip = (x: (typeof pool)[number] | null): OptionPick | null => { if (!x) return null; const { absDelta: _a, liquid: _l, ...o } = x; return o; };
  const saferC = near(0.7), aggC = near(0.35);
  const notes: string[] = [];
  if (thin) notes.push('Thin options: no strike near the money has open interest ≥ ' + (p.market === 'US' ? 100 : 50) + ' or volume ≥ 20 with a spread ≤ 15% — fills may be poor; consider trading the stock instead.');
  if (best.premiumSource === 'model') notes.push(chainSide0?.length && !quotesLive
    ? `Listed strikes and expiry are real, but the chain has no live bid / ask right now (outside market hours) — premium is a model price (volatility ${best.iv}%).`
    : `Premium is a model price (volatility ${best.iv}%) — no live option chain was available; check the real bid / ask before trading.`);
  if (!p.chain?.expiries?.length) notes.push(p.market === 'US' ? 'Expiry from the standard Friday / monthly calendar — confirm it is listed.' : 'NSE stock options expire on the last Tuesday of the month (a holiday moves it earlier) — confirm in the broker.');
  if (p.nextEarnings && p.nextEarnings <= ex) notes.push(`Results expected around ${p.nextEarnings}, before expiry — option prices usually drop after results (priced in above).`);
  notes.push(`Expiry: at least ${pe.need} days, so the move gets about 1.6× the time it usually took (median ~${Math.round(p.expSessions)} sessions to target 1).`);
  const base = strip(best)!;
  return {
    ...base, type: call ? 'CALL' : 'PUT', contractSize,
    safer: saferC && saferC.strike !== best.strike ? strip(saferC) : null,
    aggressive: aggC && aggC.strike !== best.strike ? strip(aggC) : null,
    notes,
  };
}

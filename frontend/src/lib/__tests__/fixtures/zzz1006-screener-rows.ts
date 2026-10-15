// zzz1006 — deterministic synthetic screener snapshot used to prove the Stock Screener redesign changed presentation only:
// the same screens give the same matches, the same order, the same copied tickers and the same CSV before and after.
import { FIELDS } from '../../screener/filters';
import { TV_SECTORS } from '../../screener/tv-sectors';
import type { ScreenMarket, ScreenRow } from '../../screener/types';

/** Fixed "now" for the date filters (this month / last N years): 13 Oct 2026, 12:00 UTC. */
export const FIXED_NOW = Date.UTC(2026, 9, 13, 12, 0, 0);
const DAY = 86_400_000;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function fixtureRows(market: ScreenMarket, n = 1500): ScreenRow[] {
  const r = rng(market === 'US' ? 1006 : 6001);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const between = (lo: number, hi: number) => lo + (hi - lo) * r();
  const out: ScreenRow[] = [];
  for (let i = 0; i < n; i++) {
    const px = Math.round(Math.exp(between(Math.log(2), Math.log(4000))) * 100) / 100;
    const row: any = {
      t: `${market === 'US' ? 'U' : 'I'}${String(i).padStart(4, '0')}`, n: `Fixture company ${i}`,
      sec: pick(['Technology', 'Industrials', 'Financials', 'Health care', 'Energy']), ind: pick(['Semiconductors', 'Software', 'Banks', 'Pharma', 'Oil', 'Machinery']),
      px, q: r() < 0.9 ? 'Q2 2026' : null, tvSec: pick(TV_SECTORS),
      exch: market === 'US' ? [pick(['NASDAQ', 'NYSE', 'AMEX'])] : (r() < 0.6 ? ['NSE', 'BSE'] : ['NSE']),
    };
    for (const f of FIELDS) {
      if (f.key === 'px' || !f.markets.includes(market)) continue;
      if (f.group === 'Trader setups') continue;   // zzz1020 — added after the golden file: left out so the random stream is unchanged
      if (f.key === 'fcfmT' || f.key === 'r40T') continue;   // zzz1045e — added after the golden file (same reason)
      if (f.group === 'Volume & accumulation') continue;   // zzz1046a — added after the golden file (same reason)
      if (r() < 0.08) { row[f.key] = null; continue; }
      const u = f.unit;
      let v: number;
      if (u === 'price') v = px * between(0.6, 1.35);
      else if (u === '%') v = between(-60, 160);
      else if (u === 'money') v = Math.exp(between(Math.log(20), Math.log(900_000)));
      else if (u === 'x') v = between(-5, 90);
      else if (u === 'shares') v = Math.exp(between(Math.log(1e3), Math.log(3e8)));
      else if (u === 'usd') v = between(0, 50);
      else if (u === 'date') v = Math.floor((FIXED_NOW - (r() < 0.25 ? between(0, 10) : between(40, 9000)) * DAY) / DAY);
      else v = f.key === 'tt' ? Math.floor(between(0, 7)) : /Ok$|^st12$|^ripB$/.test(f.key) ? (r() < 0.4 ? 1 : 0) : f.key === 'stage' ? Math.floor(between(1, 5)) : f.key === 'fs' ? Math.floor(between(0, 10)) : between(0, 100);
      row[f.key] = Math.round(v * 1000) / 1000;
    }
    if (r() < 0.05) row.approx = ['evRev'];
    if (r() < 0.04) { row.scanPx = Math.round(px * 0.97 * 100) / 100; row.scanAt = '2026-10-12'; row.pxGap = 3.1; }
    out.push(row as ScreenRow);
  }
  return out;
}

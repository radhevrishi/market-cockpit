// zzz883 — one source for the rupee/dollar rate. Before this, three tabs multiplied by a fixed 85.
// Server: Yahoo INR=X, cached 6 h in memory and in Redis; if Yahoo fails, the last good rate (any age) with its date;
// only when nothing was ever fetched, 85 — and the answer then says live:false so the UI can say "approximate".
import { fetchChart } from './yahoo';
import { kvGet, kvSet } from './kv';

export interface FxRate { usdInr: number; asOf: string | null; source: string; live: boolean }
export const FX_FALLBACK = 85;
const KEY = 'fx:usdinr:v1';
const FRESH_MS = 6 * 3_600_000;
let mem: { at: number; v: FxRate } | null = null;

/** Pure: a sane USD/INR (guards a bad tick or a wrong symbol). */
export function plausibleUsdInr(x: unknown): x is number { return typeof x === 'number' && Number.isFinite(x) && x > 50 && x < 200; }

export async function getUsdInr(): Promise<FxRate> {
  if (mem && Date.now() - mem.at < FRESH_MS) return mem.v;
  const saved = await kvGet<FxRate & { at: number }>(KEY).catch(() => null);
  if (saved && Date.now() - saved.at < FRESH_MS && plausibleUsdInr(saved.usdInr)) { mem = { at: saved.at, v: saved }; return saved; }
  try {
    const c: any = await fetchChart('INR=X', '5d', '1d');
    const px = Number(c?.regularMarketPrice ?? c?.price);
    if (plausibleUsdInr(px)) {
      const v: FxRate = { usdInr: Math.round(px * 100) / 100, asOf: new Date().toISOString(), source: 'Yahoo INR=X', live: true };
      mem = { at: Date.now(), v };
      await kvSet(KEY, { ...v, at: Date.now() }, 30 * 86_400).catch(() => {});
      return v;
    }
  } catch { /* fall through */ }
  if (saved && plausibleUsdInr(saved.usdInr)) { const v = { ...saved, live: false, source: `${saved.source} (last known)` }; mem = { at: Date.now() - FRESH_MS + 10 * 60_000, v }; return v; }
  return { usdInr: FX_FALLBACK, asOf: null, source: 'fallback (no live rate)', live: false };
}

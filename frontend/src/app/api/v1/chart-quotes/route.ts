// zzz940 — GET /api/v1/chart-quotes?s=IN:TCS,US:QQQ,… → last price, day change % and company name for the /charts
// watchlist panel. One Yahoo spark batch per market (20 symbols per upstream call, via lib/yahoo fetchYahooSparkBatch);
// India tries .NS first, then .BO for the ones still missing. In-memory cache 45 s. Public market data. Max 300 symbols.
import { NextRequest, NextResponse } from 'next/server';
import { fetchYahooSparkBatch } from '@/lib/yahoo';
import { IN_TICKER_RE, US_TICKER_RE } from '@/lib/chart-math';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface Q { last: number | null; chgPct: number | null; name: string | null }
const _cache = new Map<string, { at: number; q: Q | null }>();
const TTL_MS = 45_000;
const MAX = 300;

export async function GET(req: NextRequest) {
  const raw = String(req.nextUrl.searchParams.get('s') || '');
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const [m, t] = part.trim().toUpperCase().split(':');
    if (!t || (m !== 'IN' && m !== 'US')) continue;
    if (!(m === 'IN' ? IN_TICKER_RE : US_TICKER_RE).test(t)) continue;
    const k = `${m}:${t}`;
    if (seen.has(k)) continue;
    seen.add(k); keys.push(k);
    if (keys.length >= MAX) break;
  }
  const now = Date.now();
  const out: Record<string, Q> = {};
  const needIn: string[] = [], needUs: string[] = [];
  for (const k of keys) {
    const hit = _cache.get(k);
    if (hit && now - hit.at < TTL_MS) { if (hit.q) out[k] = hit.q; continue; }
    const t = k.slice(3);
    (k.startsWith('IN:') ? needIn : needUs).push(t);
  }
  const put = (k: string, v: { lastPrice: number | null; pChange: number | null; companyName: string | null } | undefined) => {
    if (!v || v.lastPrice == null) return false;
    const q: Q = { last: v.lastPrice, chgPct: v.pChange != null && Number.isFinite(v.pChange) ? v.pChange : null, name: v.companyName };
    out[k] = q; _cache.set(k, { at: now, q });
    return true;
  };
  const [inNs, us] = await Promise.all([
    needIn.length ? fetchYahooSparkBatch(needIn.map((t) => `${t}.NS`)) : Promise.resolve(new Map()),
    needUs.length ? fetchYahooSparkBatch(needUs.map((t) => t.replace(/\./g, '-'))) : Promise.resolve(new Map()),
  ]);
  const missIn = needIn.filter((t) => !put(`IN:${t}`, inNs.get(t)));
  for (const t of needUs) if (!put(`US:${t}`, us.get(t.replace(/\./g, '-')))) _cache.set(`US:${t}`, { at: now, q: null });
  if (missIn.length) {
    const bo = await fetchYahooSparkBatch(missIn.map((t) => `${t}.BO`));
    for (const t of missIn) if (!put(`IN:${t}`, bo.get(t))) _cache.set(`IN:${t}`, { at: now, q: null });
  }
  if (_cache.size > 3000) { for (const [k, v] of _cache) if (now - v.at > TTL_MS) _cache.delete(k); }
  return NextResponse.json({ ok: true, quotes: out, asOf: new Date(now).toISOString() }, { headers: { 'Cache-Control': 'private, max-age=30' } });
}

// zzz940 — GET /api/v1/chart-quotes?s=IN:TCS,US:QQQ,… → last price, day change % and company name for the /charts
// watchlist panel. One Yahoo spark batch per market (20 symbols per upstream call, via lib/yahoo fetchYahooSparkBatch);
// India tries .NS first, then .BO for the ones still missing. In-memory cache 45 s. Public market data. Max 300 symbols.
import { NextRequest, NextResponse } from 'next/server';
import { fetchYahooSparkBatch } from '@/lib/yahoo';
import { yahooCandidates } from '@/lib/yahoo-symbol';
import { IN_TICKER_RE, US_TICKER_RE } from '@/lib/chart-math';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface Q { last: number | null; chgPct: number | null; name: string | null; ext?: number | null }
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
  const put = (k: string, v: { lastPrice: number | null; pChange: number | null; companyName: string | null; extPct?: number | null } | undefined) => {
    if (!v || v.lastPrice == null) return false;
    const q: Q = { last: v.lastPrice, chgPct: v.pChange != null && Number.isFinite(v.pChange) ? v.pChange : null, name: v.companyName, ext: k.startsWith('US:') && v.extPct != null && Number.isFinite(v.extPct) ? v.extPct : null };
    out[k] = q; _cache.set(k, { at: now, q });
    return true;
  };
  // zzz943: one spark batch for every first-choice Yahoo symbol (index names and renamed tickers mapped), then .BO for India misses
  const first = new Map<string, string>();   // Yahoo symbol → our key
  for (const t of needIn) first.set(yahooCandidates('IN', t)[0], `IN:${t}`);
  for (const t of needUs) first.set(yahooCandidates('US', t)[0], `US:${t}`);
  const got = first.size ? await fetchYahooSparkBatch(Array.from(first.keys())) : new Map();
  const miss: string[] = [];
  for (const [ysym, k] of first) {
    const base = ysym.replace(/\.(NS|BO)$/i, '');
    if (!put(k, got.get(base) ?? got.get(ysym))) miss.push(k);
  }
  const second = new Map<string, string>();
  for (const k of miss) { const c = yahooCandidates(k.slice(0, 2) as 'IN' | 'US', k.slice(3))[1]; if (c) second.set(c, k); else _cache.set(k, { at: now, q: null }); }
  if (second.size) {
    const bo = await fetchYahooSparkBatch(Array.from(second.keys()));
    for (const [ysym, k] of second) if (!put(k, bo.get(ysym.replace(/\.(NS|BO)$/i, '')) ?? bo.get(ysym))) _cache.set(k, { at: now, q: null });
  }
  if (_cache.size > 3000) { for (const [k, v] of _cache) if (now - v.at > TTL_MS) _cache.delete(k); }
  return NextResponse.json({ ok: true, quotes: out, asOf: new Date(now).toISOString() }, { headers: { 'Cache-Control': 'private, max-age=30' } });
}

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

interface Q { last: number | null; chgPct: number | null; name: string | null; ext?: number | null; at: number; marketTime?: number | null }
const _cache = new Map<string, { at: number; q: Q | null }>();
const TTL_MS = 45_000;
const MAX = 300;

export async function GET(req: NextRequest) {
  const raw = String(req.nextUrl.searchParams.get('s') || '');
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const parts = part.trim().toUpperCase().split(':');
    const [m] = parts;
    const ex = parts.length === 3 && parts[1] === 'BSE' ? 'BSE' : undefined;
    const t = ex ? parts[2] : parts[1];
    if (parts.length !== (ex ? 3 : 2)) continue;
    if (!t || (m !== 'IN' && m !== 'US')) continue;
    if (!(m === 'IN' ? IN_TICKER_RE : US_TICKER_RE).test(t)) continue;
    const k = ex ? `${m}:BSE:${t}` : `${m}:${t}`;
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
    (k.startsWith('IN:') ? needIn : needUs).push(k);
  }
  const put = (k: string, v: { lastPrice: number | null; pChange: number | null; companyName: string | null; extPct?: number | null; marketTime?: number | null } | undefined) => {
    if (!v || v.lastPrice == null) return false;
    const q: Q = { at: now, marketTime: v.marketTime ?? null, last: v.lastPrice, chgPct: v.pChange != null && Number.isFinite(v.pChange) ? v.pChange : null, name: v.companyName, ext: k.startsWith('US:') && v.extPct != null && Number.isFinite(v.extPct) ? v.extPct : null };
    out[k] = q; _cache.set(k, { at: now, q });
    return true;
  };
  // zzz943: one spark batch for every first-choice Yahoo symbol (index names and renamed tickers mapped), then .BO for India misses
  const first = new Map<string, string>();   // Yahoo symbol → our key
  for (const k of needIn) first.set(yahooCandidates('IN', k.split(':').at(-1)!, k.startsWith('IN:BSE:') ? 'BSE' : undefined)[0], k);
  for (const k of needUs) first.set(yahooCandidates('US', k.slice(3))[0], k);
  const got = first.size ? await fetchYahooSparkBatch(Array.from(first.keys()), true) : new Map();
  const miss: string[] = [];
  for (const [ysym, k] of first) {
    // The exchange-specific map is authoritative: a missing .BO must never borrow a .NS quote.
    if (!put(k, got.get(ysym))) miss.push(k);
  }
  const second = new Map<string, string>();
  for (const k of miss) { const c = yahooCandidates(k.slice(0, 2) as 'IN' | 'US', k.split(':').at(-1)!, k.startsWith('IN:BSE:') ? 'BSE' : undefined)[1]; if (c) second.set(c, k); else _cache.set(k, { at: now, q: null }); }
  if (second.size) {
    const bo = await fetchYahooSparkBatch(Array.from(second.keys()), true);
    for (const [ysym, k] of second) if (!put(k, bo.get(ysym))) _cache.set(k, { at: now, q: null });
  }
  if (_cache.size > 3000) { for (const [k, v] of _cache) if (now - v.at > TTL_MS) _cache.delete(k); }
  return NextResponse.json({ ok: true, quotes: out, asOf: new Date(now).toISOString() }, { headers: { 'Cache-Control': 'private, max-age=30' } });
}

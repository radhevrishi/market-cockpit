// zzz1089 — GET /api/v1/fin-fallback?tickers=E2E,MAPROIN (India, at most 20): debt ÷ equity and the year's cash from operations /
// net profit read from each company's screener.in page, for cards where the stock-screener snapshot and the earnings feed have no
// figure. The stored page from the screener build (Postgres) is used first; otherwise the page is read live (consolidated, then
// standalone). Memory cache only: 12 h for a found figure, 1 h when nothing was found. Nothing written to Redis.
import { NextRequest, NextResponse } from 'next/server';
import { dbAvailable, dbQuery } from '@/lib/db';
import { fetchScreenerHtml } from '@/lib/earnings/screener-fetch';
import { screenerSymbol } from '@/lib/earnings/screener-documents';
import { rawFromHtml, type InRaw } from '@/lib/screener/in-assemble';
import { finFallbackFromRaw, type FinFallback } from '@/lib/fin-fallback';
import { kvGet } from '@/lib/kv';

const SEARCH_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36', Accept: 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://www.screener.in/' };

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

const TICKER_RE = /^[A-Z0-9][A-Z0-9&\-]{0,19}$/;
const _cache = new Map<string, { at: number; ttl: number; v: (FinFallback & { source: string }) | { error: string } }>();

async function readOne(t: string, stored: InRaw | null, name?: string): Promise<(FinFallback & { source: string }) | { error: string }> {
  if (stored) {
    const f = finFallbackFromRaw(stored);
    if (f.de != null || f.cfo != null) return { ...f, source: 'screener.in page (stored by the screener build)' };
  }
  const sym = encodeURIComponent(screenerSymbol(t));
  let last = 'not read';
  for (const [basis, url] of [['consolidated', `https://www.screener.in/company/${sym}/consolidated/`], ['standalone', `https://www.screener.in/company/${sym}/`]] as const) {
    const got = await fetchScreenerHtml(url, 12_000);
    if (!got.html) { last = got.error ? got.error.slice(0, 120) : 'no answer'; continue; }
    const f = finFallbackFromRaw(rawFromHtml(got.html, {}));
    if (f.de != null || f.cfo != null) return { ...f, source: `screener.in page (${basis}, read live)` };
    last = `no balance sheet on the ${basis} page`;
  }
  // zzz1090b — a BSE-only company has no page under its symbol: use the page slug the earnings engine already found for it
  // (KV screener-slug:v3:<SYMBOL>, usually the BSE code), else ask screener.in's company search (direct, like the engine does)
  let slug: string | null = null;
  try { const c = await kvGet<unknown>(`screener-slug:v3:${t}`); if (c != null && String(c) && String(c) !== '-') slug = String(c); } catch { /* optional */ }   // a BSE code can come back as a number
  if (!slug) {
    const words = String(name || '').replace(/&amp;/g, '&').replace(/\b(ltd|limited|pvt|private|the)\b\.?/gi, ' ').replace(/[^A-Za-z0-9& ]+/g, ' ').trim().split(/\s+/).slice(0, 4).join(' ');
    for (const q of [t, words].filter(Boolean)) {
      try {
        const res = await fetch(`https://www.screener.in/api/company/search/?q=${encodeURIComponent(q)}`, { headers: SEARCH_HEADERS, signal: AbortSignal.timeout(6000) });
        const list: any[] = res.ok ? await res.json().catch(() => []) : [];
        const slugs = (Array.isArray(list) ? list : []).map((c) => /^\/company\/([^/]+)\//.exec(String(c?.url || ''))?.[1] || '').filter(Boolean);
        slug = slugs.find((x) => x.toUpperCase() === t) || slugs[0] || null;
        if (slug) break;
        if (!res.ok) last = `company search HTTP ${res.status}`;
      } catch { last = 'company search did not answer'; }
    }
  }
  if (slug && slug.toUpperCase() !== t) {
    for (const [basis, url] of [['consolidated', `https://www.screener.in/company/${encodeURIComponent(slug)}/consolidated/`], ['standalone', `https://www.screener.in/company/${encodeURIComponent(slug)}/`]] as const) {
      const got = await fetchScreenerHtml(url, 12_000);
      if (!got.html) continue;
      const f = finFallbackFromRaw(rawFromHtml(got.html, {}));
      if (f.de != null || f.cfo != null) return { ...f, source: `screener.in page ${slug} (${basis}, read live)` };
      last = `no balance sheet on page ${slug}`;
    }
  }
  return { error: last.split('\n')[0].slice(0, 120) };
}

export async function GET(req: NextRequest) {
  // zzz1090b — optional company names (same order as tickers, '|' separated) to find a BSE-only company's page by name
  const rawT = String(req.nextUrl.searchParams.get('tickers') || '').split(',');
  const rawN = String(req.nextUrl.searchParams.get('names') || '').split('|');
  const nameOf = new Map<string, string>();
  rawT.forEach((t, i) => { const k = t.trim().toUpperCase().replace(/^(NSE|BSE):/, '').replace(/-(EQ|BE|SM|ST|BZ)$/, ''); if (rawN[i]) nameOf.set(k, rawN[i].slice(0, 80)); });
  const list = Array.from(new Set(String(req.nextUrl.searchParams.get('tickers') || '').split(',').map((s) => s.trim().toUpperCase().replace(/^(NSE|BSE):/, '').replace(/-(EQ|BE|SM|ST|BZ)$/, '')).filter((s) => TICKER_RE.test(s)))).slice(0, 20);
  if (!list.length) return NextResponse.json({ ok: false, error: 'tickers= is required (India symbols, comma separated).' }, { status: 400 });
  const now = Date.now();
  const need = list.filter((t) => { const c = _cache.get(t); return !c || now - c.at > c.ttl; });
  if (need.length) {
    const stored = new Map<string, InRaw>();
    if (dbAvailable()) {
      try {
        const rows = await dbQuery<{ ticker: string; payload: any }>(`SELECT ticker, payload FROM screener_store WHERE market = 'IN' AND kind = 'fund' AND ticker = ANY($1)`, [need]);
        for (const r of rows) if (r?.payload?.raw) stored.set(String(r.ticker).toUpperCase(), r.payload.raw as InRaw);
      } catch { /* the page is read live instead */ }
    }
    const results = await Promise.all(need.map(async (t) => [t, await readOne(t, stored.get(t) || null, nameOf.get(t)).catch((e) => ({ error: String(e?.message || e) }))] as const));
    for (const [t, v] of results) {
      if (_cache.size >= 2000) { const first = _cache.keys().next().value; if (first) _cache.delete(first); }
      _cache.set(t, { at: now, ttl: 'error' in v ? 3600_000 : 12 * 3600_000, v });
    }
  }
  const out: Record<string, unknown> = {};
  for (const t of list) out[t] = _cache.get(t)?.v ?? { error: 'not read' };
  return NextResponse.json({ ok: true, results: out }, { headers: { 'Cache-Control': 'private, max-age=600' } });
}

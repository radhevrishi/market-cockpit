// ═══════════════════════════════════════════════════════════════════════════
// GET /api/v1/book/bse-map?codes=543573,526612 — BSE scrip code → NSE symbol.
//                                                                    (zzz825)
// For the India book: a holding saved as a 6-digit BSE code is matched to its
// NSE symbol from in-app sources only — the earnings search index (graded
// rows carry the BSE code) and the screener.in company page for the code.
// No hard-coded map. Answer: { matches: { [code]: { symbol|null, company, via } } }
// (symbol null = looked up, no NSE listing; via 'lookup failed' = source down).
// Behind the owner's site login (PROTECTED_API_PREFIXES '/api/v1/book/').
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';
import { fetchScreenerHtml } from '@/lib/earnings/screener-fetch';
import { companyNameFromPage } from '@/lib/ai-gainers/news-context';
import { nseSymbolFromScreenerPage, matchFromIndex } from '@/lib/thesis/bse-nse-lookup';
import type { BseMatch } from '@/lib/thesis/book-membership';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const FOUND_TTL_S = 30 * 86_400;
const MISS_TTL_S = 86_400;
const key = (c: string) => `bse-nse:v1:${c}`;

export async function GET(req: NextRequest) {
  const codes = Array.from(new Set(String(req.nextUrl.searchParams.get('codes') || '').split(',').map((s) => s.trim()).filter((s) => /^\d{6}$/.test(s)))).slice(0, 40);
  if (!codes.length) return NextResponse.json({ ok: true, matches: {} });
  const t0 = Date.now();
  const matches: Record<string, BseMatch> = {};
  let index: any[] | null = null;
  try { const ix = await kvGet<any[]>('search:idx:v3'); index = Array.isArray(ix) ? ix : null; } catch { index = null; }
  for (const code of codes) {
    try { const hit = await kvGet<BseMatch>(key(code)); if (hit && typeof hit === 'object') { matches[code] = hit; continue; } } catch { /* cold */ }
    let m: BseMatch | null = matchFromIndex(code, index);
    if (!m && Date.now() - t0 >= 40_000) { matches[code] = { symbol: null, company: null, via: 'lookup failed' }; continue; }
    if (!m) {
      const page = await fetchScreenerHtml(`https://www.screener.in/company/${code}/`, 12_000).catch(() => ({ html: null } as any));
      if (page?.html) {
        const sym = nseSymbolFromScreenerPage(page.html);
        m = { symbol: sym, company: companyNameFromPage(page.html), via: sym ? 'screener.in company page' : 'screener.in — BSE-only scrip' };
      } else {
        matches[code] = { symbol: null, company: null, via: 'lookup failed' };
        continue;
      }
    }
    if (!m) m = { symbol: null, company: null, via: 'no in-app source names it' };
    matches[code] = m;
    try { await kvSet(key(code), m, m.symbol ? FOUND_TTL_S : MISS_TTL_S); } catch { /* fine */ }
  }
  return NextResponse.json({ ok: true, matches, ms: Date.now() - t0 }, { headers: { 'Cache-Control': 'no-store' } });
}

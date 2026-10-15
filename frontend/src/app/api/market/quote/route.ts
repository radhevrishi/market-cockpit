import { NextResponse } from 'next/server';
import { fetchStockQuote } from '@/lib/nse';
import { fetchQuotesWithFallback } from '@/lib/yahoo';
import { rateLimitResponse } from '@/lib/rateLimit';
import { MemoLru, singleFlight } from '@/lib/server-memo';
import { serverTiming, withServerTiming } from '@/lib/server-timing';

export const dynamic = 'force-dynamic';

// Response-level cache (avoids re-assembly on rapid polls)
const responseCache = new Map<string, { data: any; ts: number }>();
const RESPONSE_TTL = 30_000; // 30s cache for assembled response

// PATCH 0780 — Reusable pct/change resolver. NSE pChange returns 0 on
// weekends + holidays even with valid prices; compute from lastPrice +
// previousClose as fallback.
function resolvePctChange(lastPrice: number, previousClose: number, reportedChange: number, reportedPct: number) {
  const canCompute = lastPrice > 0 && previousClose > 0;
  const computedChange = canCompute ? lastPrice - previousClose : 0;
  const computedPct = canCompute ? ((lastPrice - previousClose) / previousClose) * 100 : 0;
  return {
    change: reportedChange !== 0 ? reportedChange : computedChange,
    changePercent: reportedPct !== 0 ? reportedPct : computedPct,
  };
}

// zzz1053 — per-symbol quotes (normalised rows), kept 60 s; a symbol asked by two requests at once is fetched once
const SYMBOL_TTL_MS = 60_000;
const NSE_DEADLINE_MS = 3_000;
const _symMemo = new MemoLru<any>({ maxEntries: 2000 });
type NseAnswer = { ok: true; quote: any } | { ok: false; error: string };
const _nseInflight = new Map<string, Promise<NseAnswer>>();
const TIMED_OUT = Symbol('timed-out');
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<typeof TIMED_OUT>((r) => { timer = setTimeout(() => r(TIMED_OUT), ms); })]).finally(() => clearTimeout(timer));
}
async function nseQuote(symbol: string): Promise<NseAnswer> {
  try {
    const data = await fetchStockQuote(symbol);
    if (!data || !data.priceInfo) return { ok: false, error: 'no data' };
    const pi = data.priceInfo;
    const info = data.info || {};
    const meta = data.metadata || {};
    const lastPrice = pi.lastPrice || pi.close || 0;
    const previousClose = pi.previousClose || 0;
    const { change, changePercent } = resolvePctChange(lastPrice, previousClose, pi.change || 0, pi.pChange || 0);
    return { ok: true, quote: {
      ticker: info.symbol || symbol,
      company: info.companyName || meta.companyName || symbol,
      sector: meta.industry || info.industry || '—',
      industry: meta.industry || info.industry || '—',
      price: lastPrice,
      change,
      changePercent,
      // zzz1000 (CW-01) — no high / low invented from the last price; null = not given
      dayHigh: pi.intraDayHighLow?.max || null,
      dayLow: pi.intraDayHighLow?.min || null,
      open: pi.open || 0,
      previousClose,
      weekHigh52: pi.weekHighLow?.max || 0,
      weekLow52: pi.weekHighLow?.min || 0,
      totalTradedVolume: data.preOpenMarket?.totalTradedVolume || 0,
      marketCap: data.securityInfo?.issuedSize ? (data.securityInfo.issuedSize * lastPrice) / 10000000 : null,
    } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'fetch failed' };
  }
}
function yahooRow(q: any, baseSym: string): any | null {
  const price = q.regularMarketPrice || 0;
  const prevClose = q.regularMarketPreviousClose || 0;
  if (price <= 0) return null;
  const { change, changePercent } = resolvePctChange(price, prevClose, q.regularMarketChange || 0, q.regularMarketChangePercent || 0);
  return {
    ticker: baseSym,
    company: q.shortName || baseSym,
    sector: '—',
    industry: '—',
    price,
    change,
    changePercent,
    dayHigh: q.regularMarketDayHigh || null,   // zzz1000 (CW-01) — not padded with the price
    dayLow: q.regularMarketDayLow || null,
    open: q.regularMarketOpen || 0,
    previousClose: prevClose,
    weekHigh52: q.fiftyTwoWeekHigh || 0,
    weekLow52: q.fiftyTwoWeekLow || 0,
    totalTradedVolume: q.regularMarketVolume || 0,
    marketCap: q.marketCap ? Math.round(q.marketCap / 10000000) : null,
  };
}

/**
 * GET /api/market/quote?symbols=AEROFLEX,CEINSYS,MACPOWER
 * Fetches individual stock quotes from NSE for tickers not in any index.
 * Returns array of normalized stock quote objects.
 * Max 20 symbols per call to stay within Vercel timeout.
 */
export async function GET(request: Request) {
  const limited = rateLimitResponse(request, 120, 60_000);
  if (limited) return limited;
  const { searchParams } = new URL(request.url);
  const symbolsParam = searchParams.get('symbols') || '';

  // Build cache key based on symbols param
  const cacheKey = `quote:${symbolsParam}`;

  // Check response cache
  const cached = responseCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < RESPONSE_TTL) {
    return NextResponse.json(cached.data);
  }

  // Symbol alias map for known mismatches (BUG-03 fix)
  const SYMBOL_ALIASES: Record<string, string> = {
    'SJS': 'SJSENTERPR',
    'S&SPOWER': 'S&SPOWER',    // NSE uses S&SPOWER; fetchStockQuote handles URL encoding
    'SENORES': 'SENORES',         // Verify correct NSE ticker — may need BSE fallback
    'LUMAXTECH': 'LUMAXTECH',
    'ATLANTAELE': 'ATLASCYCLE',   // Verify
    'GVT&D': 'GVTD',
    'SAVERA': 'SAVERAHOTL',
    'DYNACONS': 'DYNACONS',
    'BORANA': 'BORANAIND',
    'DATAPATTNS': 'DATAPATTNS',
    'MACPOWER': 'MACPOWER',
    'SMLMAH': 'SMLMAH',
    'IZMO': 'IZMO',
    'POWERMECH': 'POWERMECH',
    'UTLSOLAR': 'UTLSOLAR',
  };

  const symbols = symbolsParam
    .split(',')
    .map(s => {
      const upper = s.trim().toUpperCase();
      return SYMBOL_ALIASES[upper] || upper;
    })
    .filter(s => s.length > 0 && /^[A-Z0-9&-]+$/.test(s))
    .slice(0, 20); // Cap at 20

  if (symbols.length === 0) {
    // PATCH 0873 — Do NOT cache the 400-error response. Previously a bad
    // symbols input poisoned the cache for 30s, returning empty for any
    // subsequent caller with the same (bad) param. Caching is for happy-
    // path responses only.
    const responseData = { stocks: [], error: 'No valid symbols provided' };
    return NextResponse.json(responseData, { status: 400 });
  }

  // zzz1053 — every symbol at once (was batches of 5 one after another), each symbol kept 60 s and shared by concurrent requests,
  // and NSE given at most NSE_DEADLINE_MS: NSE from the server often hangs to its 10 s timeout (plus a cookie retry), which made
  // this route take 10-20 s. Yahoo is asked for the same symbols in parallel (ONE batched call) and fills whatever NSE has not
  // answered by then. A late NSE answer still lands in nseApiFetch's own 5-minute cache, so the next request gets NSE's figures.
  const t = serverTiming();
  const results: any[] = [];
  const errors: string[] = [];
  const missing: string[] = []; // PATCH 0780 — track for Yahoo fallback
  const now = Date.now();
  const need = symbols.filter((sym) => { const hit = _symMemo.get(sym); if (hit && now - hit.at < SYMBOL_TTL_MS) { results.push(hit.value); return false; } return true; });
  t.note('memo', `${symbols.length - need.length}/${symbols.length} kept`);
  let usedYahoo = false;
  if (need.length) {
    const yahooP = fetchQuotesWithFallback(need.map((s) => `${s}.NS`)).catch(() => [] as any[]);
    const nse = await t.time('nse', () => Promise.all(need.map((symbol) => withDeadline(singleFlight(_nseInflight, symbol, () => nseQuote(symbol)), NSE_DEADLINE_MS))));
    need.forEach((symbol, i) => {
      const r = nse[i];
      if (r !== TIMED_OUT && r.ok) { results.push(r.quote); _symMemo.set(symbol, r.quote); }
      else { errors.push(`${symbol}: ${r === TIMED_OUT ? `NSE did not answer within ${NSE_DEADLINE_MS / 1000} s` : r.error}`); missing.push(symbol); }
    });
    // PATCH 0780 — Yahoo fallback for symbols NSE couldn't resolve. NSE
    // gates many smallcap names on session cookies and rate-limits during
    // weekend hours; Yahoo provides reliable last-close data for almost
    // any NSE-listed ticker via the .NS suffix.
    if (missing.length > 0) {
      try {
        const yQuotes = await t.time('yahoo', () => yahooP);
        const want = new Set(missing);
        for (const q of yQuotes) {
          const baseSym = (q?.symbol || '').replace(/\.(NS|BO)$/i, '');
          if (!baseSym || !want.has(baseSym) || results.find(r => r.ticker === baseSym)) continue;
          const row = yahooRow(q, baseSym);
          if (!row) continue;
          results.push(row); _symMemo.set(baseSym, row); usedYahoo = true;
        }
      } catch { /* Yahoo failed too — return what we have */ }
    }
  }
  // the same order as asked
  const order = new Map(symbols.map((s, i) => [s, i]));
  results.sort((a, b) => (order.get(a.ticker) ?? 999) - (order.get(b.ticker) ?? 999));

  const responseData = {
    stocks: results,
    count: results.length,
    requested: symbols.length,
    errors: errors.length > 0 ? errors : undefined,
    source: missing.length > 0 || usedYahoo ? 'nse-individual+yahoo-fallback' : 'nse-individual',
    updatedAt: new Date().toISOString(),
  };

  // Cache the response before returning
  responseCache.set(cacheKey, { data: responseData, ts: Date.now() });
  // Evict old entries if cache grows too large
  if (responseCache.size > 200) {
    const oldest = [...responseCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    responseCache.delete(oldest[0]);
  }

  return withServerTiming(NextResponse.json(responseData), t);
}

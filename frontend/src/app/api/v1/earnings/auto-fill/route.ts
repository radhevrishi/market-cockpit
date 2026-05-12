// ═══════════════════════════════════════════════════════════════════════════
// EARNINGS AUTO-FILL (PATCH 0177)
//
// GET /api/v1/earnings/auto-fill?date=YYYY-MM-DD
//
// Problem: NSE's /api/corporates-financial-results API has a limited window
// and silently drops many real filings (MCX, BSE, Syrma SGS, Atlanta on user's
// dates). Manual coverage probe per ticker is unacceptable UX.
//
// Solution: scan a curated priority universe (Nifty100 + Multibagger watchlist)
// via the /enrich pipeline. Any ticker whose latest_quarter_end_iso falls within
// ±10 days of the target date is auto-discovered and returned graded.
//
// Cache: 24h per date in KV.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';
import { fetchNifty50, fetchNiftyNext50 } from '@/lib/nse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Priority watchlist — companies the user explicitly cares about that are
// known to be missing from NSE's limited feed. These get checked every time.
const PRIORITY_WATCHLIST = [
  // EarningsPulse BLOCKBUSTERs that have appeared missing from our portal
  'SYRMA', 'MCX', 'BSE', 'ATLANTAELE', 'VIJAYA',
  'GNGELEC', 'AEROFLEX', 'LLOYDSME', 'HEROMOTOCO', 'POONAWALLA', 'JKBANK',
  'ANTELOPUS', 'SELAN', 'BHEL', 'KEI', 'MANAPPURAM', 'SJS', 'SBIN',
  // Common large/mid caps that consistently file
  'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'WIPRO',
  'TATAMOTORS', 'SUNPHARMA', 'ADANIENT', 'AXISBANK', 'KOTAKBANK',
  'HAL', 'BEL', 'NTPC', 'ONGC', 'MARUTI', 'HCLTECH', 'ITC', 'LT', 'POWERGRID',
  'BAJFINANCE', 'BAJAJFINSV', 'BAJAJ-AUTO', 'TITAN', 'NESTLEIND',
  'ULTRACEMCO', 'GRASIM', 'JSWSTEEL', 'TATASTEEL', 'COALINDIA',
  // Industrial / capital-goods / capex names that often file in May
  'KALPATPOWR', 'CGPOWER', 'ABB', 'SIEMENS', 'HONAUT', 'POLYCAB',
  'HAVELLS', 'VOLTAS', 'CROMPTON', 'ASTRAZEN', 'DEEDEV',
  'WELSPUNIND', 'SONACOMS', 'WALCHANNAG',
  // Auto / mfg
  'TVSMOTOR', 'BAJAJHLDNG', 'M&M', 'EICHERMOT', 'ASHOKLEY',
  // Banks / NBFCs
  'INDUSINDBK', 'FEDERALBNK', 'IDBI', 'CHOLAFIN', 'MUTHOOTFIN',
  // FMCG / pharma
  'HINDUNILVR', 'BRITANNIA', 'DABUR', 'MARICO', 'DRREDDY',
  'CIPLA', 'DIVISLAB', 'LUPIN', 'TORNTPHARM',
];

interface AutoFillCard {
  ticker: string;
  enriched: boolean;
  sales_yoy_pct: number | null;
  pat_yoy_pct: number | null;
  eps_yoy_pct: number | null;
  period_ended: string | null;
  latest_quarter_end_iso: string | null;
  filed_iso: string | null;
  source: string;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const date = (searchParams.get('date') || '').trim();
  const force = searchParams.get('force') === '1';
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date param required (YYYY-MM-DD)' }, { status: 400 });
  }

  const cacheKey = `auto-fill:v1:${date}`;

  // KV cache hit
  if (isRedisAvailable() && !force) {
    try {
      const cached = await kvGet(cacheKey);
      if (cached) {
        return NextResponse.json({ ...cached, _cache: 'hit' });
      }
    } catch {}
  }

  const protocol = (req.headers.get('x-forwarded-proto') || 'https').split(',')[0];
  const host = req.headers.get('host') || '';
  const base = `${protocol}://${host}`;

  // ── Step 1: Get existing universe from /api/market/earnings ────────────
  const month = date.slice(0, 7);
  let existingTickers = new Set<string>();
  try {
    const r = await fetch(`${base}/api/market/earnings?market=india&month=${month}`, { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      for (const e of (j?.results || []) as any[]) {
        existingTickers.add((e.ticker || '').toUpperCase());
      }
    }
  } catch {}

  // ── Step 2: Build candidate universe (Nifty100 + priority watchlist) ───
  const candidateSet = new Set<string>(PRIORITY_WATCHLIST.map((s) => s.toUpperCase()));
  try {
    const [n50, nn50] = await Promise.all([
      fetchNifty50().catch(() => null),
      fetchNiftyNext50().catch(() => null),
    ]);
    for (const data of [n50, nn50]) {
      for (const item of (data?.data || []) as any[]) {
        if (item?.symbol) candidateSet.add(String(item.symbol).toUpperCase());
      }
    }
  } catch {}

  // Filter to tickers NOT already in the universe
  const toScan: string[] = [...candidateSet].filter((t) => !existingTickers.has(t));

  // ── Step 3: Bulk-enrich the candidates, chunked at 40 ──────────────────
  const chunks: string[][] = [];
  for (let i = 0; i < toScan.length; i += 40) chunks.push(toScan.slice(i, i + 40));

  const responses = await Promise.all(chunks.map((chunk) =>
    fetch(`${base}/api/v1/earnings/enrich?symbols=${chunk.join(',')}&filed=${date}`, { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : { data: {} })
      .catch(() => ({ data: {} }))
  ));
  const enrich: Record<string, any> = {};
  for (const r of responses) Object.assign(enrich, r.data || {});

  // ── Step 4: Filter to tickers whose latest filing matches target date ──
  // Q4 results (quarter ending Mar 31) are filed across April-May. Accept any
  // ticker whose latest_quarter_end_iso = Mar 31 of the filing year AND whose
  // period_ended decoded date is within ±10 days of the target date.
  const targetDate = new Date(date);
  const out: AutoFillCard[] = [];
  for (const ticker of toScan) {
    const e = enrich[ticker];
    if (!e) continue;
    const hasFinancials = e.sales_yoy_pct != null || e.pat_yoy_pct != null || e.eps_yoy_pct != null;
    if (!hasFinancials) continue;
    // Optional period match — Q4 (Mar 31) is typical for May filings
    const latestIso: string | null = e.latest_quarter_end_iso || null;
    let withinWindow = true;
    if (latestIso) {
      // Latest quarter must be reasonably recent (within 90 days of target)
      try {
        const latestD = new Date(latestIso);
        const diffDays = Math.abs((targetDate.getTime() - latestD.getTime()) / (24 * 3600_000));
        if (diffDays > 90) withinWindow = false;
      } catch {}
    }
    if (!withinWindow) continue;
    out.push({
      ticker,
      enriched: true,
      sales_yoy_pct: e.sales_yoy_pct ?? null,
      pat_yoy_pct: e.pat_yoy_pct ?? null,
      eps_yoy_pct: e.eps_yoy_pct ?? null,
      period_ended: e.period_ended ?? null,
      latest_quarter_end_iso: latestIso,
      filed_iso: date,
      source: 'auto-fill',
    });
  }

  const payload = {
    date,
    scanned: toScan.length,
    discovered: out.length,
    existing_universe_size: existingTickers.size,
    tickers: out,
    generated_at: new Date().toISOString(),
  };

  // Cache 24h
  if (isRedisAvailable()) {
    try { await kvSet(cacheKey, payload, 24 * 3600); } catch {}
  }

  return NextResponse.json(payload);
}

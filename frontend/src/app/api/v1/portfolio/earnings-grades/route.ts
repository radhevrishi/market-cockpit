// zzz288 — Portfolio earnings grades endpoint.
//
// Root problem we're solving: the graded KV pipeline (`graded:v10:${date}`)
// only knows about tickers that got scored on days the scanner ran. Many
// portfolio tickers (SYRMA, PSPPROJECT Q1 FY27, ASIANENE, MENONBE, etc.)
// file earnings that never make it into that index, so the tab would show
// "NO FILING" or stale prior-quarter data.
//
// Fix: primary source is `/api/market/earnings-scan?symbols=...` which is
// always fresh from Screener (returns the latest quarter for every ticker).
// The graded index is used only as *enrichment* — if the ticker+quarter is
// present there, we prefer its curated tier/score.
//
// Contract: GET /api/v1/portfolio/earnings-grades?tickers=A,B,C
// Returns  { count, graded, results: { A: {ticker,company,filing_date,tier,quarter,composite_score,...} | null, ... } }

import { NextRequest } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INDEX_KEY = 'search:idx:v2';
const INDEX_TTL_SECONDS = 15 * 60;
const CACHE_PREFIX = 'graded:v10:';
const LOOKBACK_BUSINESS_DAYS = 120;

type Tier = 'BLOCKBUSTER' | 'STRONG' | 'MIXED' | 'AVOID';
const TIERS: Tier[] = ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID'];

type IndexEntry = {
  t: string; c: string; fd: string; tier: Tier;
  sec: string | null; mc: number | null; q: string | null; cs: number | null; db: number;
  p?: number | null; // zzz299 — pead_score
};

function businessDaysBack(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; out.length < n && i < n * 2; i++) {
    const d = new Date(now.getTime() - i * 24 * 3600_000);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function buildIndex(): Promise<IndexEntry[]> {
  const dates = businessDaysBack(LOOKBACK_BUSINESS_DAYS);
  const flat: IndexEntry[] = [];
  const seen = new Set<string>();
  const CONC = 16;
  for (let i = 0; i < dates.length; i += CONC) {
    const batch = dates.slice(i, i + CONC);
    await Promise.all(batch.map(async (d, batchIdx) => {
      const daysBack = i + batchIdx;
      const key = CACHE_PREFIX + d;
      let payload: any = null;
      try { payload = await kvGet(key); } catch { return; }
      if (!payload || !payload.by_tier) return;
      for (const tier of TIERS) {
        const arr = payload.by_tier[tier];
        if (!Array.isArray(arr)) continue;
        for (const e of arr) {
          if (!e || !e.ticker) continue;
          const ticker = String(e.ticker).toUpperCase();
          const quarter = e.quarter || '';
          const dedupKey = quarter ? `${ticker}@${quarter}` : ticker;
          if (seen.has(dedupKey)) continue;
          seen.add(dedupKey);
          flat.push({
            t: ticker,
            c: String(e.company || ticker),
            fd: String(e.filing_date || d),
            tier,
            sec: e.sector || null,
            mc: typeof e.market_cap_cr === 'number' ? e.market_cap_cr : null,
            q: e.quarter || null,
            cs: typeof e.composite_score === 'number' ? e.composite_score : null,
            p: typeof e.pead_score === 'number' ? e.pead_score : null, // zzz299
            db: daysBack,
          });
        }
      }
    }));
  }
  return flat;
}

async function getIndex(): Promise<IndexEntry[]> {
  try {
    const cached = await kvGet(INDEX_KEY);
    if (Array.isArray(cached) && cached.length > 0) return cached as IndexEntry[];
  } catch {}
  const idx = await buildIndex();
  try { await kvSet(INDEX_KEY, idx, INDEX_TTL_SECONDS); } catch {}
  return idx;
}

// Map earnings-scan "period" ("Jun 2026", "Mar 2026", "Sep 2025", "Dec 2025")
// to the Indian fiscal-year quarter label used elsewhere ("Q1 FY27", "Q4 FY26", etc.).
function periodToQuarter(period: string | undefined): string | null {
  if (!period) return null;
  const m = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})$/.exec(period);
  if (!m) return null;
  const mon = m[1]; const yr = parseInt(m[2]);
  const monToQ: Record<string, { q: string; fyOffset: number }> = {
    Mar: { q: 'Q4', fyOffset: 0 },     // Mar 2026 -> Q4 FY26 (FY ending Mar 2026)
    Jun: { q: 'Q1', fyOffset: 1 },     // Jun 2026 -> Q1 FY27
    Sep: { q: 'Q2', fyOffset: 1 },
    Dec: { q: 'Q3', fyOffset: 1 },
  };
  const map = monToQ[mon];
  if (!map) return null;
  const fy = String(yr + map.fyOffset).slice(-2);
  return `${map.q} FY${fy}`;
}

// Derive tier from earnings-scan grade string + score.
function scanToTier(grade: string | undefined, score: number | undefined): Tier {
  const g = String(grade || '').toUpperCase();
  const s = typeof score === 'number' ? score : 0;
  if (g === 'EXCELLENT' || s >= 80) return 'BLOCKBUSTER';
  if (g === 'GOOD' || s >= 65) return 'STRONG';
  if (g === 'POOR' || g === 'BAD' || s < 45) return 'AVOID';
  return 'MIXED';
}

async function fetchScanBatch(base: string, tickers: string[]): Promise<Record<string, any>> {
  const out: Record<string, any> = {};
  // The upstream scan endpoint handles ~50 symbols per call comfortably.
  const CHUNK = 50;
  for (let i = 0; i < tickers.length; i += CHUNK) {
    const slice = tickers.slice(i, i + CHUNK);
    const url = `${base}/api/market/earnings-scan?symbols=${encodeURIComponent(slice.join(','))}`;
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) continue;
      const j: any = await r.json();
      const cards: any[] = Array.isArray(j?.cards) ? j.cards : [];
      for (const c of cards) {
        const sym = String(c?.symbol || '').toUpperCase();
        if (!sym) continue;
        out[sym] = c;
      }
    } catch {}
  }
  return out;
}

export async function GET(req: NextRequest) {
  const tickersParam = (req.nextUrl.searchParams.get('tickers') || '').trim();
  if (!tickersParam) {
    return Response.json({ count: 0, graded: 0, results: {} });
  }
  const tickers = tickersParam.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);

  // 1) Freshest source: earnings-scan (always up-to-date per Screener)
  const base = req.nextUrl.origin;
  const scan = await fetchScanBatch(base, tickers);

  // 2) Enrichment: graded index for professional tier/score when quarter matches
  const index = await getIndex();
  const gradedByKey = new Map<string, IndexEntry>();
  for (const e of index) {
    if (!e || !e.t) continue;
    const k = `${e.t}@${e.q || ''}`;
    const existing = gradedByKey.get(k);
    if (!existing || (e.fd || '') > (existing.fd || '')) gradedByKey.set(k, e);
  }

  const results: Record<string, any> = {};
  for (const t of tickers) {
    const c = scan[t];
    if (!c) { results[t] = null; continue; }

    const scanQuarter = periodToQuarter(c.period || c.resultDate);
    const scanScore = typeof c.totalScore === 'number' ? c.totalScore : null;
    const graded = scanQuarter ? gradedByKey.get(`${t}@${scanQuarter}`) : undefined;

    const tier: Tier = graded?.tier ?? scanToTier(c.grade, scanScore ?? undefined);
    const composite_score: number | null = graded?.cs ?? scanScore;
    const pead_score: number | null = (graded as any)?.p ?? null; // zzz299

    results[t] = {
      ticker: t,
      company: String(c.company || t),
      // filing_date: use graded's date if we have it, else derive rough date from
      // period ("Jun 2026" -> 2026-06-30). Rough dates are fine because the client
      // only uses this for a scan-fallback jump.
      filing_date: graded?.fd || quarterEndFromPeriod(c.period || c.resultDate) || '',
      tier,
      sector: graded?.sec || null,
      market_cap_cr: graded?.mc ?? null,
      quarter: scanQuarter || graded?.q || null,
      composite_score,
      pead_score, // zzz299 — real PEAD from graded pipeline
      // extras — YoY momentum + freshness source
      revenue_yoy: typeof c.revenueYoY === 'number' ? c.revenueYoY : null,
      pat_yoy: typeof c.patYoY === 'number' ? c.patYoY : null,
      eps_yoy: typeof c.epsYoY === 'number' ? c.epsYoY : null,
      source: graded ? 'graded' : 'scan',
    };
  }

  const graded = Object.values(results).filter((r: any) => r && r.source === 'graded').length;
  const covered = Object.values(results).filter(Boolean).length;
  return Response.json({
    count: tickers.length,
    graded,   // how many had a professional graded entry for the latest quarter
    covered,  // total tickers with any earnings data
    results,
    _idx: index.length,
  });
}

// "Jun 2026" -> "2026-06-30" (last day of month is fine for sort/display).
function quarterEndFromPeriod(period: string | undefined): string | null {
  if (!period) return null;
  const m = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})$/.exec(period);
  if (!m) return null;
  const mIdx = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(m[1]);
  if (mIdx < 0) return null;
  const yr = parseInt(m[2]);
  // End of month
  const lastDay = new Date(yr, mIdx + 1, 0).getDate();
  const mm = String(mIdx + 1).padStart(2, '0');
  const dd = String(lastDay).padStart(2, '0');
  return `${yr}-${mm}-${dd}`;
}

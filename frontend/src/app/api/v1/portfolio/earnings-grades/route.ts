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
import { lookupGraded, quarterRank, type GradedEntry } from '@/lib/graded-session-index';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// zzz1262 — the graded sessions are read through lib/graded-session-index (one reader for this route, the earnings
// search and the BSE-code map): compact per-session rows kept in memory, batched reads retried once, a session that
// could not be read reported in `unread_sessions` and never remembered as empty. The old 15-minute whole-index copy
// (`search:idx:v3`) is gone — a build that missed recent sessions used to be served for 15 minutes (KROSS, zzz1254).
type Tier = 'BLOCKBUSTER' | 'STRONG' | 'MIXED' | 'AVOID';
type IndexEntry = GradedEntry;

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

/**
 * The earnings scan for these tickers. zzz1262 — was 50 symbols a call, one call after another, with no time limit (a
 * 50-name call takes ~40 s, so one slow call held the whole answer and one failed call lost 50 names). Now 12 a call,
 * three calls at a time, 50 s each, one retry — the same shape the Portfolio Earnings tab uses in the browser.
 */
async function fetchScanBatch(base: string, tickers: string[]): Promise<Record<string, any>> {
  const out: Record<string, any> = {};
  const CHUNK = 12, LANES = 3;
  const chunks: string[][] = [];
  for (let i = 0; i < tickers.length; i += CHUNK) chunks.push(tickers.slice(i, i + CHUNK));
  const one = async (slice: string[]): Promise<void> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(`${base}/api/market/earnings-scan?symbols=${encodeURIComponent(slice.join(','))}`, { cache: 'no-store', signal: AbortSignal.timeout(50_000) });
        if (!r.ok) continue;
        const j: any = await r.json();
        for (const c of (Array.isArray(j?.cards) ? j.cards : [])) { const sym = String(c?.symbol || '').toUpperCase(); if (sym) out[sym] = c; }
        return;
      } catch { /* try once more */ }
    }
  };
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(LANES, chunks.length) }, async () => { while (next < chunks.length) await one(chunks[next++]); }));
  return out;
}

export async function GET(req: NextRequest) {
  const tickersParam = (req.nextUrl.searchParams.get('tickers') || '').trim();
  if (!tickersParam) {
    return Response.json({ count: 0, graded: 0, results: {} });
  }
  const tickers = tickersParam.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);

  // 1) Freshest source: earnings-scan (always up-to-date per Screener)   2) the graded sessions — both at once.
  // zzz1262 — `scan=0`: the caller runs the scan itself (the Portfolio Earnings tab does, in batches), so it is not run
  // a second time here; the answer is then the graded grades only and arrives in about a second.
  const base = req.nextUrl.origin;
  const wantScan = req.nextUrl.searchParams.get('scan') !== '0';
  const [scan, { entries: index, unread }] = await Promise.all([
    wantScan ? fetchScanBatch(base, tickers) : Promise.resolve({} as Record<string, any>),
    lookupGraded(tickers),
  ]);
  // newest session first: the first entry per ticker@quarter is the latest grade (a later re-listing of the same quarter wins)
  const gradedByKey = new Map<string, IndexEntry>();
  for (const e of index) {
    if (!e || !e.t) continue;
    const k = `${e.t}@${e.q || ''}`;
    if (!gradedByKey.has(k)) gradedByKey.set(k, e);
  }

  // zzz301 — latest graded entry per ticker (regardless of quarter). Used as a
  // fallback so we can still return pead_score/tier when the scan endpoint
  // returns nothing (which currently happens for many tickers on Railway).
  // zzz1254 — "latest" = the newest QUARTER graded, then the newest session (filing dates repeat across re-listings)
  const qRank = quarterRank;
  const latestGradedByTicker = new Map<string, IndexEntry>();
  for (const e of index) {
    if (!e || !e.t) continue;
    const cur = latestGradedByTicker.get(e.t);
    if (!cur || qRank(e.q) > qRank(cur.q) || (qRank(e.q) === qRank(cur.q) && e.db < cur.db)) latestGradedByTicker.set(e.t, e);
  }

  const results: Record<string, any> = {};
  for (const t of tickers) {
    const c = scan[t];
    const scanQuarter = c ? periodToQuarter(c.period || c.resultDate) : null;
    const scanScore = c && typeof c.totalScore === 'number' ? c.totalScore : null;
    const gradedAny = latestGradedByTicker.get(t);
    // zzz1254 — a graded NEWER quarter than the scan's (screener.in not yet updated) wins over the scan's older quarter
    const gradedQ = (scanQuarter ? gradedByKey.get(`${t}@${scanQuarter}`) : undefined)
      ?? (gradedAny && scanQuarter && qRank(gradedAny.q) > qRank(scanQuarter) ? gradedAny : undefined);
    const graded = gradedQ || gradedAny;

    // zzz301 — only skip if BOTH scan and graded miss. Previously we short-circuited
    // on !scan[t], which caused pead_score to be null for all tickers whenever the
    // scan endpoint returned empty cards (a common upstream failure mode).
    if (!c && !graded) { results[t] = null; continue; }

    const tier: Tier = graded?.tier ?? scanToTier(c?.grade, scanScore ?? undefined);
    const composite_score: number | null = graded?.cs ?? scanScore;
    const pead_score: number | null = (graded as any)?.p ?? null; // zzz299

    results[t] = {
      ticker: t,
      company: String(c?.company || graded?.c || t),
      filing_date: graded?.fd || quarterEndFromPeriod(c?.period || c?.resultDate) || '',
      tier,
      sector: graded?.sec || null,
      market_cap_cr: graded?.mc ?? null,
      // zzz1252 — a fallback graded entry keeps ITS quarter (its tier / date / score belong to it), never the scan's newer one
      quarter: gradedQ ? (gradedQ.q || scanQuarter || null) : graded ? (graded.q || null) : scanQuarter,
      composite_score,
      pead_score, // zzz299 — real PEAD from graded pipeline
      revenue_yoy: c && typeof c.revenueYoY === 'number' ? c.revenueYoY : null,
      pat_yoy: c && typeof c.patYoY === 'number' ? c.patYoY : null,
      eps_yoy: c && typeof c.epsYoY === 'number' ? c.epsYoY : null,
      source: gradedQ ? 'graded' : (gradedAny ? 'graded-fallback' : 'scan'),
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
    unread_sessions: unread,   // zzz1254 — sessions that could not be read (their grades may be missing)
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

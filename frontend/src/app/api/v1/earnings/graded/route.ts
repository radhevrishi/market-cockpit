// ═══════════════════════════════════════════════════════════════════════════
// SERVER-SIDE GRADED ENDPOINT (PATCH 0159)
//
// GET /api/v1/earnings/graded?date=YYYY-MM-DD
//
// Replaces the client-side join (hub + enrichment) with a single server call
// that returns the FULLY GRADED payload — cards already include Sales/PAT/EPS
// YoY + abs Cr pairs + price + Stage + RS + methodology pills + caveat pills
// + score + tier + narrative.
//
// CACHING strategy (key insight: past filings are immutable):
//   • Past dates (< today_IST): cache 90 days. Once a Q4 is filed, the
//     numbers don't change — re-fetching is pure waste. KV key
//     'graded:v10:<YYYY-MM-DD>' is hit on every subsequent visit (<100ms). (zzz190: v9->v10 to purge stale historic dates that got dropped by the old 7-day rule)
//   • Today's date: cache 15 min. New filings come throughout the day,
//     so we accept brief staleness for freshness.
//   • Future dates: not cached (Upcoming only).
//
// Server fetches in parallel:
//   1. /api/market/earnings?month=YYYY-MM (hub — authoritative filed list)
//   2. /api/v1/earnings/enrich?symbols=A,B,C (NSE+Screener+Yahoo)
//   3. Applies gradeRow logic, sorts into tiers, returns OpportunitiesPayload
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { gradedKey } from '@/lib/graded-cache-key';
// zzz669 — the grader and its two date helpers now live in ONE place, shared
// with the Earnings Opportunities page. See lib/india-grade.ts for why.
import { gradeIndiaRow as gradeRow, deriveQuarterLabel } from '@/lib/india-grade';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';
import { CAVEAT_PENALTY, CAVEAT_PENALTY_DEFAULT, marginQualityDelta, decideTier, marketReactionDelta, typicalDailyMovePct, thinFloatGate, quadrantForIndiaRow } from '@/lib/earnings-grade-shared';

// zzz379 — derive the correct RESULT quarter from a filing date instead of the
// hard-coded 'Q4' that mislabelled every non-Jan–Mar filing (an August/Q1-FY27
// print was rendering "reported Q4 results"). Mapping matches getExpectedQuarter
// in api/market/earnings: Jan–Mar filing → Q3, Apr–Jun → Q4, Jul–Sep → Q1, Oct–Dec → Q2.


// PATCH 0983 — Railway self-fetch loopback fallback (module-level).
// graded/route.ts makes TWO self-fetches to /api/v1/earnings/enrich
// using its own public URL. On Railway these fail like the hub fetch
// because the edge layer rejects self-loops. Retry via 127.0.0.1:$PORT.
async function _doEnrichSelfFetch(url: string, init?: RequestInit): Promise<Response> {
  const port = process.env.PORT;
  const loop = (port && /^https?:\/\/[^/]+\//.test(url))
    ? url.replace(/^https?:\/\/[^/]+/, `http://127.0.0.1:${port}`)
    : null;
  // zzz411 — ROOT CAUSE of the persistent "screener gap" / "0/N updated" bug.
  // On Railway the container frequently cannot reach its OWN public URL: the
  // edge rejects the self-loop with a NON-OK status (404/421/5xx) — or worse,
  // a 200 with an error body — instead of throwing a network error. The old
  // catch-only fallback never triggered for those cases, so the caller's
  // `r.ok ? r.json() : {data:{}}` silently returned an EMPTY enrich body and
  // every card stayed a preview ("0/42 updated" on Refresh) even though /enrich
  // returns full data in ~6s when reached directly. On Railway the reliable
  // path is the in-container loopback, so try it FIRST there and only fall back
  // to the public URL. On Vercel (no RAILWAY_* env) keep public-first.
  // "Self-hosted node server with a loopback port, and NOT Vercel serverless"
  // — i.e. Railway (or any long-running container). Vercel sets VERCEL=1 and its
  // functions can't loopback to 127.0.0.1, so there we keep public-first.
  const onRailway = !!loop && !process.env.VERCEL;
  if (loop && onRailway) {
    try {
      const rl = await fetch(loop, init);
      if (rl.ok) return rl;
      console.log(`[graded/enrich] loopback returned ${rl.status}, falling back to public URL`);
    } catch (e: any) {
      console.log(`[graded/enrich] loopback failed (${e?.message}), falling back to public URL`);
    }
  }
  try {
    const r = await fetch(url, init);
    if (!r.ok && loop && !onRailway) {
      // Vercel-side safety: non-OK public self-loop → try loopback once.
      try { const rl = await fetch(loop, init); if (rl.ok) return rl; } catch {}
    }
    return r;
  } catch (err: any) {
    if (loop) {
      console.log(`[graded/enrich] public-URL fetch failed (${err?.message}), retrying via loopback`);
      return await fetch(loop, init);
    }
    throw err;
  }
}

export const runtime = 'nodejs';
export const maxDuration = 300;  // PATCH 0993 — was 30s; dense dates need ~60s enrichment // PATCH 0818
// PATCH 0819: removed force-dynamic so Cache-Control headers aren't overridden by Next.js. Query params still force dynamic at runtime.

// ─── Types (mirror frontend) ───────────────────────────────────────────────
type EarningsTier = 'BLOCKBUSTER' | 'STRONG' | 'MIXED' | 'AVOID';
const TIER_ORDER: EarningsTier[] = ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID'];

interface ParsedEarning {
  ticker: string;
  company: string;
  sector?: string;
  filing_date: string;
  quarter: string;
  market_cap_bucket?: string;
  market_cap_cr?: number | null;
  pe?: number | null;
  price?: number | null;
  sales_yoy_pct: number | null;
  net_profit_yoy_pct: number | null;
  eps_yoy_pct: number | null;
  sales_curr_cr: number | null;
  sales_prev_cr: number | null;
  pat_curr_cr: number | null;
  pat_prev_cr: number | null;
  eps_curr: number | null;
  eps_prev: number | null;
  gap_pct: number | null;
  d1_pct: number | null;
  move_pct: number | null;
  rs_rating: number | null;
  stage: 1 | 2 | 3 | 4 | null;
  pct_from_52w_high: number | null;
  composite_score: number;
  tier: EarningsTier;
  methodology_tags: string[];
  caveat_tags: string[];
  narrative: string;
  filing_url?: string;
  source: string;
  // Pre-existing gap: the no-financials preview branch already returns these
  // (PATCH 1015 / zzz505 / zzz507) but the interface never declared them.
  opm_pct?: number | null;
  opm_prev_pct?: number | null;
  quarters_sales?: number[] | null;
  quarters_eps?: number[] | null;
  quarters_pat?: number[] | null;
}

// zzz414 — "Jun 2026" → "2026-06-30" (last day of the labelled month).
// Screener's quarterly-table column label, converted to the quarter-end ISO
// used by the corroboration guards. Null-safe: returns null on any mismatch.
function _isoFromQuarterLabel(label: any): string | null {
  const m = String(label || '').match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})/i);
  if (!m) return null;
  const mi: Record<string, number> = { JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11 };
  const d = new Date(Date.UTC(parseInt(m[2],10), (mi[m[1].toUpperCase().slice(0,3)] ?? 0) + 1, 0));
  return d.toISOString().slice(0, 10);
}

// ─── gradeRow (server-side, mirrors page.tsx PATCH 0158) ───────────────────


// ─── Main handler ──────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date') || '';
  // PATCH 0160 — refreshMissing=1 means: load existing payload, find cards
  // with no financials (sales_curr_cr null AND pat_curr_cr null), re-enrich
  // ONLY those tickers with cache bypass, merge back. Leaves populated cards
  // 100% untouched.
  const refreshMissing = searchParams.get('refreshMissing') === '1';
  // PATCH 0175 — force=1 BUSTS the KV cache and rebuilds from scratch (with
  // a fresh hub fetch). Used by the top "Refresh" button so the user can
  // pull in newly-discovered tickers that the previous cached pass missed.
  const force = searchParams.get('force') === '1';
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date param required (YYYY-MM-DD)' }, { status: 400 });
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const isPast = date < todayIso;
  const cacheKey = gradedKey(date);  // zzz665 — ONE definition, shared with refresh-bench (lib/graded-cache-key.ts)  // zzz622 — CACHE-ONLY READ. Callers that are assembling a multi-day
  // window (the AI Research Desk) must never be able to trigger a full
  // enrichment sweep on a reader's clock: thirty sessions × one sweep is a
  // ten-minute page load and a rate-limit apology. cache_only answers from
  // what is already built, and says plainly when a session is not built yet,
  // so the caller can show the gap instead of hanging on it. Inserted before
  // any of the auto-heal machinery below so it cannot start work either.
  if ((searchParams.get('cache_only') === '1') && !force && !refreshMissing) {
    if (!isRedisAvailable()) return NextResponse.json({ pending: true, reason: 'no cache backend' }, { status: 200 });
    try {
      const cached = await kvGet<any>(cacheKey);
      if (cached?.by_tier) return NextResponse.json(cached, { status: 200 });
    } catch { /* fall through to pending */ }
    return NextResponse.json({ pending: true, date }, { status: 200 });
  }
// zzz503: v10->v11 to regenerate cards with honest "newly listed"/"no YoY yet" labels + richer newly-listed narrative (was "prior-year missing")

  // Try cache first (past dates are immutable, 90-day TTL — practically forever for our use)
  // ── BUT bypass cache when refreshMissing or force is set ────────────────
  //
  // PATCH 0360 — Auto-heal preview-heavy past-date caches.
  //
  // Symptom we're fixing: user visits /earnings-opportunities for an old date.
  // The cached payload was written weeks ago when the day's filings hadn't
  // propagated to Screener yet. Most cards in cache are preview-shape (no
  // YoY data, narrative='Financial detail awaiting enrichment'). Cache-hit
  // serves them as-is, so user sees stale previews and must click Refresh.
  //
  // Fix: on cache hit for a past date, count how many cards lack YoY data.
  // If more than 30% are previews AND the date is past, internally promote
  // this request to a refreshMissing pass — which targets just those preview
  // tickers and returns enriched results. Subsequent visits hit the now-
  // fully-enriched cache.
  //
  // No automatic re-enrich for today's date — those are expected to be
  // preview-heavy until filings propagate (we still respect manual Refresh).
  let autoPromoteToRefreshMissing = false;
  if (isRedisAvailable() && !refreshMissing && !force) {
    try {
      const cached = await kvGet(cacheKey);
      if (cached) {
        const allCards: any[] = (TIER_ORDER as EarningsTier[])
          .flatMap((t) => (cached as any)?.by_tier?.[t] || []);
        const totalCards = allCards.length;
        const previewCards = allCards.filter((c) =>
          c.sales_yoy_pct == null && c.net_profit_yoy_pct == null && c.eps_yoy_pct == null
        ).length;
        const previewRatio = totalCards > 0 ? previewCards / totalCards : 0;
        // PATCH 0454 P1-26 — Audit found auto-heal could fire 12×/hour on
        // hot dates (47-ticker fan-out per fire = enormous load). Added a
        // KV-backed lockout so a date that just auto-healed can't trigger
        // again for 30 minutes regardless of how many users hit the route.
        const HEAL_LOCKOUT_S = 30 * 60;
        const lockoutKey = `graded:autoheal-lock:${cacheKey}`;
        let recentlyHealed = false;
        try {
          const lock = await kvGet<number>(lockoutKey);
          if (lock && Date.now() - lock < HEAL_LOCKOUT_S * 1000) recentlyHealed = true;
        } catch {}
        // Auto-heal threshold: past date, ≥3 cards in payload, ≥40% previews
        // (was 30% — too sensitive; raised so we don't re-heal cards that
        // are genuinely preview-only because sources never published).
        //
        // PATCH 0497 — Bypass empty-cache for recent past dates so the new
        // live-NSE augmentation actually runs. Indian companies file Fri/
        // Sat/Sun/Mon every week; an empty cache from an earlier crawl
        // shouldn't lock that out for 90 days.
        const dateAgeDaysForCache = Math.max(0, Math.floor(
          (new Date(todayIso).getTime() - new Date(date).getTime()) / 86_400_000
        ));
        const isRecentPast = isPast && dateAgeDaysForCache <= 14;
        const isEmptyCache = totalCards === 0;
        const bypassEmptyCache = isPast && isEmptyCache && !recentlyHealed;  // zzz419 — heal empty caches on ANY past date (calendar-fallback recovers hub-missing dates like Jul 24), not just <=14d
        // zzz417 — UNDERCOUNT heal. A cache written before the day's filings
        // propagated holds far fewer graded cards than the day actually filed.
        // raw_items_total records how many filings existed at write time; when
        // candidates are a small fraction of that, the cache is stale-undercounted.
        // refreshMissing can't fix this (it only re-enriches EXISTING cards, never
        // ADDS missing tickers) — only a full rebuild does. This is the 1-of-89 bug.
        const cachedRaw = Number((cached as any)?.raw_items_total) || 0;
        const isUndercounted = isPast && cachedRaw >= 8 && totalCards < 0.6 * cachedRaw;
        if (isPast && totalCards >= 3 && previewRatio >= 0.40 && !recentlyHealed && !isUndercounted) {
          autoPromoteToRefreshMissing = true;
          // Set the lockout immediately so other concurrent requests skip.
          try { await kvSet(lockoutKey, Date.now(), HEAL_LOCKOUT_S); } catch {}
        } else if (bypassEmptyCache || (isUndercounted && !recentlyHealed)) {
          // Empty payload for a recent date — try a full rebuild so the
          // new live-NSE augmentation can fire. Set lockout to throttle.
          try { await kvSet(lockoutKey, Date.now(), HEAL_LOCKOUT_S); } catch {}
          // Fall through to rebuild path (don't return cached empty).
        } else {
          const swr = isPast ? 's-maxage=3600, stale-while-revalidate=86400' : 's-maxage=60, stale-while-revalidate=300';
          return NextResponse.json({ ...cached, _cache: 'hit' }, { headers: { 'Cache-Control': swr } });
        }
      }
    } catch {}
  }
  // Promote in-request when auto-heal fires. From this point on, treat
  // the request as refreshMissing=1 (but keep force=false so we don't
  // delete the cache before reading it).
  const effectiveRefreshMissing = refreshMissing || autoPromoteToRefreshMissing;
  // PATCH 0175 / 0358 — on force=1, delete the existing KV entry so the
  // post-rebuild kvSet writes a clean payload (avoids stale shape merge).
  // CRITICAL: only delete when force=1 WITHOUT refreshMissing=1. The
  // refreshMissing path needs the existing payload to identify which
  // tickers need re-enrichment; deleting it first makes that block fall
  // through to full rebuild, which returns no `_refresh` field and
  // produces a meaningless "0/0 updated" message on the client.
  // zzz417 — no longer pre-delete on force by default. The full-rebuild path
  // overwrites KV on success and PATCH 1002 preserves the prior payload when a
  // rebuild yields zero. Pre-deleting first meant a timed-out rebuild left the
  // date EMPTY (worse than a stale count). Only wipe when explicitly asked.
  if (force && !refreshMissing && searchParams.get('wipe') === '1' && isRedisAvailable()) {
    try { await kvSet(cacheKey, null, 1); } catch {}  // null + 1s TTL = effective delete
  }

  // ── PARTIAL REFRESH PATH ──────────────────────────────────────────────
  // Read cached payload, identify cards needing enrichment, refetch only those.
  // PATCH 0360 — also fires when auto-heal promoted the request.
  if (effectiveRefreshMissing && isRedisAvailable()) {
    try {
      const existing: any = await kvGet(cacheKey);
      if (existing?.by_tier) {
        const allCards: any[] = (TIER_ORDER as EarningsTier[]).flatMap((t) => existing.by_tier[t] || []);
        // PATCH 0360 — broadened "missing" criterion. A card with raw
        // sales_curr_cr but no YoY data renders identical to a preview
        // (all dashes), so it should be re-enriched too.
        // PATCH 1011 — also re-enrich when opm/d1/gap are missing.
        // Old cached payloads from before Patches 1003/1005 have sales/pat/eps
        // populated but lack opm_pct + d1_pct + gap_pct. Those cards show
        // 'screener gap' and prevent ELITE qualification. Detect and refresh.
        const needTickers = allCards
          .filter((c) => {
            const noFinancials = c.sales_yoy_pct == null
                               && c.net_profit_yoy_pct == null
                               && c.eps_yoy_pct == null;
            // zzz235 — treat opm==0 with sales_curr_cr>=100 as "needs refresh".
            // The Cloudflare Worker used to emit opm_pct=0 for NBFCs/banks
            // (Financing Margin % not matched). zzz234 in enrich now fixes
            // this at the source, but existing cached cards still carry the
            // stale 0. Without this, refresh_missing=1 sees "0 != null" and
            // skips them → LTF/INDIANB/MAHABANK never re-enrich, keep 0.0%.
            const opmCur = (c as any).opm_pct;
            const opmPrev = (c as any).opm_prev_pct;
            const salesCur = (c as any).sales_curr_cr;
            const opmIsStaleZero = (opmCur === 0 || opmPrev === 0) &&
              salesCur != null && Number.isFinite(Number(salesCur)) && Number(salesCur) >= 100;
            const noMargin = (opmCur == null && opmPrev == null) || opmIsStaleZero;
            const noPriceAction = c.d1_pct == null && c.gap_pct == null;
            // Refresh if NO financials OR margin is missing/stale-zero.
            // Note: dropped the `noPriceAction` co-requirement for the margin
            // refresh path — stale-zero OPM is enough evidence a refresh is
            // needed even when D1/Gap is intact.
            return noFinancials || noMargin;
          })
          .map((c) => c.ticker);
        if (needTickers.length === 0) {
          return NextResponse.json({ ...existing, _cache: 'hit', _refresh: 'no-op (all populated)' }, { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=900' } });  // PATCH 0818
        }
        const base = new URL(req.url);
        // zzz420 — small SERIAL batches with a pause. Screener rate-limits big
        // bursts (40-at-once filled only 1-3 per pass); batches of 8 with a short
        // delay reliably fill the tail. Symbols are URL-encoded so tickers that
        // contain '&' (S&SPOWER, GMRP&UI, GVT&D) no longer break the query string.
        const RM_CHUNK = 8;
        const chunks: string[][] = [];
        for (let i = 0; i < needTickers.length; i += RM_CHUNK) chunks.push(needTickers.slice(i, i + RM_CHUNK));
        const responses: any[] = [];
        for (const ch of chunks) {
          const r = await _doEnrichSelfFetch(`${base.protocol}//${base.host}/api/v1/earnings/enrich?symbols=${ch.map(encodeURIComponent).join(',')}&filed=${date}&nocache=1`, { cache: 'no-store' })
            .then((rr: Response) => rr.ok ? rr.json() : { data: {} })
            .catch(() => ({ data: {} }));
          responses.push(r);
          await new Promise((res) => setTimeout(res, 1000));
        }
        const enrich: Record<string, any> = {};
        for (const r of responses) Object.assign(enrich, r.data || {});

        // Re-grade ONLY the missing-data cards
        const replacedTickers = new Set<string>();
        const updatedCards: ParsedEarning[] = [];
        for (const c of allCards) {
          // PATCH 0360 — keep card unchanged ONLY when it already has YoY
          // data (matches the new preview-detection criterion). A card with
          // sales_curr_cr=N but null YoY is preview-shape and should re-enrich.
          const cardAlreadyHasYoY =
            c.sales_yoy_pct != null ||
            c.net_profit_yoy_pct != null ||
            c.eps_yoy_pct != null;
          // zzz235 — even when the card has YoY, if OPM is a stale zero (Worker
          // pre-zzz234 NBFC/bank quirk), merge in fresh margin from the enrich
          // response so LTF/INDIANB/MAHABANK get a real number without
          // re-grading the whole card.
          const _opmCurStale = (c as any).opm_pct === 0 &&
            (c as any).sales_curr_cr != null && Number((c as any).sales_curr_cr) >= 100;
          const _opmPrevStale = (c as any).opm_prev_pct === 0 &&
            (c as any).sales_prev_cr != null && Number((c as any).sales_prev_cr) >= 100;
          if (cardAlreadyHasYoY) {
            if (_opmCurStale || _opmPrevStale) {
              const e = enrich[c.ticker];
              if (e) {
                const patched: any = { ...c };
                if (_opmCurStale && e.opm_pct != null && e.opm_pct !== 0) patched.opm_pct = e.opm_pct;
                if (_opmPrevStale && e.opm_prev_pct != null && e.opm_prev_pct !== 0) patched.opm_prev_pct = e.opm_prev_pct;
                updatedCards.push(patched);
                continue;
              }
            }
            updatedCards.push(c);
            continue;
          }
          const e = enrich[c.ticker];
          // PATCH 0360 — enrich-success criterion used YoY presence.
          // zzz411 — ALSO accept absolute current-quarter financials. Recent
          // IPOs and names Screener has no year-ago quarter for (CAMPUS, CRIZAC,
          // AWFIS, PATELRMART …) return sales_curr/pat_curr/eps/opm with NO YoY.
          // gradeRow's `hasAnyAbsolute` branch renders those perfectly, but this
          // gate was discarding them as "no useful data" → permanent screener-gap.
          const enrichHasData = !!e && (
            e.sales_yoy_pct != null || e.pat_yoy_pct != null || e.eps_yoy_pct != null ||
            e.sales_curr_cr != null || e.pat_curr_cr != null || e.eps_curr != null ||
            e.opm_pct != null || e.market_cap_cr != null || e.pe != null
          );
          if (!enrichHasData) {
            updatedCards.push(c);  // still no useful data → keep preview
            continue;
          }
          // Re-grade with new enrichment data
          const row = {
            // zzz414 — was `hub_quality: undefined`, which made gradeRow's
            // preview path return NULL for absolute-only enrichments (recent
            // IPOs like CMRGREEN: full Rev/PAT/EPS/OPM but no year-ago
            // quarter → all YoY null → !hasFin → preview branch → no
            // hubQuality → dropped). The card being IN the cached payload
            // means the filing was already confirmed once, so reconstruct
            // the quality from its existing tier — the absolutes branch then
            // renders Rev/PAT/EPS instead of "awaiting enrichment".
            hub_quality: ((): any => {
              const t = (c as any)?.tier;
              return t === 'BLOCKBUSTER' ? 'Excellent' : t === 'STRONG' ? 'Great' : t === 'AVOID' ? 'Weak' : 'Good';
            })(),
            // PATCH 0369 — prefer enrich's resolved company name (it now
            // queries Screener.in search when NSE name was missing/junk).
            // Falls back to the cached card name if enrich didn't resolve.
            symbol: c.ticker,
            company: (e.company && e.company !== c.ticker && e.company.toUpperCase() !== String(c.ticker).toUpperCase())
              ? e.company
              : (c.company || e.company_name || c.ticker),
            filing_date: c.filing_date,
            quarter: c.quarter, sector: e.sector || c.sector,
            market_cap_bucket: e.market_cap_bucket || c.market_cap_bucket,
            market_cap_cr: e.market_cap_cr ?? (c as any).market_cap_cr ?? null,
            adtv_cr: e.adtv_cr ?? null,  // PATCH 1037 — carry liquidity into grader
      announcement_text: (c as any).announcement_text ?? null,  // zzz668
      guidance_text: e.guidance_text ?? null,                    // zzz669
      guidance_raised: e.guidance_raised ?? null,
      guidance_lowered: e.guidance_lowered ?? null,
      has_concrete_guidance: e.has_concrete_guidance ?? null,
      // ─── zzz668 — FIELDS THE SCRAPER FETCHED AND THE GRADER NEVER SAW ───
      //
      // Enrichment has been returning all of these for months. The row builder
      // dropped every one, so they reached the card and could not influence a
      // single grade — the US engine uses its equivalents as tier ceilings.
      //
      // `vol_ratio_20d` is the one that stings: PEAD's volume leg has been the
      // hard-coded constant 50 because "the India feed does not carry a volume
      // ratio", and the feed has carried it all along. A quarter of that score
      // was a placeholder sitting next to the real number.
      vol_ratio_20d: e.vol_ratio_20d ?? null,
      rvol: e.rvol ?? null,
      exceptional_curr_cr: e.exceptional_curr_cr ?? null,
      exceptional_pct_pbt: e.exceptional_pct_pbt ?? null,
      pledged_pct: e.pledged_pct ?? null,
      int_coverage: e.int_coverage ?? null,
      // zzz665c — enrich has computed this all along and the row builder dropped
      // it, which is the only reason India's reaction ladder ran unscaled.
      close_30d: e.close_30d ?? null,
            source_url: c.filing_url,
            sales_curr_cr: e.sales_curr_cr, sales_prev_cr: e.sales_prev_cr, sales_yoy_pct: e.sales_yoy_pct,
            pat_curr_cr: e.pat_curr_cr, pat_prev_cr: e.pat_prev_cr, pat_yoy_pct: e.pat_yoy_pct,
            eps_curr: e.eps_curr, eps_prev: e.eps_prev, eps_yoy_pct: e.eps_yoy_pct,
            newly_listed: e.newly_listed ?? undefined, num_quarters: e.num_quarters ?? null,  // zzz503
            quarters_sales: e.quarters_sales ?? null, quarters_eps: e.quarters_eps ?? null, quarters_pat: e.quarters_pat ?? null,  // zzz505/507
            op_profit_yoy_pct: e.op_profit_yoy_pct, opm_pct: e.opm_pct, opm_prev_pct: e.opm_prev_pct,
            pe: e.pe, current_price: e.current_price ?? c.price,
            gap_pct: e.gap_pct ?? c.gap_pct, d1_pct: e.d1_pct ?? c.d1_pct, move_pct: e.move_pct ?? c.move_pct,
            pct_from_52w_high: e.pct_from_52w_high ?? c.pct_from_52w_high,
            rs_rating: e.rs_rating ?? c.rs_rating, stage: e.stage ?? c.stage,
            trend_template_passes: e.trend_template_passes,
            ocf_annual_cr: e.ocf_annual_cr, pat_annual_cr: e.pat_annual_cr, ocf_to_pat_ratio: e.ocf_to_pat_ratio,
            period_ended: e.period_ended, latest_quarter_end_iso: e.latest_quarter_end_iso ?? _isoFromQuarterLabel(e.latest_quarter_label),  // zzz414
            announce_date_iso: e.announce_date_iso,
            financials_source: e.financials_source,
          };
          const g = gradeRow(row);
          // PATCH 0359 — only count a card as "replaced" when enrich produced
          // a card with meaningful financial data (YoY %s present, not just
          // a raw sales_curr_cr). Previously gradeRow could return a card
          // with sales_curr_cr=N but YoY=null which counts as "updated" in
          // the message but renders identical to the preview card on screen.
          // The user sees "Updated 11/11" while staring at preview cards.
          const hasRealFinancials = !!g && (
            g.sales_yoy_pct != null || g.net_profit_yoy_pct != null || g.eps_yoy_pct != null ||
            // zzz411 — an absolute-financials card (Rev/PAT/EPS present, no YoY)
            // is a real, informative card, not a preview. Count it as updated so
            // Refresh stops falsely reporting "0/N updated" for these names.
            g.sales_curr_cr != null || g.pat_curr_cr != null || g.eps_curr != null
          );
          if (g && hasRealFinancials) {
            updatedCards.push(g);
            replacedTickers.add(c.ticker);
          } else {
            updatedCards.push(c);
          }
        }

        // Rebuild by_tier and re-sort
        const by_tier: Record<EarningsTier, ParsedEarning[]> = { BLOCKBUSTER: [], STRONG: [], MIXED: [], AVOID: [] };
        for (const g of updatedCards) by_tier[g.tier].push(g);
        for (const t of TIER_ORDER) by_tier[t].sort((a, b) => b.composite_score - a.composite_score);

        // PATCH 0192 — Return the exact tickers that were attempted but failed
        // (still missing financials after the refresh). Client uses this for
        // accurate error messages instead of relying on its potentially stale
        // local view.
        const failedTickers = needTickers.filter((t) => !replacedTickers.has(t));
        const payload = {
          ...existing,
          by_tier,
          candidates_total: updatedCards.length,
          generated_at: new Date().toISOString(),
          _cache: 'partial-refresh',
          _refresh: `${replacedTickers.size}/${needTickers.length} updated`,
          _attempted_tickers: needTickers,
          _failed_tickers: failedTickers,
          _updated_tickers: [...replacedTickers],
        };
        // Write back with same TTL strategy
        const ttl = isPast ? 365 * 24 * 3600 : 5 * 60;
        // PATCH 1002 — guard final cache write too. If the new payload graded
    // ZERO tickers but a cached version had entries, preserve the cache.
    try {
      const _t = (payload as any).by_tier;
      const _gradedCount = (_t?.BLOCKBUSTER?.length || 0)
                         + (_t?.STRONG?.length || 0)
                         + (_t?.MIXED?.length || 0)
                         + (_t?.AVOID?.length || 0);
      let _skipWrite = false;
      if (_gradedCount === 0) {
        const _prior: any = await kvGet(cacheKey);
        if (_prior?.by_tier) {
          const _priorN = (_prior.by_tier.BLOCKBUSTER?.length || 0)
                        + (_prior.by_tier.STRONG?.length || 0)
                        + (_prior.by_tier.MIXED?.length || 0)
                        + (_prior.by_tier.AVOID?.length || 0);
          if (_priorN > 0) {
            _skipWrite = true;
            console.log(`[graded] PATCH 1002: final write blocked — payload empty but cache has ${_priorN} entries`);
          }
        }
      }
      if (!_skipWrite) await kvSet(cacheKey, payload, ttl);
    } catch {}
        return NextResponse.json(payload, { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=900' } });  // PATCH 0818
      }
    } catch (e) {
      // Fall through to full-rebuild path
    }
  }

  // Fetch hub for the month
  const base = new URL(req.url);
  const month = date.slice(0, 7);
  // PATCH 0175 — when force=1, propagate to the hub so its in-memory cache also gets bypassed
  const hubUrl = `${base.protocol}//${base.host}/api/market/earnings?market=india&month=${month}${force ? '&force=1' : ''}`;
  // PATCH 0461 — hard 25s timeout on the hub fetch. Previously this could
  // hang for the full Vercel function lifetime (60s) and return a 504,
  // poisoning the client's retry loop. AbortController fires at 25s so
  // we still have a few seconds of budget left for KV write + response.
  // PATCH 0909 — Resilient hub fetch. Instead of returning hard 504/502 on
  // upstream failure, fall back through a tiered chain:
  //   1. Stale KV payload for this date (even past TTL — better than nothing)
  //   2. Live-NSE today-live filings (skip hub entirely)
  //   3. 200 + empty payload with `_stale` reason flag (client renders empty
  //      state cleanly without a hard error toast)
  // User report: "/api/v1/earnings/graded returning 502" cascaded into "few
  // companies in graded tiers" because client retry loop saw the error and
  // didn't bother trying again.
  let hubRes: Response | null = null;
  let hubFailReason: string | null = null;
  // PATCH 0982 — Railway self-fetch loopback fallback.
  // On Railway, `fetch(<public-URL of self>)` from inside the container
  // fails immediately with `fetch failed` because the edge layer rejects
  // the self-loop. We retry the same path via 127.0.0.1:PORT loopback.
  // No-op on Vercel (different runtime, public self-fetch works there).
  const _doHubFetch = async (url: string): Promise<Response> => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 25_000);
    try {
      return await fetch(url, { cache: 'no-store', signal: ctl.signal });
    } finally {
      clearTimeout(timer);
    }
  };
  // zzz411b — same root cause as _doEnrichSelfFetch: on Railway the container
  // often cannot reach its own PUBLIC URL (edge rejects self-loops with a
  // non-OK response OR a throw). The old code only fell back to loopback on
  // THROW, so a non-OK public response left hubRes=!ok → fallback chain →
  // "0 graded / sources have no Q-data" even when the hub was healthy.
  // On a long-running node server (PORT set, not Vercel), go LOOPBACK-FIRST.
  const _hubPort = process.env.PORT;
  const _hubLoop = (_hubPort && /^https?:\/\/[^/]+\//.test(hubUrl))
    ? hubUrl.replace(/^https?:\/\/[^/]+/, `http://127.0.0.1:${_hubPort}`)
    : null;
  const _hubOnRailway = !!_hubLoop && !process.env.VERCEL;
  if (_hubOnRailway) {
    try {
      const rl = await _doHubFetch(_hubLoop!);
      if (rl.ok) hubRes = rl;
      else console.log(`[graded] hub loopback returned ${rl.status}, falling back to public URL`);
    } catch (e: any) {
      console.log(`[graded] hub loopback failed (${e?.message}), falling back to public URL`);
    }
  }
  if (!hubRes) {
    try {
      hubRes = await _doHubFetch(hubUrl);
    } catch (e: any) {
      const firstFail = e?.name === 'AbortError' ? 'hub_timeout_25s' : `hub_throw_${e?.message || 'unknown'}`;
      if (_hubLoop && !_hubOnRailway) {
        // Vercel-side throw → try loopback once (legacy path).
        try {
          hubRes = await _doHubFetch(_hubLoop);
          console.log(`[graded] hub public-URL failed (${firstFail}), recovered via loopback`);
        } catch (e2: any) {
          hubFailReason = `${firstFail},loopback_also_failed_${e2?.message || 'unknown'}`;
          hubRes = null;
        }
      } else {
        hubFailReason = firstFail;
        hubRes = null;
      }
    }
  }
  if (hubRes && !hubRes.ok) {
    hubFailReason = `hub_http_${hubRes.status}`;
  }
  const hubOk = hubRes && hubRes.ok;
  let hub: any = null;
  if (hubOk) {
    try {
      hub = await hubRes!.json();
    } catch (e: any) {
      hubFailReason = `hub_parse_${e?.message || 'unknown'}`;
      hub = null;
    }
  }
  if (!hub) {
    // Fallback chain — hub failed for some reason. Try not to hard-error.
    console.warn(`[graded] ${date}: hub fetch failed (${hubFailReason}), attempting fallback chain`);
    // Tier 1: stale KV payload (allow any cache hit even if force=1 came in)
    if (isRedisAvailable()) {
      try {
        const staleCached = await kvGet(cacheKey);
        if (staleCached) {
          console.log(`[graded] ${date}: served stale KV cache (hub down: ${hubFailReason})`);
          return NextResponse.json(
            { ...staleCached, _cache: 'stale-fallback', _hub_fail: hubFailReason },
            { headers: { 'Cache-Control': 'no-store' } }
          );
        }
      } catch {}
    }
    // Tier 2: live-NSE only path — skip hub entirely. We synthesize a tiny
    // hub stub so the rest of the pipeline can run on just live NSE filings.
    hub = { results: [] };
  }
  // PATCH zzz101 — DROP the quality !== 'Upcoming' filter so hub Upcoming
  // entries (like VIKASLIFE on 2026-06-24) flow through gradeRow.
  let dayList: any[] = (hub?.results || []).filter((r: any) => r.resultDate === date);

  // PATCH zzz102 — REMOVED manual override list. User confirmed those tickers
  // weren't actual Q4 filers — they were stale screener-data ghosts that
  // happened to share "Outcome of Board Meeting" subjects. The true real
  // Q4 filing on 2026-06-24 was ONLY VIKASLIFE, which is correctly listed
  // on the EarningsPulse hub. Hub-corroboration is the right signal.

  // PATCH zzz96 — Build set of tickers the hub knows about for the WHOLE month.
  // The hub is the authoritative aggregator of filings, including "Upcoming"
  // entries from EarningsPulse forecast. Used downstream in dropGhosts to
  // drop today-live items that have NO corroboration anywhere in the hub —
  // those are bare "Outcome of Board Meeting" filings about dividends, AGMs,
  // share allotments, etc. — NOT Q4 results.
  const _monthlyHubTickers = new Set<string>();
  for (const r of (hub?.results || [])) {
    if (r?.ticker) _monthlyHubTickers.add(String(r.ticker).toUpperCase());
  }

  // PATCH 0363 / PATCH 0497 — Augment with live NSE corp-announcements.
  //
  // Original (0363): only fired for today + yesterday, on the theory that
  // older dates already settled in the hub aggregator.
  //
  // 0497 rewrite: the hub aggregator routinely misses Fri/Sat/Sun/Mon filings
  // (Indian companies DO file on weekends — board meetings can be Sat or Sun).
  // User pasted EarningsPulse showing 47 candidates for Fri 15 May while we
  // showed 0 with stale Apr 30 as "latest". Root cause: hub never picked
  // those up, and the live-NSE fallback refused to fire for any date >1d old.
  //
  // New rule: fire live-NSE augmentation for ANY past date within last 14
  // calendar days. NSE corp-announcements is the authoritative filing feed,
  // and 14d covers the worst-case "I'm browsing last week's filings on
  // Tuesday" window. Also fire when dayList is sparse (<10 items) even if
  // the hub is populated — the hub often returns Confirmed entries from
  // board-meeting forecasts but misses the actual filings.
  const dateAgeDays = Math.max(0, Math.floor((new Date(todayIso).getTime() - new Date(date).getTime()) / 86_400_000));
  const isHubSparse = dayList.length < 10;
  const shouldLiveAugment = dateAgeDays <= 14;  // zzz425 — fire for ALL recent dates, not just sparse ones: the hub misses recent real filers (IPOs like RUBICON) even when the day is otherwise populated
  if (shouldLiveAugment) {
    try {
      const liveUrl = `${base.protocol}//${base.host}/api/v1/earnings/today-live?date=${date}${force ? '&force=1' : ''}`;
      // PATCH zzz94 — Railway edge blocks public self-loops; use loopback on failure
      const _doLiveFetch = async (u: string) => fetch(u, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      let liveRes: Response;
      try {
        liveRes = await _doLiveFetch(liveUrl);
      } catch (e: any) {
        const port = process.env.PORT;
        if (port) {
          const loopUrl = liveUrl.replace(/^https?:\/\/[^/]+/, `http://127.0.0.1:${port}`);
          console.log(`[graded] zzz94 today-live public fetch failed, retrying loopback: ${loopUrl}`);
          liveRes = await _doLiveFetch(loopUrl);
        } else { throw e; }
      }
      if (liveRes.ok) {
        const live: any = await liveRes.json();
        const liveFilings: any[] = Array.isArray(live?.filings) ? live.filings : [];
        const existingTickers = new Set<string>(dayList.map((r: any) => String(r.ticker || '').toUpperCase()));
        let addedFromLive = 0;
        for (const f of liveFilings) {
          const sym = String(f.symbol || '').toUpperCase();
          if (!sym || existingTickers.has(sym)) continue;
          dayList.push({
            ticker: sym,
            company: f.company || sym,
            resultDate: date,
            quarter: deriveQuarterLabel(date),  // zzz379 — was 'Q4'; derive from filing date
            sector: null,
            marketCap: null,
            quality: 'Confirmed',  // it's a real NSE filing, not a board-meeting forecast
            source_url: f.attachment_url || `https://www.nseindia.com/companies-listing/corporate-filings-financial-results?symbol=${encodeURIComponent(sym)}`,
            filing_iso: f.filing_iso,
            // zzz668 — the announcement's own subject line. The grader has
            // scanned six text fields for guidance signals since it was
            // written and NOTHING has ever populated any of them, so
            // `positiveGuidance` was permanently false and Blockbuster Path A's
            // guidance alternative was unreachable. This is the one real text
            // the pipeline already holds. Expect a LOW yield — a subject line
            // is usually "Outcome of Board Meeting", not a narrative — but a
            // field that is sometimes true beats one that cannot be.
            announcement_text: f.subject || null,
            __source: 'nse-live',
          });
          existingTickers.add(sym);
          addedFromLive++;
        }
        console.log(`[graded] ${date} (age=${dateAgeDays}d, sparse=${isHubSparse}): augmented dayList with ${addedFromLive} live NSE filings (hub had ${dayList.length - addedFromLive}, live total ${liveFilings.length})`);
      }
    } catch (err) {
      console.warn(`[graded] today-live fetch failed for ${date}:`, (err as Error).message);
    }
  }

  // PATCH zzz64 — Calendar fallback seed. When the hub returns 0 candidates
  // for a date, the calendar endpoint may still know about real filings via
  // its cron+worker fallback chain (mc-scraper Worker, NSE auto-keys). Pull
  // from there and seed dayList. This bridges the gap where the hub aggregator
  // hasn't yet picked up filings the Worker already has.
  //
  // NB: Railway's edge layer rejects self-loops on the public URL, so we use
  // the same loopback-on-failure pattern as _doEnrichSelfFetch.
  if (dayList.length === 0) {
    try {
      const calUrlPublic = `${base.protocol}//${base.host}/api/v1/earnings/calendar?date=${date}`;
      const _calFetch = async (u: string) => fetch(u, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      let calRes: Response | null = null;
      try {
        calRes = await _calFetch(calUrlPublic);
      } catch (err: any) {
        const port = process.env.PORT;
        if (port) {
          const loop = calUrlPublic.replace(/^https?:\/\/[^/]+/, `http://127.0.0.1:${port}`);
          console.log(`[graded] calendar public fetch failed (${err?.message}), retrying via loopback`);
          calRes = await _calFetch(loop);
        } else {
          throw err;
        }
      }
      if (calRes && calRes.ok) {
        const cal: any = await calRes.json();
        const calItems: any[] = Array.isArray(cal?.items) ? cal.items : [];
        const existingTickers = new Set<string>(dayList.map((r: any) => String(r.ticker || '').toUpperCase()));
        let addedFromCal = 0;
        for (const it of calItems) {
          const sym = String(it.symbol || '').toUpperCase();
          if (!sym || existingTickers.has(sym)) continue;
          // zzz72 — defense-in-depth: never grade Clarification announcements
          if (it.period_type === 'Clarification') continue;
          dayList.push({
            ticker: sym,
            company: it.company || sym,
            resultDate: date,
            quarter: deriveQuarterLabel(date),  // zzz379
            sector: null,
            marketCap: null,
            quality: 'Confirmed',
            source_url: it.source_url || it.attachment || `https://www.nseindia.com/companies-listing/corporate-filings-financial-results?symbol=${encodeURIComponent(sym)}`,
            filing_iso: it.filing_dt_iso || null,
            __source: 'calendar-fallback',
          });
          existingTickers.add(sym);
          addedFromCal++;
        }
        if (addedFromCal > 0) {
          console.log(`[graded] ${date}: PATCH zzz64 — seeded ${addedFromCal} candidates from calendar fallback (source=${cal?.source})`);
        }
      }
    } catch (err) {
      console.warn(`[graded] calendar fallback fetch failed for ${date}:`, (err as Error).message);
    }
  }

  // PATCH 0497 — 2nd-pass live-NSE attempt with force=1 if first pass
  // returned empty (NSE may have been transiently blocked). Only for recent
  // past dates where we expect filings to exist.
  if (dateAgeDays > 0 && dateAgeDays <= 14 && dayList.length === 0) {
    try {
      const retryUrl = `${base.protocol}//${base.host}/api/v1/earnings/today-live?date=${date}&force=1`;
      // PATCH zzz94 — Railway edge blocks public self-loops; use loopback on failure
      const _doRetryFetch = async (u: string) => fetch(u, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      let retryRes: Response;
      try {
        retryRes = await _doRetryFetch(retryUrl);
      } catch (e: any) {
        const port = process.env.PORT;
        if (port) {
          const loopUrl = retryUrl.replace(/^https?:\/\/[^/]+/, `http://127.0.0.1:${port}`);
          console.log(`[graded] zzz94 today-live retry public fetch failed, retrying loopback: ${loopUrl}`);
          retryRes = await _doRetryFetch(loopUrl);
        } else { throw e; }
      }
      if (retryRes.ok) {
        const retry: any = await retryRes.json();
        const filings: any[] = Array.isArray(retry?.filings) ? retry.filings : [];
        let addedFromRetry = 0;
        const existingTickers = new Set<string>(dayList.map((r: any) => String(r.ticker || '').toUpperCase()));
        for (const f of filings) {
          const sym = String(f.symbol || '').toUpperCase();
          if (!sym || existingTickers.has(sym)) continue;
          dayList.push({
            ticker: sym,
            company: f.company || sym,
            resultDate: date,
            quarter: deriveQuarterLabel(date),  // zzz379
            sector: null,
            marketCap: null,
            quality: 'Confirmed',
            source_url: f.attachment_url || `https://www.nseindia.com/companies-listing/corporate-filings-financial-results?symbol=${encodeURIComponent(sym)}`,
            filing_iso: f.filing_iso,
            __source: 'nse-live-retry',
          });
          existingTickers.add(sym);
          addedFromRetry++;
        }
        console.log(`[graded] ${date}: 2nd-pass live-NSE retry added ${addedFromRetry} filings`);
      }
    } catch (err) {
      console.warn(`[graded] live-NSE retry failed for ${date}:`, (err as Error).message);
    }
  }

  if (dayList.length === 0) {
    const empty: any = {
      filing_date: date,
      candidates_total: 0,
      raw_items_total: 0,
      by_tier: { BLOCKBUSTER: [], STRONG: [], MIXED: [], AVOID: [] },
      generated_at: new Date().toISOString(),
      sources_polled: 1,
    };
    // PATCH 0909 — tag the empty payload with the hub failure reason so the
    // client can show "upstream degraded — retry shortly" instead of a silent
    // empty state. Only cache the empty when hub was actually OK (don't
    // poison KV with a false-negative).
    if (hubFailReason) {
      empty._hub_fail = hubFailReason;
    } else if (isPast && isRedisAvailable()) {
      // PATCH 1002 — don't blow away a good cached payload with empty.
      // Read existing; if it has entries, keep it (no kvSet).
      let existingHasData = false;
      try {
        const prior: any = await kvGet(cacheKey);
        if (prior && prior.by_tier) {
          const n = (prior.by_tier.BLOCKBUSTER?.length || 0)
                  + (prior.by_tier.STRONG?.length || 0)
                  + (prior.by_tier.MIXED?.length || 0)
                  + (prior.by_tier.AVOID?.length || 0);
          existingHasData = n > 0;
        }
      } catch {}
      // ═══ AN HOUR IS RIGHT FOR TODAY AND WRONG FOR LAST WEEK  (zzz647) ═══
      //
      // PATCH 1002 cut this to one hour so a day that looked empty only
      // because the filings had not propagated would re-resolve quickly. That
      // is correct for a session still settling — and badly wrong once it has
      // settled, because after the hour expires the day reverts to having NO
      // CACHE AT ALL, and every cache_only reader is told `pending: true`
      // for ever. The AI Research Desk reads exactly that way, so 2026-09-09
      // — a session on which no Indian company filed anything, a completed and
      // entirely ordinary fact — showed on the page as "1 session not graded
      // yet", permanently, alongside a genuinely ungraded today.
      //
      // "Nothing was filed" and "we have not looked yet" are opposite
      // statements and the page can only tell them apart if the first one is
      // actually stored. So the TTL now follows the age of the SESSION rather
      // than being one number for all of them: a few days of settling time at
      // an hour, and after that the empty is a fact and is kept like one. A
      // force rebuild still overrides it at any time.
      const SETTLE_DAYS = 4;
      const ageDays = Math.floor((Date.now() - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
      const emptyTtl = ageDays > SETTLE_DAYS ? 180 * 24 * 3600 : 3600;
      if (!existingHasData) {
        try { await kvSet(cacheKey, empty, emptyTtl); } catch {}
      } else {
        console.log(`[graded] PATCH 1002: kept existing non-empty cache for ${date}, skipped empty overwrite`);
      }
    }
    return NextResponse.json(empty, { headers: { 'Cache-Control': hubFailReason ? 'no-store' : 's-maxage=300, stale-while-revalidate=900' } });
  }

  // Fetch enrichment for all tickers (chunk to 40 per request)
  const symbols: string[] = dayList.map((r: any) => r.ticker);
  const chunks: string[][] = [];
  for (let i = 0; i < symbols.length; i += 40) chunks.push(symbols.slice(i, i + 40));

  // PATCH 1021 — revert Patch 1014's blanket nocache=1 on the MAIN path.
  // 1014 forced an uncached full enrichment (worker+NSE+Screener+bhavcopy) for
  // EVERY ticker, so a 100-ticker date blew past the 45s client timeout.
  // The original 1014 problem (stale empty entries) is already handled by
  // Patch 1002 (enrich never caches empty/null payloads) + the v6 cache bump
  // (1013) + gradeRow now emitting opm (1015). So we can safely use the enrich
  // KV cache here for speed. The refreshMissing path (line ~601) keeps
  // nocache=1 for targeted, user-triggered re-fetches.
  const enrichResponses = await Promise.all(chunks.map((chunk) =>
    _doEnrichSelfFetch(`${base.protocol}//${base.host}/api/v1/earnings/enrich?symbols=${chunk.map(encodeURIComponent).join(',')}&filed=${date}`, { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : { data: {} })
      .catch(() => ({ data: {} }))
  ));
  const enrich: Record<string, any> = {};
  for (const r of enrichResponses) Object.assign(enrich, r.data || {});

  // Join + grade
  // PATCH 0403 — Defensive guard against today-live ghost-filings.
  // If a ticker came from today-live ONLY (not hub) AND enrich can't
  // verify the quarter-end matches the filing_date within 75 days, drop
  // it. Symptom we're fixing: today-live's regex used to match
  // "Reply to Clarification- Financial results" subjects, dragging in
  // companies that hadn't actually filed Q4 — Screener served their
  // historic latest-quarter data, gradeRow happily produced a
  // BLOCKBUSTER card attributed to the wrong date. Even with the
  // today-live regex tightened in this patch, this guard provides
  // belt-and-suspenders so a future regex regression can't silently
  // resurrect the bug.
  const dropGhosts = (m: any, e: any): boolean => {
    if (m.__source !== 'nse-live' && m.__source !== 'nse-live-retry' && m.__source !== 'nse-announcements') return false;

    // PATCH zzz102 — STRICT hub-corroboration guard.
    // The user verified that bare "Outcome of Board Meeting" filings from
    // today-live are unreliable: routine BMs about dividends, AGMs, share
    // allotments share the same metadata as real Q4 filings. The only
    // reliable signal is the EarningsPulse hub. If the hub has NO record
    // of this ticker anywhere this month AND there's no announce_date
    // corroboration from enrich, drop.
    const tickerUpper = String(m.ticker || '').toUpperCase();
    const hubKnowsTicker = _monthlyHubTickers.has(tickerUpper);
    // zzz425 — a FRESH quarter-end matching the filing window is strong evidence
    // of a REAL result. Recent IPOs (RUBICON etc.) aren't in the EarningsPulse hub
    // and often lack an announce_date, yet have valid Screener quarter data. Check
    // that BEFORE the strict hub+announce drop so we don't discard them. Ghost
    // "Outcome of Board Meeting" filings fail this — Screener serves their STALE
    // prior quarter (daysSince > 95) — so they still get dropped just below.
    if (e.latest_quarter_end_iso) {
      const _q = new Date(e.latest_quarter_end_iso).getTime();
      const _f = new Date(m.resultDate).getTime();
      const _ds = (_f - _q) / 86_400_000;
      if (_ds >= 0 && _ds <= 95) return false;
    }
    if (!hubKnowsTicker && !e.announce_date_iso) {
      return true;  // not on hub + no announce date + no fresh quarter = noise
    }

    // Has announce_date and matches → OK
    if (e.announce_date_iso) {
      const d = new Date(e.announce_date_iso).getTime();
      const f = new Date(m.resultDate).getTime();
      if (Math.abs(d - f) <= 3 * 86_400_000) return false;
    }
    // Quarter-end within 95 days of filing → OK
    // PATCH zzz95 — bumped from 75 to 95 days. Small caps routinely file
    // Q4 results late: VIKASLIFE filed Q4 Mar-2026 on 24-Jun-2026 = 85 days,
    // got dropped by the 75-day cap even though it's a legitimate filing.
    // SEBI deadline is 60 days but extensions push small caps to 90+ days.
    if (e.latest_quarter_end_iso) {
      const q = new Date(e.latest_quarter_end_iso).getTime();
      const f = new Date(m.resultDate).getTime();
      const daysSince = (f - q) / 86_400_000;
      if (daysSince >= 0 && daysSince <= 95) return false;
    }
    // PATCH 0511 — When BOTH announce_date AND quarter_end are missing
    // from enrich (Screener Cloudflare-blocked us, or Yahoo had no Q-data),
    // we have no signal to verify against. In that case TRUST the live
    // filing instead of dropping it. Previously this branch dropped any
    // weekend BSE filing whose enrich came back empty — which is exactly
    // the Sat/Sun pattern the user keeps reporting.
    //
    // The live-NSE/BSE source itself is a strong signal (we already
    // applied SUBJECT_BLOCKLIST + RESULT_PATTERNS + category metadata
    // in today-live before getting here). If both verification paths
    // are missing, accept the filing as-is — it'll render as a preview
    // card with the company name and source URL, which is far better
    // than disappearing entirely.
    if (!e.announce_date_iso && !e.latest_quarter_end_iso) return false;
    // We have SOME enrich data but it doesn't match — likely a real
    // ghost-filing or a wrong-period attribution. Drop.
    return true;
  };
  const graded: ParsedEarning[] = [];
  for (const m of dayList) {
    const e = enrich[m.ticker] || {};
    if (dropGhosts(m, e)) {
      console.log(`[graded] ${date}: dropping ghost-filing ${m.ticker} (no announce_date and quarter_end too far)`);
      continue;
    }
    // PATCH zzz102 — Freshness guard. If screener's latest_quarter_end_iso
    // is more than 100 days before the filing_date, the company hasn't yet
    // filed Q4 — screener is serving the prior quarter (Q3 Dec data).
    // Catches hub-confirmed Upcoming tickers like GENCON (2025-12-31 ÷
    // 2026-06-25 = 176 days) that haven't actually filed Q4 yet.
    if (e?.latest_quarter_end_iso) {
      const q = new Date(e.latest_quarter_end_iso).getTime();
      const f = new Date(m.resultDate).getTime();
      const daysSince = (f - q) / 86_400_000;
      if (daysSince > 100) {
        console.log(`[graded] ${date}: dropping ${m.ticker} — screener quarter ${e.latest_quarter_end_iso} is ${Math.round(daysSince)}d stale (Q4 not filed yet)`);
        continue;
      }
    }
    const row = {
      hub_quality: m.quality,
      // PATCH 0369 — Prefer enrich's resolved company name over the
      // hub's raw name when (a) hub returned blank/ticker, OR (b) enrich
      // has a real, non-ticker name from Screener search.
      symbol: m.ticker,
      company: (e.company && e.company !== m.ticker && e.company.toUpperCase() !== String(m.ticker).toUpperCase())
        ? e.company
        : (m.company && m.company.toUpperCase() !== String(m.ticker).toUpperCase() ? m.company : (e.company || m.company || m.ticker)),
      filing_date: m.resultDate,
      quarter: m.quarter || e.quarter || deriveQuarterLabel(m.resultDate),
      sector: e.sector || m.sector,
      market_cap_bucket: e.market_cap_bucket ||
        (m.marketCap === 'L' ? 'LARGE' : m.marketCap === 'M' ? 'MID' : m.marketCap === 'S' ? 'SMALL' : m.marketCap === 'Micro' ? 'MICRO' : null),
      market_cap_cr: e.market_cap_cr ?? null,
      adtv_cr: e.adtv_cr ?? null,  // PATCH 1037 — carry liquidity into grader
      // ─── zzz668 — THIS IS THE BUILDER THE NORMAL GRADING PATH USES ───────
      //
      // There are TWO row builders in this file: this one, and a second inside
      // the partial-refresh branch. They must carry the same fields, and twice
      // now a field has been added to only one of them — `close_30d` went to
      // the partial-refresh copy alone, so the volatility-scaled reaction
      // ladder it was fetched for never ran on the main path and reported no
      // error while not working. Anything added here gets added there too.
      close_30d: e.close_30d ?? null,
      vol_ratio_20d: e.vol_ratio_20d ?? null,
      rvol: e.rvol ?? null,
      exceptional_curr_cr: e.exceptional_curr_cr ?? null,
      exceptional_pct_pbt: e.exceptional_pct_pbt ?? null,
      pledged_pct: e.pledged_pct ?? null,
      int_coverage: e.int_coverage ?? null,
      announcement_text: (m as any).announcement_text ?? null,
      // zzz669 — the guidance overlay, built by refresh-guidance from the
      // concall pipeline. Explicit booleans beat a regex over prose.
      guidance_text: e.guidance_text ?? null,
      guidance_raised: e.guidance_raised ?? null,
      guidance_lowered: e.guidance_lowered ?? null,
      has_concrete_guidance: e.has_concrete_guidance ?? null,
      source_url: e.source_url || `https://www.nseindia.com/companies-listing/corporate-filings-financial-results?symbol=${encodeURIComponent(m.ticker)}`,
      sales_curr_cr: e.sales_curr_cr ?? null, sales_prev_cr: e.sales_prev_cr ?? null,
      sales_yoy_pct: e.sales_yoy_pct ?? null,
      pat_curr_cr: e.pat_curr_cr ?? null, pat_prev_cr: e.pat_prev_cr ?? null,
      pat_yoy_pct: e.pat_yoy_pct ?? null,
      eps_curr: e.eps_curr ?? null, eps_prev: e.eps_prev ?? null, eps_yoy_pct: e.eps_yoy_pct ?? null,
      newly_listed: e.newly_listed ?? undefined, num_quarters: e.num_quarters ?? null,  // zzz503
      quarters_sales: e.quarters_sales ?? null, quarters_eps: e.quarters_eps ?? null, quarters_pat: e.quarters_pat ?? null,  // zzz505/507
      op_profit_yoy_pct: e.op_profit_yoy_pct ?? null, opm_pct: e.opm_pct ?? null, opm_prev_pct: e.opm_prev_pct ?? null,
      pe: e.pe ?? null,
      current_price: e.current_price ?? m.cmp ?? null,
      gap_pct: e.gap_pct ?? null, d1_pct: e.d1_pct ?? null,
      move_pct: e.move_pct ?? m.priceMove ?? null,
      pct_from_52w_high: e.pct_from_52w_high ?? null,
      rs_rating: e.rs_rating ?? null, stage: e.stage ?? null,
      trend_template_passes: e.trend_template_passes ?? false,
      ocf_annual_cr: e.ocf_annual_cr ?? null, pat_annual_cr: e.pat_annual_cr ?? null, ocf_to_pat_ratio: e.ocf_to_pat_ratio ?? null,
      period_ended: e.period_ended,
      // zzz414 — fall back to deriving the quarter-end from the Screener
      // quarter label when the enrich payload predates the enrich-side fix
      // (cached entries) or came from a source that only sets the label.
      latest_quarter_end_iso: e.latest_quarter_end_iso ?? _isoFromQuarterLabel(e.latest_quarter_label),
            announce_date_iso: e.announce_date_iso,
      financials_source: e.financials_source,
    };
    const g = gradeRow(row);
    if (g) graded.push(g);
  }

  const by_tier: Record<EarningsTier, ParsedEarning[]> = { BLOCKBUSTER: [], STRONG: [], MIXED: [], AVOID: [] };
  for (const g of graded) by_tier[g.tier].push(g);
  for (const t of TIER_ORDER) by_tier[t].sort((a, b) => b.composite_score - a.composite_score);

  // PATCH 0358 + 0359 — compute how many tickers got REAL financials with
  // YoY data attached (not just preview-shape cards). Previously this only
  // checked sales_curr_cr/pat_curr_cr presence which let preview cards
  // (sales_curr_cr=null, but hub_quality stamped) leak into the "updated"
  // count, producing the lying "Updated 11/11" message while the UI showed
  // 11 preview cards. New criterion mirrors what the user sees on screen:
  // YoY data present = real financials = counted as populated.
  const populated = graded.filter(g =>
    g.sales_yoy_pct != null || g.net_profit_yoy_pct != null || g.eps_yoy_pct != null
  ).length;
  const failedTickers = dayList
    .filter((m: any) => {
      const e = enrich[m.ticker];
      return !e || (
        e.sales_yoy_pct == null && e.pat_yoy_pct == null && e.eps_yoy_pct == null
      );
    })
    .map((m: any) => m.ticker);

  const payload = {
    filing_date: date,
    candidates_total: graded.length,
    raw_items_total: dayList.length,
    by_tier,
    generated_at: new Date().toISOString(),
    sources_polled: 2,
    _cache: 'miss',
    _refresh: `${populated}/${dayList.length} updated`,
    _attempted_tickers: dayList.map((m: any) => m.ticker),
    _failed_tickers: failedTickers,
    // PATCH 0909 — propagate hub failure flag if applicable (live-NSE saved us)
    ...(hubFailReason ? { _hub_fail: hubFailReason } : {}),
  };

  // Cache: past dates 90 days (immutable), today 15 min
  // PATCH 0909 — Don't cache payloads built without the hub. Live-NSE is a
  // subset of what the hub knows, so caching this would lock out the
  // complete view once the hub recovers.
  if (isRedisAvailable() && !hubFailReason) {
    const ttl = isPast ? 365 * 24 * 3600 : 5 * 60;
    // PATCH 1002 — guard final cache write too. If the new payload graded
    // ZERO tickers but a cached version had entries, preserve the cache.
    try {
      const _t = (payload as any).by_tier;
      const _gradedCount = (_t?.BLOCKBUSTER?.length || 0)
                         + (_t?.STRONG?.length || 0)
                         + (_t?.MIXED?.length || 0)
                         + (_t?.AVOID?.length || 0);
      let _skipWrite = false;
      if (_gradedCount === 0) {
        const _prior: any = await kvGet(cacheKey);
        if (_prior?.by_tier) {
          const _priorN = (_prior.by_tier.BLOCKBUSTER?.length || 0)
                        + (_prior.by_tier.STRONG?.length || 0)
                        + (_prior.by_tier.MIXED?.length || 0)
                        + (_prior.by_tier.AVOID?.length || 0);
          if (_priorN > 0) {
            _skipWrite = true;
            console.log(`[graded] PATCH 1002: final write blocked — payload empty but cache has ${_priorN} entries`);
          }
        }
      }
      if (!_skipWrite) await kvSet(cacheKey, payload, ttl);
    } catch {}
  }

  return NextResponse.json(payload, { headers: { 'Cache-Control': hubFailReason ? 'no-store' : 's-maxage=300, stale-while-revalidate=900' } });
}

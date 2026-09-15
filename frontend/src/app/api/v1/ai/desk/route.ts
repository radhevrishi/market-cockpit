// ═══════════════════════════════════════════════════════════════════════════
// THE AI RESEARCH DESK  (zzz611)
//
//   Deterministic engine  →  top candidates  →  Structural  →  Why Now
//   →  Bear case  →  composite  →  ranked  →  every prediction recorded
//
// The pipeline runs in that order for a reason. The expensive, fallible layer
// is applied LAST and only to names the filings have already qualified, so the
// AI is never asked to find an opportunity — only to interpret one the engine
// found. A model asked to search will always return something.
//
// COST AND SPEED ARE STRUCTURAL, NOT INCIDENTAL
// An assessment is keyed to the accession number and a filed quarter never
// changes, so the desk is one Redis read per name after the first pass. Only
// genuinely new filings cost a call, and they are made two at a time — the
// lesson already paid for on the earnings sweep is that unbounded parallelism
// buys nothing and loses everything.
//
//   GET /api/v1/ai/desk?days=10&limit=12
//   GET /api/v1/ai/desk?tickers=OOMA,BOX          (explicit, for verification)
//   &cache_only=1   → assess nothing, return only what is already interpreted
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { windowSessions } from '@/lib/us-merge';
import { releaseDocument, htmlToText } from '@/lib/us-guidance';
import {
  assessCompany, readAssessment, compositeScore, AI_ANALYST_VERSION,
  type AnalystInput, type AiAssessment,
} from '@/lib/ai-analyst';
import { recordPrediction, ledgerId } from '@/lib/ai-ledger';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Three, not two. Each assessment is one bounded API call with no shared rate
// limit behind it (unlike the SEC sweep), so three keeps a twelve-name deck
// inside a minute while staying well short of anything that could pile up.
const ASSESS_CONCURRENCY = 3;

function etToday(): string {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
    .toISOString().slice(0, 10);
}

const n1 = (v: any): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pct = (v: any) => (n1(v) == null ? null : `${(v as number) >= 0 ? '+' : ''}${(v as number).toFixed(1)}%`);
const musd = (v: any) => {
  const x = n1(v); if (x == null) return null;
  return Math.abs(x) >= 1000 ? `$${(x / 1000).toFixed(2)}B` : `$${x.toFixed(1)}M`;
};

/**
 * Render the engine's numbers as labelled lines.
 *
 * Deliberately NOT the raw row as JSON. A labelled line states the unit and
 * what was measured, so the model cannot quietly read a millions figure as
 * billions or a margin as a growth rate — and every line here is a figure the
 * engine computed from XBRL, never one the model may recompute.
 */
function factsFrom(r: any): string[] {
  const f: string[] = [];
  const push = (label: string, v: string | null | undefined) => { if (v) f.push(`${label}: ${v}`); };
  push('Tier assigned by the engine', r.tier);
  push('Engine composite score (0-100)', n1(r.composite_score) != null ? String(r.composite_score) : null);
  push('Revenue this quarter', musd(r.revenue_curr_musd));
  push('Revenue year-ago quarter', musd(r.revenue_prev_musd));
  push('Revenue YoY', pct(r.sales_yoy_pct));
  push('EPS (GAAP) this quarter', n1(r.eps_curr) != null ? `$${r.eps_curr.toFixed(2)}` : null);
  push('EPS (GAAP) year-ago', n1(r.eps_prev) != null ? `$${r.eps_prev.toFixed(2)}` : null);
  push('EPS YoY', pct(r.eps_yoy_pct));
  push('Adjusted EPS this quarter', n1(r.eps_adj_curr) != null ? `$${r.eps_adj_curr.toFixed(2)}` : null);
  push('Adjusted EPS YoY', pct(r.eps_adj_yoy_pct));
  push('Street EPS estimate', n1(r.eps_estimate) != null ? `$${r.eps_estimate.toFixed(2)}` : null);
  push('Operating margin', n1(r.opm_pct) != null ? `${r.opm_pct.toFixed(1)}%` : null);
  push('Operating margin year-ago', n1(r.opm_prev_pct) != null ? `${r.opm_prev_pct.toFixed(1)}%` : null);
  push('Cash flow from operations', musd(r.cfo_curr_musd));
  push('CFO to net income ratio', n1(r.cfo_to_pat_ratio) != null ? r.cfo_to_pat_ratio.toFixed(2) : null);
  push('Free cash flow', musd(r.fcf_curr_musd));
  push('Free cash flow year-ago', musd(r.fcf_prev_musd));
  push('Market capitalisation', musd(r.market_cap_musd));
  push('P/E', n1(r.pe) != null ? String(r.pe) : null);
  push('Share price reaction on the day after the print', pct(r.d1_pct));
  push('Move since the print', pct(r.move_pct));
  push('Post-earnings-drift score the engine assigned (0-100)', n1(r.pead_score) != null ? String(r.pead_score) : null);
  push('Relative strength rating (0-100)', n1(r.rs_rating) != null ? String(r.rs_rating) : null);
  push('Stage (1 base, 2 advance, 3 top, 4 decline)', n1(r.stage) != null ? String(r.stage) : null);
  push('Percent below the 52-week high', pct(r.pct_from_52w_high));
  return f;
}

function seriesFrom(r: any): string[] {
  const out: string[] = [];
  const ends: string[] = r?.series?.ends || [];
  const line = (label: string, arr: any[], fmt: (v: any) => string) => {
    if (!Array.isArray(arr) || !arr.length) return;
    const parts: string[] = [];
    for (let i = Math.max(0, arr.length - 9); i < arr.length; i++) {
      if (arr[i] == null) continue;
      parts.push(`${ends[i] || `t-${arr.length - 1 - i}`}=${fmt(arr[i])}`);
    }
    if (parts.length >= 3) out.push(`${label}: ${parts.join('  ')}`);
  };
  line('Revenue by quarter (US$m)', r?.series?.revenue || [], (v) => Number(v).toFixed(1));
  line('EPS by quarter (US$)', r?.series?.eps || [], (v) => Number(v).toFixed(2));
  line('Operating income by quarter (US$m)', r?.series?.operating_income || [], (v) => Number(v).toFixed(1));
  line('Cash from operations by quarter (US$m)', r?.series?.cfo || [], (v) => Number(v).toFixed(1));
  return out;
}

function caveatsFrom(r: any): string[] {
  const c: string[] = [];
  for (const t of (r.caveat_tags || [])) c.push(String(t));
  for (const o of (r.one_offs || [])) if (o?.label) c.push(`One-off found in the release: ${o.label}`);
  for (const o of (r.abs_one_offs || [])) if (o?.label) c.push(`One-off stated in dollars: ${o.label}`);
  if (r.eps_basis_note) c.push(String(r.eps_basis_note));
  return c.slice(0, 12);
}

// ═══ INDIA  (zzz622) ══════════════════════════════════════════════════════
//
// The desk was US-only because the US grader is the one that speaks XBRL. The
// India grader produces the same SHAPE of judgement from Screener/NSE — tier,
// composite, YoY pairs, reaction, stage, RS — in crore rather than millions,
// so the interpretation layer needs no change at all: only the fact sheet
// handed to it does. The unit is stated on every line for the same reason the
// US one states it — a model that silently reads crore as millions is a model
// producing confident nonsense.
const cr = (v: any) => (n1(v) == null ? null : `₹${(v as number).toLocaleString('en-IN')} crore`);

function factsFromIndia(r: any): string[] {
  const f: string[] = [];
  const push = (label: string, v: string | null | undefined) => { if (v) f.push(`${label}: ${v}`); };
  push('Tier assigned by the engine', r.tier);
  push('Engine composite score (0-100)', n1(r.composite_score) != null ? String(r.composite_score) : null);
  push('Revenue this quarter', cr(r.sales_curr_cr));
  push('Revenue year-ago quarter', cr(r.sales_prev_cr));
  push('Revenue YoY', pct(r.sales_yoy_pct));
  push('Net profit this quarter', cr(r.pat_curr_cr));
  push('Net profit year-ago quarter', cr(r.pat_prev_cr));
  push('Net profit YoY', pct(r.net_profit_yoy_pct));
  push('EPS this quarter', n1(r.eps_curr) != null ? `₹${r.eps_curr.toFixed(2)}` : null);
  push('EPS year-ago', n1(r.eps_prev) != null ? `₹${r.eps_prev.toFixed(2)}` : null);
  push('EPS YoY', pct(r.eps_yoy_pct));
  push('Operating margin', n1(r.opm_pct) != null ? `${r.opm_pct.toFixed(1)}%` : null);
  push('Operating margin year-ago', n1(r.opm_prev_pct) != null ? `${r.opm_prev_pct.toFixed(1)}%` : null);
  push('Market capitalisation', cr(r.market_cap_cr));
  push('P/E', n1(r.pe) != null ? String(r.pe) : null);
  push('Gap on the open after the print', pct(r.gap_pct));
  push('Share price reaction on the day after the print', pct(r.d1_pct));
  push('Move since the print', pct(r.move_pct));
  push('Relative strength rating (0-100)', n1(r.rs_rating) != null ? String(r.rs_rating) : null);
  push('Stage (1 base, 2 advance, 3 top, 4 decline)', n1(r.stage) != null ? String(r.stage) : null);
  push('Percent below the 52-week high', pct(r.pct_from_52w_high));
  return f;
}

function seriesFromIndia(r: any): string[] {
  const out: string[] = [];
  const line = (label: string, arr: any[], fmt: (v: any) => string) => {
    if (!Array.isArray(arr) || arr.length < 3) return;
    const parts = arr.slice(-9).filter((v) => v != null).map((v, i) => `q-${arr.slice(-9).length - 1 - i}=${fmt(v)}`);
    if (parts.length >= 3) out.push(`${label} (oldest first): ${arr.slice(-9).filter((v) => v != null).map(fmt).join('  ')}`);
  };
  line('Revenue by quarter (₹ crore)', r?.quarters_sales || [], (v) => Number(v).toFixed(0));
  line('Net profit by quarter (₹ crore)', r?.quarters_pat || [], (v) => Number(v).toFixed(0));
  line('EPS by quarter (₹)', r?.quarters_eps || [], (v) => Number(v).toFixed(2));
  return out;
}

/** Calendar sessions for India — companies file on weekends here, so the US
 *  trading-session window would silently drop a chunk of every quarter. */
function indiaSessions(today: string, days: number): string[] {
  const out: string[] = [];
  const d = new Date(today + 'T00:00:00Z');
  for (let i = 0; i < days; i++) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() - 1); }
  return out;
}

function istToday(): string {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
    .toISOString().slice(0, 10);
}

function guidanceFrom(r: any): string | null {
  const g = r.guidance;
  const bits: string[] = [];
  if (typeof g === 'string' && g.trim()) bits.push(g.trim());
  for (const s of (r.guidance_snippets || []).slice(0, 6)) if (typeof s === 'string') bits.push(s);
  for (const f of (r.guidance_figures || []).slice(0, 10)) {
    if (f?.label) bits.push(`${f.label}${f.low != null ? `: ${f.low}${f.high != null && f.high !== f.low ? `–${f.high}` : ''}` : ''}`);
  }
  return bits.length ? bits.join('\n') : null;
}

export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const explicit = (u.searchParams.get('tickers') || '').trim();
  const cacheOnly = u.searchParams.get('cache_only') === '1';
  const force = u.searchParams.get('force') === '1';
  const days = Math.min(30, Math.max(1, parseInt(u.searchParams.get('days') || '10', 10) || 10));
  const limit = Math.min(30, Math.max(1, parseInt(u.searchParams.get('limit') || '12', 10) || 12));
  const region = (u.searchParams.get('region') === 'india' ? 'india' : 'us') as 'us' | 'india';
  const port = process.env.PORT;
  const self = port ? `http://127.0.0.1:${port}` : u.origin;

  // ═══ THE DECK ITSELF IS CACHED  (zzz622) ══════════════════════════════════
  //
  // Every assessment was already keyed to its accession, so no filing was ever
  // re-read by the model. What was NOT cached was the ASSEMBLY around them —
  // and that was most of the work. Each visit re-walked thirty graded sessions
  // one after another, re-read every assessment out of Redis one key at a
  // time, and re-wrote a ledger entry for every name whether or not anything
  // had changed. Opening the tab twice in a minute did all of it twice, which
  // is exactly what it felt like from the outside.
  //
  // The deck is a pure function of (region, window, limit, analyst version,
  // today) — a filed quarter never changes and the window only moves when the
  // date does — so it is cached whole. A revisit is now one Redis read.
  // ↻ Refresh (refresh=1) and an explicit ticker list always bypass it, so
  // nothing is ever stuck behind the cache.
  const deckKey = `ai-desk:v2:${region}:${days}:${limit}:${AI_ANALYST_VERSION}:${region === 'india' ? istToday() : etToday()}`;
  const wantsFresh = force || u.searchParams.get('refresh') === '1';
  //
  // Two shapes are cached under two keys, and the distinction matters. A
  // cache_only pass (what the tab does on open) deliberately interprets
  // nothing, so its deck may be mostly un-interpreted rows; writing that over
  // the full deck would hide real work for half an hour. So a cache_only pass
  // PREFERS the full deck if one exists and only falls back to — and only ever
  // writes — its own key.
  const deckKeyCO = `${deckKey}:co`;
  if (!explicit && !wantsFresh && isRedisAvailable()) {
    try {
      const hit = (await kvGet<any>(deckKey)) || (cacheOnly ? await kvGet<any>(deckKeyCO) : null);
      if (hit?.rows) return NextResponse.json({ ...hit, from_deck_cache: true }, { headers: { 'Cache-Control': 'no-store' } });
    } catch { /* a cold or failing cache just means we build it */ }
  }

  // ── 1. the deterministic candidates ──────────────────────────────────────
  // Read straight from the graded engine, through its own cache. `cache_only`
  // guarantees the desk never triggers a ten-minute EDGAR sweep on a reader's
  // clock: a session that is not yet graded is simply not in today's deck, and
  // the deck says so.
  let rows: any[] = [];
  const sessionsAsked: string[] = [];
  const sessionsPending: string[] = [];
  // India grades off Screener/NSE through its own endpoint; the shape of the
  // answer (by_tier of graded cards) is identical, which is the whole reason
  // one desk can serve both.
  const gradedBase = region === 'india' ? '/api/v1/earnings/graded' : '/api/v1/earnings/graded-us';
  try {
    if (explicit) {
      const res = await fetch(`${self}${gradedBase}?tickers=${encodeURIComponent(explicit)}`, { cache: 'no-store' });
      const j: any = await res.json();
      for (const t of ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID']) rows.push(...(j?.by_tier?.[t] || []));
    } else {
      const sessions = region === 'india' ? indiaSessions(istToday(), days) : windowSessions(etToday(), days);
      sessions.forEach((d) => sessionsAsked.push(d));
      // ── READ THE SESSIONS IN PARALLEL ────────────────────────────────────
      // These are cache-only reads of days that are already built; running
      // them one after another made the desk's latency the SUM of thirty
      // round-trips for no benefit whatsoever. Six at a time is well inside
      // what a loopback to our own process handles, and the order of the
      // results does not matter because everything is re-sorted below.
      const SESSION_CONCURRENCY = 6;
      const bucket: any[][] = [];
      let si = 0;
      await Promise.all(Array.from({ length: SESSION_CONCURRENCY }, async () => {
        while (si < sessions.length) {
          const d = sessions[si++];
          const q = region === 'india'
            ? `${gradedBase}?date=${d}&cache_only=1`
            : `${gradedBase}?date=${d}&days=1&cache_only=1`;
          try {
            const res = await fetch(`${self}${q}`, { cache: 'no-store' });
            if (!res.ok) { sessionsPending.push(d); continue; }
            const j: any = await res.json();
            if (!j?.by_tier) { sessionsPending.push(d); continue; }
            // Only the tiers the engine already vouches for reach the AI layer.
            bucket.push([...(j.by_tier.BLOCKBUSTER || []), ...(j.by_tier.STRONG || [])]);
          } catch { sessionsPending.push(d); }
        }
      }));
      for (const b of bucket) rows.push(...b);
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: `Could not read the graded engine (${String(e?.message || e)}).` }, { status: 200 });
  }

  // Newest filing first, best engine score first, one row per ticker.
  const seen = new Set<string>();
  const candidates = rows
    .filter((r) => r?.ticker && !seen.has(r.ticker) && (seen.add(r.ticker), true))
    .sort((a, b) => (b.composite_score ?? 0) - (a.composite_score ?? 0) || String(b.filing_date).localeCompare(String(a.filing_date)))
    .slice(0, limit);

  // ── 2. interpret ─────────────────────────────────────────────────────────
  const out: any[] = [];
  let assessed = 0, cached = 0, failed = 0;
  const notes: string[] = [];

  const work = async (r: any) => {
    // The assessment key. In the US it is the SEC accession number, which is
    // the one identifier that cannot change once a quarter is filed. India has
    // no accession, so ticker+filing date plays the same role: it is unique per
    // print and equally immutable once the print exists.
    const accession = region === 'india'
      ? `IN:${r.ticker}:${String(r.filing_date || '')}`
      : (r?.filing_docs?.accession || null);
    let a: AiAssessment | null = await readAssessment(r.ticker, accession);
    let err: string | undefined;
    let fresh = false;
    if (a && !force) { cached++; }
    else if (cacheOnly) { a = null; }
    else {
      // The release text, when there is one. The engine's numbers carry the
      // quarter; the release carries the WHY, which is the only place a
      // structural change is ever actually described.
      let release: string | null = null;
      if (region === 'us') {
        try {
          const cik = r?.filing_docs?.cik;
          if (cik && accession) {
            const doc = await releaseDocument(cik, accession, r.filing_url);
            if (doc?.html) { const t = htmlToText(doc.html); if (t && t.length > 800) release = t; }
          }
        } catch { /* the numbers alone still support an assessment */ }
      } else if (typeof r.narrative === 'string' && r.narrative.length > 40) {
        // India has no 8-K equivalent to fetch, so the engine's own narrative
        // is what carries the qualitative half. It is stated as engine output,
        // never as a company statement, so the model does not treat it as a
        // primary source.
        release = `The engine's own summary of this print (not a company statement): ${r.narrative}`;
      }
      const inp: AnalystInput = {
        ticker: r.ticker, company: r.company || r.ticker, accession,
        quarter: r.quarter || null, sector: r.sector || null,
        facts: region === 'india' ? factsFromIndia(r) : factsFrom(r),
        caveats: caveatsFrom(r),
        guidance: guidanceFrom(r),
        series: region === 'india' ? seriesFromIndia(r) : seriesFrom(r),
        release,
      };
      const res = await assessCompany(inp, { force });
      a = res.assessment; err = res.error;
      if (a) { assessed++; fresh = true; } else { failed++; if (err && !notes.includes(err)) notes.push(err); }
    }

    const comp = compositeScore(r.composite_score ?? 0, a);
    // ── THE LEDGER IS WRITTEN ONCE, WHEN THE CALL IS MADE ────────────────
    // It used to be re-written on every page load for every cached name.
    // The write is idempotent so nothing was corrupted, but it meant a deck
    // of twelve cost twelve pointless round-trips each time the tab opened —
    // a large part of what made revisiting the desk feel like it was redoing
    // its whole job. A prediction that already exists needs no re-recording.
    if (a && fresh) {
      // THE PREDICTION IS RECORDED AT THE MOMENT IT IS MADE, not when the
      // reader happens to look. Written once and never rewritten.
      void recordPrediction({
        id: ledgerId(r.ticker, accession, String(r.filing_date || '')),
        ticker: r.ticker, company: r.company || null,
        filing_date: String(r.filing_date || ''), accession,
        price_at: n1(r.price), bench_at: null,
        // zzz638 — BOTH OF THESE USED TO SAY 'SPY' AND A BARE TICKER, for
        // Indian filings as much as US ones. An NSE small-cap's excess return
        // was therefore going to be measured against the S&P 500, and its own
        // price fetched as whatever American listing shares those letters.
        // Every Indian row in the ledger was unmarkable-but-plausible, which is
        // the worst state a record can be in.
        bench_symbol: region === 'india' ? '^NSEI' : 'SPY',
        price_symbol: region === 'india'
          ? (/\.(NS|BO)$/i.test(r.ticker) ? r.ticker : `${r.ticker}.NS`)
          : r.ticker,
        tier: r.tier || null, engine_score: n1(r.composite_score),
        pead: n1(r.pead_score), rs: n1(r.rs_rating),
        sales_yoy: n1(r.sales_yoy_pct), eps_yoy: n1(r.eps_yoy_pct),
        guidance_raised: /raise/i.test(String(r.guidance || '')) || (r.caveat_tags || []).some((t: string) => /guidance raised/i.test(t)),
        structural_score: a.structural_score, change_type: a.change_type,
        why_now_score: a.why_now_score, bear_severity: a.bear_severity,
        confidence: a.confidence, composite: comp.score,
      }).catch(() => {});
    }

    out.push({
      ticker: r.ticker, company: r.company, sector: r.sector, quarter: r.quarter,
      filing_date: r.filing_date, tier: r.tier, price: n1(r.price),
      engine_score: n1(r.composite_score), pead: n1(r.pead_score), rs: n1(r.rs_rating),
      sales_yoy_pct: n1(r.sales_yoy_pct), eps_yoy_pct: n1(r.eps_yoy_pct),
      net_profit_yoy_pct: n1(r.net_profit_yoy_pct),
      opm_pct: n1(r.opm_pct), cfo_to_pat_ratio: n1(r.cfo_to_pat_ratio),
      d1_pct: n1(r.d1_pct), market_cap_musd: n1(r.market_cap_musd),
      market_cap_cr: n1(r.market_cap_cr), region,
      filing_url: r.filing_url || null,
      caveat_tags: r.caveat_tags || [],
      ai: a, ai_error: a ? undefined : err,
      composite: comp.score, composite_parts: comp.parts,
    });
  };

  let next = 0;
  await Promise.all(Array.from({ length: ASSESS_CONCURRENCY }, async () => {
    while (next < candidates.length) await work(candidates[next++]);
  }));

  // ── INTERPRETED ROWS RANK FIRST  (zzz617) ────────────────────────────────
  //
  // Sorting purely by composite put the UNINTERPRETED names at the top, because
  // a row with no assessment scores its raw engine grade while an interpreted
  // one has already had the bear-case drag taken off it. So a deck where the AI
  // had done real work opened with nine rows reading "Not interpreted yet" above
  // the three it had actually analysed — the page looked like the analyst had
  // never run, and the composite column was comparing two different things as
  // though they were one.
  //
  // Interpreted and un-interpreted are therefore different populations, ranked
  // separately and labelled separately. A number that has been through the bear
  // case is never sorted against one that has not.
  out.sort((a, b) => {
    const ai = a.ai ? 1 : 0, bi = b.ai ? 1 : 0;
    if (ai !== bi) return bi - ai;
    return (b.composite ?? 0) - (a.composite ?? 0);
  });

  const payload = {
    ok: true,
    region,
    analyst_version: AI_ANALYST_VERSION,
    window_days: days,
    candidates_considered: candidates.length,
    assessed, cached, failed,
    sessions_pending: sessionsPending,
    notes,
    rows: out,
    generated_at: new Date().toISOString(),
  };
  // Cached for half an hour. Short enough that a freshly graded session shows
  // up on its own; long enough that reopening the tab costs one Redis read
  // instead of re-walking the whole window. Never cached for an explicit
  // ticker list — that request is a verification, and it must always run.
  if (!explicit && isRedisAvailable()) {
    try { await kvSet(cacheOnly ? deckKeyCO : deckKey, payload, 30 * 60); } catch { /* best effort */ }
  }
  return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
}

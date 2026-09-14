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
  const port = process.env.PORT;
  const self = port ? `http://127.0.0.1:${port}` : u.origin;

  // ── 1. the deterministic candidates ──────────────────────────────────────
  // Read straight from the graded engine, through its own cache. `cache_only`
  // guarantees the desk never triggers a ten-minute EDGAR sweep on a reader's
  // clock: a session that is not yet graded is simply not in today's deck, and
  // the deck says so.
  let rows: any[] = [];
  const sessionsAsked: string[] = [];
  const sessionsPending: string[] = [];
  try {
    if (explicit) {
      const res = await fetch(`${self}/api/v1/earnings/graded-us?tickers=${encodeURIComponent(explicit)}`, { cache: 'no-store' });
      const j: any = await res.json();
      for (const t of ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID']) rows.push(...(j?.by_tier?.[t] || []));
    } else {
      const sessions = windowSessions(etToday(), days);
      for (const d of sessions) {
        sessionsAsked.push(d);
        const res = await fetch(`${self}/api/v1/earnings/graded-us?date=${d}&days=1&cache_only=1`, { cache: 'no-store' });
        if (!res.ok) { sessionsPending.push(d); continue; }
        const j: any = await res.json();
        if (!j?.by_tier) { sessionsPending.push(d); continue; }
        // Only the tiers the engine already vouches for reach the AI layer.
        rows.push(...(j.by_tier.BLOCKBUSTER || []), ...(j.by_tier.STRONG || []));
      }
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
    const accession = r?.filing_docs?.accession || null;
    let a: AiAssessment | null = await readAssessment(r.ticker, accession);
    let err: string | undefined;
    if (a && !force) { cached++; }
    else if (cacheOnly) { a = null; }
    else {
      // The release text, when there is one. The engine's numbers carry the
      // quarter; the release carries the WHY, which is the only place a
      // structural change is ever actually described.
      let release: string | null = null;
      try {
        const cik = r?.filing_docs?.cik;
        if (cik && accession) {
          const doc = await releaseDocument(cik, accession, r.filing_url);
          if (doc?.html) { const t = htmlToText(doc.html); if (t && t.length > 800) release = t; }
        }
      } catch { /* the numbers alone still support an assessment */ }
      const inp: AnalystInput = {
        ticker: r.ticker, company: r.company || r.ticker, accession,
        quarter: r.quarter || null, sector: r.sector || null,
        facts: factsFrom(r), caveats: caveatsFrom(r),
        guidance: guidanceFrom(r), series: seriesFrom(r), release,
      };
      const res = await assessCompany(inp, { force });
      a = res.assessment; err = res.error;
      if (a) assessed++; else { failed++; if (err && !notes.includes(err)) notes.push(err); }
    }

    const comp = compositeScore(r.composite_score ?? 0, a);
    if (a) {
      // THE PREDICTION IS RECORDED AT THE MOMENT IT IS MADE, not when the
      // reader happens to look. Written once and never rewritten.
      void recordPrediction({
        id: ledgerId(r.ticker, accession, String(r.filing_date || '')),
        ticker: r.ticker, company: r.company || null,
        filing_date: String(r.filing_date || ''), accession,
        price_at: n1(r.price), bench_at: null, bench_symbol: 'SPY',
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
      opm_pct: n1(r.opm_pct), cfo_to_pat_ratio: n1(r.cfo_to_pat_ratio),
      d1_pct: n1(r.d1_pct), market_cap_musd: n1(r.market_cap_musd),
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

  return NextResponse.json({
    ok: true,
    analyst_version: AI_ANALYST_VERSION,
    window_days: days,
    candidates_considered: candidates.length,
    assessed, cached, failed,
    sessions_pending: sessionsPending,
    notes,
    rows: out,
    generated_at: new Date().toISOString(),
  }, { headers: { 'Cache-Control': 'no-store' } });
}

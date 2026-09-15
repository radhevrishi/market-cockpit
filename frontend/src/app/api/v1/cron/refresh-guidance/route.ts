// ═══════════════════════════════════════════════════════════════════════════
// THE INDIA GUIDANCE OVERLAY.  (zzz669)
//
// WHY THIS EXISTS.
//
// The India grader has scanned for forward guidance since the day it was
// written. It reads six fields — `guidance_text`, `narrative_text`,
// `announcement_text`, `attachment`, `headline`, `title` — against a list of
// patterns (capacity expansion, order book, margin expansion, guidance raised…)
// and sets `positiveGuidance` when two or more match.
//
// NOTHING IN THE PIPELINE HAS EVER POPULATED ANY OF THOSE FIELDS. A repo-wide
// search finds no producer. So the scan ran on an empty string every time,
// `positiveGuidance` was permanently false, and BLOCKBUSTER Path A's guidance
// alternative — `(tier1MethodCount >= 1 || positiveGuidance)` — quietly
// collapsed to the method-tag half alone. The quadrant's 15-point guidance leg
// was never scored either. The client page even admits it in a comment:
// "Server `guidance` field is preferred when present (it currently isn't…)".
//
// Meanwhile this codebase contains a WORKING concall-intelligence pipeline —
// fed by the same Cloudflare Worker that reads NSE filings, already on a cron,
// already scoring each filing for bullish content and already emitting
// `has_concrete_guidance` per filing. It was simply never connected to the
// thing that grades earnings.
//
// This route is that connection. It collapses the scored concall feed to one
// row per symbol and writes an overlay the grader can read in a single lookup.
//
// WHY AN OVERLAY AND NOT A CALL FROM THE GRADER. Grading a session already
// fans out to Screener, NSE and the price feeds under a 55-second budget. A
// per-row guidance fetch would be the slowest thing in it, and the first to
// time out. One blob, refreshed on a cron, costs the grader one read.
//
// SAFETY. Additive. A symbol missing from the overlay behaves exactly as every
// symbol behaves today — no guidance, `positiveGuidance` false. If this route
// never runs, nothing changes anywhere.
//
//   KV  india-guidance:v1:latest
//   { generatedAt, count, symbols: { RELIANCE: { raised, cut, concrete, tags, subject, at } } }
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';
import { verifyCronSecret } from '@/lib/verifyAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const OUT_KEY = 'india-guidance:v1:latest';
const TTL_S = 10 * 24 * 60 * 60;     // ten days — comfortably longer than the cadence
/** How far back to read the concall feed. A filing's guidance stays relevant
 *  well past the day it was made, and the grader looks up by symbol, not date. */
const FEED_DAYS = 30;

/** Raise / cut lexicons. Deliberately STRICTER than the grader's original
 *  pattern list: that one counted "confident" and "tailwind" — tone, not a
 *  number — and tone is what makes a guidance signal worthless. A raise is a
 *  statement about what the company will do, not how it feels about it. */
const RAISE = [
  /\bguidance\s+(?:has\s+been\s+)?(?:rais|revis\w*\s+upward|increas)/i,
  /\b(?:rais\w*|increas\w*|upgrad\w*)\s+(?:our\s+|the\s+|its\s+|full[- ]year\s+|FY\s?\d{2}\s?)*(?:guidance|outlook|target|forecast)/i,
  /\border\s+book\s+(?:at\s+)?(?:an?\s+)?(?:all[- ]time\s+high|record)/i,
  /\brecord\s+(?:order\s+(?:book|inflow)|revenue|quarter)\b/i,
  /\bcapacity\s+expansion\b.*\b(?:commission|complet|on\s+track|ahead\s+of)/i,
  /\b(?:commission\w*|commenc\w*)\s+(?:the\s+)?(?:new\s+)?(?:plant|line|facility|capacity)\b/i,
];
const CUT = [
  /\bguidance\s+(?:has\s+been\s+)?(?:cut|lower\w*|revis\w*\s+down|reduc\w*|withdraw\w*)/i,
  /\b(?:lower\w*|reduc\w*|trimm\w*|cut\w*)\s+(?:our\s+|the\s+|its\s+|full[- ]year\s+)*(?:guidance|outlook|target|forecast)/i,
  /\bdemand\s+(?:weak|soft|slowdown|moderat)/i,
  /\bmargin\s+(?:pressure|compress|headwind)/i,
  /\bdefer\w*\s+(?:the\s+)?(?:capex|expansion|commissioning)\b/i,
];

const hits = (text: string, pats: RegExp[]) => pats.filter((p) => p.test(text)).length;

export async function GET(req: Request) {
  const auth = verifyCronSecret(req, { requireSecret: true });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason },
      { status: auth.reason.includes('not configured') ? 503 : 401 });
  }

  // Read the concall feed through its own cache. Self-fetch over loopback,
  // because Railway's edge refuses a container calling its own public URL —
  // the failure mode this codebase has hit five separate times.
  const port = process.env.PORT || '3000';
  const url = `http://127.0.0.1:${port}/api/v1/concall-intel/live-feed?days=${FEED_DAYS}`;
  let payload: any = null;
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(90_000) });
    if (res.ok) payload = await res.json();
  } catch { payload = null; }

  const filings: any[] = Array.isArray(payload?.filings) ? payload.filings : [];
  if (!filings.length) {
    // NEVER REPLACE A GOOD OVERLAY WITH AN EMPTY ONE. A feed that answered
    // nothing is an outage, not a market with no guidance in it.
    const prior = await kvGet<any>(OUT_KEY);
    return NextResponse.json({
      ok: true, wrote: false, kept_prior: !!prior,
      prior_count: Object.keys(prior?.symbols || {}).length,
      note: 'the concall feed returned no filings — the existing overlay was left untouched',
    });
  }

  const symbols: Record<string, any> = {};
  for (const f of filings) {
    const sym = String(f?.symbol || '').toUpperCase();
    if (!sym) continue;
    // Every piece of text this filing carries, scanned together. The subject
    // alone is usually administrative; the scored excerpts are where a company
    // actually says what it expects.
    const text = [
      f.subject, f.headline, f.summary, f.excerpt,
      ...(Array.isArray(f.evidence_excerpts) ? f.evidence_excerpts : []),
      ...(Array.isArray((f as any).bullish_excerpts) ? (f as any).bullish_excerpts : []),
    ].filter(Boolean).join(' \n ');
    if (!text.trim()) continue;

    const raisedHits = hits(text, RAISE);
    const cutHits = hits(text, CUT);
    const concrete = !!f.has_concrete_guidance;
    const tags: string[] = Array.isArray(f.positive_tags) ? f.positive_tags : [];

    // TWO INDEPENDENT SIGNALS, not one. A single pattern is a turn of phrase;
    // two is a company describing something it has committed to. `concrete`
    // counts as one of them because the concall scorer earned it separately.
    const raised = (raisedHits + (concrete ? 1 : 0)) >= 2 && cutHits === 0;
    const cut = cutHits >= 2 || (cutHits >= 1 && /guidance/i.test(text) && raisedHits === 0);

    const at = String(f.filing_datetime || f.filing_date || '');
    const prior = symbols[sym];
    // Newest filing per symbol wins; a raise and a cut in the same window is
    // resolved by date, not by optimism.
    if (prior && String(prior.at) >= at) continue;
    symbols[sym] = {
      raised, cut, concrete, tags: tags.slice(0, 6),
      subject: String(f.subject || '').slice(0, 180),
      at,
    };
  }

  const out = {
    generatedAt: new Date().toISOString(),
    feed_days: FEED_DAYS,
    count: Object.keys(symbols).length,
    raised: Object.values(symbols).filter((x: any) => x.raised).length,
    cut: Object.values(symbols).filter((x: any) => x.cut).length,
    symbols,
  };
  await kvSet(OUT_KEY, out, TTL_S);

  return NextResponse.json({
    ok: true, wrote: true,
    filings_read: filings.length,
    ...{ count: out.count, raised: out.raised, cut: out.cut },
    generatedAt: out.generatedAt,
  });
}

export async function POST(req: Request) { return GET(req); }

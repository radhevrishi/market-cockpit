// ═══════════════════════════════════════════════════════════════════════════
// WHAT IS WORTH WAKING SOMEONE UP FOR.                              (zzz675)
//
// One read-only endpoint answering a single question: which companies have
// filed recently, graded BLOCKBUSTER or STRONG, and pass the Quality Preset?
//
// It exists so that "preset-passing" has exactly ONE definition on the server
// side, shared with the chip in the UI (lib/quality-preset). Any alert channel
// — email, Telegram, a push — reads this and formats it. None of them gets to
// re-implement the filter, because every time this codebase has allowed two
// copies of a rule, the copies have drifted and the drift has shipped.
//
// DEDUP IS THE CALLER'S JOB, NOT THIS ROUTE'S. This endpoint is a pure view of
// the current state: ask it twice and it answers the same thing twice. A
// caller that sends messages keeps its own "already told him about this"
// record, because only the caller knows what it actually delivered. Making the
// read side stateful would mean a failed send silently consumed the alert.
//
// Read-only: no writes, no KV mutation, safe to call as often as you like.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { kvGet, isRedisAvailable } from '@/lib/kv';
import { gradedKeyCandidates } from '@/lib/graded-cache-key';
import { isAlertable } from '@/lib/quality-preset';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Calendar days back to scan. Kept small: an "alert" about a filing from last
 *  week is not an alert, it is a report, and the bench already serves those. */
const DEFAULT_DAYS = 3;
const MAX_DAYS = 14;

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const days = Math.min(MAX_DAYS, Math.max(1, Number(searchParams.get('days')) || DEFAULT_DAYS));

  if (!isRedisAvailable()) {
    return NextResponse.json(
      { ok: false, error: 'kv_unavailable', hits: [], scanned: [] },
      { status: 503 },
    );
  }

  const hits: any[] = [];
  const scanned: Array<{ date: string; key: string | null; rows: number; alertable: number }> = [];

  for (let i = 0; i < days; i++) {
    const date = isoDaysAgo(i);

    // Current namespace first, then the abandoned ones — the same tolerance
    // the bench uses, so the day a cache version ships this does not go blind.
    let payload: any = null;
    let usedKey: string | null = null;
    for (const k of gradedKeyCandidates(date)) {
      try {
        const v = await kvGet(k);
        if (v) {
          const parsed = typeof v === 'string' ? JSON.parse(v) : v;
          const n = Object.values(parsed?.by_tier || {}).reduce(
            (a: number, b: any) => a + (Array.isArray(b) ? b.length : 0), 0,
          );
          // A payload that parsed but holds nothing is not a usable answer —
          // fall through to the next namespace rather than reporting an empty
          // day, which is how a version bump would otherwise look like "no
          // earnings today".
          if (n > 0) { payload = parsed; usedKey = k; break; }
        }
      } catch { /* try the next namespace */ }
    }

    if (!payload) { scanned.push({ date, key: null, rows: 0, alertable: 0 }); continue; }

    const rows: any[] = Object.values(payload.by_tier || {}).flatMap((v: any) => (Array.isArray(v) ? v : []));
    const keep = rows.filter(isAlertable);
    scanned.push({ date, key: usedKey, rows: rows.length, alertable: keep.length });

    for (const r of keep) {
      hits.push({
        ticker: r.ticker,
        company: r.company,
        tier: r.tier,
        verdict: r.verdict ?? null,
        filing_date: r.filing_date ?? date,
        quarter: r.quarter ?? null,
        market_cap_cr: r.market_cap_cr ?? null,
        sales_yoy_pct: r.sales_yoy_pct ?? null,
        net_profit_yoy_pct: r.net_profit_yoy_pct ?? null,
        eps_yoy_pct: r.eps_yoy_pct ?? null,
        opm_delta_pp:
          typeof r.opm_pct === 'number' && typeof r.opm_prev_pct === 'number'
            ? Math.round((r.opm_pct - r.opm_prev_pct) * 10) / 10
            : null,
        cfo_to_pat_ratio: r.cfo_to_pat_ratio ?? null,
        pead_score: r.pead_score ?? null,
        composite_score: r.composite_score ?? null,
        fund_composite: r.fund_composite ?? null,   // zzz673
        setup_grade: r.setup_grade ?? null,         // zzz673
        caveat_tags: r.caveat_tags ?? [],
        // The stable identity a caller dedupes on. Ticker alone would suppress
        // the NEXT quarter's result for the same company; the filing date makes
        // each quarter its own event, while a re-grade of the same filing stays
        // one event and cannot be sent twice.
        alert_id: `${r.ticker}:${r.filing_date ?? date}`,
      });
    }
  }

  // Best first: BLOCKBUSTER over STRONG, then on the fundamentals-only score
  // rather than the blended one, because the blend still carries the chart.
  const rank = (t: string) => (t === 'BLOCKBUSTER' ? 2 : 1);
  hits.sort((a, b) =>
    rank(b.tier) - rank(a.tier) ||
    (b.fund_composite ?? b.composite_score ?? 0) - (a.fund_composite ?? a.composite_score ?? 0),
  );

  return NextResponse.json({
    ok: true,
    generated_at: new Date().toISOString(),
    days,
    count: hits.length,
    scanned,
    hits,
  });
}

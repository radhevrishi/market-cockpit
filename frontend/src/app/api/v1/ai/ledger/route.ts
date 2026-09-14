// ═══════════════════════════════════════════════════════════════════════════
// THE LEDGER ENDPOINT  (zzz611)
//
//   GET  /api/v1/ai/ledger              → the ledger, plus what it has learned
//   GET  /api/v1/ai/ledger?score=1      → mark every prediction that is due
//
// Marking is the whole point and it is deliberately boring: for each entry old
// enough to have a 7 / 30 / 90 / 180-day answer, fetch what the stock did from
// the filing date and what the benchmark did over the same window, and store
// the EXCESS. Absolute return would mark a signal correct for being long in a
// rising market, which is the most common way a backtest flatters itself.
//
// Outcomes are written once per horizon and never recomputed, so the ledger is
// a record rather than a rolling opinion.
//
// The `score=1` pass is safe to run from the existing cron bridge: it is
// idempotent, it skips anything already marked, and it bounds both its work and
// its clock so it always returns.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { fetchChart } from '@/lib/yahoo';
import { readLedger, writeEntry, dueHorizons, factorRead, type LedgerEntry } from '@/lib/ai-ledger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const HORIZON_DAYS: Record<string, number> = { d7: 7, d30: 30, d90: 90, d180: 180 };
const DEADLINE_MS = 240_000;

/** Close on or after an ISO date, from a daily series. */
function closeOnOrAfter(ts: number[], closes: number[], iso: string): number | null {
  const want = Date.parse(`${iso}T00:00:00Z`) / 1000;
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (ts[i] >= want && c != null && !isNaN(c)) return c;
  }
  return null;
}
function closeNDaysAfter(ts: number[], closes: number[], iso: string, days: number): number | null {
  const want = Date.parse(`${iso}T00:00:00Z`) / 1000 + days * 86_400;
  let last: number | null = null;
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (c == null || isNaN(c)) continue;
    if (ts[i] <= want) last = c; else break;
  }
  return last;
}

export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const doScore = u.searchParams.get('score') === '1';
  const entries = await readLedger(600);
  const t0 = Date.now();
  let marked = 0, skipped = 0;

  if (doScore) {
    // One benchmark series for the whole pass — every excess return is measured
    // against the same SPY history, so entries are comparable with each other.
    let bench: { ts: number[]; closes: number[] } | null = null;
    try {
      const ch = await fetchChart('SPY', '2y', '1d');
      if (ch?.timestamps && ch?.closes) bench = { ts: ch.timestamps as number[], closes: ch.closes as number[] };
    } catch { /* without it nothing can be marked honestly */ }
    if (!bench) {
      return NextResponse.json({ ok: false, error: 'The benchmark history was unavailable, so nothing was marked. An unmarked ledger is better than one marked against nothing.' });
    }
    for (const e of entries) {
      if (Date.now() - t0 > DEADLINE_MS) { skipped++; continue; }
      const due = dueHorizons(e);
      if (!due.length) continue;
      let series: { ts: number[]; closes: number[] } | null = null;
      try {
        const ch = await fetchChart(e.ticker, '2y', '1d');
        if (ch?.timestamps && ch?.closes) series = { ts: ch.timestamps as number[], closes: ch.closes as number[] };
      } catch { /* delisted or renamed — leave the entry unmarked, never guessed */ }
      if (!series) continue;
      const base = closeOnOrAfter(series.ts, series.closes, e.filing_date);
      const bbase = closeOnOrAfter(bench.ts, bench.closes, e.filing_date);
      if (base == null || bbase == null || base <= 0 || bbase <= 0) continue;
      e.out = e.out || {};
      for (const h of due) {
        const px = closeNDaysAfter(series.ts, series.closes, e.filing_date, HORIZON_DAYS[h]);
        const bpx = closeNDaysAfter(bench.ts, bench.closes, e.filing_date, HORIZON_DAYS[h]);
        if (px == null || bpx == null) continue;
        const ret = ((px - base) / base) * 100;
        const bret = ((bpx - bbase) / bbase) * 100;
        e.out[h] = {
          at: new Date().toISOString(),
          ret_pct: +ret.toFixed(2),
          bench_ret_pct: +bret.toFixed(2),
          excess_pct: +(ret - bret).toFixed(2),
        };
        marked++;
      }
      await writeEntry(e);
    }
  }

  // ── what the ledger has learned so far ───────────────────────────────────
  // Every read is reported WITH its sample size. An edge over eleven
  // observations is not an edge, and a table that hides `n` invites exactly
  // that mistake. Nothing here is smoothed, weighted or fitted: it is the
  // arithmetic mean of what happened, split one condition at a time.
  const horizons: Array<'d7' | 'd30' | 'd90' | 'd180'> = ['d7', 'd30', 'd90', 'd180'];
  const learned: any[] = [];
  for (const h of horizons) {
    const tests: Array<[string, (e: LedgerEntry) => boolean]> = [
      ['Engine grade ≥ 80', (e) => (e.engine_score ?? 0) >= 80],
      ['PEAD ≥ 80', (e) => (e.pead ?? 0) >= 80],
      ['Structural score ≥ 75', (e) => (e.structural_score ?? 0) >= 75],
      ['Classified STRUCTURAL', (e) => e.change_type === 'STRUCTURAL'],
      ['Why-now ≥ 75', (e) => (e.why_now_score ?? 0) >= 75],
      ['Bear severity ≥ 60', (e) => (e.bear_severity ?? 0) >= 60],
      ['Composite ≥ 75', (e) => (e.composite ?? 0) >= 75],
      ['RS ≥ 80', (e) => (e.rs ?? 0) >= 80],
      ['PEAD ≥ 80 AND structural ≥ 75', (e) => (e.pead ?? 0) >= 80 && (e.structural_score ?? 0) >= 75],
    ];
    const reads = tests.map(([label, p]) => factorRead(entries, h, label, p)).filter(Boolean);
    if (reads.length) learned.push({ horizon: h, reads });
  }

  const scoredCount = entries.filter((e) => e.out && Object.keys(e.out).length).length;
  return NextResponse.json({
    ok: true,
    total: entries.length,
    scored: scoredCount,
    marked, skipped_for_time: skipped,
    learned,
    entries: entries.slice(0, 250),
    note: entries.length < 30
      ? 'The ledger is young. Nothing here should be read as evidence until there are a few hundred marked predictions — it is recording, not yet telling you anything.'
      : undefined,
  }, { headers: { 'Cache-Control': 'no-store' } });
}

// ═══════════════════════════════════════════════════════════════════════════
// THESIS DATA — EVERY HOLDING, NOT JUST THE ONES ON THE BENCH.      (zzz716)
//
// The owner's instruction: "irrespective of it's in conviction or not, all
// data as I wanted should show." He was right and the old behaviour was
// indefensible. Portfolio Catalysts read the CONVICTION BENCH out of the
// browser's localStorage, which by construction holds only the names that
// passed a quality screen. Thirty-one of fifty-one holdings therefore showed
// a ticker, an "IN", and nothing else — not because there was no data, but
// because the page was looking in the one place guaranteed not to have it.
//
// The book is not the bench. A holding you own but would not buy again is
// exactly the one you most need evidence about.
//
// THREE SOURCES, MERGED SERVER-SIDE, EACH LABELLED:
//
//   1. THE SERVER BENCH  (/api/v1/bench, /api/v1/bench-us) — the graded
//      results the engine itself produced, ~320 India and ~92 US rows, with
//      every field the thesis engine wants. Best quality, narrowest coverage.
//   2. THE SCREENER CSVs (public/data/screener/*.csv) — the screener.in
//      exports committed daily by the sync workflow. ~430 names with
//      quarterly sales and profit growth, OPM this quarter and last, CFO/PAT
//      and ROCE. Wider coverage, and every figure is screener.in's rather
//      than this engine's, so it is tagged that way and never silently mixed
//      into a bench row.
//   3. THE FILING — not here. That is the AI summary, read per holding on
//      demand, and it is where utilisation, capex, order book and guidance
//      come from for EVERY holding regardless of what either store knows.
//
// WHY THE SOURCE TRAVELS WITH THE ROW. A screener row and a graded row are
// not the same evidence: the grader read the filing, screener.in read a
// database. Showing them identically would mean the page could not tell the
// owner which numbers came from where, and "where did this come from" is the
// question he asks of every number on the portal.
//
// WHAT IS STILL MISSING IS SAID OUT LOUD. A holding in neither store returns
// `source: "none"` and the page reports it as not yet covered rather than as
// having nothing wrong with it.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { loadBench, loadScreener, norm } from '@/lib/holding-fundamentals';   // zzz914: loaders moved to a shared lib

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const wanted = (searchParams.get('tickers') || '')
    .split(',').map((t) => t.trim()).filter(Boolean);

  const [india, us, screener] = await Promise.all([
    loadBench('IN'),
    loadBench('US'),
    loadScreener(),
  ]);

  const pick = (t: string) => {
    const k = norm(t);
    // The graded bench wins wherever it has the name: it read the filing.
    return india.get(k) || us.get(k) || screener.get(k) || null;
  };

  const rows: Record<string, any> = {};
  const list = wanted.length ? wanted : [];
  for (const t of list) {
    const hit = pick(t);
    rows[t.toUpperCase()] = hit
      ? { ...hit, requested: t.toUpperCase() }
      : { requested: t.toUpperCase(), ticker: t.toUpperCase(), source: 'none', market: 'IN' };
  }

  const bySource = { graded: 0, screener: 0, none: 0 } as Record<string, number>;
  for (const r of Object.values(rows)) bySource[(r as any).source] = (bySource[(r as any).source] || 0) + 1;

  return NextResponse.json({
    ok: true,
    generated_at: new Date().toISOString(),
    requested: list.length,
    coverage: bySource,
    available: { india_bench: india.size, us_bench: us.size, screener: screener.size },
    notes: [
      'A graded row was read from the filing by this portal\'s own engine. A screener row is screener.in\'s data, wider in coverage and never merged into a graded row.',
      bySource.none
        ? `${bySource.none} holdings are in neither store. Their structural variables come only from the filing, which the page reads on demand — nothing has been hidden, and nothing is being reported as clean.`
        : 'Every requested holding was found in one of the two stores.',
    ],
    rows,
  });
}

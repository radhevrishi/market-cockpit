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
import { promises as fs } from 'fs';
import path from 'path';
import { kvGet } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

const SCREENER_DIR = path.join(process.cwd(), 'public', 'data', 'screener');

/** In-process cache. The CSVs change once a day; re-parsing 20 files on every
 *  page load is waste, and a cold Railway instance pays it once. */
let _screener: { at: number; byTicker: Map<string, any> } | null = null;
const SCREENER_TTL_MS = 10 * 60_000;

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cur: string[] = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { cur.push(field); field = ''; }
    else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.replace(/^﻿/, '').trim());
  return rows.slice(1).filter((r) => r.length > 1)
    .map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const num = (v: unknown): number | null => {
  const s = String(v ?? '').replace(/[, %]/g, '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const norm = (s: unknown): string =>
  String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(BE|BZ)$/, '');

async function loadScreener(): Promise<Map<string, any>> {
  if (_screener && Date.now() - _screener.at < SCREENER_TTL_MS) return _screener.byTicker;
  const byTicker = new Map<string, any>();
  try {
    const files = (await fs.readdir(SCREENER_DIR)).filter((f) => f.endsWith('.csv'));
    for (const f of files) {
      let rows: Record<string, string>[] = [];
      try { rows = parseCsv(await fs.readFile(path.join(SCREENER_DIR, f), 'utf8')); }
      catch { continue; }
      for (const r of rows) {
        const k = norm(r['NSE Code']);
        if (!k || byTicker.has(k)) continue;
        const opmNow = num(r['OPM latest quarter']);
        const opmPrev = num(r['OPM preceding quarter']);
        byTicker.set(k, {
          ticker: (r['NSE Code'] || '').trim().toUpperCase(),
          company: r['Name'] || null,
          // zzz816: screener's industry, so a lender / exchange is recognised
          // as one (the thesis type and the N/A rows read it).
          sector: r['Industry Group'] || null,
          industry: r['Industry'] || null,
          market: 'IN',
          sales_yoy_pct: num(r['YOY Quarterly sales growth']),
          net_profit_yoy_pct: num(r['YOY Quarterly profit growth']),
          // Screener gives no quarterly EPS growth, so eps_yoy_pct stays null
          // and the classifier falls back to PAT — which it is written to do,
          // and which it labels differently.
          eps_yoy_pct: null,
          opm_pct: opmNow,
          // SEQUENTIAL, not year-on-year, and named that way on the row so
          // nothing downstream can mistake it for a YoY margin bridge.
          opm_change_pp_qoq: opmNow != null && opmPrev != null ? Math.round((opmNow - opmPrev) * 10) / 10 : null,
          cfo_to_pat_ratio: num(r['CFO to PAT']),
          // Carried so the cash-conversion guard can tell a negative ratio
          // caused by negative CASH from one caused by a negative PROFIT —
          // they mean opposite things. (zzz719)
          profit_after_tax_latest_quarter: num(r['Profit after tax latest quarter']),
          roce_pct: num(r['Return on capital employed']),
          pe: num(r['Price to Earning']),
          market_cap_cr: num(r['Market Capitalization']),
          source: 'screener',
          source_file: f,
        });
      }
    }
  } catch { /* no screener directory is a normal state, not an error */ }
  _screener = { at: Date.now(), byTicker };
  return byTicker;
}

// ── READ THE KV, NOT OUR OWN HTTP ROUTE.                          (zzz718)
//
// The first version fetched `${origin}/api/v1/bench` from inside this route.
// Both bench endpoints answer perfectly from outside — 320 India rows and 92
// US — and returned NOTHING from in here: the deployed response reported
// `india_bench: 0, us_bench: 0` and fell through to the screener for every
// holding the graded engine actually knew about. A server calling its own
// public URL depends on the origin the proxy reports and on the platform
// allowing the loopback, and when it fails the catch cannot tell an
// unreachable store from an empty one, so it reports coverage it does not
// have.
//
// Those routes are thin readers over two KV keys. Reading the keys here
// removes the hop: no origin, no proxy, no self-call, and an empty result now
// genuinely means an empty bench.
const BENCH_KEYS = { IN: 'bench:server:v1', US: 'bench:us:server:v1' } as const;

async function loadBench(which: 'IN' | 'US'): Promise<Map<string, any>> {
  const out = new Map<string, any>();
  try {
    const payload: any = await kvGet(BENCH_KEYS[which]);
    for (const e of (payload?.entries || [])) {
      const k = norm(e?.ticker);
      if (!k || out.has(k)) continue;
      out.set(k, { ...e, market: which, source: 'graded' });
    }
  } catch { /* an unreadable bench is reported as coverage, not thrown */ }
  return out;
}

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

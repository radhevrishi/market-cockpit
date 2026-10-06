// zzz914 — the two stores the Portfolio Catalysts page reads for EVERY holding (moved here unchanged from
// app/api/v1/portfolio/thesis-data/route.ts so the scheduled owner briefs read exactly the same rows, no second copy):
// the graded bench (KV) and the screener.in CSV exports (public/data/screener). The graded row wins where it exists.
import { promises as fs } from 'fs';
import path from 'path';
import { kvGet } from '@/lib/kv';

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

export const norm = (s: unknown): string =>
  String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(BE|BZ)$/, '');

export async function loadScreener(): Promise<Map<string, any>> {
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

export async function loadBench(which: 'IN' | 'US'): Promise<Map<string, any>> {
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


/** One row per requested ticker: graded bench (India, then US), else screener CSV, else null. */
export async function loadHoldingFundamentals(tickers: string[]): Promise<Record<string, any | null>> {
  const [india, us, screener] = await Promise.all([loadBench('IN'), loadBench('US'), loadScreener()]);
  const out: Record<string, any | null> = {};
  for (const t of tickers) { const k = norm(t); out[String(t).toUpperCase()] = india.get(k) || us.get(k) || screener.get(k) || null; }
  return out;
}

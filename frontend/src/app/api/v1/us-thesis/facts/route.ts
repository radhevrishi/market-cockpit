// ═══════════════════════════════════════════════════════════════════════════
// /api/v1/us-thesis/facts — THE DETERMINISTIC US GRADER ROW.  (zzz790 → zzz793)
//
// GET ?tickers=A,B,C → { rows: { A: row | {source:'none', why, us_profile} } }
//
// For each US-listed name: EDGAR XBRL companyfacts → strict quarterly figures
// (lib/us-thesis/xbrl: 3-month facts only, the same fiscal quarter a year
// earlier, Q4 = full year − nine months only when both are clean and marked
// derived, ifrs-full for foreign filers) → usGradedRow. Every row also
// carries `us_profile`: SIC, what the company files (10-Q vs 20-F / 40-F),
// its fiscal calendar and, for a foreign filer, its latest half-year or
// annual figures labelled as such. NO model call, NO price, NO market value.
//
// Cached per ticker (`us-thesis:facts:v3:<T>`): a row for 12 hours, a
// "no figures" answer for 1 hour, a retrieval failure not at all.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';
import { tickerToCik, companyFacts, submissions } from '@/lib/us-edgar';
import { normalizeUsTicker } from '@/lib/us-book/import';
import { usFactsResult } from '@/lib/us-thesis/facts-row';
import { fetchCompanyFactsFresh } from '@/lib/us-thesis/sec-docs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TICKER_RE = /^[A-Z0-9][A-Z0-9-]{0,11}$/;
const KEY = (t: string) => `us-thesis:facts:v3:${t}`;
const TTL_ROW_S = 12 * 3600;
const TTL_NONE_S = 3600;

/** The CIK for a ticker, trying the spellings a share class comes in. */
async function cikFor(t: string): Promise<number | null> {
  const tries = Array.from(new Set([t, t.replace(/-/g, '.'), t.replace(/-/g, ''), /^[A-Z]{2,5}[AB]$/.test(t) ? `${t.slice(0, -1)}-${t.slice(-1)}` : t]));
  for (const x of tries) {
    const c = await tickerToCik(x).catch(() => null);
    if (c) return c;
  }
  return null;
}

const hasStatements = (f: any) => !!(f?.facts?.['us-gaap'] || f?.facts?.['ifrs-full']);

async function rowFor(t: string, force: boolean): Promise<any> {
  if (!force) {
    const hit = await kvGet<any>(KEY(t)).catch(() => null);
    if (hit && (hit.source === 'sec-xbrl' || hit.source === 'none')) return { ...hit, cached: true };
  }
  const cik = await cikFor(t);
  if (!cik) {
    const none = { ticker: t, requested: t, market: 'US', source: 'none', why: `${t} is not in the SEC company list — no SEC filer, so there are no SEC figures to read`, us_profile: null };
    await kvSet(KEY(t), none, TTL_NONE_S).catch(() => null);
    return none;
  }
  const subs = await submissions(cik).catch(() => null);
  const since = new Date(Date.now() - 460 * 86_400_000).toISOString().slice(0, 10);
  const forms = (subs?.recent || []).filter((r) => r.filingDate >= since).map((r) => r.form);
  let facts = await companyFacts(cik).catch(() => null);
  // A copy with no financial statements, for a company that files 10-Q/10-K,
  // is a bad answer — fetch it again rather than report "no us-gaap facts".
  if (!hasStatements(facts) && forms.some((f) => /^(10-Q|10-K|20-F|40-F)/.test(f))) {
    facts = (await fetchCompanyFactsFresh(cik).catch(() => null)) || facts;
  }
  if (!facts && !subs) {
    return { ticker: t, requested: t, market: 'US', source: 'none', why: 'SEC EDGAR could not be reached for this company (retry later) — a retrieval failure, not an absence of figures', retrieval_failed: true, us_profile: null };
  }
  const res = usFactsResult(t, facts, { cik, company: subs?.name || facts?.entityName || null, sic: subs?.sic || null, sicDescription: subs?.sicDescription || null, forms });
  const out = res.row ? { ...res.row, us_profile: res.profile }
    : { ticker: t, requested: t, market: 'US', source: 'none', why: res.why, us_profile: res.profile, ...(facts ? {} : { retrieval_failed: true }) };
  if (facts) await kvSet(KEY(t), out, res.row ? TTL_ROW_S : TTL_NONE_S).catch(() => null);
  return out;
}

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const force = sp.get('force') === '1';
  const tickers = Array.from(new Set((sp.get('tickers') || '').split(',').map((s) => normalizeUsTicker(s)).filter((s) => TICKER_RE.test(s)))).slice(0, 40);
  const rows: Record<string, any> = {};
  let i = 0;
  const worker = async () => { while (i < tickers.length) { const t = tickers[i++]; try { rows[t] = await rowFor(t, force); } catch (e: any) { rows[t] = { ticker: t, source: 'none', why: String(e?.message || e).slice(0, 200), retrieval_failed: true }; } } };
  await Promise.all(Array.from({ length: Math.min(3, tickers.length) }, worker));
  const coverage = { xbrl: 0, none: 0 };
  for (const r of Object.values(rows)) { if (r?.source === 'sec-xbrl') coverage.xbrl++; else coverage.none++; }
  return NextResponse.json({ ok: true, rows, coverage, note: 'Filed XBRL figures only — no price, no model.' }, { headers: { 'Cache-Control': 'no-store' } });
}

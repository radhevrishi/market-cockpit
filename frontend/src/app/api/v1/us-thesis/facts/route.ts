// ═══════════════════════════════════════════════════════════════════════════
// /api/v1/us-thesis/facts — THE DETERMINISTIC US GRADER ROW.         (zzz790)
//
// GET ?tickers=A,B,C → { rows: { A: row | {source:'none', why} } }
//
// For each US-listed name: EDGAR XBRL companyfacts → the shared quarterly
// grid (lib/us-earnings-core extractFundamentals) → usGradedRow. Revenue
// growth, earnings growth, operating margin and cash conversion, all from
// the company's filed figures. NO model call, NO price, NO market value.
// Cached per ticker for 12 hours (`us-thesis:facts:v1:<T>`); a filed quarter
// does not change, and a new one lands within the day.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';
import { tickerToCik, companyFacts } from '@/lib/us-edgar';
import { extractFundamentals } from '@/lib/us-earnings-core';
import { usGradedRow, fiscalLabelFor } from '@/lib/us-thesis/adapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TICKER_RE = /^[A-Z0-9][A-Z0-9-]{0,11}$/;
const KEY = (t: string) => `us-thesis:facts:v1:${t}`;
const TTL_S = 12 * 3600;

async function rowFor(t: string, force: boolean): Promise<any> {
  if (!force) {
    const hit = await kvGet<any>(KEY(t)).catch(() => null);
    if (hit && (hit.source === 'sec-xbrl' || hit.source === 'none')) return { ...hit, cached: true };
  }
  const cik = await tickerToCik(t).catch(() => null);
  if (!cik) {
    const none = { ticker: t, requested: t, market: 'US', source: 'none', why: 'ticker not in the SEC company list — no SEC filer to read' };
    await kvSet(KEY(t), none, 3600).catch(() => null);
    return none;
  }
  const facts = await companyFacts(cik).catch(() => null);
  if (!facts) return { ticker: t, requested: t, market: 'US', source: 'none', why: 'EDGAR XBRL facts could not be retrieved (retry later)', retrieval_failed: true };
  const fund = extractFundamentals(facts);
  const row = usGradedRow(t, fund as any, { company: facts?.entityName || null, cik, fiscalLabel: fiscalLabelFor(facts, fund.q_end) });
  const out = row || { ticker: t, requested: t, market: 'US', source: 'none', why: fund.error ? `XBRL: ${fund.error}` : 'no quarterly revenue or income in the XBRL facts (foreign private issuers file annual 20-F data only)' };
  await kvSet(KEY(t), out, TTL_S).catch(() => null);
  return out;
}

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const force = sp.get('force') === '1';
  const tickers = Array.from(new Set((sp.get('tickers') || '').split(',').map((s) => s.trim().toUpperCase().replace(/[./]/g, '-')).filter((s) => TICKER_RE.test(s)))).slice(0, 40);
  const rows: Record<string, any> = {};
  let i = 0;
  const worker = async () => { while (i < tickers.length) { const t = tickers[i++]; try { rows[t] = await rowFor(t, force); } catch (e: any) { rows[t] = { ticker: t, source: 'none', why: String(e?.message || e).slice(0, 200), retrieval_failed: true }; } } };
  await Promise.all(Array.from({ length: Math.min(4, tickers.length) }, worker));
  const coverage = { xbrl: 0, none: 0 };
  for (const r of Object.values(rows)) { if (r?.source === 'sec-xbrl') coverage.xbrl++; else coverage.none++; }
  return NextResponse.json({ ok: true, rows, coverage, note: 'Filed XBRL figures only — no price, no model.' }, { headers: { 'Cache-Control': 'no-store' } });
}

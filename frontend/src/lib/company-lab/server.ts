// zzz1208 — Company Lab, server side: gathers each company's inputs from what the portal already keeps and returns one card.
// Sources (each named on the card): the stock screener snapshot (name, size, price, weekly stage, RS, trend-template count),
// SEC company facts (USA yearly figures) / the kept screener.in page (India yearly figures), the daily price series (charts,
// trend-template rules, breakout) and the company record (graded result, active guidance). Read-only; ≤ 8 companies a call;
// answers kept 30 minutes per company.
import { fcfReport, yearPoints, trendRules, breakout, labSummary, type AnnualRow, type FcfReport, type LabMarket, type TrendRule, type YearPoint } from './core';
import { usAnnualRows, inAnnualRows } from './annual';

export interface LabCard {
  market: LabMarket; ticker: string; ok: boolean; error?: string;
  name: string | null; industry: string | null; cap: number | null; price: number | null; currency: '$' | '₹'; unit: string;
  stage: { st: number | null; weeks: number | null; health: number | null; mrs: number | null; rsR: number | null; tt: number | null };
  years: YearPoint[]; rows: AnnualRow[]; fcf: FcfReport; trend: TrendRule[]; breakout: { ok: boolean | null; value: string };
  prices: Array<{ t: string; c: number }>;    // weekly closes, 5 years
  record: { tier: string | null; resultDate: string | null; guidance: number; events: number; summary: string[] } | null;
  summary: string; sources: string[]; builtAt: string;
}
const memo = new Map<string, { at: number; card: LabCard }>();
const TTL = 30 * 60_000;
const withTimeout = <T,>(p: Promise<T>, ms: number, fb: T): Promise<T> => Promise.race([p.catch(() => fb), new Promise<T>((r) => setTimeout(() => r(fb), ms))]);

export const cleanLabTicker = (t: string) => String(t || '').toUpperCase().trim().replace(/^(NSE|BSE|NASDAQ|NYSE|AMEX|US|IN):/, '').replace(/\.(NS|BO)$/, '').replace(/[^A-Z0-9&.\-]/g, '').slice(0, 20);

async function snapRow(m: LabMarket, t: string): Promise<any | null> {
  const { getSnapshot } = await import('../screener/snapshot-cache');
  const s = await getSnapshot(m);
  return (s?.rows || []).find((r: any) => String(r?.t).toUpperCase() === t) || null;
}
async function annual(m: LabMarket, t: string): Promise<{ rows: AnnualRow[]; source: string; sharesNow: number | null }> {
  if (m === 'US') {
    const { tickerToCik, companyFacts, sharesOutstandingFromFacts } = await import('../us-edgar');
    const cik = await tickerToCik(t);
    if (!cik) return { rows: [], source: 'SEC: ticker not found', sharesNow: null };
    const facts = await companyFacts(cik);
    if (!facts) return { rows: [], source: 'SEC company facts not reachable', sharesNow: null };
    const sh = sharesOutstandingFromFacts(facts);
    return { rows: usAnnualRows(facts), source: 'SEC company facts (10-K / 20-F full years)', sharesNow: sh != null ? sh / 1e6 : null };
  }
  const { dbQuery } = await import('../db');
  const r = await dbQuery<{ payload: any }>(`SELECT payload FROM screener_store WHERE market = 'IN' AND ticker = $1 AND kind = 'fund'`, [t]).catch(() => []);
  let raw = r[0]?.payload?.raw ?? null;
  if (!raw) {
    // not in the stock-screener universe yet: read the company page once (kept like the build does)
    const { readCompany } = await import('../screener/in-build');
    const got = await withTimeout(readCompany(t), 25_000, { err: 'timeout' } as any);
    raw = got?.raw ?? null;
  }
  if (!raw) return { rows: [], source: 'screener.in page not available', sharesNow: null };
  const sharesNow = raw.price && raw.mcapCr ? raw.mcapCr / raw.price : null;   // crore shares
  return { rows: inAnnualRows(raw), source: 'screener.in company page (yearly profit & loss, cash flow, balance sheet)', sharesNow };
}
async function weekly(m: LabMarket, t: string): Promise<{ prices: Array<{ t: string; c: number }>; bars: { c: number[]; h: number[]; l: number[]; v: number[] } | null }> {
  const { getDailySeries } = await import('../chart-data');
  const s = await withTimeout(getDailySeries(m, t, '5y'), 20_000, null);
  const bars = (s?.bars || []).filter((b) => [b.c, b.h, b.l].every((x) => Number.isFinite(x) && x > 0));
  if (!bars.length) return { prices: [], bars: null };
  const iso = (x: number) => new Date(x < 1e11 ? x * 1000 : x).toISOString().slice(0, 10);
  const prices: Array<{ t: string; c: number }> = [];
  bars.forEach((b, i) => { if (i % 5 === 4 || i === bars.length - 1) prices.push({ t: iso(b.t), c: b.c }); });
  return { prices, bars: { c: bars.map((b) => b.c), h: bars.map((b) => b.h), l: bars.map((b) => b.l), v: bars.map((b) => b.v || 0) } };
}
async function record(t: string): Promise<LabCard['record']> {
  try {
    const { getCompanyRecord } = await import('../company-record');
    const r: any = await withTimeout(getCompanyRecord(t), 8_000, null);
    if (!r) return null;
    const res = r.results?.data || null;
    return { tier: res?.tier ?? res?.now_tier ?? null, resultDate: res?.filing_date ?? null, guidance: Array.isArray(r.guidance?.data) ? r.guidance.data.length : 0, events: Array.isArray(r.events?.data) ? r.events.data.length : 0, summary: Array.isArray(r.summary) ? r.summary.slice(0, 4) : [] };
  } catch { return null; }
}

export async function labCard(m: LabMarket, tickerIn: string): Promise<LabCard> {
  const t = cleanLabTicker(tickerIn);
  const k = `${m}:${t}`;
  const hit = memo.get(k);
  if (hit && Date.now() - hit.at < TTL) return hit.card;
  const cur = m === 'US' ? '$' : '₹', unit = m === 'US' ? '$ million' : '₹ crore';
  const blank = (error: string): LabCard => ({ market: m, ticker: t, ok: false, error, name: null, industry: null, cap: null, price: null, currency: cur, unit,
    stage: { st: null, weeks: null, health: null, mrs: null, rsR: null, tt: null }, years: [], rows: [], fcf: fcfReport([], null, ''), trend: [], breakout: { ok: null, value: '' },
    prices: [], record: null, summary: '', sources: [], builtAt: new Date().toISOString() });
  if (!t) return blank('not a ticker');
  const [row, ann, wk, rec] = await Promise.all([withTimeout(snapRow(m, t), 15_000, null), withTimeout(annual(m, t), 40_000, { rows: [], source: 'yearly figures timed out', sharesNow: null }), weekly(m, t), record(t)]);
  if (!row && !ann.rows.length && !wk.prices.length) return blank(`${t} not found in the ${m === 'US' ? 'US' : 'India'} data — check the ticker and the market`);
  const cap = typeof row?.mc === 'number' ? row.mc : null;
  const fcfBasis = m === 'US' ? 'operating cash − capital spending (company filings)' : 'operating cash + investing cash (approximation — screener.in prints no capex line)';
  const fcf = fcfReport(ann.rows, cap, fcfBasis);
  const trend = wk.bars ? trendRules(wk.bars) : [];
  const st = typeof row?.twSt === 'number' ? row.twSt : typeof row?.stage === 'number' ? row.stage : null;
  const card: LabCard = {
    market: m, ticker: t, ok: true, name: row?.n ?? null, industry: row?.ind ?? row?.sec ?? null, cap, price: typeof row?.px === 'number' ? row.px : wk.bars ? wk.bars.c[wk.bars.c.length - 1] : null,
    currency: cur, unit,
    stage: { st, weeks: row?.twWk ?? null, health: row?.twH ?? null, mrs: row?.mrs ?? null, rsR: row?.rsR ?? null, tt: row?.tt ?? null },
    years: yearPoints(ann.rows, ann.sharesNow), rows: ann.rows, fcf, trend, breakout: wk.bars ? breakout(wk.bars) : { ok: null, value: 'no prices' },
    prices: wk.prices, record: rec, summary: labSummary(fcf, trend, st),
    sources: [ann.source, 'Stock screener snapshot (stage, RS, size)', 'Daily prices (Yahoo / NSE), 5 years'],
    builtAt: new Date().toISOString(),
  };
  if (memo.size > 300) memo.clear();
  memo.set(k, { at: Date.now(), card });
  return card;
}

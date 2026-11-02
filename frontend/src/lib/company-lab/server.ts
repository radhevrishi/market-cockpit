// zzz1208 — Company Lab, server side: gathers each company's inputs from what the portal already keeps and returns one card.
// Sources (each named on the card): the stock screener snapshot (name, size, price, weekly stage, RS, trend-template count),
// SEC company facts (USA yearly figures) / the kept screener.in page (India yearly figures), the daily price series (charts,
// trend-template rules, breakout) and the company record (graded result, active guidance). Read-only; ≤ 8 companies a call;
// answers kept 30 minutes per company.
import { fcfReport, yearPoints, trendRules, breakout, labSummary, rsCumulative, maSeries, stage2Verdict, type AnnualRow, type FcfReport, type LabMarket, type RsCum, type TrendRule, type YearPoint } from './core';
import { usAnnualRows, inAnnualRows } from './annual';

export interface LabCard {
  market: LabMarket; ticker: string; ok: boolean; error?: string;
  name: string | null; industry: string | null; cap: number | null; price: number | null; currency: '$' | '₹'; unit: string;
  stage: { st: number | null; weeks: number | null; health: number | null; mrs: number | null; rsR: number | null; tt: number | null };
  years: YearPoint[]; rows: AnnualRow[]; fcf: FcfReport; trend: TrendRule[]; breakout: { ok: boolean | null; value: string };
  prices: Array<{ t: string; c: number }>;    // weekly closes, 10 years (covers every fiscal year shown)
  ma: Array<{ t: string; c: number; m50: number | null; m150: number | null; m200: number | null }>;   // last 2 years, weekly
  rs: RsCum & { index: string };
  verdict: { all: boolean | null; trendAndRs: boolean | null; text: string };
  movedFrom?: LabMarket;   // asked under the other market, not found there
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
interface Daily { t: string[]; c: number[]; h: number[]; l: number[]; v: number[] }
const isoOf = (x: number) => new Date(x < 1e11 ? x * 1000 : x).toISOString().slice(0, 10);
async function daily(m: LabMarket, t: string): Promise<Daily | null> {
  const { getDailySeries } = await import('../chart-data');
  const s = await withTimeout(getDailySeries(m, t, '10y'), 25_000, null);
  const bars = (s?.bars || []).filter((b) => [b.c, b.h, b.l].every((x) => Number.isFinite(x) && x > 0));
  if (!bars.length) return null;
  return { t: bars.map((b) => isoOf(b.t)), c: bars.map((b) => b.c), h: bars.map((b) => b.h), l: bars.map((b) => b.l), v: bars.map((b) => b.v || 0) };
}
/** The benchmark (S&P 500 / Nifty 50) daily closes, 2 years, kept 1 hour. */
const benchMemo = new Map<LabMarket, { at: number; d: { t: string[]; c: number[] } | null }>();
async function bench(m: LabMarket): Promise<{ t: string[]; c: number[] } | null> {
  const hit = benchMemo.get(m);
  if (hit && Date.now() - hit.at < 3600_000) return hit.d;
  let d: { t: string[]; c: number[] } | null = null;
  try {
    const { yahooChart } = await import('../us-prices');
    const b: any = await withTimeout(yahooChart(m === 'US' ? '^GSPC' : '^NSEI', '2y'), 15_000, null);
    if (b && Array.isArray(b.close) && Array.isArray(b.dates) && b.close.length > 30) {
      const t: string[] = [], c: number[] = [];
      b.dates.forEach((x: string, i: number) => { const v = Number(b.close[i]); if (Number.isFinite(v) && v > 0) { t.push(String(x).slice(0, 10)); c.push(v); } });
      d = { t, c };
    }
  } catch { d = null; }
  if (!d && m === 'IN') {   // NSE's own published Nifty closes (kept by the index-history job)
    try {
      const { kvGet } = await import('../kv');
      const blob: any = await kvGet('nse-index-history:v1:latest');
      const s = blob?.indices?.['^NSEI'];
      if (s?.ts?.length) d = { t: s.ts.map((x: any) => isoOf(Number(x))), c: s.close.map(Number) };
    } catch { d = null; }
  }
  benchMemo.set(m, { at: Date.now(), d });
  return d;
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

async function labCardIn(m: LabMarket, t: string): Promise<LabCard> {
  const cur = m === 'US' ? '$' : '₹', unit = m === 'US' ? '$ million' : '₹ crore';
  const idxName = m === 'US' ? 'S&P 500' : 'Nifty 50';
  const noRs: LabCard['rs'] = { ratio: null, stockRet: null, idxRet: null, ok: null, from: null, line: [], index: idxName };
  const blank = (error: string): LabCard => ({ market: m, ticker: t, ok: false, error, name: null, industry: null, cap: null, price: null, currency: cur, unit,
    stage: { st: null, weeks: null, health: null, mrs: null, rsR: null, tt: null }, years: [], rows: [], fcf: fcfReport([], null, ''), trend: [], breakout: { ok: null, value: '' },
    prices: [], ma: [], rs: noRs, verdict: { all: null, trendAndRs: null, text: '' }, record: null, summary: '', sources: [], builtAt: new Date().toISOString() });
  if (!t) return blank('not a ticker');
  const [row, ann, d, rec, ix] = await Promise.all([withTimeout(snapRow(m, t), 15_000, null), withTimeout(annual(m, t), 40_000, { rows: [], source: 'yearly figures timed out', sharesNow: null }), daily(m, t), record(t), bench(m)]);
  if (!row && !ann.rows.length && !d) return blank(`${t} not found in the ${m === 'US' ? 'US' : 'India'} data — check the ticker and the market`);
  const cap = typeof row?.mc === 'number' ? row.mc : null;
  const fcfBasis = m === 'US' ? 'operating cash − capital spending (company filings)' : 'operating cash + investing cash (approximation — screener.in prints no capex line)';
  // the close on or before a date (for the yield at each year end)
  const priceAt = (end: string): number | null => {
    if (!d) return null;
    let lo = 0, hi = d.t.length - 1, k = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (d.t[mid] <= end) { k = mid; lo = mid + 1; } else hi = mid - 1; }
    return k >= 0 && Date.parse(end) - Date.parse(d.t[k]) < 20 * 86_400_000 ? d.c[k] : null;
  };
  const sharesNow = ann.sharesNow ?? (cap != null && typeof row?.px === 'number' && row.px > 0 ? cap / row.px : null);
  const years = yearPoints(ann.rows, sharesNow, priceAt);
  const fcf = fcfReport(ann.rows, cap, fcfBasis, years);
  const bars = d ? { c: d.c, h: d.h, l: d.l, v: d.v } : null;
  const trend = bars ? trendRules(bars) : [];
  const bo = bars ? breakout(bars) : { ok: null, value: 'no prices' };
  const rs = d && ix ? { ...rsCumulative({ t: d.t, c: d.c }, ix), index: idxName } : noRs;
  const st = typeof row?.twSt === 'number' ? row.twSt : typeof row?.stage === 'number' ? row.stage : null;
  const prices: Array<{ t: string; c: number }> = [];
  if (d) d.c.forEach((c, i) => { if ((d.c.length - 1 - i) % 5 === 0) prices.push({ t: d.t[i], c }); });
  const card: LabCard = {
    market: m, ticker: t, ok: true, name: row?.n ?? null, industry: row?.ind ?? row?.sec ?? null, cap, price: typeof row?.px === 'number' ? row.px : d ? d.c[d.c.length - 1] : null,
    currency: cur, unit,
    stage: { st, weeks: row?.twWk ?? null, health: row?.twH ?? null, mrs: row?.mrs ?? null, rsR: row?.rsR ?? null, tt: row?.tt ?? null },
    years, rows: ann.rows, fcf, trend, breakout: bo,
    prices, ma: d ? maSeries(d.t, d.c) : [], rs, verdict: stage2Verdict(trend, rs, bo),
    record: rec, summary: labSummary(fcf, trend, st, typeof row?.tt === 'number' ? row.tt : null),
    sources: [ann.source, 'Stock screener snapshot (stage, RS rating, size)', `Daily prices (Yahoo / NSE), 10 years; ${idxName} for relative strength`],
    builtAt: new Date().toISOString(),
  };
  return card;
}

/** One company. Not found under the market asked → the other market is tried (SPOT / HIMS typed with India selected). */
export async function labCard(m: LabMarket, tickerIn: string): Promise<LabCard> {
  const t = cleanLabTicker(tickerIn);
  const k = `${m}:${t}`;
  const hit = memo.get(k);
  if (hit && Date.now() - hit.at < TTL) return hit.card;
  let card = await labCardIn(m, t);
  if (!card.ok && t) {
    const other: LabMarket = m === 'US' ? 'IN' : 'US';
    const alt = await labCardIn(other, t);
    if (alt.ok) card = { ...alt, movedFrom: m };
  }
  if (memo.size > 300) memo.clear();
  memo.set(k, { at: Date.now(), card });
  return card;
}

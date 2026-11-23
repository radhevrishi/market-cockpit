// zzz1208 — Company Lab, server side: gathers each company's inputs from what the portal already keeps and returns one card.
// Sources (each named on the card): the stock screener snapshot (name, size, price, weekly stage, RS, trend-template count),
// SEC company facts (USA yearly figures) / the kept screener.in page (India yearly figures), the daily price series (charts,
// trend-template rules, breakout) and the company record (graded result, active guidance). Read-only; ≤ 8 companies a call;
// answers kept 30 minutes per company.
import { labExtras, type LabExtras } from './extras';
import { fcfReport, yearPoints, trendRules, breakout, labSummary, rsCumulative, maSeries, stage2Verdict, type AnnualRow, type FcfReport, type LabMarket, type RsCum, type TrendRule, type YearPoint } from './core';
import { usAnnualRows, inAnnualRows, businessBreak } from './annual';
import { quarterReport, usQuarterInputs, inQuarterInputs, type QuarterReport, type QIn } from './quarterly';

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
  record: { tier: string | null; resultDate: string | null; guidance: number; events: number; summary: string[]; guidanceUp?: string | null } | null;
  /** zzz1295 — valuation, capital efficiency, entry, catalysts, ownership, stage check (lib/company-lab/extras) */
  extras?: LabExtras;
  summary: string; sources: string[]; builtAt: string;
  /** zzz1291 — Rule of 40, growth acceleration, margins, cash-squeeze check, dilution, cash conversion, debt ÷ equity */
  quarter?: QuarterReport;
  /** zzz1291 — data repairs and gaps said plainly */
  notes?: string[];
  /** zzz1292 — close symbols when a ticker is not found */
  suggest?: string[];
  /** zzz1292 — days since listing (screener ipoD), when known */
  listedDays?: number | null;
}
const memo = new Map<string, { at: number; card: LabCard }>();
const TTL = 30 * 60_000;
const withTimeout = <T,>(p: Promise<T>, ms: number, fb: T): Promise<T> => Promise.race([p.catch(() => fb), new Promise<T>((r) => setTimeout(() => r(fb), ms))]);

export const cleanLabTicker = (t: string) => String(t || '').toUpperCase().trim().replace(/^(NSE|BSE|NASDAQ|NYSE|AMEX|US|IN):/, '').replace(/\.(NS|BO)$/, '').replace(/[^A-Z0-9&.\-]/g, '').slice(0, 20);

async function snapRow(m: LabMarket, t: string): Promise<any | null> {
  const { getSnapshot } = await import('../screener/snapshot-cache');
  const s = await getSnapshot(m);
  // zzz1293 — class shares are written MOG-A, MOG.A or MOG/A depending on the source
  const forms = Array.from(new Set([t, t.replace(/[-./]/g, '.'), t.replace(/[-./]/g, '-'), t.replace(/[-./]/g, '/'), t.replace(/[-./]/g, '')]));
  const rows0 = s?.rows || [];
  let row: any = null;
  for (const f of forms) { row = rows0.find((r: any) => String(r?.t).toUpperCase() === f) || null; if (row) break; }
  // zzz1292 — no stored RS rating: the same 1–99 rank the screener pages use (3M / 6M / 1Y returns inside this market)
  if (row && typeof row.rsR !== 'number') {
    try { const { rsRanks } = await import('../screener/rs-rank'); const v = rsRanks((s?.rows || []) as any).get(t); if (typeof v === 'number') return { ...row, rsR: v }; } catch { /* none */ }
  }
  return row;
}
type Ann = { rows: AnnualRow[]; source: string; sharesNow: number | null; q?: QIn; notes?: string[]; name?: string | null; shpQ?: any; industry?: string | null; roce?: number | null; lastResult?: string | null };
async function annual(m: LabMarket, t: string, fresh = false): Promise<Ann> {
  if (m === 'US') {
    const { tickerToCik, companyFacts, sharesOutstandingFromFacts, forgetCompanyFacts } = await import('../us-edgar');
    const cik = await tickerToCik(t);
    if (!cik) return { rows: [], source: 'SEC: ticker not found', sharesNow: null };
    if (fresh) forgetCompanyFacts(cik);
    const facts = await companyFacts(cik);
    if (!facts) return { rows: [], source: 'SEC company facts not reachable', sharesNow: null };
    const sh = sharesOutstandingFromFacts(facts);
    const { reportingBasis } = await import('./annual');
    const basis = reportingBasis(facts);
    let toUsd = 1, note = '';
    if (basis.cur !== 'USD') {
      // a foreign filer (20-F, IFRS): its figures are converted to US dollars at today's rate so they sit against the $ price
      try {
        const { yahooChart } = await import('../us-prices');
        const b: any = await withTimeout(yahooChart(`${basis.cur}USD=X`, '5d'), 10_000, null);
        const r = Array.isArray(b?.close) ? Number(b.close.filter((x: any) => Number.isFinite(Number(x))).pop()) : NaN;
        if (Number.isFinite(r) && r > 0) { toUsd = r; note = `; reported in ${basis.cur}, converted at today's ${r.toFixed(4)} $ per ${basis.cur}`; }
        else note = `; reported in ${basis.cur} (rate not available — figures NOT converted)`;
      } catch { note = `; reported in ${basis.cur} (figures NOT converted)`; }
    }
    const brk = businessBreak(usAnnualRows(facts, 10, toUsd));
    const notes: string[] = [];
    if (brk.note) notes.push(brk.note);
    if (brk.rows.some((r) => r.fcfApprox)) notes.push(`free cash flow ≈ operating cash in ${brk.rows.filter((r) => r.fcfApprox).map((r) => r.label).join(', ')}: the company stopped reporting a capex line and its capex had been under 1% of sales`);
    let q: QIn | undefined;
    try { q = toUsd === 1 ? usQuarterInputs(facts) : undefined; } catch { q = undefined; }
    // zzz1293 — figures that stop years ago (a company that moved its listing or files elsewhere now) are said, not shown as current
    const lastEnd = brk.rows[brk.rows.length - 1]?.end;
    if (lastEnd && Date.now() - Date.parse(lastEnd) > 2 * 365 * 86_400_000) notes.push(`the newest yearly figures in the SEC data are for ${brk.rows[brk.rows.length - 1].label} — the company may no longer file full figures with the SEC, so these are old`);
    if (q && !q.rev.length) notes.push('no quarterly figures in the SEC data (a foreign company that files only yearly) — Rule of 40 uses the latest full year; margins and the cash-squeeze check need quarters');
    return { rows: brk.rows, source: `SEC company facts (10-K / 20-F full years${basis.tax === 'ifrs-full' ? ', IFRS' : ''}${note})`, sharesNow: sh != null ? sh / 1e6 : null, q, notes, name: facts?.entityName ?? null };
  }
  const { dbQuery } = await import('../db');
  const r = await dbQuery<{ payload: any }>(`SELECT payload FROM screener_store WHERE market = 'IN' AND ticker = $1 AND kind = 'fund'`, [t]).catch(() => []);
  let raw = fresh ? null : r[0]?.payload?.raw ?? null;
  let freshNote = '';
  if (fresh) {   // zzz1291 — Refresh: read the company page now so a result filed this week is in
    const { readCompany } = await import('../screener/in-build');
    const got = await withTimeout(readCompany(t), 25_000, { err: 'timeout' } as any);
    const kept = r[0]?.payload?.raw ?? null;
    // zzz1293 — a page that came back thin (screener.in slow or refusing) never replaces the kept copy
    const yrs = (x: any) => (x?.T?.a?.headers?.length ?? 0);
    raw = got?.raw && yrs(got.raw) >= Math.max(1, yrs(kept) - 1) ? got.raw : kept;
    if (raw === kept && kept) freshNote = 'screener.in did not answer in full just now — the kept copy of its page is used';
  }
  if (!raw) {
    // not in the stock-screener universe yet: read the company page once (kept like the build does)
    const { readCompany } = await import('../screener/in-build');
    const got = await withTimeout(readCompany(t), 25_000, { err: 'timeout' } as any);
    raw = got?.raw ?? null;
  }
  if (!raw) return { rows: [], source: 'screener.in page not available', sharesNow: null };
  const sharesNow = raw.price && raw.mcapCr ? raw.mcapCr / raw.price : null;   // crore shares
  let q: QIn | undefined; try { q = inQuarterInputs(raw); } catch { q = undefined; }
  return { rows: inAnnualRows(raw), source: 'screener.in company page (yearly profit & loss, cash flow, balance sheet)', sharesNow, q, notes: freshNote ? [freshNote] : [], name: raw?.name ?? null, shpQ: raw?.shpQ ?? null,
    industry: raw?.industry ?? raw?.sector ?? null, roce: typeof raw?.roce === 'number' ? raw.roce : null, lastResult: Array.isArray(raw?.ann) && raw.ann[0]?.d ? String(raw.ann[0].d).slice(0, 10) : null };
}
/** zzz1300 — no results date anywhere: the latest quarter's end + 45 days (the Indian filing deadline), if that is past. */
function qResultGuess(q: QIn | undefined): string | null {
  const e = q?.rev?.length ? q.rev[q.rev.length - 1].e : null;
  if (!e || (q?.rev?.length ?? 0) < 4) return null;
  const t = Date.parse(e) + 45 * 86_400_000;
  return Number.isFinite(t) && t <= Date.now() ? new Date(t).toISOString().slice(0, 10) : null;
}
interface Daily { t: string[]; c: number[]; h: number[]; l: number[]; v: number[]; name?: string | null }
const isoOf = (x: number) => new Date(x < 1e11 ? x * 1000 : x).toISOString().slice(0, 10);
async function daily(m: LabMarket, t: string): Promise<Daily | null> {
  const { getDailySeries } = await import('../chart-data');
  const s = await withTimeout(getDailySeries(m, t, '10y'), 25_000, null);
  const bars = (s?.bars || []).filter((b) => [b.c, b.h, b.l].every((x) => Number.isFinite(x) && x > 0));
  if (!bars.length) return null;
  return { t: bars.map((b) => isoOf(b.t)), c: bars.map((b) => b.c), h: bars.map((b) => b.h), l: bars.map((b) => b.l), v: bars.map((b) => b.v || 0), name: s?.name ?? null };
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
    // zzz1295 — newest guidance RAISE in the last 120 days (archived guidance events)
    const evs: any[] = Array.isArray(r.events?.data) ? r.events.data : [];
    const up = evs.filter((e) => (/RAIS|UPGRAD/i.test(`${e?.event_type ?? ''} ${e?.headline ?? ''}`) || (Array.isArray(e?.changes) && e.changes.some((c: any) => /up|rais/i.test(String(c?.direction ?? ''))))) && !/LOWER|CUT|DOWNGRAD/i.test(`${e?.event_type ?? ''}`) && Date.now() - Date.parse(String(e?.event_date ?? e?.last_seen ?? '')) < 120 * 86_400_000)
      .map((e) => { const t = Date.parse(String(e?.event_date ?? e?.last_seen ?? '')); return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null; })   // zzz1299 — dates arrive in several shapes ("Fri Aug 14 2026" was shown as "ug 14")
      .filter((d): d is string => !!d).sort().pop() ?? null;
    return { tier: res?.tier ?? res?.now_tier ?? null, resultDate: res?.filing_date ?? null, guidance: Array.isArray(r.guidance?.data) ? r.guidance.data.length : 0, events: evs.length, summary: Array.isArray(r.summary) ? r.summary.slice(0, 4) : [], guidanceUp: up };
  } catch { return null; }
}

async function labCardIn(m: LabMarket, t: string, fresh = false): Promise<LabCard> {
  const cur = m === 'US' ? '$' : '₹', unit = m === 'US' ? '$ million' : '₹ crore';
  const idxName = m === 'US' ? 'S&P 500' : 'Nifty 50';
  const noRs: LabCard['rs'] = { ratio: null, stockRet: null, idxRet: null, ok: null, from: null, line: [], index: idxName };
  const blank = (error: string): LabCard => ({ market: m, ticker: t, ok: false, error, name: null, industry: null, cap: null, price: null, currency: cur, unit,
    stage: { st: null, weeks: null, health: null, mrs: null, rsR: null, tt: null }, years: [], rows: [], fcf: fcfReport([], null, ''), trend: [], breakout: { ok: null, value: '' },
    prices: [], ma: [], rs: noRs, verdict: { all: null, trendAndRs: null, text: '' }, record: null, summary: '', sources: [], builtAt: new Date().toISOString() });
  if (!t) return blank('not a ticker');
  const [row, ann, d, rec, ix] = await Promise.all([withTimeout(snapRow(m, t), 15_000, null), withTimeout(annual(m, t, fresh), 40_000, { rows: [], source: 'yearly figures timed out', sharesNow: null }), daily(m, t), record(t), bench(m)]);
  if (!row && !ann.rows.length && !d) return blank(`${t} not found in the ${m === 'US' ? 'US' : 'India'} data — check the ticker and the market`);
  const notes: string[] = [...(ann.notes || [])];
  let cap = typeof row?.mc === 'number' ? row.mc : null;
  const fcfBasis = m === 'US' ? 'operating cash − capital spending (company filings)' : 'operating cash + investing cash (approximation — screener.in prints no capex line)';
  // the close on or before a date (for the yield at each year end)
  const priceAt = (end: string): number | null => {
    if (!d) return null;
    let lo = 0, hi = d.t.length - 1, k = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (d.t[mid] <= end) { k = mid; lo = mid + 1; } else hi = mid - 1; }
    return k >= 0 && Date.parse(end) - Date.parse(d.t[k]) < 20 * 86_400_000 ? d.c[k] : null;
  };
  const lastSh = [...ann.rows].reverse().find((r) => typeof r.shares === 'number' && r.shares > 0)?.shares ?? null;
  const sharesNow = ann.sharesNow ?? (cap != null && typeof row?.px === 'number' && row.px > 0 ? cap / row.px : null) ?? (m === 'US' ? lastSh : null);
  const lastPx = typeof row?.px === 'number' ? row.px : d ? d.c[d.c.length - 1] : null;
  if (cap == null && sharesNow != null && lastPx != null) { cap = Math.round(sharesNow * lastPx); notes.push('market cap worked out as shares outstanding × last price (not in the screener snapshot)'); }
  if (ann.rows.length && !ann.rows.some((r) => r.fcf != null)) notes.push('no free-cash-flow figures in the filings — the FCF charts are empty for this company');
  const years = yearPoints(ann.rows, sharesNow, priceAt);
  const fcf = fcfReport(ann.rows, cap, fcfBasis, years);
  const bars = d ? { c: d.c, h: d.h, l: d.l, v: d.v } : null;
  const trend = bars ? trendRules(bars) : [];
  const bo = bars ? breakout(bars) : { ok: null, value: 'no prices' };
  const rs = d && ix ? { ...rsCumulative({ t: d.t, c: d.c }, ix), index: idxName } : noRs;
  let st = typeof row?.twSt === 'number' ? row.twSt : typeof row?.stage === 'number' ? row.stage : null;
  // zzz1299 — a company missing from the screener snapshot (e.g. BSE-only) gets its weekly stage, moving averages and
  // 52-week high worked out from its own daily prices, so the Stage / Entry columns are not blank
  // zzz1300 — figures the snapshot lacks (BSE-only names, new listings, missing averages) are worked out from the company's own
  // daily prices, field by field; P/E and ROE from the last full year when the snapshot has none
  let ownRow: any = row ? { ...row } : null;
  // P/E, ROE and ROCE from the yearly figures — they need no price history (new listings too)
  const fillYearly = (o: any, filled: string[]) => {
    const put = (k: string, v: number | null, label: string) => { if (typeof o[k] !== 'number' && v != null && Number.isFinite(v)) { o[k] = v; filled.push(label); } };
    const lastY = [...ann.rows].reverse().find((r) => typeof r.netIncome === 'number');
    if (cap != null && lastY?.netIncome != null && lastY.netIncome > 0) put('pe', cap / lastY.netIncome, `P/E (on ${lastY.label} profit)`);
    if (lastY?.netIncome != null && typeof (lastY as any).equity === 'number' && (lastY as any).equity > 0) put('roeFY', (lastY.netIncome / (lastY as any).equity) * 100, `ROE (${lastY.label})`);
    if (typeof o.roceTTM !== 'number' && typeof o.roceFY !== 'number' && typeof ann.roce === 'number') { o.roceFY = ann.roce; filled.push('ROCE (screener.in page)'); }
  };
  if (!(d && d.c.length >= 50) && ownRow) {
    const filled: string[] = [];
    fillYearly(ownRow, filled);
    if (filled.length) notes.push(`missing from the screener snapshot — worked out here: ${filled.join(', ')}${d ? `; only ${d.c.length} trading days of prices, too few for the 50-day / 200-day averages` : ''}`);
  }
  if (d && d.c.length >= 50) {
    const avg = (n: number) => (d.c.length >= n ? d.c.slice(-n).reduce((a, b) => a + b, 0) / n : null);
    const o: any = ownRow ?? {};
    const filled: string[] = [];
    const put = (k: string, v: number | null, label: string) => { if (typeof o[k] !== 'number' && v != null && Number.isFinite(v)) { o[k] = v; filled.push(label); } };
    put('px', d.c[d.c.length - 1], 'price');
    put('sma50', avg(50), '50-day'); put('sma150', avg(150), '150-day'); put('sma200', avg(200), '200-day');
    put('hi52', Math.max(...d.c.slice(-250)), '52-week high');
    if (st == null && d.c.length >= 200) {
      try {
        const { stageFromDaily } = await import('../stage-analysis');
        const sw = stageFromDaily({ d: d.t, c: d.c, h: d.h, l: d.l, v: d.v }, null, { market: m === 'US' ? 'US' : 'IN' });
        if (sw?.stage != null) { st = sw.stage; filled.push('weekly stage'); }
      } catch { /* stage stays unknown */ }
    }
    ownRow = o;
    fillYearly(o, filled);
    if (filled.length) notes.push(`${row ? 'missing from the screener snapshot' : 'company not in the screener snapshot'} — worked out here: ${filled.join(', ')}${row ? '' : '; no relative-strength rank'}`);
  }
  const prices: Array<{ t: string; c: number }> = [];
  if (d) d.c.forEach((c, i) => { if ((d.c.length - 1 - i) % 5 === 0) prices.push({ t: d.t[i], c }); });
  const card: LabCard = {
    market: m, ticker: t, ok: true, name: row?.n ?? ann.name ?? d?.name ?? null, industry: row?.ind ?? row?.sec ?? ann.industry ?? null, cap, price: typeof row?.px === 'number' ? row.px : d ? d.c[d.c.length - 1] : null,
    currency: cur, unit,
    listedDays: typeof row?.ipoD === 'number' ? Math.floor(Date.now() / 86_400_000) - row.ipoD : null,
    stage: { st, weeks: row?.twWk ?? null, health: row?.twH ?? null, mrs: row?.mrs ?? null, rsR: row?.rsR ?? null, tt: row?.tt ?? null },
    years, rows: ann.rows, fcf, trend, breakout: bo,
    prices, ma: d ? maSeries(d.t, d.c) : [], rs, verdict: stage2Verdict(trend, rs, bo),
    record: rec, summary: labSummary(fcf, trend, st, typeof row?.tt === 'number' ? row.tt : null),
    sources: [ann.source, 'Stock screener snapshot (stage, RS rating, size)', `Daily prices (Yahoo / NSE), 10 years; ${idxName} for relative strength`],
    builtAt: new Date().toISOString(),
    quarter: quarterReport(ann.q ?? { basis: 'yearly', rev: [], gp: [], op: [], cfo: [], capex: [], cash: new Map(), debt: new Map(), recv: new Map() }, ann.rows),
    notes,
  };
  // zzz1295 — EPS growth a year over 3 years (positive start and end only) for the PEG when the TTM figure is missing
  const eps = ann.rows.filter((x) => typeof x.eps === 'number');
  const e0 = eps[Math.max(0, eps.length - 4)], e1 = eps[eps.length - 1];
  const yrs = eps.length - 1 - Math.max(0, eps.length - 4);
  const epsCagr3 = e0 && e1 && yrs > 0 && e0.eps! > 0 && e1.eps! > 0 ? Math.round((Math.pow(e1.eps! / e0.eps!, 1 / yrs) - 1) * 1000) / 10 : null;
  card.extras = labExtras({ row: ownRow ?? row, epsCagr3, lastResult: rec?.resultDate ?? ann.lastResult ?? qResultGuess(ann.q), guidanceUp: rec?.guidanceUp ?? null, shpQ: ann.shpQ ?? null, stage: st, rsRatio: rs?.ratio ?? null });
  if (card.extras.stageCheck.text) card.notes = [...(card.notes || []), card.extras.stageCheck.text];
  return card;
}

/** One company. Not found under the market asked → the other market is tried (SPOT / HIMS typed with India selected). */
/** zzz1292 — common short names / typos of Indian symbols as people write them (portfolio entries, chat). */
const IN_ALIASES: Record<string, string> = { IHCL: 'INDHOTEL', SONACOMSTAR: 'SONACOMS', RBZJEWELS: 'RBZJEWEL', RBZ: 'RBZJEWEL', TATAMOTORS: 'TMPV', ZOMATO: 'ETERNAL', MINDTREE: 'LTIM' };
const lev = (a: string, b: string): number => {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};
/** The listed symbol a mistyped ticker most likely means: an alias, else the ONE symbol one letter away (two or more = ask). */
export async function resolveLabTicker(m: LabMarket, t: string): Promise<{ t: string; note: string | null; suggest: string[] }> {
  if (m === 'IN' && IN_ALIASES[t]) return { t: IN_ALIASES[t], note: `${t} read as ${IN_ALIASES[t]}`, suggest: [] };
  try {
    const { getSnapshot } = await import('../screener/snapshot-cache');
    const rows: any[] = (await getSnapshot(m))?.rows || [];
    if (rows.some((r) => String(r?.t).toUpperCase() === t)) return { t, note: null, suggest: [] };
    const near = rows.map((r) => String(r?.t || '').toUpperCase()).filter((x) => x && x[0] === t[0] && lev(x, t) <= 2).map((x) => ({ x, d: lev(x, t) })).sort((a, b) => a.d - b.d);
    const one = near.filter((n) => n.d === 1);
    if (one.length === 1) return { t: one[0].x, note: `${t} is not a listed symbol — read as ${one[0].x}`, suggest: [] };
    return { t, note: null, suggest: near.slice(0, 4).map((n) => n.x) };
  } catch { return { t, note: null, suggest: [] }; }
}

export async function labCard(m: LabMarket, tickerIn: string, fresh = false, strict = false): Promise<LabCard> {
  const t0 = cleanLabTicker(tickerIn);
  const res = t0 ? await resolveLabTicker(m, t0) : { t: t0, note: null, suggest: [] as string[] };
  const t = res.t;
  const k = `${m}:${t}:${strict ? 1 : 0}`;
  const hit = memo.get(k);
  if (!fresh && hit && Date.now() - hit.at < TTL) return hit.card;
  let card = await labCardIn(m, t, fresh);
  // the other market only for a ticker typed by hand (strict = it came from a list that already says its market)
  // zzz1292b — a US-tagged entry not found in the USA may be an Indian company filed under the wrong market (portfolio entries ICL, SUMAX…);
  // an India-tagged one never jumps to a US ticker of the same letters
  if (!card.ok && t && !(strict && m === 'IN')) {
    const other: LabMarket = m === 'US' ? 'IN' : 'US';
    const alt = await labCardIn(other, t, fresh);
    if (alt.ok) card = { ...alt, movedFrom: m, notes: [`filed under ${m === 'US' ? 'the USA' : 'India'} in your list, found in ${other === 'US' ? 'the USA' : 'India'}`, ...(alt.notes || [])] };
  }
  if (res.note && card.ok) card = { ...card, notes: [res.note, ...(card.notes || [])] };
  // zzz1293 — 0ZQ / 3N8 / K3R: short codes with a digit are European exchange codes (Frankfurt / XETRA), not US tickers
  const euro = m === 'US' && /^[A-Z0-9]{2,4}$/.test(t0) && /\d/.test(t0);
  if (!card.ok) card = { ...card, ticker: t0, error: euro ? `${t0} looks like a European exchange code (Frankfurt / XETRA), not a US ticker — add the company under its US symbol (or its home-market symbol) instead` : `${t0} not found in the ${m === 'US' ? 'US' : 'India'} data${strict ? '' : ' or the other market'}${res.suggest.length ? ` — did you mean ${res.suggest.join(', ')}?` : ' — check the symbol'}`, suggest: euro ? [] : res.suggest };
  if (memo.size > 300) memo.clear();
  memo.set(k, { at: Date.now(), card });
  return card;
}

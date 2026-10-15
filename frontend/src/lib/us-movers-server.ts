// ═══════════════════════════════════════════════════════════════════════════
// zzz1056 — US TOP MOVERS · TOP LOSERS — server side (fetching). Pure rules live in us-movers.ts / us-movers-catalysts.ts.
//
// SOURCES, most reliable first:
//   prices   — TradingView's public US scanner, ONE request for the whole exchange-listed common-stock universe
//              ≥ $300M (≈3,000 rows: move, price, cap, volume, 30-day average volume, sector, INDUSTRY, 52-week high,
//              1-month performance, 50-day average). Live during the session; after the close it is today's completed
//              session; before the open it is the last completed session (the scanner's `change` is the last session's
//              until 09:30). Fallback: the Stock Screener US snapshot (Postgres, built after the close) — labelled as such.
//   WHY      — graded US results (/api/v1/earnings/graded-us, cache_only — the day is queued there, never computed on
//              this request's clock), and for a results 8-K the day's grade does not hold yet, an ON-DEMAND grade of that
//              one filing (us-movers-results.ts); SEC EDGAR filing lists (fetchEdgarResearch, cached per name) with what
//              each 8-K announced (EX-99.1 headline / body, cached per filing); Nasdaq press releases / Google News
//              (entity-matched, direction-checked); insider Forms 4 (open-market trades); the INDUSTRY moving together
//              (over the whole scanner universe); the broad sector; the Nasdaq earnings calendar for "earnings due".
//   Q        — the Stock Screener US snapshot's company figures (revenue growth, margin, FCF, Rule of 40, accumulation).
//
// Memory only (no Redis): one answer per mode, 3 min while the US session is live, 15 min otherwise; a stale answer is
// served at once while a fresh one is built in the background (single flight). zzz1059: the app scheduler prewarms the
// build 5 + 20 min after the close and at 09:45 ET (prewarmUsMovers), so the owner never waits for a cold build.
// ═══════════════════════════════════════════════════════════════════════════

import { classifyUsFiling, usItemsOf, usFormOf, isNyseTradingDay } from './ai-gainers/us-gainers';
import { fetchEdgarResearch, fetchUsPressFallback, fetchEdgarDocuments, secRawHtml } from './ai-gainers/edgar-research';
import { entityMatch } from './ai-gainers/news-context';
import { etParts } from './ai-gainers/us-gainers';
import { loadSnapshot } from './screener/tv-replacement-server';
import type { ScreenRow } from './screener/types';
import {
  filterUsUniverse, topMovers, usSessionNotice, usMoversTtlMs, attributeUsMover, usMoveQuality, sectorMoves, usBreadth,
  avgDollarVolM, whyCoverage, inMoveWindow,
  type UsQuoteRow, type UsMoversMode, type UsMoversPayload, type UsMoverRow, type UsEarningsLite, type UsFilingLite, type UsNewsLite,
  type UsFundamentals, type FilingClass, type UsWhyInput,
} from './us-movers';
import {
  industryStats, industryCluster, eightKAnnouncement, parseForm4Xml, insiderSummary, insiderWhyText, form4XmlUrl, earningsDueText,
  type InsiderSummary,
} from './us-movers-catalysts';
import { quickUsResults } from './us-movers-results';

const SCAN_URL = 'https://scanner.tradingview.com/america/scan';
const COLS = ['name', 'description', 'exchange', 'change', 'close', 'market_cap_basic', 'volume', 'average_volume_30d_calc',
  'relative_volume_10d_calc', 'sector', 'price_52_week_high', 'Perf.1M', 'SMA50', 'industry'] as const;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function scanBody() {
  return {
    filter: [
      { left: 'market_cap_basic', operation: 'egreater', right: 3e8 },
      { left: 'close', operation: 'egreater', right: 3 },
      { left: 'exchange', operation: 'in_range', right: ['NASDAQ', 'NYSE', 'AMEX'] },
      { left: 'type', operation: 'equal', right: 'stock' },
      { left: 'subtype', operation: 'in_range', right: ['common', 'foreign-issuer', ''] },
      { left: 'is_primary', operation: 'equal', right: true },
    ],
    options: { lang: 'en' },
    columns: COLS,
    sort: { sortBy: 'change', sortOrder: 'desc' },
    range: [0, 6000],
  };
}

export function rowFromScanData(d: unknown): UsQuoteRow | null {
  if (!Array.isArray(d)) return null;
  const g = (c: typeof COLS[number]) => d[COLS.indexOf(c)];
  const ticker = String(g('name') || '').trim().toUpperCase();
  if (!ticker) return null;
  const mc = num(g('market_cap_basic'));
  return {
    ticker, company: String(g('description') || ''), exchange: String(g('exchange') || '').toUpperCase(),
    chg: num(g('change')), price: num(g('close')), mcapM: mc != null ? mc / 1e6 : null,
    volume: num(g('volume')), avgVol: num(g('average_volume_30d_calc')), relVol: num(g('relative_volume_10d_calc')),
    sector: typeof g('sector') === 'string' && g('sector') ? String(g('sector')) : null,
    industry: typeof g('industry') === 'string' && g('industry') ? String(g('industry')) : null,
    hi52: num(g('price_52_week_high')), perf1M: num(g('Perf.1M')), sma50: num(g('SMA50')),
  };
}

async function scanUniverse(): Promise<{ rows: UsQuoteRow[]; error: string | null }> {
  let err = 'unknown error';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(SCAN_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(scanBody()), signal: AbortSignal.timeout(12_000), cache: 'no-store',
      } as RequestInit);
      if (!r.ok) err = `HTTP ${r.status}`;
      else {
        const j: any = await r.json();
        const rows = (Array.isArray(j?.data) ? j.data : []).map((x: any) => rowFromScanData(x?.d)).filter(Boolean) as UsQuoteRow[];
        if (rows.length) return { rows, error: null };
        err = 'empty answer';
      }
    } catch (e: any) { err = String(e?.message || e).slice(0, 120); }
    if (attempt === 0) await new Promise((res) => setTimeout(res, 700));
  }
  return { rows: [], error: `US scanner failed (${err})` };
}

function rowFromSnapshot(s: ScreenRow): UsQuoteRow {
  return {
    ticker: s.t, company: s.n, exchange: (s.exch && s.exch[0]) || '',
    chg: s.chg, price: s.px, mcapM: s.mc, volume: s.vol, avgVol: s.avgVol30 ?? s.avgVol10 ?? null, relVol: s.rvol ?? null,
    sector: s.tvSec ?? s.sec ?? null, industry: s.ind ?? null, hi52: s.hi52 ?? null, perf1M: s.perf1M ?? null, sma50: s.sma50,
  };
}

function fundOf(s: ScreenRow | undefined): UsFundamentals | null {
  if (!s) return null;
  return { revQYoY: s.revQYoY, opmTTM: s.opmTTM, fcfm: s.fcfmT ?? s.fcfmTTM ?? null, r40: s.r40T ?? s.r40 ?? null, accG: s.accG ?? null, rsR: s.rsR ?? null };
}

// ── graded earnings (cache_only — the grading engine is never run on this request's clock; prio=1 moves the day up the
//    graded-us queue, so an ungraded day is graded in the background for the next refresh) ──────────────────────────────
/** One graded-us row → the WHY's earnings record (GAAP and adjusted EPS kept apart). Pure. */
export function liteFromGradedRow(row: any, fallbackDate: string, tier: string | null): UsEarningsLite | null {
  const t = String(row?.ticker || '').toUpperCase();
  if (!t) return null;
  return {
    ticker: t, filing_date: String(row.filing_date || fallbackDate).slice(0, 10), quarter: row.quarter || null,
    sales_yoy_pct: num(row.sales_yoy_pct), eps_yoy_pct: num(row.eps_yoy_pct), eps_swing: row.eps_swing || null,
    net_profit_yoy_pct: num(row.net_profit_yoy_pct), tier: row.tier || tier || null,
    ...('eps_gaap_yoy_pct' in (row || {}) || 'eps_adj_yoy_pct' in (row || {})
      ? { eps_gaap_yoy_pct: num(row.eps_gaap_yoy_pct), eps_adj_yoy_pct: num(row.eps_adj_yoy_pct), eps_adj_swing: row.eps_adj_swing || null }
      : {}),
    guidance: typeof row.guidance === 'string' ? row.guidance : null,
    prelim: !!row.prelim_source,
    via: row.prelim_source ? 'graded results (prelim — press release, 10-Q not posted)' : 'graded results (SEC 8-K 2.02 + XBRL)',
  };
}

async function gradedFor(base: string, dates: string[]): Promise<{ rows: Map<string, UsEarningsLite>; pending: string[] }> {
  const out = new Map<string, UsEarningsLite>();
  const pending: string[] = [];
  await Promise.all(dates.map(async (d) => {
    try {
      const r = await fetch(`${base}/api/v1/earnings/graded-us?date=${d}&days=1&cache_only=1&prio=1`, { signal: AbortSignal.timeout(8_000), cache: 'no-store' });
      if (!r.ok) return;
      const j: any = await r.json();
      if (j?.pending) pending.push(d);
      if (!j?.by_tier) return;
      for (const tier of Object.keys(j.by_tier)) for (const row of Array.isArray(j.by_tier[tier]) ? j.by_tier[tier] : []) {
        const lite = liteFromGradedRow(row, d, tier);
        if (!lite) continue;
        const prev = out.get(lite.ticker);
        if (prev && prev.filing_date >= lite.filing_date) continue;
        out.set(lite.ticker, lite);
      }
    } catch { /* that day is simply not known here */ }
  }));
  return { rows: out, pending };
}

// ── per-name caches (memory) ───────────────────────────────────────────────────────────────────────────────────────
interface FilingsHit { rows: UsFilingLite[] | null; insiders: Array<{ form: string; dateIso: string; url: string }> }
const filingMem = new Map<string, { at: number; v: FilingsHit }>();
const newsMem = new Map<string, { at: number; rows: UsNewsLite[] | null }>();
const announcedMem = new Map<string, { at: number; text: string | null }>();        // per 8-K url (immutable)
const resultsMem = new Map<string, { at: number; v: UsEarningsLite | null }>();      // per ticker + 8-K url
const form4Mem = new Map<string, { at: number; v: InsiderSummary | null }>();         // per Form 4 url (immutable)
const FILING_TTL = 2 * 3600_000, FILING_TTL_LIVE = 20 * 60_000, NEWS_TTL = 30 * 60_000;
const trim = (m: Map<string, unknown>, max = 1500) => { while (m.size > max) m.delete(m.keys().next().value as string); };

async function filingsFor(ticker: string, live: boolean): Promise<FilingsHit> {
  const hit = filingMem.get(ticker);
  if (hit && Date.now() - hit.at < (live ? FILING_TTL_LIVE : FILING_TTL)) return hit.v;
  let v: FilingsHit = { rows: null, insiders: [] };
  try {
    const r = await fetchEdgarResearch(ticker, 5, new Date(), { timeoutMs: 7_000, readOwnership: false, pressFallback: false });
    // a ticker that is not an SEC filer (some foreign issuers) has nothing to show: an empty list, not "not checked"
    v = {
      rows: r.failure && r.failure !== 'cik_not_found' ? null : (r.announcements || []).map((a) => ({ subject: a.subject, url: a.url || null, dateIso: a.dateIso || null })),
      insiders: r.insiderFilings || [],
    };
  } catch { /* not checked */ }
  filingMem.set(ticker, { at: Date.now(), v }); trim(filingMem);
  return v;
}

async function newsFor(ticker: string, company: string): Promise<UsNewsLite[] | null> {
  const hit = newsMem.get(ticker);
  if (hit && Date.now() - hit.at < NEWS_TTL) return hit.rows;
  let rows: UsNewsLite[] | null = null;
  try {
    const p = await fetchUsPressFallback(ticker, company || null, { timeoutMs: 5_000, windowDays: 5 });
    rows = p.status === 'OK' || p.items.length
      ? p.items
        .filter((it) => it.title && entityMatch(it.title, ticker, company || null).ok)
        .map((it) => {
          const t = it.date ? Date.parse(it.date) : NaN;
          return { title: it.title.replace(/\s+-\s+[^-]{2,60}$/, '').trim(), url: it.url || '', date: Number.isFinite(t) ? etParts(new Date(t)).ymd : '', source: it.publisher || null };
        })
        .filter((n) => n.date)
      : (p.attempts.some((a) => a.ok) ? [] : null);
  } catch { rows = null; }
  newsMem.set(ticker, { at: Date.now(), rows }); trim(newsMem);
  return rows;
}

/** What one 8-K announced (EX-99.1 headline → body sentence), cached per filing. Null = read, nothing stated. */
async function announcedFor(url: string, timeoutMs: number): Promise<string | null | undefined> {
  const hit = announcedMem.get(url);
  if (hit) return hit.text;
  try {
    const docs = await fetchEdgarDocuments(url, timeoutMs);
    if (!docs.length) return undefined;              // not readable now: try again next refresh
    const text = eightKAnnouncement(docs);
    announcedMem.set(url, { at: Date.now(), text }); trim(announcedMem, 600);
    return text;
  } catch { return undefined; }
}

async function form4For(url: string, timeoutMs: number): Promise<InsiderSummary | null> {
  const hit = form4Mem.get(url);
  if (hit) return hit.v;
  const xml = await secRawHtml(form4XmlUrl(url), timeoutMs, 400_000);
  if (!xml) return null;
  const v = insiderSummary(parseForm4Xml(xml));
  form4Mem.set(url, { at: Date.now(), v }); trim(form4Mem, 800);
  return v;
}

/** Run `fn` over `items`, `n` at a time, stopping new work once `deadline` has passed. */
async function pool<T>(items: T[], n: number, deadline: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length && Date.now() < deadline) await fn(items[i++]);
  }));
}

const classify = (f: { subject: string }): FilingClass | null => {
  const c = classifyUsFiling(f);
  return c ? { kind: c.kind as FilingClass['kind'], category: (c.category as string) || null, routineReason: c.routineReason } : null;
};

/** The next `n` NYSE sessions after `ymd`. Pure. */
export function nextNyseSessions(ymd: string, n: number): string[] {
  const out: string[] = [];
  let t = Date.parse(`${ymd}T12:00:00Z`);
  for (let guard = 0; out.length < n && guard < 20; guard++) {
    t += 86_400_000;
    const d = new Date(t).toISOString().slice(0, 10);
    if (isNyseTradingDay(d)) out.push(d);
  }
  return out;
}

/** Who reports in the next 3 sessions (Nasdaq calendar; null on failure). Memory-cached per day by us-nasdaq. */
async function earningsDueMap(session: string, deadline: number): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const { nasdaqEarningsOnDetailed } = await import('./us-nasdaq');
    const days = nextNyseSessions(session, 3);
    const res = await Promise.all(days.map((d) => Promise.race([
      nasdaqEarningsOnDetailed(d).catch(() => ({ rows: [], ok: false })),
      new Promise<{ rows: any[]; ok: boolean }>((r) => setTimeout(() => r({ rows: [], ok: false }), Math.max(1, deadline - Date.now()))),
    ])));
    res.forEach((r, i) => { for (const x of r.rows || []) { const t = String(x?.ticker || '').toUpperCase(); if (t && !out.has(t)) out.set(t, earningsDueText(days[i], x.time)); } });
  } catch { /* context only */ }
  return out;
}

/** The earliest in-window results 8-K (Item 2.02) or periodic report of a name. */
function resultsFilingOf(rows: UsFilingLite[] | null | undefined, win: { session: string; prevSession: string; closeEt: string }): UsFilingLite | null {
  for (const f of rows || []) {
    if (!f.url || !inMoveWindow(f.dateIso, win.session, win.prevSession, win.closeEt)) continue;
    const form = usFormOf(f.subject);
    if ((/^8-K/.test(form) && usItemsOf(f.subject).includes('2.02'))) return f;
  }
  return null;
}

// ── build ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Time budgets. A page request must answer inside the route's 60 s; the scheduler's prewarm has no caller waiting. */
export interface UsMoversBudget { phase1Ms: number; totalMs: number }
export const REQUEST_BUDGET: UsMoversBudget = { phase1Ms: 24_000, totalMs: 44_000 };
export const PREWARM_BUDGET: UsMoversBudget = { phase1Ms: 50_000, totalMs: 90_000 };

export async function buildUsMovers(mode: UsMoversMode, base: string, now: Date = new Date(), budget: UsMoversBudget = REQUEST_BUDGET): Promise<UsMoversPayload> {
  const t0 = Date.now();
  const notice = usSessionNotice(now);
  const win = { session: notice.session, prevSession: notice.prevSession, closeEt: notice.closeEt };
  const notes: string[] = [];
  const snapP = loadSnapshot('US').catch(() => null);
  const dueP = earningsDueMap(notice.session, t0 + 20_000);
  const scan = await scanUniverse();
  const snap = await snapP;
  const snapBy = new Map<string, ScreenRow>();
  for (const r of snap?.rows || []) if (r?.t) snapBy.set(r.t.toUpperCase(), r);

  let source = 'tradingview-scan';
  let sourceNote: string | null = null;
  let all = scan.rows;
  if (!all.length) {
    notes.push(scan.error || 'US scanner gave nothing');
    if (snap?.rows?.length) {
      all = snap.rows.map(rowFromSnapshot);
      source = 'stock-screener-snapshot';
      sourceNote = `US scanner unavailable — moves from the Stock Screener snapshot built ${snap.builtAt} (after a close, not live)`;
    } else source = 'none';
  }
  const uni = filterUsUniverse(all, mode);
  const { gainers, losers } = topMovers(uni.kept, 20);
  const sectors = sectorMoves(uni.kept);
  const secAvg = new Map(sectors.map((s) => [s.sector, s.avg] as const));
  // industries over the WHOLE liquid universe (all caps): peers of a small cap are often bigger companies
  const indStats = industryStats(filterUsUniverse(all, 'all').kept);
  const movers = [...gainers, ...losers];
  const topSet = new Set(movers.map((m) => m.ticker));

  // (a) graded earnings for the shown session and the one before
  const graded = movers.length ? await gradedFor(base, Array.from(new Set([notice.session, notice.prevSession]))) : { rows: new Map<string, UsEarningsLite>(), pending: [] as string[] };
  const earnings = graded.rows;
  const inWin = (e: UsEarningsLite | undefined | null) => !!e && e.filing_date >= notice.prevSession && e.filing_date <= notice.session;

  // (b) filings, then (c) news — biggest moves first, inside a time budget; names explained by graded results skip both
  const deadline1 = t0 + budget.phase1Ms;
  const filings = new Map<string, FilingsHit>();
  const news = new Map<string, UsNewsLite[] | null>();
  const byMove = movers.slice().sort((a, b) => Math.abs(b.chg as number) - Math.abs(a.chg as number));
  // SEC (behind its fair-access gate) and the press routes run side by side; each is cached per name.
  const unexplained = byMove.filter((m) => !inWin(earnings.get(m.ticker)));
  await Promise.all([
    pool(unexplained, 4, deadline1, async (m) => { filings.set(m.ticker, await filingsFor(m.ticker, notice.live)); }),
    pool(unexplained, 8, deadline1, async (m) => { news.set(m.ticker, await newsFor(m.ticker, m.company)); }),
  ]);
  const missed = unexplained.filter((m) => !filings.has(m.ticker) || !news.has(m.ticker)).length;
  if (missed) notes.push(`time budget reached — ${missed} name${missed === 1 ? ' was' : 's were'} not fully checked for filings / news (the row says so; the next refresh continues from the cache)`);

  // (d) zzz1059 — the deeper reads, in a second budget: on-demand results grades, what each 8-K announced, insider Form 4s
  const deadline2 = t0 + budget.totalMs;
  const quick = new Map<string, UsEarningsLite>();
  const resultsTodo = unexplained.map((m) => ({ m, f: resultsFilingOf(filings.get(m.ticker)?.rows, win) })).filter((x) => x.f);
  const annTodo: UsFilingLite[] = [];
  for (const m of unexplained) for (const f of filings.get(m.ticker)?.rows || []) {
    if (!f.url || !/^8-K/.test(usFormOf(f.subject)) || !inMoveWindow(f.dateIso, win.session, win.prevSession, win.closeEt)) continue;
    const c = classify(f);
    if (c && (c.kind === 'unclassified' || c.category === 'quarterly_result' || c.kind === 'negative' || c.kind === 'catalyst')) annTodo.push(f);
  }
  const left = (cap: number) => Math.max(1_000, Math.min(cap, deadline2 - Date.now()));
  await Promise.all([
    pool(resultsTodo, 3, deadline2, async ({ m, f }) => {
      const key = `${m.ticker}|${f!.url}`;
      const hit = resultsMem.get(key);
      let v: UsEarningsLite | null;
      if (hit && Date.now() - hit.at < (hit.v?.tier ? 6 * 3600_000 : 10 * 60_000)) v = hit.v;
      else {
        v = await quickUsResults({
          ticker: m.ticker, company: m.company, filingUrl: f!.url!, filed: String(f!.dateIso || '').slice(0, 10),
          price: m.price, chg: m.chg, hi52: m.hi52, relVol: m.relVol, avgDollarVolM: avgDollarVolM(m),
        }, left(16_000));
        resultsMem.set(key, { at: Date.now(), v }); trim(resultsMem, 400);
      }
      if (v) quick.set(m.ticker, { ...v, other_items: usItemsOf(f!.subject).some((x) => x !== '2.02' && x !== '9.01') });
    }),
    pool(annTodo, 3, deadline2, async (f) => { const a = await announcedFor(f.url!, left(8_000)); if (a !== undefined) f.announced = a; }),
  ]);
  const notGraded = resultsTodo.filter((x) => !quick.get(x.m.ticker)?.tier).map((x) => x.m.ticker);
  if (resultsTodo.length) {
    notes.push(`${resultsTodo.length - notGraded.length} of ${resultsTodo.length} results 8-K${resultsTodo.length === 1 ? '' : 's'} not yet in the day's grade were graded on demand${notGraded.length ? ` (${notGraded.join(', ')}: no validated figures yet — the release's own headline is shown; the day is queued for grading${graded.pending.length ? ` (${graded.pending.join(', ')} pending)` : ''} and the next refresh carries it)` : ''}`);
  }

  const due = await dueP;
  const inputFor = (m: UsQuoteRow, insider?: UsWhyInput['insider']): UsWhyInput => {
    const e = inWin(earnings.get(m.ticker)) ? earnings.get(m.ticker)! : quick.get(m.ticker) || earnings.get(m.ticker) || null;
    const fh = filings.get(m.ticker);
    return {
      ticker: m.ticker, chg: m.chg as number, session: notice.session, prevSession: notice.prevSession, closeEt: notice.closeEt,
      earnings: e, filings: fh ? fh.rows : (inWin(e) ? [] : null),
      news: news.has(m.ticker) ? news.get(m.ticker)! : (inWin(e) ? [] : null), sector: m.sector,
      sectorMovePct: m.sector ? secAvg.get(m.sector) ?? null : null,
      industry: industryCluster({ ticker: m.ticker, chg: m.chg as number, industry: m.industry }, indStats, topSet),
      insider, mcapM: m.mcapM, earningsDue: due.get(m.ticker) || null,
    };
  };

  // (e) insider Form 4s — only for names still without a stock-specific reason (at most 3 filings each)
  const weakKinds = new Set(['INDUSTRY', 'SECTOR', 'NONE']);
  const insTodo = movers.filter((m) => weakKinds.has(attributeUsMover(inputFor(m), classify).kind)
    && (filings.get(m.ticker)?.insiders || []).some((x) => /^4/.test(x.form) && inMoveWindow(x.dateIso, win.session, win.prevSession, win.closeEt)));
  const insiders = new Map<string, NonNullable<UsWhyInput['insider']>>();
  const deadline3 = Math.max(deadline2, Date.now() + 6_000);
  await pool(insTodo, 3, deadline3, async (m) => {
    const fs = (filings.get(m.ticker)?.insiders || []).filter((x) => /^4/.test(x.form) && inMoveWindow(x.dateIso, win.session, win.prevSession, win.closeEt)).slice(0, 3);
    const sums: InsiderSummary[] = [];
    for (const f of fs) { const s = await form4For(f.url, Math.max(1_000, Math.min(6_000, deadline3 - Date.now()))); if (s) sums.push(s); }
    const w = insiderWhyText(sums);
    if (w) insiders.set(m.ticker, { ...w, date: fs[0]?.dateIso?.slice(0, 10) || null, url: fs[0]?.url || null });
  });

  const toRow = (m: UsQuoteRow): UsMoverRow => {
    const inp = inputFor(m, insiders.get(m.ticker) ?? (insTodo.includes(m) ? null : undefined));
    const why = attributeUsMover(inp, classify);
    const sr = snapBy.get(m.ticker);
    const sm = inp.sectorMovePct ?? null;
    const quality = usMoveQuality({ chg: m.chg as number, relVol: m.relVol, price: m.price, hi52: m.hi52, perf1M: m.perf1M, sma50: m.sma50, sectorMovePct: sm, confidence: why.confidence, fund: fundOf(sr) });
    const adv = avgDollarVolM(m);
    const e = inp.earnings;
    return {
      ticker: m.ticker, company: m.company, exchange: m.exchange, chg: Math.round((m.chg as number) * 100) / 100,
      price: m.price, mcapM: m.mcapM != null ? Math.round(m.mcapM) : null, avgDollarVolM: adv != null ? Math.round(adv * 10) / 10 : null,
      relVol: m.relVol != null ? Math.round(m.relVol * 10) / 10 : null, sector: m.sector, industry: m.industry ?? null, why, quality,
      accG: sr?.accG ?? null, earningsTier: inWin(e) ? e!.tier : null, thin: adv != null && adv < 10,
    };
  };
  const g = gainers.map(toRow), l = losers.map(toRow);
  if (!snap) notes.push('Stock Screener snapshot not available — Q uses price / volume only (company figures neutral)');
  return {
    ok: source !== 'none', market: 'US', mode, generatedAt: new Date().toISOString(), notice, source, sourceNote,
    universe: { kept: uni.kept.length, dropped: uni.dropped }, gainers: g, losers: l,
    breadth: usBreadth(sectors, gainers, losers), coverage: whyCoverage([...g, ...l]), notes,
    buildMs: Date.now() - t0,
  };
}

// ── memory cache + single flight ───────────────────────────────────────────────────────────────────────────────────
const cache = new Map<UsMoversMode, { at: number; ttl: number; data: UsMoversPayload }>();
const inflight = new Map<UsMoversMode, Promise<UsMoversPayload>>();

function start(mode: UsMoversMode, base: string, budget: UsMoversBudget = REQUEST_BUDGET): Promise<UsMoversPayload> {
  const f = inflight.get(mode);
  if (f) return f;
  const p = buildUsMovers(mode, base, new Date(), budget)
    .then((data) => { if (data.ok || !cache.get(mode)) cache.set(mode, { at: Date.now(), ttl: usMoversTtlMs(data.notice.phase), data }); return data; })
    .finally(() => inflight.delete(mode));
  inflight.set(mode, p);
  return p;
}

/** The latest answer: fresh from memory, else stale-while-refreshing, else built now. */
export async function getUsMovers(mode: UsMoversMode, base: string): Promise<{ data: UsMoversPayload; cache: 'hit' | 'stale' | 'miss' }> {
  const hit = cache.get(mode);
  if (hit && Date.now() - hit.at < hit.ttl) return { data: hit.data, cache: 'hit' };
  if (hit) { void start(mode, base).catch(() => {}); return { data: hit.data, cache: 'stale' }; }
  return { data: await start(mode, base), cache: 'miss' };
}

/** zzz1059 — the scheduler's prewarm: build both modes now (in this process, whose memory serves the page), one after the
 *  other so the second reuses the first's per-name caches. The loopback base is the one internalBase() picks on Railway. */
export async function prewarmUsMovers(base = `http://127.0.0.1:${process.env.PORT || '3000'}`): Promise<{ ok: boolean; ms: number; coverage: Record<string, number> | null; error?: string }> {
  const t = Date.now();
  try {
    const d = await start('smallmid', base, PREWARM_BUDGET);
    await start('all', base, PREWARM_BUDGET).catch(() => null);
    return { ok: d.ok, ms: Date.now() - t, coverage: d.coverage };
  } catch (e: any) { return { ok: false, ms: Date.now() - t, coverage: null, error: String(e?.message || e).slice(0, 200) }; }
}

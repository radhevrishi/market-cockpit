// ═══════════════════════════════════════════════════════════════════════════
// zzz1056 — US TOP MOVERS · TOP LOSERS — server side (fetching). Pure rules live in us-movers.ts.
//
// SOURCES, most reliable first:
//   prices   — TradingView's public US scanner, ONE request for the whole exchange-listed common-stock universe
//              ≥ $300M (≈3,000 rows: move, price, cap, volume, 30-day average volume, sector, 52-week high, 1-month
//              performance, 50-day average). Live during the session; after the close it is today's completed session;
//              before the open it is the last completed session (the scanner's `change` is the last session's until 09:30).
//              Fallback: the Stock Screener US snapshot (Postgres, built after the close) — labelled as such, never as live.
//   WHY      — graded US results (/api/v1/earnings/graded-us, cache_only — never computes on this request's clock), SEC
//              EDGAR filing lists (fetchEdgarResearch, cached 2 h per name), Nasdaq press releases / Google News
//              (fetchUsPressFallback, cached 30 min per name, entity-matched), the sector's average move.
//   Q        — the Stock Screener US snapshot's company figures (revenue growth, margin, FCF, Rule of 40, accumulation).
//
// Memory only (no Redis): one answer per mode, 3 min while the US session is live, 15 min otherwise; a stale answer is
// served at once while a fresh one is built in the background (single flight).
// ═══════════════════════════════════════════════════════════════════════════

import { classifyUsFiling } from './ai-gainers/us-gainers';
import { fetchEdgarResearch, fetchUsPressFallback } from './ai-gainers/edgar-research';
import { entityMatch } from './ai-gainers/news-context';
import { etParts } from './ai-gainers/us-gainers';
import { loadSnapshot } from './screener/tv-replacement-server';
import type { ScreenRow } from './screener/types';
import {
  filterUsUniverse, topMovers, usSessionNotice, usMoversTtlMs, attributeUsMover, usMoveQuality, sectorMoves, usBreadth,
  avgDollarVolM, whyCoverage,
  type UsQuoteRow, type UsMoversMode, type UsMoversPayload, type UsMoverRow, type UsEarningsLite, type UsFilingLite, type UsNewsLite,
  type UsFundamentals, type FilingClass,
} from './us-movers';

const SCAN_URL = 'https://scanner.tradingview.com/america/scan';
const COLS = ['name', 'description', 'exchange', 'change', 'close', 'market_cap_basic', 'volume', 'average_volume_30d_calc',
  'relative_volume_10d_calc', 'sector', 'price_52_week_high', 'Perf.1M', 'SMA50'] as const;

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
    sector: s.tvSec ?? s.sec ?? null, hi52: s.hi52 ?? null, perf1M: s.perf1M ?? null, sma50: s.sma50,
  };
}

function fundOf(s: ScreenRow | undefined): UsFundamentals | null {
  if (!s) return null;
  return { revQYoY: s.revQYoY, opmTTM: s.opmTTM, fcfm: s.fcfmT ?? s.fcfmTTM ?? null, r40: s.r40T ?? s.r40 ?? null, accG: s.accG ?? null, rsR: s.rsR ?? null };
}

// ── graded earnings (cache_only — the grading engine is never run on this request's clock) ───────────────────────────
async function gradedFor(base: string, dates: string[]): Promise<Map<string, UsEarningsLite>> {
  const out = new Map<string, UsEarningsLite>();
  await Promise.all(dates.map(async (d) => {
    try {
      const r = await fetch(`${base}/api/v1/earnings/graded-us?date=${d}&days=1&cache_only=1`, { signal: AbortSignal.timeout(8_000), cache: 'no-store' });
      if (!r.ok) return;
      const j: any = await r.json();
      if (!j?.by_tier) return;
      for (const tier of Object.keys(j.by_tier)) for (const row of Array.isArray(j.by_tier[tier]) ? j.by_tier[tier] : []) {
        const t = String(row?.ticker || '').toUpperCase();
        if (!t) continue;
        const prev = out.get(t);
        if (prev && prev.filing_date >= String(row.filing_date || '')) continue;
        out.set(t, {
          ticker: t, filing_date: String(row.filing_date || d).slice(0, 10), quarter: row.quarter || null,
          sales_yoy_pct: num(row.sales_yoy_pct), eps_yoy_pct: num(row.eps_yoy_pct), eps_swing: row.eps_swing || null,
          net_profit_yoy_pct: num(row.net_profit_yoy_pct), tier: row.tier || tier || null,
        });
      }
    } catch { /* that day is simply not known here */ }
  }));
  return out;
}

// ── per-name caches (memory) ───────────────────────────────────────────────────────────────────────────────────────
const filingMem = new Map<string, { at: number; rows: UsFilingLite[] | null }>();
const newsMem = new Map<string, { at: number; rows: UsNewsLite[] | null }>();
const FILING_TTL = 2 * 3600_000, FILING_TTL_LIVE = 20 * 60_000, NEWS_TTL = 30 * 60_000;
const trim = (m: Map<string, unknown>) => { while (m.size > 1500) m.delete(m.keys().next().value as string); };

async function filingsFor(ticker: string, live: boolean): Promise<UsFilingLite[] | null> {
  const hit = filingMem.get(ticker);
  if (hit && Date.now() - hit.at < (live ? FILING_TTL_LIVE : FILING_TTL)) return hit.rows;
  let rows: UsFilingLite[] | null = null;
  try {
    const r = await fetchEdgarResearch(ticker, 5, new Date(), { timeoutMs: 7_000, readOwnership: false, pressFallback: false });
    // a ticker that is not an SEC filer (some foreign issuers) has nothing to show: an empty list, not "not checked"
    rows = r.failure && r.failure !== 'cik_not_found' ? null : (r.announcements || []).map((a) => ({ subject: a.subject, url: a.url || null, dateIso: a.dateIso || null }));
  } catch { rows = null; }
  filingMem.set(ticker, { at: Date.now(), rows }); trim(filingMem);
  return rows;
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

// ── build ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function buildUsMovers(mode: UsMoversMode, base: string, now: Date = new Date()): Promise<UsMoversPayload> {
  const t0 = Date.now();
  const notice = usSessionNotice(now);
  const notes: string[] = [];
  const snapP = loadSnapshot('US').catch(() => null);
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
  const movers = [...gainers, ...losers];

  // (a) graded earnings for the shown session and the one before
  const earnings = movers.length ? await gradedFor(base, Array.from(new Set([notice.session, notice.prevSession]))) : new Map();
  const inWin = (e: UsEarningsLite | undefined) => !!e && e.filing_date >= notice.prevSession && e.filing_date <= notice.session;

  // (b) filings, then (c) news — biggest moves first, inside a time budget; names explained by graded results skip both
  const deadline = t0 + 28_000;
  const filings = new Map<string, UsFilingLite[] | null>();
  const news = new Map<string, UsNewsLite[] | null>();
  const byMove = movers.slice().sort((a, b) => Math.abs(b.chg as number) - Math.abs(a.chg as number));
  // SEC (behind its fair-access gate) and the press routes run side by side; each is cached per name.
  const unexplained = byMove.filter((m) => !inWin(earnings.get(m.ticker)));
  await Promise.all([
    pool(unexplained, 4, deadline, async (m) => { filings.set(m.ticker, await filingsFor(m.ticker, notice.live)); }),
    pool(unexplained, 8, deadline, async (m) => { news.set(m.ticker, await newsFor(m.ticker, m.company)); }),
  ]);
  const missed = unexplained.filter((m) => !filings.has(m.ticker) || !news.has(m.ticker)).length;
  if (missed) notes.push(`time budget reached — ${missed} name${missed === 1 ? ' was' : 's were'} not fully checked for filings / news (the row says so; the next refresh continues from the cache)`);

  const toRow = (m: UsQuoteRow): UsMoverRow => {
    const e = earnings.get(m.ticker);
    const sm = m.sector ? secAvg.get(m.sector) ?? null : null;
    const why = attributeUsMover({
      ticker: m.ticker, chg: m.chg as number, session: notice.session, prevSession: notice.prevSession, closeEt: notice.closeEt,
      earnings: e || null, filings: filings.has(m.ticker) ? filings.get(m.ticker)! : (inWin(e) ? [] : null),
      news: news.has(m.ticker) ? news.get(m.ticker)! : (inWin(e) ? [] : null), sector: m.sector, sectorMovePct: sm,
    }, classify);
    const sr = snapBy.get(m.ticker);
    const quality = usMoveQuality({ chg: m.chg as number, relVol: m.relVol, price: m.price, hi52: m.hi52, perf1M: m.perf1M, sma50: m.sma50, sectorMovePct: sm, confidence: why.confidence, fund: fundOf(sr) });
    const adv = avgDollarVolM(m);
    return {
      ticker: m.ticker, company: m.company, exchange: m.exchange, chg: Math.round((m.chg as number) * 100) / 100,
      price: m.price, mcapM: m.mcapM != null ? Math.round(m.mcapM) : null, avgDollarVolM: adv != null ? Math.round(adv * 10) / 10 : null,
      relVol: m.relVol != null ? Math.round(m.relVol * 10) / 10 : null, sector: m.sector, why, quality,
      accG: sr?.accG ?? null, earningsTier: inWin(e) ? e!.tier : null, thin: adv != null && adv < 10,
    };
  };
  const g = gainers.map(toRow), l = losers.map(toRow);
  if (!snap) notes.push('Stock Screener snapshot not available — Q uses price / volume only (company figures neutral)');
  return {
    ok: source !== 'none', market: 'US', mode, generatedAt: new Date().toISOString(), notice, source, sourceNote,
    universe: { kept: uni.kept.length, dropped: uni.dropped }, gainers: g, losers: l,
    breadth: usBreadth(sectors, gainers, losers), coverage: whyCoverage([...g, ...l]), notes,
  };
}

// ── memory cache + single flight ───────────────────────────────────────────────────────────────────────────────────
const cache = new Map<UsMoversMode, { at: number; ttl: number; data: UsMoversPayload }>();
const inflight = new Map<UsMoversMode, Promise<UsMoversPayload>>();

function start(mode: UsMoversMode, base: string): Promise<UsMoversPayload> {
  const f = inflight.get(mode);
  if (f) return f;
  const p = buildUsMovers(mode, base)
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

// Options Ideas — server side: one company on demand, the scheduled scan, and the live track record.
//
//   analyseTicker(market, ticker)   daily bars (2 years) + benchmark → findSetups → grade (model.ts) → option plan (live chain
//                                   when it can be read, else model prices) → Idea[] or a clear "no valid setup"
//   runScan(market)                 the optionable universe: USA = liquid names from the stock-screener snapshot (≥ $2B,
//                                   ≥ $20M traded a day), India = NSE F&O stocks. Saved to KV options-ideas:v1:scan:<market>.
//                                   Grade A / B ideas are logged for the track record.
//   gradeLog()                      follows every logged idea with the same rules as the study (fill within 5 sessions,
//                                   stop / target 1 / 40-session time limit) and stores the outcome.
import { getDailySeries } from '../chart-data';
import { kvGet, kvSet, kvMGet } from '../kv';
import { extraCtx, sectorMedians } from './context';
import { GRADE_ORDER } from './model';
import { getSnapshot } from '../screener/snapshot-cache';
import type { PBar } from '../chart-patterns';
import { findSetups, describeStructure, type Structure, SETUP_META, SETUPS_VERSION, type Setup, type SetupId } from './setups';
import { fearHigh, FEAR_VIX } from './model';
import { classify, finalGrade, historyFor, indexCtx, rawFromSetup, type Classified, type GroupStats, type Grade } from './model';
import { planOption, type OptionPlan, pickExpiry, syntheticExpiries } from './options';
import { usChain, inChain, nseLots, chainError } from './chain';
import { simulate, barMs } from './backtest';
import { STUDY } from './model-coeffs';

export type Mkt = 'US' | 'IN';
export const BENCH: Record<Mkt, string> = { US: 'SPY', IN: 'NIFTYBEES' };
export const SCAN_KEY = (m: Mkt) => `options-ideas:v1:scan:${m}`;
export const LOG_KEY = 'options-ideas:v1:log';
const LOG_MAX = 3000;

export interface Idea {
  market: Mkt; ticker: string; name: string | null; price: number; asOf: string;
  setup: Omit<Setup, 'lines'> & { lines: Setup['lines'] };
  grade: Grade; verdict: string; checks: Classified['checks']; strength: string; regime: string;
  history: { group: GroupStats | null; setup: GroupStats | null };
  option: OptionPlan | null;
  plan: { entry: string; target: string; stop: string; manage: string; why: string };
  mc: number | null; cap: 'small' | 'mid' | 'large' | null;
  /** set when this group made money in the study overall but lost money after the hold-out date */
  caution: string | null;
  /** zzz1301e — context: catalyst, volatility, sector */
  ctx: { gapDaysAgo: number | null; rvol: number; hvPct: number; hv20: number; adr: number; stopInAdr: number | null; t1InAdr: number | null; sector: string | null; industry: string | null; sectorRet3m: number | null; indexRet3m: number | null; nextResults: string | null };
}
export interface Regime { bench: string; vs200: number; ret20: number; up: boolean; label: string }
export function regimeOf(m: Mkt, idx: { vs200: number; ret20: number } | null, vix: number | null = null): Regime | null {
  if (!idx) return null;
  const fear = fearHigh(m, vix);
  const up = (idx.vs200 > 0 && idx.ret20 > 0) || fear;
  const bench = m === 'US' ? 'S&P 500 (SPY)' : 'Nifty 50 (NIFTYBEES)';
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return { bench, vs200: r1(idx.vs200), ret20: r1(idx.ret20), up, label: fear ? `Fear is high: ${m === 'US' ? 'VIX' : 'India VIX'} ${vix!.toFixed(1)} (fear line ${FEAR_VIX[m]}). Over 10 years calls bought in fear made +0.49× the risk a trade — calls can reach grade A now, even with ${bench} ${idx.vs200 >= 0 ? 'above' : 'below'} its 200-day. Buying puts now was the worst trade.` : up ? `${bench} is ${r1(idx.vs200)}% above its 200-day average and up ${r1(idx.ret20)}% in 20 sessions — calls can reach grade A.` : `${bench} is ${Math.abs(r1(idx.vs200))}% ${idx.vs200 >= 0 ? 'above' : 'below'} its 200-day average and ${idx.ret20 >= 0 ? 'up' : 'down'} ${Math.abs(r1(idx.ret20))}% in 20 sessions — no call reaches grade A until the market is above its 200-day AND rising, or fear gets high (${m === 'US' ? 'VIX' : 'India VIX'} ≥ ${FEAR_VIX[m]}${vix != null ? `, now ${vix.toFixed(1)}` : ''}). Buying puts here did not pay either — over 10 years falling markets bounced hard.` };
}
export interface TickerResult { structure?: Structure | null; regime?: Regime | null; chainNote?: string | null; ok: boolean; market: Mkt; ticker: string; name: string | null; price: number | null; asOf: string | null; ideas: Idea[]; noSetup: string | null; error?: string; bars?: Array<[number, number, number, number, number]> }

const toP = (b: { t: number; o: number; h: number; l: number; c: number; v: number }[]): PBar[] => b.filter((q) => q && q.l > 0 && Number.isFinite(q.c)).map((q) => ({ t: q.t, o: q.o, h: q.h, l: q.l, c: q.c, v: q.v || 0 }));
const fmt = (m: Mkt, x: number) => `${m === 'US' ? '$' : '₹'}${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function capOf(m: Mkt, mc: number | null | undefined): Idea['cap'] {
  if (mc == null || !(mc > 0)) return null;
  // US $ million, India ₹ crore
  return m === 'US' ? (mc < 2000 ? 'small' : mc < 10000 ? 'mid' : 'large') : (mc < 20000 ? 'small' : mc < 75000 ? 'mid' : 'large');
}

// sector map + medians from the screener snapshot (30 min)
const secMemo = new Map<Mkt, { at: number; by: Map<string, { sec: string | null; ind: string | null }>; med: Map<string, number> }>();
export async function sectorInfo(m: Mkt) {
  const h = secMemo.get(m);
  if (h && Date.now() - h.at < 30 * 60_000) return h;
  const snap = await getSnapshot(m).catch(() => null);
  const rows: any[] = snap?.rows ?? [];
  const by = new Map<string, { sec: string | null; ind: string | null }>();
  for (const r of rows) by.set(String(r.t).toUpperCase(), { sec: r.tvSec ?? r.sec ?? null, ind: r.ind ?? null });
  // the same universe the replay used: liquid, larger companies (US ≥ $2B, India ≥ ₹10,000 Cr) — small caps would pull every
  // sector below the index in a narrow, large-cap rally
  const minMc = m === 'US' ? 2000 : 10000;
  const med = sectorMedians(rows.filter((r) => (r.mc ?? 0) >= minMc).map((r) => ({ sec: r.tvSec ?? r.sec ?? null, perf3M: typeof r.perf3M === 'number' ? r.perf3M : null })));
  const v = { at: Date.now(), by, med };
  if (rows.length) secMemo.set(m, v);
  return v;
}
// next results dates: USA from Nasdaq's earnings calendar (per day, 12 h), India from the stored board-meeting calendar
const resMemo = new Map<string, { at: number; rows: string[] }>();
export async function nextResultsMap(m: Mkt, days = 60): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const dates: string[] = [];
  for (let i = 0; i <= days; i++) { const d = new Date(Date.now() + i * 86_400_000); if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) dates.push(d.toISOString().slice(0, 10)); }
  if (m === 'IN') {
    const vals = await kvMGet<string[]>(dates.map((d) => `earnings-cal:auto:${d}`)).catch(() => [] as any[]);
    dates.forEach((d, i) => { for (const t of (vals?.[i] as string[] | null) ?? []) { const k = String(t).toUpperCase(); if (!out.has(k)) out.set(k, d); } });
    return out;
  }
  const { nasdaqEarningsOn } = await import('../us-nasdaq');
  for (const d of dates) {
    const k = `US:${d}`, h = resMemo.get(k);
    let rows = h && Date.now() - h.at < 12 * 3600_000 ? h.rows : null;
    if (!rows) { rows = (await nasdaqEarningsOn(d).catch(() => [])).map((r: any) => String(r.ticker || r.symbol || '').toUpperCase()).filter(Boolean); resMemo.set(k, { at: Date.now(), rows }); }
    for (const t of rows) if (!out.has(t)) out.set(t, d);
  }
  return out;
}
let resMapMemo: Record<string, { at: number; map: Map<string, string> }> = {};
async function resultsFor(m: Mkt, t: string): Promise<string | null> {
  const h = resMapMemo[m];
  if (!h || Date.now() - h.at > 6 * 3600_000) resMapMemo[m] = { at: Date.now(), map: await nextResultsMap(m).catch(() => new Map()) };
  return resMapMemo[m].map.get(t.toUpperCase()) ?? null;
}

const benchMemo = new Map<Mkt, { at: number; bars: PBar[] }>();
async function benchBars(m: Mkt): Promise<PBar[]> {
  const h = benchMemo.get(m);
  if (h && Date.now() - h.at < 30 * 60_000) return h.bars;
  const s = await getDailySeries(m, BENCH[m], '2y').catch(() => null);
  const bars = s?.bars?.length ? toP(s.bars) : h?.bars ?? [];
  benchMemo.set(m, { at: Date.now(), bars });
  return bars;
}

function planWords(m: Mkt, s: Setup): Idea['plan'] {
  const call = s.side === 'CALL';
  return {
    entry: s.triggered ? `Triggered — ${call ? 'above' : 'below'} ${fmt(m, s.trigger)} now (close ${fmt(m, s.entry)}). Enter only if it still holds ${call ? 'above' : 'below'} ${fmt(m, s.trigger)}.` : `Enter when the stock trades ${call ? 'above' : 'below'} ${fmt(m, s.trigger)} within the next 5 sessions; if it ${call ? 'falls to' : 'rises to'} ${fmt(m, s.stop)} first, the idea is dead.`,
    target: `Target 1 ${fmt(m, s.target1)} (${s.rr1}× the risk) · target 2 ${fmt(m, s.target2)}.`,
    stop: `Invalidation: a ${call ? 'trade below' : 'trade above'} ${fmt(m, s.stop)} (${s.riskPct}% from the entry) — the structure has failed.`,
    manage: 'Once the stock is up 1× the risk, move the stop to the entry. Take half at target 1, let the rest run to target 2. Close everything after 40 sessions or 7 days before expiry, whichever is first.',
    why: SETUP_META[s.id].why,
  };
}

export async function analyseTicker(market: Mkt, tickerIn: string, opts: { chain?: boolean; bars?: boolean; mc?: number | null; name?: string | null; lotSize?: number | null } = {}): Promise<TickerResult> {
  const ticker = tickerIn.trim().toUpperCase();
  const base: TickerResult = { ok: false, market, ticker, name: opts.name ?? null, price: null, asOf: null, ideas: [], noSetup: null };
  const s = await getDailySeries(market, ticker, '2y').catch(() => null);
  if (!s?.bars?.length) return { ...base, error: 'No price history found for this ticker.' };
  const bars = toP(s.bars);
  if (bars.length < 260) return { ...base, name: s.name ?? base.name, error: `Only ${bars.length} sessions of history — setups need at least 260.` };
  const last = bars[bars.length - 1];
  const asOf = new Date(barMs(last.t)).toISOString().slice(0, 10);
  const out: TickerResult = { ...base, ok: true, name: s.name ?? base.name, price: last.c, asOf };
  if (opts.bars) out.bars = bars.slice(-260).map((q) => [q.t, q.o, q.h, q.l, q.c]);
  const setups = findSetups(bars);
  if (!setups.length) {
    out.noSetup = 'No good setup today: no trendline or level with 3+ touches is being tested or broken right now with a reward at least 1.5× the risk, and no cup is at its rim. Nothing to trade on this company yet — the levels below show what to wait for.';
    if (opts.bars) out.structure = describeStructure(bars);
    return out;
  }
  const idx = indexCtx(await benchBars(market), barMs(last.t));
  const ex = extraCtx(bars);
  const si = await sectorInfo(market).catch(() => null);
  const secRow = si?.by.get(ticker) ?? null;
  const secMed = secRow?.sec ? si?.med.get(secRow.sec) ?? null : null;
  const secStrong = secMed != null && idx ? secMed > idx.ret60 : null;
  const nextRes = await resultsFor(market, ticker).catch(() => null);
  const vixNow = await (async () => { try { const { marketPanel } = await import('./market-panel'); return (await marketPanel()).find((p) => p.market === market)?.vix?.last ?? null; } catch { return null; } })();
  out.regime = regimeOf(market, idx, vixNow);
  let lot = opts.lotSize ?? null;
  if (market === 'IN' && lot == null) lot = (await nseLots().catch(() => null))?.[ticker] ?? null;
  for (const st of setups) {
    const raw = rawFromSetup(st, market, bars, idx, { secStrong, gap60: ex.gap60, rvol: ex.rvol, hvPct: ex.hvPct, vix: vixNow });
    const cls = finalGrade(raw, classify(raw));
    const hist = historyFor(raw, cls.grade);
    const expSessions = hist.setup?.medSessions || hist.group?.medSessions || 12;
    let chain = null;
    if (opts.chain && cls.grade !== 'C') {
      const pickFn = (exps: string[]) => { const now = Date.now(); return exps.filter((e) => { const d = (Date.parse(e) - now) / 86_400_000; return d >= 14 && d <= 120; }).slice(0, 6); };
      chain = market === 'US' ? await usChain(ticker, pickFn).catch(() => null) : await inChain(ticker).catch(() => null);
    }
    const closes = bars.slice(-90).map((q) => q.c);
    const option = market === 'IN' && lot == null && !chain ? null
      : planOption({ market, call: st.side === 'CALL', spot: st.triggered ? last.c : st.entry, entry: st.entry, stop: st.stop, target1: st.target1, target2: st.target2, expSessions, closes, now: new Date(), chain, lotSize: lot, targetDelta: STUDY.option.delta || 0.5, minDte: STUDY.option.minDte || 30, nextEarnings: nextRes, hvPct: ex.hvPct });
    if (option && !st.triggered) option.notes.push(`Priced as if bought when the stock reaches the trigger (${fmt(market, st.trigger)}); today it is ${fmt(market, last.c)}.`);
    if (option && market === 'IN' && lot == null) option.notes.push('No F&O lot size found — this company may not have stock options on NSE.');
    out.ideas.push({
      market, ticker, name: out.name, price: last.c, asOf, setup: st,
      grade: cls.grade, verdict: cls.verdict, checks: cls.checks, strength: cls.strength, regime: cls.regime,
      history: { group: hist.group, setup: hist.setup }, option, plan: planWords(market, st), mc: opts.mc ?? null, cap: capOf(market, opts.mc ?? null),
      ctx: { gapDaysAgo: ex.gapDaysAgo, rvol: ex.rvol, hvPct: ex.hvPct, hv20: ex.hv20, adr: ex.adr, stopInAdr: ex.adr > 0 ? Math.round((st.riskPct / ex.adr) * 10) / 10 : null, t1InAdr: ex.adr > 0 ? Math.round((Math.abs(st.target1 / st.entry - 1) * 100 / ex.adr) * 10) / 10 : null, sector: secRow?.sec ?? null, industry: secRow?.ind ?? null, sectorRet3m: secMed != null ? Math.round(secMed * 10) / 10 : null, indexRet3m: idx ? Math.round(idx.ret60 * 10) / 10 : null, nextResults: nextRes },
      caution: (cls.grade === 'A' || cls.grade === 'A+') && hist.group && hist.group.testR < 0 ? `Caution: ${market === 'US' ? 'USA' : 'India'} grade A calls lost ${hist.group.testR} R a trade after ${STUDY.trainedOn.testFrom} (they made ${hist.group.trainR} R before). Size smaller until the live record turns.` : null,
    });
  }
  if (market === 'IN' && lot == null) out.noSetup = out.noSetup ?? null;
  if (opts.chain) out.chainNote = chainError.get(`${market === 'US' ? 'us' : 'in'}:${ticker}`) ?? null;
  out.ideas.sort((a, b) => GRADE_ORDER[a.grade] - GRADE_ORDER[b.grade] || b.setup.quality - a.setup.quality);
  return out;
}

// ─── scan ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface ScanUniverseItem { ticker: string; name: string | null; mc: number | null; lot?: number | null }
export async function scanUniverse(m: Mkt): Promise<ScanUniverseItem[]> {
  const snap = await getSnapshot(m).catch(() => null);
  const rows: any[] = snap?.rows ?? [];
  if (m === 'US') {
    return rows.filter((r) => r.px >= 10 && r.mc >= 2000 && (r['adv$'] ?? 0) >= 20 && !/ETF|Trust|Fund/i.test(r.n || ''))
      .sort((a, b) => (b['adv$'] ?? 0) - (a['adv$'] ?? 0)).slice(0, 450)
      .map((r) => ({ ticker: String(r.t), name: r.n ?? null, mc: r.mc ?? null }));
  }
  const lots = await nseLots().catch(() => null);
  const byT = new Map(rows.map((r) => [String(r.t).toUpperCase(), r]));
  if (lots) return Object.keys(lots).map((t) => ({ ticker: t, name: byT.get(t)?.n ?? null, mc: byT.get(t)?.mc ?? null, lot: lots[t] }));
  return rows.filter((r) => r.mc >= 15000).sort((a, b) => b.mc - a.mc).slice(0, 220).map((r) => ({ ticker: String(r.t), name: r.n ?? null, mc: r.mc ?? null }));
}

export interface ScanSnapshot { regime?: Regime | null; market: Mkt; builtAt: string; version: string; scanned: number; failed: number; ideas: Idea[]; counts: { 'A+': number; A: number; B: number; C: number }; tookS: number }
async function pooled<T>(items: T[], n: number, fn: (x: T) => Promise<void>, deadline: number) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length && Date.now() < deadline) { const x = items[i++]; await fn(x).catch(() => {}); } }));
}
export async function runScan(m: Mkt, budgetMs = 14 * 60_000): Promise<ScanSnapshot> {
  const t0 = Date.now();
  const uni = await scanUniverse(m);
  const ideas: Idea[] = [];
  let scanned = 0, failed = 0;
  await pooled(uni, 4, async (u) => {
    const r = await analyseTicker(m, u.ticker, { chain: false, mc: u.mc, name: u.name, lotSize: u.lot ?? null });
    if (r.ok) scanned++; else failed++;
    for (const i of r.ideas) if (i.grade !== 'C') ideas.push(i);
  }, t0 + budgetMs);
  // live chains for the best ideas only (A first), so the plan uses real premiums where it can
  ideas.sort((a, b) => GRADE_ORDER[a.grade] - GRADE_ORDER[b.grade] || b.setup.quality - a.setup.quality);
  const top = ideas.filter((i) => i.grade === 'A' || i.grade === 'A+').slice(0, 25);
  for (const i of top) {
    if (Date.now() > t0 + budgetMs + 3 * 60_000) break;
    const r = await analyseTicker(m, i.ticker, { chain: true, mc: i.mc, name: i.name }).catch(() => null);
    const same = r?.ideas.find((x) => x.setup.id === i.setup.id);
    if (same?.option) i.option = same.option;
  }
  const bb = await benchBars(m);
  const snap: ScanSnapshot = {
    regime: bb.length ? regimeOf(m, indexCtx(bb, barMs(bb[bb.length - 1].t)), await (async () => { try { const { marketPanel } = await import('./market-panel'); return (await marketPanel()).find((p) => p.market === m)?.vix?.last ?? null; } catch { return null; } })()) : null,
    market: m, builtAt: new Date().toISOString(), version: SETUPS_VERSION, scanned, failed,
    ideas: ideas.slice(0, 400), counts: { 'A+': ideas.filter((i) => i.grade === 'A+').length, A: ideas.filter((i) => i.grade === 'A').length, B: ideas.filter((i) => i.grade === 'B').length, C: ideas.filter((i) => i.grade === 'C').length },
    tookS: Math.round((Date.now() - t0) / 1000),
  };
  await kvSet(SCAN_KEY(m), snap, 14 * 86400).catch(() => {});
  await logIdeas(snap.ideas.filter((i) => i.grade !== 'C')).catch(() => {});
  return snap;
}

/** zzz1301e — near the close: read the live option chain again for the stored A+ / A ideas (real bid / ask, OI and spread
 *  while the market is open), so the plan you act on uses end-of-day quotes, not after-hours ones. */
export async function refreshChains(m: Mkt, budgetMs = 6 * 60_000): Promise<{ refreshed: number }> {
  const t0 = Date.now();
  const snap = await readScan(m);
  if (!snap) return { refreshed: 0 };
  let n = 0;
  for (const i of snap.ideas.filter((x) => x.grade === 'A+' || x.grade === 'A').slice(0, 30)) {
    if (Date.now() - t0 > budgetMs) break;
    const r = await analyseTicker(m, i.ticker, { chain: true, mc: i.mc, name: i.name }).catch(() => null);
    const same = r?.ideas.find((x) => x.setup.id === i.setup.id);
    if (same?.option) { i.option = same.option; i.price = same.price; n++; }
  }
  (snap as any).chainsAt = new Date().toISOString();
  await kvSet(SCAN_KEY(m), snap, 14 * 86400).catch(() => {});
  return { refreshed: n };
}

// ─── live track record ───────────────────────────────────────────────────────────────────────────────────────────────────
export interface LogEntry {
  key: string; market: Mkt; ticker: string; id: SetupId; side: 'CALL' | 'PUT'; grade: Grade; date: string;
  trigger: number; triggered: boolean; entry: number; stop: number; target1: number; target2: number; rr1: number; quality: number;
  premium: number | null; strike: number | null; expiry: string | null;
  status: 'open' | 'nofill' | 'target' | 'stop' | 'timeout'; r: number | null; sessions: number | null; gradedAt: string | null;
  /** result with the plan's management (stop to entry at +1R, target 2); null until that exit is known */
  rTrail?: number | null;
  /** market state when logged (for slicing the record) */
  regimeUp?: boolean | null; hvPct?: number | null; catalyst?: boolean | null;
}
export async function readLog(): Promise<LogEntry[]> { return ((await kvGet<LogEntry[]>(LOG_KEY).catch(() => null)) ?? []); }
async function logIdeas(ideas: Idea[]) {
  if (!ideas.length) return;
  const log = await readLog();
  const have = new Set(log.map((e) => e.key));
  // the same setup on the same company within 10 days is the same idea
  const recent = new Map<string, string>();
  for (const e of log) { const k = `${e.market}|${e.ticker}|${e.id}`; if (!recent.has(k) || e.date > recent.get(k)!) recent.set(k, e.date); }
  for (const i of ideas) {
    const key = `${i.market}|${i.ticker}|${i.setup.id}|${i.asOf}`;
    if (have.has(key)) continue;
    const prev = recent.get(`${i.market}|${i.ticker}|${i.setup.id}`);
    if (prev && (Date.parse(i.asOf) - Date.parse(prev)) / 86_400_000 < 14) continue;
    log.push({ key, market: i.market, ticker: i.ticker, id: i.setup.id, side: i.setup.side, grade: i.grade, date: i.asOf, trigger: i.setup.trigger, triggered: i.setup.triggered, entry: i.setup.entry, stop: i.setup.stop, target1: i.setup.target1, target2: i.setup.target2, rr1: i.setup.rr1, quality: i.setup.quality, premium: i.option?.premium ?? null, strike: i.option?.strike ?? null, expiry: i.option?.expiry ?? null, status: 'open', r: null, sessions: null, gradedAt: null,
      regimeUp: i.regime === 'market up', hvPct: i.ctx?.hvPct ?? null, catalyst: i.ctx ? !!(i.ctx.gapDaysAgo != null || i.ctx.rvol >= 1.3) : null });
    have.add(key);
  }
  await kvSet(LOG_KEY, log.slice(-LOG_MAX), 400 * 86400);
}
export async function gradeLog(budgetMs = 6 * 60_000): Promise<{ graded: number; open: number }> {
  const t0 = Date.now();
  const log = await readLog();
  let graded = 0;
  const open = log.filter((e) => e.status === 'open' || (e.status !== 'nofill' && e.rTrail == null && Date.now() - Date.parse(e.date) < 100 * 86_400_000));
  for (const e of open) {
    if (Date.now() - t0 > budgetMs) break;
    const s = await getDailySeries(e.market, e.ticker, '2y').catch(() => null);
    if (!s?.bars?.length) continue;
    const bars = toP(s.bars);
    const t = bars.findIndex((q) => new Date(barMs(q.t)).toISOString().slice(0, 10) === e.date);
    if (t < 0) continue;
    const setup = { id: e.id, side: e.side, triggered: e.triggered, trigger: e.trigger, entry: e.entry, stop: e.stop, target1: e.target1, target2: e.target2 } as unknown as Setup;
    const res = simulate(bars, t, setup, e.market, e.ticker);
    if (res === 'nofill') { e.status = 'nofill'; e.gradedAt = new Date().toISOString(); graded++; continue; }
    if (!res) continue; // still running
    const fi = bars.findIndex((q) => q.t === res.fillT);
    const after = fi >= 0 ? bars.length - 1 - fi : 0;
    e.status = res.outcome; e.r = res.r; e.sessions = res.sessions; e.gradedAt = new Date().toISOString(); graded++;
    e.rTrail = res.trailSessions < after || after >= 40 ? res.rTrail : null;
  }
  if (graded) await kvSet(LOG_KEY, log, 400 * 86400);
  return { graded, open: log.filter((e) => e.status === 'open').length };
}

export async function readScan(m: Mkt): Promise<ScanSnapshot | null> { return kvGet<ScanSnapshot>(SCAN_KEY(m)).catch(() => null); }
export { syntheticExpiries };

// zzz938 — builds the USA screener snapshot once a day (server only). Free sources, no AI:
//   1. Nasdaq stock list — every US-listed stock: price, day change, volume, market cap, sector, industry (one call);
//   2. SEC frames — every company's filed figures, one file per figure per period (lib/screener/sec-assemble.ts);
//   3. Yahoo daily bars (zzz948: one chart per company, 5 years) — moving averages, RSI, ATR, performance, volumes, 52-week high
//      (lib/screener/tech.ts); the lighter 20-a-call closes are kept as a fallback for SMA 50 / 200;
//   4. Yahoo company profile — employees and free float, refreshed about once a week per company (a slice each day).
// The snapshot is written to Postgres (screener_snapshot) and the page reads it whole.
import { yieldToServer } from './yield';
import { dbQuery, getPool } from '@/lib/db';
import { ensureSchema } from '@/lib/db-migrate';
import { yahooProfileStats } from '@/lib/us-prices';
import { FRAME_PLAN, framePeriods, usFigures, type FrameData, type FrameEntry } from './sec-assemble';
import { refreshTech, type TechStored } from './tech-fetch';
import { rowPatternFields, rowScanFields, resolveUsQuote, priceSourceNote, rowTvFields, applyRsRating, ruleOf40 } from './pine';
import { tvSectorOf } from './tv-sectors';
import { rowsJson, type ScreenRow, type ScreenSnapshot } from './types';

const SEC_UA = process.env.SEC_USER_AGENT || 'market-cockpit research radhev.232@gmail.com';
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// ── 1. Nasdaq list ─────────────────────────────────────────────────────────────────────────────────────────────────────
export interface NasdaqRow { t: string; n: string; px: number | null; chg: number | null; vol: number | null; mc: number | null; sec: string | null; ind: string | null; ex?: string; ipoYear?: number | null }
const num = (s: unknown): number | null => { const v = parseFloat(String(s ?? '').replace(/[$,%\s]/g, '')); return Number.isFinite(v) ? v : null; };
/** zzz969 — the US regular session (Mon–Fri 9:30–16:00 New York time; holidays not checked — a holiday build simply has no live price). */
export function usSessionOpen(now = new Date()): boolean {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now).map((x) => [x.type, x.value]));
  if (p.weekday === 'Sat' || p.weekday === 'Sun') return false;
  const m = (Number(p.hour) % 24) * 60 + Number(p.minute);
  return m >= 570 && m < 960;
}

/** Not common stock: warrants, rights, units, preferred, notes, depositary receipts (TradingView's "Common stock" leaves these out). */
const NOT_COMMON = /\b(warrants?|rights?|units?|preferred|pref\.?|depositary|depository|\bADRs?\b|\bADSs?\b|notes? due|debentures?|subordinated|\d+(\.\d+)?%\s)/i;
/** Pure: the Nasdaq screener download → common-stock rows (market cap in $ million). */
export function parseNasdaqList(j: any): NasdaqRow[] {
  const rows: any[] = j?.data?.rows || j?.data?.table?.rows || [];
  const out: NasdaqRow[] = [];
  for (const r of rows) {
    const sym = String(r?.symbol || '').trim().toUpperCase();
    if (!sym || /[\^~$]/.test(sym) || sym.length > 8) continue;
    const name = String(r?.name || '').replace(/\s+/g, ' ').trim();
    if (NOT_COMMON.test(name)) continue;
    const mcRaw = num(r?.marketCap);
    out.push({
      t: sym.replace('/', '.'), n: name.replace(/\s+(Common Stock|Class [A-C] Common Stock|Ordinary Shares?|Class [A-C] Ordinary Shares?)$/i, '').slice(0, 90),
      px: num(r?.lastsale), chg: num(r?.pctchange), vol: num(r?.volume), mc: mcRaw != null && mcRaw > 0 ? Math.round(mcRaw / 1e4) / 100 : null,
      sec: String(r?.sector || '').trim() || null, ind: String(r?.industry || '').trim() || null,
      ipoYear: (() => { const y = parseInt(String(r?.ipoyear || ''), 10); return y > 1900 && y < 2100 ? y : null; })(),
    });
  }
  return out;
}
async function nasdaqFetch(exchange: string | null): Promise<NasdaqRow[]> {
  const res = await fetch(`https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&offset=0&download=true${exchange ? `&exchange=${exchange}` : ''}`, {
    headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json, text/plain, */*', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' },
    cache: 'no-store', signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Nasdaq list HTTP ${res.status}`);
  return parseNasdaqList(await res.json());
}
/** The list, one exchange at a time so each row knows its exchange (TradingView's names: NASDAQ / NYSE / AMEX). If an exchange
 *  cannot be read, the whole list is read in one go (exchange then unknown — an exchange filter fails for those rows). */
export async function nasdaqList(notes: string[]): Promise<NasdaqRow[]> {
  try {
    const parts = await Promise.all([['nasdaq', 'NASDAQ'], ['nyse', 'NYSE'], ['amex', 'AMEX']].map(async ([q, ex]) => (await nasdaqFetch(q)).map((r) => ({ ...r, ex }))));
    const seen = new Set<string>();
    const out: NasdaqRow[] = [];
    for (const r of parts.flat()) if (!seen.has(r.t)) { seen.add(r.t); out.push(r); }
    if (out.length > 3000) return out;
  } catch { /* fall through */ }
  notes.push('Nasdaq list by exchange could not be read — exchange unknown this run');
  return nasdaqFetch(null);
}

// ── 2. SEC frames (Postgres-cached) ───────────────────────────────────────────────────────────────────────────────────
type Compact = Record<string, [number, string?, string?]>;
export async function secTickers(): Promise<Map<string, number>> {
  const res = await fetch('https://www.sec.gov/files/company_tickers.json', { headers: { 'User-Agent': SEC_UA }, cache: 'no-store', signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`SEC tickers HTTP ${res.status}`);
  const j: any = await res.json();
  const m = new Map<string, number>();
  for (const v of Object.values<any>(j || {})) if (v?.ticker && v?.cik_str) m.set(String(v.ticker).toUpperCase().replace(/[./]/g, '-'), Number(v.cik_str));
  return m;
}
async function fetchFrame(tax: string, concept: string, unit: string, period: string): Promise<Compact | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`https://data.sec.gov/api/xbrl/frames/${tax}/${concept}/${unit}/${period}.json`, { headers: { 'User-Agent': SEC_UA, 'Accept-Encoding': 'gzip, deflate' }, cache: 'no-store', signal: AbortSignal.timeout(30_000) });
      if (res.status === 404) return {};   // nobody filed this figure for this period
      if (!res.ok) { await sleep(1500); continue; }
      const j: any = await res.json();
      const out: Compact = {};
      for (const d of j?.data || []) if (fin(d?.val) && d?.cik) out[d.cik] = d.start ? [d.val, d.start, d.end] : [d.val];
      return out;
    } catch { await sleep(1500); }
  }
  return null;
}
/** Downloads (or reuses) every frame in the plan. Recent periods are re-read every build; older ones after a week. */
async function loadFrames(periods: ReturnType<typeof framePeriods>, notes: string[]): Promise<FrameData> {
  const jobs: Array<{ key: string; tax: string; concept: string; unit: string; period: string; maxAgeH: number }> = [];
  for (const [concept, tax, unit, kind] of FRAME_PLAN) {
    const ps = kind === 'i' ? periods.instants : kind === 'a' ? periods.years : [...periods.quarters, ...periods.years];
    ps.forEach((period) => {
      const recent = period === periods.quarters[0] || period === periods.quarters[1] || period === periods.years[0] || period === periods.years[1] || period === periods.instants[0] || period === periods.instants[1];
      jobs.push({ key: `${tax}/${concept}/${unit}/${period}`, tax, concept, unit, period, maxAgeH: recent ? 20 : 24 * 7 });
    });
  }
  const cached = new Map<string, { data: Compact; age: number }>();
  try {
    const rows = await dbQuery<{ key: string; data: Compact; age: number }>(`SELECT key, data, EXTRACT(EPOCH FROM (now() - fetched_at)) / 3600 AS age FROM sec_frame_cache WHERE key = ANY($1)`, [jobs.map((j) => j.key)]);
    for (const r of rows) cached.set(r.key, { data: r.data, age: Number(r.age) });
  } catch { /* no cache: download all */ }
  const fd: FrameData = {};
  const put = (concept: string, period: string, data: Compact) => {
    const byCik: Record<number, FrameEntry> = {};
    for (const [cik, v] of Object.entries(data)) byCik[Number(cik)] = { v: v[0], s: v[1], e: v[2] };
    (fd[concept] ||= {})[period] = byCik;
  };
  let i = 0, fetched = 0, failed = 0;
  const worker = async () => {
    while (i < jobs.length) {
      const j = jobs[i++];
      const c = cached.get(j.key);
      if (c && c.age < j.maxAgeH) { put(j.concept, j.period, c.data); await yieldToServer(); continue; }
      const data = await fetchFrame(j.tax, j.concept, j.unit, j.period);
      await sleep(250);   // SEC asks for at most 10 requests a second; 3 workers × 4/s stays under it
      if (!data) { failed++; if (c) put(j.concept, j.period, c.data); continue; }
      fetched++;
      put(j.concept, j.period, data);
      await dbQuery(`INSERT INTO sec_frame_cache (key, data, fetched_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, fetched_at = now()`, [j.key, JSON.stringify(data)]).catch(() => null);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  if (failed) notes.push(`${failed} SEC figure files could not be read this time (older copies used where kept)`);
  notes.push(`SEC figure files: ${fetched} downloaded, ${jobs.length - fetched - failed} reused`);
  return fd;
}

// ── 3. Yahoo daily closes → SMA ───────────────────────────────────────────────────────────────────────────────────────
export function sma(closes: readonly number[], n: number): number | null {
  if (closes.length < n) return null;
  const s = closes.slice(-n);
  return Math.round((s.reduce((a, b) => a + b, 0) / n) * 100) / 100;
}
/** Why the last daily-price read failed (shown in the build notes), e.g. 'query1 HTTP 429'. */
export let sparkLastError: string | null = null;
let sparkRoute = 0;   // the route that answered last time is tried first
/** Daily closes for up to 20 Yahoo symbols per call (oldest first, gaps dropped). Yahoo sometimes refuses a datacenter address, so
 *  the call goes direct (query1, then query2) and then through the repo's Cloudflare relay (PROXY_URL + PROXY_SECRET). */
export async function sparkCloses(symbols: string[]): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  const path = `/v7/finance/spark?symbols=${symbols.map(encodeURIComponent).join(',')}&range=1y&interval=1d`;
  const relay = (process.env.PROXY_URL || '').replace(/\/$/, ''), secret = process.env.PROXY_SECRET || '';
  const routes: Array<[string, string]> = [['query1', `https://query1.finance.yahoo.com${path}`], ['query2', `https://query2.finance.yahoo.com${path}`]];
  if (relay && secret) routes.push(['relay', `${relay}/proxy?url=${encodeURIComponent(`https://query1.finance.yahoo.com${path}`)}&secret=${encodeURIComponent(secret)}`]);
  for (let k = 0; k < routes.length && out.size === 0; k++) {
    const idx = (sparkRoute + k) % routes.length;
    const [name, url] = routes[idx];
    try {
      const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(20_000) });
      if (!res.ok) { sparkLastError = `${name} HTTP ${res.status}`; continue; }
      const j: any = await res.json();
      for (const r of j?.spark?.result || []) {
        const c: any[] = r?.response?.[0]?.indicators?.quote?.[0]?.close || [];
        out.set(String(r.symbol), c.filter(fin));
      }
      if (out.size) sparkRoute = idx; else sparkLastError = `${name} answered with no prices`;
    } catch (e: any) { sparkLastError = `${name} ${e?.name === 'TimeoutError' ? 'timed out' : 'failed'}`; }
  }
  return out;
}

// ── 4. profiles (employees, float) — a slice per build ─────────────────────────────────────────────────────────────────
export interface Prof { emp: number | null; flt: number | null }
/** Employees (and float) from Yahoo's company profile, refreshed about weekly per company, a slice per run. India passes '.NS'. */
export async function loadProfiles(market: 'US' | 'IN', tickers: string[], notes: string[], budgetMs: number): Promise<Map<string, Prof>> {
  const out = new Map<string, Prof>();
  const age = new Map<string, number>();
  try {
    const rows = await dbQuery<{ ticker: string; payload: Prof; age: number }>(`SELECT ticker, payload, EXTRACT(EPOCH FROM (now() - updated_at)) / 86400 AS age FROM screener_store WHERE market = $1 AND kind = 'prof'`, [market]);
    for (const r of rows) { out.set(r.ticker, r.payload); age.set(r.ticker, Number(r.age)); }
  } catch { /* none yet */ }
  const due = tickers.filter((t) => !age.has(t) || (age.get(t) as number) > 7).sort((a, b) => (age.get(a) ?? 99) < (age.get(b) ?? 99) ? 1 : -1);
  const t0 = Date.now();
  let i = 0, done = 0, blocked = false;
  const worker = async () => {
    while (i < due.length && !blocked && Date.now() - t0 < budgetMs) {
      const t = due[i++];
      const p = await yahooProfileStats(t, market === 'IN' ? '.NS' : '');
      if (p?.blocked) { blocked = true; break; }
      if (p) {
        const v = { emp: p.employees, flt: p.floatPct };
        out.set(t, v); done++;
        await dbQuery(`INSERT INTO screener_store (market, ticker, kind, payload, updated_at) VALUES ($1, $2, 'prof', $3, now()) ON CONFLICT (market, ticker, kind) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`, [market, t, JSON.stringify(v)]).catch(() => null);
      }
      await sleep(300);
    }
  };
  await Promise.all([worker(), worker()]);
  notes.push(`employees${market === 'US' ? ' / float' : ''} (Yahoo company profile): ${done} companies refreshed this run, ${out.size} known, ${Math.max(0, due.length - done)} still to read${blocked ? ' (Yahoo paused the reads; the next run continues)' : ''}`);
  return out;
}

/** Pure: one screener row per listed company from the pieces the build read (used by the build and by the cross-check). */
export function assembleUsRows(universe: NasdaqRow[], ciks: Map<string, number>, fd: FrameData, periods: ReturnType<typeof framePeriods>,
  tech: Map<string, TechStored>, closes: Map<string, number[]>, profiles: Map<string, Prof>): { rows: ScreenRow[]; noSec: number } {
  const ysym = (t: string) => t.replace(/[./]/g, '-');
  const rows: ScreenRow[] = [];
  let noSec = 0;
  for (const r of universe) {
    const key = ysym(r.t);
    const cik = ciks.get(key);
    const f = cik ? usFigures(fd, cik, periods) : null;
    if (!f?.q) noSec++;
    const p = profiles.get(r.t);
    const tf = tech.get(r.t);
    const c = closes.get(key) || [];
    const revTTM = f?.revTTM ?? null;
    const rq = resolveUsQuote({ px: r.px, chg: r.chg }, tf as any);   // zzz996 — a session-behind Nasdaq quote is replaced by the last bar
    const mc = r.mc != null && rq.mcScale !== 1 ? Math.round(r.mc * rq.mcScale * 100) / 100 : r.mc;
    const ipoD = tf?.ipoD ?? (r.ipoYear ? Math.floor(Date.UTC(r.ipoYear, 0, 1) / DAY) : null);
    // zzz954: no debt or lease line filed at all (most such companies have no debt) → EV uses 0 debt, marked ≈ like debt / equity;
    // a company with no cash figure gets no EV / revenue (never a guessed 0)
    const noDebtFiled = f != null && f.debt == null && !!f.approx?.includes('de');
    const evDebt = f?.debt ?? (noDebtFiled ? 0 : null);
    const approx = [...(f?.approx || []), ...(noDebtFiled ? ['evRev'] : []), ...(f?.fcfmFY != null ? ['fcfmTTM', 'r40'] : [])];   // zzz984: FCF margin is the latest full year's
    rows.push({
      t: r.t, n: r.n, sec: r.sec, ind: r.ind, px: rq.px, chg: rq.chg, ...(rq.pxAlt != null ? { pxAlt: rq.pxAlt } : {}), vol: r.vol, avgVol10: tf?.avgVol10 ?? null, mc,
      sma50: tf?.sma50 ?? sma(c, 50), sma200: tf?.sma200 ?? sma(c, 200),
      revQYoY: f?.revQYoY ?? null, revAYoY: f?.revAYoY ?? null, gpQYoY: f?.gpQYoY ?? null, gmFY: f?.gmFY ?? null,
      ebitdaQoQ: f?.ebitdaQoQ ?? null, ebitdaAYoY: f?.ebitdaAYoY ?? null, epsQYoY: f?.epsQYoY ?? null, opmTTM: f?.opmTTM ?? null,
      ps: mc != null && revTTM != null && revTTM > 0 ? r2(mc / revTTM) : null,
      evRev: mc != null && revTTM != null && revTTM > 0 && evDebt != null && f?.cash != null ? r2((mc + evDebt - f.cash) / revTTM) : null,
      de: f?.de ?? null, cash: f?.cash ?? null, emp: p?.emp ?? null, flt: p?.flt ?? null, bb: f?.bb ?? null, fs: f?.fs ?? null, q: f?.q ?? null,
      ...(approx.length ? { approx } : {}),
      // zzz967 (SC-02) — WHY a company has no quarterly figures (not "still to come"): recent listing, annual-only filer,
      // not in SEC's company list, or in SEC but without the tags read
      ...(!f?.q ? { nq: ipoD != null && ipoD > Math.floor(Date.now() / DAY) - 400 ? 'recent-listing' : !cik ? 'not-in-sec' : (f?.niFY != null || f?.revAYoY != null) ? 'annual-only' : 'missing-tags' } : {}),
      tvSec: tvSectorOf('US', r.sec, r.ind, r.t), exch: r.ex ? [r.ex] : null,
      ...(tf ? {
        sma21: tf.sma21, sma100: tf.sma100, sma150: tf.sma150, ema10: tf.ema10, ema21: tf.ema21, ema50: tf.ema50, rsi: tf.rsi, rsiW: tf.rsiW, rsiM: tf.rsiM,
        atrP: tf.atrP, adrP: tf.adrP, chgOpen: tf.chgOpen, chg1W: tf.chg1W, perf1W: tf.perf1W, perf1M: tf.perf1M, perf3M: tf.perf3M,
        perf6M: tf.perf6M, perfYTD: tf.perfYTD, perf1Y: tf.perf1Y, perf5Y: tf.perf5Y, perfAll: tf.perfAll, avgVol30: tf.avgVol30, avgVol60: tf.avgVol60, vol1W: tf.vol1W, hi52: tf.hi52,
        perf5D: tf.perf5D ?? null,
        // zzz969 — read during the US session: the price figures of the last COMPLETED session (close-confirmed mode)
        ...(tf.cc ? { cc: tf.cc } : usSessionOpen() && tf.close != null ? { cc: { px: tf.close, chg: null } } : {}),
      } : {}),
      ipoD,
      ...rowPatternFields(tf),   // zzz983 — chart patterns (Pine Screener)
      ...rowScanFields(tf, { px: rq.px, src: rq.src, at: rq.at }),   // zzz993 (MC-01) — scan close (Yahoo bars) vs latest quote (Nasdaq)
      ...rowTvFields(tf, 'US'),   // zzz984 — the owner's TradingView script fields
      ...(f?.fcfmFY != null ? { fcfmTTM: f.fcfmFY, r40: ruleOf40(f.revQYoY, f.fcfmFY) } : {}),
      roeTTM: f?.roeTTM ?? null, roeFY: f?.roeFY ?? null, roceTTM: f?.roceTTM ?? null, roceFY: f?.roceFY ?? null, nmTTM: f?.nmTTM ?? null, ptmTTM: f?.ptmTTM ?? null,
      opmFY: f?.opmFY ?? null, pe: mc != null && f?.niTTM != null && f.niTTM > 0 ? r2(mc / f.niTTM) : null,
      pcf: mc != null && f?.cash != null && f.cash > 0 ? r2(mc / f.cash) : null, netDebt: f?.netDebt ?? null, niFY: f?.niFY ?? null,
      epsTTMYoY: f?.epsTTMYoY ?? null, revTTMYoY: f?.revTTMYoY ?? null, gpAYoY: f?.gpAYoY ?? null, ebitdaTTMYoY: f?.ebitdaTTMYoY ?? null, ebitdaQYoY: f?.ebitdaQYoY ?? null,
      deFY: f?.deFY ?? null, fcfEmp: f?.fcfFY != null && p?.emp ? Math.round(f.fcfFY / p.emp) : null,
      debtEbitdaQ: f?.debtEbitdaQ ?? null, debtEbitdaA: f?.debtEbitdaA ?? null, liabQ: f?.liabQ ?? null, liabA: f?.liabA ?? null,
      debtAssetsQ: f?.debtAssetsQ ?? null, debtAssetsA: f?.debtAssetsA ?? null, debtCapQ: f?.debtCapQ ?? null, debtCapA: f?.debtCapA ?? null,
    });
  }
  return { rows, noSec };
}

// ── build ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const DAY = 86_400_000;
const r2 = (v: number) => Math.round(v * 100) / 100;
export async function buildUsSnapshot(now = new Date()): Promise<{ ok: boolean; rows: number; notes: string[]; ms: number }> {
  const t0 = Date.now();
  const deadline = t0 + 12.5 * 60_000;   // the scheduler gives the job 15 minutes
  const notes: string[] = [];
  if (!getPool() || !(await ensureSchema())) return { ok: false, rows: 0, notes: ['Postgres is not available'], ms: 0 };
  const list = await nasdaqList(notes);
  const universe = list.filter((r) => r.mc != null && r.mc >= 20);   // under $20M: not tradable for the owner's screens
  notes.push(`Nasdaq list: ${list.length} common stocks, ${universe.length} with a market cap of $20M or more`);
  const [ciks, periods] = [await secTickers(), framePeriods(now)];
  const fd = await loadFrames(periods, notes);
  // price figures: one Yahoo chart per company (5 years of daily bars), refreshed every run within the time left
  const ysym = (t: string) => t.replace(/[./]/g, '-');
  const tech = await refreshTech({
    market: 'US', tickers: universe.map((r) => r.t), symbolOf: ysym, notes, concurrency: 8,
    due: () => true, budgetMs: Math.max(60_000, Math.min(6.5 * 60_000, deadline - Date.now() - 3 * 60_000)),
  });
  // a company Yahoo's chart did not answer for and that has no stored figures: SMA 50 / 200 from the lighter price call
  const noTech = universe.filter((r) => !tech.get(r.t)).map((r) => ysym(r.t));
  const closes = new Map<string, number[]>();
  if (noTech.length) {
    for (let k = 0; k < noTech.length && Date.now() < deadline - 2 * 60_000; k += 20) { const m = await sparkCloses(noTech.slice(k, k + 20)); m.forEach((v, s) => closes.set(s, v)); await sleep(150); }
    notes.push(`${noTech.length} companies have no price figures yet${closes.size ? ` — SMA 50 / 200 for ${closes.size} of them from Yahoo's daily closes` : ''}${sparkLastError && !closes.size ? ` (last Yahoo refusal: ${sparkLastError})` : ''}`);
  }
  const profiles = await loadProfiles('US', universe.filter((r) => (r.mc ?? 0) >= 100).map((r) => r.t), notes, Math.max(30_000, deadline - Date.now() - 30_000));

  // zzz957: in slices, letting other requests in between (the build runs inside the web server)
  const rows: ScreenRow[] = [];
  let noSec = 0;
  for (let k = 0; k < universe.length; k += 200) {
    const part = assembleUsRows(universe.slice(k, k + 200), ciks, fd, periods, tech, closes, profiles);
    rows.push(...part.rows); noSec += part.noSec;
    await yieldToServer();
  }
  applyRsRating(rows, (t) => tech.get(t)?.rsRaw);   // zzz984 — RS Rating ranked over the whole US snapshot
  { const n = priceSourceNote(rows, 'US'); if (n) notes.push(n); }   // zzz993 (MC-01)
  if (noSec) notes.push(`${noSec} listed companies have no quarterly SEC figures (foreign companies filing 20-F / 40-F, which file no quarterly figures in SEC's data; new listings) — their company-figure filters fail`);
  const snap: ScreenSnapshot = { market: 'US', builtAt: new Date().toISOString(), rows, notes, sources: ['Nasdaq stock list', 'SEC filings (XBRL frames)', 'Yahoo daily prices', 'Yahoo company profile'] };
  await dbQuery(`INSERT INTO screener_snapshot (market, built_at, rows, meta) VALUES ('US', now(), $1, $2) ON CONFLICT (market) DO UPDATE SET built_at = now(), rows = EXCLUDED.rows, meta = EXCLUDED.meta`,
    [rowsJson(rows), JSON.stringify({ notes, sources: snap.sources })]);
  return { ok: true, rows: rows.length, notes, ms: Date.now() - t0 };
}

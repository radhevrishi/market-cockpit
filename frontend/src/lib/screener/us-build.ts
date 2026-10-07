// zzz938 — builds the USA screener snapshot once a day (server only). Free sources, no AI:
//   1. Nasdaq stock list — every US-listed stock: price, day change, volume, market cap, sector, industry (one call);
//   2. SEC frames — every company's filed figures, one file per figure per period (lib/screener/sec-assemble.ts);
//   3. Yahoo daily closes (20 names a call) — SMA 50 / SMA 200;
//   4. Yahoo company profile — employees and free float, refreshed about once a week per company (a slice each day).
// The snapshot is written to Postgres (screener_snapshot) and the page reads it whole.
import { dbQuery, getPool } from '@/lib/db';
import { ensureSchema } from '@/lib/db-migrate';
import { yahooProfileStats } from '@/lib/us-prices';
import { FRAME_PLAN, framePeriods, usFigures, type FrameData, type FrameEntry } from './sec-assemble';
import type { ScreenRow, ScreenSnapshot } from './types';

const SEC_UA = process.env.SEC_USER_AGENT || 'market-cockpit research radhev.232@gmail.com';
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// ── 1. Nasdaq list ─────────────────────────────────────────────────────────────────────────────────────────────────────
export interface NasdaqRow { t: string; n: string; px: number | null; chg: number | null; vol: number | null; mc: number | null; sec: string | null; ind: string | null }
const num = (s: unknown): number | null => { const v = parseFloat(String(s ?? '').replace(/[$,%\s]/g, '')); return Number.isFinite(v) ? v : null; };
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
    });
  }
  return out;
}
async function nasdaqList(): Promise<NasdaqRow[]> {
  const res = await fetch('https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&offset=0&download=true', {
    headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json, text/plain, */*', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' },
    cache: 'no-store', signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Nasdaq list HTTP ${res.status}`);
  return parseNasdaqList(await res.json());
}

// ── 2. SEC frames (Postgres-cached) ───────────────────────────────────────────────────────────────────────────────────
type Compact = Record<string, [number, string?, string?]>;
async function secTickers(): Promise<Map<string, number>> {
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
      if (c && c.age < j.maxAgeH) { put(j.concept, j.period, c.data); continue; }
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
interface Prof { emp: number | null; flt: number | null }
async function loadProfiles(tickers: string[], notes: string[], budgetMs: number): Promise<Map<string, Prof>> {
  const out = new Map<string, Prof>();
  const age = new Map<string, number>();
  try {
    const rows = await dbQuery<{ ticker: string; payload: Prof; age: number }>(`SELECT ticker, payload, EXTRACT(EPOCH FROM (now() - updated_at)) / 86400 AS age FROM screener_store WHERE market = 'US' AND kind = 'prof'`);
    for (const r of rows) { out.set(r.ticker, r.payload); age.set(r.ticker, Number(r.age)); }
  } catch { /* none yet */ }
  const due = tickers.filter((t) => !age.has(t) || (age.get(t) as number) > 7).sort((a, b) => (age.get(a) ?? 99) < (age.get(b) ?? 99) ? 1 : -1);
  const t0 = Date.now();
  let i = 0, done = 0, blocked = false;
  const worker = async () => {
    while (i < due.length && !blocked && Date.now() - t0 < budgetMs) {
      const t = due[i++];
      const p = await yahooProfileStats(t);
      if (p?.blocked) { blocked = true; break; }
      if (p) {
        const v = { emp: p.employees, flt: p.floatPct };
        out.set(t, v); done++;
        await dbQuery(`INSERT INTO screener_store (market, ticker, kind, payload, updated_at) VALUES ('US', $1, 'prof', $2, now()) ON CONFLICT (market, ticker, kind) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`, [t, JSON.stringify(v)]).catch(() => null);
      }
      await sleep(300);
    }
  };
  await Promise.all([worker(), worker()]);
  notes.push(`employees / float: ${done} companies refreshed this run, ${out.size} known, ${Math.max(0, due.length - done)} still to read${blocked ? ' (Yahoo paused the reads; the next run continues)' : ''}`);
  return out;
}

// ── build ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function buildUsSnapshot(now = new Date()): Promise<{ ok: boolean; rows: number; notes: string[]; ms: number }> {
  const t0 = Date.now();
  const notes: string[] = [];
  if (!getPool() || !(await ensureSchema())) return { ok: false, rows: 0, notes: ['Postgres is not available'], ms: 0 };
  const list = await nasdaqList();
  const universe = list.filter((r) => r.mc != null && r.mc >= 20);   // under $20M: not tradable for the owner's screens
  notes.push(`Nasdaq list: ${list.length} common stocks, ${universe.length} with a market cap of $20M or more`);
  const [ciks, periods] = [await secTickers(), framePeriods(now)];
  const fd = await loadFrames(periods, notes);
  // closes → SMA (20 names a call, 3 calls at a time)
  const closes = new Map<string, number[]>();
  const syms = universe.map((r) => r.t.replace(/[./]/g, '-'));
  const batches: string[][] = [];
  for (let k = 0; k < syms.length; k += 20) batches.push(syms.slice(k, k + 20));
  let bi = 0;
  const pw = async () => { while (bi < batches.length) { const b = batches[bi++]; const m = await sparkCloses(b); m.forEach((v, k) => closes.set(k, v)); await sleep(150); } };
  await Promise.all([pw(), pw()]);
  notes.push(`daily prices: ${closes.size} of ${syms.length} companies${closes.size < syms.length * 0.9 && sparkLastError ? ` (last Yahoo refusal: ${sparkLastError})` : ''}`);
  const profiles = await loadProfiles(universe.filter((r) => (r.mc ?? 0) >= 100).map((r) => r.t), notes, 4 * 60_000);

  const rows: ScreenRow[] = [];
  let noSec = 0;
  for (const r of universe) {
    const key = r.t.replace(/[./]/g, '-');
    const cik = ciks.get(key);
    const f = cik ? usFigures(fd, cik, periods) : null;
    if (!f) noSec++;
    const c = closes.get(key) || [];
    const p = profiles.get(r.t);
    const revTTM = f?.revTTM ?? null;
    rows.push({
      t: r.t, n: r.n, sec: r.sec, ind: r.ind, px: r.px, chg: r.chg, vol: r.vol, avgVol10: null, mc: r.mc,
      sma50: sma(c, 50), sma200: sma(c, 200),
      revQYoY: f?.revQYoY ?? null, revAYoY: f?.revAYoY ?? null, gpQYoY: f?.gpQYoY ?? null, gmFY: f?.gmFY ?? null,
      ebitdaQoQ: f?.ebitdaQoQ ?? null, ebitdaAYoY: f?.ebitdaAYoY ?? null, epsQYoY: f?.epsQYoY ?? null, opmTTM: f?.opmTTM ?? null,
      ps: r.mc != null && revTTM != null && revTTM > 0 ? Math.round((r.mc / revTTM) * 100) / 100 : null,
      evRev: r.mc != null && revTTM != null && revTTM > 0 ? Math.round(((r.mc + (f?.debt ?? 0) - (f?.cash ?? 0)) / revTTM) * 100) / 100 : null,
      de: f?.de ?? null, cash: f?.cash ?? null, emp: p?.emp ?? null, flt: p?.flt ?? null, bb: f?.bb ?? null, fs: null, q: f?.q ?? null,
      ...(f?.approx?.length ? { approx: f.approx } : {}),
    });
  }
  if (noSec) notes.push(`${noSec} listed companies have no SEC figures (foreign filers on Form 20-F / 40-F, new listings) — their figure filters fail`);
  const snap: ScreenSnapshot = { market: 'US', builtAt: new Date().toISOString(), rows, notes, sources: ['Nasdaq stock list', 'SEC filings (XBRL frames)', 'Yahoo daily prices', 'Yahoo company profile'] };
  await dbQuery(`INSERT INTO screener_snapshot (market, built_at, rows, meta) VALUES ('US', now(), $1, $2) ON CONFLICT (market) DO UPDATE SET built_at = now(), rows = EXCLUDED.rows, meta = EXCLUDED.meta`,
    [JSON.stringify(rows), JSON.stringify({ notes, sources: snap.sources })]);
  return { ok: true, rows: rows.length, notes, ms: Date.now() - t0 };
}

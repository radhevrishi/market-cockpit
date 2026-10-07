// zzz939 — builds the INDIA screener snapshot (server only). Free sources, no AI:
//   1. NSE's list of listed companies (EQUITY_L.csv) — the universe (EQ + BE series);
//   2. NSE's daily price files (sec_bhavdata_full) — close, day change, volume, open / high / low; old days are kept;
//   3. screener.in company pages (+ three small schedule answers each) — the company figures. ~2,500 companies cannot be read in one
//      go politely, so each run reads a slice (the ones never read first, then the oldest); a company is re-read about weekly.
//      zzz948: the page is kept boiled down (InRaw) so figures are worked out at every build — a formula change needs no re-read;
//   4. Yahoo daily bars (.NS, one chart per company, 5 years) with NSE's own prices laid over the last ~3 months — moving averages,
//      RSI, ATR, performance, volumes; once per trading day (zzz948; before: SMA 50 / 200 from closes only);
//   5. Yahoo company profile (.NS) — employees, a slice per run, about weekly per company (zzz948).
// Market cap = shares (screener.in market cap ÷ its price) × today's NSE close, so it moves with the price every day.
import { dbQuery, getPool } from '@/lib/db';
import { ensureSchema } from '@/lib/db-migrate';
import { fetchScreenerHtml } from '@/lib/earnings/screener-fetch';
import { screenerSymbol } from '@/lib/earnings/screener-documents';
import { isCurrentPeriod } from '@/lib/thesis/screener-financials';
import { inFiguresFromRaw, rawFromHtml, type InFigures, type InRaw } from './in-assemble';
import { loadProfiles, type Prof } from './us-build';
import { refreshTech, type TechStored } from './tech-fetch';
import type { NseDay } from './tech';
import { tvSectorOf } from './tv-sectors';
import { rowsJson, type ScreenRow } from './types';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const DAY = 86_400_000;

// ── CSV ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (!lines.length) return [];
  const split = (l: string) => { const out: string[] = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map((x) => x.trim()); };
  const head = split(lines[0]).map((h) => h.toUpperCase());
  return lines.slice(1).map((l) => { const c = split(l); const o: Record<string, string> = {}; head.forEach((h, i) => { o[h] = c[i] ?? ''; }); return o; });
}
/** Pure: EQUITY_L.csv → { symbol: company name } for the EQ / BE series. */
export function parseEquityList(text: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of parseCsv(text)) if ((r.SERIES === 'EQ' || r.SERIES === 'BE') && r.SYMBOL) m.set(r.SYMBOL.toUpperCase(), r['NAME OF COMPANY'] || r.SYMBOL);
  return m;
}
/** Pure: one NSE daily price file → { symbol: [close, previous close, volume, open, high, low] } for the EQ / BE series. */
export function parseBhav(text: string): Record<string, NseDay> {
  const out: Record<string, NseDay> = {};
  const num = (s: string | undefined) => { const v = parseFloat(String(s ?? '')); return Number.isFinite(v) ? v : NaN; };
  for (const r of parseCsv(text)) {
    if (r.SERIES !== 'EQ' && r.SERIES !== 'BE') continue;
    const c = num(r.CLOSE_PRICE), p = num(r.PREV_CLOSE), v = num(r.TTL_TRD_QNTY), o = num(r.OPEN_PRICE), h = num(r.HIGH_PRICE), l = num(r.LOW_PRICE);
    if (!r.SYMBOL || !Number.isFinite(c)) continue;
    const day: NseDay = [c, Number.isFinite(p) ? p : c, Number.isFinite(v) ? v : 0];
    if (Number.isFinite(o) && Number.isFinite(h) && Number.isFinite(l)) day.push(o, h, l);
    out[r.SYMBOL.toUpperCase()] = day;
  }
  return out;
}

// NSE refuses many datacenter addresses (Railway among them), so a failed direct read goes once through the repo's own Cloudflare
// relay, which serves public nsearchives files without a secret (workers/mc-proxy OPEN_HOSTS).
const RELAY = 'https://mc-proxy.radhev-232.workers.dev/page?url=';
async function getText(url: string): Promise<{ status: number; text: string | null }> {
  let status = 0;
  for (const u of [url, `${RELAY}${encodeURIComponent(url)}`]) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: '*/*', Referer: 'https://www.nseindia.com/' }, cache: 'no-store', signal: AbortSignal.timeout(30_000) });
      status = r.status;
      if (r.ok) { const text = await r.text(); if (text.length > 200 && !/^\s*</.test(text)) return { status, text }; }
      if (r.status === 404 && u === url) return { status, text: null };   // the file does not exist (holiday / not yet published)
    } catch { /* next hop */ }
  }
  return { status, text: null };
}
const ddmmyyyy = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}${String(d.getUTCMonth() + 1).padStart(2, '0')}${d.getUTCFullYear()}`;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export type BhavDay = { date: string; px: Record<string, NseDay> };
/** The last `n` trading days' price files, newest first (old days come from the database; a holiday is remembered as empty).
 *  A day saved before zzz948 has no open / high / low; it is read again once (while NSE still serves it). */
export async function loadBhav(n: number, notes: string[], maxNew = 70): Promise<BhavDay[]> {
  const out: BhavDay[] = [];
  const today = new Date();
  const keys: string[] = [];
  for (let k = 0; k < Math.ceil(n * 1.6) + 10; k++) { const d = new Date(today.getTime() - k * DAY); const wd = d.getUTCDay(); if (wd !== 0 && wd !== 6) keys.push(iso(d)); }
  const have = new Map<string, any>();
  const rows = await dbQuery<{ key: string; data: any }>(`SELECT key, data FROM sec_frame_cache WHERE key = ANY($1)`, [keys.map((d) => `nse-bhav:${d}`)]).catch(() => []);
  for (const r of rows) have.set(r.key.slice(9), r.data);
  let fetched = 0;
  for (let k = 0; k < keys.length && out.length < n; k++) {
    const date = keys[k];
    const hit = have.get(date);
    const old = hit && Object.keys(hit).length && (Object.values(hit)[0] as unknown[]).length < 6;
    if (hit && !old) { if (Object.keys(hit).length) out.push({ date, px: hit }); continue; }
    if (fetched >= maxNew) { if (hit && Object.keys(hit).length) out.push({ date, px: hit }); continue; }
    const d = new Date(`${date}T00:00:00Z`);
    const r = await getText(`https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${ddmmyyyy(d)}.csv`);
    fetched++;
    if (r.text) {
      const px = parseBhav(r.text);
      if (Object.keys(px).length > 500) {
        out.push({ date, px });
        await dbQuery(`INSERT INTO sec_frame_cache (key, data) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, fetched_at = now()`, [`nse-bhav:${date}`, JSON.stringify(px)]).catch(() => null);
      } else if (hit && Object.keys(hit).length) out.push({ date, px: hit });
    } else if (hit && Object.keys(hit).length) {
      out.push({ date, px: hit });   // NSE no longer serves the old file: keep what we have
    } else if (r.status === 404 && k >= 2) {
      // a weekday with no file two or more days later is a market holiday — remember it so it is not asked again
      await dbQuery(`INSERT INTO sec_frame_cache (key, data) VALUES ($1, '{}') ON CONFLICT (key) DO NOTHING`, [`nse-bhav:${date}`]).catch(() => null);
    }
    await sleep(300);
  }
  if (out.length < n) notes.push(`only ${out.length} of ${n} recent NSE daily price files could be read`);
  return out;
}

// ── screener.in figures, a slice per run ───────────────────────────────────────────────────────────────────────────────
/** One company as stored. `raw` = the page boiled down (zzz948); `f` = figures stored by builds before zzz948 (used until re-read).
 *  `qSeen` = the latest quarter and the day a read first found it (to date results the page does not list). */
export interface FundStore { raw?: InRaw; f?: InFigures; err?: string; basis?: string; qSeen?: { q: string | null; at: string | null } }
export async function readCompany(t: string): Promise<FundStore> {
  const sym = encodeURIComponent(screenerSymbol(t));
  let last = '';
  for (const [basis, url] of [['consolidated', `https://www.screener.in/company/${sym}/consolidated/`], ['standalone', `https://www.screener.in/company/${sym}/`]] as const) {
    const got = await fetchScreenerHtml(url, 15_000);
    if (!got.html) { last = got.error ? got.error.slice(0, 120) : 'no answer'; continue; }
    const first = inFiguresFromRaw(rawFromHtml(got.html, {}));
    if (!first.q || !isCurrentPeriod(first.q)) { last = first.q ? `latest ${basis} quarter is ${first.q} — too old` : `no ${basis} quarterly table`; continue; }
    const id = /data-company-id="(\d+)"/.exec(got.html)?.[1];
    const sched = async (parent: string, section: string) => {
      if (!id) return undefined;
      const u = `https://www.screener.in/api/company/${id}/schedules/?parent=${encodeURIComponent(parent)}&section=${section}${basis === 'consolidated' ? '&consolidated=' : ''}`;
      const r = await fetchScreenerHtml(u, 12_000);
      try { return r.html ? JSON.parse(r.html) : undefined; } catch { return undefined; }
    };
    const expQ = await sched('Expenses', 'quarters');
    const expA = await sched('Expenses', 'profit-loss');
    const otherAssets = await sched('Other Assets', 'balance-sheet');
    return { raw: rawFromHtml(got.html, { expQ, expA, otherAssets }), basis };
  }
  return { err: last || 'not read' };
}
const figuresOf = (s: FundStore | undefined): InFigures | undefined => (s?.raw ? inFiguresFromRaw(s.raw) : s?.f);
async function refreshFunds(universe: string[], budgetMs: number, notes: string[]): Promise<Map<string, FundStore>> {
  const store = new Map<string, FundStore>();
  const age = new Map<string, number>();
  const rows = await dbQuery<{ ticker: string; payload: FundStore; age: number }>(`SELECT ticker, payload, EXTRACT(EPOCH FROM (now() - updated_at)) / 86400 AS age FROM screener_store WHERE market = 'IN' AND kind = 'fund'`).catch(() => []);
  for (const r of rows) { store.set(r.ticker, r.payload); age.set(r.ticker, Number(r.age)); }
  // never read first; then companies stored the old way (before zzz948); then a failed read after 2 days; then older than 6 days
  const rank = (t: string) => (!age.has(t) ? 0 : !store.get(t)?.raw && !store.get(t)?.err ? 1 : 2);
  const due = universe
    .filter((t) => !age.has(t) || (!store.get(t)?.raw && !store.get(t)?.err) || (store.get(t)?.err ? (age.get(t) as number) > 2 : (age.get(t) as number) > 6))
    .sort((a, b) => rank(a) - rank(b) || (age.get(b) ?? 0) - (age.get(a) ?? 0));
  const t0 = Date.now();
  const today = iso(new Date());
  let i = 0, ok = 0, bad = 0;
  const worker = async () => {
    while (i < due.length && Date.now() - t0 < budgetMs) {
      const t = due[i++];
      const prev = store.get(t);
      const r = await readCompany(t).catch((e: any) => ({ err: String(e?.message || e).slice(0, 120) }) as FundStore);
      if (r.raw) {
        ok++;
        // when did these results come out? a read that finds a newer quarter than the last read dates it (within a week)
        const q = inFiguresFromRaw(r.raw).q, pq = figuresOf(prev)?.q ?? null;
        r.qSeen = prev?.qSeen?.q === q ? prev.qSeen : { q, at: pq && q && pq !== q ? today : null };
      } else {
        bad++;
        if (prev?.raw || prev?.f) { r.raw = prev.raw; r.f = prev.f; r.qSeen = prev.qSeen; }   // keep the last good figures
      }
      store.set(t, r);
      await dbQuery(`INSERT INTO screener_store (market, ticker, kind, payload, updated_at) VALUES ('IN', $1, 'fund', $2, now()) ON CONFLICT (market, ticker, kind) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`, [t, JSON.stringify(r)]).catch(() => null);
      await sleep(400);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  const have = Array.from(store.values()).filter((s) => s.raw || s.f).length;
  const legacy = universe.filter((t) => store.get(t)?.f && !store.get(t)?.raw).length;
  notes.push(`company figures (screener.in): ${ok} read this run, ${bad} could not be read, ${have} of ${universe.length} companies known, ${Math.max(0, due.length - ok - bad)} still waiting (read in the next runs)${legacy ? ` — ${legacy} of them are re-read for the new figures (ROE, ROCE, margins, TTM growth, balance-sheet ratios); until then those figures are blank` : ''}`);
  return store;
}

/** Pure: one screener row from the pieces the build read (used by the build and by the cross-check). */
export function assembleInRow(t: string, name: string, latest: BhavDay, bhav: BhavDay[], store: FundStore | undefined, tf: TechStored | undefined, p: Prof | undefined): ScreenRow {
  const [close, prev, vol] = latest.px[t];
  const f = figuresOf(store);
  const mc = f?.shares != null ? Math.round(f.shares * close * 10) / 10 : null;
  const vols = bhav.slice(0, 10).map((b) => b.px[t]?.[2]).filter(fin);
  const sales = f?.salesTTM ?? null;
  const earnIso = f?.earnD ?? store?.qSeen?.at ?? null;
  return {
    t, n: name, sec: f?.sector ?? null, ind: f?.industry ?? null, px: close, chg: prev > 0 ? Math.round(((close / prev) - 1) * 1000) / 10 : null,
    vol, avgVol10: tf?.avgVol10 ?? (vols.length >= 5 ? Math.round(vols.reduce((a, b) => a + b, 0) / vols.length) : null), mc,
    sma50: tf?.sma50 ?? null, sma200: tf?.sma200 ?? null,
    revQYoY: f?.revQYoY ?? null, revAYoY: f?.revAYoY ?? null, gpQYoY: f?.gpQYoY ?? null, gmFY: f?.gmFY ?? null,
    ebitdaQoQ: f?.ebitdaQoQ ?? null, ebitdaAYoY: f?.ebitdaAYoY ?? null, epsQYoY: f?.epsQYoY ?? null, opmTTM: store?.raw ? f?.opmTTM ?? null : null,
    ps: mc != null && sales != null && sales > 0 ? r2(mc / sales) : null,
    evRev: mc != null && sales != null && sales > 0 ? r2((mc + (f?.borrowings ?? 0) - (f?.cash ?? 0)) / sales) : null,
    de: store?.raw ? f?.de ?? null : null, cash: f?.cash ?? null, emp: p?.emp ?? null, flt: null, bb: null, fs: f?.fs ?? null, q: f?.q ?? null,
    ...(f?.approx?.length ? { approx: f.approx } : {}),
    tvSec: tvSectorOf('IN', f?.sector, f?.industry), exch: f ? (f.bse ? ['NSE', 'BSE'] : ['NSE']) : ['NSE'],
    ...(tf ? {
      sma21: tf.sma21, sma100: tf.sma100, sma150: tf.sma150, ema10: tf.ema10, ema21: tf.ema21, ema50: tf.ema50, rsi: tf.rsi, rsiW: tf.rsiW, rsiM: tf.rsiM,
      atrP: tf.atrP, adrP: tf.adrP, chgOpen: tf.chgOpen, chg1W: tf.chg1W, perf1W: tf.perf1W, perf1M: tf.perf1M, perf3M: tf.perf3M,
      perf6M: tf.perf6M, perfYTD: tf.perfYTD, perf1Y: tf.perf1Y, perf5Y: tf.perf5Y, perfAll: tf.perfAll, avgVol30: tf.avgVol30, avgVol60: tf.avgVol60, vol1W: tf.vol1W, hi52: tf.hi52,
      ipoD: tf.ipoD,
    } : {}),
    earnD: earnIso ? Math.floor(Date.parse(`${earnIso.slice(0, 10)}T00:00:00Z`) / DAY) : null,
    roeTTM: f?.roeTTM ?? null, roeFY: f?.roeFY ?? null, roceTTM: f?.roceTTM ?? null, roceFY: f?.roceFY ?? null, nmTTM: f?.nmTTM ?? null, ptmTTM: f?.ptmTTM ?? null,
    opmFY: f?.opmFY ?? null, pe: mc != null && f?.npTTM != null && f.npTTM > 0 ? r2(mc / f.npTTM) : null,
    pcf: mc != null && f?.cash != null && f.cash > 0 ? r2(mc / f.cash) : null, netDebt: f?.netDebt ?? null, niFY: f?.niFY ?? null,
    epsTTMYoY: f?.epsTTMYoY ?? null, revTTMYoY: f?.revTTMYoY ?? null, gpAYoY: f?.gpAYoY ?? null, ebitdaTTMYoY: f?.ebitdaTTMYoY ?? null, ebitdaQYoY: f?.ebitdaQYoY ?? null,
    deFY: f?.deFY ?? null, debtEbitdaQ: f?.debtEbitdaQ ?? null, debtEbitdaA: f?.debtEbitdaA ?? null, liabQ: f?.liabQ ?? null, liabA: f?.liabA ?? null,
    debtAssetsQ: f?.debtAssetsQ ?? null, debtAssetsA: f?.debtAssetsA ?? null, debtCapQ: f?.debtCapQ ?? null, debtCapA: f?.debtCapA ?? null,
  };
}

// ── build ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const r2 = (v: number) => Math.round(v * 100) / 100;
export async function buildInSnapshot(opts: { fundBudgetMs?: number } = {}): Promise<{ ok: boolean; rows: number; notes: string[]; ms: number }> {
  const t0 = Date.now();
  const deadline = t0 + 13 * 60_000;   // the scheduler gives the job 15 minutes
  const notes: string[] = [];
  if (!getPool() || !(await ensureSchema())) return { ok: false, rows: 0, notes: ['Postgres is not available'], ms: 0 };
  const eq = await getText('https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv');
  let names = eq.text ? parseEquityList(eq.text) : new Map<string, string>();
  if (names.size > 1000) await dbQuery(`INSERT INTO sec_frame_cache (key, data) VALUES ('nse-equity-list', $1) ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, fetched_at = now()`, [JSON.stringify(Object.fromEntries(names))]).catch(() => null);
  else {
    const hit = await dbQuery<{ data: Record<string, string> }>(`SELECT data FROM sec_frame_cache WHERE key = 'nse-equity-list'`).catch(() => []);
    if (hit.length) { names = new Map(Object.entries(hit[0].data)); notes.push('NSE company list not reachable — the last saved copy was used'); }
  }
  if (names.size < 1000) return { ok: false, rows: 0, notes: [...notes, 'NSE company list could not be read'], ms: Date.now() - t0 };
  const bhav = await loadBhav(11, notes, 3);
  if (!bhav.length) return { ok: false, rows: 0, notes: [...notes, 'no NSE daily price file could be read'], ms: Date.now() - t0 };
  const latest = bhav[0];
  // the universe: listed EQ / BE companies that traded on the latest day
  const universe = Array.from(names.keys()).filter((t) => latest.px[t]).sort();
  notes.push(`NSE: ${names.size} listed companies, ${universe.length} traded on ${latest.date}`);
  const funds = await refreshFunds(universe, opts.fundBudgetMs ?? 6.5 * 60_000, notes);

  // price figures once per trading day: Yahoo history + NSE's own prices for the last ~3 months (65 sessions)
  const tech = await refreshTech({
    market: 'IN', tickers: universe, symbolOf: (t) => `${t}.NS`, notes, concurrency: 8,
    due: (s) => !s || s.d !== latest.date,
    budgetMs: Math.max(30_000, Math.min(3.5 * 60_000, deadline - Date.now() - 2.5 * 60_000)),
    nse: async () => {
      const long = Date.now() < deadline - 4 * 60_000 ? await loadBhav(65, notes, 12) : bhav;
      return (t: string) => long.map((b) => ({ date: b.date, day: b.px[t] }));
    },
  });
  const profiles = await loadProfiles('IN', universe, notes, Math.max(20_000, Math.min(1.5 * 60_000, deadline - Date.now() - 30_000)));

  const rows: ScreenRow[] = universe.map((t) => assembleInRow(t, names.get(t) || t, latest, bhav, funds.get(t), tech.get(t), profiles.get(t)));
  const sources = ['NSE company list', 'NSE daily price files', 'screener.in company pages', 'Yahoo daily prices', 'Yahoo company profile'];
  await dbQuery(`INSERT INTO screener_snapshot (market, built_at, rows, meta) VALUES ('IN', now(), $1, $2) ON CONFLICT (market) DO UPDATE SET built_at = now(), rows = EXCLUDED.rows, meta = EXCLUDED.meta`,
    [rowsJson(rows), JSON.stringify({ notes, sources })]);
  return { ok: true, rows: rows.length, notes, ms: Date.now() - t0 };
}

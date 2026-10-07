// zzz939 — builds the INDIA screener snapshot (server only). Free sources, no AI:
//   1. NSE's list of listed companies (EQUITY_L.csv) — the universe (EQ + BE series);
//   2. NSE's daily price files (sec_bhavdata_full) — close, day change, volume, 10-day average volume; old days are kept;
//   3. screener.in company pages (+ three small schedule answers each) — the company figures. ~2,500 companies cannot be read in one
//      go politely, so each run reads a slice (the ones never read first, then the oldest); a company is re-read about weekly;
//   4. Yahoo daily closes (.NS, 20 a call) — SMA 50 / SMA 200, once per trading day.
// Market cap = shares (screener.in market cap ÷ its price) × today's NSE close, so it moves with the price every day.
import { dbQuery, getPool } from '@/lib/db';
import { ensureSchema } from '@/lib/db-migrate';
import { fetchScreenerHtml } from '@/lib/earnings/screener-fetch';
import { screenerSymbol } from '@/lib/earnings/screener-documents';
import { isCurrentPeriod } from '@/lib/thesis/screener-financials';
import { inFigures, type InFigures } from './in-assemble';
import { sma, sparkCloses, sparkLastError } from './us-build';
import type { ScreenRow } from './types';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

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
/** Pure: one NSE daily price file → { symbol: [close, previous close, volume] } for the EQ / BE series. */
export function parseBhav(text: string): Record<string, [number, number, number]> {
  const out: Record<string, [number, number, number]> = {};
  for (const r of parseCsv(text)) {
    if (r.SERIES !== 'EQ' && r.SERIES !== 'BE') continue;
    const c = parseFloat(r.CLOSE_PRICE), p = parseFloat(r.PREV_CLOSE), v = parseFloat(r.TTL_TRD_QNTY);
    if (r.SYMBOL && Number.isFinite(c)) out[r.SYMBOL.toUpperCase()] = [c, Number.isFinite(p) ? p : c, Number.isFinite(v) ? v : 0];
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

/** The last `n` trading days' price files, newest first (old days come from the database; a holiday is remembered as empty). */
async function loadBhav(n: number, notes: string[]): Promise<Array<{ date: string; px: Record<string, [number, number, number]> }>> {
  const out: Array<{ date: string; px: Record<string, [number, number, number]> }> = [];
  const today = new Date();
  for (let k = 0; k < 30 && out.length < n; k++) {
    const d = new Date(today.getTime() - k * 86_400_000);
    const wd = d.getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const key = `nse-bhav:${iso(d)}`;
    const hit = await dbQuery<{ data: any }>(`SELECT data FROM sec_frame_cache WHERE key = $1`, [key]).catch(() => []);
    if (hit.length) { if (hit[0].data && Object.keys(hit[0].data).length) out.push({ date: iso(d), px: hit[0].data }); continue; }
    const r = await getText(`https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${ddmmyyyy(d)}.csv`);
    if (r.text) {
      const px = parseBhav(r.text);
      if (Object.keys(px).length > 500) {
        out.push({ date: iso(d), px });
        await dbQuery(`INSERT INTO sec_frame_cache (key, data) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, fetched_at = now()`, [key, JSON.stringify(px)]).catch(() => null);
      }
    } else if (r.status === 404 && k >= 2) {
      // a weekday with no file two or more days later is a market holiday — remember it so it is not asked again
      await dbQuery(`INSERT INTO sec_frame_cache (key, data) VALUES ($1, '{}') ON CONFLICT (key) DO NOTHING`, [key]).catch(() => null);
    }
    await sleep(300);
  }
  if (out.length < n) notes.push(`only ${out.length} of ${n} recent NSE daily price files could be read`);
  return out;
}

// ── screener.in figures, a slice per run ───────────────────────────────────────────────────────────────────────────────
interface FundStore { f?: InFigures; err?: string; basis?: string }
async function readCompany(t: string): Promise<FundStore> {
  const sym = encodeURIComponent(screenerSymbol(t));
  let last = '';
  for (const [basis, url] of [['consolidated', `https://www.screener.in/company/${sym}/consolidated/`], ['standalone', `https://www.screener.in/company/${sym}/`]] as const) {
    const got = await fetchScreenerHtml(url, 15_000);
    if (!got.html) { last = got.error ? got.error.slice(0, 120) : 'no answer'; continue; }
    const first = inFigures(got.html, {});
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
    return { f: inFigures(got.html, { expQ, expA, otherAssets }), basis };
  }
  return { err: last || 'not read' };
}
async function refreshFunds(universe: string[], budgetMs: number, notes: string[]): Promise<Map<string, FundStore>> {
  const store = new Map<string, FundStore>();
  const age = new Map<string, number>();
  const rows = await dbQuery<{ ticker: string; payload: FundStore; age: number }>(`SELECT ticker, payload, EXTRACT(EPOCH FROM (now() - updated_at)) / 86400 AS age FROM screener_store WHERE market = 'IN' AND kind = 'fund'`).catch(() => []);
  for (const r of rows) { store.set(r.ticker, r.payload); age.set(r.ticker, Number(r.age)); }
  // never read first; then a failed read after 2 days; then anything older than 6 days, oldest first
  const due = universe
    .filter((t) => !age.has(t) || (store.get(t)?.err ? (age.get(t) as number) > 2 : (age.get(t) as number) > 6))
    .sort((a, b) => (age.has(a) ? 1 : 0) - (age.has(b) ? 1 : 0) || (age.get(b) ?? 0) - (age.get(a) ?? 0));
  const t0 = Date.now();
  let i = 0, ok = 0, bad = 0;
  const worker = async () => {
    while (i < due.length && Date.now() - t0 < budgetMs) {
      const t = due[i++];
      const r = await readCompany(t).catch((e: any) => ({ err: String(e?.message || e).slice(0, 120) }) as FundStore);
      if (r.f) ok++; else bad++;
      store.set(t, r);
      await dbQuery(`INSERT INTO screener_store (market, ticker, kind, payload, updated_at) VALUES ('IN', $1, 'fund', $2, now()) ON CONFLICT (market, ticker, kind) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`, [t, JSON.stringify(r)]).catch(() => null);
      await sleep(400);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  const have = Array.from(store.values()).filter((s) => s.f).length;
  notes.push(`company figures (screener.in): ${ok} read this run, ${bad} could not be read, ${have} of ${universe.length} companies known, ${Math.max(0, due.length - ok - bad)} still waiting (read in the next runs)`);
  return store;
}

// ── SMA once per trading day ───────────────────────────────────────────────────────────────────────────────────────────
async function refreshSma(universe: string[], latest: string, budgetMs: number, notes: string[]): Promise<Map<string, { d: string; s50: number | null; s200: number | null }>> {
  const m = new Map<string, { d: string; s50: number | null; s200: number | null }>();
  const rows = await dbQuery<{ ticker: string; payload: any }>(`SELECT ticker, payload FROM screener_store WHERE market = 'IN' AND kind = 'sma'`).catch(() => []);
  for (const r of rows) m.set(r.ticker, r.payload);
  const due = universe.filter((t) => m.get(t)?.d !== latest);
  const t0 = Date.now();
  let done = 0;
  for (let k = 0; k < due.length && Date.now() - t0 < budgetMs; k += 20) {
    const batch = due.slice(k, k + 20);
    const got = await sparkCloses(batch.map((t) => `${t}.NS`));
    for (const t of batch) {
      const c = got.get(`${t}.NS`);
      if (!c) continue;
      const v = { d: latest, s50: sma(c, 50), s200: sma(c, 200) };
      m.set(t, v); done++;
      await dbQuery(`INSERT INTO screener_store (market, ticker, kind, payload, updated_at) VALUES ('IN', $1, 'sma', $2, now()) ON CONFLICT (market, ticker, kind) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`, [t, JSON.stringify(v)]).catch(() => null);
    }
    await sleep(200);
  }
  if (due.length) notes.push(`SMA 50 / 200: ${done} of ${due.length} companies updated for ${latest}${done < due.length && sparkLastError ? ` (last Yahoo refusal: ${sparkLastError})` : ''}`);
  return m;
}

// ── build ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function buildInSnapshot(opts: { fundBudgetMs?: number } = {}): Promise<{ ok: boolean; rows: number; notes: string[]; ms: number }> {
  const t0 = Date.now();
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
  const bhav = await loadBhav(11, notes);
  if (!bhav.length) return { ok: false, rows: 0, notes: [...notes, 'no NSE daily price file could be read'], ms: Date.now() - t0 };
  const latest = bhav[0];
  // the universe: listed EQ / BE companies that traded on the latest day
  const universe = Array.from(names.keys()).filter((t) => latest.px[t]).sort();
  notes.push(`NSE: ${names.size} listed companies, ${universe.length} traded on ${latest.date}`);
  const funds = await refreshFunds(universe, opts.fundBudgetMs ?? 9 * 60_000, notes);
  const smas = await refreshSma(universe, latest.date, 3 * 60_000, notes);

  const rows: ScreenRow[] = [];
  for (const t of universe) {
    const [close, prev, vol] = latest.px[t];
    const vols = bhav.slice(0, 10).map((b) => b.px[t]?.[2]).filter(fin);
    const f = funds.get(t)?.f;
    const mc = f?.shares != null ? Math.round(f.shares * close * 10) / 10 : null;
    const s = smas.get(t);
    const sales = f?.salesTTM ?? null;
    rows.push({
      t, n: names.get(t) || t, sec: f?.sector ?? null, ind: f?.industry ?? null, px: close, chg: prev > 0 ? Math.round(((close / prev) - 1) * 1000) / 10 : null,
      vol, avgVol10: vols.length >= 5 ? Math.round(vols.reduce((a, b) => a + b, 0) / vols.length) : null, mc,
      sma50: s?.s50 ?? null, sma200: s?.s200 ?? null,
      revQYoY: f?.revQYoY ?? null, revAYoY: f?.revAYoY ?? null, gpQYoY: f?.gpQYoY ?? null, gmFY: f?.gmFY ?? null,
      ebitdaQoQ: f?.ebitdaQoQ ?? null, ebitdaAYoY: f?.ebitdaAYoY ?? null, epsQYoY: f?.epsQYoY ?? null, opmTTM: f?.opmTTM ?? null,
      ps: mc != null && sales != null && sales > 0 ? Math.round((mc / sales) * 100) / 100 : null,
      evRev: mc != null && sales != null && sales > 0 ? Math.round(((mc + (f?.borrowings ?? 0) - (f?.cash ?? 0)) / sales) * 100) / 100 : null,
      de: f?.de ?? null, cash: f?.cash ?? null, emp: null, flt: null, bb: null, fs: f?.fs ?? null, q: f?.q ?? null,
      ...(f?.approx?.length ? { approx: f.approx } : {}),
    });
  }
  const sources = ['NSE company list', 'NSE daily price files', 'screener.in company pages', 'Yahoo daily prices'];
  await dbQuery(`INSERT INTO screener_snapshot (market, built_at, rows, meta) VALUES ('IN', now(), $1, $2) ON CONFLICT (market) DO UPDATE SET built_at = now(), rows = EXCLUDED.rows, meta = EXCLUDED.meta`,
    [JSON.stringify(rows), JSON.stringify({ notes, sources })]);
  return { ok: true, rows: rows.length, notes, ms: Date.now() - t0 };
}

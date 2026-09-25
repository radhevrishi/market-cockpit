// ═══════════════════════════════════════════════════════════════════════════
// PORTFOLIO FUNDAMENTALS — reading the two lists per country.        (zzz799)
//
// Browser side of lib/fundamentals/universe.ts. Every list is read from the
// SERVER first (so an installed phone app with empty storage gets the full
// list); this browser's own copy only ADDS names the server does not have
// yet. A source that fails is reported in `errors` — never shown as "empty".
// ═══════════════════════════════════════════════════════════════════════════

'use client';

import { CHAT_ID } from '@/lib/config';
import { readJson, humanError } from '@/lib/thesis/safe-json';
import { readHoldingSymbols } from '@/lib/thesis/universe';
import { mergeUsBench } from '@/lib/us-thesis/us-bench';
import {
  fetchManifest, fetchCsvText, fetchTradingviewManifest, fetchTradingviewCsvText, SYNC_ROUTING,
} from '@/lib/screener-data-loader';
import {
  mergeFundUniverse, fundCounts, mergeIndiaBench, usBookHoldings,
  type FundMarket, type FundUniverse, type IndiaBenchName,
} from './universe';

const TIMEOUT_MS = 25_000;

async function getJson(url: string): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { cache: 'no-store', signal: ctl.signal });
    const j = await readJson(r);
    if (!r.ok || j?.ok === false) throw new Error(j?.error || `HTTP ${r.status}`);
    return j;
  } finally { clearTimeout(t); }
}

const when = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? `, updated ${d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : '';
};

async function loadIndia(): Promise<FundUniverse> {
  const errors: string[] = [];
  const sources: string[] = [];
  // 1. India Portfolio Book — the /portfolio page's own server store.
  let bookServer: string[] = [];
  let bookOk = false;
  try {
    const j = await getJson(`/api/portfolio?chatId=${encodeURIComponent(String(CHAT_ID))}`);
    bookServer = (Array.isArray(j?.holdings) ? j.holdings : []).map((h: any) => String(h?.symbol || '')).filter(Boolean);
    bookOk = true;
  } catch (e) { errors.push(`India Portfolio Book could not be read from the server (${humanError(e)})`); }
  const local = Array.from(readHoldingSymbols());
  const serverSet = new Set(bookServer.map((s) => s.toUpperCase()));
  const localOnly = local.filter((s) => !serverSet.has(s.toUpperCase()));
  const book = [...bookServer, ...localOnly].map((symbol) => ({ symbol }));
  sources.push(`India Portfolio Book: ${bookServer.length} from the server${localOnly.length ? ` + ${localOnly.length} only in this browser` : ''}${bookOk ? '' : ' (server not read)'}`);

  // 2. India Conviction Beats — the server bench, plus this browser's list, minus removals.
  let server: IndiaBenchName[] = [];
  let updatedAt: string | null = null;
  try {
    const j = await getJson('/api/v1/bench?view=tickers');
    server = Array.isArray(j?.entries) ? j.entries : [];
    updatedAt = j?.updatedAt || null;
  } catch (e) { errors.push(`India Conviction Beats could not be read from the server (${humanError(e)})`); }
  let localCb: Array<{ ticker: string; company?: string | null }> = [];
  let removed: string[] = [];
  try {
    const m = await import('@/lib/conviction-beats');
    localCb = m.getConvictionList().map((e: any) => ({ ticker: String(e?.ticker || ''), company: e?.company || null }));
    removed = m.readConvictionBin().map((e: any) => String(e?.ticker || '')).filter(Boolean);
  } catch { /* no browser list (an installed app starts empty) */ }
  const cb = mergeIndiaBench(server, localCb, removed);
  sources.push(`India Conviction Beats: ${cb.server} from the server${when(updatedAt)}${cb.localOnly ? ` + ${cb.localOnly} only in this browser` : ''}${cb.removed ? ` − ${cb.removed} you removed` : ''}`);

  const names = mergeFundUniverse('INDIA', book, cb.names);
  return { market: 'INDIA', names, counts: fundCounts(names), leftOut: [], sources, errors };
}

async function loadUsa(): Promise<FundUniverse> {
  const errors: string[] = [];
  const sources: string[] = [];
  // 1. US Portfolio Book — holdings only (cash is not a stock; Frankfurt lines named and left out).
  let held: Array<{ symbol: string }> = [];
  let leftOut: Array<{ symbol: string; reason: string }> = [];
  try {
    const j = await getJson('/api/v1/us-book?view=universe');
    ({ held, leftOut } = usBookHoldings(j?.universe));
    sources.push(`US Portfolio Book: ${held.length} US-listed holding${held.length === 1 ? '' : 's'} from the server${when(j?.updatedAt)}${leftOut.length ? ` (${leftOut.length} non-US line${leftOut.length === 1 ? '' : 's'} left out)` : ''}`);
  } catch (e) { errors.push(`US Portfolio Book could not be read from the server (${humanError(e)})`); }

  // 2. US Conviction Beats — server list (rebuilds itself when empty) + this browser's, minus removals.
  let server: any[] = [];
  let updatedAt: string | null = null;
  let note: string | null = null;
  try {
    const j = await getJson('/api/v1/bench-us?view=tickers');
    server = Array.isArray(j?.entries) ? j.entries : [];
    updatedAt = j?.updatedAt || null;
    note = server.length ? null : (j?.note || null);
  } catch (e) { errors.push(`US Conviction Beats could not be read from the server (${humanError(e)})`); }
  let local: any[] = [];
  let removed: string[] = [];
  try {
    const m = await import('@/lib/conviction-beats-us');
    await m.hydrateUsConviction().catch(() => 0);
    local = Object.entries(m.readUsConviction()).map(([k, e]) => ({ ...(e as any), ticker: String((e as any)?.ticker || k) }));
    removed = m.readUsConvictionBin().map((e: any) => String(e?.ticker || '')).filter(Boolean);
  } catch { /* no browser list */ }
  const mg = mergeUsBench(server, local, removed);
  sources.push(`US Conviction Beats: ${mg.server} from the server${when(updatedAt)}${mg.localOnly ? ` + ${mg.localOnly} only in this browser` : ''}${mg.removed.length ? ` − ${mg.removed.length} you removed` : ''}${note ? ` (${note})` : ''}`);

  const names = mergeFundUniverse('USA', held, mg.names.map((n) => ({ symbol: n.ticker, company: n.company })));
  return { market: 'USA', names, counts: fundCounts(names), leftOut, sources, errors };
}

export function loadFundUniverse(market: FundMarket): Promise<FundUniverse> {
  return market === 'USA' ? loadUsa() : loadIndia();
}

/**
 * Every OTHER synced export of the same country, parsed by the caller's CSV
 * reader, for names the portfolio file does not carry. India: the screener.in
 * exports in the manifest. USA: the TradingView exports that are not India
 * screens. Read once per visit, in memory only (never saved to storage).
 */
export async function loadFundPool(
  market: FundMarket,
  parse: (text: string) => Array<Record<string, any>>,
): Promise<{ pool: Array<{ file: string; rows: Array<Record<string, any>> }>; files: number; failed: number }> {
  const out: Array<{ file: string; rows: Array<Record<string, any>> }> = [];
  let failed = 0;
  const m = market === 'USA' ? await fetchTradingviewManifest() : await fetchManifest();
  const own = market === 'USA' ? SYNC_ROUTING.portfolioUsa : SYNC_ROUTING.portfolioIndia;
  const names = (m?.files || [])
    .filter((f) => /\.csv$/i.test(f.name) && f.name !== own && !f.name.startsWith('_'))
    .filter((f) => (market === 'USA' ? !/^india-/i.test(f.name) : true));
  const read = market === 'USA' ? fetchTradingviewCsvText : fetchCsvText;
  await Promise.all(names.map(async (f) => {
    const text = await read(f.name);
    if (!text) { failed++; return; }
    try { out.push({ file: f.displayName || f.name, rows: parse(text) }); } catch { failed++; }
  }));
  // Stable order: the portfolio-adjacent watchlists first, then alphabetical.
  out.sort((a, b) => a.file.localeCompare(b.file));
  return { pool: out, files: names.length, failed };
}

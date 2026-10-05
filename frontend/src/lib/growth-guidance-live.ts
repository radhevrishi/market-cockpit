// zzz848 — live Growth Guidance pipeline (extracted from the growth-guidance route so the Guidance Universe can reuse it).
// Reads cached KV only (news, concall/filing feed, graded rows, ledger) plus the existing bounded NSE/BSE/EDGAR scan. Public data, never holdings.
import { kvGet, kvMGet } from '@/lib/kv';
import { gradedKey } from '@/lib/graded-cache-key';
import { US_ENGINE_VERSION, US_ENGINE_PREVIOUS_VERSIONS } from '@/lib/us-engine-version';
import { loadCatalog } from '@/lib/symbolMaster';
import { NSE_TICKER_NAMES } from '@/lib/nse-ticker-names';
import type { GuCandidate } from '@/lib/guidance-upgrades-types';
import {
  newsToCandidate, collectGradedRows, istDateList, dedupeCandidates, usSessionDates, loadUsSessions,
  reassignGlobalToUs, buildIndiaCandidates,
} from '@/lib/guidance-upgrades-candidates';
import { scanIndia, scanUs, makeRealIndiaFetchers, makeRealEdgarFetcher, type MarketScanResult } from '@/lib/guidance-upgrades-scan';
import { buildGrowthGuidance, type GgTickerCtx, type GgReported, type GgStoredEntry } from '@/lib/growth-guidance';
import { readGgLedgers, readGgIndex, writeGgLedgers } from '@/lib/growth-guidance-ledger';
import type { GgCompany, GgResponse, GgScanSource } from '@/lib/growth-guidance-types';
import { stripScanPrefix } from '@/lib/growth-guidance-format';
import { readNewsWithLastGood, makeKvNewsIo, type NewsRead } from '@/lib/guidance-upgrades-cache';
import { readConcallFeedWithFallback, makeKvFeedIo, type ConcallFeedRead } from '@/lib/concall-feed';

const BUDGET_MS = 22_000;
const DAYS = 30;
const MAX_PER_MARKET = 600;
const MEM_TTL_MS = 2 * 60_000;
export type GgLedgerInput = Array<{ market: 'IN' | 'US'; ticker: string; entries: GgStoredEntry[] }>;
export type Built = { at: number; all: GgCompany[]; scan: GgResponse['scan']; note?: string; ledger: GgLedgerInput };
const mem = new Map<string, Built>();

export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
function reportedFromRow(r: any, market: 'IN' | 'US'): { rep: GgReported; cap: number | null; bucket: string | null; pe: number | null } {
  const opm = numOrNull(r?.opm_pct); const prev = numOrNull(r?.opm_prev_pct);
  const usable = opm != null && prev != null && !(opm === 0 && prev !== 0);
  return {
    rep: {
      unit: market === 'IN' ? '₹ Cr' : '$M', latestQuarterYoyPct: numOrNull(r?.sales_yoy_pct), patYoyPct: numOrNull(r?.net_profit_yoy_pct ?? r?.pat_yoy_pct), epsYoyPct: numOrNull(r?.eps_yoy_pct),
      ebitdaYoyPct: market === 'IN' ? numOrNull(r?.op_profit_yoy_pct) : null, opmFrom: usable ? prev : null, opmTo: usable ? opm : null,
      cfoToPat: numOrNull(market === 'IN' ? r?.ocf_to_pat_ratio : r?.cfo_to_pat_ratio), fcf: market === 'US' ? numOrNull(r?.fcf_curr_musd) : null,
      asOf: String(r?.filing_date || '').slice(0, 10) || null,
    },
    cap: numOrNull(market === 'IN' ? r?.market_cap_cr : r?.market_cap_musd), bucket: r?.market_cap_bucket ? String(r.market_cap_bucket) : null, pe: numOrNull(r?.pe),
  };
}

export async function buildLiveGuidance(market: 'IN' | 'US' | 'ALL', now: Date, t0: number): Promise<Built> {
  const wantIN = market !== 'US'; const wantUS = market !== 'IN';
  const cands: GuCandidate[] = [];
  const newsArticles: any[] = [];
  const latestRow: Record<'IN' | 'US', Map<string, { date: string; row: any }>> = { IN: new Map(), US: new Map() };
  const usTickers = new Set<string>();
  const dates = istDateList(now, DAYS + 1);   // India graded sessions are keyed by the IST day
  const usDates = wantUS ? usSessionDates(now, DAYS) : [];
  const inFetch = wantIN ? makeRealIndiaFetchers() : null;
  const inScanP: Promise<MarketScanResult | null> = inFetch ? scanIndia({ now, days: 14, fetchNse: inFetch.nse, fetchBse: inFetch.bse, readBlob: inFetch.blob, collectorDays: inFetch.collector(), budgetMs: 11_000 }).catch(() => null) : Promise.resolve(null);
  const [newsRead, feedRead, graded, usSessions, scraped, catalog] = await Promise.all([
    // zzz854: the news key lives 5 minutes; a durable last-good copy (>= 26 h) serves when it is absent, labelled stale with its age
    withTimeout(readNewsWithLastGood(makeKvNewsIo(Math.min(BUDGET_MS, 6_000))), BUDGET_MS, null as NewsRead | null),
    // zzz854: the 30-day feed key may be absent: next-best key, then the last-good copy, all labelled. A failed read is never zero filings.
    wantIN ? withTimeout(readConcallFeedWithFallback(makeKvFeedIo(4_000)), BUDGET_MS, null as ConcallFeedRead | null) : Promise.resolve(null as ConcallFeedRead | null),
    wantIN ? withTimeout(kvMGet<any>(dates.map((d) => gradedKey(d))), BUDGET_MS, null) : Promise.resolve(null),
    wantUS ? withTimeout(loadUsSessions(usDates, [US_ENGINE_VERSION, ...US_ENGINE_PREVIOUS_VERSIONS.slice(0, 2)], (keys) => kvMGet<any>(keys)), BUDGET_MS, null) : Promise.resolve(null),
    // the news cache lives 5 minutes; the scraped India news blob lives 24h and is the steadier India media source
    wantIN ? withTimeout(kvGet<any>('scraped-india-news:v1:latest'), BUDGET_MS, null) : Promise.resolve(null),
    wantIN ? withTimeout(loadCatalog(), 4_000, null) : Promise.resolve(null),
  ]);
  const inScan = await withTimeout(inScanP, 12_500, null);
  const empty: string[] = []; const feedNotes: string[] = [];
  const news = newsRead?.articles ?? null;
  const feed = feedRead?.feed ?? null;
  if (newsRead && newsRead.servedBy !== 'LIVE' && newsRead.articles) feedNotes.push(newsRead.row.text);
  if (feedRead && feedRead.feed && feedRead.stale) feedNotes.push(feedRead.label);
  const scrapedList: any[] = Array.isArray(scraped) ? scraped : Array.isArray(scraped?.entries) ? scraped.entries : [];
  if (wantIN) {
    // every India input path (news, scraped news, exchange feed + live scan, graded rows) through one shared builder
    const b = buildIndiaCandidates({ news: Array.isArray(news) ? news : null, scraped, feed, graded: Array.isArray(graded) ? graded : null, gradedDates: dates, scanCandidates: inScan?.candidates || [], catalog }, NSE_TICKER_NAMES);
    cands.push(...b.candidates);
    if (!Array.isArray(feed?.filings)) empty.push(feedRead ? feedRead.label : 'India exchange filing feed: read timed out (unknown, not zero filings)');
    if (Array.isArray(graded)) graded.forEach((p, i) => {
      for (const r of collectGradedRows(p)) {
        const t = String(r?.symbol || r?.ticker || '').toUpperCase().replace(/\.(NS|BO)$/, '');
        const cur = latestRow.IN.get(t); if (t && (!cur || dates[i] > cur.date)) latestRow.IN.set(t, { date: dates[i], row: r });
      }
    }); else empty.push('India results cache');
    if (!scrapedList.length) empty.push('scraped India news (scraped-india-news:v1:latest missing or empty)');
  }
  if (wantUS) {
    if (usSessions) {
      for (const s of usSessions.rows.slice().sort((a, b) => b.date.localeCompare(a.date))) {
        for (const r of collectGradedRows(s.payload)) {
          const t = String(r?.ticker || '').trim().toUpperCase(); if (!t) continue;
          usTickers.add(t);
          if (!latestRow.US.has(t)) latestRow.US.set(t, { date: s.date, row: r });
          const snips: string[] = Array.isArray(r?.guidance_snippets) ? r.guidance_snippets : [];
          const url = [r?.guidance_url, r?.filing_url].find((u) => /sec\.gov/i.test(String(u || '')));
          if (snips.length) cands.push({ id: `usgraded:${t}:${s.date}`, ticker: t, company: String(r?.company || t), market: 'US', title: `${r?.company || t} results outlook`, text: snips.join(' ').slice(0, 1500), url,
            sourceName: url ? 'SEC filing (8-K)' : 'US graded results cache (no source link)', publishedAt: String(r?.filing_date || s.date).slice(0, 10), kind: url ? 'FILING' : 'OTHER' });
        }
      }
    } else empty.push('US graded-results cache');
  }
  if (Array.isArray(news)) { for (const a of news) { newsArticles.push(a); if (!wantIN) { const c = newsToCandidate(a); if (c) cands.push(c); } } } else empty.push(newsRead ? newsRead.row.text : 'news cache: read timed out (unknown, not zero articles)');
  let usScan: MarketScanResult | null = null;
  if (wantUS) {
    usScan = await withTimeout(scanUs({ now, days: 14, warmSessions: usSessions?.warm ?? 0, totalSessions: usSessions?.total ?? usDates.length, gradedTickers: new Set(usTickers), warmDates: new Set((usSessions?.rows || []).map((r) => r.date)),
      fetchEdgar: makeRealEdgarFetcher(), budgetMs: Math.max(3_000, Math.min(8_000, BUDGET_MS - (Date.now() - t0) - 7_000)) }), Math.max(3_500, Math.min(9_000, BUDGET_MS - (Date.now() - t0) - 6_500)), null);
  }
  const usSet = usTickers;
  const all = reassignGlobalToUs(dedupeCandidates(cands), usSet);
  const per: Record<'IN' | 'US', GuCandidate[]> = { IN: [], US: [] };
  for (const c of all) if ((c.market === 'IN' || c.market === 'US') && per[c.market].length < MAX_PER_MARKET) per[c.market].push(c);

  // news-derived links: bottleneck themes + article ids (only where the article names the ticker)
  const links = new Map<string, { ids: string[]; themes: string[]; special: boolean }>();
  for (const a of newsArticles) {
    const reg = String(a?.region || '').toUpperCase().startsWith('U') ? 'US' : 'IN';
    for (const raw of (Array.isArray(a?.ticker_symbols) ? a.ticker_symbols : [])) {
      const k = `${reg}:${String(raw).toUpperCase()}`; const cur = links.get(k) || { ids: [], themes: [], special: false };
      if (a?.id && !cur.ids.includes(String(a.id)) && cur.ids.length < 5) cur.ids.push(String(a.id));
      const th = a?.article_type === 'BOTTLENECK' ? (a?.bottleneck_sub_tag || a?.bottleneck_child) : null;
      if (th && !cur.themes.includes(String(th))) cur.themes.push(String(th));
      if (/special[_ ]?sit/i.test(String(a?.article_type || ''))) cur.special = true;
      links.set(k, cur);
    }
  }
  // ledgers: candidate tickers + every ticker the ledger index remembers
  const tk = (m: 'IN' | 'US') => Array.from(new Set(per[m].map((c) => (c.ticker || '').toUpperCase()).filter(Boolean)));
  const [idxIN, idxUS] = await Promise.all([wantIN ? withTimeout(readGgIndex('IN'), 2_000, []) : Promise.resolve([] as string[]), wantUS ? withTimeout(readGgIndex('US'), 2_000, []) : Promise.resolve([] as string[])]);
  const left = () => Math.max(2_000, BUDGET_MS - (Date.now() - t0) - 3_000);
  const [ledIN, ledUS] = await Promise.all([
    wantIN ? withTimeout(readGgLedgers([...tk('IN'), ...idxIN], 'IN'), left(), new Map()) : Promise.resolve(new Map()),
    wantUS ? withTimeout(readGgLedgers([...tk('US'), ...idxUS], 'US'), left(), new Map()) : Promise.resolve(new Map()),
  ]);
  const ctxFor = (ticker: string, m: 'IN' | 'US'): GgTickerCtx => {
    const t = ticker.toUpperCase(); const row = latestRow[m].get(t); const ln = links.get(`${m}:${t}`);
    const r = row ? reportedFromRow(row.row, m) : null;
    return {
      reported: r?.rep ?? null, marketCap: r?.cap ?? null, capBucket: r?.bucket ?? null, valuation: r?.pe != null ? { pe: r.pe } : null,
      themes: ln?.themes.length ? ln.themes : undefined, newsIds: ln?.ids.length ? ln.ids : undefined, specialSituation: ln?.special || false,
      ledger: (m === 'IN' ? ledIN : ledUS).get(t),
    };
  };
  const ledgerTickers = [...idxIN.map((t) => ({ market: 'IN' as const, ticker: t })), ...idxUS.map((t) => ({ market: 'US' as const, ticker: t }))];
  const built = buildGrowthGuidance({ candidates: [...per.IN, ...per.US], ctxFor, now, ledgerTickers });

  // persist AFTER the answer is built: bounded, idempotent, append-only
  const byM: Record<'IN' | 'US', Map<string, any[]>> = { IN: new Map(), US: new Map() };
  for (const [k, v] of Array.from(built.newEntries.entries())) { const [m, t] = k.split(':'); byM[m as 'IN' | 'US'].set(t, v); }
  await withTimeout(Promise.all([writeGgLedgers(byM.IN, ledIN, 'IN'), writeGgLedgers(byM.US, ledUS, 'US')]).then(() => 0), 3_000, 0);

  // scan status, honest
  const sources: GgScanSource[] = [];
  for (const [m, sc] of [['IN', inScan?.status], ['US', usScan?.status]] as const) {
    if ((m === 'IN' && !wantIN) || (m === 'US' && !wantUS)) continue;
    if (!sc) { sources.push({ name: m === 'IN' ? 'India NSE/BSE scan' : 'US SEC EDGAR scan', state: 'NOT_RUN', scanned: 0, detail: 'scan did not finish within budget' }); continue; }
    for (const s of sc.sources) sources.push({ name: `${m}: ${s.name}`, state: s.state as GgScanSource['state'], scanned: s.scanned, detail: s.detail });
  }
  for (const e of empty) sources.push({ name: e, state: 'FAILED', scanned: 0, detail: 'cache empty or timed out' });
  const complete = (!wantIN || !!inScan?.status.complete) && (!wantUS || !!usScan?.status.complete) && empty.length === 0;
  const staleTail = feedNotes.length ? ` Fallbacks in use: ${feedNotes.join(' ')}` : '';
  const note = complete ? `Scan complete for the sources read.${staleTail}` + ' Only text held in the caches is read; documents are not fetched, so a number is VERIFIED only when the company filing row itself carries it.'
    : `SCAN INCOMPLETE — ${[inScan?.status && !inScan.status.complete ? stripScanPrefix(inScan.status.note) : '', usScan?.status && !usScan.status.complete ? stripScanPrefix(usScan.status.note) : '', ...(empty.length ? [`Empty: ${empty.join(', ')}`] : []), ...(!inScan && wantIN ? ['India scan did not finish'] : []), ...(!usScan && wantUS ? ['US scan did not finish'] : []), ...feedNotes].filter(Boolean).join(' ').replace(/\.\s*$/, '')}. Empty results are not a confirmation of no guidance.`;
  const ledger: GgLedgerInput = [];
  for (const [m, mp] of [['IN', ledIN], ['US', ledUS]] as const) for (const [ticker, entries] of Array.from(mp.entries() as IterableIterator<[string, GgStoredEntry[]]>)) if (entries.length) ledger.push({ market: m, ticker, entries });
  return { at: Date.now(), all: built.companies, scan: { complete, note, sources, lastScanAt: now.toISOString() }, note: undefined, ledger };
}


/** Shared 2-minute in-memory cache: the Growth Guidance route and the Guidance Universe routes read the same live build. */
export async function getLiveGuidance(market: 'IN' | 'US' | 'ALL', now: Date, t0: number, force = false): Promise<Built> {
  let uni = mem.get(market);
  if (!uni || Date.now() - uni.at > MEM_TTL_MS || force) { uni = await buildLiveGuidance(market, now, t0); mem.set(market, uni); if (mem.size > 6) mem.delete(mem.keys().next().value as string); }
  return uni;
}

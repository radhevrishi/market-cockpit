// ═══════════════════════════════════════════════════════════════════════════
// GET /api/v1/guidance-upgrades?window=24H|3D|7D|14D|30D&market=IN|US|ALL   (zzz843)
//
// Finds positive company guidance raises, verifies them against a primary source, and returns the engine's events.
// PUBLIC company data only: no holdings, no personal data (My Book is overlaid in the browser).
// NO PAID AI. NO document fetching. Cache-first, bounded time, partial answers are labelled.
//
// Candidate feeds (all existing, all read from KV cache; a cold cache is reported, never rebuilt here):
//   · news:articles:v39 (the News & Signals cache; India and US). It lives 5 minutes, so it is often EMPTY between hourly refreshes.
//   · scraped-india-news:v1:latest (GitHub scraper, 24h: ET / Mint / Moneycontrol / Business Standard / NDTV, no tickers)
//   · guidance-upgrades:in-candidates:v1 (raise-worded India news kept here so a 7D/14D window outlives the feeds' own retention)
//   · concall-feed:v26:days:N (India exchange filings + concall items)
//   · graded:<engine>:<date> (India results with the company's own guidance text)
//   · us-graded:<engine>:<date>|1 (US graded results: the company's guidance, its OWN previous full-year guidance,
//     the SEC release link, and the analyst estimate already matched to the guided period)
// India and US are processed separately so a US and an India ticker with the same letters never merge.
// Consensus: US only, and only where the graded row already matched an estimate to that exact guided period.
// India has no analyst-estimates feed, so India consensus stays DATA UNAVAILABLE.
// ═══════════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvMGet, kvSet } from '@/lib/kv';
import { loadCatalog } from '@/lib/symbolMaster';
import { NSE_TICKER_NAMES } from '@/lib/nse-ticker-names';
import { gradedKey } from '@/lib/graded-cache-key';
import { isGuidanceUpgradeCandidate, processCandidates, rank, summarise, withinWindow } from '@/lib/guidance-upgrades';
import { US_ENGINE_VERSION, US_ENGINE_PREVIOUS_VERSIONS } from '@/lib/us-engine-version';
import type { GuCandidate, GuContext, GuScanSource, GuScanStatus, GuidanceEvent, GuidanceUpgradesResponse } from '@/lib/guidance-upgrades-types';
import {
  parseWindow, parseMarket, lookbackDays, newsToCandidate, collectGradedRows, istDate, istDateList, dedupeCandidates, usSessionDates,
  loadUsSessions, usGradedRowToCandidate, reassignGlobalToUs, splitByMarket, filterByMarket, originOf, coverageLine, coverageNote,
  looksLikeGuidanceRaise, buildIndiaCandidates, isRaiseCandidate, processRaiseCandidates, collectSubjectOnly, corroborateWithFilings,
  labelUnresolved, nameKeyOf, isResolvedTicker,
  type MarketCoverage, type UsRowResult, type IndiaBuild, type IndiaRead,
} from '@/lib/guidance-upgrades-candidates';
import { readLedgers, writeEvents } from '@/lib/guidance-upgrades-ledger';
import { scanIndia, scanUs, finaliseScan, makeRealIndiaFetchers, makeRealEdgarFetcher, type MarketScanResult } from '@/lib/guidance-upgrades-scan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const NEWS_KEY = 'news:articles:v39';
const SCRAPED_NEWS_KEY = 'scraped-india-news:v1:latest';
const RETAINED_KEY = 'guidance-upgrades:in-candidates:v1';
const RETAINED_DAYS = 35;
const RETAINED_MAX = 150;
const BUDGET_MS = 22_000;
const PER_MARKET_CAP = 300;
const mem = new Map<string, { at: number; body: GuidanceUpgradesResponse }>();
const MEM_TTL_MS = 2 * 60_000;

function noScan(m: 'IN' | 'US', now: Date, why: string, days: number): GuScanStatus {
  const d = m === 'IN' ? Math.max(days, 2) : days;
  const s: GuScanStatus = { market: m, windowFrom: '', windowTo: now.toISOString().slice(0, 10), complete: false, lastScanAt: now.toISOString(),
    sources: [{ name: m === 'IN' ? 'NSE/BSE announcements' : 'SEC EDGAR 8-K', state: 'NOT_RUN', scanned: 0, detail: why }],
    daysCovered: 0, daysRequested: d, candidatesFound: 0, processed: 0, awaitingGrading: 0, verified: 0, newestItemAt: null, note: '' };
  s.note = `SCAN INCOMPLETE \u2014 ${m === 'IN' ? 'India' : 'US'}: ${why}. Zero events shown is NOT a confirmation of no upgrades.`;
  return s;
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}
/** Like withTimeout, but says whether the answer was a timeout, so 'missing' and 'too slow' are reported differently. */
type Timed<T> = { v: T | null; timedOut: boolean };
async function timed<T>(p: Promise<T>, ms: number): Promise<Timed<T>> {
  let timedOut = false;
  const v = await Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => { timedOut = true; r(null); }, ms))]);
  return { v: v as T | null, timedOut };
}
const whyEmpty = (t: Timed<unknown>, key: string): string => (t.timedOut ? `${key} timed out` : `${key} missing or empty`);

export async function GET(req: NextRequest) {
  const t0 = Date.now();
  const sp = new URL(req.url).searchParams;
  const window = parseWindow(sp.get('window'));
  const market = parseMarket(sp.get('market'));
  const now = new Date();
  const memKey = `${window}:${market}`;
  const hit = mem.get(memKey);
  if (hit && Date.now() - hit.at < MEM_TTL_MS && sp.get('force') !== '1') {
    return NextResponse.json(hit.body, { headers: { 'Cache-Control': 'no-store' } });
  }

  const wantIN = market !== 'US';
  const wantUS = market !== 'IN';
  const days = lookbackDays(window);
  const cands: GuCandidate[] = [];
  let newsArticles: any[] = [];
  const peByTicker: Record<'IN' | 'US', Map<string, number>> = { IN: new Map(), US: new Map() };
  const usConsensus = new Map<string, NonNullable<GuContext['consensus']>>();
  const usCuts = new Map<string, string[]>();
  const usTickers = new Set<string>();

  // (a) news cache, (b) India filing feed cache, (c) India graded cache, (d) US graded cache — in parallel, each with the shared budget.
  const feedDays = days <= 2 ? [2, 7, 14, 30] : days <= 7 ? [7, 14, 30] : days <= 14 ? [14, 30] : [30];
  const feedKeys = feedDays.map((d) => `concall-feed:v26:days:${d}`);
  // India graded sessions and announcements are keyed by the IST day (an evening filing belongs to that IST date, not the UTC one)
  const dates = istDateList(now, days + 1);
  const usDates = wantUS ? usSessionDates(now, days) : [];
  const inFetch = wantIN ? makeRealIndiaFetchers() : null;
  // Live incremental India scan (exchange announcements per day + scraped filings blob): catches filings the caches have not seen yet.
  const inScanP: Promise<MarketScanResult | null> = inFetch
    ? scanIndia({ now, days, fetchNse: inFetch.nse, fetchBse: inFetch.bse, readBlob: inFetch.blob, budgetMs: 12_000 }).catch(() => null)
    : Promise.resolve(null);
  let feedKeyUsed = '';
  const [news, feed, graded, usSessions, scraped, retained, catalog] = await Promise.all([
    timed(kvGet<any[]>(NEWS_KEY), BUDGET_MS),
    wantIN ? timed((async () => { for (const k of feedKeys) { const v = await kvGet<any>(k); if (v && Array.isArray(v.filings)) { feedKeyUsed = k; return v; } } return null; })(), BUDGET_MS) : Promise.resolve<Timed<any>>({ v: null, timedOut: false }),
    wantIN ? timed(kvMGet<any>(dates.map((d) => gradedKey(d))), BUDGET_MS) : Promise.resolve<Timed<any[]>>({ v: null, timedOut: false }),
    wantUS ? withTimeout(loadUsSessions(usDates, [US_ENGINE_VERSION, ...US_ENGINE_PREVIOUS_VERSIONS.slice(0, 2)], (keys) => kvMGet<any>(keys)), BUDGET_MS, null) : Promise.resolve(null),
    wantIN ? timed(kvGet<any>(SCRAPED_NEWS_KEY), BUDGET_MS) : Promise.resolve<Timed<any>>({ v: null, timedOut: false }),
    wantIN ? timed(kvGet<any>(RETAINED_KEY), BUDGET_MS) : Promise.resolve<Timed<any>>({ v: null, timedOut: false }),
    wantIN ? timed(loadCatalog(), 4_000) : Promise.resolve<Timed<any>>({ v: null, timedOut: false }),
  ]);

  const inScan = await withTimeout(inScanP, 13_500, null);
  const cov: Record<'IN' | 'US', MarketCoverage> = {
    IN: { market: 'IN', candidates: { graded: 0, filings: 0, news: 0 }, cacheEmpty: [], events: 0, withConsensus: 0, newest: null },
    US: { market: 'US', candidates: { graded: 0, filings: 0, news: 0 }, cacheEmpty: [], events: 0, withConsensus: 0, newest: null },
  };

  const newsList: any[] | null = Array.isArray(news.v) ? news.v : null;
  const scrapedList: any[] = Array.isArray(scraped.v) ? scraped.v : Array.isArray(scraped.v?.entries) ? scraped.v.entries : Array.isArray(scraped.v?.items) ? scraped.v.items : [];
  const gradedPayloads = Array.isArray(graded.v) ? graded.v.filter((p: any) => p && p.by_tier).length : 0;
  let inBuild: IndiaBuild | null = null;
  if (wantIN) {
    inBuild = buildIndiaCandidates({
      news: newsList, scraped: scraped.v, feed: feed.v, graded: Array.isArray(graded.v) ? graded.v : null, gradedDates: dates,
      scanCandidates: inScan?.candidates || [], catalog: catalog.v,
      retained: Array.isArray(retained.v) ? (retained.v as GuCandidate[]) : [],
    }, NSE_TICKER_NAMES);
    cands.push(...inBuild.candidates);
    if (Array.isArray(graded.v)) for (const p of graded.v) for (const r of collectGradedRows(p)) {
      const t = String(r?.symbol || r?.ticker || '').toUpperCase().replace(/\.(NS|BO)$/, ''); const pe = Number(r?.pe);
      if (t && Number.isFinite(pe) && pe > 0) peByTicker.IN.set(t, pe);
    }
    if (!newsList?.length) cov.IN.cacheEmpty.push(`India news cache (${whyEmpty(news, NEWS_KEY)}; it expires after 5 minutes and is refreshed hourly)`);
    if (!scrapedList.length) cov.IN.cacheEmpty.push(`scraped India news (${whyEmpty(scraped, SCRAPED_NEWS_KEY)})`);
    if (!Array.isArray(feed.v?.filings)) cov.IN.cacheEmpty.push(`exchange filing feed (${feed.timedOut ? 'timed out' : `none of ${feedKeys.join(', ')} found`})`);
    if (gradedPayloads === 0) cov.IN.cacheEmpty.push(`results cache (${graded.timedOut ? 'timed out' : `no graded session found for ${dates[dates.length - 1]} to ${dates[0]}`})`);
  } else if (newsList) {
    for (const a of newsList) { const c = newsToCandidate(a); if (c) cands.push(c); }
  }
  if (newsList) newsArticles = newsList;
  if (wantUS) {
    if (usSessions) {
      cov.US.sessions = { warm: usSessions.warm, total: usSessions.total, olderEngine: usSessions.olderEngine };
      // newest session first, so the newest results row for a ticker supplies its consensus
      for (const s of usSessions.rows.slice().sort((a, b) => b.date.localeCompare(a.date))) {
        for (const r of collectGradedRows(s.payload)) {
          const t = String(r?.ticker || '').trim().toUpperCase();
          if (t) usTickers.add(t);
          const res: UsRowResult | null = usGradedRowToCandidate(r, s.date, s.payload?.generated_at);
          if (!res) continue;
          cands.push(res.cand);
          const tk = res.cand.ticker!;
          if (res.consensus && !usConsensus.has(tk)) usConsensus.set(tk, res.consensus);
          if (res.pe && !peByTicker.US.has(tk)) peByTicker.US.set(tk, res.pe);
          if (res.cuts.length) usCuts.set(tk, [...(usCuts.get(tk) || []), ...res.cuts]);
        }
      }
    } else { cov.US.cacheEmpty.push('graded-results cache (timed out)'); cov.US.sessions = { warm: 0, total: usDates.length, olderEngine: 0 }; }
    if (!wantIN && !newsList) cov.US.cacheEmpty.push('news cache');
  }
  if (wantUS && wantIN && !newsList) cov.US.cacheEmpty.push('news cache');
  if (wantUS && !wantIN && newsList && !newsList.length) cov.US.cacheEmpty.push('news cache');

  // US live scan: SEC 8-K index for each session, compared with the graded cache. Needs the sessions read above.
  let usScan: MarketScanResult | null = null;
  if (wantUS) {
    const gradedTickers = new Set<string>(usTickers);
    const warmDates = new Set<string>((usSessions?.rows || []).map((r) => r.date));
    usScan = await withTimeout(scanUs({
      now, days, warmSessions: usSessions?.warm ?? 0, totalSessions: usSessions?.total ?? usDates.length, gradedTickers, warmDates,
      fetchEdgar: makeRealEdgarFetcher(), budgetMs: Math.max(3_000, Math.min(9_000, BUDGET_MS - (Date.now() - t0) - 8_000)),
    }), Math.max(3_500, Math.min(9_500, BUDGET_MS - (Date.now() - t0) - 7_500)), null);
  }

  const inWindow = reassignGlobalToUs(dedupeCandidates(cands), usTickers).filter((c) => withinWindow(c.publishedAt, window, now));
  // India / unlabelled items: the engine's own test, or raise wording with a resolved symbol (kept as a visible CANDIDATE). US: as before.
  const isPicked = (c: GuCandidate) => (c.market === 'US' ? isGuidanceUpgradeCandidate(c).include || looksLikeGuidanceRaise(`${c.title}. ${c.text}`) : isRaiseCandidate(c));
  const pickedAll = inWindow.filter(isPicked);
  // raise wording but no company at all: the engine cannot group it, so say so instead of counting it
  const noCompany = pickedAll.filter((c) => c.market !== 'US' && !c.ticker && !nameKeyOf(c));
  const picked = pickedAll.filter((c) => !noCompany.includes(c)).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const split = splitByMarket(picked, PER_MARKET_CAP);
  for (const c of picked) if (c.market === 'IN' || c.market === 'US') cov[c.market].candidates[originOf(c)]++;
  const unresolved = picked.filter((c) => c.market !== 'US' && !c.ticker);
  const unresolvedKeys = new Set(unresolved.map(nameKeyOf));
  // exchange announcements whose subject names a guidance-bearing document but carry no raise text we can read
  const subjectOnly = collectSubjectOnly(inWindow.filter((c) => c.market === 'IN' && !isPicked(c)));

  // Ledger reads (history) — one batched read per market, then a synchronous ctxFor.
  const tickersOf = (list: GuCandidate[]) => Array.from(new Set(list.map((c) => c.ticker).filter((t): t is string => !!t)));
  const inTickers = tickersOf([...split.IN, ...split.GLOBAL]);
  const usPicked = tickersOf(split.US);
  const left = () => Math.max(2_000, BUDGET_MS - (Date.now() - t0));
  const [ledIN, ledUS] = await Promise.all([
    withTimeout(readLedgers(inTickers, 'IN'), left(), new Map()),
    withTimeout(readLedgers(usPicked, 'US'), left(), new Map()),
  ]);

  // News / bottleneck links: only where the article names the ticker AND was classified BOTTLENECK by the news pipeline.
  // An India article is linked by the symbol it was resolved to (company name in the headline), not only by the pipeline's own ticker list.
  const allTickers = new Set([...inTickers, ...usPicked]);
  const resolvedOf = new Map<string, string>();
  for (const c of inWindow) if (c.id.startsWith('news:') && c.ticker) resolvedOf.set(c.id.slice(5), c.ticker);
  const linksByTicker = new Map<string, { ids: string[]; themes: string[] }>();
  for (const a of newsArticles) {
    const ts: string[] = Array.isArray(a?.ticker_symbols) ? a.ticker_symbols : [];
    const extra = a?.id != null ? resolvedOf.get(String(a.id)) : undefined;
    for (const raw of extra ? [...ts, extra] : ts) {
      const t = String(raw).toUpperCase();
      if (!allTickers.has(t)) continue;
      const cur = linksByTicker.get(t) || { ids: [], themes: [] };
      if (a?.id && !cur.ids.includes(a.id) && cur.ids.length < 5) cur.ids.push(String(a.id));
      const theme = a?.article_type === 'BOTTLENECK' ? (a?.bottleneck_sub_tag || a?.bottleneck_child) : null;
      if (theme && !cur.themes.includes(String(theme))) cur.themes.push(String(theme));
      linksByTicker.set(t, cur);
    }
  }

  const ctxMaker = (m: 'IN' | 'US', ledgers: Map<string, any>) => (ticker: string): GuContext => {
    const t = ticker.toUpperCase();
    const led = ledgers.get(t);
    const ln = linksByTicker.get(t);
    const pe = peByTicker[m].get(t);
    return {
      // consensus: US only, and only an estimate the graded row already matched to that guided period. India: none exists.
      consensus: m === 'US' ? usConsensus.get(t) : undefined,
      priceContext: pe ? { pe } : undefined,
      newsIds: ln?.ids.length ? ln.ids : undefined,
      bottleneckThemes: ln?.themes.length ? ln.themes : undefined,
      ledger: led?.rows, priorGuidance: led?.points,
    };
  };

  let all: GuidanceEvent[] = [];
  let corroborated = 0; let unmatchedSubjects = subjectOnly;
  try {
    let inEvents = processRaiseCandidates([...split.IN, ...split.GLOBAL], ctxMaker('IN', ledIN), now, window);
    const corr = corroborateWithFilings(inEvents, subjectOnly);
    corroborated = corr.matched; unmatchedSubjects = corr.unmatched;
    inEvents = labelUnresolved(corr.events, unresolvedKeys);
    const usEvents = processCandidates(split.US, ctxMaker('US', ledUS), now, window);
    // the same release also cut something: the engine keeps the raises, so say the cut here
    for (const e of usEvents) {
      const cuts = usCuts.get(e.ticker.toUpperCase());
      if (cuts?.length && e.primaryAvailable) e.risks = [`${cuts[0]}.`, ...e.risks].slice(0, 4);
    }
    all = rank([...inEvents, ...usEvents]);
  } catch (e: any) {
    console.error('[guidance-upgrades] engine error', e?.message || e);
    return NextResponse.json({ ok: false, error: 'The guidance engine could not finish. Please try again.' }, { status: 500 });
  }
  const events = filterByMarket(all, market);

  // Write the ledger AFTER the answer is built; bounded, idempotent, never blocks the response for long.
  // Raise-worded India news is also kept (35 days, newest 150) so a 7D / 14D window still sees it after the feeds drop the article.
  const retainedIds = new Set(((Array.isArray(retained.v) ? retained.v : []) as GuCandidate[]).map((c) => c?.id));
  const freshMedia = picked.filter((c) => c.market === 'IN' && c.id.startsWith('news:') && !retainedIds.has(c.id));
  const keepFrom = new Date(now.getTime() - RETAINED_DAYS * 86_400_000).toISOString();
  const retainNext = freshMedia.length
    ? [...freshMedia, ...((Array.isArray(retained.v) ? retained.v : []) as GuCandidate[])].filter((c) => c?.publishedAt && c.publishedAt >= keepFrom).slice(0, RETAINED_MAX)
    : null;
  await withTimeout(Promise.all([
    writeEvents(events.filter((e) => e.market !== 'US' && isResolvedTicker(e.ticker)), ledIN, 'IN'),
    writeEvents(events.filter((e) => e.market === 'US'), ledUS, 'US'),
    retainNext ? kvSet(RETAINED_KEY, retainNext, RETAINED_DAYS * 86_400).catch(() => 0) : Promise.resolve(0),
  ]).then(() => 0), 3_000, 0);

  // India: what each source returned, in numbers, so a zero can be explained (never by consensus).
  const read: IndiaRead = {
    news: inBuild?.counts.news ?? 0, newsScraped: inBuild?.counts.newsScraped ?? scrapedList.length, retained: inBuild?.counts.retained ?? 0,
    filings: (inBuild?.counts.filings ?? 0) + (inScan?.rowsSeen ?? 0), graded: inBuild?.counts.gradedRows ?? 0,
    subjectOnly: unmatchedSubjects.length, unresolved: unresolvedKeys.size, noCompany: noCompany.length,
  };
  if (wantIN) cov.IN.read = read;

  const srcRow = (name: string, n: number, bad: string | null, detail: string): GuScanSource => ({ name, state: bad ? 'FAILED' : 'COMPLETE', scanned: n, detail: bad || detail });
  const newsRaise = picked.filter((c) => c.market !== 'US' && c.id.startsWith('news:')).length;
  const inExtra: GuScanSource[] = wantIN ? [
    srcRow('India news cache', read.news, newsList?.length ? null : whyEmpty(news, NEWS_KEY), `${read.news} India of ${inBuild?.counts.newsAll ?? 0} articles read`),
    srcRow('Scraped India news', read.newsScraped, scrapedList.length ? null : whyEmpty(scraped, SCRAPED_NEWS_KEY), `${read.newsScraped} entries read (company named in the headline, no ticker)${read.retained ? `; ${read.retained} raise-worded items kept from earlier days` : ''}; ${newsRaise} with raise wording in this window`),
    srcRow('Exchange filing feed cache', Array.isArray(feed.v?.filings) ? feed.v.filings.length : 0, Array.isArray(feed.v?.filings) ? null : (feed.timedOut ? 'concall-feed timed out' : `none of ${feedKeys.join(', ')} found`), `${feed.v?.filings?.length ?? 0} announcements read from ${feedKeyUsed}`),
    srcRow('India results cache', read.graded, gradedPayloads ? null : (graded.timedOut ? 'graded cache timed out' : `no graded session found for ${dates[dates.length - 1]} to ${dates[0]}`), `${read.graded} results rows with guidance text, from ${gradedPayloads} of ${dates.length} days`),
    srcRow('Announcements with subject only', unmatchedSubjects.length, null, `${unmatchedSubjects.length} announcement${unmatchedSubjects.length === 1 ? '' : 's'} name an AGM outcome, presentation, press release, call or results document${unmatchedSubjects.length ? ` (e.g. ${unmatchedSubjects.slice(0, 4).map((f) => f.company || f.ticker || 'company').join(', ')})` : ''}; the document is not opened here, so they are NOT counted as raises${corroborated ? `; ${corroborated} raise${corroborated === 1 ? '' : 's'} have such a filing on file` : ''}`),
  ] : [];
  const bothNewsEmpty = wantIN && !newsList?.length && !scrapedList.length && !(inBuild?.counts.retained);

  // Per-market coverage: what was found, how fresh, and what is DATA UNAVAILABLE.
  const newestOf = (list: GuidanceEvent[]) => list.map((e) => e.announcement_timestamp || e.announcement_date).filter(Boolean).sort().pop() || null;
  const byMarket: NonNullable<GuidanceUpgradesResponse['freshness']['byMarket']> = {};
  const covLines: MarketCoverage[] = [];
  const scan: NonNullable<GuidanceUpgradesResponse['scan']> = {};
  for (const m of ['IN', 'US'] as const) {
    if ((m === 'IN' && !wantIN) || (m === 'US' && !wantUS)) continue;
    const mine = events.filter((e) => e.market === m);
    cov[m].events = mine.length;
    cov[m].withConsensus = mine.filter((e) => e.consensus.value != null).length;
    cov[m].newest = newestOf(mine);
    cov[m].verified = mine.filter((e) => e.verification === 'VERIFIED').length;
    let sc = m === 'IN' ? inScan?.status : usScan?.status;
    if (sc && m === 'IN') sc = { ...sc, sources: [...sc.sources, ...inExtra], complete: sc.complete && !bothNewsEmpty };
    const found = cov[m].candidates.graded + cov[m].candidates.filings + cov[m].candidates.news;
    if (sc) {
      scan[m] = finaliseScan(sc, { found, processed: mine.length, verified: cov[m].verified!, newest: cov[m].newest });
    } else {
      const ns = noScan(m, now, 'scan did not finish within budget', days);
      scan[m] = m === 'IN' ? finaliseScan({ ...ns, sources: [...ns.sources, ...inExtra] }, { found, processed: mine.length, verified: cov[m].verified!, newest: cov[m].newest }) : ns;
    }
    cov[m].scan = scan[m];
    covLines.push(cov[m]);
    byMarket[m] = {
      newestAnnouncement: cov[m].newest, events: mine.length, withConsensus: cov[m].withConsensus, candidates: cov[m].candidates,
      sessions: cov[m].sessions, cold: m === 'US' ? (cov.US.sessions ? cov.US.sessions.warm === 0 && cov.US.sessions.total > 0 : true) : cov.IN.cacheEmpty.length >= 2,
      note: coverageLine(cov[m], now),
    };
  }

  const newest = newestOf(events);
  const checkedAt = now.toISOString();
  let note: string | undefined;
  const anyIncomplete = Object.values(scan).some((x) => x && !x.complete);
  if (!events.length) note = anyIncomplete
    ? `No guidance raises shown, but the scan was INCOMPLETE, so this is NOT a confirmation of no upgrades. Last checked ${checkedAt.slice(11, 16)} UTC.`
    : `Scan complete: no guidance raises found in the last ${days === 1 ? '24 hours' : `${days} days`}; last checked ${checkedAt.slice(11, 16)} UTC.`;
  note = `${note ? `${note} ` : ''}${coverageNote(covLines, now)}`;

  const summary = summarise(events, window, now);
  try {
    // fill V2 summary fields when the engine's summarise() did not
    const tally = (m: 'IN' | 'US') => { const l = events.filter((e) => e.market === m); return {
      detected: l.length, verified: l.filter((e) => e.verification === 'VERIFIED').length,
      material: l.filter((e) => e.materiality === 'HIGH' || e.materiality === 'MEDIUM').length,
      expectationPositive: l.filter((e) => e.expectationGap === 'POSITIVE' || e.expectationGap === 'LARGE_POSITIVE').length }; };
    if (!summary.byMarket) summary.byMarket = { IN: tally('IN'), US: tally('US') };
    if (!summary.consensusAvailable) summary.consensusAvailable = { have: events.filter((e) => e.consensus.value != null).length, of: events.length };
    // "today" is the Indian day for India events (IST) and the UTC day otherwise; detected is not verified, only verified counts
    const todays = new Set([now.toISOString().slice(0, 10), istDate(now)]);
    summary.today = events.filter((e) => e.verification === 'VERIFIED' && todays.has((e.announcement_date || '').slice(0, 10))).length;
  } catch { /* summary extras are optional */ }
  const body: GuidanceUpgradesResponse = {
    summary, events, scan,
    freshness: { newestAnnouncement: newest, feedCheckedAt: checkedAt, note, byMarket },
  };
  mem.set(memKey, { at: Date.now(), body });
  if (mem.size > 20) mem.delete(mem.keys().next().value as string);
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
}

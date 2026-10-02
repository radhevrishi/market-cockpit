// ═══════════════════════════════════════════════════════════════════════════
// GET /api/v1/guidance-upgrades?window=24H|3D|7D|14D|30D&market=IN|US|ALL   (zzz843)
//
// Finds positive company guidance raises, verifies them against a primary source, and returns the engine's events.
// PUBLIC company data only: no holdings, no personal data (My Book is overlaid in the browser).
// NO PAID AI in this route (zzz854: the AI verifier runs in /api/v1/ai-verify; this route only applies its cached verdicts). Cache-first, bounded time, partial answers are labelled. zzz853: a small bounded queue (<= 12 documents, ~15 s per run) reads exchange / SEC
// documents through the repo's own text helpers (see guidance-upgrades-queue.ts); a document confirms an event only when company, metric, period and value are all read.
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
import { isGuidanceUpgradeCandidate, mergeCandidates, processCandidates, rank, summarise, withinWindow, partitionPipeline, withClassification, reviewItemOf } from '@/lib/guidance-upgrades';
import { US_ENGINE_VERSION, US_ENGINE_PREVIOUS_VERSIONS } from '@/lib/us-engine-version';
import type { GuCandidate, GuContext, GuScanSource, GuScanStatus, GuWindow, GuidanceEvent, GuidanceUpgradesResponse } from '@/lib/guidance-upgrades-types';
import {
  parseWindow, parseMarket, lookbackDays, newsToCandidate, collectGradedRows, istDate, istDateList, dedupeCandidates, usSessionDates,
  loadUsSessions, usGradedRowToCandidate, reassignGlobalToUs, splitByMarket, filterByMarket, originOf, coverageLine, coverageNote,
  looksLikeGuidanceRaise, buildIndiaCandidates, isRaiseCandidate, processRaiseCandidates, collectSubjectOnly, corroborateWithFilings,
  quarantineUnresolved, isResolvedTicker, noUpgradesNote, sanitizeRaiseCandidate, withProvenance, tagOrigin, computeCoverage, LIVE_SCAN_MAX_DAYS, coverageLabel,
  type MarketCoverage, type UsRowResult, type IndiaBuild, type IndiaRead,
} from '@/lib/guidance-upgrades-candidates';
import { readLedgers, writeEvents, readEventStore, mergeIntoStore, writeEventStore, storedCandidates, storeCoveredDays } from '@/lib/guidance-upgrades-ledger';
import { scanIndia, scanUs, finaliseScan, makeRealIndiaFetchers, makeRealEdgarFetcher, type MarketScanResult } from '@/lib/guidance-upgrades-scan';
import { loadUniverseRecords, makeExtraFor, universeLookup, writeEventStatuses } from '@/lib/guidance-upgrades-reconcile';
import type { GuUniverseRecordX } from '@/lib/guidance-universe';
import { readNewsWithLastGood, makeKvNewsIo, newsFallbackNote, cacheStateText, type NewsRead } from '@/lib/guidance-upgrades-cache';
import { readQueue, writeQueue, emptyQueue, enqueue, processQueue, doneCandidates, reportQueue, awaitingCount, unavailableCount, readNoEventCount, makeDefaultFetchDoc, DOC_BUDGET_MS, type QueueState } from '@/lib/guidance-upgrades-queue';
import { assignEventDates, reconcilePrimary, queueInputsFromFilings, type PrimaryFiling } from '@/lib/guidance-upgrades-sources';
import { computeCounts, checkEventInvariants, enforceEventInvariants, countsDetail, detectedEquation, GUIDANCE_BUCKETS, NOT_GUIDANCE_BUCKETS, BUCKET_LABEL, type GuCountsX, type CountBucket } from '@/lib/guidance-upgrades-counts';
import { readConcallFeedWithFallback, makeKvFeedIo, type ConcallFeedRead } from '@/lib/concall-feed';
import { buildCoverageCard, buildCoverageBlock } from '@/lib/guidance-upgrades-coverage';
import { isRaiseBearingSubject, normCompanyName } from '@/lib/guidance-upgrades-candidates';
import type { GuCacheRow } from '@/lib/guidance-upgrades-types';
import { verifyEventsOverlay } from '@/lib/ai-verify';
import { checkGuidanceResponseReconciles } from '@/lib/ai-verify-gate';
import type { VerificationSummary } from '@/lib/ai-verify-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const NEWS_KEY = 'news:articles:v39';
const SCRAPED_NEWS_KEY = 'scraped-india-news:v1:latest';
const RETAINED_KEY = 'guidance-upgrades:in-candidates:v1';
// raise-worded India news is kept >= 130 days (was 35) so a 120D window outlives the news feeds; bounded by count and by serialised size
const RETAINED_DAYS = 130;
const RETAINED_MAX = 600;
const RETAINED_MAX_CHARS = 900_000;
const BUDGET_MS = 22_000;
const PER_MARKET_CAP = 300;
const PER_MARKET_CAP_LONG = 600;
const mem = new Map<string, { at: number; body: GuidanceUpgradesResponse }>();
const MEM_TTL_MS = 2 * 60_000;

function noScan(m: 'IN' | 'US', now: Date, why: string, days: number, window: GuWindow = '7D'): GuScanStatus {
  const d = m === 'IN' ? Math.max(days, 2) : days;
  const s: GuScanStatus = { market: m, windowFrom: '', windowTo: now.toISOString().slice(0, 10), complete: false, lastScanAt: now.toISOString(),
    sources: [{ name: m === 'IN' ? 'NSE/BSE announcements' : 'SEC EDGAR 8-K', state: 'NOT_RUN', scanned: 0, detail: why }],
    daysCovered: 0, daysRequested: d, candidatesFound: 0, processed: 0, awaitingGrading: 0, verified: 0, newestItemAt: null, note: '' };
  s.note = `SCAN INCOMPLETE \u2014 ${m === 'IN' ? 'India' : 'US'}: ${why}. Zero events shown is NOT a confirmation of no upgrades.`;
  s.windowDays = days; s.status = 'FAILED'; s.sourcesCount = 0; s.coverageLabel = coverageLabel(0, d, window);
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
  const long = days > LIVE_SCAN_MAX_DAYS;   // 120D: live scans stay bounded, the rest of the window comes from the persisted event store
  const cands: GuCandidate[] = [];
  let newsArticles: any[] = [];
  const peByTicker: Record<'IN' | 'US', Map<string, number>> = { IN: new Map(), US: new Map() };
  const usConsensus = new Map<string, NonNullable<GuContext['consensus']>>();
  const usCuts = new Map<string, string[]>();
  const usTickers = new Set<string>();

  // (a) news cache, (b) India filing feed cache, (c) India graded cache, (d) US graded cache — in parallel, each with the shared budget.
  const feedDays = days <= 2 ? [2, 7, 14, 30] : days <= 7 ? [7, 14, 30] : days <= 14 ? [14, 30] : [30];
  // zzz854: the India filing feed is read through the shared fallback reader (preferred key → shorter keys → last-good copy, every miss named)
  let feedRead: ConcallFeedRead | null = null;
  // India graded sessions and announcements are keyed by the IST day (an evening filing belongs to that IST date, not the UTC one)
  const dates = istDateList(now, days + 1);
  const usDates = wantUS ? usSessionDates(now, days) : [];
  const inFetch = wantIN ? makeRealIndiaFetchers() : null;
  // persisted raise events + processed days (written after each run): what serves a long window once the live caches have expired
  const storeP = Promise.all([wantIN ? readEventStore('IN') : Promise.resolve(null), wantUS ? readEventStore('US') : Promise.resolve(null)]);
  const gradedP: Promise<Timed<any[]>> = wantIN ? timed(kvMGet<any>(dates.map((d) => gradedKey(d))), BUDGET_MS) : Promise.resolve<Timed<any[]>>({ v: null, timedOut: false });
  const gradedDaysP: Promise<Set<string> | null> = gradedP.then((g) => (Array.isArray(g.v) ? new Set(dates.filter((_d, i) => !!(g.v as any[])[i]?.by_tier)) : null));
  // Live incremental India scan (exchange announcements per day + scraped filings blob): catches filings the caches have not seen yet.
  const inScanP: Promise<MarketScanResult | null> = inFetch
    ? storeP.then(([stIN]) => scanIndia({ now, days, window, fetchNse: inFetch.nse, fetchBse: inFetch.bse, readBlob: inFetch.blob, budgetMs: 12_000, storeCovered: storeCoveredDays(stIN), gradedDays: gradedDaysP })).catch(() => null)
    : Promise.resolve(null);
  // zzz853: news cache with a last-good fallback (the live key lives 5 minutes and is refilled hourly, so a miss is normal and is not a data statement)
  const nr: { v: NewsRead | null } = { v: null };
  const timedNews = async (): Promise<Timed<any[]>> => {
    const r = await timed(readNewsWithLastGood(makeKvNewsIo(Math.min(BUDGET_MS, 6_000))), BUDGET_MS);
    nr.v = r.v;
    return { v: r.v?.articles ?? null, timedOut: r.timedOut };
  };
  const queueP: Promise<QueueState | null> = withTimeout(readQueue(), 4_000, null);
  const [news, feed, graded, usSessions, scraped, retained, catalog, [storeIN, storeUS]] = await Promise.all([
    timedNews(),
    wantIN ? timed(readConcallFeedWithFallback(makeKvFeedIo(Math.min(BUDGET_MS, 6_000)), feedDays).then((r) => { feedRead = r; return r.feed; }), BUDGET_MS) : Promise.resolve<Timed<any>>({ v: null, timedOut: false }),
    gradedP,
    wantUS ? withTimeout(long
      ? loadUsSessions(usDates, [US_ENGINE_VERSION, ...US_ENGINE_PREVIOUS_VERSIONS.slice(0, 2)], (keys) => kvMGet<any>(keys), 15, { concurrency: 4, budgetMs: 10_000 })   // ~85 sessions: mget chunks of 15, 4 at a time, inside the budget
      : loadUsSessions(usDates, [US_ENGINE_VERSION, ...US_ENGINE_PREVIOUS_VERSIONS.slice(0, 2)], (keys) => kvMGet<any>(keys)), BUDGET_MS, null) : Promise.resolve(null),
    wantIN ? timed(kvGet<any>(SCRAPED_NEWS_KEY), BUDGET_MS) : Promise.resolve<Timed<any>>({ v: null, timedOut: false }),
    wantIN ? timed(kvGet<any>(RETAINED_KEY), BUDGET_MS) : Promise.resolve<Timed<any>>({ v: null, timedOut: false }),
    wantIN ? timed(loadCatalog(), 4_000) : Promise.resolve<Timed<any>>({ v: null, timedOut: false }),
    storeP,
  ]);
  // events persisted by earlier runs go back through the SAME engine; live candidates are added first, so a live copy always wins the dedupe
  const storedIN = storedCandidates(storeIN).filter((c) => c.market !== 'US');
  const storedUS = storedCandidates(storeUS).filter((c) => c.market === 'US');

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
      retained: [...(Array.isArray(retained.v) ? (retained.v as GuCandidate[]) : []), ...storedIN],
    }, NSE_TICKER_NAMES);
    cands.push(...inBuild.candidates);
    if (Array.isArray(graded.v)) for (const p of graded.v) for (const r of collectGradedRows(p)) {
      const t = String(r?.symbol || r?.ticker || '').toUpperCase().replace(/\.(NS|BO)$/, ''); const pe = Number(r?.pe);
      if (t && Number.isFinite(pe) && pe > 0) peByTicker.IN.set(t, pe);
    }
    if (!newsList?.length) cov.IN.cacheEmpty.push(`India news cache (${nr.v?.row.text ?? whyEmpty(news, NEWS_KEY)})`);
    if (!scrapedList.length) cov.IN.cacheEmpty.push(`scraped India news (${whyEmpty(scraped, SCRAPED_NEWS_KEY)})`);
    if (!Array.isArray(feed.v?.filings)) cov.IN.cacheEmpty.push(`exchange filing feed (${feed.timedOut ? 'timed out' : (feedRead as ConcallFeedRead | null)?.label ?? 'not read'})`);
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
    cands.push(...storedUS);   // raises persisted by earlier runs (graded sessions that have since left the cache)
  }
  if (wantUS && wantIN && !newsList) cov.US.cacheEmpty.push('news cache');
  if (wantUS && !wantIN && newsList && !newsList.length) cov.US.cacheEmpty.push('news cache');

  // US live scan: SEC 8-K index for each session, compared with the graded cache. Needs the sessions read above.
  let usScan: MarketScanResult | null = null;
  if (wantUS) {
    const gradedTickers = new Set<string>(usTickers);
    const warmDates = new Set<string>((usSessions?.rows || []).map((r) => r.date));
    usScan = await withTimeout(scanUs({
      now, days, window, warmSessions: usSessions?.warm ?? 0, totalSessions: usSessions?.total ?? usDates.length, gradedTickers, warmDates, storeCovered: storeCoveredDays(storeUS),
      fetchEdgar: makeRealEdgarFetcher(), budgetMs: Math.max(3_000, Math.min(9_000, BUDGET_MS - (Date.now() - t0) - 8_000)),
    }), Math.max(3_500, Math.min(9_500, BUDGET_MS - (Date.now() - t0) - 7_500)), null);
  }

  // zzz853: queue. Filings whose SUBJECT names a guidance-bearing document (and SEC 8-Ks not yet graded) are queued, a few are read (P0 first, bounded),
  // and documents that showed company + metric + period + value come back as primary-source candidates for the same engine.
  const filingPool: PrimaryFiling[] = [];
  const seenPool = new Set<string>();
  for (const c of cands) {
    if (c.market !== 'IN' || c.kind !== 'FILING' || !c.id.startsWith('filing:') || !isRaiseBearingSubject(c.title)) continue;
    const k = `${c.id}`; if (seenPool.has(k)) continue; seenPool.add(k);
    filingPool.push({ market: 'IN', ticker: c.ticker, company: c.company, subject: c.title, date: c.publishedAt.slice(0, 10), url: c.url ?? null, exchange: c.sourceName.replace(/ filing$/, '') });
  }
  for (const d of usScan?.awaitingDocs ?? []) {
    filingPool.push({ market: 'US', ticker: d.ticker ?? undefined, company: d.company ?? undefined, subject: 'Form 8-K earnings release (items 2.02 / 7.01)', date: d.filed.slice(0, 10), url: d.url, exchange: 'SEC EDGAR', anySubject: true });
  }
  // a company with a media raise waiting for its document is read first (P0)
  const waitingKeys = new Set<string>();
  for (const c of cands) if (c.market !== 'US' && c.kind !== 'FILING' && c.ticker && isRaiseCandidate(c)) waitingKeys.add(`IN|${c.ticker.toUpperCase()}`);
  let queue: QueueState = (await queueP) ?? emptyQueue(now);
  const queueReadOk = !!(await queueP);
  const enq = enqueue(queue, queueInputsFromFilings(filingPool, waitingKeys), now);
  queue = enq.queue;
  const qLeft = Math.min(DOC_BUDGET_MS, 26_000 - (Date.now() - t0));
  const qRun = qLeft >= 2_500 ? await withTimeout(processQueue(queue, { now, fetchDoc: makeDefaultFetchDoc(Math.min(10_000, qLeft)), budgetMs: qLeft }), qLeft + 1_500, null) : null;
  if (qRun) queue = qRun.queue;
  cands.push(...doneCandidates(queue));

  // zzz853: the company announcement date, not the media date, decides the window. A media article takes the date of the matching primary item.
  const dated = assignEventDates(reassignGlobalToUs(dedupeCandidates(cands), usTickers));
  // headlines that raise funds / bonds / NCDs / QIP / loans / a stake / prices / capex / a dividend / a bid / a price target, or an index wrap, are not guidance.
  // zzz849: this guard runs on EVERY candidate (news, scraped, retained / stored, exchange filing, graded, US), not only on fresh news ids.
  const inWindow = dated.cands.filter((c) => withinWindow(c.eventDate || c.publishedAt, window, now))
    .map((c) => sanitizeRaiseCandidate(c)).filter((c): c is GuCandidate => !!c);
  // India / unlabelled items: the engine's own test, or raise wording with a resolved symbol (kept as a visible CANDIDATE). US: as before.
  const isPicked = (c: GuCandidate) => (c.market === 'US' ? isGuidanceUpgradeCandidate(c).include || looksLikeGuidanceRaise(`${c.title}. ${c.text}`) : isRaiseCandidate(c));
  const pickedAll = inWindow.filter(isPicked);
  // zzz849: an India / global discovery with no NSE symbol (or whose "company" is a phrase, not a name) is QUARANTINED: counted and listed for diagnostics, never an event
  const quarantine = quarantineUnresolved(pickedAll);
  const unresolvedList = quarantine.unresolved;
  const picked = quarantine.kept.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const split = splitByMarket(picked, long ? PER_MARKET_CAP_LONG : PER_MARKET_CAP);
  for (const c of picked) if (c.market === 'IN' || c.market === 'US') cov[c.market].candidates[originOf(c)]++;
  // exchange announcements whose subject names a guidance-bearing document but carry no raise text we can read
  const subjectOnly = collectSubjectOnly(inWindow.filter((c) => c.market === 'IN' && !isPicked(c)));

  // Ledger reads (history) — one batched read per market, then a synchronous ctxFor.
  const tickersOf = (list: GuCandidate[]) => Array.from(new Set(list.map((c) => c.ticker).filter((t): t is string => !!t)));
  const inTickers = tickersOf([...split.IN, ...split.GLOBAL]);
  const usPicked = tickersOf(split.US);
  const left = () => Math.max(2_000, BUDGET_MS - (Date.now() - t0));
  const [ledIN, ledUS, uniRecords] = await Promise.all([
    withTimeout(readLedgers(inTickers, 'IN'), left(), new Map()),
    withTimeout(readLedgers(usPicked, 'US'), left(), new Map()),
    // zzz849: persistent guidance-universe records (researched data + stored + ledger), read only, for events that have no before-and-after numbers of their own
    withTimeout(loadUniverseRecords({ IN: inTickers, US: usPicked }, now), Math.min(3_500, left()), [] as GuUniverseRecordX[]),
  ]);
  const extraFor = makeExtraFor(universeLookup(uniRecords));

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

  const storedIds = new Set<string>([...storedIN, ...storedUS].map((c) => c.id));
  let all: GuidanceEvent[] = [];
  let corroborated = 0; let reconcileNotFound = 0; let unmatchedSubjects = subjectOnly;
  try {
    const inRaw = processRaiseCandidates([...split.IN, ...split.GLOBAL], ctxMaker('IN', ledIN), now, window, extraFor);
    const usRaw = processCandidates(split.US, ctxMaker('US', ledUS), now, window, extraFor);
    // zzz853: search the filings already loaded (+-10 days, same company) for the primary document: found -> PRIMARY SOURCE FOUND + queue P0; none -> SECONDARY-SOURCE CLAIM
    const recIn = reconcilePrimary(inRaw, filingPool); const recUs = reconcilePrimary(usRaw, filingPool);
    corroborated = recIn.found; reconcileNotFound = recIn.notFound + recUs.notFound;
    const q2 = enqueue(queue, [...recIn.queueInputs, ...recUs.queueInputs], now); queue = q2.queue;
    const matchedKey = (e: GuidanceEvent) => `${e.market === 'US' ? 'US' : 'IN'}|${(e.ticker || '').toUpperCase()}|${normCompanyName(e.company)}`;
    const matchedSet = new Set(recIn.events.filter((e) => e.primaryState === 'PRIMARY_SOURCE_FOUND').map(matchedKey));
    unmatchedSubjects = subjectOnly.filter((f) => !matchedSet.has(`IN|${(f.ticker || '').toUpperCase()}|${f.nameKey}`) && !recIn.events.some((e) => e.primaryState === 'PRIMARY_SOURCE_FOUND' && ((f.ticker && f.ticker.toUpperCase() === (e.ticker || '').toUpperCase()) || (!!f.nameKey && f.nameKey === normCompanyName(e.company)))));
    const inEvents = recIn.events;
    const usEvents = recUs.events;
    // the same release also cut something: the engine keeps the raises, so say the cut here
    for (const e of usEvents) {
      const cuts = usCuts.get(e.ticker.toUpperCase());
      if (cuts?.length && e.primaryAvailable) e.risks = [`${cuts[0]}.`, ...e.risks].slice(0, 4);
    }
    // the announcement date may have moved to the company's filing: the window is cut on that date (never on a media date)
    all = rank([...inEvents, ...usEvents]).filter((e) => withinWindow(e.announcement_date, window, now));
  } catch (e: any) {
    console.error('[guidance-upgrades] engine error', e?.message || e);
    return NextResponse.json({ ok: false, error: 'The guidance engine could not finish. Please try again.' }, { status: 500 });
  }
  const eventsBuilt = withProvenance(tagOrigin(filterByMarket(all, market), cands.filter((c) => !storedIds.has(c.id)), [...storedIN, ...storedUS]));
  // zzz854 ORDER (each step sees the previous one's output):
  //   1. build      — engine events with their pipeline (CARD / AUDIT / QUEUE / DROPPED); only VERIFIED events can be CARD / AUDIT
  //   2. reconcile  — reconcilePrimary (above): primary filing found / secondary claim
  //   3. AI overlay — cached AI verdicts for events the engine could not verify: confirmed (numbers matched) → VERIFIED + named document,
  //                   then withClassification re-derives pipeline + decision (it reaches a card ONLY by the engine's own rules);
  //                   contradicted → review queue (invalid) with the reason; anything else → queue, reason says the verification state;
  //                   unchecked claims are queued for /api/v1/ai-verify. No paid AI call here.
  //   4. invariants — enforceEventInvariants (final word: demotes / excludes, mutates in place)
  //   5. summarise  — on the FULL list, so summary.pipeline covers every item
  //   6. partition  — partitionPipeline: events = cards + audit (shown), reviewQueue = everything else (one awaiting concept)
  const ov = await verifyEventsOverlay(eventsBuilt, (e) => { try { return withClassification(e); } catch { return e; } }, { timeoutMs: 2_000 }).catch(() => null);
  const eventsAll: GuidanceEvent[] = ov ? ov.events : eventsBuilt;   // overlay failed: the engine pipeline alone (it never shows an unverified event)
  enforceEventInvariants(eventsAll);
  const part = partitionPipeline(eventsAll);
  const isExcluded = (e: GuidanceEvent) => !!(e as any).excludedFromEvents;
  const leaked = [...part.cards, ...part.audit].filter(isExcluded);   // excluded must never be shown: they join the queue with their reason
  const events: GuidanceEvent[] = [...part.cards, ...part.audit].filter((e) => !isExcluded(e));
  const aiById = new Map(eventsAll.map((e) => [e.guidance_event_id, (e as any).aiVerification]));
  const reviewQueue = [...part.queue, ...leaked.map(reviewItemOf)].map((q) => (aiById.get(q.id) ? { ...q, aiVerification: aiById.get(q.id) } : q));

  // Write the ledger AFTER the answer is built; bounded, idempotent, never blocks the response for long.
  // Raise-worded India news is also kept (35 days, newest 150) so a 7D / 14D window still sees it after the feeds drop the article.
  const retainedIds = new Set(((Array.isArray(retained.v) ? retained.v : []) as GuCandidate[]).map((c) => c?.id));
  const freshMedia = picked.filter((c) => c.market === 'IN' && c.id.startsWith('news:') && !retainedIds.has(c.id));
  const keepFrom = new Date(now.getTime() - RETAINED_DAYS * 86_400_000).toISOString();
  let retainNext: GuCandidate[] | null = null;
  if (freshMedia.length) {
    const seenRet = new Set<string>();
    retainNext = [...freshMedia, ...((Array.isArray(retained.v) ? retained.v : []) as GuCandidate[])]
      .filter((c) => c?.publishedAt && c.publishedAt >= keepFrom && !seenRet.has(c.id) && !!seenRet.add(c.id)).slice(0, RETAINED_MAX);
    while (retainNext.length > 1 && JSON.stringify(retainNext).length > RETAINED_MAX_CHARS) retainNext = retainNext.slice(0, Math.ceil(retainNext.length * 0.9));   // stay inside one KV value
  }
  // Persisted raise events + processed days (one canonical event = one record, several sources). Idempotent: a run that learned nothing new writes nothing.
  const gradedDaySet = await gradedDaysP;
  const persist = async (m: 'IN' | 'US'): Promise<void> => {
    try {
      const scanRes = m === 'IN' ? inScan : usScan;
      if ((m === 'IN' && !wantIN) || (m === 'US' && !wantUS)) return;
      const sk = m === 'IN'
        ? mergeCandidates([...split.IN, ...split.GLOBAL].map((c) => sanitizeRaiseCandidate(c)).filter((c): c is GuCandidate => !!c))   // never store a candidate the guard rejected
        : mergeCandidates(split.US.map((c) => sanitizeRaiseCandidate(c)).filter((c): c is GuCandidate => !!c && isGuidanceUpgradeCandidate(c).include));
      // a day counts as processed only when every live source answered for it (India: and a results session exists, or it is a weekend)
      const liveDays = scanRes?.liveDays ?? [];
      const covered = m === 'IN'
        ? (gradedDaySet ? computeCoverage({ days: liveDays, live: new Set(liveDays), graded: gradedDaySet }).covered : [])
        : (usSessions ? liveDays : []);
      const r = mergeIntoStore(m === 'IN' ? storeIN : storeUS, sk, covered, now);
      if (r.changed) await writeEventStore(r.store);
    } catch { /* the store is an accelerator: the page never depends on it */ }
  };
  await withTimeout(Promise.all([
    persist('IN'), persist('US'),
    // zzz854: the ledger records what is shown (cards + audit); every event's status goes to the universe digest
    writeEvents(events.filter((e) => e.market !== 'US' && isResolvedTicker(e.ticker)), ledIN, 'IN'),
    writeEvents(events.filter((e) => e.market === 'US'), ledUS, 'US'),
    writeEventStatuses(eventsAll).catch(() => false),
    (feedRead as ConcallFeedRead | null)?.wrote ?? Promise.resolve(),
    retainNext ? kvSet(RETAINED_KEY, retainNext, RETAINED_DAYS * 86_400).catch(() => 0) : Promise.resolve(0),
    // zzz853: the queue (last write wins: two overlapping runs may each save their own view; items are idempotent, so the next run re-derives anything lost)
    (qRun?.changed || enq.added > 0 || (queueReadOk && queue.items.length)) ? writeQueue(queue).catch(() => false) : Promise.resolve(false),
    nr.v?.wrote ?? Promise.resolve(),
  ]).then(() => 0), 3_000, 0);

  // India: what each source returned, in numbers, so a zero can be explained (never by consensus).
  const read: IndiaRead = {
    news: inBuild?.counts.news ?? 0, newsScraped: inBuild?.counts.newsScraped ?? scrapedList.length, retained: inBuild?.counts.retained ?? 0,
    filings: (inBuild?.counts.filings ?? 0) + (inScan?.rowsSeen ?? 0), graded: inBuild?.counts.gradedRows ?? 0,
    subjectOnly: unmatchedSubjects.length, unresolved: unresolvedList.length, noCompany: 0,   // unnamed discoveries are inside `unresolved` now
  };
  if (wantIN) cov.IN.read = read;

  const srcRow = (name: string, n: number, bad: string | null, detail: string): GuScanSource => ({ name, state: bad ? 'FAILED' : 'COMPLETE', scanned: n, detail: bad || detail });
  const newsRaise = picked.filter((c) => c.market !== 'US' && c.id.startsWith('news:')).length;
  // long window: results sessions exist only on weekdays and expire from the cache, so PARTIAL is said plainly instead of COMPLETE
  const weekdaysInWindow = dates.filter((d) => { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); return w !== 0 && w !== 6; }).length;
  const resultsRow: GuScanSource = srcRow('India results cache', read.graded, gradedPayloads ? null : (graded.timedOut ? 'graded cache timed out' : `no graded session found for ${dates[dates.length - 1]} to ${dates[0]}`), `${read.graded} results rows with guidance text, from ${gradedPayloads} of ${dates.length} days`);
  if (long && gradedPayloads > 0 && gradedPayloads < weekdaysInWindow) {
    resultsRow.state = 'PARTIAL';
    resultsRow.detail = `${read.graded} results rows with guidance text, from ${gradedPayloads} of ${weekdaysInWindow} weekday sessions in the window; older sessions have left the cache, so days before them are covered only if an earlier run processed them`;
  }
  const inExtra: GuScanSource[] = wantIN ? [
    srcRow('India news cache', read.news, newsList?.length ? null : (nr.v?.row.text ?? whyEmpty(news, NEWS_KEY)), `${read.news} India of ${inBuild?.counts.newsAll ?? 0} articles read${nr.v && nr.v.servedBy !== 'LIVE' ? ` (served from the ${nr.v.servedBy === 'NONE' ? 'fallback' : 'last good'} copy)` : ''}`),
    srcRow('Scraped India news', read.newsScraped, scrapedList.length ? null : whyEmpty(scraped, SCRAPED_NEWS_KEY), `${read.newsScraped} entries read (company named in the headline, no ticker)${read.retained ? `; ${read.retained} raise-worded items kept from earlier days` : ''}; ${newsRaise} with raise wording in this window`),
    srcRow('Exchange filing feed cache', Array.isArray(feed.v?.filings) ? feed.v.filings.length : 0, Array.isArray(feed.v?.filings) ? null : (feed.timedOut ? 'concall-feed timed out' : (feedRead as ConcallFeedRead | null)?.label ?? 'not read'), (feedRead as ConcallFeedRead | null)?.label ?? `${feed.v?.filings?.length ?? 0} announcements read`),
    resultsRow,
    srcRow('Announcements with subject only', unmatchedSubjects.length, null, `${unmatchedSubjects.length} announcement${unmatchedSubjects.length === 1 ? '' : 's'} name an AGM outcome, presentation, press release, call or results document${unmatchedSubjects.length ? ` (e.g. ${unmatchedSubjects.slice(0, 4).map((f) => f.company || f.ticker || 'company').join(', ')})` : ''}; the document is not opened here (filing seen, raise text not read), so they are NOT counted as raises${corroborated ? `; ${corroborated} raise${corroborated === 1 ? '' : 's'} have such a filing on file` : ''}`),
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
      scan[m] = finaliseScan(sc, { found, processed: mine.length, verified: cov[m].verified!, newest: cov[m].newest, unprocessed: m === 'IN' ? unmatchedSubjects.length : sc.awaitingGrading });
    } else {
      const ns = noScan(m, now, 'scan did not finish within budget', days, window);
      scan[m] = m === 'IN' ? finaliseScan({ ...ns, sources: [...ns.sources, ...inExtra] }, { found, processed: mine.length, verified: cov[m].verified!, newest: cov[m].newest, unprocessed: unmatchedSubjects.length }) : ns;
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
  if (!events.length) {
    // mandatory wording (never a bare nothing-found line): incomplete names the real awaiting-grading count, complete names the window
    const awaiting = Object.values(scan).reduce((a, x) => a + (x ? (x.unprocessed ?? x.awaitingGrading ?? 0) : 0), 0);
    note = `${noUpgradesNote({ window, complete: !anyIncomplete, awaiting })} Last checked ${checkedAt.slice(11, 16)} UTC.`;
  }
  note = `${note ? `${note} ` : ''}${coverageNote(covLines, now)}`;
  const enriched = events.filter((e) => !!e.v2?.numbersFrom).length;
  if (enriched) note += ` ${enriched} event${enriched === 1 ? '' : 's'} carry before and after numbers taken from the guidance universe record (source and verification tier named on each event).`;

  const summary = summarise(eventsAll, window, now);   // zzz854: full list (summary.pipeline covers cards, audit, queue and dropped)
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
  // zzz853: canonical counts (one definition per number), invariants, coverage cards and the queue report
  const qWin: QueueState = { ...queue, items: queue.items.filter((x) => withinWindow(x.event_date, window, now)) };
  const countsFor = (m: 'IN' | 'US') => computeCounts(eventsAll.filter((e) => e.market === m), {
    documentsAwaitingGrading: Math.max(awaitingCount(qWin, m), m === 'US' ? (scan.US?.awaitingGrading ?? 0) : 0),
    documentsUnavailable: unavailableCount(qWin, m), documentsReadNoEvent: readNoEventCount(qWin, m),
  });
  const countsByMarket = { IN: countsFor('IN'), US: countsFor('US') };
  const sum = (k: keyof typeof countsByMarket.IN): number => (wantIN ? countsByMarket.IN[k] : 0) + (wantUS ? countsByMarket.US[k] : 0);
  summary.countsByMarket = countsByMarket;
  summary.counts = {
    discovered: sum('discovered'), processed: sum('processed'), verified: sum('verified'), material: sum('material'), upgrade: sum('upgrade'), reiteration: sum('reiteration'),
    mixed: sum('mixed'), lowered: sum('lowered'), expectationPositive: sum('expectationPositive'), unverifiedClaims: sum('unverifiedClaims'),
    documentsAwaitingGrading: sum('documentsAwaitingGrading'), documentsUnavailable: sum('documentsUnavailable'),
  };
  {
    // zzz854: the summed counts also carry the bucket partition and the equations (sum of the markets requested)
    const xs = [wantIN ? countsDetail(countsByMarket.IN) : null, wantUS ? countsDetail(countsByMarket.US) : null].filter((x): x is GuCountsX => !!x);
    if (xs.length && xs.length === (wantIN ? 1 : 0) + (wantUS ? 1 : 0)) {
      const buckets = Object.fromEntries([...GUIDANCE_BUCKETS, ...NOT_GUIDANCE_BUCKETS].map((k) => [k, xs.reduce((a, x) => a + (x.buckets[k] ?? 0), 0)])) as Record<CountBucket, number>;
      const add = (k: 'detected' | 'notGuidance' | 'verifiedPrimaryRead' | 'shown' | 'queued' | 'dropped' | 'demotedByInvariant') => xs.reduce((a, x) => a + (x[k] ?? 0), 0);
      const notGuidance = add('notGuidance');
      Object.assign(summary.counts!, {
        detected: add('detected'), buckets, notGuidance, verifiedPrimaryRead: add('verifiedPrimaryRead'), shown: add('shown'), queued: add('queued'), dropped: add('dropped'), demotedByInvariant: add('demotedByInvariant'),
        equation: detectedEquation(buckets),
        notGuidanceEquation: `Not guidance ${notGuidance} = ${buckets.capitalRaise} ${BUCKET_LABEL.capitalRaise} + ${buckets.nonGuidance} ${BUCKET_LABEL.nonGuidance} (in the audit list, never counted as guidance)`,
      });
    }
  }
  const invariantViolations = [
    ...(wantIN ? checkEventInvariants(eventsAll.filter((e) => e.market !== 'US'), countsByMarket.IN) : []),
    ...(wantUS ? checkEventInvariants(eventsAll.filter((e) => e.market === 'US'), countsByMarket.US) : []),
    // zzz854: after the AI overlay + partition, every event is in exactly one list and the counts are those lists
    ...checkGuidanceResponseReconciles({ all: eventsAll, shown: events, queueLength: reviewQueue.length, counts: countsDetail(summary.counts) }),
  ];
  const cacheRows: GuCacheRow[] = [];
  if (nr.v) cacheRows.push(nr.v.row);
  else cacheRows.push({ name: 'News cache', key: NEWS_KEY, state: news.timedOut ? 'FETCH_FAILED' : 'CACHE_MISS', servedBy: 'NONE', items: 0, text: cacheStateText(news.timedOut ? 'FETCH_FAILED' : 'CACHE_MISS', NEWS_KEY, { reason: news.timedOut ? 'timed out' : undefined }) });
  if (wantIN) {
    const st = scraped.timedOut ? 'FETCH_FAILED' : scraped.v == null ? 'CACHE_MISS' : scrapedList.length ? 'HIT' : 'SOURCE_EMPTY';
    cacheRows.push({ name: 'Scraped India news', key: SCRAPED_NEWS_KEY, state: st, servedBy: scrapedList.length ? 'LIVE' : 'NONE', items: scrapedList.length, text: cacheStateText(st, SCRAPED_NEWS_KEY, { items: scrapedList.length, reason: scraped.timedOut ? 'timed out' : undefined }) });
  }
  const fb = newsFallbackNote(nr.v ?? { servedBy: 'NONE', liveState: 'CACHE_MISS' }, scrapedList.length, inBuild?.counts.retained ?? 0);
  const cards = (['IN', 'US'] as const).filter((m) => scan[m]).map((m) => buildCoverageCard({
    market: m, window, windowDays: days, now, scan: scan[m]!, cache: cacheRows.filter((r) => m === 'IN' || r.key === NEWS_KEY),
    fallbackNote: m === 'IN' ? fb.note : null,
    documentsAwaitingGrading: countsByMarket[m].documentsAwaitingGrading, documentsUnavailable: countsByMarket[m].documentsUnavailable,
    candidatesDiscovered: countsByMarket[m].discovered, processed: countsByMarket[m].processed, verified: countsByMarket[m].verified,
  }));
  const queueReport = reportQueue(queue, { processed: qRun?.done ?? 0, verified: qRun?.complete ?? 0, failed: (qRun?.failed ?? 0) + (qRun?.unavailable ?? 0) });
  if (reconcileNotFound) queueReport.note += ` ${reconcileNotFound} claim${reconcileNotFound === 1 ? '' : 's'} have no primary filing in the filings read so far.`;
  const verification: VerificationSummary = ov?.verification ?? { provider: 'unknown', model: null, available: false, unavailableReason: 'The AI verification state could not be read; unverified events stay in the review queue.', mode: 'enforce',
    primaryVerified: eventsAll.filter((e) => e.verification === 'VERIFIED').length, checked: 0, confirmed: 0, contradicted: 0, awaiting: 0, awaitingByReason: {}, lastRunAt: null };
  const body: GuidanceUpgradesResponse & { verification: VerificationSummary; reviewQueue: typeof reviewQueue; reviewQueueCount: number; awaitingVerificationCount: number } = {
    // zzz854: events = cards + audit (shown); reviewQueue = every other item with its status and reason (awaiting numbers / primary / AI verification ...)
    verification, reviewQueue: reviewQueue.slice(0, 600), reviewQueueCount: reviewQueue.length, awaitingVerificationCount: verification.awaiting,
    summary, events, scan,
    coverage: buildCoverageBlock(cards, window, days, now), invariantViolations, queue: queueReport,
    unresolved: unresolvedList.slice(0, 50), unresolvedCount: unresolvedList.length,
    freshness: { newestAnnouncement: newest, feedCheckedAt: checkedAt, note, byMarket },
  };
  mem.set(memKey, { at: Date.now(), body });
  if (mem.size > 20) mem.delete(mem.keys().next().value as string);
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
}

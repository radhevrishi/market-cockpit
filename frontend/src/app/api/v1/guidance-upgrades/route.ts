// ═══════════════════════════════════════════════════════════════════════════
// GET /api/v1/guidance-upgrades?window=24H|3D|7D|14D|30D&market=IN|US|ALL   (zzz843)
//
// Finds positive company guidance raises, verifies them against a primary source, and returns the engine's events.
// PUBLIC company data only: no holdings, no personal data (My Book is overlaid in the browser).
// NO PAID AI. NO document fetching. Cache-first, bounded time, partial answers are labelled.
//
// Candidate feeds (all existing, all read from KV cache; a cold cache is reported, never rebuilt here):
//   · news:articles:v39 (the News & Signals cache; India and US)
//   · concall-feed:v26:days:N (India exchange filings + concall items)
//   · graded:<engine>:<date> (India results with the company's own guidance text)
//   · us-graded:<engine>:<date>|1 (US graded results: the company's guidance, its OWN previous full-year guidance,
//     the SEC release link, and the analyst estimate already matched to the guided period)
// India and US are processed separately so a US and an India ticker with the same letters never merge.
// Consensus: US only, and only where the graded row already matched an estimate to that exact guided period.
// India has no analyst-estimates feed, so India consensus stays DATA UNAVAILABLE.
// ═══════════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvMGet } from '@/lib/kv';
import { gradedKey } from '@/lib/graded-cache-key';
import { isGuidanceUpgradeCandidate, processCandidates, rank, summarise, withinWindow } from '@/lib/guidance-upgrades';
import { US_ENGINE_VERSION, US_ENGINE_PREVIOUS_VERSIONS } from '@/lib/us-engine-version';
import type { GuCandidate, GuContext, GuidanceEvent, GuidanceUpgradesResponse } from '@/lib/guidance-upgrades-types';
import {
  parseWindow, parseMarket, lookbackDays, newsToCandidate, filingToCandidate, gradedRowToCandidate,
  collectGradedRows, dateList, dedupeCandidates, usSessionDates, loadUsSessions, usGradedRowToCandidate,
  reassignGlobalToUs, splitByMarket, filterByMarket, originOf, coverageLine, coverageNote,
  type MarketCoverage, type UsRowResult,
} from '@/lib/guidance-upgrades-candidates';
import { readLedgers, writeEvents } from '@/lib/guidance-upgrades-ledger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const NEWS_KEY = 'news:articles:v39';
const BUDGET_MS = 22_000;
const MAX_CANDIDATES = 400;
const mem = new Map<string, { at: number; body: GuidanceUpgradesResponse }>();
const MEM_TTL_MS = 5 * 60_000;

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

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
  const newsArticles: any[] = [];
  const peByTicker: Record<'IN' | 'US', Map<string, number>> = { IN: new Map(), US: new Map() };
  const usConsensus = new Map<string, NonNullable<GuContext['consensus']>>();
  const usCuts = new Map<string, string[]>();
  const usTickers = new Set<string>();

  // (a) news cache, (b) India filing feed cache, (c) India graded cache, (d) US graded cache — in parallel, each with the shared budget.
  const feedKeys = (days <= 2 ? [2, 7, 14, 30] : days <= 7 ? [7, 14, 30] : days <= 14 ? [14, 30] : [30]).map((d) => `concall-feed:v26:days:${d}`);
  const dates = dateList(now, days + 1);
  const usDates = wantUS ? usSessionDates(now, days) : [];
  const [news, feed, graded, usSessions] = await Promise.all([
    withTimeout(kvGet<any[]>(NEWS_KEY), BUDGET_MS, null),
    wantIN ? withTimeout((async () => { for (const k of feedKeys) { const v = await kvGet<any>(k); if (v && Array.isArray(v.filings)) return v; } return null; })(), BUDGET_MS, null) : Promise.resolve(null),
    wantIN ? withTimeout(kvMGet<any>(dates.map((d) => gradedKey(d))), BUDGET_MS, null) : Promise.resolve(null),
    wantUS ? withTimeout(loadUsSessions(usDates, [US_ENGINE_VERSION, ...US_ENGINE_PREVIOUS_VERSIONS.slice(0, 2)], (keys) => kvMGet<any>(keys)), BUDGET_MS, null) : Promise.resolve(null),
  ]);

  const cov: Record<'IN' | 'US', MarketCoverage> = {
    IN: { market: 'IN', candidates: { graded: 0, filings: 0, news: 0 }, cacheEmpty: [], events: 0, withConsensus: 0, newest: null },
    US: { market: 'US', candidates: { graded: 0, filings: 0, news: 0 }, cacheEmpty: [], events: 0, withConsensus: 0, newest: null },
  };

  if (wantIN) {
    if (Array.isArray(feed?.filings)) for (const f of feed.filings) { const c = filingToCandidate(f); if (c) cands.push(c); }
    else { cov.IN.cacheEmpty.push('exchange filing feed'); }
    if (Array.isArray(graded)) {
      graded.forEach((p, i) => {
        for (const r of collectGradedRows(p)) {
          const c = gradedRowToCandidate(r, dates[i]);
          if (c) { cands.push(c); const pe = Number(r?.pe); if (c.ticker && Number.isFinite(pe) && pe > 0) peByTicker.IN.set(c.ticker, pe); }
        }
      });
    } else { cov.IN.cacheEmpty.push('results cache'); }
  }
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
  }
  if (Array.isArray(news)) for (const a of news) { const c = newsToCandidate(a); if (c) { cands.push(c); newsArticles.push(a); } }
  else { cov.IN.cacheEmpty.push('news cache'); cov.US.cacheEmpty.push('news cache'); }

  const inWindow = reassignGlobalToUs(dedupeCandidates(cands), usTickers).filter((c) => withinWindow(c.publishedAt, window, now));
  const picked = inWindow.filter((c) => isGuidanceUpgradeCandidate(c).include);
  const split = splitByMarket(picked, 200);
  for (const c of picked) if (c.market === 'IN' || c.market === 'US') cov[c.market].candidates[originOf(c)]++;

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
  const allTickers = new Set([...inTickers, ...usPicked]);
  const linksByTicker = new Map<string, { ids: string[]; themes: string[] }>();
  for (const a of newsArticles) {
    const ts: string[] = Array.isArray(a?.ticker_symbols) ? a.ticker_symbols : [];
    for (const raw of ts) {
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
  try {
    const inEvents = processCandidates([...split.IN, ...split.GLOBAL], ctxMaker('IN', ledIN), now, window);
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
  await withTimeout(Promise.all([
    writeEvents(events.filter((e) => e.market !== 'US'), ledIN, 'IN'),
    writeEvents(events.filter((e) => e.market === 'US'), ledUS, 'US'),
  ]).then(() => 0), 3_000, 0);

  // Per-market coverage: what was found, how fresh, and what is DATA UNAVAILABLE.
  const newestOf = (list: GuidanceEvent[]) => list.map((e) => e.announcement_timestamp || e.announcement_date).filter(Boolean).sort().pop() || null;
  const byMarket: NonNullable<GuidanceUpgradesResponse['freshness']['byMarket']> = {};
  const covLines: MarketCoverage[] = [];
  for (const m of ['IN', 'US'] as const) {
    if ((m === 'IN' && !wantIN) || (m === 'US' && !wantUS)) continue;
    const mine = events.filter((e) => e.market === m);
    cov[m].events = mine.length;
    cov[m].withConsensus = mine.filter((e) => e.consensus.value != null).length;
    cov[m].newest = newestOf(mine);
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
  if (!events.length) note = `No verified guidance raises found in the last ${days === 1 ? '24 hours' : `${days} days`}; feed last checked ${checkedAt.slice(11, 16)} UTC.`;
  note = `${note ? `${note} ` : ''}${coverageNote(covLines, now)}`;

  const body: GuidanceUpgradesResponse = {
    summary: summarise(events, window, now), events,
    freshness: { newestAnnouncement: newest, feedCheckedAt: checkedAt, note, byMarket },
  };
  mem.set(memKey, { at: Date.now(), body });
  if (mem.size > 20) mem.delete(mem.keys().next().value as string);
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
}

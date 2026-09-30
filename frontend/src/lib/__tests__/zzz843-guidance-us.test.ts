// zzz843 — Guidance Upgrades works for the USA as well as India. Synthetic tickers only (ZZUS1, ZZUS2, ZZIN1).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { isGuidanceUpgradeCandidate, processCandidates, sourceTier } from '../guidance-upgrades';
import {
  newsToCandidate, usGradedRowToCandidate, unzipUsPayload, usSessionDates, loadUsSessions, reassignGlobalToUs, splitByMarket,
  filterByMarket, coverageLine, coverageNote, parseMarket, dedupeCandidates, isCompanyWire, type MarketCoverage,
} from '../guidance-upgrades-candidates';
import { fmtBeforeAfter, fmtNumber, fmtPoint, fmtDelta, applyFilters } from '../guidance-upgrades-format';
import { ledgerKey } from '../guidance-upgrades-ledger';
import type { GuCandidate, GuContext } from '../guidance-upgrades-types';

const NOW = new Date('2026-09-30T12:00:00Z');
const SEC = 'https://www.sec.gov/Archives/edgar/data/1/000000000026000001/ex99.htm';
const PR_TEXT = 'raises full-year revenue guidance to $10.8 billion from $10.0 billion; EPS $4.75 from $4.20';
const mk = (o: Partial<GuCandidate> = {}): GuCandidate => ({
  id: 'c1', ticker: 'ZZUS1', company: 'Zed US One', market: 'US', title: `ZZUS1 ${PR_TEXT}`, text: '', sourceName: 'Company earnings release',
  publishedAt: '2026-09-29T21:05:00Z', kind: 'RELEASE', url: SEC, ...o,
});
const noCtx = (): GuContext => ({});
const one = (cs: GuCandidate[], ctx: (t: string) => GuContext = noCtx) => { const ev = processCandidates(cs, ctx, NOW, '7D'); assert.equal(ev.length, 1, 'exactly one event'); return ev[0]; };

/** A graded-US row as the route stores it: the company's figures, its own prior full-year guide, the SEC link, the matched street estimate. */
const gradedRow = (o: any = {}) => ({
  ticker: 'ZZUS1', company: 'Zed US One Inc', filing_date: '2026-09-29', pe: 31.2, guidance: 'RAISED', guidance_url: SEC,
  guidance_figures: [
    { metric: 'revenue', basis: 'gaap', period: 'year', period_label: 'FY27', low: 10.8e9, high: 10.8e9, unit: 'usd', prior_low: null, prior_high: null, raised: null, est: 10.3e9 },
    { metric: 'eps', basis: 'adjusted', period: 'year', period_label: 'FY27', low: 4.75, high: 4.75, unit: 'usd_share', prior_low: null, prior_high: null, raised: null, est: 4.6 },
  ],
  guide_change: [
    { metric: 'revenue', basis: 'gaap', period_label: 'FY27', prev_low: 10.0e9, prev_high: 10.0e9, new_low: 10.8e9, new_high: 10.8e9, direction: 'raised', delta_pct: 8, unit: 'usd' },
    { metric: 'eps', basis: 'adjusted', period_label: 'FY27', prev_low: 4.2, prev_high: 4.2, new_low: 4.75, new_high: 4.75, direction: 'raised', delta_pct: 13.1, unit: 'usd_share' },
  ],
  ...o,
});

describe('US press release', () => {
  test('a US press-release raise is included, PRIMARY, with real BEFORE to AFTER', () => {
    const c = mk();
    assert.equal(isGuidanceUpgradeCandidate(c).include, true);
    assert.equal(sourceTier(c.sourceName, c.kind, c.url), 'PRIMARY');
    const e = one([c]);
    assert.equal(e.market, 'US');
    assert.equal(e.verification, 'VERIFIED'); assert.equal(e.primaryAvailable, true);
    const rev = e.changes.find((x) => x.after.metric === 'REVENUE')!;
    const eps = e.changes.find((x) => x.after.metric === 'EPS' || x.after.metric === 'ADJ_EPS')!;
    assert.equal(rev.before!.midpoint, 10); assert.equal(rev.after.midpoint, 10.8); assert.equal(rev.after.currency, '$'); assert.equal(rev.after.unit, 'B');
    assert.ok(Math.abs(rev.percentageChange! - 8.0) < 0.05, `revenue ${rev.percentageChange}`);
    assert.ok(Math.abs(eps.percentageChange! - 13.1) < 0.05, `eps ${eps.percentageChange}`);
    assert.equal(rev.percentagePointChange, null, 'an amount is a % change, never pp');
    assert.equal(e.type, 'G_MULTI_METRIC');
  });
  test('cards print $ amounts with their scale, cents kept, and % for amounts', () => {
    const e = one([mk()]);
    const rev = fmtBeforeAfter(e.changes.find((x) => x.after.metric === 'REVENUE')!);
    assert.deepEqual([rev.before, rev.after, rev.delta], ['$10B', '$10.8B', '+8%']);
    assert.equal(fmtPoint({ metric: 'REVENUE', period: 'FY27', low: 1.205, high: 1.205, midpoint: 1.205, isGrowthRate: false, currency: '$', unit: 'B' }), '$1.205B');
    const eps = fmtBeforeAfter(e.changes.find((x) => /EPS/.test(x.after.metric))!);
    assert.deepEqual([eps.before, eps.after, eps.delta], ['$4.20', '$4.75', '+13.1%']);
    assert.ok(!/₹|Cr/.test(JSON.stringify([rev, eps])));
  });
  test('India amounts still print in rupees and Cr; growth rates print pp, never %', () => {
    const inr = processCandidates([{ id: 'i1', ticker: 'ZZIN1', company: 'Zed India One', market: 'IN', title: 'ZZIN1 raises FY27 revenue guidance to ₹5,500 Cr from ₹5,000 Cr', text: '', sourceName: 'NSE filing', publishedAt: '2026-09-29T10:00:00Z', kind: 'FILING', url: 'https://www.nseindia.com/x' }], noCtx, NOW, '7D')[0];
    const b = fmtBeforeAfter(inr.changes[0]);
    assert.deepEqual([b.before, b.after, b.delta], ['₹5,000 Cr', '₹5,500 Cr', '+10%']);
    const g = processCandidates([mk({ id: 'g1', title: 'ZZUS1 raises FY27 revenue growth guidance to 9-11% from 6-8%' })], noCtx, NOW, '7D')[0];
    const gd = fmtDelta(g.changes[0]);
    assert.match(gd!, /pp$/); assert.ok(!gd!.includes('%'));
  });
  test('fmtPoint and fmtNumber never drop the scale and never round cents away', () => {
    assert.equal(fmtPoint({ metric: 'EPS', period: 'FY27', low: 4.75, high: 4.75, midpoint: 4.75, isGrowthRate: false, currency: '$', unit: '' }), '$4.75');
    assert.equal(fmtPoint({ metric: 'REVENUE', period: 'FY27', low: 10.7, high: 10.9, midpoint: 10.8, isGrowthRate: false, currency: '$', unit: 'B' }), '$10.7B to $10.9B');
    assert.equal(fmtNumber({ value: 10.3, unit: '$B', label: 'CONSENSUS' }), '$10.3B');
    assert.equal(fmtNumber({ value: 5500, unit: '₹ Cr', label: 'COMPANY_GUIDANCE' }), '₹5,500 Cr');
    assert.equal(fmtNumber({ value: 0.75, unit: '$', label: 'COMPANY_GUIDANCE' }), '$0.75');
    assert.equal(fmtNumber({ value: 1.5, unit: 'pp', label: 'COMPANY_GUIDANCE' }), '1.5 pp');
    assert.equal(fmtNumber({ value: null, label: 'UNAVAILABLE' }), 'DATA UNAVAILABLE');
  });
});

describe('one event from many sources', () => {
  test('Reuters + Yahoo + the company release are ONE event; primary source wins', () => {
    const reuters = mk({ id: 'r', title: `Zed US One ${PR_TEXT}`, sourceName: 'Reuters', kind: 'NEWS', url: 'https://www.reuters.com/markets/zzus1', publishedAt: '2026-09-29T21:30:00Z' });
    const yahoo = mk({ id: 'y', title: `Zed US One ${PR_TEXT}`, sourceName: 'Yahoo Finance', kind: 'NEWS', url: 'https://finance.yahoo.com/news/zzus1', publishedAt: '2026-09-29T22:00:00Z' });
    const rel = mk({ id: 'p' });
    const e = one([reuters, yahoo, rel]);
    assert.equal(e.sources.length, 3);
    assert.equal(e.sources[0].tier, 'PRIMARY');
    assert.deepEqual(e.sources.map((s) => s.tier).sort(), ['DISCOVERY', 'PRIMARY', 'SECONDARY']);
    assert.equal(e.verification, 'VERIFIED');
  });
  test('news alone is UNVERIFIED with no decision; a wire release that names the company is the company release', () => {
    const e = one([mk({ sourceName: 'Reuters', kind: 'NEWS', url: 'https://www.reuters.com/x' })]);
    assert.equal(e.verification, 'UNVERIFIED'); assert.equal(e.decision, 'UNVERIFIED');
    const wire = newsToCandidate({ id: 'w1', title: `Zed US One ${PR_TEXT}`, summary: '', published_at: '2026-09-29T21:00:00Z', region: 'US', primary_ticker: 'ZZUS1', source_name: 'Business Wire', source_url: 'https://www.businesswire.com/news/home/1' })!;
    assert.equal(wire.kind, 'RELEASE'); assert.equal(sourceTier(wire.sourceName, wire.kind, wire.url), 'PRIMARY');
    const yahooCopy = newsToCandidate({ id: 'w2', title: `Zed US One ${PR_TEXT}`, summary: '', published_at: '2026-09-29T21:10:00Z', region: 'US', primary_ticker: 'ZZUS1', source_name: 'Yahoo Finance', source_url: 'https://finance.yahoo.com/n/1' })!;
    assert.equal(yahooCopy.kind, 'NEWS'); assert.equal(sourceTier(yahooCopy.sourceName, yahooCopy.kind, yahooCopy.url), 'DISCOVERY');
    const sec = newsToCandidate({ id: 'w3', title: 'x', summary: '', published_at: '2026-09-29T21:10:00Z', region: 'US', primary_ticker: 'ZZUS1', source_name: 'EDGAR', source_url: SEC })!;
    assert.equal(sec.kind, 'FILING');
    assert.equal(isCompanyWire('Reuters', 'https://reuters.com/x'), false);
    assert.equal(newsToCandidate({ id: 'w4', title: 'x', summary: '', published_at: '2026-09-29T21:10:00Z', region: 'US', source_name: 'Business Wire', source_url: 'https://www.businesswire.com/a' })!.kind, 'NEWS', 'no company named: not treated as a company release');
    assert.equal(dedupeCandidates([wire, { ...wire, id: 'dup' }]).length, 1);
  });
  test('excluded: reiterated guidance and analyst price-target raises', () => {
    assert.equal(isGuidanceUpgradeCandidate(mk({ title: 'ZZUS1 reiterates full-year revenue guidance of $10.0 billion' })).include, false);
    assert.equal(isGuidanceUpgradeCandidate(mk({ title: 'Analyst raises ZZUS1 price target to $150 from $120', sourceName: 'Benzinga', kind: 'NEWS', url: 'https://www.benzinga.com/x' })).include, false);
    assert.equal(isGuidanceUpgradeCandidate(mk({ title: 'Analysts raise ZZUS1 revenue estimates to $10.8 billion', sourceName: 'Reuters', kind: 'NEWS', url: 'https://www.reuters.com/x' })).include, false);
  });
});

describe('US consensus', () => {
  test('consensus $10.3B against $10.8B guidance: gap +4.9% POSITIVE, unit shown as $', () => {
    const e = one([mk()], () => ({ consensus: { metric: 'REVENUE', period: 'FY27', value: 10.3, unit: '$B', source: 'test estimate' } }));
    assert.equal(e.expectationGap, 'POSITIVE'); assert.equal(e.gapPct, 4.9);
    assert.equal(e.consensus.label, 'CONSENSUS'); assert.equal(fmtNumber(e.consensus), '$10.3B');
  });
  test('no consensus: UNKNOWN, never negative, DATA UNAVAILABLE', () => {
    const e = one([mk()]);
    assert.equal(e.expectationGap, 'UNKNOWN'); assert.equal(e.gapPct, null); assert.equal(fmtNumber(e.consensus), 'DATA UNAVAILABLE');
    assert.ok(e.evidenceGaps.some((g) => /Consensus/.test(g)));
  });
  test('a consensus for a different period or a different scale is refused, not forced', () => {
    const wrongPeriod = one([mk({ title: 'ZZUS1 raises FY27 revenue guidance to $10.8 billion from $10.0 billion' })], () => ({ consensus: { metric: 'REVENUE', period: 'Q2 FY27', value: 2.5, unit: '$B', source: 't' } }));
    assert.equal(wrongPeriod.expectationGap, 'UNKNOWN');
    const wrongUnit = one([mk({ title: 'ZZUS1 raises FY27 revenue guidance to $10.8 billion from $10.0 billion' })], () => ({ consensus: { metric: 'REVENUE', period: 'FY27', value: 10300, unit: '$M', source: 't' } }));
    assert.equal(wrongUnit.expectationGap, 'UNKNOWN');
  });
  test('graded row: the estimate matched to the guided period becomes consensus in the guidance scale', () => {
    const r = usGradedRowToCandidate(gradedRow(), '2026-09-29', '2026-09-29T22:10:00Z')!;
    assert.equal(r.consensus!.metric, 'REVENUE'); assert.equal(r.consensus!.value, 10.3); assert.equal(r.consensus!.unit, '$B'); assert.equal(r.consensus!.period, 'FY27');
    assert.match(r.consensus!.source, /may already reflect the raise/); assert.match(r.consensus!.source, /2026-09-29/);
    const e = one([r.cand], () => ({ consensus: r.consensus, priceContext: r.pe ? { pe: r.pe } : undefined }));
    assert.equal(e.expectationGap, 'POSITIVE'); assert.equal(e.gapPct, 4.9);
    assert.equal(e.valuation!.currentPE.value, 31.2);
  });
  test('a row with no estimate leaves consensus undefined', () => {
    const row = gradedRow(); for (const f of row.guidance_figures) (f as any).est = null;
    assert.equal(usGradedRowToCandidate(row, '2026-09-29')!.consensus, undefined);
  });
  test('adjusted-EPS-only estimate is used only when there is no revenue estimate, in $ per share', () => {
    const row = gradedRow(); (row.guidance_figures[0] as any).est = null;
    const r = usGradedRowToCandidate(row, '2026-09-29')!;
    assert.deepEqual([r.consensus!.metric, r.consensus!.value, r.consensus!.unit], ['ADJ_EPS', 4.6, '$']);
    const e = one([r.cand], () => ({ consensus: r.consensus }));
    assert.equal(e.gapPct, 3.3); assert.equal(e.expectationGap, 'POSITIVE');
  });
});

describe('US graded row to candidate', () => {
  test('structured before/after becomes the company sentence; PRIMARY through the SEC release link', () => {
    const r = usGradedRowToCandidate(gradedRow(), '2026-09-29')!;
    assert.equal(r.cand.market, 'US'); assert.equal(r.cand.kind, 'RELEASE'); assert.equal(r.cand.url, SEC); assert.equal(r.cand.publishedAt, '2026-09-29');
    assert.match(r.cand.text, /raised FY27 revenue guidance to \$10\.8 billion from \$10 billion/);
    assert.match(r.cand.text, /raised FY27 adjusted EPS guidance to \$4\.75 from \$4\.20/);
    const e = one([r.cand]);
    assert.equal(e.primaryAvailable, true); assert.equal(e.changes.length, 2);
    assert.equal(e.changes.find((c) => c.after.metric === 'REVENUE')!.after.period, 'FY27');
    assert.equal(e.announcement_date, '2026-09-29');
  });
  test('ranges keep both ends and the old range', () => {
    const row = gradedRow({ guide_change: [{ metric: 'revenue', basis: 'gaap', period_label: 'FY27', prev_low: 9.9e9, prev_high: 10.1e9, new_low: 10.7e9, new_high: 10.9e9, direction: 'raised', unit: 'usd' }] });
    const e = one([usGradedRowToCandidate(row, '2026-09-29')!.cand]);
    const c = e.changes[0];
    assert.deepEqual([c.before!.low, c.before!.high, c.after.low, c.after.high], [9.9, 10.1, 10.7, 10.9]);
    assert.equal(fmtPoint(c.after), '$10.7B to $10.9B');
  });
  test('a prior column printed inside the release is used; reiterated, narrowed and cut-only rows give no candidate', () => {
    const inTable = gradedRow({ guide_change: [], guidance_figures: [{ metric: 'revenue', basis: 'gaap', period: 'quarter', period_label: 'Q3 FY27', low: 2.6e9, high: 2.7e9, unit: 'usd', prior_low: 2.4e9, prior_high: 2.5e9, raised: true, est: null }] });
    assert.ok(usGradedRowToCandidate(inTable, '2026-09-29'));
    const re = gradedRow({ guidance: 'REITERATED', guide_change: [{ ...gradedRow().guide_change[0], direction: 'reiterated' }], guidance_figures: [] });
    assert.equal(usGradedRowToCandidate(re, '2026-09-29'), null);
    const cutOnly = gradedRow({ guidance: 'LOWERED', guide_change: [{ ...gradedRow().guide_change[0], direction: 'lowered', new_low: 9.5e9, new_high: 9.5e9 }], guidance_figures: [] });
    assert.equal(usGradedRowToCandidate(cutOnly, '2026-09-29'), null);
  });
  test('mixed release: the raise is kept and the cut in the same release is carried as a stated risk', () => {
    const row = gradedRow({ guide_change: [gradedRow().guide_change[0], { ...gradedRow().guide_change[1], direction: 'lowered', new_low: 4.0, new_high: 4.0 }] });
    const r = usGradedRowToCandidate(row, '2026-09-29')!;
    assert.equal(r.cuts.length, 1); assert.match(r.cuts[0], /lowered FY27 adjusted EPS guidance to \$4\.00 from \$4\.20/);
    assert.equal(one([r.cand]).changes.length, 1);
  });
  test('no SEC link means not PRIMARY: it stays UNVERIFIED with no decision', () => {
    const r = usGradedRowToCandidate(gradedRow({ guidance_url: undefined, filing_url: 'https://example.com/pr' }), '2026-09-29')!;
    assert.equal(r.cand.kind, 'OTHER'); assert.equal(r.cand.url, undefined);
    const e = one([r.cand]);
    assert.equal(e.verification, 'UNVERIFIED'); assert.equal(e.decision, 'UNVERIFIED');
  });
  test('unsupported measures (gross margin, comps, product revenue) are skipped, never guessed', () => {
    const row = gradedRow({ guide_change: [{ metric: 'gross_margin', basis: 'gaap', period_label: 'FY27', prev_low: 60, prev_high: 60, new_low: 62, new_high: 62, direction: 'raised', unit: 'pct' }, { metric: 'product_revenue', basis: 'gaap', period_label: 'FY27', prev_low: 5e9, prev_high: 5e9, new_low: 6e9, new_high: 6e9, direction: 'raised', unit: 'usd' }], guidance_figures: [], guidance: 'MIXED' });
    assert.equal(usGradedRowToCandidate(row, '2026-09-29'), null);
  });
  test('verbatim outlook sentences are used only when the row itself says RAISED and no numbers were structured', () => {
    const row = { ticker: 'ZZUS2', company: 'Zed US Two', filing_date: '2026-09-29', guidance: 'RAISED', guidance_url: SEC, guidance_snippets: ['We are raising our full-year outlook and now expect revenue of $2.1 billion, up from $1.9 billion, driven by strong demand.'] };
    const r = usGradedRowToCandidate(row, '2026-09-29')!;
    assert.equal(r.cand.ticker, 'ZZUS2');
    assert.equal(usGradedRowToCandidate({ ...row, guidance: 'PROVIDED' }, '2026-09-29'), null);
  });
  test('quarter guides carry their quarter; a raise with no before is not a measured upgrade', () => {
    const row = gradedRow({ guide_change: [], guidance_figures: [{ metric: 'revenue', basis: 'gaap', period: 'quarter', period_label: 'Q3 FY27', low: 2.6e9, high: 2.7e9, unit: 'usd', prior_low: 2.4e9, prior_high: 2.5e9, raised: true, est: null }] });
    const e = one([usGradedRowToCandidate(row, '2026-09-29')!.cand]);
    assert.equal(e.changes[0].after.period, 'Q3 FY27'); assert.equal(e.changes[0].before!.midpoint, 2.45);
  });
});

describe('US cache: KV shape, sessions, cold cache', () => {
  const payload = (tickers: string[]) => ({ generated_at: '2026-09-29T22:00:00Z', by_tier: { STRONG: tickers.map((t) => gradedRow({ ticker: t })) } });
  test('gzip payloads and plain payloads both unpack; junk gives null', () => {
    const p = payload(['ZZUS1']);
    assert.equal(unzipUsPayload({ z: gzipSync(Buffer.from(JSON.stringify(p))).toString('base64') }).by_tier.STRONG[0].ticker, 'ZZUS1');
    assert.equal(unzipUsPayload(p).by_tier.STRONG.length, 1);
    assert.equal(unzipUsPayload({ z: 'not-gzip' }), null); assert.equal(unzipUsPayload(null), null); assert.equal(unzipUsPayload({ nope: 1 }), null);
  });
  test('session dates are Eastern weekdays, newest first', () => {
    assert.deepEqual(usSessionDates(NOW, 3), ['2026-09-30', '2026-09-29', '2026-09-28']);
    assert.ok(usSessionDates(NOW, 30).length <= 24);
  });
  test('loadUsSessions reads the current engine first, older versions only for missing days, and counts cold days', async () => {
    const store: Record<string, any> = {
      'us-graded:V2:2026-09-30|1': { z: gzipSync(Buffer.from(JSON.stringify(payload(['ZZUS1'])))).toString('base64') },
      'us-graded:V1:2026-09-29|1': payload(['ZZUS2']),
    };
    const asked: string[] = [];
    const r = await loadUsSessions(['2026-09-30', '2026-09-29', '2026-09-28'], ['V2', 'V1'], async (keys) => { asked.push(...keys); return keys.map((k) => store[k] ?? null); });
    assert.deepEqual([r.total, r.warm, r.olderEngine], [3, 2, 1]);
    assert.ok(!asked.includes('us-graded:V1:2026-09-30|1'), 'a day found under the current version is not re-read');
    const cold = await loadUsSessions(['2026-09-30'], ['V2'], async (k) => k.map(() => null));
    assert.deepEqual([cold.warm, cold.total], [0, 1]);
    const boom = await loadUsSessions(['2026-09-30'], ['V2'], async () => { throw new Error('kv down'); });
    assert.equal(boom.warm, 0);
  });
  test('coverage note is honest per market: cold cache, counts, consensus, freshness', () => {
    const us: MarketCoverage = { market: 'US', candidates: { graded: 0, filings: 0, news: 2 }, sessions: { warm: 0, total: 6, olderEngine: 0 }, cacheEmpty: [], events: 1, withConsensus: 0, newest: '2026-09-28' };
    const l = coverageLine(us, NOW);
    assert.match(l, /US graded-results cache is cold \(0 of 6 sessions found\)/); assert.match(l, /Consensus unavailable for all 1 event/); assert.match(l, /Newest announcement 2026-09-28 \(2d ago\)/);
    const warm: MarketCoverage = { ...us, candidates: { graded: 3, filings: 0, news: 1 }, sessions: { warm: 5, total: 6, olderEngine: 1 }, events: 2, withConsensus: 1, newest: '2026-09-29' };
    const w = coverageLine(warm, NOW);
    assert.match(w, /US: 4 raise candidates \(3 from graded results \(SEC releases\), 1 from news\)/); assert.match(w, /5 of 6 US sessions/); assert.match(w, /1 from an earlier grading version/);
    assert.match(w, /Analyst consensus matched for 1 of 2 events; DATA UNAVAILABLE for the rest/);
    const ind: MarketCoverage = { market: 'IN', candidates: { graded: 2, filings: 1, news: 0 }, cacheEmpty: [], events: 2, withConsensus: 0, newest: null };
    const n = coverageNote([ind, warm], NOW);
    assert.match(n, /India: 3 raise candidates/); assert.match(n, /no analyst estimates feed for India/); assert.match(n, /No announcement in this window/);
  });
});

describe('markets: US and India together, filters end to end', () => {
  const us = mk();
  const inr: GuCandidate = { id: 'i1', ticker: 'ZZIN1', company: 'Zed India One', market: 'IN', title: 'ZZIN1 raises FY27 revenue guidance to ₹5,500 Cr from ₹5,000 Cr', text: '', sourceName: 'NSE filing', publishedAt: '2026-09-29T10:00:00Z', kind: 'FILING', url: 'https://www.nseindia.com/x' };
  test('one response carries a US and an India event with the right market flags; filters keep the right one', () => {
    const split = splitByMarket([us, inr]);
    const events = [...processCandidates(split.IN, noCtx, NOW, '7D'), ...processCandidates(split.US, noCtx, NOW, '7D')];
    assert.deepEqual(events.map((e) => [e.ticker, e.market]).sort(), [['ZZIN1', 'IN'], ['ZZUS1', 'US']]);
    assert.deepEqual(filterByMarket(events, 'US').map((e) => e.ticker), ['ZZUS1']);
    assert.deepEqual(filterByMarket(events, 'IN').map((e) => e.ticker), ['ZZIN1']);
    assert.equal(filterByMarket(events, 'ALL').length, 2);
    assert.deepEqual(applyFilters(events, 'USA', 'ALL').map((e) => e.market), ['US']);
    assert.deepEqual(applyFilters(events, 'INDIA', 'ALL').map((e) => e.market), ['IN']);
    assert.deepEqual(applyFilters(events, 'USA', 'EPS').map((e) => e.ticker), ['ZZUS1']);
    assert.equal(parseMarket('us'), 'US'); assert.equal(parseMarket('IN'), 'IN'); assert.equal(parseMarket('x'), 'ALL');
  });
  test('the same letters in both markets are never merged into one event', () => {
    const a = { ...us, ticker: 'ZZSAME' }; const b = { ...inr, ticker: 'ZZSAME' };
    const split = splitByMarket([a, b]);
    const ev = [...processCandidates(split.IN, noCtx, NOW, '7D'), ...processCandidates(split.US, noCtx, NOW, '7D')];
    assert.equal(ev.length, 2); assert.deepEqual(ev.map((e) => e.market).sort(), ['IN', 'US']);
    assert.notEqual(ledgerKey('ZZSAME', 'US'), ledgerKey('ZZSAME', 'IN'));
    assert.equal(ledgerKey('ZZIN1'), 'guidance-ledger:v1:ZZIN1', 'India ledger keys are unchanged');
  });
  test('news with no region but a ticker the US cache knows joins the US market', () => {
    const g: GuCandidate = { ...us, market: 'GLOBAL', id: 'g' };
    assert.equal(reassignGlobalToUs([g], new Set(['ZZUS1']))[0].market, 'US');
    assert.equal(reassignGlobalToUs([g], new Set(['OTHER']))[0].market, 'GLOBAL');
  });
});

describe('static rules', () => {
  const SRC = join(__dirname, '..');
  const read = (f: string) => readFileSync(join(SRC, f), 'utf8').replace(/\/\/.*$/gm, '');
  test('candidates, ledger and route import no price or quote module and no AI', () => {
    for (const f of ['guidance-upgrades-candidates.ts', 'guidance-upgrades-ledger.ts', '../app/api/v1/guidance-upgrades/route.ts']) {
      const s = read(f);
      assert.ok(!/from '[^']*(quote|price|market-data|us-nasdaq|us-estimate-snapshot|yahoo)[^']*'/i.test(s), `${f} imports price data`);
      assert.ok(!/anthropic|openai|haiku|process\.env/i.test(s), `${f} touches AI or secrets`);
      assert.ok(!/self-call|fetch\(/.test(s), `${f} makes an HTTP call`);
    }
  });
  test('route reads US only from KV, keeps markets apart, and reports per-market coverage', () => {
    const r = read('../app/api/v1/guidance-upgrades/route.ts');
    assert.match(r, /loadUsSessions\(/); assert.match(r, /splitByMarket\(/); assert.match(r, /filterByMarket\(all, market\)/); assert.match(r, /coverageNote\(/); assert.match(r, /byMarket/);
    assert.match(r, /readLedgers\(usPicked, 'US'\)/);
    assert.ok(!/US coverage comes from the news feed only/.test(r), 'the old thin-coverage claim is gone');
    assert.ok(!/consensus: usConsensus[^\n]*IN/.test(r));
  });
  test('no ₹, Cr or IST assumption in the UI formatter; scale comes from the point', () => {
    const f = read('guidance-upgrades-format.ts');
    assert.ok(!/\bIST\b/.test(f));
    assert.ok(!/'₹ Cr'/.test(f.replace(/\/\*[\s\S]*?\*\//g, '')));
  });
});

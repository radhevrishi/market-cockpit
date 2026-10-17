// zzz1066 — Special Situations audit S01–S04: one final event set with stable ids (S01/S04), issuer identity + provenance
// (S02), separated deal maths (S03). Fixtures use the five live examples from the audit (headlines as they appeared in the
// production feed on 17 Oct 2026); no logic keys on these names.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleGatedFeed, splitRadarInputs } from '../multibagger-radar-adapter';
import { createEventClusterer } from '../special-sit-feed-quality';
import {
  specSitCanonicalId, earliestItem, resolveSpecSitIssuer, buildSecurityLookups, buildFinalMeta, provenanceOf, homeRowsFromFinal, finalCountsOf,
  normaliseLink, isFilingDocUrl,
} from '../special-sit-final';
import { computeDealAnalytics, sourcedTermsOf, isTenderArbitrage, milestoneFor, rankEstablished, parsePerShare, effectiveEventType } from '../special-sit-analytics';
import { finalListOf, archivedListOf, evidenceFilterCounts, applyEvidenceFilter } from '../../components/special-situations/final-set';
import type { RadarFeedEvent, RadarFeedItem } from '../multibagger-radar-feed-types';

const ROOT = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

type Item = { id: string; title: string; link: string; pub_date: string; source: string; region: 'IN' | 'US'; tickers: string[] };
let k = 0;
const item = (title: string, o: Partial<Item> = {}): Item => { k += 1; return { id: `i${k}`, title, link: o.link || `https://news.test/a/${k}?utm_source=rss`, pub_date: o.pub_date || '2026-10-01T06:00:00Z', source: o.source || 'BL Companies', region: o.region || 'IN', tickers: o.tickers || [] }; };

/** The route's bucketing (zzz1066): per-item canonical id, the clusterer merges same-story copies, final id from the earliest item. */
function bucket(items: Item[], type = 'ACQUISITION_PUBLIC', issuerOf: (i: Item) => string = (i) => i.tickers[0] || '') {
  const cl = createEventClusterer();
  const buckets = new Map<string, Item[]>();
  for (const it of items) {
    const base = specSitCanonicalId({ eventType: type, issuerKey: issuerOf(it), pubDate: it.pub_date, link: it.link, title: it.title });
    const id = cl.assign(base, it.title, it.region, type, { link: it.link, pubDate: it.pub_date });
    buckets.set(id, [...(buckets.get(id) || []), it]);
  }
  return Array.from(buckets.values()).map((b) => {
    const a = earliestItem(b)!;
    return { id: specSitCanonicalId({ eventType: type, issuerKey: issuerOf(a), pubDate: a.pub_date, link: a.link, title: a.title }), items: b };
  });
}

// ─── S04 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('S04 canonical ids', () => {
  test('two different unnamed acquisitions stay distinct', () => {
    const ev = bucket([item('Company acquires stake in a renewable unit'), item('Firm buys majority stake in a logistics venture')], 'ACQUISITION_PUBLIC', () => '');
    assert.equal(ev.length, 2);
    assert.notEqual(ev[0].id, ev[1].id);
  });
  test('CEAT ×381 collision cannot happen: different CEAT deals over weeks are different events', () => {
    const titles = [
      'Ceat completes Camso acquisition from Michelin', 'Ceat to acquire 51% stake in Tyresnmore for ₹40 crore', 'Ceat buys land parcel in Chennai for new plant',
      'Ceat’s Camso acquisition targets EBITDA break-even by March 2027', 'Ceat acquires a stake in a tyre-recycling startup',
    ];
    const days = ['2026-07-02', '2026-07-20', '2026-08-09', '2026-09-01', '2026-09-24'];
    const items = titles.map((t, i) => item(t, { tickers: ['CEATLTD'], pub_date: `${days[i]}T06:00:00Z` }));
    const ev = bucket(items);
    assert.ok(ev.length >= 4, `expected the different deals to stay apart, got ${ev.length}`);
    assert.equal(new Set(ev.map((e) => e.id)).size, ev.length, 'no two events share an id');
    assert.ok(ev.every((e) => e.items.length < items.length));
  });
  test('genuine syndication merges (same story, two outlets, same day)', () => {
    const ev = bucket([
      item('Nuvoco Vistas to acquire 26% stake in CleanMax SPV for ₹12 crore', { source: 'NDTV Profit', tickers: ['NUVOCO'] }),
      item('Nuvoco Vistas to acquire 26% stake in CleanMax SPV for ₹12 crore', { source: 'ET Industry', tickers: ['NUVOCO'], pub_date: '2026-10-01T09:00:00Z' }),
    ]);
    assert.equal(ev.length, 1);
    assert.equal(ev[0].items.length, 2);
  });
  test('the id is stable: taken from the earliest item, so newer copies and input order do not change it', () => {
    const a = item('Ola Electric board approves rights issue of up to ₹1,000 crore', { pub_date: '2026-09-28T06:00:00Z' });
    const b = item('Ola Electric board approves rights issue of ₹1,000 crore; promoter to participate', { pub_date: '2026-09-28T09:00:00Z', source: 'NDTV Profit' });
    const id1 = bucket([a, b], 'RIGHTS_ISSUE', () => 'Ola Electric')[0].id;
    const id2 = bucket([b, a], 'RIGHTS_ISSUE', () => 'Ola Electric')[0].id;
    assert.equal(id1, id2);
  });
  test('SEC original and its amendment share one chain id; tracking parameters do not change a link id', () => {
    assert.equal(specSitCanonicalId({ eventType: 'TENDER_OFFER', secChain: 'TPT|12345' }), specSitCanonicalId({ eventType: 'MERGER_RECOMMENDATION', secChain: 'TPT|12345' }));
    assert.equal(normaliseLink('https://X.com/a/b/?utm_source=feed&id=4#top'), 'x.com/a/b?id=4');
    assert.equal(specSitCanonicalId({ eventType: 'OPEN_OFFER', issuerKey: 'ABC', pubDate: '2026-10-01T01:00:00Z', link: 'https://n.test/1?utm_source=a' }),
      specSitCanonicalId({ eventType: 'OPEN_OFFER', issuerKey: 'ABC', pubDate: '2026-10-01T22:00:00Z', link: 'https://n.test/1?utm_medium=b' }));
  });
  test('the route builds ids from the canonical id function; the page no longer regroups events on the client', () => {
    const route = read('src/app/api/v1/special-situations/feed/route.ts');
    assert.match(route, /itemCanonicalId\(it, sig\.event_type/);
    assert.match(route, /earliestItem\(bucketItems\)/);
    const page = read('src/app/(dashboard)/special-situations/page.tsx');
    assert.doesNotMatch(page, /__source_count/);
    assert.doesNotMatch(page, /published_at \|\| pf\?\.date/);
  });
});

// ─── S01 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
let n = 0;
function ev(title: string, o: { source?: string; link?: string; region?: 'IN' | 'US'; type?: string; tier?: string; pending?: boolean; tickers?: string[]; pub?: string; description?: string } = {}): RadarFeedEvent {
  n += 1;
  const pf: RadarFeedItem = { title, source: o.source || 'ET Industry', link: o.link || `https://news.test/e/${n}`, pub_date: o.pub || '2026-10-10T06:00:00Z', region: o.region || 'IN', description: o.description };
  const e: any = { event_id: `SS_T_${n}`, event_type: o.type || 'ACQUISITION_PUBLIC', category: 'MA', region: o.region || 'IN', tier: o.tier || 'TIER_2', primary_filing: pf, filings: [pf], tickers: o.tickers || [] };
  if (o.pending) e.verification_pending = { reason: 'queued', reasonText: 'Not checked yet against the company document.' };
  return e as RadarFeedEvent;
}

describe('S01 one final set', () => {
  const kept = [
    ev('Alpha Engineering to acquire Beta Castings for ₹300 crore', { description: 'Alpha Engineering will acquire Beta Castings for ₹300 crore in cash.' }),
    ev('Alpha Engineering to acquire Beta Castings for ₹300 crore', { source: 'Livemint Companies', description: 'Alpha Engineering will acquire Beta Castings for ₹300 crore in cash.' }),
    ev('Gamma Foods announces open offer at ₹410 per share', { type: 'OPEN_OFFER', pending: true }),
    ev('Delta Chemicals board approves demerger of specialty unit', { type: 'DEMERGER_INDIA', tier: 'WATCHLIST' }),
  ];
  const contradicted = [ev('Epsilon Power to acquire Zeta Grid for ₹900 crore')];
  const expired = [ev('Theta Textiles to merge with Iota Mills')];
  const held = [{ ...ev('Kappa Interval Fund repurchase offer'), quarantine_reason: 'FUND_REPURCHASE_OFFER' } as RadarFeedEvent];
  const awaiting = [ev('Lambda Pharma to acquire Mu Labs for ₹50 crore')];
  const g = assembleGatedFeed({ kept, held, awaiting, contradicted, expired, coverageBucketOf: () => 'M&A / Merger Arb' });
  const finalIds = g.finalEvents.map((e) => e.event_id);
  const payload: any = { events: g.events, final_events: g.finalEvents.map((e, i) => ({ ...e, final: buildFinalMeta({ ev: e as any, input: g.finalInputs[i] as any, primaryVerified: !(e as any).verification_pending }) })) };

  test('final ids = Radar shown ids = count model shown (compared as id sets, not sums)', () => {
    const radarIds = splitRadarInputs(g.events).inputs.map((i) => i.id);
    assert.deepEqual([...finalIds].sort(), [...radarIds].sort());
    assert.equal(g.countModel.shown, finalIds.length);
    assert.equal(Object.values(g.countModel.shown_by_tier).reduce((a, b) => a + b, 0), finalIds.length);
    assert.deepEqual(finalListOf(payload).map((e) => e.event_id).sort(), [...finalIds].sort());
  });
  test('the syndicated copy is merged (flagged merged_into) and counted once; it is neither final nor archived', () => {
    assert.equal(finalIds.length, 3);
    const copy = g.events.find((e: any) => e.merged_into);
    assert.ok(copy, 'one merged copy');
    assert.ok(finalIds.includes((copy as any).merged_into));
    assert.ok(!finalIds.includes(copy!.event_id));
    assert.ok(!archivedListOf(payload).some((e) => e.event_id === copy!.event_id));
    const merged = g.finalEvents.find((e) => e.event_id === (copy as any).merged_into)!;
    assert.equal((merged.filings || []).length, 2, 'the copy is a linked record of the final event');
  });
  test('contradicted, expired, quarantined and hidden-awaiting events never reappear in the final list', () => {
    const banned = [...contradicted, ...expired, ...held, ...awaiting].map((e) => e.event_id);
    for (const id of banned) assert.ok(!finalIds.includes(id), id);
    assert.deepEqual(archivedListOf(payload).map((e) => e.event_id).sort(), [...banned].sort());
    const c = finalCountsOf(payload.final_events, g.events.filter((e: any) => e.quarantine_reason));
    assert.equal(c.archived, banned.length);
    assert.equal(c.archived_by_reason.AI_CONTRADICTED, 1);
    assert.equal(c.archived_by_reason.VERIFICATION_EXPIRED, 1);
  });
  test('Confirmed / Pending / Archived counts and filters reconcile', () => {
    const counts = evidenceFilterCounts(finalListOf(payload), archivedListOf(payload));
    assert.equal(counts.CONFIRMED + counts.PENDING, counts.ALL);
    assert.equal(counts.PENDING, 1);
    assert.equal(counts.ARCHIVED, 4);
    assert.deepEqual(applyEvidenceFilter(finalListOf(payload), 'PENDING').map((e) => e.event_id), [kept[2].event_id]);
  });
  test('region filter has the same meaning everywhere (subset of the final set)', () => {
    const mixed: any = { final_events: [{ ...payload.final_events[0], region: 'US' }, ...payload.final_events.slice(1)], events: payload.events };
    assert.equal(finalListOf(mixed, 'US').length + finalListOf(mixed, 'IN').length, finalListOf(mixed).length);
  });
  test('route sends final_events / final_event_ids / final_counts; page and home read them', () => {
    const route = read('src/app/api/v1/special-situations/feed/route.ts');
    assert.match(route, /final_events: finalEvents/);
    assert.match(route, /final_event_ids:/);
    const page = read('src/app/(dashboard)/special-situations/page.tsx');
    assert.match(page, /finalListOf\(feed as any, region\)/);
    const home = read('src/app/(dashboard)/page.tsx');
    assert.match(home, /ssData\.final_events/);
    assert.doesNotMatch(home, /const inferMarket = /);
    assert.doesNotMatch(home, /tradeability === 'DIRECT_TRADE'/);
  });
});

// ─── S02 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('S02 identity and provenance — the five live examples', () => {
  const lk = buildSecurityLookups({
    nseRows: [
      { symbol: 'OLAELEC', name: 'Ola Electric Mobility Limited' }, { symbol: 'NUVOCO', name: 'Nuvoco Vistas Corporation Limited' },
      { symbol: 'TMCV', name: 'Tata Motors Limited' }, { symbol: 'TMPV', name: 'Tata Motors Passenger Vehicles Limited' }, { symbol: 'RELTD', name: 'Ravindra Energy Limited' },
    ],
    usRows: [{ ticker: 'NVDA', name: 'NVIDIA CORP' }, { ticker: 'CMCSA', name: 'COMCAST CORP' }],
  });
  const meta = (title: string, o: { tickers: string[]; source: string; link: string; region: 'IN' | 'US'; company?: string }, lookups = lk) => buildFinalMeta({
    ev: { event_id: 'x', event_type: 'X', region: o.region, tickers: o.tickers, primary_filing: { title, link: o.link, source: o.source, pub_date: '2026-10-01T00:00:00Z' }, filings: [{ link: o.link }] },
    input: { company: o.company, sourceLabel: o.source }, primaryVerified: true,
  }, lookups);

  test('Ola Electric rights issue → OLAELEC, India — not PTI / US; REPORTED (news)', () => {
    const m = meta('Ola Electric Board Approves Rights Issue Of Up To Rs 1,000 Crore; Promoter To Participate', { tickers: ['PTI', 'QIP'], source: 'NDTV Profit', link: 'https://www.ndtvprofit.com/x', region: 'IN', company: 'Ola Electric' });
    assert.equal(m.issuer.ticker, 'OLAELEC');
    assert.equal(m.issuer.market, 'IN');
    assert.equal(m.provenance, 'REPORTED');
    assert.ok(m.issuer.rejected?.includes('PTI'));
    // without the full NSE list: unresolved, still India, never PTI
    const bare = meta('Ola Electric Board Approves Rights Issue Of Up To Rs 1,000 Crore', { tickers: ['PTI'], source: 'NDTV Profit', link: 'https://www.ndtvprofit.com/x', region: 'IN', company: 'Ola Electric' }, {});
    assert.equal(bare.issuer.state, 'UNRESOLVED');
    assert.equal(bare.issuer.ticker, null);
    assert.equal(bare.issuer.market, 'IN');
    assert.equal(bare.issuer.name, 'Ola Electric');
  });
  test('Nuvoco acquisition → NUVOCO, India — not SPV; acquirer / target roles kept', () => {
    const m = meta('Nuvoco Vistas To Acquire 26% Stake In CleanMax SPV For 46.4 MW Rajasthan Renewable Project', { tickers: ['SPV'], source: 'NDTV Profit', link: 'https://www.ndtvprofit.com/y', region: 'IN', company: 'Nuvoco Vistas' });
    assert.equal(m.issuer.ticker, 'NUVOCO');
    assert.equal(m.issuer.market, 'IN');
    assert.equal(m.roles.acquirer, 'Nuvoco Vistas');
    assert.match(String(m.roles.target), /CleanMax SPV/);
  });
  test('Ravindra Energy / EIM → India (EIM unresolved, never US)', () => {
    const m = meta('EIM advances ₹4,000 crore electric freight plan ahead of Ravindra Energy merger', { tickers: ['EIM'], source: 'BL Companies', link: 'https://www.thehindubusinessline.com/z', region: 'IN', company: 'EIM' });
    assert.equal(m.issuer.market, 'IN');
    assert.notEqual(m.issuer.ticker, 'EIM');
    const r = resolveSpecSitIssuer({ name: 'EIM', candidateTickers: ['EIM'], title: 'EIM advances ₹4,000 crore electric freight plan', region: 'US' }, {});
    assert.equal(r.market, 'IN', 'rupee amounts mean India even if the feed region says otherwise');
    assert.equal(r.state, 'UNRESOLVED');
  });
  test('Tata Motors / Iveco → TMCV, India; home row and full page agree', () => {
    const title = "Iveco shareholders approve Tata Motors' takeover bid; acceptance threshold cut to 80 pc";
    const m = meta(title, { tickers: ['TMCV', 'ECB'], source: 'ET Industry', link: 'https://economictimes.indiatimes.com/t', region: 'IN', company: 'Iveco' });
    assert.equal(m.issuer.ticker, 'TMCV');
    assert.equal(m.issuer.market, 'IN');
    assert.equal(m.roles.target, 'Iveco');
    const [row] = homeRowsFromFinal([{ event_id: 'x', event_type: 'OPEN_OFFER', primary_filing: { title }, final: m }]);
    assert.equal(row.ticker, m.issuer.ticker);
    assert.equal(row.market, m.issuer.market);
    assert.equal(row.href, '/stock-sheet?ticker=TMCV&market=IN', 'destination carries the market');
  });
  test('Nvidia / Jim Cramer → not CNBC and not FILED', () => {
    const m = meta('Jim Cramer says Nvidia should do a half-trillion dollar, Apple-style stock buyback', { tickers: ['CNBC'], source: 'CNBC Top', link: 'https://www.cnbc.com/2026/09/01/cramer.html', region: 'US', company: 'Jim Cramer' });
    assert.notEqual(m.issuer.ticker, 'CNBC');
    assert.equal(m.provenance, 'REPORTED');
    assert.ok(m.issuer.ticker === null || m.issuer.ticker === 'NVDA');
    assert.equal(m.issuer.market === null || m.issuer.market === 'US', true);
  });
  test('FILED only from a filing document; an unresolved issuer links to the event, never a stock sheet', () => {
    assert.equal(provenanceOf({ links: ['https://www.sec.gov/Archives/edgar/data/1/000119312526000001/x-index.htm'], confirmed: false }).provenance, 'FILED');
    assert.equal(provenanceOf({ links: ['https://www.bseindia.com/xml-data/corpfiling/AttachLive/abc.pdf'], confirmed: false }).provenance, 'FILED');
    assert.equal(provenanceOf({ links: ['https://www.prnewswire.com/news-releases/x.html'], confirmed: true }).provenance, 'REPORTED');
    assert.equal(provenanceOf({ links: ['https://news.test/1'], primaryDocumentUrl: 'https://nsearchives.nseindia.com/corporate/x.pdf', confirmed: false }).provenance, 'REPORTED', 'a located filing counts only once checked');
    assert.ok(!isFilingDocUrl('https://www.ndtvprofit.com/sec.gov/x'));
    const m = meta('Unknown Holdings to acquire a stake in a startup for ₹5 crore', { tickers: [], source: 'ET Industry', link: 'https://e.test/1', region: 'IN', company: 'Unknown Holdings' });
    const [row] = homeRowsFromFinal([{ event_id: 'SS_ABC', event_type: 'ACQUISITION_PUBLIC', primary_filing: { title: 'x' }, final: m }]);
    assert.equal(row.resolved, false);
    assert.equal(row.href, '/special-situations?tab=all&event=SS_ABC');
  });
});

// ─── S03 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('S03 deal maths: sourced / illustrative / prior', () => {
  const NOW = Date.parse('2026-10-17T00:00:00Z');
  test('GCL $10M repurchase programme: not a per-share offer, not tender arbitrage, Not established', () => {
    const e = { event_type: 'BUYBACK_TENDER', title: 'GCL authorizes $10M share repurchase program', event_date: '2026-08-28T08:48:44Z', region: 'US', terms_fields: { size: '$10M' } };
    const t = sourcedTermsOf(e);
    assert.equal(t.perShare, null);
    assert.equal(t.programmeSize, '$10M');
    assert.equal(isTenderArbitrage(e), false);
    assert.equal(effectiveEventType(e), 'BUYBACK_OPEN_MARKET');
    const a = computeDealAnalytics(e, { cmp: 4.2, now: NOW });
    assert.equal(a.established, false);
    assert.equal(a.live, null);
    assert.equal(a.grossSpreadPct, null);
    assert.equal(parsePerShare('$10M'), null);
  });
  test('GEO "boosts stock buyback plan" is a generic buyback, never "spread + odd-lot capture"', () => {
    const e = { event_type: 'BUYBACK_TENDER', title: 'GEO sells Adelanto ICE facilities; boosts stock buyback plan', region: 'US' };
    assert.equal(isTenderArbitrage(e), false);
    assert.equal(computeDealAnalytics(e, { now: NOW }).illustrative, null, 'no spread illustration for a non-spread trade');
  });
  test('a buyback the source calls a tender, with all four inputs, gives success AND failure payoffs and assumptions', () => {
    const e = { event_type: 'BUYBACK_TENDER', title: 'Acme board approves buyback through tender offer route at ₹500 per share', event_date: '2026-10-01T00:00:00Z', region: 'IN',
      terms_fields: { price: '₹500 per share', record_date: 'Record date November 30, 2026' } };
    assert.equal(isTenderArbitrage(e), true);
    const a = computeDealAnalytics(e, { cmp: 450, downsidePrice: 400, now: NOW });
    assert.equal(a.established, true);
    assert.ok(a.live);
    assert.ok(Math.abs(a.live!.successPayoffPct - 11.111) < 0.01);
    assert.ok(Math.abs(a.live!.failurePayoffPct + 11.111) < 0.01);
    assert.ok(Math.abs(a.live!.breakEvenProbabilityPct - 50) < 0.01);
    assert.ok(a.live!.assumptions.length >= 3);
    assert.equal(rankEstablished([{ item: 1, a }, { item: 2, a: computeDealAnalytics(e, { now: NOW }) }]).length, 1, 'unknown inputs are never ranked');
  });
  test('missing inputs read "Not established" with what is missing; priors carry their source', () => {
    const a = computeDealAnalytics({ event_type: 'OPEN_OFFER', title: 'Gamma Foods: open offer for 26% stake', region: 'IN', event_date: '2026-10-10T00:00:00Z' }, { now: NOW });
    assert.equal(a.established, false);
    assert.ok(a.notEstablished.includes('current price'));
    assert.ok(a.notEstablished.some((x) => x.startsWith('per-share consideration')));
    assert.ok(a.notEstablished.includes('completion date'));
    assert.ok(a.notEstablished.includes('downside if the deal fails'));
    assert.match(a.illustrative!.label, /not this deal/);
    assert.match(a.prior!.source, /static synthesis/);
  });
  test('milestones are anchored to the event date: old events are overdue, unrelated tenders get different dates', () => {
    const old = milestoneFor({ event_type: 'OPEN_OFFER', event_date: '2026-07-01T00:00:00Z' }, NOW)!;
    assert.equal(old.kind, 'ESTIMATE');
    assert.equal(old.date, '2026-07-31');
    assert.equal(old.overdue, true);
    const a = milestoneFor({ event_type: 'TENDER_OFFER', event_date: '2026-10-01T00:00:00Z' }, NOW)!;
    const b = milestoneFor({ event_type: 'TENDER_OFFER', event_date: '2026-10-12T00:00:00Z' }, NOW)!;
    assert.notEqual(a.date, b.date);
    assert.equal(milestoneFor({ event_type: 'TENDER_OFFER' }, NOW), null, 'no event date → no invented date');
    const stated = milestoneFor({ event_type: 'TENDER_OFFER', event_date: '2026-10-01T00:00:00Z', terms_fields: { expiry_date: 'expires on November 5, 2026' } }, NOW)!;
    assert.equal(stated.kind, 'SOURCED');
    assert.equal(stated.date, '2026-11-05');
  });
  test('the page no longer ranks playbook spreads as a deal return', () => {
    const page = read('src/app/(dashboard)/special-situations/page.tsx');
    assert.doesNotMatch(page, /function computeEventAnalytics/);
    assert.doesNotMatch(page, /BEST RISK \/ REWARD/);
    assert.match(page, /rankEstablished\(/);
    assert.doesNotMatch(page, /new Date\(Date\.now\(\) \+ m\.days/);
  });
});
